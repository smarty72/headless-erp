import { createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { dbError } from '../errors.js';
import { TenantParams, Uuid, errors } from '../schemas.js';
import {
  CustomerRef, Line, Totals, body, conflict, invalid, json, notFound, pathId, round2, totals, type App, type Db,
} from './common.js';

const STATUS = ['concept', 'definitief', 'betaald', 'vervallen'] as const;

const InvoiceLine = Line.omit({ item_id: true }).extend({ id: Uuid, position: z.number() }).openapi('InvoiceLine');
const InvoiceSummary = z
  .object({
    id: Uuid,
    number: z.string().nullable(),
    kind: z.enum(['factuur', 'credit']),
    status: z.enum(STATUS),
    issued_on: z.string().nullable(),
    due_on: z.string().nullable(),
    created_at: z.string(),
    customer: CustomerRef,
    total_incl: z.number(),
    open_amount: z.number(),
  })
  .openapi('InvoiceSummary');
const Invoice = InvoiceSummary.omit({ total_incl: true, open_amount: true })
  .extend({
    job: z.object({ id: Uuid, title: z.string() }).nullable(),
    customer_snapshot: z.record(z.string(), z.unknown()).nullable(),
    lines: z.array(InvoiceLine),
    payments: z.array(z.object({ id: Uuid, amount: z.number(), paid_on: z.string(), method: z.string().nullable() })),
    paid_amount: z.number(),
    open_amount: z.number(),
  })
  .extend(Totals.shape)
  .openapi('Invoice');

// Regels met id blijven bestaan (en houden hun koppeling met uren en materiaal); nieuwe zonder id.
const EditLine = Line.omit({ item_id: true }).extend({ id: Uuid.optional() });

const Params = TenantParams.extend({ invoiceId: pathId('invoiceId') });
const SELECT = `id, number, kind, status, issued_on, due_on, created_at, customer_snapshot,
  total_excl, total_vat, total_incl, customer:customers(id, name), job:jobs(id, title),
  lines:invoice_lines(id, description, quantity, unit, unit_price, vat_rate, position),
  payments(id, amount, paid_on, method)`;

type InvoiceT = z.infer<typeof Invoice>;

async function loadInvoice(db: Db, tenantId: string, invoiceId: string): Promise<InvoiceT> {
  const { data, error } = await db
    .from('invoices')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .eq('id', invoiceId)
    .order('position', { referencedTable: 'invoice_lines' })
    .order('paid_on', { referencedTable: 'payments' })
    .single();
  if (error) dbError(error);
  const row = data as unknown as Omit<InvoiceT, 'paid_amount' | 'open_amount' | 'vat_breakdown'> & {
    total_excl: number | null; total_vat: number | null; total_incl: number | null;
  };
  // Concept: totalen live uitrekenen. Definitief: de vastgelegde bedragen.
  const live = totals(row.lines);
  const sums = row.status === 'concept'
    ? live
    : { ...live, total_excl: row.total_excl ?? 0, total_vat: row.total_vat ?? 0, total_incl: row.total_incl ?? 0 };
  const paid_amount = round2(row.payments.reduce((s, p) => s + p.amount, 0));
  return { ...row, ...sums, paid_amount, open_amount: row.status === 'concept' ? 0 : round2(sums.total_incl - paid_amount) };
}

export function registerInvoices(app: App) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/invoices',
      security: [{ bearer: [] }],
      request: {
        params: TenantParams,
        query: z.object({
          status: z.enum([...STATUS, 'open']).optional().openapi({ description: '"open" = definitief of vervallen' }),
          customer_id: Uuid.optional(),
        }),
      },
      responses: { 200: json(z.array(InvoiceSummary), 'Facturen, nieuwste eerst'), ...errors },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const { status, customer_id } = c.req.valid('query');
      let query = c.var.db
        .from('invoices')
        .select(`id, number, kind, status, issued_on, due_on, created_at, total_incl, customer:customers(id, name),
          invoice_lines(quantity, unit_price, vat_rate), payments(amount)`)
        .eq('tenant_id', tenantId);
      if (status === 'open') query = query.in('status', ['definitief', 'vervallen']);
      else if (status) query = query.eq('status', status);
      if (customer_id) query = query.eq('customer_id', customer_id);
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) dbError(error);
      type R = Omit<z.infer<typeof InvoiceSummary>, 'total_incl' | 'open_amount'> & {
        total_incl: number | null;
        invoice_lines: { quantity: number; unit_price: number; vat_rate: number }[];
        payments: { amount: number }[];
      };
      return c.json(
        (data as unknown as R[]).map(({ invoice_lines, payments, ...inv }) => {
          const total_incl = inv.total_incl ?? totals(invoice_lines).total_incl;
          const paid = payments.reduce((s, p) => s + p.amount, 0);
          return { ...inv, total_incl, open_amount: inv.status === 'concept' ? 0 : round2(total_incl - paid) };
        }),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/invoices',
      summary: 'Losse conceptfactuur (zonder opdracht)',
      security: [{ bearer: [] }],
      request: { params: TenantParams, body: body(z.object({ customer_id: Uuid, lines: z.array(Line).default([]) })) },
      responses: { 201: json(Invoice, 'Conceptfactuur'), ...errors, ...invalid },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const { customer_id, lines } = c.req.valid('json');
      const { data, error } = await c.var.db
        .from('invoices')
        .insert({ tenant_id: tenantId, customer_id })
        .select('id')
        .single();
      if (error) dbError(error);
      if (lines.length) {
        const ins = await c.var.db.from('invoice_lines').insert(
          lines.map(({ item_id: _i, ...l }, i) => ({ ...l, tenant_id: tenantId, invoice_id: data.id, position: i + 1 })),
        );
        if (ins.error) dbError(ins.error);
      }
      return c.json(await loadInvoice(c.var.db, tenantId, data.id), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/invoices/{invoiceId}',
      security: [{ bearer: [] }],
      request: { params: Params },
      responses: { 200: json(Invoice, 'Factuur met regels, totalen en betalingen'), ...errors, ...notFound },
    }),
    async (c) => {
      const { tenantId, invoiceId } = c.req.valid('param');
      return c.json(await loadInvoice(c.var.db, tenantId, invoiceId), 200);
    },
  );

  // Regels van een concept bewerken: met id bijwerken, zonder id toevoegen, ontbrekend verwijderen.
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/tenants/{tenantId}/invoices/{invoiceId}',
      security: [{ bearer: [] }],
      request: { params: Params, body: body(z.object({ lines: z.array(EditLine) })) },
      responses: { 200: json(Invoice, 'Bijgewerkt'), ...errors, ...notFound, ...conflict },
    }),
    async (c) => {
      const { tenantId, invoiceId } = c.req.valid('param');
      const { lines } = c.req.valid('json');
      const current = await loadInvoice(c.var.db, tenantId, invoiceId);
      if (current.status !== 'concept') throw new HTTPException(409, { message: 'Een definitieve factuur pas je niet meer aan' });

      const keep = new Set(lines.flatMap((l) => (l.id ? [l.id] : [])));
      const remove = current.lines.filter((l) => !keep.has(l.id)).map((l) => l.id);
      if (remove.length) {
        const del = await c.var.db.from('invoice_lines').delete().eq('tenant_id', tenantId).in('id', remove);
        if (del.error) dbError(del.error);
      }
      for (const [i, { id, ...line }] of lines.entries()) {
        const row = { ...line, position: i + 1 };
        const res = id
          ? await c.var.db.from('invoice_lines').update(row).eq('tenant_id', tenantId).eq('invoice_id', invoiceId).eq('id', id)
          : await c.var.db.from('invoice_lines').insert({ ...row, tenant_id: tenantId, invoice_id: invoiceId });
        if (res.error) dbError(res.error);
      }
      return c.json(await loadInvoice(c.var.db, tenantId, invoiceId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/tenants/{tenantId}/invoices/{invoiceId}',
      summary: 'Conceptfactuur verwijderen; uren en materiaal komen weer vrij',
      security: [{ bearer: [] }],
      request: { params: Params },
      responses: { 204: { description: 'Verwijderd' }, ...errors, ...notFound, ...conflict },
    }),
    async (c) => {
      const { tenantId, invoiceId } = c.req.valid('param');
      const { data, error } = await c.var.db.from('invoices').delete().eq('tenant_id', tenantId).eq('id', invoiceId).select('id');
      if (error) dbError(error);
      if (!data.length) throw new HTTPException(404, { message: 'Factuur niet gevonden' });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/invoices/{invoiceId}/finalize',
      summary: 'Definitief maken: nummer, datum, vervaldatum (betaaltermijn van het bedrijf) en totalen',
      security: [{ bearer: [] }],
      request: { params: Params },
      responses: { 200: json(Invoice, 'Definitieve factuur'), ...errors, ...notFound, ...conflict },
    }),
    async (c) => {
      const { tenantId, invoiceId } = c.req.valid('param');
      // Geen toegang tot het bedrijf: dan weigert finalize_invoice zelf met 403.
      const tenant = await c.var.db.from('tenants').select('settings').eq('id', tenantId).maybeSingle();
      if (tenant.error) dbError(tenant.error);
      const days = Number((tenant.data?.settings as { payment_days?: number } | undefined)?.payment_days ?? 14);
      const { data, error } = await c.var.db
        .rpc('finalize_invoice', { p_tenant: tenantId, p_invoice: invoiceId, p_payment_days: days })
        .single<{ job_id: string | null }>();
      if (error) dbError(error);
      if (data.job_id) {
        const job = await c.var.db
          .from('jobs')
          .update({ status: 'gefactureerd' })
          .eq('tenant_id', tenantId)
          .eq('id', data.job_id);
        if (job.error) dbError(job.error);
      }
      return c.json(await loadInvoice(c.var.db, tenantId, invoiceId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/invoices/{invoiceId}/payments',
      summary: 'Betaling vastleggen; volledig betaald zet de factuur op betaald',
      security: [{ bearer: [] }],
      request: {
        params: Params,
        body: body(
          z.object({ amount: z.number().positive(), paid_on: z.iso.date().optional(), method: z.string().optional() }),
        ),
      },
      responses: { 201: json(Invoice, 'Betaling geboekt'), ...errors, ...notFound, ...conflict },
    }),
    async (c) => {
      const { tenantId, invoiceId } = c.req.valid('param');
      const p = c.req.valid('json');
      const { error } = await c.var.db.rpc('register_payment', {
        p_tenant: tenantId,
        p_invoice: invoiceId,
        p_amount: p.amount,
        p_paid_on: p.paid_on ?? null,
        p_method: p.method ?? null,
      });
      if (error) dbError(error);
      return c.json(await loadInvoice(c.var.db, tenantId, invoiceId), 201);
    },
  );
}

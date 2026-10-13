import { createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { dbError } from '../errors.js';
import { TenantParams, Uuid, errors } from '../schemas.js';
import {
  CustomerRef, Line, Totals, body, conflict, invalid, json, notFound, pathId, totals, type App, type Db, type LineInput,
} from './common.js';

const STATUS = ['concept', 'verzonden', 'geaccepteerd', 'afgewezen', 'verlopen'] as const;

const QuoteLine = Line.extend({ id: Uuid, position: z.number() }).openapi('QuoteLine');
const QuoteSummary = z
  .object({
    id: Uuid,
    number: z.string().nullable(),
    title: z.string().nullable(),
    status: z.enum(STATUS),
    valid_until: z.string().nullable(),
    created_at: z.string(),
    customer: CustomerRef,
    total_incl: z.number(),
  })
  .openapi('QuoteSummary');
const Quote = QuoteSummary.omit({ total_incl: true })
  .extend({
    notes: z.string().nullable(),
    lines: z.array(QuoteLine),
    job_id: Uuid.nullable().openapi({ description: 'Opdracht die uit deze offerte is ontstaan' }),
  })
  .extend(Totals.shape)
  .openapi('Quote');

const NewQuote = z
  .object({
    customer_id: Uuid,
    title: z.string().optional(),
    notes: z.string().optional(),
    valid_until: z.iso.date().optional(),
    lines: z.array(Line).default([]),
  })
  .openapi('NewQuote');
const QuoteUpdate = z
  .object({
    customer_id: Uuid.optional(),
    title: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    valid_until: z.iso.date().nullable().optional(),
    lines: z.array(Line).optional().openapi({ description: 'Vervangt alle regels (alleen bij een concept)' }),
  })
  .openapi('QuoteUpdate');

const Params = TenantParams.extend({ quoteId: pathId('quoteId') });
const SELECT = `id, number, title, notes, status, valid_until, created_at, customer:customers(id, name),
  lines:quote_lines(id, item_id, description, quantity, unit, unit_price, vat_rate, position), jobs(id)`;

type Row = Omit<z.infer<typeof Quote>, 'job_id' | keyof z.infer<typeof Totals>> & { jobs: { id: string }[] };

async function loadQuote(db: Db, tenantId: string, quoteId: string): Promise<z.infer<typeof Quote>> {
  const { data, error } = await db
    .from('quotes')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .eq('id', quoteId)
    .order('position', { referencedTable: 'quote_lines' })
    .single();
  if (error) dbError(error);
  const { jobs, ...quote } = data as unknown as Row;
  return { ...quote, job_id: jobs[0]?.id ?? null, ...totals(quote.lines) };
}

async function replaceLines(db: Db, tenantId: string, quoteId: string, lines: LineInput[]) {
  const del = await db.from('quote_lines').delete().eq('tenant_id', tenantId).eq('quote_id', quoteId);
  if (del.error) dbError(del.error);
  if (!lines.length) return;
  const ins = await db
    .from('quote_lines')
    .insert(lines.map((l, i) => ({ ...l, tenant_id: tenantId, quote_id: quoteId, position: i + 1 })));
  if (ins.error) dbError(ins.error);
}

export function registerQuotes(app: App) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/quotes',
      security: [{ bearer: [] }],
      request: {
        params: TenantParams,
        query: z.object({ status: z.enum(STATUS).optional(), customer_id: Uuid.optional() }),
      },
      responses: { 200: json(z.array(QuoteSummary), 'Offertes, nieuwste eerst'), ...errors },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const { status, customer_id } = c.req.valid('query');
      let query = c.var.db
        .from('quotes')
        .select('id, number, title, status, valid_until, created_at, customer:customers(id, name), quote_lines(quantity, unit_price, vat_rate)')
        .eq('tenant_id', tenantId);
      if (status) query = query.eq('status', status);
      if (customer_id) query = query.eq('customer_id', customer_id);
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) dbError(error);
      type R = Omit<z.infer<typeof QuoteSummary>, 'total_incl'> & { quote_lines: LineInput[] };
      return c.json(
        (data as unknown as R[]).map(({ quote_lines, ...q }) => ({ ...q, total_incl: totals(quote_lines).total_incl })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/quotes',
      security: [{ bearer: [] }],
      request: { params: TenantParams, body: body(NewQuote) },
      responses: { 201: json(Quote, 'Conceptofferte'), ...errors, ...invalid },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const { lines, ...quote } = c.req.valid('json');
      const { data, error } = await c.var.db
        .from('quotes')
        .insert({ ...quote, tenant_id: tenantId })
        .select('id')
        .single();
      if (error) dbError(error);
      await replaceLines(c.var.db, tenantId, data.id, lines);
      return c.json(await loadQuote(c.var.db, tenantId, data.id), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/quotes/{quoteId}',
      security: [{ bearer: [] }],
      request: { params: Params },
      responses: { 200: json(Quote, 'Offerte met regels en totalen'), ...errors, ...notFound },
    }),
    async (c) => {
      const { tenantId, quoteId } = c.req.valid('param');
      return c.json(await loadQuote(c.var.db, tenantId, quoteId), 200);
    },
  );

  // Alleen een concept is aan te passen; regels worden in zijn geheel vervangen.
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/tenants/{tenantId}/quotes/{quoteId}',
      security: [{ bearer: [] }],
      request: { params: Params, body: body(QuoteUpdate) },
      responses: { 200: json(Quote, 'Bijgewerkt'), ...errors, ...notFound, ...conflict },
    }),
    async (c) => {
      const { tenantId, quoteId } = c.req.valid('param');
      const { lines, ...fields } = c.req.valid('json');
      const current = await loadQuote(c.var.db, tenantId, quoteId);
      if (current.status !== 'concept') throw new HTTPException(409, { message: 'Een verstuurde offerte pas je niet meer aan' });
      if (Object.keys(fields).length) {
        const { error } = await c.var.db.from('quotes').update(fields).eq('tenant_id', tenantId).eq('id', quoteId);
        if (error) dbError(error);
      }
      if (lines) await replaceLines(c.var.db, tenantId, quoteId, lines);
      return c.json(await loadQuote(c.var.db, tenantId, quoteId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/tenants/{tenantId}/quotes/{quoteId}',
      security: [{ bearer: [] }],
      request: { params: Params },
      responses: { 204: { description: 'Verwijderd' }, ...errors, ...notFound, ...conflict },
    }),
    async (c) => {
      const { tenantId, quoteId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('quotes')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('id', quoteId)
        .eq('status', 'concept')
        .select('id');
      if (error) dbError(error);
      if (!data.length) throw new HTTPException(409, { message: 'Alleen een conceptofferte kan worden verwijderd' });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/quotes/{quoteId}/send',
      summary: 'Offerte versturen: krijgt een nummer en ligt daarna vast',
      security: [{ bearer: [] }],
      request: { params: Params, body: body(z.object({ valid_days: z.number().int().min(1).max(365).default(30) })) },
      responses: { 200: json(Quote, 'Verstuurd'), ...errors, ...notFound, ...conflict },
    }),
    async (c) => {
      const { tenantId, quoteId } = c.req.valid('param');
      const { error } = await c.var.db.rpc('send_quote', {
        p_tenant: tenantId,
        p_quote: quoteId,
        p_valid_days: c.req.valid('json').valid_days,
      });
      if (error) dbError(error);
      return c.json(await loadQuote(c.var.db, tenantId, quoteId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/quotes/{quoteId}/accept',
      summary: 'Akkoord van de klant: maakt meteen een opdracht',
      security: [{ bearer: [] }],
      request: {
        params: Params,
        body: body(z.object({ title: z.string().optional(), starts_on: z.iso.date().optional() })),
      },
      responses: { 201: json(z.object({ job_id: Uuid }), 'Opdracht aangemaakt'), ...errors, ...notFound, ...conflict },
    }),
    async (c) => {
      const { tenantId, quoteId } = c.req.valid('param');
      const { title, starts_on } = c.req.valid('json');
      const { data, error } = await c.var.db
        .rpc('accept_quote', { p_tenant: tenantId, p_quote: quoteId, p_title: title ?? null, p_starts_on: starts_on ?? null })
        .single<{ id: string }>();
      if (error) dbError(error);
      return c.json({ job_id: data.id }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/quotes/{quoteId}/decline',
      security: [{ bearer: [] }],
      request: { params: Params },
      responses: { 200: json(Quote, 'Afgewezen'), ...errors, ...notFound, ...conflict },
    }),
    async (c) => {
      const { tenantId, quoteId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('quotes')
        .update({ status: 'afgewezen' })
        .eq('tenant_id', tenantId)
        .eq('id', quoteId)
        .in('status', ['concept', 'verzonden'])
        .select('id');
      if (error) dbError(error);
      if (!data.length) throw new HTTPException(409, { message: 'Deze offerte kan niet meer worden afgewezen' });
      return c.json(await loadQuote(c.var.db, tenantId, quoteId), 200);
    },
  );
}

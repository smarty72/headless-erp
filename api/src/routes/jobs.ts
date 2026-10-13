import { createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { dbError } from '../errors.js';
import { TenantParams, Uuid, errors } from '../schemas.js';
import { Address, body, conflict, invalid, json, notFound, pathId, round2, type App, type Db } from './common.js';

const STATUS = ['gepland', 'bezig', 'opgeleverd', 'gefactureerd', 'geannuleerd'] as const;
const OPEN = ['gepland', 'bezig', 'opgeleverd'];

const JobSummary = z
  .object({
    id: Uuid,
    title: z.string(),
    status: z.enum(STATUS),
    starts_on: z.string().nullable(),
    ends_on: z.string().nullable(),
    created_at: z.string(),
    customer: z.object({ id: Uuid, name: z.string() }),
    quote_id: Uuid.nullable(),
  })
  .openapi('JobSummary');

const TimeEntry = z
  .object({
    id: Uuid,
    work_date: z.string(),
    hours: z.number().nullable().openapi({ description: 'Leeg zolang de timer loopt' }),
    started_at: z.string().nullable(),
    billable: z.boolean(),
    note: z.string().nullable(),
    invoiced: z.boolean(),
  })
  .openapi('TimeEntry');
const MaterialUsage = z
  .object({
    id: Uuid,
    item_id: Uuid.nullable(),
    description: z.string(),
    quantity: z.number(),
    unit: z.string(),
    unit_price: z.number().nullable(),
    billable: z.boolean(),
    invoiced: z.boolean(),
    created_at: z.string(),
  })
  .openapi('MaterialUsage');

const Job = JobSummary.extend({
  site_address: Address.nullable(),
  customer: z.object({ id: Uuid, name: z.string(), phone: z.string().nullable(), address: Address.nullable() }),
  quote: z.object({ id: Uuid, number: z.string().nullable(), title: z.string().nullable() }).nullable(),
  time_entries: z.array(TimeEntry),
  materials: z.array(MaterialUsage),
  invoices: z.array(z.object({ id: Uuid, number: z.string().nullable(), status: z.string(), total_incl: z.number().nullable() })),
  total_hours: z.number(),
  uninvoiced_billable_hours: z.number(),
}).openapi('Job');

const NewJob = z
  .object({
    customer_id: Uuid,
    title: z.string().trim().min(1, 'Geef de opdracht een naam'),
    site_address: Address.optional().openapi({ description: 'Standaard het adres van de klant' }),
    starts_on: z.iso.date().optional(),
    ends_on: z.iso.date().optional(),
  })
  .openapi('NewJob');
const JobUpdate = z
  .object({
    title: z.string().trim().min(1).optional(),
    status: z.enum(STATUS).optional(),
    site_address: Address.nullable().optional(),
    starts_on: z.iso.date().nullable().optional(),
    ends_on: z.iso.date().nullable().optional(),
  })
  .openapi('JobUpdate');

const NewTimeEntry = z
  .object({
    hours: z.number().positive().max(24),
    work_date: z.iso.date().optional(),
    billable: z.boolean().optional().openapi({ description: 'Standaard: ja zonder offerte, nee met offerte' }),
    note: z.string().optional(),
    item_id: Uuid.optional().openapi({ description: 'Ander uurtarief dan het standaardtarief' }),
  })
  .openapi('NewTimeEntry');
const NewMaterial = z
  .object({
    item_id: Uuid.optional(),
    description: z.string().optional().openapi({ description: 'Verplicht zonder artikel' }),
    quantity: z.number().positive(),
    unit: z.string().optional(),
    unit_price: z.number().nonnegative().optional().openapi({ description: 'Standaard de verkoopprijs van het artikel' }),
    billable: z.boolean().optional(),
  })
  .openapi('NewMaterial');

const Params = TenantParams.extend({ jobId: pathId('jobId') });
const EntryParams = Params.extend({ entryId: pathId('entryId') });
const UsageParams = Params.extend({ usageId: pathId('usageId') });

const SELECT = `id, title, status, starts_on, ends_on, created_at, quote_id, site_address,
  customer:customers(id, name, phone, address), quote:quotes(id, number, title),
  time_entries(id, work_date, hours, started_at, billable, note, invoice_line_id),
  material_usages(id, item_id, description, quantity, unit, unit_price, billable, invoice_line_id, created_at),
  invoices(id, number, status, total_incl)`;

async function loadJob(db: Db, tenantId: string, jobId: string): Promise<z.infer<typeof Job>> {
  const { data, error } = await db
    .from('jobs')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .eq('id', jobId)
    .order('work_date', { referencedTable: 'time_entries', ascending: false })
    .order('created_at', { referencedTable: 'material_usages', ascending: false })
    .single();
  if (error) dbError(error);
  type Raw = Record<string, unknown> & {
    time_entries: (Omit<z.infer<typeof TimeEntry>, 'invoiced'> & { invoice_line_id: string | null })[];
    material_usages: (Omit<z.infer<typeof MaterialUsage>, 'invoiced'> & { invoice_line_id: string | null })[];
  };
  const { time_entries, material_usages, ...job } = data as unknown as Raw;
  const entries = time_entries.map(({ invoice_line_id, ...e }) => ({ ...e, invoiced: invoice_line_id !== null }));
  return {
    ...(job as unknown as Omit<z.infer<typeof Job>, 'time_entries' | 'materials' | 'total_hours' | 'uninvoiced_billable_hours'>),
    time_entries: entries,
    materials: material_usages.map(({ invoice_line_id, ...m }) => ({ ...m, invoiced: invoice_line_id !== null })),
    total_hours: round2(entries.reduce((s, e) => s + (e.hours ?? 0), 0)),
    uninvoiced_billable_hours: round2(entries.filter((e) => e.billable && !e.invoiced).reduce((s, e) => s + (e.hours ?? 0), 0)),
  };
}

// Met offerte zijn uren en materiaal standaard nacalculatie; zonder offerte (regie) factureerbaar.
async function defaultBillable(db: Db, tenantId: string, jobId: string) {
  const { data, error } = await db.from('jobs').select('quote_id, status').eq('tenant_id', tenantId).eq('id', jobId).single();
  if (error) dbError(error);
  if (data.status === 'gefactureerd' || data.status === 'geannuleerd')
    throw new HTTPException(409, { message: 'Deze opdracht is al afgesloten' });
  return data.quote_id === null;
}

export function registerJobs(app: App) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/jobs',
      security: [{ bearer: [] }],
      request: {
        params: TenantParams,
        query: z.object({
          status: z.enum([...STATUS, 'open']).optional().openapi({ description: '"open" = gepland, bezig of opgeleverd' }),
          customer_id: Uuid.optional(),
        }),
      },
      responses: { 200: json(z.array(JobSummary), 'Opdrachten'), ...errors },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const { status, customer_id } = c.req.valid('query');
      let query = c.var.db
        .from('jobs')
        .select('id, title, status, starts_on, ends_on, created_at, quote_id, customer:customers(id, name)')
        .eq('tenant_id', tenantId);
      if (status === 'open') query = query.in('status', OPEN);
      else if (status) query = query.eq('status', status);
      if (customer_id) query = query.eq('customer_id', customer_id);
      const { data, error } = await query
        .order('starts_on', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) dbError(error);
      return c.json(data as unknown as z.infer<typeof JobSummary>[], 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/jobs',
      summary: 'Opdracht zonder offerte (regiewerk)',
      security: [{ bearer: [] }],
      request: { params: TenantParams, body: body(NewJob) },
      responses: { 201: json(Job, 'Aangemaakt'), ...errors, ...invalid },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const job = c.req.valid('json');
      let site_address = job.site_address;
      if (!site_address) {
        const cust = await c.var.db.from('customers').select('address').eq('tenant_id', tenantId).eq('id', job.customer_id).maybeSingle();
        if (cust.error) dbError(cust.error);
        site_address = (cust.data?.address as z.infer<typeof Address> | null) ?? undefined;
      }
      const { data, error } = await c.var.db
        .from('jobs')
        .insert({ ...job, site_address, tenant_id: tenantId })
        .select('id')
        .single();
      if (error) dbError(error);
      return c.json(await loadJob(c.var.db, tenantId, data.id), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/jobs/{jobId}',
      security: [{ bearer: [] }],
      request: { params: Params },
      responses: { 200: json(Job, 'Opdracht met uren, materiaal en facturen'), ...errors, ...notFound },
    }),
    async (c) => {
      const { tenantId, jobId } = c.req.valid('param');
      return c.json(await loadJob(c.var.db, tenantId, jobId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/tenants/{tenantId}/jobs/{jobId}',
      security: [{ bearer: [] }],
      request: { params: Params, body: body(JobUpdate) },
      responses: { 200: json(Job, 'Bijgewerkt'), ...errors, ...notFound },
    }),
    async (c) => {
      const { tenantId, jobId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('jobs')
        .update(c.req.valid('json'))
        .eq('tenant_id', tenantId)
        .eq('id', jobId)
        .select('id')
        .single();
      if (error) dbError(error);
      return c.json(await loadJob(c.var.db, tenantId, data.id), 200);
    },
  );

  // Uren achteraf invullen.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/jobs/{jobId}/time-entries',
      security: [{ bearer: [] }],
      request: { params: Params, body: body(NewTimeEntry) },
      responses: { 201: json(Job, 'Uren geboekt'), ...errors, ...notFound, ...conflict },
    }),
    async (c) => {
      const { tenantId, jobId } = c.req.valid('param');
      const entry = c.req.valid('json');
      const billable = entry.billable ?? (await defaultBillable(c.var.db, tenantId, jobId));
      const { error } = await c.var.db
        .from('time_entries')
        .insert({ ...entry, billable, tenant_id: tenantId, job_id: jobId, source: 'app' });
      if (error) dbError(error);
      return c.json(await loadJob(c.var.db, tenantId, jobId), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/tenants/{tenantId}/jobs/{jobId}/time-entries/{entryId}',
      security: [{ bearer: [] }],
      request: { params: EntryParams, body: body(NewTimeEntry.partial()) },
      responses: { 200: json(Job, 'Bijgewerkt'), ...errors, ...notFound, ...conflict },
    }),
    async (c) => {
      const { tenantId, jobId, entryId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('time_entries')
        .update(c.req.valid('json'))
        .eq('tenant_id', tenantId)
        .eq('job_id', jobId)
        .eq('id', entryId)
        .is('invoice_line_id', null)
        .select('id');
      if (error) dbError(error);
      if (!data.length) throw new HTTPException(409, { message: 'Gefactureerde uren pas je niet meer aan' });
      return c.json(await loadJob(c.var.db, tenantId, jobId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/tenants/{tenantId}/jobs/{jobId}/time-entries/{entryId}',
      security: [{ bearer: [] }],
      request: { params: EntryParams },
      responses: { 200: json(Job, 'Verwijderd'), ...errors, ...conflict },
    }),
    async (c) => {
      const { tenantId, jobId, entryId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('time_entries')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('job_id', jobId)
        .eq('id', entryId)
        .is('invoice_line_id', null)
        .select('id');
      if (error) dbError(error);
      if (!data.length) throw new HTTPException(409, { message: 'Gefactureerde uren verwijder je niet' });
      return c.json(await loadJob(c.var.db, tenantId, jobId), 200);
    },
  );

  // Materiaal op de klus; bij een artikel met voorraad boekt de database af.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/jobs/{jobId}/materials',
      security: [{ bearer: [] }],
      request: { params: Params, body: body(NewMaterial) },
      responses: { 201: json(Job, 'Materiaal geboekt'), ...errors, ...notFound, ...conflict, ...invalid },
    }),
    async (c) => {
      const { tenantId, jobId } = c.req.valid('param');
      const m = c.req.valid('json');
      const billable = m.billable ?? (await defaultBillable(c.var.db, tenantId, jobId));
      let { description, unit, unit_price } = m;
      if (m.item_id) {
        const item = await c.var.db
          .from('items')
          .select('name, brand, unit, sale_price')
          .eq('tenant_id', tenantId)
          .eq('id', m.item_id)
          .single();
        if (item.error) dbError(item.error);
        description ??= [item.data.brand, item.data.name].filter(Boolean).join(' ');
        unit ??= item.data.unit as string;
        unit_price ??= item.data.sale_price as number;
      }
      if (!description || !unit) throw new HTTPException(400, { message: 'Kies een artikel of geef omschrijving en eenheid' });
      const { error } = await c.var.db.from('material_usages').insert({
        tenant_id: tenantId,
        job_id: jobId,
        item_id: m.item_id,
        description,
        quantity: m.quantity,
        unit,
        unit_price,
        billable,
        source: 'app',
      });
      if (error) dbError(error);
      return c.json(await loadJob(c.var.db, tenantId, jobId), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/tenants/{tenantId}/jobs/{jobId}/materials/{usageId}',
      summary: 'Materiaal weghalen; voorraad wordt teruggeboekt',
      security: [{ bearer: [] }],
      request: { params: UsageParams },
      responses: { 200: json(Job, 'Verwijderd'), ...errors, ...conflict },
    }),
    async (c) => {
      const { tenantId, jobId, usageId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('material_usages')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('job_id', jobId)
        .eq('id', usageId)
        .is('invoice_line_id', null)
        .select('id');
      if (error) dbError(error);
      if (!data.length) throw new HTTPException(409, { message: 'Gefactureerd materiaal verwijder je niet' });
      return c.json(await loadJob(c.var.db, tenantId, jobId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/jobs/{jobId}/invoice',
      summary: 'Conceptfactuur maken: offerteregels plus factureerbare uren en materiaal',
      security: [{ bearer: [] }],
      request: { params: Params },
      responses: { 201: json(z.object({ invoice_id: Uuid }), 'Conceptfactuur'), ...errors, ...notFound, ...conflict },
    }),
    async (c) => {
      const { tenantId, jobId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .rpc('create_invoice_from_job', { p_tenant: tenantId, p_job: jobId })
        .single<{ id: string }>();
      if (error) dbError(error);
      return c.json({ invoice_id: data.id }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/jobs/{jobId}/copy-to-quote',
      summary: 'Opdracht kopiëren als nieuwe conceptofferte',
      description:
        'Met offerte: de offerteregels. Zonder offerte (regie): de geboekte uren per tarief en omschrijving, plus het materiaal.',
      security: [{ bearer: [] }],
      request: {
        params: Params,
        body: body(z.object({ customer_id: Uuid.optional().openapi({ description: 'Standaard dezelfde klant' }) })),
      },
      responses: { 201: json(z.object({ quote_id: Uuid }), 'Conceptofferte'), ...errors, ...notFound, ...invalid },
    }),
    async (c) => {
      const { tenantId, jobId } = c.req.valid('param');
      const { customer_id } = c.req.valid('json');
      const db = c.var.db;
      const job = await db
        .from('jobs')
        .select(`title, customer_id, quote_id,
          time_entries(item_id, hours, note, work_date),
          material_usages(item_id, description, quantity, unit, unit_price, created_at, item:items(sale_price, vat_rate))`)
        .eq('tenant_id', tenantId)
        .eq('id', jobId)
        .single();
      if (job.error) dbError(job.error);
      const src = job.data as unknown as CopySource;
      const lines = src.quote_id ? await quoteLines(db, tenantId, src.quote_id) : await workLines(db, tenantId, src);

      const quote = await db
        .from('quotes')
        .insert({ tenant_id: tenantId, customer_id: customer_id ?? src.customer_id, title: src.title })
        .select('id')
        .single();
      if (quote.error) dbError(quote.error);
      if (lines.length) {
        const ins = await db
          .from('quote_lines')
          .insert(lines.map((l, i) => ({ ...l, tenant_id: tenantId, quote_id: quote.data.id, position: i + 1 })));
        if (ins.error) dbError(ins.error);
      }
      return c.json({ quote_id: quote.data.id as string }, 201);
    },
  );
}

type CopySource = {
  title: string;
  customer_id: string;
  quote_id: string | null;
  time_entries: { item_id: string | null; hours: number | null; note: string | null; work_date: string }[];
  material_usages: {
    item_id: string | null; description: string; quantity: number; unit: string; unit_price: number | null; created_at: string;
    item: { sale_price: number; vat_rate: number } | null;
  }[];
};
type CopyLine = { item_id: string | null; description: string; quantity: number; unit: string; unit_price: number; vat_rate: number };

async function quoteLines(db: Db, tenantId: string, quoteId: string): Promise<CopyLine[]> {
  const { data, error } = await db
    .from('quote_lines')
    .select('item_id, description, quantity, unit, unit_price, vat_rate')
    .eq('tenant_id', tenantId)
    .eq('quote_id', quoteId)
    .order('position');
  if (error) dbError(error);
  return data as CopyLine[];
}

// Regie: uren per tarief en omschrijving (zoals op de factuur), daarna het materiaal.
async function workLines(db: Db, tenantId: string, job: CopySource): Promise<CopyLine[]> {
  const rates = await db
    .from('items')
    .select('id, name, sale_price, vat_rate, created_at')
    .eq('tenant_id', tenantId)
    .eq('kind', 'arbeid')
    .order('created_at')
    .order('name');
  if (rates.error) dbError(rates.error);
  const byId = new Map(rates.data.map((r) => [r.id as string, r]));
  const fallback = rates.data[0];

  const hours = new Map<string, CopyLine>();
  const entries = job.time_entries.filter((e) => e.hours !== null).sort((a, b) => a.work_date.localeCompare(b.work_date));
  for (const e of entries) {
    const rate = (e.item_id && byId.get(e.item_id)) || fallback;
    const note = e.note?.trim() || null;
    const key = `${rate?.id ?? ''}|${note ?? ''}`;
    const line = hours.get(key);
    if (line) line.quantity = round2(line.quantity + e.hours!);
    else
      hours.set(key, {
        item_id: (rate?.id as string | undefined) ?? null,
        description: [rate?.name ?? 'Arbeid', note].filter(Boolean).join(' – '),
        quantity: e.hours!,
        unit: 'uur',
        unit_price: (rate?.sale_price as number | undefined) ?? 0,
        vat_rate: (rate?.vat_rate as number | undefined) ?? 21,
      });
  }

  const materials = [...job.material_usages]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m) => ({
      item_id: m.item_id,
      description: m.description,
      quantity: m.quantity,
      unit: m.unit,
      unit_price: m.unit_price ?? m.item?.sale_price ?? 0,
      vat_rate: m.item?.vat_rate ?? 21,
    }));
  return [...hours.values(), ...materials];
}

import { createRoute, z } from '@hono/zod-openapi';
import { dbError } from '../errors.js';
import { TenantParams, Uuid, errors } from '../schemas.js';
import { CustomerRef, body, conflict, json, notFound, round2, searchTerm, type App, type Db } from './common.js';

const RunningTimer = z
  .object({
    id: Uuid,
    started_at: z.string(),
    note: z.string().nullable(),
    job: z.object({ id: Uuid, title: z.string(), customer: z.object({ id: Uuid, name: z.string() }) }),
  })
  .openapi('RunningTimer');

const StoppedEntry = z
  .object({ id: Uuid, job_id: Uuid, hours: z.number(), started_at: z.string(), ended_at: z.string() })
  .openapi('StoppedEntry');

const Overview = z
  .object({
    timer: RunningTimer.nullable(),
    open_jobs: z.number(),
    open_quotes: z.number().openapi({ description: 'Verstuurd, nog geen antwoord' }),
    unpaid_invoices: z.number(),
    unpaid_amount: z.number(),
    hours_this_week: z.number(),
  })
  .openapi('Overview');

const SearchResults = z
  .object({
    customers: z.array(z.object({ id: Uuid, name: z.string(), city: z.string().nullable() })),
    jobs: z.array(z.object({ id: Uuid, title: z.string(), status: z.string(), customer: CustomerRef })),
    quotes: z.array(z.object({ id: Uuid, number: z.string().nullable(), title: z.string().nullable(), status: z.string(), customer: CustomerRef })),
  })
  .openapi('SearchResults');

async function runningTimer(db: Db, tenantId: string, userId: string) {
  const { data, error } = await db
    .from('time_entries')
    .select('id, started_at, note, job:jobs(id, title, customer:customers(id, name))')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .is('hours', null)
    .maybeSingle();
  if (error) dbError(error);
  return data as unknown as z.infer<typeof RunningTimer> | null;
}

// Maandag van deze week als yyyy-mm-dd.
function weekStart(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function registerWork(app: App) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/timer',
      summary: 'Lopende timer van de ingelogde gebruiker',
      security: [{ bearer: [] }],
      request: { params: TenantParams },
      responses: { 200: json(z.object({ timer: RunningTimer.nullable() }), 'Timer of null'), ...errors },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      return c.json({ timer: await runningTimer(c.var.db, tenantId, c.var.userId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/timer/start',
      summary: 'Aan het werk: start de timer (een lopende timer stopt eerst)',
      security: [{ bearer: [] }],
      request: { params: TenantParams, body: body(z.object({ job_id: Uuid, note: z.string().optional() })) },
      responses: { 201: json(RunningTimer, 'Timer loopt'), ...errors, ...notFound, ...conflict },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const { job_id, note } = c.req.valid('json');
      const { error } = await c.var.db.rpc('start_timer', { p_tenant: tenantId, p_job: job_id, p_note: note ?? null });
      if (error) dbError(error);
      return c.json((await runningTimer(c.var.db, tenantId, c.var.userId))!, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/timer/stop',
      summary: 'Timer stoppen; uren worden op een kwartier afgerond',
      security: [{ bearer: [] }],
      request: { params: TenantParams },
      responses: { 200: json(StoppedEntry, 'Geboekte uren'), ...errors, ...notFound },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const { data, error } = await c.var.db.rpc('stop_timer', { p_tenant: tenantId }).single<z.infer<typeof StoppedEntry>>();
      if (error) dbError(error);
      const { id, job_id, hours, started_at, ended_at } = data;
      return c.json({ id, job_id, hours, started_at, ended_at }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/search',
      summary: 'Zoeken op klantnaam of project: klanten, opdrachten en offertes',
      security: [{ bearer: [] }],
      request: { params: TenantParams, query: z.object({ q: z.string() }) },
      responses: { 200: json(SearchResults, 'Gevonden, maximaal 8 per soort'), ...errors },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const term = searchTerm(c.req.valid('query').q);
      if (!term) return c.json({ customers: [], jobs: [], quotes: [] }, 200);
      const db = c.var.db;
      const customers = await db
        .from('customers')
        .select('id, name, address')
        .eq('tenant_id', tenantId)
        .is('archived_at', null)
        .ilike('name', `%${term}%`)
        .order('name')
        .limit(8);
      if (customers.error) dbError(customers.error);
      // Opdrachten en offertes vind je op hun eigen naam of op die van de klant.
      const ids = customers.data.map((r) => r.id as string);
      const ofCustomer = ids.length ? `,customer_id.in.(${ids.join(',')})` : '';
      const [jobs, quotes] = await Promise.all([
        db
          .from('jobs')
          .select('id, title, status, customer:customers(id, name)')
          .eq('tenant_id', tenantId)
          .or(`title.ilike.*${term}*${ofCustomer}`)
          .order('created_at', { ascending: false })
          .limit(8),
        db
          .from('quotes')
          .select('id, number, title, status, customer:customers(id, name)')
          .eq('tenant_id', tenantId)
          .or(`title.ilike.*${term}*,number.ilike.*${term}*${ofCustomer}`)
          .order('created_at', { ascending: false })
          .limit(8),
      ]);
      for (const r of [jobs, quotes]) if (r.error) dbError(r.error);
      return c.json(
        {
          customers: customers.data.map((r) => ({
            id: r.id as string,
            name: r.name as string,
            city: (r.address as { city?: string } | null)?.city ?? null,
          })),
          jobs: jobs.data as unknown as z.infer<typeof SearchResults>['jobs'],
          quotes: quotes.data as unknown as z.infer<typeof SearchResults>['quotes'],
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/overview',
      summary: 'Kerncijfers voor het dashboard',
      security: [{ bearer: [] }],
      request: { params: TenantParams },
      responses: { 200: json(Overview, 'Overzicht'), ...errors },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const db = c.var.db;
      const count = { count: 'exact' as const, head: true };
      const [timer, jobs, quotes, unpaid, hours] = await Promise.all([
        runningTimer(db, tenantId, c.var.userId),
        db.from('jobs').select('id', count).eq('tenant_id', tenantId).in('status', ['gepland', 'bezig', 'opgeleverd']),
        db.from('quotes').select('id', count).eq('tenant_id', tenantId).eq('status', 'verzonden'),
        db.from('invoices').select('total_incl, payments(amount)').eq('tenant_id', tenantId).in('status', ['definitief', 'vervallen']),
        db.from('time_entries').select('hours').eq('tenant_id', tenantId).eq('user_id', c.var.userId).gte('work_date', weekStart()),
      ]);
      for (const r of [jobs, quotes, unpaid, hours]) if (r.error) dbError(r.error);
      const open = (unpaid.data ?? []) as { total_incl: number; payments: { amount: number }[] }[];
      return c.json(
        {
          timer,
          open_jobs: jobs.count ?? 0,
          open_quotes: quotes.count ?? 0,
          unpaid_invoices: open.length,
          unpaid_amount: round2(open.reduce((s, i) => s + i.total_incl - i.payments.reduce((p, x) => p + x.amount, 0), 0)),
          hours_this_week: round2(((hours.data ?? []) as { hours: number | null }[]).reduce((s, e) => s + (e.hours ?? 0), 0)),
        },
        200,
      );
    },
  );
}

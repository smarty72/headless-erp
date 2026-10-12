import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { requireUser, type AuthVariables } from './auth.js';
import { dbError } from './errors.js';

const Uuid = z.uuid();
const TenantParams = z.object({ tenantId: Uuid.openapi({ param: { name: 'tenantId', in: 'path' } }) });
const ErrorBody = z.object({ error: z.string() }).openapi('Error');

const Tenant = z
  .object({ id: Uuid, name: z.string(), industry: z.string(), role: z.string() })
  .openapi('Tenant');

const Customer = z
  .object({
    id: Uuid,
    tenant_id: Uuid,
    kind: z.enum(['particulier', 'zakelijk']),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    vat_number: z.string().nullable(),
    address: z.record(z.string(), z.unknown()).nullable(),
    attributes: z.record(z.string(), z.unknown()),
  })
  .openapi('Customer');

const NewCustomer = Customer.pick({ kind: true, name: true }).partial({ kind: true }).extend({
  email: z.email().optional(),
  phone: z.string().optional(),
  vat_number: z.string().optional(),
  address: z.record(z.string(), z.unknown()).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

const FieldDefinition = z
  .object({
    entity: z.string(),
    key: z.string(),
    label: z.string(),
    data_type: z.enum(['number', 'text', 'enum', 'date', 'bool']),
    options: z.record(z.string(), z.unknown()),
    required: z.boolean(),
  })
  .openapi('FieldDefinition');

const Invoice = z
  .object({
    id: Uuid,
    number: z.string().nullable(),
    status: z.string(),
    issued_on: z.string().nullable(),
    due_on: z.string().nullable(),
    total_excl: z.number().nullable(),
    total_vat: z.number().nullable(),
    total_incl: z.number().nullable(),
  })
  .openapi('Invoice');

const errors = {
  401: { description: 'Niet ingelogd', content: { 'application/json': { schema: ErrorBody } } },
  403: { description: 'Geen rechten', content: { 'application/json': { schema: ErrorBody } } },
};

export function createApp() {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ error: result.error.issues.map((i) => i.message).join('; ') }, 400);
    },
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Interne fout' }, 500);
  });

  app.get('/health', (c) => c.json({ ok: true }));

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'HeadlessERP API', version: '0.1.0' },
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', { type: 'http', scheme: 'bearer' });

  app.use('/me/*', requireUser);
  app.use('/tenants', requireUser);
  app.use('/tenants/*', requireUser);

  // Bedrijven waar de gebruiker lid van is.
  app.openapi(
    createRoute({
      method: 'get',
      path: '/me/tenants',
      security: [{ bearer: [] }],
      responses: {
        200: { description: 'Bedrijven', content: { 'application/json': { schema: z.array(Tenant) } } },
        ...errors,
      },
    }),
    async (c) => {
      const { data, error } = await c.var.db
        .from('memberships')
        .select('role, tenants(id, name, industry)')
        .eq('user_id', c.var.userId);
      if (error) dbError(error);
      const tenants = data.flatMap((m) => {
        const t = m.tenants as unknown as { id: string; name: string; industry: string } | null;
        return t ? [{ ...t, role: m.role as string }] : [];
      });
      return c.json(tenants, 200);
    },
  );

  // Nieuw bedrijf; de aanroeper wordt owner.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants',
      security: [{ bearer: [] }],
      request: {
        body: {
          content: {
            'application/json': {
              schema: z.object({ name: z.string().min(1), industry: z.string().min(1) }),
            },
          },
        },
      },
      responses: {
        201: { description: 'Aangemaakt', content: { 'application/json': { schema: Tenant } } },
        ...errors,
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const { data, error } = await c.var.db
        .rpc('create_tenant', { p_name: body.name, p_industry: body.industry })
        .single<{ id: string; name: string; industry: string }>();
      if (error) dbError(error);
      return c.json({ id: data.id, name: data.name, industry: data.industry, role: 'owner' }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/customers',
      security: [{ bearer: [] }],
      request: { params: TenantParams },
      responses: {
        200: { description: 'Klanten', content: { 'application/json': { schema: z.array(Customer) } } },
        ...errors,
      },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('customers')
        .select('id, tenant_id, kind, name, email, phone, vat_number, address, attributes')
        .eq('tenant_id', tenantId)
        .is('archived_at', null)
        .order('name');
      if (error) dbError(error);
      return c.json(data as z.infer<typeof Customer>[], 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/customers',
      security: [{ bearer: [] }],
      request: {
        params: TenantParams,
        body: { content: { 'application/json': { schema: NewCustomer } } },
      },
      responses: {
        201: { description: 'Aangemaakt', content: { 'application/json': { schema: Customer } } },
        ...errors,
      },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('customers')
        .insert({ ...c.req.valid('json'), tenant_id: tenantId })
        .select('id, tenant_id, kind, name, email, phone, vat_number, address, attributes')
        .single();
      if (error) dbError(error);
      return c.json(data as z.infer<typeof Customer>, 201);
    },
  );

  // Velddefinities voor dit bedrijf: branche-template plus eigen velden.
  // Kanalen (formulieren, WhatsApp-vragen, AI-tools) bouwen zich hieruit op.
  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/field-definitions',
      security: [{ bearer: [] }],
      request: {
        params: TenantParams,
        query: z.object({ entity: z.string().optional() }),
      },
      responses: {
        200: { description: 'Velden', content: { 'application/json': { schema: z.array(FieldDefinition) } } },
        ...errors,
        404: { description: 'Onbekend bedrijf', content: { 'application/json': { schema: ErrorBody } } },
      },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const { entity } = c.req.valid('query');
      const tenant = await c.var.db.from('tenants').select('industry').eq('id', tenantId).single();
      if (tenant.error) dbError(tenant.error);

      // tenantId is als uuid gevalideerd, dus veilig in het filter; industry filteren we in JS.
      let query = c.var.db
        .from('field_definitions')
        .select('tenant_id, industry, entity, key, label, data_type, options, required')
        .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
        .order('entity')
        .order('position');
      if (entity) query = query.eq('entity', entity);
      const { data, error } = await query;
      if (error) dbError(error);
      const fields = data
        .filter((f) => f.tenant_id !== null || f.industry === tenant.data.industry)
        .map(({ tenant_id: _t, industry: _i, ...field }) => field);
      return c.json(fields as z.infer<typeof FieldDefinition>[], 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/invoices/{invoiceId}/finalize',
      security: [{ bearer: [] }],
      request: {
        params: TenantParams.extend({ invoiceId: Uuid.openapi({ param: { name: 'invoiceId', in: 'path' } }) }),
      },
      responses: {
        200: { description: 'Definitieve factuur', content: { 'application/json': { schema: Invoice } } },
        ...errors,
        409: { description: 'Al definitief of zonder regels', content: { 'application/json': { schema: ErrorBody } } },
      },
    }),
    async (c) => {
      const { tenantId, invoiceId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .rpc('finalize_invoice', { p_tenant: tenantId, p_invoice: invoiceId })
        .single<z.infer<typeof Invoice>>();
      if (error) dbError(error);
      const { id, number, status, issued_on, due_on, total_excl, total_vat, total_incl } = data;
      return c.json({ id, number, status, issued_on, due_on, total_excl, total_vat, total_incl }, 200);
    },
  );

  return app;
}

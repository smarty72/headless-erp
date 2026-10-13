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

const VatRate = z.union([z.literal(0), z.literal(9), z.literal(21)]);

const Item = z
  .object({
    id: Uuid,
    kind: z.enum(['materiaal', 'arbeid', 'overig']),
    name: z.string(),
    brand: z.string().nullable(),
    sku: z.string().nullable(),
    unit: z.string(),
    purchase_price: z.number().nullable(),
    sale_price: z.number(),
    vat_rate: z.number(),
    track_stock: z.boolean(),
    stock_quantity: z.number(),
    min_stock: z.number().nullable(),
    attributes: z.record(z.string(), z.unknown()),
  })
  .openapi('Item');
const ITEM_COLUMNS =
  'id, kind, name, brand, sku, unit, purchase_price, sale_price, vat_rate, track_stock, stock_quantity, min_stock, attributes';

// Prijzen zijn exclusief btw.
const NewItem = z
  .object({
    kind: z.enum(['materiaal', 'arbeid', 'overig']),
    name: z.string().min(1),
    brand: z.string().optional(),
    sku: z.string().optional(),
    unit: z.string().min(1).openapi({ example: 'stuk' }),
    purchase_price: z.number().nonnegative().optional(),
    sale_price: z.number().nonnegative(),
    vat_rate: VatRate.default(21),
    track_stock: z.boolean().default(false),
    min_stock: z.number().nonnegative().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('NewItem');

const StockMovement = z
  .object({
    id: z.number(),
    item_id: Uuid,
    quantity: z.number(),
    reason: z.enum(['beginvoorraad', 'inkoop', 'verbruik', 'correctie', 'retour']),
    job_id: Uuid.nullable(),
    unit_cost: z.number().nullable(),
    note: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('StockMovement');
const NewStockMovement = z
  .object({
    quantity: z.number().refine((q) => q !== 0, 'Aantal mag niet 0 zijn'),
    reason: z.enum(['beginvoorraad', 'inkoop', 'correctie', 'retour']),
    unit_cost: z.number().nonnegative().optional(),
    note: z.string().optional(),
  })
  .openapi('NewStockMovement');
const ItemParams = TenantParams.extend({ itemId: Uuid.openapi({ param: { name: 'itemId', in: 'path' } }) });

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

  // Artikelen: arbeid, materialen en overige posten.
  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/items',
      security: [{ bearer: [] }],
      request: {
        params: TenantParams,
        query: z.object({
          kind: z.enum(['materiaal', 'arbeid', 'overig']).optional(),
          low_stock: z.enum(['true', 'false']).optional().openapi({ description: 'Alleen artikelen onder de minimumvoorraad' }),
          search: z.string().optional(),
        }),
      },
      responses: {
        200: { description: 'Artikelen', content: { 'application/json': { schema: z.array(Item) } } },
        ...errors,
      },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const { kind, low_stock, search } = c.req.valid('query');
      let query = c.var.db.from('items').select(ITEM_COLUMNS).eq('tenant_id', tenantId).is('archived_at', null);
      if (kind) query = query.eq('kind', kind);
      if (search) {
        // Alleen letters, cijfers en spaties: de term gaat in een PostgREST-filterstring.
        const term = search.replace(/[^\p{L}\p{N} .-]/gu, '');
        if (term) query = query.or(`name.ilike.*${term}*,brand.ilike.*${term}*`);
      }
      if (low_stock === 'true') {
        const low = await c.var.db.from('low_stock_items').select('id').eq('tenant_id', tenantId);
        if (low.error) dbError(low.error);
        query = query.in('id', low.data.map((r) => r.id as string));
      }
      const { data, error } = await query.order('kind').order('name');
      if (error) dbError(error);
      return c.json(data as z.infer<typeof Item>[], 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/items',
      security: [{ bearer: [] }],
      request: { params: TenantParams, body: { content: { 'application/json': { schema: NewItem } } } },
      responses: {
        201: { description: 'Aangemaakt', content: { 'application/json': { schema: Item } } },
        ...errors,
        409: { description: 'Artikelcode bestaat al', content: { 'application/json': { schema: ErrorBody } } },
      },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('items')
        .insert({ ...c.req.valid('json'), tenant_id: tenantId })
        .select(ITEM_COLUMNS)
        .single();
      if (error) dbError(error);
      return c.json(data as z.infer<typeof Item>, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/tenants/{tenantId}/items/{itemId}',
      security: [{ bearer: [] }],
      request: {
        params: ItemParams,
        body: { content: { 'application/json': { schema: NewItem.partial().extend({ vat_rate: VatRate.optional(), track_stock: z.boolean().optional() }) } } },
      },
      responses: {
        200: { description: 'Bijgewerkt', content: { 'application/json': { schema: Item } } },
        ...errors,
        404: { description: 'Niet gevonden', content: { 'application/json': { schema: ErrorBody } } },
      },
    }),
    async (c) => {
      const { tenantId, itemId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('items')
        .update(c.req.valid('json'))
        .eq('tenant_id', tenantId)
        .eq('id', itemId)
        .select(ITEM_COLUMNS)
        .single();
      if (error) dbError(error);
      return c.json(data as z.infer<typeof Item>, 200);
    },
  );

  // Voorraad: mutaties zijn onveranderlijk; verbruik op opdrachten wordt automatisch geboekt.
  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/items/{itemId}/stock-movements',
      security: [{ bearer: [] }],
      request: { params: ItemParams },
      responses: {
        200: { description: 'Mutaties, nieuwste eerst', content: { 'application/json': { schema: z.array(StockMovement) } } },
        ...errors,
      },
    }),
    async (c) => {
      const { tenantId, itemId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('stock_movements')
        .select('id, item_id, quantity, reason, job_id, unit_cost, note, created_at')
        .eq('tenant_id', tenantId)
        .eq('item_id', itemId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (error) dbError(error);
      return c.json(data as z.infer<typeof StockMovement>[], 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/items/{itemId}/stock-movements',
      security: [{ bearer: [] }],
      request: { params: ItemParams, body: { content: { 'application/json': { schema: NewStockMovement } } } },
      responses: {
        201: { description: 'Geboekt', content: { 'application/json': { schema: StockMovement } } },
        ...errors,
        409: { description: 'Geen voorraad voor dit artikel', content: { 'application/json': { schema: ErrorBody } } },
      },
    }),
    async (c) => {
      const { tenantId, itemId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('stock_movements')
        .insert({ ...c.req.valid('json'), tenant_id: tenantId, item_id: itemId })
        .select('id, item_id, quantity, reason, job_id, unit_cost, note, created_at')
        .single();
      if (error) dbError(error);
      return c.json(data as z.infer<typeof StockMovement>, 201);
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

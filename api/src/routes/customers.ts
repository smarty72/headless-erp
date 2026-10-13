import { createRoute, z } from '@hono/zod-openapi';
import { dbError } from '../errors.js';
import { TenantParams, Uuid, errors } from '../schemas.js';
import { Address, body, json, notFound, pathId, searchTerm, type App } from './common.js';

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
const COLUMNS = 'id, tenant_id, kind, name, email, phone, vat_number, address, attributes';

const NewCustomer = z
  .object({
    kind: z.enum(['particulier', 'zakelijk']).optional(),
    name: z.string().trim().min(1, 'Naam is verplicht'),
    email: z.email('Ongeldig e-mailadres').optional(),
    phone: z.string().optional(),
    vat_number: z.string().optional(),
    address: Address.optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('NewCustomer');

const CustomerUpdate = NewCustomer.partial()
  .extend({
    email: z.email('Ongeldig e-mailadres').nullable().optional(),
    phone: z.string().nullable().optional(),
    vat_number: z.string().nullable().optional(),
    address: Address.nullable().optional(),
  })
  .openapi('CustomerUpdate');

const Summary = z.object({ id: Uuid, number: z.string().nullable(), status: z.string(), created_at: z.string() });
const CustomerDetail = Customer.extend({
  quotes: z.array(Summary.extend({ title: z.string().nullable() })),
  jobs: z.array(Summary.omit({ number: true }).extend({ title: z.string() })),
  invoices: z.array(Summary.extend({ total_incl: z.number().nullable() })),
}).openapi('CustomerDetail');

const Params = TenantParams.extend({ customerId: pathId('customerId') });
type CustomerT = z.infer<typeof Customer>;

export function registerCustomers(app: App) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/customers',
      security: [{ bearer: [] }],
      request: { params: TenantParams, query: z.object({ search: z.string().optional() }) },
      responses: { 200: json(z.array(Customer), 'Klanten, op naam'), ...errors },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const term = searchTerm(c.req.valid('query').search);
      let query = c.var.db.from('customers').select(COLUMNS).eq('tenant_id', tenantId).is('archived_at', null);
      if (term) query = query.or(`name.ilike.*${term}*,email.ilike.*${term}*,phone.ilike.*${term}*`);
      const { data, error } = await query.order('name');
      if (error) dbError(error);
      return c.json(data as CustomerT[], 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/customers',
      security: [{ bearer: [] }],
      request: { params: TenantParams, body: body(NewCustomer) },
      responses: { 201: json(Customer, 'Aangemaakt'), ...errors },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('customers')
        .insert({ ...c.req.valid('json'), tenant_id: tenantId })
        .select(COLUMNS)
        .single();
      if (error) dbError(error);
      return c.json(data as CustomerT, 201);
    },
  );

  // Klant met zijn offertes, opdrachten en facturen.
  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}/customers/{customerId}',
      security: [{ bearer: [] }],
      request: { params: Params },
      responses: { 200: json(CustomerDetail, 'Klant'), ...errors, ...notFound },
    }),
    async (c) => {
      const { tenantId, customerId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('customers')
        .select(
          `${COLUMNS}, quotes(id, number, title, status, created_at), jobs(id, title, status, created_at),
           invoices(id, number, status, total_incl, created_at)`,
        )
        .eq('tenant_id', tenantId)
        .eq('id', customerId)
        .order('created_at', { referencedTable: 'quotes', ascending: false })
        .order('created_at', { referencedTable: 'jobs', ascending: false })
        .order('created_at', { referencedTable: 'invoices', ascending: false })
        .single();
      if (error) dbError(error);
      return c.json(data as unknown as z.infer<typeof CustomerDetail>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/tenants/{tenantId}/customers/{customerId}',
      security: [{ bearer: [] }],
      request: { params: Params, body: body(CustomerUpdate) },
      responses: { 200: json(Customer, 'Bijgewerkt'), ...errors, ...notFound },
    }),
    async (c) => {
      const { tenantId, customerId } = c.req.valid('param');
      const { data, error } = await c.var.db
        .from('customers')
        .update(c.req.valid('json'))
        .eq('tenant_id', tenantId)
        .eq('id', customerId)
        .select(COLUMNS)
        .single();
      if (error) dbError(error);
      return c.json(data as CustomerT, 200);
    },
  );

  // Archiveren: offertes en facturen blijven naar de klant verwijzen.
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/tenants/{tenantId}/customers/{customerId}',
      security: [{ bearer: [] }],
      request: { params: Params },
      responses: { 204: { description: 'Gearchiveerd' }, ...errors, ...notFound },
    }),
    async (c) => {
      const { tenantId, customerId } = c.req.valid('param');
      const { error } = await c.var.db
        .from('customers')
        .update({ archived_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('id', customerId)
        .select('id')
        .single();
      if (error) dbError(error);
      return c.body(null, 204);
    },
  );
}

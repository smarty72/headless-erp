import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import type { AuthVariables } from '../auth.js';
import { dbError } from '../errors.js';
import { ErrorBody, TenantParams, Uuid, errors } from '../schemas.js';

const Industry = z
  .object({
    key: z.string(),
    label: z.string(),
    icon: z.string().openapi({ description: 'Lucide-icoonnaam' }),
    suggested_hourly_rate: z.number().openapi({ description: 'Indicatie, exclusief btw' }),
    default_labour_vat_rate: z.number(),
  })
  .openapi('Industry');

const Address = z
  .object({
    street: z.string().optional(),
    postal_code: z.string().optional(),
    city: z.string().optional(),
  })
  .openapi('Address');

const Onboarding = z
  .object({
    industry: z.string().min(1),
    name: z.string().trim().min(1, 'Bedrijfsnaam is verplicht'),
    contact_name: z.string().optional(),
    email: z.email('Ongeldig e-mailadres').optional(),
    phone: z.string().optional(),
    address: Address.optional(),
    hourly_rate: z.number().positive().optional(),
    labour_vat_rate: z.union([z.literal(0), z.literal(9), z.literal(21)]).optional(),
    call_out_fee: z.number().nonnegative().optional(),
    payment_days: z.number().int().min(0).max(120).default(14),
    kvk_number: z.string().optional(),
    vat_number: z.string().optional(),
    iban: z.string().optional(),
  })
  .openapi('Onboarding');

const TenantDetails = z
  .object({
    id: Uuid,
    name: z.string(),
    industry: z.string(),
    contact_name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: Address.nullable(),
    kvk_number: z.string().nullable(),
    vat_number: z.string().nullable(),
    iban: z.string().nullable(),
    settings: z.record(z.string(), z.unknown()),
    logo_url: z.string().nullable(),
  })
  .openapi('TenantDetails');

const TENANT_COLUMNS =
  'id, name, industry, contact_name, email, phone, address, kvk_number, vat_number, iban, settings, logo_path';

const LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

type App = OpenAPIHono<{ Variables: AuthVariables }>;
type TenantRow = Omit<z.infer<typeof TenantDetails>, 'logo_url'> & { logo_path: string | null };

export function registerOnboarding(app: App) {
  const withLogoUrl = (db: AuthVariables['db'], { logo_path, ...tenant }: TenantRow) => ({
    ...tenant,
    logo_url: logo_path ? db.storage.from('logos').getPublicUrl(logo_path).data.publicUrl : null,
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/industries',
      security: [{ bearer: [] }],
      responses: {
        200: { description: 'Branches', content: { 'application/json': { schema: z.array(Industry) } } },
        ...errors,
      },
    }),
    async (c) => {
      const { data, error } = await c.var.db
        .from('industries')
        .select('key, label, icon, suggested_hourly_rate, default_labour_vat_rate')
        .order('position');
      if (error) dbError(error);
      return c.json(data as z.infer<typeof Industry>[], 200);
    },
  );

  // Zet in één transactie het bedrijf, het lidmaatschap en de standaardartikelen neer.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/onboarding',
      security: [{ bearer: [] }],
      request: { body: { content: { 'application/json': { schema: Onboarding } } } },
      responses: {
        201: { description: 'Bedrijf aangemaakt', content: { 'application/json': { schema: TenantDetails } } },
        ...errors,
        422: { description: 'Onbekende branche', content: { 'application/json': { schema: ErrorBody } } },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const { data, error } = await c.var.db
        .rpc('onboard_tenant', {
          p_industry: body.industry,
          p_name: body.name,
          p_contact_name: body.contact_name ?? null,
          p_email: body.email ?? null,
          p_phone: body.phone ?? null,
          p_address: body.address ?? null,
          p_hourly_rate: body.hourly_rate ?? null,
          p_labour_vat_rate: body.labour_vat_rate ?? null,
          p_call_out_fee: body.call_out_fee ?? null,
          p_payment_days: body.payment_days,
          p_kvk_number: body.kvk_number ?? null,
          p_vat_number: body.vat_number ?? null,
          p_iban: body.iban ?? null,
        })
        .single<TenantRow>();
      if (error) dbError(error);
      return c.json(withLogoUrl(c.var.db, data), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{tenantId}',
      security: [{ bearer: [] }],
      request: { params: TenantParams },
      responses: {
        200: { description: 'Bedrijf', content: { 'application/json': { schema: TenantDetails } } },
        ...errors,
        404: { description: 'Niet gevonden', content: { 'application/json': { schema: ErrorBody } } },
      },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const { data, error } = await c.var.db.from('tenants').select(TENANT_COLUMNS).eq('id', tenantId).single<TenantRow>();
      if (error) dbError(error);
      return c.json(withLogoUrl(c.var.db, data), 200);
    },
  );

  // Logo als multipart-upload (veld "file"); alleen owner/admin, max 2 MB.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants/{tenantId}/logo',
      security: [{ bearer: [] }],
      request: {
        params: TenantParams,
        body: {
          content: {
            'multipart/form-data': { schema: z.object({ file: z.any().openapi({ type: 'string', format: 'binary' }) }) },
          },
        },
      },
      responses: {
        200: { description: 'Logo opgeslagen', content: { 'application/json': { schema: TenantDetails } } },
        ...errors,
        400: { description: 'Geen of ongeldig bestand', content: { 'application/json': { schema: ErrorBody } } },
      },
    }),
    async (c) => {
      const { tenantId } = c.req.valid('param');
      const form = await c.req.parseBody();
      const file = form.file;
      if (!(file instanceof File)) throw new HTTPException(400, { message: 'Stuur het logo mee in het veld "file"' });
      const ext = LOGO_TYPES[file.type];
      if (!ext) throw new HTTPException(400, { message: 'Logo moet PNG, JPG, WebP of SVG zijn' });
      if (file.size > MAX_LOGO_BYTES) throw new HTTPException(400, { message: 'Logo mag maximaal 2 MB zijn' });

      // Nieuwe bestandsnaam per upload, zodat caches nooit een oud logo tonen.
      const path = `${tenantId}/logo-${Date.now()}.${ext}`;
      const upload = await c.var.db.storage.from('logos').upload(path, file, { contentType: file.type });
      if (upload.error) {
        const status = 'statusCode' in upload.error && upload.error.statusCode === '403' ? 403 : 400;
        throw new HTTPException(status, { message: status === 403 ? 'Alleen de eigenaar of een beheerder kan het logo wijzigen' : upload.error.message });
      }

      const { data, error } = await c.var.db
        .from('tenants')
        .update({ logo_path: path })
        .eq('id', tenantId)
        .select(TENANT_COLUMNS)
        .single<TenantRow>();
      if (error) dbError(error);
      return c.json(withLogoUrl(c.var.db, data), 200);
    },
  );
}

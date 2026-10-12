// Integratietest tegen een lokale Supabase (`supabase start` in de repo-root).
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createApp } from '../src/app.js';
import { env } from '../src/env.js';

const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!secretKey) throw new Error('SUPABASE_SECRET_KEY ontbreekt (alleen nodig voor tests)');

const app = createApp();
const admin = createClient(env.supabaseUrl, secretKey, { auth: { persistSession: false } });
const run = Date.now().toString(36);

async function tokenFor(name: string): Promise<string> {
  const email = `${name}-${run}@test.local`;
  const password = `Test-${run}-wachtwoord`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(env.supabaseUrl, env.supabaseKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session.access_token;
}

function call(token: string | null, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

let anna: string;
let bram: string;
let tenantA: string;

beforeAll(async () => {
  [anna, bram] = await Promise.all([tokenFor('anna'), tokenFor('bram')]);
  const res = await call(anna, 'POST', '/tenants', { name: 'Schildersbedrijf Anna', industry: 'schilder' });
  expect(res.status).toBe(201);
  tenantA = ((await res.json()) as { id: string }).id;
  await call(bram, 'POST', '/tenants', { name: 'Timmerwerk Bram', industry: 'timmer' });
});

describe('HeadlessERP API', () => {
  it('weigert verzoeken zonder token', async () => {
    expect((await call(null, 'GET', '/me/tenants')).status).toBe(401);
  });

  it('toont alleen de eigen bedrijven', async () => {
    const tenants = (await (await call(anna, 'GET', '/me/tenants')).json()) as { name: string; role: string }[];
    expect(tenants).toEqual([expect.objectContaining({ name: 'Schildersbedrijf Anna', role: 'owner' })]);
  });

  it('maakt een klant aan en houdt die binnen het bedrijf', async () => {
    const created = await call(anna, 'POST', `/tenants/${tenantA}/customers`, {
      name: 'Fam. De Vries',
      attributes: { voorkeur_contact: 'whatsapp' },
    });
    expect(created.status).toBe(201);

    const own = (await (await call(anna, 'GET', `/tenants/${tenantA}/customers`)).json()) as unknown[];
    expect(own).toHaveLength(1);

    const foreign = await call(bram, 'GET', `/tenants/${tenantA}/customers`);
    expect(await foreign.json()).toEqual([]);

    const intrusion = await call(bram, 'POST', `/tenants/${tenantA}/customers`, { name: 'Indringer' });
    expect(intrusion.status).toBe(403);
  });

  it('valideert invoer', async () => {
    const res = await call(anna, 'POST', `/tenants/${tenantA}/customers`, { name: '', email: 'geen-email' });
    expect(res.status).toBe(400);
  });

  it('geeft de branchevelden van een schilder', async () => {
    const res = await call(anna, 'GET', `/tenants/${tenantA}/field-definitions?entity=quote_line`);
    const keys = ((await res.json()) as { key: string }[]).map((f) => f.key);
    expect(keys).toContain('oppervlakte_m2');
    expect(keys).not.toContain('houtsoort');
  });

  it('beheert artikelen en voorraad', async () => {
    const labour = await call(anna, 'POST', `/tenants/${tenantA}/items`, {
      kind: 'arbeid',
      name: 'Schilderwerk',
      unit: 'uur',
      sale_price: 60,
      vat_rate: 9,
    });
    expect(labour.status).toBe(201);
    const labourItem = (await labour.json()) as { id: string };
    expect(labourItem).toMatchObject({ sale_price: 60, vat_rate: 9, track_stock: false });

    const paint = await call(anna, 'POST', `/tenants/${tenantA}/items`, {
      kind: 'materiaal',
      name: 'Alpha Rezisto Easy Clean 2,5 l',
      brand: 'Sikkens',
      sku: 'SIK-AR-25',
      unit: 'stuk',
      sale_price: 18.95,
      track_stock: true,
      min_stock: 5,
    });
    expect(paint.status).toBe(201);
    const paintId = ((await paint.json()) as { id: string }).id;

    const duplicate = await call(anna, 'POST', `/tenants/${tenantA}/items`, {
      kind: 'materiaal', name: 'Kopie', sku: 'SIK-AR-25', unit: 'stuk', sale_price: 1,
    });
    expect(duplicate.status).toBe(409);

    const bought = await call(anna, 'POST', `/tenants/${tenantA}/items/${paintId}/stock-movements`, {
      quantity: 3, reason: 'inkoop', unit_cost: 12.4,
    });
    expect(bought.status).toBe(201);

    const low = (await (await call(anna, 'GET', `/tenants/${tenantA}/items?low_stock=true`)).json()) as {
      name: string; stock_quantity: number;
    }[];
    expect(low).toEqual([expect.objectContaining({ name: 'Alpha Rezisto Easy Clean 2,5 l', stock_quantity: 3 })]);

    const found = (await (await call(anna, 'GET', `/tenants/${tenantA}/items?search=sikkens`)).json()) as unknown[];
    expect(found).toHaveLength(1);

    const direct = await call(anna, 'PATCH', `/tenants/${tenantA}/items/${paintId}`, { sale_price: 19.95 });
    expect(await direct.json()).toMatchObject({ sale_price: 19.95, stock_quantity: 3 });

    const noStock = await call(anna, 'POST', `/tenants/${tenantA}/items/${labourItem.id}/stock-movements`, {
      quantity: 1, reason: 'inkoop',
    });
    expect(noStock.status).toBe(409);

    const foreign = await call(bram, 'GET', `/tenants/${tenantA}/items`);
    expect(await foreign.json()).toEqual([]);
  });

  it('doorloopt de onboarding met logo', async () => {
    const carla = await tokenFor('carla');
    const industries = (await (await call(carla, 'GET', '/industries')).json()) as { key: string }[];
    expect(industries.map((i) => i.key)).toEqual(expect.arrayContaining(['schilder', 'stukadoor', 'timmer']));

    const invalid = await call(carla, 'POST', '/onboarding', { industry: 'stukadoor', name: ' ' });
    expect(invalid.status).toBe(400);

    const res = await call(carla, 'POST', '/onboarding', {
      industry: 'stukadoor',
      name: 'Stukadoorsbedrijf Carla',
      contact_name: 'Carla Jansen',
      email: 'carla@stuc.test',
      phone: '0612345678',
      address: { street: 'Kerkstraat 5', postal_code: '3511 AB', city: 'Utrecht' },
      hourly_rate: 58,
      call_out_fee: 30,
    });
    expect(res.status).toBe(201);
    const tenant = (await res.json()) as { id: string; settings: { payment_days: number }; logo_url: string | null };
    expect(tenant).toMatchObject({ settings: { payment_days: 14 }, logo_url: null });

    const items = (await (await call(carla, 'GET', `/tenants/${tenant.id}/items`)).json()) as { name: string }[];
    expect(items.map((i) => i.name).sort()).toEqual(['Uurtarief stukadoor', 'Voorrijkosten']);

    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));
    const form = new FormData();
    form.append('file', new File([png], 'logo.png', { type: 'image/png' }));
    const upload = await app.request(`/tenants/${tenant.id}/logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${carla}` },
      body: form,
    });
    expect(upload.status).toBe(200);
    const withLogo = (await upload.json()) as { logo_url: string };
    expect(withLogo.logo_url).toMatch(new RegExp(`/logos/${tenant.id}/logo-\\d+\\.png$`));

    const foreignForm = new FormData();
    foreignForm.append('file', new File([png], 'logo.png', { type: 'image/png' }));
    const foreign = await app.request(`/tenants/${tenant.id}/logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bram}` },
      body: foreignForm,
    });
    expect(foreign.status).toBe(403);
  });

  it('staat de webapp toe via CORS', async () => {
    const res = await app.request('/health', { headers: { Origin: 'http://localhost:5173' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('maakt een factuur definitief met doorlopend nummer', async () => {
    const db = createClient(env.supabaseUrl, env.supabaseKey, {
      global: { headers: { Authorization: `Bearer ${anna}` } },
      auth: { persistSession: false },
    });
    const customer = await db.from('customers').select('id').eq('tenant_id', tenantA).single();
    const invoice = await db
      .from('invoices')
      .insert({ tenant_id: tenantA, customer_id: customer.data!.id })
      .select('id')
      .single();
    await db.from('invoice_lines').insert({
      tenant_id: tenantA,
      invoice_id: invoice.data!.id,
      description: 'Schilderwerk',
      quantity: 2,
      unit: 'uur',
      unit_price: 50,
      vat_rate: 21,
    });

    const path = `/tenants/${tenantA}/invoices/${invoice.data!.id}/finalize`;
    const res = await call(anna, 'POST', path);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      number: `${new Date().getFullYear()}-0001`,
      status: 'definitief',
      total_incl: 121,
    });
    expect((await call(anna, 'POST', path)).status).toBe(409);
    expect((await call(bram, 'POST', path)).status).toBe(403);
  });
});

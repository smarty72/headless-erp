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

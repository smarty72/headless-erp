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

  it('doorloopt offerte, opdracht, uren, factuur en betaling', async () => {
    const dirk = await tokenFor('dirk');
    const onboard = await call(dirk, 'POST', '/onboarding', { industry: 'schilder', name: 'Schilder Dirk', hourly_rate: 60, payment_days: 30 });
    const t = ((await onboard.json()) as { id: string }).id;
    const base = `/tenants/${t}`;

    const customer = (await (await call(dirk, 'POST', `${base}/customers`, {
      name: 'Fam. Bakker', address: { street: 'Laan 1', city: 'Zeist' },
    })).json()) as { id: string };
    const paint = (await (await call(dirk, 'POST', `${base}/items`, {
      kind: 'materiaal', name: 'Rubbol BL Azura', brand: 'Sikkens', unit: 'stuk', sale_price: 18.95, track_stock: true,
    })).json()) as { id: string };
    await call(dirk, 'POST', `${base}/items/${paint.id}/stock-movements`, { quantity: 10, reason: 'inkoop' });

    // Offerte: 3 x 18,95 = 56,85 (21%) en 16 uur x 60 = 960 (9%).
    const created = await call(dirk, 'POST', `${base}/quotes`, {
      customer_id: customer.id,
      title: 'Kozijnen buiten',
      lines: [
        { description: 'Schilderwerk kozijnen', quantity: 16, unit: 'uur', unit_price: 60, vat_rate: 9 },
        { item_id: paint.id, description: 'Sikkens Rubbol', quantity: 3, unit: 'stuk', unit_price: 18.95, vat_rate: 21 },
      ],
    });
    expect(created.status).toBe(201);
    const quote = (await created.json()) as { id: string; total_excl: number; total_vat: number; total_incl: number };
    expect(quote).toMatchObject({ total_excl: 1016.85, total_vat: 98.34, total_incl: 1115.19 });

    const sent = (await (await call(dirk, 'POST', `${base}/quotes/${quote.id}/send`, {})).json()) as { number: string; status: string };
    expect(sent).toMatchObject({ number: `O${new Date().getFullYear()}-0001`, status: 'verzonden' });
    expect((await call(dirk, 'PATCH', `${base}/quotes/${quote.id}`, { title: 'Anders' })).status).toBe(409);

    const accepted = await call(dirk, 'POST', `${base}/quotes/${quote.id}/accept`, {});
    expect(accepted.status).toBe(201);
    const { job_id } = (await accepted.json()) as { job_id: string };

    // Aan het werk: timer starten en stoppen.
    const started = await call(dirk, 'POST', `${base}/timer/start`, { job_id, note: 'Voorkant huis' });
    expect(started.status).toBe(201);
    expect(await started.json()).toMatchObject({ note: 'Voorkant huis', job: { id: job_id, title: 'Kozijnen buiten', customer: { name: 'Fam. Bakker' } } });
    const stopped = (await (await call(dirk, 'POST', `${base}/timer/stop`)).json()) as { hours: number };
    expect(stopped.hours).toBe(0.25);
    expect(await (await call(dirk, 'GET', `${base}/timer`)).json()).toEqual({ timer: null });

    // Meerwerk factureerbaar, materiaal uit voorraad.
    await call(dirk, 'POST', `${base}/jobs/${job_id}/time-entries`, { hours: 2, billable: true, note: 'Meerwerk' });
    const withMaterial = await call(dirk, 'POST', `${base}/jobs/${job_id}/materials`, { item_id: paint.id, quantity: 1, billable: true });
    expect(withMaterial.status).toBe(201);
    const job = (await withMaterial.json()) as { status: string; total_hours: number; uninvoiced_billable_hours: number; materials: { description: string }[] };
    expect(job).toMatchObject({ status: 'bezig', total_hours: 2.25, uninvoiced_billable_hours: 2 });
    expect(job.materials[0].description).toBe('Sikkens Rubbol BL Azura');
    const stock = (await (await call(dirk, 'GET', `${base}/items/${paint.id}`)).json()) as { stock_quantity: number };
    expect(stock.stock_quantity).toBe(9);

    const inv = await call(dirk, 'POST', `${base}/jobs/${job_id}/invoice`);
    expect(inv.status).toBe(201);
    const { invoice_id } = (await inv.json()) as { invoice_id: string };
    const draft = (await (await call(dirk, 'GET', `${base}/invoices/${invoice_id}`)).json()) as {
      lines: { id: string; description: string; quantity: number; unit: string; unit_price: number; vat_rate: number }[];
    };
    expect(draft.lines.map((l) => l.description)).toEqual(['Schilderwerk kozijnen', 'Sikkens Rubbol', 'Uurtarief schilder – Meerwerk', 'Sikkens Rubbol BL Azura']);

    // Zoeken op klantnaam vindt de klant én de opdracht en offerte; zoeken op project ook.
    const byCustomer = (await (await call(dirk, 'GET', `${base}/search?q=bakk`)).json()) as {
      customers: { name: string; city: string | null }[]; jobs: { id: string }[]; quotes: { id: string }[];
    };
    expect(byCustomer.customers).toEqual([expect.objectContaining({ name: 'Fam. Bakker', city: 'Zeist' })]);
    expect(byCustomer.jobs.map((j) => j.id)).toEqual([job_id]);
    expect(byCustomer.quotes.map((q) => q.id)).toEqual([quote.id]);
    const byProject = (await (await call(dirk, 'GET', `${base}/search?q=kozijn`)).json()) as { customers: unknown[]; jobs: unknown[] };
    expect([byProject.customers.length, byProject.jobs.length]).toEqual([0, 1]);
    expect(await (await call(bram, 'GET', `${base}/search?q=bakk`)).json()).toEqual({ customers: [], jobs: [], quotes: [] });

    // Opdracht kopiëren als offerte: dezelfde klant en de offerteregels, als concept.
    const copied = await call(dirk, 'POST', `${base}/jobs/${job_id}/copy-to-quote`, {});
    expect(copied.status).toBe(201);
    const copy = (await (await call(dirk, 'GET', `${base}/quotes/${((await copied.json()) as { quote_id: string }).quote_id}`)).json()) as {
      status: string; number: string | null; title: string; customer: { id: string }; lines: { description: string }[];
    };
    expect(copy).toMatchObject({ status: 'concept', number: null, title: 'Kozijnen buiten', customer: { id: customer.id } });
    expect(copy.lines.map((l) => l.description)).toEqual(['Schilderwerk kozijnen', 'Sikkens Rubbol']);

    // Laatste regel weghalen en een eigen regel toevoegen.
    const edited = await call(dirk, 'PATCH', `${base}/invoices/${invoice_id}`, {
      lines: [...draft.lines.slice(0, 3), { description: 'Voorrijkosten', quantity: 1, unit: 'keer', unit_price: 25, vat_rate: 21 }],
    });
    expect(edited.status).toBe(200);

    const final = await call(dirk, 'POST', `${base}/invoices/${invoice_id}/finalize`);
    expect(final.status).toBe(200);
    const finalized = (await final.json()) as { number: string; status: string; issued_on: string; due_on: string; total_incl: number; open_amount: number };
    expect(finalized.status).toBe('definitief');
    expect((Date.parse(finalized.due_on) - Date.parse(finalized.issued_on)) / 86_400_000).toBe(30);
    expect(finalized.open_amount).toBe(finalized.total_incl);
    expect(((await (await call(dirk, 'GET', `${base}/jobs/${job_id}`)).json()) as { status: string }).status).toBe('gefactureerd');

    const overview = (await (await call(dirk, 'GET', `${base}/overview`)).json()) as { unpaid_invoices: number; unpaid_amount: number; open_jobs: number };
    expect(overview).toMatchObject({ unpaid_invoices: 1, unpaid_amount: finalized.total_incl, open_jobs: 0 });

    const paid = (await (await call(dirk, 'POST', `${base}/invoices/${invoice_id}/payments`, { amount: finalized.total_incl })).json()) as { status: string; open_amount: number };
    expect(paid).toMatchObject({ status: 'betaald', open_amount: 0 });

    const detail = (await (await call(dirk, 'GET', `${base}/customers/${customer.id}`)).json()) as { quotes: unknown[]; jobs: unknown[]; invoices: unknown[] };
    expect([detail.quotes.length, detail.jobs.length, detail.invoices.length]).toEqual([2, 1, 1]); // 2 offertes: origineel en kopie

    // Een ander bedrijf ziet hier niets van.
    expect(await (await call(bram, 'GET', `${base}/quotes`)).json()).toEqual([]);
    expect((await call(bram, 'GET', `${base}/jobs/${job_id}`)).status).toBe(404);
  });

  it('kopieert een regie-opdracht als offerte met uren per omschrijving en materiaal', async () => {
    const eva = await tokenFor('eva');
    const onboard = await call(eva, 'POST', '/onboarding', { industry: 'schilder', name: 'Schilder Eva', hourly_rate: 50, payment_days: 14 });
    const base = `/tenants/${((await onboard.json()) as { id: string }).id}`;
    const customer = (await (await call(eva, 'POST', `${base}/customers`, { name: 'Dhr. Jansen' })).json()) as { id: string };
    const other = (await (await call(eva, 'POST', `${base}/customers`, { name: 'Mevr. Smit' })).json()) as { id: string };
    const job = (await (await call(eva, 'POST', `${base}/jobs`, { customer_id: customer.id, title: 'Schuur verven' })).json()) as { id: string };
    for (const [hours, note] of [[2, 'Schuren'], [1, ' Schuren '], [1, undefined]] as const)
      await call(eva, 'POST', `${base}/jobs/${job.id}/time-entries`, { hours, note });
    await call(eva, 'POST', `${base}/jobs/${job.id}/materials`, { description: 'Kwast', quantity: 2, unit: 'stuk', unit_price: 7.5 });

    const res = await call(eva, 'POST', `${base}/jobs/${job.id}/copy-to-quote`, { customer_id: other.id });
    expect(res.status).toBe(201);
    const quote = (await (await call(eva, 'GET', `${base}/quotes/${((await res.json()) as { quote_id: string }).quote_id}`)).json()) as {
      customer: { id: string }; lines: { description: string; quantity: number; unit_price: number; vat_rate: number }[];
    };
    expect(quote.customer.id).toBe(other.id);
    expect(quote.lines.slice(0, 2).sort((a, b) => a.description.localeCompare(b.description))).toEqual([
      expect.objectContaining({ description: 'Uurtarief schilder', quantity: 1, unit_price: 50, vat_rate: 9 }),
      expect.objectContaining({ description: 'Uurtarief schilder – Schuren', quantity: 3, unit_price: 50, vat_rate: 9 }),
    ]);
    expect(quote.lines[2]).toMatchObject({ description: 'Kwast', quantity: 2, unit_price: 7.5, vat_rate: 21 });

    // Op de factuur komen dezelfde omschrijvingen terug.
    const inv = (await (await call(eva, 'POST', `${base}/jobs/${job.id}/invoice`)).json()) as { invoice_id: string };
    const invoice = (await (await call(eva, 'GET', `${base}/invoices/${inv.invoice_id}`)).json()) as { lines: { description: string; quantity: number }[] };
    expect(invoice.lines.map((l) => [l.description, l.quantity])).toEqual([
      ['Uurtarief schilder', 1],
      ['Uurtarief schilder – Schuren', 3],
      ['Kwast', 2],
    ]);
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

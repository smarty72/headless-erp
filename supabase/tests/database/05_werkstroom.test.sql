-- Werkstroom: offerte -> opdracht -> uren en materiaal -> factuur -> betaling.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@schilder.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bram@timmer.test');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

insert into ids select 't', (public.onboard_tenant(p_industry => 'schilder', p_name => 'Anna', p_hourly_rate => 60)).id;
insert into public.customers (tenant_id, name, address)
  select v, 'Fam. Jansen', '{"street": "Kerkstraat 3", "city": "Utrecht"}' from ids where k = 't';
insert into ids select 'c', id from public.customers;
insert into public.items (tenant_id, kind, name, unit, sale_price, vat_rate, track_stock)
  select v, 'materiaal', 'Sikkens Rubbol', 'stuk', 18.95, 21, true from ids where k = 't';
insert into ids select 'verf', id from public.items where name = 'Sikkens Rubbol';
insert into public.stock_movements (tenant_id, item_id, quantity, reason)
  select (select v from ids where k = 't'), v, 10, 'inkoop' from ids where k = 'verf';

-- Offerte met twee regels.
insert into public.quotes (tenant_id, customer_id, title)
  select (select v from ids where k = 't'), v, 'Kozijnen buiten' from ids where k = 'c';
insert into ids select 'q', id from public.quotes;
insert into public.quote_lines (tenant_id, quote_id, description, quantity, unit, unit_price, vat_rate, position)
  select (select v from ids where k = 't'), v, d, qty, u, p, r, pos
    from ids, (values ('Schilderwerk kozijnen', 16, 'uur', 60, 9, 1), ('Verf', 3, 'stuk', 18.95, 21, 2)) x(d, qty, u, p, r, pos)
   where k = 'q';

select throws_ok($$select public.send_quote((select v from ids where k = 't'), gen_random_uuid())$$,
  'P0002', null, 'Onbekende offerte versturen geeft niet gevonden');

select is((public.send_quote((select v from ids where k = 't'), (select v from ids where k = 'q'))).number,
  'O' || extract(year from current_date) || '-0001', 'Versturen kent een offertenummer toe');
select is((select valid_until from public.quotes), current_date + 30, 'Standaard 30 dagen geldig');

select throws_ok($$update public.quote_lines set unit_price = 1$$,
  '23514', null, 'Regels van een verstuurde offerte liggen vast');

insert into ids select 'j', (public.accept_quote((select v from ids where k = 't'), (select v from ids where k = 'q'))).id;
select results_eq($$select status from public.quotes$$, array['geaccepteerd'], 'Offerte is geaccepteerd');
select results_eq($$select title, site_address->>'street', quote_id = (select v from ids where k = 'q') from public.jobs$$,
  $$values ('Kozijnen buiten', 'Kerkstraat 3', true)$$, 'Opdracht krijgt titel, werkadres en offerte mee');
select throws_ok($$select public.accept_quote((select v from ids where k = 't'), (select v from ids where k = 'q'))$$,
  '23514', null, 'Twee keer accepteren kan niet');

-- Timer.
select lives_ok($$select public.start_timer((select v from ids where k = 't'), (select v from ids where k = 'j'))$$,
  'Timer start');
select results_eq($$select status from public.jobs$$, array['bezig'], 'Opdracht staat op bezig');
select is((select billable from public.time_entries), false, 'Uren op een offerte-opdracht zijn standaard nacalculatie');
select throws_ok($$insert into public.time_entries (tenant_id, job_id, started_at)
                   select (select v from ids where k = 't'), v, now() from ids where k = 'j'$$,
  '23505', null, 'Maar één lopende timer per persoon');
update public.time_entries set started_at = now() - interval '2 hours 50 minutes';
select is((public.stop_timer((select v from ids where k = 't'))).hours, 2.75::numeric(5,2), 'Stoppen rondt af op een kwartier');
select throws_ok($$select public.stop_timer((select v from ids where k = 't'))$$, 'P0002', null, 'Geen lopende timer');

-- Meerwerk: factureerbare uren en materiaal.
insert into public.time_entries (tenant_id, job_id, hours, note)
  select (select v from ids where k = 't'), v, 1.5, 'Meerwerk dakkapel' from ids where k = 'j';
insert into public.material_usages (tenant_id, job_id, item_id, description, quantity, unit)
  select (select v from ids where k = 't'), (select v from ids where k = 'j'), v, 'Sikkens Rubbol', 2, 'stuk'
    from ids where k = 'verf';
select is((select stock_quantity from public.items where name = 'Sikkens Rubbol'), 8.000::numeric(12,3),
  'Materiaalverbruik boekt voorraad af');

-- Factuur uit de opdracht.
insert into ids select 'f', (public.create_invoice_from_job((select v from ids where k = 't'), (select v from ids where k = 'j'))).id;
select results_eq(
  $$select description, quantity, unit_price, vat_rate from public.invoice_lines order by position$$,
  $$values ('Schilderwerk kozijnen', 16.000::numeric(12,3), 60.00::numeric(12,2), 9.00::numeric(4,2)),
           ('Verf', 3.000, 18.95, 21.00),
           ('Uurtarief schilder – Meerwerk dakkapel', 1.500, 60.00, 9.00),
           ('Sikkens Rubbol', 2.000, 18.95, 21.00)$$,
  'Factuur = offerteregels + factureerbare uren (met omschrijving) + materiaal');
select is((select count(*)::int from public.time_entries where billable and invoice_line_id is null), 0,
  'Gefactureerde uren zijn gekoppeld');
select is((public.create_invoice_from_job((select v from ids where k = 't'), (select v from ids where k = 'j'))).id,
  (select v from ids where k = 'f'), 'Nog een keer geeft hetzelfde concept terug');

-- Concept verwijderen maakt uren weer vrij.
delete from public.invoices;
select is((select count(*)::int from public.time_entries where billable and invoice_line_id is null), 1,
  'Concept verwijderen maakt de uren weer vrij');

-- Definitief maken en betalen.
delete from ids where k = 'f';
insert into ids select 'f', (public.create_invoice_from_job((select v from ids where k = 't'), (select v from ids where k = 'j'))).id;
select public.finalize_invoice((select v from ids where k = 't'), (select v from ids where k = 'f'));
select is((public.register_payment((select v from ids where k = 't'), (select v from ids where k = 'f'), 100)).status,
  'definitief', 'Deelbetaling laat de factuur openstaan');
select is((public.register_payment((select v from ids where k = 't'), (select v from ids where k = 'f'),
  (select total_incl - 100 from public.invoices))).status, 'betaald', 'Restbedrag betaalt de factuur');

-- Een ander bedrijf kan niets met deze offerte of opdracht.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select throws_ok($$select public.start_timer((select v from ids where k = 't'), (select v from ids where k = 'j'))$$,
  'P0002', null, 'Timer op een opdracht van een ander bedrijf: niet gevonden');
select throws_ok($$select public.send_quote((select v from ids where k = 't'), (select v from ids where k = 'q'))$$,
  '42501', null, 'Offerte van een ander bedrijf versturen: geen rechten');

select * from finish();
rollback;

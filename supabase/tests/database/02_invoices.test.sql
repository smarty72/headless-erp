-- Facturen: doorlopende nummering, juiste totalen en onveranderlijk na definitief maken.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'anna@schilder.test');
insert into public.tenants (id, name, industry) values
  ('10000000-0000-0000-0000-00000000000a', 'Schildersbedrijf Anna', 'schilder');
insert into public.memberships (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'owner');
insert into public.customers (id, tenant_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Fam. De Vries');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

insert into public.invoices (id, tenant_id, customer_id) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a');
insert into public.invoice_lines (tenant_id, invoice_id, description, quantity, unit, unit_price, vat_rate) values
  ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', 'Schilderwerk woonkamer', 8, 'uur', 52.50, 21),
  ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', 'Muurverf', 10, 'liter', 12.95, 21),
  ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', 'Arbeid woning > 2 jaar', 4, 'uur', 50.00, 9),
  ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000002', 'Klein herstel', 1, 'stuk', 75.00, 21);

select public.finalize_invoice('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001');
select public.finalize_invoice('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000002');

select results_eq(
  $$select number from public.invoices order by number$$,
  array[extract(year from current_date)::int || '-0001', extract(year from current_date)::int || '-0002'],
  'Factuurnummers zijn doorlopend');

-- 8 x 52,50 + 10 x 12,95 = 549,50 tegen 21% (115,40); 200,00 tegen 9% (18,00).
select results_eq(
  $$select total_excl, total_vat, total_incl from public.invoices
     where id = '30000000-0000-0000-0000-000000000001'$$,
  $$values (749.50::numeric(12,2), 133.40::numeric(12,2), 882.90::numeric(12,2))$$,
  'Totalen en btw per tarief kloppen');

select is(
  (select customer_snapshot->>'name' from public.invoices where id = '30000000-0000-0000-0000-000000000001'),
  'Fam. De Vries', 'Klantgegevens zijn vastgelegd op de factuur');

select throws_ok(
  $$update public.invoices set total_incl = 1 where id = '30000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'Bedragen van een definitieve factuur zijn niet te wijzigen');

select throws_ok(
  $$update public.invoice_lines set unit_price = 1 where invoice_id = '30000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'Regels van een definitieve factuur zijn niet te wijzigen');

select throws_ok(
  $$delete from public.invoices where id = '30000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'Een definitieve factuur is niet te verwijderen');

select lives_ok(
  $$update public.invoices set status = 'betaald' where id = '30000000-0000-0000-0000-000000000001'$$,
  'De status mag na definitief nog naar betaald');

select throws_ok(
  $$select public.finalize_invoice('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000002')$$,
  '23514', null, 'Een factuur wordt niet twee keer definitief gemaakt');

select is(
  (select count(*)::int from public.events where type = 'invoice.issued'), 2,
  'Elke definitieve factuur schrijft een event');

select * from finish();
rollback;

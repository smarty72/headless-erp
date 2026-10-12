-- Producten en voorraad: saldo via mutaties, automatisch afboeken bij materiaalverbruik.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@schilder.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bram@timmer.test');
insert into public.tenants (id, name, industry) values
  ('10000000-0000-0000-0000-00000000000a', 'Schildersbedrijf Anna', 'schilder'),
  ('10000000-0000-0000-0000-00000000000b', 'Timmerwerk Bram', 'timmer');
insert into public.memberships (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'owner'),
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'owner');
insert into public.customers (id, tenant_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Fam. De Vries');
insert into public.jobs (id, tenant_id, customer_id, title) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
   '20000000-0000-0000-0000-00000000000a', 'Woonkamer schilderen');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

insert into public.items (id, tenant_id, kind, name, unit, sale_price, vat_rate) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a',
   'arbeid', 'Schilderwerk', 'uur', 60.00, 9);
insert into public.items (id, tenant_id, kind, name, brand, sku, unit, purchase_price, sale_price, vat_rate,
                          track_stock, min_stock, stock_quantity) values
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a',
   'materiaal', 'Alpha Rezisto Easy Clean 2,5 l', 'Sikkens', 'SIK-AR-25', 'stuk', 12.40, 18.95, 21,
   true, 3, 999);

select is((select stock_quantity from public.items where id = '50000000-0000-0000-0000-000000000002'),
  0::numeric, 'Een nieuw artikel begint op voorraad 0, ook als je een saldo meestuurt');

select throws_ok(
  $$insert into public.items (tenant_id, kind, name, unit, sale_price, track_stock)
    values ('10000000-0000-0000-0000-00000000000a', 'arbeid', 'Uurloon', 'uur', 60, true)$$,
  '23514', null, 'Voor arbeid wordt geen voorraad bijgehouden');

insert into public.stock_movements (tenant_id, item_id, quantity, reason, unit_cost) values
  ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000002', 10, 'inkoop', 12.40);
select is((select stock_quantity from public.items where id = '50000000-0000-0000-0000-000000000002'),
  10::numeric, 'Inkoop verhoogt de voorraad');

select throws_ok(
  $$update public.items set stock_quantity = 50 where id = '50000000-0000-0000-0000-000000000002'$$,
  '23514', null, 'Voorraad is niet rechtstreeks aan te passen');

select lives_ok(
  $$update public.items set sale_price = 19.95 where id = '50000000-0000-0000-0000-000000000002'$$,
  'Andere velden van het artikel zijn gewoon aan te passen');

select throws_ok(
  $$insert into public.stock_movements (tenant_id, item_id, quantity, reason) values
    ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 1, 'inkoop')$$,
  '23514', null, 'Geen voorraadmutatie op een artikel zonder voorraad');

-- Verbruik op een opdracht boekt automatisch af.
insert into public.material_usages (id, tenant_id, job_id, item_id, description, quantity, unit, unit_price) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a',
   '40000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000002',
   'Sikkens Alpha Rezisto', 4, 'stuk', 19.95);
select is((select stock_quantity from public.items where id = '50000000-0000-0000-0000-000000000002'),
  6::numeric, 'Materiaalverbruik boekt 4 potten af');

update public.material_usages set quantity = 8 where id = '60000000-0000-0000-0000-000000000001';
select is((select stock_quantity from public.items where id = '50000000-0000-0000-0000-000000000002'),
  2::numeric, 'Aangepast verbruik corrigeert de voorraad');

select results_eq('select name from public.low_stock_items', array['Alpha Rezisto Easy Clean 2,5 l'],
  'Artikel onder de minimumvoorraad verschijnt in de signalering');

delete from public.material_usages where id = '60000000-0000-0000-0000-000000000001';
select is((select stock_quantity from public.items where id = '50000000-0000-0000-0000-000000000002'),
  10::numeric, 'Verwijderd verbruik komt terug op voorraad');

select throws_ok(
  $$delete from public.stock_movements$$,
  '42501', null, 'Voorraadmutaties zijn niet te verwijderen');

-- Bram ziet niets van Anna's voorraad.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is_empty('select 1 from public.stock_movements union all select 1 from public.low_stock_items',
  'Een ander bedrijf ziet geen voorraad of mutaties');

select * from finish();
rollback;

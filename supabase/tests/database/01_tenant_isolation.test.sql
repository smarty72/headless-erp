-- Bewijst dat bedrijf A niets van bedrijf B kan lezen of wijzigen.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Twee gebruikers, twee bedrijven, plus een boekhouder bij A.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@schilder.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bram@timmer.test'),
  ('00000000-0000-0000-0000-00000000000c', 'boekhouder@test');
insert into public.tenants (id, name, industry) values
  ('10000000-0000-0000-0000-00000000000a', 'Schildersbedrijf Anna', 'schilder'),
  ('10000000-0000-0000-0000-00000000000b', 'Timmerwerk Bram', 'timmer');
insert into public.memberships (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'owner'),
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'owner'),
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'boekhouder');
insert into public.customers (id, tenant_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Fam. De Vries'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Jansen BV');

-- Als Anna
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

select results_eq('select name from public.customers', array['Fam. De Vries'],
  'Anna ziet alleen haar eigen klanten');
select results_eq('select name from public.tenants', array['Schildersbedrijf Anna'],
  'Anna ziet alleen haar eigen bedrijf');

select throws_ok(
  $$insert into public.customers (tenant_id, name) values ('10000000-0000-0000-0000-00000000000b', 'Indringer')$$,
  '42501', null, 'Anna kan geen klant in het bedrijf van Bram aanmaken');

select is_empty(
  $$update public.customers set name = 'Gehackt' where id = '20000000-0000-0000-0000-00000000000b' returning id$$,
  'Anna kan een klant van Bram niet wijzigen');

select is_empty(
  $$delete from public.customers where id = '20000000-0000-0000-0000-00000000000b' returning id$$,
  'Anna kan een klant van Bram niet verwijderen');

-- Een offerte in A die naar een klant van B wijst, faalt op de samengestelde foreign key.
select throws_ok(
  $$insert into public.quotes (tenant_id, customer_id) values
      ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000b')$$,
  '23503', null, 'Een offerte kan niet naar een klant van een ander bedrijf wijzen');

select lives_ok(
  $$insert into public.quotes (tenant_id, customer_id) values
      ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a')$$,
  'Anna kan een offerte voor haar eigen klant maken');

select ok(
  (select count(*) from public.field_definitions where industry = 'schilder') > 0,
  'Branche-templates zijn zichtbaar');

select is_empty('select 1 from public.user_identities',
  'Kanaal-identiteiten zijn niet leesbaar voor gebruikers');

-- Als boekhouder van A: lezen mag, schrijven niet.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';

select results_eq('select name from public.customers', array['Fam. De Vries'],
  'De boekhouder leest de klanten van A');
select throws_ok(
  $$insert into public.customers (tenant_id, name) values ('10000000-0000-0000-0000-00000000000a', 'Nieuw')$$,
  '42501', null, 'De boekhouder kan geen klanten aanmaken');

-- Als anonieme bezoeker
reset role;
set local role anon;
select throws_ok('select * from public.customers', '42501', null,
  'Anonieme bezoekers hebben geen toegang tot klanten');

-- Onboarding via create_tenant maakt de aanroeper owner.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select lives_ok($$select public.create_tenant('Tweede zaak Bram', 'tuin')$$,
  'Bram kan een nieuw bedrijf aanmaken');
select results_eq(
  $$select role from public.memberships m join public.tenants t on t.id = m.tenant_id
     where t.name = 'Tweede zaak Bram'$$,
  array['owner'], 'Bram is owner van zijn nieuwe bedrijf');

select * from finish();
rollback;

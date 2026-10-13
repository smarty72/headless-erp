-- Onboarding: één aanroep zet bedrijf, lidmaatschap en standaardartikelen neer.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'anna@schilder.test');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

select ok((select count(*) from public.industries) >= 10, 'Branches zijn leesbaar voor ingelogde gebruikers');

select lives_ok($$
  select public.onboard_tenant(
    p_industry => 'schilder', p_name => '  Schildersbedrijf Anna  ', p_contact_name => 'Anna de Vries',
    p_email => 'info@anna.test', p_phone => '0612345678',
    p_address => '{"street": "Dorpsstraat 1", "postal_code": "1234 AB", "city": "Utrecht"}',
    p_hourly_rate => 60, p_call_out_fee => 25, p_payment_days => 30, p_iban => 'NL91ABNA0417164300')
$$, 'Onboarding slaagt');

select results_eq(
  $$select name, industry, settings->>'payment_days' from public.tenants$$,
  $$values ('Schildersbedrijf Anna', 'schilder', '30')$$,
  'Bedrijf staat er met opgeschoonde naam en betaaltermijn');

select results_eq($$select role from public.memberships$$, array['owner'], 'De aanroeper is owner');

select results_eq(
  $$select name, unit, sale_price, vat_rate from public.items where kind = 'arbeid'$$,
  $$values ('Uurtarief schilder', 'uur', 60.00::numeric(12,2), 9.00::numeric(4,2))$$,
  'Uurtarief-artikel met eigen tarief en 9% btw voor schilders');

select results_eq(
  $$select name, sale_price from public.items where kind = 'overig'$$,
  $$values ('Voorrijkosten', 25.00::numeric(12,2))$$,
  'Voorrijkosten als artikel');

select is((select count(*)::int from public.events where type = 'tenant.onboarded'), 1, 'Onboarding schrijft een event');

-- Zonder eigen tarief: de suggestie van de branche.
select public.onboard_tenant(p_industry => 'loodgieter', p_name => 'Loodgieter Anna');
select results_eq(
  $$select i.sale_price, i.vat_rate from public.items i join public.tenants t on t.id = i.tenant_id
     where t.name = 'Loodgieter Anna'$$,
  $$values (65.00::numeric(12,2), 21.00::numeric(4,2))$$,
  'Zonder tarief wordt het voorgestelde branchetarief gebruikt');

select throws_ok($$select public.onboard_tenant(p_industry => 'astronaut', p_name => 'X')$$,
  '23503', null, 'Onbekende branche wordt geweigerd');

reset role;
set local role anon;
select throws_ok($$select public.onboard_tenant(p_industry => 'schilder', p_name => 'X')$$,
  '42501', null, 'Anoniem onboarden kan niet');

select * from finish();
rollback;

-- Onboarding: branches als data, bedrijfsgegevens op de tenant, logo-opslag en
-- één functie die een nieuw bedrijf in één transactie compleet neerzet.

create table public.industries (
  key                      text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  label                    text not null,
  icon                     text not null,                 -- lucide-icoonnaam, voor kanalen met beeld
  suggested_hourly_rate    numeric(12,2) not null,        -- indicatie, exclusief btw
  default_labour_vat_rate  numeric(4,2) not null default 21 check (default_labour_vat_rate in (0, 9, 21)),
  position                 int not null default 0
);

alter table public.industries enable row level security;
create policy industries_select on public.industries for select to authenticated using (true);
revoke all on public.industries from anon;

-- 9% geldt voor schilder- en stukadoorswerk aan woningen ouder dan 2 jaar; per regel aan te passen.
insert into public.industries (key, label, icon, suggested_hourly_rate, default_labour_vat_rate, position) values
  ('schilder',    'Schilder',          'paint-roller', 55, 9,  10),
  ('stukadoor',   'Stukadoor',         'layers',       55, 9,  20),
  ('timmer',      'Timmerman',         'hammer',       55, 21, 30),
  ('tuin',        'Hovenier',          'shovel',       50, 21, 40),
  ('loodgieter',  'Loodgieter',        'wrench',       65, 21, 50),
  ('elektricien', 'Elektricien',       'zap',          65, 21, 60),
  ('tegelzetter', 'Tegelzetter',       'grid-3x3',     55, 21, 70),
  ('dakdekker',   'Dakdekker',         'house',        60, 21, 80),
  ('klusjesman',  'Klusjesman',        'drill',        45, 21, 90),
  ('anders',      'Iets anders',       'briefcase',    50, 21, 100);

alter table public.tenants
  add column contact_name text,
  add column email        text,
  add column phone        text,
  add column address      jsonb,                          -- {street, postal_code, city}
  add column logo_path    text,
  add constraint tenants_industry_fkey foreign key (industry) references public.industries (key);

-- Nieuw bedrijf met de aanroeper als owner, een uurtarief-artikel en eventueel voorrijkosten.
create function public.onboard_tenant(
  p_industry         text,
  p_name             text,
  p_contact_name     text    default null,
  p_email            text    default null,
  p_phone            text    default null,
  p_address          jsonb   default null,
  p_hourly_rate      numeric default null,
  p_labour_vat_rate  numeric default null,
  p_call_out_fee     numeric default null,
  p_payment_days     int     default 14,
  p_kvk_number       text    default null,
  p_vat_number       text    default null,
  p_iban             text    default null
) returns public.tenants
language plpgsql security definer set search_path = '' as $$
declare
  v_industry public.industries;
  v_tenant   public.tenants;
begin
  if (select auth.uid()) is null then
    raise exception 'Niet ingelogd' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Bedrijfsnaam is verplicht' using errcode = 'check_violation';
  end if;
  if p_payment_days is null or p_payment_days not between 0 and 120 then
    raise exception 'Betaaltermijn moet tussen 0 en 120 dagen liggen' using errcode = 'check_violation';
  end if;

  select * into v_industry from public.industries where key = p_industry;
  if not found then
    raise exception 'Onbekende branche %', p_industry using errcode = 'foreign_key_violation';
  end if;

  insert into public.tenants (name, industry, contact_name, email, phone, address,
                              kvk_number, vat_number, iban, settings)
  values (trim(p_name), p_industry, p_contact_name, p_email, p_phone, p_address,
          p_kvk_number, p_vat_number, p_iban,
          jsonb_build_object('payment_days', p_payment_days))
  returning * into v_tenant;

  insert into public.memberships (user_id, tenant_id, role)
  values ((select auth.uid()), v_tenant.id, 'owner');

  insert into public.items (tenant_id, kind, name, unit, sale_price, vat_rate)
  values (v_tenant.id, 'arbeid', 'Uurtarief ' || lower(v_industry.label), 'uur',
          coalesce(p_hourly_rate, v_industry.suggested_hourly_rate),
          coalesce(p_labour_vat_rate, v_industry.default_labour_vat_rate));

  if coalesce(p_call_out_fee, 0) > 0 then
    insert into public.items (tenant_id, kind, name, unit, sale_price, vat_rate)
    values (v_tenant.id, 'overig', 'Voorrijkosten', 'keer', p_call_out_fee, 21);
  end if;

  insert into public.events (tenant_id, actor_user_id, channel, entity, entity_id, type)
  values (v_tenant.id, (select auth.uid()), 'onboarding', 'tenant', v_tenant.id, 'tenant.onboarded');

  return v_tenant;
end;
$$;
revoke execute on function public.onboard_tenant(text, text, text, text, text, jsonb, numeric, numeric, numeric, int, text, text, text)
  from public, anon;
grant execute on function public.onboard_tenant(text, text, text, text, text, jsonb, numeric, numeric, numeric, int, text, text, text)
  to authenticated;

create function app.uuid_or_null(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;
grant execute on function app.uuid_or_null(text) to authenticated, service_role;

-- Logo's: openbaar leesbaar (ze staan op offertes en facturen), alleen owner/admin uploadt.
-- Pad: <tenant_id>/<bestandsnaam>. Overgeslagen waar Storage niet draait.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage niet aanwezig, logo-bucket overgeslagen';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('logos', 'logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
  on conflict (id) do nothing;

  execute $p$
    create policy logos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'logos' and app.is_admin(app.uuid_or_null((storage.foldername(name))[1])))
  $p$;
  execute $p$
    create policy logos_update on storage.objects for update to authenticated
      using (bucket_id = 'logos' and app.is_admin(app.uuid_or_null((storage.foldername(name))[1])))
  $p$;
  execute $p$
    create policy logos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'logos' and app.is_admin(app.uuid_or_null((storage.foldername(name))[1])))
  $p$;
  execute $p$
    create policy logos_select on storage.objects for select to authenticated
      using (bucket_id = 'logos')
  $p$;
end;
$$;

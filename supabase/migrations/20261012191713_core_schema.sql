-- Kernschema HeadlessERP
--
-- Principes:
--   * Elke bedrijfstabel heeft tenant_id; primaire sleutel is (tenant_id, id) zodat
--     foreign keys nooit naar een rij van een ander bedrijf kunnen wijzen.
--   * Row Level Security op elke tabel; toegang loopt via lidmaatschap (memberships).
--   * Geld als numeric(12,2), nooit float. Btw-tarief per regel.
--   * Branche-specifieke velden in attributes jsonb, beschreven door field_definitions.
--   * Een definitieve factuur is onveranderlijk; corrigeren gaat via een creditfactuur.

create extension if not exists pgcrypto with schema extensions;

-- Hulpfuncties staan in een eigen schema dat PostgREST niet als API publiceert.
create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-------------------------------------------------------------------------------
-- Identiteit en tenancy
-------------------------------------------------------------------------------

create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  industry    text not null,                       -- 'schilder' | 'tuin' | 'timmer' | ...
  kvk_number  text,
  vat_number  text,
  iban        text,
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Profiel naast auth.users van Supabase.
create table public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text,
  phone       text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Extra identiteiten per kanaal (WhatsApp-nummer, spraak). Alleen de backend
-- (service_role) leest en schrijft deze tabel.
create table public.user_identities (
  provider     text not null check (provider in ('whatsapp', 'phone')),
  external_id  text not null,
  user_id      uuid not null references auth.users on delete cascade,
  verified_at  timestamptz,
  created_at   timestamptz not null default now(),
  primary key (provider, external_id)
);

create table public.memberships (
  user_id     uuid not null references auth.users on delete cascade,
  tenant_id   uuid not null references public.tenants on delete cascade,
  role        text not null check (role in ('owner', 'admin', 'medewerker', 'boekhouder')),
  created_at  timestamptz not null default now(),
  primary key (user_id, tenant_id)
);
create index memberships_tenant_idx on public.memberships (tenant_id);

-- Security definer zodat policies memberships kunnen lezen zonder recursieve RLS.
create function app.is_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = (select auth.uid())
  );
$$;

-- Schrijfrecht: iedereen behalve de boekhouder (die leest mee).
create function app.can_write(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'medewerker')
  );
$$;

create function app.is_admin(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

grant execute on function app.is_member(uuid), app.can_write(uuid), app.is_admin(uuid)
  to authenticated, service_role;

create function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-------------------------------------------------------------------------------
-- Branche-flexibiliteit
-------------------------------------------------------------------------------

create table public.field_definitions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants on delete cascade,  -- null = branche-template
  industry    text,
  entity      text not null check (entity in ('customer', 'item', 'quote', 'quote_line', 'job')),
  key         text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  label       text not null,
  data_type   text not null check (data_type in ('number', 'text', 'enum', 'date', 'bool')),
  options     jsonb not null default '{}',                     -- enum-waarden, eenheid, min/max
  required    boolean not null default false,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  check ((tenant_id is null) <> (industry is null))            -- template xor tenant-eigen
);
create unique index field_definitions_template_key
  on public.field_definitions (industry, entity, key) where tenant_id is null;
create unique index field_definitions_tenant_key
  on public.field_definitions (tenant_id, entity, key) where tenant_id is not null;

-------------------------------------------------------------------------------
-- Relaties en catalogus
-------------------------------------------------------------------------------

create table public.customers (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants on delete cascade,
  kind        text not null default 'particulier' check (kind in ('particulier', 'zakelijk')),
  name        text not null,
  email       text,
  phone       text,
  vat_number  text,
  address     jsonb,
  attributes  jsonb not null default '{}',
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, id)
);

-- Materialen en arbeid zijn allebei een artikel.
create table public.items (
  id              uuid not null default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants on delete cascade,
  kind            text not null check (kind in ('materiaal', 'arbeid', 'overig')),
  name            text not null,
  unit            text not null,                               -- 'uur', 'm2', 'liter', 'stuk'
  purchase_price  numeric(12,2),
  sale_price      numeric(12,2) not null,
  vat_rate        numeric(4,2) not null default 21 check (vat_rate in (0, 9, 21)),
  attributes      jsonb not null default '{}',
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (tenant_id, id)
);

-------------------------------------------------------------------------------
-- Offertes
-------------------------------------------------------------------------------

create table public.quotes (
  id           uuid not null default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants on delete cascade,
  customer_id  uuid not null,
  number       text,
  status       text not null default 'concept'
               check (status in ('concept', 'verzonden', 'geaccepteerd', 'afgewezen', 'verlopen')),
  valid_until  date,
  attributes   jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, number),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id)
);
create index quotes_customer_idx on public.quotes (tenant_id, customer_id);

create table public.quote_lines (
  id           uuid not null default gen_random_uuid(),
  tenant_id    uuid not null,
  quote_id     uuid not null,
  item_id      uuid,
  description  text not null,
  quantity     numeric(12,3) not null,
  unit         text not null,
  unit_price   numeric(12,2) not null,
  vat_rate     numeric(4,2) not null check (vat_rate in (0, 9, 21)),
  position     int not null default 0,
  attributes   jsonb not null default '{}',
  primary key (tenant_id, id),
  foreign key (tenant_id, quote_id) references public.quotes (tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references public.items (tenant_id, id)
);
create index quote_lines_quote_idx on public.quote_lines (tenant_id, quote_id);

-------------------------------------------------------------------------------
-- Opdrachten, uren en materiaal
-------------------------------------------------------------------------------

create table public.jobs (
  id            uuid not null default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants on delete cascade,
  customer_id   uuid not null,
  quote_id      uuid,                                          -- null bij regiewerk zonder offerte
  title         text not null,
  site_address  jsonb,
  status        text not null default 'gepland'
                check (status in ('gepland', 'bezig', 'opgeleverd', 'gefactureerd', 'geannuleerd')),
  starts_on     date,
  ends_on       date,
  attributes    jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, quote_id) references public.quotes (tenant_id, id)
);
create index jobs_customer_idx on public.jobs (tenant_id, customer_id);

-------------------------------------------------------------------------------
-- Facturen en betalingen
-------------------------------------------------------------------------------

create table public.invoices (
  id                  uuid not null default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants on delete cascade,
  customer_id         uuid not null,
  job_id              uuid,
  number              text,                                    -- toegekend bij definitief maken
  kind                text not null default 'factuur' check (kind in ('factuur', 'credit')),
  credits_invoice_id  uuid,
  status              text not null default 'concept'
                      check (status in ('concept', 'definitief', 'betaald', 'vervallen')),
  issued_on           date,
  due_on              date,
  customer_snapshot   jsonb,                                   -- NAW en btw-nummer bij uitgifte
  total_excl          numeric(12,2),
  total_vat           numeric(12,2),
  total_incl          numeric(12,2),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, number),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id),
  foreign key (tenant_id, credits_invoice_id) references public.invoices (tenant_id, id),
  check (status = 'concept' or number is not null)
);
create index invoices_customer_idx on public.invoices (tenant_id, customer_id);

create table public.invoice_lines (
  id           uuid not null default gen_random_uuid(),
  tenant_id    uuid not null,
  invoice_id   uuid not null,
  description  text not null,
  quantity     numeric(12,3) not null,
  unit         text not null,
  unit_price   numeric(12,2) not null,
  vat_rate     numeric(4,2) not null check (vat_rate in (0, 9, 21)),
  position     int not null default 0,
  primary key (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id) on delete cascade
);
create index invoice_lines_invoice_idx on public.invoice_lines (tenant_id, invoice_id);

create table public.time_entries (
  id               uuid not null default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants on delete cascade,
  job_id           uuid not null,
  user_id          uuid not null references auth.users,
  work_date        date not null,
  hours            numeric(5,2) not null check (hours > 0 and hours <= 24),
  billable         boolean not null default true,
  note             text,
  source           text not null default 'web' check (source in ('web', 'app', 'whatsapp', 'spraak', 'ai', 'api')),
  invoice_line_id  uuid,                                       -- gevuld zodra gefactureerd
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id),
  foreign key (tenant_id, invoice_line_id) references public.invoice_lines (tenant_id, id)
);
create index time_entries_job_idx on public.time_entries (tenant_id, job_id);

create table public.material_usages (
  id               uuid not null default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants on delete cascade,
  job_id           uuid not null,
  item_id          uuid,
  description      text not null,
  quantity         numeric(12,3) not null check (quantity > 0),
  unit             text not null,
  unit_price       numeric(12,2),
  source           text not null default 'web' check (source in ('web', 'app', 'whatsapp', 'spraak', 'ai', 'api')),
  invoice_line_id  uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id),
  foreign key (tenant_id, invoice_line_id) references public.invoice_lines (tenant_id, id)
);
create index material_usages_job_idx on public.material_usages (tenant_id, job_id);

create table public.payments (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants on delete cascade,
  invoice_id  uuid not null,
  amount      numeric(12,2) not null,
  paid_on     date not null,
  method      text,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id)
);

-- Doorlopende nummering zonder gaten, per bedrijf, documentsoort en jaar.
create table public.number_sequences (
  tenant_id   uuid not null references public.tenants on delete cascade,
  doc_type    text not null,
  year        int not null,
  last_value  int not null default 0,
  primary key (tenant_id, doc_type, year)
);

-- Audit en outbox voor webhooks, notificaties en AI-kanalen.
create table public.events (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references public.tenants on delete cascade,
  actor_user_id  uuid,
  channel        text,
  entity         text not null,
  entity_id      uuid not null,
  type           text not null,                                -- 'invoice.issued', 'quote.accepted'
  payload        jsonb,
  occurred_at    timestamptz not null default now(),
  processed_at   timestamptz
);
create index events_unprocessed_idx on public.events (occurred_at) where processed_at is null;

-------------------------------------------------------------------------------
-- updated_at-triggers
-------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['tenants', 'profiles', 'customers', 'items', 'quotes', 'jobs',
                           'invoices', 'time_entries', 'material_usages'] loop
    execute format('create trigger touch_updated_at before update on public.%I
                    for each row execute function app.touch_updated_at()', t);
  end loop;
end;
$$;

-------------------------------------------------------------------------------
-- Row Level Security
-------------------------------------------------------------------------------

alter table public.tenants           enable row level security;
alter table public.profiles          enable row level security;
alter table public.user_identities   enable row level security;
alter table public.memberships       enable row level security;
alter table public.field_definitions enable row level security;
alter table public.number_sequences  enable row level security;
alter table public.events            enable row level security;

create policy tenants_select on public.tenants for select to authenticated
  using (app.is_member(id));
create policy tenants_update on public.tenants for update to authenticated
  using (app.is_admin(id)) with check (app.is_admin(id));

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid())
         or exists (select 1 from public.memberships m
                    where m.user_id = profiles.id and app.is_member(m.tenant_id)));
create policy profiles_upsert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- user_identities en number_sequences: geen policies = alleen service_role.

create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or app.is_member(tenant_id));
create policy memberships_admin on public.memberships for all to authenticated
  using (app.is_admin(tenant_id)) with check (app.is_admin(tenant_id));

create policy field_definitions_select on public.field_definitions for select to authenticated
  using (tenant_id is null or app.is_member(tenant_id));
create policy field_definitions_admin on public.field_definitions for all to authenticated
  using (tenant_id is not null and app.is_admin(tenant_id))
  with check (tenant_id is not null and app.is_admin(tenant_id));

create policy events_select on public.events for select to authenticated
  using (app.is_member(tenant_id));

-- Bedrijfsdata: lezen voor elk lid, schrijven voor owner/admin/medewerker.
do $$
declare t text;
begin
  foreach t in array array['customers', 'items', 'quotes', 'quote_lines', 'jobs', 'invoices',
                           'invoice_lines', 'time_entries', 'material_usages', 'payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated
                    using (app.is_member(tenant_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated
                    with check (app.can_write(tenant_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated
                    using (app.can_write(tenant_id)) with check (app.can_write(tenant_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated
                    using (app.can_write(tenant_id))', t || '_delete', t);
  end loop;
end;
$$;

-- Anonieme bezoekers krijgen niets, ook niet als er later een policy bij komt.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-------------------------------------------------------------------------------
-- Facturen: onveranderlijk na definitief maken
-------------------------------------------------------------------------------

create function app.guard_invoice() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'concept' then
      raise exception 'Definitieve factuur % kan niet worden verwijderd', old.number
        using errcode = 'check_violation';
    end if;
    return old;
  end if;
  -- Na definitief mag alleen de status nog veranderen (betaald, vervallen).
  if old.status <> 'concept' and (
       new.number, new.customer_id, new.issued_on, new.due_on, new.customer_snapshot,
       new.total_excl, new.total_vat, new.total_incl, new.kind, new.credits_invoice_id)
     is distinct from (
       old.number, old.customer_id, old.issued_on, old.due_on, old.customer_snapshot,
       old.total_excl, old.total_vat, old.total_incl, old.kind, old.credits_invoice_id)
     or (old.status <> 'concept' and new.status = 'concept') then
    raise exception 'Definitieve factuur % is onveranderlijk; maak een creditfactuur', old.number
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger guard_invoice before update or delete on public.invoices
  for each row execute function app.guard_invoice();

create function app.guard_invoice_lines() returns trigger
language plpgsql as $$
declare
  v_status text;
  v_row    public.invoice_lines := coalesce(new, old);
begin
  select status into v_status from public.invoices
   where tenant_id = v_row.tenant_id and id = v_row.invoice_id;
  -- v_status is null wanneer de factuur zelf al via cascade is verwijderd.
  if v_status is not null and v_status <> 'concept' then
    raise exception 'Regels van een definitieve factuur zijn onveranderlijk'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_invoice_lines before insert or update or delete on public.invoice_lines
  for each row execute function app.guard_invoice_lines();

-- Volgend doorlopend nummer. De rij blijft gelockt tot het einde van de transactie,
-- zodat een teruggedraaide factuur geen gat in de nummering achterlaat.
create function app.next_number(p_tenant uuid, p_doc_type text, p_year int)
returns int language sql security definer set search_path = '' as $$
  insert into public.number_sequences as s (tenant_id, doc_type, year, last_value)
  values (p_tenant, p_doc_type, p_year, 1)
  on conflict (tenant_id, doc_type, year) do update set last_value = s.last_value + 1
  returning last_value;
$$;
revoke execute on function app.next_number(uuid, text, int) from public;

-- Maakt een conceptfactuur definitief: nummer, datum, totalen, klant-snapshot en event.
create function public.finalize_invoice(p_tenant uuid, p_invoice uuid, p_payment_days int default 14)
returns public.invoices
language plpgsql security definer set search_path = '' as $$
declare
  v_inv   public.invoices;
  v_year  int := extract(year from current_date)::int;
  v_seq   int;
begin
  if not app.can_write(p_tenant) and (select auth.role()) <> 'service_role' then
    raise exception 'Geen schrijfrechten voor dit bedrijf' using errcode = 'insufficient_privilege';
  end if;

  select * into v_inv from public.invoices
   where tenant_id = p_tenant and id = p_invoice for update;
  if not found then
    raise exception 'Factuur niet gevonden' using errcode = 'no_data_found';
  end if;
  if v_inv.status <> 'concept' then
    raise exception 'Factuur % is al definitief', v_inv.number using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.invoice_lines where tenant_id = p_tenant and invoice_id = p_invoice) then
    raise exception 'Factuur heeft geen regels' using errcode = 'check_violation';
  end if;

  v_seq := app.next_number(p_tenant, 'invoice', v_year);

  update public.invoices i set
    number            = v_year || '-' || lpad(v_seq::text, 4, '0'),
    status            = 'definitief',
    issued_on         = current_date,
    due_on            = current_date + p_payment_days,
    customer_snapshot = (select jsonb_build_object('name', c.name, 'kind', c.kind, 'email', c.email,
                                                   'vat_number', c.vat_number, 'address', c.address)
                           from public.customers c
                          where c.tenant_id = i.tenant_id and c.id = i.customer_id),
    total_excl        = t.excl,
    total_vat         = t.vat,
    total_incl        = t.excl + t.vat
  from (
    -- Btw per tarief afronden, zoals op de factuur getoond.
    select coalesce(sum(excl), 0) as excl, coalesce(sum(round(excl * rate / 100, 2)), 0) as vat
      from (select vat_rate as rate, round(sum(quantity * unit_price), 2) as excl
              from public.invoice_lines
             where tenant_id = p_tenant and invoice_id = p_invoice
             group by vat_rate) per_rate
  ) t
  where i.tenant_id = p_tenant and i.id = p_invoice
  returning i.* into v_inv;

  insert into public.events (tenant_id, actor_user_id, entity, entity_id, type, payload)
  values (p_tenant, (select auth.uid()), 'invoice', p_invoice, 'invoice.issued',
          jsonb_build_object('number', v_inv.number, 'total_incl', v_inv.total_incl));

  return v_inv;
end;
$$;
revoke execute on function public.finalize_invoice(uuid, uuid, int) from public, anon;
grant execute on function public.finalize_invoice(uuid, uuid, int) to authenticated, service_role;

-------------------------------------------------------------------------------
-- Onboarding: nieuw bedrijf aanmaken met de aanroeper als owner
-------------------------------------------------------------------------------

create function public.create_tenant(p_name text, p_industry text)
returns public.tenants
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant public.tenants;
begin
  if (select auth.uid()) is null then
    raise exception 'Niet ingelogd' using errcode = 'insufficient_privilege';
  end if;
  insert into public.tenants (name, industry) values (p_name, p_industry) returning * into v_tenant;
  insert into public.memberships (user_id, tenant_id, role) values ((select auth.uid()), v_tenant.id, 'owner');
  return v_tenant;
end;
$$;
revoke execute on function public.create_tenant(text, text) from public, anon;
grant execute on function public.create_tenant(text, text) to authenticated;

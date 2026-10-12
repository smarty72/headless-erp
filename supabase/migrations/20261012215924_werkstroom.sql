-- Werkstroom: offerte -> opdracht -> uren en materiaal -> factuur -> betaling.
--
--   * Offertes krijgen een nummer bij versturen; daarna liggen de regels vast.
--   * Een geaccepteerde offerte wordt in één stap een opdracht.
--   * Uren kun je achteraf invullen of met een timer bijhouden (één lopende timer per persoon).
--   * Een factuur maak je uit een opdracht: offerteregels plus factureerbare uren en materiaal.
--     Bij een opdracht met offerte zijn uren en materiaal standaard niet factureerbaar
--     (nacalculatie); meerwerk zet je op factureerbaar.

-- Event vastleggen vanuit functies die met de rechten van de gebruiker draaien
-- (events heeft geen insert-policy). Alleen voor wie mag schrijven.
create function app.log_event(p_tenant uuid, p_entity text, p_entity_id uuid, p_type text, p_payload jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_write(p_tenant) then
    raise exception 'Geen schrijfrechten voor dit bedrijf' using errcode = 'insufficient_privilege';
  end if;
  insert into public.events (tenant_id, actor_user_id, entity, entity_id, type, payload)
  values (p_tenant, (select auth.uid()), p_entity, p_entity_id, p_type, p_payload);
end;
$$;
revoke execute on function app.log_event(uuid, text, uuid, text, jsonb) from public;
grant execute on function app.log_event(uuid, text, uuid, text, jsonb) to authenticated, service_role;

-------------------------------------------------------------------------------
-- Uren en materiaal
-------------------------------------------------------------------------------

alter table public.time_entries
  add column item_id    uuid,                                  -- arbeid-artikel (tarief); leeg = standaard uurtarief
  add column started_at timestamptz,
  add column ended_at   timestamptz,
  alter column hours drop not null,
  alter column user_id set default auth.uid(),
  alter column work_date set default current_date,
  add constraint time_entries_item_fkey foreign key (tenant_id, item_id) references public.items (tenant_id, id),
  add constraint time_entries_hours_or_running
    check (hours is not null or (started_at is not null and ended_at is null));

-- Eén lopende timer per persoon per bedrijf.
create unique index time_entries_one_running on public.time_entries (tenant_id, user_id) where hours is null;

alter table public.material_usages
  add column billable boolean not null default true;

-- Een conceptfactuur verwijderen maakt de uren en het materiaal weer vrij.
alter table public.time_entries
  drop constraint time_entries_tenant_id_invoice_line_id_fkey,
  add constraint time_entries_tenant_id_invoice_line_id_fkey foreign key (tenant_id, invoice_line_id)
    references public.invoice_lines (tenant_id, id) on delete set null (invoice_line_id);
alter table public.material_usages
  drop constraint material_usages_tenant_id_invoice_line_id_fkey,
  add constraint material_usages_tenant_id_invoice_line_id_fkey foreign key (tenant_id, invoice_line_id)
    references public.invoice_lines (tenant_id, id) on delete set null (invoice_line_id);

-- Het standaard uurtarief van een bedrijf: het oudste actieve arbeid-artikel.
create function app.default_labour_item(p_tenant uuid) returns uuid
language sql stable set search_path = '' as $$
  select id from public.items
   where tenant_id = p_tenant and kind = 'arbeid' and archived_at is null
   order by created_at, name
   limit 1;
$$;
grant execute on function app.default_labour_item(uuid) to authenticated, service_role;

-- Stopt de lopende timer van de aanroeper; afgerond op het dichtstbijzijnde kwartier.
create function public.stop_timer(p_tenant uuid) returns public.time_entries
language plpgsql set search_path = '' as $$
declare
  v_entry public.time_entries;
begin
  update public.time_entries set
    ended_at = now(),
    hours    = least(24, greatest(0.25, round(extract(epoch from now() - started_at) / 900) * 0.25))
  where tenant_id = p_tenant and user_id = (select auth.uid()) and hours is null
  returning * into v_entry;
  if not found then
    raise exception 'Er loopt geen timer' using errcode = 'no_data_found';
  end if;
  return v_entry;
end;
$$;

-- Start een timer op een opdracht. Een lopende timer op een andere klus stopt eerst.
create function public.start_timer(p_tenant uuid, p_job uuid, p_note text default null)
returns public.time_entries
language plpgsql set search_path = '' as $$
declare
  v_job   public.jobs;
  v_entry public.time_entries;
begin
  select * into v_job from public.jobs where tenant_id = p_tenant and id = p_job;
  if not found then
    raise exception 'Opdracht niet gevonden' using errcode = 'no_data_found';
  end if;
  if v_job.status in ('gefactureerd', 'geannuleerd') then
    raise exception 'Deze opdracht is al afgesloten' using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.time_entries
              where tenant_id = p_tenant and user_id = (select auth.uid()) and hours is null) then
    perform public.stop_timer(p_tenant);
  end if;

  insert into public.time_entries (tenant_id, job_id, item_id, started_at, billable, note, source)
  values (p_tenant, p_job, app.default_labour_item(p_tenant), now(), v_job.quote_id is null, p_note, 'app')
  returning * into v_entry;

  if v_job.status = 'gepland' then
    update public.jobs set status = 'bezig' where tenant_id = p_tenant and id = p_job;
  end if;
  return v_entry;
end;
$$;

-------------------------------------------------------------------------------
-- Offertes
-------------------------------------------------------------------------------

alter table public.quotes
  add column title text,                                       -- bijv. 'Buitenschilderwerk kozijnen'
  add column notes text;                                       -- toelichting onder de offerte

-- Regels van een verstuurde offerte liggen vast.
create function app.guard_quote_lines() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_row    public.quote_lines := coalesce(new, old);
  v_status text;
begin
  select status into v_status from public.quotes
   where tenant_id = v_row.tenant_id and id = v_row.quote_id;
  if v_status is not null and v_status <> 'concept' then
    raise exception 'Regels van een verstuurde offerte liggen vast' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_quote_lines before insert or update or delete on public.quote_lines
  for each row execute function app.guard_quote_lines();

-- Versturen: doorlopend offertenummer, geldigheid en event. Security definer voor de nummering.
create function public.send_quote(p_tenant uuid, p_quote uuid, p_valid_days int default 30)
returns public.quotes
language plpgsql security definer set search_path = '' as $$
declare
  v_quote public.quotes;
  v_year  int := extract(year from current_date)::int;
begin
  if not app.can_write(p_tenant) then
    raise exception 'Geen schrijfrechten voor dit bedrijf' using errcode = 'insufficient_privilege';
  end if;
  select * into v_quote from public.quotes where tenant_id = p_tenant and id = p_quote for update;
  if not found then
    raise exception 'Offerte niet gevonden' using errcode = 'no_data_found';
  end if;
  if v_quote.status <> 'concept' then
    raise exception 'Offerte % is al verstuurd', v_quote.number using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.quote_lines where tenant_id = p_tenant and quote_id = p_quote) then
    raise exception 'Offerte heeft geen regels' using errcode = 'check_violation';
  end if;

  update public.quotes set
    number      = 'O' || v_year || '-' || lpad(app.next_number(p_tenant, 'quote', v_year)::text, 4, '0'),
    status      = 'verzonden',
    valid_until = coalesce(valid_until, current_date + p_valid_days)
  where tenant_id = p_tenant and id = p_quote
  returning * into v_quote;

  insert into public.events (tenant_id, actor_user_id, entity, entity_id, type, payload)
  values (p_tenant, (select auth.uid()), 'quote', p_quote, 'quote.sent', jsonb_build_object('number', v_quote.number));
  return v_quote;
end;
$$;

-- Akkoord van de klant: offerte geaccepteerd en meteen een opdracht.
create function public.accept_quote(p_tenant uuid, p_quote uuid, p_title text default null,
                                    p_starts_on date default null)
returns public.jobs
language plpgsql set search_path = '' as $$
declare
  v_quote public.quotes;
  v_job   public.jobs;
begin
  select * into v_quote from public.quotes where tenant_id = p_tenant and id = p_quote for update;
  if not found then
    raise exception 'Offerte niet gevonden' using errcode = 'no_data_found';
  end if;
  if v_quote.status = 'concept' then
    v_quote := public.send_quote(p_tenant, p_quote);   -- mondeling akkoord: eerst een nummer
  elsif v_quote.status <> 'verzonden' then
    raise exception 'Offerte is al %', v_quote.status using errcode = 'check_violation';
  end if;

  update public.quotes set status = 'geaccepteerd' where tenant_id = p_tenant and id = p_quote;

  insert into public.jobs (tenant_id, customer_id, quote_id, title, site_address, starts_on)
  select p_tenant, v_quote.customer_id, p_quote,
         coalesce(nullif(trim(p_title), ''), v_quote.title, 'Offerte ' || v_quote.number),
         c.address, p_starts_on
    from public.customers c
   where c.tenant_id = p_tenant and c.id = v_quote.customer_id
  returning * into v_job;

  perform app.log_event(p_tenant, 'quote', p_quote, 'quote.accepted',
                        jsonb_build_object('number', v_quote.number, 'job_id', v_job.id));
  return v_job;
end;
$$;

-------------------------------------------------------------------------------
-- Facturen
-------------------------------------------------------------------------------

-- Conceptfactuur uit een opdracht. Bestaat er al een concept, dan komt dat terug.
create function public.create_invoice_from_job(p_tenant uuid, p_job uuid)
returns public.invoices
language plpgsql set search_path = '' as $$
declare
  v_job     public.jobs;
  v_invoice public.invoices;
  v_pos     int := 0;
  v_line    uuid;
  v_default uuid := app.default_labour_item(p_tenant);
  r         record;
begin
  select * into v_job from public.jobs where tenant_id = p_tenant and id = p_job for update;
  if not found then
    raise exception 'Opdracht niet gevonden' using errcode = 'no_data_found';
  end if;

  select * into v_invoice from public.invoices
   where tenant_id = p_tenant and job_id = p_job and status = 'concept';
  if found then
    return v_invoice;
  end if;

  insert into public.invoices (tenant_id, customer_id, job_id)
  values (p_tenant, v_job.customer_id, p_job)
  returning * into v_invoice;

  -- 1. De geaccepteerde offerte.
  for r in
    select l.description, l.quantity, l.unit, l.unit_price, l.vat_rate
      from public.quote_lines l join public.quotes q on q.tenant_id = l.tenant_id and q.id = l.quote_id
     where l.tenant_id = p_tenant and l.quote_id = v_job.quote_id and q.status = 'geaccepteerd'
     order by l.position, l.id
  loop
    v_pos := v_pos + 1;
    insert into public.invoice_lines (tenant_id, invoice_id, description, quantity, unit, unit_price, vat_rate, position)
    values (p_tenant, v_invoice.id, r.description, r.quantity, r.unit, r.unit_price, r.vat_rate, v_pos);
  end loop;

  -- 2. Factureerbare uren, per tarief samengevoegd.
  for r in
    select i.id as item_id, i.name, i.sale_price, i.vat_rate, sum(t.hours) as hours
      from public.time_entries t
      join public.items i on i.tenant_id = t.tenant_id and i.id = coalesce(t.item_id, v_default)
     where t.tenant_id = p_tenant and t.job_id = p_job and t.billable
       and t.hours is not null and t.invoice_line_id is null
     group by i.id, i.name, i.sale_price, i.vat_rate
     order by i.name
  loop
    v_pos := v_pos + 1;
    insert into public.invoice_lines (tenant_id, invoice_id, description, quantity, unit, unit_price, vat_rate, position)
    values (p_tenant, v_invoice.id, r.name, r.hours, 'uur', r.sale_price, r.vat_rate, v_pos)
    returning id into v_line;
    update public.time_entries set invoice_line_id = v_line
     where tenant_id = p_tenant and job_id = p_job and billable and hours is not null
       and invoice_line_id is null and coalesce(item_id, v_default) = r.item_id;
  end loop;

  if exists (select 1 from public.time_entries
              where tenant_id = p_tenant and job_id = p_job and billable
                and hours is not null and invoice_line_id is null) then
    raise exception 'Leg eerst een uurtarief vast bij Artikelen' using errcode = 'check_violation';
  end if;

  -- 3. Factureerbaar materiaal.
  for r in
    select m.id, m.description, m.quantity, m.unit,
           coalesce(m.unit_price, i.sale_price, 0) as unit_price, coalesce(i.vat_rate, 21) as vat_rate
      from public.material_usages m
      left join public.items i on i.tenant_id = m.tenant_id and i.id = m.item_id
     where m.tenant_id = p_tenant and m.job_id = p_job and m.billable and m.invoice_line_id is null
     order by m.created_at
  loop
    v_pos := v_pos + 1;
    insert into public.invoice_lines (tenant_id, invoice_id, description, quantity, unit, unit_price, vat_rate, position)
    values (p_tenant, v_invoice.id, r.description, r.quantity, r.unit, r.unit_price, r.vat_rate, v_pos)
    returning id into v_line;
    update public.material_usages set invoice_line_id = v_line where tenant_id = p_tenant and id = r.id;
  end loop;

  if v_pos = 0 then
    raise exception 'Er is nog niets te factureren op deze opdracht' using errcode = 'check_violation';
  end if;

  perform app.log_event(p_tenant, 'invoice', v_invoice.id, 'invoice.created', jsonb_build_object('job_id', p_job));
  return v_invoice;
end;
$$;

-- Betaling vastleggen; volledig betaald zet de factuur op betaald.
create function public.register_payment(p_tenant uuid, p_invoice uuid, p_amount numeric,
                                        p_paid_on date default current_date, p_method text default null)
returns public.invoices
language plpgsql set search_path = '' as $$
declare
  v_invoice public.invoices;
  v_paid    numeric;
begin
  select * into v_invoice from public.invoices where tenant_id = p_tenant and id = p_invoice for update;
  if not found then
    raise exception 'Factuur niet gevonden' using errcode = 'no_data_found';
  end if;
  if v_invoice.status not in ('definitief', 'vervallen') then
    raise exception 'Alleen een openstaande definitieve factuur kan worden betaald' using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Bedrag moet groter dan 0 zijn' using errcode = 'check_violation';
  end if;

  insert into public.payments (tenant_id, invoice_id, amount, paid_on, method)
  values (p_tenant, p_invoice, p_amount, coalesce(p_paid_on, current_date), p_method);

  select coalesce(sum(amount), 0) into v_paid from public.payments where tenant_id = p_tenant and invoice_id = p_invoice;
  if v_paid >= v_invoice.total_incl then
    update public.invoices set status = 'betaald' where tenant_id = p_tenant and id = p_invoice
    returning * into v_invoice;
    perform app.log_event(p_tenant, 'invoice', p_invoice, 'invoice.paid', jsonb_build_object('number', v_invoice.number));
  end if;
  return v_invoice;
end;
$$;

-------------------------------------------------------------------------------
-- Rechten
-------------------------------------------------------------------------------

revoke execute on function public.stop_timer(uuid), public.start_timer(uuid, uuid, text),
  public.send_quote(uuid, uuid, int), public.accept_quote(uuid, uuid, text, date),
  public.create_invoice_from_job(uuid, uuid), public.register_payment(uuid, uuid, numeric, date, text)
  from public, anon;
grant execute on function public.stop_timer(uuid), public.start_timer(uuid, uuid, text),
  public.send_quote(uuid, uuid, int), public.accept_quote(uuid, uuid, text, date),
  public.create_invoice_from_job(uuid, uuid), public.register_payment(uuid, uuid, numeric, date, text)
  to authenticated, service_role;

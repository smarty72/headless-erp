-- Omschrijving bij uren ("voorkant huis", "schuren") komt terug op de factuur.
-- Uren worden nu per tarief en omschrijving samengevoegd: "Uurtarief schilder – voorkant huis".

create or replace function public.create_invoice_from_job(p_tenant uuid, p_job uuid)
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

  -- 2. Factureerbare uren, per tarief en omschrijving samengevoegd.
  for r in
    select i.id as item_id, i.name, i.sale_price, i.vat_rate, nullif(btrim(t.note), '') as note, sum(t.hours) as hours
      from public.time_entries t
      join public.items i on i.tenant_id = t.tenant_id and i.id = coalesce(t.item_id, v_default)
     where t.tenant_id = p_tenant and t.job_id = p_job and t.billable
       and t.hours is not null and t.invoice_line_id is null
     group by i.id, i.name, i.sale_price, i.vat_rate, nullif(btrim(t.note), '')
     order by i.name, min(t.work_date), nullif(btrim(t.note), '') nulls first
  loop
    v_pos := v_pos + 1;
    insert into public.invoice_lines (tenant_id, invoice_id, description, quantity, unit, unit_price, vat_rate, position)
    values (p_tenant, v_invoice.id, r.name || coalesce(' – ' || r.note, ''), r.hours, 'uur', r.sale_price, r.vat_rate, v_pos)
    returning id into v_line;
    update public.time_entries set invoice_line_id = v_line
     where tenant_id = p_tenant and job_id = p_job and billable and hours is not null
       and invoice_line_id is null and coalesce(item_id, v_default) = r.item_id
       and nullif(btrim(note), '') is not distinct from r.note;
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

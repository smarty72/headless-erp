-- Productbeheer en eenvoudige voorraad.
--
--   * Artikelen krijgen merk, artikelcode en een minimumvoorraad.
--   * Voorraad is een grootboek: stock_movements is de waarheid, items.stock_quantity
--     een bijgehouden saldo. Mutaties worden nooit gewijzigd; corrigeren = nieuwe mutatie.
--   * Materiaalverbruik op een opdracht boekt automatisch voorraad af.

alter table public.items
  add column brand          text,
  add column sku            text,
  add column track_stock    boolean not null default false,
  add column stock_quantity numeric(12,3) not null default 0,
  add column min_stock      numeric(12,3) check (min_stock >= 0),
  add constraint items_sku_unique unique (tenant_id, sku),
  add constraint items_stock_only_for_goods check (not track_stock or kind = 'materiaal');

-- Het saldo verandert alleen via mutaties.
create function app.guard_item_stock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.stock_quantity := 0;  -- beginvoorraad boek je als mutatie
  elsif new.stock_quantity is distinct from old.stock_quantity
        and coalesce(current_setting('app.stock_sync', true), '') <> 'on' then
    raise exception 'Voorraad wijzig je met een voorraadmutatie, niet rechtstreeks'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger guard_item_stock before insert or update on public.items
  for each row execute function app.guard_item_stock();

create table public.stock_movements (
  id                 bigint generated always as identity,
  tenant_id          uuid not null references public.tenants on delete cascade,
  item_id            uuid not null,
  quantity           numeric(12,3) not null check (quantity <> 0),  -- positief = erbij, negatief = eraf
  reason             text not null
                     check (reason in ('beginvoorraad', 'inkoop', 'verbruik', 'correctie', 'retour')),
  job_id             uuid,
  material_usage_id  uuid,
  unit_cost          numeric(12,2),
  note               text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id),
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id),
  foreign key (tenant_id, material_usage_id)
    references public.material_usages (tenant_id, id) on delete set null (material_usage_id)
);
create index stock_movements_item_idx on public.stock_movements (tenant_id, item_id, created_at);

alter table public.stock_movements enable row level security;
create policy stock_movements_select on public.stock_movements for select to authenticated
  using (app.is_member(tenant_id));
create policy stock_movements_insert on public.stock_movements for insert to authenticated
  with check (app.can_write(tenant_id));
-- Mutaties zijn onveranderlijk: geen policy en geen recht om te wijzigen of te verwijderen.
revoke update, delete, truncate on public.stock_movements from authenticated, anon;

-- Elke mutatie werkt het saldo van het artikel bij.
create function app.apply_stock_movement() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.items i
                  where i.tenant_id = new.tenant_id and i.id = new.item_id and i.track_stock) then
    raise exception 'Voor dit artikel wordt geen voorraad bijgehouden'
      using errcode = 'check_violation';
  end if;
  perform set_config('app.stock_sync', 'on', true);
  update public.items set stock_quantity = stock_quantity + new.quantity
   where tenant_id = new.tenant_id and id = new.item_id;
  perform set_config('app.stock_sync', 'off', true);
  return new;
end;
$$;

create trigger apply_stock_movement after insert on public.stock_movements
  for each row execute function app.apply_stock_movement();

-- Materiaalverbruik boekt voorraad af (en terug bij wijzigen of verwijderen).
create function app.material_usage_stock() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_old_tracked boolean := false;
  v_new_tracked boolean := false;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.item_id is not null then
    select track_stock into v_old_tracked from public.items
     where tenant_id = old.tenant_id and id = old.item_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.item_id is not null then
    select track_stock into v_new_tracked from public.items
     where tenant_id = new.tenant_id and id = new.item_id;
  end if;

  if tg_op = 'UPDATE' and old.item_id is not distinct from new.item_id
     and old.quantity = new.quantity then
    return new;
  end if;

  if coalesce(v_old_tracked, false) then
    insert into public.stock_movements (tenant_id, item_id, quantity, reason, job_id, note)
    values (old.tenant_id, old.item_id, old.quantity, 'correctie', old.job_id,
            'Materiaalverbruik teruggedraaid');
  end if;
  if coalesce(v_new_tracked, false) then
    insert into public.stock_movements (tenant_id, item_id, quantity, reason, job_id, material_usage_id)
    values (new.tenant_id, new.item_id, -new.quantity, 'verbruik', new.job_id, new.id);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger material_usage_stock after insert or update or delete on public.material_usages
  for each row execute function app.material_usage_stock();

-- Artikelen onder de minimumvoorraad; security_invoker zodat RLS van items geldt.
create view public.low_stock_items with (security_invoker = true) as
  select tenant_id, id, name, brand, sku, unit, stock_quantity, min_stock
    from public.items
   where track_stock and min_stock is not null and stock_quantity < min_stock
     and archived_at is null;

revoke all on public.low_stock_items from anon;

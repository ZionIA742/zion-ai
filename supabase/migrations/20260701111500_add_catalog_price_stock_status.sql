-- Pilar 8 / Fase 2 / Checkpoint 2.1
-- Semântica persistida de preço e estoque.
-- Não infere significado de dados antigos.

alter table public.pools
  add column if not exists price_status text,
  add column if not exists stock_status text;

alter table public.store_catalog_items
  add column if not exists price_status text,
  add column if not exists stock_status text;

-- Backfill conservador:
-- registros históricos não têm evidência confiável para classificar
-- preço e estoque como valid/missing/zero/etc.
update public.pools
set
  price_status = coalesce(price_status, 'unknown_legacy'),
  stock_status = coalesce(stock_status, 'unknown_legacy');

update public.store_catalog_items
set
  price_status = coalesce(price_status, 'unknown_legacy'),
  stock_status = coalesce(stock_status, 'unknown_legacy');

alter table public.pools
  alter column price_status set default 'unknown_legacy',
  alter column stock_status set default 'unknown_legacy',
  alter column price_status set not null,
  alter column stock_status set not null;

alter table public.store_catalog_items
  alter column price_status set default 'unknown_legacy',
  alter column stock_status set default 'unknown_legacy',
  alter column price_status set not null,
  alter column stock_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pools_price_status_check'
      and conrelid = 'public.pools'::regclass
  ) then
    alter table public.pools
      add constraint pools_price_status_check
      check (
        price_status in (
          'valid',
          'missing',
          'invalid',
          'on_request',
          'unknown_legacy'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'pools_stock_status_check'
      and conrelid = 'public.pools'::regclass
  ) then
    alter table public.pools
      add constraint pools_stock_status_check
      check (
        stock_status in (
          'available',
          'zero',
          'unknown',
          'unknown_legacy',
          'not_tracked'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_catalog_items_price_status_check'
      and conrelid = 'public.store_catalog_items'::regclass
  ) then
    alter table public.store_catalog_items
      add constraint store_catalog_items_price_status_check
      check (
        price_status in (
          'valid',
          'missing',
          'invalid',
          'on_request',
          'unknown_legacy'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_catalog_items_stock_status_check'
      and conrelid = 'public.store_catalog_items'::regclass
  ) then
    alter table public.store_catalog_items
      add constraint store_catalog_items_stock_status_check
      check (
        stock_status in (
          'available',
          'zero',
          'unknown',
          'unknown_legacy',
          'not_tracked'
        )
      );
  end if;
end
$$;

comment on column public.pools.price_status is
  'Semântica comercial do preço: valid, missing, invalid, on_request ou unknown_legacy.';

comment on column public.pools.stock_status is
  'Semântica comercial do estoque: available, zero, unknown, unknown_legacy ou not_tracked.';

comment on column public.store_catalog_items.price_status is
  'Semântica comercial do preço: valid, missing, invalid, on_request ou unknown_legacy.';

comment on column public.store_catalog_items.stock_status is
  'Semântica comercial do estoque: available, zero, unknown, unknown_legacy ou not_tracked.';
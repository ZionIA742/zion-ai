-- ZION / Bloco 2 / 2.1.4-P
-- Protect human quote provenance at the sales_quotes boundary.
-- No historical backfill. No changes to CRM or AI approval.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $preflight$
begin
  if pg_catalog.to_regclass('public.sales_quotes') is null then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_QUOTE_PROVENANCE_TABLE_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.sales_quotes'::pg_catalog.regclass
      and a.attname = 'metadata'
      and a.atttypid = 'pg_catalog.jsonb'::pg_catalog.regtype
      and not a.attisdropped
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_QUOTE_PROVENANCE_METADATA_CONTRACT_INVALID';
  end if;
end;
$preflight$;

create or replace function public.zion_sales_quote_creation_provenance_guard_trg()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_metadata jsonb;
  v_has_actor_provenance boolean;
begin
  if tg_op = 'UPDATE' then
    if old.metadata -> 'creation_actor_kind'
         is distinct from new.metadata -> 'creation_actor_kind'
       or old.metadata -> 'creation_actor_user_id'
         is distinct from new.metadata -> 'creation_actor_user_id'
       or old.metadata -> 'created_via'
         is distinct from new.metadata -> 'created_via'
    then
      raise exception using
        errcode = '42501',
        message = 'ZION_QUOTE_CREATION_PROVENANCE_IMMUTABLE';
    end if;

    return new;
  end if;

  v_metadata := coalesce(new.metadata, '{}'::jsonb);

  v_has_actor_provenance :=
       v_metadata ? 'creation_actor_kind'
    or v_metadata ? 'creation_actor_user_id';

  if v_has_actor_provenance then
    -- Inspect database role, not caller-supplied JSON or JWT GUC.
    -- Direct service_role writes and postgres admin sessions only.
    if current_user <> 'service_role'
       and not (
         current_user = 'postgres'
         and session_user = 'postgres'
       )
    then
      raise exception using
        errcode = '42501',
        message = 'ZION_QUOTE_CREATION_PROVENANCE_INSERT_FORBIDDEN';
    end if;

    if pg_catalog.jsonb_typeof(v_metadata) is distinct from 'object'
       or v_metadata ->> 'creation_actor_kind' is distinct from 'user'
       or pg_catalog.jsonb_typeof(
            v_metadata -> 'creation_actor_user_id'
          ) is distinct from 'string'
       or nullif(
            pg_catalog.btrim(v_metadata ->> 'creation_actor_user_id'),
            ''
          ) is null
       or v_metadata ->> 'created_via'
            is distinct from 'api_sales_quotes_create'
    then
      raise exception using
        errcode = '22023',
        message = 'ZION_QUOTE_CREATION_PROVENANCE_INVALID';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function
  public.zion_sales_quote_creation_provenance_guard_trg()
from public, anon, authenticated;

drop trigger if exists
  zion_sales_quote_creation_provenance_guard
on public.sales_quotes;

create trigger zion_sales_quote_creation_provenance_guard
before insert or update
on public.sales_quotes
for each row
execute function
  public.zion_sales_quote_creation_provenance_guard_trg();

comment on function
  public.zion_sales_quote_creation_provenance_guard_trg()
is 'ZION Bloco 2: prevent sales_quotes creation provenance mutation; validate privileged human provenance inserts. Historical quotes are not backfilled.';

commit;

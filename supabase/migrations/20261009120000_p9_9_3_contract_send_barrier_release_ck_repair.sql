-- ZION / P9 / 9.3-B - Forward-only repair of the applied foundation CHECK.
-- PostgreSQL CHECK accepts UNKNOWN. The previous release_ck could accept a
-- non-null released_at with NULL release_reason / release_evidence.
-- Do not edit or reapply the already-installed foundation migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare
  v_invalid_rows bigint;
begin
  if to_regclass('public.p9_sales_contract_send_barriers') is null then
    raise exception using errcode='42P01', message='P9_9_3_BARRIER_RELEASE_REPAIR_TABLE_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid='public.p9_sales_contract_send_barriers'::regclass
       and conname='p9_sales_contract_send_barriers_release_ck'
       and contype='c'
  ) then
    raise exception using errcode='P0001', message='P9_9_3_BARRIER_RELEASE_REPAIR_CONSTRAINT_MISSING';
  end if;

  -- Refuse the repair if previously accepted malformed rows exist. Never
  -- silently rewrite an outbound barrier or its reconciliation evidence.
  select count(*) into v_invalid_rows
  from public.p9_sales_contract_send_barriers b
  where not (
    (b.released_at is null and b.release_reason is null and b.release_evidence is null)
    or (
      b.released_at is not null
      and b.release_reason is not null
      and b.release_reason in ('finalized', 'reconciled_no_delivery')
      and b.release_evidence is not null
      and jsonb_typeof(b.release_evidence) = 'object'
      and b.released_at >= b.activated_at
    )
  );

  if v_invalid_rows <> 0 then
    raise exception using errcode='23514', message='P9_9_3_BARRIER_RELEASE_REPAIR_INVALID_EXISTING_ROWS',
      detail='invalid_barrier_count=' || v_invalid_rows::text;
  end if;
end
$preflight$;

alter table public.p9_sales_contract_send_barriers
  drop constraint p9_sales_contract_send_barriers_release_ck,
  add constraint p9_sales_contract_send_barriers_release_ck
  check (
    (released_at is null and release_reason is null and release_evidence is null)
    or (
      released_at is not null
      and release_reason is not null
      and release_reason in ('finalized', 'reconciled_no_delivery')
      and release_evidence is not null
      and jsonb_typeof(release_evidence) = 'object'
      and released_at >= activated_at
    )
  );

do $postconditions$
declare
  v_definition text;
  v_validated boolean;
begin
  select lower(pg_catalog.pg_get_constraintdef(oid)), convalidated
    into v_definition, v_validated
    from pg_catalog.pg_constraint
   where conrelid='public.p9_sales_contract_send_barriers'::regclass
     and conname='p9_sales_contract_send_barriers_release_ck'
     and contype='c';

  if not coalesce(v_validated, false)
     or v_definition is null
     or position('release_reason is not null' in v_definition) = 0
     or position('release_evidence is not null' in v_definition) = 0 then
    raise exception using errcode='P0001', message='P9_9_3_BARRIER_RELEASE_REPAIR_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;

commit;

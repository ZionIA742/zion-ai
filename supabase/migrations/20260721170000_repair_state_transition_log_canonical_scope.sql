-- ZION / Pilar 18 / Bloco 3 / Etapa 1
-- Repara somente o escopo canonico dos registros historicos divergentes
-- de public.state_transition_log.
--
-- Escopo exclusivo:
-- - deriva organization_id e store_id por conversation -> lead -> store;
-- - corrige apenas logs cujo escopo diverge desse caminho canonico;
-- - preserva os valores anteriores em metadata;
-- - nao altera funcoes, triggers, grants, SLA, archive ou regras comerciais;
-- - nao usa UUIDs, quantidades ou casos de teste fixos.

begin;

set local lock_timeout = '5s';

set local statement_timeout = '120s';

set local idle_in_transaction_session_timeout = '120s';

set local search_path = pg_catalog, pg_temp, public, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p18:state-transition-log:canonical-scope-repair:v1',
    0
  )
);

do $preflight$
begin
  if pg_catalog.to_regclass('public.state_transition_log') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.stores') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required canonical scope tables are missing';
  end if;
end;
$preflight$;

-- Mantem o caminho canonico estavel durante o reparo e impede novas escritas
-- concorrentes no log ate o commit.
lock table public.conversations in share mode;

lock table public.leads in share mode;

lock table public.stores in share mode;

lock table public.state_transition_log in share row exclusive mode;

create temp table pg_temp._p18_state_transition_scope_repairs (
  log_id uuid primary key,
  conversation_id uuid not null,
  previous_organization_id uuid null,
  previous_store_id uuid null,
  correct_organization_id uuid not null,
  correct_store_id uuid not null
) on commit drop;

insert into pg_temp._p18_state_transition_scope_repairs (
  log_id,
  conversation_id,
  previous_organization_id,
  previous_store_id,
  correct_organization_id,
  correct_store_id
)
select
  log_row.id,
  log_row.conversation_id,
  log_row.organization_id,
  log_row.store_id,
  lead_row.organization_id,
  lead_row.store_id
from public.state_transition_log log_row
join public.conversations conversation_row
  on conversation_row.id = log_row.conversation_id
join public.leads lead_row
  on lead_row.id = conversation_row.lead_id
join public.stores store_row
  on store_row.id = lead_row.store_id
 and store_row.organization_id = lead_row.organization_id
where log_row.organization_id is distinct from lead_row.organization_id
   or log_row.store_id is distinct from lead_row.store_id;

do $candidate_validation$
declare
  v_candidate_count bigint;
  v_unresolved_mismatch_count bigint;
begin
  select count(*)
  into v_candidate_count
  from pg_temp._p18_state_transition_scope_repairs;

  if v_candidate_count = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: no state_transition_log canonical scope mismatches were found';
  end if;

  select count(*)
  into v_unresolved_mismatch_count
  from public.state_transition_log log_row
  left join public.conversations conversation_row
    on conversation_row.id = log_row.conversation_id
  left join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
  left join public.stores store_row
    on store_row.id = lead_row.store_id
   and store_row.organization_id = lead_row.organization_id
  where (
      lead_row.id is not null
      and (
        log_row.organization_id is distinct from lead_row.organization_id
        or log_row.store_id is distinct from lead_row.store_id
      )
    )
    and (
      conversation_row.id is null
      or lead_row.id is null
      or store_row.id is null
    );

  if v_unresolved_mismatch_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'precondition failed: %s canonical scope mismatch(es) cannot be repaired safely',
        v_unresolved_mismatch_count
      );
  end if;

  if exists (
    select 1
    from pg_temp._p18_state_transition_scope_repairs repair_row
    join public.state_transition_log log_row
      on log_row.id = repair_row.log_id
    where log_row.metadata ? 'canonical_scope_repair'
      and (
        pg_catalog.jsonb_typeof(
          log_row.metadata -> 'canonical_scope_repair'
        ) is distinct from 'object'
        or log_row.metadata
             #>> '{canonical_scope_repair,migration}'
           is distinct from
             '20260721170000_repair_state_transition_log_canonical_scope'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical_scope_repair metadata key is already used by another repair';
  end if;
end;
$candidate_validation$;

do $apply_repair$
declare
  v_expected_count bigint;
  v_updated_count bigint;
  v_repaired_at timestamptz := pg_catalog.clock_timestamp();
begin
  select count(*)
  into v_expected_count
  from pg_temp._p18_state_transition_scope_repairs;

  update public.state_transition_log log_row
  set
    organization_id = repair_row.correct_organization_id,
    store_id = repair_row.correct_store_id,
    metadata = coalesce(log_row.metadata, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'canonical_scope_repair',
        pg_catalog.jsonb_build_object(
          'migration',
            '20260721170000_repair_state_transition_log_canonical_scope',
          'previous_organization_id',
            repair_row.previous_organization_id,
          'previous_store_id',
            repair_row.previous_store_id,
          'corrected_organization_id',
            repair_row.correct_organization_id,
          'corrected_store_id',
            repair_row.correct_store_id,
          'repaired_at',
            v_repaired_at
        )
      )
  from pg_temp._p18_state_transition_scope_repairs repair_row
  where log_row.id = repair_row.log_id;

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> v_expected_count then
    raise exception using
      errcode = 'P0001',
      message = format(
        'repair failed: expected %s updated row(s), updated %s',
        v_expected_count,
        v_updated_count
      );
  end if;
end;
$apply_repair$;

do $postconditions$
declare
  v_remaining_mismatch_count bigint;
begin
  select count(*)
  into v_remaining_mismatch_count
  from public.state_transition_log log_row
  join public.conversations conversation_row
    on conversation_row.id = log_row.conversation_id
  join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
  join public.stores store_row
    on store_row.id = lead_row.store_id
   and store_row.organization_id = lead_row.organization_id
  where log_row.organization_id is distinct from lead_row.organization_id
     or log_row.store_id is distinct from lead_row.store_id;

  if v_remaining_mismatch_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'postcondition failed: %s state_transition_log canonical scope mismatch(es) remain',
        v_remaining_mismatch_count
      );
  end if;

  if exists (
    select 1
    from pg_temp._p18_state_transition_scope_repairs repair_row
    join public.state_transition_log log_row
      on log_row.id = repair_row.log_id
    where log_row.organization_id
            is distinct from repair_row.correct_organization_id
       or log_row.store_id
            is distinct from repair_row.correct_store_id
       or log_row.metadata
            #>> '{canonical_scope_repair,migration}'
          is distinct from
            '20260721170000_repair_state_transition_log_canonical_scope'
       or log_row.metadata
            #>> '{canonical_scope_repair,previous_organization_id}'
          is distinct from repair_row.previous_organization_id::text
       or log_row.metadata
            #>> '{canonical_scope_repair,corrected_organization_id}'
          is distinct from repair_row.correct_organization_id::text
       or log_row.metadata
            #>> '{canonical_scope_repair,corrected_store_id}'
          is distinct from repair_row.correct_store_id::text
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: repaired state_transition_log audit metadata is incomplete';
  end if;
end;
$postconditions$;

commit;

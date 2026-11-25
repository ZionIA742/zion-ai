-- ZION / Pilar 18 / Bloco 3 / Etapa 6
-- Corrige e protege a autoria dos registros de state_transition_log.
--
-- Regras aplicadas:
-- - actor_type = human exige actor_user_id;
-- - actor_type = ai ou system exige actor_user_id nulo;
-- - actor_user_id referencia auth.users(id) com ON DELETE RESTRICT;
-- - os 3 registros historicos de teste sem autoria identificavel
--   sao reclassificados de human para system, preservando auditoria.
--
-- Fora do escopo:
-- - nao altera funcoes escritoras;
-- - nao altera SLA, archive, estados comerciais ou permissoes de acesso.

begin;

set local lock_timeout = '5s';

set local statement_timeout = '120s';

set local idle_in_transaction_session_timeout = '120s';

set local search_path = pg_catalog, pg_temp;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p18:state-transition-log:actor-integrity:v1',
    0
  )
);

lock table public.state_transition_log
  in share row exclusive mode;

lock table auth.users
  in share mode;

do $preflight$
declare
  v_invalid_human_count bigint;
  v_known_test_count bigint;
  v_invalid_nonhuman_count bigint;
begin
  if pg_catalog.to_regclass('public.state_transition_log') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.state_transition_log is missing';
  end if;

  if pg_catalog.to_regclass('auth.users') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: auth.users is missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.state_transition_log'::pg_catalog.regclass
      and constraint_row.conname =
          'state_transition_log_actor_user_id_fkey'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: actor_user_id foreign key already exists';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.state_transition_log'::pg_catalog.regclass
      and constraint_row.conname =
          'state_transition_log_actor_identity_check'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: actor identity check already exists';
  end if;

  select pg_catalog.count(*)
  into v_invalid_human_count
  from public.state_transition_log log_row
  where log_row.actor_type = 'human'
    and log_row.actor_user_id is null;

  select pg_catalog.count(*)
  into v_known_test_count
  from public.state_transition_log log_row
  where log_row.actor_type = 'human'
    and log_row.actor_user_id is null
    and (
      log_row.metadata ->> 'source' = 'sql_editor'
      or log_row.metadata ->> 'note' =
         'was_manual_status_change_test'
    );

  select pg_catalog.count(*)
  into v_invalid_nonhuman_count
  from public.state_transition_log log_row
  where log_row.actor_type in ('ai', 'system')
    and log_row.actor_user_id is not null;

  if v_invalid_human_count <> 3
     or v_known_test_count <> 3 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'precondition failed: expected exactly 3 known historical human test logs without actor_user_id; invalid_human=%s, known_tests=%s',
        v_invalid_human_count,
        v_known_test_count
      );
  end if;

  if v_invalid_nonhuman_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'precondition failed: found %s ai/system logs with actor_user_id',
        v_invalid_nonhuman_count
      );
  end if;
end;
$preflight$;

update public.state_transition_log log_row
set
  actor_type = 'system',
  actor_user_id = null,
  metadata =
    coalesce(log_row.metadata, '{}'::jsonb)
    || pg_catalog.jsonb_build_object(
      'actor_integrity_repair',
      pg_catalog.jsonb_build_object(
        'migration',
        '20260721191000_enforce_state_transition_log_actor_integrity',
        'previous_actor_type',
        'human',
        'reason',
        'historical_sql_editor_test_without_identifiable_user'
      )
    )
where log_row.actor_type = 'human'
  and log_row.actor_user_id is null
  and (
    log_row.metadata ->> 'source' = 'sql_editor'
    or log_row.metadata ->> 'note' =
       'was_manual_status_change_test'
  );

alter table public.state_transition_log
  add constraint state_transition_log_actor_user_id_fkey
  foreign key (actor_user_id)
  references auth.users(id)
  on delete restrict
  not valid;

alter table public.state_transition_log
  validate constraint state_transition_log_actor_user_id_fkey;

alter table public.state_transition_log
  add constraint state_transition_log_actor_identity_check
  check (
    (
      actor_type = 'human'
      and actor_user_id is not null
    )
    or
    (
      actor_type in ('ai', 'system')
      and actor_user_id is null
    )
  )
  not valid;

alter table public.state_transition_log
  validate constraint state_transition_log_actor_identity_check;

comment on constraint state_transition_log_actor_user_id_fkey
  on public.state_transition_log is
  'Preserva autoria humana historica; usuarios referenciados nao podem ser excluidos fisicamente.';

comment on constraint state_transition_log_actor_identity_check
  on public.state_transition_log is
  'Human exige actor_user_id; ai e system nao podem usar actor_user_id.';

do $postconditions$
declare
  v_repaired_count bigint;
  v_invalid_actor_count bigint;
begin
  select pg_catalog.count(*)
  into v_repaired_count
  from public.state_transition_log log_row
  where log_row.metadata
        #>> '{actor_integrity_repair,migration}'
        =
        '20260721191000_enforce_state_transition_log_actor_integrity'
    and log_row.actor_type = 'system'
    and log_row.actor_user_id is null;

  if v_repaired_count <> 3 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'postcondition failed: expected 3 repaired historical logs, found %s',
        v_repaired_count
      );
  end if;

  select pg_catalog.count(*)
  into v_invalid_actor_count
  from public.state_transition_log log_row
  where (
    log_row.actor_type = 'human'
    and log_row.actor_user_id is null
  )
  or (
    log_row.actor_type in ('ai', 'system')
    and log_row.actor_user_id is not null
  );

  if v_invalid_actor_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'postcondition failed: %s actor identity violations remain',
        v_invalid_actor_count
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.state_transition_log'::pg_catalog.regclass
      and constraint_row.conname =
          'state_transition_log_actor_user_id_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.convalidated
      and constraint_row.confrelid =
          'auth.users'::pg_catalog.regclass
      and constraint_row.confdeltype = 'r'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: actor_user_id FK is missing, unvalidated, or not ON DELETE RESTRICT';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.state_transition_log'::pg_catalog.regclass
      and constraint_row.conname =
          'state_transition_log_actor_identity_check'
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: actor identity check is missing or unvalidated';
  end if;
end;
$postconditions$;

commit;

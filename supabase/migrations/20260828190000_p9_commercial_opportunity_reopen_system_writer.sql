begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    '20260828190000_p9_commercial_opportunity_reopen_system_writer',
    0
  )
);

do $preflight$
declare
  v_actor_constraint text;
begin
  if pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_lifecycle_events') is null
     or pg_catalog.to_regclass('public.memberships') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial opportunity lifecycle foundation is missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.compute_commercial_opportunity_event_fingerprint_internal(uuid,uuid,uuid,integer,text,text,text,text,uuid,text,text,text,text,uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.normalize_commercial_opportunity_stage(text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical lifecycle reopen prerequisites are missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.apply_commercial_opportunity_reopen_internal(uuid,uuid,uuid,text,text,text,text,text,uuid)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.reopen_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,text)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial opportunity system reopen writer already exists';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'reopen_commercial_opportunity_by_user'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: unexpected overloads for reopen_commercial_opportunity_by_user';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
  into v_actor_constraint
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
        'public.commercial_opportunity_lifecycle_events'::pg_catalog.regclass
    and constraint_row.conname =
        'commercial_opportunity_lifecycle_events_actor_type_check';

  if v_actor_constraint is null
     or pg_catalog.strpos(pg_catalog.lower(v_actor_constraint), '''system''') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: lifecycle actor contract does not permit system events';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class index_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = index_row.relnamespace
    where namespace_row.nspname = 'public'
      and index_row.relname =
          'commercial_opportunity_lifecycle_events_idempotency_uidx'
  ) or not exists (
    select 1
    from pg_catalog.pg_class index_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = index_row.relnamespace
    where namespace_row.nspname = 'public'
      and index_row.relname =
          'commercial_opportunity_lifecycle_events_operational_slot_uidx'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: lifecycle idempotency indexes are missing';
  end if;
end;
$preflight$;

-- --------------------------------------------------------------------------
-- Internal canonical core.
--
-- This is the single implementation of a general loss reopen. It preserves
-- the pre-existing lifecycle event/idempotency contract and varies only the
-- actor identity supplied by the controlled wrapper.
-- --------------------------------------------------------------------------
create or replace function public.apply_commercial_opportunity_reopen_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_target_stage text,
  p_reason_details text,
  p_source text,
  p_actor_type text,
  p_actor_user_id uuid
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  current_loss_event_id uuid,
  last_reopened_at timestamptz
)
language plpgsql
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_target_stage text;
  v_reason_details text := nullif(pg_catalog.btrim(coalesce(p_reason_details, '')), '');
  v_source text := nullif(pg_catalog.btrim(coalesce(p_source, '')), '');
  v_idempotency_key text := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
  v_actor_type text := nullif(pg_catalog.btrim(coalesce(p_actor_type, '')), '');
  v_opportunity public.commercial_opportunities;
  v_reopen_event public.commercial_opportunity_lifecycle_events;
  v_existing_event public.commercial_opportunity_lifecycle_events;
  v_existing_slot_event public.commercial_opportunity_lifecycle_events;
  v_event_key text;
  v_stored_event_key text;
  v_candidate_event_key text;
  v_constraint_name text;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or v_source is null
     or v_reason_details is null
     or v_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'commercial opportunity reopen requires scope, reason_details, idempotency_key and source';
  end if;

  if v_actor_type not in ('human', 'system')
     or (v_actor_type = 'human' and p_actor_user_id is null)
     or (v_actor_type = 'system' and p_actor_user_id is not null) then
    raise exception using
      errcode = '22023',
      message = 'ZION_REOPEN_ACTOR_INVALID';
  end if;

  v_target_stage := public.normalize_commercial_opportunity_stage(p_target_stage);

  if v_target_stage not in (
       'novo_lead',
       'qualificacao',
       'orcamento',
       'visita_tecnica',
       'negociacao',
       'fechamento_pagamento',
       'instalacao_entrega',
       'pos_venda'
     ) then
    raise exception using
      errcode = '22023',
      message = 'ZION_REOPEN_TARGET_STAGE_INVALID';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity not found';
  end if;

  if v_opportunity.organization_id is distinct from p_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity scope mismatch';
  end if;

  select lifecycle_event.*
  into v_existing_event
  from public.commercial_opportunity_lifecycle_events lifecycle_event
  where lifecycle_event.organization_id = v_opportunity.organization_id
    and lifecycle_event.store_id = v_opportunity.store_id
    and lifecycle_event.commercial_opportunity_id = v_opportunity.id
    and lifecycle_event.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    if v_existing_event.event_type <> 'reopened' then
      raise exception using
        errcode = '23505',
        message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    v_stored_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
      v_existing_event.organization_id,
      v_existing_event.store_id,
      v_existing_event.commercial_opportunity_id,
      v_existing_event.lifecycle_cycle,
      v_existing_event.event_type,
      v_existing_event.previous_stage,
      v_existing_event.new_stage,
      v_existing_event.actor_type,
      v_existing_event.actor_user_id,
      v_existing_event.reason_code,
      v_existing_event.reason_details,
      v_existing_event.source,
      v_existing_event.evidence_type,
      v_existing_event.evidence_message_id,
      v_existing_event.evidence_summary
    );

    if v_existing_event.event_key is distinct from v_stored_event_key then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_STORED_EVENT_FINGERPRINT_MISMATCH';
    end if;

    v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_existing_event.lifecycle_cycle,
      'reopened',
      'perdido',
      v_target_stage,
      v_actor_type,
      p_actor_user_id,
      null,
      v_reason_details,
      v_source,
      null,
      null,
      null
    );

    if v_candidate_event_key is distinct from v_existing_event.event_key then
      raise exception using
        errcode = '23505',
        message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    return query
    select
      v_existing_event.commercial_opportunity_id,
      v_existing_event.new_stage,
      v_existing_event.lifecycle_cycle + 1,
      null::uuid,
      v_existing_event.created_at;
    return;
  end if;

  if v_opportunity.stage <> 'perdido' then
    raise exception using
      errcode = '23514',
      message = 'ZION_REOPEN_REQUIRES_LOST_STAGE';
  end if;

  v_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    v_opportunity.lifecycle_cycle,
    'reopened',
    'perdido',
    v_target_stage,
    v_actor_type,
    p_actor_user_id,
    null,
    v_reason_details,
    v_source,
    null,
    null,
    null
  );

  begin
    insert into public.commercial_opportunity_lifecycle_events (
      organization_id,
      store_id,
      commercial_opportunity_id,
      customer_id,
      lifecycle_cycle,
      event_type,
      previous_stage,
      new_stage,
      reason_code,
      reason_details,
      evidence_type,
      evidence_message_id,
      evidence_summary,
      actor_type,
      actor_user_id,
      source,
      metadata,
      idempotency_key,
      event_key
    )
    values (
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_opportunity.customer_id,
      v_opportunity.lifecycle_cycle,
      'reopened',
      'perdido',
      v_target_stage,
      null,
      v_reason_details,
      null,
      null,
      null,
      v_actor_type,
      p_actor_user_id,
      v_source,
      pg_catalog.jsonb_build_object(
        'internal_operation', true,
        'reopen_actor_type', v_actor_type
      ),
      v_idempotency_key,
      v_event_key
    )
    returning *
    into v_reopen_event;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;

      if v_constraint_name = 'commercial_opportunity_lifecycle_events_idempotency_uidx'
         or v_constraint_name = 'commercial_opportunity_lifecycle_events_operational_slot_uidx' then
        select lifecycle_event.*
        into v_existing_event
        from public.commercial_opportunity_lifecycle_events lifecycle_event
        where lifecycle_event.organization_id = v_opportunity.organization_id
          and lifecycle_event.store_id = v_opportunity.store_id
          and lifecycle_event.commercial_opportunity_id = v_opportunity.id
          and lifecycle_event.idempotency_key = v_idempotency_key
        limit 1;

        if found then
          if v_existing_event.event_type <> 'reopened' then
            raise exception using
              errcode = '23505',
              message = 'ZION_IDEMPOTENCY_KEY_REUSED';
          end if;

          v_stored_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
            v_existing_event.organization_id,
            v_existing_event.store_id,
            v_existing_event.commercial_opportunity_id,
            v_existing_event.lifecycle_cycle,
            v_existing_event.event_type,
            v_existing_event.previous_stage,
            v_existing_event.new_stage,
            v_existing_event.actor_type,
            v_existing_event.actor_user_id,
            v_existing_event.reason_code,
            v_existing_event.reason_details,
            v_existing_event.source,
            v_existing_event.evidence_type,
            v_existing_event.evidence_message_id,
            v_existing_event.evidence_summary
          );

          if v_existing_event.event_key is distinct from v_stored_event_key then
            raise exception using
              errcode = 'P0001',
              message = 'ZION_STORED_EVENT_FINGERPRINT_MISMATCH';
          end if;

          v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
            v_opportunity.organization_id,
            v_opportunity.store_id,
            v_opportunity.id,
            v_existing_event.lifecycle_cycle,
            'reopened',
            'perdido',
            v_target_stage,
            v_actor_type,
            p_actor_user_id,
            null,
            v_reason_details,
            v_source,
            null,
            null,
            null
          );

          if v_candidate_event_key is distinct from v_existing_event.event_key then
            raise exception using
              errcode = '23505',
              message = 'ZION_IDEMPOTENCY_KEY_REUSED';
          end if;

          return query
          select
            v_existing_event.commercial_opportunity_id,
            v_existing_event.new_stage,
            v_existing_event.lifecycle_cycle + 1,
            null::uuid,
            v_existing_event.created_at;
          return;
        end if;

        if v_constraint_name = 'commercial_opportunity_lifecycle_events_operational_slot_uidx' then
          select lifecycle_event.*
          into v_existing_slot_event
          from public.commercial_opportunity_lifecycle_events lifecycle_event
          where lifecycle_event.organization_id = v_opportunity.organization_id
            and lifecycle_event.store_id = v_opportunity.store_id
            and lifecycle_event.commercial_opportunity_id = v_opportunity.id
            and lifecycle_event.lifecycle_cycle = v_opportunity.lifecycle_cycle
            and lifecycle_event.event_type = 'reopened'
          limit 1;

          if found then
            raise exception using
              errcode = '23505',
              message = 'ZION_OPERATIONAL_SLOT_ALREADY_CONSUMED';
          end if;
        end if;
      end if;

      raise;
  end;

  update public.commercial_opportunities opportunity_row
  set
    lifecycle_cycle = opportunity_row.lifecycle_cycle + 1,
    stage = v_target_stage,
    lost_at = null,
    lost_reason_code = null,
    lost_reason_details = null,
    current_loss_event_id = null,
    last_reopened_at = v_reopen_event.created_at
  where opportunity_row.id = v_opportunity.id;

  return query
  select
    opportunity_row.id,
    opportunity_row.stage,
    opportunity_row.lifecycle_cycle,
    opportunity_row.current_loss_event_id,
    opportunity_row.last_reopened_at
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_opportunity.id;
end;
$function$;

alter function public.apply_commercial_opportunity_reopen_internal(
  uuid, uuid, uuid, text, text, text, text, text, uuid
) owner to postgres;

revoke all on function public.apply_commercial_opportunity_reopen_internal(
  uuid, uuid, uuid, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;

comment on function public.apply_commercial_opportunity_reopen_internal(
  uuid, uuid, uuid, text, text, text, text, text, uuid
) is
  'Core interno canonico para reabrir opportunity perdida. Preserva idempotencia/lifecycle e recebe ator explicitamente; nao e executavel por clientes.';

-- --------------------------------------------------------------------------
-- Existing human RPC preserved, now delegating to the single internal core.
-- --------------------------------------------------------------------------
create or replace function public.reopen_commercial_opportunity_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_target_stage text,
  p_reason_details text,
  p_source text
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  current_loss_event_id uuid,
  last_reopened_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity reopen by user is not authorized';
  end if;

  if p_request_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'commercial opportunity reopen by user requires scope, reason_details, idempotency_key and source';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity reopen by user is not authorized';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_reopen_internal(
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_idempotency_key,
    p_target_stage,
    p_reason_details,
    p_source,
    'human',
    v_user_id
  );
end;
$function$;

alter function public.reopen_commercial_opportunity_by_user(
  uuid, uuid, uuid, text, text, text, text
) owner to postgres;

revoke all on function public.reopen_commercial_opportunity_by_user(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.reopen_commercial_opportunity_by_user(
  uuid, uuid, uuid, text, text, text, text
) to authenticated;

-- --------------------------------------------------------------------------
-- New system-only RPC used by canonical automation/orchestration.
-- --------------------------------------------------------------------------
create or replace function public.reopen_commercial_opportunity_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_target_stage text,
  p_reason_details text,
  p_source text default 'system_reopen'
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  current_loss_event_id uuid,
  last_reopened_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := pg_catalog.coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
begin
  if v_request_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity reopen by system is not authorized';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_reopen_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_idempotency_key,
    p_target_stage,
    p_reason_details,
    p_source,
    'system',
    null
  );
end;
$function$;

alter function public.reopen_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, text
) owner to postgres;

revoke all on function public.reopen_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.reopen_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, text
) to service_role;

comment on function public.reopen_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, text
) is
  'Writer canonico service_role-only para reabrir opportunity perdida quando uma regra de sistema provou a mesma intencao.';

do $postconditions$
declare
  v_core_oid oid;
  v_user_oid oid;
  v_system_oid oid;
  v_core_def text;
  v_user_def text;
  v_system_def text;
begin
  v_core_oid := pg_catalog.to_regprocedure(
    'public.apply_commercial_opportunity_reopen_internal(uuid,uuid,uuid,text,text,text,text,text,uuid)'
  );
  v_user_oid := pg_catalog.to_regprocedure(
    'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)'
  );
  v_system_oid := pg_catalog.to_regprocedure(
    'public.reopen_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,text)'
  );

  if v_core_oid is null or v_user_oid is null or v_system_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: one or more reopen writer functions are missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid in (v_core_oid, v_user_oid, v_system_oid)
      and pg_catalog.pg_get_userbyid(proc_row.proowner) <> 'postgres'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: reopen writer owner mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_user_oid
      and proc_row.prosecdef
      and proc_row.proconfig @> array[
        'search_path=pg_catalog, pg_temp, public',
        'row_security=off'
      ]::text[]
  ) or not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_system_oid
      and proc_row.prosecdef
      and proc_row.proconfig @> array[
        'search_path=pg_catalog, pg_temp, public',
        'row_security=off'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: reopen wrappers are not hardened security definer functions';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       v_core_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       v_core_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       v_core_oid,
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal reopen core is externally executable';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated',
       v_user_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       v_user_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       v_user_oid,
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: human reopen writer grants mismatch';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       v_system_oid,
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       v_system_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       v_system_oid,
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: system reopen writer grants mismatch';
  end if;

  select pg_catalog.pg_get_functiondef(v_core_oid) into v_core_def;
  select pg_catalog.pg_get_functiondef(v_user_oid) into v_user_def;
  select pg_catalog.pg_get_functiondef(v_system_oid) into v_system_def;

  if pg_catalog.strpos(pg_catalog.lower(v_core_def), 'for update') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_core_def), '''reopened''') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_core_def), 'zion_idempotency_key_reused') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_core_def), 'zion_operational_slot_already_consumed') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_core_def), 'lifecycle_cycle = opportunity_row.lifecycle_cycle + 1') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal reopen core lost a critical lifecycle invariant';
  end if;

  if pg_catalog.strpos(
       v_user_def,
       'apply_commercial_opportunity_reopen_internal'
     ) = 0
     or pg_catalog.strpos(
       v_system_def,
       'apply_commercial_opportunity_reopen_internal'
     ) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: reopen wrappers do not delegate to the common core';
  end if;

  if pg_catalog.strpos(v_system_def, 'request.jwt.claim.role') = 0
     or pg_catalog.strpos(v_system_def, 'auth.jwt()') = 0
     or pg_catalog.strpos(v_system_def, '''service_role''') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: system reopen authorization contract is incomplete';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.commercial_opportunity_lifecycle_events'::pg_catalog.regclass
      and constraint_row.conname =
          'commercial_opportunity_lifecycle_events_reopened_shape_check'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.commercial_opportunity_lifecycle_events'::pg_catalog.regclass
      and constraint_row.conname =
          'commercial_opportunity_lifecycle_events_actor_type_check'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: lifecycle reopen/actor constraints changed unexpectedly';
  end if;
end;
$postconditions$;

commit;

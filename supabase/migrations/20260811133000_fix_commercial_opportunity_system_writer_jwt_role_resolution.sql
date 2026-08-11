do $preflight$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
    'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
    'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception using
        errcode = 'P0001',
        message = 'precondition failed: required function is missing: ' || v_signature;
    end if;
  end loop;
end;
$preflight$;

create or replace function public.transition_commercial_opportunity_stage_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_target_stage text,
  p_reason_details text default null,
  p_evidence_type text default null,
  p_evidence_message_id uuid default null,
  p_evidence_summary text default null,
  p_source text default 'system_stage_transition'
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text :=
    coalesce(
      nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
      nullif(auth.jwt() ->> 'role', '')
    );
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity stage transition by system is not authorized';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_idempotency_key,
    p_target_stage,
    p_reason_details,
    p_evidence_type,
    p_evidence_message_id,
    p_evidence_summary,
    p_source,
    'stage_transition',
    'system',
    null
  );
end;
$function$;

create or replace function public.conclude_commercial_opportunity_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_reason_details text default null,
  p_evidence_type text default null,
  p_evidence_message_id uuid default null,
  p_evidence_summary text default null,
  p_source text default 'system_conclusion'
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text :=
    coalesce(
      nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
      nullif(auth.jwt() ->> 'role', '')
    );
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity conclusion by system is not authorized';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_idempotency_key,
    'concluido_sem_mais_acoes',
    p_reason_details,
    p_evidence_type,
    p_evidence_message_id,
    p_evidence_summary,
    p_source,
    'conclusion',
    'system',
    null
  );
end;
$function$;

create or replace function public.reopen_commercial_opportunity_for_post_sale_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_reason_details text default null,
  p_evidence_type text default null,
  p_evidence_message_id uuid default null,
  p_evidence_summary text default null,
  p_source text default 'system_post_sale_reopen'
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text :=
    coalesce(
      nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
      nullif(auth.jwt() ->> 'role', '')
    );
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity post-sale reopen by system is not authorized';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_idempotency_key,
    'pos_venda',
    p_reason_details,
    p_evidence_type,
    p_evidence_message_id,
    p_evidence_summary,
    p_source,
    'post_sale_reopen',
    'system',
    null
  );
end;
$function$;

alter function public.transition_commercial_opportunity_stage_by_system(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) owner to postgres;
alter function public.conclude_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) owner to postgres;
alter function public.reopen_commercial_opportunity_for_post_sale_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) owner to postgres;

comment on function public.transition_commercial_opportunity_stage_by_system(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) is
  'Writer canonico de sistema para transicoes normais entre estagios comerciais, sempre mediado pela matriz 2.2.';
comment on function public.conclude_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) is
  'Writer canonico de sistema para concluir oportunidade comercial em concluido_sem_mais_acoes com auditoria append-only.';
comment on function public.reopen_commercial_opportunity_for_post_sale_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) is
  'Writer canonico de sistema para reabrir oportunidade concluida exclusivamente em pos_venda.';

revoke all on function public.transition_commercial_opportunity_stage_by_system(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.conclude_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.reopen_commercial_opportunity_for_post_sale_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.transition_commercial_opportunity_stage_by_system(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) to service_role;
grant execute on function public.conclude_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) to service_role;
grant execute on function public.reopen_commercial_opportunity_for_post_sale_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) to service_role;

do $postconditions$
declare
  v_signature text;
  v_proc_oid oid;
  v_definition text;
  v_normalized_definition text;
begin
  foreach v_signature in array array[
    'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
    'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
    'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'
  ] loop
    v_proc_oid := pg_catalog.to_regprocedure(v_signature);

    if v_proc_oid is null then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: required function missing after jwt fallback fix: ' || v_signature;
    end if;

    select pg_catalog.pg_get_functiondef(v_proc_oid)
    into v_definition;

    v_normalized_definition := pg_catalog.regexp_replace(
      coalesce(v_definition, ''),
      '\s+',
      ' ',
      'g'
    );

    if position('current_setting(''request.jwt.claim.role'', true)' in v_normalized_definition) = 0
       or position('auth.jwt() ->> ''role''' in v_normalized_definition) = 0
       or position('service_role' in v_normalized_definition) = 0
       or position('session_user <> ''postgres''' in v_normalized_definition) = 0 then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: jwt fallback authorization markers missing: ' || v_signature;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = v_proc_oid
        and (
          proc_row.prosecdef is not true
          or proc_row.proconfig is null
          or not proc_row.proconfig @> array[
            'search_path=pg_catalog, pg_temp, public',
            'row_security=off'
          ]::text[]
        )
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: hardened security definer contract changed: ' || v_signature;
    end if;
  end loop;

  if has_function_privilege(
       'authenticated',
       'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: transition_commercial_opportunity_stage_by_system grants mismatch';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: conclude_commercial_opportunity_by_system grants mismatch';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: reopen_commercial_opportunity_for_post_sale_by_system grants mismatch';
  end if;
end;
$postconditions$;

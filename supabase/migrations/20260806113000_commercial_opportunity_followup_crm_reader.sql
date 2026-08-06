begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b2:e2.1-c2:commercial-opportunity-followup-crm-reader:v1',
    0
  )
);

do $preflight$
declare
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.panel_list_crm_opportunity_cards_scoped(uuid,uuid,integer,integer)'
  );
  v_expected_body_md5 text := '0c6615d3ee748aaacc382a6cbd982f91';
  v_pronargs integer;
  v_pronargdefaults integer;
  v_arg_names text[];
  v_arg_type_oids oid[];
  v_defaults_expr text;
  v_out_arg_names text[];
  v_out_arg_types text[];
  v_owner text;
  v_prosecdef boolean;
  v_proconfig text[];
  v_prosrc text;
  v_prosrc_md5 text;
  v_prolang text;
  v_provolatile "char";
  v_proparallel "char";
  v_prokind "char";
  v_proretset boolean;
  v_authenticated_has_execute boolean := false;
  v_service_role_has_execute boolean := false;
  v_anon_has_execute boolean := false;
  v_public_has_execute boolean := false;
  v_has_unexpected_execute_grantee boolean := false;
  v_dependency_summary text;
begin
  if v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical crm cards rpc is missing';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunity_followups') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_followup_events') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial opportunity followup foundation tables are missing';
  end if;

  select
    proc_row.pronargs,
    proc_row.pronargdefaults,
    proc_row.proargnames[1:4],
    string_to_array(proc_row.proargtypes::text, ' ')::oid[],
    pg_catalog.pg_get_expr(proc_row.proargdefaults, 0::oid),
    role_row.rolname,
    proc_row.prosecdef,
    proc_row.proconfig,
    proc_row.prosrc,
    language_row.lanname,
    proc_row.provolatile,
    proc_row.proparallel,
    proc_row.prokind,
    proc_row.proretset
  into
    v_pronargs,
    v_pronargdefaults,
    v_arg_names,
    v_arg_type_oids,
    v_defaults_expr,
    v_owner,
    v_prosecdef,
    v_proconfig,
    v_prosrc,
    v_prolang,
    v_provolatile,
    v_proparallel,
    v_prokind,
    v_proretset
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_language language_row
    on language_row.oid = proc_row.prolang
  join pg_catalog.pg_roles role_row
    on role_row.oid = proc_row.proowner
  where proc_row.oid = v_function_oid;

  select
    array_agg(arg_row.arg_name order by arg_row.ordinality),
    array_agg(arg_row.arg_type order by arg_row.ordinality)
  into
    v_out_arg_names,
    v_out_arg_types
  from pg_catalog.pg_proc proc_row
  cross join lateral (
    select
      arg_names.arg_name,
      pg_catalog.format_type(arg_types.arg_type_oid, null) as arg_type,
      arg_types.ordinality
    from unnest(proc_row.proallargtypes) with ordinality as arg_types(arg_type_oid, ordinality)
    join unnest(proc_row.proargmodes) with ordinality as arg_modes(arg_mode, ordinality)
      on arg_modes.ordinality = arg_types.ordinality
    join unnest(proc_row.proargnames) with ordinality as arg_names(arg_name, ordinality)
      on arg_names.ordinality = arg_types.ordinality
    where arg_modes.arg_mode = 't'
  ) arg_row
  where proc_row.oid = v_function_oid;

  if v_pronargs <> 4
     or v_pronargdefaults <> 3
     or v_arg_names <> array[
       'p_organization_id',
       'p_store_id',
       'p_limit',
       'p_offset'
     ]
     or v_arg_type_oids <> array[
       'uuid'::pg_catalog.regtype::oid,
       'uuid'::pg_catalog.regtype::oid,
       'integer'::pg_catalog.regtype::oid,
       'integer'::pg_catalog.regtype::oid
     ]
     or v_defaults_expr !~ '^NULL::uuid, 500, 0$' then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical crm cards rpc input signature diverged';
  end if;

  if v_out_arg_names = array[
       'commercial_opportunity_id',
       'organization_id',
       'store_id',
       'customer_id',
       'lead_id',
       'conversation_id',
       'name',
       'phone',
       'effective_state',
       'opportunity_stage',
       'lead_state',
       'conversation_status',
       'is_human_active',
       'stage_changed_at',
       'lifecycle_cycle',
       'created_at',
       'updated_at',
       'is_follow_up_active'
     ]
     and v_out_arg_types = array[
       'uuid',
       'uuid',
       'uuid',
       'uuid',
       'uuid',
       'uuid',
       'text',
       'text',
       'text',
       'text',
       'text',
       'text',
       'boolean',
       'timestamp with time zone',
       'integer',
       'timestamp with time zone',
       'timestamp with time zone',
       'boolean'
     ] then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical crm cards rpc already includes is_follow_up_active';
  end if;

  if v_out_arg_names <> array[
       'commercial_opportunity_id',
       'organization_id',
       'store_id',
       'customer_id',
       'lead_id',
       'conversation_id',
       'name',
       'phone',
       'effective_state',
       'opportunity_stage',
       'lead_state',
       'conversation_status',
       'is_human_active',
       'stage_changed_at',
       'lifecycle_cycle',
       'created_at',
       'updated_at'
     ]
     or v_out_arg_types <> array[
       'uuid',
       'uuid',
       'uuid',
       'uuid',
       'uuid',
       'uuid',
       'text',
       'text',
       'text',
       'text',
       'text',
       'text',
       'boolean',
       'timestamp with time zone',
       'integer',
       'timestamp with time zone',
       'timestamp with time zone'
     ] then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical crm cards rpc output contract diverged';
  end if;

  if v_owner <> 'postgres'
     or not v_prosecdef
     or v_prolang <> 'plpgsql'
     or v_provolatile <> 'v'
     or v_proparallel <> 'u'
     or v_prokind <> 'f'
     or not v_proretset
     or v_proconfig is distinct from array[
       'search_path=pg_catalog, pg_temp, public',
       'row_security=off'
     ] then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical crm cards rpc execution contract diverged';
  end if;

  v_prosrc_md5 := pg_catalog.md5(
    pg_catalog.btrim(
      replace(v_prosrc, E'\r\n', E'\n'),
      E'\r\n'
    )
  );

  if v_prosrc_md5 <> v_expected_body_md5 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical crm cards rpc body diverged from the approved baseline',
      detail = 'expected md5=' || v_expected_body_md5 || ', actual md5=' || v_prosrc_md5;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_depend dependency_row
    where dependency_row.classid = 'pg_proc'::pg_catalog.regclass
      and dependency_row.objid = v_function_oid
      and dependency_row.deptype = 'e'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical crm cards rpc belongs to an extension and cannot be replaced safely';
  end if;

  select
    coalesce(
      bool_or(
        role_row.rolname = 'authenticated'
        and acl_row.privilege_type = 'EXECUTE'
      ),
      false
    ),
    coalesce(
      bool_or(
        role_row.rolname = 'service_role'
        and acl_row.privilege_type = 'EXECUTE'
      ),
      false
    ),
    coalesce(
      bool_or(
        role_row.rolname = 'anon'
        and acl_row.privilege_type = 'EXECUTE'
      ),
      false
    ),
    coalesce(
      bool_or(
        acl_row.grantee = 0
        and acl_row.privilege_type = 'EXECUTE'
      ),
      false
    ),
    coalesce(
      bool_or(
        acl_row.privilege_type = 'EXECUTE'
        and acl_row.grantee <> 0
        and coalesce(role_row.rolname, '') not in (
          'postgres',
          'authenticated',
          'service_role'
        )
      ),
      false
    )
  into
    v_authenticated_has_execute,
    v_service_role_has_execute,
    v_anon_has_execute,
    v_public_has_execute,
    v_has_unexpected_execute_grantee
  from pg_catalog.pg_proc proc_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      proc_row.proacl,
      pg_catalog.acldefault('f', proc_row.proowner)
    )
  ) acl_row
  left join pg_catalog.pg_roles role_row
    on role_row.oid = acl_row.grantee
  where proc_row.oid = v_function_oid;

  if not v_authenticated_has_execute
     or not v_service_role_has_execute
     or v_anon_has_execute
     or v_public_has_execute
     or v_has_unexpected_execute_grantee then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical crm cards rpc acl diverged before replacement';
  end if;

  select string_agg(
           pg_catalog.pg_describe_object(
             dependency_row.classid,
             dependency_row.objid,
             dependency_row.objsubid
           ),
           '; '
           order by
             pg_catalog.pg_describe_object(
               dependency_row.classid,
               dependency_row.objid,
               dependency_row.objsubid
             )
         )
  into v_dependency_summary
  from pg_catalog.pg_depend dependency_row
  where dependency_row.refclassid = 'pg_proc'::pg_catalog.regclass
    and dependency_row.refobjid = v_function_oid
    and dependency_row.deptype in ('n', 'a')
    and not (
      dependency_row.classid = 'pg_proc'::pg_catalog.regclass
      and dependency_row.objid = v_function_oid
    );

  if v_dependency_summary is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical crm cards rpc has unexpected database dependencies before replacement',
      detail = v_dependency_summary;
  end if;
end;
$preflight$;

drop function public.panel_list_crm_opportunity_cards_scoped(uuid, uuid, integer, integer);

create function public.panel_list_crm_opportunity_cards_scoped(
  p_organization_id uuid,
  p_store_id uuid default null,
  p_limit integer default 500,
  p_offset integer default 0
)
returns table (
  commercial_opportunity_id uuid,
  organization_id uuid,
  store_id uuid,
  customer_id uuid,
  lead_id uuid,
  conversation_id uuid,
  name text,
  phone text,
  effective_state text,
  opportunity_stage text,
  lead_state text,
  conversation_status text,
  is_human_active boolean,
  stage_changed_at timestamptz,
  lifecycle_cycle integer,
  created_at timestamptz,
  updated_at timestamptz,
  is_follow_up_active boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_set_role text := nullif(
    pg_catalog.current_setting('role', true),
    ''
  );
  v_claim_role_setting text := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  v_claims_text text := nullif(
    pg_catalog.current_setting('request.jwt.claims', true),
    ''
  );
  v_claims jsonb;
  v_claim_role_json text;
  v_claim_role text;
  v_request_role text;
  v_user_id uuid := auth.uid();
begin
  if p_organization_id is null then
    raise exception using
      errcode = '22023',
      message = 'panel_list_crm_opportunity_cards_scoped requires organization_id';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using
      errcode = '22023',
      message = 'panel_list_crm_opportunity_cards_scoped requires p_limit between 1 and 500';
  end if;

  if p_offset is null or p_offset < 0 then
    raise exception using
      errcode = '22023',
      message = 'panel_list_crm_opportunity_cards_scoped requires p_offset greater than or equal to zero';
  end if;

  if v_set_role = 'none' then
    v_set_role := null;
  end if;

  if v_claims_text is not null then
    begin
      v_claims := v_claims_text::jsonb;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '42501',
          message = 'panel_list_crm_opportunity_cards_scoped is not authorized';
    end;

    if pg_catalog.jsonb_typeof(v_claims) <> 'object' then
      raise exception using
        errcode = '42501',
        message = 'panel_list_crm_opportunity_cards_scoped is not authorized';
    end if;

    v_claim_role_json := nullif(v_claims ->> 'role', '');
  end if;

  if v_claim_role_setting is not null
     and v_claim_role_json is not null
     and v_claim_role_setting <> v_claim_role_json then
    raise exception using
      errcode = '42501',
      message = 'panel_list_crm_opportunity_cards_scoped is not authorized';
  end if;

  v_claim_role := coalesce(v_claim_role_setting, v_claim_role_json);

  if v_set_role in ('authenticated', 'service_role', 'anon') then
    if v_claim_role is not null and v_claim_role <> v_set_role then
      raise exception using
        errcode = '42501',
        message = 'panel_list_crm_opportunity_cards_scoped is not authorized';
    end if;

    v_request_role := v_set_role;
  elsif session_user = 'postgres'
        and (v_set_role is null or v_set_role = 'postgres') then
    if v_claim_role in ('authenticated', 'service_role', 'anon') then
      raise exception using
        errcode = '42501',
        message = 'panel_list_crm_opportunity_cards_scoped is not authorized';
    end if;

    v_request_role := 'postgres';
  else
    raise exception using
      errcode = '42501',
      message = 'panel_list_crm_opportunity_cards_scoped is not authorized';
  end if;

  if v_request_role = 'anon' then
    raise exception using
      errcode = '42501',
      message = 'panel_list_crm_opportunity_cards_scoped is not authorized';
  end if;

  if v_request_role = 'authenticated' then
    if v_user_id is null then
      raise exception using
        errcode = '42501',
        message = 'panel_list_crm_opportunity_cards_scoped is not authorized';
    end if;

    if not exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = v_user_id
    ) then
      raise exception using
        errcode = '42501',
        message = 'panel_list_crm_opportunity_cards_scoped is not authorized';
    end if;
  elsif v_request_role not in ('service_role', 'postgres') then
    raise exception using
      errcode = '42501',
      message = 'panel_list_crm_opportunity_cards_scoped is not authorized';
  end if;

  if not exists (
    select 1
    from public.organizations organization_row
    where organization_row.id = p_organization_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'panel_list_crm_opportunity_cards_scoped organization not found';
  end if;

  if p_store_id is not null
     and not exists (
       select 1
       from public.stores store_row
       where store_row.id = p_store_id
         and store_row.organization_id = p_organization_id
     ) then
    raise exception using
      errcode = '23503',
      message = 'panel_list_crm_opportunity_cards_scoped store scope not found';
  end if;

  return query
  select
    opportunity_row.id as commercial_opportunity_id,
    opportunity_row.organization_id,
    opportunity_row.store_id,
    opportunity_row.customer_id,
    opportunity_row.origin_lead_id as lead_id,
    opportunity_row.primary_conversation_id as conversation_id,
    coalesce(
      nullif(pg_catalog.btrim(lead_row.name), ''),
      nullif(pg_catalog.btrim(customer_row.display_name), '')
    ) as name,
    coalesce(
      nullif(pg_catalog.btrim(lead_row.phone), ''),
      customer_whatsapp_identity_row.whatsapp_phone
    ) as phone,
    opportunity_row.stage as effective_state,
    opportunity_row.stage as opportunity_stage,
    lead_row.state as lead_state,
    conversation_row.status as conversation_status,
    case
      when opportunity_row.primary_conversation_id is null then null::boolean
      else conversation_row.is_human_active
    end as is_human_active,
    opportunity_row.stage_changed_at,
    opportunity_row.lifecycle_cycle,
    opportunity_row.created_at,
    opportunity_row.updated_at,
    coalesce(
      exists (
        select 1
        from public.commercial_opportunity_followups followup_row
        where followup_row.organization_id = opportunity_row.organization_id
          and followup_row.store_id = opportunity_row.store_id
          and followup_row.commercial_opportunity_id = opportunity_row.id
          and followup_row.status = 'active'
      ),
      false
    ) as is_follow_up_active
  from public.commercial_opportunities opportunity_row
  left join public.leads lead_row
    on lead_row.id = opportunity_row.origin_lead_id
   and lead_row.organization_id = opportunity_row.organization_id
   and lead_row.store_id = opportunity_row.store_id
  left join public.customers customer_row
    on customer_row.id = opportunity_row.customer_id
   and customer_row.organization_id = opportunity_row.organization_id
  left join lateral (
    select
      case
        when count(*) = 1
          then (array_agg(identity_scope_row.resolved_phone))[1]
        else null::text
      end as whatsapp_phone
    from (
      select
        coalesce(
          nullif(pg_catalog.btrim(identity_row.normalized_external_identity), ''),
          nullif(pg_catalog.btrim(identity_row.external_identity), '')
        ) as resolved_phone
      from public.customer_channel_identities identity_row
      where identity_row.organization_id = opportunity_row.organization_id
        and identity_row.customer_id = opportunity_row.customer_id
        and identity_row.channel = 'whatsapp'
        and identity_row.is_primary = true
    ) identity_scope_row
  ) customer_whatsapp_identity_row
    on true
  left join public.conversations conversation_row
    on conversation_row.id = opportunity_row.primary_conversation_id
   and conversation_row.organization_id = opportunity_row.organization_id
   and (
     opportunity_row.origin_lead_id is null
     or conversation_row.lead_id = opportunity_row.origin_lead_id
   )
  where opportunity_row.organization_id = p_organization_id
    and (
      p_store_id is null
      or opportunity_row.store_id = p_store_id
    )
  order by opportunity_row.updated_at desc, opportunity_row.id
  limit p_limit
  offset p_offset;
end;
$function$;

alter function public.panel_list_crm_opportunity_cards_scoped(
  uuid,
  uuid,
  integer,
  integer
)
  owner to postgres;

revoke all on function public.panel_list_crm_opportunity_cards_scoped(
  uuid,
  uuid,
  integer,
  integer
)
  from public, anon, authenticated, service_role;

grant execute on function public.panel_list_crm_opportunity_cards_scoped(
  uuid,
  uuid,
  integer,
  integer
)
  to authenticated, service_role;

comment on function public.panel_list_crm_opportunity_cards_scoped(
  uuid,
  uuid,
  integer,
  integer
) is
  'Lista cards canonicos do CRM por commercial_opportunities, preservando compatibilidade temporaria com a RPC legada orientada por lead.';

do $postconditions$
declare
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.panel_list_crm_opportunity_cards_scoped(uuid,uuid,integer,integer)'
  );
  v_authenticated_has_execute boolean := false;
  v_service_role_has_execute boolean := false;
  v_anon_has_execute boolean := false;
  v_public_has_execute boolean := false;
  v_has_unexpected_execute_grantee boolean := false;
  v_prosrc text;
  v_followup_reference_count integer := 0;
begin
  if v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: canonical crm cards rpc is missing after followup reader patch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_function_oid
      and proc_row.pronargs = 4
      and proc_row.pronargdefaults = 3
      and proc_row.proargnames[1:4] = array[
        'p_organization_id',
        'p_store_id',
        'p_limit',
        'p_offset'
      ]
      and string_to_array(proc_row.proargtypes::text, ' ')::oid[] = array[
        'uuid'::pg_catalog.regtype::oid,
        'uuid'::pg_catalog.regtype::oid,
        'integer'::pg_catalog.regtype::oid,
        'integer'::pg_catalog.regtype::oid
      ]
      and pg_catalog.pg_get_expr(proc_row.proargdefaults, 0::oid) ~ '^NULL::uuid, 500, 0$'
      and proc_row.prosecdef
      and proc_row.proconfig = array[
        'search_path=pg_catalog, pg_temp, public',
        'row_security=off'
      ]
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'TABLE(commercial_opportunity_id uuid, organization_id uuid, store_id uuid, customer_id uuid, lead_id uuid, conversation_id uuid, name text, phone text, effective_state text, opportunity_stage text, lead_state text, conversation_status text, is_human_active boolean, stage_changed_at timestamp with time zone, lifecycle_cycle integer, created_at timestamp with time zone, updated_at timestamp with time zone, is_follow_up_active boolean)'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: canonical crm cards rpc contract diverged after followup reader patch';
  end if;

  select proc_row.prosrc
  into v_prosrc
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_function_oid;

  v_followup_reference_count :=
    (
      pg_catalog.length(v_prosrc)
      - pg_catalog.length(
          replace(v_prosrc, 'public.commercial_opportunity_followups', '')
        )
    )
    / pg_catalog.length('public.commercial_opportunity_followups');

  if v_followup_reference_count <> 1
     or v_prosrc not like '%from public.commercial_opportunity_followups followup_row%'
     or v_prosrc not like '%and followup_row.status = ''active''%'
     or v_prosrc like '%join public.commercial_opportunity_followups%'
     or v_prosrc like '%public.commercial_opportunity_followup_events%'
     or v_prosrc like '%schedule_post_appointment_followups%'
     or v_prosrc like '%create_overdue_post_appointment_followups%'
     or v_prosrc like '%enqueue_post_appointment_followups%'
     or v_prosrc like '%panel_enqueue_followup_scoped%'
     or v_prosrc like '%panel_list_followup_candidates_scoped%'
     or v_prosrc like '%process_conservative_followup_offers_scoped%'
     or v_prosrc like '%process_conservative_followup_visits_scoped%'
     or v_prosrc like '%run_conservative_followup_cycle_scoped%'
     or v_prosrc like '%ai_sales_real_handler_followup_offer%'
     or v_prosrc like '%ai_sales_real_handler_followup_visit%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: followup reader definition does not match the canonical active followup rule';
  end if;

  select
    coalesce(
      bool_or(
        role_row.rolname = 'authenticated'
        and acl_row.privilege_type = 'EXECUTE'
      ),
      false
    ),
    coalesce(
      bool_or(
        role_row.rolname = 'service_role'
        and acl_row.privilege_type = 'EXECUTE'
      ),
      false
    ),
    coalesce(
      bool_or(
        role_row.rolname = 'anon'
        and acl_row.privilege_type = 'EXECUTE'
      ),
      false
    ),
    coalesce(
      bool_or(
        acl_row.grantee = 0
        and acl_row.privilege_type = 'EXECUTE'
      ),
      false
    ),
    coalesce(
      bool_or(
        acl_row.privilege_type = 'EXECUTE'
        and acl_row.grantee <> 0
        and coalesce(role_row.rolname, '') not in (
          'postgres',
          'authenticated',
          'service_role'
        )
      ),
      false
    )
  into
    v_authenticated_has_execute,
    v_service_role_has_execute,
    v_anon_has_execute,
    v_public_has_execute,
    v_has_unexpected_execute_grantee
  from pg_catalog.pg_proc proc_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      proc_row.proacl,
      pg_catalog.acldefault('f', proc_row.proowner)
    )
  ) acl_row
  left join pg_catalog.pg_roles role_row
    on role_row.oid = acl_row.grantee
  where proc_row.oid = v_function_oid;

  if not v_authenticated_has_execute
     or not v_service_role_has_execute
     or v_anon_has_execute
     or v_public_has_execute
     or v_has_unexpected_execute_grantee then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: canonical crm cards rpc grants diverged after followup reader patch';
  end if;
end;
$postconditions$;

commit;

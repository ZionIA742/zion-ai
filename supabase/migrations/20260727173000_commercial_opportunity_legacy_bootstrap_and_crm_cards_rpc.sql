begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

lock table public.organizations in share mode;
lock table public.stores in share mode;
lock table public.customers in share mode;
lock table public.customer_store_links in share mode;
lock table public.leads in share mode;
lock table public.lead_customer_links in share mode;
lock table public.conversations in share mode;
lock table public.commercial_opportunities in share mode;

do $advisory_lock$
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:b1:e1.3:legacy-bootstrap-and-crm-opportunity-cards:v1',
      0
    )
  ) then
    raise exception using
      errcode = '55P03',
      message = 'migration aborted: another execution is already active';
  end if;
end;
$advisory_lock$;

do $preflight$
declare
  v_namespace constant text :=
    'zion:p9:b1:e1.3:commercial-opportunity-legacy-bootstrap:v1';
begin
  if pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.lead_customer_links') is null
     or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.customer_channel_identities') is null
     or pg_catalog.to_regclass('public.customer_store_links') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regclass('public.organizations') is null
     or pg_catalog.to_regclass('public.stores') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more required relations are missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.normalize_commercial_opportunity_stage(text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.normalize_commercial_opportunity_stage(text) is required';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    where lead_row.store_id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more leads do not have store_id';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    left join public.stores store_row
      on store_row.id = lead_row.store_id
     and store_row.organization_id = lead_row.organization_id
    where store_row.id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more leads are outside canonical store scope';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    left join (
      select
        link_row.lead_id,
        count(*) as active_count
      from public.lead_customer_links link_row
      where link_row.status = 'active'
        and link_row.unlinked_at is null
      group by link_row.lead_id
    ) active_link_counts
      on active_link_counts.lead_id = lead_row.id
    where coalesce(active_link_counts.active_count, 0) <> 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: each lead must have exactly one active lead_customer_link with unlinked_at null';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    join public.lead_customer_links link_row
      on link_row.lead_id = lead_row.id
     and link_row.status = 'active'
     and link_row.unlinked_at is null
    where link_row.organization_id is distinct from lead_row.organization_id
       or link_row.store_id is distinct from lead_row.store_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more active lead_customer_links diverge from the lead organization/store scope';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    join public.lead_customer_links link_row
      on link_row.lead_id = lead_row.id
     and link_row.status = 'active'
     and link_row.unlinked_at is null
    group by lead_row.id
    having count(distinct link_row.customer_id) <> 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: each lead must resolve to exactly one current customer';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    join public.lead_customer_links link_row
      on link_row.lead_id = lead_row.id
     and link_row.status = 'active'
     and link_row.unlinked_at is null
    left join public.customers customer_row
      on customer_row.id = link_row.customer_id
    where customer_row.id is null
       or customer_row.organization_id is distinct from lead_row.organization_id
       or customer_row.merged_into_customer_id is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more current customers are missing, cross-org or merged';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    join public.lead_customer_links link_row
      on link_row.lead_id = lead_row.id
     and link_row.status = 'active'
     and link_row.unlinked_at is null
    left join public.customer_store_links customer_store_link_row
      on customer_store_link_row.organization_id = lead_row.organization_id
     and customer_store_link_row.store_id = lead_row.store_id
     and customer_store_link_row.customer_id = link_row.customer_id
    where customer_store_link_row.id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more current customers do not have customer_store_link in the lead scope';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    where public.normalize_commercial_opportunity_stage(lead_row.state) is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more lead.state values are not accepted by normalize_commercial_opportunity_stage()';
  end if;

  if pg_catalog.length(v_namespace) > 63 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: deterministic uuid namespace identifier is unexpectedly too long';
  end if;
end;
$preflight$;

create temp table pg_temp._p9_b1_e1_3_bootstrap_plan (
  lead_id uuid primary key,
  bootstrap_id uuid not null,
  organization_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  primary_conversation_id uuid null,
  stage text not null,
  stage_changed_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  lifecycle_cycle integer not null
) on commit drop;

insert into pg_temp._p9_b1_e1_3_bootstrap_plan (
  lead_id,
  bootstrap_id,
  organization_id,
  store_id,
  customer_id,
  primary_conversation_id,
  stage,
  stage_changed_at,
  created_at,
  updated_at,
  lifecycle_cycle
)
with conversation_counts as (
  select
    conversation_row.lead_id,
    conversation_row.organization_id,
    count(*) as conversation_count,
    case
      when count(*) = 1
        then (array_agg(conversation_row.id))[1]
      else null::uuid
    end as only_conversation_id
  from public.conversations conversation_row
  group by conversation_row.lead_id, conversation_row.organization_id
),
active_links as (
  select
    link_row.lead_id,
    link_row.organization_id,
    link_row.store_id,
    link_row.customer_id
  from public.lead_customer_links link_row
  where link_row.status = 'active'
    and link_row.unlinked_at is null
),
prepared as (
  select
    lead_row.id as lead_id,
    lead_row.organization_id,
    lead_row.store_id,
    active_link_row.customer_id,
    case
      when coalesce(conversation_count_row.conversation_count, 0) = 1
        then conversation_count_row.only_conversation_id
      else null::uuid
    end as primary_conversation_id,
    public.normalize_commercial_opportunity_stage(lead_row.state) as stage,
    coalesce(lead_row.updated_at, lead_row.created_at) as stage_changed_at,
    lead_row.created_at,
    coalesce(lead_row.updated_at, lead_row.created_at) as updated_at,
    lower(
      substr(hash_row.digest, 1, 8) || '-' ||
      substr(hash_row.digest, 9, 4) || '-' ||
      '5' || substr(hash_row.digest, 14, 3) || '-' ||
      'a' || substr(hash_row.digest, 18, 3) || '-' ||
      substr(hash_row.digest, 21, 12)
    )::uuid as bootstrap_id
  from public.leads lead_row
  join active_links active_link_row
    on active_link_row.lead_id = lead_row.id
   and active_link_row.organization_id = lead_row.organization_id
   and active_link_row.store_id = lead_row.store_id
  left join conversation_counts conversation_count_row
    on conversation_count_row.lead_id = lead_row.id
   and conversation_count_row.organization_id = lead_row.organization_id
  cross join lateral (
    select pg_catalog.md5(
      'zion:p9:b1:e1.3:commercial-opportunity-legacy-bootstrap:v1'
      || ':' || lead_row.id::text
    ) as digest
  ) hash_row
)
select
  prepared.lead_id,
  prepared.bootstrap_id,
  prepared.organization_id,
  prepared.store_id,
  prepared.customer_id,
  prepared.primary_conversation_id,
  prepared.stage,
  prepared.stage_changed_at,
  prepared.created_at,
  prepared.updated_at,
  1 as lifecycle_cycle
from prepared;

do $conflicts$
begin
  if exists (
    select 1
    from pg_temp._p9_b1_e1_3_bootstrap_plan plan_row
    left join public.commercial_opportunities bootstrap_row
      on bootstrap_row.id = plan_row.bootstrap_id
    join public.commercial_opportunities opportunity_row
      on opportunity_row.origin_lead_id = plan_row.lead_id
     and opportunity_row.id <> plan_row.bootstrap_id
    where bootstrap_row.id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: non-bootstrap opportunity already exists for a lead without its reserved bootstrap record';
  end if;

  if exists (
    select 1
    from pg_temp._p9_b1_e1_3_bootstrap_plan plan_row
    join public.commercial_opportunities opportunity_row
      on opportunity_row.id = plan_row.bootstrap_id
    where opportunity_row.organization_id is distinct from plan_row.organization_id
       or opportunity_row.store_id is distinct from plan_row.store_id
       or opportunity_row.customer_id is distinct from plan_row.customer_id
       or opportunity_row.origin_lead_id is distinct from plan_row.lead_id
       or opportunity_row.primary_conversation_id is distinct from plan_row.primary_conversation_id
       or opportunity_row.stage is distinct from plan_row.stage
       or opportunity_row.stage_changed_at is distinct from plan_row.stage_changed_at
       or opportunity_row.created_at is distinct from plan_row.created_at
       or opportunity_row.updated_at is distinct from plan_row.updated_at
       or opportunity_row.lifecycle_cycle is distinct from plan_row.lifecycle_cycle
       or opportunity_row.lost_at is not null
       or opportunity_row.lost_reason_code is not null
       or opportunity_row.lost_reason_details is not null
       or opportunity_row.current_loss_event_id is not null
       or opportunity_row.last_reopened_at is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: deterministic bootstrap opportunity id already exists with divergent payload';
  end if;
end;
$conflicts$;

insert into public.commercial_opportunities (
  id,
  organization_id,
  store_id,
  customer_id,
  origin_lead_id,
  primary_conversation_id,
  stage,
  stage_changed_at,
  created_at,
  updated_at,
  lifecycle_cycle,
  lost_at,
  lost_reason_code,
  lost_reason_details,
  current_loss_event_id,
  last_reopened_at
)
select
  plan_row.bootstrap_id,
  plan_row.organization_id,
  plan_row.store_id,
  plan_row.customer_id,
  plan_row.lead_id,
  plan_row.primary_conversation_id,
  plan_row.stage,
  plan_row.stage_changed_at,
  plan_row.created_at,
  plan_row.updated_at,
  plan_row.lifecycle_cycle,
  null::timestamptz,
  null::text,
  null::text,
  null::uuid,
  null::timestamptz
from pg_temp._p9_b1_e1_3_bootstrap_plan plan_row
left join public.commercial_opportunities opportunity_row
  on opportunity_row.id = plan_row.bootstrap_id
where opportunity_row.id is null;

create or replace function public.panel_list_crm_opportunity_cards_scoped(
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
  updated_at timestamptz
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
    opportunity_row.updated_at
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
begin
  if exists (
    select 1
    from pg_temp._p9_b1_e1_3_bootstrap_plan plan_row
    left join public.commercial_opportunities opportunity_row
      on opportunity_row.id = plan_row.bootstrap_id
    where opportunity_row.id is null
       or opportunity_row.organization_id is distinct from plan_row.organization_id
       or opportunity_row.store_id is distinct from plan_row.store_id
       or opportunity_row.customer_id is distinct from plan_row.customer_id
       or opportunity_row.origin_lead_id is distinct from plan_row.lead_id
       or opportunity_row.primary_conversation_id is distinct from plan_row.primary_conversation_id
       or opportunity_row.stage is distinct from plan_row.stage
       or opportunity_row.stage_changed_at is distinct from plan_row.stage_changed_at
       or opportunity_row.created_at is distinct from plan_row.created_at
       or opportunity_row.updated_at is distinct from plan_row.updated_at
       or opportunity_row.lifecycle_cycle is distinct from plan_row.lifecycle_cycle
       or opportunity_row.lost_at is not null
       or opportunity_row.lost_reason_code is not null
       or opportunity_row.lost_reason_details is not null
       or opportunity_row.current_loss_event_id is not null
       or opportunity_row.last_reopened_at is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: one or more deterministic bootstrap opportunities diverged from the bootstrap plan';
  end if;

  if v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: panel_list_crm_opportunity_cards_scoped is missing';
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
      message = 'postcondition failed: panel_list_crm_opportunity_cards_scoped grants mismatch';
  end if;
end;
$postconditions$;

commit;

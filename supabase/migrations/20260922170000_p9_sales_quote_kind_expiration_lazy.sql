-- ZION P9 / Bloco 6 / Etapa 6.4
-- Canonical sales quote kind resolution + lazy quote expiration.
-- Do not apply remotely without an explicit runbook.
--
-- 6.4 invariants:
-- - one canonical reader of technical-visit/checklist authority;
-- - generation and send-readiness delegate to that same authority reader;
-- - expiration is lazy and snapshot-first;
-- - approve/send fail closed before lifecycle/outbound mutation.

begin;

do $preflight$
begin
  if pg_catalog.to_regclass('public.sales_quotes') is null
     or pg_catalog.to_regclass('public.sales_quote_versions') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_checklist_current') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_checklist_items') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_checklist_progress_current') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_checklist_progress_items') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_6_4_PREFLIGHT_REQUIRED_RELATION_MISSING';
  end if;

  if pg_catalog.to_regprocedure(
       'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.materialize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.read_quote_kind_send_readiness_scoped(uuid,uuid,uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_6_4_PREFLIGHT_REQUIRED_CANONICAL_FUNCTION_MISSING';
  end if;
end;
$preflight$;

create or replace function public.resolve_sales_quote_version_valid_until(
  p_quote_snapshot jsonb,
  p_quote_valid_until date
)
returns date
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select case
    when p_quote_snapshot is not null
     and jsonb_typeof(p_quote_snapshot) = 'object'
     and jsonb_typeof(p_quote_snapshot -> 'quote') = 'object'
     and (p_quote_snapshot -> 'quote') ? 'validUntil'
      then nullif(
        btrim(coalesce(p_quote_snapshot -> 'quote' ->> 'validUntil', '')),
        ''
      )::date
    else p_quote_valid_until
  end;
$function$;

alter function public.resolve_sales_quote_version_valid_until(jsonb, date)
  owner to postgres;
revoke all on function public.resolve_sales_quote_version_valid_until(jsonb, date)
  from public, anon, authenticated, service_role;

create or replace function public.sales_quote_version_is_expired(
  p_quote_snapshot jsonb,
  p_quote_valid_until date,
  p_today date default ((now() at time zone 'UTC')::date)
)
returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select coalesce(
    public.resolve_sales_quote_version_valid_until(
      p_quote_snapshot,
      p_quote_valid_until
    ) < p_today,
    false
  );
$function$;

alter function public.sales_quote_version_is_expired(jsonb, date, date)
  owner to postgres;
revoke all on function public.sales_quote_version_is_expired(jsonb, date, date)
  from public, anon, authenticated, service_role;

-- Single canonical reader of the current checklist/progress authority.
create or replace function public.p9_read_sales_quote_kind_authority_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  authority_state text,
  technical_visit_item_id uuid,
  technical_visit_applicability_state text,
  technical_visit_reason_code text,
  technical_visit_progress_state text,
  technical_visit_assessment_state text,
  technical_visit_progress_reason_code text,
  preliminary_policy_item_id uuid,
  preliminary_allowed boolean,
  authority_fingerprint text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities%rowtype;
  v_technical_item public.commercial_opportunity_checklist_items%rowtype;
  v_technical public.commercial_opportunity_checklist_progress_items%rowtype;
  v_preliminary_policy public.commercial_opportunity_checklist_items%rowtype;
  v_progress_found boolean := false;
  v_state text := 'ready';
  v_basis jsonb;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using errcode = '22023',
      message = 'P9_QUOTE_KIND_AUTHORITY_ARGUMENTS_REQUIRED';
  end if;

  select opportunity_row.*
    into v_opportunity
    from public.commercial_opportunities opportunity_row
   where opportunity_row.id = p_commercial_opportunity_id
     and opportunity_row.organization_id = p_organization_id
     and opportunity_row.store_id = p_store_id;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'P9_QUOTE_KIND_AUTHORITY_OPPORTUNITY_NOT_FOUND';
  end if;

  select item_row.*
    into v_technical_item
    from public.commercial_opportunity_checklist_current current_row
    join public.commercial_opportunity_checklist_items item_row
      on item_row.checklist_version_id = current_row.current_checklist_version_id
     and item_row.organization_id = current_row.organization_id
     and item_row.store_id = current_row.store_id
     and item_row.commercial_opportunity_id = current_row.commercial_opportunity_id
   where current_row.organization_id = p_organization_id
     and current_row.store_id = p_store_id
     and current_row.commercial_opportunity_id = p_commercial_opportunity_id
     and item_row.item_key = 'technical_visit';

  select item_row.*
    into v_preliminary_policy
    from public.commercial_opportunity_checklist_current current_row
    join public.commercial_opportunity_checklist_items item_row
      on item_row.checklist_version_id = current_row.current_checklist_version_id
     and item_row.organization_id = current_row.organization_id
     and item_row.store_id = current_row.store_id
     and item_row.commercial_opportunity_id = current_row.commercial_opportunity_id
   where current_row.organization_id = p_organization_id
     and current_row.store_id = p_store_id
     and current_row.commercial_opportunity_id = p_commercial_opportunity_id
     and item_row.item_key = 'preliminary_quote_before_technical_visit'
     and item_row.applicability_state = 'optional';

  if v_technical_item.id is not null
     and v_technical_item.applicability_state in ('conflict', 'needs_resolution') then
    v_state := v_technical_item.applicability_state;
  elsif v_technical_item.id is not null
        and v_technical_item.applicability_state = 'required' then
    select progress_row.*
      into v_technical
      from public.commercial_opportunity_checklist_progress_current current_row
      join public.commercial_opportunity_checklist_progress_items progress_row
        on progress_row.progress_version_id = current_row.current_progress_version_id
       and progress_row.organization_id = current_row.organization_id
       and progress_row.store_id = current_row.store_id
       and progress_row.commercial_opportunity_id = current_row.commercial_opportunity_id
     where current_row.organization_id = p_organization_id
       and current_row.store_id = p_store_id
       and current_row.commercial_opportunity_id = p_commercial_opportunity_id
       and progress_row.checklist_item_id = v_technical_item.id;

    v_progress_found := found;
    if not v_progress_found then
      v_state := 'needs_resolution';
    elsif v_technical.assessment_state in ('conflict', 'needs_resolution') then
      v_state := v_technical.assessment_state;
    end if;
  end if;

  v_basis := jsonb_build_object(
    'schema', 'p9_sales_quote_kind_authority_v1',
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'technical_visit_item_id', v_technical_item.id,
    'technical_visit_applicability_state', v_technical_item.applicability_state,
    'technical_visit_reason_code', v_technical_item.reason_code,
    'technical_visit_progress_found', v_progress_found,
    'technical_visit_progress_state', v_technical.progress_state,
    'technical_visit_assessment_state', v_technical.assessment_state,
    'technical_visit_progress_reason_code', v_technical.reason_code,
    'preliminary_policy_item_id', v_preliminary_policy.id,
    'preliminary_allowed', (v_preliminary_policy.id is not null),
    'authority_state', v_state
  );

  return query select
    v_state,
    v_technical_item.id,
    v_technical_item.applicability_state,
    v_technical_item.reason_code,
    v_technical.progress_state,
    v_technical.assessment_state,
    v_technical.reason_code,
    v_preliminary_policy.id,
    (v_preliminary_policy.id is not null),
    encode(digest(convert_to(v_basis::text, 'UTF8'), 'sha256'), 'hex');
end;
$function$;

alter function public.p9_read_sales_quote_kind_authority_internal(uuid, uuid, uuid)
  owner to postgres;
revoke all on function public.p9_read_sales_quote_kind_authority_internal(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.resolve_sales_quote_kind_for_generation_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_sales_quote_id uuid
)
returns table (
  resolution_state text,
  quote_kind text,
  reason_code text,
  blocking_items jsonb,
  authority_fingerprint text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_quote public.sales_quotes%rowtype;
  v_authority record;
  v_state text := 'ready';
  v_kind text := 'definitive';
  v_reason text := 'definitive_quote_ready';
  v_blocking jsonb := '[]'::jsonb;
  v_basis jsonb;
begin
  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'sales quote kind resolver is not authorized';
  end if;
  if p_organization_id is null or p_store_id is null
     or p_commercial_opportunity_id is null or p_sales_quote_id is null then
    raise exception using errcode = '22023', message = 'SALES_QUOTE_KIND_RESOLUTION_ARGUMENTS_REQUIRED';
  end if;

  select quote_row.* into v_quote
    from public.sales_quotes quote_row
   where quote_row.id = p_sales_quote_id
     and quote_row.organization_id = p_organization_id
     and quote_row.store_id = p_store_id
     and quote_row.commercial_opportunity_id = p_commercial_opportunity_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'SALES_QUOTE_KIND_QUOTE_NOT_FOUND';
  end if;

  select * into v_authority
    from public.p9_read_sales_quote_kind_authority_internal(
      p_organization_id, p_store_id, p_commercial_opportunity_id
    );
  if not found then
    raise exception using errcode = 'P0001', message = 'SALES_QUOTE_KIND_AUTHORITY_EMPTY';
  end if;

  if v_authority.authority_state in ('conflict', 'needs_resolution') then
    v_state := v_authority.authority_state;
    v_kind := null;
    if v_authority.technical_visit_applicability_state in ('conflict', 'needs_resolution') then
      v_reason := 'quote_kind_technical_visit_applicability_' || v_authority.technical_visit_applicability_state;
      v_blocking := jsonb_build_array(jsonb_build_object(
        'item_key', 'technical_visit',
        'applicability_state', v_authority.technical_visit_applicability_state,
        'reason_code', v_authority.technical_visit_reason_code
      ));
    elsif v_authority.technical_visit_progress_state is null then
      v_reason := 'quote_kind_technical_visit_progress_missing';
      v_blocking := jsonb_build_array(jsonb_build_object(
        'item_key', 'technical_visit', 'applicability_state', 'required'
      ));
    else
      v_reason := 'quote_kind_technical_visit_progress_' || coalesce(v_authority.technical_visit_assessment_state, 'needs_resolution');
      v_blocking := jsonb_build_array(jsonb_build_object(
        'item_key', 'technical_visit',
        'assessment_state', v_authority.technical_visit_assessment_state,
        'reason_code', v_authority.technical_visit_progress_reason_code
      ));
    end if;
  elsif v_authority.technical_visit_applicability_state = 'required'
        and v_authority.technical_visit_progress_state is distinct from 'completed' then
    if v_authority.preliminary_allowed then
      v_kind := 'preliminary';
      v_reason := 'preliminary_quote_before_visit_allowed';
    else
      v_state := 'blocked';
      v_kind := null;
      v_reason := 'preliminary_quote_before_visit_not_allowed';
      v_blocking := jsonb_build_array(jsonb_build_object(
        'item_key', 'preliminary_quote_before_technical_visit',
        'technical_visit_progress_state', v_authority.technical_visit_progress_state,
        'technical_visit_assessment_state', v_authority.technical_visit_assessment_state
      ));
    end if;
  end if;

  v_basis := jsonb_build_object(
    'schema', 'p9_sales_quote_kind_generation_resolution_v1',
    'sales_quote_id', p_sales_quote_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'authority_fingerprint', v_authority.authority_fingerprint,
    'resolution_state', v_state,
    'quote_kind', v_kind,
    'reason_code', v_reason,
    'blocking_items', v_blocking
  );

  return query select v_state, v_kind, v_reason, v_blocking,
    encode(digest(convert_to(v_basis::text, 'UTF8'), 'sha256'), 'hex');
end;
$function$;

alter function public.resolve_sales_quote_kind_for_generation_by_system(uuid, uuid, uuid, uuid)
  owner to postgres;
revoke all on function public.resolve_sales_quote_kind_for_generation_by_system(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_sales_quote_kind_for_generation_by_system(uuid, uuid, uuid, uuid)
  to service_role;

-- Existing send-readiness contract, delegated to the same internal authority reader.
create or replace function public.read_quote_kind_send_readiness_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_sales_quote_version_id uuid
)
returns table (
  readiness_state text,
  reason_code text,
  blocking_items jsonb,
  authority_fingerprint text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_version public.sales_quote_versions%rowtype;
  v_authority record;
  v_state text := 'ready';
  v_reason text := 'quote_kind_send_ready';
  v_blocking jsonb := '[]'::jsonb;
  v_basis jsonb;
begin
  select version_row.* into v_version
    from public.sales_quote_versions version_row
   where version_row.id = p_sales_quote_version_id
     and version_row.organization_id = p_organization_id
     and version_row.store_id = p_store_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'QUOTE_KIND_VERSION_NOT_FOUND';
  end if;

  if coalesce(v_version.quote_kind, '') not in ('preliminary', 'definitive') then
    return query select 'ready'::text, 'legacy_quote_kind_send'::text, '[]'::jsonb, null::text;
    return;
  end if;

  select * into v_authority
    from public.p9_read_sales_quote_kind_authority_internal(
      p_organization_id, p_store_id, p_commercial_opportunity_id
    );
  if not found then
    raise exception using errcode = 'P0001', message = 'QUOTE_KIND_SEND_AUTHORITY_EMPTY';
  end if;

  if v_authority.authority_state in ('conflict', 'needs_resolution') then
    v_state := v_authority.authority_state;
    if v_authority.technical_visit_applicability_state in ('conflict', 'needs_resolution') then
      v_reason := 'quote_kind_technical_visit_applicability_' || v_authority.technical_visit_applicability_state;
      v_blocking := jsonb_build_array(jsonb_build_object(
        'item_key', 'technical_visit',
        'applicability_state', v_authority.technical_visit_applicability_state,
        'reason_code', v_authority.technical_visit_reason_code
      ));
    elsif v_authority.technical_visit_progress_state is null then
      v_reason := 'quote_kind_technical_visit_progress_missing';
      v_blocking := jsonb_build_array(jsonb_build_object(
        'item_key', 'technical_visit', 'applicability_state', 'required'
      ));
    else
      v_reason := 'quote_kind_technical_visit_progress_' || coalesce(v_authority.technical_visit_assessment_state, 'needs_resolution');
      v_blocking := jsonb_build_array(jsonb_build_object(
        'item_key', 'technical_visit',
        'assessment_state', v_authority.technical_visit_assessment_state,
        'reason_code', v_authority.technical_visit_progress_reason_code
      ));
    end if;
  elsif v_authority.technical_visit_applicability_state = 'required'
        and v_authority.technical_visit_progress_state is distinct from 'completed' then
    if v_version.quote_kind = 'definitive' then
      v_state := 'blocked';
      v_reason := 'definitive_quote_requires_completed_technical_visit';
      v_blocking := jsonb_build_array(jsonb_build_object(
        'item_key', 'technical_visit',
        'progress_state', v_authority.technical_visit_progress_state,
        'assessment_state', v_authority.technical_visit_assessment_state
      ));
    elsif v_authority.preliminary_allowed then
      v_reason := 'preliminary_quote_before_visit_allowed';
    else
      v_state := 'blocked';
      v_reason := 'preliminary_quote_before_visit_not_allowed';
      v_blocking := jsonb_build_array(jsonb_build_object(
        'item_key', 'preliminary_quote_before_technical_visit',
        'technical_visit_progress_state', v_authority.technical_visit_progress_state,
        'technical_visit_assessment_state', v_authority.technical_visit_assessment_state
      ));
    end if;
  end if;

  v_basis := jsonb_build_object(
    'schema', 'p19a_quote_kind_send_readiness_v1',
    'sales_quote_version_id', p_sales_quote_version_id,
    'quote_kind', v_version.quote_kind,
    'technical_visit_applicability_state', v_authority.technical_visit_applicability_state,
    'technical_visit_progress_state', v_authority.technical_visit_progress_state,
    'preliminary_before_visit_policy_item_id', v_authority.preliminary_policy_item_id,
    'readiness_state', v_state,
    'reason_code', v_reason,
    'blocking_items', v_blocking
  );

  return query select v_state, v_reason, v_blocking,
    encode(digest(convert_to(v_basis::text, 'UTF8'), 'sha256'), 'hex');
end;
$function$;

alter function public.read_quote_kind_send_readiness_scoped(uuid, uuid, uuid, uuid)
  owner to postgres;
revoke all on function public.read_quote_kind_send_readiness_scoped(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_quote_kind_send_readiness_scoped(uuid, uuid, uuid, uuid)
  to service_role;

-- Approval writer: expiration before lifecycle mutation.
create or replace function public.approve_sales_quote_version_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_quote_id uuid,
  p_sales_quote_version_id uuid
)
returns table (
  id uuid,
  quote_id uuid,
  organization_id uuid,
  store_id uuid,
  version_number integer,
  status text,
  quote_kind text,
  store_file_id uuid,
  storage_bucket text,
  storage_path text,
  original_filename text,
  mime_type text,
  size_bytes integer,
  quote_snapshot jsonb,
  created_at timestamptz,
  sent_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_quote public.sales_quotes%rowtype;
  v_version public.sales_quote_versions%rowtype;
begin
  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'sales quote version approval writer is not authorized';
  end if;
  if p_organization_id is null or p_store_id is null
     or p_quote_id is null or p_sales_quote_version_id is null then
    raise exception using errcode = '22023', message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_ARGUMENTS_INVALID';
  end if;

  select quote_row.* into v_quote
    from public.sales_quotes quote_row
   where quote_row.id = p_quote_id
     and quote_row.organization_id = p_organization_id
     and quote_row.store_id = p_store_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_QUOTE_NOT_FOUND';
  end if;
  if v_quote.current_version_id is distinct from p_sales_quote_version_id then
    raise exception using errcode = '23514', message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_REQUIRES_CURRENT_VERSION';
  end if;

  select version_row.* into v_version
    from public.sales_quote_versions version_row
   where version_row.id = p_sales_quote_version_id
     and version_row.quote_id = p_quote_id
     and version_row.organization_id = p_organization_id
     and version_row.store_id = p_store_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_VERSION_NOT_FOUND';
  end if;

  if public.sales_quote_version_is_expired(
    v_version.quote_snapshot,
    v_quote.valid_until,
    (now() at time zone 'UTC')::date
  ) then
    raise exception using errcode = '23514', message = 'ZION_SALES_QUOTE_VERSION_EXPIRED';
  end if;

  if v_version.sent_at is not null
     or lower(btrim(coalesce(v_version.status, ''))) in ('sent', 'superseded', 'failed') then
    raise exception using errcode = '23514', message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_STATUS_INVALID';
  end if;
  if lower(btrim(coalesce(v_version.status, ''))) not in ('generated', 'pending_review', 'approved') then
    raise exception using errcode = '23514', message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_STATUS_INVALID';
  end if;

  update public.sales_quote_versions version_row
     set status = 'approved'
   where version_row.id = p_sales_quote_version_id
     and version_row.quote_id = p_quote_id
     and version_row.organization_id = p_organization_id
     and version_row.store_id = p_store_id
  returning * into v_version;

  id := v_version.id;
  quote_id := v_version.quote_id;
  organization_id := v_version.organization_id;
  store_id := v_version.store_id;
  version_number := v_version.version_number;
  status := v_version.status;
  quote_kind := v_version.quote_kind;
  store_file_id := v_version.store_file_id;
  storage_bucket := v_version.storage_bucket;
  storage_path := v_version.storage_path;
  original_filename := v_version.original_filename;
  mime_type := v_version.mime_type;
  size_bytes := v_version.size_bytes;
  quote_snapshot := v_version.quote_snapshot;
  created_at := v_version.created_at;
  sent_at := v_version.sent_at;
  return next;
end;
$function$;

-- Canonical send materialization: expiration before message lookup/insert.
create or replace function public.materialize_sales_quote_send_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_conversation_id uuid,
  p_sales_quote_id uuid,
  p_sales_quote_version_id uuid,
  p_message_content text,
  p_message_metadata jsonb,
  p_idempotency_key text,
  p_source text
)
returns table (
  message_id uuid,
  outbound_idempotency_key text,
  outbound_delivery_state text,
  commercial_opportunity_id uuid,
  sales_quote_id uuid,
  sales_quote_version_id uuid,
  external_message_id text,
  outcome text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
  v_expected_key text;
  v_quote public.sales_quotes;
  v_version public.sales_quote_versions;
  v_opportunity public.commercial_opportunities;
  v_message public.messages;
  v_store_file public.store_files;
  v_metadata jsonb;
  v_storage_bucket text;
  v_storage_path text;
  v_original_filename text;
  v_mime_type text;
  v_size_bytes bigint;
begin
  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'sales quote send materialization is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_conversation_id is null
     or p_sales_quote_id is null
     or p_sales_quote_version_id is null
     or v_key is null
     or nullif(btrim(coalesce(p_message_content, '')), '') is null
     or p_message_metadata is null
     or jsonb_typeof(p_message_metadata) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'SALES_QUOTE_SEND_ARGUMENTS_REQUIRED';
  end if;

  if v_source is distinct from 'sales_quote_send_route' then
    raise exception using errcode = '22023', message = 'SALES_QUOTE_SEND_SOURCE_INVALID';
  end if;

  v_expected_key :=
    'sales_quote_send:'
    || p_organization_id::text || ':'
    || p_store_id::text || ':'
    || p_commercial_opportunity_id::text || ':'
    || p_sales_quote_id::text || ':'
    || p_sales_quote_version_id::text;

  if v_key is distinct from v_expected_key then
    raise exception using errcode = '22023', message = 'SALES_QUOTE_SEND_IDEMPOTENCY_KEY_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_expected_key, 0));

  select opportunity_row.* into v_opportunity
    from public.commercial_opportunities as opportunity_row
   where opportunity_row.id = p_commercial_opportunity_id
     and opportunity_row.organization_id = p_organization_id
     and opportunity_row.store_id = p_store_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COMMERCIAL_OPPORTUNITY_NOT_FOUND_FOR_QUOTE_SEND';
  end if;

  select quote_row.* into v_quote
    from public.sales_quotes as quote_row
   where quote_row.id = p_sales_quote_id
     and quote_row.organization_id = p_organization_id
     and quote_row.store_id = p_store_id
     and quote_row.commercial_opportunity_id = p_commercial_opportunity_id
     and quote_row.conversation_id = p_conversation_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SALES_QUOTE_NOT_FOUND_FOR_CANONICAL_SEND';
  end if;

  if v_quote.current_version_id is distinct from p_sales_quote_version_id then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_VERSION_MUST_BE_CURRENT_FOR_SEND';
  end if;

  select version_row.* into v_version
    from public.sales_quote_versions as version_row
   where version_row.id = p_sales_quote_version_id
     and version_row.quote_id = v_quote.id
     and version_row.organization_id = p_organization_id
     and version_row.store_id = p_store_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SALES_QUOTE_VERSION_NOT_FOUND_FOR_CANONICAL_SEND';
  end if;

  if public.sales_quote_version_is_expired(
    v_version.quote_snapshot,
    v_quote.valid_until,
    (now() at time zone 'UTC')::date
  ) then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_VERSION_EXPIRED_FOR_SEND';
  end if;

  if v_version.version_number is null then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_VERSION_NUMBER_REQUIRED_FOR_CANONICAL_SEND';
  end if;
  if v_version.sent_at is not null
     or lower(btrim(coalesce(v_version.status, ''))) in ('sent', 'superseded', 'failed') then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_VERSION_NOT_SENDABLE';
  end if;

  if v_version.store_file_id is not null then
    select store_file_row.* into v_store_file
      from public.store_files as store_file_row
     where store_file_row.id = v_version.store_file_id
       and store_file_row.organization_id = p_organization_id
       and store_file_row.store_id = p_store_id
     limit 1;
    if not found then
      raise exception using errcode = '23514', message = 'SALES_QUOTE_STORE_FILE_SCOPE_MISMATCH';
    end if;
  end if;

  v_storage_bucket := nullif(btrim(coalesce(v_store_file.storage_bucket, v_version.storage_bucket, '')), '');
  v_storage_path := nullif(btrim(coalesce(v_store_file.storage_path, v_version.storage_path, '')), '');
  v_original_filename := nullif(btrim(coalesce(v_store_file.original_filename, v_version.original_filename, '')), '');
  v_mime_type := lower(nullif(btrim(coalesce(v_store_file.mime_type, v_version.mime_type, '')), ''));
  v_size_bytes := coalesce(v_store_file.size_bytes, v_version.size_bytes);

  if v_storage_bucket is null
     or v_storage_path is null
     or v_original_filename is null
     or v_mime_type is distinct from 'application/pdf' then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_PDF_ARTIFACT_INVALID_FOR_SEND';
  end if;

  select message_row.* into v_message
    from public.messages as message_row
   where message_row.organization_id = p_organization_id
     and message_row.store_id = p_store_id
     and message_row.outbound_idempotency_key = v_expected_key
   limit 1
   for update;

  if found then
    if v_message.deleted_at is not null then
      raise exception using errcode = '23505', message = 'SALES_QUOTE_SEND_SOFT_DELETED_OPERATION_ALREADY_EXISTS';
    end if;

    if coalesce(v_message.metadata ->> 'outbound_origin', '') <> 'sales_quote_send'
       or coalesce(v_message.metadata ->> 'source', '') <> 'sales_quote_send_route'
       or coalesce(v_message.metadata ->> 'commercial_opportunity_id', '') <> p_commercial_opportunity_id::text
       or coalesce(v_message.metadata ->> 'sales_quote_id', '') <> p_sales_quote_id::text
       or coalesce(v_message.metadata ->> 'sales_quote_version_id', '') <> p_sales_quote_version_id::text
       or lower(btrim(coalesce(v_message.message_type, ''))) <> 'document'
       or coalesce(v_message.media_url, '') <> v_storage_path then
      raise exception using errcode = '23514', message = 'SALES_QUOTE_SEND_EXISTING_MESSAGE_SCOPE_MISMATCH';
    end if;

    return query
    select
      v_message.id,
      v_expected_key,
      coalesce(v_message.outbound_delivery_state, 'pending'),
      p_commercial_opportunity_id,
      p_sales_quote_id,
      p_sales_quote_version_id,
      v_message.external_message_id,
      case
        when coalesce(v_message.outbound_delivery_state, '') = 'uncertain' then 'uncertain'
        when v_message.external_message_id is not null
          or coalesce(v_message.outbound_delivery_state, '') = 'sent' then 'already_sent'
        when coalesce(v_message.outbound_delivery_state, '') = 'failed' then 'failed'
        else 'already_queued'
      end;
    return;
  end if;

  v_metadata := coalesce(p_message_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source', 'sales_quote_send_route',
      'channel', 'whatsapp',
      'external_channel', 'whatsapp',
      'send_external', true,
      'outbound_origin', 'sales_quote_send',
      'outbound_idempotency_key', v_expected_key,
      'organization_id', p_organization_id,
      'store_id', p_store_id,
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'sales_quote_id', p_sales_quote_id,
      'sales_quote_version_id', p_sales_quote_version_id,
      'attachment_kind', 'file',
      'file_kind', 'sales_quote_pdf',
      'storage_bucket', v_storage_bucket,
      'storage_path', v_storage_path,
      'mime_type', 'application/pdf',
      'original_file_name', v_original_filename,
      'size_bytes', v_size_bytes,
      'generated_by', 'system'
    );

  select * into v_message
    from public.insert_message(
      p_conversation_id,
      'human',
      'outgoing',
      'document',
      p_message_content,
      null,
      v_storage_path,
      v_metadata
    );

  if v_message.id is null
     or v_message.organization_id is distinct from p_organization_id
     or v_message.store_id is distinct from p_store_id
     or v_message.conversation_id is distinct from p_conversation_id then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_SEND_INSERT_MESSAGE_SCOPE_MISMATCH';
  end if;

  update public.messages as message_row
     set outbound_idempotency_key = v_expected_key,
         outbound_delivery_state = 'pending',
         outbound_claimed_at = null,
         outbound_claimed_by = null,
         outbound_attempt_started_at = null,
         outbound_provider_accepted_at = null,
         outbound_uncertain_at = null,
         outbound_error_text = null,
         outbound_commercial_finalized_at = null,
         outbound_commercial_error_at = null,
         outbound_commercial_error_text = null
   where message_row.id = v_message.id
     and message_row.organization_id = p_organization_id
     and message_row.store_id = p_store_id
     and message_row.deleted_at is null
  returning message_row.* into v_message;

  if not found then
    raise exception using errcode = 'P0001', message = 'SALES_QUOTE_SEND_MESSAGE_OUTBOUND_STATE_NOT_APPLIED';
  end if;

  return query
  select
    v_message.id,
    v_expected_key,
    v_message.outbound_delivery_state,
    p_commercial_opportunity_id,
    p_sales_quote_id,
    p_sales_quote_version_id,
    v_message.external_message_id,
    'queued'::text;
end;
$function$;

alter function public.approve_sales_quote_version_by_system(uuid, uuid, uuid, uuid)
  owner to postgres;
revoke all on function public.approve_sales_quote_version_by_system(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_sales_quote_version_by_system(uuid, uuid, uuid, uuid)
  to service_role;

alter function public.materialize_sales_quote_send_by_system(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, text, text)
  owner to postgres;
revoke all on function public.materialize_sales_quote_send_by_system(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.materialize_sales_quote_send_by_system(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, text, text)
  to service_role;

comment on function public.p9_read_sales_quote_kind_authority_internal(uuid, uuid, uuid) is
  'Single internal P9 authority reader for sales quote kind. Reads canonical current technical-visit/checklist projections and is shared by generation and send readiness.';
comment on function public.resolve_sales_quote_kind_for_generation_by_system(uuid, uuid, uuid, uuid) is
  'Resolves preliminary/definitive sales quote kind for generation from the shared canonical quote-kind authority reader.';
comment on function public.sales_quote_version_is_expired(jsonb, date, date) is
  'Lazy date-only UTC expiration check for sales quote versions. Snapshot validUntil wins; quote valid_until is legacy fallback only when snapshot has no validUntil field.';

do $postconditions$
declare
  v_internal_definition text;
  v_generation_definition text;
  v_readiness_definition text;
  v_approval_definition text;
  v_send_definition text;
begin
  select pg_get_functiondef('public.p9_read_sales_quote_kind_authority_internal(uuid,uuid,uuid)'::regprocedure)
    into v_internal_definition;
  select pg_get_functiondef('public.resolve_sales_quote_kind_for_generation_by_system(uuid,uuid,uuid,uuid)'::regprocedure)
    into v_generation_definition;
  select pg_get_functiondef('public.read_quote_kind_send_readiness_scoped(uuid,uuid,uuid,uuid)'::regprocedure)
    into v_readiness_definition;
  select pg_get_functiondef('public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid)'::regprocedure)
    into v_approval_definition;
  select pg_get_functiondef('public.materialize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure)
    into v_send_definition;

  if v_internal_definition not like '%commercial_opportunity_checklist_current%'
     or v_internal_definition not like '%commercial_opportunity_checklist_progress_current%'
     or v_internal_definition not like '%preliminary_quote_before_technical_visit%'
     or v_internal_definition not like '%technical_visit%' then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: shared quote-kind authority reader is not anchored to canonical current projections';
  end if;

  if v_generation_definition not like '%p9_read_sales_quote_kind_authority_internal%'
     or v_generation_definition like '%commercial_opportunity_checklist_current%'
     or v_generation_definition like '%commercial_opportunity_checklist_progress_current%' then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: generation resolver does not delegate exclusively to shared quote-kind authority';
  end if;

  if v_readiness_definition not like '%p9_read_sales_quote_kind_authority_internal%'
     or v_readiness_definition like '%commercial_opportunity_checklist_current%'
     or v_readiness_definition like '%commercial_opportunity_checklist_progress_current%' then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: send readiness does not delegate exclusively to shared quote-kind authority';
  end if;

  if v_generation_definition like '%sales_quote_versions%' then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: generation resolver depends on an existing quote version';
  end if;

  if v_approval_definition not like '%sales_quote_version_is_expired%'
     or position('sales_quote_version_is_expired' in v_approval_definition)
        > position('update public.sales_quote_versions' in v_approval_definition) then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: approval writer does not block expiration before lifecycle mutation';
  end if;

  if v_send_definition not like '%sales_quote_version_is_expired%'
     or position('sales_quote_version_is_expired' in v_send_definition)
        > position('insert_message' in v_send_definition) then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: send materialization does not block expiration before outbound effects';
  end if;

  if has_function_privilege('authenticated', 'public.resolve_sales_quote_kind_for_generation_by_system(uuid,uuid,uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.materialize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.read_quote_kind_send_readiness_scoped(uuid,uuid,uuid,uuid)', 'execute') then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: authenticated can execute a service-only P9 6.4 function';
  end if;

  if not has_function_privilege('service_role', 'public.resolve_sales_quote_kind_for_generation_by_system(uuid,uuid,uuid,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.materialize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.read_quote_kind_send_readiness_scoped(uuid,uuid,uuid,uuid)', 'execute') then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: service_role lost required P9 6.4 execute privilege';
  end if;

  if has_function_privilege('service_role', 'public.p9_read_sales_quote_kind_authority_internal(uuid,uuid,uuid)', 'execute')
     or has_function_privilege('service_role', 'public.resolve_sales_quote_version_valid_until(jsonb,date)', 'execute')
     or has_function_privilege('service_role', 'public.sales_quote_version_is_expired(jsonb,date,date)', 'execute') then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: internal P9 6.4 helpers are directly executable by service_role';
  end if;
end;
$postconditions$;

commit;

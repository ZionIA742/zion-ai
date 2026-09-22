-- ZION P9 / Bloco 6 / Etapa 6.4
-- Manual checks for the corrective fail-closed authority-chain patch.
-- Run after 20260922174500_p9_quote_kind_generation_fail_closed_authority_chain.sql.
-- All fixture mutations are rolled back.

begin;

do $checks$
declare
  v_definition text;
  v_quote public.sales_quotes%rowtype;
  v_state text;
  v_kind text;
  v_reason text;
  v_blocking jsonb;
  v_fp text;
  v_versions_before bigint;
  v_versions_after bigint;
begin
  v_definition := pg_get_functiondef(
    'public.resolve_sales_quote_kind_for_generation_by_system(uuid,uuid,uuid,uuid)'::regprocedure
  );

  if v_definition not like '%quote_kind_profile_current_missing%'
     or v_definition not like '%quote_kind_checklist_current_missing%' then
    raise exception
      'scenario 1 failed: fail-closed authority-chain guards are absent';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.resolve_sales_quote_kind_for_generation_by_system(uuid,uuid,uuid,uuid)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.resolve_sales_quote_kind_for_generation_by_system(uuid,uuid,uuid,uuid)',
       'execute'
     ) then
    raise exception
      'scenario 2 failed: resolver privilege contract changed';
  end if;

  select quote_row.*
    into v_quote
    from public.sales_quotes quote_row
    join public.commercial_opportunity_profile_current profile_current
      on profile_current.organization_id = quote_row.organization_id
     and profile_current.store_id = quote_row.store_id
     and profile_current.commercial_opportunity_id = quote_row.commercial_opportunity_id
     and profile_current.current_profile_version_id is not null
    join public.commercial_opportunity_checklist_current checklist_current
      on checklist_current.organization_id = quote_row.organization_id
     and checklist_current.store_id = quote_row.store_id
     and checklist_current.commercial_opportunity_id = quote_row.commercial_opportunity_id
     and checklist_current.current_checklist_version_id is not null
   where quote_row.commercial_opportunity_id is not null
   order by quote_row.created_at desc
   limit 1;

  if not found then
    raise exception
      'precondition failed: scenarios 3-5 require one quote with current Profile and checklist';
  end if;

  select count(*)
    into v_versions_before
    from public.sales_quote_versions
   where quote_id = v_quote.id;

  -- Remove only the checklist pointer, transactionally.
  delete from public.commercial_opportunity_checklist_current
   where organization_id = v_quote.organization_id
     and store_id = v_quote.store_id
     and commercial_opportunity_id = v_quote.commercial_opportunity_id;

  select resolution_state, quote_kind, reason_code, blocking_items, authority_fingerprint
    into v_state, v_kind, v_reason, v_blocking, v_fp
    from public.resolve_sales_quote_kind_for_generation_by_system(
      v_quote.organization_id,
      v_quote.store_id,
      v_quote.commercial_opportunity_id,
      v_quote.id
    );

  if v_state is distinct from 'needs_resolution'
     or v_kind is not null
     or v_reason is distinct from 'quote_kind_checklist_current_missing'
     or coalesce(jsonb_array_length(v_blocking), 0) = 0
     or v_fp is null then
    raise exception
      'scenario 3 failed: missing checklist did not fail closed: state=%, kind=%, reason=%',
      v_state, v_kind, v_reason;
  end if;

  -- Remove Profile too. Profile absence must take precedence and remain closed.
  delete from public.commercial_opportunity_profile_current
   where organization_id = v_quote.organization_id
     and store_id = v_quote.store_id
     and commercial_opportunity_id = v_quote.commercial_opportunity_id;

  select resolution_state, quote_kind, reason_code, blocking_items, authority_fingerprint
    into v_state, v_kind, v_reason, v_blocking, v_fp
    from public.resolve_sales_quote_kind_for_generation_by_system(
      v_quote.organization_id,
      v_quote.store_id,
      v_quote.commercial_opportunity_id,
      v_quote.id
    );

  if v_state is distinct from 'needs_resolution'
     or v_kind is not null
     or v_reason is distinct from 'quote_kind_profile_current_missing'
     or coalesce(jsonb_array_length(v_blocking), 0) = 0
     or v_fp is null then
    raise exception
      'scenario 4 failed: missing Profile did not fail closed: state=%, kind=%, reason=%',
      v_state, v_kind, v_reason;
  end if;

  select count(*)
    into v_versions_after
    from public.sales_quote_versions
   where quote_id = v_quote.id;

  if v_versions_after is distinct from v_versions_before then
    raise exception
      'scenario 5 failed: resolver mutated sales_quote_versions';
  end if;
end;
$checks$;

rollback;

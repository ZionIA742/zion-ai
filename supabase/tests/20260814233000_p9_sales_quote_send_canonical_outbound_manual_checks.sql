begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public;

create temp table pg_temp._p9_quote_send_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
) on commit drop;

create or replace function pg_temp._p9_quote_send_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_quote_send_results (
    scenario_number,
    scenario_name,
    status,
    details
  ) values (
    p_scenario_number,
    p_scenario_name,
    p_status,
    p_details
  )
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      details = excluded.details;
end;
$function$;

create or replace function pg_temp._p9_quote_send_exec_json_sql(
  p_role text,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_json jsonb,
  returned_sqlstate text,
  message_text text,
  constraint_name text
)
language plpgsql
as $function$
declare
  v_value jsonb;
  v_state text;
  v_message text;
  v_constraint text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query select false, null::jsonb, null::text,
      'runner helper must start as postgres'::text, null::text;
    return;
  end if;

  if p_role not in ('anon', 'authenticated', 'service_role') then
    return query select false, null::jsonb, null::text,
      'unsupported role'::text, null::text;
    return;
  end if;

  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', p_role)::text,
    true
  );
  execute format('set local role %I', p_role);

  begin
    execute format('select to_jsonb(result_row) from (%s) result_row', p_sql)
      into v_value;
    execute 'reset role';
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    return query select true, v_value, null::text, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      execute 'reset role';
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '', true);
      return query select false, null::jsonb, v_state, v_message, v_constraint;
  end;
exception
  when others then
    begin
      execute 'reset role';
    exception when others then null;
    end;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    return query select false, null::jsonb, sqlstate::text,
      ('runner helper error: ' || sqlerrm)::text, null::text;
end;
$function$;

create or replace function pg_temp._p9_quote_send_key(
  p_organization_id uuid,
  p_store_id uuid,
  p_opportunity_id uuid,
  p_quote_id uuid,
  p_version_id uuid
)
returns text
language sql
immutable
as $function$
  select
    'sales_quote_send:'
    || p_organization_id::text || ':'
    || p_store_id::text || ':'
    || p_opportunity_id::text || ':'
    || p_quote_id::text || ':'
    || p_version_id::text;
$function$;

-- --------------------------------------------------------------------------
-- Structural compatibility: prove the new protocol exists without mutating
-- the legacy RPC contracts that older callers still depend on.
-- --------------------------------------------------------------------------
do $structure$
declare
  v_columns_ok boolean;
  v_index_ok boolean;
  v_state_check_ok boolean;
  v_legacy_pending_result text;
  v_legacy_mark_result text;
  v_v2_pending_result text;
  v_v2_mark_result text;
  v_materialize_result text;
  v_finalize_result text;
  v_legacy_pending_def text;
  v_legacy_mark_def text;
begin
  select count(*) = 11
    into v_columns_ok
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'messages'
    and column_name in (
      'outbound_idempotency_key',
      'outbound_delivery_state',
      'outbound_claimed_at',
      'outbound_claimed_by',
      'outbound_attempt_started_at',
      'outbound_provider_accepted_at',
      'outbound_uncertain_at',
      'outbound_error_text',
      'outbound_commercial_finalized_at',
      'outbound_commercial_error_at',
      'outbound_commercial_error_text'
    );

  select exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'messages_org_store_outbound_idempotency_uidx'
      and lower(regexp_replace(indexdef, '\s+', ' ', 'g')) not like '%deleted_at is null%'
  ) into v_index_ok;

  select exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.messages'::regclass
      and constraint_row.conname = 'messages_outbound_delivery_state_check'
      and lower(pg_catalog.pg_get_constraintdef(constraint_row.oid)) like '%pending%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_row.oid)) like '%processing%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_row.oid)) like '%sent%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_row.oid)) like '%uncertain%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_row.oid)) like '%failed%'
  ) into v_state_check_ok;

  select pg_catalog.pg_get_function_result(
    pg_catalog.to_regprocedure('public.get_pending_external_messages(uuid,uuid)')
  ) into v_legacy_pending_result;
  select pg_catalog.pg_get_function_result(
    pg_catalog.to_regprocedure('public.mark_message_external_sent(uuid,text)')
  ) into v_legacy_mark_result;
  select pg_catalog.pg_get_function_result(
    pg_catalog.to_regprocedure('public.get_pending_external_messages_v2(uuid,uuid,integer,integer)')
  ) into v_v2_pending_result;
  select pg_catalog.pg_get_function_result(
    pg_catalog.to_regprocedure('public.mark_message_external_sent_v2(uuid,uuid,uuid,text)')
  ) into v_v2_mark_result;
  select pg_catalog.pg_get_function_result(
    pg_catalog.to_regprocedure('public.materialize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)')
  ) into v_materialize_result;
  select pg_catalog.pg_get_function_result(
    pg_catalog.to_regprocedure('public.finalize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text)')
  ) into v_finalize_result;

  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.get_pending_external_messages(uuid,uuid)')
  ) into v_legacy_pending_def;
  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.mark_message_external_sent(uuid,text)')
  ) into v_legacy_mark_def;

  perform pg_temp._p9_quote_send_record(1, '11 colunas outbound existem',
    case when v_columns_ok then 'PASS' else 'FAIL' end,
    'mensagens tem estado de transporte e reconciliacao comercial');
  perform pg_temp._p9_quote_send_record(2, 'indice idempotente nao reabre identidade apos soft-delete',
    case when v_index_ok then 'PASS' else 'FAIL' end,
    'indice unico nao possui predicado deleted_at is null');
  perform pg_temp._p9_quote_send_record(3, 'check de delivery state contem cinco estados canonicos',
    case when v_state_check_ok then 'PASS' else 'FAIL' end,
    'pending/processing/sent/uncertain/failed');
  perform pg_temp._p9_quote_send_record(4, 'legacy pending continua presente com assinatura antiga',
    case when v_legacy_pending_result is not null then 'PASS' else 'FAIL' end,
    coalesce(v_legacy_pending_result, '<missing>'));
  perform pg_temp._p9_quote_send_record(5, 'legacy mark continua retornando void',
    case when lower(coalesce(v_legacy_mark_result, '')) = 'void' then 'PASS' else 'FAIL' end,
    coalesce(v_legacy_mark_result, '<missing>'));
  perform pg_temp._p9_quote_send_record(6, 'RPCs v2 e quote-send existem',
    case when v_v2_pending_result is not null
           and lower(coalesce(v_v2_mark_result, '')) = 'jsonb'
           and v_materialize_result is not null
           and v_finalize_result is not null
         then 'PASS' else 'FAIL' end,
    'pending_v2=' || coalesce(v_v2_pending_result, '<missing>')
      || ' mark_v2=' || coalesce(v_v2_mark_result, '<missing>'));
  perform pg_temp._p9_quote_send_record(7, 'legacy RPCs nao foram convertidas em wrappers v2',
    case when position('get_pending_external_messages_v2' in lower(coalesce(v_legacy_pending_def, ''))) = 0
           and position('mark_message_external_sent_v2' in lower(coalesce(v_legacy_mark_def, ''))) = 0
         then 'PASS' else 'FAIL' end,
    'contratos antigos permanecem independentes');
  perform pg_temp._p9_quote_send_record(8, 'surface nova e system-only',
    case when pg_catalog.has_function_privilege('service_role', 'public.get_pending_external_messages_v2(uuid,uuid,integer,integer)', 'EXECUTE')
           and pg_catalog.has_function_privilege('service_role', 'public.mark_message_external_sent_v2(uuid,uuid,uuid,text)', 'EXECUTE')
           and pg_catalog.has_function_privilege('service_role', 'public.materialize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)', 'EXECUTE')
           and pg_catalog.has_function_privilege('service_role', 'public.finalize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text)', 'EXECUTE')
           and not pg_catalog.has_function_privilege('anon', 'public.materialize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)', 'EXECUTE')
           and not pg_catalog.has_function_privilege('authenticated', 'public.finalize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text)', 'EXECUTE')
         then 'PASS' else 'FAIL' end,
    'service_role executa; anon/authenticated nao executam');
end;
$structure$;

-- --------------------------------------------------------------------------
-- Functional fixtures. All rows are runner-owned and the whole runner ends in
-- ROLLBACK, so no production fixture survives.
-- --------------------------------------------------------------------------
do $functional$
declare
  v_run uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();

  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_customer_a uuid := gen_random_uuid();
  v_customer_b uuid := gen_random_uuid();
  v_lead_a uuid := gen_random_uuid();
  v_lead_a2 uuid := gen_random_uuid();
  v_lead_b uuid := gen_random_uuid();
  v_conv_a uuid := gen_random_uuid();
  v_conv_a2 uuid := gen_random_uuid();
  v_conv_b uuid := gen_random_uuid();

  v_opp_main uuid := gen_random_uuid();
  v_opp_other uuid := gen_random_uuid();
  v_opp_b uuid := gen_random_uuid();
  v_opp_lineage_a uuid := gen_random_uuid();
  v_opp_lineage_b uuid := gen_random_uuid();
  v_opp_tie uuid := gen_random_uuid();

  v_quote_main uuid := gen_random_uuid();
  v_ver_main uuid := gen_random_uuid();
  v_quote_soft uuid := gen_random_uuid();
  v_ver_soft uuid := gen_random_uuid();
  v_quote_nosent uuid := gen_random_uuid();
  v_ver_nosent uuid := gen_random_uuid();
  v_quote_lineage_a uuid := gen_random_uuid();
  v_ver_lineage_a1 uuid := gen_random_uuid();
  v_ver_lineage_a2 uuid := gen_random_uuid();
  v_quote_lineage_b uuid := gen_random_uuid();
  v_ver_lineage_b1 uuid := gen_random_uuid();
  v_ver_lineage_b2 uuid := gen_random_uuid();
  v_quote_tie_existing uuid := gen_random_uuid();
  v_ver_tie_existing uuid := gen_random_uuid();
  v_quote_tie_new uuid := gen_random_uuid();
  v_ver_tie_new uuid := gen_random_uuid();

  v_task_same uuid := gen_random_uuid();
  v_task_other uuid := gen_random_uuid();

  v_msg_main uuid;
  v_msg_soft uuid;
  v_msg_nosent uuid;
  v_msg_lineage_a1 uuid;
  v_msg_lineage_b1 uuid;
  v_msg_lineage_b2 uuid;
  v_msg_tie_new uuid;

  v_key_main text;
  v_key_soft text;
  v_key_nosent text;
  v_key_lineage_a1 text;
  v_key_lineage_b1 text;
  v_key_lineage_b2 text;
  v_key_tie_new text;

  v_exec record;
  v_row record;
  v_json jsonb;
  v_count integer;
  v_count_other integer;
  v_provider_at timestamptz;
  v_sent_at timestamptz;
  v_state text;
  v_error text;
  v_before_quote_status text;
  v_before_quote_sent_at timestamptz;
  v_projection_outcome text;
  v_pointer_quote uuid;
  v_pointer_version uuid;
begin
  insert into public.organizations (id, name)
  values
    (v_org_a, 'Runner P9 Quote Send Org A ' || v_run::text),
    (v_org_b, 'Runner P9 Quote Send Org B ' || v_run::text);

  insert into public.stores (id, organization_id, name, created_at)
  values
    (v_store_a, v_org_a, 'Runner P9 Quote Send Store A ' || v_run::text, v_now),
    (v_store_b, v_org_b, 'Runner P9 Quote Send Store B ' || v_run::text, v_now);

  insert into public.customers (id, organization_id, display_name, normalized_name)
  values
    (v_customer_a, v_org_a, 'Runner Quote Send Customer A', 'runner-quote-send-a-' || replace(v_run::text, '-', '')),
    (v_customer_b, v_org_b, 'Runner Quote Send Customer B', 'runner-quote-send-b-' || replace(v_run::text, '-', ''));

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  values
    (v_org_a, v_store_a, v_customer_a),
    (v_org_b, v_store_b, v_customer_b);

  insert into public.leads (id, organization_id, store_id, name, phone, state)
  values
    (v_lead_a, v_org_a, v_store_a, 'Runner Quote Lead A', '5511990000101', 'orcamento'),
    (v_lead_a2, v_org_a, v_store_a, 'Runner Quote Lead A2', '5511990000102', 'orcamento'),
    (v_lead_b, v_org_b, v_store_b, 'Runner Quote Lead B', '5511990000201', 'orcamento');

  insert into public.conversations (id, organization_id, lead_id, status, is_human_active, created_at)
  values
    (v_conv_a, v_org_a, v_lead_a, 'orcamento', false, v_now),
    (v_conv_a2, v_org_a, v_lead_a2, 'orcamento', false, v_now),
    (v_conv_b, v_org_b, v_lead_b, 'orcamento', false, v_now);

  -- O trigger legado trg_create_initial_state cria conversation_states em
  -- novo_lead para toda conversa nova. Estes fixtures representam conversas
  -- que já chegaram a orçamento; portanto sincronizamos somente o espelho
  -- legado necessário para validar conversation_events, sem mudar a fonte
  -- canônica comercial (commercial_opportunities.stage).
  perform set_config('app.allow_state_update', 'true', true);

  update public.conversation_states as conversation_state_row
     set state = 'orcamento',
         entered_at = v_now,
         updated_at = v_now
   where (
       conversation_state_row.organization_id = v_org_a
       and conversation_state_row.conversation_id in (v_conv_a, v_conv_a2)
     )
      or (
       conversation_state_row.organization_id = v_org_b
       and conversation_state_row.conversation_id = v_conv_b
     );

  perform set_config('app.allow_state_update', 'false', true);

  insert into public.commercial_opportunities (id, organization_id, store_id, customer_id, stage)
  values
    (v_opp_main, v_org_a, v_store_a, v_customer_a, 'orcamento'),
    (v_opp_other, v_org_a, v_store_a, v_customer_a, 'orcamento'),
    (v_opp_b, v_org_b, v_store_b, v_customer_b, 'orcamento'),
    (v_opp_lineage_a, v_org_a, v_store_a, v_customer_a, 'orcamento'),
    (v_opp_lineage_b, v_org_a, v_store_a, v_customer_a, 'orcamento'),
    (v_opp_tie, v_org_a, v_store_a, v_customer_a, 'orcamento');

  insert into public.sales_quotes (
    id, organization_id, store_id, commercial_opportunity_id,
    conversation_id, lead_id, quote_number, title, status,
    customer_name, customer_phone, customer_notes, internal_notes,
    subtotal_cents, discount_cents, total_cents, current_version_id, metadata
  )
  values
    (v_quote_main, v_org_a, v_store_a, v_opp_main, v_conv_a, v_lead_a,
     'QMAIN-' || replace(v_quote_main::text, '-', ''), 'Main quote', 'draft',
     'Runner A', '5511990000101', null, null, 10000, 0, 10000, null,
     jsonb_build_object('runner', v_run, 'fixture', 'main')),
    (v_quote_soft, v_org_a, v_store_a, v_opp_main, v_conv_a, v_lead_a,
     'QSOFT-' || replace(v_quote_soft::text, '-', ''), 'Soft delete quote', 'draft',
     'Runner A', '5511990000101', null, null, 11000, 0, 11000, null,
     jsonb_build_object('runner', v_run, 'fixture', 'soft')),
    (v_quote_nosent, v_org_a, v_store_a, v_opp_main, v_conv_a, v_lead_a,
     'QNOSENT-' || replace(v_quote_nosent::text, '-', ''), 'No provider quote', 'draft',
     'Runner A', '5511990000101', null, null, 12000, 0, 12000, null,
     jsonb_build_object('runner', v_run, 'fixture', 'nosent')),
    (v_quote_lineage_a, v_org_a, v_store_a, v_opp_lineage_a, v_conv_a, v_lead_a,
     'QLINA-' || replace(v_quote_lineage_a::text, '-', ''), 'Lineage A', 'draft',
     'Runner A', '5511990000101', null, null, 13000, 0, 13000, null,
     jsonb_build_object('runner', v_run, 'fixture', 'lineage_a')),
    (v_quote_lineage_b, v_org_a, v_store_a, v_opp_lineage_b, v_conv_a, v_lead_a,
     'QLINB-' || replace(v_quote_lineage_b::text, '-', ''), 'Lineage B', 'draft',
     'Runner A', '5511990000101', null, null, 14000, 0, 14000, null,
     jsonb_build_object('runner', v_run, 'fixture', 'lineage_b')),
    (v_quote_tie_existing, v_org_a, v_store_a, v_opp_tie, v_conv_a, v_lead_a,
     'QTIEE-' || replace(v_quote_tie_existing::text, '-', ''), 'Tie existing', 'sent',
     'Runner A', '5511990000101', null, null, 15000, 0, 15000, null,
     jsonb_build_object('runner', v_run, 'fixture', 'tie_existing')),
    (v_quote_tie_new, v_org_a, v_store_a, v_opp_tie, v_conv_a, v_lead_a,
     'QTIEN-' || replace(v_quote_tie_new::text, '-', ''), 'Tie new', 'draft',
     'Runner A', '5511990000101', null, null, 16000, 0, 16000, null,
     jsonb_build_object('runner', v_run, 'fixture', 'tie_new'));

  insert into public.sales_quote_versions (
    id, quote_id, organization_id, store_id, version_number, status,
    store_file_id, storage_bucket, storage_path, original_filename,
    mime_type, size_bytes, quote_snapshot, created_at, sent_at
  )
  values
    (v_ver_main, v_quote_main, v_org_a, v_store_a, 1, 'generated', null,
     'zion-store-files', v_org_a::text || '/' || v_store_a::text || '/sales-quotes/' || v_quote_main::text || '/main-v0001.pdf',
     'main-v0001.pdf', 'application/pdf', 1000, '{}'::jsonb, v_now, null),
    (v_ver_soft, v_quote_soft, v_org_a, v_store_a, 1, 'generated', null,
     'zion-store-files', v_org_a::text || '/' || v_store_a::text || '/sales-quotes/' || v_quote_soft::text || '/soft-v0001.pdf',
     'soft-v0001.pdf', 'application/pdf', 1000, '{}'::jsonb, v_now, null),
    (v_ver_nosent, v_quote_nosent, v_org_a, v_store_a, 1, 'generated', null,
     'zion-store-files', v_org_a::text || '/' || v_store_a::text || '/sales-quotes/' || v_quote_nosent::text || '/nosent-v0001.pdf',
     'nosent-v0001.pdf', 'application/pdf', 1000, '{}'::jsonb, v_now, null),
    (v_ver_lineage_a1, v_quote_lineage_a, v_org_a, v_store_a, 1, 'generated', null,
     'zion-store-files', v_org_a::text || '/' || v_store_a::text || '/sales-quotes/' || v_quote_lineage_a::text || '/lineage-a-v0001.pdf',
     'lineage-a-v0001.pdf', 'application/pdf', 1000, '{}'::jsonb, v_now, null),
    (v_ver_lineage_b1, v_quote_lineage_b, v_org_a, v_store_a, 1, 'generated', null,
     'zion-store-files', v_org_a::text || '/' || v_store_a::text || '/sales-quotes/' || v_quote_lineage_b::text || '/lineage-b-v0001.pdf',
     'lineage-b-v0001.pdf', 'application/pdf', 1000, '{}'::jsonb, v_now, null),
    (v_ver_tie_existing, v_quote_tie_existing, v_org_a, v_store_a, 1, 'sent', null,
     'zion-store-files', v_org_a::text || '/' || v_store_a::text || '/sales-quotes/' || v_quote_tie_existing::text || '/tie-existing-v0001.pdf',
     'tie-existing-v0001.pdf', 'application/pdf', 1000, '{}'::jsonb, v_now, v_now + interval '2 hours'),
    (v_ver_tie_new, v_quote_tie_new, v_org_a, v_store_a, 1, 'generated', null,
     'zion-store-files', v_org_a::text || '/' || v_store_a::text || '/sales-quotes/' || v_quote_tie_new::text || '/tie-new-v0001.pdf',
     'tie-new-v0001.pdf', 'application/pdf', 1000, '{}'::jsonb, v_now, null);

  update public.sales_quotes
  set current_version_id = case id
    when v_quote_main then v_ver_main
    when v_quote_soft then v_ver_soft
    when v_quote_nosent then v_ver_nosent
    when v_quote_lineage_a then v_ver_lineage_a1
    when v_quote_lineage_b then v_ver_lineage_b1
    when v_quote_tie_existing then v_ver_tie_existing
    when v_quote_tie_new then v_ver_tie_new
    else current_version_id
  end,
  sent_at = case when id = v_quote_tie_existing then v_now + interval '2 hours' else sent_at end
  where id in (
    v_quote_main, v_quote_soft, v_quote_nosent,
    v_quote_lineage_a, v_quote_lineage_b,
    v_quote_tie_existing, v_quote_tie_new
  );

  v_key_main := pg_temp._p9_quote_send_key(v_org_a, v_store_a, v_opp_main, v_quote_main, v_ver_main);
  v_key_soft := pg_temp._p9_quote_send_key(v_org_a, v_store_a, v_opp_main, v_quote_soft, v_ver_soft);
  v_key_nosent := pg_temp._p9_quote_send_key(v_org_a, v_store_a, v_opp_main, v_quote_nosent, v_ver_nosent);
  v_key_lineage_a1 := pg_temp._p9_quote_send_key(v_org_a, v_store_a, v_opp_lineage_a, v_quote_lineage_a, v_ver_lineage_a1);
  v_key_lineage_b1 := pg_temp._p9_quote_send_key(v_org_a, v_store_a, v_opp_lineage_b, v_quote_lineage_b, v_ver_lineage_b1);
  v_key_tie_new := pg_temp._p9_quote_send_key(v_org_a, v_store_a, v_opp_tie, v_quote_tie_new, v_ver_tie_new);

  -- 9/10/11: authorization.
  select * into v_exec from pg_temp._p9_quote_send_exec_json_sql(
    'anon',
    format($sql$
      select * from public.materialize_sales_quote_send_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'runner', '{}'::jsonb, %L, 'sales_quote_send_route'
      )
    $sql$, v_org_a, v_store_a, v_opp_main, v_conv_a, v_quote_main, v_ver_main, v_key_main)
  );
  perform pg_temp._p9_quote_send_record(9, 'anon nao materializa quote-send',
    case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '42501' then 'PASS' else 'FAIL' end,
    coalesce(v_exec.returned_sqlstate, '<none>') || ' ' || coalesce(v_exec.message_text, ''));

  select * into v_exec from pg_temp._p9_quote_send_exec_json_sql(
    'authenticated',
    format($sql$
      select * from public.materialize_sales_quote_send_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'runner', '{}'::jsonb, %L, 'sales_quote_send_route'
      )
    $sql$, v_org_a, v_store_a, v_opp_main, v_conv_a, v_quote_main, v_ver_main, v_key_main)
  );
  perform pg_temp._p9_quote_send_record(10, 'authenticated nao materializa quote-send',
    case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '42501' then 'PASS' else 'FAIL' end,
    coalesce(v_exec.returned_sqlstate, '<none>') || ' ' || coalesce(v_exec.message_text, ''));

  select * into v_exec from pg_temp._p9_quote_send_exec_json_sql(
    'service_role',
    format($sql$
      select * from public.materialize_sales_quote_send_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'Segue o orcamento em PDF para voce conferir.',
        jsonb_build_object('quote_number','RUNNER-MAIN','storage_bucket','tamper-is-overwritten'),
        %L,'sales_quote_send_route'
      )
    $sql$, v_org_a, v_store_a, v_opp_main, v_conv_a, v_quote_main, v_ver_main, v_key_main)
  );
  v_msg_main := nullif(v_exec.value_json ->> 'message_id', '')::uuid;
  perform pg_temp._p9_quote_send_record(11, 'service_role materializa quote-send',
    case when v_exec.operation_succeeded
           and v_exec.value_json ->> 'outcome' = 'queued'
           and v_msg_main is not null then 'PASS' else 'FAIL' end,
    coalesce(v_exec.value_json::text, v_exec.message_text, '<null>'));

  -- 12/13: canonical document and caller metadata cannot override authoritative PDF scope.
  select * into v_row from public.messages where id = v_msg_main;
  perform pg_temp._p9_quote_send_record(12, 'materializer cria mensagem document pendente',
    case when v_row.organization_id = v_org_a
           and v_row.store_id = v_store_a
           and v_row.conversation_id = v_conv_a
           and v_row.sender = 'human'
           and v_row.direction = 'outgoing'
           and v_row.message_type = 'document'
           and v_row.outbound_delivery_state = 'pending'
           and v_row.outbound_idempotency_key = v_key_main
           and v_row.external_message_id is null
         then 'PASS' else 'FAIL' end,
    format('message=%s type=%s state=%s', v_row.id, v_row.message_type, v_row.outbound_delivery_state));
  perform pg_temp._p9_quote_send_record(13, 'PDF canonico vem da quote version e nao do caller',
    case when v_row.media_url = (
               select storage_path from public.sales_quote_versions where id = v_ver_main
             )
           and v_row.metadata ->> 'storage_bucket' = 'zion-store-files'
           and v_row.metadata ->> 'mime_type' = 'application/pdf'
           and v_row.metadata ->> 'sales_quote_id' = v_quote_main::text
           and v_row.metadata ->> 'sales_quote_version_id' = v_ver_main::text
           and v_row.metadata ->> 'commercial_opportunity_id' = v_opp_main::text
         then 'PASS' else 'FAIL' end,
    coalesce(v_row.metadata::text, '<null>'));

  -- 14: same key replays exactly the same operation.
  select * into v_exec from pg_temp._p9_quote_send_exec_json_sql(
    'service_role',
    format($sql$
      select * from public.materialize_sales_quote_send_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'Segue o orcamento em PDF para voce conferir.', '{}'::jsonb,
        %L,'sales_quote_send_route'
      )
    $sql$, v_org_a, v_store_a, v_opp_main, v_conv_a, v_quote_main, v_ver_main, v_key_main)
  );
  perform pg_temp._p9_quote_send_record(14, 'replay idempotente devolve a mesma mensagem',
    case when v_exec.operation_succeeded
           and v_exec.value_json ->> 'outcome' = 'already_queued'
           and (v_exec.value_json ->> 'message_id')::uuid = v_msg_main
         then 'PASS' else 'FAIL' end,
    coalesce(v_exec.value_json::text, v_exec.message_text, '<null>'));

  -- 15/16/17/18: fail-closed scope and source.
  select * into v_exec from pg_temp._p9_quote_send_exec_json_sql(
    'service_role',
    format($sql$
      select * from public.materialize_sales_quote_send_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'runner','{}'::jsonb,'runner-invalid-key','sales_quote_send_route')
    $sql$, v_org_a, v_store_a, v_opp_main, v_conv_a, v_quote_main, v_ver_main)
  );
  perform pg_temp._p9_quote_send_record(15, 'chave arbitraria e rejeitada',
    case when not v_exec.operation_succeeded and v_exec.message_text = 'SALES_QUOTE_SEND_IDEMPOTENCY_KEY_INVALID' then 'PASS' else 'FAIL' end,
    coalesce(v_exec.returned_sqlstate, '') || ' ' || coalesce(v_exec.message_text, ''));

  select * into v_exec from pg_temp._p9_quote_send_exec_json_sql(
    'service_role',
    format($sql$
      select * from public.materialize_sales_quote_send_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'runner','{}'::jsonb,%L,'wrong_source')
    $sql$, v_org_a, v_store_a, v_opp_main, v_conv_a, v_quote_main, v_ver_main, v_key_main)
  );
  perform pg_temp._p9_quote_send_record(16, 'source nao canonica e rejeitada',
    case when not v_exec.operation_succeeded and v_exec.message_text = 'SALES_QUOTE_SEND_SOURCE_INVALID' then 'PASS' else 'FAIL' end,
    coalesce(v_exec.returned_sqlstate, '') || ' ' || coalesce(v_exec.message_text, ''));

  select * into v_exec from pg_temp._p9_quote_send_exec_json_sql(
    'service_role',
    format($sql$
      select * from public.materialize_sales_quote_send_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'runner','{}'::jsonb,%L,'sales_quote_send_route')
    $sql$, v_org_a, v_store_a, v_opp_other, v_conv_a, v_quote_main, v_ver_main,
      pg_temp._p9_quote_send_key(v_org_a, v_store_a, v_opp_other, v_quote_main, v_ver_main))
  );
  perform pg_temp._p9_quote_send_record(17, 'quote nao pode ser materializada em opportunity errada',
    case when not v_exec.operation_succeeded then 'PASS' else 'FAIL' end,
    coalesce(v_exec.returned_sqlstate, '') || ' ' || coalesce(v_exec.message_text, ''));

  select * into v_exec from pg_temp._p9_quote_send_exec_json_sql(
    'service_role',
    format($sql$
      select * from public.materialize_sales_quote_send_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'runner','{}'::jsonb,%L,'sales_quote_send_route')
    $sql$, v_org_a, v_store_b, v_opp_main, v_conv_a, v_quote_main, v_ver_main,
      pg_temp._p9_quote_send_key(v_org_a, v_store_b, v_opp_main, v_quote_main, v_ver_main))
  );
  perform pg_temp._p9_quote_send_record(18, 'cross-store e rejeitado',
    case when not v_exec.operation_succeeded then 'PASS' else 'FAIL' end,
    coalesce(v_exec.returned_sqlstate, '') || ' ' || coalesce(v_exec.message_text, ''));

  -- 19/20: soft delete must not create a second logical operation.
  select * into v_row from public.materialize_sales_quote_send_by_system(
    v_org_a, v_store_a, v_opp_main, v_conv_a, v_quote_soft, v_ver_soft,
    'Runner soft delete', '{}'::jsonb, v_key_soft, 'sales_quote_send_route'
  );
  v_msg_soft := v_row.message_id;
  update public.messages set deleted_at = clock_timestamp() where id = v_msg_soft;
  begin
    perform * from public.materialize_sales_quote_send_by_system(
      v_org_a, v_store_a, v_opp_main, v_conv_a, v_quote_soft, v_ver_soft,
      'Runner soft delete', '{}'::jsonb, v_key_soft, 'sales_quote_send_route'
    );
    perform pg_temp._p9_quote_send_record(19, 'soft-delete nao reabre a mesma operacao', 'FAIL', 'segunda materializacao foi aceita');
  exception when others then
    perform pg_temp._p9_quote_send_record(19, 'soft-delete nao reabre a mesma operacao',
      case when sqlerrm = 'SALES_QUOTE_SEND_SOFT_DELETED_OPERATION_ALREADY_EXISTS' then 'PASS' else 'FAIL' end,
      sqlstate || ' ' || sqlerrm);
  end;
  select count(*) into v_count from public.messages
  where organization_id = v_org_a and store_id = v_store_a and outbound_idempotency_key = v_key_soft;
  perform pg_temp._p9_quote_send_record(20, 'soft-delete conserva unicidade fisica da operacao',
    case when v_count = 1 then 'PASS' else 'FAIL' end,
    'rows=' || v_count::text);

  -- 21/22/23: pending v2 supports document and lease reclaim but never uncertain.
  select count(*) into v_count
  from public.get_pending_external_messages_v2(v_org_a, v_store_a, 100, 600) pending
  where pending.message_id = v_msg_main and pending.message_type = 'document';
  perform pg_temp._p9_quote_send_record(21, 'pending v2 retorna PDF document canonico',
    case when v_count = 1 then 'PASS' else 'FAIL' end, 'rows=' || v_count::text);

  update public.messages
  set outbound_delivery_state = 'processing',
      outbound_claimed_at = clock_timestamp() - interval '20 minutes',
      outbound_attempt_started_at = null
  where id = v_msg_main;
  select count(*) into v_count
  from public.get_pending_external_messages_v2(v_org_a, v_store_a, 100, 600) pending
  where pending.message_id = v_msg_main;
  perform pg_temp._p9_quote_send_record(22, 'processing stale sem attempt pode ser reclaimed',
    case when v_count = 1 then 'PASS' else 'FAIL' end, 'rows=' || v_count::text);

  update public.messages
  set outbound_delivery_state = 'uncertain',
      outbound_claimed_at = null,
      outbound_attempt_started_at = clock_timestamp(),
      outbound_uncertain_at = clock_timestamp()
  where id = v_msg_main;
  select count(*) into v_count
  from public.get_pending_external_messages_v2(v_org_a, v_store_a, 100, 600) pending
  where pending.message_id = v_msg_main;
  perform pg_temp._p9_quote_send_record(23, 'uncertain nunca volta ao pending automaticamente',
    case when v_count = 0 then 'PASS' else 'FAIL' end, 'rows=' || v_count::text);

  -- 24: before attempt evidence must fail. Use a fresh no-provider message.
  select * into v_row from public.materialize_sales_quote_send_by_system(
    v_org_a, v_store_a, v_opp_main, v_conv_a, v_quote_nosent, v_ver_nosent,
    'Runner no sent', '{}'::jsonb, v_key_nosent, 'sales_quote_send_route'
  );
  v_msg_nosent := v_row.message_id;
  begin
    perform public.mark_message_external_sent_v2(v_org_a, v_store_a, v_msg_nosent, 'wamid-before-attempt');
    perform pg_temp._p9_quote_send_record(24, 'provider sent exige attempt evidence', 'FAIL', 'mark sent foi aceito antes de attempt');
  exception when others then
    perform pg_temp._p9_quote_send_record(24, 'provider sent exige attempt evidence',
      case when sqlerrm = 'MESSAGE_EXTERNAL_ATTEMPT_EVIDENCE_REQUIRED' then 'PASS' else 'FAIL' end,
      sqlstate || ' ' || sqlerrm);
  end;

  -- 25: wrong tenant cannot mark even with a valid message id.
  begin
    perform public.mark_message_external_sent_v2(v_org_b, v_store_b, v_msg_main, 'wamid-wrong-tenant');
    perform pg_temp._p9_quote_send_record(25, 'mark sent v2 e tenant-scoped', 'FAIL', 'cross-tenant mark aceito');
  exception when others then
    perform pg_temp._p9_quote_send_record(25, 'mark sent v2 e tenant-scoped',
      case when sqlerrm = 'MESSAGE_NOT_FOUND_IN_SCOPE' then 'PASS' else 'FAIL' end,
      sqlstate || ' ' || sqlerrm);
  end;

  -- 26/27/28: transport source fact succeeds and does not erase commercial error.
  update public.messages
  set outbound_commercial_error_at = clock_timestamp() - interval '1 minute',
      outbound_commercial_error_text = 'projection pending from previous attempt'
  where id = v_msg_main;

  select public.mark_message_external_sent_v2(
    v_org_a, v_store_a, v_msg_main, 'wamid-main'
  ) into v_json;
  select outbound_provider_accepted_at into v_provider_at from public.messages where id = v_msg_main;
  perform pg_temp._p9_quote_send_record(26, 'provider fact e persistido com exact scope',
    case when (v_json ->> 'outbound_delivery_state') = 'sent'
           and (v_json ->> 'external_message_id') = 'wamid-main'
           and v_provider_at is not null then 'PASS' else 'FAIL' end,
    coalesce(v_json::text, '<null>'));

  select outbound_commercial_error_text into v_error from public.messages where id = v_msg_main;
  perform pg_temp._p9_quote_send_record(27, 'transport writer preserva erro comercial pendente',
    case when v_error = 'projection pending from previous attempt' then 'PASS' else 'FAIL' end,
    coalesce(v_error, '<null>'));

  select public.mark_message_external_sent_v2(
    v_org_a, v_store_a, v_msg_main, 'wamid-main'
  ) into v_json;
  perform pg_temp._p9_quote_send_record(28, 'mark sent com mesmo wamid e idempotente',
    case when (v_json ->> 'outcome') = 'already_sent' then 'PASS' else 'FAIL' end,
    coalesce(v_json::text, '<null>'));

  begin
    perform public.mark_message_external_sent_v2(v_org_a, v_store_a, v_msg_main, 'wamid-different');
    perform pg_temp._p9_quote_send_record(29, 'wamid divergente para mensagem ja enviada e rejeitado', 'FAIL', 'id divergente aceito');
  exception when others then
    perform pg_temp._p9_quote_send_record(29, 'wamid divergente para mensagem ja enviada e rejeitado',
      case when sqlerrm = 'MESSAGE_EXTERNAL_ID_ALREADY_DIFFERENT' then 'PASS' else 'FAIL' end,
      sqlstate || ' ' || sqlerrm);
  end;

  -- 30: finalizer cannot run without provider source fact.
  begin
    perform * from public.finalize_sales_quote_send_by_system(
      v_org_a, v_store_a, v_opp_main, v_quote_nosent, v_ver_nosent,
      v_msg_nosent, v_key_nosent, 'system_quote_send_reconciliation'
    );
    perform pg_temp._p9_quote_send_record(30, 'finalizer exige provider fact confirmado', 'FAIL', 'finalizacao sem provider foi aceita');
  exception when others then
    perform pg_temp._p9_quote_send_record(30, 'finalizer exige provider fact confirmado',
      case when sqlerrm = 'SALES_QUOTE_SEND_EXTERNAL_EVIDENCE_REQUIRED' then 'PASS' else 'FAIL' end,
      sqlstate || ' ' || sqlerrm);
  end;

  -- Task isolation before main finalization.
  insert into public.store_assistant_operational_tasks (
    id, organization_id, store_id, thread_id, task_type, status, priority,
    title, description, related_lead_id, related_conversation_id,
    related_appointment_id, customer_name, customer_phone,
    target_date, target_time, target_start_at, target_end_at,
    timezone_name, task_payload, commercial_opportunity_id
  ) values
    (v_task_same, v_org_a, v_store_a, null, 'commercial_quote_request', 'open', 'normal',
     'Runner task same opp', 'same opp', v_lead_a, v_conv_a, null, 'Runner A', '5511990000101',
     null, null, null, null, 'America/Sao_Paulo', '{}'::jsonb, v_opp_main),
    (v_task_other, v_org_a, v_store_a, null, 'commercial_quote_request', 'open', 'normal',
     'Runner task other opp', 'other opp same lead/conv', v_lead_a, v_conv_a, null, 'Runner A', '5511990000101',
     null, null, null, null, 'America/Sao_Paulo', '{}'::jsonb, v_opp_other);

  -- 31/32/33/34/35: valid finalization.
  select status, sent_at into v_before_quote_status, v_before_quote_sent_at
  from public.sales_quotes where id = v_quote_main;

  select * into v_row from public.finalize_sales_quote_send_by_system(
    v_org_a, v_store_a, v_opp_main, v_quote_main, v_ver_main,
    v_msg_main, v_key_main, 'system_quote_send_reconciliation'
  );
  v_projection_outcome := v_row.current_proposal_outcome;
  select sent_at into v_sent_at from public.sales_quote_versions where id = v_ver_main;
  perform pg_temp._p9_quote_send_record(31, 'finalizer usa provider accepted como sent_at da versao',
    case when v_sent_at = v_provider_at then 'PASS' else 'FAIL' end,
    format('provider=%s version_sent=%s', v_provider_at, v_sent_at));

  select count(*) into v_count from public.store_assistant_operational_tasks
  where id = v_task_same and status = 'resolved';
  select count(*) into v_count_other from public.store_assistant_operational_tasks
  where id = v_task_other and status = 'open';
  perform pg_temp._p9_quote_send_record(32, 'task da mesma opportunity e resolvida',
    case when v_count = 1 then 'PASS' else 'FAIL' end, 'resolved=' || v_count::text);
  perform pg_temp._p9_quote_send_record(33, 'task de outra opportunity no mesmo lead/conversation permanece aberta',
    case when v_count_other = 1 then 'PASS' else 'FAIL' end, 'open=' || v_count_other::text);

  select count(*) into v_count from public.conversation_events
  where organization_id = v_org_a
    and conversation_id = v_conv_a
    and event_type = 'orcamento_enviado'
    and payload ->> 'message_id' = v_msg_main::text;
  perform pg_temp._p9_quote_send_record(34, 'evento orcamento_enviado e criado uma vez',
    case when v_count = 1 then 'PASS' else 'FAIL' end, 'events=' || v_count::text);

  select outbound_commercial_finalized_at, outbound_commercial_error_text
  into v_sent_at, v_error
  from public.messages where id = v_msg_main;
  perform pg_temp._p9_quote_send_record(35, 'finalizacao comercial marca sucesso e limpa erro apenas ao concluir',
    case when v_sent_at is not null and v_error is null then 'PASS' else 'FAIL' end,
    format('finalized_at=%s error=%s', v_sent_at, coalesce(v_error, '<null>')));

  select * into v_row from public.finalize_sales_quote_send_by_system(
    v_org_a, v_store_a, v_opp_main, v_quote_main, v_ver_main,
    v_msg_main, v_key_main, 'system_quote_send_reconciliation'
  );
  select count(*) into v_count from public.conversation_events
  where organization_id = v_org_a
    and conversation_id = v_conv_a
    and event_type = 'orcamento_enviado'
    and payload ->> 'message_id' = v_msg_main::text;
  perform pg_temp._p9_quote_send_record(36, 'replay do finalizer e idempotente e nao duplica evento',
    case when v_row.outcome = 'already_finalized' and v_count = 1 then 'PASS' else 'FAIL' end,
    format('outcome=%s events=%s projection=%s', v_row.outcome, v_count, coalesce(v_projection_outcome, '<null>')));

  -- ------------------------------------------------------------------------
  -- 37-39 Lineage A: v1 was queued, v2 only exists internally, v1 actually
  -- reaches the customer. v1 must become Current Commercial Proposal while
  -- aggregate quote remains tied to the newer internal draft.
  -- ------------------------------------------------------------------------
  select * into v_row from public.materialize_sales_quote_send_by_system(
    v_org_a, v_store_a, v_opp_lineage_a, v_conv_a, v_quote_lineage_a, v_ver_lineage_a1,
    'Lineage A v1', '{}'::jsonb, v_key_lineage_a1, 'sales_quote_send_route'
  );
  v_msg_lineage_a1 := v_row.message_id;

  insert into public.sales_quote_versions (
    id, quote_id, organization_id, store_id, version_number, status,
    store_file_id, storage_bucket, storage_path, original_filename,
    mime_type, size_bytes, quote_snapshot, created_at, sent_at
  ) values (
    v_ver_lineage_a2, v_quote_lineage_a, v_org_a, v_store_a, 2, 'generated', null,
    'zion-store-files', v_org_a::text || '/' || v_store_a::text || '/sales-quotes/' || v_quote_lineage_a::text || '/lineage-a-v0002.pdf',
    'lineage-a-v0002.pdf', 'application/pdf', 1000, '{}'::jsonb, v_now + interval '1 minute', null
  );
  update public.sales_quote_versions set status = 'superseded' where id = v_ver_lineage_a1;
  update public.sales_quotes set current_version_id = v_ver_lineage_a2, status = 'draft', sent_at = null where id = v_quote_lineage_a;

  update public.messages
  set outbound_delivery_state = 'uncertain',
      outbound_attempt_started_at = clock_timestamp(),
      outbound_uncertain_at = clock_timestamp()
  where id = v_msg_lineage_a1;
  perform public.mark_message_external_sent_v2(v_org_a, v_store_a, v_msg_lineage_a1, 'wamid-lineage-a1');
  perform * from public.finalize_sales_quote_send_by_system(
    v_org_a, v_store_a, v_opp_lineage_a, v_quote_lineage_a, v_ver_lineage_a1,
    v_msg_lineage_a1, v_key_lineage_a1, 'system_quote_send_reconciliation'
  );

  select current_quote_id, current_quote_version_id
  into v_pointer_quote, v_pointer_version
  from public.commercial_opportunities where id = v_opp_lineage_a;
  perform pg_temp._p9_quote_send_record(37, 'v1 enviada enquanto v2 e apenas draft vira Current Proposal',
    case when v_pointer_quote = v_quote_lineage_a and v_pointer_version = v_ver_lineage_a1 then 'PASS' else 'FAIL' end,
    format('pointer_quote=%s pointer_version=%s', v_pointer_quote, v_pointer_version));

  select status, sent_at into v_state, v_sent_at from public.sales_quotes where id = v_quote_lineage_a;
  perform pg_temp._p9_quote_send_record(38, 'v1 tardia nao marca aggregate da quote se v2 e current interno',
    case when v_state = 'draft' and v_sent_at is null then 'PASS' else 'FAIL' end,
    format('quote_status=%s quote_sent_at=%s', v_state, v_sent_at));
  select status into v_state from public.sales_quote_versions where id = v_ver_lineage_a1;
  perform pg_temp._p9_quote_send_record(39, 'versao superseded preserva status ao ganhar sent_at real',
    case when v_state = 'superseded' then 'PASS' else 'FAIL' end,
    'version_status=' || coalesce(v_state, '<null>'));

  -- ------------------------------------------------------------------------
  -- 40-42 Lineage B: v2 is actually sent first. A later provider acceptance
  -- from queued v1 must remain historical and never replace v2.
  -- ------------------------------------------------------------------------
  select * into v_row from public.materialize_sales_quote_send_by_system(
    v_org_a, v_store_a, v_opp_lineage_b, v_conv_a, v_quote_lineage_b, v_ver_lineage_b1,
    'Lineage B v1 queued', '{}'::jsonb, v_key_lineage_b1, 'sales_quote_send_route'
  );
  v_msg_lineage_b1 := v_row.message_id;

  insert into public.sales_quote_versions (
    id, quote_id, organization_id, store_id, version_number, status,
    store_file_id, storage_bucket, storage_path, original_filename,
    mime_type, size_bytes, quote_snapshot, created_at, sent_at
  ) values (
    v_ver_lineage_b2, v_quote_lineage_b, v_org_a, v_store_a, 2, 'generated', null,
    'zion-store-files', v_org_a::text || '/' || v_store_a::text || '/sales-quotes/' || v_quote_lineage_b::text || '/lineage-b-v0002.pdf',
    'lineage-b-v0002.pdf', 'application/pdf', 1000, '{}'::jsonb, v_now + interval '2 minutes', null
  );
  update public.sales_quote_versions set status = 'superseded' where id = v_ver_lineage_b1;
  update public.sales_quotes set current_version_id = v_ver_lineage_b2 where id = v_quote_lineage_b;
  v_key_lineage_b2 := pg_temp._p9_quote_send_key(v_org_a, v_store_a, v_opp_lineage_b, v_quote_lineage_b, v_ver_lineage_b2);

  select * into v_row from public.materialize_sales_quote_send_by_system(
    v_org_a, v_store_a, v_opp_lineage_b, v_conv_a, v_quote_lineage_b, v_ver_lineage_b2,
    'Lineage B v2', '{}'::jsonb, v_key_lineage_b2, 'sales_quote_send_route'
  );
  v_msg_lineage_b2 := v_row.message_id;
  update public.messages
  set outbound_delivery_state = 'uncertain', outbound_attempt_started_at = clock_timestamp(), outbound_uncertain_at = clock_timestamp()
  where id = v_msg_lineage_b2;
  perform public.mark_message_external_sent_v2(v_org_a, v_store_a, v_msg_lineage_b2, 'wamid-lineage-b2');
  perform * from public.finalize_sales_quote_send_by_system(
    v_org_a, v_store_a, v_opp_lineage_b, v_quote_lineage_b, v_ver_lineage_b2,
    v_msg_lineage_b2, v_key_lineage_b2, 'system_quote_send_reconciliation'
  );

  select current_quote_version_id into v_pointer_version from public.commercial_opportunities where id = v_opp_lineage_b;
  perform pg_temp._p9_quote_send_record(40, 'v2 enviada passa a ser Current Proposal',
    case when v_pointer_version = v_ver_lineage_b2 then 'PASS' else 'FAIL' end,
    'pointer=' || coalesce(v_pointer_version::text, '<null>'));

  -- v1 arrives after v2.
  update public.messages
  set outbound_delivery_state = 'uncertain', outbound_attempt_started_at = clock_timestamp(), outbound_uncertain_at = clock_timestamp()
  where id = v_msg_lineage_b1;
  perform public.mark_message_external_sent_v2(v_org_a, v_store_a, v_msg_lineage_b1, 'wamid-lineage-b1-late');
  select * into v_row from public.finalize_sales_quote_send_by_system(
    v_org_a, v_store_a, v_opp_lineage_b, v_quote_lineage_b, v_ver_lineage_b1,
    v_msg_lineage_b1, v_key_lineage_b1, 'system_quote_send_reconciliation'
  );
  select current_quote_version_id into v_pointer_version from public.commercial_opportunities where id = v_opp_lineage_b;
  perform pg_temp._p9_quote_send_record(41, 'v1 tardia nao substitui v2 ja enviada',
    case when v_pointer_version = v_ver_lineage_b2 then 'PASS' else 'FAIL' end,
    format('finalizer=%s pointer=%s', v_row.current_proposal_outcome, v_pointer_version));
  perform pg_temp._p9_quote_send_record(42, 'finalizer explicita skip de versao anterior da mesma quote',
    case when v_row.current_proposal_outcome = 'stale_older_quote_version_ignored' then 'PASS' else 'FAIL' end,
    coalesce(v_row.current_proposal_outcome, '<null>'));

  -- ------------------------------------------------------------------------
  -- 43-45: projection failure cannot roll back an already-confirmed provider
  -- fact because source fact and commercial finalization are separate calls.
  -- ------------------------------------------------------------------------
  -- First set a valid current proposal for the existing sent quote.
  perform * from public.set_current_commercial_proposal_from_sent_quote_by_system(
    v_org_a, v_store_a, v_opp_tie, v_quote_tie_existing, v_ver_tie_existing,
    'current_commercial_proposal:' || v_opp_tie::text || ':' || v_quote_tie_existing::text || ':' || v_ver_tie_existing::text,
    'runner_existing_tie'
  );

  select * into v_row from public.materialize_sales_quote_send_by_system(
    v_org_a, v_store_a, v_opp_tie, v_conv_a, v_quote_tie_new, v_ver_tie_new,
    'Tie new', '{}'::jsonb, v_key_tie_new, 'sales_quote_send_route'
  );
  v_msg_tie_new := v_row.message_id;
  update public.messages
  set outbound_delivery_state = 'uncertain', outbound_attempt_started_at = clock_timestamp(), outbound_uncertain_at = clock_timestamp()
  where id = v_msg_tie_new;
  perform public.mark_message_external_sent_v2(v_org_a, v_store_a, v_msg_tie_new, 'wamid-tie-new');
  select outbound_provider_accepted_at into v_provider_at from public.messages where id = v_msg_tie_new;

  -- Force exact sent_at tie in a different proposal of the same opportunity.
  update public.sales_quote_versions set sent_at = v_provider_at where id = v_ver_tie_existing;
  update public.sales_quotes set sent_at = v_provider_at where id = v_quote_tie_existing;

  begin
    perform * from public.finalize_sales_quote_send_by_system(
      v_org_a, v_store_a, v_opp_tie, v_quote_tie_new, v_ver_tie_new,
      v_msg_tie_new, v_key_tie_new, 'system_quote_send_reconciliation'
    );
    perform pg_temp._p9_quote_send_record(43, 'empate de send order falha fechado na projection', 'FAIL', 'finalizer aceitou tie ambiguo');
  exception when others then
    perform pg_temp._p9_quote_send_record(43, 'empate de send order falha fechado na projection',
      case when sqlerrm = 'ZION_CURRENT_PROPOSAL_SEND_ORDER_AMBIGUOUS' then 'PASS' else 'FAIL' end,
      sqlstate || ' ' || sqlerrm);
  end;

  select external_message_id, outbound_delivery_state, outbound_provider_accepted_at,
         outbound_commercial_finalized_at
  into v_error, v_state, v_sent_at, v_before_quote_sent_at
  from public.messages where id = v_msg_tie_new;
  perform pg_temp._p9_quote_send_record(44, 'provider fact sobrevive a falha comercial posterior',
    case when v_error = 'wamid-tie-new'
           and v_state = 'sent'
           and v_sent_at is not null
           and v_before_quote_sent_at is null
         then 'PASS' else 'FAIL' end,
    format('wamid=%s state=%s provider_at=%s commercial_finalized=%s', v_error, v_state, v_sent_at, v_before_quote_sent_at));

  select current_quote_id, current_quote_version_id
  into v_pointer_quote, v_pointer_version
  from public.commercial_opportunities where id = v_opp_tie;
  perform pg_temp._p9_quote_send_record(45, 'projection falha sem corromper Current Proposal anterior',
    case when v_pointer_quote = v_quote_tie_existing and v_pointer_version = v_ver_tie_existing then 'PASS' else 'FAIL' end,
    format('quote=%s version=%s', v_pointer_quote, v_pointer_version));

  -- 46: invalid canonical quote-send metadata must be rejected by finalizer.
  update public.messages
  set metadata = metadata - 'sales_quote_version_id'
  where id = v_msg_tie_new;
  begin
    perform * from public.finalize_sales_quote_send_by_system(
      v_org_a, v_store_a, v_opp_tie, v_quote_tie_new, v_ver_tie_new,
      v_msg_tie_new, v_key_tie_new, 'system_quote_send_reconciliation'
    );
    perform pg_temp._p9_quote_send_record(46, 'metadata quote-send incompleta falha fechado', 'FAIL', 'finalizer aceitou metadata incompleta');
  exception when others then
    perform pg_temp._p9_quote_send_record(46, 'metadata quote-send incompleta falha fechado',
      case when sqlerrm = 'SALES_QUOTE_SEND_MESSAGE_SCOPE_MISMATCH' then 'PASS' else 'FAIL' end,
      sqlstate || ' ' || sqlerrm);
  end;
end;
$functional$;

select scenario_number, scenario_name, status, details
from pg_temp._p9_quote_send_results
order by scenario_number;

do $gate$
declare
  v_non_pass integer;
  v_details text;
begin
  select count(*) into v_non_pass
  from pg_temp._p9_quote_send_results
  where status <> 'PASS';

  if v_non_pass > 0 then
    select string_agg(
      format('#%s %s => %s (%s)', scenario_number, scenario_name, status, details),
      E'\n' order by scenario_number
    ) into v_details
    from pg_temp._p9_quote_send_results
    where status <> 'PASS';

    raise exception using
      errcode = 'P0001',
      message = format('P9 quote-send runner failed: %s non-PASS scenario(s)', v_non_pass),
      detail = coalesce(v_details, '<no details>');
  end if;

  if (select count(*) from pg_temp._p9_quote_send_results) <> 46 then
    raise exception using
      errcode = 'P0001',
      message = 'P9 quote-send runner scenario count mismatch',
      detail = format('expected=46 actual=%s', (select count(*) from pg_temp._p9_quote_send_results));
  end if;
end;
$gate$;

rollback;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;
-- SQL Editor runs this rollback-only harness as postgres.
-- Keep JWT identity empty for system/service-only writers. The commercial
-- message session writer intentionally rejects postgres + forged service_role JWT.
select pg_catalog.set_config('request.jwt.claim.role','',true);
select pg_catalog.set_config('request.jwt.claim.sub','',true);
select pg_catalog.set_config('request.jwt.claims','{}',true);

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    '20261006190500_p9_8_5_negotiation_concession_materialization_manual_checks',
    0
  )
);

-- ============================================================================
-- P9 / 8.5 - REAL-SUT rollback-only runner
--
-- Important:
-- * This runner targets 20261006190000 plus the two additive repairs already applied in DEV.
-- * It intentionally DOES NOT use proposed_condition.discount_semantics.
-- * It DOES NOT call Meta/HTTP. Provider acceptance is simulated only through
--   the canonical database writer mark_message_external_sent_v2().
-- * Every business fixture is transaction-local and the runner ends in ROLLBACK.
-- * Legacy conversation_states is explicitly synchronized to orcamento because
--   canonical quote finalization validates conversation_events against that mirror.
-- ============================================================================

create temp table p9_8_5_results (
  n integer primary key,
  name text not null,
  status text not null check (status in ('PASS','FAIL','ERROR','SKIP')),
  details text null
) on commit drop;

insert into pg_temp.p9_8_5_results(n,name,status,details)
values
  (1,'final_8_5_surface_installed','SKIP','not executed yet'),
  (2,'final_discount_and_superseded_semantics','SKIP','not executed yet'),
  (3,'atomic_finalize_and_specialized_gate_installed','SKIP','not executed yet'),
  (4,'real_fixture_and_base_current_proposal','SKIP','not executed yet'),
  (5,'legacy_unapproved_materializes','SKIP','not executed yet'),
  (6,'legacy_unapproved_blocked_by_gate','SKIP','not executed yet'),
  (7,'legacy_approved_materializes','SKIP','not executed yet'),
  (8,'legacy_approved_permitted_by_gate','SKIP','not executed yet'),
  (9,'normal_1_prepare_reserves_ordinal_1','SKIP','not executed yet'),
  (10,'normal_1_prepare_idempotent_replay','SKIP','not executed yet'),
  (11,'normal_1_target_quote_items_and_totals','SKIP','not executed yet'),
  (12,'normal_1_historical_item_id_not_reused','SKIP','not executed yet'),
  (13,'normal_1_target_writer_replay_no_duplicate','SKIP','not executed yet'),
  (14,'normal_1_target_version_bound','SKIP','not executed yet'),
  (15,'wrong_concession_metadata_rejected','SKIP','not executed yet'),
  (16,'wrong_materialization_metadata_rejected','SKIP','not executed yet'),
  (17,'specialized_send_queues_canonical_message','SKIP','not executed yet'),
  (18,'specialized_quote_has_no_fake_human_approval','SKIP','not executed yet'),
  (19,'specialized_gate_permits_without_human_approval','SKIP','not executed yet'),
  (20,'provider_evidence_required_before_quote_finalize','SKIP','not executed yet'),
  (21,'concession_not_materialized_before_provider','SKIP','not executed yet'),
  (22,'controlled_provider_evidence_persisted','SKIP','not executed yet'),
  (23,'concession_cannot_finalize_before_current_proposal_target','SKIP','not executed yet'),
  (24,'normal_1_canonical_finalize_triggers_atomic_materialization','SKIP','not executed yet'),
  (25,'current_commercial_proposal_is_normal_1_target','SKIP','not executed yet'),
  (26,'normal_1_definitive_ordinal_is_1','SKIP','not executed yet'),
  (27,'stage_stays_negociacao_without_lifecycle_ping_pong','SKIP','not executed yet'),
  (28,'normal_1_finalize_retry_no_duplicate_effects','SKIP','not executed yet'),
  (29,'probe_reserves_ordinal_2_before_supersede','SKIP','not executed yet'),
  (30,'superseded_materialization_releases_ordinal','SKIP','not executed yet'),
  (31,'normal_2_reuses_released_ordinal_2','SKIP','not executed yet'),
  (32,'normal_2_complete_path_reaches_provider_boundary','SKIP','not executed yet'),
  (33,'failed_commercial_finalize_rolls_back_projection_but_provider_fact_survives','SKIP','not executed yet'),
  (34,'reconciliation_finalizes_without_second_provider_post','SKIP','not executed yet'),
  (35,'third_normal_concession_blocked','SKIP','not executed yet'),
  (36,'normal_2_keeps_same_stage_and_cycle','SKIP','not executed yet'),
  (37,'stale_cycle_blocked','SKIP','not executed yet'),
  (38,'human_exception_without_real_approval_rejected','SKIP','not executed yet'),
  (39,'human_exception_real_8_4_approval_then_prepare_has_null_ordinal','SKIP','not executed yet'),
  (40,'human_exception_specialized_gate_allowed_with_real_8_4_approval','SKIP','not executed yet'),
  (41,'human_exception_materializes_with_null_definitive_ordinal','SKIP','not executed yet'),
  (42,'human_exception_becomes_current_proposal_without_fake_quote_approval','SKIP','not executed yet'),
  (43,'all_8_5_materialization_keeps_stage_negociacao','SKIP','not executed yet'),
  (44,'final_cycle_and_ordinal_integrity','SKIP','not executed yet'),
  (45,'rollback_only_runner_ready','SKIP','not executed yet');

create temp table p9_8_5_ctx (
  run_id uuid not null,
  org_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  lead_id uuid not null,
  conversation_id uuid not null,
  opportunity_id uuid not null,
  cycle_id uuid not null,
  stale_cycle_id uuid null,
  actor_id uuid not null,
  base_quote_id uuid not null,
  base_version_id uuid not null,
  initial_lifecycle_count integer not null,
  normal_1_id uuid null,
  normal_1_mat_id uuid null,
  normal_1_quote_id uuid null,
  normal_1_version_id uuid null,
  normal_1_message_id uuid null,
  superseded_probe_id uuid null,
  superseded_probe_mat_id uuid null,
  normal_2_id uuid null,
  normal_2_mat_id uuid null,
  normal_2_quote_id uuid null,
  normal_2_version_id uuid null,
  normal_2_message_id uuid null,
  human_exception_id uuid null,
  human_exception_mat_id uuid null,
  human_exception_quote_id uuid null,
  human_exception_version_id uuid null,
  human_exception_message_id uuid null
) on commit drop;

create or replace function pg_temp.p9_8_5_record(
  p_n integer,
  p_name text,
  p_status text,
  p_details text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp.p9_8_5_results(n,name,status,details)
  values (p_n,p_name,p_status,p_details)
  on conflict (n) do update
     set name = excluded.name,
         status = excluded.status,
         details = excluded.details;

  raise notice '% %: % -- %', p_status, p_n, p_name, coalesce(p_details,'');
end;
$function$;

create or replace function pg_temp.p9_8_5_assert(
  p_n integer,
  p_name text,
  p_ok boolean,
  p_details text default null
)
returns void
language plpgsql
as $function$
begin
  perform pg_temp.p9_8_5_record(
    p_n,
    p_name,
    case when coalesce(p_ok,false) then 'PASS' else 'FAIL' end,
    p_details
  );
end;
$function$;

create or replace function pg_temp.p9_8_5_expect_error(
  p_n integer,
  p_name text,
  p_sql text,
  p_expected_message text
)
returns void
language plpgsql
as $function$
begin
  begin
    execute p_sql;
    perform pg_temp.p9_8_5_record(
      p_n,p_name,'FAIL','expected error was not raised: '||coalesce(p_expected_message,'<any>')
    );
  exception
    when others then
      perform pg_temp.p9_8_5_record(
        p_n,
        p_name,
        case
          when p_expected_message is null
            or pg_catalog.strpos(pg_catalog.lower(sqlerrm), pg_catalog.lower(p_expected_message)) > 0
          then 'PASS'
          else 'FAIL'
        end,
        sqlstate||' '||sqlerrm
      );
  end;
end;
$function$;

create or replace function pg_temp.p9_8_5_make_concession(
  p_org uuid,
  p_store uuid,
  p_opportunity uuid,
  p_cycle uuid,
  p_quote uuid,
  p_version uuid,
  p_class text,
  p_previous_price bigint,
  p_proposed_price bigint,
  p_actor uuid default null,
  p_label text default 'fixture'
)
returns uuid
language plpgsql
as $function$
declare
  v_id uuid := gen_random_uuid();
  v_key text;
  v_fingerprint text;
  v_percent numeric(7,4);
begin
  v_key := 'p9_8_5_runner:' || p_label || ':' || v_id::text;
  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_key, 'UTF8'::name),
      'sha256'::text
    ),
    'hex'::text
  );
  v_percent := case
    when p_previous_price > 0
      then pg_catalog.round(((p_previous_price-p_proposed_price)::numeric * 100) / p_previous_price, 4)
    else 0
  end;

  insert into public.commercial_negotiation_concessions (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    negotiation_cycle_id,
    quote_id,
    quote_version_id,
    concession_class,
    concession_kind,
    status,
    concession_number,
    previous_condition,
    proposed_condition,
    requested_discount_percent,
    requested_discount_cents,
    counterpart_snapshot,
    policy_snapshot,
    authority_snapshot,
    authority_decision,
    effective_decision,
    high_value,
    high_value_context,
    origin,
    source_message_id,
    operation_key,
    request_fingerprint,
    approval_status,
    approval_decided_at,
    approval_actor_user_id,
    approval_reason,
    authorized_at
  ) values (
    v_id,
    p_org,
    p_store,
    p_opportunity,
    p_cycle,
    p_quote,
    p_version,
    p_class,
    'discount',
    'authorized',
    null,
    pg_catalog.jsonb_build_object('price_cents',p_previous_price),
    pg_catalog.jsonb_build_object('price_cents',p_proposed_price),
    v_percent,
    p_previous_price-p_proposed_price,
    '{}'::jsonb,
    '{}'::jsonb,
    pg_catalog.jsonb_build_object(
      'state','allowed',
      'canOffer',true,
      'canApply',true,
      'canRequestApproval',false,
      'requiresHumanApproval',false,
      'reasonCode','TRANSACTIONAL_AUTHORITY_WITHIN_POLICY',
      'scope',pg_catalog.jsonb_build_object(
        'organizationId',p_org::text,
        'storeId',p_store::text,
        'commercialOpportunityId',p_opportunity::text,
        'quoteId',p_quote::text,
        'quoteVersionId',p_version::text
      ),
      'provenance',pg_catalog.jsonb_build_object('source','p9_8_5_runner')
    ),
    'allowed',
    'allowed',
    false,
    '{}'::jsonb,
    case when p_class='human_exception' then 'human' else 'system' end,
    null,
    v_key,
    v_fingerprint,
    case when p_class='human_exception' then 'approved' else 'not_required' end,
    case when p_class='human_exception' then clock_timestamp() else null end,
    case when p_class='human_exception' then p_actor else null end,
    case when p_class='human_exception' then 'P9 8.5 rollback runner approved exception' else null end,
    clock_timestamp()
  );

  return v_id;
end;
$function$;

create or replace function pg_temp.p9_8_5_make_human_exception_proposed(
  p_org uuid,
  p_store uuid,
  p_opportunity uuid,
  p_cycle uuid,
  p_quote uuid,
  p_version uuid,
  p_previous_price bigint,
  p_proposed_price bigint,
  p_label text default 'human-exception'
)
returns uuid
language plpgsql
as $function$
declare
  v_id uuid := gen_random_uuid();
  v_key text;
  v_fingerprint text;
  v_percent numeric(7,4);
begin
  v_key := 'p9_8_5_runner:' || p_label || ':' || v_id::text;
  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_key, 'UTF8'::name),
      'sha256'::text
    ),
    'hex'::text
  );
  v_percent := case
    when p_previous_price > 0
      then pg_catalog.round(((p_previous_price-p_proposed_price)::numeric * 100) / p_previous_price, 4)
    else 0
  end;

  insert into public.commercial_negotiation_concessions (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    negotiation_cycle_id,
    quote_id,
    quote_version_id,
    concession_class,
    concession_kind,
    status,
    concession_number,
    previous_condition,
    proposed_condition,
    requested_discount_percent,
    requested_discount_cents,
    counterpart_snapshot,
    policy_snapshot,
    authority_snapshot,
    authority_decision,
    effective_decision,
    high_value,
    high_value_context,
    origin,
    source_message_id,
    operation_key,
    request_fingerprint,
    approval_status,
    approval_requested_at,
    approval_decided_at,
    approval_actor_user_id,
    approval_reason,
    approval_reference,
    authorized_at,
    materialized_at
  ) values (
    v_id,
    p_org,
    p_store,
    p_opportunity,
    p_cycle,
    p_quote,
    p_version,
    'human_exception',
    'discount',
    'proposed',
    null,
    pg_catalog.jsonb_build_object('price_cents',p_previous_price),
    pg_catalog.jsonb_build_object('price_cents',p_proposed_price),
    v_percent,
    p_previous_price-p_proposed_price,
    '{}'::jsonb,
    '{}'::jsonb,
    pg_catalog.jsonb_build_object(
      'action','apply_discount',
      'state','allowed',
      'requestedDiscountPercent',v_percent,
      'canOffer',true,
      'canApply',true,
      'canRequestApproval',false,
      'requiresHumanApproval',false,
      'reasonCode','TRANSACTIONAL_AUTHORITY_WITHIN_POLICY',
      'scope',pg_catalog.jsonb_build_object(
        'organizationId',p_org::text,
        'storeId',p_store::text,
        'commercialOpportunityId',p_opportunity::text,
        'quoteId',p_quote::text,
        'quoteVersionId',p_version::text
      ),
      'provenance',pg_catalog.jsonb_build_object('source','p9_8_5_runner')
    ),
    'allowed',
    null,
    false,
    '{}'::jsonb,
    'human',
    null,
    v_key,
    v_fingerprint,
    'not_required',
    null,
    null,
    null,
    null,
    null,
    null,
    null
  );

  return v_id;
end;
$function$;

create or replace function pg_temp.p9_8_5_make_target_version(
  p_org uuid,
  p_store uuid,
  p_quote uuid,
  p_label text
)
returns uuid
language plpgsql
as $function$
declare
  v_id uuid := gen_random_uuid();
  v_file uuid := gen_random_uuid();
  v_quote public.sales_quotes%rowtype;
  v_path text;
begin
  select q.* into strict v_quote
  from public.sales_quotes q
  where q.id=p_quote
    and q.organization_id=p_org
    and q.store_id=p_store;

  v_path := p_org::text||'/'||p_store::text||'/sales-quotes/'||p_quote::text||'/'||p_label||'-v0001.pdf';

  insert into public.store_files(
    id,organization_id,store_id,file_kind,storage_bucket,storage_path,
    original_filename,mime_type,size_bytes,uploaded_by
  ) values(
    v_file,p_org,p_store,'sales_quote_pdf','zion-store-files',v_path,
    p_label||'-v0001.pdf','application/pdf',1000,'system'
  );

  insert into public.sales_quote_versions (
    id,
    quote_id,
    organization_id,
    store_id,
    version_number,
    status,
    quote_kind,
    store_file_id,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    generated_by,
    quote_snapshot,
    created_at,
    sent_at
  ) values (
    v_id,
    p_quote,
    p_org,
    p_store,
    1,
    'generated',
    null,
    v_file,
    'zion-store-files',
    v_path,
    p_label||'-v0001.pdf',
    'application/pdf',
    1000,
    'system',
    pg_catalog.jsonb_build_object(
      'quote',pg_catalog.jsonb_build_object(
        'id',p_quote::text,
        'subtotalCents',v_quote.subtotal_cents,
        'discountCents',v_quote.discount_cents,
        'totalCents',v_quote.total_cents
      ),
      'items',pg_catalog.jsonb_build_array()
    ),
    clock_timestamp(),
    null
  );

  update public.sales_quotes
     set current_version_id=v_id
   where id=p_quote
     and organization_id=p_org
     and store_id=p_store;

  return v_id;
end;
$function$;

create or replace function pg_temp.p9_8_5_claim_message(
  p_org uuid,
  p_store uuid,
  p_message uuid
)
returns void
language plpgsql
as $function$
begin
  update public.messages
     set outbound_delivery_state='processing',
         outbound_claimed_at=clock_timestamp(),
         outbound_claimed_by='p9-8-5-runner',
         outbound_attempt_started_at=null,
         outbound_uncertain_at=null,
         outbound_error_text=null
   where id=p_message
     and organization_id=p_org
     and store_id=p_store;

  if not found then
    raise exception using errcode='P0002',message='P9_8_5_RUNNER_MESSAGE_NOT_FOUND_FOR_CLAIM';
  end if;
end;
$function$;

-- ============================================================================
-- 0. Structural preflight against the FINAL applied 8.5 contract.
-- ============================================================================
do $preflight$
declare
  v_prepare_def text;
  v_target_def text;
  v_gate_def text;
  v_finalize_def text;
  v_state_constraint text;
  v_ok boolean;
begin
  v_ok :=
    pg_catalog.to_regclass('public.commercial_negotiation_concession_materializations') is not null
    and pg_catalog.to_regprocedure('public.prepare_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid)') is not null
    and pg_catalog.to_regprocedure('public.materialize_commercial_negotiation_concession_target_quote_by_system(uuid,uuid,uuid,uuid)') is not null
    and pg_catalog.to_regprocedure('public.bind_commercial_negotiation_concession_materialization_version_by_system(uuid,uuid,uuid,uuid,uuid,uuid)') is not null
    and pg_catalog.to_regprocedure('public.materialize_commercial_negotiation_concession_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)') is not null
    and pg_catalog.to_regprocedure('public.finalize_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid)') is not null
    and pg_catalog.to_regprocedure('public.supersede_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid)') is not null
    and pg_catalog.to_regprocedure('public.p9_8_5_validate_specialized_quote_send_authority(uuid,uuid,uuid,uuid,uuid,uuid)') is not null
    and pg_catalog.to_regprocedure('public.materialize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)') is not null
    and pg_catalog.to_regprocedure('public.ensure_commercial_conversation_session_context(uuid,uuid,uuid)') is not null
    and pg_catalog.to_regprocedure('public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)') is not null
    and pg_catalog.to_regprocedure('public.mark_message_external_sent_v2(uuid,uuid,uuid,text)') is not null
    and pg_catalog.to_regprocedure('public.finalize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text)') is not null
    and pg_catalog.to_regprocedure('public.decide_commercial_negotiation_concession_by_human(uuid,uuid,uuid,uuid,text,text,text)') is not null
    and pg_catalog.to_regclass('public.commercial_negotiation_concession_decision_events') is not null
    and pg_catalog.to_regclass('public.conversation_states') is not null
    and exists(
      select 1
      from public.event_state_rules rule_row
      where rule_row.event_type='orcamento_enviado'
        and rule_row.state='orcamento'
        and rule_row.is_allowed is true
    );

  perform pg_temp.p9_8_5_assert(1,'final_8_5_surface_installed',v_ok,'all required 8.5 + canonical outbound RPCs present');

  if v_ok then
    v_prepare_def := pg_catalog.pg_get_functiondef(
      'public.prepare_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid)'::regprocedure
    );
    v_target_def := pg_catalog.pg_get_functiondef(
      'public.materialize_commercial_negotiation_concession_target_quote_by_system(uuid,uuid,uuid,uuid)'::regprocedure
    );
    v_gate_def := pg_catalog.pg_get_functiondef(
      'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)'::regprocedure
    );
    v_finalize_def := pg_catalog.pg_get_functiondef(
      'public.finalize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text)'::regprocedure
    );

    select pg_catalog.lower(pg_catalog.pg_get_constraintdef(c.oid))
      into v_state_constraint
      from pg_catalog.pg_constraint c
     where c.conrelid='public.commercial_negotiation_concession_materializations'::regclass
       and c.conname='p9_8_5_materialization_state_check';

    perform pg_temp.p9_8_5_assert(
      2,
      'final_discount_and_superseded_semantics',
      pg_catalog.strpos(pg_catalog.lower(coalesce(v_target_def,'')), 'discount_semantics')=0
      and pg_catalog.strpos(pg_catalog.lower(coalesce(v_target_def,'')), 'previous_condition')>0
      and pg_catalog.strpos(pg_catalog.lower(coalesce(v_target_def,'')), 'proposed_condition')>0
      and pg_catalog.strpos(pg_catalog.lower(coalesce(v_target_def,'')), 'v_item.commercial_opportunity_id')>0
      and pg_catalog.strpos(pg_catalog.lower(coalesce(v_target_def,'')), 'v_item.profile_component_id')>0
      and pg_catalog.strpos(coalesce(v_state_constraint,''), 'superseded')>0,
      'discount semantics + superseded state + target item lineage repair installed'
    );

    perform pg_temp.p9_8_5_assert(
      3,
      'atomic_finalize_and_specialized_gate_installed',
      exists(
        select 1 from pg_catalog.pg_trigger t
        where t.tgrelid='public.messages'::regclass
          and t.tgname='p9_8_5_finalize_concession_after_quote_send'
          and not t.tgisinternal
      )
      and pg_catalog.strpos(pg_catalog.lower(coalesce(v_gate_def,'')), 'p9_8_5_validate_specialized_quote_send_authority')>0
      and pg_catalog.strpos(pg_catalog.lower(coalesce(v_finalize_def,'')), 'outbound_commercial_finalized_at')>0
      and pg_catalog.strpos(pg_catalog.lower(coalesce(v_prepare_def,'')), 'commercial_negotiation_concession_materializations as mat')>0
      and pg_catalog.strpos(pg_catalog.lower(coalesce(v_prepare_def,'')), 'mat.operation_key')>0,
      'atomic finalization + specialized gate + prepare RETURNING ambiguity repair installed'
    );
  else
    perform pg_temp.p9_8_5_record(2,'final_discount_and_superseded_semantics','SKIP','preflight surface incomplete');
    perform pg_temp.p9_8_5_record(3,'atomic_finalize_and_specialized_gate_installed','SKIP','preflight surface incomplete');
  end if;
end;
$preflight$;

-- ============================================================================
-- 1. Transaction-local fixture with REAL lead + conversation + opportunity.
-- ============================================================================
do $fixture$
declare
  v_run uuid:=gen_random_uuid();
  v_org uuid:=gen_random_uuid();
  v_store uuid:=gen_random_uuid();
  v_customer uuid:=gen_random_uuid();
  v_lead uuid:=gen_random_uuid();
  v_conversation uuid:=gen_random_uuid();
  v_opp uuid:=gen_random_uuid();
  v_cycle uuid:=gen_random_uuid();
  v_actor uuid:=gen_random_uuid();
  v_quote uuid:=gen_random_uuid();
  v_version uuid:=gen_random_uuid();
  v_file uuid:=gen_random_uuid();
  v_now timestamptz:=clock_timestamp();
  v_event_key text;
  v_lifecycle_count integer;
  v_session record;
begin
  begin
    insert into auth.users(id) values(v_actor);

    insert into public.organizations(id,name,subscription_status)
    values(v_org,'P9 8.5 runner organization '||left(v_run::text,8),'active');

    insert into public.stores(id,organization_id,name,created_at)
    values(v_store,v_org,'P9 8.5 runner store',v_now);

    insert into public.customers(id,organization_id,display_name,normalized_name)
    values(v_customer,v_org,'P9 8.5 runner customer','p9-8-5-'||replace(v_run::text,'-',''));

    insert into public.customer_store_links(organization_id,store_id,customer_id)
    values(v_org,v_store,v_customer);

    insert into public.memberships(organization_id,user_id,role,is_active)
    values(v_org,v_actor,'admin',true);

    insert into public.leads(id,organization_id,store_id,name,phone,state)
    values(v_lead,v_org,v_store,'P9 8.5 Runner Lead','55119'||substring(replace(v_run::text,'-','') from 1 for 8),'orcamento');

    insert into public.conversations(id,organization_id,lead_id,status,is_human_active,created_at)
    values(v_conversation,v_org,v_lead,'orcamento',false,v_now);

    -- The legacy conversation-state trigger always creates novo_lead.
    -- This fixture represents a conversation that already reached quote stage
    -- before the canonical opportunity entered negociacao. Keep the legacy
    -- event-state mirror coherent so canonical quote finalization can emit
    -- orcamento_enviado without weakening production event_state_rules.
    perform pg_catalog.set_config('app.allow_state_update','true',true);
    update public.conversation_states conversation_state_row
       set state='orcamento',
           entered_at=v_now,
           updated_at=v_now
     where conversation_state_row.organization_id=v_org
       and conversation_state_row.conversation_id=v_conversation;
    if not found then
      raise exception using errcode='P0001',message='P9_8_5_RUNNER_CONVERSATION_STATE_FIXTURE_MISSING';
    end if;
    perform pg_catalog.set_config('app.allow_state_update','false',true);

    insert into public.commercial_opportunities(
      id,organization_id,store_id,customer_id,origin_lead_id,primary_conversation_id,stage,lifecycle_cycle
    ) values(
      v_opp,v_org,v_store,v_customer,v_lead,v_conversation,'negociacao',1
    );

    v_event_key:=public.compute_commercial_opportunity_event_fingerprint_internal(
      v_org,v_store,v_opp,1,'stage_transition','orcamento','negociacao','system',null,
      'concrete_quote_objection_required',null,'p9_8_5_runner','material_negotiation_discount_request',null,
      'P9 8.5 runner negotiation cycle'
    );

    insert into public.commercial_opportunity_lifecycle_events(
      id,organization_id,store_id,commercial_opportunity_id,customer_id,lifecycle_cycle,
      event_type,previous_stage,new_stage,reason_code,evidence_type,evidence_summary,
      actor_type,source,metadata,idempotency_key,event_key
    ) values(
      v_cycle,v_org,v_store,v_opp,v_customer,1,
      'stage_transition','orcamento','negociacao','concrete_quote_objection_required',
      'material_negotiation_discount_request','P9 8.5 runner negotiation cycle',
      'system','p9_8_5_runner','{}'::jsonb,'p9_8_5_cycle:'||v_cycle::text,v_event_key
    );

    insert into public.store_quote_settings(
      organization_id,store_id,quote_number_prefix,next_quote_number,
      quote_pdf_enabled,ai_can_generate_quote,ai_can_send_quote_to_customer,
      requires_human_approval_before_send
    ) values(v_org,v_store,'P985',1,true,true,true,true);

    insert into public.sales_quotes(
      id,organization_id,store_id,commercial_opportunity_id,conversation_id,lead_id,
      quote_number,title,status,customer_name,customer_phone,valid_until,
      subtotal_cents,discount_cents,total_cents,metadata
    ) values(
      v_quote,v_org,v_store,v_opp,v_conversation,v_lead,
      'P985-BASE-'||left(replace(v_quote::text,'-',''),8),'Base P9 8.5 runner quote','sent',
      'P9 8.5 Runner Customer','5511999999999',((v_now at time zone 'UTC')::date + 30),
      100000,0,100000,'{}'::jsonb
    );

    insert into public.sales_quote_items(
      quote_id,organization_id,store_id,
      item_type,name,description,quantity,unit_price_cents,discount_cents,
      subtotal_cents,total_cents,sort_order,sku,metadata
    ) values(
      v_quote,v_org,v_store,
      'custom','P9 8.5 Runner Item','Rollback-only item',1,100000,0,
      100000,100000,1,null,'{}'::jsonb
    );

    insert into public.store_files(
      id,organization_id,store_id,file_kind,storage_bucket,storage_path,original_filename,mime_type,size_bytes,uploaded_by
    ) values(
      v_file,v_org,v_store,'sales_quote_pdf','zion-store-files',
      v_org::text||'/'||v_store::text||'/sales-quotes/'||v_quote::text||'/base-v0001.pdf',
      'base-v0001.pdf','application/pdf',1000,'system'
    );

    insert into public.sales_quote_versions(
      id,quote_id,organization_id,store_id,version_number,status,quote_kind,store_file_id,
      storage_bucket,storage_path,original_filename,mime_type,size_bytes,generated_by,
      quote_snapshot,created_at,sent_at
    ) values(
      v_version,v_quote,v_org,v_store,1,'sent',null,v_file,
      'zion-store-files',v_org::text||'/'||v_store::text||'/sales-quotes/'||v_quote::text||'/base-v0001.pdf',
      'base-v0001.pdf','application/pdf',1000,'system',
      pg_catalog.jsonb_build_object(
        'quote',pg_catalog.jsonb_build_object(
          'id',v_quote::text,'subtotalCents',100000,'discountCents',0,'totalCents',100000
        ),
        'items',pg_catalog.jsonb_build_array()
      ),
      v_now,v_now
    );

    update public.sales_quotes set current_version_id=v_version where id=v_quote;

    perform * from public.set_current_commercial_proposal_from_sent_quote_by_system(
      v_org,v_store,v_opp,v_quote,v_version,
      'current_commercial_proposal:'||v_opp::text||':'||v_quote::text||':'||v_version::text,
      'p9_8_5_runner'
    );

    -- Exercise the exact canonical session/context writer before any quote-send.
    -- With the SQL Editor's postgres identity and empty JWT claims this is an
    -- authorized system call. A fixture without lead_customer_links may validly
    -- resolve as pending_context; the active conversation_session is mandatory.
    select * into v_session
    from public.ensure_commercial_conversation_session_context(
      v_org,v_store,v_conversation
    );

    if v_session.conversation_session_id is null
       or v_session.commercial_context_state not in ('pending_context','captured','existing_captured') then
      raise exception using
        errcode='P0001',
        message='P9_8_5_RUNNER_CANONICAL_SESSION_CONTEXT_NOT_ESTABLISHED';
    end if;

    select count(*) into v_lifecycle_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id=v_opp;

    insert into pg_temp.p9_8_5_ctx(
      run_id,org_id,store_id,customer_id,lead_id,conversation_id,opportunity_id,cycle_id,
      actor_id,base_quote_id,base_version_id,initial_lifecycle_count
    ) values(
      v_run,v_org,v_store,v_customer,v_lead,v_conversation,v_opp,v_cycle,
      v_actor,v_quote,v_version,v_lifecycle_count
    );

    perform pg_temp.p9_8_5_assert(
      4,'real_fixture_and_base_current_proposal',
      exists(
        select 1 from public.conversations
        where id=v_conversation and organization_id=v_org and status='orcamento'
      )
      and exists(
        select 1 from public.conversation_states
        where conversation_id=v_conversation and organization_id=v_org and state='orcamento'
      )
      and exists(
        select 1
        from public.p9_resolve_current_commercial_proposal_internal(v_org,v_store,v_opp) p
        where p.proposal_state='available'
          and p.current_quote_id=v_quote
          and p.current_quote_version_id=v_version
      )
      and exists(
        select 1 from public.conversation_sessions s
        where s.id=v_session.conversation_session_id
          and s.organization_id=v_org
          and s.store_id=v_store
          and s.conversation_id=v_conversation
          and s.status='active'
      ),
      'real lead/conversation/opportunity + sent base proposal + canonical active conversation session'
    );
  exception when others then
    perform pg_temp.p9_8_5_record(4,'real_fixture_and_base_current_proposal','ERROR',sqlstate||' '||sqlerrm);
  end;
end;
$fixture$;

-- ============================================================================
-- 2. Legacy approval compatibility A/B.
-- ============================================================================
do $legacy$
declare
  c pg_temp.p9_8_5_ctx%rowtype;
  v_quote_unapproved uuid:=gen_random_uuid();
  v_version_unapproved uuid:=gen_random_uuid();
  v_file_unapproved uuid:=gen_random_uuid();
  v_msg_unapproved uuid;
  v_quote_approved uuid:=gen_random_uuid();
  v_version_approved uuid:=gen_random_uuid();
  v_file_approved uuid:=gen_random_uuid();
  v_msg_approved uuid;
  v_key text;
  v_r record;
  v_gate jsonb;
begin
  if not exists(select 1 from pg_temp.p9_8_5_ctx) then
    perform pg_temp.p9_8_5_record(5,'legacy_unapproved_materializes','SKIP','fixture unavailable');
    perform pg_temp.p9_8_5_record(6,'legacy_unapproved_blocked_by_gate','SKIP','fixture unavailable');
    perform pg_temp.p9_8_5_record(7,'legacy_approved_materializes','SKIP','fixture unavailable');
    perform pg_temp.p9_8_5_record(8,'legacy_approved_permitted_by_gate','SKIP','fixture unavailable');
    return;
  end if;
  select * into strict c from pg_temp.p9_8_5_ctx;

  begin
    insert into public.sales_quotes(
      id,organization_id,store_id,commercial_opportunity_id,conversation_id,lead_id,
      quote_number,title,status,customer_name,customer_phone,valid_until,
      subtotal_cents,discount_cents,total_cents,metadata
    ) values(
      v_quote_unapproved,c.org_id,c.store_id,c.opportunity_id,c.conversation_id,c.lead_id,
      'P985-LEG-A-'||left(replace(v_quote_unapproved::text,'-',''),8),'Legacy unapproved','pending_review',
      'P9 Runner','5511999999999',((clock_timestamp() at time zone 'UTC')::date + 30),10000,0,10000,'{}'::jsonb
    );

    insert into public.store_files(
      id,organization_id,store_id,file_kind,storage_bucket,storage_path,original_filename,mime_type,size_bytes,uploaded_by
    ) values(
      v_file_unapproved,c.org_id,c.store_id,'sales_quote_pdf','zion-store-files',
      c.org_id::text||'/'||c.store_id::text||'/sales-quotes/'||v_quote_unapproved::text||'/legacy-a.pdf',
      'legacy-a.pdf','application/pdf',1000,'system'
    );

    insert into public.sales_quote_versions(
      id,quote_id,organization_id,store_id,version_number,status,quote_kind,store_file_id,
      storage_bucket,storage_path,original_filename,mime_type,size_bytes,generated_by,quote_snapshot,created_at,sent_at
    ) values(
      v_version_unapproved,v_quote_unapproved,c.org_id,c.store_id,1,'generated',null,v_file_unapproved,
      'zion-store-files',c.org_id::text||'/'||c.store_id::text||'/sales-quotes/'||v_quote_unapproved::text||'/legacy-a.pdf',
      'legacy-a.pdf','application/pdf',1000,'system','{}'::jsonb,clock_timestamp(),null
    );
    update public.sales_quotes set current_version_id=v_version_unapproved where id=v_quote_unapproved;

    v_key:='sales_quote_send:'||c.org_id::text||':'||c.store_id::text||':'||c.opportunity_id::text||':'||v_quote_unapproved::text||':'||v_version_unapproved::text;
    select * into v_r from public.materialize_sales_quote_send_by_system(
      c.org_id,c.store_id,c.opportunity_id,c.conversation_id,v_quote_unapproved,v_version_unapproved,
      'Legacy unapproved test','{}'::jsonb,v_key,'sales_quote_send_route'
    );
    v_msg_unapproved:=v_r.message_id;
    perform pg_temp.p9_8_5_assert(5,'legacy_unapproved_materializes',v_msg_unapproved is not null,'message='||coalesce(v_msg_unapproved::text,'<null>'));

    perform pg_temp.p9_8_5_claim_message(c.org_id,c.store_id,v_msg_unapproved);
    v_gate:=public.validate_or_cancel_whatsapp_external_send_v2_by_system(c.org_id,c.store_id,v_msg_unapproved);
    perform pg_temp.p9_8_5_assert(
      6,'legacy_unapproved_blocked_by_gate',
      v_gate->>'decision'='blocked'
      and v_gate->>'reason'='sales_quote_send_quote_not_approved'
      and (select outbound_delivery_state from public.messages where id=v_msg_unapproved)='failed',
      v_gate::text
    );
  exception when others then
    perform pg_temp.p9_8_5_record(5,'legacy_unapproved_materializes','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_5_record(6,'legacy_unapproved_blocked_by_gate','SKIP','legacy A flow failed');
  end;

  begin
    insert into public.sales_quotes(
      id,organization_id,store_id,commercial_opportunity_id,conversation_id,lead_id,
      quote_number,title,status,customer_name,customer_phone,valid_until,
      subtotal_cents,discount_cents,total_cents,
      approved_at,approved_by,metadata
    ) values(
      v_quote_approved,c.org_id,c.store_id,c.opportunity_id,c.conversation_id,c.lead_id,
      'P985-LEG-B-'||left(replace(v_quote_approved::text,'-',''),8),'Legacy approved','approved',
      'P9 Runner','5511999999999',((clock_timestamp() at time zone 'UTC')::date + 30),11000,0,11000,
      clock_timestamp(),c.actor_id,'{}'::jsonb
    );

    insert into public.store_files(
      id,organization_id,store_id,file_kind,storage_bucket,storage_path,original_filename,mime_type,size_bytes,uploaded_by
    ) values(
      v_file_approved,c.org_id,c.store_id,'sales_quote_pdf','zion-store-files',
      c.org_id::text||'/'||c.store_id::text||'/sales-quotes/'||v_quote_approved::text||'/legacy-b.pdf',
      'legacy-b.pdf','application/pdf',1000,'system'
    );

    insert into public.sales_quote_versions(
      id,quote_id,organization_id,store_id,version_number,status,quote_kind,store_file_id,
      storage_bucket,storage_path,original_filename,mime_type,size_bytes,generated_by,quote_snapshot,created_at,sent_at
    ) values(
      v_version_approved,v_quote_approved,c.org_id,c.store_id,1,'approved',null,v_file_approved,
      'zion-store-files',c.org_id::text||'/'||c.store_id::text||'/sales-quotes/'||v_quote_approved::text||'/legacy-b.pdf',
      'legacy-b.pdf','application/pdf',1000,'system','{}'::jsonb,clock_timestamp(),null
    );
    update public.sales_quotes set current_version_id=v_version_approved where id=v_quote_approved;

    v_key:='sales_quote_send:'||c.org_id::text||':'||c.store_id::text||':'||c.opportunity_id::text||':'||v_quote_approved::text||':'||v_version_approved::text;
    select * into v_r from public.materialize_sales_quote_send_by_system(
      c.org_id,c.store_id,c.opportunity_id,c.conversation_id,v_quote_approved,v_version_approved,
      'Legacy approved test','{}'::jsonb,v_key,'sales_quote_send_route'
    );
    v_msg_approved:=v_r.message_id;
    perform pg_temp.p9_8_5_assert(7,'legacy_approved_materializes',v_msg_approved is not null,'message='||coalesce(v_msg_approved::text,'<null>'));

    perform pg_temp.p9_8_5_claim_message(c.org_id,c.store_id,v_msg_approved);
    v_gate:=public.validate_or_cancel_whatsapp_external_send_v2_by_system(c.org_id,c.store_id,v_msg_approved);
    perform pg_temp.p9_8_5_assert(
      8,'legacy_approved_permitted_by_gate',
      v_gate->>'decision'='send'
      and (select outbound_delivery_state from public.messages where id=v_msg_approved)='uncertain'
      and (select outbound_attempt_started_at from public.messages where id=v_msg_approved) is not null,
      v_gate::text
    );
  exception when others then
    perform pg_temp.p9_8_5_record(7,'legacy_approved_materializes','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_5_record(8,'legacy_approved_permitted_by_gate','SKIP','legacy B flow failed');
  end;
end;
$legacy$;

-- ============================================================================
-- 3. Normal concession #1 complete path.
-- ============================================================================
do $normal1$
declare
  c pg_temp.p9_8_5_ctx%rowtype;
  v_concession uuid;
  v_mat uuid;
  v_target uuid;
  v_version uuid;
  v_message uuid;
  v_r record;
  v_gate jsonb;
  v_before_items integer;
  v_after_items integer;
  v_before_events integer;
  v_after_events integer;
  v_base_item uuid;
  v_bad uuid:=gen_random_uuid();
  v_final record;
  v_step text:='start';
begin
  if not exists(select 1 from pg_temp.p9_8_5_ctx) then
    for i in 9..28 loop
      perform pg_temp.p9_8_5_record(i,'normal_1_flow','SKIP','fixture unavailable');
    end loop;
    return;
  end if;
  select * into strict c from pg_temp.p9_8_5_ctx;

  begin
    v_step:='normal1_make_concession';
    v_concession:=pg_temp.p9_8_5_make_concession(
      c.org_id,c.store_id,c.opportunity_id,c.cycle_id,c.base_quote_id,c.base_version_id,
      'normal',100000,90000,null,'normal-1'
    );
    update pg_temp.p9_8_5_ctx set normal_1_id=v_concession;

    v_step:='normal1_prepare_first';
    select * into v_r from public.prepare_commercial_negotiation_concession_materialization_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_concession
    );
    v_mat:=v_r.materialization_id;
    v_target:=v_r.target_quote_id;
    update pg_temp.p9_8_5_ctx set normal_1_mat_id=v_mat,normal_1_quote_id=v_target;

    perform pg_temp.p9_8_5_assert(9,'normal_1_prepare_reserves_ordinal_1',v_r.state='prepared' and v_r.reserved_concession_number=1,v_r::text);

    select * into v_r from public.prepare_commercial_negotiation_concession_materialization_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_concession
    );
    perform pg_temp.p9_8_5_assert(10,'normal_1_prepare_idempotent_replay',v_r.replayed and v_r.materialization_id=v_mat and v_r.target_quote_id=v_target,v_r::text);

    select id into v_base_item from public.sales_quote_items where quote_id=c.base_quote_id order by sort_order,id limit 1;
    v_step:='normal1_materialize_target_quote';
    select * into v_r from public.materialize_commercial_negotiation_concession_target_quote_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_mat
    );
    select count(*) into v_before_items from public.sales_quote_items where quote_id=v_target;
    perform pg_temp.p9_8_5_assert(
      11,'normal_1_target_quote_items_and_totals',
      v_before_items=1
      and (select total_cents from public.sales_quotes where id=v_target)=90000
      and (select discount_cents from public.sales_quotes where id=v_target)=10000,
      'items='||v_before_items::text||' target='||v_target::text
    );

    perform pg_temp.p9_8_5_assert(
      12,'normal_1_historical_item_id_not_reused',
      not exists(select 1 from public.sales_quote_items where quote_id=v_target and id=v_base_item),
      'base_item='||coalesce(v_base_item::text,'<null>')
    );

    perform * from public.materialize_commercial_negotiation_concession_target_quote_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_mat
    );
    select count(*) into v_after_items from public.sales_quote_items where quote_id=v_target;
    perform pg_temp.p9_8_5_assert(13,'normal_1_target_writer_replay_no_duplicate',v_after_items=v_before_items,'before='||v_before_items||' after='||v_after_items);

    v_step:='normal1_make_target_version';
    v_version:=pg_temp.p9_8_5_make_target_version(c.org_id,c.store_id,v_target,'normal-1');
    update pg_temp.p9_8_5_ctx set normal_1_version_id=v_version;
    select * into v_r from public.bind_commercial_negotiation_concession_materialization_version_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_mat,v_target,v_version
    );
    perform pg_temp.p9_8_5_assert(14,'normal_1_target_version_bound',v_r.state='version_created' and v_r.target_quote_version_id=v_version,v_r::text);

    perform pg_temp.p9_8_5_expect_error(
      15,'wrong_concession_metadata_rejected',
      pg_catalog.format(
        'select * from public.materialize_commercial_negotiation_concession_send_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L::jsonb)',
        c.org_id,c.store_id,c.opportunity_id,v_mat,c.conversation_id,v_target,v_version,'wrong metadata',
        pg_catalog.jsonb_build_object('commercial_negotiation_concession_id',v_bad)::text
      ),
      'P9_8_5_CONCESSION_METADATA_MISMATCH'
    );

    perform pg_temp.p9_8_5_expect_error(
      16,'wrong_materialization_metadata_rejected',
      pg_catalog.format(
        'select * from public.materialize_commercial_negotiation_concession_send_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L::jsonb)',
        c.org_id,c.store_id,c.opportunity_id,v_mat,c.conversation_id,v_target,v_version,'wrong metadata',
        pg_catalog.jsonb_build_object('commercial_negotiation_concession_materialization_id',v_bad)::text
      ),
      'P9_8_5_MATERIALIZATION_METADATA_MISMATCH'
    );

    v_step:='normal1_materialize_send';
    select * into v_r from public.materialize_commercial_negotiation_concession_send_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_mat,c.conversation_id,v_target,v_version,
      'P9 8.5 normal concession #1','{}'::jsonb
    );
    v_message:=v_r.message_id;
    update pg_temp.p9_8_5_ctx set normal_1_message_id=v_message;

    perform pg_temp.p9_8_5_assert(
      17,'specialized_send_queues_canonical_message',
      v_message is not null
      and (select state from public.commercial_negotiation_concession_materializations where id=v_mat)='send_queued'
      and (select metadata->>'commercial_negotiation_concession_id' from public.messages where id=v_message)=v_concession::text
      and (select metadata->>'commercial_negotiation_concession_materialization_id' from public.messages where id=v_message)=v_mat::text,
      'message='||coalesce(v_message::text,'<null>')
    );

    perform pg_temp.p9_8_5_assert(
      18,'specialized_quote_has_no_fake_human_approval',
      (select status from public.sales_quotes where id=v_target)='pending_review'
      and (select approved_at from public.sales_quotes where id=v_target) is null
      and (select approved_by from public.sales_quotes where id=v_target) is null,
      'specialized target remains pending_review without approved_by'
    );

    v_step:='normal1_gate';
    perform pg_temp.p9_8_5_claim_message(c.org_id,c.store_id,v_message);
    v_gate:=public.validate_or_cancel_whatsapp_external_send_v2_by_system(c.org_id,c.store_id,v_message);
    perform pg_temp.p9_8_5_assert(
      19,'specialized_gate_permits_without_human_approval',
      v_gate->>'decision'='send'
      and (select outbound_delivery_state from public.messages where id=v_message)='uncertain'
      and (select outbound_attempt_started_at from public.messages where id=v_message) is not null,
      v_gate::text
    );

    perform pg_temp.p9_8_5_expect_error(
      20,'provider_evidence_required_before_quote_finalize',
      pg_catalog.format(
        'select * from public.finalize_sales_quote_send_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L)',
        c.org_id,c.store_id,c.opportunity_id,v_target,v_version,v_message,
        'sales_quote_send:'||c.org_id::text||':'||c.store_id::text||':'||c.opportunity_id::text||':'||v_target::text||':'||v_version::text,
        'system_quote_send_reconciliation'
      ),
      'SALES_QUOTE_SEND_EXTERNAL_EVIDENCE_REQUIRED'
    );

    perform pg_temp.p9_8_5_assert(
      21,'concession_not_materialized_before_provider',
      (select status from public.commercial_negotiation_concessions where id=v_concession)='authorized'
      and (select state from public.commercial_negotiation_concession_materializations where id=v_mat)='send_queued',
      'authority remains authorized/send_queued before provider evidence'
    );

    v_step:='normal1_provider_evidence';
    perform public.mark_message_external_sent_v2(
      c.org_id,c.store_id,v_message,'wamid.p985.normal1.'||replace(gen_random_uuid()::text,'-','')
    );
    perform pg_temp.p9_8_5_assert(
      22,'controlled_provider_evidence_persisted',
      (select outbound_delivery_state from public.messages where id=v_message)='sent'
      and (select external_message_id from public.messages where id=v_message) is not null
      and (select outbound_provider_accepted_at from public.messages where id=v_message) is not null,
      'provider fact written through canonical mark_message_external_sent_v2'
    );

    perform pg_temp.p9_8_5_expect_error(
      23,'concession_cannot_finalize_before_current_proposal_target',
      pg_catalog.format(
        'select * from public.finalize_commercial_negotiation_concession_materialization_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
        c.org_id,c.store_id,c.opportunity_id,v_mat,v_message,v_target,v_version
      ),
      'P9_8_5_FINALIZE_PRECONDITION_FAILED'
    );

    select count(*) into v_before_events
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id=c.opportunity_id;

    v_step:='normal1_canonical_finalize';
    select * into v_final from public.finalize_sales_quote_send_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_target,v_version,v_message,
      'sales_quote_send:'||c.org_id::text||':'||c.store_id::text||':'||c.opportunity_id::text||':'||v_target::text||':'||v_version::text,
      'system_quote_send_reconciliation'
    );

    perform pg_temp.p9_8_5_assert(
      24,'normal_1_canonical_finalize_triggers_atomic_materialization',
      (select status from public.commercial_negotiation_concessions where id=v_concession)='materialized'
      and (select state from public.commercial_negotiation_concession_materializations where id=v_mat)='materialized'
      and (select outbound_commercial_finalized_at from public.messages where id=v_message) is not null,
      coalesce(v_final::text,'<null>')
    );

    perform pg_temp.p9_8_5_assert(
      25,'current_commercial_proposal_is_normal_1_target',
      exists(
        select 1 from public.p9_resolve_current_commercial_proposal_internal(c.org_id,c.store_id,c.opportunity_id) p
        where p.proposal_state='available'
          and p.current_quote_id=v_target
          and p.current_quote_version_id=v_version
      ),
      'target='||v_target::text||' version='||v_version::text
    );

    perform pg_temp.p9_8_5_assert(
      26,'normal_1_definitive_ordinal_is_1',
      (select concession_number from public.commercial_negotiation_concessions where id=v_concession)=1
      and (select reserved_concession_number from public.commercial_negotiation_concession_materializations where id=v_mat)=1,
      'reserved and definitive ordinal must both be 1'
    );

    select count(*) into v_after_events
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id=c.opportunity_id;
    perform pg_temp.p9_8_5_assert(
      27,'stage_stays_negociacao_without_lifecycle_ping_pong',
      (select stage from public.commercial_opportunities where id=c.opportunity_id)='negociacao'
      and v_after_events=v_before_events,
      'events_before='||v_before_events||' events_after='||v_after_events
    );

    select * into v_final from public.finalize_sales_quote_send_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_target,v_version,v_message,
      'sales_quote_send:'||c.org_id::text||':'||c.store_id::text||':'||c.opportunity_id::text||':'||v_target::text||':'||v_version::text,
      'system_quote_send_reconciliation'
    );
    perform pg_temp.p9_8_5_assert(
      28,'normal_1_finalize_retry_no_duplicate_effects',
      (select count(*) from public.commercial_negotiation_concession_materializations where concession_id=v_concession)=1
      and (select count(*) from public.sales_quote_items where quote_id=v_target)=v_after_items
      and (select status from public.commercial_negotiation_concessions where id=v_concession)='materialized',
      coalesce(v_final::text,'<null>')
    );
  exception when others then
    perform pg_temp.p9_8_5_record(
      99,'normal_1_flow_unexpected_error','ERROR',
      'step='||coalesce(v_step,'<unknown>')||' '||sqlstate||' '||sqlerrm
    );
  end;
end;
$normal1$;

-- ============================================================================
-- 4. Superseded reservation release + normal concession #2 + reconciliation.
-- ============================================================================
do $normal2$
declare
  c pg_temp.p9_8_5_ctx%rowtype;
  v_probe uuid;
  v_probe_mat uuid;
  v_concession uuid;
  v_mat uuid;
  v_target uuid;
  v_version uuid;
  v_message uuid;
  v_r record;
  v_gate jsonb;
  v_wrong_mat uuid:=gen_random_uuid();
  v_metadata jsonb;
  v_provider_at timestamptz;
  v_external text;
  v_finalize_failed boolean:=false;
  v_finalize_error text:=null;
  v_final record;
  v_step text:='start';
begin
  if not exists(select 1 from pg_temp.p9_8_5_ctx where normal_1_quote_id is not null and normal_1_version_id is not null) then
    for i in 29..36 loop perform pg_temp.p9_8_5_record(i,'normal_2_flow','SKIP','normal #1 unavailable'); end loop;
    return;
  end if;
  select * into strict c from pg_temp.p9_8_5_ctx;

  begin
    v_step:='normal2_make_probe';
    v_probe:=pg_temp.p9_8_5_make_concession(
      c.org_id,c.store_id,c.opportunity_id,c.cycle_id,c.normal_1_quote_id,c.normal_1_version_id,
      'normal',90000,88000,null,'supersede-probe'
    );
    select * into v_r from public.prepare_commercial_negotiation_concession_materialization_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_probe
    );
    v_probe_mat:=v_r.materialization_id;
    update pg_temp.p9_8_5_ctx set superseded_probe_id=v_probe,superseded_probe_mat_id=v_probe_mat;

    perform pg_temp.p9_8_5_assert(29,'probe_reserves_ordinal_2_before_supersede',v_r.reserved_concession_number=2,v_r::text);

    select * into v_r from public.supersede_commercial_negotiation_concession_materialization_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_probe_mat
    );
    perform pg_temp.p9_8_5_assert(
      30,'superseded_materialization_releases_ordinal',
      v_r.state='superseded'
      and v_r.reserved_concession_number is null
      and (select materialized_at from public.commercial_negotiation_concession_materializations where id=v_probe_mat) is null,
      v_r::text
    );

    v_step:='normal2_make_concession';
    v_concession:=pg_temp.p9_8_5_make_concession(
      c.org_id,c.store_id,c.opportunity_id,c.cycle_id,c.normal_1_quote_id,c.normal_1_version_id,
      'normal',90000,85000,null,'normal-2'
    );
    update pg_temp.p9_8_5_ctx set normal_2_id=v_concession;
    select * into v_r from public.prepare_commercial_negotiation_concession_materialization_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_concession
    );
    v_mat:=v_r.materialization_id;
    v_target:=v_r.target_quote_id;
    update pg_temp.p9_8_5_ctx set normal_2_mat_id=v_mat,normal_2_quote_id=v_target;
    perform pg_temp.p9_8_5_assert(31,'normal_2_reuses_released_ordinal_2',v_r.reserved_concession_number=2,v_r::text);

    v_step:='normal2_materialize_target_quote';
    perform * from public.materialize_commercial_negotiation_concession_target_quote_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_mat
    );
    v_step:='normal2_make_target_version';
    v_version:=pg_temp.p9_8_5_make_target_version(c.org_id,c.store_id,v_target,'normal-2');
    update pg_temp.p9_8_5_ctx set normal_2_version_id=v_version;
    perform * from public.bind_commercial_negotiation_concession_materialization_version_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_mat,v_target,v_version
    );
    v_step:='normal2_materialize_send';
    select * into v_r from public.materialize_commercial_negotiation_concession_send_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_mat,c.conversation_id,v_target,v_version,
      'P9 8.5 normal concession #2','{}'::jsonb
    );
    v_message:=v_r.message_id;
    update pg_temp.p9_8_5_ctx set normal_2_message_id=v_message;
    perform pg_temp.p9_8_5_claim_message(c.org_id,c.store_id,v_message);
    v_gate:=public.validate_or_cancel_whatsapp_external_send_v2_by_system(c.org_id,c.store_id,v_message);
    perform pg_temp.p9_8_5_assert(
      32,'normal_2_complete_path_reaches_provider_boundary',
      v_gate->>'decision'='send'
      and (select total_cents from public.sales_quotes where id=v_target)=85000
      and (select approved_by from public.sales_quotes where id=v_target) is null,
      v_gate::text
    );

    v_step:='normal2_provider_evidence';
    perform public.mark_message_external_sent_v2(
      c.org_id,c.store_id,v_message,'wamid.p985.normal2.'||replace(gen_random_uuid()::text,'-','')
    );
    select metadata, outbound_provider_accepted_at, external_message_id
      into v_metadata,v_provider_at,v_external
      from public.messages where id=v_message;

    -- Simulate a crash-window failure AFTER the provider fact already exists.
    -- Tamper only the 8.5 materialization metadata so canonical finalize reaches
    -- outbound_commercial_finalized_at, then the 8.5 trigger rejects the bad scope.
    update public.messages
       set metadata=pg_catalog.jsonb_set(
         metadata,
         '{commercial_negotiation_concession_materialization_id}',
         pg_catalog.to_jsonb(v_wrong_mat::text),
         true
       )
     where id=v_message;

    begin
      perform * from public.finalize_sales_quote_send_by_system(
        c.org_id,c.store_id,c.opportunity_id,v_target,v_version,v_message,
        'sales_quote_send:'||c.org_id::text||':'||c.store_id::text||':'||c.opportunity_id::text||':'||v_target::text||':'||v_version::text,
        'system_quote_send_reconciliation'
      );
    exception when others then
      v_finalize_failed:=true;
      v_finalize_error:=sqlstate||' '||sqlerrm;
    end;

    perform pg_temp.p9_8_5_assert(
      33,'failed_commercial_finalize_rolls_back_projection_but_provider_fact_survives',
      v_finalize_failed
      and (select outbound_provider_accepted_at from public.messages where id=v_message)=v_provider_at
      and (select external_message_id from public.messages where id=v_message)=v_external
      and (select outbound_delivery_state from public.messages where id=v_message)='sent'
      and (select outbound_commercial_finalized_at from public.messages where id=v_message) is null
      and (select sent_at from public.sales_quote_versions where id=v_version) is null,
      coalesce(v_finalize_error,'finalize unexpectedly succeeded')
    );

    update public.messages set metadata=v_metadata where id=v_message;

    v_step:='normal2_reconciliation_finalize';
    select * into v_final from public.finalize_sales_quote_send_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_target,v_version,v_message,
      'sales_quote_send:'||c.org_id::text||':'||c.store_id::text||':'||c.opportunity_id::text||':'||v_target::text||':'||v_version::text,
      'system_quote_send_reconciliation'
    );

    perform pg_temp.p9_8_5_assert(
      34,'reconciliation_finalizes_without_second_provider_post',
      (select status from public.commercial_negotiation_concessions where id=v_concession)='materialized'
      and (select concession_number from public.commercial_negotiation_concessions where id=v_concession)=2
      and (select state from public.commercial_negotiation_concession_materializations where id=v_mat)='materialized'
      and (select external_message_id from public.messages where id=v_message)=v_external
      and exists(
        select 1 from public.p9_resolve_current_commercial_proposal_internal(c.org_id,c.store_id,c.opportunity_id) p
        where p.current_quote_id=v_target and p.current_quote_version_id=v_version
      ),
      coalesce(v_final::text,'<null>')
    );

    -- Third normal concession in the same negotiation cycle must be rejected.
    declare
      v_third uuid;
    begin
      v_third:=pg_temp.p9_8_5_make_concession(
        c.org_id,c.store_id,c.opportunity_id,c.cycle_id,v_target,v_version,
        'normal',85000,84000,null,'third-normal'
      );
      perform pg_temp.p9_8_5_expect_error(
        35,'third_normal_concession_blocked',
        pg_catalog.format(
          'select * from public.prepare_commercial_negotiation_concession_materialization_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
          c.org_id,c.store_id,c.opportunity_id,v_third
        ),
        'P9_8_5_THIRD_NORMAL_BLOCKED'
      );
    end;

    perform pg_temp.p9_8_5_assert(
      36,'normal_2_keeps_same_stage_and_cycle',
      (select stage from public.commercial_opportunities where id=c.opportunity_id)='negociacao'
      and (select lifecycle_cycle from public.commercial_opportunities where id=c.opportunity_id)=1,
      'no negociacao -> orcamento -> negociacao ping-pong'
    );
  exception when others then
    perform pg_temp.p9_8_5_record(
      199,'normal_2_flow_unexpected_error','ERROR',
      'step='||coalesce(v_step,'<unknown>')||' '||sqlstate||' '||sqlerrm
    );
  end;
end;
$normal2$;

-- ============================================================================
-- 5. Explicit stale-cycle blocking.
-- ============================================================================
do $stale_cycle$
declare
  c pg_temp.p9_8_5_ctx%rowtype;
  v_cycle uuid:=gen_random_uuid();
  v_event_key text;
  v_concession uuid;
begin
  if not exists(select 1 from pg_temp.p9_8_5_ctx where normal_2_quote_id is not null and normal_2_version_id is not null) then
    perform pg_temp.p9_8_5_record(37,'stale_cycle_blocked','SKIP','normal #2 unavailable');
    return;
  end if;
  select * into strict c from pg_temp.p9_8_5_ctx;

  begin
    v_event_key:=public.compute_commercial_opportunity_event_fingerprint_internal(
      c.org_id,c.store_id,c.opportunity_id,2,'stage_transition','orcamento','negociacao','system',null,
      'concrete_quote_objection_required',null,'p9_8_5_runner','material_negotiation_discount_request',null,
      'P9 8.5 intentionally stale cycle fixture'
    );

    insert into public.commercial_opportunity_lifecycle_events(
      id,organization_id,store_id,commercial_opportunity_id,customer_id,lifecycle_cycle,
      event_type,previous_stage,new_stage,reason_code,evidence_type,evidence_summary,
      actor_type,source,metadata,idempotency_key,event_key
    ) values(
      v_cycle,c.org_id,c.store_id,c.opportunity_id,c.customer_id,2,
      'stage_transition','orcamento','negociacao','concrete_quote_objection_required',
      'material_negotiation_discount_request','P9 8.5 stale cycle fixture',
      'system','p9_8_5_runner','{}'::jsonb,'p9_8_5_stale_cycle:'||v_cycle::text,v_event_key
    );
    update pg_temp.p9_8_5_ctx set stale_cycle_id=v_cycle;

    v_concession:=pg_temp.p9_8_5_make_concession(
      c.org_id,c.store_id,c.opportunity_id,v_cycle,c.normal_2_quote_id,c.normal_2_version_id,
      'human_exception',85000,84000,c.actor_id,'stale-cycle'
    );

    perform pg_temp.p9_8_5_expect_error(
      37,'stale_cycle_blocked',
      pg_catalog.format(
        'select * from public.prepare_commercial_negotiation_concession_materialization_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
        c.org_id,c.store_id,c.opportunity_id,v_concession
      ),
      'P9_8_5_NEGOTIATION_CYCLE_STALE'
    );
  exception when others then
    perform pg_temp.p9_8_5_record(37,'stale_cycle_blocked','ERROR',sqlstate||' '||sqlerrm);
  end;
end;
$stale_cycle$;

-- ============================================================================
-- 6. Human exception: real approval required, ordinal stays NULL, full send.
-- ============================================================================
do $human_exception$
declare
  c pg_temp.p9_8_5_ctx%rowtype;
  v_invalid uuid:=gen_random_uuid();
  v_concession uuid;
  v_mat uuid;
  v_target uuid;
  v_version uuid;
  v_message uuid;
  v_r record;
  v_gate jsonb;
  v_final record;
  v_invalid_failed boolean:=false;
  v_invalid_error text:=null;
  v_step text:='start';
begin
  if not exists(select 1 from pg_temp.p9_8_5_ctx where normal_2_quote_id is not null and normal_2_version_id is not null) then
    for i in 38..43 loop perform pg_temp.p9_8_5_record(i,'human_exception_flow','SKIP','normal #2 unavailable'); end loop;
    return;
  end if;
  select * into strict c from pg_temp.p9_8_5_ctx;

  begin
    -- Prove the ledger itself refuses an authorized human exception without a
    -- real approval actor/decision. This is fixture-level enforcement from 8.4
    -- and is revalidated again by 8.5.
    begin
      insert into public.commercial_negotiation_concessions(
        id,organization_id,store_id,commercial_opportunity_id,negotiation_cycle_id,
        quote_id,quote_version_id,concession_class,concession_kind,status,concession_number,
        previous_condition,proposed_condition,requested_discount_percent,requested_discount_cents,
        counterpart_snapshot,policy_snapshot,authority_snapshot,authority_decision,effective_decision,
        high_value,high_value_context,origin,operation_key,request_fingerprint,approval_status,authorized_at
      ) values(
        v_invalid,c.org_id,c.store_id,c.opportunity_id,c.cycle_id,
        c.normal_2_quote_id,c.normal_2_version_id,'human_exception','discount','authorized',null,
        pg_catalog.jsonb_build_object('price_cents',85000),pg_catalog.jsonb_build_object('price_cents',84000),
        1.1765,1000,'{}','{}','{}','allowed','allowed',false,'{}','human',
        'p9_8_5_runner:invalid-human:'||v_invalid::text,repeat('e',64),'not_required',clock_timestamp()
      );
    exception when others then
      v_invalid_failed:=true;
      v_invalid_error:=sqlstate||' '||sqlerrm;
    end;

    perform pg_temp.p9_8_5_assert(
      38,'human_exception_without_real_approval_rejected',
      v_invalid_failed,
      coalesce(v_invalid_error,'invalid human exception was accepted')
    );

    v_step:='human_make_proposed_exception';
    v_concession:=pg_temp.p9_8_5_make_human_exception_proposed(
      c.org_id,c.store_id,c.opportunity_id,c.cycle_id,c.normal_2_quote_id,c.normal_2_version_id,
      85000,83000,'human-exception'
    );
    update pg_temp.p9_8_5_ctx set human_exception_id=v_concession;

    -- Exercise the real 8.4 B2B human writer. The actor is not accepted from
    -- the concession payload; it is resolved from auth.uid() + membership.
    perform pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
    perform pg_catalog.set_config('request.jwt.claim.sub',c.actor_id::text,true);
    perform pg_catalog.set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object('role','authenticated','sub',c.actor_id)::text,
      true
    );

    v_step:='human_real_8_4_decision';
    select * into v_r from public.decide_commercial_negotiation_concession_by_human(
      c.org_id,c.store_id,c.opportunity_id,v_concession,
      'approve','P9 8.5 real human exception approval','p9-8-5-runner'
    );

    perform pg_catalog.set_config('request.jwt.claim.role','',true);
    perform pg_catalog.set_config('request.jwt.claim.sub','',true);
    perform pg_catalog.set_config('request.jwt.claims','{}',true);

    perform pg_temp.p9_8_5_assert(
      39,
      'human_exception_real_8_4_approval_then_prepare_has_null_ordinal',
      v_r.status='authorized'
      and v_r.effective_decision='allowed'
      and exists(
        select 1
        from public.commercial_negotiation_concession_decision_events e
        where e.concession_id=v_concession
          and e.decision_kind='human_decision'
          and e.actor_kind='human'
          and e.actor_user_id=c.actor_id
      )
      and (select approval_status from public.commercial_negotiation_concessions where id=v_concession)='approved'
      and (select approval_actor_user_id from public.commercial_negotiation_concessions where id=v_concession)=c.actor_id,
      v_r::text
    );

    v_step:='human_prepare_materialization';
    select * into v_r from public.prepare_commercial_negotiation_concession_materialization_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_concession
    );
    v_mat:=v_r.materialization_id;
    v_target:=v_r.target_quote_id;
    update pg_temp.p9_8_5_ctx set human_exception_mat_id=v_mat,human_exception_quote_id=v_target;

    if v_r.reserved_concession_number is not null then
      raise exception using errcode='P0001',message='P9_8_5_RUNNER_HUMAN_EXCEPTION_RESERVED_ORDINAL';
    end if;

    v_step:='human_materialize_target_quote';
    perform * from public.materialize_commercial_negotiation_concession_target_quote_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_mat
    );
    v_step:='human_make_target_version';
    v_version:=pg_temp.p9_8_5_make_target_version(c.org_id,c.store_id,v_target,'human-exception');
    update pg_temp.p9_8_5_ctx set human_exception_version_id=v_version;
    perform * from public.bind_commercial_negotiation_concession_materialization_version_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_mat,v_target,v_version
    );
    v_step:='human_materialize_send';
    select * into v_r from public.materialize_commercial_negotiation_concession_send_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_mat,c.conversation_id,v_target,v_version,
      'P9 8.5 human exception','{}'::jsonb
    );
    v_message:=v_r.message_id;
    update pg_temp.p9_8_5_ctx set human_exception_message_id=v_message;
    perform pg_temp.p9_8_5_claim_message(c.org_id,c.store_id,v_message);
    v_gate:=public.validate_or_cancel_whatsapp_external_send_v2_by_system(c.org_id,c.store_id,v_message);

    perform pg_temp.p9_8_5_assert(
      40,'human_exception_specialized_gate_allowed_with_real_8_4_approval',
      v_gate->>'decision'='send'
      and (select approval_status from public.commercial_negotiation_concessions where id=v_concession)='approved'
      and (select approval_actor_user_id from public.commercial_negotiation_concessions where id=v_concession)=c.actor_id
      and (select approved_by from public.sales_quotes where id=v_target) is null,
      v_gate::text
    );

    v_step:='human_provider_evidence';
    perform public.mark_message_external_sent_v2(
      c.org_id,c.store_id,v_message,'wamid.p985.human.'||replace(gen_random_uuid()::text,'-','')
    );
    v_step:='human_canonical_finalize';
    select * into v_final from public.finalize_sales_quote_send_by_system(
      c.org_id,c.store_id,c.opportunity_id,v_target,v_version,v_message,
      'sales_quote_send:'||c.org_id::text||':'||c.store_id::text||':'||c.opportunity_id::text||':'||v_target::text||':'||v_version::text,
      'system_quote_send_reconciliation'
    );

    perform pg_temp.p9_8_5_assert(
      41,'human_exception_materializes_with_null_definitive_ordinal',
      (select status from public.commercial_negotiation_concessions where id=v_concession)='materialized'
      and (select concession_number from public.commercial_negotiation_concessions where id=v_concession) is null
      and (select reserved_concession_number from public.commercial_negotiation_concession_materializations where id=v_mat) is null
      and (select state from public.commercial_negotiation_concession_materializations where id=v_mat)='materialized',
      coalesce(v_final::text,'<null>')
    );

    perform pg_temp.p9_8_5_assert(
      42,'human_exception_becomes_current_proposal_without_fake_quote_approval',
      exists(
        select 1 from public.p9_resolve_current_commercial_proposal_internal(c.org_id,c.store_id,c.opportunity_id) p
        where p.current_quote_id=v_target and p.current_quote_version_id=v_version
      )
      and (select approved_at from public.sales_quotes where id=v_target) is null
      and (select approved_by from public.sales_quotes where id=v_target) is null,
      'target='||v_target::text
    );

    perform pg_temp.p9_8_5_assert(
      43,'all_8_5_materialization_keeps_stage_negociacao',
      (select stage from public.commercial_opportunities where id=c.opportunity_id)='negociacao',
      'stage='||(select stage from public.commercial_opportunities where id=c.opportunity_id)
    );
  exception when others then
    perform pg_catalog.set_config('request.jwt.claim.role','',true);
    perform pg_catalog.set_config('request.jwt.claim.sub','',true);
    perform pg_catalog.set_config('request.jwt.claims','{}',true);
    perform pg_temp.p9_8_5_record(
      299,'human_exception_flow_unexpected_error','ERROR',
      'step='||coalesce(v_step,'<unknown>')||' '||sqlstate||' '||sqlerrm
    );
  end;
end;
$human_exception$;

-- ============================================================================
-- 7. Final integrity checks. No real fixture may survive ROLLBACK.
-- ============================================================================
do $final_checks$
declare
  c pg_temp.p9_8_5_ctx%rowtype;
  v_normal_materialized integer;
  v_active_reserved integer;
  v_lifecycle_count integer;
begin
  if not exists(select 1 from pg_temp.p9_8_5_ctx) then
    perform pg_temp.p9_8_5_record(44,'final_cycle_and_ordinal_integrity','SKIP','fixture unavailable');
    perform pg_temp.p9_8_5_record(45,'rollback_only_runner_ready','SKIP','fixture unavailable');
    return;
  end if;
  select * into strict c from pg_temp.p9_8_5_ctx;

  select count(*) into v_normal_materialized
  from public.commercial_negotiation_concessions
  where organization_id=c.org_id and store_id=c.store_id
    and negotiation_cycle_id=c.cycle_id
    and concession_class='normal'
    and status='materialized'
    and concession_number in (1,2);

  select count(*) into v_active_reserved
  from public.commercial_negotiation_concession_materializations
  where organization_id=c.org_id and store_id=c.store_id
    and negotiation_cycle_id=c.cycle_id
    and reserved_concession_number is not null
    and state<>'materialized';

  select count(*) into v_lifecycle_count
  from public.commercial_opportunity_lifecycle_events
  where commercial_opportunity_id=c.opportunity_id;

  perform pg_temp.p9_8_5_assert(
    44,'final_cycle_and_ordinal_integrity',
    v_normal_materialized=2
    and v_active_reserved=0
    and (select stage from public.commercial_opportunities where id=c.opportunity_id)='negociacao'
    and v_lifecycle_count = c.initial_lifecycle_count + case when c.stale_cycle_id is null then 0 else 1 end,
    'normal_materialized='||v_normal_materialized||' active_nonterminal_reserved='||v_active_reserved||' lifecycle_events='||v_lifecycle_count
  );

  perform pg_temp.p9_8_5_assert(
    45,'rollback_only_runner_ready',
    exists(select 1 from public.organizations where id=c.org_id)
    and exists(select 1 from public.conversations where id=c.conversation_id)
    and exists(select 1 from public.commercial_opportunities where id=c.opportunity_id),
    'fixture exists inside transaction now; final ROLLBACK below removes it'
  );
end;
$final_checks$;

-- Results are emitted in ONE result set before rollback.
-- Supabase SQL Editor may display only the final result set, so every row
-- carries the aggregate summary and ERROR details remain visible.
with summary as (
  select
    count(*) filter (where status='PASS' and n between 1 and 45) as pass_count,
    count(*) filter (where status='FAIL') as fail_count,
    count(*) filter (where status='ERROR') as error_count,
    count(*) filter (where status='SKIP') as skip_count,
    count(*) filter (where n between 1 and 45) as numbered_scenario_count,
    case
      when count(*) filter (where status in ('FAIL','ERROR','SKIP'))=0
       and count(*) filter (where n between 1 and 45)=45
       and count(*) filter (where status='PASS' and n between 1 and 45)=45
      then 'P9_8_5_REAL_SUT_PASS'
      else 'P9_8_5_REVIEW_REQUIRED'
    end as overall_status
  from pg_temp.p9_8_5_results
)
select
  r.n,
  r.name,
  r.status,
  r.details,
  s.pass_count,
  s.fail_count,
  s.error_count,
  s.skip_count,
  s.numbered_scenario_count,
  s.overall_status,
  true as rollback_only
from pg_temp.p9_8_5_results r
cross join summary s
order by r.n;

rollback;

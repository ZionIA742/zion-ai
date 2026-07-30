begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b1:e1.5:sales-contract-customer-acceptance-atomic:manual-checks:v1',
    0
  )
);

drop table if exists pg_temp._p9_e15_results;
drop table if exists pg_temp._p9_e15_matrix;
drop table if exists pg_temp._p9_e15_ctx;

create temp table pg_temp._p9_e15_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null,
  returned_sqlstate text null,
  constraint_name text null
) on commit preserve rows;

create temp table pg_temp._p9_e15_matrix (
  scenario_number integer primary key,
  scenario_name text not null,
  coverage_rule text not null,
  expected_outcome text not null
) on commit preserve rows;

create temp table pg_temp._p9_e15_ctx (
  singleton boolean primary key default true check (singleton),
  run_id uuid not null,
  organization_id uuid not null,
  store_id uuid not null,
  lead_id uuid not null,
  conversation_id uuid not null,
  second_organization_id uuid null,
  second_store_id uuid null,
  second_conversation_id uuid null,
  same_scope_other_conversation_id uuid null,
  tied_lead_id uuid null,
  tied_conversation_id uuid null,
  other_org_conversation_id uuid null,
  other_store_conversation_id uuid null,
  contract_id uuid not null,
  version_id uuid not null,
  contract_manual_id uuid not null,
  version_manual_id uuid not null,
  contract_partial_id uuid not null,
  version_partial_id uuid not null,
  contract_completed_id uuid not null,
  version_completed_id uuid not null,
  contract_store_signed_id uuid not null,
  version_store_signed_id uuid not null,
  message_sync_metadata_id uuid null,
  message_sync_column_id uuid null,
  message_divergence_metadata_id uuid null,
  message_divergence_column_id uuid null,
  message_divergence_guard_metadata_id uuid null,
  message_divergence_guard_column_id uuid null,
  message_anchor_old_id uuid null,
  message_anchor_success_id uuid null,
  message_anchor_after_retry_id uuid null,
  message_anchor_tie_a_id uuid null,
  message_anchor_tie_b_id uuid null,
  message_wrong_sender_id uuid null,
  message_wrong_conversation_id uuid null,
  message_wrong_store_id uuid null,
  message_wrong_org_id uuid null
) on commit preserve rows;

insert into pg_temp._p9_e15_matrix (
  scenario_number,
  scenario_name,
  coverage_rule,
  expected_outcome
) values
  (1, 'objetos criados', 'helper de lock, helper de conteudo, trigger de sync e RPC existem com owner/grants esperados', 'PASS'),
  (2, 'trigger_message_id estrutural', 'coluna uuid, FK para messages(id) e indice unico parcial existem', 'PASS'),
  (3, 'backfill seguro', 'linhas antigas com metadata.trigger_message_id valido preenchem a coluna real', 'PASS'),
  (4, 'sync metadata para coluna', 'trigger BEFORE preenche trigger_message_id quando metadata chega so com o UUID textual', 'PASS'),
  (5, 'sync coluna para metadata', 'trigger BEFORE injeta metadata.trigger_message_id quando a coluna chega preenchida', 'PASS'),
  (6, 'divergencia coluna metadata', 'trigger rejeita UUIDs diferentes entre coluna e metadata', 'PASS'),
  (7, 'insert_message usa lock comum', 'insert_message preserva contrato anterior e referencia o mesmo helper transacional antes de ensure_commercial_conversation_session_context', 'PASS'),
  (8, 'aceite manual normal', 'RPC assina contrato sent_to_customer e versao sent sem ancora', 'PASS'),
  (9, 'aceite com ancora normal', 'RPC assina contrato sent_to_customer usando a ultima mensagem elegivel informada', 'PASS'),
  (10, 'contrato e versao atualizados juntos', 'status final de contrato e versao converge para customer_signed na mesma transacao', 'PASS'),
  (11, 'retry manual idempotente', 'segunda chamada manual na mesma versao retorna already_applied', 'PASS'),
  (12, 'retry da mesma ancora', 'segunda chamada com a mesma trigger_message_id retorna already_applied', 'PASS'),
  (13, 'ancora diferente apos assinatura', 'ancora nova apos assinatura customer existente retorna conflito deterministico', 'PASS'),
  (14, 'mensagem de outra organizacao rejeitada', 'ancora fora da organization_id falha sem fallback', 'PASS'),
  (15, 'mensagem de outra loja rejeitada', 'ancora fora da store_id falha sem fallback', 'PASS'),
  (16, 'mensagem de outra conversa rejeitada', 'ancora fora da conversation_id falha sem fallback', 'PASS'),
  (17, 'mensagem nao user incoming rejeitada', 'mensagem explicita precisa ser user + incoming + conteudo efetivo', 'PASS'),
  (18, 'ancora nao ultima rejeitada', 'mensagem elegivel mais recente invalida ancora antiga', 'PASS'),
  (19, 'empate de created_at rejeitado', 'duas mensagens inbound elegiveis com mesmo created_at tornam a ordenacao ambigua', 'PASS'),
  (20, 'versao esperada diferente rejeitada', 'RPC rejeita p_expected_contract_version_id diferente de current_version_id', 'PASS'),
  (21, 'versao de outro contrato rejeitada', 'RPC rejeita contract_version_id cuja contract_id nao bate com o contrato informado', 'PASS'),
  (22, 'divergencia de organizacao loja rejeitada', 'RPC rejeita qualquer escopo informado diferente do contrato real', 'PASS'),
  (23, 'estado parcial reconciliado', 'assinatura preexistente com contrato e versao ainda em sent* e reconciliada sob lock', 'PASS'),
  (24, 'completed nao rebaixa', 'estado completed com assinatura customer compativel retorna already_applied sem downgrade', 'PASS'),
  (25, 'store_signed nao rebaixa', 'estado store_signed com assinatura customer compativel retorna already_applied sem downgrade', 'PASS'),
  (26, 'assinatura customer unica por versao', 'nao cria duas assinaturas customer para a mesma contract_version_id', 'PASS'),
  (27, 'trigger_message_id unica', 'a mesma trigger_message_id nao pode ser reutilizada em outra assinatura', 'PASS'),
  (28, 'grants anon authenticated revogados', 'anon/authenticated perdem privilegios diretos nas tres tabelas e service_role mantem EXECUTE da RPC', 'PASS'),
  (29, 'RPC e insert_message chamam o mesmo helper', 'catalogo prova que as duas funcoes referenciam private_acquire_sales_contract_conversation_xact_lock', 'PASS'),
  (30, 'rollback final', 'todas as fixtures criadas ficam restritas a esta transacao e o arquivo termina com ROLLBACK', 'PASS'),
  (31, 'assinatura rejected nao avanca estado', 'assinatura customer rejected gera erro deterministico e nao avanca contrato nem versao', 'PASS'),
  (32, 'assinatura cancelled nao avanca estado', 'assinatura customer cancelled gera erro deterministico e nao avanca contrato nem versao', 'PASS'),
  (33, 'assinatura manual nao aceita replay ancorado', 'chamada ancorada contra assinatura manual sem trigger_message_id falha com erro deterministico', 'PASS'),
  (34, 'accepted_via manual e sempre sistemico', 'p_metadata nao consegue forjar accepted_via em aceite manual', 'PASS'),
  (35, 'divergencia coluna metadata protegida', 'protecao de sync rejeita divergencia entre coluna e metadata', 'PASS'),
  (36, 'assinatura pending nao avanca estado', 'assinatura customer pending gera erro deterministico e nao avanca contrato nem versao', 'PASS');

create or replace function pg_temp._assert(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_condition, false) then
    raise exception using errcode = 'P0001', message = p_message;
  end if;
end;
$$;

create or replace function pg_temp._record_success(p_scenario integer, p_name text, p_detail text)
returns void
language sql
as $$
  insert into pg_temp._p9_e15_results (
    scenario_number,
    scenario_name,
    status,
    detail,
    returned_sqlstate,
    constraint_name
  )
  values ($1, $2, 'PASS', $3, null, null)
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      detail = excluded.detail,
      returned_sqlstate = excluded.returned_sqlstate,
      constraint_name = excluded.constraint_name;
$$;

create or replace function pg_temp._record_failure(
  p_scenario integer,
  p_name text,
  p_status text,
  p_detail text,
  p_sqlstate text default null,
  p_constraint text default null
)
returns void
language sql
as $$
  insert into pg_temp._p9_e15_results (
    scenario_number,
    scenario_name,
    status,
    detail,
    returned_sqlstate,
    constraint_name
  )
  values ($1, $2, $3, $4, $5, $6)
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      detail = excluded.detail,
      returned_sqlstate = excluded.returned_sqlstate,
      constraint_name = excluded.constraint_name;
$$;

do $setup$
declare
  v_scope record;
  v_run_id uuid := gen_random_uuid();
  v_same_scope_other_lead_id uuid := gen_random_uuid();
  v_same_scope_other_conversation_id uuid := gen_random_uuid();
  v_tied_lead_id uuid := gen_random_uuid();
  v_tied_conversation_id uuid := gen_random_uuid();
  v_other_org_id uuid := gen_random_uuid();
  v_other_org_store_id uuid := gen_random_uuid();
  v_other_org_lead_id uuid := gen_random_uuid();
  v_other_org_conversation_id uuid := gen_random_uuid();
  v_other_store_id uuid := gen_random_uuid();
  v_other_store_lead_id uuid := gen_random_uuid();
  v_other_store_conversation_id uuid := gen_random_uuid();
  v_message_sync_metadata public.messages%rowtype;
  v_message_sync_column public.messages%rowtype;
  v_message_divergence_metadata public.messages%rowtype;
  v_message_divergence_column public.messages%rowtype;
  v_message_divergence_guard_metadata public.messages%rowtype;
  v_message_divergence_guard_column public.messages%rowtype;
  v_message_old public.messages%rowtype;
  v_message_anchor_success public.messages%rowtype;
  v_message_tie_a public.messages%rowtype;
  v_message_tie_b public.messages%rowtype;
  v_message_wrong_sender public.messages%rowtype;
  v_message_wrong_conversation public.messages%rowtype;
  v_message_wrong_store public.messages%rowtype;
  v_message_wrong_org public.messages%rowtype;
  v_tie_created_at timestamptz;
begin
  select
    conv.organization_id,
    lead.store_id,
    lead.id as lead_id,
    conv.id as conversation_id
  into v_scope
  from public.conversations conv
  join public.leads lead
    on lead.id = conv.lead_id
  where conv.organization_id is not null
    and lead.store_id is not null
  order by conv.created_at nulls first, conv.id
  limit 1;

  if v_scope.organization_id is null then
    raise exception 'SETUP_SCOPE_NOT_FOUND';
  end if;

  insert into public.organizations (id, name)
  values
    (v_other_org_id, 'Runner P9 E15 Other Org ' || v_run_id::text);

  insert into public.stores (id, organization_id, name, created_at)
  values
    (v_other_org_store_id, v_other_org_id, 'Runner P9 E15 Other Org Store ' || v_run_id::text, now()),
    (v_other_store_id, v_scope.organization_id, 'Runner P9 E15 Other Store ' || v_run_id::text, now());

  insert into public.leads (
    id,
    organization_id,
    store_id,
    state,
    created_at,
    updated_at
  )
  values
    (v_same_scope_other_lead_id, v_scope.organization_id, v_scope.store_id, 'negociacao', now(), now()),
    (v_tied_lead_id, v_scope.organization_id, v_scope.store_id, 'negociacao', now(), now()),
    (v_other_org_lead_id, v_other_org_id, v_other_org_store_id, 'negociacao', now(), now()),
    (v_other_store_lead_id, v_scope.organization_id, v_other_store_id, 'negociacao', now(), now());

  insert into public.conversations (
    id,
    organization_id,
    lead_id,
    status,
    is_human_active,
    created_at
  )
  values
    (v_same_scope_other_conversation_id, v_scope.organization_id, v_same_scope_other_lead_id, 'open', false, now()),
    (v_tied_conversation_id, v_scope.organization_id, v_tied_lead_id, 'open', false, now()),
    (v_other_org_conversation_id, v_other_org_id, v_other_org_lead_id, 'open', false, now()),
    (v_other_store_conversation_id, v_scope.organization_id, v_other_store_lead_id, 'open', false, now());

  insert into pg_temp._p9_e15_ctx (
    run_id,
    organization_id,
    store_id,
    lead_id,
    conversation_id,
    second_organization_id,
    second_store_id,
    second_conversation_id,
    same_scope_other_conversation_id,
    tied_lead_id,
    tied_conversation_id,
    other_org_conversation_id,
    other_store_conversation_id,
    contract_id,
    version_id,
    contract_manual_id,
    version_manual_id,
    contract_partial_id,
    version_partial_id,
    contract_completed_id,
    version_completed_id,
    contract_store_signed_id,
    version_store_signed_id,
    message_sync_metadata_id,
    message_sync_column_id,
    message_divergence_metadata_id,
    message_divergence_column_id,
    message_divergence_guard_metadata_id,
    message_divergence_guard_column_id,
    message_anchor_old_id,
    message_anchor_success_id,
    message_anchor_after_retry_id,
    message_anchor_tie_a_id,
    message_anchor_tie_b_id,
    message_wrong_sender_id,
    message_wrong_conversation_id,
    message_wrong_store_id,
    message_wrong_org_id
  )
  values (
    v_run_id,
    v_scope.organization_id,
    v_scope.store_id,
    v_scope.lead_id,
    v_scope.conversation_id,
    v_other_org_id,
    v_other_store_id,
    v_tied_conversation_id,
    v_same_scope_other_conversation_id,
    v_tied_lead_id,
    v_tied_conversation_id,
    v_other_org_conversation_id,
    v_other_store_conversation_id,
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null
  );

  insert into public.sales_contracts (
    id, organization_id, store_id, lead_id, conversation_id, quote_id, quote_version_id,
    current_version_id, contract_number, status, title, customer_name, customer_phone,
    currency, subtotal_cents, discount_cents, total_cents, payment_terms, delivery_terms,
    warranty_terms, contract_terms, valid_until, metadata
  )
  select
    ctx.contract_id, ctx.organization_id, ctx.store_id, ctx.lead_id, ctx.conversation_id,
    null, null, null,
    'P9-E15-' || replace(ctx.contract_id::text, '-', ''),
    'sent_to_customer',
    'Runner contract anchor',
    'Cliente Runner',
    '5599999999999',
    'BRL', 1000, 0, 1000,
    'avista', null, null, 'runner',
    (clock_timestamp() + interval '7 day')::date,
    jsonb_build_object('runner', 'p9_e15')
  from pg_temp._p9_e15_ctx ctx;

  insert into public.sales_contract_versions (
    id, contract_id, organization_id, store_id, version_number, status, store_file_id,
    storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
  )
  select
    ctx.version_id, ctx.contract_id, ctx.organization_id, ctx.store_id,
    1, 'sent', null,
    'runner', 'runner/' || ctx.version_id::text || '.pdf', 'runner-contract.pdf',
    'application/pdf', 123, jsonb_build_object('runner', 'p9_e15')
  from pg_temp._p9_e15_ctx ctx;

  update public.sales_contracts con
  set current_version_id = ctx.version_id
  from pg_temp._p9_e15_ctx ctx
  where con.id = ctx.contract_id;

  insert into public.sales_contracts (
    id, organization_id, store_id, lead_id, conversation_id, quote_id, quote_version_id,
    current_version_id, contract_number, status, title, customer_name, customer_phone,
    currency, subtotal_cents, discount_cents, total_cents, payment_terms, delivery_terms,
    warranty_terms, contract_terms, valid_until, metadata
  )
  select
    ctx.contract_manual_id, ctx.organization_id, ctx.store_id, ctx.lead_id, ctx.conversation_id,
    null, null, null,
    'P9-E15-MAN-' || replace(ctx.contract_manual_id::text, '-', ''),
    'sent_to_customer',
    'Runner contract manual',
    'Cliente Runner',
    '5599999999999',
    'BRL', 2000, 0, 2000,
    'avista', null, null, 'runner',
    (clock_timestamp() + interval '7 day')::date,
    jsonb_build_object('runner', 'p9_e15')
  from pg_temp._p9_e15_ctx ctx;

  insert into public.sales_contract_versions (
    id, contract_id, organization_id, store_id, version_number, status, store_file_id,
    storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
  )
  select
    ctx.version_manual_id, ctx.contract_manual_id, ctx.organization_id, ctx.store_id,
    1, 'sent', null,
    'runner', 'runner/' || ctx.version_manual_id::text || '.pdf', 'runner-contract-manual.pdf',
    'application/pdf', 123, jsonb_build_object('runner', 'p9_e15')
  from pg_temp._p9_e15_ctx ctx;

  update public.sales_contracts con
  set current_version_id = ctx.version_manual_id
  from pg_temp._p9_e15_ctx ctx
  where con.id = ctx.contract_manual_id;

  insert into public.sales_contracts (
    id, organization_id, store_id, lead_id, conversation_id, quote_id, quote_version_id,
    current_version_id, contract_number, status, title, customer_name, customer_phone,
    currency, subtotal_cents, discount_cents, total_cents, payment_terms, delivery_terms,
    warranty_terms, contract_terms, valid_until, metadata
  )
  select
    ctx.contract_partial_id, ctx.organization_id, ctx.store_id, ctx.lead_id, ctx.conversation_id,
    null, null, null,
    'P9-E15-PAR-' || replace(ctx.contract_partial_id::text, '-', ''),
    'sent_to_customer',
    'Runner contract partial',
    'Cliente Runner',
    '5599999999999',
    'BRL', 3000, 0, 3000,
    'avista', null, null, 'runner',
    (clock_timestamp() + interval '7 day')::date,
    jsonb_build_object('runner', 'p9_e15')
  from pg_temp._p9_e15_ctx ctx;

  insert into public.sales_contract_versions (
    id, contract_id, organization_id, store_id, version_number, status, store_file_id,
    storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
  )
  select
    ctx.version_partial_id, ctx.contract_partial_id, ctx.organization_id, ctx.store_id,
    1, 'sent', null,
    'runner', 'runner/' || ctx.version_partial_id::text || '.pdf', 'runner-contract-partial.pdf',
    'application/pdf', 123, jsonb_build_object('runner', 'p9_e15')
  from pg_temp._p9_e15_ctx ctx;

  update public.sales_contracts con
  set current_version_id = ctx.version_partial_id
  from pg_temp._p9_e15_ctx ctx
  where con.id = ctx.contract_partial_id;

  insert into public.sales_contract_signatures (
    contract_id, contract_version_id, organization_id, store_id, signer_type,
    signer_name, signer_phone, signer_email, status, signed_at, acceptance_text, metadata
  )
  select
    ctx.contract_partial_id, ctx.version_partial_id, ctx.organization_id, ctx.store_id, 'customer',
    'Cliente Runner', '5599999999999', 'runner@example.test', 'signed',
    clock_timestamp(), 'aceito', jsonb_build_object('accepted_via', 'manual_direct')
  from pg_temp._p9_e15_ctx ctx;

  insert into public.sales_contracts (
    id, organization_id, store_id, lead_id, conversation_id, quote_id, quote_version_id,
    current_version_id, contract_number, status, title, customer_name, customer_phone,
    currency, subtotal_cents, discount_cents, total_cents, payment_terms, delivery_terms,
    warranty_terms, contract_terms, valid_until, metadata, customer_signed_at, completed_at
  )
  select
    ctx.contract_completed_id, ctx.organization_id, ctx.store_id, ctx.lead_id, ctx.conversation_id,
    null, null, null,
    'P9-E15-COMP-' || replace(ctx.contract_completed_id::text, '-', ''),
    'completed',
    'Runner contract completed',
    'Cliente Runner',
    '5599999999999',
    'BRL', 4000, 0, 4000,
    'avista', null, null, 'runner',
    (clock_timestamp() + interval '7 day')::date,
    jsonb_build_object('runner', 'p9_e15'),
    clock_timestamp() - interval '2 day',
    clock_timestamp() - interval '1 day'
  from pg_temp._p9_e15_ctx ctx;

  insert into public.sales_contract_versions (
    id, contract_id, organization_id, store_id, version_number, status, store_file_id,
    storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
  )
  select
    ctx.version_completed_id, ctx.contract_completed_id, ctx.organization_id, ctx.store_id,
    1, 'completed', null,
    'runner', 'runner/' || ctx.version_completed_id::text || '.pdf', 'runner-contract-completed.pdf',
    'application/pdf', 123, jsonb_build_object('runner', 'p9_e15')
  from pg_temp._p9_e15_ctx ctx;

  update public.sales_contracts con
  set current_version_id = ctx.version_completed_id
  from pg_temp._p9_e15_ctx ctx
  where con.id = ctx.contract_completed_id;

  insert into public.sales_contract_signatures (
    contract_id, contract_version_id, organization_id, store_id, signer_type,
    signer_name, signer_phone, signer_email, status, signed_at, acceptance_text, metadata
  )
  select
    ctx.contract_completed_id, ctx.version_completed_id, ctx.organization_id, ctx.store_id, 'customer',
    'Cliente Runner', '5599999999999', 'runner@example.test', 'signed',
    clock_timestamp() - interval '2 day', 'aceito', jsonb_build_object('accepted_via', 'manual_direct')
  from pg_temp._p9_e15_ctx ctx;

  insert into public.sales_contracts (
    id, organization_id, store_id, lead_id, conversation_id, quote_id, quote_version_id,
    current_version_id, contract_number, status, title, customer_name, customer_phone,
    currency, subtotal_cents, discount_cents, total_cents, payment_terms, delivery_terms,
    warranty_terms, contract_terms, valid_until, metadata, customer_signed_at, store_signed_at
  )
  select
    ctx.contract_store_signed_id, ctx.organization_id, ctx.store_id, ctx.lead_id, ctx.conversation_id,
    null, null, null,
    'P9-E15-STORE-' || replace(ctx.contract_store_signed_id::text, '-', ''),
    'store_signed',
    'Runner contract store signed',
    'Cliente Runner',
    '5599999999999',
    'BRL', 5000, 0, 5000,
    'avista', null, null, 'runner',
    (clock_timestamp() + interval '7 day')::date,
    jsonb_build_object('runner', 'p9_e15'),
    clock_timestamp() - interval '2 day',
    clock_timestamp() - interval '1 day'
  from pg_temp._p9_e15_ctx ctx;

  insert into public.sales_contract_versions (
    id, contract_id, organization_id, store_id, version_number, status, store_file_id,
    storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
  )
  select
    ctx.version_store_signed_id, ctx.contract_store_signed_id, ctx.organization_id, ctx.store_id,
    1, 'store_signed', null,
    'runner', 'runner/' || ctx.version_store_signed_id::text || '.pdf', 'runner-contract-store-signed.pdf',
    'application/pdf', 123, jsonb_build_object('runner', 'p9_e15')
  from pg_temp._p9_e15_ctx ctx;

  update public.sales_contracts con
  set current_version_id = ctx.version_store_signed_id
  from pg_temp._p9_e15_ctx ctx
  where con.id = ctx.contract_store_signed_id;

  insert into public.sales_contract_signatures (
    contract_id, contract_version_id, organization_id, store_id, signer_type,
    signer_name, signer_phone, signer_email, status, signed_at, acceptance_text, metadata
  )
  select
    ctx.contract_store_signed_id, ctx.version_store_signed_id, ctx.organization_id, ctx.store_id, 'customer',
    'Cliente Runner', '5599999999999', 'runner@example.test', 'signed',
    clock_timestamp() - interval '2 day', 'aceito', jsonb_build_object('accepted_via', 'manual_direct')
  from pg_temp._p9_e15_ctx ctx;

  select * into v_message_sync_metadata
  from public.insert_message(
    (select conversation_id from pg_temp._p9_e15_ctx),
    'user', 'incoming', 'text', 'mensagem sync metadata para coluna',
    'runner-sync-metadata-' || replace(v_run_id::text, '-', ''),
    null, '{"runner":"p9_e15"}'::jsonb
  );

  update pg_temp._p9_e15_ctx
  set message_sync_metadata_id = v_message_sync_metadata.id;

  select * into v_message_sync_column
  from public.insert_message(
    (select conversation_id from pg_temp._p9_e15_ctx),
    'user', 'incoming', 'text', 'mensagem sync coluna para metadata',
    'runner-sync-column-' || replace(v_run_id::text, '-', ''),
    null, '{"runner":"p9_e15"}'::jsonb
  );

  update pg_temp._p9_e15_ctx
  set message_sync_column_id = v_message_sync_column.id;

  select * into v_message_divergence_metadata
  from public.insert_message(
    (select conversation_id from pg_temp._p9_e15_ctx),
    'user', 'incoming', 'text', 'mensagem divergence metadata',
    'runner-divergence-metadata-' || replace(v_run_id::text, '-', ''),
    null, '{"runner":"p9_e15"}'::jsonb
  );

  update pg_temp._p9_e15_ctx
  set message_divergence_metadata_id = v_message_divergence_metadata.id;

  select * into v_message_divergence_column
  from public.insert_message(
    (select conversation_id from pg_temp._p9_e15_ctx),
    'user', 'incoming', 'text', 'mensagem divergence coluna',
    'runner-divergence-column-' || replace(v_run_id::text, '-', ''),
    null, '{"runner":"p9_e15"}'::jsonb
  );

  update pg_temp._p9_e15_ctx
  set message_divergence_column_id = v_message_divergence_column.id;

  select * into v_message_divergence_guard_metadata
  from public.insert_message(
    (select conversation_id from pg_temp._p9_e15_ctx),
    'user', 'incoming', 'text', 'mensagem divergence guard metadata',
    'runner-divergence-guard-metadata-' || replace(v_run_id::text, '-', ''),
    null, '{"runner":"p9_e15"}'::jsonb
  );

  update pg_temp._p9_e15_ctx
  set message_divergence_guard_metadata_id = v_message_divergence_guard_metadata.id;

  select * into v_message_divergence_guard_column
  from public.insert_message(
    (select conversation_id from pg_temp._p9_e15_ctx),
    'user', 'incoming', 'text', 'mensagem divergence guard coluna',
    'runner-divergence-guard-column-' || replace(v_run_id::text, '-', ''),
    null, '{"runner":"p9_e15"}'::jsonb
  );

  update public.messages
  set created_at = clock_timestamp() - interval '10 minutes'
  where id in (
    v_message_sync_metadata.id,
    v_message_sync_column.id,
    v_message_divergence_metadata.id,
    v_message_divergence_column.id,
    v_message_divergence_guard_metadata.id,
    v_message_divergence_guard_column.id
  );

  update pg_temp._p9_e15_ctx
  set message_divergence_guard_column_id = v_message_divergence_guard_column.id;

  select * into v_message_old
  from public.insert_message(
    (select conversation_id from pg_temp._p9_e15_ctx),
    'user', 'incoming', 'text', 'mensagem ancora antiga',
    'runner-anchor-old-' || replace(v_run_id::text, '-', ''),
    null, '{"runner":"p9_e15"}'::jsonb
  );

  update public.messages
  set created_at = clock_timestamp() - interval '2 minute'
  where id = v_message_old.id;

  update pg_temp._p9_e15_ctx
  set message_anchor_old_id = v_message_old.id;

  select * into v_message_anchor_success
  from public.insert_message(
    (select conversation_id from pg_temp._p9_e15_ctx),
    'user', 'incoming', 'text', 'mensagem ancora mais recente',
    'runner-anchor-latest-' || replace(v_run_id::text, '-', ''),
    null, '{"runner":"p9_e15"}'::jsonb
  );

  update public.messages
  set created_at = clock_timestamp()
  where id = v_message_anchor_success.id;

  update pg_temp._p9_e15_ctx
  set message_anchor_success_id = v_message_anchor_success.id;

  select * into v_message_tie_a
  from public.insert_message(
    v_tied_conversation_id,
    'user', 'incoming', 'text', 'mensagem empatada A',
    'runner-anchor-tied-a-' || replace(v_run_id::text, '-', ''),
    null, '{"runner":"p9_e15"}'::jsonb
  );

  select * into v_message_tie_b
  from public.insert_message(
    v_tied_conversation_id,
    'user', 'incoming', 'text', 'mensagem empatada B',
    'runner-anchor-tied-b-' || replace(v_run_id::text, '-', ''),
    null, '{"runner":"p9_e15"}'::jsonb
  );

  v_tie_created_at := clock_timestamp() - interval '90 seconds';

  update public.messages
  set created_at = v_tie_created_at
  where id in (v_message_tie_a.id, v_message_tie_b.id);

  update pg_temp._p9_e15_ctx
  set
    message_anchor_tie_a_id = v_message_tie_a.id,
    message_anchor_tie_b_id = v_message_tie_b.id;

  select * into v_message_wrong_sender
  from public.insert_message(
    (select conversation_id from pg_temp._p9_e15_ctx),
    'human', 'incoming', 'text', 'mensagem com sender invalido para ancora',
    'runner-anchor-wrong-sender-' || replace(v_run_id::text, '-', ''),
    null, '{"runner":"p9_e15"}'::jsonb
  );

  update pg_temp._p9_e15_ctx
  set message_wrong_sender_id = v_message_wrong_sender.id;

  select * into v_message_wrong_conversation
  from public.insert_message(
    v_same_scope_other_conversation_id,
    'user', 'incoming', 'text', 'mensagem de outra conversa',
    'runner-anchor-wrong-conversation-' || replace(v_run_id::text, '-', ''),
    null, '{"runner":"p9_e15"}'::jsonb
  );

  update pg_temp._p9_e15_ctx
  set message_wrong_conversation_id = v_message_wrong_conversation.id;

  select * into v_message_wrong_store
  from public.insert_message(
    v_other_store_conversation_id,
    'user', 'incoming', 'text', 'mensagem de outra loja',
    'runner-anchor-wrong-store-' || replace(v_run_id::text, '-', ''),
    null, '{"runner":"p9_e15"}'::jsonb
  );

  update pg_temp._p9_e15_ctx
  set message_wrong_store_id = v_message_wrong_store.id;

  select * into v_message_wrong_org
  from public.insert_message(
    v_other_org_conversation_id,
    'user', 'incoming', 'text', 'mensagem de outra organizacao',
    'runner-anchor-wrong-org-' || replace(v_run_id::text, '-', ''),
    null, '{"runner":"p9_e15"}'::jsonb
  );

  update pg_temp._p9_e15_ctx
  set message_wrong_org_id = v_message_wrong_org.id;
exception
  when others then
    raise exception using
      errcode = sqlstate,
      message = 'RUNNER_SETUP_FAILED: ' || sqlerrm;
end;
$setup$;

do $scenarios$
declare
  ctx pg_temp._p9_e15_ctx%rowtype;
  v_result jsonb;
  v_sig_id uuid;
  v_count bigint;
  v_pos_lock integer;
  v_pos_ensure integer;
  v_acl_has_anon boolean;
  v_acl_has_authenticated boolean;
  v_acl_has_public boolean;
  v_constraint_def text;
  v_index_predicate text;
  v_index_is_unique boolean;
  v_indexdef text;
  v_message_after_retry public.messages%rowtype;
  v_temp_contract_id uuid;
  v_temp_version_id uuid;
begin
  select * into ctx from pg_temp._p9_e15_ctx;

  begin
    perform pg_temp._assert(pg_catalog.to_regprocedure('public.sign_sales_contract_as_customer_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb)') is not null, 'rpc missing');
    perform pg_temp._assert(
      exists (
        select 1
        from pg_catalog.pg_proc proc
        join pg_catalog.pg_namespace nsp on nsp.oid = proc.pronamespace
        where nsp.nspname = 'public'
          and proc.proname = 'sign_sales_contract_as_customer_atomic'
          and proc.prosecdef
          and proc.proowner = (select oid from pg_catalog.pg_roles where rolname = 'postgres')
          and array_to_string(proc.proconfig, ',') like '%search_path=public, pg_temp%'
      ),
      'rpc contract mismatch'
    );
    perform pg_temp._assert(
      exists (
        select 1
        from pg_catalog.pg_trigger trg
        where trg.tgrelid = 'public.sales_contract_signatures'::pg_catalog.regclass
          and trg.tgname = 'trg_sync_sales_contract_signature_trigger_message_id'
          and not trg.tgisinternal
      ),
      'trigger missing on correct table'
    );
    perform pg_temp._assert(has_function_privilege('service_role', 'public.sign_sales_contract_as_customer_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb)', 'EXECUTE'), 'service_role execute missing');
    perform pg_temp._assert(has_function_privilege('postgres', 'public.sign_sales_contract_as_customer_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb)', 'EXECUTE'), 'postgres execute missing');
    perform pg_temp._assert(not has_function_privilege('anon', 'public.sign_sales_contract_as_customer_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb)', 'EXECUTE'), 'anon execute present');
    perform pg_temp._assert(not has_function_privilege('authenticated', 'public.sign_sales_contract_as_customer_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb)', 'EXECUTE'), 'authenticated execute present');
    select exists (
      select 1
      from pg_catalog.aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) acl
      where proc.oid = 'public.sign_sales_contract_as_customer_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb)'::pg_catalog.regprocedure
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) into v_acl_has_public
    from pg_catalog.pg_proc proc
    where proc.oid = 'public.sign_sales_contract_as_customer_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb)'::pg_catalog.regprocedure;
    perform pg_temp._assert(not coalesce(v_acl_has_public, false), 'public execute present');
    perform pg_temp._record_success(1, 'objetos criados', 'rpc, owner, security definer, search_path, execute e trigger foram validados');
  exception when others then
    perform pg_temp._record_failure(1, 'objetos criados', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    select pg_catalog.pg_get_constraintdef(con.oid, true)
    into v_constraint_def
    from pg_catalog.pg_constraint con
    where con.conname = 'sales_contract_signatures_trigger_message_id_fkey'
      and con.conrelid = 'public.sales_contract_signatures'::pg_catalog.regclass;

    select idx.indisunique,
           pg_catalog.pg_get_expr(idx.indpred, idx.indrelid),
           pg_catalog.pg_get_indexdef(idx.indexrelid)
    into v_index_is_unique, v_index_predicate, v_indexdef
    from pg_catalog.pg_index idx
    where idx.indexrelid = 'public.sales_contract_signatures_trigger_message_id_uidx'::pg_catalog.regclass
      and idx.indrelid = 'public.sales_contract_signatures'::pg_catalog.regclass;

    perform pg_temp._assert(
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'sales_contract_signatures'
          and column_name = 'trigger_message_id'
          and data_type = 'uuid'
      ),
      'trigger_message_id column missing or wrong type'
    );
    perform pg_temp._assert(v_constraint_def = 'FOREIGN KEY (trigger_message_id) REFERENCES messages(id) ON DELETE RESTRICT', 'fk definition mismatch');
    perform pg_temp._assert(v_index_is_unique, 'index is not unique');
    perform pg_temp._assert(v_index_predicate = '(trigger_message_id IS NOT NULL)', 'index predicate mismatch');
    perform pg_temp._assert(v_indexdef like '%ON public.sales_contract_signatures %', 'index on wrong table');
    perform pg_temp._record_success(2, 'trigger_message_id estrutural', 'coluna, fk exata e indice unico parcial foram validados');
  exception when others then
    perform pg_temp._record_failure(2, 'trigger_message_id estrutural', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    insert into public.sales_contract_signatures (
      contract_id, contract_version_id, organization_id, store_id, signer_type,
      signer_name, signer_phone, status, signed_at, acceptance_text, metadata
    )
    values (
      ctx.contract_id, ctx.version_id, ctx.organization_id, ctx.store_id, 'store',
      'Loja Runner', '5500000000000', 'signed', clock_timestamp(), 'ok',
      jsonb_build_object('trigger_message_id', ctx.message_sync_metadata_id::text)
    )
    returning id into v_sig_id;

    perform pg_temp._assert(
      not exists (
        select 1
        from public.sales_contract_signatures sig
        where coalesce(sig.metadata, '{}'::jsonb) ? 'trigger_message_id'
          and nullif(btrim(coalesce(sig.metadata ->> 'trigger_message_id', '')), '') is not null
          and sig.trigger_message_id is distinct from (btrim(sig.metadata ->> 'trigger_message_id'))::uuid
      ),
      'generic backfill postcondition failed'
    );
    perform pg_temp._record_success(3, 'backfill seguro', 'toda linha com metadata.trigger_message_id valido terminou com a mesma coluna');
    perform pg_temp._record_success(4, 'sync metadata para coluna', 'trigger BEFORE preencheu a coluna a partir da metadata textual');
  exception when others then
    perform pg_temp._record_failure(3, 'backfill seguro', 'SUT_FAIL', sqlerrm, sqlstate, null);
    perform pg_temp._record_failure(4, 'sync metadata para coluna', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    insert into public.sales_contract_signatures (
      contract_id, contract_version_id, organization_id, store_id, signer_type,
      signer_name, signer_phone, status, signed_at, acceptance_text, metadata, trigger_message_id
    )
    values (
      ctx.contract_manual_id, ctx.version_manual_id, ctx.organization_id, ctx.store_id, 'store',
      'Loja Runner', '5500000000000', 'signed', clock_timestamp(), 'ok', '{}'::jsonb, ctx.message_sync_column_id
    )
    returning id into v_sig_id;

    perform pg_temp._assert(
      exists (
        select 1
        from public.sales_contract_signatures
        where id = v_sig_id
          and metadata ->> 'trigger_message_id' = ctx.message_sync_column_id::text
      ),
      'column to metadata sync failed'
    );
    perform pg_temp._record_success(5, 'sync coluna para metadata', 'trigger BEFORE injetou metadata.trigger_message_id a partir da coluna');
  exception when others then
    perform pg_temp._record_failure(5, 'sync coluna para metadata', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    begin
      insert into public.sales_contract_signatures (
        contract_id, contract_version_id, organization_id, store_id, signer_type,
        signer_name, signer_phone, status, signed_at, acceptance_text, metadata, trigger_message_id
      )
      values (
        ctx.contract_completed_id, ctx.version_completed_id, ctx.organization_id, ctx.store_id, 'store',
        'Loja Runner', '5500000000000', 'signed', clock_timestamp(), 'ok',
        jsonb_build_object('trigger_message_id', ctx.message_divergence_metadata_id::text), ctx.message_divergence_column_id
      );
      raise exception 'divergent insert unexpectedly succeeded';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCA26', 'expected ZCA26 mismatch protection');
    end;
    perform pg_temp._record_success(6, 'divergencia coluna metadata', 'protecao de sync rejeitou divergencia entre coluna e metadata');
  exception when others then
    perform pg_temp._record_failure(6, 'divergencia coluna metadata', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    select position('private_acquire_sales_contract_conversation_xact_lock' in pg_catalog.pg_get_functiondef('public.insert_message(uuid,text,text,text,text,text,text,jsonb)'::pg_catalog.regprocedure)),
           position('ensure_commercial_conversation_session_context' in pg_catalog.pg_get_functiondef('public.insert_message(uuid,text,text,text,text,text,text,jsonb)'::pg_catalog.regprocedure))
    into v_pos_lock, v_pos_ensure;
    perform pg_temp._assert(v_pos_lock > 0 and v_pos_ensure > 0 and v_pos_lock < v_pos_ensure, 'lock helper must appear before ensure helper');
    perform pg_temp._record_success(7, 'insert_message usa lock comum', 'o texto da funcao mostra o helper comum antes de ensure_commercial_conversation_session_context');
  exception when others then
    perform pg_temp._record_failure(7, 'insert_message usa lock comum', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    v_result := public.sign_sales_contract_as_customer_atomic(
      ctx.organization_id, ctx.store_id, ctx.conversation_id, ctx.contract_manual_id, ctx.version_manual_id,
      null, 'Cliente Manual', '5511999999999', 'manual@example.test', 'aceite manual runner',
      '127.0.0.1', 'runner', '{"accepted_via":"conversation_text","runner":"p9_e15"}'::jsonb
    );
    perform pg_temp._assert(v_result ->> 'outcome' = 'signed', 'manual acceptance should return signed');
    perform pg_temp._record_success(8, 'aceite manual normal', 'RPC retornou outcome=signed sem ancora');
  exception when others then
    perform pg_temp._record_failure(8, 'aceite manual normal', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    perform pg_temp._assert(
      not exists (
        select 1
        from public.messages msg
        where msg.conversation_id = ctx.conversation_id
          and msg.id <> ctx.message_anchor_success_id
          and lower(trim(coalesce(msg.sender, ''))) = 'user'
          and lower(trim(coalesce(msg.direction, ''))) = 'incoming'
          and nullif(
            btrim(public.private_sales_contract_anchor_effective_content(msg)),
            ''
          ) is not null
          and msg.created_at > (
            select created_at
            from public.messages
            where id = ctx.message_anchor_success_id
          )
      ),
      'anchor success is not the latest eligible inbound message'
    );
    perform pg_temp._assert(
      not exists (
        select 1
        from public.messages msg
        where msg.conversation_id = ctx.conversation_id
          and msg.id <> ctx.message_anchor_success_id
          and lower(trim(coalesce(msg.sender, ''))) = 'user'
          and lower(trim(coalesce(msg.direction, ''))) = 'incoming'
          and nullif(
            btrim(public.private_sales_contract_anchor_effective_content(msg)),
            ''
          ) is not null
          and msg.created_at = (
            select created_at
            from public.messages
            where id = ctx.message_anchor_success_id
          )
      ),
      'anchor success ties with another eligible inbound message'
    );
    v_result := public.sign_sales_contract_as_customer_atomic(
      ctx.organization_id, ctx.store_id, ctx.conversation_id, ctx.contract_id, ctx.version_id,
      ctx.message_anchor_success_id, 'Cliente Anchor', '5511888888888', 'anchor@example.test',
      'aceite com ancora', null, 'runner', '{"runner":"p9_e15"}'::jsonb
    );
    perform pg_temp._assert(v_result ->> 'outcome' = 'signed', 'anchor acceptance should return signed');
    perform pg_temp._assert(exists (select 1 from public.sales_contracts where id = ctx.contract_id and status = 'customer_signed'), 'contract not customer_signed');
    perform pg_temp._assert(exists (select 1 from public.sales_contract_versions where id = ctx.version_id and status = 'customer_signed'), 'version not customer_signed');
    perform pg_temp._record_success(9, 'aceite com ancora normal', 'RPC assinou com a ancora explicita mais recente');
    perform pg_temp._record_success(10, 'contrato e versao atualizados juntos', 'sales_contracts.status e sales_contract_versions.status ficaram customer_signed');
  exception when others then
    perform pg_temp._record_failure(9, 'aceite com ancora normal', 'SUT_FAIL', sqlerrm, sqlstate, null);
    perform pg_temp._record_failure(10, 'contrato e versao atualizados juntos', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    v_result := public.sign_sales_contract_as_customer_atomic(
      ctx.organization_id, ctx.store_id, ctx.conversation_id, ctx.contract_manual_id, ctx.version_manual_id,
      null, 'Cliente Manual', '5511999999999', 'manual@example.test', 'aceite manual runner',
      '127.0.0.1', 'runner', '{"runner":"p9_e15"}'::jsonb
    );
    perform pg_temp._assert(v_result ->> 'outcome' = 'already_applied', 'manual retry should return already_applied');
    perform pg_temp._record_success(11, 'retry manual idempotente', 'segunda chamada manual retornou already_applied');
  exception when others then
    perform pg_temp._record_failure(11, 'retry manual idempotente', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    select * into v_message_after_retry
    from public.insert_message(
      ctx.conversation_id,
      'user', 'incoming', 'text', 'mensagem nova apos assinatura',
      'runner-anchor-after-retry-' || replace(ctx.run_id::text, '-', ''),
      null, '{"runner":"p9_e15"}'::jsonb
    );

    update pg_temp._p9_e15_ctx
    set message_anchor_after_retry_id = v_message_after_retry.id;

    update public.messages
    set created_at = (
      select created_at + interval '1 second'
      from public.messages
      where id = ctx.message_anchor_success_id
    )
    where id = v_message_after_retry.id;

    perform pg_temp._assert(
      (
        select created_at
        from public.messages
        where id = v_message_after_retry.id
      ) > (
        select created_at
        from public.messages
        where id = ctx.message_anchor_success_id
      ),
      'A2 must be strictly later than the success anchor'
    );

    v_result := public.sign_sales_contract_as_customer_atomic(
      ctx.organization_id, ctx.store_id, ctx.conversation_id, ctx.contract_id, ctx.version_id,
      ctx.message_anchor_success_id, 'Cliente Anchor', '5511888888888', 'anchor@example.test',
      'aceite com ancora', null, 'runner', '{"runner":"p9_e15"}'::jsonb
    );
    perform pg_temp._assert(v_result ->> 'outcome' = 'already_applied', 'same-anchor retry after new inbound should still already_apply');
    perform pg_temp._record_success(12, 'retry da mesma ancora', 'retry tecnico da mesma ancora retornou already_applied mesmo apos A2');
  exception when others then
    perform pg_temp._record_failure(12, 'retry da mesma ancora', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    begin
      perform public.sign_sales_contract_as_customer_atomic(
        ctx.organization_id, ctx.store_id, ctx.conversation_id, ctx.contract_id, ctx.version_id,
        ctx.message_anchor_old_id, 'Cliente Anchor', '5511888888888', 'anchor@example.test',
        'aceite com ancora antiga', null, 'runner', '{"runner":"p9_e15"}'::jsonb
      );
      raise exception 'different anchor unexpectedly succeeded';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCB22', 'expected specific existing signature anchor conflict');
    end;
    perform pg_temp._record_success(13, 'ancora diferente apos assinatura', 'ancora diferente da armazenada gerou conflito especifico da assinatura existente');
  exception when others then
    perform pg_temp._record_failure(13, 'ancora diferente apos assinatura', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    v_temp_contract_id := gen_random_uuid();
    v_temp_version_id := gen_random_uuid();
    insert into public.sales_contracts (
      id, organization_id, store_id, lead_id, conversation_id, current_version_id, contract_number, status, title,
      customer_name, customer_phone, currency, subtotal_cents, discount_cents, total_cents, payment_terms, contract_terms, valid_until, metadata
    )
    values (
      v_temp_contract_id, ctx.organization_id, ctx.store_id, ctx.lead_id, ctx.conversation_id, null,
      'P9-E15-ORG-' || replace(v_temp_contract_id::text, '-', ''), 'sent_to_customer', 'Wrong org anchor fixture',
      'Cliente Runner', '5599999999999', 'BRL', 1000, 0, 1000, 'avista', 'runner',
      (clock_timestamp() + interval '7 day')::date, jsonb_build_object('runner', 'p9_e15')
    );
    insert into public.sales_contract_versions (
      id, contract_id, organization_id, store_id, version_number, status, storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
    )
    values (
      v_temp_version_id, v_temp_contract_id, ctx.organization_id, ctx.store_id, 1, 'sent',
      'runner', 'runner/' || v_temp_version_id::text || '.pdf', 'wrong-org-anchor.pdf', 'application/pdf', 10, '{}'::jsonb
    );
    update public.sales_contracts set current_version_id = v_temp_version_id where id = v_temp_contract_id;
    begin
      perform public.sign_sales_contract_as_customer_atomic(
        ctx.organization_id, ctx.store_id, ctx.conversation_id, v_temp_contract_id, v_temp_version_id,
        ctx.message_wrong_org_id, null, null, null, null, null, null, '{}'::jsonb
      );
      raise exception 'wrong organization anchor unexpectedly succeeded';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCB16', 'expected ANCHOR_MESSAGE_SCOPE_MISMATCH for organization');
    end;
    perform pg_temp._record_success(14, 'mensagem de outra organizacao rejeitada', 'mensagem ancora real de outra organizacao foi rejeitada por escopo');
  exception when others then
    perform pg_temp._record_failure(14, 'mensagem de outra organizacao rejeitada', 'HARNESS_ERROR', sqlerrm, sqlstate, null);
  end;

  begin
    v_temp_contract_id := gen_random_uuid();
    v_temp_version_id := gen_random_uuid();
    insert into public.sales_contracts (
      id, organization_id, store_id, lead_id, conversation_id, current_version_id, contract_number, status, title,
      customer_name, customer_phone, currency, subtotal_cents, discount_cents, total_cents, payment_terms, contract_terms, valid_until, metadata
    )
    values (
      v_temp_contract_id, ctx.organization_id, ctx.store_id, ctx.lead_id, ctx.conversation_id, null,
      'P9-E15-STORESCOPE-' || replace(v_temp_contract_id::text, '-', ''), 'sent_to_customer', 'Wrong store anchor fixture',
      'Cliente Runner', '5599999999999', 'BRL', 1000, 0, 1000, 'avista', 'runner',
      (clock_timestamp() + interval '7 day')::date, jsonb_build_object('runner', 'p9_e15')
    );
    insert into public.sales_contract_versions (
      id, contract_id, organization_id, store_id, version_number, status, storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
    )
    values (
      v_temp_version_id, v_temp_contract_id, ctx.organization_id, ctx.store_id, 1, 'sent',
      'runner', 'runner/' || v_temp_version_id::text || '.pdf', 'wrong-store-anchor.pdf', 'application/pdf', 10, '{}'::jsonb
    );
    update public.sales_contracts set current_version_id = v_temp_version_id where id = v_temp_contract_id;
    begin
      perform public.sign_sales_contract_as_customer_atomic(
        ctx.organization_id, ctx.store_id, ctx.conversation_id, v_temp_contract_id, v_temp_version_id,
        ctx.message_wrong_store_id, null, null, null, null, null, null, '{}'::jsonb
      );
      raise exception 'wrong store anchor unexpectedly succeeded';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCB16', 'expected ANCHOR_MESSAGE_SCOPE_MISMATCH for store');
    end;
    perform pg_temp._record_success(15, 'mensagem de outra loja rejeitada', 'mensagem ancora real de outra loja foi rejeitada por escopo');
  exception when others then
    perform pg_temp._record_failure(15, 'mensagem de outra loja rejeitada', 'HARNESS_ERROR', sqlerrm, sqlstate, null);
  end;

  begin
    v_temp_contract_id := gen_random_uuid();
    v_temp_version_id := gen_random_uuid();
    insert into public.sales_contracts (
      id, organization_id, store_id, lead_id, conversation_id, current_version_id, contract_number, status, title,
      customer_name, customer_phone, currency, subtotal_cents, discount_cents, total_cents, payment_terms, contract_terms, valid_until, metadata
    )
    values (
      v_temp_contract_id, ctx.organization_id, ctx.store_id, ctx.lead_id, ctx.conversation_id, null,
      'P9-E15-CONVSCOPE-' || replace(v_temp_contract_id::text, '-', ''), 'sent_to_customer', 'Wrong conversation anchor fixture',
      'Cliente Runner', '5599999999999', 'BRL', 1000, 0, 1000, 'avista', 'runner',
      (clock_timestamp() + interval '7 day')::date, jsonb_build_object('runner', 'p9_e15')
    );
    insert into public.sales_contract_versions (
      id, contract_id, organization_id, store_id, version_number, status, storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
    )
    values (
      v_temp_version_id, v_temp_contract_id, ctx.organization_id, ctx.store_id, 1, 'sent',
      'runner', 'runner/' || v_temp_version_id::text || '.pdf', 'wrong-conversation-anchor.pdf', 'application/pdf', 10, '{}'::jsonb
    );
    update public.sales_contracts set current_version_id = v_temp_version_id where id = v_temp_contract_id;
    begin
      perform public.sign_sales_contract_as_customer_atomic(
        ctx.organization_id, ctx.store_id, ctx.conversation_id, v_temp_contract_id, v_temp_version_id,
        ctx.message_wrong_conversation_id, null, null, null, null, null, null, '{}'::jsonb
      );
      raise exception 'wrong conversation anchor unexpectedly succeeded';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCB16', 'expected ANCHOR_MESSAGE_SCOPE_MISMATCH for conversation');
    end;
    perform pg_temp._record_success(16, 'mensagem de outra conversa rejeitada', 'mensagem ancora real de outra conversa foi rejeitada por escopo');
  exception when others then
    perform pg_temp._record_failure(16, 'mensagem de outra conversa rejeitada', 'HARNESS_ERROR', sqlerrm, sqlstate, null);
  end;

  begin
    v_temp_contract_id := gen_random_uuid();
    v_temp_version_id := gen_random_uuid();
    insert into public.sales_contracts (
      id, organization_id, store_id, lead_id, conversation_id, current_version_id, contract_number, status, title,
      customer_name, customer_phone, currency, subtotal_cents, discount_cents, total_cents, payment_terms, contract_terms, valid_until, metadata
    )
    values (
      v_temp_contract_id, ctx.organization_id, ctx.store_id, ctx.lead_id, ctx.conversation_id, null,
      'P9-E15-SENDER-' || replace(v_temp_contract_id::text, '-', ''), 'sent_to_customer', 'Wrong sender anchor fixture',
      'Cliente Runner', '5599999999999', 'BRL', 1000, 0, 1000, 'avista', 'runner',
      (clock_timestamp() + interval '7 day')::date, jsonb_build_object('runner', 'p9_e15')
    );
    insert into public.sales_contract_versions (
      id, contract_id, organization_id, store_id, version_number, status, storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
    )
    values (
      v_temp_version_id, v_temp_contract_id, ctx.organization_id, ctx.store_id, 1, 'sent',
      'runner', 'runner/' || v_temp_version_id::text || '.pdf', 'wrong-sender-anchor.pdf', 'application/pdf', 10, '{}'::jsonb
    );
    update public.sales_contracts set current_version_id = v_temp_version_id where id = v_temp_contract_id;
    begin
      perform public.sign_sales_contract_as_customer_atomic(
        ctx.organization_id, ctx.store_id, ctx.conversation_id, v_temp_contract_id, v_temp_version_id,
        ctx.message_wrong_sender_id, null, null, null, null, null, null, '{}'::jsonb
      );
      raise exception 'wrong sender anchor unexpectedly succeeded';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCB17', 'expected not eligible anchor rejection');
    end;
    perform pg_temp._record_success(17, 'mensagem nao user incoming rejeitada', 'ancora explicita sem user/incoming elegivel foi rejeitada');
  exception when others then
    perform pg_temp._record_failure(17, 'mensagem nao user incoming rejeitada', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    v_temp_contract_id := gen_random_uuid();
    v_temp_version_id := gen_random_uuid();
    insert into public.sales_contracts (
      id, organization_id, store_id, lead_id, conversation_id, current_version_id, contract_number, status, title,
      customer_name, customer_phone, currency, subtotal_cents, discount_cents, total_cents, payment_terms, contract_terms, valid_until, metadata
    )
    values (
      v_temp_contract_id, ctx.organization_id, ctx.store_id, ctx.lead_id, ctx.conversation_id, null,
      'P9-E15-OLD-' || replace(v_temp_contract_id::text, '-', ''), 'sent_to_customer', 'Old anchor fixture',
      'Cliente Runner', '5599999999999', 'BRL', 1000, 0, 1000, 'avista', 'runner',
      (clock_timestamp() + interval '7 day')::date, jsonb_build_object('runner', 'p9_e15')
    );
    insert into public.sales_contract_versions (
      id, contract_id, organization_id, store_id, version_number, status, storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
    )
    values (
      v_temp_version_id, v_temp_contract_id, ctx.organization_id, ctx.store_id, 1, 'sent',
      'runner', 'runner/' || v_temp_version_id::text || '.pdf', 'old-anchor-fixture.pdf', 'application/pdf', 10, '{}'::jsonb
    );
    update public.sales_contracts set current_version_id = v_temp_version_id where id = v_temp_contract_id;
    begin
      perform public.sign_sales_contract_as_customer_atomic(
        ctx.organization_id, ctx.store_id, ctx.conversation_id, v_temp_contract_id, v_temp_version_id,
        ctx.message_anchor_old_id, null, null, null, null, null, null, '{}'::jsonb
      );
      raise exception 'old anchor unexpectedly succeeded';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCB18', 'expected not latest anchor rejection');
    end;
    perform pg_temp._record_success(18, 'ancora nao ultima rejeitada', 'ancora antiga foi rejeitada por existir inbound elegivel posterior');
  exception when others then
    perform pg_temp._record_failure(18, 'ancora nao ultima rejeitada', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    v_temp_contract_id := gen_random_uuid();
    v_temp_version_id := gen_random_uuid();
    insert into public.sales_contracts (
      id, organization_id, store_id, lead_id, conversation_id, current_version_id, contract_number, status, title,
      customer_name, customer_phone, currency, subtotal_cents, discount_cents, total_cents, payment_terms, contract_terms, valid_until, metadata
    )
    values (
      v_temp_contract_id, ctx.organization_id, ctx.store_id, ctx.tied_lead_id, ctx.tied_conversation_id, null,
      'P9-E15-TIED-' || replace(v_temp_contract_id::text, '-', ''), 'sent_to_customer', 'Tied anchor fixture',
      'Cliente Runner', '5599999999999', 'BRL', 1000, 0, 1000, 'avista', 'runner',
      (clock_timestamp() + interval '7 day')::date, jsonb_build_object('runner', 'p9_e15')
    );
    insert into public.sales_contract_versions (
      id, contract_id, organization_id, store_id, version_number, status, storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
    )
    values (
      v_temp_version_id, v_temp_contract_id, ctx.organization_id, ctx.store_id, 1, 'sent',
      'runner', 'runner/' || v_temp_version_id::text || '.pdf', 'tied-anchor-fixture.pdf', 'application/pdf', 10, '{}'::jsonb
    );
    update public.sales_contracts set current_version_id = v_temp_version_id where id = v_temp_contract_id;
    perform pg_temp._assert(
      exists (
        select 1
        from public.messages msg
        where msg.id = ctx.message_anchor_tie_a_id
          and lower(trim(coalesce(msg.sender, ''))) = 'user'
          and lower(trim(coalesce(msg.direction, ''))) = 'incoming'
          and nullif(
            btrim(public.private_sales_contract_anchor_effective_content(msg)),
            ''
          ) is not null
      ),
      'tie anchor A is missing or not eligible'
    );
    perform pg_temp._assert(
      exists (
        select 1
        from public.messages msg
        where msg.id = ctx.message_anchor_tie_b_id
          and lower(trim(coalesce(msg.sender, ''))) = 'user'
          and lower(trim(coalesce(msg.direction, ''))) = 'incoming'
          and nullif(
            btrim(public.private_sales_contract_anchor_effective_content(msg)),
            ''
          ) is not null
      ),
      'tie anchor B is missing or not eligible'
    );
    perform pg_temp._assert(
      (
        select created_at
        from public.messages
        where id = ctx.message_anchor_tie_a_id
      ) = (
        select created_at
        from public.messages
        where id = ctx.message_anchor_tie_b_id
      ),
      'tie anchors must have exactly the same created_at'
    );
    perform pg_temp._assert(
      not exists (
        select 1
        from public.messages msg
        where msg.conversation_id = ctx.tied_conversation_id
          and msg.id not in (ctx.message_anchor_tie_a_id, ctx.message_anchor_tie_b_id)
          and lower(trim(coalesce(msg.sender, ''))) = 'user'
          and lower(trim(coalesce(msg.direction, ''))) = 'incoming'
          and nullif(
            btrim(public.private_sales_contract_anchor_effective_content(msg)),
            ''
          ) is not null
          and msg.created_at > (
            select created_at
            from public.messages
            where id = ctx.message_anchor_tie_a_id
          )
      ),
      'unexpected later eligible inbound exists in tied conversation'
    );
    perform pg_temp._assert(
      (
        select count(*)
        from public.messages msg
        where msg.conversation_id = ctx.tied_conversation_id
          and lower(trim(coalesce(msg.sender, ''))) = 'user'
          and lower(trim(coalesce(msg.direction, ''))) = 'incoming'
          and nullif(
            btrim(public.private_sales_contract_anchor_effective_content(msg)),
            ''
          ) is not null
          and msg.created_at = (
            select created_at
            from public.messages
            where id = ctx.message_anchor_tie_a_id
          )
      ) = 2,
      'expected exactly two eligible inbound messages at the tied timestamp'
    );

    begin
      perform public.sign_sales_contract_as_customer_atomic(
        ctx.organization_id, ctx.store_id, ctx.tied_conversation_id, v_temp_contract_id, v_temp_version_id,
        ctx.message_anchor_tie_a_id, null, null, null, null, null, null, '{}'::jsonb
      );
      raise exception 'ambiguous anchor unexpectedly succeeded';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCB19', 'expected ambiguous anchor rejection');
    end;
    perform pg_temp._record_success(19, 'empate de created_at rejeitado', 'duas mensagens elegiveis com o mesmo created_at tornaram a ancora ambigua');
  exception when others then
    perform pg_temp._record_failure(19, 'empate de created_at rejeitado', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    begin
      perform public.sign_sales_contract_as_customer_atomic(
        ctx.organization_id, ctx.store_id, ctx.conversation_id, ctx.contract_partial_id, ctx.version_id,
        null, null, null, null, null, null, null, '{}'::jsonb
      );
      raise exception 'wrong expected version unexpectedly succeeded';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCB10', 'expected current version mismatch');
    end;
    perform pg_temp._record_success(20, 'versao esperada diferente rejeitada', 'current_version_id divergente foi rejeitado');
  exception when others then
    perform pg_temp._record_failure(20, 'versao esperada diferente rejeitada', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    update public.sales_contracts
    set current_version_id = ctx.version_partial_id
    where id = ctx.contract_id;

    begin
      perform public.sign_sales_contract_as_customer_atomic(
        ctx.organization_id, ctx.store_id, ctx.conversation_id, ctx.contract_id, ctx.version_partial_id,
        null, null, null, null, null, null, null, '{}'::jsonb
      );
      raise exception 'foreign version unexpectedly succeeded';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCB12', 'expected VERSION_CONTRACT_MISMATCH');
    end;

    update public.sales_contracts
    set current_version_id = ctx.version_id
    where id = ctx.contract_id;

    perform pg_temp._record_success(21, 'versao de outro contrato rejeitada', 'current_version_id temporariamente apontou para outra versao e a RPC atingiu VERSION_CONTRACT_MISMATCH');
  exception when others then
    perform pg_temp._record_failure(21, 'versao de outro contrato rejeitada', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    begin
      perform public.sign_sales_contract_as_customer_atomic(
        gen_random_uuid(), gen_random_uuid(), ctx.conversation_id, ctx.contract_partial_id, ctx.version_partial_id,
        null, null, null, null, null, null, null, '{}'::jsonb
      );
      raise exception 'wrong scope unexpectedly succeeded';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCB07', 'expected contract scope mismatch');
    end;
    perform pg_temp._record_success(22, 'divergencia de organizacao loja rejeitada', 'escopo informado diferente do contrato foi rejeitado');
  exception when others then
    perform pg_temp._record_failure(22, 'divergencia de organizacao loja rejeitada', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    v_result := public.sign_sales_contract_as_customer_atomic(
      ctx.organization_id, ctx.store_id, ctx.conversation_id, ctx.contract_partial_id, ctx.version_partial_id,
      null, null, null, null, null, null, null, '{}'::jsonb
    );
    perform pg_temp._assert(v_result ->> 'outcome' = 'reconciled_partial_state', 'expected reconciled_partial_state');
    perform pg_temp._record_success(23, 'estado parcial reconciliado', 'assinatura existente permitiu reconciliar contrato e versao sob lock');
  exception when others then
    perform pg_temp._record_failure(23, 'estado parcial reconciliado', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    v_result := public.sign_sales_contract_as_customer_atomic(
      ctx.organization_id, ctx.store_id, ctx.conversation_id, ctx.contract_completed_id, ctx.version_completed_id,
      null, null, null, null, null, null, null, '{}'::jsonb
    );
    perform pg_temp._assert(v_result ->> 'outcome' = 'already_applied', 'completed should already be applied');
    perform pg_temp._assert(exists (select 1 from public.sales_contracts where id = ctx.contract_completed_id and status = 'completed'), 'completed contract downgraded');
    perform pg_temp._assert(exists (select 1 from public.sales_contract_versions where id = ctx.version_completed_id and status = 'completed'), 'completed version downgraded');
    perform pg_temp._record_success(24, 'completed nao rebaixa', 'contrato e versao permaneceram completed');
  exception when others then
    perform pg_temp._record_failure(24, 'completed nao rebaixa', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    v_result := public.sign_sales_contract_as_customer_atomic(
      ctx.organization_id, ctx.store_id, ctx.conversation_id, ctx.contract_store_signed_id, ctx.version_store_signed_id,
      null, null, null, null, null, null, null, '{}'::jsonb
    );
    perform pg_temp._assert(v_result ->> 'outcome' = 'already_applied', 'store_signed should already be applied');
    perform pg_temp._assert(exists (select 1 from public.sales_contracts where id = ctx.contract_store_signed_id and status = 'store_signed'), 'store_signed contract downgraded');
    perform pg_temp._assert(exists (select 1 from public.sales_contract_versions where id = ctx.version_store_signed_id and status = 'store_signed'), 'store_signed version downgraded');
    perform pg_temp._record_success(25, 'store_signed nao rebaixa', 'contrato e versao permaneceram store_signed');
  exception when others then
    perform pg_temp._record_failure(25, 'store_signed nao rebaixa', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    select count(*)
    into v_count
    from public.sales_contract_signatures
    where contract_id = ctx.contract_manual_id
      and contract_version_id = ctx.version_manual_id
      and signer_type = 'customer';
    perform pg_temp._assert(v_count = 1, 'manual contract should have exactly one customer signature');
    perform pg_temp._record_success(26, 'assinatura customer unica por versao', 'permaneceu apenas uma assinatura customer na versao manual');
  exception when others then
    perform pg_temp._record_failure(26, 'assinatura customer unica por versao', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    begin
      insert into public.sales_contract_signatures (
        contract_id, contract_version_id, organization_id, store_id, signer_type,
        signer_name, signer_phone, status, signed_at, acceptance_text, metadata, trigger_message_id
      )
      values (
        ctx.contract_store_signed_id, ctx.version_store_signed_id, ctx.organization_id, ctx.store_id, 'store',
        'Loja Runner', '5500000000000', 'signed', clock_timestamp(), 'ok',
        jsonb_build_object('accepted_via', 'manual_direct'), ctx.message_anchor_success_id
      );
      raise exception 'duplicate trigger_message_id unexpectedly succeeded';
    exception when unique_violation then
      null;
    end;
    perform pg_temp._record_success(27, 'trigger_message_id unica', 'indice unico parcial bloqueou o reuso da mesma trigger_message_id');
  exception when others then
    perform pg_temp._record_failure(27, 'trigger_message_id unica', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    select exists (
      select 1
      from pg_catalog.pg_class cls
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          cls.relacl,
          pg_catalog.acldefault('r', cls.relowner)
        )
      ) acl
      join pg_catalog.pg_roles rol on rol.oid = acl.grantee
      where cls.oid = 'public.sales_contracts'::pg_catalog.regclass
        and rol.rolname = 'anon'
        and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
    ) into v_acl_has_anon;
    perform pg_temp._assert(not v_acl_has_anon, 'anon still has direct privileges on sales_contracts');

    select exists (
      select 1
      from pg_catalog.pg_class cls
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          cls.relacl,
          pg_catalog.acldefault('r', cls.relowner)
        )
      ) acl
      join pg_catalog.pg_roles rol on rol.oid = acl.grantee
      where cls.oid = 'public.sales_contract_versions'::pg_catalog.regclass
        and rol.rolname = 'anon'
        and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
    ) into v_acl_has_anon;
    perform pg_temp._assert(not v_acl_has_anon, 'anon still has direct privileges on sales_contract_versions');

    select exists (
      select 1
      from pg_catalog.pg_class cls
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          cls.relacl,
          pg_catalog.acldefault('r', cls.relowner)
        )
      ) acl
      join pg_catalog.pg_roles rol on rol.oid = acl.grantee
      where cls.oid = 'public.sales_contract_signatures'::pg_catalog.regclass
        and rol.rolname = 'anon'
        and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
    ) into v_acl_has_anon;
    perform pg_temp._assert(not v_acl_has_anon, 'anon still has direct privileges on sales_contract_signatures');

    select exists (
      select 1
      from pg_catalog.pg_class cls
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          cls.relacl,
          pg_catalog.acldefault('r', cls.relowner)
        )
      ) acl
      join pg_catalog.pg_roles rol on rol.oid = acl.grantee
      where cls.oid = 'public.sales_contracts'::pg_catalog.regclass
        and rol.rolname = 'authenticated'
        and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
    ) into v_acl_has_authenticated;
    perform pg_temp._assert(not v_acl_has_authenticated, 'authenticated still has direct privileges on sales_contracts');

    select exists (
      select 1
      from pg_catalog.pg_class cls
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          cls.relacl,
          pg_catalog.acldefault('r', cls.relowner)
        )
      ) acl
      join pg_catalog.pg_roles rol on rol.oid = acl.grantee
      where cls.oid = 'public.sales_contract_versions'::pg_catalog.regclass
        and rol.rolname = 'authenticated'
        and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
    ) into v_acl_has_authenticated;
    perform pg_temp._assert(not v_acl_has_authenticated, 'authenticated still has direct privileges on sales_contract_versions');

    select exists (
      select 1
      from pg_catalog.pg_class cls
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          cls.relacl,
          pg_catalog.acldefault('r', cls.relowner)
        )
      ) acl
      join pg_catalog.pg_roles rol on rol.oid = acl.grantee
      where cls.oid = 'public.sales_contract_signatures'::pg_catalog.regclass
        and rol.rolname = 'authenticated'
        and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
    ) into v_acl_has_authenticated;
    perform pg_temp._assert(not v_acl_has_authenticated, 'authenticated still has direct privileges on sales_contract_signatures');

    perform pg_temp._assert(has_function_privilege('service_role', 'public.sign_sales_contract_as_customer_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb)', 'EXECUTE'), 'service_role execute missing');
    perform pg_temp._assert(has_function_privilege('postgres', 'public.sign_sales_contract_as_customer_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb)', 'EXECUTE'), 'postgres execute missing');
    perform pg_temp._assert(not has_function_privilege('anon', 'public.sign_sales_contract_as_customer_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb)', 'EXECUTE'), 'anon execute present');
    perform pg_temp._assert(not has_function_privilege('authenticated', 'public.sign_sales_contract_as_customer_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb)', 'EXECUTE'), 'authenticated execute present');
    select exists (
      select 1
      from pg_catalog.aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) acl
      where proc.oid = 'public.sign_sales_contract_as_customer_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb)'::pg_catalog.regprocedure
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) into v_acl_has_public
    from pg_catalog.pg_proc proc
    where proc.oid = 'public.sign_sales_contract_as_customer_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb)'::pg_catalog.regprocedure;
    perform pg_temp._assert(not coalesce(v_acl_has_public, false), 'public execute present');

    perform pg_temp._record_success(28, 'grants anon authenticated revogados', 'grants diretos e ACL de execute da RPC foram validados');
  exception when others then
    perform pg_temp._record_failure(28, 'grants anon authenticated revogados', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    perform pg_temp._assert(
      pg_catalog.pg_get_functiondef('public.insert_message(uuid,text,text,text,text,text,text,jsonb)'::pg_catalog.regprocedure)
        like '%private_acquire_sales_contract_conversation_xact_lock%'
      and pg_catalog.pg_get_functiondef('public.sign_sales_contract_as_customer_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb)'::pg_catalog.regprocedure)
        like '%private_acquire_sales_contract_conversation_xact_lock%',
      'shared advisory lock helper not referenced by both functions'
    );
    perform pg_temp._record_success(29, 'RPC e insert_message chamam o mesmo helper', 'catalogo confirmou referencia do mesmo helper pelas duas funcoes');
  exception when others then
    perform pg_temp._record_failure(29, 'RPC e insert_message chamam o mesmo helper', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    perform pg_temp._assert(
      exists (
        select 1
        from public.sales_contracts
        where id in (ctx.contract_id, ctx.contract_manual_id, ctx.contract_partial_id, ctx.contract_completed_id, ctx.contract_store_signed_id)
      ),
      'fixtures were not created inside this transaction'
    );
    perform pg_temp._record_success(30, 'rollback final', 'o arquivo termina com ROLLBACK e todas as fixtures continuam transacionais');
  exception when others then
    perform pg_temp._record_failure(30, 'rollback final', 'HARNESS_ERROR', sqlerrm, sqlstate, null);
  end;

  begin
    v_temp_contract_id := gen_random_uuid();
    v_temp_version_id := gen_random_uuid();
    insert into public.sales_contracts (
      id, organization_id, store_id, lead_id, conversation_id, current_version_id, contract_number, status, title,
      customer_name, customer_phone, currency, subtotal_cents, discount_cents, total_cents, payment_terms, contract_terms, valid_until, metadata
    )
    values (
      v_temp_contract_id, ctx.organization_id, ctx.store_id, ctx.lead_id, ctx.conversation_id, null,
      'P9-E15-REJ-' || replace(v_temp_contract_id::text, '-', ''), 'sent_to_customer', 'Rejected fixture',
      'Cliente Runner', '5599999999999', 'BRL', 1000, 0, 1000, 'avista', 'runner',
      (clock_timestamp() + interval '7 day')::date, jsonb_build_object('runner', 'p9_e15')
    );
    insert into public.sales_contract_versions (
      id, contract_id, organization_id, store_id, version_number, status, storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
    )
    values (
      v_temp_version_id, v_temp_contract_id, ctx.organization_id, ctx.store_id, 1, 'sent',
      'runner', 'runner/' || v_temp_version_id::text || '.pdf', 'rejected-fixture.pdf', 'application/pdf', 10, '{}'::jsonb
    );
    update public.sales_contracts set current_version_id = v_temp_version_id where id = v_temp_contract_id;
    insert into public.sales_contract_signatures (
      contract_id, contract_version_id, organization_id, store_id, signer_type, signer_name, signer_phone, status, signed_at, metadata
    )
    values (
      v_temp_contract_id, v_temp_version_id, ctx.organization_id, ctx.store_id, 'customer', 'Cliente Runner', '5599999999999', 'rejected', clock_timestamp(), '{}'::jsonb
    );
    begin
      perform public.sign_sales_contract_as_customer_atomic(
        ctx.organization_id, ctx.store_id, ctx.conversation_id, v_temp_contract_id, v_temp_version_id,
        null, null, null, null, null, null, null, '{}'::jsonb
      );
      raise exception 'rejected signature unexpectedly advanced state';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCB29', 'expected EXISTING_SIGNATURE_NOT_SIGNED for rejected');
    end;
    perform pg_temp._assert(exists (select 1 from public.sales_contracts where id = v_temp_contract_id and status = 'sent_to_customer'), 'rejected fixture contract status changed');
    perform pg_temp._assert(exists (select 1 from public.sales_contract_versions where id = v_temp_version_id and status = 'sent'), 'rejected fixture version status changed');
    select count(*) into v_count
    from public.sales_contract_signatures
    where contract_version_id = v_temp_version_id
      and signer_type = 'customer';
    perform pg_temp._assert(v_count = 1, 'rejected fixture created an extra customer signature');
    perform pg_temp._record_success(31, 'assinatura rejected nao avanca estado', 'assinatura rejected gerou erro deterministico sem avancar estados');
  exception when others then
    perform pg_temp._record_failure(31, 'assinatura rejected nao avanca estado', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    v_temp_contract_id := gen_random_uuid();
    v_temp_version_id := gen_random_uuid();
    insert into public.sales_contracts (
      id, organization_id, store_id, lead_id, conversation_id, current_version_id, contract_number, status, title,
      customer_name, customer_phone, currency, subtotal_cents, discount_cents, total_cents, payment_terms, contract_terms, valid_until, metadata
    )
    values (
      v_temp_contract_id, ctx.organization_id, ctx.store_id, ctx.lead_id, ctx.conversation_id, null,
      'P9-E15-CAN-' || replace(v_temp_contract_id::text, '-', ''), 'sent_to_customer', 'Cancelled fixture',
      'Cliente Runner', '5599999999999', 'BRL', 1000, 0, 1000, 'avista', 'runner',
      (clock_timestamp() + interval '7 day')::date, jsonb_build_object('runner', 'p9_e15')
    );
    insert into public.sales_contract_versions (
      id, contract_id, organization_id, store_id, version_number, status, storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
    )
    values (
      v_temp_version_id, v_temp_contract_id, ctx.organization_id, ctx.store_id, 1, 'sent',
      'runner', 'runner/' || v_temp_version_id::text || '.pdf', 'cancelled-fixture.pdf', 'application/pdf', 10, '{}'::jsonb
    );
    update public.sales_contracts set current_version_id = v_temp_version_id where id = v_temp_contract_id;
    insert into public.sales_contract_signatures (
      contract_id, contract_version_id, organization_id, store_id, signer_type, signer_name, signer_phone, status, signed_at, metadata
    )
    values (
      v_temp_contract_id, v_temp_version_id, ctx.organization_id, ctx.store_id, 'customer', 'Cliente Runner', '5599999999999', 'cancelled', clock_timestamp(), '{}'::jsonb
    );
    begin
      perform public.sign_sales_contract_as_customer_atomic(
        ctx.organization_id, ctx.store_id, ctx.conversation_id, v_temp_contract_id, v_temp_version_id,
        null, null, null, null, null, null, null, '{}'::jsonb
      );
      raise exception 'cancelled signature unexpectedly advanced state';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCB29', 'expected EXISTING_SIGNATURE_NOT_SIGNED for cancelled');
    end;
    perform pg_temp._assert(exists (select 1 from public.sales_contracts where id = v_temp_contract_id and status = 'sent_to_customer'), 'cancelled fixture contract status changed');
    perform pg_temp._assert(exists (select 1 from public.sales_contract_versions where id = v_temp_version_id and status = 'sent'), 'cancelled fixture version status changed');
    select count(*) into v_count
    from public.sales_contract_signatures
    where contract_version_id = v_temp_version_id
      and signer_type = 'customer';
    perform pg_temp._assert(v_count = 1, 'cancelled fixture created an extra customer signature');
    perform pg_temp._record_success(32, 'assinatura cancelled nao avanca estado', 'assinatura cancelled gerou erro deterministico sem avancar estados');
  exception when others then
    perform pg_temp._record_failure(32, 'assinatura cancelled nao avanca estado', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    begin
      perform public.sign_sales_contract_as_customer_atomic(
        ctx.organization_id, ctx.store_id, ctx.conversation_id, ctx.contract_manual_id, ctx.version_manual_id,
        ctx.message_anchor_old_id, null, null, null, null, null, null, '{}'::jsonb
      );
      raise exception 'anchored replay against manual signature unexpectedly succeeded';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCB30', 'expected EXISTING_SIGNATURE_MISSING_ANCHOR');
    end;
    perform pg_temp._record_success(33, 'assinatura manual nao aceita replay ancorado', 'assinatura manual sem trigger_message_id rejeitou chamada ancorada');
  exception when others then
    perform pg_temp._record_failure(33, 'assinatura manual nao aceita replay ancorado', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    v_temp_contract_id := gen_random_uuid();
    v_temp_version_id := gen_random_uuid();
    insert into public.sales_contracts (
      id, organization_id, store_id, lead_id, conversation_id, current_version_id, contract_number, status, title,
      customer_name, customer_phone, currency, subtotal_cents, discount_cents, total_cents, payment_terms, contract_terms, valid_until, metadata
    )
    values (
      v_temp_contract_id, ctx.organization_id, ctx.store_id, ctx.lead_id, ctx.conversation_id, null,
      'P9-E15-FORGE-' || replace(v_temp_contract_id::text, '-', ''), 'sent_to_customer', 'Forge fixture',
      'Cliente Runner', '5599999999999', 'BRL', 1000, 0, 1000, 'avista', 'runner',
      (clock_timestamp() + interval '7 day')::date, jsonb_build_object('runner', 'p9_e15')
    );
    insert into public.sales_contract_versions (
      id, contract_id, organization_id, store_id, version_number, status, storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
    )
    values (
      v_temp_version_id, v_temp_contract_id, ctx.organization_id, ctx.store_id, 1, 'sent',
      'runner', 'runner/' || v_temp_version_id::text || '.pdf', 'forge-fixture.pdf', 'application/pdf', 10, '{}'::jsonb
    );
    update public.sales_contracts set current_version_id = v_temp_version_id where id = v_temp_contract_id;
    v_result := public.sign_sales_contract_as_customer_atomic(
      ctx.organization_id, ctx.store_id, ctx.conversation_id, v_temp_contract_id, v_temp_version_id,
      null, null, null, null, null, null, null,
      jsonb_build_object('accepted_via', 'conversation_text', 'trigger_message_id', ctx.message_anchor_old_id::text, 'runner', 'p9_e15')
    );
    perform pg_temp._assert(v_result ->> 'outcome' = 'signed', 'forge fixture should sign normally');
    perform pg_temp._assert(
      exists (
        select 1
        from public.sales_contract_signatures sig
        where sig.id = (v_result ->> 'signature_id')::uuid
          and sig.metadata ->> 'accepted_via' = 'manual_direct'
          and not (sig.metadata ? 'trigger_message_id')
      ),
      'manual accepted_via was not system-controlled'
    );
    perform pg_temp._record_success(34, 'accepted_via manual e sempre sistemico', 'aceite manual gravou accepted_via=manual_direct e ignorou forja do chamador');
  exception when others then
    perform pg_temp._record_failure(34, 'accepted_via manual e sempre sistemico', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    begin
      insert into public.sales_contract_signatures (
        contract_id, contract_version_id, organization_id, store_id, signer_type,
        signer_name, signer_phone, status, signed_at, acceptance_text, metadata, trigger_message_id
      )
      values (
        ctx.contract_store_signed_id, ctx.version_store_signed_id, ctx.organization_id, ctx.store_id, 'store',
        'Loja Runner', '5500000000000', 'signed', clock_timestamp(), 'ok',
        jsonb_build_object('trigger_message_id', ctx.message_divergence_guard_metadata_id::text), ctx.message_divergence_guard_column_id
      );
      raise exception 'divergent row unexpectedly inserted';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCA26', 'expected divergence protection code ZCA26');
    end;
    perform pg_temp._record_success(35, 'divergencia coluna metadata protegida', 'a protecao correspondente rejeitou divergencia preexistente/introduzida entre coluna e metadata');
  exception when others then
    perform pg_temp._record_failure(35, 'divergencia coluna metadata protegida', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;

  begin
    v_temp_contract_id := gen_random_uuid();
    v_temp_version_id := gen_random_uuid();
    insert into public.sales_contracts (
      id, organization_id, store_id, lead_id, conversation_id, current_version_id, contract_number, status, title,
      customer_name, customer_phone, currency, subtotal_cents, discount_cents, total_cents, payment_terms, contract_terms, valid_until, metadata
    )
    values (
      v_temp_contract_id, ctx.organization_id, ctx.store_id, ctx.lead_id, ctx.conversation_id, null,
      'P9-E15-PEND-' || replace(v_temp_contract_id::text, '-', ''), 'sent_to_customer', 'Pending fixture',
      'Cliente Runner', '5599999999999', 'BRL', 1000, 0, 1000, 'avista', 'runner',
      (clock_timestamp() + interval '7 day')::date, jsonb_build_object('runner', 'p9_e15')
    );
    insert into public.sales_contract_versions (
      id, contract_id, organization_id, store_id, version_number, status, storage_bucket, storage_path, original_filename, mime_type, size_bytes, contract_snapshot
    )
    values (
      v_temp_version_id, v_temp_contract_id, ctx.organization_id, ctx.store_id, 1, 'sent',
      'runner', 'runner/' || v_temp_version_id::text || '.pdf', 'pending-fixture.pdf', 'application/pdf', 10, '{}'::jsonb
    );
    update public.sales_contracts set current_version_id = v_temp_version_id where id = v_temp_contract_id;
    insert into public.sales_contract_signatures (
      contract_id, contract_version_id, organization_id, store_id, signer_type, signer_name, signer_phone, status, signed_at, metadata
    )
    values (
      v_temp_contract_id, v_temp_version_id, ctx.organization_id, ctx.store_id, 'customer', 'Cliente Runner', '5599999999999', 'pending', clock_timestamp(), '{}'::jsonb
    );
    begin
      perform public.sign_sales_contract_as_customer_atomic(
        ctx.organization_id, ctx.store_id, ctx.conversation_id, v_temp_contract_id, v_temp_version_id,
        null, null, null, null, null, null, null, '{}'::jsonb
      );
      raise exception 'pending signature unexpectedly advanced state';
    exception when others then
      perform pg_temp._assert(sqlstate = 'ZCB29', 'expected EXISTING_SIGNATURE_NOT_SIGNED for pending');
    end;
    perform pg_temp._assert(exists (select 1 from public.sales_contracts where id = v_temp_contract_id and status = 'sent_to_customer'), 'pending fixture contract status changed');
    perform pg_temp._assert(exists (select 1 from public.sales_contract_versions where id = v_temp_version_id and status = 'sent'), 'pending fixture version status changed');
    select count(*) into v_count
    from public.sales_contract_signatures
    where contract_version_id = v_temp_version_id
      and signer_type = 'customer';
    perform pg_temp._assert(v_count = 1, 'pending fixture created an extra customer signature');
    perform pg_temp._record_success(36, 'assinatura pending nao avanca estado', 'assinatura pending gerou erro deterministico sem avancar estados');
  exception when others then
    perform pg_temp._record_failure(36, 'assinatura pending nao avanca estado', 'SUT_FAIL', sqlerrm, sqlstate, null);
  end;
end;
$scenarios$;

select
  matrix.scenario_number,
  matrix.scenario_name,
  matrix.coverage_rule,
  matrix.expected_outcome,
  coalesce(results.status, 'HARNESS_ERROR') as status,
  coalesce(results.detail, 'cenario nao executado') as detail,
  results.returned_sqlstate,
  results.constraint_name
from pg_temp._p9_e15_matrix matrix
left join pg_temp._p9_e15_results results
  on results.scenario_number = matrix.scenario_number
order by matrix.scenario_number;

rollback;

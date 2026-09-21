begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table _identity_results (
  scenario integer primary key,
  name text not null,
  status text not null,
  detail text null
) on commit drop;

create or replace function pg_temp._record_identity_result(
  p_scenario integer,
  p_name text,
  p_status text,
  p_detail text default null
) returns void
language plpgsql
as $$
begin
  insert into _identity_results(scenario, name, status, detail)
  values (p_scenario, p_name, p_status, p_detail)
  on conflict (scenario) do update
  set name = excluded.name,
      status = excluded.status,
      detail = excluded.detail;
end;
$$;

create or replace function pg_temp._uuid(p_seed text)
returns uuid
language sql
immutable
as $$
  select (
    substr(md5(p_seed), 1, 8) || '-' ||
    substr(md5(p_seed), 9, 4) || '-' ||
    '4' || substr(md5(p_seed), 14, 3) || '-' ||
    '8' || substr(md5(p_seed), 18, 3) || '-' ||
    substr(md5(p_seed), 21, 12)
  )::uuid;
$$;

create or replace function pg_temp._make_identity_fixture(
  p_seed text,
  p_lead_name text,
  p_customer_name text,
  p_sender text default 'user',
  p_direction text default 'incoming'
) returns table (
  org_id uuid,
  store_id uuid,
  lead_id uuid,
  customer_id uuid,
  conversation_id uuid,
  message_id uuid
)
language plpgsql
as $$
declare
  v_org uuid := pg_temp._uuid(p_seed || ':org');
  v_store uuid := pg_temp._uuid(p_seed || ':store');
  v_lead uuid := pg_temp._uuid(p_seed || ':lead');
  v_customer uuid := pg_temp._uuid(p_seed || ':customer');
  v_conversation uuid := pg_temp._uuid(p_seed || ':conversation');
  v_message uuid := pg_temp._uuid(p_seed || ':message');
begin
  insert into public.organizations(id, name, subscription_status)
  values (v_org, 'P9 Identity Name Org ' || p_seed, 'active');

  insert into public.stores(id, organization_id, name)
  values (v_store, v_org, 'P9 Identity Name Store ' || p_seed);

  insert into public.leads(id, organization_id, store_id, name, phone, state)
  values (v_lead, v_org, v_store, p_lead_name, '5511999' || right(md5(p_seed), 6), 'novo_lead');

  insert into public.customers(id, organization_id, display_name, normalized_name)
  values (
    v_customer,
    v_org,
    p_customer_name,
    public.normalize_customer_identity_name_for_system(p_customer_name)
  );

  insert into public.customer_store_links(id, organization_id, store_id, customer_id)
  values (pg_temp._uuid(p_seed || ':store-link'), v_org, v_store, v_customer);

  insert into public.lead_customer_links(
    id,
    organization_id,
    store_id,
    lead_id,
    customer_id,
    status,
    source,
    linked_by_actor_type
  )
  values (
    pg_temp._uuid(p_seed || ':lead-link'),
    v_org,
    v_store,
    v_lead,
    v_customer,
    'active',
    'system',
    'system'
  );

  insert into public.conversations(id, organization_id, lead_id, status, is_human_active)
  values (v_conversation, v_org, v_lead, 'active', false);

  select inserted.id
  into v_message
  from public.insert_message(
    v_conversation,
    p_sender,
    p_direction,
    'text',
    'Meu nome é João',
    'p9-identity-name-check:' || p_seed,
    null,
    '{}'::jsonb
  ) inserted;

  return query select v_org, v_store, v_lead, v_customer, v_conversation, v_message;
end;
$$;

-- SQL Editor executa este harness como postgres.
-- Nao simular request.jwt.claim.role=service_role aqui: os writers endurecidos
-- de contexto comercial rejeitam divergencia entre ROLE real e JWT claim.
-- O wrapper de identidade aceita session_user=postgres para este manual check.

-- 1. null/null -> updated
do $$
declare c record; r record;
begin
  select * into c from pg_temp._make_identity_fixture('s1', null, null);
  select * into r from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,c.conversation_id,c.message_id,'identity:s1','João','runner');
  perform pg_temp._record_identity_result(1, 'null/null -> updated', case when r.outcome = 'updated' and r.changed then 'PASS' else 'SUT_FAIL' end, row_to_json(r)::text);
exception when others then
  perform pg_temp._record_identity_result(1, 'null/null -> updated', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end $$;

-- 2. Cliente WhatsApp/null -> updated
do $$
declare c record; r record;
begin
  select * into c from pg_temp._make_identity_fixture('s2', 'Cliente WhatsApp', null);
  select * into r from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,c.conversation_id,c.message_id,'identity:s2','Maria','runner');
  perform pg_temp._record_identity_result(2, 'placeholder/null -> updated', case when r.outcome = 'updated' then 'PASS' else 'SUT_FAIL' end, row_to_json(r)::text);
exception when others then
  perform pg_temp._record_identity_result(2, 'placeholder/null -> updated', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end $$;

-- 3. valor igual -> no-op/reaffirmed
do $$
declare c record; r record;
begin
  select * into c from pg_temp._make_identity_fixture('s3', 'João', 'João');
  select * into r from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,c.conversation_id,c.message_id,'identity:s3','João','runner');
  perform pg_temp._record_identity_result(3, 'same value -> existing match', case when r.outcome = 'completed_existing_match' and not r.changed then 'PASS' else 'SUT_FAIL' end, row_to_json(r)::text);
exception when others then
  perform pg_temp._record_identity_result(3, 'same value -> existing match', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end $$;

-- 4. um lado igual + outro vazio -> sincroniza
do $$
declare c record; r record; lead_name text; customer_name text;
begin
  select * into c from pg_temp._make_identity_fixture('s4', 'João', null);
  select * into r from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,c.conversation_id,c.message_id,'identity:s4','João','runner');
  select l.name, cu.display_name into lead_name, customer_name from public.leads l join public.customers cu on cu.id = c.customer_id where l.id = c.lead_id;
  perform pg_temp._record_identity_result(4, 'one side equal + other empty -> sync', case when r.outcome = 'updated' and lead_name = 'João' and customer_name = 'João' then 'PASS' else 'SUT_FAIL' end, row_to_json(r)::text);
exception when others then
  perform pg_temp._record_identity_result(4, 'one side equal + other empty -> sync', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end $$;

-- 5. nome diferente existente -> conflict, zero overwrite
do $$
declare c record; r record; lead_name text; customer_name text;
begin
  select * into c from pg_temp._make_identity_fixture('s5', 'Carlos', 'Carlos');
  select * into r from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,c.conversation_id,c.message_id,'identity:s5','João','runner');
  select l.name, cu.display_name into lead_name, customer_name from public.leads l join public.customers cu on cu.id = c.customer_id where l.id = c.lead_id;
  perform pg_temp._record_identity_result(5, 'existing different name -> conflict no overwrite', case when r.outcome = 'conflict_existing_name' and lead_name = 'Carlos' and customer_name = 'Carlos' then 'PASS' else 'SUT_FAIL' end, row_to_json(r)::text);
exception when others then
  perform pg_temp._record_identity_result(5, 'existing different name -> conflict no overwrite', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end $$;

-- 6. lead/customer divergentes -> fail closed outcome
do $$
declare c record; r record;
begin
  select * into c from pg_temp._make_identity_fixture('s6', 'Carlos', 'Maria');
  select * into r from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,c.conversation_id,c.message_id,'identity:s6','João','runner');
  perform pg_temp._record_identity_result(6, 'lead/customer divergent -> identity_scope_conflict', case when r.outcome = 'identity_scope_conflict' and not r.changed then 'PASS' else 'SUT_FAIL' end, row_to_json(r)::text);
exception when others then
  perform pg_temp._record_identity_result(6, 'lead/customer divergent -> identity_scope_conflict', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end $$;

-- 7. mensagem de outra conversation -> rejeitada
do $$
declare c record; other_conv uuid := pg_temp._uuid('s7:other-conv');
begin
  select * into c from pg_temp._make_identity_fixture('s7', null, null);
  insert into public.conversations(id, organization_id, lead_id, status) values(other_conv, c.org_id, c.lead_id, 'active');
  perform * from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,other_conv,c.message_id,'identity:s7','João','runner');
  perform pg_temp._record_identity_result(7, 'message other conversation rejected', 'SUT_FAIL', 'unexpected success');
exception when others then
  perform pg_temp._record_identity_result(7, 'message other conversation rejected', case when sqlerrm like '%MESSAGE_SCOPE%' then 'PASS' else 'HARNESS_ERROR' end, sqlstate || ' ' || sqlerrm);
end $$;

-- 8. mensagem de outro store -> rejeitada
do $$
declare
  c record;
  other_store uuid := pg_temp._uuid('s8:other-store');
  other_lead uuid := pg_temp._uuid('s8:other-lead');
  other_customer uuid := pg_temp._uuid('s8:other-customer');
  other_conversation uuid := pg_temp._uuid('s8:other-conversation');
  other_message public.messages;
begin
  select * into c from pg_temp._make_identity_fixture('s8', null, null);

  insert into public.stores(id, organization_id, name)
  values (other_store, c.org_id, 'P9 Identity Name Other Store s8');

  insert into public.leads(id, organization_id, store_id, name, phone, state)
  values (
    other_lead,
    c.org_id,
    other_store,
    null,
    '5511888' || right(md5('s8:other-lead'), 6),
    'novo_lead'
  );

  insert into public.customers(id, organization_id, display_name, normalized_name)
  values (other_customer, c.org_id, null, null);

  insert into public.customer_store_links(id, organization_id, store_id, customer_id)
  values (
    pg_temp._uuid('s8:other-store-link'),
    c.org_id,
    other_store,
    other_customer
  );

  insert into public.lead_customer_links(
    id,
    organization_id,
    store_id,
    lead_id,
    customer_id,
    status,
    source,
    linked_by_actor_type
  )
  values (
    pg_temp._uuid('s8:other-lead-link'),
    c.org_id,
    other_store,
    other_lead,
    other_customer,
    'active',
    'system',
    'system'
  );

  insert into public.conversations(
    id,
    organization_id,
    lead_id,
    status,
    is_human_active
  )
  values (
    other_conversation,
    c.org_id,
    other_lead,
    'active',
    false
  );

  select *
  into other_message
  from public.insert_message(
    other_conversation,
    'user',
    'incoming',
    'text',
    'Meu nome é João',
    'p9-identity-name-check:s8-other-store',
    null,
    '{}'::jsonb
  );

  perform *
  from public.write_customer_identity_name_by_system(
    c.org_id,
    c.store_id,
    c.lead_id,
    c.conversation_id,
    other_message.id,
    'identity:s8',
    'João',
    'runner'
  );

  perform pg_temp._record_identity_result(
    8,
    'message other store rejected',
    'SUT_FAIL',
    'unexpected success'
  );
exception when others then
  perform pg_temp._record_identity_result(
    8,
    'message other store rejected',
    case when sqlerrm like '%MESSAGE_SCOPE%' then 'PASS' else 'HARNESS_ERROR' end,
    sqlstate || ' ' || sqlerrm
  );
end $$;

-- 9. mensagem outbound/IA -> rejeitada
do $$
declare c record;
begin
  select * into c from pg_temp._make_identity_fixture('s9', null, null, 'ai', 'outgoing');
  perform * from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,c.conversation_id,c.message_id,'identity:s9','João','runner');
  perform pg_temp._record_identity_result(9, 'outbound ai message rejected', 'SUT_FAIL', 'unexpected success');
exception when others then
  perform pg_temp._record_identity_result(9, 'outbound ai message rejected', case when sqlerrm like '%SOURCE_NOT_INCOMING%' then 'PASS' else 'HARNESS_ERROR' end, sqlstate || ' ' || sqlerrm);
end $$;

-- 10. lead/customer scope errado -> rejeitado
do $$
declare c record; wrong_lead uuid := pg_temp._uuid('s10:wrong-lead');
begin
  select * into c from pg_temp._make_identity_fixture('s10', null, null);
  insert into public.leads(id, organization_id, store_id, name) values(wrong_lead, c.org_id, c.store_id, null);
  perform * from public.write_customer_identity_name_by_system(c.org_id,c.store_id,wrong_lead,c.conversation_id,c.message_id,'identity:s10','João','runner');
  perform pg_temp._record_identity_result(10, 'wrong lead scope rejected', 'SUT_FAIL', 'unexpected success');
exception when others then
  perform pg_temp._record_identity_result(10, 'wrong lead scope rejected', case when sqlerrm like '%CONVERSATION_SCOPE%' then 'PASS' else 'HARNESS_ERROR' end, sqlstate || ' ' || sqlerrm);
end $$;

-- 11. customer/link ambíguo -> impedido por constraint
do $$
begin
  perform pg_temp._record_identity_result(
    11,
    'ambiguous active customer link rejected by schema',
    case when to_regclass('public.lead_customer_links_one_active_per_lead_uidx') is not null then 'PASS' else 'SUT_FAIL' end,
    'one active lead_customer_link per lead is enforced before writer resolution'
  );
end $$;

-- 12. replay mesma operation key/payload -> idempotente
do $$
declare c record; r1 record; r2 record;
begin
  select * into c from pg_temp._make_identity_fixture('s12', null, null);
  select * into r1 from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,c.conversation_id,c.message_id,'identity:s12','João','runner');
  select * into r2 from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,c.conversation_id,c.message_id,'identity:s12','João','runner');
  perform pg_temp._record_identity_result(12, 'same operation replay idempotent', case when r1.outcome = 'updated' and r2.outcome = 'idempotent_replay' then 'PASS' else 'SUT_FAIL' end, row_to_json(r2)::text);
exception when others then
  perform pg_temp._record_identity_result(12, 'same operation replay idempotent', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end $$;

-- 13. mesma operation key com payload diferente -> rejeitado
do $$
declare c record;
begin
  select * into c from pg_temp._make_identity_fixture('s13', null, null);
  perform * from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,c.conversation_id,c.message_id,'identity:s13','João','runner');
  perform * from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,c.conversation_id,c.message_id,'identity:s13','Maria','runner');
  perform pg_temp._record_identity_result(13, 'operation key different payload rejected', 'SUT_FAIL', 'unexpected success');
exception when others then
  perform pg_temp._record_identity_result(13, 'operation key different payload rejected', case when sqlerrm like '%OPERATION_KEY_REUSED%' then 'PASS' else 'HARNESS_ERROR' end, sqlstate || ' ' || sqlerrm);
end $$;

-- 14. concorrência/lock: static contract
do $$
begin
  perform pg_temp._record_identity_result(
    14,
    'writer contains per-lead advisory transaction lock',
    case when pg_get_functiondef('public.apply_customer_identity_name_internal(uuid,uuid,uuid,uuid,uuid,text,text,text)'::regprocedure) like '%pg_advisory_xact_lock%' then 'PASS' else 'SUT_FAIL' end,
    null
  );
end $$;

-- 15. customer + lead atomically updated in one RPC
do $$
declare c record; r record; lead_name text; customer_name text;
begin
  select * into c from pg_temp._make_identity_fixture('s15', null, null);
  select * into r from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,c.conversation_id,c.message_id,'identity:s15','Ana','runner');
  select l.name, cu.display_name into lead_name, customer_name from public.leads l join public.customers cu on cu.id = c.customer_id where l.id = c.lead_id;
  perform pg_temp._record_identity_result(15, 'lead and customer updated atomically', case when lead_name = 'Ana' and customer_name = 'Ana' and r.outcome = 'updated' then 'PASS' else 'SUT_FAIL' end, row_to_json(r)::text);
exception when others then
  perform pg_temp._record_identity_result(15, 'lead and customer updated atomically', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end $$;

-- 16. append-only event table and writer function privileges
do $$
declare
  public_event_dml boolean;
  api_event_dml boolean;
  wrapper_ok boolean;
  wrapper_api_execute boolean;
  internal_api_execute boolean;
begin
  select exists (
    select 1
    from pg_catalog.pg_class table_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(table_row.relacl, pg_catalog.acldefault('r', table_row.relowner))
    ) acl
    where table_row.oid = 'public.customer_identity_name_events'::regclass
      and acl.grantee = 0
      and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  )
  into public_event_dml;

  api_event_dml :=
    pg_catalog.has_table_privilege('anon', 'public.customer_identity_name_events', 'SELECT')
    or pg_catalog.has_table_privilege('anon', 'public.customer_identity_name_events', 'INSERT')
    or pg_catalog.has_table_privilege('anon', 'public.customer_identity_name_events', 'UPDATE')
    or pg_catalog.has_table_privilege('anon', 'public.customer_identity_name_events', 'DELETE')
    or pg_catalog.has_table_privilege('authenticated', 'public.customer_identity_name_events', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'public.customer_identity_name_events', 'INSERT')
    or pg_catalog.has_table_privilege('authenticated', 'public.customer_identity_name_events', 'UPDATE')
    or pg_catalog.has_table_privilege('authenticated', 'public.customer_identity_name_events', 'DELETE')
    or pg_catalog.has_table_privilege('service_role', 'public.customer_identity_name_events', 'SELECT')
    or pg_catalog.has_table_privilege('service_role', 'public.customer_identity_name_events', 'INSERT')
    or pg_catalog.has_table_privilege('service_role', 'public.customer_identity_name_events', 'UPDATE')
    or pg_catalog.has_table_privilege('service_role', 'public.customer_identity_name_events', 'DELETE');

  wrapper_ok := pg_catalog.has_function_privilege(
    'service_role',
    'public.write_customer_identity_name_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  );

  wrapper_api_execute :=
    pg_catalog.has_function_privilege(
      'anon',
      'public.write_customer_identity_name_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.write_customer_identity_name_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)',
      'EXECUTE'
    );

  internal_api_execute :=
    pg_catalog.has_function_privilege(
      'anon',
      'public.apply_customer_identity_name_internal(uuid,uuid,uuid,uuid,uuid,text,text,text)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.apply_customer_identity_name_internal(uuid,uuid,uuid,uuid,uuid,text,text,text)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      'public.apply_customer_identity_name_internal(uuid,uuid,uuid,uuid,uuid,text,text,text)',
      'EXECUTE'
    );

  perform pg_temp._record_identity_result(
    16,
    'event table and RPC privileges are restricted',
    case when not public_event_dml and not api_event_dml and wrapper_ok and not wrapper_api_execute and not internal_api_execute then 'PASS' else 'SUT_FAIL' end,
    jsonb_build_object(
      'public_event_dml', public_event_dml,
      'api_event_dml', api_event_dml,
      'service_role_wrapper_execute', wrapper_ok,
      'wrapper_api_execute', wrapper_api_execute,
      'internal_api_execute', internal_api_execute
    )::text
  );
exception when others then
  perform pg_temp._record_identity_result(16, 'event table and RPC privileges are restricted', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end $$;

-- 17. nome positivo com acento, apostrofo e hifen
do $$
declare c record; c2 record; r record; r2 record; lead_name text; customer_name text; decomposed_lead_name text; decomposed_customer_name text;
begin
  select * into c from pg_temp._make_identity_fixture('s17', null, null);
  select * into r from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,c.conversation_id,c.message_id,'identity:s17','José D''Ávila-Santos','runner');
  select l.name, cu.display_name into lead_name, customer_name from public.leads l join public.customers cu on cu.id = c.customer_id where l.id = c.lead_id;

  select * into c2 from pg_temp._make_identity_fixture('s17-decomposed', null, null);
  select * into r2 from public.write_customer_identity_name_by_system(c2.org_id,c2.store_id,c2.lead_id,c2.conversation_id,c2.message_id,'identity:s17:decomposed',U&'Joa\0303o','runner');
  select l.name, cu.display_name into decomposed_lead_name, decomposed_customer_name from public.leads l join public.customers cu on cu.id = c2.customer_id where l.id = c2.lead_id;

  perform pg_temp._record_identity_result(
    17,
    'unicode name with apostrophe, hyphen and decomposed input accepted',
    case
      when r.outcome = 'updated'
        and lead_name = 'José D''Ávila-Santos'
        and customer_name = 'José D''Ávila-Santos'
        and r2.outcome = 'updated'
        and decomposed_lead_name = 'João'
        and decomposed_customer_name = 'João'
      then 'PASS'
      else 'SUT_FAIL'
    end,
    jsonb_build_object('precomposed', row_to_json(r), 'decomposed', row_to_json(r2))::text
  );
exception when others then
  perform pg_temp._record_identity_result(17, 'unicode name with apostrophe, hyphen and decomposed input accepted', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end $$;

-- 18. nomes estruturalmente invalidos rejeitados por chamada direta da RPC
do $$
declare
  c record;
  invalid_name text;
  unexpected_success integer := 0;
  unexpected_error integer := 0;
begin
  select * into c from pg_temp._make_identity_fixture('s18', null, null);

  foreach invalid_name in array array[
    'João!',
    'João?',
    'João,',
    'João.',
    'João123',
    'João🙂',
    '<João>',
    'joao@email.com'
  ]
  loop
    begin
      perform * from public.write_customer_identity_name_by_system(
        c.org_id,
        c.store_id,
        c.lead_id,
        c.conversation_id,
        c.message_id,
        'identity:s18:' || invalid_name,
        invalid_name,
        'runner'
      );
      unexpected_success := unexpected_success + 1;
    exception when others then
      if sqlerrm not like '%ZION_IDENTITY_NAME_VALUE_INVALID%' then
        unexpected_error := unexpected_error + 1;
      end if;
    end;
  end loop;

  perform pg_temp._record_identity_result(
    18,
    'invalid structural names rejected',
    case when unexpected_success = 0 and unexpected_error = 0 then 'PASS' else 'SUT_FAIL' end,
    jsonb_build_object('unexpected_success', unexpected_success, 'unexpected_error', unexpected_error)::text
  );
exception when others then
  perform pg_temp._record_identity_result(18, 'invalid structural names rejected', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end $$;

-- 19. display igual + normalized_name stale -> repara somente normalized_name
do $$
declare
  c record;
  r record;
  stale_case record;
  lead_name text;
  customer_name text;
  customer_normalized_name text;
  failed_cases jsonb := '[]'::jsonb;
begin
  for stale_case in
    select *
    from (
      values
        ('null', null::text),
        ('uppercase', 'JOÃO'::text),
        ('whitespace', '  joão  '::text)
    ) cases(label, stale_value)
  loop
    select * into c from pg_temp._make_identity_fixture('s19-' || stale_case.label, 'João', 'João');
    update public.customers
    set normalized_name = stale_case.stale_value
    where id = c.customer_id
      and organization_id = c.org_id;

    select * into r from public.write_customer_identity_name_by_system(c.org_id,c.store_id,c.lead_id,c.conversation_id,c.message_id,'identity:s19:' || stale_case.label,'João','runner');
    select l.name, cu.display_name, cu.normalized_name
    into lead_name, customer_name, customer_normalized_name
    from public.leads l
    join public.customers cu on cu.id = c.customer_id
    where l.id = c.lead_id;

    if not (
      r.outcome = 'updated'
      and r.changed
      and lead_name = 'João'
      and customer_name = 'João'
      and customer_normalized_name = public.normalize_customer_identity_name_for_system('João')
    ) then
      failed_cases := failed_cases || jsonb_build_object(
        'case', stale_case.label,
        'stale_value', stale_case.stale_value,
        'result', row_to_json(r),
        'lead_name', lead_name,
        'customer_name', customer_name,
        'customer_normalized_name', customer_normalized_name
      );
    end if;
  end loop;

  perform pg_temp._record_identity_result(
    19,
    'same display names with stale normalized_name repaired',
    case when failed_cases = '[]'::jsonb then 'PASS' else 'SUT_FAIL' end,
    failed_cases::text
  );
exception when others then
  perform pg_temp._record_identity_result(19, 'same display names with stale normalized_name repaired', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end $$;

select * from _identity_results order by scenario;

do $$
declare failures jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(r) order by scenario), '[]'::jsonb)
  into failures
  from _identity_results r
  where status <> 'PASS';

  if failures <> '[]'::jsonb then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: customer identity name writer manual checks failed',
      detail = failures::text;
  end if;
end $$;

rollback;

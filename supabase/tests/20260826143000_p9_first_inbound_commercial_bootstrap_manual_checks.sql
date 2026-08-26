begin;

set transaction isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_b3_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS','SUT_FAIL','HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create or replace function pg_temp._p9_b3_record(
  p_number integer,
  p_name text,
  p_status text,
  p_detail text
) returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_b3_results values (
    p_number, p_name, p_status, coalesce(p_detail, '<null>')
  )
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      detail = excluded.detail;
end;
$function$;

create or replace function pg_temp._p9_b3_exec_json(
  p_role text,
  p_sql text
) returns table (
  operation_succeeded boolean,
  value_json jsonb,
  returned_sqlstate text,
  message_text text
)
language plpgsql
as $function$
declare
  v_value jsonb;
  v_state text;
  v_message text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query select false, null::jsonb, 'P0001'::text,
      'runner helper must start as postgres'::text;
    return;
  end if;

  if p_role not in ('postgres','service_role','authenticated','anon') then
    return query select false, null::jsonb, 'P0001'::text,
      'unsupported role'::text;
    return;
  end if;

  if p_role <> 'postgres' then
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', p_role, true);
    perform set_config('request.jwt.claims', jsonb_build_object('role', p_role)::text, true);
    execute format('set local role %I', p_role);
  end if;

  begin
    execute format('select to_jsonb(result_row) from (%s) result_row', p_sql)
      into v_value;
    if p_role <> 'postgres' then
      execute 'reset role';
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims', '', true);
    end if;
    return query select true, v_value, null::text, null::text;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if p_role <> 'postgres' then
      execute 'reset role';
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims', '', true);
    end if;
    return query select false, null::jsonb, v_state, v_message;
  end;
end;
$function$;

create temp table pg_temp._p9_b3_ctx (
  singleton boolean primary key default true check (singleton),
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_b uuid not null,
  store_other_org uuid not null
) on commit preserve rows;

insert into pg_temp._p9_b3_ctx(org_a,org_b,store_a,store_b,store_other_org)
values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

do $fixtures$
declare c pg_temp._p9_b3_ctx%rowtype;
begin
  select * into c from pg_temp._p9_b3_ctx;
  insert into public.organizations(id,name,subscription_status) values
    (c.org_a,'P9 inbound runner org A','active'),
    (c.org_b,'P9 inbound runner org B','active');
  insert into public.stores(id,organization_id,name) values
    (c.store_a,c.org_a,'P9 inbound runner store A'),
    (c.store_b,c.org_a,'P9 inbound runner store B'),
    (c.store_other_org,c.org_b,'P9 inbound runner store C');
end;
$fixtures$;

-- 1. Security/grants --------------------------------------------------------
do $s$
declare ok boolean;
begin
  ok :=
    pg_catalog.has_function_privilege('service_role','public.resolve_whatsapp_inbound_thread_by_system(uuid,uuid,text,text)','EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated','public.resolve_whatsapp_inbound_thread_by_system(uuid,uuid,text,text)','EXECUTE')
    and pg_catalog.has_function_privilege('service_role','public.bootstrap_commercial_identity_from_whatsapp_by_system(uuid,uuid,uuid,uuid,text,text)','EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated','public.bootstrap_commercial_identity_from_whatsapp_by_system(uuid,uuid,uuid,uuid,text,text)','EXECUTE')
    and pg_catalog.has_function_privilege('service_role','public.create_commercial_opportunity_with_context_by_system(uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated','public.create_commercial_opportunity_with_context_by_system(uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE')
    and pg_catalog.has_function_privilege('service_role','public.bootstrap_first_commercial_context_for_inbound_by_system(uuid,uuid,uuid,uuid,text,text)','EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated','public.bootstrap_first_commercial_context_for_inbound_by_system(uuid,uuid,uuid,uuid,text,text)','EXECUTE');
  perform pg_temp._p9_b3_record(1,'writers system-only e grants mínimos',case when ok then 'PASS' else 'SUT_FAIL' end,ok::text);
exception when others then
  perform pg_temp._p9_b3_record(1,'writers system-only e grants mínimos','HARNESS_ERROR',sqlstate||' '||sqlerrm);
end;$s$;

-- 2. First thread creates exactly one lead+active conversation --------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; r record; lc bigint; cc bigint;
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into r from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000001','Cliente 1');
  select count(*) into lc from public.leads where id=r.lead_id and organization_id=c.org_a and store_id=c.store_a;
  select count(*) into cc from public.conversations where id=r.conversation_id and organization_id=c.org_a and lead_id=r.lead_id and status='active';
  perform pg_temp._p9_b3_record(2,'primeiro thread cria lead e conversation ativa',case when lc=1 and cc=1 and r.lead_created and r.conversation_created then 'PASS' else 'SUT_FAIL' end,format('lead=%s conv=%s state=%s',lc,cc,r.thread_state));
exception when others then perform pg_temp._p9_b3_record(2,'primeiro thread cria lead e conversation ativa','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 3. Thread retry reuses, no duplicates -------------------------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; r1 record; r2 record; lc bigint; cc bigint;
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into r1 from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000002','Cliente 2');
  select * into r2 from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000002','Cliente 2');
  select count(*) into lc from public.leads where organization_id=c.org_a and store_id=c.store_a and regexp_replace(phone,'[^0-9]+','','g')='5511999000002';
  select count(*) into cc from public.conversations where organization_id=c.org_a and lead_id=r1.lead_id and status='active';
  perform pg_temp._p9_b3_record(3,'retry do thread não duplica',case when r1.lead_id=r2.lead_id and r1.conversation_id=r2.conversation_id and lc=1 and cc=1 and not r2.lead_created and not r2.conversation_created then 'PASS' else 'SUT_FAIL' end,format('leads=%s active_convs=%s',lc,cc));
exception when others then perform pg_temp._p9_b3_record(3,'retry do thread não duplica','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 4. Duplicate leads fail closed -------------------------------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; r record; p text := '5511999000003';
begin
  select * into c from pg_temp._p9_b3_ctx;
  insert into public.leads(organization_id,store_id,phone,name) values (c.org_a,c.store_a,p,'Dup A'),(c.org_a,c.store_a,p,'Dup B');
  select * into r from pg_temp._p9_b3_exec_json('service_role',format('select * from public.resolve_whatsapp_inbound_thread_by_system(%L::uuid,%L::uuid,%L,%L)',c.org_a,c.store_a,p,'Dup'));
  perform pg_temp._p9_b3_record(4,'dois leads para a mesma identidade fecham fail-closed',case when not r.operation_succeeded and r.message_text like '%lead identity is ambiguous%' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_b3_record(4,'dois leads para a mesma identidade fecham fail-closed','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 5. Multiple active conversations fail closed -----------------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; l uuid:=gen_random_uuid(); r record; p text:='5511999000004';
begin
  select * into c from pg_temp._p9_b3_ctx;
  insert into public.leads(id,organization_id,store_id,phone,name) values(l,c.org_a,c.store_a,p,'Conv Amb');
  insert into public.conversations(organization_id,lead_id,status) values(c.org_a,l,'active'),(c.org_a,l,'active');
  select * into r from pg_temp._p9_b3_exec_json('service_role',format('select * from public.resolve_whatsapp_inbound_thread_by_system(%L::uuid,%L::uuid,%L,%L)',c.org_a,c.store_a,p,'Conv Amb'));
  perform pg_temp._p9_b3_record(5,'múltiplas conversations ativas fecham fail-closed',case when not r.operation_succeeded and r.message_text like '%active conversation is ambiguous%' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_b3_record(5,'múltiplas conversations ativas fecham fail-closed','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 6. Closed conversation is not reused -------------------------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; l uuid:=gen_random_uuid(); oldc uuid:=gen_random_uuid(); r record; p text:='5511999000005';
begin
  select * into c from pg_temp._p9_b3_ctx;
  insert into public.leads(id,organization_id,store_id,phone,name) values(l,c.org_a,c.store_a,p,'Closed');
  insert into public.conversations(id,organization_id,lead_id,status) values(oldc,c.org_a,l,'active');
  update public.conversations set status='closed' where id=oldc;
  select * into r from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,p,'Closed');
  perform pg_temp._p9_b3_record(6,'conversation fechada não é reutilizada',case when r.conversation_id<>oldc and r.conversation_created and exists(select 1 from public.conversations where id=r.conversation_id and status='active') then 'PASS' else 'SUT_FAIL' end,format('old=%s new=%s',oldc,r.conversation_id));
exception when others then perform pg_temp._p9_b3_record(6,'conversation fechada não é reutilizada','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 7. Identity bootstrap creates all four identity layers --------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; t record; b record;
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into t from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000006','Ident 6');
  select * into b from public.bootstrap_commercial_identity_from_whatsapp_by_system(c.org_a,c.store_a,t.lead_id,t.conversation_id,'5511999000006','Ident 6');
  perform pg_temp._p9_b3_record(7,'bootstrap cria customer identity store-link e lead-link',case when b.customer_id is not null and b.customer_channel_identity_id is not null and b.customer_store_link_id is not null and b.lead_customer_link_id is not null and b.customer_created and b.customer_channel_identity_created and b.customer_store_link_created and b.lead_customer_link_created then 'PASS' else 'SUT_FAIL' end,to_jsonb(b)::text);
exception when others then perform pg_temp._p9_b3_record(7,'bootstrap cria customer identity store-link e lead-link','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 8. Identity replay reuses all layers -------------------------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; t record; b1 record; b2 record; ic bigint; sc bigint; lc bigint;
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into t from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000007','Ident 7');
  select * into b1 from public.bootstrap_commercial_identity_from_whatsapp_by_system(c.org_a,c.store_a,t.lead_id,t.conversation_id,'5511999000007','Ident 7');
  select * into b2 from public.bootstrap_commercial_identity_from_whatsapp_by_system(c.org_a,c.store_a,t.lead_id,t.conversation_id,'5511999000007','Ident 7');
  select count(*) into ic from public.customer_channel_identities where organization_id=c.org_a and channel='whatsapp' and normalized_external_identity=b1.normalized_whatsapp_identity;
  select count(*) into sc from public.customer_store_links where organization_id=c.org_a and store_id=c.store_a and customer_id=b1.customer_id;
  select count(*) into lc from public.lead_customer_links where organization_id=c.org_a and store_id=c.store_a and lead_id=t.lead_id and status='active';
  perform pg_temp._p9_b3_record(8,'retry de identity bootstrap não duplica',case when b1.customer_id=b2.customer_id and b1.customer_channel_identity_id=b2.customer_channel_identity_id and ic=1 and sc=1 and lc=1 and not b2.customer_created and not b2.customer_channel_identity_created and not b2.customer_store_link_created and not b2.lead_customer_link_created then 'PASS' else 'SUT_FAIL' end,format('identity=%s store=%s link=%s',ic,sc,lc));
exception when others then perform pg_temp._p9_b3_record(8,'retry de identity bootstrap não duplica','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 9. Conflicting active lead link fails ------------------------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; t record; ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); ia uuid:=gen_random_uuid(); r record; norm text;
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into t from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000008','Conflict');
  norm:=public.normalize_br_whatsapp_identity('5511999000008');
  insert into public.customers(id,organization_id,display_name) values(ca,c.org_a,'A'),(cb,c.org_a,'B');
  insert into public.customer_channel_identities(id,organization_id,customer_id,channel,external_identity,normalized_external_identity,is_primary) values(ia,c.org_a,ca,'whatsapp','5511999000008',norm,true);
  insert into public.customer_store_links(organization_id,store_id,customer_id) values(c.org_a,c.store_a,ca),(c.org_a,c.store_a,cb);
  perform * from public.link_lead_to_customer(c.org_a,c.store_a,t.lead_id,cb,'system','system',null,null,'runner-conflict','runner-conflict-'||t.lead_id::text,null,'{}'::jsonb,null);
  select * into r from pg_temp._p9_b3_exec_json('service_role',format('select * from public.bootstrap_commercial_identity_from_whatsapp_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L)',c.org_a,c.store_a,t.lead_id,t.conversation_id,'5511999000008','Conflict'));
  perform pg_temp._p9_b3_record(9,'lead link conflitante fecha fail-closed',case when not r.operation_succeeded and r.message_text like '%conflicting active lead customer link%' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_b3_record(9,'lead link conflitante fecha fail-closed','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 10. Merged customer fails -------------------------------------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; t record; survivor uuid:=gen_random_uuid(); merged uuid:=gen_random_uuid(); norm text; r record;
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into t from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000009','Merged');
  norm:=public.normalize_br_whatsapp_identity('5511999000009');
  insert into public.customers(id,organization_id,display_name) values(survivor,c.org_a,'Survivor'),(merged,c.org_a,'Merged');
  update public.customers set merged_into_customer_id=survivor where id=merged;
  insert into public.customer_channel_identities(organization_id,customer_id,channel,external_identity,normalized_external_identity,is_primary) values(c.org_a,merged,'whatsapp','5511999000009',norm,true);
  select * into r from pg_temp._p9_b3_exec_json('service_role',format('select * from public.bootstrap_commercial_identity_from_whatsapp_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L)',c.org_a,c.store_a,t.lead_id,t.conversation_id,'5511999000009','Merged'));
  perform pg_temp._p9_b3_record(10,'merged customer é rejeitado',case when not r.operation_succeeded and r.message_text like '%merged customer%' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_b3_record(10,'merged customer é rejeitado','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 11. Contextual opportunity stores core on INSERT --------------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; t record; b record; o record; oid uuid:=gen_random_uuid();
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into t from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000010','Opp 10');
  select * into b from public.bootstrap_commercial_identity_from_whatsapp_by_system(c.org_a,c.store_a,t.lead_id,t.conversation_id,'5511999000010','Opp 10');
  select * into o from public.create_commercial_opportunity_with_context_by_system(c.org_a,c.store_a,b.customer_id,oid,t.lead_id,t.conversation_id);
  perform pg_temp._p9_b3_record(11,'contextual opportunity grava lead+conversation no INSERT',case when o.commercial_opportunity_id=oid and o.origin_lead_id=t.lead_id and o.primary_conversation_id=t.conversation_id and o.stage='novo_lead' then 'PASS' else 'SUT_FAIL' end,to_jsonb(o)::text);
exception when others then perform pg_temp._p9_b3_record(11,'contextual opportunity grava lead+conversation no INSERT','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 12. Same opportunity replay ----------------------------------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; t record; b record; o1 record; o2 record; oid uuid:=gen_random_uuid(); n bigint;
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into t from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000011','Replay');
  select * into b from public.bootstrap_commercial_identity_from_whatsapp_by_system(c.org_a,c.store_a,t.lead_id,t.conversation_id,'5511999000011','Replay');
  select * into o1 from public.create_commercial_opportunity_with_context_by_system(c.org_a,c.store_a,b.customer_id,oid,t.lead_id,t.conversation_id);
  select * into o2 from public.create_commercial_opportunity_with_context_by_system(c.org_a,c.store_a,b.customer_id,oid,t.lead_id,t.conversation_id);
  select count(*) into n from public.commercial_opportunities where id=oid;
  perform pg_temp._p9_b3_record(12,'same opportunity payload é replay-safe',case when o1.commercial_opportunity_id=o2.commercial_opportunity_id and n=1 then 'PASS' else 'SUT_FAIL' end,format('rows=%s',n));
exception when others then perform pg_temp._p9_b3_record(12,'same opportunity payload é replay-safe','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 13. Divergent replay fails ------------------------------------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; t1 record; b1 record; oid uuid:=gen_random_uuid(); divergent_conversation_id uuid; r record;
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into t1 from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000012','Div A');
  select * into b1 from public.bootstrap_commercial_identity_from_whatsapp_by_system(c.org_a,c.store_a,t1.lead_id,t1.conversation_id,'5511999000012','Div A');
  perform * from public.create_commercial_opportunity_with_context_by_system(c.org_a,c.store_a,b1.customer_id,oid,t1.lead_id,t1.conversation_id);
  insert into public.conversations(organization_id,lead_id,status) values(c.org_a,t1.lead_id,'active') returning id into divergent_conversation_id;
  select * into r from pg_temp._p9_b3_exec_json('service_role',format('select * from public.create_commercial_opportunity_with_context_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',c.org_a,c.store_a,b1.customer_id,oid,t1.lead_id,divergent_conversation_id));
  perform pg_temp._p9_b3_record(13,'same opportunity id com payload divergente falha',case when not r.operation_succeeded and r.message_text like '%payload mismatch%' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_b3_record(13,'same opportunity id com payload divergente falha','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 14. Conversation/lead mismatch fails -------------------------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; t1 record; t2 record; b1 record; r record;
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into t1 from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000013','Lead A');
  select * into b1 from public.bootstrap_commercial_identity_from_whatsapp_by_system(c.org_a,c.store_a,t1.lead_id,t1.conversation_id,'5511999000013','Lead A');
  select * into t2 from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000014','Lead B');
  select * into r from pg_temp._p9_b3_exec_json('service_role',format('select * from public.create_commercial_opportunity_with_context_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',c.org_a,c.store_a,b1.customer_id,gen_random_uuid(),t1.lead_id,t2.conversation_id));
  perform pg_temp._p9_b3_record(14,'conversation de outro lead falha',case when not r.operation_succeeded and r.message_text like '%conversation scope mismatch%' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_b3_record(14,'conversation de outro lead falha','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 15. Zero history creates first contextual opportunity ---------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; t record; b record; n bigint;
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into t from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000015','First');
  select * into b from public.bootstrap_first_commercial_context_for_inbound_by_system(c.org_a,c.store_a,t.lead_id,t.conversation_id,'5511999000015','First');
  select count(*) into n from public.commercial_opportunities where id=b.commercial_opportunity_id and origin_lead_id=t.lead_id and primary_conversation_id=t.conversation_id;
  perform pg_temp._p9_b3_record(15,'zero history cria primeira opportunity',case when b.bootstrap_state='created_first_contextual_opportunity' and b.commercial_opportunity_created and n=1 then 'PASS' else 'SUT_FAIL' end,to_jsonb(b)::text);
exception when others then perform pg_temp._p9_b3_record(15,'zero history cria primeira opportunity','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 16. Existing history + new conversation does not create -------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; t record; b1 record; newc uuid:=gen_random_uuid(); b2 record; before_n bigint; after_n bigint;
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into t from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000016','Hist');
  select * into b1 from public.bootstrap_first_commercial_context_for_inbound_by_system(c.org_a,c.store_a,t.lead_id,t.conversation_id,'5511999000016','Hist');
  select count(*) into before_n from public.commercial_opportunities where organization_id=c.org_a and store_id=c.store_a and customer_id=b1.customer_id;
  insert into public.conversations(id,organization_id,lead_id,status) values(newc,c.org_a,t.lead_id,'active');
  select * into b2 from public.bootstrap_first_commercial_context_for_inbound_by_system(c.org_a,c.store_a,t.lead_id,newc,'5511999000016','Hist');
  select count(*) into after_n from public.commercial_opportunities where organization_id=c.org_a and store_id=c.store_a and customer_id=b1.customer_id;
  perform pg_temp._p9_b3_record(16,'history sem contexto não cria nova opportunity',case when b2.bootstrap_state='historical_context_requires_manual_resolution' and b2.commercial_opportunity_id is null and before_n=after_n then 'PASS' else 'SUT_FAIL' end,to_jsonb(b2)::text);
exception when others then perform pg_temp._p9_b3_record(16,'history sem contexto não cria nova opportunity','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 17. Exact ambiguity returns safe state, not exception ---------------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; t record; idb record; o1 uuid:=gen_random_uuid(); o2 uuid:=gen_random_uuid(); b record;
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into t from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000017','Amb');
  select * into idb from public.bootstrap_commercial_identity_from_whatsapp_by_system(c.org_a,c.store_a,t.lead_id,t.conversation_id,'5511999000017','Amb');
  perform * from public.create_commercial_opportunity_with_context_by_system(c.org_a,c.store_a,idb.customer_id,o1,t.lead_id,t.conversation_id);
  perform * from public.create_commercial_opportunity_with_context_by_system(c.org_a,c.store_a,idb.customer_id,o2,t.lead_id,t.conversation_id);
  select * into b from public.bootstrap_first_commercial_context_for_inbound_by_system(c.org_a,c.store_a,t.lead_id,t.conversation_id,'5511999000017','Amb');
  perform pg_temp._p9_b3_record(17,'duas exact opportunities retornam ambiguidade segura',case when b.bootstrap_state='commercial_opportunity_exact_context_ambiguous' and b.commercial_opportunity_id is null then 'PASS' else 'SUT_FAIL' end,to_jsonb(b)::text);
exception when others then perform pg_temp._p9_b3_record(17,'duas exact opportunities retornam ambiguidade segura','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 18. Active context has precedence over multiple historical opportunities --
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; t record; b1 record; o2 uuid:=gen_random_uuid(); ensured record; b2 record;
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into t from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000018','ActiveCtx');
  select * into b1 from public.bootstrap_first_commercial_context_for_inbound_by_system(c.org_a,c.store_a,t.lead_id,t.conversation_id,'5511999000018','ActiveCtx');
  select * into ensured from public.ensure_commercial_conversation_session_context(c.org_a,c.store_a,t.conversation_id);
  perform * from public.create_commercial_opportunity_with_context_by_system(c.org_a,c.store_a,b1.customer_id,o2,t.lead_id,t.conversation_id);
  select * into b2 from public.bootstrap_first_commercial_context_for_inbound_by_system(c.org_a,c.store_a,t.lead_id,t.conversation_id,'5511999000018','ActiveCtx');
  perform pg_temp._p9_b3_record(18,'active context explícito vence múltiplas opportunities históricas',case when b2.bootstrap_state='existing_active_commercial_context' and b2.commercial_opportunity_id=ensured.commercial_opportunity_id then 'PASS' else 'SUT_FAIL' end,to_jsonb(b2)::text);
exception when others then perform pg_temp._p9_b3_record(18,'active context explícito vence múltiplas opportunities históricas','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

-- 19. Real insert_message becomes captured after first bootstrap ------------
do $s$
declare c pg_temp._p9_b3_ctx%rowtype; t record; b record; m public.messages; ext text := 'wamid.p9-runner-'||gen_random_uuid()::text;
begin
  select * into c from pg_temp._p9_b3_ctx;
  select * into t from public.resolve_whatsapp_inbound_thread_by_system(c.org_a,c.store_a,'5511999000019','Captured');
  select * into b from public.bootstrap_first_commercial_context_for_inbound_by_system(c.org_a,c.store_a,t.lead_id,t.conversation_id,'5511999000019','Captured');
  select * into m from public.insert_message(t.conversation_id,'user','incoming','text','runner first inbound',ext,null,'{}'::jsonb);
  perform pg_temp._p9_b3_record(19,'insert_message real nasce captured após bootstrap',case when m.commercial_context_capture_state='captured' and m.conversation_session_id is not null and m.commercial_session_context_link_id is not null and b.commercial_opportunity_id is not null then 'PASS' else 'SUT_FAIL' end,format('state=%s session=%s context=%s',m.commercial_context_capture_state,m.conversation_session_id,m.commercial_session_context_link_id));
exception when others then perform pg_temp._p9_b3_record(19,'insert_message real nasce captured após bootstrap','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;$s$;

table pg_temp._p9_b3_results order by scenario_number;

select
  count(*) filter (where status='PASS') as passed,
  count(*) filter (where status='SUT_FAIL') as sut_failed,
  count(*) filter (where status='HARNESS_ERROR') as harness_errors,
  count(*) as total
from pg_temp._p9_b3_results;

select count(*) as failed_scenarios
from pg_temp._p9_b3_results
where status <> 'PASS';

rollback;

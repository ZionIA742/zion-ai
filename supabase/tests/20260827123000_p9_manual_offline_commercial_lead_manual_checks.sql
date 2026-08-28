begin;

create temporary table _p9_manual_offline_results (
  scenario integer primary key,
  name text not null,
  status text not null,
  detail text
) on commit drop;

create or replace function pg_temp._p9_manual_offline_record(
  p_scenario integer,
  p_name text,
  p_status text,
  p_detail text default null
)
returns void
language plpgsql
as $$
begin
  insert into pg_temp._p9_manual_offline_results(scenario, name, status, detail)
  values (p_scenario, p_name, p_status, p_detail);
end;
$$;


create or replace function pg_temp._p9_manual_offline_exec_value_sql(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_text text,
  returned_sqlstate text,
  message_text text
)
language plpgsql
as $$
declare
  v_value text;
  v_state text;
  v_message text;
  v_operation_succeeded boolean := false;
begin
  execute pg_catalog.format('set local role %I', p_role);

  perform pg_catalog.set_config('request.jwt.claim.role', p_role, true);
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    coalesce(p_user_id::text, ''),
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claims',
    case
      when p_user_id is null then
        pg_catalog.jsonb_build_object('role', p_role)::text
      else
        pg_catalog.jsonb_build_object(
          'role', p_role,
          'sub', p_user_id::text
        )::text
    end,
    true
  );

  begin
    execute p_sql into v_value;
    v_operation_succeeded := true;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;
      v_operation_succeeded := false;
  end;

  begin
    execute 'reset role';
  exception
    when others then
      null;
  end;

  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);

  return query
  select
    v_operation_succeeded,
    case when v_operation_succeeded then v_value else null::text end,
    v_state,
    v_message;
end;
$$;

create temporary table _p9_manual_offline_ctx (
  organization_id uuid,
  store_id uuid,
  member_user_id uuid,
  operation_id uuid,
  lead_id uuid,
  customer_id uuid,
  customer_store_link_id uuid,
  lead_customer_link_id uuid,
  commercial_opportunity_id uuid
) on commit drop;

do $setup$
declare
  v_org uuid;
  v_store uuid;
  v_user uuid;
begin
  select m.organization_id, s.id, m.user_id
  into v_org, v_store, v_user
  from public.memberships m
  join public.stores s on s.organization_id = m.organization_id
  where m.user_id is not null
  order by m.organization_id, s.id, m.user_id
  limit 1;

  if v_org is null or v_store is null or v_user is null then
    raise exception using errcode = 'P0001',
      message = 'runner prerequisite missing: organization/store/member';
  end if;

  insert into pg_temp._p9_manual_offline_ctx(
    organization_id, store_id, member_user_id, operation_id
  ) values (v_org, v_store, v_user, pg_catalog.gen_random_uuid());
end;
$setup$;

-- 1. Contract/grants.
do $s1$
declare
  v_oid oid;
  v_ok boolean;
begin
  v_oid := pg_catalog.to_regprocedure(
    'public.create_manual_commercial_lead_by_user(uuid,uuid,uuid,text,text)'
  );

  select v_oid is not null
    and pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
  into v_ok;

  perform pg_temp._p9_manual_offline_record(
    1, 'writer existe com grants fail-closed',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_oid::text, '<missing>')
  );
exception when others then
  perform pg_temp._p9_manual_offline_record(
    1, 'writer existe com grants fail-closed',
    'HARNESS_ERROR', sqlstate || ' ' || sqlerrm
  );
end;
$s1$;

-- 2. Create full offline chain.
do $s2$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
  r record;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;

  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', c.member_user_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'role','authenticated','sub',c.member_user_id::text
    )::text,
    true
  );

  select * into r
  from public.create_manual_commercial_lead_by_user(
    c.organization_id,
    c.store_id,
    c.operation_id,
    'Cliente Offline P9',
    '(11) 98888-7766'
  );

  update pg_temp._p9_manual_offline_ctx
  set lead_id = r.lead_id,
      customer_id = r.customer_id,
      customer_store_link_id = r.customer_store_link_id,
      lead_customer_link_id = r.lead_customer_link_id,
      commercial_opportunity_id = r.commercial_opportunity_id;

  perform pg_temp._p9_manual_offline_record(
    2, 'criacao atomica retorna cadeia completa',
    case when r.lead_id is not null
      and r.customer_id is not null
      and r.customer_store_link_id is not null
      and r.lead_customer_link_id is not null
      and r.commercial_opportunity_id is not null
      and r.stage = 'novo_lead'
      and r.primary_conversation_id is null
      and r.replayed = false
    then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.to_jsonb(r)::text
  );
exception when others then
  perform pg_temp._p9_manual_offline_record(
    2, 'criacao atomica retorna cadeia completa',
    'SUT_FAIL', sqlstate || ' ' || sqlerrm
  );
end;
$s2$;

-- 3. Persisted graph is exact.
do $s3$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;

  select exists (
      select 1 from public.leads l
      where l.id = c.lead_id
        and l.organization_id = c.organization_id
        and l.store_id = c.store_id
        and l.name = 'Cliente Offline P9'
        and l.phone = '(11) 98888-7766'
        and l.state = 'novo_lead'
    )
    and exists (
      select 1 from public.customers x
      where x.id = c.customer_id
        and x.organization_id = c.organization_id
        and x.display_name = 'Cliente Offline P9'
        and x.normalized_name = 'cliente offline p9'
        and x.merged_into_customer_id is null
    )
    and exists (
      select 1 from public.customer_store_links x
      where x.id = c.customer_store_link_id
        and x.customer_id = c.customer_id
        and x.organization_id = c.organization_id
        and x.store_id = c.store_id
    )
    and exists (
      select 1 from public.lead_customer_links x
      where x.id = c.lead_customer_link_id
        and x.lead_id = c.lead_id
        and x.customer_id = c.customer_id
        and x.source = 'manual'
        and x.source_identity_id is null
        and x.linked_by_actor_type = 'human'
        and x.linked_by_user_id = c.member_user_id
        and x.status = 'active'
        and x.unlinked_at is null
    )
    and exists (
      select 1 from public.commercial_opportunities x
      where x.id = c.commercial_opportunity_id
        and x.customer_id = c.customer_id
        and x.origin_lead_id = c.lead_id
        and x.primary_conversation_id is null
        and x.stage = 'novo_lead'
    )
  into v_ok;

  perform pg_temp._p9_manual_offline_record(
    3, 'grafo persistido preserva origem manual/offline',
    case when v_ok then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_manual_offline_record(
    3, 'grafo persistido preserva origem manual/offline',
    'HARNESS_ERROR', sqlstate || ' ' || sqlerrm
  );
end;
$s3$;

-- 4. No fabricated conversation/message.
do $s4$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
  v_conversations bigint;
  v_messages bigint;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;

  select pg_catalog.count(*) into v_conversations
  from public.conversations x
  where x.organization_id = c.organization_id
    and x.lead_id = c.lead_id;

  select pg_catalog.count(*) into v_messages
  from public.messages x
  where x.organization_id = c.organization_id
    and x.store_id = c.store_id
    and x.lead_id = c.lead_id;

  perform pg_temp._p9_manual_offline_record(
    4, 'criacao offline nao fabrica conversation/message',
    case when v_conversations = 0 and v_messages = 0
      then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.format('conversations=%s messages=%s',v_conversations,v_messages)
  );
exception when others then
  perform pg_temp._p9_manual_offline_record(
    4, 'criacao offline nao fabrica conversation/message',
    'HARNESS_ERROR', sqlstate || ' ' || sqlerrm
  );
end;
$s4$;

-- 5. Exact replay.
do $s5$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
  r record;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;

  select * into r
  from public.create_manual_commercial_lead_by_user(
    c.organization_id,
    c.store_id,
    c.operation_id,
    'Cliente Offline P9',
    '(11) 98888-7766'
  );

  perform pg_temp._p9_manual_offline_record(
    5, 'replay exato devolve as mesmas identidades',
    case when r.replayed = true
      and r.lead_id = c.lead_id
      and r.customer_id = c.customer_id
      and r.lead_customer_link_id = c.lead_customer_link_id
      and r.commercial_opportunity_id = c.commercial_opportunity_id
    then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.to_jsonb(r)::text
  );
exception when others then
  perform pg_temp._p9_manual_offline_record(
    5, 'replay exato devolve as mesmas identidades',
    'SUT_FAIL', sqlstate || ' ' || sqlerrm
  );
end;
$s5$;

-- 6. Divergent replay.
do $s6$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
  v_blocked boolean := false;
  v_detail text;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;

  begin
    perform * from public.create_manual_commercial_lead_by_user(
      c.organization_id, c.store_id, c.operation_id,
      'Payload Divergente', '(11) 97777-6655'
    );
    v_detail := 'unexpected success';
  exception when sqlstate '23514' then
    v_blocked := true;
    v_detail := sqlerrm;
  end;

  perform pg_temp._p9_manual_offline_record(
    6, 'mesma operation_id com payload divergente falha fechado',
    case when v_blocked then 'PASS' else 'SUT_FAIL' end,
    v_detail
  );
exception when others then
  perform pg_temp._p9_manual_offline_record(
    6, 'mesma operation_id com payload divergente falha fechado',
    'HARNESS_ERROR', sqlstate || ' ' || sqlerrm
  );
end;
$s6$;

-- 7. service_role cannot impersonate human action.
do $s7$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
  v_blocked boolean := false;
  v_detail text;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;

  perform pg_catalog.set_config('request.jwt.claim.role','service_role',true);
  perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  perform pg_catalog.set_config('request.jwt.claims','{"role":"service_role"}',true);

  begin
    perform * from public.create_manual_commercial_lead_by_user(
      c.organization_id, c.store_id, pg_catalog.gen_random_uuid(),
      'Service Role Block', null
    );
    v_detail := 'unexpected success';
  exception when sqlstate '42501' then
    v_blocked := true;
    v_detail := sqlerrm;
  end;

  perform pg_temp._p9_manual_offline_record(
    7, 'service_role nao pode falsificar acao humana',
    case when v_blocked then 'PASS' else 'SUT_FAIL' end,
    v_detail
  );
exception when others then
  perform pg_temp._p9_manual_offline_record(
    7, 'service_role nao pode falsificar acao humana',
    'HARNESS_ERROR', sqlstate || ' ' || sqlerrm
  );
end;
$s7$;

-- Restore member claims.
do $restore$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;
  perform pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
  perform pg_catalog.set_config('request.jwt.claim.sub',c.member_user_id::text,true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'role','authenticated','sub',c.member_user_id::text
    )::text,
    true
  );
end;
$restore$;

-- 8. Board exposes offline card using the same effective authenticated role
-- contract required by the hardened CRM reader.
do $s8$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
  v_exec record;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;

  select *
  into v_exec
  from pg_temp._p9_manual_offline_exec_value_sql(
    'authenticated',
    c.member_user_id,
    pg_catalog.format(
      $sql$
        select case when exists (
          select 1
          from public.panel_list_crm_opportunity_cards_scoped(
            %L::uuid,
            %L::uuid,
            500,
            0
          ) card
          where card.commercial_opportunity_id = %L::uuid
            and card.lead_id = %L::uuid
            and card.conversation_id is null
            and card.name = 'Cliente Offline P9'
            and card.phone = '(11) 98888-7766'
            and card.opportunity_stage = 'novo_lead'
        ) then 'true' else 'false' end
      $sql$,
      c.organization_id,
      c.store_id,
      c.commercial_opportunity_id,
      c.lead_id
    )
  );

  perform pg_temp._p9_manual_offline_record(
    8,
    'board lista opportunity offline com conversation_id null',
    case
      when v_exec.operation_succeeded and v_exec.value_text = 'true'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(
      v_exec.value_text,
      v_exec.returned_sqlstate || ' ' || v_exec.message_text,
      '<null>'
    )
  );
exception when others then
  perform pg_temp._p9_manual_offline_record(
    8, 'board lista opportunity offline com conversation_id null',
    'HARNESS_ERROR', sqlstate || ' ' || sqlerrm
  );
end;
$s8$;

-- The role-aware board harness clears JWT settings after execution.
-- Restore the authenticated member context for the remaining by_user checks.
do $restore_after_board$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;
  perform pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
  perform pg_catalog.set_config('request.jwt.claim.sub',c.member_user_id::text,true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'role','authenticated','sub',c.member_user_id::text
    )::text,
    true
  );
end;
$restore_after_board$;

-- 9. Manual fact without message/conversation.
do $s9$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
  r record;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;

  select * into r
  from public.write_commercial_opportunity_qualification_fact_by_user(
    c.organization_id,
    c.store_id,
    c.commercial_opportunity_id,
    'p9_31_manual_offline_location:' || c.operation_id::text,
    'location_text',
    pg_catalog.to_jsonb('Campinas'::text),
    null,
    null,
    false
  );

  perform pg_temp._p9_manual_offline_record(
    9, 'qualification fact crm_manual funciona sem message/conversation',
    case when r.fact_key = 'location_text'
      and r.current_state = 'confirmed'
    then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.to_jsonb(r)::text
  );
exception when others then
  perform pg_temp._p9_manual_offline_record(
    9, 'qualification fact crm_manual funciona sem message/conversation',
    'SUT_FAIL', sqlstate || ' ' || sqlerrm
  );
end;
$s9$;

-- 10. Provenance remains crm_manual.
do $s10$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;

  select exists (
    select 1
    from public.commercial_opportunity_qualification_fact_events e
    where e.organization_id = c.organization_id
      and e.store_id = c.store_id
      and e.commercial_opportunity_id = c.commercial_opportunity_id
      and e.fact_key = 'location_text'
      and e.source_type = 'crm_manual'
      and e.source_message_id is null
      and e.source_conversation_id is null
      and e.assertion_level = 'confirmed'
  )
  into v_ok;

  perform pg_temp._p9_manual_offline_record(
    10, 'proveniencia offline e crm_manual sem mensagem falsa',
    case when v_ok then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_manual_offline_record(
    10, 'proveniencia offline e crm_manual sem mensagem falsa',
    'HARNESS_ERROR', sqlstate || ' ' || sqlerrm
  );
end;
$s10$;

-- 11. Reader sees the fact without conversation.
do $s11$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;

  select * into r
  from public.read_commercial_opportunity_qualification_facts_by_user(
    c.organization_id,c.store_id,c.commercial_opportunity_id
  );

  v_ok := r.known_fact_count >= 1
    and r.conflict_count = 0
    and r.known_facts @> pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'factKey','location_text',
        'state','confirmed',
        'value','Campinas'
      )
    );

  perform pg_temp._p9_manual_offline_record(
    11, 'reader canonico le fato manual sem conversation',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.to_jsonb(r)::text
  );
exception when others then
  perform pg_temp._p9_manual_offline_record(
    11, 'reader canonico le fato manual sem conversation',
    'SUT_FAIL', sqlstate || ' ' || sqlerrm
  );
end;
$s11$;

-- 12. Lifecycle progresses with no conversation.
do $s12$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
  r record;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;

  select * into r
  from public.transition_commercial_opportunity_stage_by_user(
    c.organization_id,
    c.store_id,
    c.commercial_opportunity_id,
    'p9_31_manual_offline_stage:' || c.operation_id::text,
    'qualificacao',
    'Lead offline recebeu qualificacao manual.',
    'crm_manual_action',
    null,
    'Progressao E2E da etapa 3.1 sem conversation.',
    'p9_31_manual_offline_e2e'
  );

  perform pg_temp._p9_manual_offline_record(
    12, 'lifecycle progride offline para qualificacao',
    case when r.stage = 'qualificacao' then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.to_jsonb(r)::text
  );
exception when others then
  perform pg_temp._p9_manual_offline_record(
    12, 'lifecycle progride offline para qualificacao',
    'SUT_FAIL', sqlstate || ' ' || sqlerrm
  );
end;
$s12$;

-- 13. Still no conversation after lifecycle progression.
do $s13$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;

  select exists (
      select 1 from public.commercial_opportunities o
      where o.id = c.commercial_opportunity_id
        and o.stage = 'qualificacao'
        and o.origin_lead_id = c.lead_id
        and o.primary_conversation_id is null
    )
    and not exists (
      select 1 from public.conversations x
      where x.organization_id = c.organization_id
        and x.lead_id = c.lead_id
    )
  into v_ok;

  perform pg_temp._p9_manual_offline_record(
    13, 'opportunity segue operavel sem ganhar conversa ficticia',
    case when v_ok then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_manual_offline_record(
    13, 'opportunity segue operavel sem ganhar conversa ficticia',
    'HARNESS_ERROR', sqlstate || ' ' || sqlerrm
  );
end;
$s13$;


-- 14. Authenticated user without membership is rejected.
do $s14$
declare
  c pg_temp._p9_manual_offline_ctx%rowtype;
  v_fake_user uuid := pg_catalog.gen_random_uuid();
  v_blocked boolean := false;
  v_detail text;
begin
  select * into c from pg_temp._p9_manual_offline_ctx limit 1;

  perform pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
  perform pg_catalog.set_config('request.jwt.claim.sub',v_fake_user::text,true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'role','authenticated','sub',v_fake_user::text
    )::text,
    true
  );

  begin
    perform * from public.create_manual_commercial_lead_by_user(
      c.organization_id,
      c.store_id,
      pg_catalog.gen_random_uuid(),
      'Non Member Block',
      null
    );
    v_detail := 'unexpected success';
  exception when sqlstate '42501' then
    v_blocked := true;
    v_detail := sqlerrm;
  end;

  perform pg_temp._p9_manual_offline_record(
    14, 'authenticated sem membership nao pode criar lead comercial',
    case when v_blocked then 'PASS' else 'SUT_FAIL' end,
    v_detail
  );
exception when others then
  perform pg_temp._p9_manual_offline_record(
    14, 'authenticated sem membership nao pode criar lead comercial',
    'HARNESS_ERROR', sqlstate || ' ' || sqlerrm
  );
end;
$s14$;

select *
from pg_temp._p9_manual_offline_results
order by scenario;

select pg_catalog.count(*) as failed_scenarios
from pg_temp._p9_manual_offline_results
where status <> 'PASS';

rollback;

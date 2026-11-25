-- ZION P9 B10 - 5.3-I.13-G.2
-- Synthetic fixture foundation.
-- CANDIDATE ONLY. Execution requires separate review.
-- No external requests, no persistent installation.

begin;

set local lock_timeout = '4s';
set local statement_timeout = '60s';

create temporary table p9_recovery_fixture_results (
  test_name text not null,
  verdict text not null,
  details text not null
) on commit drop;

create temporary table p9_recovery_fixture (
  fixture_name text primary key,
  organization_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  lead_id uuid not null,
  conversation_id uuid not null,
  conversation_session_id uuid not null,
  opportunity_id uuid not null,
  lead_customer_link_id uuid,
  context_link_id uuid,
  anchor_message_id uuid,
  operation_prefix text not null
) on commit drop;

insert into pg_temp.p9_recovery_fixture (
  fixture_name,
  organization_id,
  store_id,
  customer_id,
  lead_id,
  conversation_id,
  conversation_session_id,
  opportunity_id,
  operation_prefix
)
select
  fixture_name,
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'p9-recovery-homologation:' || gen_random_uuid()::text
from (
  values ('target'), ('foreign')
) fixtures(fixture_name);

do $fixture_preflight$
begin
  if session_user <> 'postgres'
     or current_user <> 'postgres'
     or coalesce(
       current_setting('request.jwt.claim.role',true),''
     ) <> ''
     or coalesce(
       current_setting('request.jwt.claims',true),''
     ) not in ('','{}') then
    raise exception 'P9_FIXTURE_ADMIN_CONTEXT_REQUIRED';
  end if;

  if exists (
    select 1
    from pg_temp.p9_recovery_fixture f
    join public.organizations o
      on o.id=f.organization_id
  ) then
    raise exception 'P9_FIXTURE_ID_COLLISION';
  end if;

  if exists (
    select 1
    from pg_temp.p9_recovery_fixture f
    join public.ai_run_queue q
      on q.organization_id=f.organization_id
  ) then
    raise exception 'P9_FIXTURE_QUEUE_COLLISION';
  end if;

  insert into pg_temp.p9_recovery_fixture_results
  values (
    'fixture_preflight',
    'PASS',
    'Fresh synthetic identities and administrative context'
  );
end;
$fixture_preflight$;

do $fixture_setup$
declare
  f record;
  v_link record;
  v_context record;
  v_anchor uuid;
  v_queue_count bigint;
begin
  for f in
    select *
    from pg_temp.p9_recovery_fixture
    order by fixture_name
  loop
    insert into public.organizations (
      id,name,subscription_status
    ) values (
      f.organization_id,
      'P9 synthetic recovery '||f.fixture_name,
      'past_due'
    );

    insert into public.stores (
      id,organization_id,name
    ) values (
      f.store_id,
      f.organization_id,
      'P9 synthetic store '||f.fixture_name
    );

    insert into public.customers (
      id,organization_id,display_name,normalized_name
    ) values (
      f.customer_id,
      f.organization_id,
      'P9 synthetic customer '||f.fixture_name,
      'p9 synthetic customer '||f.fixture_name
    );

    insert into public.customer_store_links (
      organization_id,store_id,customer_id
    ) values (
      f.organization_id,f.store_id,f.customer_id
    );

    insert into public.leads (
      id,organization_id,store_id,name,phone,state
    ) values (
      f.lead_id,
      f.organization_id,
      f.store_id,
      'P9 synthetic lead '||f.fixture_name,
      case when f.fixture_name='target'
        then '+5500000000001'
        else '+5500000000002'
      end,
      'novo_lead'
    );

    insert into public.conversations (
      id,organization_id,lead_id,status,is_human_active
    ) values (
      f.conversation_id,
      f.organization_id,
      f.lead_id,
      'open',
      false
    );

    insert into public.commercial_opportunities (
      id,organization_id,store_id,customer_id,
      origin_lead_id,primary_conversation_id,stage
    ) values (
      f.opportunity_id,
      f.organization_id,
      f.store_id,
      f.customer_id,
      f.lead_id,
      f.conversation_id,
      'novo_lead'
    );

    insert into public.conversation_sessions (
      id,organization_id,store_id,
      conversation_id,status,closed_at
    ) values (
      f.conversation_session_id,
      f.organization_id,
      f.store_id,
      f.conversation_id,
      'active',
      null
    );

    select * into strict v_link
    from public.link_lead_to_customer(
      f.organization_id,
      f.store_id,
      f.lead_id,
      f.customer_id,
      'manual',
      'system',
      null,
      null,
      'P9 synthetic recovery fixture',
      f.operation_prefix||':lead-customer',
      gen_random_uuid(),
      jsonb_build_object(
        'runner',true,
        'synthetic',true
      ),
      null
    );

    select * into strict v_context
    from public.link_commercial_session_context(
      f.organization_id,
      f.store_id,
      f.conversation_session_id,
      f.customer_id,
      f.opportunity_id,
      v_link.id,
      'system',
      'system',
      null,
      'P9 synthetic recovery fixture',
      f.operation_prefix||':context-link',
      gen_random_uuid(),
      jsonb_build_object(
        'runner',true,
        'synthetic',true
      ),
      null
    );

    select id into strict v_anchor
    from public.insert_message(
      f.conversation_id,
      'user',
      'incoming',
      'text',
      'Synthetic commercial recovery request',
      null,
      null,
      jsonb_build_object(
        'runner',true,
        'synthetic',true,
        'fixture',f.fixture_name
      )
    );

    update pg_temp.p9_recovery_fixture
       set lead_customer_link_id=v_link.id,
           context_link_id=v_context.id,
           anchor_message_id=v_anchor
     where fixture_name=f.fixture_name;

    if not exists (
      select 1
      from public.messages m
      where m.id=v_anchor
        and m.organization_id=f.organization_id
        and m.store_id=f.store_id
        and m.conversation_id=f.conversation_id
        and m.lead_id=f.lead_id
        and m.sender='user'
        and m.direction='incoming'
        and m.deleted_at is null
    ) then
      raise exception 'P9_FIXTURE_ANCHOR_SCOPE_INVALID';
    end if;

    insert into pg_temp.p9_recovery_fixture_results
    values (
      'fixture_'||f.fixture_name,
      'PASS',
      'Canonical customer, session, opportunity and anchor'
    );
  end loop;

  select
    (select count(*) from public.ai_run_queue
      where organization_id in (
        select organization_id
        from pg_temp.p9_recovery_fixture
      ))
    +
    (select count(*) from public.ai_sales_action_queue
      where organization_id in (
        select organization_id
        from pg_temp.p9_recovery_fixture
      ))
    +
    (select count(*) from public.ai_runs
      where organization_id in (
        select organization_id
        from pg_temp.p9_recovery_fixture
      ))
    +
    (select count(*) from public.store_assistant_notification_queue
      where organization_id in (
        select organization_id
        from pg_temp.p9_recovery_fixture
      ))
    +
    (select count(*) from public.store_assistant_operational_task_queue
      where organization_id in (
        select organization_id
        from pg_temp.p9_recovery_fixture
      ))
    +
    (select count(*) from public.store_assistant_operational_tasks
      where organization_id in (
        select organization_id
        from pg_temp.p9_recovery_fixture
      ))
  into v_queue_count;

  if v_queue_count<>0 then
    raise exception
      'P9_FIXTURE_UNEXPECTED_SIDE_EFFECTS:%',
      v_queue_count;
  end if;

  if (
    select count(distinct organization_id)
    from pg_temp.p9_recovery_fixture
  )<>2 then
    raise exception 'P9_FIXTURE_TENANT_ISOLATION_INVALID';
  end if;

  insert into pg_temp.p9_recovery_fixture_results
  values
    (
      'fixture_tenant_isolation',
      'PASS',
      'Two independent synthetic organizations'
    ),
    (
      'fixture_side_effects',
      'PASS',
      'No AI runs or unexpected queue entries'
    );
end;
$fixture_setup$;

-- G.3 INSERTION POINT:
-- Candidate migration integration.
-- Confirmed response-set materialization.
-- Canonical claim acquisition.
-- Recovery writers and negative tests.
-- Human control, retry and idempotency.
-- Rollback residue checks.

select test_name,verdict,details
from pg_temp.p9_recovery_fixture_results
order by test_name;

rollback;
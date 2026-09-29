begin;

create temp table pg_temp._p9_wtr_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  detail text not null
) on commit preserve rows;

create or replace function pg_temp._p9_wtr_record(
  p_number integer,
  p_name text,
  p_status text,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_wtr_results (
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_number,
    p_name,
    p_status,
    coalesce(p_detail, '<null>')
  );
end;
$function$;

create temp table pg_temp._p9_wtr_ctx (
  organization_id uuid not null,
  store_id uuid not null
) on commit preserve rows;

do $setup$
declare
  v_organization_id uuid;
  v_store_id uuid;
begin
  select s.organization_id, s.id
  into v_organization_id, v_store_id
  from public.stores s
  order by s.id
  limit 1;

  if v_organization_id is null or v_store_id is null then
    raise exception 'HARNESS_BLOCKED: no store fixture available';
  end if;

  insert into pg_temp._p9_wtr_ctx (organization_id, store_id)
  values (v_organization_id, v_store_id);
end;
$setup$;

-- 1. active is reused
do $s$
declare
  c pg_temp._p9_wtr_ctx%rowtype;
  v_lead uuid := gen_random_uuid();
  v_conversation uuid := gen_random_uuid();
  v_phone text := '5599' || right('000000000000' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'), 12);
  r record;
begin
  select * into c from pg_temp._p9_wtr_ctx;
  insert into public.leads (id, organization_id, store_id, phone, name)
  values (v_lead, c.organization_id, c.store_id, v_phone, 'P9 WTR active reuse');
  insert into public.conversations (id, organization_id, lead_id, status)
  values (v_conversation, c.organization_id, v_lead, 'active');
  select * into r
  from public.resolve_whatsapp_inbound_thread_by_system(c.organization_id, c.store_id, v_phone, 'P9 WTR active reuse');
  perform pg_temp._p9_wtr_record(
    1,
    'active conversation is reused',
    case when r.conversation_id = v_conversation
      and r.lead_id = v_lead
      and r.thread_state = 'existing_active_thread'
      and not r.lead_created
      and not r.conversation_created
      then 'PASS' else 'SUT_FAIL' end,
    format('expected=%s actual=%s state=%s lead_created=%s conversation_created=%s',
      v_conversation, r.conversation_id, r.thread_state, r.lead_created, r.conversation_created)
  );
exception when others then
  perform pg_temp._p9_wtr_record(1,'active conversation is reused','HARNESS_ERROR',sqlstate || ' ' || sqlerrm);
end;
$s$;

-- 2. humano_assumiu is reused
do $s$
declare
  c pg_temp._p9_wtr_ctx%rowtype;
  v_lead uuid := gen_random_uuid();
  v_conversation uuid := gen_random_uuid();
  v_phone text := '5598' || right('000000000000' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'), 12);
  r record;
begin
  select * into c from pg_temp._p9_wtr_ctx;
  insert into public.leads (id, organization_id, store_id, phone, name)
  values (v_lead, c.organization_id, c.store_id, v_phone, 'P9 WTR human reuse');
  insert into public.conversations (id, organization_id, lead_id, status, is_human_active)
  values (v_conversation, c.organization_id, v_lead, 'humano_assumiu', true);
  select * into r
  from public.resolve_whatsapp_inbound_thread_by_system(c.organization_id, c.store_id, v_phone, 'P9 WTR human reuse');
  perform pg_temp._p9_wtr_record(
    2,
    'humano_assumiu conversation is reused',
    case when r.conversation_id = v_conversation
      and r.lead_id = v_lead
      and r.thread_state = 'existing_active_thread'
      and not r.conversation_created
      then 'PASS' else 'SUT_FAIL' end,
    format('expected=%s actual=%s state=%s conversation_created=%s',
      v_conversation, r.conversation_id, r.thread_state, r.conversation_created)
  );
exception when others then
  perform pg_temp._p9_wtr_record(2,'humano_assumiu conversation is reused','HARNESS_ERROR',sqlstate || ' ' || sqlerrm);
end;
$s$;

-- 3. commercial stage is reused
do $s$
declare
  c pg_temp._p9_wtr_ctx%rowtype;
  v_lead uuid := gen_random_uuid();
  v_conversation uuid := gen_random_uuid();
  v_phone text := '5597' || right('000000000000' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'), 12);
  r record;
begin
  select * into c from pg_temp._p9_wtr_ctx;
  insert into public.leads (id, organization_id, store_id, phone, name)
  values (v_lead, c.organization_id, c.store_id, v_phone, 'P9 WTR commercial stage reuse');
  insert into public.conversations (id, organization_id, lead_id, status)
  values (v_conversation, c.organization_id, v_lead, 'orcamento');
  select * into r
  from public.resolve_whatsapp_inbound_thread_by_system(c.organization_id, c.store_id, v_phone, 'P9 WTR commercial stage reuse');
  perform pg_temp._p9_wtr_record(
    3,
    'commercial-stage conversation is reused',
    case when r.conversation_id = v_conversation
      and r.lead_id = v_lead
      and r.thread_state = 'existing_active_thread'
      and not r.conversation_created
      then 'PASS' else 'SUT_FAIL' end,
    format('expected=%s actual=%s state=%s conversation_created=%s',
      v_conversation, r.conversation_id, r.thread_state, r.conversation_created)
  );
exception when others then
  perform pg_temp._p9_wtr_record(3,'commercial-stage conversation is reused','HARNESS_ERROR',sqlstate || ' ' || sqlerrm);
end;
$s$;

-- 4. closed is not reused
do $s$
declare
  c pg_temp._p9_wtr_ctx%rowtype;
  v_lead uuid := gen_random_uuid();
  v_closed uuid := gen_random_uuid();
  v_phone text := '5596' || right('000000000000' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'), 12);
  r record;
begin
  select * into c from pg_temp._p9_wtr_ctx;
  insert into public.leads (id, organization_id, store_id, phone, name)
  values (v_lead, c.organization_id, c.store_id, v_phone, 'P9 WTR closed terminal');
  insert into public.conversations (id, organization_id, lead_id, status)
  values (v_closed, c.organization_id, v_lead, 'active');
  update public.conversations set status = 'closed' where id = v_closed;
  select * into r
  from public.resolve_whatsapp_inbound_thread_by_system(c.organization_id, c.store_id, v_phone, 'P9 WTR closed terminal');
  perform pg_temp._p9_wtr_record(
    4,
    'closed conversation is not reused',
    case when r.conversation_id <> v_closed
      and r.lead_id = v_lead
      and r.thread_state = 'created_active_thread'
      and r.conversation_created
      and exists (select 1 from public.conversations created_row where created_row.id = r.conversation_id and created_row.status = 'active')
      then 'PASS' else 'SUT_FAIL' end,
    format('closed=%s returned=%s state=%s conversation_created=%s',
      v_closed, r.conversation_id, r.thread_state, r.conversation_created)
  );
exception when others then
  perform pg_temp._p9_wtr_record(4,'closed conversation is not reused','HARNESS_ERROR',sqlstate || ' ' || sqlerrm);
end;
$s$;

-- 5. resolved is not reused
do $s$
declare
  c pg_temp._p9_wtr_ctx%rowtype;
  v_lead uuid := gen_random_uuid();
  v_resolved uuid := gen_random_uuid();
  v_phone text := '5595' || right('000000000000' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'), 12);
  r record;
begin
  select * into c from pg_temp._p9_wtr_ctx;
  insert into public.leads (id, organization_id, store_id, phone, name)
  values (v_lead, c.organization_id, c.store_id, v_phone, 'P9 WTR resolved terminal');
  insert into public.conversations (id, organization_id, lead_id, status)
  values (v_resolved, c.organization_id, v_lead, 'active');
  update public.conversations set status = 'resolved' where id = v_resolved;
  select * into r
  from public.resolve_whatsapp_inbound_thread_by_system(c.organization_id, c.store_id, v_phone, 'P9 WTR resolved terminal');
  perform pg_temp._p9_wtr_record(
    5,
    'resolved conversation is not reused',
    case when r.conversation_id <> v_resolved
      and r.lead_id = v_lead
      and r.thread_state = 'created_active_thread'
      and r.conversation_created
      and exists (select 1 from public.conversations created_row where created_row.id = r.conversation_id and created_row.status = 'active')
      then 'PASS' else 'SUT_FAIL' end,
    format('resolved=%s returned=%s state=%s conversation_created=%s',
      v_resolved, r.conversation_id, r.thread_state, r.conversation_created)
  );
exception when others then
  perform pg_temp._p9_wtr_record(5,'resolved conversation is not reused','HARNESS_ERROR',sqlstate || ' ' || sqlerrm);
end;
$s$;

-- 6. multiple non-terminal conversations fail closed
do $s$
declare
  c pg_temp._p9_wtr_ctx%rowtype;
  v_lead uuid := gen_random_uuid();
  v_phone text := '5594' || right('000000000000' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'), 12);
  v_ok boolean := false;
  v_detail text := null;
begin
  select * into c from pg_temp._p9_wtr_ctx;
  insert into public.leads (id, organization_id, store_id, phone, name)
  values (v_lead, c.organization_id, c.store_id, v_phone, 'P9 WTR ambiguity');
  insert into public.conversations (organization_id, lead_id, status)
  values
    (c.organization_id, v_lead, 'active'),
    (c.organization_id, v_lead, 'orcamento');
  begin
    perform *
    from public.resolve_whatsapp_inbound_thread_by_system(c.organization_id, c.store_id, v_phone, 'P9 WTR ambiguity');
    v_detail := 'resolver unexpectedly succeeded';
  exception when others then
    v_ok := sqlstate = 'P0001'
      and sqlerrm like '%whatsapp inbound reusable conversation is ambiguous%';
    v_detail := sqlstate || ' ' || sqlerrm;
  end;
  perform pg_temp._p9_wtr_record(
    6,
    'multiple non-terminal conversations fail closed',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    v_detail
  );
exception when others then
  perform pg_temp._p9_wtr_record(6,'multiple non-terminal conversations fail closed','HARNESS_ERROR',sqlstate || ' ' || sqlerrm);
end;
$s$;

-- 7. CRM ignores newer terminal conversation
do $s$
declare
  c pg_temp._p9_wtr_ctx%rowtype;
  v_lead uuid := gen_random_uuid();
  v_reusable uuid := gen_random_uuid();
  v_terminal uuid := gen_random_uuid();
  v_phone text := '5593' || right('000000000000' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'), 12);
  r record;
begin
  select * into c from pg_temp._p9_wtr_ctx;
  insert into public.leads (id, organization_id, store_id, phone, name)
  values (v_lead, c.organization_id, c.store_id, v_phone, 'P9 WTR CRM reader');
  insert into public.conversations (id, organization_id, lead_id, status, created_at)
  values (v_reusable, c.organization_id, v_lead, 'orcamento', clock_timestamp() + interval '10 minutes');
  insert into public.conversations (id, organization_id, lead_id, status, created_at)
  values (v_terminal, c.organization_id, v_lead, 'active', clock_timestamp() + interval '20 minutes');
  update public.conversations set status = 'closed' where id = v_terminal;
  select * into r
  from public.panel_list_crm_cards_scoped(c.organization_id, c.store_id, 500, 0)
  where lead_id = v_lead;
  perform pg_temp._p9_wtr_record(
    7,
    'CRM reader ignores newer terminal conversation',
    case when r.conversation_id = v_reusable and r.conversation_status = 'orcamento'
      then 'PASS' else 'SUT_FAIL' end,
    format('expected=%s actual=%s status=%s terminal=%s',
      v_reusable, r.conversation_id, r.conversation_status, v_terminal)
  );
exception when others then
  perform pg_temp._p9_wtr_record(7,'CRM reader ignores newer terminal conversation','HARNESS_ERROR',sqlstate || ' ' || sqlerrm);
end;
$s$;

-- 8. Inbox hides closed/resolved
do $s$
declare
  c pg_temp._p9_wtr_ctx%rowtype;
  v_lead_closed uuid := gen_random_uuid();
  v_lead_resolved uuid := gen_random_uuid();
  v_closed uuid := gen_random_uuid();
  v_resolved uuid := gen_random_uuid();
  v_phone_closed text := '5592' || right('000000000000' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'), 12);
  v_phone_resolved text := '5591' || right('000000000000' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'), 12);
  v_count bigint;
begin
  select * into c from pg_temp._p9_wtr_ctx;
  insert into public.leads (id, organization_id, store_id, phone, name)
  values
    (v_lead_closed, c.organization_id, c.store_id, v_phone_closed, 'P9 WTR inbox closed'),
    (v_lead_resolved, c.organization_id, c.store_id, v_phone_resolved, 'P9 WTR inbox resolved');
  insert into public.conversations (id, organization_id, lead_id, status)
  values
    (v_closed, c.organization_id, v_lead_closed, 'active'),
    (v_resolved, c.organization_id, v_lead_resolved, 'active');
  update public.conversations set status = 'closed' where id = v_closed;
  update public.conversations set status = 'resolved' where id = v_resolved;
  select count(*) into v_count
  from public.panel_list_inbox(c.organization_id, c.store_id, 500, 0) inbox_row
  where inbox_row.conversation_id in (v_closed, v_resolved);
  perform pg_temp._p9_wtr_record(
    8,
    'Inbox hides closed and resolved conversations',
    case when v_count = 0 then 'PASS' else 'SUT_FAIL' end,
    format('terminal_rows_returned=%s closed=%s resolved=%s', v_count, v_closed, v_resolved)
  );
exception when others then
  perform pg_temp._p9_wtr_record(8,'Inbox hides closed and resolved conversations','HARNESS_ERROR',sqlstate || ' ' || sqlerrm);
end;
$s$;

-- 9. SLA runtime hides closed/resolved
do $s$
declare
  c pg_temp._p9_wtr_ctx%rowtype;
  v_lead_closed uuid := gen_random_uuid();
  v_lead_resolved uuid := gen_random_uuid();
  v_closed uuid := gen_random_uuid();
  v_resolved uuid := gen_random_uuid();
  v_count bigint;
begin
  select * into c from pg_temp._p9_wtr_ctx;
  insert into public.leads (id, organization_id, store_id, phone, name)
  values
    (v_lead_closed, c.organization_id, c.store_id,
      '5589' || right('000000000000' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'), 12),
      'P9 WTR SLA closed'),
    (v_lead_resolved, c.organization_id, c.store_id,
      '5588' || right('000000000000' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'), 12),
      'P9 WTR SLA resolved');
  insert into public.conversations (id, organization_id, lead_id, status)
  values
    (v_closed, c.organization_id, v_lead_closed, 'active'),
    (v_resolved, c.organization_id, v_lead_resolved, 'active');
  update public.conversations set status = 'closed' where id = v_closed;
  update public.conversations set status = 'resolved' where id = v_resolved;
  select count(*) into v_count
  from public.conversations_sla_runtime sla
  where sla.conversation_id in (v_closed, v_resolved);
  perform pg_temp._p9_wtr_record(
    9,
    'SLA runtime hides closed and resolved conversations',
    case when v_count = 0 then 'PASS' else 'SUT_FAIL' end,
    format('terminal_rows_returned=%s closed=%s resolved=%s', v_count, v_closed, v_resolved)
  );
exception when others then
  perform pg_temp._p9_wtr_record(9,'SLA runtime hides closed and resolved conversations','HARNESS_ERROR',sqlstate || ' ' || sqlerrm);
end;
$s$;

-- 10. SLA runtime keeps non-terminal conversation
do $s$
declare
  c pg_temp._p9_wtr_ctx%rowtype;
  v_lead uuid := gen_random_uuid();
  v_conversation uuid := gen_random_uuid();
  v_count bigint;
begin
  select * into c from pg_temp._p9_wtr_ctx;
  insert into public.leads (id, organization_id, store_id, phone, name)
  values (
    v_lead,
    c.organization_id,
    c.store_id,
    '5587' || right('000000000000' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'), 12),
    'P9 WTR SLA nonterminal'
  );
  insert into public.conversations (id, organization_id, lead_id, status)
  values (v_conversation, c.organization_id, v_lead, 'orcamento');
  select count(*) into v_count
  from public.conversations_sla_runtime sla
  where sla.conversation_id = v_conversation
    and sla.current_state = 'orcamento';
  perform pg_temp._p9_wtr_record(
    10,
    'SLA runtime keeps non-terminal conversation',
    case when v_count = 1 then 'PASS' else 'SUT_FAIL' end,
    format('rows_returned=%s conversation=%s', v_count, v_conversation)
  );
exception when others then
  perform pg_temp._p9_wtr_record(10,'SLA runtime keeps non-terminal conversation','HARNESS_ERROR',sqlstate || ' ' || sqlerrm);
end;
$s$;

table pg_temp._p9_wtr_results
order by scenario_number;

select
  count(*) filter (where status = 'PASS') as passed,
  count(*) filter (where status = 'SUT_FAIL') as sut_failed,
  count(*) filter (where status = 'HARNESS_ERROR') as harness_errors,
  count(*) as total
from pg_temp._p9_wtr_results;

select count(*) as failed_scenarios
from pg_temp._p9_wtr_results
where status <> 'PASS';

rollback;

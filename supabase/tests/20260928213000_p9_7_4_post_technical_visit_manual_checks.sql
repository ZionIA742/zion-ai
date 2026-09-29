-- P9 / Bloco 7 / Etapa 7.4 fixture-backed rollback runner.

-- Execute only in an explicitly selected DEV database. It never commits.

begin;

create temp table p974_results (

  scenario text primary key,

  passed boolean not null,

  detail text not null

) on commit drop;

create temp table p974_context (organization_id uuid, store_id uuid) on commit drop;



do $runner$

declare

  v_run text := replace(gen_random_uuid()::text,'-','');

  v_org uuid := gen_random_uuid(); v_store uuid := gen_random_uuid();

  v_customer uuid := gen_random_uuid(); v_opportunity uuid := gen_random_uuid();

  v_responsible uuid := gen_random_uuid(); v_appointment uuid := gen_random_uuid();

  v_completed uuid := gen_random_uuid(); v_full uuid := gen_random_uuid(); v_needs uuid := gen_random_uuid();

  v_stale uuid := gen_random_uuid(); v_missing uuid := gen_random_uuid(); v_fallback uuid := gen_random_uuid(); v_second uuid := gen_random_uuid(); v_future uuid := gen_random_uuid();

  v_clock timestamptz; v_before timestamptz; v_end timestamptz; v_new_end timestamptz; v_last timestamptz;

  v_completed_end timestamptz; v_full_end timestamptz; v_needs_end timestamptz;

  v_missing_end timestamptz; v_fallback_end timestamptz; v_second_end timestamptz;

  v_claim jsonb; v_attempt uuid; v_notification uuid; v_count integer;

begin

  v_clock := clock_timestamp();

  v_end := v_clock - interval '11 minutes';

  v_before := v_end - interval '1 hour';

  -- Keep every later active fixture on the same weekday/time as the first
  -- appointment, but on a different week. This preserves operating-window /
  -- technical-visit-day compatibility while avoiding overlap and per-day
  -- capacity interaction from the 7.3 guards.

  v_completed_end := v_end - interval '7 days';

  v_full_end := v_end - interval '14 days';

  v_needs_end := v_end - interval '21 days';

  v_missing_end := v_end - interval '28 days';

  v_fallback_end := v_end - interval '35 days';

  v_second_end := v_end - interval '42 days';

  insert into p974_context values(v_org,v_store);

  insert into public.organizations(id,name) values(v_org,'P974 runner '||v_run);

  insert into public.stores(id,organization_id,name) values(v_store,v_org,'P974 store '||v_run);

  insert into public.customers(id,organization_id,display_name,normalized_name) values(v_customer,v_org,'P974 customer','p974 customer');

  insert into public.commercial_opportunities(id,organization_id,store_id,customer_id,stage) values(v_opportunity,v_org,v_store,v_customer,'negociacao');

  insert into public.store_responsibles(id,organization_id,store_id,name,whatsapp_number,role,is_primary,is_active)

    values(v_responsible,v_org,v_store,'P974 responsible','5511999999999','owner',true,true);

  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_appointment,v_org,v_store,'P974 technical','technical_visit','scheduled',v_before,v_end,'system',v_opportunity,1);



  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,v_end+interval '9 minutes') x;

  insert into p974_results values('01 before +10 no claim',v_claim is null or v_claim->>'attempt_id' is null,coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,v_end+interval '10 minutes') x;

  v_attempt := (v_claim->>'attempt_id')::uuid; v_notification := (v_claim->>'notification_id')::uuid;

  insert into p974_results values('02 +10 attempt 1',v_claim->>'attempt_number'='1',coalesce(v_claim::text,'empty'));

  update public.store_responsible_external_notifications set status='sent',external_message_id='P974-M1',sent_at=clock_timestamp() where id=v_notification;

  if not public.finalize_post_technical_visit_followup_attempt(v_org,v_store,v_attempt,'sent',v_notification,'P974-M1',null) then raise exception 'P974-02 finalize 1'; end if;

  select last_prompted_at into v_last from public.schedule_post_appointment_followups where appointment_id=v_appointment;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,v_last+interval '30 minutes') x;

  insert into p974_results values('03 +30 attempt 2',v_claim->>'attempt_number'='2',coalesce(v_claim::text,'empty'));

  v_attempt := (v_claim->>'attempt_id')::uuid; v_notification := (v_claim->>'notification_id')::uuid;

  update public.store_responsible_external_notifications set status='sent',external_message_id='P974-M2',sent_at=clock_timestamp() where id=v_notification;

  perform public.finalize_post_technical_visit_followup_attempt(v_org,v_store,v_attempt,'sent',v_notification,'P974-M2',null);

  select last_prompted_at into v_last from public.schedule_post_appointment_followups where appointment_id=v_appointment;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,v_last+interval '30 minutes') x;

  insert into p974_results values('04 +30 attempt 3',v_claim->>'attempt_number'='3',coalesce(v_claim::text,'empty'));

  v_attempt := (v_claim->>'attempt_id')::uuid; v_notification := (v_claim->>'notification_id')::uuid;

  update public.store_responsible_external_notifications set status='sent',external_message_id='P974-M3',sent_at=clock_timestamp() where id=v_notification;

  perform public.finalize_post_technical_visit_followup_attempt(v_org,v_store,v_attempt,'sent',v_notification,'P974-M3',null);

  select last_prompted_at into v_last

    from public.schedule_post_appointment_followups

   where appointment_id=v_appointment;



  select to_jsonb(x) into v_claim

    from public.claim_post_technical_visit_followup_attempt(

      v_org,

      v_store,

      v_last + interval '30 minutes'

    ) x;



  select count(*) into v_count

    from public.schedule_post_appointment_followup_attempts

   where organization_id=v_org

     and store_id=v_store

     and attempt_number=4;



  insert into p974_results

  values(

    '05 no attempt 4',

    (v_claim is null or v_claim->>'attempt_id' is null) and v_count=0,

    coalesce(v_claim::text,'empty') || ' / count=' || v_count::text

  );



  v_new_end := clock_timestamp() - interval '11 minutes';

  update public.store_appointments set status='rescheduled',scheduled_start=v_new_end-interval '1 hour',scheduled_end=v_new_end where id=v_appointment;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,v_new_end+interval '9 minutes') x;

  insert into p974_results values('06 rescheduled before current +10',v_claim is null or v_claim->>'attempt_id' is null,coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,v_new_end+interval '10 minutes') x;

  insert into p974_results values('07 rescheduled current anchor attempt 1',v_claim->>'attempt_number'='1',coalesce(v_claim::text,'empty'));

  v_attempt := (v_claim->>'attempt_id')::uuid; v_notification := (v_claim->>'notification_id')::uuid;

  update public.store_responsible_external_notifications set status='sent',external_message_id='P974-M4',sent_at=clock_timestamp() where id=v_notification;

  perform public.finalize_post_technical_visit_followup_attempt(v_org,v_store,v_attempt,'sent',v_notification,'P974-M4',null);

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-1','P974-M4','ok','{"media_ids":{"image":null}}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('08 exact context current response',v_claim->>'handled'='true' and v_claim->>'correlation_status'='correlated',coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-1','P974-M4','duplicate','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('09 duplicate inbound idempotent',v_claim->>'correlation_status'='duplicate',coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-2',null,'no context','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('10 resolved followup excluded from fallback',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));

  select count(*) into v_count from public.schedule_post_appointment_followup_attempts where organization_id=v_org and store_id=v_store and schedule_anchor=v_end;

  insert into p974_results values('11 old anchor retained as history',v_count=3,v_count::text);

  update public.store_appointments set status='cancelled' where id=v_appointment;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()+interval '2 days') x;

  insert into p974_results values('12 cancelled no claim',v_claim is null or v_claim->>'attempt_id' is null,coalesce(v_claim::text,'empty'));



  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_completed,v_org,v_store,'P974 no completion','technical_visit','completed',v_completed_end-interval '1 hour',v_completed_end,'system',v_opportunity,1);

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()+interval '2 days') x;

  insert into p974_results values('44 completed without canonical event fail closed',v_claim is null or v_claim->>'attempt_id' is null,coalesce(v_claim::text,'empty'));

  insert into p974_results values('45 response preserves media locator',exists(select 1 from public.schedule_post_appointment_followup_responses where organization_id=v_org and store_id=v_store and metadata ? 'media_ids'),'metadata');

  insert into p974_results values('46 response closes collection',exists(select 1 from public.schedule_post_appointment_followups where organization_id=v_org and store_id=v_store and resolution='responsible_replied_pending_7_5'),'resolution');



  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_full,v_org,v_store,'P974 fully completed','technical_visit','scheduled',v_full_end-interval '1 hour',v_full_end,'system',v_opportunity,1);

  perform set_config('request.jwt.claim.role','service_role',true);

  perform public.complete_store_appointment_with_outcome(v_full,v_org,v_store,'fully_completed','runner full');

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('47 fully_completed resolved no send',v_claim is null or v_claim->>'attempt_id' is null,'no claim');



  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_needs,v_org,v_store,'P974 needs followup','technical_visit','scheduled',v_needs_end-interval '1 hour',v_needs_end,'system',v_opportunity,1);

  perform public.complete_store_appointment_with_outcome(v_needs,v_org,v_store,'needs_followup','runner needs');

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('48 needs_followup remains eligible',v_claim->>'attempt_number'='1',coalesce(v_claim::text,'empty'));

  v_attempt := (v_claim->>'attempt_id')::uuid; v_notification := (v_claim->>'notification_id')::uuid;

  update public.store_responsible_external_notifications set status='failed',attempts=1,failed_at=clock_timestamp() where id=v_notification;

  perform public.finalize_post_technical_visit_followup_attempt(v_org,v_store,v_attempt,'failed',v_notification,null,'deterministic');

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('49 deterministic retry keeps business attempt',v_claim->>'attempt_id'=v_attempt::text and v_claim->>'attempt_number'='1',coalesce(v_claim::text,'empty'));

  update public.store_responsible_external_notifications set status='failed',attempts=3,failed_at=clock_timestamp() where id=v_notification;

  perform public.finalize_post_technical_visit_followup_attempt(v_org,v_store,v_attempt,'failed',v_notification,null,'exhausted');

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('50 exhausted transport retry creates no attempt 2',v_claim is null or v_claim->>'attempt_id' is null,coalesce(v_claim::text,'empty'));

  update public.schedule_post_appointment_followup_attempts set status='materialized' where id=v_attempt;

  update public.store_responsible_external_notifications set status='processing' where id=v_notification;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('51 processing worker is not failed',v_claim is null or v_claim->>'attempt_id' is null,coalesce(v_claim::text,'empty'));

  update public.schedule_post_appointment_followup_attempts set status='uncertain',uncertain_at=clock_timestamp() where id=v_attempt;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('52 uncertain freezes blind retry',v_claim is null or v_claim->>'attempt_id' is null,coalesce(v_claim::text,'empty'));



  update public.schedule_post_appointment_followup_attempts

     set status='failed',

         lifecycle_cycle=99,

         commercial_opportunity_id=v_opportunity

   where id=v_attempt;



  update public.store_responsible_external_notifications

     set status='failed',

         attempts=1,

         source_event_key=pg_catalog.regexp_replace(

           source_event_key,

           ':[^:]+$',

           ':99'

         )

   where id=v_notification;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('53 stale lifecycle same anchor is not rearmed',v_claim->>'attempt_id' is distinct from v_attempt::text and v_claim->>'attempt_number'='1',coalesce(v_claim::text,'empty'));
  -- Scenario 53 is finished. Remove its legitimate open obligation so
  -- scenarios 54/55 isolate the completed-without-canonical-event case.
  update public.schedule_post_appointment_followups
     set resolved_at=clock_timestamp(),
         resolution='fixture_cleanup',
         followup_status='resolved',
         updated_at=clock_timestamp()
   where appointment_id=v_needs
     and resolved_at is null;

  update public.schedule_post_appointment_followup_attempts
     set status='cancelled',
         updated_at=clock_timestamp()
   where organization_id=v_org
     and store_id=v_store
     and appointment_id=v_needs
     and status in ('reserved','materialized','failed');

  update public.store_responsible_external_notifications
     set status='cancelled',
         processed_at=clock_timestamp(),
         locked_at=null,
         locked_by=null,
         updated_at=clock_timestamp()
   where organization_id=v_org
     and store_id=v_store
     and related_appointment_id=v_needs
     and status in ('ready_to_send','materialized','processing','failed');



  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-C1','P974-M1','completed no event','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('54 completed without event context unmatched',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-C2',null,'completed no event','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('55 completed without event fallback unmatched',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));



  update public.store_responsibles set is_active=false where id=v_responsible;

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-P0',null,'no primary','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('56 zero primary fail closed',v_claim->>'correlation_status'='responsible_primary_invalid',coalesce(v_claim::text,'empty'));

  update public.store_responsibles set is_active=true,whatsapp_number='5511999999999' where id=v_responsible;

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,gen_random_uuid(),'P974-IN-PX',null,'wrong primary','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('57 responsible different from primary fail closed',v_claim->>'correlation_status'='responsible_primary_invalid',coalesce(v_claim::text,'empty'));



  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_missing,v_org,v_store,'P974 invalid destination','technical_visit','scheduled',v_missing_end-interval '1 hour',v_missing_end,'system',v_opportunity,1);

  update public.store_responsibles set whatsapp_number='invalid' where id=v_responsible;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('58 invalid destination no materialization',not exists(select 1 from public.store_responsible_external_notifications where related_appointment_id=v_missing),'no notification');

  update public.store_responsibles set whatsapp_number='5511999999999' where id=v_responsible;

  update public.schedule_post_appointment_followups set resolved_at=clock_timestamp(),resolution='fixture_cleanup' where appointment_id=v_missing;

  update public.store_appointments set status='cancelled' where id=v_missing;



  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_fallback,v_org,v_store,'P974 fallback','technical_visit','scheduled',v_fallback_end-interval '1 hour',v_fallback_end,'system',v_opportunity,1);

  insert into public.schedule_post_appointment_followups(organization_id,store_id,appointment_id,scheduled_end,followup_status,preferred_channel,prompt_count)

    values(v_org,v_store,v_fallback,v_fallback_end,'pending_confirmation','unknown',0);

  update public.schedule_post_appointment_followups set resolved_at=clock_timestamp(),resolution='fixture_cleanup' where appointment_id=v_needs;

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-F1',null,'fallback one','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('59 fallback exactly one correlates',v_claim->>'handled'='true' and v_claim->>'correlation_status'='correlated',coalesce(v_claim::text,'empty'));

  update public.schedule_post_appointment_followups set resolved_at=clock_timestamp(),resolution='fixture_cleanup' where appointment_id=v_fallback;

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-F0',null,'fallback zero','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('60 fallback zero unmatched',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));

  update public.schedule_post_appointment_followups set resolved_at=null,resolution=null,followup_status='pending_confirmation' where appointment_id=v_fallback;

  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_second,v_org,v_store,'P974 fallback second','technical_visit','scheduled',v_second_end-interval '1 hour',v_second_end,'system',v_opportunity,1);

  insert into public.schedule_post_appointment_followups(organization_id,store_id,appointment_id,scheduled_end,followup_status,preferred_channel,prompt_count)

    values(v_org,v_store,v_second,v_second_end,'pending_confirmation','unknown',0);

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-FM',null,'fallback multiple','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('61 fallback multiple ambiguous',v_claim->>'handled'='false' and v_claim->>'correlation_status'='ambiguous_or_unmatched',coalesce(v_claim::text,'empty'));

  update public.schedule_post_appointment_followups set resolved_at=clock_timestamp(),resolution='fixture_cleanup' where appointment_id in (v_fallback,v_second);

  update public.store_appointments set status='cancelled' where id in (v_fallback,v_second);

  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_future,v_org,v_store,'P974 fallback future','technical_visit','scheduled',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours','system',v_opportunity,1);

  insert into public.schedule_post_appointment_followups(organization_id,store_id,appointment_id,scheduled_end,followup_status,preferred_channel,prompt_count)

    values(v_org,v_store,v_future,clock_timestamp()+interval '2 hours','pending_confirmation','unknown',0);

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-FT',null,'fallback future','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('62 fallback before due unmatched',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(gen_random_uuid(),v_store,v_responsible,'P974-IN-XT','P974-M4','cross tenant','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('63 context cross tenant unmatched',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,gen_random_uuid(),v_responsible,'P974-IN-XS','P974-M4','cross store','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('64 context cross store unmatched',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,gen_random_uuid(),'P974-IN-XR','P974-M4','other responsible','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('65 context other responsible unmatched',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));

end

$runner$;



insert into p974_results values

 ('13 RLS external',(select relrowsecurity from pg_class where oid='public.store_responsible_external_notifications'::regclass),'RLS'),

 ('14 RLS attempts',(select relrowsecurity from pg_class where oid='public.schedule_post_appointment_followup_attempts'::regclass),'RLS'),

 ('15 RLS responses',(select relrowsecurity from pg_class where oid='public.schedule_post_appointment_followup_responses'::regclass),'RLS'),

 ('16 anon no external select',not has_table_privilege('anon','public.store_responsible_external_notifications','SELECT'),'ACL'),

 ('17 authenticated no external insert',not has_table_privilege('authenticated','public.store_responsible_external_notifications','INSERT'),'ACL'),

 ('18 anon no attempts update',not has_table_privilege('anon','public.schedule_post_appointment_followup_attempts','UPDATE'),'ACL'),

 ('19 authenticated no responses delete',not has_table_privilege('authenticated','public.schedule_post_appointment_followup_responses','DELETE'),'ACL'),

 ('20 service role claim execute',has_function_privilege('service_role','public.claim_post_technical_visit_followup_attempt(uuid,uuid,timestamptz)','EXECUTE'),'RPC ACL'),

 ('21 anon claim denied',not has_function_privilege('anon','public.claim_post_technical_visit_followup_attempt(uuid,uuid,timestamptz)','EXECUTE'),'RPC ACL'),

 ('22 authenticated finalize denied',not has_function_privilege('authenticated','public.finalize_post_technical_visit_followup_attempt(uuid,uuid,uuid,text,uuid,text,text)','EXECUTE'),'RPC ACL'),

 ('23 public response denied',not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.record_post_technical_visit_followup_response(uuid,uuid,uuid,text,text,text,jsonb,timestamptz)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'RPC ACL'),

 ('24 service role no external delete',not has_table_privilege('service_role','public.store_responsible_external_notifications','DELETE'),'minimum grant'),

 ('25 service role no attempts delete',not has_table_privilege('service_role','public.schedule_post_appointment_followup_attempts','DELETE'),'minimum grant'),

 ('26 service role no responses delete',not has_table_privilege('service_role','public.schedule_post_appointment_followup_responses','DELETE'),'minimum grant'),

 ('27 public no external ACL',not exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='public.store_responsible_external_notifications'::regclass and a.grantee=0),'ACL'),

 ('28 public no attempts ACL',not exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='public.schedule_post_appointment_followup_attempts'::regclass and a.grantee=0),'ACL'),

 ('29 public no responses ACL',not exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='public.schedule_post_appointment_followup_responses'::regclass and a.grantee=0),'ACL'),

 ('30 anon no external update',not has_table_privilege('anon','public.store_responsible_external_notifications','UPDATE'),'ACL'),

 ('31 authenticated no external delete',not has_table_privilege('authenticated','public.store_responsible_external_notifications','DELETE'),'ACL'),

 ('32 attempt numbers bounded',not exists(select 1 from public.schedule_post_appointment_followup_attempts where attempt_number not between 1 and 3),'constraint'),

 ('33 response metadata object',not exists(select 1 from public.schedule_post_appointment_followup_responses where jsonb_typeof(metadata)<>'object'),'constraint'),

 ('34 no quote or contract notification',not exists(select 1 from public.store_responsible_external_notifications n join p974_context c on c.organization_id=n.organization_id and c.store_id=n.store_id where n.notification_type in ('quote','contract')),'contract boundary');



do $assert$

declare r record;

begin

  for r in select * from p974_results loop

    if not r.passed then raise exception 'P974-FAIL [%] %',r.scenario,r.detail; end if;

  end loop;

end

$assert$;



select * from p974_results order by scenario;

rollback;



-- P974-MANUAL-CONCURRENCY (not asserted by this single-connection runner):

-- execute two concurrent service_role calls to claim_post_technical_visit_followup_attempt

-- for the same organization/store and assert one business attempt and one

-- notification. Transactional row locks/unique indexes are the production

-- protection; this script intentionally does not pretend to prove simultaneity.
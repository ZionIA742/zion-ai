-- P9 B10 5.3-I.6 functional homologation.
-- Run only after the definitive migration in an explicitly disposable session.
-- This artifact contains no COMMIT. Every fixture mutation and authority call
-- is rolled back by the final ROLLBACK.
begin;
set local lock_timeout='4s';
set local statement_timeout='60s';

do $preflight$
begin
  if to_regprocedure('public.p9_10_4_d_assert_recovery_set_claim_authority(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)') is null
     or to_regprocedure('public.release_ai_run_queue_recovery_claim_by_system(uuid,uuid,uuid,uuid)') is null
     or to_regprocedure('public.p9_10_4_d_recovery_enqueue_enabled()') is null
     or to_regprocedure('public.p9_10_4_d_transition_recovery_stage_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text)') is null
     or to_regprocedure('public.p9_10_4_d_write_recovery_window_state_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)') is null then
    raise exception 'P9_10_4_D_HOMOLOGATION_AUTHORITY_MISSING';
  end if;
  if not exists (select 1 from public.zion_p9_recovery_activation where singleton and not automatic_enqueue_enabled and not compatible_consumers_deployed) then
    raise exception 'P9_10_4_D_DEFAULT_ACTIVATION_NOT_DISABLED';
  end if;
  if position('sales_ai_post_materialization_recovery' in pg_get_functiondef('public.process_next_ai_run_queue(uuid)'::regprocedure))=0
     or position('P9_10_4_D_RECOVERY_ENQUEUE_FORBIDDEN' in pg_get_functiondef('public.enqueue_ai_run(uuid,uuid,uuid,uuid,jsonb)'::regprocedure))=0 then
    raise exception 'P9_10_4_D_LEGACY_RECOVERY_FENCE_NOT_INSTALLED';
  end if;
  if position('P9_10_4_D_RECOVERY_CLAIM_CANNOT_MATERIALIZE' in pg_get_functiondef('public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure))=0 then
    raise exception 'P9_10_4_D_WORKER_RECOVERY_FENCE_NOT_INSTALLED';
  end if;
end;
$preflight$;

-- Isolated synthetic fixture. Every row is disposable and linked through real
-- foreign keys; no production customer or recovery queue row is selected.
create temporary table p9_recovery_fixture on commit drop as
select gen_random_uuid() queue_id,gen_random_uuid() organization_id,gen_random_uuid() store_id,
       gen_random_uuid() customer_id,gen_random_uuid() lead_id,gen_random_uuid() conversation_id,
       gen_random_uuid() opportunity_id,gen_random_uuid() anchor_message_id,
       gen_random_uuid() text_message_id,gen_random_uuid() response_set_id,gen_random_uuid() claim_token;

do $fixture_setup$
declare f record;
begin
  select * into strict f from p9_recovery_fixture;
  insert into public.stores(id,organization_id,name) values(f.store_id,f.organization_id,'P9 recovery homologation store');
  insert into public.customers(id,organization_id,display_name) values(f.customer_id,f.organization_id,'P9 recovery homologation customer');
  insert into public.leads(id,organization_id,store_id,name,phone,state,created_at,updated_at)
    values(f.lead_id,f.organization_id,f.store_id,'P9 recovery homologation lead','+5500000000000','novo_lead',clock_timestamp(),clock_timestamp());
  insert into public.conversations(id,organization_id,lead_id,status,is_human_active,created_at)
    values(f.conversation_id,f.organization_id,f.lead_id,'novo_lead',false,clock_timestamp());
  insert into public.commercial_opportunities(id,organization_id,store_id,customer_id,origin_lead_id,primary_conversation_id,stage)
    values(f.opportunity_id,f.organization_id,f.store_id,f.customer_id,f.lead_id,f.conversation_id,'qualificacao');
  insert into public.messages(id,organization_id,store_id,lead_id,conversation_id,sender,direction,message_type,content,metadata,created_at,deleted_at)
    values(f.anchor_message_id,f.organization_id,f.store_id,f.lead_id,f.conversation_id,'user','incoming','text','synthetic recovery anchor','{}'::jsonb,clock_timestamp(),null);
  insert into public.messages(id,organization_id,store_id,lead_id,conversation_id,sender,direction,message_type,content,metadata,created_at,deleted_at)
    values(f.text_message_id,f.organization_id,f.store_id,f.lead_id,f.conversation_id,'ai','outgoing','text','synthetic confirmed reply','{}'::jsonb,clock_timestamp(),null);
  insert into public.p19a_sales_ai_reply_sets(id,organization_id,store_id,conversation_id,anchor_message_id,commercial_opportunity_id,request_fingerprint,payload,materialization_state,confirmed_at,text_message_id)
    values(f.response_set_id,f.organization_id,f.store_id,f.conversation_id,f.anchor_message_id,f.opportunity_id,repeat('a',64),jsonb_build_object('organization_id',f.organization_id,'store_id',f.store_id,'conversation_id',f.conversation_id,'lead_id',f.lead_id,'anchor_message_id',f.anchor_message_id), 'confirmed',clock_timestamp(),f.text_message_id);
  insert into public.ai_run_queue(id,organization_id,store_id,conversation_id,lead_id,queue_key,input,enqueued_at,processed_at,claim_token,claim_expires_at,claimed_by)
    values(f.queue_id,f.organization_id,f.store_id,f.conversation_id,f.lead_id,'p9-homologation-recovery-'||f.queue_id::text,jsonb_build_object('type','sales_ai_post_materialization_recovery','responseSetId',f.response_set_id,'anchorMessageId',f.anchor_message_id),clock_timestamp(),null,f.claim_token,clock_timestamp()+interval '10 minutes','p9-homologation');
end;
$fixture_setup$;

do $positive$
declare f record;
begin
  select * into f from p9_recovery_fixture limit 1;
  perform public.p9_10_4_d_assert_recovery_set_claim_authority(
    f.response_set_id::uuid,f.queue_id,f.claim_token,f.organization_id,f.store_id,
    f.conversation_id,f.anchor_message_id::uuid,f.lead_id,null
  );
end;
$positive$;

do $negative$
declare f record; m text; c text; raised boolean;
begin
  select * into f from p9_recovery_fixture limit 1;
  raised:=false;
  begin
    perform public.p9_10_4_d_assert_recovery_set_claim_authority(f.response_set_id::uuid,f.queue_id,f.claim_token,
      '00000000-0000-0000-0000-000000000001'::uuid,f.store_id,f.conversation_id,f.anchor_message_id::uuid,f.lead_id,null);
    raise exception 'P9_10_4_D_CROSS_TENANT_ACCEPTED';
  exception when others then get stacked diagnostics c=returned_sqlstate,m=message_text; raised:=true; if c<>'42501' or m<>'P9_10_4_D_RECOVERY_SCOPE_MISMATCH' then raise; end if; end;
  if not raised then raise exception 'P9_10_4_D_CROSS_TENANT_ACCEPTED'; end if;
  raised:=false;
  begin
    perform public.p9_10_4_d_assert_recovery_set_claim_authority(f.response_set_id::uuid,f.queue_id,f.claim_token,f.organization_id,f.store_id,
      f.conversation_id,'00000000-0000-0000-0000-000000000002'::uuid,f.lead_id,null);
    raise exception 'P9_10_4_D_STALE_ANCHOR_ACCEPTED';
  exception when others then get stacked diagnostics c=returned_sqlstate,m=message_text; raised:=true; if c<>'42501' or m<>'P9_10_4_D_RECOVERY_ANCHOR_STALE_OR_DELETED' then raise; end if; end;
  if not raised then raise exception 'P9_10_4_D_STALE_ANCHOR_ACCEPTED'; end if;
  raised:=false;
  begin
    perform public.p9_10_4_d_assert_recovery_set_claim_authority(f.response_set_id::uuid,f.queue_id,
      '00000000-0000-0000-0000-000000000003'::uuid,f.organization_id,f.store_id,f.conversation_id,f.anchor_message_id::uuid,f.lead_id,null);
    raise exception 'P9_10_4_D_UNKNOWN_CLAIM_ACCEPTED';
  exception when others then get stacked diagnostics c=returned_sqlstate,m=message_text; raised:=true; if c<>'42501' or m<>'P9_10_4_D_RECOVERY_QUEUE_SCOPE_OR_TOKEN_MISMATCH' then raise; end if; end;
  if not raised then raise exception 'P9_10_4_D_UNKNOWN_CLAIM_ACCEPTED'; end if;
  raised:=false;
  begin
    update public.ai_run_queue set claim_expires_at=clock_timestamp()-interval '1 second'
      where id=f.queue_id and organization_id=f.organization_id and store_id=f.store_id;
    perform public.p9_10_4_d_assert_recovery_set_claim_authority(f.response_set_id::uuid,f.queue_id,f.claim_token,
      f.organization_id,f.store_id,f.conversation_id,f.anchor_message_id::uuid,f.lead_id,null);
    raise exception 'P9_10_4_D_EXPIRED_CLAIM_ACCEPTED';
  exception when others then get stacked diagnostics c=returned_sqlstate,m=message_text; raised:=true; if c<>'P0001' or m<>'P9_10_4_D_RECOVERY_CLAIM_EXPIRED' then raise; end if; end;
  if not raised then raise exception 'P9_10_4_D_EXPIRED_CLAIM_ACCEPTED'; end if;
  raised:=false;
  begin
    perform public.enqueue_ai_run(f.organization_id,f.store_id,f.conversation_id,f.lead_id,
      jsonb_build_object('type','sales_ai_post_materialization_recovery'));
    raise exception 'P9_10_4_D_LEGACY_ENQUEUE_ACCEPTED_RECOVERY';
  exception when others then get stacked diagnostics c=returned_sqlstate,m=message_text; raised:=true; if c<>'42501' or m<>'P9_10_4_D_RECOVERY_ENQUEUE_FORBIDDEN' then raise; end if; end;
  if not raised then raise exception 'P9_10_4_D_LEGACY_ENQUEUE_ACCEPTED_RECOVERY'; end if;
end;
$negative$;

savepoint p9_human_deferral;
do $human$
declare f record; r record; c text; m text;
begin
  select * into f from p9_recovery_fixture limit 1;
  update public.conversations set is_human_active=true where id=f.conversation_id;
  select * into r from public.release_ai_run_queue_recovery_claim_by_system(f.organization_id,f.store_id,f.queue_id,f.claim_token);
  if r.ok is distinct from true then raise exception 'P9_10_4_D_HUMAN_DEFERRAL_NOT_RELEASED'; end if;
  begin
    perform public.release_ai_run_queue_recovery_claim_by_system(f.organization_id,f.store_id,f.queue_id,f.claim_token);
    raise exception 'P9_10_4_D_REPEATED_HUMAN_DEFERRAL_REFUNDED';
  exception when others then
    get stacked diagnostics c=returned_sqlstate,m=message_text;
    if c<>'42501' or m<>'P9_10_4_D_RECOVERY_CLAIM_NOT_LIVE' then raise; end if;
  end;
end;
$human$;
rollback to savepoint p9_human_deferral;

-- Legacy SQL processor signatures are reported by the read-only diagnostic and
-- must be confirmed before installing the definitive migration.
rollback;

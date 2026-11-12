drop table if exists pg_temp.p19a_manual_attachment_check_keys;
create temp table p19a_manual_attachment_check_keys (idempotency_key text) on commit preserve rows;
insert into pg_temp.p19a_manual_attachment_check_keys (idempotency_key)
values ('manual-check:' || gen_random_uuid()::text);

begin;

do $$
declare
  v_org uuid;
  v_store uuid;
  v_conversation uuid;
  v_lead uuid;
  v_other_store uuid;
  v_other_org uuid;
  v_other_lead uuid;
  v_key text;
  v_path text;
  v_fp text := 'manual-check-fingerprint';
  v_first record;
  v_second record;
  v_count integer;
begin
  select idempotency_key into v_key
  from pg_temp.p19a_manual_attachment_check_keys
  limit 1;
  if v_key is null then raise exception 'manual check precondition: persistent test key missing'; end if;

  select c.organization_id, l.store_id, c.id, c.lead_id
    into v_org, v_store, v_conversation, v_lead
  from public.conversations c
  join public.leads l on l.id = c.lead_id and l.organization_id = c.organization_id
  where c.organization_id is not null and l.store_id is not null
  order by c.id
  limit 1;
  if v_org is null then raise exception 'manual check precondition: no scoped conversation fixture'; end if;

  select l.store_id into v_other_store
  from public.leads l
  where l.organization_id = v_org and l.store_id is not null and l.store_id <> v_store
  order by l.store_id
  limit 1;
  if v_other_store is null then raise exception 'manual check precondition: no second store fixture in organization'; end if;

  select c.organization_id into v_other_org
  from public.conversations c
  where c.organization_id is not null and c.organization_id <> v_org
  order by c.organization_id
  limit 1;
  if v_other_org is null then raise exception 'manual check precondition: no second organization fixture'; end if;

  select l.id into v_other_lead
  from public.leads l
  where l.id <> v_lead and l.organization_id is not null
  order by l.id
  limit 1;
  if v_other_lead is null then raise exception 'manual check precondition: no incompatible lead fixture'; end if;

  v_path := v_org::text || '/' || v_store::text || '/manual-attachments/' || v_conversation::text || '/manual-check.pdf';

  select * into v_first from public.finalize_manual_attachment_message(
    v_org, v_store, v_conversation, v_lead, 'document', 'manual check', v_path,
    jsonb_build_object('storage_bucket','zion-store-files','storage_path',v_path,'outbound_idempotency_key',v_key,'manual_attachment_payload_fingerprint',v_fp,'attachment_kind','document','mime_type','application/pdf','size_bytes',12,'send_external',false), v_key, v_fp);
  if v_first.replayed is distinct from false then raise exception 'first finalize was not new'; end if;
  raise notice 'PASS original scope materializes';

  select * into v_second from public.finalize_manual_attachment_message(
    v_org, v_store, v_conversation, v_lead, 'document', 'manual check', v_path,
    jsonb_build_object('storage_bucket','zion-store-files','storage_path',v_path,'outbound_idempotency_key',v_key,'manual_attachment_payload_fingerprint',v_fp,'attachment_kind','document','mime_type','application/pdf','size_bytes',12,'send_external',false), v_key, v_fp);
  if v_second.replayed is distinct from true or v_second.message_id <> v_first.message_id then raise exception 'replay did not return the winner'; end if;
  raise notice 'PASS same key replay returns winner';

  select count(*) into v_count from public.messages where organization_id = v_org and store_id = v_store and outbound_idempotency_key = v_key;
  if v_count <> 1 then raise exception 'expected exactly one test message before rollback, got %', v_count; end if;
  raise notice 'PASS exact expected message count before rollback = 1';

  begin
    perform public.finalize_manual_attachment_message(
      v_org, v_other_store, v_conversation, v_lead, 'document', 'manual check', v_path,
      jsonb_build_object('storage_bucket','zion-store-files','storage_path',v_path,'outbound_idempotency_key',v_key,'manual_attachment_payload_fingerprint',v_fp,'attachment_kind','document','mime_type','application/pdf','size_bytes',12,'send_external',false), v_key, v_fp);
    raise exception 'different store was accepted';
  exception when sqlstate '42501' then raise notice 'PASS different store rejected'; end;

  begin
    perform public.finalize_manual_attachment_message(
      v_other_org, v_store, v_conversation, v_lead, 'document', 'manual check', v_path,
      jsonb_build_object('storage_bucket','zion-store-files','storage_path',v_path,'outbound_idempotency_key',v_key,'manual_attachment_payload_fingerprint',v_fp,'attachment_kind','document','mime_type','application/pdf','size_bytes',12,'send_external',false), v_key, v_fp);
    raise exception 'different organization was accepted';
  exception when sqlstate '42501' then raise notice 'PASS incompatible organization rejected'; end;

  begin
    perform public.finalize_manual_attachment_message(
      v_org, v_store, v_conversation, v_other_lead, 'document', 'manual check', v_path,
      jsonb_build_object('storage_bucket','zion-store-files','storage_path',v_path,'outbound_idempotency_key',v_key,'manual_attachment_payload_fingerprint',v_fp,'attachment_kind','document','mime_type','application/pdf','size_bytes',12,'send_external',false), v_key, v_fp);
    raise exception 'incompatible conversation/lead was accepted';
  exception when sqlstate '42501' then raise notice 'PASS incompatible conversation/lead rejected'; end;

  begin
    perform public.finalize_manual_attachment_message(
      v_org, v_store, v_conversation, v_lead, 'document', 'different payload', v_path || '-different',
      jsonb_build_object('storage_bucket','zion-store-files','storage_path',v_path || '-different','outbound_idempotency_key',v_key,'manual_attachment_payload_fingerprint','different','attachment_kind','document','mime_type','application/pdf','size_bytes',12,'send_external',false), v_key, 'different');
    raise exception 'same key was reused with another payload';
  exception when sqlstate '23514' then raise notice 'PASS same key/payload conflict rejected'; end;

  raise notice 'PASS structural concurrency protection: unique (organization_id, store_id, outbound_idempotency_key) plus same-INSERT ON CONFLICT';
end $$;

rollback;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.messages m
  join pg_temp.p19a_manual_attachment_check_keys k on k.idempotency_key = m.outbound_idempotency_key;
  if v_count <> 0 then raise exception 'rollback left test rows: %', v_count; end if;
  raise notice 'PASS no test rows remain after rollback';
end $$;

drop table pg_temp.p19a_manual_attachment_check_keys;

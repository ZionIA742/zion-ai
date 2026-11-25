-- MICROETAPA 10.8-D
-- Diagnostico somente leitura para o Supabase original.
-- Cada bloco retorna tabela visivel no SQL Editor. Nao cria fixtures nem altera dados.

select
  'p10_8_d_objects'::text as diagnostic,
  object_name,
  object_kind,
  present,
  expected_signature
from (values
  ('public.messages', 'table', to_regclass('public.messages') is not null, 'messages com metadata jsonb'),
  ('mark_audio_retention_eligible_by_system', 'function', to_regprocedure('public.mark_audio_retention_eligible_by_system(uuid,uuid,uuid,uuid,text,timestamptz)') is not null, 'atomic set-if-absent'),
  ('claim_audio_retention_deletion_by_system', 'function', to_regprocedure('public.claim_audio_retention_deletion_by_system(uuid,uuid,uuid,uuid,timestamptz)') is not null, 'atomic claim scoped'),
  ('finish_audio_retention_deletion_by_system', 'function', to_regprocedure('public.finish_audio_retention_deletion_by_system(uuid,uuid,uuid,uuid,text,text,timestamptz)') is not null, 'persistent deleted/failed outcome'),
  ('storage.zion-store-files', 'bucket', exists (select 1 from storage.buckets where id = 'zion-store-files'), 'private original-media bucket')
) as objects(object_name, object_kind, present, expected_signature)
order by object_kind, object_name;

select
  'p10_8_d_function_security'::text as diagnostic,
  p.oid::regprocedure as function_signature,
  r.rolname as owner,
  p.prosecdef as security_definer,
  pg_get_userbyid(p.proowner) as owner_name,
  coalesce(pg_catalog.array_to_string(p.proconfig, '; '), '') as function_config,
  pg_catalog.array_to_string(p.proacl, ', ') as acl_text
from pg_catalog.pg_proc p
join pg_catalog.pg_roles r on r.oid = p.proowner
where p.oid in (
  to_regprocedure('public.mark_audio_retention_eligible_by_system(uuid,uuid,uuid,uuid,text,timestamptz)'),
  to_regprocedure('public.claim_audio_retention_deletion_by_system(uuid,uuid,uuid,uuid,timestamptz)'),
  to_regprocedure('public.finish_audio_retention_deletion_by_system(uuid,uuid,uuid,uuid,text,text,timestamptz)')
)
order by function_signature;

select
  'p10_8_d_definition_hashes'::text as diagnostic,
  p.oid::regprocedure as function_signature,
  md5(pg_get_functiondef(p.oid)) as definition_md5,
  length(pg_get_functiondef(p.oid)) as definition_length
from pg_catalog.pg_proc p
where p.oid in (
  to_regprocedure('public.mark_audio_retention_eligible_by_system(uuid,uuid,uuid,uuid,text,timestamptz)'),
  to_regprocedure('public.claim_audio_retention_deletion_by_system(uuid,uuid,uuid,uuid,timestamptz)'),
  to_regprocedure('public.finish_audio_retention_deletion_by_system(uuid,uuid,uuid,uuid,text,text,timestamptz)')
)
order by function_signature;

select
  'p10_8_d_existing_audio_inventory'::text as diagnostic,
  m.organization_id,
  m.store_id,
  count(*)::bigint as eligible_marked_rows,
  count(*) filter (where m.metadata->>'audio_retention_deletion_status' = 'claimed')::bigint as claimed_rows,
  count(*) filter (where m.metadata->>'audio_retention_deletion_status' = 'failed')::bigint as failed_rows,
  count(*) filter (where m.metadata->>'audio_retention_deletion_status' = 'deleted')::bigint as deleted_rows,
  count(*) filter (where m.metadata->>'audio_retention_eligible_at' is not null and not pg_catalog.pg_input_is_valid(m.metadata->>'audio_retention_eligible_at', 'timestamptz'))::bigint as invalid_marker_rows
from public.messages m
where m.message_type = 'audio'
  and m.sender in ('user', 'human')
  and m.deleted_at is null
  and m.metadata->>'attachment_kind' = 'audio'
  and m.metadata->>'media_origin' in ('customer', 'human')
group by m.organization_id, m.store_id
order by m.organization_id, m.store_id;

select
  'p10_8_d_timestamp_input_compatibility'::text as diagnostic,
  input_value,
  pg_catalog.pg_input_is_valid(input_value, 'timestamptz') as is_valid
from (values
  ('2026-11-24T12:00:00.000Z'::text),
  ('invalid-timestamp'::text),
  (null::text),
  (''::text)
) as inputs(input_value)
order by input_value nulls last;

select
  'p10_8_d_scope_and_exclusions'::text as diagnostic,
  count(*) filter (where m.message_type = 'audio' and m.metadata->>'media_origin' in ('customer', 'human'))::bigint as commercial_audio_rows,
  count(*) filter (where m.message_type <> 'audio' or m.metadata->>'media_origin' not in ('customer', 'human'))::bigint as excluded_message_rows,
  count(*) filter (where m.message_type = 'audio' and m.metadata->>'storage_bucket' <> 'zion-store-files')::bigint as wrong_bucket_rows,
  count(*) filter (where m.message_type = 'audio' and m.metadata->>'storage_path' not like (m.organization_id::text || '/' || m.store_id::text || '/whatsapp-inbound/%'))::bigint as wrong_path_rows
from public.messages m
where m.deleted_at is null;

select
  'p10_8_d_grants'::text as diagnostic,
  p.oid::regprocedure as function_signature,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('public', p.oid, 'EXECUTE') as public_execute
from pg_catalog.pg_proc p
where p.oid in (
  to_regprocedure('public.mark_audio_retention_eligible_by_system(uuid,uuid,uuid,uuid,text,timestamptz)'),
  to_regprocedure('public.claim_audio_retention_deletion_by_system(uuid,uuid,uuid,uuid,timestamptz)'),
  to_regprocedure('public.finish_audio_retention_deletion_by_system(uuid,uuid,uuid,uuid,text,text,timestamptz)')
)
order by function_signature;

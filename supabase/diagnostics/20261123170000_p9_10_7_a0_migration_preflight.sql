-- P9 / 10.7-A0
-- Somente leitura. Execute como uma unica consulta no Supabase original.
-- Nao chama writers, nao insere dados e nao executa migration.
with
base_checks as (
  select * from (values
    ('public.conversations', to_regclass('public.conversations') is not null),
    ('public.stores', to_regclass('public.stores') is not null),
    ('public.memberships', to_regclass('public.memberships') is not null),
    ('public.messages', to_regclass('public.messages') is not null),
    ('public.conversation_sessions', to_regclass('public.conversation_sessions') is not null),
    ('auth.users', to_regclass('auth.users') is not null),
    ('public.process_stale_human_conversations()', to_regprocedure('public.process_stale_human_conversations()') is not null)
  ) as v(object_identity, ok)
),
base_columns as (
  select * from (values
    ('public.conversations(id, organization_id)', (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'conversations' and column_name in ('id','organization_id'))),
    ('public.stores(id, organization_id)', (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'stores' and column_name in ('id','organization_id'))),
    ('public.memberships(organization_id, user_id)', (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'memberships' and column_name in ('organization_id','user_id'))),
    ('public.messages(id, organization_id, store_id, conversation_id)', (select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name in ('id','organization_id','store_id','conversation_id'))),
    ('public.conversation_sessions(id, organization_id, store_id)', (select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_sessions' and column_name in ('id','organization_id','store_id')))
  ) as v(object_identity, ok)
),
p0_check as (
  select
    'process_stale_human_conversations()'::text as object_identity,
    case when p.oid is not null then
      lower(pg_get_functiondef(p.oid)) ~ 'return[[:space:]]+0[[:space:]]*;'
      and lower(pg_get_functiondef(p.oid)) not like '%human_release_conversation_to_ai%'
      and lower(pg_get_functiondef(p.oid)) not like '%update public.conversation_human_takeover_leases%'
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    else false end as ok,
    'P0 must remain RETURN 0 and service-only'::text as detail
  from (select to_regprocedure('public.process_stale_human_conversations()') as oid) target
  left join pg_proc p on p.oid = target.oid
),
base_all as (
  select object_identity, ok, 'base dependency'::text as category, 'missing or incompatible'::text as detail from base_checks
  union all select object_identity, ok, 'base contract', 'missing or incompatible' from base_columns
  union all select object_identity, ok, 'P0 protection', detail from p0_check
),
target_objects as (
  select * from (values
    ('table', 'public.conversation_human_response_commitments'),
    ('function', 'public.record_human_response_commitment_by_system(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,boolean)'),
    ('function', 'public.transition_human_response_commitment_by_system(uuid,uuid,uuid,text,text,timestamptz)'),
    ('function', 'public.read_human_response_commitments_by_system(uuid,uuid,uuid)')
  ) as v(object_kind, object_identity)
),
target_presence as (
  select object_kind, object_identity,
    case when object_kind = 'table' then to_regclass(object_identity) is not null
         when object_kind = 'function' then to_regprocedure(object_identity) is not null
         else false end as present
  from target_objects
),
target_state as (
  select count(*) filter (where present) as present_count, count(*) as target_count from target_presence
),
installed_columns as (
  select x.column_name,
    exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'conversation_human_response_commitments' and c.column_name = x.column_name and c.udt_name = x.udt_name and c.is_nullable = x.is_nullable) as ok,
    x.udt_name || ', nullable=' || x.is_nullable as detail
  from (values
    ('organization_id','uuid','NO'), ('store_id','uuid','NO'), ('conversation_id','uuid','NO'), ('conversation_session_id','uuid','YES'),
    ('source_message_id','uuid','NO'), ('responsible_user_id','uuid','NO'), ('due_at','timestamptz','NO'), ('status','text','NO'),
    ('revision','int4','NO'), ('operation_key','text','NO'), ('last_operation_key','text','NO'), ('source_kind','text','NO')
  ) as x(column_name, udt_name, is_nullable)
),
function_catalog as (
  select x.check_name, x.object_identity, p.oid, p.prosecdef, p.proowner,
    case when p.oid is not null then lower(pg_get_functiondef(p.oid)) else null end as definition
  from (values
    ('record_contract'::text, 'public.record_human_response_commitment_by_system(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,boolean)'),
    ('transition_contract'::text, 'public.transition_human_response_commitment_by_system(uuid,uuid,uuid,text,text,timestamptz)'),
    ('read_scope_contract'::text, 'public.read_human_response_commitments_by_system(uuid,uuid,uuid)')
  ) as x(check_name, object_identity)
  left join pg_proc p on p.oid = to_regprocedure(x.object_identity)
),
installed_constraints as (
  select x.conname,
    case
      when c.oid is null then false
      when c.contype = 'f' and x.conname = 'human_response_commitments_scope_fkey' then pg_get_constraintdef(c.oid, true) ~* 'foreign key \(conversation_id, organization_id\) references (public\.)?conversations\(id, organization_id\)'
      when c.contype = 'f' and x.conname = 'human_response_commitments_store_org_fkey' then pg_get_constraintdef(c.oid, true) ~* 'foreign key \(store_id, organization_id\) references (public\.)?stores\(id, organization_id\)'
      when c.contype = 'f' and x.conname = 'human_response_commitments_session_scope_fkey' then pg_get_constraintdef(c.oid, true) ~* 'foreign key \(conversation_session_id, organization_id, store_id\) references (public\.)?conversation_sessions\(id, organization_id, store_id\)'
      when c.contype = 'f' and x.conname = 'human_response_commitments_message_scope_fkey' then pg_get_constraintdef(c.oid, true) ~* 'foreign key \(source_message_id, organization_id, store_id\) references (public\.)?messages\(id, organization_id, store_id\)'
      when c.contype = 'c' and x.conname = 'human_response_commitments_status_check' then lower(regexp_replace(pg_get_constraintdef(c.oid, true), '::[a-z_][a-z0-9_ ]*', '', 'g')) ~* $$status.*(active|fulfilled|cancelled|expired)$$ and lower(regexp_replace(pg_get_constraintdef(c.oid, true), '::[a-z_][a-z0-9_ ]*', '', 'g')) ~* $$= any.*array$$ and lower(regexp_replace(pg_get_constraintdef(c.oid, true), '::[a-z_][a-z0-9_ ]*', '', 'g')) ~* $$active.*fulfilled.*cancelled.*expired$$
      when c.contype = 'c' and x.conname = 'human_response_commitments_source_kind_check' then lower(regexp_replace(pg_get_constraintdef(c.oid, true), '::[a-z_][a-z0-9_ ]*', '', 'g')) ~* $$source_kind.*(panel|whatsapp_human)$$ and lower(regexp_replace(pg_get_constraintdef(c.oid, true), '::[a-z_][a-z0-9_ ]*', '', 'g')) ~* $$= any.*array$$ and lower(regexp_replace(pg_get_constraintdef(c.oid, true), '::[a-z_][a-z0-9_ ]*', '', 'g')) ~* $$panel.*whatsapp_human$$
      when c.contype = 'c' and x.conname = 'human_response_commitments_due_check' then pg_get_constraintdef(c.oid, true) ~* 'due_at > created_at'
      when c.contype = 'c' and x.conname = 'human_response_commitments_revision_check' then pg_get_constraintdef(c.oid, true) ~* 'revision > 0'
      else false
    end as ok,
    case when c.oid is not null then pg_get_constraintdef(c.oid, true) else 'missing' end as detail
  from (values
    ('human_response_commitments_scope_fkey'), ('human_response_commitments_store_org_fkey'), ('human_response_commitments_session_scope_fkey'), ('human_response_commitments_message_scope_fkey'),
    ('human_response_commitments_status_check'), ('human_response_commitments_source_kind_check'), ('human_response_commitments_due_check'), ('human_response_commitments_revision_check')
  ) as x(conname)
  left join pg_constraint c on c.conrelid = to_regclass('public.conversation_human_response_commitments') and c.conname = x.conname
),
installed_indexes as (
  select x.index_name,
    case
      when i.indexrelid is null then false
      when x.index_name = 'conversation_human_response_commitments_create_key_uidx' then i.indisunique and pg_get_indexdef(i.indexrelid) ~* '\(organization_id, operation_key\)'
      when x.index_name = 'conversation_human_response_commitments_one_active_uidx' then i.indisunique and pg_get_indexdef(i.indexrelid) ~* '\(organization_id, store_id, conversation_id\)' and coalesce(pg_get_expr(i.indpred, i.indrelid), '') ~* $$status = 'active'$$
      when x.index_name = 'conversation_human_response_commitments_active_idx' then not i.indisunique and pg_get_indexdef(i.indexrelid) ~* '\(organization_id, store_id, conversation_id, due_at\)' and coalesce(pg_get_expr(i.indpred, i.indrelid), '') ~* $$status = 'active'$$
      else false
    end as ok,
    case when i.indexrelid is not null then pg_get_indexdef(i.indexrelid) else 'missing' end as detail
  from (values ('conversation_human_response_commitments_create_key_uidx'), ('conversation_human_response_commitments_one_active_uidx'), ('conversation_human_response_commitments_active_idx')) as x(index_name)
  left join pg_index i on i.indrelid = to_regclass('public.conversation_human_response_commitments') and i.indexrelid = to_regclass('public.' || x.index_name)
),
installed_security as (
  select 'table_rls'::text as check_name, coalesce(c.relrowsecurity, false) as ok, 'relrowsecurity=' || coalesce(c.relrowsecurity::text, 'null') as detail
  from (select to_regclass('public.conversation_human_response_commitments') as oid) target
  left join pg_class c on c.oid = target.oid
  union all select 'table_grants', case when target.oid is not null then has_table_privilege('service_role', target.oid, 'SELECT') and not has_table_privilege('service_role', target.oid, 'INSERT') and not has_table_privilege('service_role', target.oid, 'UPDATE') and not has_table_privilege('authenticated', target.oid, 'SELECT') else false end, 'service_role SELECT only; authenticated denied' from (select to_regclass('public.conversation_human_response_commitments') as oid) target
  union all select 'record_grants', case when p.oid is not null then p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres' and has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE') else false end, 'record function security and grants' from function_catalog p where p.check_name = 'record_contract'
  union all select 'transition_grants', case when p.oid is not null then p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres' and has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE') else false end, 'transition function security and grants' from function_catalog p where p.check_name = 'transition_contract'
  union all select 'read_grants', case when p.oid is not null then p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres' and has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE') else false end, 'read function security and grants' from function_catalog p where p.check_name = 'read_scope_contract'
),
installed_functions as (
  select check_name, definition is not null and definition ~* 'human_response_commitment_explicit_confirmation_required' and definition ~* 'sender <> ''human''' and definition ~* 'direction <> ''outgoing''' and definition ~* 'sent_by_user_id' and definition ~* 'message_echo' and definition ~* 'audio_transcript' and definition ~* 'operation_key_conflict' and definition ~* 'p_due_at <= clock_timestamp' as ok, 'writer definition checked'::text as detail from function_catalog where check_name = 'record_contract'
  union all select check_name, definition is not null and definition ~* 'for update' and definition ~* 'status_invalid' and definition ~* 'terminal' and definition ~* 'revision = revision \+ 1' and definition ~* 'last_operation_key', 'transition definition checked' from function_catalog where check_name = 'transition_contract'
  union all select check_name, definition is not null and definition ~* 'organization_id = p_organization_id' and definition ~* 'store_id = p_store_id', 'read definition checked' from function_catalog where check_name = 'read_scope_contract'
),
installed_checks as (
  select 'column'::text as category, column_name as object_identity, ok, detail from installed_columns
  union all select 'constraint', conname, ok, detail from installed_constraints
  union all select 'index', index_name, ok, detail from installed_indexes
  union all select 'security', check_name, ok, detail from installed_security
  union all select 'function', check_name, ok, detail from installed_functions
),
state as (
  select t.present_count, t.target_count, coalesce((select bool_and(ok) from base_all), false) as base_ok, coalesce((select bool_and(ok) from installed_checks), false) as installed_ok from target_state t
),
result as (
  select case when s.present_count = 0 and s.base_ok then 'PENDING_10_7_A0_COMPATIBLE_BASELINE' when s.present_count = s.target_count and s.base_ok and s.installed_ok then 'INSTALLED_10_7_A0' else 'BLOQUEADO' end as verdict, s.present_count, s.target_count from state s
)
select r.verdict,
  case when r.verdict = 'PENDING_10_7_A0_COMPATIBLE_BASELINE' then '[]'::jsonb else
    coalesce((select jsonb_agg(jsonb_build_object('category', b.category, 'object', b.object_identity, 'detail', b.detail) order by b.category, b.object_identity) from base_all b where not b.ok), '[]'::jsonb) ||
    coalesce((select jsonb_agg(jsonb_build_object('category', i.category, 'object', i.object_identity, 'detail', i.detail) order by i.category, i.object_identity) from installed_checks i where not i.ok), '[]'::jsonb) ||
    case when r.present_count > 0 and r.present_count < r.target_count then jsonb_build_array(jsonb_build_object('category','installation','object','10.7-A0 target objects','detail','partial installation')) else '[]'::jsonb end
  end as blockers,
  r.present_count as target_objects_present,
  r.target_count as target_objects_expected,
  'READ_ONLY_P9_10_7_A0_MIGRATION_PREFLIGHT'::text as diagnostic_id
from result r;

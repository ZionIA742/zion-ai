/*
  P9 10.6-A read-only preflight.

  This is intentionally one SELECT: the SQL editor receives one final verdict
  row, while the intermediate CTEs keep the baseline and installed contracts
  independently auditable.  It does not replay migration text.

  A false definition is reported through the final BLOQUEADO verdict as
  BLOCKED_CANONICAL_CONSTRAINT_DEFINITION; an invalid catalog/name mapping is
  BLOCKED_CANONICAL_CONSTRAINT_IDENTITY.
*/
with
relations as (
  select
    to_regclass('public.commercial_opportunity_qualification_fact_events') as events_rel,
    to_regclass('public.commercial_opportunity_qualification_facts_current') as current_rel
),
columns_ok as (
  select
    r.events_rel is not null
      and r.current_rel is not null
      and (select count(*) from pg_catalog.pg_attribute a where a.attrelid = r.events_rel and a.attname = 'organization_id' and a.atttypid = 'uuid'::regtype and a.attnotnull)
        = 1
      and (select count(*) from pg_catalog.pg_attribute a where a.attrelid = r.events_rel and a.attname = 'store_id' and a.atttypid = 'uuid'::regtype and a.attnotnull)
        = 1
      and (select count(*) from pg_catalog.pg_attribute a where a.attrelid = r.events_rel and a.attname = 'commercial_opportunity_id' and a.atttypid = 'uuid'::regtype and a.attnotnull)
        = 1
      and (select count(*) from pg_catalog.pg_attribute a where a.attrelid = r.events_rel and a.attname = 'source_type' and a.atttypid = 'text'::regtype and a.attnotnull)
        = 1
      and (select count(*) from pg_catalog.pg_attribute a where a.attrelid = r.events_rel and a.attname = 'source_message_id' and a.atttypid = 'uuid'::regtype)
        = 1
      and (select count(*) from pg_catalog.pg_attribute a where a.attrelid = r.events_rel and a.attname = 'source_conversation_id' and a.atttypid = 'uuid'::regtype)
        = 1
      and (select count(*) from pg_catalog.pg_attribute a where a.attrelid = r.current_rel and a.attname = 'organization_id' and a.atttypid = 'uuid'::regtype and a.attnotnull)
        = 1
      and (select count(*) from pg_catalog.pg_attribute a where a.attrelid = r.current_rel and a.attname = 'store_id' and a.atttypid = 'uuid'::regtype and a.attnotnull)
        = 1
      and (select count(*) from pg_catalog.pg_attribute a where a.attrelid = r.current_rel and a.attname = 'commercial_opportunity_id' and a.atttypid = 'uuid'::regtype and a.attnotnull)
        = 1
      and (select count(*) from pg_catalog.pg_attribute a where a.attrelid = r.current_rel and a.attname = 'source_type' and a.atttypid = 'text'::regtype and a.attnotnull)
        = 1
      and (select count(*) from pg_catalog.pg_attribute a where a.attrelid = r.current_rel and a.attname = 'source_message_id' and a.atttypid = 'uuid'::regtype)
        = 1
      and (select count(*) from pg_catalog.pg_attribute a where a.attrelid = r.current_rel and a.attname = 'source_conversation_id' and a.atttypid = 'uuid'::regtype)
        = 1
    as ok
  from relations r
),
canonical_constraints as (
  select
    c.conname,
    c.conrelid = r.events_rel as on_events,
    c.conrelid = r.current_rel as on_current,
    c.contype = 'c' as is_check,
    pg_catalog.pg_get_constraintdef(c.oid, true) as raw_definition,
    lower(regexp_replace(pg_catalog.pg_get_constraintdef(c.oid, true), '[[:space:]"()]', '', 'g')) as definition
  from relations r
  left join pg_catalog.pg_constraint c
    on c.conname in ('p9_qfact_events_source_type_chk', 'p9_qfact_current_source_type_chk', 'p9_qfact_events_resolution_chk')
   and c.conrelid in (r.events_rel, r.current_rel)
),
constraint_shape as (
  select
    count(*) filter (where conname = 'p9_qfact_events_source_type_chk' and on_events and is_check) = 1
      and count(*) filter (where conname = 'p9_qfact_current_source_type_chk' and on_current and is_check) = 1
      and count(*) filter (where conname = 'p9_qfact_events_resolution_chk' and on_events and is_check) = 1
    as identity_ok,
    bool_and(conname is not null) as all_present,
    bool_and(
      (conname not in ('p9_qfact_events_source_type_chk', 'p9_qfact_current_source_type_chk') or (
        raw_definition ~* $$source_type[[:space:]]*=[[:space:]]*any[[:space:]]*\([[:space:]]*array\[$$
        and raw_definition ~ $$'incoming_customer_message'::text$$
        and raw_definition ~ $$'crm_manual'::text$$
        and raw_definition ~ $$'system_inference'::text$$
        and raw_definition ~ $$'system_correction'::text$$
        and raw_definition ~ $$'migration_backfill'::text$$
        and raw_definition !~ $$'human_message'::text$$
        and pg_catalog.regexp_count(raw_definition, '''[^'']+''') = 5
      ))
      and (conname <> 'p9_qfact_events_resolution_chk'
        or (
          raw_definition ~* $$resolves_conflict[[:space:]]+is[[:space:]]+false[[:space:]]+or$$
          and raw_definition ~ $$assertion_level[[:space:]]*=[[:space:]]*'confirmed'::text$$
          and raw_definition ~ $$'incoming_customer_message'::text$$
          and raw_definition ~ $$'crm_manual'::text$$
          and raw_definition ~ $$'system_correction'::text$$
          and raw_definition !~ $$'human_message'::text$$
          and pg_catalog.regexp_count(raw_definition, '''[^'']+''') = 4
        ))
    ) as common_shape,
    bool_and(
      (conname not in ('p9_qfact_events_source_type_chk', 'p9_qfact_current_source_type_chk') or (
        raw_definition ~* $$source_type[[:space:]]*=[[:space:]]*any[[:space:]]*\([[:space:]]*array\[$$
        and raw_definition ~ $$'human_message'::text$$
        and raw_definition ~* $$source_message_id[[:space:]]+is[[:space:]]+not[[:space:]]+null$$
        and raw_definition ~* $$source_conversation_id[[:space:]]+is[[:space:]]+not[[:space:]]+null$$
        and pg_catalog.regexp_count(raw_definition, '''[^'']+''') = 7
      ))
      and (conname <> 'p9_qfact_events_resolution_chk'
        or (
          raw_definition ~ $$'human_message'::text$$
          and pg_catalog.regexp_count(raw_definition, '''[^'']+''') = 5
        ))
    ) as installed_definition_marker,
    bool_and(
      (conname not in ('p9_qfact_events_source_type_chk', 'p9_qfact_current_source_type_chk') or (
        raw_definition ~* $$source_type[[:space:]]*=[[:space:]]*any[[:space:]]*\([[:space:]]*array\[$$
        and raw_definition ~ $$'incoming_customer_message'::text$$
        and raw_definition ~ $$'crm_manual'::text$$
        and raw_definition ~ $$'system_inference'::text$$
        and raw_definition ~ $$'system_correction'::text$$
        and raw_definition ~ $$'migration_backfill'::text$$
        and raw_definition ~ $$'human_message'::text$$
        and raw_definition ~* $$source_message_id[[:space:]]+is[[:space:]]+not[[:space:]]+null$$
        and raw_definition ~* $$source_conversation_id[[:space:]]+is[[:space:]]+not[[:space:]]+null$$
        and pg_catalog.regexp_count(raw_definition, '''[^'']+''') = 7
      ))
      and (conname <> 'p9_qfact_events_resolution_chk' or (
        raw_definition ~* $$resolves_conflict[[:space:]]+is[[:space:]]+false[[:space:]]+or$$
        and raw_definition ~ $$assertion_level[[:space:]]*=[[:space:]]*'confirmed'::text$$
        and raw_definition ~ $$'incoming_customer_message'::text$$
        and raw_definition ~ $$'crm_manual'::text$$
        and raw_definition ~ $$'system_correction'::text$$
        and raw_definition ~ $$'human_message'::text$$
        and pg_catalog.regexp_count(raw_definition, '''[^'']+''') = 5
      ))
    ) as installed_shape
  from canonical_constraints
),
writers as (
  select
    p.oid,
    p.proname,
    p.prosecdef,
    pg_catalog.pg_get_userbyid(p.proowner) as owner_name,
    coalesce(array_to_string(p.proconfig, ';'), '') as config,
    pg_catalog.pg_get_functiondef(p.oid) as definition
  from pg_catalog.pg_proc p
  where p.oid in (
    to_regprocedure('public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)'),
    to_regprocedure('public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)')
  )
),
writer_shape as (
  select
    count(*) = 2 as both_present,
    bool_and(owner_name = 'postgres' and prosecdef
      and config like '%search_path=pg_catalog, pg_temp, public%'
      and config like '%row_security=off%') as owner_security_ok,
    bool_and(
      definition like '%organization_id%store_id%commercial_opportunity_id%'
      and definition like '%source_message_id%source_conversation_id%'
    ) as provenance_and_scope_ok,
    coalesce((select has_function_privilege('service_role', oid, 'execute')
      and not has_function_privilege('authenticated', oid, 'execute')
      and not has_function_privilege('anon', oid, 'execute')
      from writers where proname = 'write_commercial_opportunity_qualification_fact_by_system'), false) as system_grants_ok,
    coalesce((select not has_function_privilege('public', oid, 'execute')
      and not has_function_privilege('anon', oid, 'execute')
      and not has_function_privilege('authenticated', oid, 'execute')
      and not has_function_privilege('service_role', oid, 'execute')
      from writers where proname = 'apply_commercial_opportunity_qualification_fact_internal'), false) as internal_grants_ok,
    bool_and(proname <> 'apply_commercial_opportunity_qualification_fact_internal' or (
      definition not like '%human_message%'
      and definition like '%source_type%'
      and definition like '%incoming_customer_message%'
      and definition like '%sender%'
      and definition like '%direction%'
    )) as baseline_internal_ok,
    bool_and(proname <> 'write_commercial_opportunity_qualification_fact_by_system' or (
      definition not like '%human_message%'
      and definition like '%system_inference%'
      and definition like '%incoming_customer_message%'
    )) as baseline_system_ok,
    bool_and(proname <> 'apply_commercial_opportunity_qualification_fact_internal' or (
      definition like '%human_message%'
      and definition like '%ZION_QFACT_HUMAN_PROVENANCE_REQUIRED%'
      and definition like '%ZION_QFACT_HUMAN_PROVENANCE_INVALID%'
      and definition like '%sender%human%'
      and definition like '%direction%outgoing%'
    )) as installed_internal_ok,
    bool_and(proname <> 'write_commercial_opportunity_qualification_fact_by_system' or (
      definition like '%human_message%'
      and definition like '%system_inference%'
    )) as installed_system_ok
  from writers
),
checks as (
  select * from constraint_shape cross join writer_shape cross join columns_ok
),
verdict as (
  select
    case
      when both_present and identity_ok and common_shape and baseline_internal_ok and baseline_system_ok
        and owner_security_ok and provenance_and_scope_ok and system_grants_ok and internal_grants_ok and ok
        then 'PENDING_10_6_A_COMPATIBLE_BASELINE'
      when both_present and identity_ok and installed_shape and installed_internal_ok and installed_system_ok
        and owner_security_ok and provenance_and_scope_ok and system_grants_ok and internal_grants_ok and ok
        then 'INSTALLED_10_6_A'
      else 'BLOQUEADO'
    end as verdict,
    jsonb_build_object(
      'canonical_constraint_identity_ok', identity_ok,
      'canonical_constraint_baseline_definition_ok', common_shape,
      'canonical_constraint_installed_definition_ok', installed_shape,
      'writers_present', both_present,
      'owner_security_ok', owner_security_ok,
      'grants_ok', system_grants_ok and internal_grants_ok,
      'provenance_and_isolation_ok', provenance_and_scope_ok,
      'canonical_column_types_ok', ok,
      'baseline_writers_ok', baseline_internal_ok and baseline_system_ok,
      'installed_writers_ok', installed_internal_ok and installed_system_ok
    ) as checks
  from checks
)
select verdict, checks
from verdict;

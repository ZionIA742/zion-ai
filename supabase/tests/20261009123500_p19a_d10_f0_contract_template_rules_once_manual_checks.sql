-- ZION-ADM / D10-F0 manual checks.
-- Run only after 20261009123000_p19a_d10_f0_contract_template_rules_once.sql.
-- All fixtures are transaction-local. This runner ends with ROLLBACK.
-- A single SQL session cannot prove two concurrent sessions; that limitation is
-- reported explicitly below.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    '20261009123500_p19a_d10_f0_contract_template_rules_once_manual_checks',
    0
  )
);

create temp table p19a_d10_f0_results (
  n integer primary key,
  name text not null,
  status text not null check (status in ('PASS', 'FAIL', 'ERROR', 'SKIP')),
  details text null
) on commit drop;

create or replace function pg_temp.p19a_d10_f0_record(
  p_n integer,
  p_name text,
  p_status text,
  p_details text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp.p19a_d10_f0_results(n, name, status, details)
  values (p_n, p_name, p_status, p_details)
  on conflict (n) do update
  set name = excluded.name,
      status = excluded.status,
      details = excluded.details;

  raise notice '% %: % -- %',
    p_status,
    p_n,
    p_name,
    coalesce(p_details, '');
end;
$function$;

create or replace function pg_temp.p19a_d10_f0_assert(
  p_n integer,
  p_name text,
  p_ok boolean,
  p_details text default null
)
returns void
language plpgsql
as $function$
begin
  perform pg_temp.p19a_d10_f0_record(
    p_n,
    p_name,
    case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end,
    p_details
  );
end;
$function$;

create or replace function pg_temp.p19a_d10_f0_skip(
  p_n integer,
  p_name text,
  p_details text default null
)
returns void
language plpgsql
as $function$
begin
  perform pg_temp.p19a_d10_f0_record(p_n, p_name, 'SKIP', p_details);
end;
$function$;

do $structural$
declare
  v_proc regprocedure := to_regprocedure(
    'public.replace_store_contract_template_rules_by_system(uuid,uuid,uuid,jsonb,uuid)'
  );
  v_definition text;
  v_prosecdef boolean;
  v_proconfig text[];
begin
  select pg_get_functiondef(p.oid), p.prosecdef, p.proconfig
  into v_definition, v_prosecdef, v_proconfig
  from pg_proc p
  where p.oid = v_proc;

  perform pg_temp.p19a_d10_f0_assert(
    1,
    'replacement RPC signature remains present',
    v_proc is not null
      and v_definition like '%replace_store_contract_template_rules_by_system%'
  );
  perform pg_temp.p19a_d10_f0_assert(
    2,
    'replacement RPC remains SECURITY DEFINER with public search_path',
    coalesce(v_prosecdef, false)
      and coalesce(v_proconfig @> array['search_path=public'], false)
  );
  perform pg_temp.p19a_d10_f0_assert(
    3,
    'lock and one-shot guard are in the function body',
    coalesce(v_definition, '') like '%for update%'
      and coalesce(v_definition, '') like '%P19A_CONTRACT_RULES_ALREADY_EXTRACTED%'
      and coalesce(v_definition, '') like '%rules_extracted_at%'
  );
  perform pg_temp.p19a_d10_f0_assert(
    4,
    'only service_role retains EXECUTE',
    has_function_privilege('service_role', v_proc, 'EXECUTE')
      and not has_function_privilege('public', v_proc, 'EXECUTE')
      and not has_function_privilege('anon', v_proc, 'EXECUTE')
      and not has_function_privilege('authenticated', v_proc, 'EXECUTE')
  );
end;
$structural$;

do $behavioral$
declare
  v_organization_id uuid;
  v_store_id uuid;
  v_actor_id uuid;
  v_template_id uuid := gen_random_uuid();
  v_base_version_number integer;
  v_rules_version_id uuid := gen_random_uuid();
  v_zero_version_id uuid := gen_random_uuid();
  v_uploaded_version_id uuid := gen_random_uuid();
  v_rejected_version_id uuid := gen_random_uuid();
  v_first_count integer;
  v_second_rejected boolean;
  v_before_rule_key text;
  v_before_review_status text;
  v_before_rule_count bigint;
  v_after_rule_count bigint;
  v_before_rules_fingerprint text;
  v_after_rules_fingerprint text;
  v_before_metadata jsonb;
  v_after_metadata jsonb;
  v_persisted_rule_count bigint;
  v_first_metadata jsonb;
  v_zero_second_rejected boolean;
  v_skip_n integer;
begin
  select s.organization_id, s.id, u.id
  into v_organization_id, v_store_id, v_actor_id
  from public.stores s
  cross join auth.users u
  where s.organization_id is not null
  limit 1;

  if v_organization_id is null or v_store_id is null or v_actor_id is null then
    for v_skip_n in 5..15 loop
      perform pg_temp.p19a_d10_f0_skip(
        v_skip_n,
        case v_skip_n
          when 5 then 'behavioral fixture: first extraction accepted'
          when 6 then 'behavioral fixture: extraction metadata and count'
          when 7 then 'behavioral fixture: duplicate extraction rejected'
          when 8 then 'behavioral fixture: reviewed rules preserved'
          when 9 then 'behavioral fixture: zero-rule extraction marks completion'
          when 10 then 'behavioral fixture: duplicate zero-rule extraction rejected'
          when 11 then 'behavioral fixture: foreign organization blocked'
          when 12 then 'behavioral fixture: foreign store blocked'
          when 13 then 'behavioral fixture: non-extractable version blocked'
          when 14 then 'behavioral fixture: rejected version blocked'
          when 15 then 'behavioral fixture: invalid arguments blocked'
        end,
        'no existing DEV store and auth user available for a transaction-local fixture'
      );
    end loop;
    perform pg_temp.p19a_d10_f0_skip(
      16,
      'two-session concurrency proof',
      'not experimentally proven: this rollback-only runner uses one SQL session'
    );
    perform pg_temp.p19a_d10_f0_skip(
      17,
      'fixture remains tenant/store scoped',
      'no transaction-local fixture available to verify the scope invariant'
    );
    return;
  end if;

  -- The DEV store may already have its unique template row. Reuse it and
  -- allocate version numbers after its current history; never touch the
  -- existing active pointer or historical versions.
  select t.id
  into v_template_id
  from public.store_contract_templates t
  where t.organization_id = v_organization_id
    and t.store_id = v_store_id
  limit 1;

  if v_template_id is null then
    v_template_id := gen_random_uuid();
    insert into public.store_contract_templates (
      id, organization_id, store_id, status, active_version_id
    ) values (
      v_template_id, v_organization_id, v_store_id, 'draft', null
    );
  end if;

  select coalesce(max(version_number), 0) + 1
  into v_base_version_number
  from public.store_contract_template_versions
  where template_id = v_template_id;

  insert into public.store_contract_template_versions (
    id, template_id, organization_id, store_id, version_number, status,
    storage_bucket, storage_path, raw_extracted_text, metadata
  ) values
    (
      v_rules_version_id, v_template_id, v_organization_id, v_store_id, v_base_version_number,
      'analyzed', 'zion-store-files', 'd10-f0/rules.pdf',
      'texto de contrato para regras', '{}'::jsonb
    ),
    (
      v_zero_version_id, v_template_id, v_organization_id, v_store_id, v_base_version_number + 1,
      'analyzed', 'zion-store-files', 'd10-f0/zero.pdf',
      'texto sem regras confiaveis', '{}'::jsonb
    ),
    (
      v_uploaded_version_id, v_template_id, v_organization_id, v_store_id, v_base_version_number + 2,
      'uploaded', 'zion-store-files', 'd10-f0/uploaded.pdf',
      'texto ainda nao analisado', '{}'::jsonb
    ),
    (
      v_rejected_version_id, v_template_id, v_organization_id, v_store_id, v_base_version_number + 3,
      'rejected', 'zion-store-files', 'd10-f0/rejected.pdf',
      'texto rejeitado', jsonb_build_object('rejection_reason', 'fixture')
    );

  select public.replace_store_contract_template_rules_by_system(
    v_rules_version_id,
    v_organization_id,
    v_store_id,
    jsonb_build_array(
      jsonb_build_object(
        'rule_key', 'payment_due',
        'rule_group', 'payment',
        'label', 'Vencimento',
        'value_text', '30 dias',
        'source_excerpt', 'pagamento em 30 dias'
      )
    ),
    v_actor_id
  ) into v_first_count;

  perform pg_temp.p19a_d10_f0_assert(
    5,
    'first extraction accepted',
    v_first_count = 1
  );

  select metadata
  into v_first_metadata
  from public.store_contract_template_versions
  where id = v_rules_version_id
    and organization_id = v_organization_id
    and store_id = v_store_id;

  select count(*)
  into v_persisted_rule_count
  from public.store_contract_template_extracted_rules
  where template_version_id = v_rules_version_id
    and organization_id = v_organization_id
    and store_id = v_store_id;

  perform pg_temp.p19a_d10_f0_assert(
    6,
    'first extraction metadata and persisted count are correct',
    (v_first_metadata ? 'rules_extracted_at')
      and v_first_metadata->>'rules_extracted_by_user_id' = v_actor_id::text
      and (v_first_metadata->>'rules_extracted_count')::integer = v_first_count
      and v_persisted_rule_count = v_first_count
  );

  update public.store_contract_template_extracted_rules
  set review_status = 'approved'
  where template_version_id = v_rules_version_id
    and organization_id = v_organization_id
    and store_id = v_store_id;

  select rule_key, review_status, count(*) over ()
  into v_before_rule_key, v_before_review_status, v_before_rule_count
  from public.store_contract_template_extracted_rules
  where template_version_id = v_rules_version_id
    and organization_id = v_organization_id
    and store_id = v_store_id;

  select md5(coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text, ''))
  into v_before_rules_fingerprint
  from public.store_contract_template_extracted_rules r
  where r.template_version_id = v_rules_version_id
    and r.organization_id = v_organization_id
    and r.store_id = v_store_id;

  select metadata
  into v_before_metadata
  from public.store_contract_template_versions
  where id = v_rules_version_id
    and organization_id = v_organization_id
    and store_id = v_store_id;

  v_second_rejected := false;
  begin
    perform public.replace_store_contract_template_rules_by_system(
      v_rules_version_id,
      v_organization_id,
      v_store_id,
      jsonb_build_array(jsonb_build_object(
        'rule_key', 'replacement',
        'rule_group', 'human',
        'label', 'Nao pode substituir'
      )),
      v_actor_id
    );
  exception when others then
    v_second_rejected := sqlerrm like 'P19A_CONTRACT_RULES_ALREADY_EXTRACTED%';
  end;

  select count(*) into v_after_rule_count
  from public.store_contract_template_extracted_rules
  where template_version_id = v_rules_version_id
    and organization_id = v_organization_id
    and store_id = v_store_id
    and rule_key = v_before_rule_key
    and review_status = v_before_review_status;

  perform pg_temp.p19a_d10_f0_assert(
    7,
    'duplicate extraction rejects and preserves reviewed rules',
    v_second_rejected
      and v_after_rule_count = v_before_rule_count
  );

  select md5(coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text, ''))
  into v_after_rules_fingerprint
  from public.store_contract_template_extracted_rules r
  where r.template_version_id = v_rules_version_id
    and r.organization_id = v_organization_id
    and r.store_id = v_store_id;

  select metadata
  into v_after_metadata
  from public.store_contract_template_versions
  where id = v_rules_version_id
    and organization_id = v_organization_id
    and store_id = v_store_id;

  perform pg_temp.p19a_d10_f0_assert(
    8,
    'duplicate extraction preserves every rule and metadata field',
    v_second_rejected
      and v_after_rule_count = v_before_rule_count
      and v_after_rules_fingerprint = v_before_rules_fingerprint
      and v_after_metadata = v_before_metadata
  );

  perform public.replace_store_contract_template_rules_by_system(
    v_zero_version_id,
    v_organization_id,
    v_store_id,
    '[]'::jsonb,
    v_actor_id
  );

  perform pg_temp.p19a_d10_f0_assert(
    9,
    'zero-rule extraction records completion marker',
    exists (
      select 1
      from public.store_contract_template_versions
      where id = v_zero_version_id
        and (metadata ? 'rules_extracted_at')
        and (metadata->>'rules_extracted_count')::integer = 0
    )
    and not exists (
      select 1
      from public.store_contract_template_extracted_rules
      where template_version_id = v_zero_version_id
    )
  );

  v_zero_second_rejected := false;
  begin
    perform public.replace_store_contract_template_rules_by_system(
      v_zero_version_id, v_organization_id, v_store_id, '[]'::jsonb, v_actor_id
    );
  exception when others then
    v_zero_second_rejected := sqlerrm like 'P19A_CONTRACT_RULES_ALREADY_EXTRACTED%';
  end;
  perform pg_temp.p19a_d10_f0_assert(
    10,
    'second zero-rule extraction rejects',
    v_zero_second_rejected
  );

  select md5(coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text, ''))
  into v_before_rules_fingerprint
  from public.store_contract_template_extracted_rules r
  where r.template_version_id = v_rules_version_id
    and r.organization_id = v_organization_id
    and r.store_id = v_store_id;

  begin
    perform public.replace_store_contract_template_rules_by_system(
      v_rules_version_id, gen_random_uuid(), v_store_id, '[]'::jsonb, v_actor_id
    );
    v_second_rejected := false;
  exception when others then
    v_second_rejected := sqlerrm like 'P19A_CONTRACT_VERSION_NOT_FOUND_OR_OUT_OF_SCOPE%';
  end;
  select md5(coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text, ''))
  into v_after_rules_fingerprint
  from public.store_contract_template_extracted_rules r
  where r.template_version_id = v_rules_version_id
    and r.organization_id = v_organization_id
    and r.store_id = v_store_id;
  perform pg_temp.p19a_d10_f0_assert(
    11,
    'foreign organization is blocked',
    v_second_rejected and v_after_rules_fingerprint = v_before_rules_fingerprint
  );

  select md5(coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text, ''))
  into v_before_rules_fingerprint
  from public.store_contract_template_extracted_rules r
  where r.template_version_id = v_rules_version_id
    and r.organization_id = v_organization_id
    and r.store_id = v_store_id;

  begin
    perform public.replace_store_contract_template_rules_by_system(
      v_rules_version_id, v_organization_id, gen_random_uuid(), '[]'::jsonb, v_actor_id
    );
    v_second_rejected := false;
  exception when others then
    v_second_rejected := sqlerrm like 'P19A_CONTRACT_VERSION_NOT_FOUND_OR_OUT_OF_SCOPE%';
  end;
  select md5(coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text, ''))
  into v_after_rules_fingerprint
  from public.store_contract_template_extracted_rules r
  where r.template_version_id = v_rules_version_id
    and r.organization_id = v_organization_id
    and r.store_id = v_store_id;
  perform pg_temp.p19a_d10_f0_assert(
    12,
    'foreign store is blocked',
    v_second_rejected and v_after_rules_fingerprint = v_before_rules_fingerprint
  );

  begin
    perform public.replace_store_contract_template_rules_by_system(
      v_uploaded_version_id, v_organization_id, v_store_id, '[]'::jsonb, v_actor_id
    );
    v_second_rejected := false;
  exception when others then
    v_second_rejected := sqlerrm like 'P19A_CONTRACT_RULES_VERSION_READ_ONLY%';
  end;
  perform pg_temp.p19a_d10_f0_assert(13, 'uploaded version remains blocked', v_second_rejected);

  begin
    perform public.replace_store_contract_template_rules_by_system(
      v_rejected_version_id, v_organization_id, v_store_id, '[]'::jsonb, v_actor_id
    );
    v_second_rejected := false;
  exception when others then
    v_second_rejected := sqlerrm like 'P19A_CONTRACT_RULES_VERSION_READ_ONLY%'
      or sqlerrm like 'P19A_CONTRACT_RULES_REJECTED_VERSION_READ_ONLY%';
  end;
  perform pg_temp.p19a_d10_f0_assert(14, 'rejected version remains blocked', v_second_rejected);

  begin
    perform public.replace_store_contract_template_rules_by_system(
      null, v_organization_id, v_store_id, '[]'::jsonb, v_actor_id
    );
    v_second_rejected := false;
  exception when others then
    v_second_rejected := sqlerrm like 'P19A_CONTRACT_INVALID_RULE_REPLACEMENT_ARGUMENTS%';
  end;
  perform pg_temp.p19a_d10_f0_assert(15, 'invalid arguments remain blocked', v_second_rejected);

  perform pg_temp.p19a_d10_f0_skip(
    16,
    'two-session concurrency proof',
    'not experimentally proven: this rollback-only runner uses one SQL session; FOR UPDATE plus the marker provides the intended serialization'
  );

  perform pg_temp.p19a_d10_f0_assert(
    17,
    'fixture remains tenant/store scoped',
    not exists (
      select 1
      from public.store_contract_template_extracted_rules
      where template_version_id = v_rules_version_id
        and (organization_id <> v_organization_id or store_id <> v_store_id)
    )
  );
end;
$behavioral$;

select
  r.n as scenario,
  r.name,
  r.status as result,
  r.details,
  s.pass_count,
  s.fail_count,
  s.error_count,
  s.skip_count,
  s.scenario_count,
  case
    when s.fail_count > 0
      or s.error_count > 0
      or s.scenario_count <> 17
      or s.non_concurrency_skip > 0
      then 'P19A_D10_F0_REVIEW_REQUIRED'
    when s.skip_count = 1
      and s.concurrency_skip = 1
      and s.pass_count = 16
      then 'P19A_D10_F0_PASS_WITH_LIMITATIONS'
    else 'P19A_D10_F0_REAL_SUT_PASS'
  end as overall_status,
  true as rollback_only
from pg_temp.p19a_d10_f0_results r
cross join lateral (
  select
    count(*) filter (where status = 'PASS') as pass_count,
    count(*) filter (where status = 'FAIL') as fail_count,
    count(*) filter (where status = 'ERROR') as error_count,
    count(*) filter (where status = 'SKIP') as skip_count,
    count(*) filter (where status = 'SKIP' and n = 16) as concurrency_skip,
    count(*) filter (where status = 'SKIP' and n <> 16) as non_concurrency_skip,
    count(*) as scenario_count
  from pg_temp.p19a_d10_f0_results
) s
order by r.n;

do $assert_all$
declare
  v_fail bigint;
  v_error bigint;
  v_count bigint;
  v_non_concurrency_skip bigint;
begin
  select
    count(*) filter (where status = 'FAIL'),
    count(*) filter (where status = 'ERROR'),
    count(*),
    count(*) filter (where status = 'SKIP' and n <> 16)
  into v_fail, v_error, v_count, v_non_concurrency_skip
  from pg_temp.p19a_d10_f0_results;

  if v_fail <> 0
     or v_error <> 0
     or v_count <> 17
     or v_non_concurrency_skip <> 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'P19A_D10_F0_MANUAL_CHECKS_FAILED fail=%s error=%s count=%s',
        v_fail, v_error, v_count
      );
  end if;
end;
$assert_all$;

rollback;

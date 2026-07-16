with conversation_metrics as (
  select
    count(*) filter (
      where c.organization_id is distinct from l.organization_id
    ) as conversation_lead_org_mismatch,

    count(*) filter (
      where l.store_id is not null
        and s.id is not null
        and c.organization_id is distinct from s.organization_id
    ) as conversation_store_org_mismatch,

    count(*) filter (
      where c.organization_id is distinct from l.organization_id
        and (
          l.store_id is null
          or s.id is null
          or s.organization_id is distinct from l.organization_id
        )
    ) as ambiguous_org_mismatch,

    count(*) filter (
      where l.store_id is null
    ) as conversations_with_lead_without_store,

    count(*) filter (
      where l.store_id is not null
        and s.id is null
    ) as conversations_with_invalid_store_reference
  from public.conversations c
  join public.leads l
    on l.id = c.lead_id
  left join public.stores s
    on s.id = l.store_id
),

repair_audit_metrics as (
  select
    count(*) as repaired_state_transition_rows,

    count(*) filter (
      where organization_id::text
        is distinct from metadata
          #>> '{organization_consistency_repair,corrected_organization_id}'
    ) as repaired_rows_wrong_current_org,

    count(*) filter (
      where metadata
          #>> '{organization_consistency_repair,previous_organization_id}'
        is null
        or metadata
          #>> '{organization_consistency_repair,corrected_organization_id}'
        is null
        or metadata
          #>> '{organization_consistency_repair,migration}'
        is distinct from
          '20260716135000_repair_legacy_conversation_organization_consistency'
    ) as repaired_rows_incomplete_audit,

    count(*) filter (
      where metadata
          #>> '{organization_consistency_repair,previous_organization_id}'
        is not distinct from metadata
          #>> '{organization_consistency_repair,corrected_organization_id}'
    ) as repaired_rows_without_real_change
  from public.state_transition_log
  where metadata ? 'organization_consistency_repair'
),

global_diagnostic as (
  select
    count(*) filter (
      where stl.organization_id is distinct from c.organization_id
    ) as unrelated_global_state_log_org_mismatch
  from public.state_transition_log stl
  join public.conversations c
    on c.id = stl.conversation_id
),

checks as (
  select
    'conversation_lead_org_mismatch'::text as check_name,
    case
      when conversation_lead_org_mismatch = 0 then 'PASS'
      else 'FAIL'
    end::text as status,
    conversation_lead_org_mismatch::text as detail
  from conversation_metrics

  union all

  select
    'conversation_store_org_mismatch',
    case
      when conversation_store_org_mismatch = 0 then 'PASS'
      else 'FAIL'
    end,
    conversation_store_org_mismatch::text
  from conversation_metrics

  union all

  select
    'ambiguous_org_mismatch',
    case
      when ambiguous_org_mismatch = 0 then 'PASS'
      else 'FAIL'
    end,
    ambiguous_org_mismatch::text
  from conversation_metrics

  union all

  select
    'conversations_with_invalid_store_reference',
    case
      when conversations_with_invalid_store_reference = 0
        then 'PASS'
      else 'FAIL'
    end,
    conversations_with_invalid_store_reference::text
  from conversation_metrics

  union all

  select
    'conversations_with_lead_without_store',
    'INFO',
    conversations_with_lead_without_store::text
  from conversation_metrics

  union all

  select
    'repaired_rows_wrong_current_org',
    case
      when repaired_rows_wrong_current_org = 0 then 'PASS'
      else 'FAIL'
    end,
    repaired_rows_wrong_current_org::text
  from repair_audit_metrics

  union all

  select
    'repaired_rows_incomplete_audit',
    case
      when repaired_rows_incomplete_audit = 0 then 'PASS'
      else 'FAIL'
    end,
    repaired_rows_incomplete_audit::text
  from repair_audit_metrics

  union all

  select
    'repaired_rows_without_real_change',
    case
      when repaired_rows_without_real_change = 0 then 'PASS'
      else 'FAIL'
    end,
    repaired_rows_without_real_change::text
  from repair_audit_metrics

  union all

  select
    'repaired_state_transition_rows',
    'INFO',
    repaired_state_transition_rows::text
  from repair_audit_metrics

  union all

  select
    'unrelated_global_state_log_org_mismatch',
    'INFO',
    unrelated_global_state_log_org_mismatch::text
      || ' registros fora do escopo desta migration; revisar no Pilar 19-A'
  from global_diagnostic
),

summary as (
  select
    'SUMMARY'::text as check_name,
    case
      when exists (
        select 1
        from checks
        where status = 'FAIL'
      ) then 'REPROVADA'
      else 'APROVADA'
    end::text as status,
    'pass=' || count(*) filter (where status = 'PASS')
      || ' ; fail=' || count(*) filter (where status = 'FAIL')
      || ' ; info=' || count(*) filter (where status = 'INFO')
      as detail
  from checks
)

select *
from (
  select * from summary
  union all
  select * from checks
) result
order by
  case status
    when 'REPROVADA' then 1
    when 'FAIL' then 1
    when 'APROVADA' then 2
    when 'PASS' then 2
    else 3
  end,
  check_name;

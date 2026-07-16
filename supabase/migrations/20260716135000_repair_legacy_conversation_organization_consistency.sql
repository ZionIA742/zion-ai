-- Repair legacy conversations whose organization_id diverges from the
-- organization shared by their lead and store.
--
-- Generalized repair:
-- - no hardcoded UUIDs;
-- - repairs every unambiguous mismatch detected by structure;
-- - aborts when lead/store do not establish one safe organization;
-- - scopes every post-check to the rows selected by this migration;
-- - preserves the previous organization on repaired transition-log rows.

drop table if exists pg_temp._conversation_org_repair_candidates;

create temporary table _conversation_org_repair_candidates
on commit drop
as
select
  c.id as conversation_id,
  c.organization_id as previous_organization_id,
  l.organization_id as correct_organization_id,
  l.store_id
from public.conversations c
join public.leads l
  on l.id = c.lead_id
join public.stores s
  on s.id = l.store_id
 and s.organization_id = l.organization_id
where c.organization_id is distinct from l.organization_id;

do $$
begin
  if exists (
    select 1
    from public.conversations c
    join public.leads l
      on l.id = c.lead_id
    left join public.stores s
      on s.id = l.store_id
    where c.organization_id is distinct from l.organization_id
      and (
        l.store_id is null
        or s.id is null
        or s.organization_id is distinct from l.organization_id
      )
  ) then
    raise exception
      'ambiguous conversation organization mismatch: lead/store relationship is not safe to repair automatically';
  end if;

  if exists (
    select 1
    from public.state_transition_log stl
    join _conversation_org_repair_candidates rc
      on rc.conversation_id = stl.conversation_id
    where stl.organization_id
      is distinct from rc.previous_organization_id
      and stl.organization_id
        is distinct from rc.correct_organization_id
  ) then
    raise exception
      'state_transition_log contains a third organization for a repair candidate';
  end if;
end;
$$;

drop table if exists pg_temp._state_transition_log_org_repairs;

create temporary table _state_transition_log_org_repairs
on commit drop
as
select
  stl.id as state_transition_log_id,
  rc.conversation_id,
  rc.previous_organization_id,
  rc.correct_organization_id
from public.state_transition_log stl
join _conversation_org_repair_candidates rc
  on rc.conversation_id = stl.conversation_id
where stl.organization_id = rc.previous_organization_id;

update public.state_transition_log stl
set
  organization_id = repair.correct_organization_id,
  metadata = coalesce(stl.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'organization_consistency_repair',
      jsonb_build_object(
        'previous_organization_id',
          repair.previous_organization_id,
        'corrected_organization_id',
          repair.correct_organization_id,
        'migration',
          '20260716135000_repair_legacy_conversation_organization_consistency'
      )
    )
from _state_transition_log_org_repairs repair
where stl.id = repair.state_transition_log_id;

update public.conversations c
set organization_id = repair.correct_organization_id
from _conversation_org_repair_candidates repair
where c.id = repair.conversation_id;

do $$
begin
  if exists (
    select 1
    from _conversation_org_repair_candidates repair
    left join public.conversations c
      on c.id = repair.conversation_id
    left join public.leads l
      on l.id = c.lead_id
    left join public.stores s
      on s.id = l.store_id
    where c.id is null
      or l.id is null
      or s.id is null
      or c.organization_id
        is distinct from repair.correct_organization_id
      or l.organization_id
        is distinct from repair.correct_organization_id
      or s.organization_id
        is distinct from repair.correct_organization_id
      or l.store_id is distinct from repair.store_id
  ) then
    raise exception
      'conversation organization consistency repair did not converge for the selected candidates';
  end if;

  if exists (
    select 1
    from public.state_transition_log stl
    join _conversation_org_repair_candidates repair
      on repair.conversation_id = stl.conversation_id
    where stl.organization_id
      is distinct from repair.correct_organization_id
  ) then
    raise exception
      'state_transition_log mismatch remains for a selected repair candidate';
  end if;

  if exists (
    select 1
    from _state_transition_log_org_repairs repair
    left join public.state_transition_log stl
      on stl.id = repair.state_transition_log_id
    where stl.id is null
      or stl.organization_id
        is distinct from repair.correct_organization_id
      or stl.metadata
          #>> '{organization_consistency_repair,previous_organization_id}'
        is distinct from repair.previous_organization_id::text
      or stl.metadata
          #>> '{organization_consistency_repair,corrected_organization_id}'
        is distinct from repair.correct_organization_id::text
      or stl.metadata
          #>> '{organization_consistency_repair,migration}'
        is distinct from
          '20260716135000_repair_legacy_conversation_organization_consistency'
  ) then
    raise exception
      'state_transition_log repair audit metadata is incomplete';
  end if;
end;
$$;

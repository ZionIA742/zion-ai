alter table public.store_discount_settings
  add column if not exists discount_special_rules text;

drop function if exists public.upsert_store_discount_settings_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text
);

create or replace function public.upsert_store_discount_settings_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_default_discount_percent numeric,
  p_max_discount_percent numeric,
  p_allow_ask_above_max_discount boolean default false,
  p_discount_autonomy_mode text default 'approval_required',
  p_discount_special_rules text default null
)
returns public.store_discount_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_result public.store_discount_settings%rowtype;
  v_discount_autonomy_mode text := coalesce(
    nullif(pg_catalog.btrim(coalesce(p_discount_autonomy_mode, '')), ''),
    'approval_required'
  );
  v_discount_special_rules text :=
    nullif(pg_catalog.btrim(coalesce(p_discount_special_rules, '')), '');
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if p_default_discount_percent is null or p_max_discount_percent is null then
    raise exception using
      errcode = '22023',
      message = 'default_discount_percent and max_discount_percent are required';
  end if;

  if p_default_discount_percent < 0
     or p_max_discount_percent < 0
     or p_default_discount_percent > p_max_discount_percent
     or p_max_discount_percent > 100
  then
    raise exception using
      errcode = '23514',
      message = 'discount policy values are invalid';
  end if;

  if not public.store_discount_autonomy_mode_is_valid(v_discount_autonomy_mode) then
    raise exception using
      errcode = '23514',
      message = 'discount autonomy mode is invalid';
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'store discount settings scope is not authorized';
    end if;

    select exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    into v_is_member;

    if coalesce(v_is_member, false) is not true then
      raise exception using
        errcode = '42501',
        message = 'store discount settings scope is not authorized';
    end if;
  elsif v_request_role = 'postgres' then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store discount settings scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store discount settings scope is not authorized';
  end if;

  insert into public.store_discount_settings (
    store_id,
    organization_id,
    default_discount_percent,
    max_discount_percent,
    allow_ask_above_max_discount,
    discount_autonomy_mode,
    discount_special_rules
  )
  values (
    p_store_id,
    p_organization_id,
    p_default_discount_percent,
    p_max_discount_percent,
    coalesce(p_allow_ask_above_max_discount, false),
    v_discount_autonomy_mode,
    v_discount_special_rules
  )
  on conflict (store_id)
  do update
    set organization_id = excluded.organization_id,
        default_discount_percent = excluded.default_discount_percent,
        max_discount_percent = excluded.max_discount_percent,
        allow_ask_above_max_discount = excluded.allow_ask_above_max_discount,
        discount_autonomy_mode = excluded.discount_autonomy_mode,
        discount_special_rules = excluded.discount_special_rules
  returning *
  into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_discount_settings_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text,
  text
) owner to postgres;

drop function if exists public.upsert_store_discount_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text
);

create or replace function public.upsert_store_discount_settings_with_legacy_mirror_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_default_discount_percent numeric,
  p_max_discount_percent numeric,
  p_allow_ask_above_max_discount boolean default false,
  p_discount_autonomy_mode text default 'approval_required',
  p_discount_special_rules text default null
)
returns public.store_discount_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_result public.store_discount_settings%rowtype;
  v_summary text;
  v_can_offer_discount boolean;
begin
  v_result := public.upsert_store_discount_settings_scoped(
    p_organization_id,
    p_store_id,
    p_default_discount_percent,
    p_max_discount_percent,
    p_allow_ask_above_max_discount,
    p_discount_autonomy_mode,
    p_discount_special_rules
  );

  v_summary := public.store_discount_settings_build_legacy_summary(
    v_result.default_discount_percent,
    v_result.max_discount_percent,
    v_result.allow_ask_above_max_discount,
    v_result.discount_autonomy_mode
  );

  v_can_offer_discount :=
    v_result.discount_autonomy_mode in (
      'default_step_autonomous',
      'within_policy_autonomous'
    )
    and (
      coalesce(v_result.default_discount_percent, 0) > 0
      or coalesce(v_result.max_discount_percent, 0) > 0
    );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'can_offer_discount',
    p_answer => to_jsonb(v_can_offer_discount)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'max_discount_percent',
    p_answer => to_jsonb(v_result.max_discount_percent)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'discount_policy_summary',
    p_answer => to_jsonb(v_summary)
  );

  -- Canonical NULL is mirrored as an empty legacy string, matching the
  -- compatibility convention used by the other canonical Settings families.
  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'discount_special_rules',
    p_answer => to_jsonb(coalesce(v_result.discount_special_rules, ''))
  );

  return v_result;
end;
$function$;

alter function public.upsert_store_discount_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text,
  text
) owner to postgres;

-- Conservative backfill.
-- Authority order:
--   1) a unique explicit legacy discount_special_rules value;
--   2) otherwise, a unique human_help_discount_cases_other value ONLY when a
--      unique valid selected-cases array explicitly contains
--      quer_condicao_especial.
-- Conflicts/malformed legacy data are not guessed.
with legacy_discount_rule_answers as (
  select
    answer_row.organization_id,
    answer_row.store_id,
    answer_row.question_key,
    answer_row.answer,
    nullif(pg_catalog.btrim(answer_row.answer #>> '{}'), '') as answer_text
  from public.store_onboarding_answers answer_row
  where answer_row.question_key in (
    'discount_special_rules',
    'human_help_discount_cases_selected',
    'human_help_discount_cases_other'
  )
),
legacy_discount_rule_grouped as (
  select
    organization_id,
    store_id,

    count(distinct answer_text) filter (
      where question_key = 'discount_special_rules'
        and answer_text is not null
    ) as explicit_rule_count,

    case
      when count(distinct answer_text) filter (
        where question_key = 'discount_special_rules'
          and answer_text is not null
      ) = 1
      then max(answer_text) filter (
        where question_key = 'discount_special_rules'
          and answer_text is not null
      )
      else null
    end as explicit_rule,

    count(distinct answer_text) filter (
      where question_key = 'human_help_discount_cases_other'
        and answer_text is not null
    ) as other_rule_count,

    case
      when count(distinct answer_text) filter (
        where question_key = 'human_help_discount_cases_other'
          and answer_text is not null
      ) = 1
      then max(answer_text) filter (
        where question_key = 'human_help_discount_cases_other'
          and answer_text is not null
      )
      else null
    end as other_rule,

    count(distinct answer::text) filter (
      where question_key = 'human_help_discount_cases_selected'
        and answer is not null
        and answer <> 'null'::jsonb
        and pg_catalog.jsonb_typeof(answer) = 'array'
    ) as selected_array_count,

    count(*) filter (
      where question_key = 'human_help_discount_cases_selected'
        and answer is not null
        and answer <> 'null'::jsonb
        and pg_catalog.jsonb_typeof(answer) <> 'array'
    ) as selected_invalid_count,

    case
      when count(distinct answer::text) filter (
        where question_key = 'human_help_discount_cases_selected'
          and answer is not null
          and answer <> 'null'::jsonb
          and pg_catalog.jsonb_typeof(answer) = 'array'
      ) = 1
      and count(*) filter (
        where question_key = 'human_help_discount_cases_selected'
          and answer is not null
          and answer <> 'null'::jsonb
          and pg_catalog.jsonb_typeof(answer) <> 'array'
      ) = 0
      then max(answer::text) filter (
        where question_key = 'human_help_discount_cases_selected'
          and answer is not null
          and answer <> 'null'::jsonb
          and pg_catalog.jsonb_typeof(answer) = 'array'
      )
      else null
    end as selected_cases_json
  from legacy_discount_rule_answers
  group by organization_id, store_id
),
legacy_discount_rule_candidates as (
  select
    grouped_row.organization_id,
    grouped_row.store_id,
    case
      -- Explicit new-key legacy data wins only when unique.
      when grouped_row.explicit_rule_count = 1
        then grouped_row.explicit_rule

      -- Conflicting explicit values are intentionally left unresolved.
      when grouped_row.explicit_rule_count > 1
        then null

      -- Legacy "special condition" can carry its unique free-text complement.
      when grouped_row.explicit_rule_count = 0
        and grouped_row.other_rule_count = 1
        and grouped_row.selected_array_count = 1
        and grouped_row.selected_invalid_count = 0
        and grouped_row.selected_cases_json is not null
        and exists (
          select 1
          from pg_catalog.jsonb_array_elements_text(
            grouped_row.selected_cases_json::jsonb
          ) as selected_case
          where pg_catalog.lower(pg_catalog.btrim(selected_case))
            = 'quer_condicao_especial'
        )
      then grouped_row.other_rule

      -- "quer_condicao_especial" without an unambiguous text does not invent
      -- a canonical rule.
      else null
    end as discount_special_rules
  from legacy_discount_rule_grouped grouped_row
)
update public.store_discount_settings discount_row
set discount_special_rules = candidate_row.discount_special_rules
from legacy_discount_rule_candidates candidate_row
where candidate_row.organization_id = discount_row.organization_id
  and candidate_row.store_id = discount_row.store_id
  and discount_row.discount_special_rules is null
  and candidate_row.discount_special_rules is not null;

revoke all on function public.upsert_store_discount_settings_scoped(
  uuid, uuid, numeric, numeric, boolean, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.upsert_store_discount_settings_with_legacy_mirror_scoped(
  uuid, uuid, numeric, numeric, boolean, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.upsert_store_discount_settings_with_legacy_mirror_scoped(
  uuid, uuid, numeric, numeric, boolean, text, text
) to authenticated;

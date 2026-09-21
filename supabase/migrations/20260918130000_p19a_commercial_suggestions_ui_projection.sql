begin;

-- ============================================================
-- P19-A / BLOCO 3 / ETAPA 3.4
-- Commercial Suggestions Settings UI -> canonical authority.
--
-- Extends store_commercial_ai_settings so the approved Settings
-- UX can be represented without creating a second authority.
--
-- Existing canonical behavior fields remain authoritative:
--   complementary_suggestions_enabled
--   complementary_scope_mode
--   complementary_category_keys
--   complementary_line_keys
--   complementary_allowed_moments
--   superior_option_suggestions_enabled
--   superior_option_allowed_triggers
--
-- The columns below preserve Settings intent that the previous
-- structured policy could not represent losslessly.
-- ============================================================

alter table public.store_commercial_ai_settings
  add column if not exists complementary_non_catalog_type_keys text[]
    not null default '{}'::text[],
  add column if not exists complementary_catalog_item_keys text[]
    not null default '{}'::text[],
  add column if not exists complementary_services_detail text
    not null default '',
  add column if not exists complementary_other_detail text
    not null default '',
  add column if not exists superior_option_policy text
    not null default '';

alter table public.store_commercial_ai_settings
  drop constraint if exists store_commercial_ai_settings_complementary_payload_valid;

alter table public.store_commercial_ai_settings
  add constraint store_commercial_ai_settings_complementary_payload_valid
  check (
    complementary_suggestions_enabled is false
    or complementary_scope_mode <> 'selected_scope'
    or cardinality(complementary_category_keys) > 0
    or cardinality(complementary_line_keys) > 0
    or cardinality(complementary_non_catalog_type_keys) > 0
  );

alter table public.store_commercial_ai_settings
  drop constraint if exists store_commercial_ai_settings_non_catalog_types_valid;

alter table public.store_commercial_ai_settings
  add constraint store_commercial_ai_settings_non_catalog_types_valid
  check (
    complementary_non_catalog_type_keys
      <@ array['servicos', 'outro']::text[]
  );

alter table public.store_commercial_ai_settings
  drop constraint if exists store_commercial_ai_settings_superior_option_policy_valid;

alter table public.store_commercial_ai_settings
  add constraint store_commercial_ai_settings_superior_option_policy_valid
  check (
    superior_option_policy in (
      '',
      'beneficio',
      'se_pedir',
      'nao'
    )
  );

-- ============================================================
-- SETTINGS-SPECIFIC STRUCTURED WRITER
--
-- This overload accepts the actual Settings UX vocabulary.
-- The legacy/canonical 9-argument writers remain available.
-- No ambiguity exists because this overload has a different
-- argument count and no default arguments.
-- ============================================================

create or replace function public.upsert_store_commercial_ai_suggestion_policy_configured_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_suggestions_enabled boolean,
  p_suggestion_types text[],
  p_suggestion_catalog_item_keys text[],
  p_suggestion_services_detail text,
  p_suggestion_other text,
  p_better_option_policy text
)
returns public.store_commercial_ai_settings
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
set row_security = off
as $function$
declare
  v_enabled boolean := coalesce(p_suggestions_enabled, false);
  v_types text[];
  v_category_keys text[];
  v_non_catalog_type_keys text[];
  v_catalog_item_keys text[];
  v_services_detail text := pg_catalog.btrim(coalesce(p_suggestion_services_detail, ''));
  v_other_detail text := pg_catalog.btrim(coalesce(p_suggestion_other, ''));
  v_better_option_policy text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(p_better_option_policy, ''))
  );
  v_existing public.store_commercial_ai_settings%rowtype;
  v_result public.store_commercial_ai_settings%rowtype;
begin
  perform public.assert_store_settings_experience_policies_scope(
    p_organization_id,
    p_store_id
  );

  v_types :=
    public.store_commercial_ai_normalize_category_keys(p_suggestion_types);

  if exists (
    select 1
    from unnest(v_types) as suggestion_type(value)
    where suggestion_type.value not in (
      'piscinas',
      'acessorios',
      'quimicos',
      'equipamentos',
      'outros_catalogo',
      'servicos',
      'outro'
    )
  ) then
    raise exception using
      errcode = '22023',
      message = 'suggestion_types contains an unsupported value';
  end if;

  select coalesce(array_agg(value order by ordinality), '{}'::text[])
  into v_category_keys
  from unnest(v_types) with ordinality as suggestion_type(value, ordinality)
  where value in (
    'piscinas',
    'acessorios',
    'quimicos',
    'equipamentos',
    'outros_catalogo'
  );

  select coalesce(array_agg(value order by ordinality), '{}'::text[])
  into v_non_catalog_type_keys
  from unnest(v_types) with ordinality as suggestion_type(value, ordinality)
  where value in ('servicos', 'outro');

  v_catalog_item_keys :=
    public.store_commercial_ai_normalize_text_array(
      p_suggestion_catalog_item_keys
    );

  if not v_enabled then
    v_types := '{}'::text[];
    v_category_keys := '{}'::text[];
    v_non_catalog_type_keys := '{}'::text[];
    v_catalog_item_keys := '{}'::text[];
    v_services_detail := '';
    v_other_detail := '';
    v_better_option_policy := '';
  else
    if cardinality(v_types) = 0 then
      raise exception using
        errcode = '22023',
        message = 'at least one suggestion type is required when suggestions are enabled';
    end if;

    if 'servicos' = any(v_non_catalog_type_keys)
       and v_services_detail = ''
    then
      raise exception using
        errcode = '22023',
        message = 'services detail is required when servicos is selected';
    end if;

    if not ('servicos' = any(v_non_catalog_type_keys)) then
      v_services_detail := '';
    end if;

    if 'outro' = any(v_non_catalog_type_keys)
       and v_other_detail = ''
    then
      raise exception using
        errcode = '22023',
        message = 'other suggestion detail is required when outro is selected';
    end if;

    if not ('outro' = any(v_non_catalog_type_keys)) then
      v_other_detail := '';
    end if;

    if v_better_option_policy not in (
      'beneficio',
      'se_pedir',
      'nao'
    ) then
      raise exception using
        errcode = '22023',
        message = 'better_option_policy is required and invalid';
    end if;
  end if;

  select *
  into v_existing
  from public.store_commercial_ai_settings settings_row
  where settings_row.organization_id = p_organization_id
    and settings_row.store_id = p_store_id
  for update;

  insert into public.store_commercial_ai_settings (
    organization_id,
    store_id,
    price_answer_policy,
    price_context_requirements,
    complementary_suggestions_enabled,
    complementary_scope_mode,
    complementary_category_keys,
    complementary_line_keys,
    complementary_allowed_moments,
    complementary_non_catalog_type_keys,
    complementary_catalog_item_keys,
    complementary_services_detail,
    complementary_other_detail,
    superior_option_policy,
    superior_option_suggestions_enabled,
    superior_option_allowed_triggers,
    complementary_suggestions_configured_at
  )
  values (
    p_organization_id,
    p_store_id,
    coalesce(v_existing.price_answer_policy, 'human_required_for_price'),
    coalesce(v_existing.price_context_requirements, '{}'::text[]),
    v_enabled,
    case when v_enabled then 'selected_scope' else 'all_compatible' end,
    v_category_keys,
    '{}'::text[],
    coalesce(v_existing.complementary_allowed_moments, '{}'::text[]),
    v_non_catalog_type_keys,
    v_catalog_item_keys,
    v_services_detail,
    v_other_detail,
    v_better_option_policy,
    v_enabled and v_better_option_policy = 'beneficio',
    case
      when v_enabled and v_better_option_policy = 'beneficio'
        then array['materially_relevant_advantage']::text[]
      else '{}'::text[]
    end,
    pg_catalog.clock_timestamp()
  )
  on conflict on constraint store_commercial_ai_settings_pkey
  do update
  set complementary_suggestions_enabled =
        excluded.complementary_suggestions_enabled,
      complementary_scope_mode =
        excluded.complementary_scope_mode,
      complementary_category_keys =
        excluded.complementary_category_keys,
      complementary_line_keys =
        excluded.complementary_line_keys,
      complementary_non_catalog_type_keys =
        excluded.complementary_non_catalog_type_keys,
      complementary_catalog_item_keys =
        excluded.complementary_catalog_item_keys,
      complementary_services_detail =
        excluded.complementary_services_detail,
      complementary_other_detail =
        excluded.complementary_other_detail,
      superior_option_policy =
        excluded.superior_option_policy,
      superior_option_suggestions_enabled =
        excluded.superior_option_suggestions_enabled,
      superior_option_allowed_triggers =
        excluded.superior_option_allowed_triggers,
      complementary_suggestions_configured_at =
        excluded.complementary_suggestions_configured_at
  returning *
  into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_commercial_ai_suggestion_policy_configured_scoped(
  uuid,
  uuid,
  boolean,
  text[],
  text[],
  text,
  text,
  text
)
owner to postgres;

revoke all
  on function public.upsert_store_commercial_ai_suggestion_policy_configured_scoped(
    uuid,
    uuid,
    boolean,
    text[],
    text[],
    text,
    text,
    text
  )
  from public, anon, service_role;

grant execute
  on function public.upsert_store_commercial_ai_suggestion_policy_configured_scoped(
    uuid,
    uuid,
    boolean,
    text[],
    text[],
    text,
    text,
    text
  )
  to authenticated;

-- ============================================================
-- SETTINGS COMPATIBILITY READER
--
-- Storage stays structured in store_commercial_ai_settings.
-- commercial_suggestions is only a Settings read model.
-- It exposes both canonical fields and the existing UI field names.
-- ============================================================

drop function if exists public.read_store_settings_experience_policies_scoped(
  uuid,
  uuid
);

create function public.read_store_settings_experience_policies_scoped(
  p_organization_id uuid,
  p_store_id uuid
)
returns table (
  organization_id uuid,
  store_id uuid,
  commercial_ai_guidance jsonb,
  commercial_suggestions jsonb,
  price_extra_context jsonb,
  payment_extensions jsonb,
  payment_execution_rules jsonb,
  discount_extensions jsonb,
  quote_policy jsonb,
  post_sale_policy jsonb,
  warranty_policy jsonb,
  cancellation_policy jsonb,
  brand_visual_policy jsonb,
  contract_usage_policy jsonb,
  configured_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
set row_security = off
as $function$
begin
  perform public.assert_store_settings_experience_policies_scope(
    p_organization_id,
    p_store_id
  );

  return query
  select
    p_organization_id,
    p_store_id,
    coalesce(commercial_row.commercial_ai_guidance, '{}'::jsonb),

    case
      when commercial_row.complementary_suggestions_configured_at is null
        then '{}'::jsonb
      else pg_catalog.jsonb_build_object(
        -- Existing Settings UI vocabulary.
        'suggestions_enabled',
          case
            when commercial_row.complementary_suggestions_enabled
              then 'Sim'
            else 'Não'
          end,
        'suggestion_types',
          to_jsonb(
            array_cat(
              coalesce(
                commercial_row.complementary_category_keys,
                '{}'::text[]
              ),
              coalesce(
                commercial_row.complementary_non_catalog_type_keys,
                '{}'::text[]
              )
            )
          ),
        'suggestion_catalog_item_keys',
          to_jsonb(
            coalesce(
              commercial_row.complementary_catalog_item_keys,
              '{}'::text[]
            )
          ),
        'suggestion_services_detail',
          coalesce(commercial_row.complementary_services_detail, ''),
        'suggestion_other',
          coalesce(commercial_row.complementary_other_detail, ''),
        'better_option_policy',
          coalesce(commercial_row.superior_option_policy, ''),

        -- Canonical structured policy remains visible in the read model.
        'complementary_suggestions_enabled',
          commercial_row.complementary_suggestions_enabled,
        'complementary_scope_mode',
          commercial_row.complementary_scope_mode,
        'complementary_category_keys',
          to_jsonb(commercial_row.complementary_category_keys),
        'complementary_line_keys',
          to_jsonb(commercial_row.complementary_line_keys),
        'complementary_allowed_moments',
          to_jsonb(commercial_row.complementary_allowed_moments),
        'complementary_non_catalog_type_keys',
          to_jsonb(commercial_row.complementary_non_catalog_type_keys),
        'complementary_catalog_item_keys',
          to_jsonb(commercial_row.complementary_catalog_item_keys),
        'superior_option_suggestions_enabled',
          commercial_row.superior_option_suggestions_enabled,
        'superior_option_allowed_triggers',
          to_jsonb(commercial_row.superior_option_allowed_triggers),
        'superior_option_policy',
          commercial_row.superior_option_policy,
        'configured_at',
          to_jsonb(commercial_row.complementary_suggestions_configured_at)
      )
    end,

    coalesce(commercial_row.price_extra_context, '{}'::jsonb),
    coalesce(payment_row.payment_extensions, '{}'::jsonb),
    coalesce(payment_row.payment_execution_rules, '{}'::jsonb),

    case
      when high_value_row.requires_human_approval_configured_at is null
        then '{}'::jsonb
      else pg_catalog.jsonb_build_object(
        'high_value_requires_human',
        coalesce(high_value_row.requires_human_approval, false)
      )
    end,

    coalesce(experience_row.quote_policy, '{}'::jsonb),
    coalesce(experience_row.post_sale_policy, '{}'::jsonb),
    coalesce(experience_row.warranty_policy, '{}'::jsonb),
    coalesce(experience_row.cancellation_policy, '{}'::jsonb),
    coalesce(experience_row.brand_visual_policy, '{}'::jsonb),
    coalesce(experience_row.contract_usage_policy, '{}'::jsonb),

    greatest(
      experience_row.configured_at,
      high_value_row.requires_human_approval_configured_at,
      commercial_row.updated_at,
      payment_row.updated_at
    ),

    least(
      experience_row.created_at,
      commercial_row.created_at,
      payment_row.created_at,
      high_value_row.created_at
    ),

    greatest(
      experience_row.updated_at,
      commercial_row.updated_at,
      payment_row.updated_at,
      high_value_row.updated_at
    )

  from (select 1) seed

  left join public.store_commercial_ai_settings commercial_row
    on commercial_row.organization_id = p_organization_id
   and commercial_row.store_id = p_store_id

  left join public.store_payment_settings payment_row
    on payment_row.organization_id = p_organization_id
   and payment_row.store_id = p_store_id

  left join public.store_high_value_discount_settings high_value_row
    on high_value_row.organization_id = p_organization_id
   and high_value_row.store_id = p_store_id

  left join public.store_settings_experience_policies experience_row
    on experience_row.organization_id = p_organization_id
   and experience_row.store_id = p_store_id;
end;
$function$;

alter function public.read_store_settings_experience_policies_scoped(
  uuid,
  uuid
)
owner to postgres;

revoke all
  on function public.read_store_settings_experience_policies_scoped(
    uuid,
    uuid
  )
  from public, anon, service_role;

grant execute
  on function public.read_store_settings_experience_policies_scoped(
    uuid,
    uuid
  )
  to authenticated;

commit;
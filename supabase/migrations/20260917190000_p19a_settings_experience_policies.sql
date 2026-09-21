begin;

-- ============================================================
-- P19-A / BLOCO 3 / ETAPA 3.4
-- Settings authorities canonicalization.
--
-- This migration intentionally keeps each setting inside the
-- authority that owns its domain:
--
--   store_commercial_ai_settings
--     - commercial_ai_guidance
--     - commercial_suggestions through the EXISTING structured
--       complementary suggestion-policy columns/writer
--     - price_extra_context
--
--   store_payment_settings
--     - payment_extensions
--     - payment_execution_rules
--
--   store_high_value_discount_settings
--     - high_value_requires_human
--
--   store_settings_experience_policies
--     - quote_policy
--     - post_sale_policy
--     - warranty_policy
--     - cancellation_policy
--     - brand_visual_policy
--     - contract_usage_policy
--
-- The scoped read/upsert RPCs below remain a compatibility
-- facade for Settings UI. They do NOT create a second source
-- of truth: each payload is routed to its canonical owner.
-- ============================================================

-- ============================================================
-- 1. EXTEND EXISTING DOMAIN AUTHORITIES
-- ============================================================

alter table public.store_commercial_ai_settings
  add column if not exists commercial_ai_guidance jsonb not null default '{}'::jsonb,
  add column if not exists price_extra_context jsonb not null default '{}'::jsonb,
  add column if not exists complementary_suggestions_configured_at timestamptz;

alter table public.store_payment_settings
  add column if not exists payment_extensions jsonb not null default '{}'::jsonb,
  add column if not exists payment_execution_rules jsonb not null default '{}'::jsonb;

alter table public.store_high_value_discount_settings
  add column if not exists requires_human_approval boolean,
  add column if not exists requires_human_approval_configured_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_commercial_ai_settings'::regclass
      and conname = 'store_commercial_ai_settings_experience_json_objects_check'
  ) then
    alter table public.store_commercial_ai_settings
      add constraint store_commercial_ai_settings_experience_json_objects_check
      check (
        pg_catalog.jsonb_typeof(commercial_ai_guidance) = 'object'
        and pg_catalog.jsonb_typeof(price_extra_context) = 'object'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_payment_settings'::regclass
      and conname = 'store_payment_settings_experience_json_objects_check'
  ) then
    alter table public.store_payment_settings
      add constraint store_payment_settings_experience_json_objects_check
      check (
        pg_catalog.jsonb_typeof(payment_extensions) = 'object'
        and pg_catalog.jsonb_typeof(payment_execution_rules) = 'object'
      );
  end if;
end;
$$;

comment on column public.store_commercial_ai_settings.commercial_ai_guidance is
  'P19-A canonical Settings payload for explicit additional commercial AI guidance.';

comment on column public.store_commercial_ai_settings.complementary_suggestions_configured_at is
  'P19-A marker that distinguishes an explicit Suggestions Sim/No decision from legacy/default false.';

comment on column public.store_commercial_ai_settings.price_extra_context is
  'P19-A canonical complementary price-context payload. Base price policy remains in the structured columns of this table.';

comment on column public.store_payment_settings.payment_extensions is
  'P19-A canonical complementary payment payload. Base payment methods/down-payment/installments remain structured columns of this table.';

comment on column public.store_payment_settings.payment_execution_rules is
  'P19-A canonical payment execution/release payload owned by store_payment_settings.';

comment on column public.store_high_value_discount_settings.requires_human_approval is
  'P19-A canonical high-value human-approval decision. NULL means not explicitly configured.';

-- ============================================================
-- 2. AUTHORITY ONLY FOR DOMAINS THAT DO NOT HAVE A DEDICATED
--    SETTINGS OWNER YET
-- ============================================================

create table if not exists public.store_settings_experience_policies (
  organization_id uuid not null,
  store_id uuid not null,

  quote_policy jsonb not null default '{}'::jsonb,
  post_sale_policy jsonb not null default '{}'::jsonb,
  warranty_policy jsonb not null default '{}'::jsonb,
  cancellation_policy jsonb not null default '{}'::jsonb,
  brand_visual_policy jsonb not null default '{}'::jsonb,
  contract_usage_policy jsonb not null default '{}'::jsonb,

  configured_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint store_settings_experience_policies_pkey
    primary key (organization_id, store_id),

  constraint store_settings_experience_policies_store_scope_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete cascade,

  constraint store_settings_experience_policies_json_objects_check
    check (
      pg_catalog.jsonb_typeof(quote_policy) = 'object'
      and pg_catalog.jsonb_typeof(post_sale_policy) = 'object'
      and pg_catalog.jsonb_typeof(warranty_policy) = 'object'
      and pg_catalog.jsonb_typeof(cancellation_policy) = 'object'
      and pg_catalog.jsonb_typeof(brand_visual_policy) = 'object'
      and pg_catalog.jsonb_typeof(contract_usage_policy) = 'object'
    )
);

create or replace function public.touch_store_settings_experience_policies_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

alter function public.touch_store_settings_experience_policies_updated_at()
  owner to postgres;

revoke all
  on function public.touch_store_settings_experience_policies_updated_at()
  from public, anon, authenticated, service_role;

drop trigger if exists touch_store_settings_experience_policies_updated_at
  on public.store_settings_experience_policies;

create trigger touch_store_settings_experience_policies_updated_at
before update
on public.store_settings_experience_policies
for each row
execute function public.touch_store_settings_experience_policies_updated_at();

alter table public.store_settings_experience_policies
  enable row level security;

revoke all
  on table public.store_settings_experience_policies
  from public, anon, authenticated, service_role;

grant select
  on table public.store_settings_experience_policies
  to authenticated;

drop policy if exists store_settings_experience_policies_select_by_active_membership
  on public.store_settings_experience_policies;

create policy store_settings_experience_policies_select_by_active_membership
on public.store_settings_experience_policies
for select
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id =
      store_settings_experience_policies.organization_id
      and membership_row.user_id = auth.uid()
      and membership_row.is_active is true
  )
  and exists (
    select 1
    from public.stores store_row
    where store_row.id = store_settings_experience_policies.store_id
      and store_row.organization_id =
        store_settings_experience_policies.organization_id
  )
);

-- ============================================================
-- 3. SHARED SCOPE ASSERTION
-- ============================================================

create or replace function public.assert_store_settings_experience_policies_scope(
  p_organization_id uuid,
  p_store_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'settings experience policy scope is not authorized';
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
        message = 'settings experience policy scope is not authorized';
    end if;
  elsif v_request_role = 'postgres' then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'settings experience policy scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'settings experience policy scope is not authorized';
  end if;
end;
$function$;

alter function public.assert_store_settings_experience_policies_scope(uuid, uuid)
  owner to postgres;

revoke all
  on function public.assert_store_settings_experience_policies_scope(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ============================================================
-- 4. STRUCTURED SUGGESTION WRAPPER
--
-- The September 3 migration already owns the Suggestions policy.
-- This wrapper keeps that structured writer authoritative and only
-- adds an explicit configured-at marker so false can mean an actual
-- user choice instead of merely a legacy/default value.
-- ============================================================

create or replace function public.upsert_store_commercial_ai_suggestion_policy_configured_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_complementary_suggestions_enabled boolean default false,
  p_complementary_scope_mode text default 'all_compatible',
  p_complementary_category_keys text[] default '{}'::text[],
  p_complementary_line_keys text[] default '{}'::text[],
  p_complementary_allowed_moments text[] default '{}'::text[],
  p_superior_option_suggestions_enabled boolean default false,
  p_superior_option_allowed_triggers text[] default '{}'::text[]
)
returns public.store_commercial_ai_settings
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
set row_security = off
as $function$
declare
  v_result public.store_commercial_ai_settings%rowtype;
begin
  perform public.assert_store_settings_experience_policies_scope(
    p_organization_id,
    p_store_id
  );

  v_result := public.upsert_store_commercial_ai_suggestion_policy_scoped(
    p_organization_id,
    p_store_id,
    p_complementary_suggestions_enabled,
    p_complementary_scope_mode,
    p_complementary_category_keys,
    p_complementary_line_keys,
    p_complementary_allowed_moments,
    p_superior_option_suggestions_enabled,
    p_superior_option_allowed_triggers
  );

  update public.store_commercial_ai_settings settings_row
  set complementary_suggestions_configured_at = pg_catalog.clock_timestamp()
  where settings_row.organization_id = p_organization_id
    and settings_row.store_id = p_store_id
  returning *
  into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_commercial_ai_suggestion_policy_configured_scoped(
  uuid,
  uuid,
  boolean,
  text,
  text[],
  text[],
  text[],
  boolean,
  text[]
)
owner to postgres;

revoke all
  on function public.upsert_store_commercial_ai_suggestion_policy_configured_scoped(
    uuid,
    uuid,
    boolean,
    text,
    text[],
    text[],
    text[],
    boolean,
    text[]
  )
  from public, anon, service_role;

grant execute
  on function public.upsert_store_commercial_ai_suggestion_policy_configured_scoped(
    uuid,
    uuid,
    boolean,
    text,
    text[],
    text[],
    text[],
    boolean,
    text[]
  )
  to authenticated;

-- ============================================================
-- 5. CANONICAL AGGREGATE READER
--
-- This is a read model only. Storage remains distributed across
-- the canonical domain owners listed above.
-- ============================================================

drop function if exists public.read_store_settings_experience_policies_scoped(uuid, uuid);

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
        'superior_option_suggestions_enabled',
          commercial_row.superior_option_suggestions_enabled,
        'superior_option_allowed_triggers',
          to_jsonb(commercial_row.superior_option_allowed_triggers),
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

alter function public.read_store_settings_experience_policies_scoped(uuid, uuid)
  owner to postgres;

revoke all
  on function public.read_store_settings_experience_policies_scoped(uuid, uuid)
  from public, anon, service_role;

grant execute
  on function public.read_store_settings_experience_policies_scoped(uuid, uuid)
  to authenticated;

-- ============================================================
-- 6. CANONICAL ROUTING UPSERT
--
-- NULL payload = preserve current value.
-- This keeps the current UI contract while routing each domain
-- to its real authority.
-- ============================================================

drop function if exists public.upsert_store_settings_experience_policies_scoped(
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
);

create function public.upsert_store_settings_experience_policies_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_ai_guidance jsonb default null,
  p_commercial_suggestions jsonb default null,
  p_price_extra_context jsonb default null,
  p_payment_extensions jsonb default null,
  p_payment_execution_rules jsonb default null,
  p_discount_extensions jsonb default null,
  p_quote_policy jsonb default null,
  p_post_sale_policy jsonb default null,
  p_warranty_policy jsonb default null,
  p_cancellation_policy jsonb default null,
  p_brand_visual_policy jsonb default null,
  p_contract_usage_policy jsonb default null
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
declare
  v_high_value_requires_human boolean;
begin
  perform public.assert_store_settings_experience_policies_scope(
    p_organization_id,
    p_store_id
  );

  if (p_commercial_ai_guidance is not null and pg_catalog.jsonb_typeof(p_commercial_ai_guidance) <> 'object')
     or (p_commercial_suggestions is not null and pg_catalog.jsonb_typeof(p_commercial_suggestions) <> 'object')
     or (p_price_extra_context is not null and pg_catalog.jsonb_typeof(p_price_extra_context) <> 'object')
     or (p_payment_extensions is not null and pg_catalog.jsonb_typeof(p_payment_extensions) <> 'object')
     or (p_payment_execution_rules is not null and pg_catalog.jsonb_typeof(p_payment_execution_rules) <> 'object')
     or (p_discount_extensions is not null and pg_catalog.jsonb_typeof(p_discount_extensions) <> 'object')
     or (p_quote_policy is not null and pg_catalog.jsonb_typeof(p_quote_policy) <> 'object')
     or (p_post_sale_policy is not null and pg_catalog.jsonb_typeof(p_post_sale_policy) <> 'object')
     or (p_warranty_policy is not null and pg_catalog.jsonb_typeof(p_warranty_policy) <> 'object')
     or (p_cancellation_policy is not null and pg_catalog.jsonb_typeof(p_cancellation_policy) <> 'object')
     or (p_brand_visual_policy is not null and pg_catalog.jsonb_typeof(p_brand_visual_policy) <> 'object')
     or (p_contract_usage_policy is not null and pg_catalog.jsonb_typeof(p_contract_usage_policy) <> 'object')
  then
    raise exception using
      errcode = '22023',
      message = 'settings experience policy payloads must be json objects';
  end if;

  -- Commercial AI domain. Fail-closed defaults are used only when
  -- this is the first row for the store.
  if p_commercial_suggestions is not null
     and p_commercial_suggestions <> '{}'::jsonb
  then
    raise exception using
      errcode = '22023',
      message = 'commercial_suggestions must use the canonical structured suggestion-policy writer';
  end if;

  if p_commercial_ai_guidance is not null
     or p_price_extra_context is not null
  then
    insert into public.store_commercial_ai_settings (
      organization_id,
      store_id,
      price_answer_policy,
      price_context_requirements,
      commercial_ai_guidance,
      price_extra_context
    )
    values (
      p_organization_id,
      p_store_id,
      'human_required_for_price',
      '{}'::text[],
      coalesce(p_commercial_ai_guidance, '{}'::jsonb),
      coalesce(p_price_extra_context, '{}'::jsonb)
    )
    on conflict (organization_id, store_id)
    do update
    set
      commercial_ai_guidance = coalesce(
        p_commercial_ai_guidance,
        store_commercial_ai_settings.commercial_ai_guidance
      ),
      price_extra_context = coalesce(
        p_price_extra_context,
        store_commercial_ai_settings.price_extra_context
      );
  end if;

  -- Payment extensions require the base payment authority to exist.
  -- We never invent accepted payment methods merely to persist an
  -- extension card.
  if p_payment_extensions is not null
     or p_payment_execution_rules is not null
  then
    update public.store_payment_settings payment_row
    set
      payment_extensions = coalesce(
        p_payment_extensions,
        payment_row.payment_extensions
      ),
      payment_execution_rules = coalesce(
        p_payment_execution_rules,
        payment_row.payment_execution_rules
      )
    where payment_row.organization_id = p_organization_id
      and payment_row.store_id = p_store_id;

    if not found then
      raise exception using
        errcode = '23514',
        message = 'base payment settings must be configured before payment extensions';
    end if;
  end if;

  -- High-value approval belongs to the existing high-value authority.
  if p_discount_extensions is not null then
    if p_discount_extensions ? 'high_value_requires_human' then
      if p_discount_extensions->'high_value_requires_human' = 'null'::jsonb
         or pg_catalog.jsonb_typeof(
           p_discount_extensions->'high_value_requires_human'
         ) <> 'boolean'
      then
        raise exception using
          errcode = '22023',
          message = 'high_value_requires_human must be boolean';
      end if;

      v_high_value_requires_human :=
        (p_discount_extensions->>'high_value_requires_human')::boolean;

      insert into public.store_high_value_discount_settings (
        organization_id,
        store_id,
        enabled,
        threshold_amount_cents,
        discount_percent,
        requires_human_approval,
        requires_human_approval_configured_at
      )
      values (
        p_organization_id,
        p_store_id,
        false,
        null,
        null,
        v_high_value_requires_human,
        pg_catalog.clock_timestamp()
      )
      on conflict (organization_id, store_id)
      do update
      set
        requires_human_approval = excluded.requires_human_approval,
        requires_human_approval_configured_at =
          excluded.requires_human_approval_configured_at;
    elsif p_discount_extensions <> '{}'::jsonb then
      raise exception using
        errcode = '22023',
        message = 'discount_extensions contains unsupported keys';
    end if;
  end if;

  -- Domains without a dedicated settings authority yet.
  if p_quote_policy is not null
     or p_post_sale_policy is not null
     or p_warranty_policy is not null
     or p_cancellation_policy is not null
     or p_brand_visual_policy is not null
     or p_contract_usage_policy is not null
  then
    insert into public.store_settings_experience_policies (
      organization_id,
      store_id,
      quote_policy,
      post_sale_policy,
      warranty_policy,
      cancellation_policy,
      brand_visual_policy,
      contract_usage_policy,
      configured_at
    )
    values (
      p_organization_id,
      p_store_id,
      coalesce(p_quote_policy, '{}'::jsonb),
      coalesce(p_post_sale_policy, '{}'::jsonb),
      coalesce(p_warranty_policy, '{}'::jsonb),
      coalesce(p_cancellation_policy, '{}'::jsonb),
      coalesce(p_brand_visual_policy, '{}'::jsonb),
      coalesce(p_contract_usage_policy, '{}'::jsonb),
      pg_catalog.clock_timestamp()
    )
    on conflict (organization_id, store_id)
    do update
    set
      quote_policy = coalesce(
        p_quote_policy,
        store_settings_experience_policies.quote_policy
      ),
      post_sale_policy = coalesce(
        p_post_sale_policy,
        store_settings_experience_policies.post_sale_policy
      ),
      warranty_policy = coalesce(
        p_warranty_policy,
        store_settings_experience_policies.warranty_policy
      ),
      cancellation_policy = coalesce(
        p_cancellation_policy,
        store_settings_experience_policies.cancellation_policy
      ),
      brand_visual_policy = coalesce(
        p_brand_visual_policy,
        store_settings_experience_policies.brand_visual_policy
      ),
      contract_usage_policy = coalesce(
        p_contract_usage_policy,
        store_settings_experience_policies.contract_usage_policy
      );
  end if;

  return query
  select *
  from public.read_store_settings_experience_policies_scoped(
    p_organization_id,
    p_store_id
  );
end;
$function$;

alter function public.upsert_store_settings_experience_policies_scoped(
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
)
owner to postgres;

revoke all
  on function public.upsert_store_settings_experience_policies_scoped(
    uuid,
    uuid,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb
  )
  from public, anon, service_role;

grant execute
  on function public.upsert_store_settings_experience_policies_scoped(
    uuid,
    uuid,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb
  )
  to authenticated;

commit;

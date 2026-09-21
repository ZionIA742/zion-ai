begin;

-- P19-A 3.4
-- Forward fix: payment_extensions and payment_execution_rules are shared
-- canonical JSON authorities consumed by separate Settings cards.
-- Treat incoming JSON as a partial patch so one card cannot erase keys
-- owned by another card. The applied migrations remain immutable.

create or replace function public.upsert_store_settings_experience_policies_scoped(
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
    on conflict on constraint store_commercial_ai_settings_pkey
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
      payment_extensions = case
        when p_payment_extensions is null
          then payment_row.payment_extensions
        else
          coalesce(payment_row.payment_extensions, '{}'::jsonb)
          || p_payment_extensions
      end,
      payment_execution_rules = case
        when p_payment_execution_rules is null
          then payment_row.payment_execution_rules
        else
          coalesce(payment_row.payment_execution_rules, '{}'::jsonb)
          || p_payment_execution_rules
      end
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
      on conflict on constraint store_high_value_discount_settings_pkey
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
    on conflict on constraint store_settings_experience_policies_pkey
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

commit;
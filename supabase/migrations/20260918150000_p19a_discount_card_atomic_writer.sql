begin;

create or replace function public.upsert_store_discount_card_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_default_discount_percent numeric,
  p_max_discount_percent numeric,
  p_allow_ask_above_max_discount boolean,
  p_discount_autonomy_mode text,
  p_discount_special_rules text,
  p_high_value_enabled boolean,
  p_high_value_threshold_amount_cents integer,
  p_high_value_discount_percent numeric,
  p_high_value_requires_human boolean,
  p_discount_explanation text
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public, auth, pg_temp
set row_security to off
as $function$
declare
  v_discount public.store_discount_settings%rowtype;
  v_high_value public.store_high_value_discount_settings%rowtype;

  v_high_value_enabled boolean :=
    coalesce(p_high_value_enabled, false);

  v_discount_explanation text :=
    nullif(
      pg_catalog.btrim(
        coalesce(p_discount_explanation, '')
      ),
      ''
    );
begin
  if p_organization_id is null
     or p_store_id is null
  then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if v_high_value_enabled
     and p_high_value_requires_human is null
  then
    raise exception using
      errcode = '22023',
      message =
        'high_value_requires_human is required when high-value discount is enabled';
  end if;

  /*
   * Canonical base discount authority + existing legacy mirrors:
   * - store_discount_settings
   * - can_offer_discount
   * - max_discount_percent
   * - discount_policy_summary
   * - discount_special_rules
   *
   * The delegated writer owns validation of:
   * - percentages
   * - default <= max
   * - max <= 100
   * - canonical autonomy mode
   * - authenticated organization/store scope
   */
  v_discount :=
    public.upsert_store_discount_settings_with_legacy_mirror_scoped(
      p_organization_id,
      p_store_id,
      p_default_discount_percent,
      p_max_discount_percent,
      p_allow_ask_above_max_discount,
      p_discount_autonomy_mode,
      p_discount_special_rules
    );

  /*
   * Canonical high-value authority.
   *
   * The delegated writer normalizes disabled policy to:
   * enabled=false
   * threshold_amount_cents=null
   * discount_percent=null
   */
  v_high_value :=
    public.upsert_store_high_value_discount_settings_scoped(
      p_organization_id,
      p_store_id,
      v_high_value_enabled,
      p_high_value_threshold_amount_cents,
      p_high_value_discount_percent
    );

  /*
   * Approval is part of the same high-value authority.
   *
   * When high-value policy is disabled, stale approval state must
   * disappear with the rest of that policy.
   */
  update public.store_high_value_discount_settings high_value_row
  set
    requires_human_approval =
      case
        when v_high_value_enabled
          then p_high_value_requires_human
        else null
      end,

    requires_human_approval_configured_at =
      case
        when v_high_value_enabled
          then pg_catalog.clock_timestamp()
        else null
      end
  where high_value_row.organization_id = p_organization_id
    and high_value_row.store_id = p_store_id
  returning *
  into v_high_value;

  if not found then
    raise exception using
      errcode = '23514',
      message =
        'high-value discount authority was not created';
  end if;

  /*
   * Compatibility mirror still consumed by the current Sales AI.
   * It stays inside this same RPC so the card cannot be partially
   * persisted.
   */
  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'discount_explanation',
    p_answer => to_jsonb(
      coalesce(v_discount_explanation, '')
    )
  );

  return jsonb_build_object(
    'discount_settings',
      to_jsonb(v_discount),

    'high_value_settings',
      to_jsonb(v_high_value),

    'discount_explanation',
      coalesce(v_discount_explanation, '')
  );
end;
$function$;

revoke all
on function public.upsert_store_discount_card_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text,
  text,
  boolean,
  integer,
  numeric,
  boolean,
  text
)
from public;

revoke all
on function public.upsert_store_discount_card_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text,
  text,
  boolean,
  integer,
  numeric,
  boolean,
  text
)
from anon;

revoke all
on function public.upsert_store_discount_card_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text,
  text,
  boolean,
  integer,
  numeric,
  boolean,
  text
)
from service_role;

grant execute
on function public.upsert_store_discount_card_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text,
  text,
  boolean,
  integer,
  numeric,
  boolean,
  text
)
to authenticated;

commit;
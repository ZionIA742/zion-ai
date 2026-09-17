-- P19-A / Block 3 / Front 8
-- Structured canonical authority for the Commercial Strategy card.
-- Authority remains public.store_strategy_settings.

alter table public.store_strategy_settings
  add column if not exists strategy_sell_more_choices text[] null,
  add column if not exists strategy_sell_more_other text null,
  add column if not exists strategy_sale_preference text null,
  add column if not exists strategy_sale_preference_other text null,
  add column if not exists strategy_customer_traits text[] null,
  add column if not exists strategy_customer_traits_other text null,
  add column if not exists strategy_attention_cases text[] null,
  add column if not exists strategy_attention_other text null,
  add column if not exists strategy_sale_value_range text null,
  add column if not exists strategy_sale_value_custom text null,
  add column if not exists strategy_commercial_experience_configured_at timestamptz null;

comment on column public.store_strategy_settings.strategy_sell_more_choices is
  'Canonical structured priorities selected in the Commercial Strategy card. This does not restrict other products or services offered by the store.';

comment on column public.store_strategy_settings.strategy_sell_more_other is
  'Free-text complement when the structured commercial priority selection contains the other option.';

comment on column public.store_strategy_settings.strategy_sale_preference is
  'Canonical preferred sale profile selected by the store in the Commercial Strategy card.';

comment on column public.store_strategy_settings.strategy_sale_preference_other is
  'Free-text complement for another preferred sale profile.';

comment on column public.store_strategy_settings.strategy_customer_traits is
  'Canonical customer traits that commonly fit the store operation. These traits must not be used to disadvantage other customers.';

comment on column public.store_strategy_settings.strategy_customer_traits_other is
  'Free-text complement for another customer trait selected by the store.';

comment on column public.store_strategy_settings.strategy_attention_cases is
  'Canonical situations in which Sales AI must apply extra care, collect more context, or involve a human when required by policy.';

comment on column public.store_strategy_settings.strategy_attention_other is
  'Free-text complement for another situation that requires extra care.';

comment on column public.store_strategy_settings.strategy_sale_value_range is
  'Canonical typical total-sale-value range selected in the Commercial Strategy card.';

comment on column public.store_strategy_settings.strategy_sale_value_custom is
  'Free-text value or explanation when the typical sale value uses another range or varies significantly.';

comment on column public.store_strategy_settings.strategy_commercial_experience_configured_at is
  'Timestamp of the first explicit valid save of the structured Commercial Strategy card. NULL means this structured card has not yet been configured.';

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.store_strategy_settings'::regclass
      and conname = 'store_strategy_settings_commercial_experience_shape_valid'
  ) then
    alter table public.store_strategy_settings
      add constraint store_strategy_settings_commercial_experience_shape_valid
      check (
        strategy_commercial_experience_configured_at is not null
        or (
          strategy_sell_more_choices is null
          and strategy_sell_more_other is null
          and strategy_sale_preference is null
          and strategy_sale_preference_other is null
          and strategy_customer_traits is null
          and strategy_customer_traits_other is null
          and strategy_attention_cases is null
          and strategy_attention_other is null
          and strategy_sale_value_range is null
          and strategy_sale_value_custom is null
        )
      );
  end if;
end;
$$;

create or replace function public.upsert_store_structured_commercial_strategy_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_strategy_sell_more_choices text[],
  p_strategy_sell_more_other text,
  p_strategy_sale_preference text,
  p_strategy_sale_preference_other text,
  p_strategy_customer_traits text[],
  p_strategy_customer_traits_other text,
  p_strategy_attention_cases text[],
  p_strategy_attention_other text,
  p_strategy_sale_value_range text,
  p_strategy_sale_value_custom text
)
returns public.store_strategy_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_is_member boolean;
  v_result public.store_strategy_settings%rowtype;
  v_sell_more_choices text[] := '{}'::text[];
  v_customer_traits text[] := '{}'::text[];
  v_attention_cases text[] := '{}'::text[];
  v_sell_more_other text := nullif(pg_catalog.btrim(coalesce(p_strategy_sell_more_other, '')), '');
  v_sale_preference text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_strategy_sale_preference, ''))), '');
  v_sale_preference_other text := nullif(pg_catalog.btrim(coalesce(p_strategy_sale_preference_other, '')), '');
  v_customer_traits_other text := nullif(pg_catalog.btrim(coalesce(p_strategy_customer_traits_other, '')), '');
  v_attention_other text := nullif(pg_catalog.btrim(coalesce(p_strategy_attention_other, '')), '');
  v_sale_value_range text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_strategy_sale_value_range, ''))), '');
  v_sale_value_custom text := nullif(pg_catalog.btrim(coalesce(p_strategy_sale_value_custom, '')), '');
  v_candidate text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED'
      using errcode = 'P0001',
            detail = 'AUTH_REQUIRED',
            hint = 'Apenas usuarios autenticados podem salvar a estrategia comercial estruturada.';
  end if;

  select exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_organization_id
      and membership_row.user_id = auth.uid()
      and membership_row.is_active is true
  )
  into v_is_member;

  if not coalesce(v_is_member, false) then
    raise exception 'MEMBERSHIP_REQUIRED'
      using errcode = 'P0001',
            detail = 'MEMBERSHIP_REQUIRED',
            hint = 'Usuario sem vinculacao ativa nao pode salvar a estrategia comercial estruturada.';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception 'STORE_NOT_FOUND'
      using errcode = 'P0001',
            detail = 'STORE_NOT_FOUND',
            hint = 'Loja nao encontrada no escopo informado.';
  end if;

  foreach v_candidate in array coalesce(p_strategy_sell_more_choices, '{}'::text[]) loop
    v_candidate := pg_catalog.lower(pg_catalog.btrim(coalesce(v_candidate, '')));
    if v_candidate <> '' and not (v_candidate = any(v_sell_more_choices)) then
      v_sell_more_choices := array_append(v_sell_more_choices, v_candidate);
    end if;
  end loop;

  foreach v_candidate in array coalesce(p_strategy_customer_traits, '{}'::text[]) loop
    v_candidate := pg_catalog.lower(pg_catalog.btrim(coalesce(v_candidate, '')));
    if v_candidate <> '' and not (v_candidate = any(v_customer_traits)) then
      v_customer_traits := array_append(v_customer_traits, v_candidate);
    end if;
  end loop;

  foreach v_candidate in array coalesce(p_strategy_attention_cases, '{}'::text[]) loop
    v_candidate := pg_catalog.lower(pg_catalog.btrim(coalesce(v_candidate, '')));
    if v_candidate <> '' and not (v_candidate = any(v_attention_cases)) then
      v_attention_cases := array_append(v_attention_cases, v_candidate);
    end if;
  end loop;

  if 'outro' = any(v_sell_more_choices) and v_sell_more_other is null then
    raise exception 'STRATEGY_SELL_MORE_OTHER_REQUIRED' using errcode = '22023';
  elsif not ('outro' = any(v_sell_more_choices)) then
    v_sell_more_other := null;
  end if;

  if v_sale_preference = 'outro' and v_sale_preference_other is null then
    raise exception 'STRATEGY_SALE_PREFERENCE_OTHER_REQUIRED' using errcode = '22023';
  elsif v_sale_preference is distinct from 'outro' then
    v_sale_preference_other := null;
  end if;

  if 'outro' = any(v_customer_traits) and v_customer_traits_other is null then
    raise exception 'STRATEGY_CUSTOMER_TRAITS_OTHER_REQUIRED' using errcode = '22023';
  elsif not ('outro' = any(v_customer_traits)) then
    v_customer_traits_other := null;
  end if;

  if 'outro' = any(v_attention_cases) and v_attention_other is null then
    raise exception 'STRATEGY_ATTENTION_OTHER_REQUIRED' using errcode = '22023';
  elsif not ('outro' = any(v_attention_cases)) then
    v_attention_other := null;
  end if;

  if v_sale_value_range in ('outra', 'varia_muito') and v_sale_value_custom is null then
    raise exception 'STRATEGY_SALE_VALUE_CUSTOM_REQUIRED' using errcode = '22023';
  elsif v_sale_value_range is null or v_sale_value_range not in ('outra', 'varia_muito') then
    v_sale_value_custom := null;
  end if;

  insert into public.store_strategy_settings (
    organization_id,
    store_id,
    strategy_sell_more_choices,
    strategy_sell_more_other,
    strategy_sale_preference,
    strategy_sale_preference_other,
    strategy_customer_traits,
    strategy_customer_traits_other,
    strategy_attention_cases,
    strategy_attention_other,
    strategy_sale_value_range,
    strategy_sale_value_custom,
    strategy_commercial_experience_configured_at,
    updated_at
  )
  values (
    p_organization_id,
    p_store_id,
    v_sell_more_choices,
    v_sell_more_other,
    v_sale_preference,
    v_sale_preference_other,
    v_customer_traits,
    v_customer_traits_other,
    v_attention_cases,
    v_attention_other,
    v_sale_value_range,
    v_sale_value_custom,
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (organization_id, store_id) do update
  set
    strategy_sell_more_choices = excluded.strategy_sell_more_choices,
    strategy_sell_more_other = excluded.strategy_sell_more_other,
    strategy_sale_preference = excluded.strategy_sale_preference,
    strategy_sale_preference_other = excluded.strategy_sale_preference_other,
    strategy_customer_traits = excluded.strategy_customer_traits,
    strategy_customer_traits_other = excluded.strategy_customer_traits_other,
    strategy_attention_cases = excluded.strategy_attention_cases,
    strategy_attention_other = excluded.strategy_attention_other,
    strategy_sale_value_range = excluded.strategy_sale_value_range,
    strategy_sale_value_custom = excluded.strategy_sale_value_custom,
    strategy_commercial_experience_configured_at = coalesce(
      public.store_strategy_settings.strategy_commercial_experience_configured_at,
      excluded.strategy_commercial_experience_configured_at
    ),
    updated_at = excluded.updated_at
  returning *
  into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_structured_commercial_strategy_scoped(
  uuid, uuid, text[], text, text, text, text[], text, text[], text, text, text
) owner to postgres;

revoke all on function public.upsert_store_structured_commercial_strategy_scoped(
  uuid, uuid, text[], text, text, text, text[], text, text[], text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.upsert_store_structured_commercial_strategy_scoped(
  uuid, uuid, text[], text, text, text, text[], text, text[], text, text, text
) to authenticated;

comment on function public.upsert_store_structured_commercial_strategy_scoped(
  uuid, uuid, text[], text, text, text, text[], text, text[], text, text, text
) is
  'P19-A canonical authenticated writer for the structured Commercial Strategy card. Updates only the structured strategy fields and preserves legacy strategy fields.';

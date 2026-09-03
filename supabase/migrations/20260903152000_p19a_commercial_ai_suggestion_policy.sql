create or replace function public.store_commercial_ai_complementary_scope_mode_is_valid(
  p_scope_mode text
)
returns boolean
language sql
immutable
as $function$
  select coalesce(p_scope_mode, '') in (
    'all_compatible',
    'selected_scope'
  );
$function$;

create or replace function public.store_commercial_ai_complementary_moments_are_valid(
  p_allowed_moments text[]
)
returns boolean
language sql
immutable
as $function$
  select not exists (
    select 1
    from unnest(coalesce(p_allowed_moments, '{}'::text[])) as moment
    where moment not in (
      'after_need_understood',
      'after_product_interest',
      'during_proposal_preparation',
      'customer_asks_what_else_needed'
    )
  );
$function$;

create or replace function public.store_commercial_ai_superior_triggers_are_valid(
  p_allowed_triggers text[]
)
returns boolean
language sql
immutable
as $function$
  select not exists (
    select 1
    from unnest(coalesce(p_allowed_triggers, '{}'::text[])) as trigger_value
    where trigger_value not in (
      'more_suitable_alternative',
      'customer_requests_better_option',
      'materially_relevant_advantage'
    )
  );
$function$;

alter table public.store_commercial_ai_settings
  add column if not exists complementary_suggestions_enabled boolean not null default false,
  add column if not exists complementary_scope_mode text not null default 'all_compatible',
  add column if not exists complementary_category_keys text[] not null default '{}'::text[],
  add column if not exists complementary_line_keys text[] not null default '{}'::text[],
  add column if not exists complementary_allowed_moments text[] not null default '{}'::text[],
  add column if not exists superior_option_suggestions_enabled boolean not null default false,
  add column if not exists superior_option_allowed_triggers text[] not null default '{}'::text[];

alter table public.store_commercial_ai_settings
  drop constraint if exists store_commercial_ai_settings_complementary_scope_mode_valid,
  drop constraint if exists store_commercial_ai_settings_complementary_moments_valid,
  drop constraint if exists store_commercial_ai_settings_superior_triggers_valid,
  drop constraint if exists store_commercial_ai_settings_complementary_payload_valid;

alter table public.store_commercial_ai_settings
  add constraint store_commercial_ai_settings_complementary_scope_mode_valid
    check (public.store_commercial_ai_complementary_scope_mode_is_valid(complementary_scope_mode)),
  add constraint store_commercial_ai_settings_complementary_moments_valid
    check (public.store_commercial_ai_complementary_moments_are_valid(complementary_allowed_moments)),
  add constraint store_commercial_ai_settings_superior_triggers_valid
    check (public.store_commercial_ai_superior_triggers_are_valid(superior_option_allowed_triggers)),
  add constraint store_commercial_ai_settings_complementary_payload_valid
    check (
      complementary_suggestions_enabled is false
      or complementary_scope_mode <> 'selected_scope'
      or cardinality(complementary_category_keys) > 0
      or cardinality(complementary_line_keys) > 0
    );

create or replace function public.store_commercial_ai_normalize_text_array(
  p_values text[]
)
returns text[]
language sql
immutable
as $function$
  select coalesce(array_agg(value order by first_position, value), '{}'::text[])
  from (
    select
      pg_catalog.lower(pg_catalog.btrim(value)) as value,
      min(ordinality) as first_position
    from unnest(coalesce(p_values, '{}'::text[]))
      with ordinality as value_row(value, ordinality)
    where nullif(pg_catalog.btrim(value), '') is not null
    group by pg_catalog.lower(pg_catalog.btrim(value))
  ) normalized;
$function$;

create or replace function public.store_commercial_ai_normalize_category_keys(
  p_values text[]
)
returns text[]
language sql
immutable
as $function$
  select coalesce(array_agg(value order by first_position, value), '{}'::text[])
  from (
    select
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(
          pg_catalog.lower(pg_catalog.btrim(value)),
          '[^a-z0-9_-]+',
          '_',
          'g'
        ),
        '^_+|_+$',
        '',
        'g'
      ) as value,
      min(ordinality) as first_position
    from unnest(coalesce(p_values, '{}'::text[]))
      with ordinality as value_row(value, ordinality)
    where nullif(pg_catalog.btrim(value), '') is not null
    group by pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.btrim(value)),
        '[^a-z0-9_-]+',
        '_',
        'g'
      ),
      '^_+|_+$',
      '',
      'g'
    )
  ) normalized
  where value <> '';
$function$;

create or replace function public.upsert_store_commercial_ai_suggestion_policy_scoped(
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
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_complementary_enabled boolean := coalesce(p_complementary_suggestions_enabled, false);
  v_complementary_scope_mode text := pg_catalog.lower(
    nullif(pg_catalog.btrim(coalesce(p_complementary_scope_mode, '')), '')
  );
  v_complementary_category_keys text[];
  v_complementary_line_keys text[];
  v_complementary_allowed_moments text[];
  v_superior_enabled boolean := coalesce(p_superior_option_suggestions_enabled, false);
  v_superior_allowed_triggers text[];
  v_existing public.store_commercial_ai_settings%rowtype;
  v_result public.store_commercial_ai_settings%rowtype;
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
        message = 'store commercial AI suggestion policy scope is not authorized';
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
        message = 'store commercial AI suggestion policy scope is not authorized';
    end if;
  elsif v_request_role = 'postgres' then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store commercial AI suggestion policy scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store commercial AI suggestion policy scope is not authorized';
  end if;

  v_complementary_scope_mode := coalesce(v_complementary_scope_mode, 'all_compatible');
  if not public.store_commercial_ai_complementary_scope_mode_is_valid(v_complementary_scope_mode) then
    raise exception using
      errcode = '23514',
      message = 'complementary_scope_mode is invalid';
  end if;

  v_complementary_category_keys :=
    public.store_commercial_ai_normalize_category_keys(p_complementary_category_keys);
  v_complementary_line_keys :=
    public.store_commercial_ai_normalize_category_keys(p_complementary_line_keys);
  v_complementary_allowed_moments :=
    public.store_commercial_ai_normalize_text_array(p_complementary_allowed_moments);
  v_superior_allowed_triggers :=
    public.store_commercial_ai_normalize_text_array(p_superior_option_allowed_triggers);

  if not v_complementary_enabled then
    v_complementary_scope_mode := 'all_compatible';
    v_complementary_category_keys := '{}'::text[];
    v_complementary_line_keys := '{}'::text[];
    v_complementary_allowed_moments := '{}'::text[];
  end if;

  if not v_superior_enabled then
    v_superior_allowed_triggers := '{}'::text[];
  end if;

  if not public.store_commercial_ai_complementary_moments_are_valid(v_complementary_allowed_moments) then
    raise exception using
      errcode = '23514',
      message = 'complementary_allowed_moments contains invalid values';
  end if;

  if not public.store_commercial_ai_superior_triggers_are_valid(v_superior_allowed_triggers) then
    raise exception using
      errcode = '23514',
      message = 'superior_option_allowed_triggers contains invalid values';
  end if;

  if (
    v_complementary_enabled
    and v_complementary_scope_mode = 'selected_scope'
    and cardinality(v_complementary_category_keys) = 0
    and cardinality(v_complementary_line_keys) = 0
  ) then
    raise exception using
      errcode = '23514',
      message = 'complementary_category_keys or complementary_line_keys is required for selected_scope';
  end if;

  select *
  into v_existing
  from public.store_commercial_ai_settings existing_row
  where existing_row.organization_id = p_organization_id
    and existing_row.store_id = p_store_id
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
    superior_option_suggestions_enabled,
    superior_option_allowed_triggers
  )
  values (
    p_organization_id,
    p_store_id,
    coalesce(v_existing.price_answer_policy, 'human_required_for_price'),
    coalesce(v_existing.price_context_requirements, '{}'::text[]),
    v_complementary_enabled,
    v_complementary_scope_mode,
    v_complementary_category_keys,
    v_complementary_line_keys,
    v_complementary_allowed_moments,
    v_superior_enabled,
    v_superior_allowed_triggers
  )
  on conflict (organization_id, store_id)
  do update
    set complementary_suggestions_enabled = excluded.complementary_suggestions_enabled,
        complementary_scope_mode = excluded.complementary_scope_mode,
        complementary_category_keys = excluded.complementary_category_keys,
        complementary_line_keys = excluded.complementary_line_keys,
        complementary_allowed_moments = excluded.complementary_allowed_moments,
        superior_option_suggestions_enabled = excluded.superior_option_suggestions_enabled,
        superior_option_allowed_triggers = excluded.superior_option_allowed_triggers
  returning *
  into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_commercial_ai_suggestion_policy_scoped(
  uuid,
  uuid,
  boolean,
  text,
  text[],
  text[],
  text[],
  boolean,
  text[]
) owner to postgres;

revoke all on function public.store_commercial_ai_complementary_scope_mode_is_valid(text)
  from public, anon, authenticated, service_role;
revoke all on function public.store_commercial_ai_complementary_moments_are_valid(text[])
  from public, anon, authenticated, service_role;
revoke all on function public.store_commercial_ai_superior_triggers_are_valid(text[])
  from public, anon, authenticated, service_role;
revoke all on function public.store_commercial_ai_normalize_text_array(text[])
  from public, anon, authenticated, service_role;
revoke all on function public.store_commercial_ai_normalize_category_keys(text[])
  from public, anon, authenticated, service_role;
revoke all on function public.upsert_store_commercial_ai_suggestion_policy_scoped(
  uuid,
  uuid,
  boolean,
  text,
  text[],
  text[],
  text[],
  boolean,
  text[]
) from public, anon, authenticated, service_role;

grant execute on function public.upsert_store_commercial_ai_suggestion_policy_scoped(
  uuid,
  uuid,
  boolean,
  text,
  text[],
  text[],
  text[],
  boolean,
  text[]
) to authenticated;

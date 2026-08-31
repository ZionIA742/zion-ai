create or replace function public.store_strategy_settings_region_modes_are_valid(
  p_service_region_modes text[]
)
returns boolean
language sql
immutable
as $function$
  select not exists (
    select 1
    from unnest(coalesce(p_service_region_modes, '{}'::text[])) as region_mode
    where region_mode not in (
      'somente_cidade_loja',
      'cidade_e_vizinhas',
      'grande_regiao',
      'todo_estado',
      'sob_consulta'
    )
  );
$function$;

create or replace function public.store_strategy_settings_services_are_valid(
  p_store_services text[]
)
returns boolean
language sql
immutable
as $function$
  select not exists (
    select 1
    from unnest(coalesce(p_store_services, '{}'::text[])) as store_service
    where store_service not in (
      'venda_piscinas',
      'instalacao_piscinas',
      'venda_produtos_quimicos',
      'venda_acessorios',
      'visita_tecnica',
      'manutencao'
    )
  );
$function$;

create table if not exists public.store_strategy_settings (
  organization_id uuid not null,
  store_id uuid not null,
  city text,
  state text,
  service_regions text,
  service_region_modes text[] not null default '{}'::text[],
  service_region_primary_mode text,
  service_region_outside_consultation boolean not null default false,
  service_region_notes text,
  store_services text[] not null default '{}'::text[],
  store_services_other text,
  store_description text,
  main_store_brand text,
  brands_worked text,
  strategy_service_exclusions text,
  strategy_primary_focus text,
  strategy_sell_more text,
  strategy_common_customer text,
  strategy_ideal_customer text,
  strategy_ticket_range text,
  strategy_positioning text,
  strategy_priority_brands text,
  strategy_non_worked_brands text,
  strategy_top_lines text,
  strategy_top_products text,
  strategy_differentials text,
  strategy_promise_limits text,
  strategy_ai_presentation text,
  strategy_ai_priorities text,
  strategy_ai_never_forget text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint store_strategy_settings_pkey primary key (organization_id, store_id),
  constraint store_strategy_settings_store_scope_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete cascade,
  constraint store_strategy_settings_region_modes_allowed
    check (public.store_strategy_settings_region_modes_are_valid(service_region_modes)),
  constraint store_strategy_settings_services_allowed
    check (public.store_strategy_settings_services_are_valid(store_services)),
  constraint store_strategy_settings_primary_region_mode_valid
    check (
      service_region_primary_mode is null
      or service_region_primary_mode in (
        'somente_cidade_loja',
        'cidade_e_vizinhas',
        'grande_regiao',
        'todo_estado'
      )
    )
);

create or replace function public.touch_store_strategy_settings_updated_at()
returns trigger
language plpgsql
as $function$
begin
  -- clock_timestamp() is intentionally used instead of now():
  -- the manual runner validates multiple updates inside one transaction.
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

drop trigger if exists store_strategy_settings_touch_updated_at
  on public.store_strategy_settings;

create trigger store_strategy_settings_touch_updated_at
before update on public.store_strategy_settings
for each row
execute function public.touch_store_strategy_settings_updated_at();

-- Conservative legacy backfill.
-- Any explicit conflict or malformed structured value keeps that store on the
-- legacy fallback instead of materializing an ambiguous canonical decision.
with legacy_strategy_answers as (
  select
    answer_row.organization_id,
    answer_row.store_id,
    answer_row.question_key,
    answer_row.answer,
    nullif(pg_catalog.btrim(answer_row.answer #>> '{}'), '') as answer_text,
    case
      when answer_row.question_key = 'service_region_primary_mode'
        then pg_catalog.lower(
          nullif(pg_catalog.btrim(answer_row.answer #>> '{}'), '')
        )
      when answer_row.question_key in (
        'service_region_modes',
        'service_region_outside_consultation',
        'store_services'
      )
        then case
          when answer_row.answer is null
            or answer_row.answer = 'null'::jsonb
          then null
          else answer_row.answer::text
        end
      else nullif(pg_catalog.btrim(answer_row.answer #>> '{}'), '')
    end as compare_value
  from public.store_onboarding_answers answer_row
  where answer_row.question_key in (
    'city',
    'state',
    'service_regions',
    'service_region_modes',
    'service_region_primary_mode',
    'service_region_outside_consultation',
    'service_region_notes',
    'store_services',
    'store_services_other',
    'store_description',
    'main_store_brand',
    'brands_worked',
    'strategy_service_exclusions',
    'strategy_primary_focus',
    'strategy_sell_more',
    'strategy_common_customer',
    'strategy_ideal_customer',
    'strategy_ticket_range',
    'strategy_positioning',
    'strategy_priority_brands',
    'strategy_non_worked_brands',
    'strategy_top_lines',
    'strategy_top_products',
    'strategy_differentials',
    'strategy_promise_limits',
    'strategy_ai_presentation',
    'strategy_ai_priorities',
    'strategy_ai_never_forget'
  )
),
legacy_strategy_scopes as (
  select distinct organization_id, store_id
  from legacy_strategy_answers
),
legacy_strategy_backfill_eligibility as (
  select
    scope_row.organization_id,
    scope_row.store_id,

    not exists (
      select 1
      from legacy_strategy_answers conflict_row
      where conflict_row.organization_id = scope_row.organization_id
        and conflict_row.store_id = scope_row.store_id
      group by conflict_row.question_key
      having count(distinct conflict_row.compare_value)
        filter (where conflict_row.compare_value is not null) > 1
    ) as no_conflicts,

    not exists (
      select 1
      from legacy_strategy_answers invalid_row
      where invalid_row.organization_id = scope_row.organization_id
        and invalid_row.store_id = scope_row.store_id
        and (
          (
            invalid_row.question_key = 'service_region_modes'
            and invalid_row.answer is not null
            and invalid_row.answer <> 'null'::jsonb
            and case
              when pg_catalog.jsonb_typeof(invalid_row.answer) <> 'array'
                then true
              else exists (
                select 1
                from pg_catalog.jsonb_array_elements_text(invalid_row.answer) as value
                where nullif(pg_catalog.btrim(value), '') is null
                   or pg_catalog.lower(pg_catalog.btrim(value)) not in (
                      'somente_cidade_loja',
                      'cidade_e_vizinhas',
                      'grande_regiao',
                      'todo_estado',
                      'sob_consulta'
                   )
              )
            end
          )
          or (
            invalid_row.question_key = 'store_services'
            and invalid_row.answer is not null
            and invalid_row.answer <> 'null'::jsonb
            and case
              when pg_catalog.jsonb_typeof(invalid_row.answer) <> 'array'
                then true
              else exists (
                select 1
                from pg_catalog.jsonb_array_elements_text(invalid_row.answer) as value
                where nullif(pg_catalog.btrim(value), '') is null
                   or pg_catalog.lower(pg_catalog.btrim(value)) not in (
                      'venda_piscinas',
                      'instalacao_piscinas',
                      'venda_produtos_quimicos',
                      'venda_acessorios',
                      'visita_tecnica',
                      'manutencao'
                   )
              )
            end
          )
          or (
            invalid_row.question_key = 'service_region_outside_consultation'
            and invalid_row.answer is not null
            and invalid_row.answer <> 'null'::jsonb
            and pg_catalog.jsonb_typeof(invalid_row.answer) <> 'boolean'
          )
          or (
            invalid_row.question_key = 'service_region_primary_mode'
            and invalid_row.answer_text is not null
            and pg_catalog.lower(pg_catalog.btrim(invalid_row.answer_text)) not in (
                  'somente_cidade_loja',
                  'cidade_e_vizinhas',
                  'grande_regiao',
                  'todo_estado'
            )
          )
        )
    ) as structured_values_valid
  from legacy_strategy_scopes scope_row
),
legacy_strategy_grouped as (
  select
    organization_id,
    store_id,
    max(answer_text) filter (
      where question_key = 'city'
        and answer_text is not null
    ) as city,
    max(answer_text) filter (
      where question_key = 'state'
        and answer_text is not null
    ) as state,
    max(answer_text) filter (
      where question_key = 'service_regions'
        and answer_text is not null
    ) as service_regions,
    max(answer::text) filter (
      where question_key = 'service_region_modes'
        and pg_catalog.jsonb_typeof(answer) = 'array'
    ) as service_region_modes_json,
    max(pg_catalog.lower(pg_catalog.btrim(answer_text))) filter (
      where question_key = 'service_region_primary_mode'
        and answer_text is not null
    ) as service_region_primary_mode,
    bool_or((answer #>> '{}')::boolean) filter (
      where question_key = 'service_region_outside_consultation'
        and pg_catalog.jsonb_typeof(answer) = 'boolean'
    ) as service_region_outside_consultation,
    max(answer_text) filter (
      where question_key = 'service_region_notes'
        and answer_text is not null
    ) as service_region_notes,
    max(answer::text) filter (
      where question_key = 'store_services'
        and pg_catalog.jsonb_typeof(answer) = 'array'
    ) as store_services_json,
    max(answer_text) filter (
      where question_key = 'store_services_other'
        and answer_text is not null
    ) as store_services_other,
    max(answer_text) filter (
      where question_key = 'store_description'
        and answer_text is not null
    ) as store_description,
    max(answer_text) filter (
      where question_key = 'main_store_brand'
        and answer_text is not null
    ) as main_store_brand,
    max(answer_text) filter (
      where question_key = 'brands_worked'
        and answer_text is not null
    ) as brands_worked,
    max(answer_text) filter (
      where question_key = 'strategy_service_exclusions'
        and answer_text is not null
    ) as strategy_service_exclusions,
    max(answer_text) filter (
      where question_key = 'strategy_primary_focus'
        and answer_text is not null
    ) as strategy_primary_focus,
    max(answer_text) filter (
      where question_key = 'strategy_sell_more'
        and answer_text is not null
    ) as strategy_sell_more,
    max(answer_text) filter (
      where question_key = 'strategy_common_customer'
        and answer_text is not null
    ) as strategy_common_customer,
    max(answer_text) filter (
      where question_key = 'strategy_ideal_customer'
        and answer_text is not null
    ) as strategy_ideal_customer,
    max(answer_text) filter (
      where question_key = 'strategy_ticket_range'
        and answer_text is not null
    ) as strategy_ticket_range,
    max(answer_text) filter (
      where question_key = 'strategy_positioning'
        and answer_text is not null
    ) as strategy_positioning,
    max(answer_text) filter (
      where question_key = 'strategy_priority_brands'
        and answer_text is not null
    ) as strategy_priority_brands,
    max(answer_text) filter (
      where question_key = 'strategy_non_worked_brands'
        and answer_text is not null
    ) as strategy_non_worked_brands,
    max(answer_text) filter (
      where question_key = 'strategy_top_lines'
        and answer_text is not null
    ) as strategy_top_lines,
    max(answer_text) filter (
      where question_key = 'strategy_top_products'
        and answer_text is not null
    ) as strategy_top_products,
    max(answer_text) filter (
      where question_key = 'strategy_differentials'
        and answer_text is not null
    ) as strategy_differentials,
    max(answer_text) filter (
      where question_key = 'strategy_promise_limits'
        and answer_text is not null
    ) as strategy_promise_limits,
    max(answer_text) filter (
      where question_key = 'strategy_ai_presentation'
        and answer_text is not null
    ) as strategy_ai_presentation,
    max(answer_text) filter (
      where question_key = 'strategy_ai_priorities'
        and answer_text is not null
    ) as strategy_ai_priorities,
    max(answer_text) filter (
      where question_key = 'strategy_ai_never_forget'
        and answer_text is not null
    ) as strategy_ai_never_forget
  from legacy_strategy_answers
  group by organization_id, store_id
)
insert into public.store_strategy_settings (
  organization_id,
    store_id,
    city,
    state,
    service_regions,
    service_region_modes,
    service_region_primary_mode,
    service_region_outside_consultation,
    service_region_notes,
    store_services,
    store_services_other,
    store_description,
    main_store_brand,
    brands_worked,
    strategy_service_exclusions,
    strategy_primary_focus,
    strategy_sell_more,
    strategy_common_customer,
    strategy_ideal_customer,
    strategy_ticket_range,
    strategy_positioning,
    strategy_priority_brands,
    strategy_non_worked_brands,
    strategy_top_lines,
    strategy_top_products,
    strategy_differentials,
    strategy_promise_limits,
    strategy_ai_presentation,
    strategy_ai_priorities,
    strategy_ai_never_forget
)
select
  legacy_row.organization_id,
  legacy_row.store_id,
  legacy_row.city,
  legacy_row.state,
  legacy_row.service_regions,
  coalesce(
    array(
      select distinct pg_catalog.lower(pg_catalog.btrim(value))
      from pg_catalog.jsonb_array_elements_text(
        coalesce(legacy_row.service_region_modes_json, '[]')::jsonb
      ) as value
      where pg_catalog.lower(pg_catalog.btrim(value)) in (
        'somente_cidade_loja',
        'cidade_e_vizinhas',
        'grande_regiao',
        'todo_estado',
        'sob_consulta'
      )
      order by 1
    ),
    '{}'::text[]
  ),
  case
    when legacy_row.service_region_primary_mode in (
      'somente_cidade_loja',
      'cidade_e_vizinhas',
      'grande_regiao',
      'todo_estado'
    ) then legacy_row.service_region_primary_mode
    else null
  end,
  coalesce(
    legacy_row.service_region_outside_consultation,
    exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(
        coalesce(legacy_row.service_region_modes_json, '[]')::jsonb
      ) as value
      where pg_catalog.lower(pg_catalog.btrim(value)) = 'sob_consulta'
    ),
    false
  ),
  legacy_row.service_region_notes,
  coalesce(
    array(
      select distinct pg_catalog.lower(pg_catalog.btrim(value))
      from pg_catalog.jsonb_array_elements_text(
        coalesce(legacy_row.store_services_json, '[]')::jsonb
      ) as value
      where pg_catalog.lower(pg_catalog.btrim(value)) in (
        'venda_piscinas',
        'instalacao_piscinas',
        'venda_produtos_quimicos',
        'venda_acessorios',
        'visita_tecnica',
        'manutencao'
      )
      order by 1
    ),
    '{}'::text[]
  ),
  legacy_row.store_services_other,
  legacy_row.store_description,
  legacy_row.main_store_brand,
  legacy_row.brands_worked,
  legacy_row.strategy_service_exclusions,
  legacy_row.strategy_primary_focus,
  legacy_row.strategy_sell_more,
  legacy_row.strategy_common_customer,
  legacy_row.strategy_ideal_customer,
  legacy_row.strategy_ticket_range,
  legacy_row.strategy_positioning,
  legacy_row.strategy_priority_brands,
  legacy_row.strategy_non_worked_brands,
  legacy_row.strategy_top_lines,
  legacy_row.strategy_top_products,
  legacy_row.strategy_differentials,
  legacy_row.strategy_promise_limits,
  legacy_row.strategy_ai_presentation,
  legacy_row.strategy_ai_priorities,
  legacy_row.strategy_ai_never_forget
from legacy_strategy_grouped legacy_row
join legacy_strategy_backfill_eligibility eligibility
  on eligibility.organization_id = legacy_row.organization_id
 and eligibility.store_id = legacy_row.store_id
where eligibility.no_conflicts is true
  and eligibility.structured_values_valid is true
  and exists (
    select 1
    from legacy_strategy_answers materialized_answer
    where materialized_answer.organization_id = legacy_row.organization_id
      and materialized_answer.store_id = legacy_row.store_id
      and materialized_answer.compare_value is not null
  )
on conflict (organization_id, store_id) do nothing;

alter table public.store_strategy_settings enable row level security;

revoke all on table public.store_strategy_settings from public;
revoke all on table public.store_strategy_settings from anon;
revoke all on table public.store_strategy_settings from authenticated;
revoke all on table public.store_strategy_settings from service_role;

grant select on table public.store_strategy_settings to authenticated;

drop policy if exists store_strategy_settings_select_by_active_membership
  on public.store_strategy_settings;

create policy store_strategy_settings_select_by_active_membership
  on public.store_strategy_settings
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = store_strategy_settings.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    and exists (
      select 1
      from public.stores store_row
      where store_row.id = store_strategy_settings.store_id
        and store_row.organization_id = store_strategy_settings.organization_id
    )
  );

drop policy if exists store_strategy_settings_insert_by_active_membership
  on public.store_strategy_settings;
drop policy if exists store_strategy_settings_update_by_active_membership
  on public.store_strategy_settings;

create or replace function public.store_strategy_settings_build_ai_store_summary(
  p_store_description text,
  p_strategy_primary_focus text,
  p_strategy_positioning text,
  p_strategy_sell_more text,
  p_service_regions text,
  p_service_region_modes text[],
  p_store_services text[],
  p_store_services_other text,
  p_main_store_brand text,
  p_strategy_priority_brands text,
  p_strategy_differentials text,
  p_strategy_promise_limits text
)
returns text
language plpgsql
immutable
as $function$
declare
  v_parts text[] := '{}'::text[];
begin
  if nullif(pg_catalog.btrim(coalesce(p_store_description, '')), '') is not null then
    v_parts := v_parts || pg_catalog.btrim(p_store_description);
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_strategy_primary_focus, '')), '') is not null then
    v_parts := v_parts || pg_catalog.btrim(p_strategy_primary_focus);
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_strategy_positioning, '')), '') is not null then
    v_parts := v_parts || pg_catalog.btrim(p_strategy_positioning);
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_strategy_sell_more, '')), '') is not null then
    v_parts := v_parts || concat('Vender mais: ', pg_catalog.btrim(p_strategy_sell_more));
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_service_regions, '')), '') is not null then
    v_parts := v_parts || concat('Regiao: ', pg_catalog.btrim(p_service_regions));
  end if;
  if coalesce(pg_catalog.array_length(p_service_region_modes, 1), 0) > 0 then
    v_parts := v_parts || concat('Cobertura: ', array_to_string(p_service_region_modes, ', '));
  end if;
  if coalesce(pg_catalog.array_length(p_store_services, 1), 0) > 0 then
    v_parts := v_parts || concat('Servicos: ', array_to_string(p_store_services, ', '));
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_store_services_other, '')), '') is not null then
    v_parts := v_parts || concat('Outros servicos: ', pg_catalog.btrim(p_store_services_other));
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_main_store_brand, '')), '') is not null then
    v_parts := v_parts || concat('Marca principal: ', pg_catalog.btrim(p_main_store_brand));
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_strategy_priority_brands, '')), '') is not null then
    v_parts := v_parts || concat('Prioridades: ', pg_catalog.btrim(p_strategy_priority_brands));
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_strategy_differentials, '')), '') is not null then
    v_parts := v_parts || concat('Diferenciais: ', pg_catalog.btrim(p_strategy_differentials));
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_strategy_promise_limits, '')), '') is not null then
    v_parts := v_parts || concat('Limites: ', pg_catalog.btrim(p_strategy_promise_limits));
  end if;

  return array_to_string(v_parts, ' | ');
end;
$function$;

create or replace function public.upsert_store_strategy_settings_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_city text default null,
  p_state text default null,
  p_service_regions text default null,
  p_service_region_modes text[] default '{}'::text[],
  p_service_region_primary_mode text default null,
  p_service_region_outside_consultation boolean default false,
  p_service_region_notes text default null,
  p_store_services text[] default '{}'::text[],
  p_store_services_other text default null,
  p_store_description text default null,
  p_main_store_brand text default null,
  p_brands_worked text default null,
  p_strategy_service_exclusions text default null,
  p_strategy_primary_focus text default null,
  p_strategy_sell_more text default null,
  p_strategy_common_customer text default null,
  p_strategy_ideal_customer text default null,
  p_strategy_ticket_range text default null,
  p_strategy_positioning text default null,
  p_strategy_priority_brands text default null,
  p_strategy_non_worked_brands text default null,
  p_strategy_top_lines text default null,
  p_strategy_top_products text default null,
  p_strategy_differentials text default null,
  p_strategy_promise_limits text default null,
  p_strategy_ai_presentation text default null,
  p_strategy_ai_priorities text default null,
  p_strategy_ai_never_forget text default null
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
  v_city text := nullif(pg_catalog.btrim(coalesce(p_city, '')), '');
  v_state text := nullif(pg_catalog.btrim(coalesce(p_state, '')), '');
  v_service_regions text := nullif(pg_catalog.btrim(coalesce(p_service_regions, '')), '');
  v_service_region_primary_mode text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_service_region_primary_mode, ''))), '');
  v_service_region_notes text := nullif(pg_catalog.btrim(coalesce(p_service_region_notes, '')), '');
  v_store_services_other text := nullif(pg_catalog.btrim(coalesce(p_store_services_other, '')), '');
  v_store_description text := nullif(pg_catalog.btrim(coalesce(p_store_description, '')), '');
  v_main_store_brand text := nullif(pg_catalog.btrim(coalesce(p_main_store_brand, '')), '');
  v_brands_worked text := nullif(pg_catalog.btrim(coalesce(p_brands_worked, '')), '');
  v_strategy_service_exclusions text := nullif(pg_catalog.btrim(coalesce(p_strategy_service_exclusions, '')), '');
  v_strategy_primary_focus text := nullif(pg_catalog.btrim(coalesce(p_strategy_primary_focus, '')), '');
  v_strategy_sell_more text := nullif(pg_catalog.btrim(coalesce(p_strategy_sell_more, '')), '');
  v_strategy_common_customer text := nullif(pg_catalog.btrim(coalesce(p_strategy_common_customer, '')), '');
  v_strategy_ideal_customer text := nullif(pg_catalog.btrim(coalesce(p_strategy_ideal_customer, '')), '');
  v_strategy_ticket_range text := nullif(pg_catalog.btrim(coalesce(p_strategy_ticket_range, '')), '');
  v_strategy_positioning text := nullif(pg_catalog.btrim(coalesce(p_strategy_positioning, '')), '');
  v_strategy_priority_brands text := nullif(pg_catalog.btrim(coalesce(p_strategy_priority_brands, '')), '');
  v_strategy_non_worked_brands text := nullif(pg_catalog.btrim(coalesce(p_strategy_non_worked_brands, '')), '');
  v_strategy_top_lines text := nullif(pg_catalog.btrim(coalesce(p_strategy_top_lines, '')), '');
  v_strategy_top_products text := nullif(pg_catalog.btrim(coalesce(p_strategy_top_products, '')), '');
  v_strategy_differentials text := nullif(pg_catalog.btrim(coalesce(p_strategy_differentials, '')), '');
  v_strategy_promise_limits text := nullif(pg_catalog.btrim(coalesce(p_strategy_promise_limits, '')), '');
  v_strategy_ai_presentation text := nullif(pg_catalog.btrim(coalesce(p_strategy_ai_presentation, '')), '');
  v_strategy_ai_priorities text := nullif(pg_catalog.btrim(coalesce(p_strategy_ai_priorities, '')), '');
  v_strategy_ai_never_forget text := nullif(pg_catalog.btrim(coalesce(p_strategy_ai_never_forget, '')), '');
  v_service_region_outside_consultation boolean :=
    coalesce(p_service_region_outside_consultation, false);
  v_service_region_modes text[] := '{}'::text[];
  v_store_services text[] := '{}'::text[];
  v_candidate text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED'
      using errcode = 'P0001',
            detail = 'AUTH_REQUIRED',
            hint = 'Apenas usuarios autenticados podem salvar configuracoes canonicas de estrategia.';
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
            hint = 'Usuario sem vinculacao ativa nao pode salvar configuracoes canonicas de estrategia.';
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

  foreach v_candidate in array coalesce(p_service_region_modes, '{}'::text[]) loop
    v_candidate := pg_catalog.lower(pg_catalog.btrim(coalesce(v_candidate, '')));
    if v_candidate = '' then
      continue;
    end if;
    if v_candidate not in (
      'somente_cidade_loja',
      'cidade_e_vizinhas',
      'grande_regiao',
      'todo_estado',
      'sob_consulta'
    ) then
      raise exception 'SERVICE_REGION_MODE_INVALID'
        using errcode = 'P0001',
              detail = 'SERVICE_REGION_MODE_INVALID',
              hint = 'Modo de cobertura regional invalido.';
    end if;
    if not (v_candidate = any(v_service_region_modes)) then
      v_service_region_modes := array_append(v_service_region_modes, v_candidate);
    end if;
  end loop;

  if v_service_region_primary_mode is not null
     and v_service_region_primary_mode not in (
        'somente_cidade_loja',
        'cidade_e_vizinhas',
        'grande_regiao',
        'todo_estado'
     )
  then
    raise exception 'SERVICE_REGION_PRIMARY_MODE_INVALID'
      using errcode = 'P0001',
            detail = 'SERVICE_REGION_PRIMARY_MODE_INVALID',
            hint = 'Cobertura principal invalida.';
  end if;

  if v_service_region_primary_mode is not null
     and not (v_service_region_primary_mode = any(v_service_region_modes))
  then
    v_service_region_modes := array_append(
      v_service_region_modes,
      v_service_region_primary_mode
    );
  end if;

  if v_service_region_outside_consultation then
    if not ('sob_consulta' = any(v_service_region_modes)) then
      v_service_region_modes := array_append(
        v_service_region_modes,
        'sob_consulta'
      );
    end if;
  else
    select coalesce(
      array_agg(region_row.region_mode order by region_row.ordinality),
      '{}'::text[]
    )
    into v_service_region_modes
    from unnest(v_service_region_modes) with ordinality
      as region_row(region_mode, ordinality)
    where region_row.region_mode <> 'sob_consulta';
  end if;

  foreach v_candidate in array coalesce(p_store_services, '{}'::text[]) loop
    v_candidate := pg_catalog.lower(pg_catalog.btrim(coalesce(v_candidate, '')));
    if v_candidate = '' then
      continue;
    end if;
    if v_candidate not in (
      'venda_piscinas',
      'instalacao_piscinas',
      'venda_produtos_quimicos',
      'venda_acessorios',
      'visita_tecnica',
      'manutencao'
    ) then
      raise exception 'STORE_SERVICE_INVALID'
        using errcode = 'P0001',
              detail = 'STORE_SERVICE_INVALID',
              hint = 'Servico principal invalido.';
    end if;
    if not (v_candidate = any(v_store_services)) then
      v_store_services := array_append(v_store_services, v_candidate);
    end if;
  end loop;

  insert into public.store_strategy_settings (
    organization_id,
    store_id,
    city,
    state,
    service_regions,
    service_region_modes,
    service_region_primary_mode,
    service_region_outside_consultation,
    service_region_notes,
    store_services,
    store_services_other,
    store_description,
    main_store_brand,
    brands_worked,
    strategy_service_exclusions,
    strategy_primary_focus,
    strategy_sell_more,
    strategy_common_customer,
    strategy_ideal_customer,
    strategy_ticket_range,
    strategy_positioning,
    strategy_priority_brands,
    strategy_non_worked_brands,
    strategy_top_lines,
    strategy_top_products,
    strategy_differentials,
    strategy_promise_limits,
    strategy_ai_presentation,
    strategy_ai_priorities,
    strategy_ai_never_forget
  )
  values (
    p_organization_id,
    p_store_id,
    v_city,
    v_state,
    v_service_regions,
    v_service_region_modes,
    v_service_region_primary_mode,
    v_service_region_outside_consultation,
    v_service_region_notes,
    v_store_services,
    v_store_services_other,
    v_store_description,
    v_main_store_brand,
    v_brands_worked,
    v_strategy_service_exclusions,
    v_strategy_primary_focus,
    v_strategy_sell_more,
    v_strategy_common_customer,
    v_strategy_ideal_customer,
    v_strategy_ticket_range,
    v_strategy_positioning,
    v_strategy_priority_brands,
    v_strategy_non_worked_brands,
    v_strategy_top_lines,
    v_strategy_top_products,
    v_strategy_differentials,
    v_strategy_promise_limits,
    v_strategy_ai_presentation,
    v_strategy_ai_priorities,
    v_strategy_ai_never_forget
  )
  on conflict (organization_id, store_id) do update
  set
    city = excluded.city,
    state = excluded.state,
    service_regions = excluded.service_regions,
    service_region_modes = excluded.service_region_modes,
    service_region_primary_mode = excluded.service_region_primary_mode,
    service_region_outside_consultation = excluded.service_region_outside_consultation,
    service_region_notes = excluded.service_region_notes,
    store_services = excluded.store_services,
    store_services_other = excluded.store_services_other,
    store_description = excluded.store_description,
    main_store_brand = excluded.main_store_brand,
    brands_worked = excluded.brands_worked,
    strategy_service_exclusions = excluded.strategy_service_exclusions,
    strategy_primary_focus = excluded.strategy_primary_focus,
    strategy_sell_more = excluded.strategy_sell_more,
    strategy_common_customer = excluded.strategy_common_customer,
    strategy_ideal_customer = excluded.strategy_ideal_customer,
    strategy_ticket_range = excluded.strategy_ticket_range,
    strategy_positioning = excluded.strategy_positioning,
    strategy_priority_brands = excluded.strategy_priority_brands,
    strategy_non_worked_brands = excluded.strategy_non_worked_brands,
    strategy_top_lines = excluded.strategy_top_lines,
    strategy_top_products = excluded.strategy_top_products,
    strategy_differentials = excluded.strategy_differentials,
    strategy_promise_limits = excluded.strategy_promise_limits,
    strategy_ai_presentation = excluded.strategy_ai_presentation,
    strategy_ai_priorities = excluded.strategy_ai_priorities,
    strategy_ai_never_forget = excluded.strategy_ai_never_forget
  returning *
  into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_strategy_settings_scoped(
  uuid,
  uuid,
  text,
  text,
  text,
  text[],
  text,
  boolean,
  text,
  text[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) owner to postgres;

revoke all on function public.upsert_store_strategy_settings_scoped(
  uuid,
  uuid,
  text,
  text,
  text,
  text[],
  text,
  boolean,
  text,
  text[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public;
revoke all on function public.upsert_store_strategy_settings_scoped(
  uuid,
  uuid,
  text,
  text,
  text,
  text[],
  text,
  boolean,
  text,
  text[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from anon;
revoke all on function public.upsert_store_strategy_settings_scoped(
  uuid,
  uuid,
  text,
  text,
  text,
  text[],
  text,
  boolean,
  text,
  text[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from authenticated;
revoke all on function public.upsert_store_strategy_settings_scoped(
  uuid,
  uuid,
  text,
  text,
  text,
  text[],
  text,
  boolean,
  text,
  text[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from service_role;

create or replace function public.upsert_store_strategy_settings_with_legacy_mirror_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_city text default null,
  p_state text default null,
  p_service_regions text default null,
  p_service_region_modes text[] default '{}'::text[],
  p_service_region_primary_mode text default null,
  p_service_region_outside_consultation boolean default false,
  p_service_region_notes text default null,
  p_store_services text[] default '{}'::text[],
  p_store_services_other text default null,
  p_store_description text default null,
  p_main_store_brand text default null,
  p_brands_worked text default null,
  p_strategy_service_exclusions text default null,
  p_strategy_primary_focus text default null,
  p_strategy_sell_more text default null,
  p_strategy_common_customer text default null,
  p_strategy_ideal_customer text default null,
  p_strategy_ticket_range text default null,
  p_strategy_positioning text default null,
  p_strategy_priority_brands text default null,
  p_strategy_non_worked_brands text default null,
  p_strategy_top_lines text default null,
  p_strategy_top_products text default null,
  p_strategy_differentials text default null,
  p_strategy_promise_limits text default null,
  p_strategy_ai_presentation text default null,
  p_strategy_ai_priorities text default null,
  p_strategy_ai_never_forget text default null
)
returns public.store_strategy_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_result public.store_strategy_settings%rowtype;
  v_ai_store_summary text;
begin
  v_result := public.upsert_store_strategy_settings_scoped(
    p_organization_id,
    p_store_id,
    p_city,
    p_state,
    p_service_regions,
    p_service_region_modes,
    p_service_region_primary_mode,
    p_service_region_outside_consultation,
    p_service_region_notes,
    p_store_services,
    p_store_services_other,
    p_store_description,
    p_main_store_brand,
    p_brands_worked,
    p_strategy_service_exclusions,
    p_strategy_primary_focus,
    p_strategy_sell_more,
    p_strategy_common_customer,
    p_strategy_ideal_customer,
    p_strategy_ticket_range,
    p_strategy_positioning,
    p_strategy_priority_brands,
    p_strategy_non_worked_brands,
    p_strategy_top_lines,
    p_strategy_top_products,
    p_strategy_differentials,
    p_strategy_promise_limits,
    p_strategy_ai_presentation,
    p_strategy_ai_priorities,
    p_strategy_ai_never_forget
  );

  v_ai_store_summary := public.store_strategy_settings_build_ai_store_summary(
    v_result.store_description,
    v_result.strategy_primary_focus,
    v_result.strategy_positioning,
    v_result.strategy_sell_more,
    v_result.service_regions,
    v_result.service_region_modes,
    v_result.store_services,
    v_result.store_services_other,
    v_result.main_store_brand,
    v_result.strategy_priority_brands,
    v_result.strategy_differentials,
    v_result.strategy_promise_limits
  );

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'city',
  p_answer => to_jsonb(coalesce(v_result.city, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'state',
  p_answer => to_jsonb(coalesce(v_result.state, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'service_regions',
  p_answer => to_jsonb(coalesce(v_result.service_regions, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'service_region_modes',
  p_answer => to_jsonb(v_result.service_region_modes)
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'service_region_primary_mode',
  p_answer => to_jsonb(coalesce(v_result.service_region_primary_mode, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'service_region_outside_consultation',
  p_answer => to_jsonb(v_result.service_region_outside_consultation)
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'service_region_notes',
  p_answer => to_jsonb(coalesce(v_result.service_region_notes, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'store_services',
  p_answer => to_jsonb(v_result.store_services)
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'store_services_other',
  p_answer => to_jsonb(coalesce(v_result.store_services_other, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'store_description',
  p_answer => to_jsonb(coalesce(v_result.store_description, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'main_store_brand',
  p_answer => to_jsonb(coalesce(v_result.main_store_brand, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'brands_worked',
  p_answer => to_jsonb(coalesce(v_result.brands_worked, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_service_exclusions',
  p_answer => to_jsonb(coalesce(v_result.strategy_service_exclusions, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_primary_focus',
  p_answer => to_jsonb(coalesce(v_result.strategy_primary_focus, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_sell_more',
  p_answer => to_jsonb(coalesce(v_result.strategy_sell_more, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_common_customer',
  p_answer => to_jsonb(coalesce(v_result.strategy_common_customer, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_ideal_customer',
  p_answer => to_jsonb(coalesce(v_result.strategy_ideal_customer, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_ticket_range',
  p_answer => to_jsonb(coalesce(v_result.strategy_ticket_range, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_positioning',
  p_answer => to_jsonb(coalesce(v_result.strategy_positioning, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_priority_brands',
  p_answer => to_jsonb(coalesce(v_result.strategy_priority_brands, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_non_worked_brands',
  p_answer => to_jsonb(coalesce(v_result.strategy_non_worked_brands, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_top_lines',
  p_answer => to_jsonb(coalesce(v_result.strategy_top_lines, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_top_products',
  p_answer => to_jsonb(coalesce(v_result.strategy_top_products, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_differentials',
  p_answer => to_jsonb(coalesce(v_result.strategy_differentials, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_promise_limits',
  p_answer => to_jsonb(coalesce(v_result.strategy_promise_limits, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_ai_presentation',
  p_answer => to_jsonb(coalesce(v_result.strategy_ai_presentation, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_ai_priorities',
  p_answer => to_jsonb(coalesce(v_result.strategy_ai_priorities, ''))
);

perform public.onboarding_upsert_answer_scoped(
  p_organization_id => p_organization_id,
  p_store_id => p_store_id,
  p_question_key => 'strategy_ai_never_forget',
  p_answer => to_jsonb(coalesce(v_result.strategy_ai_never_forget, ''))
);

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'strategy_ai_store_summary',
    p_answer => to_jsonb(coalesce(v_ai_store_summary, ''))
  );

  return v_result;
end;
$function$;

alter function public.upsert_store_strategy_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text,
  text,
  text,
  text[],
  text,
  boolean,
  text,
  text[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) owner to postgres;

revoke all on function public.upsert_store_strategy_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text,
  text,
  text,
  text[],
  text,
  boolean,
  text,
  text[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public;
revoke all on function public.upsert_store_strategy_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text,
  text,
  text,
  text[],
  text,
  boolean,
  text,
  text[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from anon;
revoke all on function public.upsert_store_strategy_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text,
  text,
  text,
  text[],
  text,
  boolean,
  text,
  text[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from authenticated;
revoke all on function public.upsert_store_strategy_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text,
  text,
  text,
  text[],
  text,
  boolean,
  text,
  text[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from service_role;

grant execute on function public.upsert_store_strategy_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text,
  text,
  text,
  text[],
  text,
  boolean,
  text,
  text[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

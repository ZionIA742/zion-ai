-- P19-A / Bloco 3 / Etapa 3.3
-- Fonte canônica de Operação + dias de visita técnica na agenda.
--
-- Autoridades:
--   public.store_schedule_settings  -> agenda/calendário/capacidade
--   public.store_operation_settings -> política operacional permanente da loja
--
-- Regras importantes:
--   * Não cria store_schedule_settings durante o backfill.
--   * Backfill legado é conservador/fail-closed.
--   * service_role recebe somente leitura da nova tabela.
--   * Escrita canônica de store_operation_settings somente via wrapper autenticado.
--   * AI/runtime não recebe EXECUTE dos writers.
--   * installation_process_steps legado NÃO vira autoridade canônica.
--   * operational_ai_summary NÃO vira autoridade canônica.
--   * região permanece em store_strategy_settings.

create or replace function public.store_schedule_normalize_day(
  p_day text
)
returns text
language sql
immutable
as $function$
  select case pg_catalog.lower(pg_catalog.btrim(coalesce(p_day, '')))
    when 'segunda' then 'segunda'
    when 'segunda-feira' then 'segunda'
    when 'segunda feira' then 'segunda'
    when 'terca' then 'terca'
    when 'terça' then 'terca'
    when 'terca-feira' then 'terca'
    when 'terça-feira' then 'terca'
    when 'terca feira' then 'terca'
    when 'terça feira' then 'terca'
    when 'quarta' then 'quarta'
    when 'quarta-feira' then 'quarta'
    when 'quarta feira' then 'quarta'
    when 'quinta' then 'quinta'
    when 'quinta-feira' then 'quinta'
    when 'quinta feira' then 'quinta'
    when 'sexta' then 'sexta'
    when 'sexta-feira' then 'sexta'
    when 'sexta feira' then 'sexta'
    when 'sabado' then 'sabado'
    when 'sábado' then 'sabado'
    when 'sabado-feira' then 'sabado'
    when 'sábado-feira' then 'sabado'
    when 'sabado feira' then 'sabado'
    when 'sábado feira' then 'sabado'
    when 'domingo' then 'domingo'
    else null
  end;
$function$;

create or replace function public.store_schedule_technical_visit_days_are_valid(
  p_days jsonb
)
returns boolean
language sql
immutable
as $function$
  select
    p_days is null
    or (
      pg_catalog.jsonb_typeof(p_days) = 'array'
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements_text(
          case
            when pg_catalog.jsonb_typeof(p_days) = 'array' then p_days
            else '[]'::jsonb
          end
        ) as day_row(day_value)
        where day_value not in (
          'segunda',
          'terca',
          'quarta',
          'quinta',
          'sexta',
          'sabado',
          'domingo'
        )
      )
    );
$function$;

create or replace function public.store_operation_technical_visit_rules_are_valid(
  p_rules text[]
)
returns boolean
language sql
immutable
as $function$
  select not exists (
    select 1
    from unnest(coalesce(p_rules, '{}'::text[])) as rule_row(rule_value)
    where rule_value is null
       or rule_value not in (
      'precisa_agendar',
      'confirmar_endereco',
      'analise_do_local',
      'pode_ter_taxa'
    )
  );
$function$;

alter table public.store_schedule_settings
  add column if not exists technical_visit_days jsonb null;

do $block$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_schedule_settings'::regclass
      and constraint_row.conname = 'store_schedule_settings_technical_visit_days_valid'
  ) then
    alter table public.store_schedule_settings
      add constraint store_schedule_settings_technical_visit_days_valid
      check (
        public.store_schedule_technical_visit_days_are_valid(technical_visit_days)
      );
  end if;
end;
$block$;

create table if not exists public.store_operation_settings (
  organization_id uuid not null,
  store_id uuid not null,
  offers_installation boolean null,
  average_installation_time_days integer null,
  installation_days_rule text null,
  installation_process_notes text null,
  offers_technical_visit boolean null,
  technical_visit_days_rule text null,
  technical_visit_rules text[] not null default '{}'::text[],
  technical_visit_rules_other text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint store_operation_settings_pkey
    primary key (organization_id, store_id),
  constraint store_operation_settings_store_scope_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete cascade,
  constraint store_operation_settings_average_installation_time_days_valid
    check (
      average_installation_time_days is null
      or average_installation_time_days > 0
    ),
  constraint store_operation_settings_technical_visit_rules_valid
    check (
      public.store_operation_technical_visit_rules_are_valid(
        technical_visit_rules
      )
    )
);

create or replace function public.touch_store_operation_settings_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

drop trigger if exists store_operation_settings_touch_updated_at
  on public.store_operation_settings;

create trigger store_operation_settings_touch_updated_at
before update on public.store_operation_settings
for each row
execute function public.touch_store_operation_settings_updated_at();

with latest_legacy_visit_days as (
  select distinct on (
    answer_row.organization_id,
    answer_row.store_id,
    answer_row.question_key
  )
    answer_row.organization_id,
    answer_row.store_id,
    answer_row.answer
  from public.store_onboarding_answers answer_row
  where answer_row.question_key = 'technical_visit_available_days'
  order by
    answer_row.organization_id,
    answer_row.store_id,
    answer_row.question_key,
    answer_row.updated_at desc,
    answer_row.id desc
),
mapped_days as (
  select
    legacy_row.organization_id,
    legacy_row.store_id,
    public.store_schedule_normalize_day(day_row.day_value) as canonical_day
  from latest_legacy_visit_days legacy_row
  cross join lateral pg_catalog.jsonb_array_elements_text(
    case
      when pg_catalog.jsonb_typeof(legacy_row.answer) = 'array'
        then legacy_row.answer
      else '[]'::jsonb
    end
  ) as day_row(day_value)
),
distinct_days as (
  select distinct
    mapped_row.organization_id,
    mapped_row.store_id,
    mapped_row.canonical_day
  from mapped_days mapped_row
  where mapped_row.canonical_day is not null
),
normalized_days as (
  select
    day_row.organization_id,
    day_row.store_id,
    pg_catalog.jsonb_agg(
      day_row.canonical_day
      order by case day_row.canonical_day
        when 'segunda' then 1
        when 'terca' then 2
        when 'quarta' then 3
        when 'quinta' then 4
        when 'sexta' then 5
        when 'sabado' then 6
        when 'domingo' then 7
        else 99
      end
    ) as technical_visit_days
  from distinct_days day_row
  group by
    day_row.organization_id,
    day_row.store_id
)
update public.store_schedule_settings schedule_row
set
  technical_visit_days = normalized_row.technical_visit_days,
  updated_at = pg_catalog.clock_timestamp()
from normalized_days normalized_row
where schedule_row.organization_id = normalized_row.organization_id
  and schedule_row.store_id = normalized_row.store_id
  and schedule_row.technical_visit_days is null;

with latest_legacy as (
  select distinct on (
    answer_row.organization_id,
    answer_row.store_id,
    answer_row.question_key
  )
    answer_row.organization_id,
    answer_row.store_id,
    answer_row.question_key,
    answer_row.answer
  from public.store_onboarding_answers answer_row
  where answer_row.question_key in (
    'offers_installation',
    'average_installation_time_days',
    'installation_days_rule',
    'offers_technical_visit',
    'technical_visit_days_rule',
    'technical_visit_rules_selected'
  )
  order by
    answer_row.organization_id,
    answer_row.store_id,
    answer_row.question_key,
    answer_row.updated_at desc,
    answer_row.id desc
),
legacy_by_store as (
  select
    legacy_row.organization_id,
    legacy_row.store_id,
    pg_catalog.jsonb_object_agg(
      legacy_row.question_key,
      legacy_row.answer
    ) as answers
  from latest_legacy legacy_row
  group by
    legacy_row.organization_id,
    legacy_row.store_id
),
parsed as (
  select
    store_row.organization_id,
    store_row.store_id,
    case
      when pg_catalog.jsonb_typeof(store_row.answers -> 'offers_installation') = 'boolean'
        then (store_row.answers ->> 'offers_installation')::boolean
      when pg_catalog.jsonb_typeof(store_row.answers -> 'offers_installation') = 'string'
        then case pg_catalog.lower(pg_catalog.btrim(store_row.answers ->> 'offers_installation'))
          when 'sim' then true
          when 'true' then true
          when 'yes' then true
          when '1' then true
          when 'não' then false
          when 'nao' then false
          when 'false' then false
          when 'no' then false
          when '0' then false
          else null
        end
      else null
    end as offers_installation,
    case
      when pg_catalog.jsonb_typeof(store_row.answers -> 'average_installation_time_days') = 'number'
        and (store_row.answers ->> 'average_installation_time_days') ~ '^[0-9]+$'
        and (store_row.answers ->> 'average_installation_time_days')::integer > 0
        then (store_row.answers ->> 'average_installation_time_days')::integer
      when pg_catalog.jsonb_typeof(store_row.answers -> 'average_installation_time_days') = 'string'
        and pg_catalog.lower(pg_catalog.btrim(
          store_row.answers ->> 'average_installation_time_days'
        )) ~ '^[0-9]+[[:space:]]*(dia|dias)?$'
        then (
          substring(
            pg_catalog.lower(pg_catalog.btrim(
              store_row.answers ->> 'average_installation_time_days'
            ))
            from '^([0-9]+)'
          )
        )::integer
      else null
    end as average_installation_time_days,
    case
      when pg_catalog.jsonb_typeof(store_row.answers -> 'installation_days_rule') = 'string'
        then nullif(pg_catalog.btrim(store_row.answers ->> 'installation_days_rule'), '')
      else null
    end as installation_days_rule,
    case
      when pg_catalog.jsonb_typeof(store_row.answers -> 'offers_technical_visit') = 'boolean'
        then (store_row.answers ->> 'offers_technical_visit')::boolean
      when pg_catalog.jsonb_typeof(store_row.answers -> 'offers_technical_visit') = 'string'
        then case pg_catalog.lower(pg_catalog.btrim(store_row.answers ->> 'offers_technical_visit'))
          when 'sim' then true
          when 'true' then true
          when 'yes' then true
          when '1' then true
          when 'não' then false
          when 'nao' then false
          when 'false' then false
          when 'no' then false
          when '0' then false
          else null
        end
      else null
    end as offers_technical_visit,
    case
      when pg_catalog.jsonb_typeof(store_row.answers -> 'technical_visit_days_rule') = 'string'
        then nullif(pg_catalog.btrim(store_row.answers ->> 'technical_visit_days_rule'), '')
      else null
    end as technical_visit_days_rule,
    store_row.answers -> 'technical_visit_rules_selected'
      as legacy_technical_visit_rules
  from legacy_by_store store_row
),
parsed_with_rules as (
  select
    parsed_row.organization_id,
    parsed_row.store_id,
    parsed_row.offers_installation,
    parsed_row.average_installation_time_days,
    parsed_row.installation_days_rule,
    parsed_row.offers_technical_visit,
    parsed_row.technical_visit_days_rule,
    coalesce(rule_row.technical_visit_rules, '{}'::text[])
      as technical_visit_rules
  from parsed parsed_row
  left join lateral (
    select coalesce(
      pg_catalog.array_agg(
        distinct pg_catalog.lower(pg_catalog.btrim(rule_value))
        order by pg_catalog.lower(pg_catalog.btrim(rule_value))
      ),
      '{}'::text[]
    ) as technical_visit_rules
    from pg_catalog.jsonb_array_elements_text(
      case
        when pg_catalog.jsonb_typeof(parsed_row.legacy_technical_visit_rules) = 'array'
          then parsed_row.legacy_technical_visit_rules
        else '[]'::jsonb
      end
    ) as legacy_rule(rule_value)
    where pg_catalog.lower(pg_catalog.btrim(rule_value)) in (
      'precisa_agendar',
      'confirmar_endereco',
      'analise_do_local',
      'pode_ter_taxa'
    )
  ) rule_row on true
)
insert into public.store_operation_settings (
  organization_id,
  store_id,
  offers_installation,
  average_installation_time_days,
  installation_days_rule,
  installation_process_notes,
  offers_technical_visit,
  technical_visit_days_rule,
  technical_visit_rules,
  technical_visit_rules_other
)
select
  normalized_row.organization_id,
  normalized_row.store_id,
  normalized_row.offers_installation,
  normalized_row.average_installation_time_days,
  normalized_row.installation_days_rule,
  null::text as installation_process_notes,
  normalized_row.offers_technical_visit,
  normalized_row.technical_visit_days_rule,
  normalized_row.technical_visit_rules,
  null::text as technical_visit_rules_other
from parsed_with_rules normalized_row
where
  normalized_row.offers_installation is not null
  or normalized_row.average_installation_time_days is not null
  or normalized_row.installation_days_rule is not null
  or normalized_row.offers_technical_visit is not null
  or normalized_row.technical_visit_days_rule is not null
  or cardinality(normalized_row.technical_visit_rules) > 0
on conflict (organization_id, store_id) do nothing;

alter table public.store_operation_settings enable row level security;

revoke all on table public.store_operation_settings from public;
revoke all on table public.store_operation_settings from anon;
revoke all on table public.store_operation_settings from authenticated;
revoke all on table public.store_operation_settings from service_role;

grant select on table public.store_operation_settings to authenticated;
grant select on table public.store_operation_settings to service_role;

drop policy if exists store_operation_settings_select_by_active_membership
  on public.store_operation_settings;

create policy store_operation_settings_select_by_active_membership
  on public.store_operation_settings
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = store_operation_settings.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    and exists (
      select 1
      from public.stores store_row
      where store_row.id = store_operation_settings.store_id
        and store_row.organization_id = store_operation_settings.organization_id
    )
  );

create or replace function public.upsert_store_operation_settings_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_offers_installation boolean,
  p_average_installation_time_days integer,
  p_installation_days_rule text,
  p_installation_process_notes text,
  p_offers_technical_visit boolean,
  p_technical_visit_days_rule text,
  p_technical_visit_rules text[],
  p_technical_visit_rules_other text
)
returns public.store_operation_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_technical_visit_rules text[];
  v_result public.store_operation_settings%rowtype;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if p_average_installation_time_days is not null
     and p_average_installation_time_days <= 0 then
    raise exception using
      errcode = '23514',
      message = 'average_installation_time_days must be positive when provided';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_technical_visit_rules, '{}'::text[]))
      as raw_rule(rule_value)
    where nullif(pg_catalog.btrim(rule_value), '') is null
       or pg_catalog.lower(pg_catalog.btrim(rule_value)) not in (
         'precisa_agendar',
         'confirmar_endereco',
         'analise_do_local',
         'pode_ter_taxa'
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'technical_visit_rules contains invalid values';
  end if;

  select coalesce(
    pg_catalog.array_agg(
      normalized_rule.rule_value
      order by normalized_rule.first_position, normalized_rule.rule_value
    ),
    '{}'::text[]
  )
  into v_technical_visit_rules
  from (
    select
      pg_catalog.lower(pg_catalog.btrim(rule_value)) as rule_value,
      min(ordinality) as first_position
    from unnest(coalesce(p_technical_visit_rules, '{}'::text[]))
      with ordinality as raw_rule(rule_value, ordinality)
    group by pg_catalog.lower(pg_catalog.btrim(rule_value))
  ) normalized_rule;

  if not public.store_operation_technical_visit_rules_are_valid(
    v_technical_visit_rules
  ) then
    raise exception using
      errcode = '23514',
      message = 'technical_visit_rules contains invalid values';
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'store operation settings scope is not authorized';
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
        message = 'store operation settings scope is not authorized';
    end if;
  elsif v_request_role = 'postgres' then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store operation settings scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store operation settings scope is not authorized';
  end if;

  insert into public.store_operation_settings (
    organization_id,
    store_id,
    offers_installation,
    average_installation_time_days,
    installation_days_rule,
    installation_process_notes,
    offers_technical_visit,
    technical_visit_days_rule,
    technical_visit_rules,
    technical_visit_rules_other
  )
  values (
    p_organization_id,
    p_store_id,
    p_offers_installation,
    p_average_installation_time_days,
    nullif(pg_catalog.btrim(coalesce(p_installation_days_rule, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_installation_process_notes, '')), ''),
    p_offers_technical_visit,
    nullif(pg_catalog.btrim(coalesce(p_technical_visit_days_rule, '')), ''),
    v_technical_visit_rules,
    nullif(pg_catalog.btrim(coalesce(p_technical_visit_rules_other, '')), '')
  )
  on conflict (organization_id, store_id)
  do update set
    offers_installation = excluded.offers_installation,
    average_installation_time_days = excluded.average_installation_time_days,
    installation_days_rule = excluded.installation_days_rule,
    installation_process_notes = excluded.installation_process_notes,
    offers_technical_visit = excluded.offers_technical_visit,
    technical_visit_days_rule = excluded.technical_visit_days_rule,
    technical_visit_rules = excluded.technical_visit_rules,
    technical_visit_rules_other = excluded.technical_visit_rules_other
  returning *
  into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_operation_settings_scoped(
  uuid,
  uuid,
  boolean,
  integer,
  text,
  text,
  boolean,
  text,
  text[],
  text
) owner to postgres;

create or replace function public.upsert_store_operation_settings_with_legacy_mirror_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_offers_installation boolean,
  p_average_installation_time_days integer,
  p_installation_days_rule text,
  p_installation_process_notes text,
  p_offers_technical_visit boolean,
  p_technical_visit_days_rule text,
  p_technical_visit_rules text[],
  p_technical_visit_rules_other text
)
returns public.store_operation_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_result public.store_operation_settings%rowtype;
begin
  v_result := public.upsert_store_operation_settings_scoped(
    p_organization_id,
    p_store_id,
    p_offers_installation,
    p_average_installation_time_days,
    p_installation_days_rule,
    p_installation_process_notes,
    p_offers_technical_visit,
    p_technical_visit_days_rule,
    p_technical_visit_rules,
    p_technical_visit_rules_other
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'offers_installation',
    p_answer => case
      when v_result.offers_installation is null then 'null'::jsonb
      else pg_catalog.to_jsonb(v_result.offers_installation)
    end
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'average_installation_time_days',
    p_answer => case
      when v_result.average_installation_time_days is null then 'null'::jsonb
      else pg_catalog.to_jsonb(v_result.average_installation_time_days::text)
    end
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'installation_days_rule',
    p_answer => pg_catalog.to_jsonb(coalesce(v_result.installation_days_rule, ''))
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'installation_process_other',
    p_answer => pg_catalog.to_jsonb(coalesce(v_result.installation_process_notes, ''))
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'offers_technical_visit',
    p_answer => case
      when v_result.offers_technical_visit is null then 'null'::jsonb
      else pg_catalog.to_jsonb(v_result.offers_technical_visit)
    end
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'technical_visit_days_rule',
    p_answer => pg_catalog.to_jsonb(coalesce(v_result.technical_visit_days_rule, ''))
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'technical_visit_rules_selected',
    p_answer => pg_catalog.to_jsonb(v_result.technical_visit_rules)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'technical_visit_rules_other',
    p_answer => pg_catalog.to_jsonb(coalesce(v_result.technical_visit_rules_other, ''))
  );

  return v_result;
end;
$function$;

alter function public.upsert_store_operation_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  boolean,
  integer,
  text,
  text,
  boolean,
  text,
  text[],
  text
) owner to postgres;

create or replace function public.upsert_store_schedule_technical_visit_days_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_technical_visit_days text[]
)
returns public.store_schedule_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_days text[];
  v_days_jsonb jsonb;
  v_result public.store_schedule_settings%rowtype;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if p_technical_visit_days is null then
    v_days := null;
    v_days_jsonb := null;
  else
    if exists (
      select 1
      from unnest(p_technical_visit_days) as raw_day(day_value)
      where public.store_schedule_normalize_day(day_value) is null
    ) then
      raise exception using
        errcode = '23514',
        message = 'technical_visit_days contains invalid values';
    end if;

    select coalesce(
      pg_catalog.array_agg(
        normalized_day.canonical_day
        order by case normalized_day.canonical_day
          when 'segunda' then 1
          when 'terca' then 2
          when 'quarta' then 3
          when 'quinta' then 4
          when 'sexta' then 5
          when 'sabado' then 6
          when 'domingo' then 7
          else 99
        end
      ),
      '{}'::text[]
    )
    into v_days
    from (
      select distinct
        public.store_schedule_normalize_day(raw_day.day_value) as canonical_day
      from unnest(p_technical_visit_days) as raw_day(day_value)
    ) normalized_day
    where normalized_day.canonical_day is not null;

    v_days_jsonb := pg_catalog.to_jsonb(v_days);
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'store schedule technical visit days scope is not authorized';
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
        message = 'store schedule technical visit days scope is not authorized';
    end if;
  elsif v_request_role = 'postgres' then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store schedule technical visit days scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store schedule technical visit days scope is not authorized';
  end if;

  update public.store_schedule_settings schedule_row
  set
    technical_visit_days = v_days_jsonb,
    updated_at = pg_catalog.clock_timestamp()
  where schedule_row.organization_id = p_organization_id
    and schedule_row.store_id = p_store_id
  returning *
  into v_result;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'store_schedule_settings must exist before technical_visit_days can be written';
  end if;

  return v_result;
end;
$function$;

alter function public.upsert_store_schedule_technical_visit_days_scoped(
  uuid,
  uuid,
  text[]
) owner to postgres;

create or replace function public.upsert_store_schedule_technical_visit_days_with_legacy_mirror_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_technical_visit_days text[]
)
returns public.store_schedule_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_result public.store_schedule_settings%rowtype;
begin
  v_result := public.upsert_store_schedule_technical_visit_days_scoped(
    p_organization_id,
    p_store_id,
    p_technical_visit_days
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'technical_visit_available_days',
    p_answer => case
      when v_result.technical_visit_days is null then 'null'::jsonb
      else v_result.technical_visit_days
    end
  );

  return v_result;
end;
$function$;

alter function public.upsert_store_schedule_technical_visit_days_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text[]
) owner to postgres;

alter function public.store_schedule_normalize_day(text) owner to postgres;
alter function public.store_schedule_technical_visit_days_are_valid(jsonb) owner to postgres;
alter function public.store_operation_technical_visit_rules_are_valid(text[]) owner to postgres;
alter function public.touch_store_operation_settings_updated_at() owner to postgres;

revoke all on function public.store_schedule_normalize_day(text)
  from public, anon, authenticated, service_role;

revoke all on function public.store_schedule_technical_visit_days_are_valid(jsonb)
  from public, anon, authenticated, service_role;

-- O RPC legado upsert_store_schedule_settings é SECURITY INVOKER.
-- Como a nova CHECK constraint usa este helper, authenticated/service_role
-- precisam poder executá-lo para que writers antigos continuem compatíveis.
grant execute on function public.store_schedule_technical_visit_days_are_valid(jsonb)
  to authenticated, service_role;

revoke all on function public.store_operation_technical_visit_rules_are_valid(text[])
  from public, anon, authenticated, service_role;

revoke all on function public.upsert_store_operation_settings_scoped(
  uuid,
  uuid,
  boolean,
  integer,
  text,
  text,
  boolean,
  text,
  text[],
  text
)
from public, anon, authenticated, service_role;

revoke all on function public.upsert_store_operation_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  boolean,
  integer,
  text,
  text,
  boolean,
  text,
  text[],
  text
)
from public, anon, authenticated, service_role;

revoke all on function public.upsert_store_schedule_technical_visit_days_scoped(
  uuid,
  uuid,
  text[]
)
from public, anon, authenticated, service_role;

revoke all on function public.upsert_store_schedule_technical_visit_days_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text[]
)
from public, anon, authenticated, service_role;

grant execute on function public.upsert_store_operation_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  boolean,
  integer,
  text,
  text,
  boolean,
  text,
  text[],
  text
)
to authenticated;

grant execute on function public.upsert_store_schedule_technical_visit_days_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text[]
)
to authenticated;

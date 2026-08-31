create or replace function public.store_commercial_ai_price_answer_policy_is_valid(
  p_price_answer_policy text
)
returns boolean
language sql
immutable
as $function$
  select coalesce(p_price_answer_policy, '') in (
    'direct_when_asked',
    'range_only_when_asked',
    'human_required_for_price'
  );
$function$;

create or replace function public.store_commercial_ai_price_context_requirements_are_valid(
  p_price_context_requirements text[]
)
returns boolean
language sql
immutable
as $function$
  select not exists (
    select 1
    from unnest(coalesce(p_price_context_requirements, '{}'::text[])) as requirement
    where requirement not in (
      'need_summary',
      'interested_product_reference',
      'space_or_measurements',
      'installation_scope'
    )
  );
$function$;

create table if not exists public.store_commercial_ai_settings (
  organization_id uuid not null,
  store_id uuid not null,
  price_answer_policy text not null,
  price_context_requirements text[] not null default '{}'::text[],
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint store_commercial_ai_settings_pkey primary key (organization_id, store_id),
  constraint store_commercial_ai_settings_store_scope_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete cascade,
  constraint store_commercial_ai_settings_price_answer_policy_valid
    check (public.store_commercial_ai_price_answer_policy_is_valid(price_answer_policy)),
  constraint store_commercial_ai_settings_context_requirements_allowed
    check (public.store_commercial_ai_price_context_requirements_are_valid(price_context_requirements))
);

create or replace function public.touch_store_commercial_ai_settings_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

drop trigger if exists store_commercial_ai_settings_touch_updated_at
  on public.store_commercial_ai_settings;

create trigger store_commercial_ai_settings_touch_updated_at
before update on public.store_commercial_ai_settings
for each row
execute function public.touch_store_commercial_ai_settings_updated_at();

with legacy_answers as (
  select
    answer_row.organization_id,
    answer_row.store_id,
    answer_row.question_key,
    answer_row.answer,
    case
      when answer_row.question_key in (
        'ai_can_send_price_directly',
        'price_needs_human_help'
      )
      then case
        when answer_row.answer = 'true'::jsonb then 'sim'
        when answer_row.answer = 'false'::jsonb then 'nao'
        else pg_catalog.lower(
          translate(
            nullif(pg_catalog.btrim(answer_row.answer #>> '{}'), ''),
            'ãáàâäÃÁÀÂÄõóòôöÕÓÒÔÖçÇ',
            'aaaaaAAAAAoooooOOOOOcC'
          )
        )
      end
      when answer_row.question_key = 'price_talk_mode'
      then pg_catalog.lower(nullif(pg_catalog.btrim(answer_row.answer #>> '{}'), ''))
      when answer_row.question_key = 'price_must_understand_before'
      then answer_row.answer::text
      else null
    end as compare_value
  from public.store_onboarding_answers answer_row
  where answer_row.question_key in (
    'ai_can_send_price_directly',
    'price_needs_human_help',
    'price_talk_mode',
    'price_must_understand_before'
  )
),
legacy_scopes as (
  select distinct organization_id, store_id
  from legacy_answers
),
legacy_eligibility as (
  select
    scope_row.organization_id,
    scope_row.store_id,
    not exists (
      select 1
      from legacy_answers conflict_row
      where conflict_row.organization_id = scope_row.organization_id
        and conflict_row.store_id = scope_row.store_id
      group by conflict_row.question_key
      having count(distinct conflict_row.compare_value)
        filter (where conflict_row.compare_value is not null) > 1
    ) as no_conflicts,
    not exists (
      select 1
      from legacy_answers invalid_row
      where invalid_row.organization_id = scope_row.organization_id
        and invalid_row.store_id = scope_row.store_id
        and (
          (
            invalid_row.question_key in (
              'ai_can_send_price_directly',
              'price_needs_human_help'
            )
            and invalid_row.compare_value is not null
            and invalid_row.compare_value not in ('sim', 'nao')
          )
          or (
            invalid_row.question_key = 'price_talk_mode'
            and invalid_row.compare_value is not null
            and invalid_row.compare_value not in (
              'quando_cliente_perguntar',
              'apenas_faixa_inicial',
              'nao_falar_sozinha'
            )
          )
          or (
            invalid_row.question_key = 'price_must_understand_before'
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
                      'so_apos_entender_objetivo',
                      'so_apos_identificar_interesse_real',
                      'so_apos_entender_tipo',
                      'so_apos_entender_medidas',
                      'so_apos_entender_instalacao'
                   )
              )
            end
          )
        )
    ) as no_invalid_values
  from legacy_scopes scope_row
),
legacy_pivot as (
  select
    scope_row.organization_id,
    scope_row.store_id,
    max(answer_row.compare_value) filter (
      where answer_row.question_key = 'ai_can_send_price_directly'
    ) as ai_can_send_price_directly,
    max(answer_row.compare_value) filter (
      where answer_row.question_key = 'price_needs_human_help'
    ) as price_needs_human_help,
    max(answer_row.compare_value) filter (
      where answer_row.question_key = 'price_talk_mode'
    ) as price_talk_mode,
    (
      max(answer_row.answer::text) filter (
        where answer_row.question_key = 'price_must_understand_before'
      )
    )::jsonb as price_must_understand_before
  from legacy_scopes scope_row
  left join legacy_answers answer_row
    on answer_row.organization_id = scope_row.organization_id
   and answer_row.store_id = scope_row.store_id
  group by scope_row.organization_id, scope_row.store_id
),
legacy_decisions as (
  select
    pivot_row.organization_id,
    pivot_row.store_id,
    case
      when pivot_row.ai_can_send_price_directly = 'nao'
        or pivot_row.price_needs_human_help = 'sim'
        or pivot_row.price_talk_mode = 'nao_falar_sozinha'
      then 'human_required_for_price'
      when pivot_row.ai_can_send_price_directly = 'sim'
        and pivot_row.price_needs_human_help = 'nao'
        and pivot_row.price_talk_mode = 'apenas_faixa_inicial'
      then 'range_only_when_asked'
      when pivot_row.ai_can_send_price_directly = 'sim'
        and pivot_row.price_needs_human_help = 'nao'
        and pivot_row.price_talk_mode = 'quando_cliente_perguntar'
      then 'direct_when_asked'
      else null
    end as price_answer_policy,
    coalesce(
      (
        select array_agg(mapped_requirement order by first_position, mapped_requirement)
        from (
          select
            case pg_catalog.lower(pg_catalog.btrim(value.value))
              when 'so_apos_entender_objetivo' then 'need_summary'
              when 'so_apos_entender_tipo' then 'interested_product_reference'
              when 'so_apos_entender_medidas' then 'space_or_measurements'
              when 'so_apos_entender_instalacao' then 'installation_scope'
              else null
            end as mapped_requirement,
            min(value.ordinality) as first_position
          from pg_catalog.jsonb_array_elements_text(
            case
              when pg_catalog.jsonb_typeof(pivot_row.price_must_understand_before) = 'array'
                then pivot_row.price_must_understand_before
              else '[]'::jsonb
            end
          ) with ordinality as value(value, ordinality)
          group by mapped_requirement
        ) mapped
        where mapped_requirement is not null
      ),
      '{}'::text[]
    ) as price_context_requirements
  from legacy_pivot pivot_row
  join legacy_eligibility eligibility_row
    on eligibility_row.organization_id = pivot_row.organization_id
   and eligibility_row.store_id = pivot_row.store_id
  where eligibility_row.no_conflicts is true
    and eligibility_row.no_invalid_values is true
)
insert into public.store_commercial_ai_settings (
  organization_id,
  store_id,
  price_answer_policy,
  price_context_requirements
)
select
  decision_row.organization_id,
  decision_row.store_id,
  decision_row.price_answer_policy,
  decision_row.price_context_requirements
from legacy_decisions decision_row
where decision_row.price_answer_policy is not null
on conflict (organization_id, store_id) do nothing;

alter table public.store_commercial_ai_settings enable row level security;

revoke all on table public.store_commercial_ai_settings from public;
revoke all on table public.store_commercial_ai_settings from anon;
revoke all on table public.store_commercial_ai_settings from authenticated;
revoke all on table public.store_commercial_ai_settings from service_role;

grant select on table public.store_commercial_ai_settings to authenticated;
-- generate-ai-sales-reply is server-side and reads this canonical source directly.
-- service_role receives READ ONLY; writer RPC execution remains revoked below.
grant select on table public.store_commercial_ai_settings to service_role;

drop policy if exists store_commercial_ai_settings_select_by_active_membership
  on public.store_commercial_ai_settings;
drop policy if exists store_commercial_ai_settings_insert_by_active_membership
  on public.store_commercial_ai_settings;
drop policy if exists store_commercial_ai_settings_update_by_active_membership
  on public.store_commercial_ai_settings;
drop policy if exists store_commercial_ai_settings_delete_by_active_membership
  on public.store_commercial_ai_settings;

create policy store_commercial_ai_settings_select_by_active_membership
  on public.store_commercial_ai_settings
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = store_commercial_ai_settings.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    and exists (
      select 1
      from public.stores store_row
      where store_row.id = store_commercial_ai_settings.store_id
        and store_row.organization_id = store_commercial_ai_settings.organization_id
    )
  );

create or replace function public.store_commercial_ai_settings_build_price_direct_rule(
  p_price_answer_policy text,
  p_price_context_requirements text[]
)
returns text
language plpgsql
immutable
as $function$
declare
  v_requirement_labels text[] := '{}'::text[];
  v_policy_label text;
begin
  if coalesce(p_price_answer_policy, '') = 'human_required_for_price' then
    return 'A IA nao pode falar preco sem chamar uma pessoa da loja.';
  end if;

  select coalesce(
    array_agg(
      case requirement
        when 'need_summary' then 'So depois de entender o que o cliente quer'
        when 'interested_product_reference' then 'So depois de entender o tipo de piscina ou produto'
        when 'space_or_measurements' then 'So depois de entender medidas ou porte do projeto'
        when 'installation_scope' then 'So depois de entender se precisa instalacao'
        else requirement
      end
    ),
    '{}'::text[]
  )
  into v_requirement_labels
  from unnest(coalesce(p_price_context_requirements, '{}'::text[])) as requirement;

  v_policy_label := case p_price_answer_policy
    when 'range_only_when_asked' then 'Pode falar so uma faixa inicial, nao valor fechado'
    else 'Pode falar preco quando o cliente perguntar'
  end;

  return array_to_string(
    array_remove(
      array[
        nullif(array_to_string(v_requirement_labels, ', '), ''),
        v_policy_label,
        'Nao precisa de ajuda humana para falar preco na regra normal.'
      ],
      null
    ),
    ' | '
  );
end;
$function$;

create or replace function public.upsert_store_commercial_ai_settings_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_price_answer_policy text,
  p_price_context_requirements text[] default '{}'::text[]
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
  v_price_answer_policy text := pg_catalog.lower(
    nullif(pg_catalog.btrim(coalesce(p_price_answer_policy, '')), '')
  );
  v_price_context_requirements text[];
  v_result public.store_commercial_ai_settings%rowtype;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if not public.store_commercial_ai_price_answer_policy_is_valid(v_price_answer_policy) then
    raise exception using
      errcode = '23514',
      message = 'price_answer_policy is invalid';
  end if;

  select coalesce(array_agg(requirement order by first_position, requirement), '{}'::text[])
  into v_price_context_requirements
  from (
    select
      pg_catalog.lower(pg_catalog.btrim(requirement)) as requirement,
      min(ordinality) as first_position
    from unnest(coalesce(p_price_context_requirements, '{}'::text[]))
      with ordinality as requirement_row(requirement, ordinality)
    where nullif(pg_catalog.btrim(requirement), '') is not null
    group by pg_catalog.lower(pg_catalog.btrim(requirement))
  ) normalized_requirement;

  if not public.store_commercial_ai_price_context_requirements_are_valid(
    v_price_context_requirements
  ) then
    raise exception using
      errcode = '23514',
      message = 'price_context_requirements contains invalid values';
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'store commercial AI settings scope is not authorized';
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
        message = 'store commercial AI settings scope is not authorized';
    end if;
  elsif v_request_role = 'postgres' then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store commercial AI settings scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store commercial AI settings scope is not authorized';
  end if;

  insert into public.store_commercial_ai_settings (
    organization_id,
    store_id,
    price_answer_policy,
    price_context_requirements
  )
  values (
    p_organization_id,
    p_store_id,
    v_price_answer_policy,
    v_price_context_requirements
  )
  on conflict (organization_id, store_id)
  do update
    set price_answer_policy = excluded.price_answer_policy,
        price_context_requirements = excluded.price_context_requirements
  returning *
  into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_commercial_ai_settings_scoped(
  uuid,
  uuid,
  text,
  text[]
) owner to postgres;

create or replace function public.upsert_store_commercial_ai_settings_with_legacy_mirror_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_price_answer_policy text,
  p_price_context_requirements text[] default '{}'::text[]
)
returns public.store_commercial_ai_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_result public.store_commercial_ai_settings%rowtype;
  v_legacy_requirements text[];
  v_price_talk_mode text;
  v_ai_can_send_price_directly boolean;
  v_price_needs_human_help text;
  v_price_direct_conditions text[];
  v_price_direct_rule text;
begin
  v_result := public.upsert_store_commercial_ai_settings_scoped(
    p_organization_id,
    p_store_id,
    p_price_answer_policy,
    p_price_context_requirements
  );

  select coalesce(array_agg(
    case requirement
      when 'need_summary' then 'so_apos_entender_objetivo'
      when 'interested_product_reference' then 'so_apos_entender_tipo'
      when 'space_or_measurements' then 'so_apos_entender_medidas'
      when 'installation_scope' then 'so_apos_entender_instalacao'
    end
    order by ordinality
  ), '{}'::text[])
  into v_legacy_requirements
  from unnest(v_result.price_context_requirements)
    with ordinality as requirement_row(requirement, ordinality);

  v_price_talk_mode := case v_result.price_answer_policy
    when 'range_only_when_asked' then 'apenas_faixa_inicial'
    when 'human_required_for_price' then 'nao_falar_sozinha'
    else 'quando_cliente_perguntar'
  end;

  v_ai_can_send_price_directly :=
    v_result.price_answer_policy <> 'human_required_for_price';
  v_price_needs_human_help := case
    when v_result.price_answer_policy = 'human_required_for_price' then 'sim'
    else 'nao'
  end;
  v_price_direct_conditions :=
    v_legacy_requirements ||
    array[v_price_talk_mode] ||
    case
      when v_price_needs_human_help = 'sim'
        then array['nunca_sem_chamar_humano']::text[]
      else '{}'::text[]
    end;
  v_price_direct_rule :=
    public.store_commercial_ai_settings_build_price_direct_rule(
      v_result.price_answer_policy,
      v_result.price_context_requirements
    );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'price_talk_mode',
    p_answer => to_jsonb(v_price_talk_mode)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'ai_can_send_price_directly',
    p_answer => to_jsonb(v_ai_can_send_price_directly)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'price_needs_human_help',
    p_answer => to_jsonb(v_price_needs_human_help)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'price_must_understand_before',
    p_answer => to_jsonb(v_legacy_requirements)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'price_direct_conditions',
    p_answer => to_jsonb(v_price_direct_conditions)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'price_direct_rule',
    p_answer => to_jsonb(v_price_direct_rule)
  );

  return v_result;
end;
$function$;

alter function public.upsert_store_commercial_ai_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text,
  text[]
) owner to postgres;

revoke all on function public.store_commercial_ai_price_answer_policy_is_valid(text)
  from public, anon, authenticated, service_role;
revoke all on function public.store_commercial_ai_price_context_requirements_are_valid(text[])
  from public, anon, authenticated, service_role;
revoke all on function public.store_commercial_ai_settings_build_price_direct_rule(text,text[])
  from public, anon, authenticated, service_role;
revoke all on function public.upsert_store_commercial_ai_settings_scoped(uuid,uuid,text,text[])
  from public, anon, authenticated, service_role;
revoke all on function public.upsert_store_commercial_ai_settings_with_legacy_mirror_scoped(uuid,uuid,text,text[])
  from public, anon, authenticated, service_role;

grant execute on function public.upsert_store_commercial_ai_settings_with_legacy_mirror_scoped(uuid,uuid,text,text[])
  to authenticated;

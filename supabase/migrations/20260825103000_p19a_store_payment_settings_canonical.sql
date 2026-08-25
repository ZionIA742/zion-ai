create or replace function public.store_payment_settings_methods_are_valid(
  p_accepted_payment_methods text[]
)
returns boolean
language sql
immutable
as $function$
  select not exists (
    select 1
    from unnest(coalesce(p_accepted_payment_methods, '{}'::text[])) as accepted_method
    where accepted_method not in (
      'pix',
      'cartao_credito',
      'cartao_debito',
      'boleto',
      'dinheiro',
      'transferencia',
      'financiamento',
      'parcelado',
      'sinal_mais_parcelas'
    )
  );
$function$;

create table if not exists public.store_payment_settings (
  organization_id uuid not null,
  store_id uuid not null,
  accepted_payment_methods text[] not null default '{}'::text[],
  pix_key_type text,
  pix_key text,
  pix_holder_name text,
  down_payment_mode text not null default 'none',
  down_payment_value_type text,
  down_payment_percent numeric(5,2),
  down_payment_amount_cents integer,
  installments_enabled boolean not null default false,
  max_installments integer,
  installment_interest_policy text,
  payment_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint store_payment_settings_pkey primary key (organization_id, store_id),
  constraint store_payment_settings_store_scope_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete cascade,
  constraint store_payment_settings_accepted_methods_not_empty
    check (coalesce(pg_catalog.array_length(accepted_payment_methods, 1), 0) > 0),
  constraint store_payment_settings_accepted_methods_allowed
    check (public.store_payment_settings_methods_are_valid(accepted_payment_methods)),
  constraint store_payment_settings_down_payment_mode_valid
    check (down_payment_mode in ('none', 'optional', 'required')),
  constraint store_payment_settings_down_payment_value_type_valid
    check (
      down_payment_value_type is null
      or down_payment_value_type in ('percent', 'fixed', 'case_by_case')
    ),
  constraint store_payment_settings_installment_interest_policy_valid
    check (
      installment_interest_policy is null
      or installment_interest_policy in ('interest_free', 'with_interest', 'case_by_case')
    ),
  constraint store_payment_settings_pix_key_type_valid
    check (
      pix_key_type is null
      or pix_key_type in ('cpf', 'cnpj', 'email', 'phone', 'random')
    ),
  constraint store_payment_settings_pix_requires_method
    check (
      'pix' = any(accepted_payment_methods)
      or (pix_key_type is null and pix_key is null and pix_holder_name is null)
    ),
  constraint store_payment_settings_down_payment_none_children_cleared
    check (
      down_payment_mode <> 'none'
      or (
        down_payment_value_type is null
        and down_payment_percent is null
        and down_payment_amount_cents is null
      )
    ),
  constraint store_payment_settings_down_payment_value_type_required
    check (
      down_payment_mode = 'none'
      or down_payment_value_type is not null
    ),
  constraint store_payment_settings_down_payment_percent_requirements
    check (
      down_payment_value_type <> 'percent'
      or (
        down_payment_percent is not null
        and down_payment_percent > 0
        and down_payment_percent <= 100
        and down_payment_amount_cents is null
      )
    ),
  constraint store_payment_settings_down_payment_fixed_requirements
    check (
      down_payment_value_type <> 'fixed'
      or (
        down_payment_amount_cents is not null
        and down_payment_amount_cents > 0
        and down_payment_percent is null
      )
    ),
  constraint store_payment_settings_down_payment_case_by_case_requirements
    check (
      down_payment_value_type <> 'case_by_case'
      or (
        down_payment_percent is null
        and down_payment_amount_cents is null
      )
    ),
  constraint store_payment_settings_installments_disabled_children_cleared
    check (
      installments_enabled is true
      or (max_installments is null and installment_interest_policy is null)
    ),
  constraint store_payment_settings_installments_enabled_requirements
    check (
      installments_enabled is false
      or (
        max_installments is not null
        and max_installments >= 1
        and max_installments <= 360
        and installment_interest_policy is not null
      )
    )
);

create or replace function public.touch_store_payment_settings_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$function$;

drop trigger if exists store_payment_settings_touch_updated_at on public.store_payment_settings;
create trigger store_payment_settings_touch_updated_at
before update on public.store_payment_settings
for each row
execute function public.touch_store_payment_settings_updated_at();

-- Preserve legacy payment-method information deterministically before the
-- application starts preferring the canonical table. Only the structured
-- accepted_payment_methods array is backfilled; Pix keys, down payment values,
-- installment details and notes are never inferred from free text.
with legacy_payment_method_values as (
  select
    answer_row.organization_id,
    answer_row.store_id,
    pg_catalog.lower(pg_catalog.btrim(method_row.method_value)) as method_value,
    method_row.ordinality
  from public.store_onboarding_answers answer_row
  cross join lateral jsonb_array_elements_text(
    case
      when pg_catalog.jsonb_typeof(answer_row.answer) = 'array' then answer_row.answer
      else '[]'::jsonb
    end
  ) with ordinality as method_row(method_value, ordinality)
  where answer_row.question_key = 'accepted_payment_methods'
),
legacy_payment_method_candidates as (
  select
    organization_id,
    store_id,
    method_value,
    ordinality
  from legacy_payment_method_values
  where method_value <> ''
    and method_value not in ('p', 'i', 'x')

  union all

  -- Historical data contains a known split-Pix artifact ("p","i","x").
  -- Reconstruct Pix only when all three fragments exist for the same store.
  select
    organization_id,
    store_id,
    'pix'::text as method_value,
    min(ordinality) as ordinality
  from legacy_payment_method_values
  where method_value in ('p', 'i', 'x')
  group by organization_id, store_id
  having count(distinct method_value) = 3
),
legacy_payment_method_distinct as (
  select
    organization_id,
    store_id,
    method_value,
    min(ordinality) as first_position
  from legacy_payment_method_candidates
  where method_value in (
    'pix',
    'cartao_credito',
    'cartao_debito',
    'boleto',
    'dinheiro',
    'transferencia',
    'financiamento',
    'parcelado',
    'sinal_mais_parcelas'
  )
  group by organization_id, store_id, method_value
),
legacy_payment_method_rows as (
  select
    organization_id,
    store_id,
    array_agg(method_value order by first_position, method_value) as accepted_payment_methods
  from legacy_payment_method_distinct
  group by organization_id, store_id
)
insert into public.store_payment_settings (
  organization_id,
  store_id,
  accepted_payment_methods,
  down_payment_mode,
  installments_enabled
)
select
  legacy_row.organization_id,
  legacy_row.store_id,
  legacy_row.accepted_payment_methods,
  'none',
  false
from legacy_payment_method_rows legacy_row
where coalesce(pg_catalog.array_length(legacy_row.accepted_payment_methods, 1), 0) > 0
on conflict (organization_id, store_id) do nothing;

alter table public.store_payment_settings enable row level security;

revoke all on table public.store_payment_settings from public;
revoke all on table public.store_payment_settings from anon;
revoke all on table public.store_payment_settings from authenticated;
revoke all on table public.store_payment_settings from service_role;

-- The UI may read the canonical row directly under tenant-scoped RLS.
-- All writes must go through the canonical SECURITY DEFINER writers below so
-- the canonical row and legacy mirrors cannot diverge.
grant select on table public.store_payment_settings to authenticated;

drop policy if exists store_payment_settings_select_by_active_membership on public.store_payment_settings;
create policy store_payment_settings_select_by_active_membership
  on public.store_payment_settings
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = store_payment_settings.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    and exists (
      select 1
      from public.stores store_row
      where store_row.id = store_payment_settings.store_id
        and store_row.organization_id = store_payment_settings.organization_id
    )
  );

drop policy if exists store_payment_settings_insert_by_active_membership on public.store_payment_settings;
drop policy if exists store_payment_settings_update_by_active_membership on public.store_payment_settings;

create or replace function public.store_payment_settings_build_legacy_summary(
  p_accepted_payment_methods text[],
  p_down_payment_mode text,
  p_down_payment_value_type text,
  p_down_payment_percent numeric,
  p_down_payment_amount_cents integer,
  p_installments_enabled boolean,
  p_max_installments integer,
  p_installment_interest_policy text,
  p_payment_notes text
)
returns text
language plpgsql
immutable
as $function$
declare
  v_parts text[] := '{}'::text[];
  v_method_labels text[] := '{}'::text[];
  v_down_payment_summary text;
  v_installments_summary text;
begin
  if p_accepted_payment_methods is not null then
    select coalesce(
      array_agg(
        case accepted_method
          when 'pix' then 'Pix'
          when 'cartao_credito' then 'Cartao de credito'
          when 'cartao_debito' then 'Cartao de debito'
          when 'boleto' then 'Boleto'
          when 'dinheiro' then 'Dinheiro'
          when 'transferencia' then 'Transferencia'
          when 'financiamento' then 'Financiamento'
          when 'parcelado' then 'Parcelado'
          when 'sinal_mais_parcelas' then 'Sinal + parcelas'
          else accepted_method
        end
      ),
      '{}'::text[]
    )
    into v_method_labels
    from unnest(p_accepted_payment_methods) as accepted_method;
  end if;

  if coalesce(array_length(v_method_labels, 1), 0) > 0 then
    v_parts := v_parts || array_to_string(v_method_labels, ', ');
  end if;

  if p_installments_enabled is true then
    v_installments_summary := trim(
      both ' '
      from concat_ws(
        ' ',
        case
          when p_max_installments is not null then format('parcelamento em ate %sx', p_max_installments)
          else null
        end,
        case p_installment_interest_policy
          when 'interest_free' then 'sem juros'
          when 'with_interest' then 'com juros'
          when 'case_by_case' then 'juros caso a caso'
          else null
        end
      )
    );

    if nullif(v_installments_summary, '') is not null then
      v_parts := v_parts || v_installments_summary;
    end if;
  end if;

  if p_down_payment_mode is not null and p_down_payment_mode <> 'none' then
    v_down_payment_summary := trim(
      both ' '
      from concat_ws(
        ' ',
        case p_down_payment_mode
          when 'optional' then 'Entrada opcional'
          when 'required' then 'Entrada obrigatoria'
          else 'Entrada'
        end,
        case p_down_payment_value_type
          when 'percent' then concat(p_down_payment_percent, '%')
          when 'fixed' then to_char((p_down_payment_amount_cents::numeric / 100), '"R$ "FM999999990D00')
          when 'case_by_case' then 'caso a caso'
          else null
        end
      )
    );

    if nullif(v_down_payment_summary, '') is not null then
      v_parts := v_parts || replace(v_down_payment_summary, '.', ',');
    end if;
  end if;

  if nullif(pg_catalog.btrim(coalesce(p_payment_notes, '')), '') is not null then
    v_parts := v_parts || pg_catalog.btrim(p_payment_notes);
  end if;

  return array_to_string(v_parts, ' | ');
end;
$function$;

create or replace function public.upsert_store_payment_settings_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_accepted_payment_methods text[],
  p_pix_key_type text default null,
  p_pix_key text default null,
  p_pix_holder_name text default null,
  p_down_payment_mode text default 'none',
  p_down_payment_value_type text default null,
  p_down_payment_percent numeric default null,
  p_down_payment_amount_cents integer default null,
  p_installments_enabled boolean default false,
  p_max_installments integer default null,
  p_installment_interest_policy text default null,
  p_payment_notes text default null
)
returns public.store_payment_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_result public.store_payment_settings%rowtype;
  v_pix_key_type text := nullif(pg_catalog.btrim(coalesce(p_pix_key_type, '')), '');
  v_pix_key text := nullif(pg_catalog.btrim(coalesce(p_pix_key, '')), '');
  v_pix_holder_name text := nullif(pg_catalog.btrim(coalesce(p_pix_holder_name, '')), '');
  v_down_payment_mode text := coalesce(nullif(pg_catalog.btrim(coalesce(p_down_payment_mode, '')), ''), 'none');
  v_down_payment_value_type text := nullif(pg_catalog.btrim(coalesce(p_down_payment_value_type, '')), '');
  v_payment_notes text := nullif(pg_catalog.btrim(coalesce(p_payment_notes, '')), '');
  v_accepted_payment_methods text[];
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
        message = 'store payment settings scope is not authorized';
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
        message = 'store payment settings scope is not authorized';
    end if;
  elsif v_request_role = 'postgres' then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store payment settings scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store payment settings scope is not authorized';
  end if;

  with normalized_methods as (
    select
      pg_catalog.lower(pg_catalog.btrim(coalesce(accepted_method, ''))) as accepted_method,
      ordinality
    from unnest(coalesce(p_accepted_payment_methods, '{}'::text[]))
      with ordinality as accepted_method_row(accepted_method, ordinality)
  ),
  candidate_methods as (
    select
      accepted_method,
      ordinality
    from normalized_methods
    where accepted_method <> ''
      and accepted_method not in ('p', 'i', 'x')

    union all

    -- Historical data contains a known split-Pix artifact ("p","i","x").
    -- Reconstruct Pix only when all three fragments are present.
    select
      'pix'::text as accepted_method,
      min(ordinality) as ordinality
    from normalized_methods
    where accepted_method in ('p', 'i', 'x')
    having count(distinct accepted_method) = 3
  ),
  distinct_methods as (
    select
      accepted_method,
      min(ordinality) as first_position
    from candidate_methods
    group by accepted_method
  )
  select coalesce(
    array_agg(distinct_methods.accepted_method order by distinct_methods.first_position),
    '{}'::text[]
  )
  into v_accepted_payment_methods
  from distinct_methods;

  if coalesce(array_length(v_accepted_payment_methods, 1), 0) = 0 then
    raise exception using
      errcode = '22023',
      message = 'accepted payment methods are required';
  end if;

  if exists (
    select 1
    from unnest(v_accepted_payment_methods) as accepted_method
    where accepted_method not in (
      'pix',
      'cartao_credito',
      'cartao_debito',
      'boleto',
      'dinheiro',
      'transferencia',
      'financiamento',
      'parcelado',
      'sinal_mais_parcelas'
    )
  ) then
    raise exception using
      errcode = '22023',
      message = 'accepted payment methods contain invalid values';
  end if;

  if not ('pix' = any(v_accepted_payment_methods)) then
    v_pix_key_type := null;
    v_pix_key := null;
    v_pix_holder_name := null;
  elsif v_pix_key is not null and v_pix_key_type is null then
    raise exception using
      errcode = '22023',
      message = 'pix key type is required when a pix key is provided';
  end if;

  if v_down_payment_mode not in ('none', 'optional', 'required') then
    raise exception using
      errcode = '22023',
      message = 'down payment mode is invalid';
  end if;

  if v_down_payment_mode = 'none' then
    v_down_payment_value_type := null;
    p_down_payment_percent := null;
    p_down_payment_amount_cents := null;
  else
    if v_down_payment_value_type not in ('percent', 'fixed', 'case_by_case') then
      raise exception using
        errcode = '22023',
        message = 'down payment value type is invalid';
    end if;

    if v_down_payment_value_type = 'percent' then
      if p_down_payment_percent is null
         or p_down_payment_percent <= 0
         or p_down_payment_percent > 100
      then
        raise exception using
          errcode = '22023',
          message = 'down payment percent is invalid';
      end if;

      p_down_payment_amount_cents := null;
    elsif v_down_payment_value_type = 'fixed' then
      if p_down_payment_amount_cents is null or p_down_payment_amount_cents <= 0 then
        raise exception using
          errcode = '22023',
          message = 'down payment amount is invalid';
      end if;

      p_down_payment_percent := null;
    else
      p_down_payment_percent := null;
      p_down_payment_amount_cents := null;
    end if;
  end if;

  if coalesce(p_installments_enabled, false) is not true then
    p_installments_enabled := false;
    p_max_installments := null;
    p_installment_interest_policy := null;
  else
    if p_max_installments is null or p_max_installments < 1 or p_max_installments > 360 then
      raise exception using
        errcode = '22023',
        message = 'max installments is invalid';
    end if;

    if p_installment_interest_policy not in ('interest_free', 'with_interest', 'case_by_case') then
      raise exception using
        errcode = '22023',
        message = 'installment interest policy is invalid';
    end if;
  end if;

  insert into public.store_payment_settings (
    organization_id,
    store_id,
    accepted_payment_methods,
    pix_key_type,
    pix_key,
    pix_holder_name,
    down_payment_mode,
    down_payment_value_type,
    down_payment_percent,
    down_payment_amount_cents,
    installments_enabled,
    max_installments,
    installment_interest_policy,
    payment_notes
  )
  values (
    p_organization_id,
    p_store_id,
    v_accepted_payment_methods,
    v_pix_key_type,
    v_pix_key,
    v_pix_holder_name,
    v_down_payment_mode,
    v_down_payment_value_type,
    p_down_payment_percent,
    p_down_payment_amount_cents,
    p_installments_enabled,
    p_max_installments,
    p_installment_interest_policy,
    v_payment_notes
  )
  on conflict (organization_id, store_id)
  do update
  set
    accepted_payment_methods = excluded.accepted_payment_methods,
    pix_key_type = excluded.pix_key_type,
    pix_key = excluded.pix_key,
    pix_holder_name = excluded.pix_holder_name,
    down_payment_mode = excluded.down_payment_mode,
    down_payment_value_type = excluded.down_payment_value_type,
    down_payment_percent = excluded.down_payment_percent,
    down_payment_amount_cents = excluded.down_payment_amount_cents,
    installments_enabled = excluded.installments_enabled,
    max_installments = excluded.max_installments,
    installment_interest_policy = excluded.installment_interest_policy,
    payment_notes = excluded.payment_notes,
    updated_at = timezone('utc', now())
  returning *
  into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_payment_settings_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  text,
  text,
  numeric,
  integer,
  boolean,
  integer,
  text,
  text
) owner to postgres;

revoke all on function public.upsert_store_payment_settings_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  text,
  text,
  numeric,
  integer,
  boolean,
  integer,
  text,
  text
) from public;
revoke all on function public.upsert_store_payment_settings_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  text,
  text,
  numeric,
  integer,
  boolean,
  integer,
  text,
  text
) from anon;
revoke all on function public.upsert_store_payment_settings_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  text,
  text,
  numeric,
  integer,
  boolean,
  integer,
  text,
  text
) from authenticated;
revoke all on function public.upsert_store_payment_settings_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  text,
  text,
  numeric,
  integer,
  boolean,
  integer,
  text,
  text
) from service_role;

grant execute on function public.upsert_store_payment_settings_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  text,
  text,
  numeric,
  integer,
  boolean,
  integer,
  text,
  text
) to authenticated;

create or replace function public.upsert_store_payment_settings_with_legacy_mirror_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_accepted_payment_methods text[],
  p_pix_key_type text default null,
  p_pix_key text default null,
  p_pix_holder_name text default null,
  p_down_payment_mode text default 'none',
  p_down_payment_value_type text default null,
  p_down_payment_percent numeric default null,
  p_down_payment_amount_cents integer default null,
  p_installments_enabled boolean default false,
  p_max_installments integer default null,
  p_installment_interest_policy text default null,
  p_payment_notes text default null
)
returns public.store_payment_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_result public.store_payment_settings%rowtype;
  v_summary text;
begin
  v_result := public.upsert_store_payment_settings_scoped(
    p_organization_id,
    p_store_id,
    p_accepted_payment_methods,
    p_pix_key_type,
    p_pix_key,
    p_pix_holder_name,
    p_down_payment_mode,
    p_down_payment_value_type,
    p_down_payment_percent,
    p_down_payment_amount_cents,
    p_installments_enabled,
    p_max_installments,
    p_installment_interest_policy,
    p_payment_notes
  );

  v_summary := public.store_payment_settings_build_legacy_summary(
    v_result.accepted_payment_methods,
    v_result.down_payment_mode,
    v_result.down_payment_value_type,
    v_result.down_payment_percent,
    v_result.down_payment_amount_cents,
    v_result.installments_enabled,
    v_result.max_installments,
    v_result.installment_interest_policy,
    v_result.payment_notes
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'accepted_payment_methods',
    p_answer => to_jsonb(v_result.accepted_payment_methods)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'accepted_payment_methods_summary',
    p_answer => to_jsonb(v_summary)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'payment_methods_summary',
    p_answer => to_jsonb(v_summary)
  );

  -- Keep legacy mirrors compatible with the current Sales AI heuristics.
  -- Empty strings represent "not configured" for conditional children; JSON
  -- null/"none"/false would otherwise look like a meaningful value to legacy
  -- key-name heuristics.
  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'pix_key_type',
    p_answer => to_jsonb(
      case
        when not ('pix' = any(v_result.accepted_payment_methods)) then ''
        when v_result.pix_key is null then ''
        else coalesce(v_result.pix_key_type, '')
      end
    )
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'pix_key',
    p_answer => to_jsonb(
      case
        when not ('pix' = any(v_result.accepted_payment_methods)) then ''
        else coalesce(v_result.pix_key, '')
      end
    )
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'pix_holder_name',
    p_answer => to_jsonb(
      case
        when not ('pix' = any(v_result.accepted_payment_methods)) then ''
        when v_result.pix_key is null then ''
        else coalesce(v_result.pix_holder_name, '')
      end
    )
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'down_payment_mode',
    p_answer => to_jsonb(
      case
        when v_result.down_payment_mode = 'none' then ''
        else v_result.down_payment_mode
      end
    )
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'down_payment_value_type',
    p_answer => to_jsonb(
      case
        when v_result.down_payment_mode = 'none' then ''
        else coalesce(v_result.down_payment_value_type, '')
      end
    )
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'down_payment_percent',
    p_answer => case
      when v_result.down_payment_mode <> 'none'
        and v_result.down_payment_value_type = 'percent'
        and v_result.down_payment_percent is not null
      then to_jsonb(v_result.down_payment_percent)
      else to_jsonb(''::text)
    end
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'down_payment_amount_cents',
    p_answer => case
      when v_result.down_payment_mode <> 'none'
        and v_result.down_payment_value_type = 'fixed'
        and v_result.down_payment_amount_cents is not null
      then to_jsonb(v_result.down_payment_amount_cents)
      else to_jsonb(''::text)
    end
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'installments_enabled',
    p_answer => case
      when v_result.installments_enabled is true then to_jsonb(true)
      else to_jsonb(''::text)
    end
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'max_installments',
    p_answer => case
      when v_result.installments_enabled is true
        and v_result.max_installments is not null
      then to_jsonb(v_result.max_installments)
      else to_jsonb(''::text)
    end
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'installment_interest_policy',
    p_answer => to_jsonb(
      case
        when v_result.installments_enabled is true then coalesce(v_result.installment_interest_policy, '')
        else ''
      end
    )
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'payment_notes',
    p_answer => to_jsonb(coalesce(v_result.payment_notes, ''))
  );

  return v_result;
end;
$function$;

alter function public.upsert_store_payment_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  text,
  text,
  numeric,
  integer,
  boolean,
  integer,
  text,
  text
) owner to postgres;

revoke all on function public.upsert_store_payment_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  text,
  text,
  numeric,
  integer,
  boolean,
  integer,
  text,
  text
) from public;
revoke all on function public.upsert_store_payment_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  text,
  text,
  numeric,
  integer,
  boolean,
  integer,
  text,
  text
) from anon;
revoke all on function public.upsert_store_payment_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  text,
  text,
  numeric,
  integer,
  boolean,
  integer,
  text,
  text
) from authenticated;
revoke all on function public.upsert_store_payment_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  text,
  text,
  numeric,
  integer,
  boolean,
  integer,
  text,
  text
) from service_role;

grant execute on function public.upsert_store_payment_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  text,
  text,
  numeric,
  integer,
  boolean,
  integer,
  text,
  text
) to authenticated;

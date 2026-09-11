begin;

-- ============================================================
-- P19-A / GERAL
-- Authority canonica do endereco fisico da loja.
--
-- store_strategy_settings.city/state continuam pertencendo
-- ao contexto de estrategia/regiao de atendimento.
--
-- Nenhum backfill marca endereco como configurado implicitamente.
-- ============================================================

create table public.store_general_address_settings (
  organization_id uuid not null,
  store_id uuid not null,

  has_public_address boolean not null,

  cep text,
  street text,
  number text,
  complement text,
  district text,
  city text,
  state text,

  customer_visit_mode text,
  reference_point text,
  directions_notes text,

  address_configured_at timestamptz,

  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint store_general_address_settings_pkey
    primary key (organization_id, store_id),

  constraint store_general_address_settings_store_fkey
    foreign key (store_id)
    references public.stores(id)
    on delete cascade,

  constraint store_general_address_settings_visit_mode_check
    check (
      customer_visit_mode is null
      or customer_visit_mode in (
        'sem_agendamento',
        'com_agendamento',
        'nao_recebe_clientes'
      )
    ),

  constraint store_general_address_settings_cep_check
    check (
      cep is null
      or cep ~ '^[0-9]{8}$'
    ),

  constraint store_general_address_settings_payload_check
    check (
      (
        has_public_address is false
        and cep is null
        and street is null
        and number is null
        and complement is null
        and district is null
        and city is null
        and state is null
        and customer_visit_mode is null
        and reference_point is null
        and directions_notes is null
      )
      or
      (
        has_public_address is true
        and nullif(pg_catalog.btrim(street), '') is not null
        and nullif(pg_catalog.btrim(number), '') is not null
        and nullif(pg_catalog.btrim(district), '') is not null
        and nullif(pg_catalog.btrim(city), '') is not null
        and nullif(pg_catalog.btrim(state), '') is not null
        and customer_visit_mode in (
          'sem_agendamento',
          'com_agendamento',
          'nao_recebe_clientes'
        )
      )
    )
);

-- ============================================================
-- UPDATED_AT
-- ============================================================

create or replace function public.touch_store_general_address_settings_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

alter function public.touch_store_general_address_settings_updated_at()
  owner to postgres;

revoke all
  on function public.touch_store_general_address_settings_updated_at()
  from public, anon, authenticated, service_role;

create trigger touch_store_general_address_settings_updated_at
before update
on public.store_general_address_settings
for each row
execute function public.touch_store_general_address_settings_updated_at();

-- ============================================================
-- RLS
-- Leitura direta somente para membro ativo e store pertencente
-- a mesma organization.
-- Escrita direta permanece proibida: somente writer canonico.
-- ============================================================

alter table public.store_general_address_settings
  enable row level security;

revoke all
  on table public.store_general_address_settings
  from public, anon, authenticated, service_role;

grant select
  on table public.store_general_address_settings
  to authenticated;

create policy store_general_address_settings_select_by_active_membership
on public.store_general_address_settings
for select
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id =
      store_general_address_settings.organization_id
      and membership_row.user_id = auth.uid()
      and membership_row.is_active is true
  )
  and exists (
    select 1
    from public.stores store_row
    where store_row.id = store_general_address_settings.store_id
      and store_row.organization_id =
        store_general_address_settings.organization_id
  )
);

-- ============================================================
-- ASSERT DE ESCOPO
-- Interno. Nao e exposto aos clientes.
-- ============================================================

create or replace function public.assert_store_general_address_settings_scope(
  p_organization_id uuid,
  p_store_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_organization_id
      and membership_row.user_id = auth.uid()
      and membership_row.is_active is true
  ) then
    raise exception 'active organization membership required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception 'store is outside organization scope'
      using errcode = '42501';
  end if;
end;
$function$;

alter function public.assert_store_general_address_settings_scope(uuid, uuid)
  owner to postgres;

revoke all
  on function public.assert_store_general_address_settings_scope(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ============================================================
-- READER CANONICO
-- Ausencia de row = nunca configurado.
-- ============================================================

create or replace function public.read_store_general_address_settings_scoped(
  p_organization_id uuid,
  p_store_id uuid
)
returns setof public.store_general_address_settings
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
begin
  perform public.assert_store_general_address_settings_scope(
    p_organization_id,
    p_store_id
  );

  return query
  select settings_row.*
  from public.store_general_address_settings settings_row
  where settings_row.organization_id = p_organization_id
    and settings_row.store_id = p_store_id;
end;
$function$;

alter function public.read_store_general_address_settings_scoped(uuid, uuid)
  owner to postgres;

revoke all
  on function public.read_store_general_address_settings_scoped(uuid, uuid)
  from public, anon, service_role;

grant execute
  on function public.read_store_general_address_settings_scoped(uuid, uuid)
  to authenticated;

-- ============================================================
-- WRITER CANONICO
--
-- Regras:
-- - has_public_address precisa ser decisao explicita.
-- - false limpa todos os campos dependentes.
-- - true exige rua, numero, bairro, cidade, estado e modo.
-- - CEP e opcional; se informado, deve possuir 8 digitos.
-- - marker e criado somente na primeira configuracao humana
--   e preservado em replays/edicoes posteriores.
-- ============================================================

create or replace function public.upsert_store_general_address_settings_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_has_public_address boolean,
  p_cep text,
  p_street text,
  p_number text,
  p_complement text,
  p_district text,
  p_city text,
  p_state text,
  p_customer_visit_mode text,
  p_reference_point text,
  p_directions_notes text
)
returns public.store_general_address_settings
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  v_result public.store_general_address_settings%rowtype;

  v_cep_input text :=
    nullif(pg_catalog.btrim(coalesce(p_cep, '')), '');

  v_cep text :=
    nullif(
      pg_catalog.regexp_replace(
        coalesce(p_cep, ''),
        '[^0-9]',
        '',
        'g'
      ),
      ''
    );

  v_street text :=
    nullif(pg_catalog.btrim(coalesce(p_street, '')), '');

  v_number text :=
    nullif(pg_catalog.btrim(coalesce(p_number, '')), '');

  v_complement text :=
    nullif(pg_catalog.btrim(coalesce(p_complement, '')), '');

  v_district text :=
    nullif(pg_catalog.btrim(coalesce(p_district, '')), '');

  v_city text :=
    nullif(pg_catalog.btrim(coalesce(p_city, '')), '');

  v_state text :=
    nullif(
      pg_catalog.upper(
        pg_catalog.btrim(coalesce(p_state, ''))
      ),
      ''
    );

  v_customer_visit_mode text :=
    nullif(
      pg_catalog.lower(
        pg_catalog.btrim(coalesce(p_customer_visit_mode, ''))
      ),
      ''
    );

  v_reference_point text :=
    nullif(pg_catalog.btrim(coalesce(p_reference_point, '')), '');

  v_directions_notes text :=
    nullif(pg_catalog.btrim(coalesce(p_directions_notes, '')), '');
begin
  perform public.assert_store_general_address_settings_scope(
    p_organization_id,
    p_store_id
  );

  if p_has_public_address is null then
    raise exception 'has_public_address must be explicitly configured'
      using errcode = '22023';
  end if;

  if p_has_public_address is false then
    v_cep := null;
    v_street := null;
    v_number := null;
    v_complement := null;
    v_district := null;
    v_city := null;
    v_state := null;
    v_customer_visit_mode := null;
    v_reference_point := null;
    v_directions_notes := null;
  else
    if v_street is null then
      raise exception 'street is required when store has public address'
        using errcode = '22023';
    end if;

    if v_number is null then
      raise exception 'number is required when store has public address'
        using errcode = '22023';
    end if;

    if v_district is null then
      raise exception 'district is required when store has public address'
        using errcode = '22023';
    end if;

    if v_city is null then
      raise exception 'city is required when store has public address'
        using errcode = '22023';
    end if;

    if v_state is null then
      raise exception 'state is required when store has public address'
        using errcode = '22023';
    end if;

    if v_customer_visit_mode is null
       or v_customer_visit_mode not in (
         'sem_agendamento',
         'com_agendamento',
         'nao_recebe_clientes'
       ) then
      raise exception 'invalid customer_visit_mode'
        using errcode = '22023';
    end if;

    if v_cep_input is not null
       and (
         v_cep is null
         or pg_catalog.length(v_cep) <> 8
       ) then
      raise exception 'cep must contain exactly 8 digits when provided'
        using errcode = '22023';
    end if;
  end if;

  insert into public.store_general_address_settings (
    organization_id,
    store_id,
    has_public_address,
    cep,
    street,
    number,
    complement,
    district,
    city,
    state,
    customer_visit_mode,
    reference_point,
    directions_notes,
    address_configured_at
  )
  values (
    p_organization_id,
    p_store_id,
    p_has_public_address,
    v_cep,
    v_street,
    v_number,
    v_complement,
    v_district,
    v_city,
    v_state,
    v_customer_visit_mode,
    v_reference_point,
    v_directions_notes,
    pg_catalog.clock_timestamp()
  )
  on conflict (organization_id, store_id)
  do update
  set
    has_public_address = excluded.has_public_address,
    cep = excluded.cep,
    street = excluded.street,
    number = excluded.number,
    complement = excluded.complement,
    district = excluded.district,
    city = excluded.city,
    state = excluded.state,
    customer_visit_mode = excluded.customer_visit_mode,
    reference_point = excluded.reference_point,
    directions_notes = excluded.directions_notes,
    address_configured_at =
      coalesce(
        store_general_address_settings.address_configured_at,
        excluded.address_configured_at
      )
  returning *
  into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_general_address_settings_scoped(
  uuid,
  uuid,
  boolean,
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
)
owner to postgres;

revoke all
  on function public.upsert_store_general_address_settings_scoped(
    uuid,
    uuid,
    boolean,
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
  )
  from public, anon, service_role;

grant execute
  on function public.upsert_store_general_address_settings_scoped(
    uuid,
    uuid,
    boolean,
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
  )
  to authenticated;

commit;
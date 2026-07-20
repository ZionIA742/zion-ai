-- ZION / Pilar 9 / Fase 4 / 4.1A-2
-- Fundação canônica e auditável de vínculo entre lead legado e customer.
--
-- ESCOPO DESTA MIGRATION:
-- - cria a normalização brasileira de identidade WhatsApp;
-- - cria public.lead_customer_links;
-- - cria integridade composta, histórico, idempotência, RLS e funções de escrita;
-- - NÃO executa backfill;
-- - NÃO altera linhas existentes de leads, customers, customer_store_links
--   ou customer_channel_identities;
-- - NÃO concede escrita direta a authenticated nem service_role;
-- - toda escrita operacional ocorre por funções SECURITY DEFINER executáveis
--   somente por service_role.
--
-- IMPORTANTE:
-- - aplicar uma única vez;
-- - não editar migrations já aplicadas;
-- - qualquer divergência de pré-condição ou pós-condição aborta a transação.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:lead_customer_links:foundation',
    0
  )
);

-- --------------------------------------------------------------------------
-- Pré-condições e inventário de linhas que não podem ser alteradas.
-- --------------------------------------------------------------------------

create temp table _p9_lcl_preflight_counts (
  object_name text primary key,
  row_count bigint not null
) on commit drop;

insert into _p9_lcl_preflight_counts (object_name, row_count)
values
  ('public.leads', (select count(*) from public.leads)),
  ('public.customers', (select count(*) from public.customers)),
  ('public.customer_store_links', (select count(*) from public.customer_store_links)),
  ('public.customer_channel_identities', (select count(*) from public.customer_channel_identities));

do $preflight$
begin
  if to_regclass('public.leads') is null
     or to_regclass('public.customers') is null
     or to_regclass('public.customer_store_links') is null
     or to_regclass('public.customer_channel_identities') is null
     or to_regclass('public.organizations') is null
     or to_regclass('public.stores') is null then
    raise exception using
      errcode = 'P0001',
      message = 'lead_customer_links foundation prerequisites are missing';
  end if;

  if to_regclass('public.lead_customer_links') is not null then
    raise exception using
      errcode = 'P0001',
      message = 'lead_customer_links already exists; migration must not be reapplied';
  end if;

  if to_regprocedure('public.normalize_br_whatsapp_identity(text)') is not null
     or to_regprocedure('public.lead_customer_link_request_role()') is not null
     or to_regprocedure('public.enforce_lead_customer_link_write_rules()') is not null
     or to_regprocedure('public.link_lead_to_customer(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text,text,uuid,jsonb,timestamp with time zone)') is not null
     or to_regprocedure('public.close_lead_customer_link(uuid,uuid,uuid,text,uuid,text,text,jsonb,uuid)') is not null
     or to_regprocedure('public.replace_lead_customer_link(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text,text,uuid,jsonb,text,text,jsonb,timestamp with time zone)') is not null then
    raise exception using
      errcode = 'P0001',
      message = 'one or more lead_customer_links functions already exist';
  end if;

  if to_regclass('public.leads_id_organization_store_uidx') is not null
     or to_regclass('public.customer_store_links_customer_org_store_uidx') is not null
     or to_regclass('public.customer_channel_identities_id_customer_org_uidx') is not null then
    raise exception using
      errcode = 'P0001',
      message = 'one or more support indexes already exist unexpectedly';
  end if;

  if not exists (
    select 1
    from pg_roles
    where rolname = 'postgres'
      and rolbypassrls
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postgres owner must have BYPASSRLS';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'id'
      and data_type = 'uuid'
      and is_nullable = 'NO'
  )
  or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'organization_id'
      and data_type = 'uuid'
      and is_nullable = 'NO'
  )
  or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'store_id'
      and data_type = 'uuid'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'leads structure differs from the approved prerequisite';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'customers'
      and indexname = 'customers_id_organization_uidx'
      and indexdef ilike '%unique%'
      and indexdef ilike '%(id, organization_id)%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'customers composite identity index is missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'stores'
      and indexdef ilike '%unique%'
      and indexdef ilike '%(id, organization_id)%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'stores composite identity index is missing';
  end if;
end;
$preflight$;

-- --------------------------------------------------------------------------
-- Índices compostos de suporte para FKs reais por organização e loja.
-- --------------------------------------------------------------------------

create unique index leads_id_organization_store_uidx
  on public.leads (id, organization_id, store_id);

create unique index customer_store_links_customer_org_store_uidx
  on public.customer_store_links (customer_id, organization_id, store_id);

create unique index customer_channel_identities_id_customer_org_uidx
  on public.customer_channel_identities (id, customer_id, organization_id);

-- --------------------------------------------------------------------------
-- Normalização canônica brasileira para identidade WhatsApp.
-- --------------------------------------------------------------------------

create function public.normalize_br_whatsapp_identity(p_value text)
returns text
language plpgsql
immutable
strict
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_digits text;
begin
  v_digits := pg_catalog.regexp_replace(p_value, '[^0-9]', '', 'g');

  if pg_catalog.length(v_digits) = 11 then
    return '55' || v_digits;
  end if;

  if pg_catalog.length(v_digits) = 13
     and pg_catalog.left(v_digits, 2) = '55' then
    return v_digits;
  end if;

  raise exception using
    errcode = '22023',
    message = 'invalid Brazilian WhatsApp identity';
end;
$function$;

alter function public.normalize_br_whatsapp_identity(text) owner to postgres;

comment on function public.normalize_br_whatsapp_identity(text) is
  'Normaliza identidade brasileira de WhatsApp para 55 + DDD + número, somente dígitos.';

revoke all on function public.normalize_br_whatsapp_identity(text)
  from public, anon, authenticated, service_role;

grant execute on function public.normalize_br_whatsapp_identity(text)
  to service_role;

-- --------------------------------------------------------------------------
-- Helper interno para identificar o papel chamador.
-- --------------------------------------------------------------------------

create function public.lead_customer_link_request_role()
returns text
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_role text;
  v_claims text;
begin
  v_role := nullif(current_setting('request.jwt.claim.role', true), '');

  if v_role is not null then
    return v_role;
  end if;

  v_claims := nullif(current_setting('request.jwt.claims', true), '');

  if v_claims is not null then
    begin
      v_role := nullif((v_claims::jsonb ->> 'role'), '');
    exception
      when others then
        v_role := null;
    end;
  end if;

  if v_role is not null then
    return v_role;
  end if;

  return nullif(current_setting('role', true), '');
end;
$function$;

alter function public.lead_customer_link_request_role() owner to postgres;

comment on function public.lead_customer_link_request_role() is
  'Helper interno para identificar o papel efetivo da requisição nas funções controladas de lead_customer_links.';

revoke all on function public.lead_customer_link_request_role()
  from public, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- Tabela histórica e auditável.
-- --------------------------------------------------------------------------

create table public.lead_customer_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  lead_id uuid not null,
  customer_id uuid not null,
  source_identity_id uuid null,
  replaces_link_id uuid null,

  status text not null default 'active',
  source text not null,
  source_reference text null,

  idempotency_key text null,
  correlation_id uuid null,

  linked_at timestamptz not null default now(),
  linked_by_actor_type text not null,
  linked_by_user_id uuid null,

  unlinked_at timestamptz null,
  unlinked_by_actor_type text null,
  unlinked_by_user_id uuid null,
  unlink_reason_code text null,
  unlink_reason text null,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lead_customer_links_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete cascade,

  constraint lead_customer_links_store_org_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint lead_customer_links_lead_org_store_fkey
    foreign key (lead_id, organization_id, store_id)
    references public.leads(id, organization_id, store_id)
    on delete restrict,

  constraint lead_customer_links_customer_org_fkey
    foreign key (customer_id, organization_id)
    references public.customers(id, organization_id)
    on delete restrict,

  constraint lead_customer_links_customer_store_fkey
    foreign key (customer_id, organization_id, store_id)
    references public.customer_store_links(customer_id, organization_id, store_id)
    on delete restrict,

  constraint lead_customer_links_source_identity_fkey
    foreign key (source_identity_id, customer_id, organization_id)
    references public.customer_channel_identities(id, customer_id, organization_id)
    on delete restrict,

  constraint lead_customer_links_linked_by_user_fkey
    foreign key (linked_by_user_id)
    references auth.users(id)
    on delete set null,

  constraint lead_customer_links_unlinked_by_user_fkey
    foreign key (unlinked_by_user_id)
    references auth.users(id)
    on delete set null,

  constraint lead_customer_links_status_check
    check (status in ('active', 'inactive')),

  constraint lead_customer_links_source_check
    check (source in ('legacy_backfill', 'whatsapp_identity', 'manual', 'merge_repair', 'system')),

  constraint lead_customer_links_link_actor_check
    check (
      linked_by_actor_type in ('human', 'ai', 'system', 'migration')
      and (
        linked_by_actor_type = 'human'
        or linked_by_user_id is null
      )
    ),

  constraint lead_customer_links_unlink_state_check
    check (
      (
        status = 'active'
        and unlinked_at is null
        and unlinked_by_actor_type is null
        and unlinked_by_user_id is null
        and unlink_reason_code is null
        and unlink_reason is null
      )
      or (
        status = 'inactive'
        and unlinked_at is not null
        and unlinked_by_actor_type in ('human', 'ai', 'system', 'migration')
        and unlink_reason_code is not null
        and (
          unlinked_by_actor_type = 'human'
          or unlinked_by_user_id is null
        )
      )
    ),

  constraint lead_customer_links_source_reference_not_blank
    check (source_reference is null or pg_catalog.length(pg_catalog.btrim(source_reference)) > 0),

  constraint lead_customer_links_idempotency_not_blank
    check (idempotency_key is null or pg_catalog.length(pg_catalog.btrim(idempotency_key)) > 0),

  constraint lead_customer_links_unlink_reason_code_format
    check (unlink_reason_code is null or unlink_reason_code ~ '^[a-z0-9_:-]+$'),

  constraint lead_customer_links_unlink_reason_not_blank
    check (unlink_reason is null or pg_catalog.length(pg_catalog.btrim(unlink_reason)) > 0),

  constraint lead_customer_links_metadata_object_check
    check (pg_catalog.jsonb_typeof(metadata) = 'object'),

  constraint lead_customer_links_source_identity_required
    check (
      source not in ('legacy_backfill', 'whatsapp_identity')
      or source_identity_id is not null
    ),

  constraint lead_customer_links_not_replace_self
    check (replaces_link_id is null or replaces_link_id <> id)
);

alter table public.lead_customer_links owner to postgres;

comment on table public.lead_customer_links is
  'Histórico canônico e auditável da relação entre lead legado e customer, com uma ligação ativa por lead.';

comment on column public.lead_customer_links.source_identity_id is
  'Identidade de canal que serviu como evidência do vínculo, sem duplicar telefone ou outro dado pessoal.';

comment on column public.lead_customer_links.replaces_link_id is
  'Vínculo histórico anterior substituído explicitamente por esta linha.';

comment on column public.lead_customer_links.idempotency_key is
  'Chave textual de idempotência da operação de criação do vínculo.';

comment on column public.lead_customer_links.correlation_id is
  'UUID de correlação para agrupar operações pertencentes à mesma execução ou fluxo.';

create unique index lead_customer_links_id_org_store_lead_uidx
  on public.lead_customer_links (id, organization_id, store_id, lead_id);

create unique index lead_customer_links_one_active_per_lead_uidx
  on public.lead_customer_links (organization_id, store_id, lead_id)
  where status = 'active';

create unique index lead_customer_links_idempotency_uidx
  on public.lead_customer_links (organization_id, idempotency_key)
  where idempotency_key is not null;

create unique index lead_customer_links_replaces_once_uidx
  on public.lead_customer_links (replaces_link_id)
  where replaces_link_id is not null;

create index lead_customer_links_customer_status_idx
  on public.lead_customer_links (organization_id, store_id, customer_id, status, linked_at desc);

create index lead_customer_links_source_identity_idx
  on public.lead_customer_links (organization_id, source_identity_id)
  where source_identity_id is not null;

create index lead_customer_links_correlation_idx
  on public.lead_customer_links (correlation_id, linked_at desc)
  where correlation_id is not null;

create index lead_customer_links_lead_history_idx
  on public.lead_customer_links (organization_id, store_id, lead_id, linked_at desc);

alter table public.lead_customer_links
  add constraint lead_customer_links_replaces_same_lead_fkey
  foreign key (replaces_link_id, organization_id, store_id, lead_id)
  references public.lead_customer_links (id, organization_id, store_id, lead_id)
  on delete restrict;

-- --------------------------------------------------------------------------
-- Trigger de histórico e integridade não declarativa.
-- --------------------------------------------------------------------------

create function public.enforce_lead_customer_link_write_rules()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_replaced public.lead_customer_links;
begin
  if tg_table_schema <> 'public'
     or tg_table_name <> 'lead_customer_links' then
    raise exception using
      errcode = 'P0001',
      message = 'invalid trigger binding for lead_customer_links';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'active' then
      raise exception using
        errcode = '23514',
        message = 'lead customer link state mismatch';
    end if;

    if (
      new.linked_by_actor_type = 'human'
      and new.linked_by_user_id is null
    )
    or (
      new.linked_by_actor_type <> 'human'
      and new.linked_by_user_id is not null
    ) then
      raise exception using
        errcode = '23514',
        message = 'lead customer link actor mismatch';
    end if;

    if new.source in ('legacy_backfill', 'whatsapp_identity')
       and not exists (
         select 1
         from public.customer_channel_identities identity_row
         where identity_row.id = new.source_identity_id
           and identity_row.customer_id = new.customer_id
           and identity_row.organization_id = new.organization_id
           and identity_row.channel = 'whatsapp'
           and identity_row.normalized_external_identity
             ~ '^55[0-9]{11}$'
       ) then
      raise exception using
        errcode = '23514',
        message = 'lead customer link relation mismatch';
    end if;

    if not exists (
      select 1
      from public.customers c
      where c.id = new.customer_id
        and c.organization_id = new.organization_id
        and c.merged_into_customer_id is null
    ) then
      raise exception using
        errcode = '23514',
        message = 'lead customer link relation mismatch';
    end if;

    if new.replaces_link_id is not null then
      select old_link.*
      into v_replaced
      from public.lead_customer_links old_link
      where old_link.id = new.replaces_link_id
        and old_link.organization_id = new.organization_id
        and old_link.store_id = new.store_id
        and old_link.lead_id = new.lead_id;

      if not found
         or v_replaced.status <> 'inactive'
         or v_replaced.unlinked_at is null
         or new.linked_at < v_replaced.unlinked_at then
        raise exception using
          errcode = '23514',
          message = 'lead customer link replacement mismatch';
      end if;
    end if;

    new.updated_at := coalesce(new.updated_at, new.created_at, pg_catalog.clock_timestamp());
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Permite somente o SET NULL automático das FKs para auth.users quando
    -- uma conta humana for removida. Nenhum outro campo pode mudar.
    if (
      pg_catalog.to_jsonb(new)
        - 'linked_by_user_id'
        - 'unlinked_by_user_id'
    ) = (
      pg_catalog.to_jsonb(old)
        - 'linked_by_user_id'
        - 'unlinked_by_user_id'
    )
    and (
      new.linked_by_user_id is not distinct from old.linked_by_user_id
      or (
        old.linked_by_user_id is not null
        and new.linked_by_user_id is null
      )
    )
    and (
      new.unlinked_by_user_id is not distinct from old.unlinked_by_user_id
      or (
        old.unlinked_by_user_id is not null
        and new.unlinked_by_user_id is null
      )
    )
    and (
      new.linked_by_user_id is distinct from old.linked_by_user_id
      or new.unlinked_by_user_id is distinct from old.unlinked_by_user_id
    ) then
      return new;
    end if;

    if new.organization_id is distinct from old.organization_id
       or new.store_id is distinct from old.store_id
       or new.lead_id is distinct from old.lead_id
       or new.customer_id is distinct from old.customer_id
       or new.source_identity_id is distinct from old.source_identity_id
       or new.replaces_link_id is distinct from old.replaces_link_id
       or new.source is distinct from old.source
       or new.source_reference is distinct from old.source_reference
       or new.idempotency_key is distinct from old.idempotency_key
       or new.correlation_id is distinct from old.correlation_id
       or new.linked_at is distinct from old.linked_at
       or new.linked_by_actor_type is distinct from old.linked_by_actor_type
       or new.linked_by_user_id is distinct from old.linked_by_user_id
       or new.created_at is distinct from old.created_at then
      raise exception using
        errcode = 'P0001',
        message = 'lead customer link core fields are immutable';
    end if;

    if old.status = 'inactive' then
      raise exception using
        errcode = 'P0001',
        message = 'inactive lead customer link is immutable';
    end if;

    if old.status <> 'active' or new.status <> 'inactive' then
      raise exception using
        errcode = 'P0001',
        message = 'lead customer link can only transition from active to inactive';
    end if;

    if (
      new.unlinked_by_actor_type = 'human'
      and new.unlinked_by_user_id is null
    )
    or (
      new.unlinked_by_actor_type <> 'human'
      and new.unlinked_by_user_id is not null
    ) then
      raise exception using
        errcode = '23514',
        message = 'lead customer link actor mismatch';
    end if;

    new.updated_at := pg_catalog.clock_timestamp();
    return new;
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'unsupported operation for lead_customer_links';
end;
$function$;

alter function public.enforce_lead_customer_link_write_rules() owner to postgres;

comment on function public.enforce_lead_customer_link_write_rules() is
  'Protege histórico, cliente canônico e transição active -> inactive de lead_customer_links.';

revoke all on function public.enforce_lead_customer_link_write_rules()
  from public, anon, authenticated, service_role;

create trigger lead_customer_links_enforce_write_rules
before insert or update on public.lead_customer_links
for each row execute function public.enforce_lead_customer_link_write_rules();

-- --------------------------------------------------------------------------
-- Função controlada: criar vínculo.
-- --------------------------------------------------------------------------

create function public.link_lead_to_customer(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_customer_id uuid,
  p_source text,
  p_linked_by_actor_type text,
  p_linked_by_user_id uuid default null,
  p_source_identity_id uuid default null,
  p_source_reference text default null,
  p_idempotency_key text default null,
  p_correlation_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_linked_at timestamptz default null
)
returns public.lead_customer_links
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_request_role text;
  v_existing public.lead_customer_links;
  v_result public.lead_customer_links;
  v_idempotency_key text;
  v_source_reference text;
  v_metadata jsonb;
begin
  v_request_role := public.lead_customer_link_request_role();

  if not (v_request_role = 'service_role' or session_user = 'postgres') then
    raise exception using
      errcode = '42501',
      message = 'lead customer link operation is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_lead_id is null
     or p_customer_id is null
     or p_source is null
     or p_linked_by_actor_type is null then
    raise exception using
      errcode = '22004',
      message = 'lead customer link input is incomplete';
  end if;

  if p_linked_by_actor_type not in ('human', 'ai', 'system', 'migration')
     or (
       p_linked_by_actor_type = 'human'
       and p_linked_by_user_id is null
     )
     or (
       p_linked_by_actor_type <> 'human'
       and p_linked_by_user_id is not null
     ) then
    raise exception using
      errcode = '22023',
      message = 'lead customer link actor is invalid';
  end if;

  v_idempotency_key := nullif(pg_catalog.btrim(p_idempotency_key), '');
  v_source_reference := nullif(pg_catalog.btrim(p_source_reference), '');
  v_metadata := coalesce(p_metadata, '{}'::jsonb);

  if pg_catalog.jsonb_typeof(v_metadata) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'lead customer link metadata must be an object';
  end if;

  if v_idempotency_key is not null then
    select link_row.*
    into v_existing
    from public.lead_customer_links link_row
    where link_row.organization_id = p_organization_id
      and link_row.idempotency_key = v_idempotency_key;

    if found then
      if v_existing.store_id = p_store_id
         and v_existing.lead_id = p_lead_id
         and v_existing.customer_id = p_customer_id
         and v_existing.source = p_source
         and v_existing.source_identity_id is not distinct from p_source_identity_id then
        return v_existing;
      end if;

      raise exception using
        errcode = '23505',
        message = 'lead customer link idempotency conflict';
    end if;
  end if;

  perform 1
  from public.leads l
  where l.id = p_lead_id
    and l.organization_id = p_organization_id
    and l.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'lead customer link relation mismatch';
  end if;

  if not exists (
    select 1
    from public.customers c
    where c.id = p_customer_id
      and c.organization_id = p_organization_id
      and c.merged_into_customer_id is null
  )
  or not exists (
    select 1
    from public.customer_store_links store_link
    where store_link.customer_id = p_customer_id
      and store_link.organization_id = p_organization_id
      and store_link.store_id = p_store_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'lead customer link relation mismatch';
  end if;

  if p_source_identity_id is not null then
    if not exists (
      select 1
      from public.customer_channel_identities identity_row
      where identity_row.id = p_source_identity_id
        and identity_row.customer_id = p_customer_id
        and identity_row.organization_id = p_organization_id
        and (
          p_source not in ('legacy_backfill', 'whatsapp_identity')
          or (
            identity_row.channel = 'whatsapp'
            and identity_row.normalized_external_identity
              ~ '^55[0-9]{11}$'
          )
        )
    ) then
      raise exception using
        errcode = '23514',
        message = 'lead customer link relation mismatch';
    end if;
  elsif p_source in ('legacy_backfill', 'whatsapp_identity') then
    raise exception using
      errcode = '23514',
      message = 'lead customer link relation mismatch';
  end if;

  select link_row.*
  into v_existing
  from public.lead_customer_links link_row
  where link_row.organization_id = p_organization_id
    and link_row.store_id = p_store_id
    and link_row.lead_id = p_lead_id
    and link_row.status = 'active'
  for update;

  if found then
    raise exception using
      errcode = '23505',
      message = 'lead already has an active customer link';
  end if;

  begin
    insert into public.lead_customer_links (
      organization_id,
      store_id,
      lead_id,
      customer_id,
      source_identity_id,
      replaces_link_id,
      status,
      source,
      source_reference,
      idempotency_key,
      correlation_id,
      linked_at,
      linked_by_actor_type,
      linked_by_user_id,
      metadata
    )
    values (
      p_organization_id,
      p_store_id,
      p_lead_id,
      p_customer_id,
      p_source_identity_id,
      null,
      'active',
      p_source,
      v_source_reference,
      v_idempotency_key,
      p_correlation_id,
      coalesce(p_linked_at, pg_catalog.clock_timestamp()),
      p_linked_by_actor_type,
      p_linked_by_user_id,
      v_metadata
    )
    returning * into v_result;
  exception
    when unique_violation then
      if v_idempotency_key is not null then
        select link_row.*
        into v_existing
        from public.lead_customer_links link_row
        where link_row.organization_id = p_organization_id
          and link_row.idempotency_key = v_idempotency_key;

        if found
           and v_existing.store_id = p_store_id
           and v_existing.lead_id = p_lead_id
           and v_existing.customer_id = p_customer_id
           and v_existing.source = p_source
           and v_existing.source_identity_id is not distinct from p_source_identity_id then
          return v_existing;
        end if;
      end if;

      raise;
  end;

  return v_result;
end;
$function$;

alter function public.link_lead_to_customer(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, text, uuid, jsonb, timestamptz
) owner to postgres;

comment on function public.link_lead_to_customer(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, text, uuid, jsonb, timestamptz
) is
  'Cria vínculo ativo lead -> customer de forma validada, idempotente e auditável.';

revoke all on function public.link_lead_to_customer(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, text, uuid, jsonb, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.link_lead_to_customer(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, text, uuid, jsonb, timestamptz
) to service_role;

-- --------------------------------------------------------------------------
-- Função controlada: encerrar vínculo.
-- --------------------------------------------------------------------------

create function public.close_lead_customer_link(
  p_link_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_unlinked_by_actor_type text,
  p_unlinked_by_user_id uuid,
  p_unlink_reason_code text,
  p_unlink_reason text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_correlation_id uuid default null
)
returns public.lead_customer_links
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_request_role text;
  v_link public.lead_customer_links;
  v_result public.lead_customer_links;
  v_metadata jsonb;
  v_unlink_reason text;
  v_unlink_reason_code text;
begin
  v_request_role := public.lead_customer_link_request_role();

  if not (v_request_role = 'service_role' or session_user = 'postgres') then
    raise exception using
      errcode = '42501',
      message = 'lead customer link operation is not authorized';
  end if;

  if p_link_id is null
     or p_organization_id is null
     or p_store_id is null
     or p_unlinked_by_actor_type is null
     or p_unlink_reason_code is null then
    raise exception using
      errcode = '22004',
      message = 'lead customer link close input is incomplete';
  end if;

  if p_unlinked_by_actor_type not in ('human', 'ai', 'system', 'migration')
     or (
       p_unlinked_by_actor_type = 'human'
       and p_unlinked_by_user_id is null
     )
     or (
       p_unlinked_by_actor_type <> 'human'
       and p_unlinked_by_user_id is not null
     ) then
    raise exception using
      errcode = '22023',
      message = 'lead customer link actor is invalid';
  end if;

  v_metadata := coalesce(p_metadata, '{}'::jsonb);
  v_unlink_reason := nullif(pg_catalog.btrim(p_unlink_reason), '');
  v_unlink_reason_code := nullif(pg_catalog.btrim(p_unlink_reason_code), '');

  if pg_catalog.jsonb_typeof(v_metadata) <> 'object'
     or v_unlink_reason_code is null then
    raise exception using
      errcode = '22023',
      message = 'lead customer link close input is invalid';
  end if;

  select link_row.*
  into v_link
  from public.lead_customer_links link_row
  where link_row.id = p_link_id
    and link_row.organization_id = p_organization_id
    and link_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'lead customer link relation mismatch';
  end if;

  if v_link.status = 'inactive' then
    if v_link.unlink_reason_code = v_unlink_reason_code then
      return v_link;
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'inactive lead customer link is immutable';
  end if;

  update public.lead_customer_links
  set
    status = 'inactive',
    unlinked_at = pg_catalog.clock_timestamp(),
    unlinked_by_actor_type = p_unlinked_by_actor_type,
    unlinked_by_user_id = p_unlinked_by_user_id,
    unlink_reason_code = v_unlink_reason_code,
    unlink_reason = v_unlink_reason,
    metadata = pg_catalog.jsonb_set(
      metadata,
      '{unlink}',
      v_metadata || pg_catalog.jsonb_build_object('correlation_id', p_correlation_id),
      true
    )
  where id = v_link.id
  returning * into v_result;

  return v_result;
end;
$function$;

alter function public.close_lead_customer_link(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, uuid
) owner to postgres;

comment on function public.close_lead_customer_link(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, uuid
) is
  'Encerra vínculo ativo sem exclusão física, preservando ator, motivo e metadata de encerramento.';

revoke all on function public.close_lead_customer_link(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.close_lead_customer_link(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, uuid
) to service_role;

-- --------------------------------------------------------------------------
-- Função controlada: substituir vínculo de forma atômica.
-- --------------------------------------------------------------------------

create function public.replace_lead_customer_link(
  p_old_link_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_new_customer_id uuid,
  p_source text,
  p_actor_type text,
  p_actor_user_id uuid default null,
  p_source_identity_id uuid default null,
  p_source_reference text default null,
  p_idempotency_key text default null,
  p_correlation_id uuid default null,
  p_link_metadata jsonb default '{}'::jsonb,
  p_unlink_reason_code text default 'manual_correction',
  p_unlink_reason text default null,
  p_unlink_metadata jsonb default '{}'::jsonb,
  p_linked_at timestamptz default null
)
returns public.lead_customer_links
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_request_role text;
  v_old public.lead_customer_links;
  v_existing_replacement public.lead_customer_links;
  v_result public.lead_customer_links;
  v_source_reference text;
  v_idempotency_key text;
  v_unlink_reason_code text;
  v_unlink_reason text;
  v_link_metadata jsonb;
  v_unlink_metadata jsonb;
begin
  v_request_role := public.lead_customer_link_request_role();

  if not (v_request_role = 'service_role' or session_user = 'postgres') then
    raise exception using
      errcode = '42501',
      message = 'lead customer link operation is not authorized';
  end if;

  if p_old_link_id is null
     or p_organization_id is null
     or p_store_id is null
     or p_new_customer_id is null
     or p_source is null
     or p_actor_type is null
     or p_unlink_reason_code is null then
    raise exception using
      errcode = '22004',
      message = 'lead customer link replacement input is incomplete';
  end if;

  if p_actor_type not in ('human', 'ai', 'system', 'migration')
     or (
       p_actor_type = 'human'
       and p_actor_user_id is null
     )
     or (
       p_actor_type <> 'human'
       and p_actor_user_id is not null
     ) then
    raise exception using
      errcode = '22023',
      message = 'lead customer link actor is invalid';
  end if;

  v_source_reference := nullif(pg_catalog.btrim(p_source_reference), '');
  v_idempotency_key := nullif(pg_catalog.btrim(p_idempotency_key), '');
  v_unlink_reason_code := nullif(pg_catalog.btrim(p_unlink_reason_code), '');
  v_unlink_reason := nullif(pg_catalog.btrim(p_unlink_reason), '');
  v_link_metadata := coalesce(p_link_metadata, '{}'::jsonb);
  v_unlink_metadata := coalesce(p_unlink_metadata, '{}'::jsonb);

  if pg_catalog.jsonb_typeof(v_link_metadata) <> 'object'
     or pg_catalog.jsonb_typeof(v_unlink_metadata) <> 'object'
     or v_unlink_reason_code is null then
    raise exception using
      errcode = '22023',
      message = 'lead customer link replacement input is invalid';
  end if;

  select link_row.*
  into v_old
  from public.lead_customer_links link_row
  where link_row.id = p_old_link_id
    and link_row.organization_id = p_organization_id
    and link_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'lead customer link relation mismatch';
  end if;

  select replacement.*
  into v_existing_replacement
  from public.lead_customer_links replacement
  where replacement.replaces_link_id = v_old.id;

  if found then
    if v_existing_replacement.customer_id = p_new_customer_id
       and v_existing_replacement.source = p_source
       and v_existing_replacement.source_identity_id is not distinct from p_source_identity_id then
      return v_existing_replacement;
    end if;

    raise exception using
      errcode = '23505',
      message = 'lead customer link replacement conflict';
  end if;

  if v_old.status <> 'active' then
    raise exception using
      errcode = 'P0001',
      message = 'only active lead customer link can be replaced';
  end if;

  if v_old.customer_id = p_new_customer_id then
    raise exception using
      errcode = '22023',
      message = 'replacement customer must differ from current customer';
  end if;

  if not exists (
    select 1
    from public.customers c
    where c.id = p_new_customer_id
      and c.organization_id = p_organization_id
      and c.merged_into_customer_id is null
  )
  or not exists (
    select 1
    from public.customer_store_links store_link
    where store_link.customer_id = p_new_customer_id
      and store_link.organization_id = p_organization_id
      and store_link.store_id = p_store_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'lead customer link relation mismatch';
  end if;

  if p_source_identity_id is not null then
    if not exists (
      select 1
      from public.customer_channel_identities identity_row
      where identity_row.id = p_source_identity_id
        and identity_row.customer_id = p_new_customer_id
        and identity_row.organization_id = p_organization_id
        and (
          p_source not in ('legacy_backfill', 'whatsapp_identity')
          or (
            identity_row.channel = 'whatsapp'
            and identity_row.normalized_external_identity
              ~ '^55[0-9]{11}$'
          )
        )
    ) then
      raise exception using
        errcode = '23514',
        message = 'lead customer link relation mismatch';
    end if;
  elsif p_source in ('legacy_backfill', 'whatsapp_identity') then
    raise exception using
      errcode = '23514',
      message = 'lead customer link relation mismatch';
  end if;

  if v_idempotency_key is not null
     and exists (
       select 1
       from public.lead_customer_links link_row
       where link_row.organization_id = p_organization_id
         and link_row.idempotency_key = v_idempotency_key
     ) then
    raise exception using
      errcode = '23505',
      message = 'lead customer link idempotency conflict';
  end if;

  update public.lead_customer_links
  set
    status = 'inactive',
    unlinked_at = pg_catalog.clock_timestamp(),
    unlinked_by_actor_type = p_actor_type,
    unlinked_by_user_id = p_actor_user_id,
    unlink_reason_code = v_unlink_reason_code,
    unlink_reason = v_unlink_reason,
    metadata = pg_catalog.jsonb_set(
      metadata,
      '{unlink}',
      v_unlink_metadata || pg_catalog.jsonb_build_object('correlation_id', p_correlation_id),
      true
    )
  where id = v_old.id;

  begin
    insert into public.lead_customer_links (
      organization_id,
      store_id,
      lead_id,
      customer_id,
      source_identity_id,
      replaces_link_id,
      status,
      source,
      source_reference,
      idempotency_key,
      correlation_id,
      linked_at,
      linked_by_actor_type,
      linked_by_user_id,
      metadata
    )
    values (
      p_organization_id,
      p_store_id,
      v_old.lead_id,
      p_new_customer_id,
      p_source_identity_id,
      v_old.id,
      'active',
      p_source,
      v_source_reference,
      v_idempotency_key,
      p_correlation_id,
      coalesce(p_linked_at, pg_catalog.clock_timestamp()),
      p_actor_type,
      p_actor_user_id,
      v_link_metadata || pg_catalog.jsonb_build_object(
        'replacement',
        pg_catalog.jsonb_build_object(
          'replaces_link_id', v_old.id,
          'reason_code', v_unlink_reason_code
        )
      )
    )
    returning * into v_result;
  exception
    when unique_violation then
      select replacement.*
      into v_existing_replacement
      from public.lead_customer_links replacement
      where replacement.replaces_link_id = v_old.id;

      if found
         and v_existing_replacement.customer_id = p_new_customer_id
         and v_existing_replacement.source = p_source
         and v_existing_replacement.source_identity_id is not distinct from p_source_identity_id then
        return v_existing_replacement;
      end if;

      raise;
  end;

  return v_result;
end;
$function$;

alter function public.replace_lead_customer_link(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, text, uuid, jsonb, text, text, jsonb, timestamptz
) owner to postgres;

comment on function public.replace_lead_customer_link(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, text, uuid, jsonb, text, text, jsonb, timestamptz
) is
  'Substitui vínculo ativo de forma atômica, encerrando o anterior e preservando a cadeia histórica.';

revoke all on function public.replace_lead_customer_link(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, text, uuid, jsonb, text, text, jsonb, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.replace_lead_customer_link(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, text, uuid, jsonb, text, text, jsonb, timestamptz
) to service_role;

-- --------------------------------------------------------------------------
-- RLS e grants.
-- --------------------------------------------------------------------------

alter table public.lead_customer_links enable row level security;

create policy lead_customer_links_select_by_membership
on public.lead_customer_links
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.organization_id = lead_customer_links.organization_id
      and m.user_id = auth.uid()
  )
);

revoke all on table public.lead_customer_links
  from public, anon, authenticated, service_role;

grant select on table public.lead_customer_links
  to authenticated, service_role;

-- --------------------------------------------------------------------------
-- Pós-condições e garantia de zero alteração em dados de negócio.
-- --------------------------------------------------------------------------

do $postconditions$
declare
  v_count bigint;
begin
  if to_regclass('public.lead_customer_links') is null then
    raise exception using
      errcode = 'P0001',
      message = 'lead_customer_links table was not created';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lead_customer_links'
  ) <> 23 then
    raise exception using
      errcode = 'P0001',
      message = 'lead_customer_links column contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'lead_customer_links'
      and c.relrowsecurity
      and not c.relforcerowsecurity
      and pg_get_userbyid(c.relowner) = 'postgres'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'lead_customer_links ownership or RLS mismatch';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_customer_links'
  ) <> 1
  or not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_customer_links'
      and policyname = 'lead_customer_links_select_by_membership'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and position('memberships' in lower(qual)) > 0
      and position('auth.uid()' in lower(qual)) > 0
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'lead_customer_links RLS policy mismatch';
  end if;

  if has_table_privilege('authenticated', 'public.lead_customer_links', 'INSERT')
     or has_table_privilege('authenticated', 'public.lead_customer_links', 'UPDATE')
     or has_table_privilege('authenticated', 'public.lead_customer_links', 'DELETE')
     or not has_table_privilege('authenticated', 'public.lead_customer_links', 'SELECT')
     or has_table_privilege('service_role', 'public.lead_customer_links', 'INSERT')
     or has_table_privilege('service_role', 'public.lead_customer_links', 'UPDATE')
     or has_table_privilege('service_role', 'public.lead_customer_links', 'DELETE')
     or not has_table_privilege('service_role', 'public.lead_customer_links', 'SELECT') then
    raise exception using
      errcode = 'P0001',
      message = 'lead_customer_links grants mismatch';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'lead_customer_links'
      and indexname = 'lead_customer_links_one_active_per_lead_uidx'
      and indexdef ilike '%unique%'
      and indexdef ilike '%where%status%active%'
  )
  or not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'lead_customer_links'
      and indexname = 'lead_customer_links_idempotency_uidx'
      and indexdef ilike '%unique%'
  )
  or not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'lead_customer_links'
      and indexname = 'lead_customer_links_replaces_once_uidx'
      and indexdef ilike '%unique%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'lead_customer_links critical indexes mismatch';
  end if;

  if (
    select count(*)
    from pg_trigger t
    where t.tgrelid = 'public.lead_customer_links'::regclass
      and not t.tgisinternal
      and t.tgname = 'lead_customer_links_enforce_write_rules'
      and t.tgenabled = 'O'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'lead_customer_links trigger mismatch';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
    where n.nspname = 'public'
      and p.proname = 'link_lead_to_customer'
      and p.prosecdef
      and r.rolname = 'postgres'
      and r.rolbypassrls
      and p.proconfig @> array['search_path=pg_catalog, pg_temp', 'row_security=off']::text[]
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
  )
  or not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
    where n.nspname = 'public'
      and p.proname = 'close_lead_customer_link'
      and p.prosecdef
      and r.rolname = 'postgres'
      and r.rolbypassrls
      and p.proconfig @> array['search_path=pg_catalog, pg_temp', 'row_security=off']::text[]
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
  )
  or not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
    where n.nspname = 'public'
      and p.proname = 'replace_lead_customer_link'
      and p.prosecdef
      and r.rolname = 'postgres'
      and r.rolbypassrls
      and p.proconfig @> array['search_path=pg_catalog, pg_temp', 'row_security=off']::text[]
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'controlled function hardening mismatch';
  end if;

  if has_function_privilege('service_role', 'public.lead_customer_link_request_role()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.lead_customer_link_request_role()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.enforce_lead_customer_link_write_rules()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enforce_lead_customer_link_write_rules()', 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'internal helper execution grants mismatch';
  end if;

  select count(*) into v_count from public.lead_customer_links;

  if v_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'structural migration must not insert lead_customer_links rows';
  end if;

  if (select count(*) from public.leads) <>
       (select row_count from _p9_lcl_preflight_counts where object_name = 'public.leads')
  or (select count(*) from public.customers) <>
       (select row_count from _p9_lcl_preflight_counts where object_name = 'public.customers')
  or (select count(*) from public.customer_store_links) <>
       (select row_count from _p9_lcl_preflight_counts where object_name = 'public.customer_store_links')
  or (select count(*) from public.customer_channel_identities) <>
       (select row_count from _p9_lcl_preflight_counts where object_name = 'public.customer_channel_identities') then
    raise exception using
      errcode = 'P0001',
      message = 'structural migration changed business rows unexpectedly';
  end if;
end;
$postconditions$;

commit;

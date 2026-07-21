-- ZION / Pilar 9 / Fase 4 / 4.1A-4
-- Fundacao canonica e auditavel do contexto comercial principal de uma sessao.
--
-- ESCOPO:
-- - cria public.commercial_session_context_links;
-- - cria integridade composta, historico, idempotencia, RLS e funcoes de escrita;
-- - nao cria oportunidades nem sessoes reais;
-- - nao faz backfill;
-- - nao concede escrita direta a authenticated nem service_role;
-- - toda escrita operacional ocorre por funcoes SECURITY DEFINER.
--
-- IMPORTANTE:
-- - aplicar uma unica vez;
-- - nao editar migrations ja aplicadas;
-- - qualquer divergencia de precondicao ou poscondicao aborta a transacao.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:commercial_session_context_links:foundation',
    0
  )
);


-- --------------------------------------------------------------------------
-- Preconditions e integridade estrutural dos pais.
-- --------------------------------------------------------------------------

do $preflight$
declare
  v_index record;
begin
  if pg_catalog.to_regclass('public.conversation_sessions') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.lead_customer_links') is null
     or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.customer_store_links') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regclass('public.organizations') is null
     or pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('auth.users') is null then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links foundation prerequisites are missing';
  end if;

  if pg_catalog.to_regclass('public.commercial_session_context_links') is not null then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links already exists; migration must not be reapplied';
  end if;

  if pg_catalog.to_regprocedure(
       'public.link_lead_to_customer(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text,text,uuid,jsonb,timestamp with time zone)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.close_lead_customer_link(uuid,uuid,uuid,text,uuid,text,text,jsonb,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.replace_lead_customer_link(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text,text,uuid,jsonb,text,text,jsonb,timestamp with time zone)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.enforce_lead_customer_link_write_rules()'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links depends on the approved lead_customer_links foundation';
  end if;

  if pg_catalog.to_regprocedure(
       'public.enforce_commercial_session_context_link_write_rules()'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.link_commercial_session_context(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,timestamp with time zone)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.close_commercial_session_context_link(uuid,uuid,uuid,text,uuid,text,text,jsonb,uuid)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.replace_commercial_session_context_link(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,text,text,jsonb,timestamp with time zone)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'one or more commercial_session_context_links functions already exist';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'public'
      and procedure_row.proname in (
        'enforce_commercial_session_context_link_write_rules',
        'link_commercial_session_context',
        'close_commercial_session_context_link',
        'replace_commercial_session_context_link'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'unexpected commercial_session_context_links function overload already exists';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = relation_row.relnamespace
    where namespace_row.nspname = 'public'
      and relation_row.relname in (
        'commercial_session_context_links_pkey',
        'commercial_session_context_links_id_org_store_session_uidx',
        'commercial_session_context_links_one_active_per_session_uidx',
        'commercial_session_context_links_idempotency_uidx',
        'commercial_session_context_links_replaces_once_uidx',
        'commercial_session_context_links_session_history_idx',
        'commercial_session_context_links_opportunity_idx',
        'commercial_session_context_links_customer_idx',
        'commercial_session_context_links_lead_customer_link_idx',
        'commercial_session_context_links_correlation_idx'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'one or more commercial_session_context_links relations already exist unexpectedly';
  end if;

  for v_index in
    select *
    from (
      values
        (
          'conversation_sessions_id_org_store_uidx'::text,
          'conversation_sessions'::text,
          array['id', 'organization_id', 'store_id']::text[]
        ),
        (
          'commercial_opportunities_id_org_store_customer_uidx'::text,
          'commercial_opportunities'::text,
          array['id', 'organization_id', 'store_id', 'customer_id']::text[]
        ),
        (
          'lead_customer_links_id_org_store_customer_uidx'::text,
          'lead_customer_links'::text,
          array['id', 'organization_id', 'store_id', 'customer_id']::text[]
        )
    ) as expected_index(index_name, table_name, expected_columns)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_relation
        on index_relation.oid = index_row.indexrelid
      join pg_catalog.pg_namespace index_namespace
        on index_namespace.oid = index_relation.relnamespace
      join pg_catalog.pg_class table_relation
        on table_relation.oid = index_row.indrelid
      join pg_catalog.pg_namespace table_namespace
        on table_namespace.oid = table_relation.relnamespace
      where index_namespace.nspname = 'public'
        and index_relation.relname = v_index.index_name
        and index_relation.relkind = 'i'
        and table_namespace.nspname = 'public'
        and table_relation.relname = v_index.table_name
        and index_row.indisunique
        and index_row.indisvalid
        and index_row.indisready
        and index_row.indexprs is null
        and index_row.indpred is null
        and index_row.indnatts = pg_catalog.array_length(v_index.expected_columns, 1)
        and index_row.indnkeyatts = pg_catalog.array_length(v_index.expected_columns, 1)
        and (
          select pg_catalog.array_agg(
                   attribute_row.attname::text
                   order by key_column.ordinality
                 )
          from pg_catalog.unnest(index_row.indkey::smallint[])
               with ordinality as key_column(attnum, ordinality)
          join pg_catalog.pg_attribute attribute_row
            on attribute_row.attrelid = index_row.indrelid
           and attribute_row.attnum = key_column.attnum
        ) = v_index.expected_columns
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'commercial_session_context_links parent composite index contract mismatch';
    end if;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_roles
    where rolname in ('anon', 'authenticated', 'service_role')
  ) <> 3 then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links API roles are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'postgres'
      and rolbypassrls
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postgres owner must have BYPASSRLS';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'service_role'
      and rolbypassrls
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'service_role must have BYPASSRLS for its explicit read contract';
  end if;
end;
$preflight$;

-- --------------------------------------------------------------------------
-- Tabela historica e auditavel.
-- --------------------------------------------------------------------------

create table public.commercial_session_context_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  conversation_session_id uuid not null,
  customer_id uuid not null,
  commercial_opportunity_id uuid not null,
  lead_customer_link_id uuid not null,
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

  constraint commercial_session_context_links_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint commercial_session_context_links_store_org_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint commercial_session_context_links_customer_org_fkey
    foreign key (customer_id, organization_id)
    references public.customers(id, organization_id)
    on delete restrict,

  constraint commercial_session_context_links_session_org_store_fkey
    foreign key (conversation_session_id, organization_id, store_id)
    references public.conversation_sessions(id, organization_id, store_id)
    on delete restrict,

  constraint commercial_session_context_links_opportunity_scope_fkey
    foreign key (
      commercial_opportunity_id,
      organization_id,
      store_id,
      customer_id
    )
    references public.commercial_opportunities(
      id,
      organization_id,
      store_id,
      customer_id
    )
    on delete restrict,

  constraint commercial_session_context_links_lead_customer_org_store_fkey
    foreign key (
      lead_customer_link_id,
      organization_id,
      store_id,
      customer_id
    )
    references public.lead_customer_links(
      id,
      organization_id,
      store_id,
      customer_id
    )
    on delete restrict,

  constraint commercial_session_context_links_linked_by_user_fkey
    foreign key (linked_by_user_id)
    references auth.users(id)
    on delete restrict,

  constraint commercial_session_context_links_unlinked_by_user_fkey
    foreign key (unlinked_by_user_id)
    references auth.users(id)
    on delete restrict,

  constraint commercial_session_context_links_status_check
    check (status in ('active', 'inactive')),

  constraint commercial_session_context_links_source_check
    check (source in ('manual', 'ai', 'system', 'migration')),

  constraint commercial_session_context_links_link_actor_check
    check (
      linked_by_actor_type in ('human', 'ai', 'system', 'migration')
      and (
        (
          linked_by_actor_type = 'human'
          and linked_by_user_id is not null
        )
        or (
          linked_by_actor_type <> 'human'
          and linked_by_user_id is null
        )
      )
    ),

  constraint commercial_session_context_links_unlink_state_check
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
          (
            unlinked_by_actor_type = 'human'
            and unlinked_by_user_id is not null
          )
          or (
            unlinked_by_actor_type <> 'human'
            and unlinked_by_user_id is null
          )
        )
      )
    ),

  constraint commercial_session_context_links_source_reference_not_blank
    check (
      source_reference is null
      or pg_catalog.length(pg_catalog.btrim(source_reference)) > 0
    ),

  constraint commercial_session_context_links_idempotency_not_blank
    check (
      idempotency_key is null
      or pg_catalog.length(pg_catalog.btrim(idempotency_key)) > 0
    ),

  constraint commercial_session_context_links_unlink_reason_not_blank
    check (
      unlink_reason is null
      or pg_catalog.length(pg_catalog.btrim(unlink_reason)) > 0
    ),

  constraint commercial_session_context_links_unlink_reason_code_format
    check (
      unlink_reason_code is null
      or unlink_reason_code ~ '^[a-z0-9_:-]+$'
    ),

  constraint commercial_session_context_links_metadata_object_check
    check (pg_catalog.jsonb_typeof(metadata) = 'object'),

  constraint commercial_session_context_links_metadata_state_check
    check (
      (
        status = 'active'
        and not (metadata ? 'unlink')
      )
      or (
        status = 'inactive'
        and metadata ? 'unlink'
        and pg_catalog.jsonb_typeof(metadata -> 'unlink') = 'object'
      )
    ),

  constraint commercial_session_context_links_temporal_order_check
    check (unlinked_at is null or unlinked_at >= linked_at),

  constraint commercial_session_context_links_not_replace_self
    check (replaces_link_id is null or replaces_link_id <> id)
);

alter table public.commercial_session_context_links owner to postgres;

comment on table public.commercial_session_context_links is
  'Historico canonico e auditavel do contexto comercial principal de uma conversation_session.';

comment on column public.commercial_session_context_links.customer_id is
  'Customer congelado no momento do vinculo contextual, sem sobrescrever historico anterior.';

comment on column public.commercial_session_context_links.lead_customer_link_id is
  'Evidencia historica da identidade/lead-customer-link usada na classificacao da sessao.';

comment on column public.commercial_session_context_links.replaces_link_id is
  'Vinculo historico anterior substituido explicitamente por esta linha.';

create unique index commercial_session_context_links_id_org_store_session_uidx
  on public.commercial_session_context_links (
    id,
    organization_id,
    store_id,
    conversation_session_id
  );

create unique index commercial_session_context_links_one_active_per_session_uidx
  on public.commercial_session_context_links (
    organization_id,
    store_id,
    conversation_session_id
  )
  where status = 'active';

create unique index commercial_session_context_links_idempotency_uidx
  on public.commercial_session_context_links (
    organization_id,
    idempotency_key
  )
  where idempotency_key is not null;

create unique index commercial_session_context_links_replaces_once_uidx
  on public.commercial_session_context_links (replaces_link_id)
  where replaces_link_id is not null;

create index commercial_session_context_links_session_history_idx
  on public.commercial_session_context_links (
    organization_id,
    store_id,
    conversation_session_id,
    linked_at desc
  );

create index commercial_session_context_links_opportunity_idx
  on public.commercial_session_context_links (
    organization_id,
    store_id,
    commercial_opportunity_id,
    linked_at desc
  );

create index commercial_session_context_links_customer_idx
  on public.commercial_session_context_links (
    organization_id,
    store_id,
    customer_id,
    linked_at desc
  );

create index commercial_session_context_links_lead_customer_link_idx
  on public.commercial_session_context_links (
    organization_id,
    lead_customer_link_id,
    linked_at desc
  );

create index commercial_session_context_links_correlation_idx
  on public.commercial_session_context_links (
    correlation_id,
    linked_at desc
  )
  where correlation_id is not null;

alter table public.commercial_session_context_links
  add constraint commercial_session_context_links_replaces_same_session_fkey
    foreign key (
      replaces_link_id,
      organization_id,
      store_id,
      conversation_session_id
    )
    references public.commercial_session_context_links(
      id,
      organization_id,
      store_id,
      conversation_session_id
    )
    on delete restrict;


-- --------------------------------------------------------------------------
-- Trigger de historico e integridade nao declarativa.
-- --------------------------------------------------------------------------

create function public.enforce_commercial_session_context_link_write_rules()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_session public.conversation_sessions;
  v_session_conversation_id uuid;
  v_session_lead_id uuid;
  v_customer public.customers;
  v_opportunity public.commercial_opportunities;
  v_lead_customer_link public.lead_customer_links;
  v_replaced public.commercial_session_context_links;
begin
  if tg_table_schema <> 'public'
     or tg_table_name <> 'commercial_session_context_links' then
    raise exception using
      errcode = 'P0001',
      message = 'invalid trigger binding for commercial_session_context_links';
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'commercial session context link delete is not allowed';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'active' then
      raise exception using
        errcode = '23514',
        message = 'commercial session context link state mismatch';
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
        message = 'commercial session context link actor mismatch';
    end if;

    if new.linked_at > pg_catalog.clock_timestamp() then
      raise exception using
        errcode = '23514',
        message = 'commercial session context link temporal mismatch';
    end if;

    if new.metadata ? 'unlink'
       or new.metadata ? 'correlation_id'
       or (
         new.replaces_link_id is null
         and new.metadata ? 'replacement'
       )
       or (
         new.replaces_link_id is not null
         and (
           pg_catalog.jsonb_typeof(new.metadata -> 'replacement')
             is distinct from 'object'
           or new.metadata #>> '{replacement,replaces_link_id}'
             is distinct from new.replaces_link_id::text
           or nullif(
                pg_catalog.btrim(
                  new.metadata #>> '{replacement,reason_code}'
                ),
                ''
              ) is null
           or (
             new.metadata #>> '{replacement,reason_code}'
           ) !~ '^[a-z0-9_:-]+$'
         )
       ) then
      raise exception using
        errcode = '23514',
        message = 'commercial session context link metadata mismatch';
    end if;

    select session_row.*
    into v_session
    from public.conversation_sessions session_row
    where session_row.id = new.conversation_session_id
      and session_row.organization_id = new.organization_id
      and session_row.store_id = new.store_id
      and session_row.status = 'active';

    if not found then
      raise exception using
        errcode = '23514',
        message = 'commercial session context link relation mismatch';
    end if;

    select conversation_row.id, conversation_row.lead_id
    into v_session_conversation_id, v_session_lead_id
    from public.conversations conversation_row
    where conversation_row.id = v_session.conversation_id
      and conversation_row.organization_id = v_session.organization_id;

    if v_session_conversation_id is null or v_session_lead_id is null then
      raise exception using
        errcode = '23514',
        message = 'commercial session context link relation mismatch';
    end if;

    select customer_row.*
    into v_customer
    from public.customers customer_row
    where customer_row.id = new.customer_id
      and customer_row.organization_id = new.organization_id;

    if not found or v_customer.merged_into_customer_id is not null then
      raise exception using
        errcode = '23514',
        message = 'commercial session context link relation mismatch';
    end if;

    select opportunity_row.*
    into v_opportunity
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = new.commercial_opportunity_id
      and opportunity_row.organization_id = new.organization_id
      and opportunity_row.store_id = new.store_id
      and opportunity_row.customer_id = new.customer_id;

    if not found then
      raise exception using
        errcode = '23514',
        message = 'commercial session context link relation mismatch';
    end if;

    select lead_link.*
    into v_lead_customer_link
    from public.lead_customer_links lead_link
    where lead_link.id = new.lead_customer_link_id
      and lead_link.organization_id = new.organization_id
      and lead_link.store_id = new.store_id
      and lead_link.customer_id = new.customer_id
      and lead_link.status = 'active';

    if not found
       or v_lead_customer_link.lead_id <> v_session_lead_id then
      raise exception using
        errcode = '23514',
        message = 'commercial session context link relation mismatch';
    end if;

    if new.replaces_link_id is not null then
      select old_link.*
      into v_replaced
      from public.commercial_session_context_links old_link
      where old_link.id = new.replaces_link_id
        and old_link.organization_id = new.organization_id
        and old_link.store_id = new.store_id
        and old_link.conversation_session_id = new.conversation_session_id;

      if not found
         or v_replaced.status <> 'inactive'
         or v_replaced.unlinked_at is null
         or new.linked_at < v_replaced.unlinked_at
         or new.metadata #>> '{replacement,reason_code}'
              is distinct from v_replaced.unlink_reason_code
         or v_replaced.metadata #>> '{unlink,correlation_id}'
              is distinct from new.correlation_id::text then
        raise exception using
          errcode = '23514',
          message = 'commercial session context link replacement mismatch';
      end if;
    end if;

    new.updated_at := coalesce(
      new.updated_at,
      new.created_at,
      pg_catalog.clock_timestamp()
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.store_id is distinct from old.store_id
       or new.conversation_session_id is distinct from old.conversation_session_id
       or new.customer_id is distinct from old.customer_id
       or new.commercial_opportunity_id is distinct from old.commercial_opportunity_id
       or new.lead_customer_link_id is distinct from old.lead_customer_link_id
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
        message = 'commercial session context link core fields are immutable';
    end if;

    if old.status = 'inactive' then
      raise exception using
        errcode = 'P0001',
        message = 'inactive commercial session context link is immutable';
    end if;

    if old.status <> 'active' or new.status <> 'inactive' then
      raise exception using
        errcode = 'P0001',
        message = 'commercial session context link can only transition from active to inactive';
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
        message = 'commercial session context link actor mismatch';
    end if;

    if new.unlinked_at < old.linked_at then
      raise exception using
        errcode = '23514',
        message = 'commercial session context link temporal mismatch';
    end if;

    if old.metadata ? 'unlink'
       or not (new.metadata ? 'unlink')
       or pg_catalog.jsonb_typeof(new.metadata -> 'unlink')
            is distinct from 'object'
       or not ((new.metadata -> 'unlink') ? 'correlation_id')
       or (new.metadata - 'unlink') is distinct from old.metadata then
      raise exception using
        errcode = '23514',
        message = 'commercial session context link metadata mismatch';
    end if;

    new.updated_at := pg_catalog.clock_timestamp();
    return new;
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'unsupported operation for commercial_session_context_links';
end;
$function$;

alter function public.enforce_commercial_session_context_link_write_rules()
  owner to postgres;

comment on function public.enforce_commercial_session_context_link_write_rules() is
  'Protege historico imutavel, autoria estrita e transicao active -> inactive de commercial_session_context_links.';

revoke all on function public.enforce_commercial_session_context_link_write_rules()
  from public, anon, authenticated, service_role;

create trigger commercial_session_context_links_enforce_write_rules
  before insert or update or delete on public.commercial_session_context_links
  for each row
  execute function public.enforce_commercial_session_context_link_write_rules();

-- --------------------------------------------------------------------------
-- Funcao controlada: vincular contexto comercial principal.
-- --------------------------------------------------------------------------

create function public.link_commercial_session_context(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_session_id uuid,
  p_customer_id uuid,
  p_commercial_opportunity_id uuid,
  p_lead_customer_link_id uuid,
  p_source text,
  p_linked_by_actor_type text,
  p_linked_by_user_id uuid default null,
  p_source_reference text default null,
  p_idempotency_key text default null,
  p_correlation_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_linked_at timestamptz default null
)
returns public.commercial_session_context_links
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_set_role text;
  v_claim_role_setting text;
  v_claim_role_json text;
  v_claim_role text;
  v_claim_sub_setting text;
  v_claim_sub_json text;
  v_claims_text text;
  v_claims jsonb;
  v_request_role text;
  v_request_sub uuid;
  v_session public.conversation_sessions;
  v_customer public.customers;
  v_opportunity public.commercial_opportunities;
  v_lead_customer_link public.lead_customer_links;
  v_existing public.commercial_session_context_links;
  v_existing_active public.commercial_session_context_links;
  v_source_reference text;
  v_idempotency_key text;
  v_metadata jsonb;
  v_effective_linked_at timestamptz;
  v_session_lead_id uuid;
  v_result public.commercial_session_context_links;
begin
  v_set_role := nullif(pg_catalog.current_setting('role', true), '');
  if v_set_role = 'none' then
    v_set_role := null;
  end if;

  v_claim_role_setting := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  v_claim_sub_setting := nullif(
    pg_catalog.current_setting('request.jwt.claim.sub', true),
    ''
  );
  v_claims_text := nullif(
    pg_catalog.current_setting('request.jwt.claims', true),
    ''
  );

  if v_claims_text is not null then
    begin
      v_claims := v_claims_text::jsonb;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '42501',
          message = 'commercial session context link operation is not authorized';
    end;

    if pg_catalog.jsonb_typeof(v_claims) <> 'object' then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;

    v_claim_role_json := nullif(v_claims ->> 'role', '');
    v_claim_sub_json := nullif(v_claims ->> 'sub', '');
  end if;

  if v_claim_role_setting is not null
     and v_claim_role_json is not null
     and v_claim_role_setting <> v_claim_role_json then
    raise exception using
      errcode = '42501',
      message = 'commercial session context link operation is not authorized';
  end if;

  if v_claim_sub_setting is not null
     and v_claim_sub_json is not null
     and v_claim_sub_setting <> v_claim_sub_json then
    raise exception using
      errcode = '42501',
      message = 'commercial session context link operation is not authorized';
  end if;

  v_claim_role := coalesce(v_claim_role_setting, v_claim_role_json);

  if v_set_role in ('authenticated', 'service_role', 'anon') then
    if v_claim_role is not null and v_claim_role <> v_set_role then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;
    v_request_role := v_set_role;
  elsif session_user = 'postgres'
        and (v_set_role is null or v_set_role = 'postgres') then
    if v_claim_role is not null then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;
    v_request_role := 'postgres';
  else
    raise exception using
      errcode = '42501',
      message = 'commercial session context link operation is not authorized';
  end if;

  begin
    v_request_sub := coalesce(
      v_claim_sub_setting,
      v_claim_sub_json
    )::uuid;
  exception
    when invalid_text_representation then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
  end;

  if v_request_role = 'anon' then
    raise exception using
      errcode = '42501',
      message = 'commercial session context link operation is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_conversation_session_id is null
     or p_customer_id is null
     or p_commercial_opportunity_id is null
     or p_lead_customer_link_id is null
     or p_source is null
     or p_linked_by_actor_type is null then
    raise exception using
      errcode = '22004',
      message = 'commercial session context link input is incomplete';
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
      message = 'commercial session context link actor is invalid';
  end if;

  if v_request_role = 'authenticated' then
    if p_linked_by_actor_type <> 'human'
       or v_request_sub is null
       or p_linked_by_user_id is distinct from v_request_sub
       or not exists (
         select 1
         from public.memberships membership_row
         where membership_row.organization_id = p_organization_id
           and membership_row.user_id = v_request_sub
       ) then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;
  elsif v_request_role = 'service_role' then
    if p_linked_by_actor_type not in ('ai', 'system', 'migration')
       or p_linked_by_user_id is not null then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;
  end if;

  v_source_reference := nullif(pg_catalog.btrim(p_source_reference), '');
  v_idempotency_key := nullif(pg_catalog.btrim(p_idempotency_key), '');
  v_metadata := coalesce(p_metadata, '{}'::jsonb);
  v_effective_linked_at := coalesce(
    p_linked_at,
    pg_catalog.clock_timestamp()
  );

  if pg_catalog.jsonb_typeof(v_metadata) <> 'object'
     or v_metadata ? 'unlink'
     or v_metadata ? 'replacement'
     or v_metadata ? 'correlation_id'
     or p_source not in ('manual', 'ai', 'system', 'migration')
     or (
       p_linked_at is not null
       and p_linked_by_actor_type <> 'migration'
     )
     or v_effective_linked_at > pg_catalog.clock_timestamp() then
    raise exception using
      errcode = '22023',
      message = 'commercial session context link input is invalid';
  end if;

  if v_idempotency_key is not null then
    select link_row.*
    into v_existing
    from public.commercial_session_context_links link_row
    where link_row.organization_id = p_organization_id
      and link_row.idempotency_key = v_idempotency_key
    for update;

    if found then
      if v_existing.store_id = p_store_id
         and v_existing.conversation_session_id = p_conversation_session_id
         and v_existing.customer_id = p_customer_id
         and v_existing.commercial_opportunity_id = p_commercial_opportunity_id
         and v_existing.lead_customer_link_id = p_lead_customer_link_id
         and v_existing.source = p_source
         and v_existing.source_reference is not distinct from v_source_reference
         and v_existing.linked_by_actor_type = p_linked_by_actor_type
         and v_existing.linked_by_user_id is not distinct from p_linked_by_user_id
         and v_existing.correlation_id is not distinct from p_correlation_id
         and (v_existing.metadata - 'unlink') = v_metadata
         and (
           p_linked_at is null
           or v_existing.linked_at = p_linked_at
         ) then
        return v_existing;
      end if;

      raise exception using
        errcode = '23505',
        message = 'commercial session context link idempotency conflict';
    end if;
  end if;

  select session_row.*
  into v_session
  from public.conversation_sessions session_row
  where session_row.id = p_conversation_session_id
    and session_row.organization_id = p_organization_id
    and session_row.store_id = p_store_id
  for update;

  -- Revalida a chave depois do lock da sessao para convergir retries
  -- concorrentes que ainda nao eram visiveis na primeira leitura.
  if v_idempotency_key is not null then
    select link_row.*
    into v_existing
    from public.commercial_session_context_links link_row
    where link_row.organization_id = p_organization_id
      and link_row.idempotency_key = v_idempotency_key
    for update;

    if found then
      if v_existing.store_id = p_store_id
         and v_existing.conversation_session_id = p_conversation_session_id
         and v_existing.customer_id = p_customer_id
         and v_existing.commercial_opportunity_id = p_commercial_opportunity_id
         and v_existing.lead_customer_link_id = p_lead_customer_link_id
         and v_existing.source = p_source
         and v_existing.source_reference is not distinct from v_source_reference
         and v_existing.linked_by_actor_type = p_linked_by_actor_type
         and v_existing.linked_by_user_id is not distinct from p_linked_by_user_id
         and v_existing.correlation_id is not distinct from p_correlation_id
         and (v_existing.metadata - 'unlink') = v_metadata
         and (
           p_linked_at is null
           or v_existing.linked_at = p_linked_at
         ) then
        return v_existing;
      end if;

      raise exception using
        errcode = '23505',
        message = 'commercial session context link idempotency conflict';
    end if;
  end if;

  if v_session.id is null or v_session.status <> 'active' then
    raise exception using
      errcode = '23514',
      message = 'commercial session context link relation mismatch';
  end if;

  select customer_row.*
  into v_customer
  from public.customers customer_row
  where customer_row.id = p_customer_id
    and customer_row.organization_id = p_organization_id
  for update;

  if not found or v_customer.merged_into_customer_id is not null then
    raise exception using
      errcode = '23514',
      message = 'commercial session context link relation mismatch';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
    and opportunity_row.customer_id = p_customer_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'commercial session context link relation mismatch';
  end if;

  select conversation_row.lead_id
  into v_session_lead_id
  from public.conversations conversation_row
  where conversation_row.id = v_session.conversation_id
    and conversation_row.organization_id = v_session.organization_id;

  if v_session_lead_id is null then
    raise exception using
      errcode = '23514',
      message = 'commercial session context link relation mismatch';
  end if;

  select lead_link.*
  into v_lead_customer_link
  from public.lead_customer_links lead_link
  where lead_link.id = p_lead_customer_link_id
    and lead_link.organization_id = p_organization_id
    and lead_link.store_id = p_store_id
    and lead_link.customer_id = p_customer_id
  for update;

  if not found
     or v_lead_customer_link.status <> 'active'
     or v_lead_customer_link.lead_id is distinct from v_session_lead_id then
    raise exception using
      errcode = '23514',
      message = 'commercial session context link relation mismatch';
  end if;

  select active_row.*
  into v_existing_active
  from public.commercial_session_context_links active_row
  where active_row.organization_id = p_organization_id
    and active_row.store_id = p_store_id
    and active_row.conversation_session_id = p_conversation_session_id
    and active_row.status = 'active'
  for update;

  if found then
    raise exception using
      errcode = '23505',
      message = 'commercial session already has an active context link';
  end if;

  begin
    insert into public.commercial_session_context_links (
      organization_id,
      store_id,
      conversation_session_id,
      customer_id,
      commercial_opportunity_id,
      lead_customer_link_id,
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
      p_conversation_session_id,
      p_customer_id,
      p_commercial_opportunity_id,
      p_lead_customer_link_id,
      'active',
      p_source,
      v_source_reference,
      v_idempotency_key,
      p_correlation_id,
      v_effective_linked_at,
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
        from public.commercial_session_context_links link_row
        where link_row.organization_id = p_organization_id
          and link_row.idempotency_key = v_idempotency_key;

        if found then
          if v_existing.store_id = p_store_id
             and v_existing.conversation_session_id = p_conversation_session_id
             and v_existing.customer_id = p_customer_id
             and v_existing.commercial_opportunity_id = p_commercial_opportunity_id
             and v_existing.lead_customer_link_id = p_lead_customer_link_id
             and v_existing.source = p_source
             and v_existing.source_reference is not distinct from v_source_reference
             and v_existing.linked_by_actor_type = p_linked_by_actor_type
             and v_existing.linked_by_user_id is not distinct from p_linked_by_user_id
             and v_existing.correlation_id is not distinct from p_correlation_id
             and (v_existing.metadata - 'unlink') = v_metadata
             and (
               p_linked_at is null
               or v_existing.linked_at = p_linked_at
             ) then
            return v_existing;
          end if;

          raise exception using
            errcode = '23505',
            message = 'commercial session context link idempotency conflict';
        end if;
      end if;

      raise exception using
        errcode = '23505',
        message = 'commercial session already has an active context link';
  end;

  return v_result;
end;
$function$;

alter function public.link_commercial_session_context(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, uuid, jsonb, timestamptz
) owner to postgres;

comment on function public.link_commercial_session_context(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, uuid, jsonb, timestamptz
) is
  'Cria o contexto comercial principal active de uma conversation_session de forma auditavel e idempotente.';

revoke all on function public.link_commercial_session_context(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, uuid, jsonb, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.link_commercial_session_context(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, uuid, jsonb, timestamptz
) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- Funcao controlada: encerrar contexto comercial.
-- --------------------------------------------------------------------------

create function public.close_commercial_session_context_link(
  p_link_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_unlinked_by_actor_type text,
  p_unlinked_by_user_id uuid default null,
  p_unlink_reason_code text default null,
  p_unlink_reason text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_correlation_id uuid default null
)
returns public.commercial_session_context_links
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_set_role text;
  v_claim_role_setting text;
  v_claim_role_json text;
  v_claim_role text;
  v_claim_sub_setting text;
  v_claim_sub_json text;
  v_claims_text text;
  v_claims jsonb;
  v_request_role text;
  v_request_sub uuid;
  v_session public.conversation_sessions;
  v_link public.commercial_session_context_links;
  v_metadata jsonb;
  v_unlink_reason_code text;
  v_unlink_reason text;
  v_unlink_payload jsonb;
  v_result public.commercial_session_context_links;
begin
  v_set_role := nullif(pg_catalog.current_setting('role', true), '');
  if v_set_role = 'none' then
    v_set_role := null;
  end if;

  v_claim_role_setting := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  v_claim_sub_setting := nullif(
    pg_catalog.current_setting('request.jwt.claim.sub', true),
    ''
  );
  v_claims_text := nullif(
    pg_catalog.current_setting('request.jwt.claims', true),
    ''
  );

  if v_claims_text is not null then
    begin
      v_claims := v_claims_text::jsonb;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '42501',
          message = 'commercial session context link operation is not authorized';
    end;

    if pg_catalog.jsonb_typeof(v_claims) <> 'object' then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;

    v_claim_role_json := nullif(v_claims ->> 'role', '');
    v_claim_sub_json := nullif(v_claims ->> 'sub', '');
  end if;

  if v_claim_role_setting is not null
     and v_claim_role_json is not null
     and v_claim_role_setting <> v_claim_role_json then
    raise exception using
      errcode = '42501',
      message = 'commercial session context link operation is not authorized';
  end if;

  if v_claim_sub_setting is not null
     and v_claim_sub_json is not null
     and v_claim_sub_setting <> v_claim_sub_json then
    raise exception using
      errcode = '42501',
      message = 'commercial session context link operation is not authorized';
  end if;

  v_claim_role := coalesce(v_claim_role_setting, v_claim_role_json);

  if v_set_role in ('authenticated', 'service_role', 'anon') then
    if v_claim_role is not null and v_claim_role <> v_set_role then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;
    v_request_role := v_set_role;
  elsif session_user = 'postgres'
        and (v_set_role is null or v_set_role = 'postgres') then
    if v_claim_role is not null then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;
    v_request_role := 'postgres';
  else
    raise exception using
      errcode = '42501',
      message = 'commercial session context link operation is not authorized';
  end if;

  begin
    v_request_sub := coalesce(
      v_claim_sub_setting,
      v_claim_sub_json
    )::uuid;
  exception
    when invalid_text_representation then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
  end;

  if v_request_role = 'anon' then
    raise exception using
      errcode = '42501',
      message = 'commercial session context link operation is not authorized';
  end if;

  if p_link_id is null
     or p_organization_id is null
     or p_store_id is null
     or p_unlinked_by_actor_type is null then
    raise exception using
      errcode = '22004',
      message = 'commercial session context link close input is incomplete';
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
      message = 'commercial session context link actor is invalid';
  end if;

  if v_request_role = 'authenticated' then
    if p_unlinked_by_actor_type <> 'human'
       or v_request_sub is null
       or p_unlinked_by_user_id is distinct from v_request_sub
       or not exists (
         select 1
         from public.memberships membership_row
         where membership_row.organization_id = p_organization_id
           and membership_row.user_id = v_request_sub
       ) then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;
  elsif v_request_role = 'service_role' then
    if p_unlinked_by_actor_type not in ('ai', 'system', 'migration')
       or p_unlinked_by_user_id is not null then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;
  end if;

  v_unlink_reason_code := nullif(pg_catalog.btrim(p_unlink_reason_code), '');
  v_unlink_reason := nullif(pg_catalog.btrim(p_unlink_reason), '');
  v_metadata := coalesce(p_metadata, '{}'::jsonb);

  if v_unlink_reason_code is null
     or v_unlink_reason_code !~ '^[a-z0-9_:-]+$'
     or pg_catalog.jsonb_typeof(v_metadata) <> 'object'
     or v_metadata ? 'correlation_id'
     or v_metadata ? 'reason_code'
     or v_metadata ? 'reason'
     or v_metadata ? 'actor_type'
     or v_metadata ? 'actor_user_id'
     or v_metadata ? 'unlinked_at' then
    raise exception using
      errcode = '22023',
      message = 'commercial session context link close input is invalid';
  end if;

  v_unlink_payload := v_metadata || pg_catalog.jsonb_build_object(
    'correlation_id',
    p_correlation_id
  );

  select session_row.*
  into v_session
  from public.conversation_sessions session_row
  join public.commercial_session_context_links link_row
    on link_row.conversation_session_id = session_row.id
   and link_row.organization_id = session_row.organization_id
   and link_row.store_id = session_row.store_id
  where link_row.id = p_link_id
    and link_row.organization_id = p_organization_id
    and link_row.store_id = p_store_id
  for update of session_row;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'commercial session context link relation mismatch';
  end if;

  select link_row.*
  into v_link
  from public.commercial_session_context_links link_row
  where link_row.id = p_link_id
    and link_row.organization_id = p_organization_id
    and link_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'commercial session context link relation mismatch';
  end if;

  if v_link.status = 'inactive' then
    if v_link.unlinked_by_actor_type = p_unlinked_by_actor_type
       and v_link.unlinked_by_user_id is not distinct from p_unlinked_by_user_id
       and v_link.unlink_reason_code = v_unlink_reason_code
       and v_link.unlink_reason is not distinct from v_unlink_reason
       and v_link.metadata -> 'unlink' = v_unlink_payload then
      return v_link;
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'inactive commercial session context link is immutable';
  end if;

  update public.commercial_session_context_links
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
      v_unlink_payload,
      true
    )
  where id = v_link.id
  returning * into v_result;

  return v_result;
end;
$function$;

alter function public.close_commercial_session_context_link(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, uuid
) owner to postgres;

comment on function public.close_commercial_session_context_link(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, uuid
) is
  'Encerra o contexto comercial active sem exclusao fisica, preservando ator, motivo e metadata de encerramento.';

revoke all on function public.close_commercial_session_context_link(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.close_commercial_session_context_link(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, uuid
) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- Funcao controlada: substituir contexto comercial de forma atomica.
-- --------------------------------------------------------------------------

create function public.replace_commercial_session_context_link(
  p_old_link_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_new_customer_id uuid,
  p_new_commercial_opportunity_id uuid,
  p_new_lead_customer_link_id uuid,
  p_source text,
  p_actor_type text,
  p_actor_user_id uuid default null,
  p_source_reference text default null,
  p_idempotency_key text default null,
  p_correlation_id uuid default null,
  p_link_metadata jsonb default '{}'::jsonb,
  p_unlink_reason_code text default null,
  p_unlink_reason text default null,
  p_unlink_metadata jsonb default '{}'::jsonb,
  p_linked_at timestamptz default null
)
returns public.commercial_session_context_links
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_set_role text;
  v_claim_role_setting text;
  v_claim_role_json text;
  v_claim_role text;
  v_claim_sub_setting text;
  v_claim_sub_json text;
  v_claims_text text;
  v_claims jsonb;
  v_request_role text;
  v_request_sub uuid;
  v_session public.conversation_sessions;
  v_old public.commercial_session_context_links;
  v_customer public.customers;
  v_opportunity public.commercial_opportunities;
  v_lead_customer_link public.lead_customer_links;
  v_existing public.commercial_session_context_links;
  v_existing_replacement public.commercial_session_context_links;
  v_source_reference text;
  v_idempotency_key text;
  v_unlink_reason_code text;
  v_unlink_reason text;
  v_link_metadata jsonb;
  v_unlink_metadata jsonb;
  v_expected_link_metadata jsonb;
  v_expected_unlink_payload jsonb;
  v_effective_linked_at timestamptz;
  v_session_lead_id uuid;
  v_result public.commercial_session_context_links;
begin
  v_set_role := nullif(pg_catalog.current_setting('role', true), '');
  if v_set_role = 'none' then
    v_set_role := null;
  end if;

  v_claim_role_setting := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  v_claim_sub_setting := nullif(
    pg_catalog.current_setting('request.jwt.claim.sub', true),
    ''
  );
  v_claims_text := nullif(
    pg_catalog.current_setting('request.jwt.claims', true),
    ''
  );

  if v_claims_text is not null then
    begin
      v_claims := v_claims_text::jsonb;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '42501',
          message = 'commercial session context link operation is not authorized';
    end;

    if pg_catalog.jsonb_typeof(v_claims) <> 'object' then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;

    v_claim_role_json := nullif(v_claims ->> 'role', '');
    v_claim_sub_json := nullif(v_claims ->> 'sub', '');
  end if;

  if v_claim_role_setting is not null
     and v_claim_role_json is not null
     and v_claim_role_setting <> v_claim_role_json then
    raise exception using
      errcode = '42501',
      message = 'commercial session context link operation is not authorized';
  end if;

  if v_claim_sub_setting is not null
     and v_claim_sub_json is not null
     and v_claim_sub_setting <> v_claim_sub_json then
    raise exception using
      errcode = '42501',
      message = 'commercial session context link operation is not authorized';
  end if;

  v_claim_role := coalesce(v_claim_role_setting, v_claim_role_json);

  if v_set_role in ('authenticated', 'service_role', 'anon') then
    if v_claim_role is not null and v_claim_role <> v_set_role then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;
    v_request_role := v_set_role;
  elsif session_user = 'postgres'
        and (v_set_role is null or v_set_role = 'postgres') then
    if v_claim_role is not null then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;
    v_request_role := 'postgres';
  else
    raise exception using
      errcode = '42501',
      message = 'commercial session context link operation is not authorized';
  end if;

  begin
    v_request_sub := coalesce(
      v_claim_sub_setting,
      v_claim_sub_json
    )::uuid;
  exception
    when invalid_text_representation then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
  end;

  if v_request_role = 'anon' then
    raise exception using
      errcode = '42501',
      message = 'commercial session context link operation is not authorized';
  end if;

  if p_old_link_id is null
     or p_organization_id is null
     or p_store_id is null
     or p_new_customer_id is null
     or p_new_commercial_opportunity_id is null
     or p_new_lead_customer_link_id is null
     or p_source is null
     or p_actor_type is null then
    raise exception using
      errcode = '22004',
      message = 'commercial session context link replacement input is incomplete';
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
      message = 'commercial session context link actor is invalid';
  end if;

  if v_request_role = 'authenticated' then
    if p_actor_type <> 'human'
       or v_request_sub is null
       or p_actor_user_id is distinct from v_request_sub
       or not exists (
         select 1
         from public.memberships membership_row
         where membership_row.organization_id = p_organization_id
           and membership_row.user_id = v_request_sub
       ) then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;
  elsif v_request_role = 'service_role' then
    if p_actor_type not in ('ai', 'system', 'migration')
       or p_actor_user_id is not null then
      raise exception using
        errcode = '42501',
        message = 'commercial session context link operation is not authorized';
    end if;
  end if;

  v_source_reference := nullif(pg_catalog.btrim(p_source_reference), '');
  v_idempotency_key := nullif(pg_catalog.btrim(p_idempotency_key), '');
  v_unlink_reason_code := nullif(pg_catalog.btrim(p_unlink_reason_code), '');
  v_unlink_reason := nullif(pg_catalog.btrim(p_unlink_reason), '');
  v_link_metadata := coalesce(p_link_metadata, '{}'::jsonb);
  v_unlink_metadata := coalesce(p_unlink_metadata, '{}'::jsonb);

  if pg_catalog.jsonb_typeof(v_link_metadata) <> 'object'
     or pg_catalog.jsonb_typeof(v_unlink_metadata) <> 'object'
     or v_link_metadata ? 'unlink'
     or v_link_metadata ? 'replacement'
     or v_link_metadata ? 'correlation_id'
     or v_unlink_metadata ? 'correlation_id'
     or v_unlink_metadata ? 'reason_code'
     or v_unlink_metadata ? 'reason'
     or v_unlink_metadata ? 'actor_type'
     or v_unlink_metadata ? 'actor_user_id'
     or v_unlink_metadata ? 'unlinked_at'
     or v_unlink_reason_code is null
     or v_unlink_reason_code !~ '^[a-z0-9_:-]+$'
     or p_source not in ('manual', 'ai', 'system', 'migration')
     or (
       p_linked_at is not null
       and p_actor_type <> 'migration'
     )
     or (
       p_linked_at is not null
       and p_linked_at > pg_catalog.clock_timestamp()
     ) then
    raise exception using
      errcode = '22023',
      message = 'commercial session context link replacement input is invalid';
  end if;

  select session_row.*
  into v_session
  from public.conversation_sessions session_row
  join public.commercial_session_context_links link_row
    on link_row.conversation_session_id = session_row.id
   and link_row.organization_id = session_row.organization_id
   and link_row.store_id = session_row.store_id
  where link_row.id = p_old_link_id
    and link_row.organization_id = p_organization_id
    and link_row.store_id = p_store_id
  for update of session_row;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'commercial session context link relation mismatch';
  end if;

  select old_link.*
  into v_old
  from public.commercial_session_context_links old_link
  where old_link.id = p_old_link_id
    and old_link.organization_id = p_organization_id
    and old_link.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'commercial session context link relation mismatch';
  end if;

  v_expected_link_metadata := v_link_metadata || pg_catalog.jsonb_build_object(
    'replacement',
    pg_catalog.jsonb_build_object(
      'replaces_link_id',
      v_old.id,
      'reason_code',
      v_unlink_reason_code
    )
  );
  v_expected_unlink_payload := v_unlink_metadata || pg_catalog.jsonb_build_object(
    'correlation_id',
    p_correlation_id
  );

  select replacement.*
  into v_existing_replacement
  from public.commercial_session_context_links replacement
  where replacement.replaces_link_id = v_old.id
  for update;

  if found then
    if v_existing_replacement.organization_id = p_organization_id
       and v_existing_replacement.store_id = p_store_id
       and v_existing_replacement.conversation_session_id = v_old.conversation_session_id
       and v_existing_replacement.customer_id = p_new_customer_id
       and v_existing_replacement.commercial_opportunity_id = p_new_commercial_opportunity_id
       and v_existing_replacement.lead_customer_link_id = p_new_lead_customer_link_id
       and v_existing_replacement.source = p_source
       and v_existing_replacement.source_reference is not distinct from v_source_reference
       and v_existing_replacement.idempotency_key is not distinct from v_idempotency_key
       and v_existing_replacement.correlation_id is not distinct from p_correlation_id
       and v_existing_replacement.linked_by_actor_type = p_actor_type
       and v_existing_replacement.linked_by_user_id is not distinct from p_actor_user_id
       and (v_existing_replacement.metadata - 'unlink') = v_expected_link_metadata
       and (
         p_linked_at is null
         or v_existing_replacement.linked_at = p_linked_at
       )
       and v_old.status = 'inactive'
       and v_old.unlinked_by_actor_type = p_actor_type
       and v_old.unlinked_by_user_id is not distinct from p_actor_user_id
       and v_old.unlink_reason_code = v_unlink_reason_code
       and v_old.unlink_reason is not distinct from v_unlink_reason
       and v_old.metadata -> 'unlink' = v_expected_unlink_payload then
      return v_existing_replacement;
    end if;

    raise exception using
      errcode = '23505',
      message = 'commercial session context link replacement conflict';
  end if;

  if v_idempotency_key is not null then
    select link_row.*
    into v_existing
    from public.commercial_session_context_links link_row
    where link_row.organization_id = p_organization_id
      and link_row.idempotency_key = v_idempotency_key
    for update;

    if found then
      if v_existing.replaces_link_id = v_old.id
         and v_existing.store_id = p_store_id
         and v_existing.conversation_session_id = v_old.conversation_session_id
         and v_existing.customer_id = p_new_customer_id
         and v_existing.commercial_opportunity_id = p_new_commercial_opportunity_id
         and v_existing.lead_customer_link_id = p_new_lead_customer_link_id
         and v_existing.source = p_source
         and v_existing.source_reference is not distinct from v_source_reference
         and v_existing.correlation_id is not distinct from p_correlation_id
         and v_existing.linked_by_actor_type = p_actor_type
         and v_existing.linked_by_user_id is not distinct from p_actor_user_id
         and (v_existing.metadata - 'unlink') = v_expected_link_metadata
         and (
           p_linked_at is null
           or v_existing.linked_at = p_linked_at
         )
         and v_old.status = 'inactive'
         and v_old.unlinked_by_actor_type = p_actor_type
         and v_old.unlinked_by_user_id is not distinct from p_actor_user_id
         and v_old.unlink_reason_code = v_unlink_reason_code
         and v_old.unlink_reason is not distinct from v_unlink_reason
         and v_old.metadata -> 'unlink' = v_expected_unlink_payload then
        return v_existing;
      end if;

      raise exception using
        errcode = '23505',
        message = 'commercial session context link idempotency conflict';
    end if;
  end if;

  if v_old.status <> 'active' then
    raise exception using
      errcode = 'P0001',
      message = 'only active commercial session context link can be replaced';
  end if;

  if v_session.status <> 'active' then
    raise exception using
      errcode = '23514',
      message = 'commercial session context link relation mismatch';
  end if;

  select customer_row.*
  into v_customer
  from public.customers customer_row
  where customer_row.id = p_new_customer_id
    and customer_row.organization_id = p_organization_id
  for update;

  if not found or v_customer.merged_into_customer_id is not null then
    raise exception using
      errcode = '23514',
      message = 'commercial session context link relation mismatch';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_new_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
    and opportunity_row.customer_id = p_new_customer_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'commercial session context link relation mismatch';
  end if;

  select conversation_row.lead_id
  into v_session_lead_id
  from public.conversations conversation_row
  where conversation_row.id = v_session.conversation_id
    and conversation_row.organization_id = v_session.organization_id;

  if v_session_lead_id is null then
    raise exception using
      errcode = '23514',
      message = 'commercial session context link relation mismatch';
  end if;

  select lead_link.*
  into v_lead_customer_link
  from public.lead_customer_links lead_link
  where lead_link.id = p_new_lead_customer_link_id
    and lead_link.organization_id = p_organization_id
    and lead_link.store_id = p_store_id
    and lead_link.customer_id = p_new_customer_id
  for update;

  if not found
     or v_lead_customer_link.status <> 'active'
     or v_lead_customer_link.lead_id is distinct from v_session_lead_id then
    raise exception using
      errcode = '23514',
      message = 'commercial session context link relation mismatch';
  end if;

  update public.commercial_session_context_links
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
      v_expected_unlink_payload,
      true
    )
  where id = v_old.id
  returning * into v_old;

  -- CORRECAO FINAL: calculado somente apos o encerramento anterior.
  -- Sem timestamp explicito, a nova linha inicia exatamente no unlinked_at.
  v_effective_linked_at := coalesce(
    p_linked_at,
    v_old.unlinked_at
  );

  begin
    insert into public.commercial_session_context_links (
      organization_id,
      store_id,
      conversation_session_id,
      customer_id,
      commercial_opportunity_id,
      lead_customer_link_id,
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
      v_old.conversation_session_id,
      p_new_customer_id,
      p_new_commercial_opportunity_id,
      p_new_lead_customer_link_id,
      v_old.id,
      'active',
      p_source,
      v_source_reference,
      v_idempotency_key,
      p_correlation_id,
      v_effective_linked_at,
      p_actor_type,
      p_actor_user_id,
      v_expected_link_metadata
    )
    returning * into v_result;
  exception
    when unique_violation then
      select replacement.*
      into v_existing_replacement
      from public.commercial_session_context_links replacement
      where replacement.replaces_link_id = v_old.id;

      if found
         and v_existing_replacement.organization_id = p_organization_id
         and v_existing_replacement.store_id = p_store_id
         and v_existing_replacement.conversation_session_id = v_old.conversation_session_id
         and v_existing_replacement.customer_id = p_new_customer_id
         and v_existing_replacement.commercial_opportunity_id = p_new_commercial_opportunity_id
         and v_existing_replacement.lead_customer_link_id = p_new_lead_customer_link_id
         and v_existing_replacement.source = p_source
         and v_existing_replacement.source_reference is not distinct from v_source_reference
         and v_existing_replacement.idempotency_key is not distinct from v_idempotency_key
         and v_existing_replacement.correlation_id is not distinct from p_correlation_id
         and v_existing_replacement.linked_by_actor_type = p_actor_type
         and v_existing_replacement.linked_by_user_id is not distinct from p_actor_user_id
         and (v_existing_replacement.metadata - 'unlink') = v_expected_link_metadata
         and (
           p_linked_at is null
           or v_existing_replacement.linked_at = p_linked_at
         )
         and v_old.status = 'inactive'
         and v_old.unlinked_by_actor_type = p_actor_type
         and v_old.unlinked_by_user_id is not distinct from p_actor_user_id
         and v_old.unlink_reason_code = v_unlink_reason_code
         and v_old.unlink_reason is not distinct from v_unlink_reason
         and v_old.metadata -> 'unlink' = v_expected_unlink_payload then
        return v_existing_replacement;
      end if;

      if v_idempotency_key is not null
         and exists (
           select 1
           from public.commercial_session_context_links link_row
           where link_row.organization_id = p_organization_id
             and link_row.idempotency_key = v_idempotency_key
         ) then
        raise exception using
          errcode = '23505',
          message = 'commercial session context link idempotency conflict';
      end if;

      raise exception using
        errcode = '23505',
        message = 'commercial session context link replacement conflict';
  end;

  if (
    select count(*)
    from public.commercial_session_context_links link_row
    where link_row.organization_id = p_organization_id
      and link_row.store_id = p_store_id
      and link_row.conversation_session_id = v_old.conversation_session_id
      and link_row.status = 'active'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'commercial session context replacement did not converge';
  end if;

  return v_result;
end;
$function$;

alter function public.replace_commercial_session_context_link(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, uuid, jsonb, text, text, jsonb, timestamptz
) owner to postgres;

comment on function public.replace_commercial_session_context_link(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, uuid, jsonb, text, text, jsonb, timestamptz
) is
  'Substitui o contexto comercial active de uma sessao de forma atomica, encerrando o anterior e preservando a cadeia historica.';

revoke all on function public.replace_commercial_session_context_link(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, uuid, jsonb, text, text, jsonb, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.replace_commercial_session_context_link(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, uuid, jsonb, text, text, jsonb, timestamptz
) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- RLS e grants.
-- --------------------------------------------------------------------------

alter table public.commercial_session_context_links enable row level security;

create policy commercial_session_context_links_select_by_membership
on public.commercial_session_context_links
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id =
          commercial_session_context_links.organization_id
      and membership_row.user_id = auth.uid()
  )
);

revoke all on table public.commercial_session_context_links
  from public, anon, authenticated, service_role;

grant select on table public.commercial_session_context_links
  to authenticated, service_role;


-- --------------------------------------------------------------------------
-- Postconditions estruturais completas.
-- --------------------------------------------------------------------------

do $postconditions$
declare
  v_mismatch_count integer;
  v_constraint record;
  v_index record;
  v_function_oid oid;
  v_policy_qual text;
begin
  if pg_catalog.to_regclass('public.commercial_session_context_links') is null then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links table was not created';
  end if;

  with expected_columns(
    ordinal_position,
    column_name,
    data_type,
    is_nullable,
    normalized_default
  ) as (
    values
      (1,  'id',                        'uuid',                     'NO',  'gen_random_uuid()'),
      (2,  'organization_id',           'uuid',                     'NO',  null),
      (3,  'store_id',                  'uuid',                     'NO',  null),
      (4,  'conversation_session_id',   'uuid',                     'NO',  null),
      (5,  'customer_id',               'uuid',                     'NO',  null),
      (6,  'commercial_opportunity_id', 'uuid',                     'NO',  null),
      (7,  'lead_customer_link_id',     'uuid',                     'NO',  null),
      (8,  'replaces_link_id',          'uuid',                     'YES', null),
      (9,  'status',                    'text',                     'NO',  '''active''::text'),
      (10, 'source',                    'text',                     'NO',  null),
      (11, 'source_reference',          'text',                     'YES', null),
      (12, 'idempotency_key',           'text',                     'YES', null),
      (13, 'correlation_id',            'uuid',                     'YES', null),
      (14, 'linked_at',                 'timestamp with time zone', 'NO',  'now()'),
      (15, 'linked_by_actor_type',      'text',                     'NO',  null),
      (16, 'linked_by_user_id',         'uuid',                     'YES', null),
      (17, 'unlinked_at',               'timestamp with time zone', 'YES', null),
      (18, 'unlinked_by_actor_type',    'text',                     'YES', null),
      (19, 'unlinked_by_user_id',       'uuid',                     'YES', null),
      (20, 'unlink_reason_code',        'text',                     'YES', null),
      (21, 'unlink_reason',             'text',                     'YES', null),
      (22, 'metadata',                  'jsonb',                    'NO',  '''{}''::jsonb'),
      (23, 'created_at',                'timestamp with time zone', 'NO',  'now()'),
      (24, 'updated_at',                'timestamp with time zone', 'NO',  'now()')
  ),
  actual_columns as (
    select
      column_row.ordinal_position,
      column_row.column_name,
      column_row.data_type,
      column_row.is_nullable,
      case
        when column_row.column_default is null then null
        else pg_catalog.lower(
          pg_catalog.regexp_replace(
            column_row.column_default,
            '[[:space:]]+',
            '',
            'g'
          )
        )
      end as normalized_default
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'commercial_session_context_links'
  )
  select count(*)
  into v_mismatch_count
  from expected_columns expected
  full join actual_columns actual
    using (ordinal_position)
  where expected.column_name is distinct from actual.column_name
     or expected.data_type is distinct from actual.data_type
     or expected.is_nullable is distinct from actual.is_nullable
     or expected.normalized_default is distinct from actual.normalized_default;

  if v_mismatch_count <> 0
     or (
       select count(*)
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'commercial_session_context_links'
     ) <> 24 then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links column contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_session_context_links'
      and class_row.relkind = 'r'
      and class_row.relrowsecurity
      and not class_row.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(class_row.relowner) = 'postgres'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links ownership or RLS mismatch';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.commercial_session_context_links'::pg_catalog.regclass
  ) <> 22 then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links constraint count mismatch';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.commercial_session_context_links'::pg_catalog.regclass
      and constraint_row.conname in (
        'commercial_session_context_links_pkey',
        'commercial_session_context_links_organization_fkey',
        'commercial_session_context_links_store_org_fkey',
        'commercial_session_context_links_customer_org_fkey',
        'commercial_session_context_links_session_org_store_fkey',
        'commercial_session_context_links_opportunity_scope_fkey',
        'commercial_session_context_links_lead_customer_org_store_fkey',
        'commercial_session_context_links_linked_by_user_fkey',
        'commercial_session_context_links_unlinked_by_user_fkey',
        'commercial_session_context_links_replaces_same_session_fkey',
        'commercial_session_context_links_status_check',
        'commercial_session_context_links_source_check',
        'commercial_session_context_links_link_actor_check',
        'commercial_session_context_links_unlink_state_check',
        'commercial_session_context_links_source_reference_not_blank',
        'commercial_session_context_links_idempotency_not_blank',
        'commercial_session_context_links_unlink_reason_not_blank',
        'commercial_session_context_links_unlink_reason_code_format',
        'commercial_session_context_links_metadata_object_check',
        'commercial_session_context_links_metadata_state_check',
        'commercial_session_context_links_temporal_order_check',
        'commercial_session_context_links_not_replace_self'
      )
  ) <> 22 then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links constraint names mismatch';
  end if;

  for v_constraint in
    select *
    from (
      values
        (
          'commercial_session_context_links_organization_fkey'::text,
          'public.organizations'::text,
          array['organization_id']::text[],
          array['id']::text[]
        ),
        (
          'commercial_session_context_links_store_org_fkey',
          'public.stores',
          array['store_id', 'organization_id']::text[],
          array['id', 'organization_id']::text[]
        ),
        (
          'commercial_session_context_links_customer_org_fkey',
          'public.customers',
          array['customer_id', 'organization_id']::text[],
          array['id', 'organization_id']::text[]
        ),
        (
          'commercial_session_context_links_session_org_store_fkey',
          'public.conversation_sessions',
          array['conversation_session_id', 'organization_id', 'store_id']::text[],
          array['id', 'organization_id', 'store_id']::text[]
        ),
        (
          'commercial_session_context_links_opportunity_scope_fkey',
          'public.commercial_opportunities',
          array['commercial_opportunity_id', 'organization_id', 'store_id', 'customer_id']::text[],
          array['id', 'organization_id', 'store_id', 'customer_id']::text[]
        ),
        (
          'commercial_session_context_links_lead_customer_org_store_fkey',
          'public.lead_customer_links',
          array['lead_customer_link_id', 'organization_id', 'store_id', 'customer_id']::text[],
          array['id', 'organization_id', 'store_id', 'customer_id']::text[]
        ),
        (
          'commercial_session_context_links_linked_by_user_fkey',
          'auth.users',
          array['linked_by_user_id']::text[],
          array['id']::text[]
        ),
        (
          'commercial_session_context_links_unlinked_by_user_fkey',
          'auth.users',
          array['unlinked_by_user_id']::text[],
          array['id']::text[]
        ),
        (
          'commercial_session_context_links_replaces_same_session_fkey',
          'public.commercial_session_context_links',
          array['replaces_link_id', 'organization_id', 'store_id', 'conversation_session_id']::text[],
          array['id', 'organization_id', 'store_id', 'conversation_session_id']::text[]
        )
    ) as expected_fk(
      constraint_name,
      referenced_relation,
      local_columns,
      referenced_columns
    )
  loop
    if not exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid =
            'public.commercial_session_context_links'::pg_catalog.regclass
        and constraint_row.conname = v_constraint.constraint_name
        and constraint_row.contype = 'f'
        and constraint_row.confrelid =
            v_constraint.referenced_relation::pg_catalog.regclass
        and constraint_row.confdeltype = 'r'
        and (
          select pg_catalog.array_agg(
                   attribute_row.attname::text
                   order by key_column.ordinality
                 )
          from pg_catalog.unnest(constraint_row.conkey)
               with ordinality as key_column(attnum, ordinality)
          join pg_catalog.pg_attribute attribute_row
            on attribute_row.attrelid = constraint_row.conrelid
           and attribute_row.attnum = key_column.attnum
        ) = v_constraint.local_columns
        and (
          select pg_catalog.array_agg(
                   attribute_row.attname::text
                   order by key_column.ordinality
                 )
          from pg_catalog.unnest(constraint_row.confkey)
               with ordinality as key_column(attnum, ordinality)
          join pg_catalog.pg_attribute attribute_row
            on attribute_row.attrelid = constraint_row.confrelid
           and attribute_row.attnum = key_column.attnum
        ) = v_constraint.referenced_columns
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'commercial_session_context_links foreign key contract mismatch';
    end if;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.commercial_session_context_links'::pg_catalog.regclass
      and constraint_row.contype = 'c'
      and constraint_row.conname in (
        'commercial_session_context_links_status_check',
        'commercial_session_context_links_source_check',
        'commercial_session_context_links_link_actor_check',
        'commercial_session_context_links_unlink_state_check',
        'commercial_session_context_links_source_reference_not_blank',
        'commercial_session_context_links_idempotency_not_blank',
        'commercial_session_context_links_unlink_reason_not_blank',
        'commercial_session_context_links_unlink_reason_code_format',
        'commercial_session_context_links_metadata_object_check',
        'commercial_session_context_links_metadata_state_check',
        'commercial_session_context_links_temporal_order_check',
        'commercial_session_context_links_not_replace_self'
      )
  ) <> 12
  or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.commercial_session_context_links'::pg_catalog.regclass
      and constraint_row.conname = 'commercial_session_context_links_status_check'
      and pg_catalog.strpos(
            pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
            '''active''::text'
          ) > 0
      and pg_catalog.strpos(
            pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
            '''inactive''::text'
          ) > 0
  )
  or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.commercial_session_context_links'::pg_catalog.regclass
      and constraint_row.conname = 'commercial_session_context_links_source_check'
      and pg_catalog.strpos(
            pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
            '''manual''::text'
          ) > 0
      and pg_catalog.strpos(
            pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
            '''migration''::text'
          ) > 0
  )
  or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.commercial_session_context_links'::pg_catalog.regclass
      and constraint_row.conname = 'commercial_session_context_links_link_actor_check'
      and pg_catalog.strpos(
            pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
            'linked_by_user_id is not null'
          ) > 0
      and pg_catalog.strpos(
            pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
            'linked_by_user_id is null'
          ) > 0
  )
  or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.commercial_session_context_links'::pg_catalog.regclass
      and constraint_row.conname = 'commercial_session_context_links_unlink_state_check'
      and pg_catalog.strpos(
            pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
            'unlinked_by_user_id is not null'
          ) > 0
      and pg_catalog.strpos(
            pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
            'unlinked_by_user_id is null'
          ) > 0
  )
  or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.commercial_session_context_links'::pg_catalog.regclass
      and constraint_row.conname =
          'commercial_session_context_links_metadata_state_check'
      and pg_catalog.strpos(
            pg_catalog.lower(
              pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
            ),
            'status = ''active''::text'
          ) > 0
      and pg_catalog.strpos(
            pg_catalog.lower(
              pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
            ),
            'status = ''inactive''::text'
          ) > 0
      and pg_catalog.strpos(
            pg_catalog.lower(
              pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
            ),
            'metadata ? ''unlink''::text'
          ) > 0
      and pg_catalog.strpos(
            pg_catalog.lower(
              pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
            ),
            'jsonb_typeof(metadata -> ''unlink''::text) = ''object''::text'
          ) > 0
  )
  or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.commercial_session_context_links'::pg_catalog.regclass
      and constraint_row.conname =
          'commercial_session_context_links_temporal_order_check'
      and pg_catalog.regexp_replace(
            pg_catalog.lower(
              pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
            ),
            '[[:space:]()]',
            '',
            'g'
          ) = 'checkunlinked_atisnullorunlinked_at>=linked_at'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links check constraint contract mismatch';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'commercial_session_context_links'
  ) <> 10 then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links index count mismatch';
  end if;

  for v_index in
    select *
    from (
      values
        ('commercial_session_context_links_pkey'::text, true,  array['id']::text[], array[0]::smallint[], null::text),
        ('commercial_session_context_links_id_org_store_session_uidx', true, array['id','organization_id','store_id','conversation_session_id']::text[], array[0,0,0,0]::smallint[], null),
        ('commercial_session_context_links_one_active_per_session_uidx', true, array['organization_id','store_id','conversation_session_id']::text[], array[0,0,0]::smallint[], 'status=''active''::text'),
        ('commercial_session_context_links_idempotency_uidx', true, array['organization_id','idempotency_key']::text[], array[0,0]::smallint[], 'idempotency_keyisnotnull'),
        ('commercial_session_context_links_replaces_once_uidx', true, array['replaces_link_id']::text[], array[0]::smallint[], 'replaces_link_idisnotnull'),
        ('commercial_session_context_links_session_history_idx', false, array['organization_id','store_id','conversation_session_id','linked_at']::text[], array[0,0,0,3]::smallint[], null),
        ('commercial_session_context_links_opportunity_idx', false, array['organization_id','store_id','commercial_opportunity_id','linked_at']::text[], array[0,0,0,3]::smallint[], null),
        ('commercial_session_context_links_customer_idx', false, array['organization_id','store_id','customer_id','linked_at']::text[], array[0,0,0,3]::smallint[], null),
        ('commercial_session_context_links_lead_customer_link_idx', false, array['organization_id','lead_customer_link_id','linked_at']::text[], array[0,0,3]::smallint[], null),
        ('commercial_session_context_links_correlation_idx', false, array['correlation_id','linked_at']::text[], array[0,3]::smallint[], 'correlation_idisnotnull')
    ) as expected_index(
      index_name,
      is_unique,
      expected_columns,
      expected_options,
      expected_predicate
    )
  loop
    if not exists (
      select 1
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_relation
        on index_relation.oid = index_row.indexrelid
      join pg_catalog.pg_namespace index_namespace
        on index_namespace.oid = index_relation.relnamespace
      where index_namespace.nspname = 'public'
        and index_relation.relname = v_index.index_name
        and index_relation.relkind = 'i'
        and index_row.indrelid =
            'public.commercial_session_context_links'::pg_catalog.regclass
        and index_row.indisunique = v_index.is_unique
        and index_row.indisvalid
        and index_row.indisready
        and index_row.indexprs is null
        and index_row.indnatts = pg_catalog.array_length(v_index.expected_columns, 1)
        and index_row.indnkeyatts = pg_catalog.array_length(v_index.expected_columns, 1)
        and (
          select pg_catalog.array_agg(
                   attribute_row.attname::text
                   order by key_column.ordinality
                 )
          from pg_catalog.unnest(index_row.indkey::smallint[])
               with ordinality as key_column(attnum, ordinality)
          join pg_catalog.pg_attribute attribute_row
            on attribute_row.attrelid = index_row.indrelid
           and attribute_row.attnum = key_column.attnum
        ) = v_index.expected_columns
        and (
          select pg_catalog.array_agg(
                   option_value
                   order by option_column.ordinality
                 )
          from pg_catalog.unnest(index_row.indoption::smallint[])
               with ordinality as option_column(option_value, ordinality)
        ) = v_index.expected_options
        and (
          (v_index.expected_predicate is null and index_row.indpred is null)
          or (
            v_index.expected_predicate is not null
            and index_row.indpred is not null
            and pg_catalog.regexp_replace(
                  pg_catalog.lower(
                    pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)
                  ),
                  '[[:space:]()]',
                  '',
                  'g'
                ) = v_index.expected_predicate
          )
        )
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'commercial_session_context_links index contract mismatch';
    end if;
  end loop;

  select pg_catalog.regexp_replace(
           pg_catalog.replace(
             pg_catalog.lower(policy_row.qual),
             'public.',
             ''
           ),
           '[[:space:]()]',
           '',
           'g'
         )
  into v_policy_qual
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'public'
    and policy_row.tablename = 'commercial_session_context_links'
    and policy_row.policyname =
        'commercial_session_context_links_select_by_membership';

  if (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'commercial_session_context_links'
  ) <> 1
  or not exists (
    select 1
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'public'
      and policy_row.tablename = 'commercial_session_context_links'
      and policy_row.policyname =
          'commercial_session_context_links_select_by_membership'
      and policy_row.permissive = 'PERMISSIVE'
      and policy_row.cmd = 'SELECT'
      and policy_row.roles = array['authenticated']::name[]
      and policy_row.with_check is null
  )
  or v_policy_qual is distinct from
       'existsselect1frommembershipsmembership_rowwheremembership_row.organization_id=commercial_session_context_links.organization_idandmembership_row.user_id=auth.uid'
  then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links RLS policy mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'service_role'
      and rolbypassrls
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links service_role read contract mismatch';
  end if;

  if (
    select count(*)
    from information_schema.role_table_grants grant_row
    where grant_row.table_schema = 'public'
      and grant_row.table_name = 'commercial_session_context_links'
      and grant_row.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ) <> 2
  or not exists (
    select 1
    from information_schema.role_table_grants grant_row
    where grant_row.table_schema = 'public'
      and grant_row.table_name = 'commercial_session_context_links'
      and grant_row.grantee = 'authenticated'
      and grant_row.privilege_type = 'SELECT'
  )
  or not exists (
    select 1
    from information_schema.role_table_grants grant_row
    where grant_row.table_schema = 'public'
      and grant_row.table_name = 'commercial_session_context_links'
      and grant_row.grantee = 'service_role'
      and grant_row.privilege_type = 'SELECT'
  )
  or pg_catalog.has_table_privilege('authenticated', 'public.commercial_session_context_links', 'INSERT')
  or pg_catalog.has_table_privilege('authenticated', 'public.commercial_session_context_links', 'UPDATE')
  or pg_catalog.has_table_privilege('authenticated', 'public.commercial_session_context_links', 'DELETE')
  or pg_catalog.has_table_privilege('service_role', 'public.commercial_session_context_links', 'INSERT')
  or pg_catalog.has_table_privilege('service_role', 'public.commercial_session_context_links', 'UPDATE')
  or pg_catalog.has_table_privilege('service_role', 'public.commercial_session_context_links', 'DELETE')
  or pg_catalog.has_table_privilege('anon', 'public.commercial_session_context_links', 'SELECT') then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links grants mismatch';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_proc procedure_row
      on procedure_row.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where trigger_row.tgrelid =
          'public.commercial_session_context_links'::pg_catalog.regclass
      and not trigger_row.tgisinternal
      and trigger_row.tgname = 'commercial_session_context_links_enforce_write_rules'
      and trigger_row.tgenabled = 'O'
      and trigger_row.tgtype = 31
      and namespace_row.nspname = 'public'
      and procedure_row.proname = 'enforce_commercial_session_context_link_write_rules'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links trigger contract mismatch';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'public'
      and procedure_row.proname in (
        'enforce_commercial_session_context_link_write_rules',
        'link_commercial_session_context',
        'close_commercial_session_context_link',
        'replace_commercial_session_context_link'
      )
  ) <> 4 then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_session_context_links function overload contract mismatch';
  end if;

  for v_constraint in
    select *
    from (
      values
        (
          'public.link_commercial_session_context(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,timestamp with time zone)'::text,
          true
        ),
        (
          'public.close_commercial_session_context_link(uuid,uuid,uuid,text,uuid,text,text,jsonb,uuid)',
          true
        ),
        (
          'public.replace_commercial_session_context_link(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,text,text,jsonb,timestamp with time zone)',
          true
        ),
        (
          'public.enforce_commercial_session_context_link_write_rules()',
          false
        )
    ) as expected_function(function_signature, is_controlled)
  loop
    v_function_oid := pg_catalog.to_regprocedure(
      v_constraint.function_signature
    );

    if v_function_oid is null
       or not exists (
         select 1
         from pg_catalog.pg_proc procedure_row
         join pg_catalog.pg_roles role_row
           on role_row.oid = procedure_row.proowner
         where procedure_row.oid = v_function_oid
           and role_row.rolname = 'postgres'
           and procedure_row.prosecdef = v_constraint.is_controlled
           and procedure_row.proconfig @>
             case
               when v_constraint.is_controlled then
                 array[
                   'search_path=pg_catalog, pg_temp',
                   'row_security=off'
                 ]::text[]
               else
                 array['search_path=pg_catalog, pg_temp']::text[]
             end
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'commercial_session_context_links function hardening mismatch';
    end if;

    if v_constraint.is_controlled then
      if not pg_catalog.has_function_privilege(
           'authenticated',
           v_function_oid,
           'EXECUTE'
         )
         or not pg_catalog.has_function_privilege(
              'service_role',
              v_function_oid,
              'EXECUTE'
            )
         or pg_catalog.has_function_privilege(
              'anon',
              v_function_oid,
              'EXECUTE'
            ) then
        raise exception using
          errcode = 'P0001',
          message = 'commercial_session_context_links controlled function grants mismatch';
      end if;
    else
      if pg_catalog.has_function_privilege(
           'authenticated',
           v_function_oid,
           'EXECUTE'
         )
         or pg_catalog.has_function_privilege(
              'service_role',
              v_function_oid,
              'EXECUTE'
            )
         or pg_catalog.has_function_privilege(
              'anon',
              v_function_oid,
              'EXECUTE'
            ) then
        raise exception using
          errcode = 'P0001',
          message = 'commercial_session_context_links internal function grants mismatch';
      end if;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc procedure_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          procedure_row.proacl,
          pg_catalog.acldefault('f', procedure_row.proowner)
        )
      ) privilege_row
      where procedure_row.oid = v_function_oid
        and privilege_row.grantee = 0
        and privilege_row.privilege_type = 'EXECUTE'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'commercial_session_context_links PUBLIC execute grant mismatch';
    end if;
  end loop;

  if (
    select count(*)
    from public.commercial_session_context_links
  ) <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'structural migration must not insert commercial_session_context_links rows';
  end if;
end;
$postconditions$;

commit;

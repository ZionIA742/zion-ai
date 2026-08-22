begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:current-commercial-proposal-foundation:v2',
    0
  )
);

-- ============================================================================
-- P9 / Bloco 2 / Etapa 2.4
-- Fundação da proposta comercial vigente.
--
-- Regra canônica:
-- - o caller sempre fornece opportunity + quote + version explicitamente;
-- - não existe seleção por latest/first;
-- - o fato imutável de apresentação é sales_quote_versions.sent_at;
-- - uma versão já enviada pode posteriormente ficar superseded e ainda assim
--   continuar sendo a proposta apresentada vigente até existir envio posterior;
-- - replay de uma proposta enviada antes de outra não pode regredir o ponteiro;
-- - empate de sent_at entre propostas distintas é ambíguo e falha fechado.
-- ============================================================================

do $preflight$
declare
  v_expected record;
begin
  if pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.sales_quotes') is null
     or pg_catalog.to_regclass('public.sales_quote_versions') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial_opportunities, sales_quotes and sales_quote_versions are required';
  end if;

  for v_expected in
    select *
    from (
      values
        ('commercial_opportunities'::text, 'id'::text, 'uuid'::text, 'NO'::text),
        ('commercial_opportunities', 'organization_id', 'uuid', 'NO'),
        ('commercial_opportunities', 'store_id', 'uuid', 'NO'),
        ('commercial_opportunities', 'updated_at', 'timestamp with time zone', 'NO'),
        ('sales_quotes', 'id', 'uuid', 'NO'),
        ('sales_quotes', 'organization_id', 'uuid', 'NO'),
        ('sales_quotes', 'store_id', 'uuid', 'NO'),
        ('sales_quotes', 'commercial_opportunity_id', 'uuid', 'YES'),
        ('sales_quote_versions', 'id', 'uuid', 'NO'),
        ('sales_quote_versions', 'quote_id', 'uuid', 'NO'),
        ('sales_quote_versions', 'organization_id', 'uuid', 'NO'),
        ('sales_quote_versions', 'store_id', 'uuid', 'NO'),
        ('sales_quote_versions', 'status', 'text', 'NO'),
        ('sales_quote_versions', 'sent_at', 'timestamp with time zone', 'YES')
    ) as expected(table_name, column_name, data_type, is_nullable)
  loop
    if not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = v_expected.table_name
        and column_row.column_name = v_expected.column_name
        and column_row.data_type = v_expected.data_type
        and column_row.is_nullable = v_expected.is_nullable
    ) then
      raise exception using
        errcode = 'P0001',
        message = format(
          'precondition failed: public.%s.%s must be %s nullable=%s',
          v_expected.table_name,
          v_expected.column_name,
          v_expected.data_type,
          v_expected.is_nullable
        );
    end if;
  end loop;

  -- Se as colunas já existirem, só aceitamos exatamente uuid nullable.
  if exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'commercial_opportunities'
      and column_row.column_name in ('current_quote_id', 'current_quote_version_id')
      and (
        column_row.data_type <> 'uuid'
        or column_row.is_nullable <> 'YES'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: existing current proposal columns have an incompatible contract';
  end if;
end;
$preflight$;

-- Índices únicos de suporte às FKs compostas.
-- O índice já existente de busca por opportunity em sales_quotes continua sendo
-- o caminho de busca normal; estes dois são somente contratos de referência.
create unique index if not exists sales_quotes_id_commercial_opportunity_organization_store_uidx
  on public.sales_quotes (
    id,
    commercial_opportunity_id,
    organization_id,
    store_id
  );

create unique index if not exists sales_quote_versions_id_quote_organization_store_uidx
  on public.sales_quote_versions (
    id,
    quote_id,
    organization_id,
    store_id
  );

alter table public.commercial_opportunities
  add column if not exists current_quote_id uuid null,
  add column if not exists current_quote_version_id uuid null;

comment on column public.commercial_opportunities.current_quote_id is
  'Quote explicitamente associada à proposta comercial atualmente apresentada/vigente da opportunity; nunca inferida por recência.';

comment on column public.commercial_opportunities.current_quote_version_id is
  'Versão explicitamente associada à proposta comercial atualmente apresentada/vigente da opportunity; deve pertencer a current_quote_id.';

do $ensure_constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_opportunities'::pg_catalog.regclass
      and constraint_row.conname = 'commercial_opportunities_current_quote_pair_check'
  ) then
    alter table public.commercial_opportunities
      add constraint commercial_opportunities_current_quote_pair_check
      check (
        (
          current_quote_id is null
          and current_quote_version_id is null
        )
        or (
          current_quote_id is not null
          and current_quote_version_id is not null
        )
      )
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_opportunities'::pg_catalog.regclass
      and constraint_row.conname = 'commercial_opportunities_current_quote_opportunity_scope_fkey'
  ) then
    alter table public.commercial_opportunities
      add constraint commercial_opportunities_current_quote_opportunity_scope_fkey
      foreign key (
        current_quote_id,
        id,
        organization_id,
        store_id
      )
      references public.sales_quotes (
        id,
        commercial_opportunity_id,
        organization_id,
        store_id
      )
      on update no action
      on delete restrict
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_opportunities'::pg_catalog.regclass
      and constraint_row.conname = 'commercial_opportunities_current_quote_version_scope_fkey'
  ) then
    alter table public.commercial_opportunities
      add constraint commercial_opportunities_current_quote_version_scope_fkey
      foreign key (
        current_quote_version_id,
        current_quote_id,
        organization_id,
        store_id
      )
      references public.sales_quote_versions (
        id,
        quote_id,
        organization_id,
        store_id
      )
      on update no action
      on delete restrict
      not valid;
  end if;
end;
$ensure_constraints$;

alter table public.commercial_opportunities
  validate constraint commercial_opportunities_current_quote_pair_check;

alter table public.commercial_opportunities
  validate constraint commercial_opportunities_current_quote_opportunity_scope_fkey;

alter table public.commercial_opportunities
  validate constraint commercial_opportunities_current_quote_version_scope_fkey;

create or replace function public.set_current_commercial_proposal_from_sent_quote_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_sales_quote_id uuid,
  p_sales_quote_version_id uuid,
  p_idempotency_key text default null,
  p_source text default 'system_current_commercial_proposal_projection'
)
returns table (
  commercial_opportunity_id uuid,
  current_quote_id uuid,
  current_quote_version_id uuid,
  changed boolean,
  outcome text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text :=
    coalesce(
      nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
      nullif(auth.jwt() ->> 'role', '')
    );
  v_idempotency_key text :=
    nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
  v_source text :=
    nullif(pg_catalog.btrim(coalesce(p_source, '')), '');
  v_expected_idempotency_key text;
  v_opportunity public.commercial_opportunities;
  v_sales_quote public.sales_quotes;
  v_sales_quote_version public.sales_quote_versions;
  v_current_quote public.sales_quotes;
  v_current_quote_version public.sales_quote_versions;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'current commercial proposal projection by system is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_sales_quote_id is null
     or p_sales_quote_version_id is null
     or v_idempotency_key is null
     or v_source is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_CURRENT_PROPOSAL_ARGUMENTS_REQUIRED';
  end if;

  -- A idempotência é determinística pela identidade explícita da operação.
  -- Não aceitamos chave arbitrária: a própria tripla opportunity/quote/version
  -- define a chave, logo a mesma chave não pode ser reaproveitada com outro
  -- payload sem ser rejeitada.
  v_expected_idempotency_key :=
    'current_commercial_proposal:'
    || p_commercial_opportunity_id::text
    || ':'
    || p_sales_quote_id::text
    || ':'
    || p_sales_quote_version_id::text;

  if v_idempotency_key is distinct from v_expected_idempotency_key then
    raise exception using
      errcode = '22023',
      message = 'ZION_CURRENT_PROPOSAL_IDEMPOTENCY_KEY_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_expected_idempotency_key, 0)
  );

  -- Serializa toda decisão de current proposal desta opportunity.
  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity not found';
  end if;

  if v_opportunity.organization_id is distinct from p_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity scope mismatch';
  end if;

  select sales_quote_row.*
  into v_sales_quote
  from public.sales_quotes sales_quote_row
  where sales_quote_row.id = p_sales_quote_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'sales quote not found';
  end if;

  if v_sales_quote.organization_id is distinct from p_organization_id
     or v_sales_quote.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'sales quote scope mismatch';
  end if;

  if v_sales_quote.commercial_opportunity_id is null then
    raise exception using
      errcode = '23514',
      message = 'sales quote is not linked to a commercial opportunity';
  end if;

  if v_sales_quote.commercial_opportunity_id is distinct from v_opportunity.id then
    raise exception using
      errcode = '23514',
      message = 'sales quote opportunity mismatch';
  end if;

  select sales_quote_version_row.*
  into v_sales_quote_version
  from public.sales_quote_versions sales_quote_version_row
  where sales_quote_version_row.id = p_sales_quote_version_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'sales quote version not found';
  end if;

  if v_sales_quote_version.organization_id is distinct from p_organization_id
     or v_sales_quote_version.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'sales quote version scope mismatch';
  end if;

  if v_sales_quote_version.quote_id is distinct from v_sales_quote.id then
    raise exception using
      errcode = '23514',
      message = 'sales quote version does not belong to the provided quote';
  end if;

  -- sent_at é a evidência de apresentação. O status pode ter evoluído de
  -- sent para superseded depois que uma revisão em draft nasceu.
  if v_sales_quote_version.sent_at is null
     or lower(pg_catalog.btrim(coalesce(v_sales_quote_version.status, '')))
        not in ('sent', 'superseded') then
    raise exception using
      errcode = '23514',
      message = 'sales quote version has no canonical sent evidence';
  end if;

  -- Se já existe ponteiro, ele próprio precisa continuar íntegro e apoiado por
  -- evidência de envio. Não corrigimos silenciosamente estado corrompido.
  if v_opportunity.current_quote_id is not null then
    select current_quote_row.*
    into v_current_quote
    from public.sales_quotes current_quote_row
    where current_quote_row.id = v_opportunity.current_quote_id;

    if not found
       or v_current_quote.organization_id is distinct from v_opportunity.organization_id
       or v_current_quote.store_id is distinct from v_opportunity.store_id
       or v_current_quote.commercial_opportunity_id is distinct from v_opportunity.id then
      raise exception using
        errcode = '23514',
        message = 'ZION_CURRENT_PROPOSAL_STORED_QUOTE_INVALID';
    end if;

    select current_version_row.*
    into v_current_quote_version
    from public.sales_quote_versions current_version_row
    where current_version_row.id = v_opportunity.current_quote_version_id;

    if not found
       or v_current_quote_version.quote_id is distinct from v_current_quote.id
       or v_current_quote_version.organization_id is distinct from v_opportunity.organization_id
       or v_current_quote_version.store_id is distinct from v_opportunity.store_id
       or v_current_quote_version.sent_at is null
       or lower(pg_catalog.btrim(coalesce(v_current_quote_version.status, '')))
          not in ('sent', 'superseded') then
      raise exception using
        errcode = '23514',
        message = 'ZION_CURRENT_PROPOSAL_STORED_VERSION_INVALID';
    end if;
  end if;

  -- Ambiguidade real: duas propostas distintas da mesma opportunity com o
  -- mesmo sent_at não podem ser ordenadas com segurança.
  if exists (
    select 1
    from public.sales_quotes other_quote
    join public.sales_quote_versions other_version
      on other_version.quote_id = other_quote.id
     and other_version.organization_id = other_quote.organization_id
     and other_version.store_id = other_quote.store_id
    where other_quote.organization_id = v_opportunity.organization_id
      and other_quote.store_id = v_opportunity.store_id
      and other_quote.commercial_opportunity_id = v_opportunity.id
      and other_version.sent_at = v_sales_quote_version.sent_at
      and lower(pg_catalog.btrim(coalesce(other_version.status, '')))
          in ('sent', 'superseded')
      and (
        other_quote.id is distinct from v_sales_quote.id
        or other_version.id is distinct from v_sales_quote_version.id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'ZION_CURRENT_PROPOSAL_SEND_ORDER_AMBIGUOUS';
  end if;

  -- Não seleciona a "mais recente". Apenas prova que a candidate explícita
  -- está obsoleta quando já existe um fato de envio posterior para a mesma
  -- opportunity. Isso torna o writer seguro contra replay direto e execução
  -- fora de ordem.
  if exists (
    select 1
    from public.sales_quotes later_quote
    join public.sales_quote_versions later_version
      on later_version.quote_id = later_quote.id
     and later_version.organization_id = later_quote.organization_id
     and later_version.store_id = later_quote.store_id
    where later_quote.organization_id = v_opportunity.organization_id
      and later_quote.store_id = v_opportunity.store_id
      and later_quote.commercial_opportunity_id = v_opportunity.id
      and later_version.sent_at is not null
      and later_version.sent_at > v_sales_quote_version.sent_at
      and lower(pg_catalog.btrim(coalesce(later_version.status, '')))
          in ('sent', 'superseded')
  ) then
    return query
    select
      v_opportunity.id,
      v_opportunity.current_quote_id,
      v_opportunity.current_quote_version_id,
      false,
      'stale_sent_proposal_ignored'::text,
      v_opportunity.updated_at;
    return;
  end if;

  if v_opportunity.current_quote_id is not distinct from v_sales_quote.id
     and v_opportunity.current_quote_version_id is not distinct from v_sales_quote_version.id then
    return query
    select
      v_opportunity.id,
      v_opportunity.current_quote_id,
      v_opportunity.current_quote_version_id,
      false,
      'already_current_proposal'::text,
      v_opportunity.updated_at;
    return;
  end if;

  update public.commercial_opportunities opportunity_row
  set current_quote_id = v_sales_quote.id,
      current_quote_version_id = v_sales_quote_version.id,
      updated_at = pg_catalog.clock_timestamp()
  where opportunity_row.id = v_opportunity.id
    and opportunity_row.organization_id = v_opportunity.organization_id
    and opportunity_row.store_id = v_opportunity.store_id
  returning opportunity_row.*
  into v_opportunity;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CURRENT_PROPOSAL_UPDATE_LOST_LOCKED_ROW';
  end if;

  return query
  select
    v_opportunity.id,
    v_opportunity.current_quote_id,
    v_opportunity.current_quote_version_id,
    true,
    'current_proposal_updated'::text,
    v_opportunity.updated_at;
end;
$function$;

alter function public.set_current_commercial_proposal_from_sent_quote_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text
) owner to postgres;

comment on function public.set_current_commercial_proposal_from_sent_quote_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text
) is
  'Materializa a proposta comercial vigente a partir de quote/version explícita com sent_at. É segura contra replay obsoleto: proposta com envio posterior impede regressão; empate de sent_at entre propostas distintas falha fechado.';

revoke all on function public.set_current_commercial_proposal_from_sent_quote_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.set_current_commercial_proposal_from_sent_quote_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text
) to service_role;

do $postconditions$
declare
  v_proc_oid oid := pg_catalog.to_regprocedure(
    'public.set_current_commercial_proposal_from_sent_quote_by_system(uuid,uuid,uuid,uuid,uuid,text,text)'
  );
  v_definition text;
  v_normalized_definition text;
  v_index_definition text;
begin
  -- Colunas
  if (
    select count(*)
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'commercial_opportunities'
      and column_row.column_name in ('current_quote_id', 'current_quote_version_id')
      and column_row.data_type = 'uuid'
      and column_row.is_nullable = 'YES'
  ) <> 2 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current proposal columns mismatch';
  end if;

  -- Índices de referência: o nome existente não pode esconder definição errada.
  select lower(regexp_replace(pg_catalog.pg_get_indexdef(index_row.indexrelid), '\s+', ' ', 'g'))
  into v_index_definition
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_class
    on index_class.oid = index_row.indexrelid
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = index_class.relnamespace
  where namespace_row.nspname = 'public'
    and index_class.relname = 'sales_quotes_id_commercial_opportunity_organization_store_uidx';

  if v_index_definition is null
     or v_index_definition not like '%unique index%sales_quotes_id_commercial_opportunity_organization_store_uidx%on public.sales_quotes%using btree (id, commercial_opportunity_id, organization_id, store_id)%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: sales_quotes current proposal reference index mismatch';
  end if;

  select lower(regexp_replace(pg_catalog.pg_get_indexdef(index_row.indexrelid), '\s+', ' ', 'g'))
  into v_index_definition
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_class
    on index_class.oid = index_row.indexrelid
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = index_class.relnamespace
  where namespace_row.nspname = 'public'
    and index_class.relname = 'sales_quote_versions_id_quote_organization_store_uidx';

  if v_index_definition is null
     or v_index_definition not like '%unique index%sales_quote_versions_id_quote_organization_store_uidx%on public.sales_quote_versions%using btree (id, quote_id, organization_id, store_id)%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: sales_quote_versions current proposal reference index mismatch';
  end if;

  -- Constraints devem existir, estar validadas e preservar o contrato esperado.
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_opportunities'::pg_catalog.regclass
      and constraint_row.conname = 'commercial_opportunities_current_quote_pair_check'
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
      and lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true))
          like '%current_quote_id is null%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true))
          like '%current_quote_version_id is null%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true))
          like '%current_quote_id is not null%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true))
          like '%current_quote_version_id is not null%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current quote pair check mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_opportunities'::pg_catalog.regclass
      and constraint_row.conname = 'commercial_opportunities_current_quote_opportunity_scope_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.convalidated
      and constraint_row.confrelid = 'public.sales_quotes'::pg_catalog.regclass
      and constraint_row.confdeltype = 'r'
      and constraint_row.confupdtype = 'a'
      and (
        select pg_catalog.array_agg(attribute_row.attname order by key_row.ordinality)
        from pg_catalog.unnest(constraint_row.conkey)
             with ordinality as key_row(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.conrelid
         and attribute_row.attnum = key_row.attnum
      ) = array[
        'current_quote_id',
        'id',
        'organization_id',
        'store_id'
      ]::name[]
      and (
        select pg_catalog.array_agg(attribute_row.attname order by key_row.ordinality)
        from pg_catalog.unnest(constraint_row.confkey)
             with ordinality as key_row(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.confrelid
         and attribute_row.attnum = key_row.attnum
      ) = array[
        'id',
        'commercial_opportunity_id',
        'organization_id',
        'store_id'
      ]::name[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current quote opportunity-scope FK mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_opportunities'::pg_catalog.regclass
      and constraint_row.conname = 'commercial_opportunities_current_quote_version_scope_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.convalidated
      and constraint_row.confrelid = 'public.sales_quote_versions'::pg_catalog.regclass
      and constraint_row.confdeltype = 'r'
      and constraint_row.confupdtype = 'a'
      and (
        select pg_catalog.array_agg(attribute_row.attname order by key_row.ordinality)
        from pg_catalog.unnest(constraint_row.conkey)
             with ordinality as key_row(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.conrelid
         and attribute_row.attnum = key_row.attnum
      ) = array[
        'current_quote_version_id',
        'current_quote_id',
        'organization_id',
        'store_id'
      ]::name[]
      and (
        select pg_catalog.array_agg(attribute_row.attname order by key_row.ordinality)
        from pg_catalog.unnest(constraint_row.confkey)
             with ordinality as key_row(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.confrelid
         and attribute_row.attnum = key_row.attnum
      ) = array[
        'id',
        'quote_id',
        'organization_id',
        'store_id'
      ]::name[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current quote version-scope FK mismatch';
  end if;

  -- As colunas controladas não podem ficar diretamente graváveis por papéis da API.
  if pg_catalog.has_column_privilege(
       'authenticated',
       'public.commercial_opportunities',
       'current_quote_id',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'authenticated',
       'public.commercial_opportunities',
       'current_quote_version_id',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'service_role',
       'public.commercial_opportunities',
       'current_quote_id',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'service_role',
       'public.commercial_opportunities',
       'current_quote_version_id',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'anon',
       'public.commercial_opportunities',
       'current_quote_id',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'anon',
       'public.commercial_opportunities',
       'current_quote_version_id',
       'UPDATE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current proposal columns are directly writable by an API role';
  end if;

  if v_proc_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current commercial proposal writer was not created';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_roles owner_row
      on owner_row.oid = proc_row.proowner
    where proc_row.oid = v_proc_oid
      and owner_row.rolname = 'postgres'
      and proc_row.prosecdef
      and proc_row.provolatile = 'v'
      and exists (
        select 1
        from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_row
        where config_row = 'search_path=pg_catalog, pg_temp, public'
      )
      and exists (
        select 1
        from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_row
        where config_row = 'row_security=off'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current commercial proposal writer metadata mismatch';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))
    ) privilege_row
    where proc_row.oid = v_proc_oid
      and privilege_row.grantee = 0
      and privilege_row.privilege_type = 'EXECUTE'
  )
  or pg_catalog.has_function_privilege('anon', v_proc_oid, 'EXECUTE')
  or pg_catalog.has_function_privilege('authenticated', v_proc_oid, 'EXECUTE')
  or not pg_catalog.has_function_privilege('service_role', v_proc_oid, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current commercial proposal writer grants mismatch';
  end if;

  select pg_catalog.pg_get_functiondef(v_proc_oid)
  into v_definition;

  v_normalized_definition :=
    lower(regexp_replace(coalesce(v_definition, ''), '\s+', ' ', 'g'));

  if v_normalized_definition not like '%for update%'
     or v_normalized_definition not like '%sent_at is null%'
     or v_normalized_definition not like '%stale_sent_proposal_ignored%'
     or v_normalized_definition not like '%zion_current_proposal_send_order_ambiguous%'
     or v_normalized_definition not like '%zion_current_proposal_idempotency_key_invalid%'
     or v_normalized_definition not like '%later_version.sent_at > v_sales_quote_version.sent_at%'
     or v_normalized_definition like '%order by%'
     or v_normalized_definition like '%limit 1%'
     or v_normalized_definition like '%updated_at desc%'
     or v_normalized_definition like '%created_at desc%'
     or v_normalized_definition like '%conversation_id%'
     or v_normalized_definition like '%lead_id%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current commercial proposal writer definition mismatch';
  end if;
end;
$postconditions$;

commit;

-- ZION / Pilar 9 / Fase 4 / 4.1A-2
-- Backfill canônico dos leads legados para customers e lead_customer_links.
--
-- OBJETIVO:
-- - reutilizar customer existente quando já houver identidade WhatsApp canônica;
-- - criar customer, identidade WhatsApp e vínculo com loja quando faltarem;
-- - criar lead_customer_links exclusivamente pela função controlada;
-- - registrar source=legacy_backfill e actor=migration;
-- - preservar dados existentes e não alterar nenhuma linha de leads;
-- - abortar integralmente diante de inconsistência, concorrência ou pós-condição.
--
-- IMPORTANTE:
-- - esta migration depende de:
--   20260720150000_lead_customer_links_foundation.sql
--   20260720153000_preserve_lead_customer_link_actor_identity.sql
-- - não editar nem reaplicar as migrations anteriores;
-- - executar este arquivo inteiro uma única vez;
-- - não há quantidade, UUID, organização, loja, lead ou telefone fixado no código.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:lead_customer_links:legacy_backfill:v1',
    0
  )
);

-- Bloqueia escritas concorrentes durante o plano e a aplicação do backfill.
-- A execução é curta e qualquer espera acima do lock_timeout aborta sem mutação.
lock table
  public.organizations,
  public.stores,
  public.leads,
  public.customers,
  public.customer_channel_identities,
  public.customer_store_links,
  public.lead_customer_links
in share row exclusive mode;

-- --------------------------------------------------------------------------
-- Contexto, inventário inicial e plano determinístico.
-- --------------------------------------------------------------------------

create temp table _p9_lcl_backfill_context (
  singleton boolean primary key default true check (singleton),
  run_id uuid not null,
  leads_count_before bigint not null,
  customers_count_before bigint not null,
  identities_count_before bigint not null,
  store_links_count_before bigint not null,
  lead_links_count_before bigint not null,
  leads_fingerprint_before text not null
) on commit drop;

create temp table _p9_lcl_backfill_plan (
  lead_id uuid primary key,
  organization_id uuid not null,
  store_id uuid not null,
  lead_name text not null,
  raw_phone text not null,
  normalized_phone text not null,

  existing_identity_id uuid null,
  existing_customer_id uuid null,
  customer_id uuid not null,
  identity_id uuid not null,

  create_customer boolean not null,
  create_identity boolean not null,

  idempotency_key text not null,
  source_reference text not null,
  created_link_id uuid null
) on commit drop;

create temp table _p9_lcl_backfill_store_link_plan (
  organization_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  customer_store_link_id uuid not null unique,
  primary key (organization_id, store_id, customer_id)
) on commit drop;

insert into _p9_lcl_backfill_context (
  run_id,
  leads_count_before,
  customers_count_before,
  identities_count_before,
  store_links_count_before,
  lead_links_count_before,
  leads_fingerprint_before
)
select
  gen_random_uuid(),
  (select count(*) from public.leads),
  (select count(*) from public.customers),
  (select count(*) from public.customer_channel_identities),
  (select count(*) from public.customer_store_links),
  (select count(*) from public.lead_customer_links),
  coalesce(
    (
      select pg_catalog.md5(
        pg_catalog.string_agg(
          pg_catalog.to_jsonb(lead_row)::text,
          E'\n'
          order by lead_row.id
        )
      )
      from public.leads lead_row
    ),
    pg_catalog.md5('')
  );

-- --------------------------------------------------------------------------
-- Pré-condições estruturais e de dados.
-- --------------------------------------------------------------------------

do $preconditions$
begin
  if pg_catalog.to_regclass('public.lead_customer_links') is null
     or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.customer_channel_identities') is null
     or pg_catalog.to_regclass('public.customer_store_links') is null
     or pg_catalog.to_regclass('public.leads') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical customer backfill objects are missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.normalize_br_whatsapp_identity(text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.link_lead_to_customer(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text,text,uuid,jsonb,timestamp with time zone)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: controlled lead customer link functions are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.lead_customer_links'::pg_catalog.regclass
      and con.conname = 'lead_customer_links_linked_by_user_fkey'
      and con.contype = 'f'
      and con.confrelid = 'auth.users'::pg_catalog.regclass
      and con.confdeltype = 'r'
  )
  or not exists (
    select 1
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.lead_customer_links'::pg_catalog.regclass
      and con.conname = 'lead_customer_links_unlinked_by_user_fkey'
      and con.contype = 'f'
      and con.confrelid = 'auth.users'::pg_catalog.regclass
      and con.confdeltype = 'r'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: strict actor identity migration is not applied';
  end if;

  if exists (
    select 1
    from public.lead_customer_links existing_backfill
    where existing_backfill.idempotency_key like
      'p9:lcl:legacy-backfill:v1:%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: legacy lead customer backfill v1 was already applied';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    where lead_row.organization_id is null
       or lead_row.store_id is null
       or nullif(pg_catalog.btrim(lead_row.name), '') is null
       or nullif(pg_catalog.btrim(lead_row.phone), '') is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'precondition failed: one or more legacy leads lack organization, store, name or phone';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    where not exists (
      select 1
      from public.stores store_row
      where store_row.id = lead_row.store_id
        and store_row.organization_id = lead_row.organization_id
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'precondition failed: one or more legacy leads have an invalid store relation';
  end if;
end;
$preconditions$;

-- A chamada de normalização também funciona como validação explícita:
-- qualquer telefone fora do contrato brasileiro aborta toda a transação.
insert into _p9_lcl_backfill_plan (
  lead_id,
  organization_id,
  store_id,
  lead_name,
  raw_phone,
  normalized_phone,
  existing_identity_id,
  existing_customer_id,
  customer_id,
  identity_id,
  create_customer,
  create_identity,
  idempotency_key,
  source_reference
)
select
  prepared.lead_id,
  prepared.organization_id,
  prepared.store_id,
  prepared.lead_name,
  prepared.raw_phone,
  prepared.normalized_phone,
  identity_row.id,
  identity_row.customer_id,
  coalesce(identity_row.customer_id, gen_random_uuid()),
  coalesce(identity_row.id, gen_random_uuid()),
  identity_row.id is null,
  identity_row.id is null,
  'p9:lcl:legacy-backfill:v1:' || prepared.lead_id::text,
  'legacy_lead:' || prepared.lead_id::text
from (
  select
    lead_row.id as lead_id,
    lead_row.organization_id,
    lead_row.store_id,
    pg_catalog.btrim(lead_row.name) as lead_name,
    pg_catalog.btrim(lead_row.phone) as raw_phone,
    public.normalize_br_whatsapp_identity(lead_row.phone)
      as normalized_phone
  from public.leads lead_row
) prepared
left join public.customer_channel_identities identity_row
  on identity_row.organization_id = prepared.organization_id
 and identity_row.channel = 'whatsapp'
 and identity_row.normalized_external_identity =
     prepared.normalized_phone
where not exists (
  select 1
  from public.lead_customer_links existing_lead_link
  where existing_lead_link.organization_id = prepared.organization_id
    and existing_lead_link.store_id = prepared.store_id
    and existing_lead_link.lead_id = prepared.lead_id
);

do $plan_validation$
begin
  if exists (
    select 1
    from _p9_lcl_backfill_plan plan_row
    group by plan_row.organization_id, plan_row.normalized_phone
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'precondition failed: duplicate normalized WhatsApp identities require manual review';
  end if;

  if exists (
    select 1
    from _p9_lcl_backfill_plan plan_row
    join public.customers customer_row
      on customer_row.id = plan_row.existing_customer_id
     and customer_row.organization_id = plan_row.organization_id
    where plan_row.existing_customer_id is not null
      and customer_row.merged_into_customer_id is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'precondition failed: an existing WhatsApp identity belongs to a merged customer';
  end if;

  if exists (
    select 1
    from _p9_lcl_backfill_plan plan_row
    where plan_row.create_customer is distinct from
          plan_row.create_identity
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: customer and identity creation plan diverged';
  end if;

  if exists (
    select 1
    from _p9_lcl_backfill_plan plan_row
    where plan_row.existing_identity_id is not null
      and (
        plan_row.existing_customer_id is null
        or plan_row.customer_id <> plan_row.existing_customer_id
        or plan_row.identity_id <> plan_row.existing_identity_id
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: existing identity mapping is inconsistent';
  end if;
end;
$plan_validation$;

insert into _p9_lcl_backfill_store_link_plan (
  organization_id,
  store_id,
  customer_id,
  customer_store_link_id
)
select
  plan_row.organization_id,
  plan_row.store_id,
  plan_row.customer_id,
  gen_random_uuid()
from _p9_lcl_backfill_plan plan_row
where not exists (
  select 1
  from public.customer_store_links existing_store_link
  where existing_store_link.organization_id = plan_row.organization_id
    and existing_store_link.store_id = plan_row.store_id
    and existing_store_link.customer_id = plan_row.customer_id
)
group by
  plan_row.organization_id,
  plan_row.store_id,
  plan_row.customer_id
order by
  plan_row.organization_id,
  plan_row.store_id,
  plan_row.customer_id;

-- --------------------------------------------------------------------------
-- Criação canônica de customers e identidades faltantes.
-- --------------------------------------------------------------------------

insert into public.customers (
  id,
  organization_id,
  display_name,
  normalized_name
)
select
  plan_row.customer_id,
  plan_row.organization_id,
  plan_row.lead_name,
  pg_catalog.lower(
    pg_catalog.regexp_replace(
      plan_row.lead_name,
      '[[:space:]]+',
      ' ',
      'g'
    )
  )
from _p9_lcl_backfill_plan plan_row
where plan_row.create_customer
order by plan_row.organization_id, plan_row.lead_id;

insert into public.customer_channel_identities (
  id,
  organization_id,
  customer_id,
  channel,
  external_identity,
  normalized_external_identity,
  verified_at,
  is_primary
)
select
  plan_row.identity_id,
  plan_row.organization_id,
  plan_row.customer_id,
  'whatsapp',
  plan_row.raw_phone,
  plan_row.normalized_phone,
  null,
  true
from _p9_lcl_backfill_plan plan_row
where plan_row.create_identity
order by plan_row.organization_id, plan_row.lead_id;

insert into public.customer_store_links (
  id,
  organization_id,
  store_id,
  customer_id
)
select
  store_plan.customer_store_link_id,
  store_plan.organization_id,
  store_plan.store_id,
  store_plan.customer_id
from _p9_lcl_backfill_store_link_plan store_plan
order by
  store_plan.organization_id,
  store_plan.store_id,
  store_plan.customer_id;

-- --------------------------------------------------------------------------
-- Vínculo lead -> customer exclusivamente pela função controlada.
-- --------------------------------------------------------------------------

do $create_links$
declare
  v_run_id uuid;
  v_plan record;
  v_created public.lead_customer_links;
begin
  select context_row.run_id
  into v_run_id
  from _p9_lcl_backfill_context context_row;

  for v_plan in
    select plan_row.*
    from _p9_lcl_backfill_plan plan_row
    order by
      plan_row.organization_id,
      plan_row.store_id,
      plan_row.lead_id
  loop
    select created_row.*
    into v_created
    from public.link_lead_to_customer(
      p_organization_id => v_plan.organization_id,
      p_store_id => v_plan.store_id,
      p_lead_id => v_plan.lead_id,
      p_customer_id => v_plan.customer_id,
      p_source => 'legacy_backfill',
      p_linked_by_actor_type => 'migration',
      p_linked_by_user_id => null,
      p_source_identity_id => v_plan.identity_id,
      p_source_reference => v_plan.source_reference,
      p_idempotency_key => v_plan.idempotency_key,
      p_correlation_id => v_run_id,
      p_metadata => pg_catalog.jsonb_build_object(
        'backfill',
        pg_catalog.jsonb_build_object(
          'version', 1,
          'migration', '20260720163000_backfill_legacy_leads_to_customers',
          'legacy_lead_id', v_plan.lead_id
        )
      ),
      p_linked_at => null
    ) created_row;

    update _p9_lcl_backfill_plan
    set created_link_id = v_created.id
    where lead_id = v_plan.lead_id;
  end loop;
end;
$create_links$;

-- --------------------------------------------------------------------------
-- Pós-condições: contagens, relações, autoria, ausência de resíduos e
-- preservação integral dos leads.
-- --------------------------------------------------------------------------

do $postconditions$
declare
  v_context _p9_lcl_backfill_context%rowtype;
  v_new_customers bigint;
  v_new_identities bigint;
  v_new_store_links bigint;
  v_new_lead_links bigint;
  v_current_leads_fingerprint text;
begin
  select *
  into v_context
  from _p9_lcl_backfill_context;

  select count(*) into v_new_customers
  from _p9_lcl_backfill_plan
  where create_customer;

  select count(*) into v_new_identities
  from _p9_lcl_backfill_plan
  where create_identity;

  select count(*) into v_new_store_links
  from _p9_lcl_backfill_store_link_plan;

  select count(*) into v_new_lead_links
  from _p9_lcl_backfill_plan;

  select coalesce(
    (
      select pg_catalog.md5(
        pg_catalog.string_agg(
          pg_catalog.to_jsonb(lead_row)::text,
          E'\n'
          order by lead_row.id
        )
      )
      from public.leads lead_row
    ),
    pg_catalog.md5('')
  )
  into v_current_leads_fingerprint;

  if (select count(*) from public.leads)
       <> v_context.leads_count_before
     or v_current_leads_fingerprint
       <> v_context.leads_fingerprint_before then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: legacy leads changed during backfill';
  end if;

  if (select count(*) from public.customers)
       <> v_context.customers_count_before + v_new_customers
     or (select count(*) from public.customer_channel_identities)
       <> v_context.identities_count_before + v_new_identities
     or (select count(*) from public.customer_store_links)
       <> v_context.store_links_count_before + v_new_store_links
     or (select count(*) from public.lead_customer_links)
       <> v_context.lead_links_count_before + v_new_lead_links then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: canonical table counts differ from the backfill plan';
  end if;

  if exists (
    select 1
    from _p9_lcl_backfill_plan plan_row
    where plan_row.create_customer
      and not exists (
        select 1
        from public.customers customer_row
        where customer_row.id = plan_row.customer_id
          and customer_row.organization_id = plan_row.organization_id
          and customer_row.merged_into_customer_id is null
          and customer_row.display_name = plan_row.lead_name
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: one or more planned customers are missing or invalid';
  end if;

  if exists (
    select 1
    from _p9_lcl_backfill_plan plan_row
    where not exists (
      select 1
      from public.customer_channel_identities identity_row
      where identity_row.id = plan_row.identity_id
        and identity_row.customer_id = plan_row.customer_id
        and identity_row.organization_id = plan_row.organization_id
        and identity_row.channel = 'whatsapp'
        and identity_row.normalized_external_identity =
            plan_row.normalized_phone
        and (
          not plan_row.create_identity
          or (
            identity_row.verified_at is null
            and identity_row.is_primary
          )
        )
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: one or more canonical WhatsApp identities are missing or invalid';
  end if;

  if exists (
    select 1
    from _p9_lcl_backfill_plan plan_row
    where not exists (
      select 1
      from public.customer_store_links store_link
      where store_link.organization_id = plan_row.organization_id
        and store_link.store_id = plan_row.store_id
        and store_link.customer_id = plan_row.customer_id
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: one or more customer-store relations are missing';
  end if;

  if exists (
    select 1
    from _p9_lcl_backfill_plan plan_row
    where not exists (
        select 1
        from public.lead_customer_links link_row
        where link_row.id = plan_row.created_link_id
          and link_row.organization_id = plan_row.organization_id
          and link_row.store_id = plan_row.store_id
          and link_row.lead_id = plan_row.lead_id
          and link_row.customer_id = plan_row.customer_id
          and link_row.source_identity_id = plan_row.identity_id
          and link_row.status = 'active'
          and link_row.source = 'legacy_backfill'
          and link_row.idempotency_key = plan_row.idempotency_key
          and link_row.correlation_id = v_context.run_id
          and link_row.linked_by_actor_type = 'migration'
          and link_row.linked_by_user_id is null
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: one or more lead customer links are missing or invalid';
  end if;

  if exists (
    select 1
    from _p9_lcl_backfill_plan plan_row
    where (
        plan_row.created_link_id is null
        or (
          select count(*)
          from public.lead_customer_links link_row
          where link_row.organization_id = plan_row.organization_id
            and link_row.store_id = plan_row.store_id
            and link_row.lead_id = plan_row.lead_id
            and link_row.status = 'active'
        ) <> 1
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: active lead customer link cardinality is invalid';
  end if;

  if exists (
    select 1
    from _p9_lcl_backfill_plan plan_row
    join public.customers customer_row
      on customer_row.id = plan_row.customer_id
     and customer_row.organization_id = plan_row.organization_id
    where customer_row.merged_into_customer_id is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: backfill references a merged customer';
  end if;
end;
$postconditions$;

commit;

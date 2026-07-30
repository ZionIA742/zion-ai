-- ZION / Pilar 9 / Etapa 1.1
-- Hardening estrutural exclusivo de public.leads para escopo canonico
-- organization_id + store_id.
--
-- Escopo:
-- - exige leads.store_id como NOT NULL;
-- - remove apenas a FK simples legada leads_store_id_fkey;
-- - cria/valida a FK composta leads_store_id_organization_id_fkey;
-- - preserva a FK canonica leads_organization_id_fkey;
-- - nao altera dados, RLS, policies, triggers, state ou humano_assumiu.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:leads:store-scope-hardening:v1',
    0
  )
);

do $preflight$
declare
  v_has_legacy_fk boolean;
  v_legacy_fk_is_expected boolean;
  v_has_final_fk boolean;
  v_final_fk_is_expected boolean;
  v_has_org_fk boolean;
  v_org_fk_is_expected boolean;
begin
  if pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.stores') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.leads or public.stores is missing';
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
      message = 'precondition failed: public.leads does not expose id/organization_id/store_id as expected';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'id'
      and data_type = 'uuid'
      and is_nullable = 'NO'
  )
  or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'organization_id'
      and data_type = 'uuid'
      and is_nullable = 'NO'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.stores does not expose id/organization_id as expected';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class index_relation
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_index index_row
      on index_row.indexrelid = index_relation.oid
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where index_namespace.nspname = 'public'
      and table_namespace.nspname = 'public'
      and table_relation.relname = 'stores'
      and index_relation.relkind = 'i'
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indpred is null
      and index_row.indexprs is null
      and index_row.indnatts = 2
      and index_row.indnkeyatts = 2
      and (
        select pg_catalog.array_agg(
                 attribute_row.attname::text
                 order by key_column.ordinality
               )
        from pg_catalog.unnest(
               index_row.indkey::smallint[]
             ) with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = index_row.indrelid
         and attribute_row.attnum = key_column.attnum
      ) = array['id', 'organization_id']::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.stores lacks a valid unique index on (id, organization_id)';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    where lead_row.store_id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.leads still contains rows with store_id null';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    left join public.stores store_row
      on store_row.id = lead_row.store_id
     and store_row.organization_id = lead_row.organization_id
    where store_row.id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more leads do not match stores by (store_id, organization_id)';
  end if;

  select exists (
           select 1
           from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid = 'public.leads'::pg_catalog.regclass
             and constraint_row.conname = 'leads_store_id_fkey'
         ),
         exists (
           select 1
           from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid = 'public.leads'::pg_catalog.regclass
             and constraint_row.conname = 'leads_store_id_fkey'
             and constraint_row.contype = 'f'
             and constraint_row.confrelid = 'public.stores'::pg_catalog.regclass
             and constraint_row.confdeltype = 'n'
             and constraint_row.condeferrable = false
             and constraint_row.condeferred = false
             and (
               select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
               from pg_catalog.unnest(
                      constraint_row.conkey
                    ) with ordinality as key_column(attnum, ordinality)
               join pg_catalog.pg_attribute attribute_row
                 on attribute_row.attrelid = constraint_row.conrelid
                and attribute_row.attnum = key_column.attnum
             ) = array['store_id']::text[]
             and (
               select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
               from pg_catalog.unnest(
                      constraint_row.confkey
                    ) with ordinality as key_column(attnum, ordinality)
               join pg_catalog.pg_attribute attribute_row
                 on attribute_row.attrelid = constraint_row.confrelid
                and attribute_row.attnum = key_column.attnum
             ) = array['id']::text[]
         ),
         exists (
           select 1
           from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid = 'public.leads'::pg_catalog.regclass
             and constraint_row.conname = 'leads_store_id_organization_id_fkey'
         ),
         exists (
           select 1
           from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid = 'public.leads'::pg_catalog.regclass
             and constraint_row.conname = 'leads_store_id_organization_id_fkey'
             and constraint_row.contype = 'f'
             and constraint_row.confrelid = 'public.stores'::pg_catalog.regclass
             and constraint_row.confdeltype = 'r'
             and constraint_row.condeferrable = false
             and constraint_row.condeferred = false
             and (
               select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
               from pg_catalog.unnest(
                      constraint_row.conkey
                    ) with ordinality as key_column(attnum, ordinality)
               join pg_catalog.pg_attribute attribute_row
                 on attribute_row.attrelid = constraint_row.conrelid
                and attribute_row.attnum = key_column.attnum
             ) = array['store_id', 'organization_id']::text[]
             and (
               select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
               from pg_catalog.unnest(
                      constraint_row.confkey
                    ) with ordinality as key_column(attnum, ordinality)
               join pg_catalog.pg_attribute attribute_row
                 on attribute_row.attrelid = constraint_row.confrelid
                and attribute_row.attnum = key_column.attnum
             ) = array['id', 'organization_id']::text[]
         ),
         exists (
           select 1
           from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid = 'public.leads'::pg_catalog.regclass
             and constraint_row.conname = 'leads_organization_id_fkey'
         ),
         exists (
           select 1
           from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid = 'public.leads'::pg_catalog.regclass
             and constraint_row.conname = 'leads_organization_id_fkey'
             and constraint_row.contype = 'f'
             and constraint_row.confrelid = 'public.organizations'::pg_catalog.regclass
             and (
               select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
               from pg_catalog.unnest(
                      constraint_row.conkey
                    ) with ordinality as key_column(attnum, ordinality)
               join pg_catalog.pg_attribute attribute_row
                 on attribute_row.attrelid = constraint_row.conrelid
                and attribute_row.attnum = key_column.attnum
             ) = array['organization_id']::text[]
             and (
               select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
               from pg_catalog.unnest(
                      constraint_row.confkey
                    ) with ordinality as key_column(attnum, ordinality)
               join pg_catalog.pg_attribute attribute_row
                 on attribute_row.attrelid = constraint_row.confrelid
                and attribute_row.attnum = key_column.attnum
             ) = array['id']::text[]
         )
    into
      v_has_legacy_fk,
      v_legacy_fk_is_expected,
      v_has_final_fk,
      v_final_fk_is_expected,
      v_has_org_fk,
      v_org_fk_is_expected;

  if v_has_legacy_fk and not v_legacy_fk_is_expected then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: leads_store_id_fkey exists with an unexpected definition';
  end if;

  if v_has_final_fk and not v_final_fk_is_expected then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: leads_store_id_organization_id_fkey exists with a divergent definition';
  end if;

  if not v_has_org_fk or not v_org_fk_is_expected then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: leads_organization_id_fkey is missing or divergent';
  end if;

  if not v_has_legacy_fk and not v_has_final_fk then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: neither the legacy store FK nor the final composite FK is present';
  end if;
end;
$preflight$;

do $apply$
declare
  v_has_final_fk boolean;
  v_final_validated boolean;
  v_store_not_null boolean;
  v_has_legacy_fk boolean;
begin
  select exists (
           select 1
           from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid = 'public.leads'::pg_catalog.regclass
             and constraint_row.conname = 'leads_store_id_organization_id_fkey'
         ),
         exists (
           select 1
           from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid = 'public.leads'::pg_catalog.regclass
             and constraint_row.conname = 'leads_store_id_organization_id_fkey'
             and constraint_row.convalidated
         ),
         exists (
           select 1
           from pg_catalog.pg_attribute attribute_row
           where attribute_row.attrelid = 'public.leads'::pg_catalog.regclass
             and attribute_row.attname = 'store_id'
             and attribute_row.attnotnull
         ),
         exists (
           select 1
           from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid = 'public.leads'::pg_catalog.regclass
             and constraint_row.conname = 'leads_store_id_fkey'
         )
    into
      v_has_final_fk,
      v_final_validated,
      v_store_not_null,
      v_has_legacy_fk;

  if not v_has_final_fk then
    execute $sql$
      alter table public.leads
      add constraint leads_store_id_organization_id_fkey
      foreign key (store_id, organization_id)
      references public.stores(id, organization_id)
      on delete restrict
      not valid
    $sql$;

    v_has_final_fk := true;
    v_final_validated := false;
  end if;

  if v_has_final_fk and not v_final_validated then
    execute $sql$
      alter table public.leads
      validate constraint leads_store_id_organization_id_fkey
    $sql$;
  end if;

  if not v_store_not_null then
    execute $sql$
      alter table public.leads
      alter column store_id set not null
    $sql$;
  end if;

  if v_has_legacy_fk then
    execute $sql$
      alter table public.leads
      drop constraint leads_store_id_fkey
    $sql$;
  end if;
end;
$apply$;

do $postconditions$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute_row
    where attribute_row.attrelid = 'public.leads'::pg_catalog.regclass
      and attribute_row.attname = 'store_id'
      and attribute_row.attnotnull
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.leads.store_id is still nullable';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.leads'::pg_catalog.regclass
      and constraint_row.conname = 'leads_store_id_fkey'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: legacy leads_store_id_fkey still exists';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.leads'::pg_catalog.regclass
      and constraint_row.conname = 'leads_store_id_organization_id_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.convalidated
      and constraint_row.confrelid = 'public.stores'::pg_catalog.regclass
      and constraint_row.confdeltype = 'r'
      and (
        select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(
               constraint_row.conkey
             ) with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.conrelid
         and attribute_row.attnum = key_column.attnum
      ) = array['store_id', 'organization_id']::text[]
      and (
        select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(
               constraint_row.confkey
             ) with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.confrelid
         and attribute_row.attnum = key_column.attnum
      ) = array['id', 'organization_id']::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: final composite FK is missing, invalid or divergent';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.leads'::pg_catalog.regclass
      and constraint_row.conname = 'leads_organization_id_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.organizations'::pg_catalog.regclass
      and (
        select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(
               constraint_row.conkey
             ) with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.conrelid
         and attribute_row.attnum = key_column.attnum
      ) = array['organization_id']::text[]
      and (
        select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(
               constraint_row.confkey
             ) with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.confrelid
         and attribute_row.attnum = key_column.attnum
      ) = array['id']::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: leads_organization_id_fkey was not preserved';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    where lead_row.store_id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.leads still contains rows with store_id null';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    left join public.stores store_row
      on store_row.id = lead_row.store_id
     and store_row.organization_id = lead_row.organization_id
    where store_row.id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.leads still contains rows outside the composite store scope';
  end if;
end;
$postconditions$;

commit;

-- ZION / Pilar 9 / Fase 4 / 4.1A-2
-- Correção definitiva da preservação de autoria humana em lead_customer_links.
--
-- OBJETIVO:
-- - exigir user_id para qualquer autoria humana;
-- - impedir exclusão física de auth.users referenciados no histórico;
-- - remover a exceção de SET NULL do trigger de imutabilidade;
-- - preservar integralmente dados, funções operacionais, RLS, grants e índices.
--
-- IMPORTANTE:
-- - esta migration corrige a migration já aplicada
--   20260720150000_lead_customer_links_foundation.sql;
-- - não editar nem reaplicar a migration anterior;
-- - executar este arquivo inteiro uma única vez.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';
set local search_path = pg_catalog, pg_temp;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:lead_customer_links:preserve_actor_identity',
    0
  )
);

-- --------------------------------------------------------------------------
-- Preconditions: bloqueiam reaplicação e divergência inesperada.
-- --------------------------------------------------------------------------

do $preconditions$
declare
  v_link_fk_delete_action "char";
  v_unlink_fk_delete_action "char";
  v_trigger_function_oid oid;
  v_trigger_function_definition text;
begin
  if pg_catalog.to_regclass('public.lead_customer_links') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.lead_customer_links is missing';
  end if;

  select con.confdeltype
  into v_link_fk_delete_action
  from pg_catalog.pg_constraint con
  where con.conrelid = 'public.lead_customer_links'::pg_catalog.regclass
    and con.conname = 'lead_customer_links_linked_by_user_fkey'
    and con.contype = 'f';

  if not found or v_link_fk_delete_action <> 'n' then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: linked_by_user FK is not the expected ON DELETE SET NULL version';
  end if;

  select con.confdeltype
  into v_unlink_fk_delete_action
  from pg_catalog.pg_constraint con
  where con.conrelid = 'public.lead_customer_links'::pg_catalog.regclass
    and con.conname = 'lead_customer_links_unlinked_by_user_fkey'
    and con.contype = 'f';

  if not found or v_unlink_fk_delete_action <> 'n' then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: unlinked_by_user FK is not the expected ON DELETE SET NULL version';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.lead_customer_links'::pg_catalog.regclass
      and con.conname = 'lead_customer_links_link_actor_check'
      and con.contype = 'c'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: link actor check is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.lead_customer_links'::pg_catalog.regclass
      and con.conname = 'lead_customer_links_unlink_state_check'
      and con.contype = 'c'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: unlink state check is missing';
  end if;

  if exists (
    select 1
    from public.lead_customer_links link_row
    where not (
      link_row.linked_by_actor_type in (
        'human', 'ai', 'system', 'migration'
      )
      and (
        (
          link_row.linked_by_actor_type = 'human'
          and link_row.linked_by_user_id is not null
        )
        or (
          link_row.linked_by_actor_type <> 'human'
          and link_row.linked_by_user_id is null
        )
      )
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'precondition failed: existing linked actor data violates the strict actor contract';
  end if;

  if exists (
    select 1
    from public.lead_customer_links link_row
    where not (
      (
        link_row.status = 'active'
        and link_row.unlinked_at is null
        and link_row.unlinked_by_actor_type is null
        and link_row.unlinked_by_user_id is null
        and link_row.unlink_reason_code is null
        and link_row.unlink_reason is null
      )
      or (
        link_row.status = 'inactive'
        and link_row.unlinked_at is not null
        and link_row.unlinked_by_actor_type in (
          'human', 'ai', 'system', 'migration'
        )
        and link_row.unlink_reason_code is not null
        and (
          (
            link_row.unlinked_by_actor_type = 'human'
            and link_row.unlinked_by_user_id is not null
          )
          or (
            link_row.unlinked_by_actor_type <> 'human'
            and link_row.unlinked_by_user_id is null
          )
        )
      )
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'precondition failed: existing unlink actor data violates the strict actor contract';
  end if;

  select p.oid
  into v_trigger_function_oid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'enforce_lead_customer_link_write_rules'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = '';

  if v_trigger_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: write-rules trigger function is missing';
  end if;

  v_trigger_function_definition :=
    pg_catalog.lower(
      pg_catalog.pg_get_functiondef(v_trigger_function_oid)
    );

  if pg_catalog.strpos(
       v_trigger_function_definition,
       'permite somente o set null automático'
     ) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: write-rules function is not the expected SET NULL-compatible version';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.lead_customer_links'::pg_catalog.regclass
      and t.tgname = 'lead_customer_links_enforce_write_rules'
      and t.tgfoid = v_trigger_function_oid
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: write-rules trigger binding is missing or disabled';
  end if;
end;
$preconditions$;

-- --------------------------------------------------------------------------
-- FKs: autoria humana passa a impedir exclusão física do auth.users.
-- --------------------------------------------------------------------------

alter table public.lead_customer_links
  drop constraint lead_customer_links_linked_by_user_fkey,
  drop constraint lead_customer_links_unlinked_by_user_fkey;

alter table public.lead_customer_links
  add constraint lead_customer_links_linked_by_user_fkey
    foreign key (linked_by_user_id)
    references auth.users(id)
    on delete restrict,

  add constraint lead_customer_links_unlinked_by_user_fkey
    foreign key (unlinked_by_user_id)
    references auth.users(id)
    on delete restrict;

-- --------------------------------------------------------------------------
-- CHECKs: human exige user_id; demais atores proíbem user_id.
-- --------------------------------------------------------------------------

alter table public.lead_customer_links
  drop constraint lead_customer_links_link_actor_check,
  drop constraint lead_customer_links_unlink_state_check;

alter table public.lead_customer_links
  add constraint lead_customer_links_link_actor_check
    check (
      linked_by_actor_type in (
        'human', 'ai', 'system', 'migration'
      )
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

  add constraint lead_customer_links_unlink_state_check
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
        and unlinked_by_actor_type in (
          'human', 'ai', 'system', 'migration'
        )
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
    );

-- --------------------------------------------------------------------------
-- Trigger: remove a exceção que permitia SET NULL automático de auth.users.
-- --------------------------------------------------------------------------

create or replace function public.enforce_lead_customer_link_write_rules()
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

    new.updated_at := coalesce(
      new.updated_at,
      new.created_at,
      pg_catalog.clock_timestamp()
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
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

alter function public.enforce_lead_customer_link_write_rules()
  owner to postgres;

comment on function public.enforce_lead_customer_link_write_rules() is
  'Protege histórico imutável, autoria humana preservada e transição active -> inactive de lead_customer_links.';

revoke all on function public.enforce_lead_customer_link_write_rules()
  from public, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- Postconditions independentes dentro da própria transação.
-- --------------------------------------------------------------------------

do $postconditions$
declare
  v_link_check_definition text;
  v_unlink_check_definition text;
  v_trigger_function_oid oid;
  v_trigger_function_definition text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.lead_customer_links'::pg_catalog.regclass
      and con.conname = 'lead_customer_links_linked_by_user_fkey'
      and con.contype = 'f'
      and con.confdeltype = 'r'
      and con.confrelid = 'auth.users'::pg_catalog.regclass
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: linked_by_user FK is not ON DELETE RESTRICT';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.lead_customer_links'::pg_catalog.regclass
      and con.conname = 'lead_customer_links_unlinked_by_user_fkey'
      and con.contype = 'f'
      and con.confdeltype = 'r'
      and con.confrelid = 'auth.users'::pg_catalog.regclass
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: unlinked_by_user FK is not ON DELETE RESTRICT';
  end if;

  select pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(con.oid, true)
         )
  into v_link_check_definition
  from pg_catalog.pg_constraint con
  where con.conrelid = 'public.lead_customer_links'::pg_catalog.regclass
    and con.conname = 'lead_customer_links_link_actor_check'
    and con.contype = 'c';

  if v_link_check_definition is null
     or pg_catalog.strpos(
          v_link_check_definition,
          'linked_by_actor_type = ''human''::text'
        ) = 0
     or pg_catalog.strpos(
          v_link_check_definition,
          'linked_by_user_id is not null'
        ) = 0
     or pg_catalog.strpos(
          v_link_check_definition,
          'linked_by_actor_type <> ''human''::text'
        ) = 0
     or pg_catalog.strpos(
          v_link_check_definition,
          'linked_by_user_id is null'
        ) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: strict linked actor check is not installed';
  end if;

  select pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(con.oid, true)
         )
  into v_unlink_check_definition
  from pg_catalog.pg_constraint con
  where con.conrelid = 'public.lead_customer_links'::pg_catalog.regclass
    and con.conname = 'lead_customer_links_unlink_state_check'
    and con.contype = 'c';

  if v_unlink_check_definition is null
     or pg_catalog.strpos(
          v_unlink_check_definition,
          'unlinked_by_actor_type = ''human''::text'
        ) = 0
     or pg_catalog.strpos(
          v_unlink_check_definition,
          'unlinked_by_user_id is not null'
        ) = 0
     or pg_catalog.strpos(
          v_unlink_check_definition,
          'unlinked_by_actor_type <> ''human''::text'
        ) = 0
     or pg_catalog.strpos(
          v_unlink_check_definition,
          'unlinked_by_user_id is null'
        ) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: strict unlink actor check is not installed';
  end if;

  select p.oid
  into v_trigger_function_oid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'enforce_lead_customer_link_write_rules'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
    and not p.prosecdef
    and p.proconfig =
      array['search_path=pg_catalog, pg_temp']::text[]
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres';

  if v_trigger_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: hardened trigger function contract is missing';
  end if;

  v_trigger_function_definition :=
    pg_catalog.lower(
      pg_catalog.pg_get_functiondef(v_trigger_function_oid)
    );

  if pg_catalog.strpos(
       v_trigger_function_definition,
       'permite somente o set null automático'
     ) > 0
     or pg_catalog.strpos(
          v_trigger_function_definition,
          'lead customer link core fields are immutable'
        ) = 0
     or pg_catalog.strpos(
          v_trigger_function_definition,
          'lead customer link actor mismatch'
        ) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: trigger function still permits actor identity erasure';
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       v_trigger_function_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
          'authenticated',
          v_trigger_function_oid,
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'service_role',
          v_trigger_function_oid,
          'EXECUTE'
        ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: direct trigger-function execution is not fully revoked';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.lead_customer_links'::pg_catalog.regclass
      and t.tgname = 'lead_customer_links_enforce_write_rules'
      and t.tgfoid = v_trigger_function_oid
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: trigger binding is missing or disabled';
  end if;
end;
$postconditions$;

commit;

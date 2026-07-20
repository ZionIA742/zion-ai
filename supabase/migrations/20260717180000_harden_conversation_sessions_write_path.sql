begin;

-- ============================================================================
-- ZION / Pilar 9 / Fase 4 / 4.1B-2
-- Hardening definitivo do caminho de escrita de conversation_sessions.
--
-- Objetivos:
-- 1. impedir que a RLS do chamador oculte conversation/lead/store do trigger;
-- 2. separar autorização por membership da validação de integridade;
-- 3. autorizar dentro do trigger antes de qualquer leitura privilegiada;
-- 4. impedir vazamento estrutural entre organizações;
-- 5. fechar a execução direta das funções de trigger;
-- 6. preservar dados, constraints, índices, grants e regra de negócio.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Preconditions
--
-- A migration falha antes de alterar qualquer objeto caso:
-- - a fundação esperada não exista;
-- - o hardening já tenha sido aplicado;
-- - o owner privilegiado não possua BYPASSRLS;
-- - as policies ou os triggers tenham divergido do estado diagnosticado.
-- --------------------------------------------------------------------------

do $preconditions$
declare
  v_count integer;
  v_function_oid oid;
  v_owner name;
  v_security_definer boolean;
  v_config text[];
  v_owner_bypass_rls boolean;
  v_insert_check text;
  v_update_check text;
begin
  if to_regclass('public.conversation_sessions') is null then
    raise exception
      'precondition failed: public.conversation_sessions does not exist';
  end if;

  select
    p.oid,
    pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig
  into
    v_function_oid,
    v_owner,
    v_security_definer,
    v_config
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'conversation_session_apply_write_rules'
    and pg_get_function_identity_arguments(p.oid) = ''
    and pg_get_function_result(p.oid) = 'trigger';

  if v_function_oid is null then
    raise exception
      'precondition failed: public.conversation_session_apply_write_rules() was not found';
  end if;

  if v_owner <> 'postgres' then
    raise exception
      'precondition failed: unexpected write-rules owner %',
      v_owner;
  end if;

  if v_security_definer then
    raise exception
      'precondition failed: write-rules function is already SECURITY DEFINER';
  end if;

  if v_config is not null then
    raise exception
      'precondition failed: unexpected preexisting write-rules config %',
      v_config;
  end if;

  select r.rolbypassrls
    into v_owner_bypass_rls
  from pg_roles r
  where r.rolname = v_owner;

  if coalesce(v_owner_bypass_rls, false) is not true then
    raise exception
      'precondition failed: function owner % does not have BYPASSRLS',
      v_owner;
  end if;

  select count(*)
    into v_count
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'prevent_conversation_session_organization_change'
    and pg_get_function_identity_arguments(p.oid) = ''
    and pg_get_function_result(p.oid) = 'trigger'
    and p.prosecdef is false
    and p.proconfig is null
    and pg_get_userbyid(p.proowner) = 'postgres';

  if v_count <> 1 then
    raise exception
      'precondition failed: immutability trigger function does not match the diagnosed state';
  end if;

  select count(*)
    into v_count
  from pg_trigger t
  join pg_class c
    on c.oid = t.tgrelid
  join pg_namespace n
    on n.oid = c.relnamespace
  join pg_proc p
    on p.oid = t.tgfoid
  join pg_namespace pn
    on pn.oid = p.pronamespace
  where not t.tgisinternal
    and n.nspname = 'public'
    and c.relname = 'conversation_sessions'
    and t.tgname = 'conversation_sessions_apply_write_rules'
    and t.tgenabled = 'O'
    and pn.nspname = 'public'
    and p.proname = 'conversation_session_apply_write_rules';

  if v_count <> 1 then
    raise exception
      'precondition failed: expected write-rules trigger binding was not found';
  end if;

  select count(*)
    into v_count
  from pg_trigger t
  join pg_class c
    on c.oid = t.tgrelid
  join pg_namespace n
    on n.oid = c.relnamespace
  join pg_proc p
    on p.oid = t.tgfoid
  join pg_namespace pn
    on pn.oid = p.pronamespace
  where not t.tgisinternal
    and n.nspname = 'public'
    and c.relname = 'conversation_sessions'
    and t.tgname = 'conversation_sessions_prevent_organization_change'
    and t.tgenabled = 'O'
    and pn.nspname = 'public'
    and p.proname = 'prevent_conversation_session_organization_change';

  if v_count <> 1 then
    raise exception
      'precondition failed: expected organization-immutability trigger binding was not found';
  end if;

  select p.with_check
    into v_insert_check
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'conversation_sessions'
    and p.policyname = 'conversation_sessions_insert_by_membership'
    and p.cmd = 'INSERT'
    and p.roles = array['authenticated']::name[];

  if v_insert_check is null then
    raise exception
      'precondition failed: expected authenticated INSERT policy was not found';
  end if;

  if position('conversations' in lower(v_insert_check)) = 0
     or position('leads' in lower(v_insert_check)) = 0
     or position('stores' in lower(v_insert_check)) = 0 then
    raise exception
      'precondition failed: INSERT policy no longer matches the diagnosed legacy definition';
  end if;

  select p.with_check
    into v_update_check
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'conversation_sessions'
    and p.policyname = 'conversation_sessions_update_by_membership'
    and p.cmd = 'UPDATE'
    and p.roles = array['authenticated']::name[];

  if v_update_check is null then
    raise exception
      'precondition failed: expected authenticated UPDATE policy was not found';
  end if;

  if position('conversations' in lower(v_update_check)) = 0
     or position('leads' in lower(v_update_check)) = 0
     or position('stores' in lower(v_update_check)) = 0 then
    raise exception
      'precondition failed: UPDATE policy no longer matches the diagnosed legacy definition';
  end if;

  select count(*)
    into v_count
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'memberships'
    and p.policyname = 'memberships_select_own'
    and p.cmd = 'SELECT'
    and p.roles = array['authenticated']::name[]
    and position('user_id = auth.uid()' in lower(p.qual)) > 0;

  if v_count <> 1 then
    raise exception
      'precondition failed: memberships_select_own is missing or incompatible';
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.memberships',
    'SELECT'
  ) then
    raise exception
      'precondition failed: authenticated lacks SELECT on public.memberships';
  end if;
end;
$preconditions$;

-- --------------------------------------------------------------------------
-- 2. Função principal
--
-- SECURITY DEFINER é necessário porque a função valida integridade entre
-- conversation_sessions, conversations, leads e stores.
--
-- Ordem de segurança obrigatória:
-- 1. identificar o papel efetivo da requisição;
-- 2. para authenticated, exigir auth.uid/sub e membership em NEW.organization_id;
-- 3. somente depois consultar conversation/lead/store com BYPASSRLS;
-- 4. usar erro relacional genérico para não revelar estrutura cross-org.
--
-- row_security=off faz a função falhar explicitamente se o owner perder
-- BYPASSRLS no futuro, em vez de validar sobre um conjunto parcialmente oculto.
-- --------------------------------------------------------------------------

create or replace function public.conversation_session_apply_write_rules()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();

  v_claims_text text;
  v_claims jsonb;
  v_claim_role text;
  v_claim_sub text;
  v_set_role text;
  v_request_role text;
  v_actor_user_id uuid;
  v_has_membership boolean := false;

  v_conversation_organization_id uuid;
  v_conversation_lead_id uuid;
  v_lead_organization_id uuid;
  v_lead_store_id uuid;
  v_store_organization_id uuid;
begin
  if tg_table_schema <> 'public'
     or tg_table_name <> 'conversation_sessions' then
    raise exception using
      errcode = '55000',
      message = 'conversation session trigger invoked from an unexpected relation';
  end if;

  -- Captura os claims sem depender de funções externas ao search_path seguro.
  v_claim_role :=
    nullif(
      pg_catalog.current_setting(
        'request.jwt.claim.role',
        true
      ),
      ''
    );

  v_claim_sub :=
    nullif(
      pg_catalog.current_setting(
        'request.jwt.claim.sub',
        true
      ),
      ''
    );

  v_claims_text :=
    nullif(
      pg_catalog.current_setting(
        'request.jwt.claims',
        true
      ),
      ''
    );

  if v_claims_text is not null then
    begin
      v_claims := v_claims_text::jsonb;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '42501',
          message = 'conversation session write is not authorized';
    end;

    v_claim_role :=
      coalesce(
        v_claim_role,
        nullif(v_claims ->> 'role', '')
      );

    v_claim_sub :=
      coalesce(
        v_claim_sub,
        nullif(v_claims ->> 'sub', '')
      );
  end if;

  -- Em conexões SQL controladas, SET ROLE pode existir sem claims.
  -- A claim verificada tem prioridade; a configuração role é apenas fallback.
  v_set_role :=
    nullif(
      pg_catalog.current_setting('role', true),
      ''
    );

  v_request_role :=
    coalesce(
      v_claim_role,
      case
        when v_set_role in (
          'authenticated',
          'service_role',
          'anon'
        ) then v_set_role
        else null
      end
    );

  if v_request_role = 'authenticated' then
    if v_claim_sub is null then
      raise exception using
        errcode = '42501',
        message = 'conversation session write is not authorized';
    end if;

    begin
      v_actor_user_id := v_claim_sub::uuid;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '42501',
          message = 'conversation session write is not authorized';
    end;

    select exists (
      select 1
      from public.memberships m
      where m.organization_id = new.organization_id
        and m.user_id = v_actor_user_id
    )
    into v_has_membership;

    if not v_has_membership then
      raise exception using
        errcode = '42501',
        message = 'conversation session write is not authorized';
    end if;

  elsif v_request_role = 'service_role' then
    null;

  elsif v_request_role = 'anon' then
    raise exception using
      errcode = '42501',
      message = 'conversation session write is not authorized';

  elsif v_request_role is null
        and session_user = 'postgres' then
    -- Caminho administrativo direto, sem JWT e sem SET ROLE de API.
    null;

  else
    raise exception using
      errcode = '42501',
      message = 'conversation session write is not authorized';
  end if;

  -- Impede que UPDATE tente trocar de organização antes das leituras
  -- privilegiadas. O trigger dedicado de imutabilidade permanece como
  -- segunda barreira independente.
  if tg_op = 'UPDATE'
     and new.organization_id is distinct from old.organization_id then
    raise exception
      'organization_id is immutable after insert for %',
      tg_table_name;
  end if;

  select
    c.organization_id,
    c.lead_id,
    l.organization_id,
    l.store_id,
    s.organization_id
  into
    v_conversation_organization_id,
    v_conversation_lead_id,
    v_lead_organization_id,
    v_lead_store_id,
    v_store_organization_id
  from public.conversations c
  left join public.leads l
    on l.id = c.lead_id
  left join public.stores s
    on s.id = l.store_id
  where c.id = new.conversation_id;

  if not found
     or v_conversation_lead_id is null
     or v_lead_organization_id is null
     or v_lead_store_id is null
     or v_store_organization_id is null
     or v_conversation_organization_id
          is distinct from v_lead_organization_id
     or v_lead_organization_id
          is distinct from v_store_organization_id
     or new.organization_id
          is distinct from v_conversation_organization_id
     or new.store_id
          is distinct from v_lead_store_id then
    raise exception using
      errcode = '23514',
      message = 'conversation session relation mismatch';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := v_now;

    if old.status = 'closed'
       and new.status is distinct from old.status then
      raise exception
        'closed session cannot be reopened for %',
        tg_table_name;
    end if;

    if new.status is distinct from old.status then
      if old.status = 'active'
         and new.status = 'closed' then
        new.closed_at := v_now;
      end if;
    else
      if new.closed_at is distinct from old.closed_at then
        raise exception
          'closed_at can only change when status changes for %',
          tg_table_name;
      end if;

      if new.status = 'active' then
        new.closed_at := null;
      else
        new.closed_at := old.closed_at;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

alter function public.conversation_session_apply_write_rules()
  owner to postgres;

comment on function public.conversation_session_apply_write_rules() is
  'Trigger SECURITY DEFINER que autoriza o ator antes de validar a integridade conversation -> lead -> store de conversation_sessions. Usa erro relacional genérico e não depende da visibilidade RLS do chamador.';

revoke all
  on function public.conversation_session_apply_write_rules()
  from public;

revoke all
  on function public.conversation_session_apply_write_rules()
  from anon;

revoke all
  on function public.conversation_session_apply_write_rules()
  from authenticated;

revoke all
  on function public.conversation_session_apply_write_rules()
  from service_role;

-- --------------------------------------------------------------------------
-- 3. Função de imutabilidade
--
-- Continua SECURITY INVOKER porque não consulta tabelas protegidas.
-- Recebe apenas hardening de search_path e ACL.
-- --------------------------------------------------------------------------

create or replace function public.prevent_conversation_session_organization_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception
      'organization_id is immutable after insert for %',
      tg_table_name;
  end if;

  return new;
end;
$function$;

alter function public.prevent_conversation_session_organization_change()
  owner to postgres;

comment on function public.prevent_conversation_session_organization_change() is
  'Trigger SECURITY INVOKER que impede alteração de organization_id após a criação da conversation_session.';

revoke all
  on function public.prevent_conversation_session_organization_change()
  from public;

revoke all
  on function public.prevent_conversation_session_organization_change()
  from anon;

revoke all
  on function public.prevent_conversation_session_organization_change()
  from authenticated;

revoke all
  on function public.prevent_conversation_session_organization_change()
  from service_role;

-- --------------------------------------------------------------------------
-- 4. Policies de escrita
--
-- As policies autorizam por membership.
-- FKs, constraints e triggers validam integridade.
-- A checagem de membership também existe dentro do trigger privilegiado
-- porque BEFORE ROW triggers executam antes do WITH CHECK.
-- --------------------------------------------------------------------------

drop policy conversation_sessions_insert_by_membership
  on public.conversation_sessions;

create policy conversation_sessions_insert_by_membership
on public.conversation_sessions
as permissive
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.organization_id =
          conversation_sessions.organization_id
      and m.user_id = auth.uid()
  )
);

drop policy conversation_sessions_update_by_membership
  on public.conversation_sessions;

create policy conversation_sessions_update_by_membership
on public.conversation_sessions
as permissive
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.organization_id =
          conversation_sessions.organization_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.organization_id =
          conversation_sessions.organization_id
      and m.user_id = auth.uid()
  )
);

comment on policy conversation_sessions_insert_by_membership
  on public.conversation_sessions is
  'Autoriza INSERT quando auth.uid() possui membership na organization_id da sessão. A integridade é validada por FKs e pelo trigger endurecido.';

comment on policy conversation_sessions_update_by_membership
  on public.conversation_sessions is
  'Autoriza UPDATE quando auth.uid() possui membership na organization_id da sessão. A integridade é validada por FKs e pelos triggers endurecidos.';

-- --------------------------------------------------------------------------
-- 5. Postconditions
--
-- Qualquer divergência provoca exceção e desfaz toda a migration.
-- --------------------------------------------------------------------------

do $postconditions$
declare
  v_function_oid oid;
  v_immutability_function_oid oid;
  v_owner name;
  v_security_definer boolean;
  v_config text[];
  v_owner_bypass_rls boolean;
  v_count integer;
  v_insert_check text;
  v_update_using text;
  v_update_check text;
  v_function_definition text;
begin
  select
    p.oid,
    pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    pg_get_functiondef(p.oid)
  into
    v_function_oid,
    v_owner,
    v_security_definer,
    v_config,
    v_function_definition
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'conversation_session_apply_write_rules'
    and pg_get_function_identity_arguments(p.oid) = '';

  if v_function_oid is null then
    raise exception
      'postcondition failed: write-rules function not found';
  end if;

  if v_owner <> 'postgres' then
    raise exception
      'postcondition failed: unexpected write-rules owner %',
      v_owner;
  end if;

  if not v_security_definer then
    raise exception
      'postcondition failed: write-rules function is not SECURITY DEFINER';
  end if;

  if v_config is null
     or pg_catalog.array_length(v_config, 1) <> 2
     or not (
       v_config @> array[
         'search_path=pg_catalog, pg_temp',
         'row_security=off'
       ]::text[]
     ) then
    raise exception
      'postcondition failed: unexpected write-rules config %',
      v_config;
  end if;

  select r.rolbypassrls
    into v_owner_bypass_rls
  from pg_roles r
  where r.rolname = v_owner;

  if coalesce(v_owner_bypass_rls, false) is not true then
    raise exception
      'postcondition failed: write-rules owner lost BYPASSRLS';
  end if;

  if position(
       'conversation session write is not authorized'
       in lower(v_function_definition)
     ) = 0
     or position(
       'conversation session relation mismatch'
       in lower(v_function_definition)
     ) = 0
     or position(
       'from public.memberships'
       in lower(v_function_definition)
     ) = 0 then
    raise exception
      'postcondition failed: write-rules authorization hardening is incomplete';
  end if;

  if has_function_privilege(
       'anon',
       v_function_oid,
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       v_function_oid,
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       v_function_oid,
       'EXECUTE'
     ) then
    raise exception
      'postcondition failed: direct EXECUTE remains granted on write-rules function';
  end if;

  select
    p.oid,
    pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig
  into
    v_immutability_function_oid,
    v_owner,
    v_security_definer,
    v_config
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname =
        'prevent_conversation_session_organization_change'
    and pg_get_function_identity_arguments(p.oid) = '';

  if v_immutability_function_oid is null then
    raise exception
      'postcondition failed: organization-immutability function not found';
  end if;

  if v_owner <> 'postgres' then
    raise exception
      'postcondition failed: unexpected immutability owner %',
      v_owner;
  end if;

  if v_security_definer then
    raise exception
      'postcondition failed: immutability function must remain SECURITY INVOKER';
  end if;

  if v_config is distinct from
       array['search_path=pg_catalog, pg_temp']::text[] then
    raise exception
      'postcondition failed: unexpected immutability function config %',
      v_config;
  end if;

  if has_function_privilege(
       'anon',
       v_immutability_function_oid,
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       v_immutability_function_oid,
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       v_immutability_function_oid,
       'EXECUTE'
     ) then
    raise exception
      'postcondition failed: direct EXECUTE remains granted on immutability function';
  end if;

  select
    p.with_check
  into
    v_insert_check
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'conversation_sessions'
    and p.policyname = 'conversation_sessions_insert_by_membership'
    and p.cmd = 'INSERT'
    and p.roles = array['authenticated']::name[];

  if v_insert_check is null
     or position('memberships' in lower(v_insert_check)) = 0
     or position('auth.uid()' in lower(v_insert_check)) = 0
     or position('conversations' in lower(v_insert_check)) > 0
     or position('leads' in lower(v_insert_check)) > 0
     or position('stores' in lower(v_insert_check)) > 0
     or position('current_org_id' in lower(v_insert_check)) > 0 then
    raise exception
      'postcondition failed: INSERT policy is not membership-only';
  end if;

  select
    p.qual,
    p.with_check
  into
    v_update_using,
    v_update_check
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'conversation_sessions'
    and p.policyname = 'conversation_sessions_update_by_membership'
    and p.cmd = 'UPDATE'
    and p.roles = array['authenticated']::name[];

  if v_update_using is null
     or v_update_check is null
     or position('memberships' in lower(v_update_using)) = 0
     or position('auth.uid()' in lower(v_update_using)) = 0
     or position('memberships' in lower(v_update_check)) = 0
     or position('auth.uid()' in lower(v_update_check)) = 0
     or position('conversations' in lower(v_update_using)) > 0
     or position('conversations' in lower(v_update_check)) > 0
     or position('leads' in lower(v_update_using)) > 0
     or position('leads' in lower(v_update_check)) > 0
     or position('stores' in lower(v_update_using)) > 0
     or position('stores' in lower(v_update_check)) > 0
     or position('current_org_id' in lower(v_update_using)) > 0
     or position('current_org_id' in lower(v_update_check)) > 0 then
    raise exception
      'postcondition failed: UPDATE policy is not membership-only';
  end if;

  select count(*)
    into v_count
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'conversation_sessions'
    and p.policyname = 'conversation_sessions_select_by_membership'
    and p.cmd = 'SELECT'
    and p.roles = array['authenticated']::name[];

  if v_count <> 1 then
    raise exception
      'postcondition failed: SELECT policy changed or disappeared';
  end if;

  select count(*)
    into v_count
  from pg_trigger t
  join pg_class c
    on c.oid = t.tgrelid
  join pg_namespace n
    on n.oid = c.relnamespace
  join pg_proc p
    on p.oid = t.tgfoid
  join pg_namespace pn
    on pn.oid = p.pronamespace
  where not t.tgisinternal
    and n.nspname = 'public'
    and c.relname = 'conversation_sessions'
    and t.tgname = 'conversation_sessions_apply_write_rules'
    and t.tgenabled = 'O'
    and pn.nspname = 'public'
    and p.proname = 'conversation_session_apply_write_rules';

  if v_count <> 1 then
    raise exception
      'postcondition failed: write-rules trigger binding changed or disabled';
  end if;

  select count(*)
    into v_count
  from pg_trigger t
  join pg_class c
    on c.oid = t.tgrelid
  join pg_namespace n
    on n.oid = c.relnamespace
  join pg_proc p
    on p.oid = t.tgfoid
  join pg_namespace pn
    on pn.oid = p.pronamespace
  where not t.tgisinternal
    and n.nspname = 'public'
    and c.relname = 'conversation_sessions'
    and t.tgname =
        'conversation_sessions_prevent_organization_change'
    and t.tgenabled = 'O'
    and pn.nspname = 'public'
    and p.proname =
        'prevent_conversation_session_organization_change';

  if v_count <> 1 then
    raise exception
      'postcondition failed: organization-immutability trigger binding changed or disabled';
  end if;
end;
$postconditions$;

commit;

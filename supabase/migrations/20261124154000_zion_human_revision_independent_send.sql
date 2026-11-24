begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $preflight$
begin
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.assert_human_quote_revision_send_safe_internal(uuid,uuid,uuid,timestamptz,uuid)'::regprocedure
      and p.proowner = 'postgres'::regrole
      and p.prosecdef is false
      and md5(btrim(replace(p.prosrc, chr(13), ''), E' \t\n')) = '4ea77e717ff1e099c6c4d4f4b18b8a00'
  ) then
    raise exception 'AG9Q_PRE_BODY_MISMATCH: public.assert_human_quote_revision_send_safe_internal(uuid,uuid,uuid,timestamptz,uuid)';
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.enforce_sales_quote_version_external_send_linearization()'::regprocedure
      and p.proowner = 'postgres'::regrole
      and p.prosecdef is true
      and md5(btrim(replace(p.prosrc, chr(13), ''), E' \t\n')) = '66c17dff861146fa0ba88c0328562fa4'
  ) then
    raise exception 'AG9Q_PRE_BODY_MISMATCH: public.enforce_sales_quote_version_external_send_linearization()';
  end if;
  if not exists (
    select 1 from pg_proc p where p.oid =
      'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)'::regprocedure
      and md5(replace(p.prosrc, chr(13), '')) = '96e75838f79a4eff297e732fd1843d05'
  ) then
    raise exception 'AG9Q_GATE_DEPENDENCY_CHANGED';
  end if;
  if to_regclass('public.human_quote_revision_prior_send_evidence') is null
     or to_regprocedure('public.capture_prior_quote_send_authority_internal(uuid,uuid,uuid,uuid)') is null then
    raise exception 'AG9Q_CAPTURE_DEPENDENCY_MISSING';
  end if;
end;
$preflight$;

create or replace function public.assert_human_quote_revision_send_safe_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_quote_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_current_version_id uuid
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_quote public.sales_quotes%rowtype;
  v_version public.sales_quote_versions%rowtype;
begin

  if p_organization_id is null
     or p_store_id is null
     or p_quote_id is null
     or p_expected_updated_at is null
     or p_expected_current_version_id is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_HUMAN_REVISION_ARGUMENTS_REQUIRED';
  end if;

  -- Compartilha o bloqueio utilizado pelas autoridades
  -- existentes de materializacao e finalizacao de envio.
  select q.*
  into v_quote
  from public.sales_quotes q
  where q.id = p_quote_id
    and q.organization_id = p_organization_id
    and q.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'ZION_HUMAN_REVISION_QUOTE_NOT_FOUND';
  end if;

  -- Procedencia humana obrigatoria.
  if v_quote.metadata ->> 'created_via'
       is distinct from 'api_sales_quotes_create'
     or v_quote.metadata ->> 'creation_actor_kind'
       is distinct from 'user'
     or jsonb_typeof(
       v_quote.metadata -> 'creation_actor_user_id'
     ) is distinct from 'string'
     or coalesce(
       btrim(v_quote.metadata ->> 'creation_actor_user_id'),
       ''
     ) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    raise exception using
      errcode = '42501',
      message = 'ZION_HUMAN_REVISION_PROVENANCE_REQUIRED';
  end if;

  -- Concorrencia otimista sob bloqueio.
  if v_quote.updated_at
       is distinct from p_expected_updated_at
     or v_quote.current_version_id
       is distinct from p_expected_current_version_id then
    raise exception using
      errcode = '40001',
      message = 'ZION_HUMAN_REVISION_STALE';
  end if;

  -- Confirma a identidade exata da versao anterior.
  select v.*
  into v_version
  from public.sales_quote_versions v
  where v.id = p_expected_current_version_id
    and v.quote_id = p_quote_id
    and v.organization_id = p_organization_id
    and v.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_HUMAN_REVISION_VERSION_SCOPE_INVALID';
  end if;

  -- A edicao humana independe do estado do transporte.
  -- A autorizacao anterior e preservada pelo trigger de versao.
  -- Sem escritas ou efeitos comerciais.
  -- O bloqueio permanece ate o fim da transacao chamadora.
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_sales_quote_version_external_send_linearization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp', 'public'
 SET row_security TO 'off'
AS $function$
declare
  v_quote public.sales_quotes%rowtype;
  v_blocking_message_id uuid;
begin
  if new.generated_by = 'human_revision'
     and new.status is distinct from 'generated' then
    raise exception using
      errcode = '23514',
      message = 'ZION_HUMAN_REVISION_VERSION_STATUS_INVALID';
  end if;

  if pg_catalog.lower(pg_catalog.btrim(coalesce(new.status, ''))) <> 'generated' then
    return new;
  end if;

  select quote_row.*
    into v_quote
    from public.sales_quotes quote_row
   where quote_row.id = new.quote_id
     and quote_row.organization_id = new.organization_id
     and quote_row.store_id = new.store_id
   for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_SALES_QUOTE_VERSION_QUOTE_NOT_FOUND';
  end if;

  -- Caminho exclusivo do futuro writer de revisao humana.
  -- O marcador nao pode ser fornecido pela interface.
  if new.generated_by = 'human_revision' then

    if coalesce(
         nullif(
           pg_catalog.current_setting(
             'request.jwt.claim.role', true
           ),
           ''
         ),
         nullif(auth.jwt() ->> 'role', '')
       ) is distinct from 'service_role'
       and session_user <> 'postgres' then

      raise exception using
        errcode = '42501',
        message = 'ZION_HUMAN_REVISION_VERSION_FORBIDDEN';
    end if;

    if v_quote.current_version_id is null then
      raise exception using
        errcode = '23514',
        message = 'ZION_HUMAN_REVISION_PREVIOUS_VERSION_REQUIRED';
    end if;

    if new.sent_at is not null
       or new.approved_at is not null then
      raise exception using
        errcode = '23514',
        message = 'ZION_HUMAN_REVISION_NEW_VERSION_ALREADY_PROCESSED';
    end if;

    -- Revalida procedencia e escopo da revisao.
    -- O writer tambem devera validar as precondicoes
    -- fornecidas pelo usuario antes de qualquer alteracao.
    perform public.assert_human_quote_revision_send_safe_internal(
      new.organization_id,
      new.store_id,
      new.quote_id,
      v_quote.updated_at,
      v_quote.current_version_id
    );

    -- Captura a autoridade antes de substituir a versao atual.
    -- Ausencia de envio elegivel nao impede a revisao.
    perform public.capture_prior_quote_send_authority_internal(
      new.organization_id,
      new.store_id,
      new.quote_id,
      v_quote.current_version_id
    );

    return new;

  end if;

  if v_quote.current_version_id is null then
    return new;
  end if;

  select message_row.id
    into v_blocking_message_id
    from public.messages message_row
   where message_row.organization_id = new.organization_id
     and message_row.store_id = new.store_id
     and message_row.deleted_at is null
     and coalesce(message_row.metadata ->> 'outbound_origin', '') = 'sales_quote_send'
     and coalesce(message_row.metadata ->> 'source', '') = 'sales_quote_send_route'
     and coalesce(message_row.metadata ->> 'sales_quote_id', '') = new.quote_id::text
     and coalesce(message_row.metadata ->> 'sales_quote_version_id', '') =
           v_quote.current_version_id::text
     and (
       coalesce(message_row.outbound_delivery_state, '') in (
         'processing',
         'uncertain',
         'sent'
       )
       or message_row.outbound_attempt_started_at is not null
       or message_row.outbound_provider_accepted_at is not null
       or message_row.external_message_id is not null
     )
   order by message_row.created_at desc, message_row.id desc
   limit 1;

  if v_blocking_message_id is not null then
    raise exception using
      errcode = '23514',
      message =
        'ZION_SALES_QUOTE_VERSION_EXTERNAL_SEND_IN_FLIGHT_OR_REQUIRES_RECONCILIATION';
  end if;

  return new;
end;
$function$;

do $postflight$
begin
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.assert_human_quote_revision_send_safe_internal(uuid,uuid,uuid,timestamptz,uuid)'::regprocedure
      and p.proowner = 'postgres'::regrole
      and p.prosecdef is false
      and md5(btrim(replace(p.prosrc, chr(13), ''), E' \t\n')) = '10a5662dcc4eb173633afd1131b85394'
  ) then
    raise exception 'AG9Q_POST_BODY_MISMATCH: public.assert_human_quote_revision_send_safe_internal(uuid,uuid,uuid,timestamptz,uuid)';
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.enforce_sales_quote_version_external_send_linearization()'::regprocedure
      and p.proowner = 'postgres'::regrole
      and p.prosecdef is true
      and md5(btrim(replace(p.prosrc, chr(13), ''), E' \t\n')) = 'f47b4f2c0a45695d3975d080a5a351ab'
  ) then
    raise exception 'AG9Q_POST_BODY_MISMATCH: public.enforce_sales_quote_version_external_send_linearization()';
  end if;
end;
$postflight$;

commit;

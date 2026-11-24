begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $preflight$
declare
  v_original text;
begin

  select p.prosrc
    into v_original
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.enforce_sales_quote_version_external_send_linearization()'
   )
     and p.prosecdef is true
     and p.proowner = 'postgres'::regrole;

  if v_original is null then
    raise exception 'ZION_VERSION_GUARD_ORIGINAL_MISSING';
  end if;

  if btrim(
       regexp_replace(
         v_original,
         '[[:space:]]+',
         ' ',
         'g'
       )
     ) is distinct from btrim(
       regexp_replace(
         $legacy$
declare
  v_quote public.sales_quotes%rowtype;
  v_blocking_message_id uuid;
begin
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
$legacy$,
         '[[:space:]]+',
         ' ',
         'g'
       )
     ) then
    raise exception 'ZION_VERSION_GUARD_ORIGINAL_CHANGED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid =
      'public.sales_quote_versions'::regclass
      and t.tgname =
        'trg_sales_quote_version_external_send_linearization'
      and t.tgenabled = 'O'
      and t.tgfoid = pg_catalog.to_regprocedure(
        'public.enforce_sales_quote_version_external_send_linearization()'
      )
  ) then
    raise exception 'ZION_VERSION_GUARD_TRIGGER_INVALID';
  end if;

  if pg_catalog.to_regprocedure(
    'public.assert_human_quote_revision_send_safe_internal(uuid,uuid,uuid,timestamptz,uuid)'
  ) is null then
    raise exception 'ZION_HUMAN_REVISION_SEND_GUARD_MISSING';
  end if;

end;
$preflight$;

create or replace function
  public.enforce_sales_quote_version_external_send_linearization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
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

    -- Revalida procedencia, escopo e todos os envios.
    -- O writer tambem devera validar as precondicoes
    -- fornecidas pelo usuario antes de qualquer alteracao.
    perform public.assert_human_quote_revision_send_safe_internal(
      new.organization_id,
      new.store_id,
      new.quote_id,
      v_quote.updated_at,
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

commit;

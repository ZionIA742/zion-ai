begin;

create function public.assert_human_quote_revision_send_safe_internal(
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
  v_blocking_message_id uuid;
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

  -- Verifica envios relacionados ao orcamento inteiro.
  -- Nao ignora mensagens excluidas logicamente.
  -- Nao considera uma tentativa como envio finalizado.
  select m.id
  into v_blocking_message_id
  from public.messages m
  where m.organization_id = p_organization_id
    and m.store_id = p_store_id
    and (
      (
        m.metadata ->> 'sales_quote_id' = p_quote_id::text
        and (
          m.metadata ->> 'outbound_origin' = 'sales_quote_send'
          or m.metadata ->> 'source' = 'sales_quote_send_route'
        )
      )
      or (
        split_part(m.outbound_idempotency_key, ':', 1)
          = 'sales_quote_send'
        and split_part(m.outbound_idempotency_key, ':', 2)
          = p_organization_id::text
        and split_part(m.outbound_idempotency_key, ':', 3)
          = p_store_id::text
        and split_part(m.outbound_idempotency_key, ':', 5)
          = p_quote_id::text
      )
    )
    and not (
      m.outbound_delivery_state is not distinct from 'sent'
      and m.outbound_provider_accepted_at is not null
      and nullif(btrim(m.external_message_id), '') is not null
      and m.outbound_commercial_finalized_at is not null
      and exists (
        select 1
        from public.sales_quote_versions sent_version
        where sent_version.quote_id = p_quote_id
          and sent_version.organization_id = p_organization_id
          and sent_version.store_id = p_store_id
          and sent_version.id::text =
            m.metadata ->> 'sales_quote_version_id'
          and sent_version.sent_at is not null
          and sent_version.status in ('sent', 'superseded')
      )
    )
  order by m.created_at, m.id
  limit 1;

  if v_blocking_message_id is not null then
    raise exception using
      errcode = '23514',
      message = 'ZION_HUMAN_REVISION_SEND_NOT_FINALIZED';
  end if;

  -- Sem escritas ou efeitos comerciais.
  -- O bloqueio permanece ate o fim da transacao chamadora.
end;
$function$;

alter function public.assert_human_quote_revision_send_safe_internal(
  uuid, uuid, uuid, timestamptz, uuid
) owner to postgres;

revoke all on function
  public.assert_human_quote_revision_send_safe_internal(
    uuid, uuid, uuid, timestamptz, uuid
  )
from public, anon, authenticated, service_role;

comment on function
  public.assert_human_quote_revision_send_safe_internal(
    uuid, uuid, uuid, timestamptz, uuid
  )
is
  'Internal transactional guard for human quote revisions. Preserves historical send evidence and rejects unresolved outbound operations.';

commit;

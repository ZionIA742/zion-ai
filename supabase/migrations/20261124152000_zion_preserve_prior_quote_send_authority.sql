begin;

create table public.human_quote_revision_prior_send_evidence (
  message_id uuid primary key,
  organization_id uuid not null,
  store_id uuid not null,
  conversation_id uuid not null,
  commercial_opportunity_id uuid not null,
  quote_id uuid not null,
  version_id uuid not null,
  outbound_idempotency_key text not null,
  storage_bucket text not null,
  storage_path text not null,
  approved_at timestamptz not null,
  approved_by text not null,
  valid_until date,
  captured_at timestamptz not null
    default clock_timestamp()
);

alter table
  public.human_quote_revision_prior_send_evidence
  owner to postgres;

alter table
  public.human_quote_revision_prior_send_evidence
  enable row level security;

revoke all on table
  public.human_quote_revision_prior_send_evidence
  from public, anon, authenticated, service_role;

create function public.capture_prior_quote_send_authority_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_quote_id uuid,
  p_previous_version_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_quote public.sales_quotes%rowtype;
  v_version public.sales_quote_versions%rowtype;
  v_file public.store_files%rowtype;

  v_key text;
  v_bucket text;
  v_path text;
  v_valid_until date;
  v_count integer := 0;

begin

  -- Captura somente a autoridade que ja existia.
  -- Ausencia de aprovacao nao impede a edicao.
  select q.*
  into v_quote
  from public.sales_quotes q
  where q.id = p_quote_id
    and q.organization_id = p_organization_id
    and q.store_id = p_store_id
  for update;

  if not found then
    return 0;
  end if;

  if v_quote.current_version_id
       is distinct from p_previous_version_id
     or v_quote.status is distinct from 'approved'
     or v_quote.approved_at is null
     or v_quote.approved_by is null
     or v_quote.sent_at is not null
     or v_quote.conversation_id is null
     or v_quote.commercial_opportunity_id is null
  then
    return 0;
  end if;

  select v.*
  into v_version
  from public.sales_quote_versions v
  where v.id = p_previous_version_id
    and v.quote_id = p_quote_id
    and v.organization_id = p_organization_id
    and v.store_id = p_store_id
  for update;

  if not found then
    return 0;
  end if;

  if v_version.status is distinct from 'approved'
     or v_version.sent_at is not null
  then
    return 0;
  end if;

  -- Mesma resolucao de arquivo utilizada
  -- pela materializacao canonica do envio.
  if v_version.store_file_id is not null then

    select f.*
    into v_file
    from public.store_files f
    where f.id = v_version.store_file_id
      and f.organization_id = p_organization_id
      and f.store_id = p_store_id;

    if not found then
      return 0;
    end if;

  end if;

  v_bucket := nullif(
    btrim(coalesce(
      v_file.storage_bucket,
      v_version.storage_bucket
    )),
    ''
  );

  v_path := nullif(
    btrim(coalesce(
      v_file.storage_path,
      v_version.storage_path
    )),
    ''
  );

  if v_bucket is null or v_path is null then
    return 0;
  end if;

  v_valid_until :=
    public.resolve_sales_quote_version_valid_until(
      v_version.quote_snapshot,
      v_quote.valid_until
    );

  v_key :=
    'sales_quote_send:'
    || p_organization_id::text || ':'
    || p_store_id::text || ':'
    || v_quote.commercial_opportunity_id::text || ':'
    || p_quote_id::text || ':'
    || p_previous_version_id::text;

  -- Registra apenas mensagens canonicas existentes.
  -- Nao cria mensagens e nao inicia envios.
  -- Nao bloqueia nem modifica a fila do WhatsApp.
  insert into
    public.human_quote_revision_prior_send_evidence (
      message_id,
      organization_id,
      store_id,
      conversation_id,
      commercial_opportunity_id,
      quote_id,
      version_id,
      outbound_idempotency_key,
      storage_bucket,
      storage_path,
      approved_at,
      approved_by,
      valid_until
    )
  select
    m.id,
    p_organization_id,
    p_store_id,
    v_quote.conversation_id,
    v_quote.commercial_opportunity_id,
    p_quote_id,
    p_previous_version_id,
    v_key,
    v_bucket,
    v_path,
    v_quote.approved_at,
    v_quote.approved_by::text,
    v_valid_until
  from public.messages m
  where m.organization_id = p_organization_id
    and m.store_id = p_store_id
    and m.conversation_id = v_quote.conversation_id
    and m.outbound_idempotency_key = v_key

    and m.metadata ->> 'outbound_idempotency_key' = v_key
    and m.metadata ->> 'outbound_origin' = 'sales_quote_send'
    and m.metadata ->> 'source' = 'sales_quote_send_route'
    and m.metadata ->> 'sales_quote_id' = p_quote_id::text
    and m.metadata ->> 'sales_quote_version_id' =
      p_previous_version_id::text
    and m.metadata ->> 'commercial_opportunity_id' =
      v_quote.commercial_opportunity_id::text

    and m.sender = 'human'
    and m.direction = 'outgoing'
    and m.message_type = 'document'
    and m.deleted_at is null

    and m.metadata ->> 'send_external' = 'true'
    and m.metadata ->> 'external_channel' = 'whatsapp'
    and m.metadata ->> 'storage_bucket' = v_bucket
    and m.metadata ->> 'storage_path' = v_path
    and m.media_url = v_path

    and m.external_message_id is null
    and m.outbound_commercial_finalized_at is null

    -- Fluxos especializados permanecem independentes.
    and not (
      m.metadata ? 'commercial_negotiation_concession_id'
      or m.metadata ?
        'commercial_negotiation_concession_materialization_id'
    )

  on conflict (message_id) do nothing;

  get diagnostics v_count = row_count;

  return v_count;

end;
$function$;

alter function
  public.capture_prior_quote_send_authority_internal(
    uuid, uuid, uuid, uuid
  )
owner to postgres;

revoke all on function
  public.capture_prior_quote_send_authority_internal(
    uuid, uuid, uuid, uuid
  )
from public, anon, authenticated, service_role;

comment on function
  public.capture_prior_quote_send_authority_internal(
    uuid, uuid, uuid, uuid
  )
is
  'Preserves existing send authority before a human quote revision. Does not grant new approval or initiate external transport.';

commit;

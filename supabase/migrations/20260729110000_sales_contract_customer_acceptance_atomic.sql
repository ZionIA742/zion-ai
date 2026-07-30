begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, public, pg_temp;

do $$
declare
  v_column_type text;
  v_constraint_def text;
  v_index_def text;
begin
  select cols.data_type
  into v_column_type
  from information_schema.columns cols
  where cols.table_schema = 'public'
    and cols.table_name = 'sales_contract_signatures'
    and cols.column_name = 'trigger_message_id';

  if v_column_type is not null and v_column_type <> 'uuid' then
    raise exception using
      errcode = 'ZCA00',
      message = 'INCOMPATIBLE_TRIGGER_MESSAGE_ID_COLUMN',
      detail = format(
        'public.sales_contract_signatures.trigger_message_id already exists as %s, expected uuid.',
        v_column_type
      );
  end if;

  select pg_catalog.pg_get_constraintdef(con.oid, true)
  into v_constraint_def
  from pg_catalog.pg_constraint con
  where con.conname = 'sales_contract_signatures_trigger_message_id_fkey'
    and con.conrelid = 'public.sales_contract_signatures'::pg_catalog.regclass;

  if v_constraint_def is not null
     and v_constraint_def <> 'FOREIGN KEY (trigger_message_id) REFERENCES messages(id) ON DELETE RESTRICT' then
    raise exception using
      errcode = 'ZCA01',
      message = 'INCOMPATIBLE_TRIGGER_MESSAGE_ID_FK',
      detail = format(
        'Constraint sales_contract_signatures_trigger_message_id_fkey already exists with incompatible definition: %s',
        v_constraint_def
      );
  end if;

  select pg_catalog.pg_get_indexdef(idx.indexrelid)
  into v_index_def
  from pg_catalog.pg_index idx
  where idx.indexrelid = 'public.sales_contract_signatures_trigger_message_id_uidx'::pg_catalog.regclass;

  if v_index_def is not null
     and v_index_def <> 'CREATE UNIQUE INDEX sales_contract_signatures_trigger_message_id_uidx ON public.sales_contract_signatures USING btree (trigger_message_id) WHERE (trigger_message_id IS NOT NULL)' then
    raise exception using
      errcode = 'ZCA02',
      message = 'INCOMPATIBLE_TRIGGER_MESSAGE_ID_INDEX',
      detail = format(
        'Index sales_contract_signatures_trigger_message_id_uidx already exists with incompatible definition: %s',
        v_index_def
      );
  end if;
exception
  when undefined_table then
    null;
end;
$$;

alter table public.sales_contract_signatures
  add column if not exists trigger_message_id uuid null;

do $preconditions$
begin
  if exists (
    select 1
    from public.sales_contract_signatures sig
    where coalesce(sig.metadata, '{}'::jsonb) ? 'trigger_message_id'
      and nullif(btrim(coalesce(sig.metadata ->> 'trigger_message_id', '')), '') is not null
      and lower(btrim(sig.metadata ->> 'trigger_message_id')) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception using
      errcode = 'ZCA10',
      message = 'INVALID_TRIGGER_MESSAGE_ID_TEXT',
      detail = 'sales_contract_signatures.metadata.trigger_message_id contains a non-UUID textual value.';
  end if;

  if exists (
    select 1
    from public.sales_contract_signatures sig
    where sig.trigger_message_id is not null
      and not exists (
        select 1
        from public.messages msg
        where msg.id = sig.trigger_message_id
      )
  ) then
    raise exception using
      errcode = 'ZCA18',
      message = 'TRIGGER_MESSAGE_ID_COLUMN_NOT_FOUND',
      detail = 'sales_contract_signatures.trigger_message_id references a message that does not exist.';
  end if;

  if exists (
    select 1
    from public.sales_contract_signatures sig
    where sig.trigger_message_id is not null
    group by sig.trigger_message_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = 'ZCA19',
      message = 'DUPLICATE_TRIGGER_MESSAGE_ID_COLUMN',
      detail = 'sales_contract_signatures.trigger_message_id contains duplicate non-null values.';
  end if;

  if exists (
    select 1
    from public.sales_contract_signatures sig
    join public.messages msg
      on msg.id = sig.trigger_message_id
    where sig.trigger_message_id is not null
      and (
        msg.organization_id is distinct from sig.organization_id
        or msg.store_id is distinct from sig.store_id
      )
  ) then
    raise exception using
      errcode = 'ZCA20',
      message = 'TRIGGER_MESSAGE_ID_COLUMN_SCOPE_MISMATCH',
      detail = 'A trigger_message_id column value points to a message outside the signature organization/store scope.';
  end if;

  if exists (
    select 1
    from public.sales_contract_signatures sig
    left join public.messages msg
      on msg.id = (btrim(sig.metadata ->> 'trigger_message_id'))::uuid
    where coalesce(sig.metadata, '{}'::jsonb) ? 'trigger_message_id'
      and nullif(btrim(coalesce(sig.metadata ->> 'trigger_message_id', '')), '') is not null
      and msg.id is null
  ) then
    raise exception using
      errcode = 'ZCA11',
      message = 'TRIGGER_MESSAGE_ID_NOT_FOUND',
      detail = 'sales_contract_signatures.metadata.trigger_message_id references a message that does not exist.';
  end if;

  if exists (
    select 1
    from (
      select (btrim(sig.metadata ->> 'trigger_message_id'))::uuid as trigger_message_id
      from public.sales_contract_signatures sig
      where coalesce(sig.metadata, '{}'::jsonb) ? 'trigger_message_id'
        and nullif(btrim(coalesce(sig.metadata ->> 'trigger_message_id', '')), '') is not null
      group by 1
      having count(*) > 1
    ) dup
  ) then
    raise exception using
      errcode = 'ZCA12',
      message = 'DUPLICATE_TRIGGER_MESSAGE_ID',
      detail = 'The same trigger_message_id appears in more than one sales_contract_signatures row.';
  end if;

  if exists (
    select 1
    from public.sales_contract_signatures sig
    where sig.trigger_message_id is not null
      and coalesce(sig.metadata, '{}'::jsonb) ? 'trigger_message_id'
      and nullif(btrim(coalesce(sig.metadata ->> 'trigger_message_id', '')), '') is not null
      and sig.trigger_message_id is distinct from (btrim(sig.metadata ->> 'trigger_message_id'))::uuid
  ) then
    raise exception using
      errcode = 'ZCA21',
      message = 'TRIGGER_MESSAGE_ID_MISMATCH',
      detail = 'trigger_message_id column and metadata.trigger_message_id diverge in preexisting data.';
  end if;

  if exists (
    select 1
    from (
      select
        coalesce(
          sig.trigger_message_id,
          case
            when coalesce(sig.metadata, '{}'::jsonb) ? 'trigger_message_id'
             and nullif(btrim(coalesce(sig.metadata ->> 'trigger_message_id', '')), '') is not null
            then (btrim(sig.metadata ->> 'trigger_message_id'))::uuid
            else null
          end
        ) as effective_trigger_message_id
      from public.sales_contract_signatures sig
    ) effective_ids
    where effective_ids.effective_trigger_message_id is not null
    group by effective_ids.effective_trigger_message_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = 'ZCA27',
      message = 'DUPLICATE_TRIGGER_MESSAGE_ID_EFFECTIVE',
      detail = 'The effective trigger_message_id is duplicated across preexisting sales_contract_signatures rows.';
  end if;

  if exists (
    select 1
    from public.sales_contract_signatures sig
    join public.messages msg
      on msg.id = (btrim(sig.metadata ->> 'trigger_message_id'))::uuid
    where coalesce(sig.metadata, '{}'::jsonb) ? 'trigger_message_id'
      and nullif(btrim(coalesce(sig.metadata ->> 'trigger_message_id', '')), '') is not null
      and (
        msg.organization_id is distinct from sig.organization_id
        or msg.store_id is distinct from sig.store_id
      )
  ) then
    raise exception using
      errcode = 'ZCA13',
      message = 'TRIGGER_MESSAGE_ID_SCOPE_MISMATCH',
      detail = 'A trigger_message_id points to a message outside the signature organization/store scope.';
  end if;

  if exists (
    select 1
    from public.sales_contract_signatures sig
    join public.sales_contract_versions ver
      on ver.id = sig.contract_version_id
    where sig.contract_version_id is not null
      and ver.contract_id is distinct from sig.contract_id
  ) then
    raise exception using
      errcode = 'ZCA14',
      message = 'SIGNATURE_VERSION_CONTRACT_MISMATCH',
      detail = 'A sales_contract_signatures row references a contract_version_id owned by another contract.';
  end if;

  if exists (
    select 1
    from public.sales_contract_signatures sig
    join public.sales_contracts con
      on con.id = sig.contract_id
    where sig.organization_id is distinct from con.organization_id
       or sig.store_id is distinct from con.store_id
  ) then
    raise exception using
      errcode = 'ZCA15',
      message = 'SIGNATURE_CONTRACT_SCOPE_MISMATCH',
      detail = 'A sales_contract_signatures row diverges from its contract organization/store scope.';
  end if;

  if exists (
    select 1
    from public.sales_contracts con
    left join public.sales_contract_versions ver
      on ver.id = con.current_version_id
    where con.current_version_id is not null
      and (
        ver.id is null
        or ver.contract_id is distinct from con.id
      )
  ) then
    raise exception using
      errcode = 'ZCA16',
      message = 'INVALID_CURRENT_CONTRACT_VERSION',
      detail = 'sales_contracts.current_version_id does not belong to its own contract.';
  end if;

  if exists (
    select 1
    from public.sales_contracts con
    join public.sales_contract_versions ver
      on ver.id = con.current_version_id
    where con.current_version_id is not null
      and (
        ver.organization_id is distinct from con.organization_id
        or ver.store_id is distinct from con.store_id
      )
  ) then
    raise exception using
      errcode = 'ZCA17',
      message = 'CURRENT_VERSION_SCOPE_MISMATCH',
      detail = 'The current contract version diverges from its contract organization/store scope.';
  end if;
end;
$preconditions$;

update public.sales_contract_signatures sig
set trigger_message_id = (btrim(sig.metadata ->> 'trigger_message_id'))::uuid
where sig.trigger_message_id is null
  and coalesce(sig.metadata, '{}'::jsonb) ? 'trigger_message_id'
  and nullif(btrim(coalesce(sig.metadata ->> 'trigger_message_id', '')), '') is not null;

create or replace function public.private_sales_contract_conversation_lock_key(
  p_conversation_id uuid
)
returns bigint
language sql
immutable
strict
set search_path = public, pg_temp
as $function$
  select
      (get_byte(pg_catalog.uuid_send(p_conversation_id), 0)::bigint << 56)
    | (get_byte(pg_catalog.uuid_send(p_conversation_id), 1)::bigint << 48)
    | (get_byte(pg_catalog.uuid_send(p_conversation_id), 2)::bigint << 40)
    | (get_byte(pg_catalog.uuid_send(p_conversation_id), 3)::bigint << 32)
    | (get_byte(pg_catalog.uuid_send(p_conversation_id), 4)::bigint << 24)
    | (get_byte(pg_catalog.uuid_send(p_conversation_id), 5)::bigint << 16)
    | (get_byte(pg_catalog.uuid_send(p_conversation_id), 6)::bigint << 8)
    | get_byte(pg_catalog.uuid_send(p_conversation_id), 7)::bigint;
$function$;

alter function public.private_sales_contract_conversation_lock_key(uuid) owner to postgres;
revoke all on function public.private_sales_contract_conversation_lock_key(uuid) from public, anon, authenticated, service_role;
grant execute on function public.private_sales_contract_conversation_lock_key(uuid) to postgres;

create or replace function public.private_acquire_sales_contract_conversation_xact_lock(
  p_conversation_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_key bigint;
begin
  if p_conversation_id is null then
    raise exception using
      errcode = 'ZCA22',
      message = 'CONVERSATION_ID_REQUIRED',
      detail = 'p_conversation_id must not be null.';
  end if;

  v_key := public.private_sales_contract_conversation_lock_key(p_conversation_id);
  perform pg_catalog.pg_advisory_xact_lock(v_key);
  return v_key;
end;
$function$;

alter function public.private_acquire_sales_contract_conversation_xact_lock(uuid) owner to postgres;
revoke all on function public.private_acquire_sales_contract_conversation_xact_lock(uuid) from public, anon, authenticated, service_role;
grant execute on function public.private_acquire_sales_contract_conversation_xact_lock(uuid) to postgres;

create or replace function public.private_sales_contract_anchor_effective_content(
  p_message public.messages
)
returns text
language sql
stable
set search_path = public, pg_temp
as $function$
  select coalesce(
    nullif(
      case
        when lower(trim(coalesce(p_message.message_type, ''))) = 'audio'
          then btrim(coalesce(p_message.metadata ->> 'audio_transcript', ''))
        when lower(trim(coalesce(p_message.message_type, ''))) = 'image'
          and lower(trim(coalesce(p_message.metadata ->> 'media_purpose', ''))) = 'customer_location_photo'
          then btrim(coalesce(p_message.metadata #>> '{location_photo_analysis,summary}', ''))
        else ''
      end,
      ''
    ),
    btrim(coalesce(p_message.content, ''))
  );
$function$;

alter function public.private_sales_contract_anchor_effective_content(public.messages) owner to postgres;
revoke all on function public.private_sales_contract_anchor_effective_content(public.messages) from public, anon, authenticated, service_role;
grant execute on function public.private_sales_contract_anchor_effective_content(public.messages) to postgres;

create or replace function public.sync_sales_contract_signature_trigger_message_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_metadata jsonb := coalesce(new.metadata, '{}'::jsonb);
  v_metadata_text text;
  v_metadata_uuid uuid;
begin
  if jsonb_typeof(v_metadata) is distinct from 'object' then
    raise exception using
      errcode = 'ZCA23',
      message = 'SIGNATURE_METADATA_OBJECT_REQUIRED',
      detail = 'sales_contract_signatures.metadata must remain a JSON object.';
  end if;

  if v_metadata ? 'trigger_message_id' then
    v_metadata_text := nullif(btrim(coalesce(v_metadata ->> 'trigger_message_id', '')), '');

    if v_metadata_text is null then
      raise exception using
        errcode = 'ZCA24',
        message = 'EMPTY_TRIGGER_MESSAGE_ID_TEXT',
        detail = 'metadata.trigger_message_id cannot be blank when present.';
    end if;

    if lower(v_metadata_text) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using
        errcode = 'ZCA25',
        message = 'INVALID_TRIGGER_MESSAGE_ID_TEXT',
        detail = 'metadata.trigger_message_id must be a valid UUID textual value.';
    end if;

    v_metadata_uuid := v_metadata_text::uuid;
  end if;

  if new.trigger_message_id is null and v_metadata_uuid is not null then
    new.trigger_message_id := v_metadata_uuid;
  elsif new.trigger_message_id is not null and v_metadata_uuid is null then
    v_metadata := jsonb_set(
      v_metadata,
      '{trigger_message_id}',
      to_jsonb(new.trigger_message_id::text),
      true
    );
  elsif new.trigger_message_id is not null and v_metadata_uuid is not null and new.trigger_message_id <> v_metadata_uuid then
    raise exception using
      errcode = 'ZCA26',
      message = 'TRIGGER_MESSAGE_ID_MISMATCH',
      detail = 'trigger_message_id column and metadata.trigger_message_id must match.';
  end if;

  new.metadata := v_metadata;
  return new;
end;
$function$;

alter function public.sync_sales_contract_signature_trigger_message_id() owner to postgres;
revoke all on function public.sync_sales_contract_signature_trigger_message_id() from public, anon, authenticated, service_role;
grant execute on function public.sync_sales_contract_signature_trigger_message_id() to postgres;

update public.sales_contract_signatures sig
set metadata = jsonb_set(
  coalesce(sig.metadata, '{}'::jsonb),
  '{trigger_message_id}',
  to_jsonb(sig.trigger_message_id::text),
  true
)
where sig.trigger_message_id is not null
  and (
    not (coalesce(sig.metadata, '{}'::jsonb) ? 'trigger_message_id')
    or btrim(coalesce(sig.metadata ->> 'trigger_message_id', '')) <> sig.trigger_message_id::text
  );

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint con
    where con.conname = 'sales_contract_signatures_trigger_message_id_fkey'
      and con.conrelid = 'public.sales_contract_signatures'::pg_catalog.regclass
  ) then
    alter table public.sales_contract_signatures
      add constraint sales_contract_signatures_trigger_message_id_fkey
      foreign key (trigger_message_id)
      references public.messages(id)
      on delete restrict;
  end if;
end;
$$;

create unique index if not exists sales_contract_signatures_trigger_message_id_uidx
  on public.sales_contract_signatures (trigger_message_id)
  where trigger_message_id is not null;

drop trigger if exists trg_sync_sales_contract_signature_trigger_message_id on public.sales_contract_signatures;

create trigger trg_sync_sales_contract_signature_trigger_message_id
before insert or update of metadata, trigger_message_id
on public.sales_contract_signatures
for each row
execute function public.sync_sales_contract_signature_trigger_message_id();

create or replace function public.insert_message(
  p_conversation_id uuid,
  p_sender text,
  p_direction text,
  p_message_type text,
  p_content text,
  p_external_message_id text default null,
  p_media_url text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.messages
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_org_id uuid;
  v_lead_id uuid;
  v_store_id uuid;
  v_row public.messages;
  v_content text;
  v_sender text;
  v_direction text;
  v_message_type text;
begin
  perform set_config('app.insert_via_function', 'true', true);

  v_sender := lower(trim(p_sender));
  v_direction := lower(trim(p_direction));
  v_message_type := lower(trim(p_message_type));
  v_content := nullif(btrim(p_content), '');

  select
    c.organization_id,
    c.lead_id
  into
    v_org_id,
    v_lead_id
  from public.conversations c
  where c.id = p_conversation_id;

  if v_org_id is null then
    raise exception 'conversation_not_found: %', p_conversation_id;
  end if;

  if v_lead_id is null then
    raise exception 'conversation_without_lead: %', p_conversation_id;
  end if;

  select l.store_id
  into v_store_id
  from public.leads l
  where l.id = v_lead_id;

  if not found then
    raise exception 'lead_not_found_for_conversation: %, lead_id=%', p_conversation_id, v_lead_id;
  end if;

  if v_store_id is null then
    raise exception 'lead_without_store: %, lead_id=%', p_conversation_id, v_lead_id;
  end if;

  if v_sender not in ('user', 'ai', 'human') then
    raise exception 'invalid_sender: %', p_sender;
  end if;

  if v_direction not in ('incoming', 'outgoing') then
    raise exception 'invalid_direction: %', p_direction;
  end if;

  if v_message_type not in ('text', 'image', 'audio', 'video', 'document') then
    raise exception 'invalid_message_type: %', p_message_type;
  end if;

  if v_message_type = 'text' and v_content is null then
    raise exception 'text_message_requires_content';
  end if;

  if v_message_type = 'text' and p_media_url is not null then
    raise exception 'text_message_cannot_have_media_url';
  end if;

  if v_message_type in ('image', 'audio', 'video', 'document') and p_media_url is null then
    raise exception 'media_message_requires_media_url: %', v_message_type;
  end if;

  if v_message_type in ('image', 'audio', 'video', 'document') and v_content is null then
    raise exception 'media_message_requires_content: %', v_message_type;
  end if;

  perform public.private_acquire_sales_contract_conversation_xact_lock(p_conversation_id);

  perform public.ensure_commercial_conversation_session_context(
    v_org_id,
    v_store_id,
    p_conversation_id
  );

  insert into public.messages (
    organization_id,
    conversation_id,
    sender,
    direction,
    message_type,
    content,
    external_message_id,
    media_url,
    metadata,
    lead_id,
    store_id
  )
  values (
    v_org_id,
    p_conversation_id,
    v_sender,
    v_direction,
    v_message_type,
    v_content,
    p_external_message_id,
    p_media_url,
    coalesce(p_metadata, '{}'::jsonb),
    v_lead_id,
    v_store_id
  )
  returning * into v_row;

  return v_row;
end;
$function$;

alter function public.insert_message(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) owner to postgres;

create or replace function public.sign_sales_contract_as_customer_atomic(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_contract_id uuid,
  p_expected_contract_version_id uuid,
  p_expected_anchor_message_id uuid default null,
  p_signer_name text default null,
  p_signer_phone text default null,
  p_signer_email text default null,
  p_acceptance_text text default null,
  p_ip_address text default null,
  p_user_agent text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_contract public.sales_contracts%rowtype;
  v_version public.sales_contract_versions%rowtype;
  v_signature public.sales_contract_signatures%rowtype;
  v_existing_signature public.sales_contract_signatures%rowtype;
  v_anchor_signature public.sales_contract_signatures%rowtype;
  v_anchor_message public.messages%rowtype;
  v_stored_anchor_message public.messages%rowtype;
  v_anchor_effective_content text;
  v_contract_status text;
  v_version_status text;
  v_input_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_signature_metadata jsonb;
  v_signed_at timestamptz := pg_catalog.clock_timestamp();
  v_outcome text;
  v_replayed boolean := false;
  v_reconciled boolean := false;
  v_customer_signed_at timestamptz;
begin
  if p_organization_id is null then
    raise exception using errcode = 'ZCB00', message = 'ORGANIZATION_ID_REQUIRED';
  end if;
  if p_store_id is null then
    raise exception using errcode = 'ZCB01', message = 'STORE_ID_REQUIRED';
  end if;
  if p_conversation_id is null then
    raise exception using errcode = 'ZCB02', message = 'CONVERSATION_ID_REQUIRED';
  end if;
  if p_contract_id is null then
    raise exception using errcode = 'ZCB03', message = 'CONTRACT_ID_REQUIRED';
  end if;
  if p_expected_contract_version_id is null then
    raise exception using errcode = 'ZCB04', message = 'EXPECTED_CONTRACT_VERSION_ID_REQUIRED';
  end if;
  if jsonb_typeof(v_input_metadata) is distinct from 'object' then
    raise exception using errcode = 'ZCB05', message = 'METADATA_OBJECT_REQUIRED';
  end if;

  perform public.private_acquire_sales_contract_conversation_xact_lock(p_conversation_id);

  select *
  into v_contract
  from public.sales_contracts con
  where con.id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = 'ZCB06', message = 'CONTRACT_NOT_FOUND';
  end if;

  if v_contract.organization_id is distinct from p_organization_id
     or v_contract.store_id is distinct from p_store_id then
    raise exception using errcode = 'ZCB07', message = 'CONTRACT_SCOPE_MISMATCH';
  end if;

  if v_contract.conversation_id is distinct from p_conversation_id then
    raise exception using errcode = 'ZCB08', message = 'CONTRACT_CONVERSATION_MISMATCH';
  end if;

  if v_contract.current_version_id is null then
    raise exception using errcode = 'ZCB09', message = 'CONTRACT_CURRENT_VERSION_REQUIRED';
  end if;

  if v_contract.current_version_id is distinct from p_expected_contract_version_id then
    raise exception using errcode = 'ZCB10', message = 'EXPECTED_VERSION_MISMATCH';
  end if;

  select *
  into v_version
  from public.sales_contract_versions ver
  where ver.id = p_expected_contract_version_id
  for update;

  if not found then
    raise exception using errcode = 'ZCB11', message = 'CONTRACT_VERSION_NOT_FOUND';
  end if;

  if v_version.contract_id is distinct from v_contract.id then
    raise exception using errcode = 'ZCB12', message = 'VERSION_CONTRACT_MISMATCH';
  end if;

  if v_version.organization_id is distinct from p_organization_id
     or v_version.store_id is distinct from p_store_id then
    raise exception using errcode = 'ZCB13', message = 'VERSION_SCOPE_MISMATCH';
  end if;

  v_contract_status := lower(trim(coalesce(v_contract.status, '')));
  v_version_status := lower(trim(coalesce(v_version.status, '')));

  if v_version_status in ('superseded', 'failed') then
    raise exception using errcode = 'ZCB14', message = 'VERSION_NOT_SIGNABLE';
  end if;

  select *
  into v_existing_signature
  from public.sales_contract_signatures sig
  where sig.contract_id = v_contract.id
    and sig.contract_version_id = v_version.id
    and lower(trim(coalesce(sig.signer_type, ''))) = 'customer'
  for update;

  if found then
    if v_existing_signature.organization_id is distinct from p_organization_id
       or v_existing_signature.store_id is distinct from p_store_id then
      raise exception using errcode = 'ZCB21', message = 'EXISTING_SIGNATURE_SCOPE_MISMATCH';
    end if;

    if lower(trim(coalesce(v_existing_signature.status, ''))) <> 'signed' then
      raise exception using errcode = 'ZCB29', message = 'EXISTING_SIGNATURE_NOT_SIGNED';
    end if;

    if p_expected_anchor_message_id is not null then
      if v_existing_signature.trigger_message_id is null then
        raise exception using errcode = 'ZCB30', message = 'EXISTING_SIGNATURE_MISSING_ANCHOR';
      end if;

      if v_existing_signature.trigger_message_id is distinct from p_expected_anchor_message_id then
        raise exception using errcode = 'ZCB22', message = 'EXISTING_SIGNATURE_ANCHOR_CONFLICT';
      end if;
    end if;

    if v_existing_signature.trigger_message_id is not null then
      select *
      into v_stored_anchor_message
      from public.messages msg
      where msg.id = v_existing_signature.trigger_message_id;

      if not found then
        raise exception using errcode = 'ZCB31', message = 'EXISTING_SIGNATURE_ANCHOR_NOT_FOUND';
      end if;

      if v_stored_anchor_message.organization_id is distinct from p_organization_id
         or v_stored_anchor_message.store_id is distinct from p_store_id
         or v_stored_anchor_message.conversation_id is distinct from p_conversation_id then
        raise exception using errcode = 'ZCB32', message = 'EXISTING_SIGNATURE_ANCHOR_SCOPE_MISMATCH';
      end if;
    end if;

    v_replayed := true;

    if v_contract_status = 'sent_to_customer' or v_version_status = 'sent' then
      v_reconciled := true;
      v_outcome := 'reconciled_partial_state';
      v_customer_signed_at := coalesce(v_existing_signature.signed_at, v_signed_at);

      if v_contract_status = 'sent_to_customer' then
        update public.sales_contracts con
        set status = 'customer_signed',
            customer_signed_at = coalesce(con.customer_signed_at, v_customer_signed_at)
        where con.id = v_contract.id
        returning * into v_contract;
      elsif v_contract_status not in ('customer_signed', 'store_signed', 'completed') then
        raise exception using errcode = 'ZCB23', message = 'CONTRACT_STATE_CONFLICT';
      end if;

      if v_version_status = 'sent' then
        update public.sales_contract_versions ver
        set status = 'customer_signed'
        where ver.id = v_version.id
        returning * into v_version;
      elsif v_version_status not in ('customer_signed', 'store_signed', 'completed') then
        raise exception using errcode = 'ZCB24', message = 'VERSION_STATE_CONFLICT';
      end if;
    else
      if v_contract_status not in ('customer_signed', 'store_signed', 'completed') then
        raise exception using errcode = 'ZCB25', message = 'CONTRACT_NOT_REPLAYABLE';
      end if;

      if v_version_status not in ('customer_signed', 'store_signed', 'completed') then
        raise exception using errcode = 'ZCB26', message = 'VERSION_NOT_REPLAYABLE';
      end if;

      v_outcome := 'already_applied';
    end if;

    v_signature := v_existing_signature;
  else
    if v_contract_status <> 'sent_to_customer' then
      raise exception using errcode = 'ZCB27', message = 'CONTRACT_NOT_SENT_TO_CUSTOMER';
    end if;

    if v_version_status <> 'sent' then
      raise exception using errcode = 'ZCB28', message = 'VERSION_NOT_SENT';
    end if;

    if p_expected_anchor_message_id is not null then
      select *
      into v_anchor_message
      from public.messages msg
      where msg.id = p_expected_anchor_message_id;

      if not found then
        raise exception using errcode = 'ZCB15', message = 'ANCHOR_MESSAGE_NOT_FOUND';
      end if;

      if v_anchor_message.organization_id is distinct from p_organization_id
         or v_anchor_message.store_id is distinct from p_store_id
         or v_anchor_message.conversation_id is distinct from p_conversation_id then
        raise exception using errcode = 'ZCB16', message = 'ANCHOR_MESSAGE_SCOPE_MISMATCH';
      end if;

      v_anchor_effective_content := public.private_sales_contract_anchor_effective_content(v_anchor_message);

      if lower(trim(coalesce(v_anchor_message.sender, ''))) <> 'user'
         or lower(trim(coalesce(v_anchor_message.direction, ''))) <> 'incoming'
         or v_anchor_effective_content = '' then
        raise exception using errcode = 'ZCB17', message = 'ANCHOR_MESSAGE_NOT_ELIGIBLE';
      end if;

      if exists (
        select 1
        from public.messages newer
        where newer.organization_id = p_organization_id
          and newer.store_id = p_store_id
          and newer.conversation_id = p_conversation_id
          and lower(trim(coalesce(newer.sender, ''))) = 'user'
          and lower(trim(coalesce(newer.direction, ''))) = 'incoming'
          and public.private_sales_contract_anchor_effective_content(newer) <> ''
          and newer.created_at > v_anchor_message.created_at
      ) then
        raise exception using errcode = 'ZCB18', message = 'ANCHOR_MESSAGE_NOT_LATEST';
      end if;

      if exists (
        select 1
        from public.messages tied
        where tied.organization_id = p_organization_id
          and tied.store_id = p_store_id
          and tied.conversation_id = p_conversation_id
          and tied.id <> v_anchor_message.id
          and lower(trim(coalesce(tied.sender, ''))) = 'user'
          and lower(trim(coalesce(tied.direction, ''))) = 'incoming'
          and public.private_sales_contract_anchor_effective_content(tied) <> ''
          and tied.created_at = v_anchor_message.created_at
      ) then
        raise exception using errcode = 'ZCB19', message = 'ANCHOR_MESSAGE_ORDER_AMBIGUOUS';
      end if;

      select *
      into v_anchor_signature
      from public.sales_contract_signatures sig
      where sig.trigger_message_id = p_expected_anchor_message_id
      for update;

      if found
         and (
           v_anchor_signature.contract_id is distinct from v_contract.id
           or v_anchor_signature.contract_version_id is distinct from v_version.id
           or lower(trim(coalesce(v_anchor_signature.signer_type, ''))) <> 'customer'
         ) then
        raise exception using errcode = 'ZCB20', message = 'TRIGGER_MESSAGE_ALREADY_USED';
      end if;
    end if;

    v_signature_metadata := (v_input_metadata - 'trigger_message_id' - 'accepted_via')
      || jsonb_build_object(
        'accepted_via',
        case
          when p_expected_anchor_message_id is not null then 'conversation_text'
          else 'manual_direct'
        end
      );

    if p_expected_anchor_message_id is not null then
      v_signature_metadata := v_signature_metadata
        || jsonb_build_object('trigger_message_id', p_expected_anchor_message_id::text);
    end if;

    insert into public.sales_contract_signatures (
      contract_id,
      contract_version_id,
      organization_id,
      store_id,
      signer_type,
      signer_name,
      signer_phone,
      signer_email,
      status,
      signed_at,
      ip_address,
      user_agent,
      acceptance_text,
      metadata,
      trigger_message_id
    )
    values (
      v_contract.id,
      v_version.id,
      p_organization_id,
      p_store_id,
      'customer',
      nullif(btrim(p_signer_name), ''),
      nullif(btrim(p_signer_phone), ''),
      nullif(btrim(p_signer_email), ''),
      'signed',
      v_signed_at,
      nullif(btrim(p_ip_address), ''),
      nullif(btrim(p_user_agent), ''),
      nullif(btrim(p_acceptance_text), ''),
      v_signature_metadata,
      p_expected_anchor_message_id
    )
    returning * into v_signature;

    update public.sales_contracts con
    set status = 'customer_signed',
        customer_signed_at = coalesce(con.customer_signed_at, v_signed_at)
    where con.id = v_contract.id
    returning * into v_contract;

    update public.sales_contract_versions ver
    set status = 'customer_signed'
    where ver.id = v_version.id
    returning * into v_version;

    v_outcome := 'signed';
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'replayed', v_replayed,
    'reconciled', v_reconciled,
    'contract_id', v_contract.id,
    'contract_version_id', v_version.id,
    'signature_id', v_signature.id,
    'trigger_message_id', v_signature.trigger_message_id,
    'contract_status', v_contract.status,
    'version_status', v_version.status,
    'signed_at', v_signature.signed_at
  );
end;
$function$;

alter function public.sign_sales_contract_as_customer_atomic(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) owner to postgres;

revoke all on function public.sign_sales_contract_as_customer_atomic(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.sign_sales_contract_as_customer_atomic(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) to service_role, postgres;

revoke all on table public.sales_contracts from anon, authenticated;
revoke all on table public.sales_contract_versions from anon, authenticated;
revoke all on table public.sales_contract_signatures from anon, authenticated;

do $postconditions$
declare
  v_constraint_def text;
  v_index_def text;
begin
  select pg_catalog.pg_get_constraintdef(con.oid, true)
  into v_constraint_def
  from pg_catalog.pg_constraint con
  where con.conname = 'sales_contract_signatures_trigger_message_id_fkey'
    and con.conrelid = 'public.sales_contract_signatures'::pg_catalog.regclass;

  if v_constraint_def is distinct from 'FOREIGN KEY (trigger_message_id) REFERENCES messages(id) ON DELETE RESTRICT' then
    raise exception using
      errcode = 'ZCA30',
      message = 'POSTCONDITION_TRIGGER_MESSAGE_ID_FK_MISSING';
  end if;

  select pg_catalog.pg_get_indexdef(idx.indexrelid)
  into v_index_def
  from pg_catalog.pg_index idx
  where idx.indexrelid = 'public.sales_contract_signatures_trigger_message_id_uidx'::pg_catalog.regclass;

  if v_index_def is distinct from 'CREATE UNIQUE INDEX sales_contract_signatures_trigger_message_id_uidx ON public.sales_contract_signatures USING btree (trigger_message_id) WHERE (trigger_message_id IS NOT NULL)' then
    raise exception using
      errcode = 'ZCA31',
      message = 'POSTCONDITION_TRIGGER_MESSAGE_ID_INDEX_MISSING';
  end if;
end;
$postconditions$;

commit;

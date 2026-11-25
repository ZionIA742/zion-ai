begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create table public.conversation_human_response_commitments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  conversation_id uuid not null,
  conversation_session_id uuid null,
  source_message_id uuid not null,
  responsible_user_id uuid not null references auth.users(id) on delete restrict,
  due_at timestamptz not null,
  status text not null default 'active',
  revision integer not null default 1,
  operation_key text not null,
  last_operation_key text not null,
  source_kind text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fulfilled_at timestamptz null,
  cancelled_at timestamptz null,
  expired_at timestamptz null,

  constraint human_response_commitments_scope_fkey
    foreign key (conversation_id, organization_id)
    references public.conversations(id, organization_id) on delete restrict,
  constraint human_response_commitments_store_org_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id) on delete restrict,
  constraint human_response_commitments_session_scope_fkey
    foreign key (conversation_session_id, organization_id, store_id)
    references public.conversation_sessions(id, organization_id, store_id) on delete restrict,
  constraint human_response_commitments_message_scope_fkey
    foreign key (source_message_id, organization_id, store_id)
    references public.messages(id, organization_id, store_id) on delete restrict,
  constraint human_response_commitments_status_check
    check (status in ('active', 'fulfilled', 'cancelled', 'expired')),
  constraint human_response_commitments_source_kind_check
    check (source_kind in ('panel', 'whatsapp_human')),
  constraint human_response_commitments_due_check
    check (due_at > created_at),
  constraint human_response_commitments_revision_check
    check (revision > 0)
);

create unique index conversation_human_response_commitments_create_key_uidx
  on public.conversation_human_response_commitments (organization_id, operation_key);
create index conversation_human_response_commitments_active_idx
  on public.conversation_human_response_commitments (organization_id, store_id, conversation_id, due_at)
  where status = 'active';
create unique index conversation_human_response_commitments_one_active_uidx
  on public.conversation_human_response_commitments (organization_id, store_id, conversation_id)
  where status = 'active';

alter table public.conversation_human_response_commitments enable row level security;

revoke all on table public.conversation_human_response_commitments from public, anon, authenticated, service_role;
grant select on table public.conversation_human_response_commitments to service_role;

create or replace function public.record_human_response_commitment_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_conversation_session_id uuid,
  p_source_message_id uuid,
  p_responsible_user_id uuid,
  p_due_at timestamptz,
  p_operation_key text,
  p_source_kind text,
  p_explicit_confirmation boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public, auth, extensions
as $$
declare
  v_request_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_message record;
  v_metadata jsonb;
  v_existing public.conversation_human_response_commitments;
  v_id uuid;
begin
  if not (v_request_role = 'service_role' or session_user = 'postgres') then
    raise exception using errcode = '42501', message = 'human_response_commitment_service_only';
  end if;
  if not coalesce(p_explicit_confirmation, false) then
    raise exception using errcode = '22023', message = 'human_response_commitment_explicit_confirmation_required';
  end if;
  if p_source_kind not in ('panel', 'whatsapp_human') then
    raise exception using errcode = '22023', message = 'human_response_commitment_source_kind_invalid';
  end if;
  if p_due_at <= clock_timestamp() then
    raise exception using errcode = '22023', message = 'human_response_commitment_due_at_must_be_future';
  end if;
  if nullif(btrim(p_operation_key), '') is null then
    raise exception using errcode = '22023', message = 'human_response_commitment_operation_key_required';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.organization_id = p_organization_id and m.user_id = p_responsible_user_id
  ) then
    raise exception using errcode = '42501', message = 'human_response_commitment_responsible_user_out_of_scope';
  end if;

  select m.id, m.organization_id, m.store_id, m.conversation_id, m.conversation_session_id,
         m.sender, m.direction, m.message_type, m.metadata
    into v_message
  from public.messages m
  where m.id = p_source_message_id
    and m.organization_id = p_organization_id
    and m.store_id = p_store_id
    and m.conversation_id = p_conversation_id
    and m.deleted_at is null;
  if not found or v_message.sender <> 'human' or v_message.direction <> 'outgoing' then
    raise exception using errcode = '23514', message = 'human_response_commitment_source_message_not_verified';
  end if;
  v_metadata := coalesce(v_message.metadata, '{}'::jsonb);
  if p_source_kind = 'panel' then
    if v_metadata->>'source' <> 'panel'
       or v_metadata->>'sent_by_user_id' is distinct from p_responsible_user_id::text then
      raise exception using errcode = '23514', message = 'human_response_commitment_panel_actor_not_verified';
    end if;
  elsif v_metadata->>'source' <> 'meta_whatsapp_webhook'
        or v_metadata->>'channel' <> 'whatsapp'
        or v_metadata->>'origin' <> 'whatsapp_business_app'
        or v_metadata->>'event_kind' <> 'message_echo'
        or (v_message.message_type = 'audio' and (
          nullif(btrim(v_metadata->>'audio_transcript'), '') is null
          or v_metadata->>'transcription_status' <> 'succeeded'
        )) then
    raise exception using errcode = '23514', message = 'human_response_commitment_whatsapp_echo_not_verified';
  end if;
  if p_conversation_session_id is distinct from v_message.conversation_session_id then
    raise exception using errcode = '23514', message = 'human_response_commitment_session_scope_mismatch';
  end if;

  select * into v_existing
  from public.conversation_human_response_commitments c
  where c.organization_id = p_organization_id and c.operation_key = p_operation_key;
  if found then
    if v_existing.store_id <> p_store_id
       or v_existing.conversation_id <> p_conversation_id
       or v_existing.due_at <> p_due_at
       or v_existing.responsible_user_id <> p_responsible_user_id then
      raise exception using errcode = '23505', message = 'human_response_commitment_operation_key_conflict';
    end if;
    return v_existing.id;
  end if;

  insert into public.conversation_human_response_commitments (
    organization_id, store_id, conversation_id, conversation_session_id,
    source_message_id, responsible_user_id, due_at, operation_key,
    last_operation_key, source_kind
  ) values (
    p_organization_id, p_store_id, p_conversation_id, p_conversation_session_id,
    p_source_message_id, p_responsible_user_id, p_due_at, p_operation_key,
    p_operation_key, p_source_kind
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_human_response_commitment_by_system(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,boolean) from public, anon, authenticated;
grant execute on function public.record_human_response_commitment_by_system(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,boolean) to service_role;

create or replace function public.transition_human_response_commitment_by_system(
  p_commitment_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_status text,
  p_operation_key text,
  p_due_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public, auth, extensions
as $$
declare
  v_request_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_row public.conversation_human_response_commitments;
begin
  if not (v_request_role = 'service_role' or session_user = 'postgres') then
    raise exception using errcode = '42501', message = 'human_response_commitment_service_only';
  end if;
  if p_status not in ('fulfilled', 'cancelled', 'expired', 'active') then
    raise exception using errcode = '22023', message = 'human_response_commitment_status_invalid';
  end if;
  if nullif(btrim(p_operation_key), '') is null then
    raise exception using errcode = '22023', message = 'human_response_commitment_operation_key_required';
  end if;
  select * into v_row from public.conversation_human_response_commitments
   where id = p_commitment_id and organization_id = p_organization_id and store_id = p_store_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'human_response_commitment_not_found';
  end if;
  if v_row.last_operation_key = p_operation_key then return v_row.id; end if;
  if v_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'human_response_commitment_terminal';
  end if;
  if p_status = 'active' and (p_due_at is null or p_due_at <= clock_timestamp()) then
    raise exception using errcode = '22023', message = 'human_response_commitment_amendment_due_at_invalid';
  end if;
  update public.conversation_human_response_commitments
     set status = p_status,
         due_at = case when p_status = 'active' then p_due_at else due_at end,
         revision = revision + case when p_status = 'active' then 1 else 0 end,
         last_operation_key = p_operation_key,
         updated_at = clock_timestamp(),
         fulfilled_at = case when p_status = 'fulfilled' then clock_timestamp() else fulfilled_at end,
         cancelled_at = case when p_status = 'cancelled' then clock_timestamp() else cancelled_at end,
         expired_at = case when p_status = 'expired' then clock_timestamp() else expired_at end
   where id = v_row.id;
  return v_row.id;
end;
$$;

revoke all on function public.transition_human_response_commitment_by_system(uuid,uuid,uuid,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.transition_human_response_commitment_by_system(uuid,uuid,uuid,text,text,timestamptz) to service_role;

create or replace function public.read_human_response_commitments_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid default null
)
returns setof public.conversation_human_response_commitments
language sql
security definer
set search_path = pg_catalog, pg_temp, public, auth, extensions
as $$
  select c.*
  from public.conversation_human_response_commitments c
  where c.organization_id = p_organization_id
    and c.store_id = p_store_id
    and (p_conversation_id is null or c.conversation_id = p_conversation_id)
  order by c.due_at asc, c.id asc
$$;

revoke all on function public.read_human_response_commitments_by_system(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.read_human_response_commitments_by_system(uuid,uuid,uuid) to service_role;

commit;

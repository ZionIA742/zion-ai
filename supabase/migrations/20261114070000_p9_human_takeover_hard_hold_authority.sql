-- P9 Block 10 / Etapa 10.4-B
-- Persisted hard-hold authority for explicitly authorized human control.

begin;

create table if not exists public.conversation_human_takeover_hard_hold_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  conversation_id uuid not null,
  decision_type text not null,
  decision_key text not null,
  reason text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint conversation_human_takeover_hard_hold_decisions_type_chk
    check (decision_type in ('created', 'released')),
  constraint conversation_human_takeover_hard_hold_decisions_key_chk
    check (pg_catalog.length(pg_catalog.btrim(decision_key)) > 0
           and pg_catalog.length(decision_key) <= 512),
  constraint conversation_human_takeover_hard_hold_decisions_reason_chk
    check (pg_catalog.length(pg_catalog.btrim(reason)) > 0
           and pg_catalog.length(reason) <= 2000),
  constraint conversation_human_takeover_hard_hold_decisions_conversation_scope_fkey
    foreign key (conversation_id, organization_id)
    references public.conversations(id, organization_id)
    on delete restrict,
  constraint conversation_human_takeover_hard_hold_decisions_store_scope_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,
  constraint conversation_human_takeover_hard_hold_decisions_key_uidx
    unique (organization_id, store_id, conversation_id, decision_key),
  constraint conversation_human_takeover_hard_hold_decisions_id_scope_uidx
    unique (id, organization_id, store_id, conversation_id)
);

create index if not exists conversation_human_takeover_hard_hold_decisions_scope_idx
  on public.conversation_human_takeover_hard_hold_decisions
    (organization_id, store_id, conversation_id, created_at);

alter table public.conversation_human_takeover_hard_hold_decisions
  enable row level security;

revoke all on table public.conversation_human_takeover_hard_hold_decisions
  from public, anon, authenticated, service_role;

create or replace function public.create_human_takeover_hard_hold_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_reason text,
  p_decision_key text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
  v_membership_role text;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_decision_key text := nullif(pg_catalog.btrim(coalesce(p_decision_key, '')), '');
  v_existing public.conversation_human_takeover_hard_hold_decisions%rowtype;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using errcode = '42501', message = 'hard hold is not authorized';
  end if;
  if v_reason is null or pg_catalog.length(v_reason) > 2000
     or v_decision_key is null or pg_catalog.length(v_decision_key) > 512 then
    raise exception using errcode = '22023', message = 'hard hold reason and decision key are required';
  end if;

  -- Every hard-hold decision follows conversation -> lease lock order.
  select conversation_row.*
    into v_conversation
    from public.conversations conversation_row
    join public.leads lead_row
      on lead_row.id = conversation_row.lead_id
     and lead_row.organization_id = p_organization_id
     and lead_row.store_id = p_store_id
    join public.stores store_row
      on store_row.id = lead_row.store_id
     and store_row.organization_id = lead_row.organization_id
   where conversation_row.id = p_conversation_id
     and conversation_row.organization_id = p_organization_id
   for update of conversation_row;

  if not found then
    raise exception using errcode = '42501', message = 'hard hold conversation scope mismatch';
  end if;

  select membership_row.role
    into v_membership_role
    from public.memberships membership_row
   where membership_row.organization_id = p_organization_id
     and membership_row.user_id = v_user_id
     and coalesce(membership_row.is_active, true)
   order by membership_row.created_at nulls first
   limit 1;
  if v_membership_role is null
     or not public._conversation_transition_role_is_allowed(v_membership_role) then
    raise exception using errcode = '42501', message = 'hard hold is not authorized';
  end if;

  select lease_row.*
    into v_lease
    from public.conversation_human_takeover_leases lease_row
   where lease_row.conversation_id = p_conversation_id
   for update;
  if not found then
    raise exception using errcode = '55000', message = 'hard hold requires an active human takeover lease';
  end if;
  if v_lease.organization_id is distinct from p_organization_id
     or v_lease.store_id is distinct from p_store_id then
    raise exception using errcode = '42501', message = 'hard hold lease scope mismatch';
  end if;

  select decision_row.*
    into v_existing
    from public.conversation_human_takeover_hard_hold_decisions decision_row
   where decision_row.organization_id = p_organization_id
     and decision_row.store_id = p_store_id
     and decision_row.conversation_id = p_conversation_id
     and decision_row.decision_key = v_decision_key
   for update;
  if found then
    if v_existing.decision_type <> 'created'
       or v_existing.reason <> v_reason
       or v_existing.actor_user_id <> v_user_id then
      raise exception using errcode = '23505', message = 'hard hold decision key conflict';
    end if;
    return;
  end if;

  if not v_conversation.is_human_active
     or pg_catalog.lower(pg_catalog.btrim(coalesce(v_conversation.status, ''))) <> 'humano_assumiu'
     or v_lease.released_at is not null then
    raise exception using errcode = '55000', message = 'hard hold requires active human control';
  end if;
  if v_lease.hard_hold is true then
    raise exception using errcode = '55000', message = 'hard hold is already active';
  end if;

  insert into public.conversation_human_takeover_hard_hold_decisions (
    organization_id, store_id, conversation_id, decision_type,
    decision_key, reason, actor_user_id
  ) values (
    p_organization_id, p_store_id, p_conversation_id, 'created',
    v_decision_key, v_reason, v_user_id
  );

  update public.conversation_human_takeover_leases
     set hard_hold = true, updated_at = pg_catalog.clock_timestamp()
   where conversation_id = p_conversation_id
     and organization_id = p_organization_id
     and store_id = p_store_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'hard hold lease was not updated';
  end if;
end;
$function$;

create or replace function public.release_human_takeover_hard_hold_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_reason text,
  p_decision_key text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
  v_membership_role text;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_decision_key text := nullif(pg_catalog.btrim(coalesce(p_decision_key, '')), '');
  v_existing public.conversation_human_takeover_hard_hold_decisions%rowtype;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using errcode = '42501', message = 'hard hold release is not authorized';
  end if;
  if v_reason is null or pg_catalog.length(v_reason) > 2000
     or v_decision_key is null or pg_catalog.length(v_decision_key) > 512 then
    raise exception using errcode = '22023', message = 'hard hold release reason and decision key are required';
  end if;

  select conversation_row.*
    into v_conversation
    from public.conversations conversation_row
    join public.leads lead_row
      on lead_row.id = conversation_row.lead_id
     and lead_row.organization_id = p_organization_id
     and lead_row.store_id = p_store_id
    join public.stores store_row
      on store_row.id = lead_row.store_id
     and store_row.organization_id = lead_row.organization_id
   where conversation_row.id = p_conversation_id
     and conversation_row.organization_id = p_organization_id
   for update of conversation_row;
  if not found then
    raise exception using errcode = '42501', message = 'hard hold conversation scope mismatch';
  end if;

  select membership_row.role
    into v_membership_role
    from public.memberships membership_row
   where membership_row.organization_id = p_organization_id
     and membership_row.user_id = v_user_id
     and coalesce(membership_row.is_active, true)
   order by membership_row.created_at nulls first
   limit 1;
  if v_membership_role is null
     or not public._conversation_transition_role_is_allowed(v_membership_role) then
    raise exception using errcode = '42501', message = 'hard hold release is not authorized';
  end if;

  select lease_row.*
    into v_lease
    from public.conversation_human_takeover_leases lease_row
   where lease_row.conversation_id = p_conversation_id
   for update;
  if not found then
    raise exception using errcode = '42501', message = 'hard hold lease scope mismatch';
  end if;
  if v_lease.organization_id is distinct from p_organization_id
     or v_lease.store_id is distinct from p_store_id then
    raise exception using errcode = '42501', message = 'hard hold lease scope mismatch';
  end if;

  select decision_row.*
    into v_existing
    from public.conversation_human_takeover_hard_hold_decisions decision_row
   where decision_row.organization_id = p_organization_id
     and decision_row.store_id = p_store_id
     and decision_row.conversation_id = p_conversation_id
     and decision_row.decision_key = v_decision_key
   for update;
  if found then
    if v_existing.decision_type <> 'released'
       or v_existing.reason <> v_reason
       or v_existing.actor_user_id <> v_user_id then
      raise exception using errcode = '23505', message = 'hard hold release decision key conflict';
    end if;
    return;
  end if;

  if v_lease.hard_hold is not true then
    raise exception using errcode = '55000', message = 'hard hold is not active';
  end if;

  insert into public.conversation_human_takeover_hard_hold_decisions (
    organization_id, store_id, conversation_id, decision_type,
    decision_key, reason, actor_user_id
  ) values (
    p_organization_id, p_store_id, p_conversation_id, 'released',
    v_decision_key, v_reason, v_user_id
  );

  update public.conversation_human_takeover_leases
     set hard_hold = false, updated_at = pg_catalog.clock_timestamp()
   where conversation_id = p_conversation_id
     and organization_id = p_organization_id
     and store_id = p_store_id
     and hard_hold is true;
  if not found then
    raise exception using errcode = 'P0001', message = 'hard hold release did not update the locked lease';
  end if;
end;
$function$;

-- Legacy release remains the clock authority, but cannot cross an active hard hold.
create or replace function public.release_human_takeover_lease_by_system(
  p_conversation_id uuid,
  p_reason text default 'human_release'
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
begin
  select conversation_row.* into v_conversation
    from public.conversations conversation_row
   where conversation_row.id = p_conversation_id
   for update;
  if not found then return; end if;

  select lease_row.* into v_lease
    from public.conversation_human_takeover_leases lease_row
   where lease_row.conversation_id = p_conversation_id
   for update;
  if not found then return; end if;

  if v_lease.organization_id is distinct from v_conversation.organization_id
     or v_lease.hard_hold is true then
    raise exception using errcode = '42501', message = 'legacy takeover release cannot cross active hard hold or scope';
  end if;

  update public.conversation_human_takeover_leases
     set released_at = pg_catalog.clock_timestamp(),
         release_reason = nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''),
         updated_at = pg_catalog.clock_timestamp()
   where conversation_id = p_conversation_id
     and organization_id = v_conversation.organization_id;
end;
$function$;

alter function public.create_human_takeover_hard_hold_scoped(uuid, uuid, uuid, text, text) owner to postgres;
alter function public.release_human_takeover_hard_hold_scoped(uuid, uuid, uuid, text, text) owner to postgres;
alter function public.release_human_takeover_lease_by_system(uuid, text) owner to postgres;

revoke all on function public.create_human_takeover_hard_hold_scoped(uuid, uuid, uuid, text, text) from public, anon, service_role;
revoke all on function public.release_human_takeover_hard_hold_scoped(uuid, uuid, uuid, text, text) from public, anon, service_role;
grant execute on function public.create_human_takeover_hard_hold_scoped(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.release_human_takeover_hard_hold_scoped(uuid, uuid, uuid, text, text) to authenticated;

do $postconditions$
declare
  v_create text := pg_catalog.pg_get_functiondef('public.create_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text)'::regprocedure);
  v_release text := pg_catalog.pg_get_functiondef('public.release_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text)'::regprocedure);
  v_legacy text := pg_catalog.pg_get_functiondef('public.release_human_takeover_lease_by_system(uuid,text)'::regprocedure);
begin
  if pg_catalog.to_regclass('public.conversation_human_takeover_hard_hold_decisions') is null
     or pg_catalog.strpos(v_create, 'for update of conversation_row') = 0
     or pg_catalog.strpos(v_create, 'hard_hold = true') = 0
     or pg_catalog.strpos(v_release, 'hard_hold = false') = 0
     or pg_catalog.strpos(v_release, 'for update of conversation_row') = 0
     or pg_catalog.strpos(v_legacy, 'legacy takeover release cannot cross active hard hold') = 0
     or pg_catalog.has_function_privilege('anon', 'public.create_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'public.create_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', 'public.create_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.release_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'public.release_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', 'public.release_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text)', 'EXECUTE')
     or pg_catalog.has_table_privilege('authenticated', 'public.conversation_human_takeover_hard_hold_decisions', 'SELECT') then
    raise exception using errcode = 'P0001', message = 'P9_10_4_B_HARD_HOLD_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;

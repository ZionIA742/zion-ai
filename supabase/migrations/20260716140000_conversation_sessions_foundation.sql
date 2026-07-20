create unique index conversations_id_organization_uidx
  on public.conversations (id, organization_id);

create table public.conversation_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  conversation_id uuid not null,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  closed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint conversation_sessions_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete cascade,

  constraint conversation_sessions_store_org_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint conversation_sessions_conversation_org_fkey
    foreign key (conversation_id, organization_id)
    references public.conversations(id, organization_id)
    on delete restrict,

  constraint conversation_sessions_status_check
    check (status in ('active', 'closed')),

  constraint conversation_sessions_status_closed_at_check
    check (
      (status = 'active' and closed_at is null)
      or (status = 'closed' and closed_at is not null)
    )
);

create unique index conversation_sessions_id_organization_uidx
  on public.conversation_sessions (id, organization_id);

create unique index conversation_sessions_id_org_store_uidx
  on public.conversation_sessions (id, organization_id, store_id);

create index conversation_sessions_org_store_status_updated_idx
  on public.conversation_sessions (organization_id, store_id, status, updated_at desc);

create index conversation_sessions_org_conversation_started_idx
  on public.conversation_sessions (organization_id, conversation_id, started_at desc);

create unique index conversation_sessions_one_active_per_thread_uidx
  on public.conversation_sessions (organization_id, store_id, conversation_id)
  where status = 'active';

create or replace function public.conversation_session_apply_write_rules()
returns trigger
language plpgsql
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_conversation_organization_id uuid;
  v_conversation_lead_id uuid;
  v_lead_organization_id uuid;
  v_lead_store_id uuid;
  v_store_organization_id uuid;
begin
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

  if not found then
    raise exception 'conversation not found for %', tg_table_name;
  end if;

  if v_conversation_lead_id is null or v_lead_organization_id is null then
    raise exception 'conversation lead not found for %', tg_table_name;
  end if;

  if v_lead_store_id is null then
    raise exception 'conversation lead has no store for %', tg_table_name;
  end if;

  if v_store_organization_id is null then
    raise exception 'conversation lead store not found for %', tg_table_name;
  end if;

  if v_conversation_organization_id is distinct from v_lead_organization_id then
    raise exception 'conversation and lead organization mismatch for %', tg_table_name;
  end if;

  if v_lead_organization_id is distinct from v_store_organization_id then
    raise exception 'lead and store organization mismatch for %', tg_table_name;
  end if;

  if new.organization_id is distinct from v_conversation_organization_id then
    raise exception 'conversation session organization mismatch for %', tg_table_name;
  end if;

  if new.store_id is distinct from v_lead_store_id then
    raise exception 'conversation session store mismatch for %', tg_table_name;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := v_now;

    if old.status = 'closed' and new.status is distinct from old.status then
      raise exception 'closed session cannot be reopened for %', tg_table_name;
    end if;

    if new.status is distinct from old.status then
      if old.status = 'active' and new.status = 'closed' then
        new.closed_at := v_now;
      end if;
    else
      if new.closed_at is distinct from old.closed_at then
        raise exception 'closed_at can only change when status changes for %', tg_table_name;
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
$$;

create or replace function public.prevent_conversation_session_organization_change()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable after insert for %', tg_table_name;
  end if;

  return new;
end;
$$;

drop trigger if exists conversation_sessions_apply_write_rules on public.conversation_sessions;
create trigger conversation_sessions_apply_write_rules
  before insert or update on public.conversation_sessions
  for each row
  execute function public.conversation_session_apply_write_rules();

drop trigger if exists conversation_sessions_prevent_organization_change on public.conversation_sessions;
create trigger conversation_sessions_prevent_organization_change
  before update on public.conversation_sessions
  for each row
  execute function public.prevent_conversation_session_organization_change();

alter table public.conversation_sessions enable row level security;

revoke all on table public.conversation_sessions from public;
revoke all on table public.conversation_sessions from anon;
revoke all on table public.conversation_sessions from authenticated;

grant select, insert, update on table public.conversation_sessions to authenticated;
grant all on table public.conversation_sessions to service_role;

drop policy if exists conversation_sessions_select_by_membership on public.conversation_sessions;
create policy conversation_sessions_select_by_membership
  on public.conversation_sessions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.organization_id = conversation_sessions.organization_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists conversation_sessions_insert_by_membership on public.conversation_sessions;
create policy conversation_sessions_insert_by_membership
  on public.conversation_sessions
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.memberships m
      where m.organization_id = conversation_sessions.organization_id
        and m.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.stores s
      where s.id = conversation_sessions.store_id
        and s.organization_id = conversation_sessions.organization_id
    )
    and exists (
      select 1
      from public.conversations c
      join public.leads l
        on l.id = c.lead_id
      join public.stores s
        on s.id = l.store_id
      where c.id = conversation_sessions.conversation_id
        and c.organization_id = conversation_sessions.organization_id
        and l.organization_id = conversation_sessions.organization_id
        and l.store_id = conversation_sessions.store_id
        and s.id = conversation_sessions.store_id
        and s.organization_id = conversation_sessions.organization_id
    )
  );

drop policy if exists conversation_sessions_update_by_membership on public.conversation_sessions;
create policy conversation_sessions_update_by_membership
  on public.conversation_sessions
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.organization_id = conversation_sessions.organization_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.memberships m
      where m.organization_id = conversation_sessions.organization_id
        and m.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.stores s
      where s.id = conversation_sessions.store_id
        and s.organization_id = conversation_sessions.organization_id
    )
    and exists (
      select 1
      from public.conversations c
      join public.leads l
        on l.id = c.lead_id
      join public.stores s
        on s.id = l.store_id
      where c.id = conversation_sessions.conversation_id
        and c.organization_id = conversation_sessions.organization_id
        and l.organization_id = conversation_sessions.organization_id
        and l.store_id = conversation_sessions.store_id
        and s.id = conversation_sessions.store_id
        and s.organization_id = conversation_sessions.organization_id
    )
  );

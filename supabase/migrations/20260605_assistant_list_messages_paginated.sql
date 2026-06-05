create or replace function public.assistant_list_messages_paginated(
  p_organization_id uuid,
  p_store_id uuid,
  p_limit integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  id uuid,
  thread_id uuid,
  sender text,
  sender_role text,
  direction text,
  message_type text,
  content text,
  related_lead_id uuid,
  related_conversation_id uuid,
  related_appointment_id uuid,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_thread_id uuid;
  v_user_id uuid := auth.uid();
begin
  if p_organization_id is null or p_store_id is null then
    return;
  end if;

  if v_user_id is null then
    return;
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'assistant_list_messages_paginated requires p_before_created_at and p_before_id together';
  end if;

  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception 'assistant_list_messages_paginated requires p_after_created_at and p_after_id together';
  end if;

  if p_before_created_at is not null and p_after_created_at is not null then
    raise exception 'assistant_list_messages_paginated does not accept before and after cursors in the same call';
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = v_user_id
  ) then
    return;
  end if;

  if not exists (
    select 1
    from public.stores s
    where s.id = p_store_id
      and s.organization_id = p_organization_id
  ) then
    return;
  end if;

  select t.id
  into v_thread_id
  from public.store_assistant_threads t
  where t.organization_id = p_organization_id
    and t.store_id = p_store_id
    and t.thread_type = 'primary'
    and t.status = 'active'
  order by t.updated_at desc nulls last, t.created_at desc nulls last, t.id desc
  limit 1;

  if v_thread_id is null then
    return;
  end if;

  if p_before_created_at is not null then
    return query
    with older_messages as (
      select
        m.id,
        m.thread_id,
        m.sender,
        m.sender_role,
        m.direction,
        m.message_type,
        m.content,
        m.related_lead_id,
        m.related_conversation_id,
        m.related_appointment_id,
        m.metadata,
        m.created_at
      from public.store_assistant_messages m
      where m.organization_id = p_organization_id
        and m.store_id = p_store_id
        and m.thread_id = v_thread_id
        and (
          m.created_at < p_before_created_at
          or (m.created_at = p_before_created_at and m.id < p_before_id)
        )
      order by m.created_at desc, m.id desc
      limit v_limit
    )
    select
      older_messages.id,
      older_messages.thread_id,
      older_messages.sender,
      older_messages.sender_role,
      older_messages.direction,
      older_messages.message_type,
      older_messages.content,
      older_messages.related_lead_id,
      older_messages.related_conversation_id,
      older_messages.related_appointment_id,
      older_messages.metadata,
      older_messages.created_at
    from older_messages
    order by older_messages.created_at asc, older_messages.id asc;

    return;
  end if;

  if p_after_created_at is not null then
    return query
    select
      m.id,
      m.thread_id,
      m.sender,
      m.sender_role,
      m.direction,
      m.message_type,
      m.content,
      m.related_lead_id,
      m.related_conversation_id,
      m.related_appointment_id,
      m.metadata,
      m.created_at
    from public.store_assistant_messages m
    where m.organization_id = p_organization_id
      and m.store_id = p_store_id
      and m.thread_id = v_thread_id
      and (
        m.created_at > p_after_created_at
        or (m.created_at = p_after_created_at and m.id > p_after_id)
      )
    order by m.created_at asc, m.id asc
    limit v_limit;

    return;
  end if;

  return query
  with recent_messages as (
    select
      m.id,
      m.thread_id,
      m.sender,
      m.sender_role,
      m.direction,
      m.message_type,
      m.content,
      m.related_lead_id,
      m.related_conversation_id,
      m.related_appointment_id,
      m.metadata,
      m.created_at
    from public.store_assistant_messages m
    where m.organization_id = p_organization_id
      and m.store_id = p_store_id
      and m.thread_id = v_thread_id
    order by m.created_at desc, m.id desc
    limit v_limit
  )
  select
    recent_messages.id,
    recent_messages.thread_id,
    recent_messages.sender,
    recent_messages.sender_role,
    recent_messages.direction,
    recent_messages.message_type,
    recent_messages.content,
    recent_messages.related_lead_id,
    recent_messages.related_conversation_id,
    recent_messages.related_appointment_id,
    recent_messages.metadata,
    recent_messages.created_at
  from recent_messages
  order by recent_messages.created_at asc, recent_messages.id asc;
end;
$$;

revoke all on function public.assistant_list_messages_paginated(
  uuid,
  uuid,
  integer,
  timestamptz,
  uuid,
  timestamptz,
  uuid
) from public;

grant execute on function public.assistant_list_messages_paginated(
  uuid,
  uuid,
  integer,
  timestamptz,
  uuid,
  timestamptz,
  uuid
) to authenticated;

grant execute on function public.assistant_list_messages_paginated(
  uuid,
  uuid,
  integer,
  timestamptz,
  uuid,
  timestamptz,
  uuid
) to service_role;

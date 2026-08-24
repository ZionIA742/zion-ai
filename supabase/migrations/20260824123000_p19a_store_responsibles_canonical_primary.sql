alter table public.store_responsibles
  add column if not exists is_primary boolean,
  add column if not exists is_active boolean;

update public.store_responsibles
set is_primary = false
where is_primary is null;

update public.store_responsibles
set is_active = true
where is_active is null;

with singleton_stores as (
  select
    responsible_row.organization_id,
    responsible_row.store_id
  from public.store_responsibles responsible_row
  group by responsible_row.organization_id, responsible_row.store_id
  having count(*) = 1
)
update public.store_responsibles responsible_row
set is_primary = true
from singleton_stores singleton_row
where responsible_row.organization_id = singleton_row.organization_id
  and responsible_row.store_id = singleton_row.store_id;

alter table public.store_responsibles
  alter column is_primary set default false,
  alter column is_primary set not null,
  alter column is_active set default true,
  alter column is_active set not null;

create unique index if not exists store_responsibles_one_active_primary_per_store_uidx
  on public.store_responsibles (organization_id, store_id)
  where is_primary is true and is_active is true;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'store_responsibles_store_scope_fkey'
      and constraint_row.conrelid = 'public.store_responsibles'::pg_catalog.regclass
  ) then
    alter table public.store_responsibles
      add constraint store_responsibles_store_scope_fkey
      foreign key (store_id, organization_id)
      references public.stores(id, organization_id)
      on delete cascade;
  end if;
end;
$$;

create or replace function public.upsert_store_primary_responsible_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_name text,
  p_whatsapp_number text
)
returns public.store_responsibles
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_name text := nullif(pg_catalog.btrim(coalesce(p_name, '')), '');
  v_whatsapp_number text := nullif(pg_catalog.btrim(coalesce(p_whatsapp_number, '')), '');
  v_active_primary_count integer := 0;
  v_store_responsible_count integer := 0;
  v_result public.store_responsibles%rowtype;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if v_name is null or v_whatsapp_number is null then
    raise exception using
      errcode = '22023',
      message = 'responsible name and whatsapp are required';
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'store scope is not authorized';
    end if;

    select exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    into v_is_member;

    if coalesce(v_is_member, false) is not true then
      raise exception using
        errcode = '42501',
        message = 'store scope is not authorized';
    end if;
  elsif v_request_role in ('service_role', 'postgres') then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store scope is not authorized';
  end if;

  perform 1
  from public.store_responsibles responsible_row
  where responsible_row.organization_id = p_organization_id
    and responsible_row.store_id = p_store_id
  for update;

  select count(*)
  into v_active_primary_count
  from public.store_responsibles responsible_row
  where responsible_row.organization_id = p_organization_id
    and responsible_row.store_id = p_store_id
    and responsible_row.is_primary is true
    and responsible_row.is_active is true;

  if v_active_primary_count > 1 then
    raise exception using
      errcode = 'P0001',
      message = 'store_responsibles primary state is ambiguous';
  end if;

  if v_active_primary_count = 1 then
    update public.store_responsibles responsible_row
    set
      name = v_name,
      whatsapp_number = v_whatsapp_number,
      is_primary = true,
      is_active = true
    where responsible_row.organization_id = p_organization_id
      and responsible_row.store_id = p_store_id
      and responsible_row.is_primary is true
      and responsible_row.is_active is true
    returning responsible_row.*
    into v_result;

    return v_result;
  end if;

  select count(*)
  into v_store_responsible_count
  from public.store_responsibles responsible_row
  where responsible_row.organization_id = p_organization_id
    and responsible_row.store_id = p_store_id;

  if v_store_responsible_count > 1 then
    raise exception using
      errcode = 'P0001',
      message = 'store_responsibles state is ambiguous';
  end if;

  if v_store_responsible_count = 1 then
    update public.store_responsibles responsible_row
    set
      name = v_name,
      whatsapp_number = v_whatsapp_number,
      is_primary = true,
      is_active = true
    where responsible_row.organization_id = p_organization_id
      and responsible_row.store_id = p_store_id
    returning responsible_row.*
    into v_result;

    return v_result;
  end if;

  insert into public.store_responsibles (
    organization_id,
    store_id,
    name,
    whatsapp_number,
    role,
    receive_discount_alerts,
    receive_subscription_alerts,
    receive_sla_alerts,
    is_primary,
    is_active
  )
  values (
    p_organization_id,
    p_store_id,
    v_name,
    v_whatsapp_number,
    'owner',
    true,
    true,
    true,
    true,
    true
  )
  returning *
  into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_primary_responsible_scoped(uuid, uuid, text, text) owner to postgres;

revoke all on function public.upsert_store_primary_responsible_scoped(uuid, uuid, text, text) from public;
revoke all on function public.upsert_store_primary_responsible_scoped(uuid, uuid, text, text) from anon;
revoke all on function public.upsert_store_primary_responsible_scoped(uuid, uuid, text, text) from authenticated;
revoke all on function public.upsert_store_primary_responsible_scoped(uuid, uuid, text, text) from service_role;

grant execute on function public.upsert_store_primary_responsible_scoped(uuid, uuid, text, text) to authenticated;
grant execute on function public.upsert_store_primary_responsible_scoped(uuid, uuid, text, text) to service_role;

create or replace function public.upsert_store_primary_responsible_with_legacy_mirror_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_name text,
  p_whatsapp_number text
)
returns public.store_responsibles
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_result public.store_responsibles%rowtype;
begin
  v_result := public.upsert_store_primary_responsible_scoped(
    p_organization_id,
    p_store_id,
    p_name,
    p_whatsapp_number
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'responsible_name',
    p_answer => to_jsonb(p_name)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'responsible_whatsapp',
    p_answer => to_jsonb(p_whatsapp_number)
  );

  return v_result;
end;
$function$;

alter function public.upsert_store_primary_responsible_with_legacy_mirror_scoped(uuid, uuid, text, text) owner to postgres;

revoke all on function public.upsert_store_primary_responsible_with_legacy_mirror_scoped(uuid, uuid, text, text) from public;
revoke all on function public.upsert_store_primary_responsible_with_legacy_mirror_scoped(uuid, uuid, text, text) from anon;
revoke all on function public.upsert_store_primary_responsible_with_legacy_mirror_scoped(uuid, uuid, text, text) from authenticated;
revoke all on function public.upsert_store_primary_responsible_with_legacy_mirror_scoped(uuid, uuid, text, text) from service_role;

grant execute on function public.upsert_store_primary_responsible_with_legacy_mirror_scoped(uuid, uuid, text, text) to authenticated;
grant execute on function public.upsert_store_primary_responsible_with_legacy_mirror_scoped(uuid, uuid, text, text) to service_role;

create table if not exists public.store_channel_settings (
  organization_id uuid not null,
  store_id uuid not null,
  commercial_channel_name text,
  commercial_receives_real_clients boolean,
  commercial_is_official_sales_channel boolean,
  commercial_channel_type text,
  commercial_entry_priority text,
  commercial_human_handoff_enabled boolean,
  commercial_channel_notes text,
  integration_provider_name text,
  integration_connection_mode text,
  integrations_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint store_channel_settings_pkey primary key (organization_id, store_id),
  constraint store_channel_settings_store_scope_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete cascade,
  constraint store_channel_settings_commercial_channel_name_not_blank
    check (
      commercial_channel_name is null
      or nullif(pg_catalog.btrim(commercial_channel_name), '') is not null
    ),
  constraint store_channel_settings_commercial_channel_type_not_blank
    check (
      commercial_channel_type is null
      or nullif(pg_catalog.btrim(commercial_channel_type), '') is not null
    ),
  constraint store_channel_settings_commercial_entry_priority_not_blank
    check (
      commercial_entry_priority is null
      or nullif(pg_catalog.btrim(commercial_entry_priority), '') is not null
    ),
  constraint store_channel_settings_integration_provider_name_not_blank
    check (
      integration_provider_name is null
      or nullif(pg_catalog.btrim(integration_provider_name), '') is not null
    ),
  constraint store_channel_settings_integration_connection_mode_not_blank
    check (
      integration_connection_mode is null
      or nullif(pg_catalog.btrim(integration_connection_mode), '') is not null
    )
);

create or replace function public.touch_store_channel_settings_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

drop trigger if exists store_channel_settings_touch_updated_at on public.store_channel_settings;
create trigger store_channel_settings_touch_updated_at
before update on public.store_channel_settings
for each row
execute function public.touch_store_channel_settings_updated_at();

with legacy_channel_answers as (
  select
    answer_row.organization_id,
    answer_row.store_id,
    answer_row.question_key,
    nullif(pg_catalog.btrim(answer_row.answer #>> '{}'), '') as answer_text,
    case
      when answer_row.question_key in (
        'commercial_receives_real_clients',
        'commercial_is_official_sales_channel',
        'commercial_human_handoff_enabled'
      )
        and pg_catalog.lower(
          coalesce(nullif(pg_catalog.btrim(answer_row.answer #>> '{}'), ''), '')
        ) in ('sim', 'true', '1')
      then true
      when answer_row.question_key in (
        'commercial_receives_real_clients',
        'commercial_is_official_sales_channel',
        'commercial_human_handoff_enabled'
      )
        and pg_catalog.lower(
          coalesce(nullif(pg_catalog.btrim(answer_row.answer #>> '{}'), ''), '')
        ) in ('nao', 'não', 'false', '0')
      then false
      else null
    end as answer_boolean
  from public.store_onboarding_answers answer_row
  where answer_row.question_key in (
    'commercial_channel_name',
    'commercial_receives_real_clients',
    'commercial_is_official_sales_channel',
    'commercial_channel_type',
    'commercial_entry_priority',
    'commercial_human_handoff_enabled',
    'commercial_channel_notes',
    'integration_provider_name',
    'integration_connection_mode',
    'integrations_notes'
  )
),
legacy_channel_settings as (
  select
    organization_id,
    store_id,
    case
      when count(distinct answer_text) filter (
        where question_key = 'commercial_channel_name'
          and answer_text is not null
      ) = 1
      then max(answer_text) filter (where question_key = 'commercial_channel_name')
      else null
    end as commercial_channel_name,
    case
      when count(*) filter (
        where question_key = 'commercial_receives_real_clients'
          and answer_text is not null
      ) = count(answer_boolean) filter (
        where question_key = 'commercial_receives_real_clients'
      )
       and count(distinct answer_boolean) filter (
        where question_key = 'commercial_receives_real_clients'
          and answer_boolean is not null
      ) = 1
      then bool_or(answer_boolean) filter (
        where question_key = 'commercial_receives_real_clients'
      )
      else null
    end as commercial_receives_real_clients,
    case
      when count(*) filter (
        where question_key = 'commercial_is_official_sales_channel'
          and answer_text is not null
      ) = count(answer_boolean) filter (
        where question_key = 'commercial_is_official_sales_channel'
      )
       and count(distinct answer_boolean) filter (
        where question_key = 'commercial_is_official_sales_channel'
          and answer_boolean is not null
      ) = 1
      then bool_or(answer_boolean) filter (
        where question_key = 'commercial_is_official_sales_channel'
      )
      else null
    end as commercial_is_official_sales_channel,
    case
      when count(distinct answer_text) filter (
        where question_key = 'commercial_channel_type'
          and answer_text is not null
      ) = 1
      then max(answer_text) filter (where question_key = 'commercial_channel_type')
      else null
    end as commercial_channel_type,
    case
      when count(distinct answer_text) filter (
        where question_key = 'commercial_entry_priority'
          and answer_text is not null
      ) = 1
      then max(answer_text) filter (where question_key = 'commercial_entry_priority')
      else null
    end as commercial_entry_priority,
    case
      when count(*) filter (
        where question_key = 'commercial_human_handoff_enabled'
          and answer_text is not null
      ) = count(answer_boolean) filter (
        where question_key = 'commercial_human_handoff_enabled'
      )
       and count(distinct answer_boolean) filter (
        where question_key = 'commercial_human_handoff_enabled'
          and answer_boolean is not null
      ) = 1
      then bool_or(answer_boolean) filter (
        where question_key = 'commercial_human_handoff_enabled'
      )
      else null
    end as commercial_human_handoff_enabled,
    case
      when count(distinct answer_text) filter (
        where question_key = 'commercial_channel_notes'
          and answer_text is not null
      ) = 1
      then max(answer_text) filter (where question_key = 'commercial_channel_notes')
      else null
    end as commercial_channel_notes,
    case
      when count(distinct answer_text) filter (
        where question_key = 'integration_provider_name'
          and answer_text is not null
      ) = 1
      then max(answer_text) filter (where question_key = 'integration_provider_name')
      else null
    end as integration_provider_name,
    case
      when count(distinct answer_text) filter (
        where question_key = 'integration_connection_mode'
          and answer_text is not null
      ) = 1
      then max(answer_text) filter (where question_key = 'integration_connection_mode')
      else null
    end as integration_connection_mode,
    case
      when count(distinct answer_text) filter (
        where question_key = 'integrations_notes'
          and answer_text is not null
      ) = 1
      then max(answer_text) filter (where question_key = 'integrations_notes')
      else null
    end as integrations_notes
  from legacy_channel_answers
  group by organization_id, store_id
)
insert into public.store_channel_settings (
  organization_id,
  store_id,
  commercial_channel_name,
  commercial_receives_real_clients,
  commercial_is_official_sales_channel,
  commercial_channel_type,
  commercial_entry_priority,
  commercial_human_handoff_enabled,
  commercial_channel_notes,
  integration_provider_name,
  integration_connection_mode,
  integrations_notes
)
select
  legacy_row.organization_id,
  legacy_row.store_id,
  legacy_row.commercial_channel_name,
  legacy_row.commercial_receives_real_clients,
  legacy_row.commercial_is_official_sales_channel,
  legacy_row.commercial_channel_type,
  legacy_row.commercial_entry_priority,
  legacy_row.commercial_human_handoff_enabled,
  legacy_row.commercial_channel_notes,
  legacy_row.integration_provider_name,
  legacy_row.integration_connection_mode,
  legacy_row.integrations_notes
from legacy_channel_settings legacy_row
where legacy_row.commercial_channel_name is not null
   or legacy_row.commercial_receives_real_clients is not null
   or legacy_row.commercial_is_official_sales_channel is not null
   or legacy_row.commercial_channel_type is not null
   or legacy_row.commercial_entry_priority is not null
   or legacy_row.commercial_human_handoff_enabled is not null
   or legacy_row.commercial_channel_notes is not null
   or legacy_row.integration_provider_name is not null
   or legacy_row.integration_connection_mode is not null
   or legacy_row.integrations_notes is not null
on conflict (organization_id, store_id) do nothing;

alter table public.store_channel_settings enable row level security;

revoke all on table public.store_channel_settings from public;
revoke all on table public.store_channel_settings from anon;
revoke all on table public.store_channel_settings from authenticated;
revoke all on table public.store_channel_settings from service_role;

grant select on table public.store_channel_settings to authenticated;

drop policy if exists store_channel_settings_select_by_active_membership on public.store_channel_settings;
create policy store_channel_settings_select_by_active_membership
  on public.store_channel_settings
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = store_channel_settings.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    and exists (
      select 1
      from public.stores store_row
      where store_row.id = store_channel_settings.store_id
        and store_row.organization_id = store_channel_settings.organization_id
    )
  );

drop policy if exists store_channel_settings_insert_by_active_membership on public.store_channel_settings;
drop policy if exists store_channel_settings_update_by_active_membership on public.store_channel_settings;

create or replace function public.upsert_store_channel_settings_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_channel_name text,
  p_commercial_receives_real_clients boolean,
  p_commercial_is_official_sales_channel boolean,
  p_commercial_channel_type text,
  p_commercial_entry_priority text,
  p_commercial_human_handoff_enabled boolean,
  p_commercial_channel_notes text default null,
  p_integration_provider_name text default null,
  p_integration_connection_mode text default null,
  p_integrations_notes text default null
)
returns public.store_channel_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_is_member boolean;
  v_result public.store_channel_settings%rowtype;
  v_commercial_channel_name text := nullif(pg_catalog.btrim(coalesce(p_commercial_channel_name, '')), '');
  v_commercial_channel_type text := nullif(pg_catalog.btrim(coalesce(p_commercial_channel_type, '')), '');
  v_commercial_entry_priority text := nullif(pg_catalog.btrim(coalesce(p_commercial_entry_priority, '')), '');
  v_commercial_channel_notes text := nullif(pg_catalog.btrim(coalesce(p_commercial_channel_notes, '')), '');
  v_integration_provider_name text := nullif(pg_catalog.btrim(coalesce(p_integration_provider_name, '')), '');
  v_integration_connection_mode text := nullif(pg_catalog.btrim(coalesce(p_integration_connection_mode, '')), '');
  v_integrations_notes text := nullif(pg_catalog.btrim(coalesce(p_integrations_notes, '')), '');
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED'
      using errcode = 'P0001',
            detail = 'AUTH_REQUIRED',
            hint = 'Apenas usuarios autenticados podem salvar configuracoes canônicas de canais.';
  end if;

  select exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_organization_id
      and membership_row.user_id = auth.uid()
      and membership_row.is_active is true
  )
  into v_is_member;

  if not coalesce(v_is_member, false) then
    raise exception 'MEMBERSHIP_REQUIRED'
      using errcode = 'P0001',
            detail = 'MEMBERSHIP_REQUIRED',
            hint = 'Usuario sem vinculacao ativa nao pode salvar configuracoes canônicas de canais.';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception 'STORE_NOT_FOUND'
      using errcode = 'P0001',
            detail = 'STORE_NOT_FOUND',
            hint = 'Loja nao encontrada no escopo informado.';
  end if;

  if v_commercial_channel_name is null then
    raise exception 'COMMERCIAL_CHANNEL_NAME_REQUIRED'
      using errcode = 'P0001',
            detail = 'COMMERCIAL_CHANNEL_NAME_REQUIRED',
            hint = 'Informe o nome do canal comercial principal.';
  end if;

  if p_commercial_receives_real_clients is null then
    raise exception 'COMMERCIAL_RECEIVES_REAL_CLIENTS_REQUIRED'
      using errcode = 'P0001',
            detail = 'COMMERCIAL_RECEIVES_REAL_CLIENTS_REQUIRED',
            hint = 'Defina se o canal comercial realmente recebe clientes.';
  end if;

  if p_commercial_is_official_sales_channel is null then
    raise exception 'COMMERCIAL_IS_OFFICIAL_SALES_CHANNEL_REQUIRED'
      using errcode = 'P0001',
            detail = 'COMMERCIAL_IS_OFFICIAL_SALES_CHANNEL_REQUIRED',
            hint = 'Defina se este e o canal oficial da IA vendedora.';
  end if;

  if v_commercial_channel_type is null then
    raise exception 'COMMERCIAL_CHANNEL_TYPE_REQUIRED'
      using errcode = 'P0001',
            detail = 'COMMERCIAL_CHANNEL_TYPE_REQUIRED',
            hint = 'Informe o tipo do canal comercial.';
  end if;

  if v_commercial_entry_priority is null then
    raise exception 'COMMERCIAL_ENTRY_PRIORITY_REQUIRED'
      using errcode = 'P0001',
            detail = 'COMMERCIAL_ENTRY_PRIORITY_REQUIRED',
            hint = 'Explique a prioridade de entrada do canal comercial.';
  end if;

  if p_commercial_human_handoff_enabled is null then
    raise exception 'COMMERCIAL_HUMAN_HANDOFF_ENABLED_REQUIRED'
      using errcode = 'P0001',
            detail = 'COMMERCIAL_HUMAN_HANDOFF_ENABLED_REQUIRED',
            hint = 'Defina se o canal comercial permite transbordo para humano.';
  end if;

  if v_integration_provider_name is null then
    raise exception 'INTEGRATION_PROVIDER_REQUIRED'
      using errcode = 'P0001',
            detail = 'INTEGRATION_PROVIDER_REQUIRED',
            hint = 'Informe qual provedor ou integração principal a loja usa.';
  end if;

  if v_integration_connection_mode is null then
    raise exception 'INTEGRATION_CONNECTION_MODE_REQUIRED'
      using errcode = 'P0001',
            detail = 'INTEGRATION_CONNECTION_MODE_REQUIRED',
            hint = 'Informe o modo de conexao da integração.';
  end if;

  insert into public.store_channel_settings (
    organization_id,
    store_id,
    commercial_channel_name,
    commercial_receives_real_clients,
    commercial_is_official_sales_channel,
    commercial_channel_type,
    commercial_entry_priority,
    commercial_human_handoff_enabled,
    commercial_channel_notes,
    integration_provider_name,
    integration_connection_mode,
    integrations_notes
  )
  values (
    p_organization_id,
    p_store_id,
    v_commercial_channel_name,
    p_commercial_receives_real_clients,
    p_commercial_is_official_sales_channel,
    v_commercial_channel_type,
    v_commercial_entry_priority,
    p_commercial_human_handoff_enabled,
    v_commercial_channel_notes,
    v_integration_provider_name,
    v_integration_connection_mode,
    v_integrations_notes
  )
  on conflict (organization_id, store_id) do update
  set
    commercial_channel_name = excluded.commercial_channel_name,
    commercial_receives_real_clients = excluded.commercial_receives_real_clients,
    commercial_is_official_sales_channel = excluded.commercial_is_official_sales_channel,
    commercial_channel_type = excluded.commercial_channel_type,
    commercial_entry_priority = excluded.commercial_entry_priority,
    commercial_human_handoff_enabled = excluded.commercial_human_handoff_enabled,
    commercial_channel_notes = excluded.commercial_channel_notes,
    integration_provider_name = excluded.integration_provider_name,
    integration_connection_mode = excluded.integration_connection_mode,
    integrations_notes = excluded.integrations_notes
  returning *
  into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_channel_settings_scoped(
  uuid,
  uuid,
  text,
  boolean,
  boolean,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text
) owner to postgres;

revoke all on function public.upsert_store_channel_settings_scoped(
  uuid,
  uuid,
  text,
  boolean,
  boolean,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text
) from public;
revoke all on function public.upsert_store_channel_settings_scoped(
  uuid,
  uuid,
  text,
  boolean,
  boolean,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text
) from anon;
revoke all on function public.upsert_store_channel_settings_scoped(
  uuid,
  uuid,
  text,
  boolean,
  boolean,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text
) from authenticated;
revoke all on function public.upsert_store_channel_settings_scoped(
  uuid,
  uuid,
  text,
  boolean,
  boolean,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text
) from service_role;

create or replace function public.upsert_store_channel_settings_with_legacy_mirror_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_channel_name text,
  p_commercial_receives_real_clients boolean,
  p_commercial_is_official_sales_channel boolean,
  p_commercial_channel_type text,
  p_commercial_entry_priority text,
  p_commercial_human_handoff_enabled boolean,
  p_commercial_channel_notes text default null,
  p_integration_provider_name text default null,
  p_integration_connection_mode text default null,
  p_integrations_notes text default null
)
returns public.store_channel_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_result public.store_channel_settings%rowtype;
begin
  v_result := public.upsert_store_channel_settings_scoped(
    p_organization_id,
    p_store_id,
    p_commercial_channel_name,
    p_commercial_receives_real_clients,
    p_commercial_is_official_sales_channel,
    p_commercial_channel_type,
    p_commercial_entry_priority,
    p_commercial_human_handoff_enabled,
    p_commercial_channel_notes,
    p_integration_provider_name,
    p_integration_connection_mode,
    p_integrations_notes
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'commercial_channel_name',
    p_answer => to_jsonb(coalesce(v_result.commercial_channel_name, ''))
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'commercial_receives_real_clients',
    p_answer => to_jsonb(
      case when v_result.commercial_receives_real_clients is true then 'Sim' else 'Não' end
    )
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'commercial_is_official_sales_channel',
    p_answer => to_jsonb(
      case when v_result.commercial_is_official_sales_channel is true then 'Sim' else 'Não' end
    )
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'commercial_channel_type',
    p_answer => to_jsonb(coalesce(v_result.commercial_channel_type, ''))
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'commercial_entry_priority',
    p_answer => to_jsonb(coalesce(v_result.commercial_entry_priority, ''))
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'commercial_human_handoff_enabled',
    p_answer => to_jsonb(
      case when v_result.commercial_human_handoff_enabled is true then 'Sim' else 'Não' end
    )
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'commercial_channel_notes',
    p_answer => to_jsonb(coalesce(v_result.commercial_channel_notes, ''))
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'integration_provider_name',
    p_answer => to_jsonb(coalesce(v_result.integration_provider_name, ''))
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'integration_connection_mode',
    p_answer => to_jsonb(coalesce(v_result.integration_connection_mode, ''))
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'integrations_notes',
    p_answer => to_jsonb(coalesce(v_result.integrations_notes, ''))
  );

  return v_result;
end;
$function$;

alter function public.upsert_store_channel_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text,
  boolean,
  boolean,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text
) owner to postgres;

revoke all on function public.upsert_store_channel_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text,
  boolean,
  boolean,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text
) from public;
revoke all on function public.upsert_store_channel_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text,
  boolean,
  boolean,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text
) from anon;
revoke all on function public.upsert_store_channel_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text,
  boolean,
  boolean,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text
) from authenticated;
revoke all on function public.upsert_store_channel_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text,
  boolean,
  boolean,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text
) from service_role;

grant execute on function public.upsert_store_channel_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text,
  boolean,
  boolean,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text
) to authenticated;

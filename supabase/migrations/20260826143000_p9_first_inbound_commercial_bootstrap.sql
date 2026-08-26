begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

-- --------------------------------------------------------------------------
-- Deterministic IDs are used only for bootstrap-created commercial entities.
-- Every seed is namespaced by entity kind and the tenant/store/context that
-- defines that entity. Identity/concurrency correctness does NOT rely on the
-- hash alone: canonical unique constraints and advisory locks remain the gate.
-- --------------------------------------------------------------------------
create or replace function public.p9_deterministic_uuid_from_text(p_seed text)
returns uuid
language plpgsql
immutable
strict
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_digest text;
begin
  v_digest := pg_catalog.md5(p_seed);

  return pg_catalog.lower(
    pg_catalog.substr(v_digest, 1, 8) || '-' ||
    pg_catalog.substr(v_digest, 9, 4) || '-' ||
    '5' || pg_catalog.substr(v_digest, 14, 3) || '-' ||
    'a' || pg_catalog.substr(v_digest, 18, 3) || '-' ||
    pg_catalog.substr(v_digest, 21, 12)
  )::uuid;
end;
$function$;

alter function public.p9_deterministic_uuid_from_text(text) owner to postgres;
revoke all on function public.p9_deterministic_uuid_from_text(text)
  from public, anon, authenticated, service_role;

comment on function public.p9_deterministic_uuid_from_text(text) is
  'Helper interno P9 para IDs determinísticos namespaced de bootstrap; não é autoridade de resolução de identidade.';

-- --------------------------------------------------------------------------
-- Resolve/cria o par lead + conversation para inbound WhatsApp.
--
-- Regras:
-- - serializa por organization + store + identidade de telefone recebida;
-- - 0 leads compatíveis -> cria exatamente um;
-- - 1 lead compatível -> reutiliza;
-- - >1 -> fail-closed, sem latest/first;
-- - 0 conversations ativas -> cria nova ativa; conversation fechada não reabre;
-- - 1 ativa -> reutiliza;
-- - >1 ativas -> fail-closed.
-- --------------------------------------------------------------------------
create or replace function public.resolve_whatsapp_inbound_thread_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_whatsapp_identity text,
  p_contact_name text default null
)
returns table (
  lead_id uuid,
  conversation_id uuid,
  normalized_whatsapp_identity text,
  thread_state text,
  lead_created boolean,
  conversation_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := public.lead_customer_link_request_role();
  v_digits text;
  v_contact_name text := nullif(pg_catalog.btrim(p_contact_name), '');
  v_lead_count bigint := 0;
  v_lead_id uuid := null;
  v_conversation_count bigint := 0;
  v_conversation_id uuid := null;
  v_lead_created boolean := false;
  v_conversation_created boolean := false;
begin
  if not (v_request_role = 'service_role' or session_user = 'postgres') then
    raise exception using errcode = '42501',
      message = 'whatsapp inbound thread resolution by system is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or nullif(pg_catalog.btrim(p_whatsapp_identity), '') is null then
    raise exception using errcode = '22004',
      message = 'whatsapp inbound thread resolution input is incomplete';
  end if;

  v_digits := pg_catalog.regexp_replace(p_whatsapp_identity, '[^0-9]+', '', 'g');
  if v_digits = '' then
    raise exception using errcode = '22023',
      message = 'whatsapp inbound identity has no digits';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception using errcode = '23514',
      message = 'whatsapp inbound thread store scope mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:whatsapp-inbound-thread:v1:' ||
      p_organization_id::text || ':' || p_store_id::text || ':' || v_digits,
      0
    )
  );

  select pg_catalog.count(*), pg_catalog.min(lead_row.id::text)::uuid
  into v_lead_count, v_lead_id
  from public.leads lead_row
  where lead_row.organization_id = p_organization_id
    and lead_row.store_id = p_store_id
    and lead_row.phone is not null
    and pg_catalog.regexp_replace(lead_row.phone, '[^0-9]+', '', 'g') = v_digits;

  if v_lead_count > 1 then
    raise exception using errcode = 'P0001',
      message = 'whatsapp inbound lead identity is ambiguous';
  end if;

  if v_lead_count = 0 then
    insert into public.leads (
      organization_id,
      store_id,
      phone,
      name
    ) values (
      p_organization_id,
      p_store_id,
      v_digits,
      coalesce(v_contact_name, 'Cliente WhatsApp')
    )
    returning id into v_lead_id;

    v_lead_created := true;
  end if;

  perform 1
  from public.leads lead_row
  where lead_row.id = v_lead_id
    and lead_row.organization_id = p_organization_id
    and lead_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using errcode = '23514',
      message = 'whatsapp inbound lead scope mismatch';
  end if;

  select pg_catalog.count(*), pg_catalog.min(conversation_row.id::text)::uuid
  into v_conversation_count, v_conversation_id
  from public.conversations conversation_row
  where conversation_row.organization_id = p_organization_id
    and conversation_row.lead_id = v_lead_id
    and conversation_row.status = 'active';

  if v_conversation_count > 1 then
    raise exception using errcode = 'P0001',
      message = 'whatsapp inbound active conversation is ambiguous';
  end if;

  if v_conversation_count = 0 then
    insert into public.conversations (
      organization_id,
      lead_id,
      status
    ) values (
      p_organization_id,
      v_lead_id,
      'active'
    )
    returning id into v_conversation_id;

    v_conversation_created := true;
  end if;

  return query
  select
    v_lead_id,
    v_conversation_id,
    v_digits,
    case
      when v_lead_created or v_conversation_created then 'created_active_thread'::text
      else 'existing_active_thread'::text
    end,
    v_lead_created,
    v_conversation_created;
end;
$function$;

alter function public.resolve_whatsapp_inbound_thread_by_system(uuid,uuid,text,text)
  owner to postgres;
revoke all on function public.resolve_whatsapp_inbound_thread_by_system(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_whatsapp_inbound_thread_by_system(uuid,uuid,text,text)
  to service_role;

comment on function public.resolve_whatsapp_inbound_thread_by_system(uuid,uuid,text,text) is
  'Resolve/cria lead+conversation ativa do inbound WhatsApp sem latest/first: múltiplos leads ou múltiplas conversations ativas fecham em fail-closed; conversation fechada não é reutilizada.';

-- --------------------------------------------------------------------------
-- Bootstrap de identidade comercial WhatsApp.
-- --------------------------------------------------------------------------
create or replace function public.bootstrap_commercial_identity_from_whatsapp_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_whatsapp_identity text,
  p_contact_name text default null
)
returns table (
  customer_id uuid,
  customer_channel_identity_id uuid,
  customer_store_link_id uuid,
  lead_customer_link_id uuid,
  normalized_whatsapp_identity text,
  bootstrap_state text,
  customer_created boolean,
  customer_channel_identity_created boolean,
  customer_store_link_created boolean,
  lead_customer_link_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := public.lead_customer_link_request_role();
  v_normalized_whatsapp_identity text;
  v_lead public.leads;
  v_conversation public.conversations;
  v_identity public.customer_channel_identities;
  v_customer public.customers;
  v_customer_store_link public.customer_store_links;
  v_lead_customer_link public.lead_customer_links;
  v_customer_id uuid;
  v_identity_id uuid;
  v_store_link_id uuid;
  v_contact_name text := nullif(pg_catalog.btrim(p_contact_name), '');
  v_customer_created boolean := false;
  v_identity_created boolean := false;
  v_store_link_created boolean := false;
  v_lead_link_created boolean := false;
begin
  if not (v_request_role = 'service_role' or session_user = 'postgres') then
    raise exception using errcode = '42501',
      message = 'commercial identity bootstrap by system is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_lead_id is null
     or p_conversation_id is null
     or nullif(pg_catalog.btrim(p_whatsapp_identity), '') is null then
    raise exception using errcode = '22004',
      message = 'commercial identity bootstrap by system input is incomplete';
  end if;

  v_normalized_whatsapp_identity :=
    public.normalize_br_whatsapp_identity(p_whatsapp_identity);

  if nullif(pg_catalog.btrim(v_normalized_whatsapp_identity), '') is null then
    raise exception using errcode = '22023',
      message = 'commercial identity bootstrap normalized WhatsApp identity is invalid';
  end if;

  -- customer_channel_identities is unique at organization+channel+identity,
  -- therefore the lock intentionally does NOT contain store_id.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:whatsapp-commercial-identity:v2:' ||
      p_organization_id::text || ':' || v_normalized_whatsapp_identity,
      0
    )
  );

  select lead_row.*
  into v_lead
  from public.leads lead_row
  where lead_row.id = p_lead_id
    and lead_row.organization_id = p_organization_id
    and lead_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using errcode = '23514',
      message = 'commercial identity bootstrap lead scope mismatch';
  end if;

  select conversation_row.*
  into v_conversation
  from public.conversations conversation_row
  where conversation_row.id = p_conversation_id
    and conversation_row.organization_id = p_organization_id
  for update;

  if not found or v_conversation.lead_id is distinct from p_lead_id then
    raise exception using errcode = '23514',
      message = 'commercial identity bootstrap conversation scope mismatch';
  end if;

  select identity_row.*
  into v_identity
  from public.customer_channel_identities identity_row
  where identity_row.organization_id = p_organization_id
    and identity_row.channel = 'whatsapp'
    and identity_row.normalized_external_identity = v_normalized_whatsapp_identity
  for update;

  if found then
    select customer_row.*
    into v_customer
    from public.customers customer_row
    where customer_row.id = v_identity.customer_id
      and customer_row.organization_id = p_organization_id
    for update;

    if not found or v_customer.merged_into_customer_id is not null then
      raise exception using errcode = '23514',
        message = 'commercial identity bootstrap matched an invalid or merged customer';
    end if;

    v_customer_id := v_customer.id;
    v_identity_id := v_identity.id;
  else
    v_customer_id := public.p9_deterministic_uuid_from_text(
      'zion:p9:first-inbound-customer:v2:' ||
      p_organization_id::text || ':' || v_normalized_whatsapp_identity
    );

    begin
      insert into public.customers (
        id,
        organization_id,
        display_name,
        normalized_name
      ) values (
        v_customer_id,
        p_organization_id,
        v_contact_name,
        case
          when v_contact_name is null then null::text
          else pg_catalog.lower(
            pg_catalog.regexp_replace(v_contact_name, '[[:space:]]+', ' ', 'g')
          )
        end
      )
      returning * into v_customer;
      v_customer_created := true;
    exception
      when unique_violation then
        select customer_row.*
        into v_customer
        from public.customers customer_row
        where customer_row.id = v_customer_id
          and customer_row.organization_id = p_organization_id
        for update;

        if not found or v_customer.merged_into_customer_id is not null then
          raise exception using errcode = '23514',
            message = 'commercial identity bootstrap customer conflict';
        end if;
    end;

    v_identity_id := public.p9_deterministic_uuid_from_text(
      'zion:p9:first-inbound-whatsapp-identity:v2:' ||
      p_organization_id::text || ':' || v_normalized_whatsapp_identity
    );

    begin
      insert into public.customer_channel_identities (
        id,
        organization_id,
        customer_id,
        channel,
        external_identity,
        normalized_external_identity,
        is_primary,
        verified_at
      ) values (
        v_identity_id,
        p_organization_id,
        v_customer_id,
        'whatsapp',
        p_whatsapp_identity,
        v_normalized_whatsapp_identity,
        true,
        null
      )
      returning * into v_identity;
      v_identity_created := true;
    exception
      when unique_violation then
        select identity_row.*
        into v_identity
        from public.customer_channel_identities identity_row
        where identity_row.organization_id = p_organization_id
          and identity_row.channel = 'whatsapp'
          and identity_row.normalized_external_identity = v_normalized_whatsapp_identity
        for update;

        if not found then
          raise;
        end if;

        -- Always use the canonical persisted identity id.
        v_identity_id := v_identity.id;

        if v_identity.customer_id is distinct from v_customer_id then
          select customer_row.*
          into v_customer
          from public.customers customer_row
          where customer_row.id = v_identity.customer_id
            and customer_row.organization_id = p_organization_id
          for update;

          if not found or v_customer.merged_into_customer_id is not null then
            raise exception using errcode = '23514',
              message = 'commercial identity bootstrap identity conflict';
          end if;

          -- This transaction may have created a deterministic customer before
          -- another canonical identity won the unique race. Remove only that
          -- unreferenced row created by this invocation, then converge to the
          -- persisted identity/customer pair.
          if v_customer_created then
            delete from public.customers customer_row
            where customer_row.id = v_customer_id
              and customer_row.organization_id = p_organization_id
              and not exists (
                select 1
                from public.customer_channel_identities existing_identity
                where existing_identity.customer_id = customer_row.id
                  and existing_identity.organization_id = p_organization_id
              )
              and not exists (
                select 1
                from public.customer_store_links existing_store_link
                where existing_store_link.customer_id = customer_row.id
                  and existing_store_link.organization_id = p_organization_id
              );
          end if;

          v_customer_id := v_customer.id;
          v_customer_created := false;
        end if;
    end;
  end if;

  select store_link_row.*
  into v_customer_store_link
  from public.customer_store_links store_link_row
  where store_link_row.organization_id = p_organization_id
    and store_link_row.store_id = p_store_id
    and store_link_row.customer_id = v_customer_id
  for update;

  if not found then
    v_store_link_id := public.p9_deterministic_uuid_from_text(
      'zion:p9:first-inbound-customer-store-link:v2:' ||
      p_organization_id::text || ':' || p_store_id::text || ':' || v_customer_id::text
    );

    begin
      insert into public.customer_store_links (
        id,
        organization_id,
        store_id,
        customer_id
      ) values (
        v_store_link_id,
        p_organization_id,
        p_store_id,
        v_customer_id
      )
      returning * into v_customer_store_link;
      v_store_link_created := true;
    exception
      when unique_violation then
        select store_link_row.*
        into v_customer_store_link
        from public.customer_store_links store_link_row
        where store_link_row.organization_id = p_organization_id
          and store_link_row.store_id = p_store_id
          and store_link_row.customer_id = v_customer_id
        for update;

        if not found then
          raise;
        end if;
    end;
  end if;

  select link_row.*
  into v_lead_customer_link
  from public.lead_customer_links link_row
  where link_row.organization_id = p_organization_id
    and link_row.store_id = p_store_id
    and link_row.lead_id = p_lead_id
    and link_row.status = 'active'
  for update;

  if found then
    if v_lead_customer_link.customer_id is distinct from v_customer_id then
      raise exception using errcode = '23514',
        message = 'commercial identity bootstrap found a conflicting active lead customer link';
    end if;
  else
    select link_row.*
    into v_lead_customer_link
    from public.link_lead_to_customer(
      p_organization_id => p_organization_id,
      p_store_id => p_store_id,
      p_lead_id => p_lead_id,
      p_customer_id => v_customer_id,
      p_source => 'whatsapp_identity',
      p_linked_by_actor_type => 'system',
      p_linked_by_user_id => null,
      p_source_identity_id => v_identity_id,
      p_source_reference => pg_catalog.format(
        'whatsapp_inbound_conversation:%s', p_conversation_id
      ),
      p_idempotency_key => pg_catalog.format(
        'zion:p9:first-inbound-lead-link:v2:%s:%s:%s:%s:%s',
        p_organization_id, p_store_id, p_lead_id, v_customer_id, v_identity_id
      ),
      p_correlation_id => p_conversation_id,
      p_metadata => pg_catalog.jsonb_build_object(
        'writer', 'bootstrap_commercial_identity_from_whatsapp_by_system',
        'normalized_whatsapp_identity', v_normalized_whatsapp_identity
      ),
      p_linked_at => null
    ) link_row;

    v_lead_link_created := true;
  end if;

  return query
  select
    v_customer_id,
    v_identity_id,
    v_customer_store_link.id,
    v_lead_customer_link.id,
    v_normalized_whatsapp_identity,
    'commercial_identity_bootstrapped'::text,
    v_customer_created,
    v_identity_created,
    v_store_link_created,
    v_lead_link_created;
end;
$function$;

alter function public.bootstrap_commercial_identity_from_whatsapp_by_system(uuid,uuid,uuid,uuid,text,text)
  owner to postgres;
revoke all on function public.bootstrap_commercial_identity_from_whatsapp_by_system(uuid,uuid,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bootstrap_commercial_identity_from_whatsapp_by_system(uuid,uuid,uuid,uuid,text,text)
  to service_role;

comment on function public.bootstrap_commercial_identity_from_whatsapp_by_system(uuid,uuid,uuid,uuid,text,text) is
  'Bootstrap system-only de customer, WhatsApp identity, customer_store_link e lead_customer_link, com escopo e idempotência explícitos.';

-- --------------------------------------------------------------------------
-- Writer contextual. Core is written atomically on INSERT and stays immutable.
-- --------------------------------------------------------------------------
create or replace function public.create_commercial_opportunity_with_context_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_customer_id uuid,
  p_commercial_opportunity_id uuid,
  p_origin_lead_id uuid default null,
  p_primary_conversation_id uuid default null
)
returns table (
  commercial_opportunity_id uuid,
  organization_id uuid,
  store_id uuid,
  customer_id uuid,
  origin_lead_id uuid,
  primary_conversation_id uuid,
  stage text,
  stage_changed_at timestamptz,
  lifecycle_cycle integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := public.lead_customer_link_request_role();
  v_existing public.commercial_opportunities;
  v_initial_stage text;
begin
  if not (v_request_role = 'service_role' or session_user = 'postgres') then
    raise exception using errcode = '42501',
      message = 'commercial opportunity contextual creation by system is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_customer_id is null
     or p_commercial_opportunity_id is null then
    raise exception using errcode = '22004',
      message = 'commercial opportunity contextual creation by system input is incomplete';
  end if;

  if p_primary_conversation_id is not null and p_origin_lead_id is null then
    raise exception using errcode = '22023',
      message = 'primary_conversation_id requires origin_lead_id';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:contextual-commercial-opportunity:v2:' ||
      p_organization_id::text || ':' || p_store_id::text || ':' ||
      p_commercial_opportunity_id::text,
      0
    )
  );

  select opportunity_row.*
  into v_existing
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if found then
    if v_existing.organization_id is distinct from p_organization_id
       or v_existing.store_id is distinct from p_store_id
       or v_existing.customer_id is distinct from p_customer_id
       or v_existing.origin_lead_id is distinct from p_origin_lead_id
       or v_existing.primary_conversation_id is distinct from p_primary_conversation_id then
      raise exception using errcode = '23514',
        message = 'commercial opportunity contextual payload mismatch';
    end if;

    return query
    select v_existing.id, v_existing.organization_id, v_existing.store_id,
      v_existing.customer_id, v_existing.origin_lead_id,
      v_existing.primary_conversation_id, v_existing.stage,
      v_existing.stage_changed_at, v_existing.lifecycle_cycle,
      v_existing.created_at, v_existing.updated_at;
    return;
  end if;

  if not exists (
    select 1 from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception using errcode = '23503',
      message = 'commercial opportunity store scope not found';
  end if;

  if not exists (
    select 1 from public.customers customer_row
    where customer_row.id = p_customer_id
      and customer_row.organization_id = p_organization_id
      and customer_row.merged_into_customer_id is null
  ) then
    raise exception using errcode = '23503',
      message = 'commercial opportunity customer scope not found';
  end if;

  if not exists (
    select 1 from public.customer_store_links customer_store_link_row
    where customer_store_link_row.organization_id = p_organization_id
      and customer_store_link_row.store_id = p_store_id
      and customer_store_link_row.customer_id = p_customer_id
  ) then
    raise exception using errcode = '23503',
      message = 'commercial opportunity customer store link not found';
  end if;

  if p_origin_lead_id is not null then
    perform 1
    from public.leads lead_row
    where lead_row.id = p_origin_lead_id
      and lead_row.organization_id = p_organization_id
      and lead_row.store_id = p_store_id
    for update;

    if not found then
      raise exception using errcode = '23514',
        message = 'commercial opportunity lead scope mismatch';
    end if;

    if not exists (
      select 1 from public.lead_customer_links lead_link_row
      where lead_link_row.organization_id = p_organization_id
        and lead_link_row.store_id = p_store_id
        and lead_link_row.lead_id = p_origin_lead_id
        and lead_link_row.customer_id = p_customer_id
        and lead_link_row.status = 'active'
        and lead_link_row.unlinked_at is null
    ) then
      raise exception using errcode = '23514',
        message = 'commercial opportunity active lead customer link not found';
    end if;
  end if;

  if p_primary_conversation_id is not null and not exists (
    select 1
    from public.conversations conversation_row
    where conversation_row.id = p_primary_conversation_id
      and conversation_row.organization_id = p_organization_id
      and conversation_row.lead_id = p_origin_lead_id
  ) then
    raise exception using errcode = '23514',
      message = 'commercial opportunity conversation scope mismatch';
  end if;

  v_initial_stage := public.normalize_commercial_opportunity_stage('novo_lead');

  begin
    insert into public.commercial_opportunities (
      id, organization_id, store_id, customer_id,
      origin_lead_id, primary_conversation_id, stage
    ) values (
      p_commercial_opportunity_id, p_organization_id, p_store_id, p_customer_id,
      p_origin_lead_id, p_primary_conversation_id, v_initial_stage
    )
    returning * into v_existing;
  exception
    when unique_violation then
      select opportunity_row.*
      into v_existing
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id = p_commercial_opportunity_id
      for update;

      if not found then raise; end if;

      if v_existing.organization_id is distinct from p_organization_id
         or v_existing.store_id is distinct from p_store_id
         or v_existing.customer_id is distinct from p_customer_id
         or v_existing.origin_lead_id is distinct from p_origin_lead_id
         or v_existing.primary_conversation_id is distinct from p_primary_conversation_id then
        raise exception using errcode = '23514',
          message = 'commercial opportunity contextual payload mismatch';
      end if;
  end;

  return query
  select v_existing.id, v_existing.organization_id, v_existing.store_id,
    v_existing.customer_id, v_existing.origin_lead_id,
    v_existing.primary_conversation_id, v_existing.stage,
    v_existing.stage_changed_at, v_existing.lifecycle_cycle,
    v_existing.created_at, v_existing.updated_at;
end;
$function$;

alter function public.create_commercial_opportunity_with_context_by_system(uuid,uuid,uuid,uuid,uuid,uuid)
  owner to postgres;
revoke all on function public.create_commercial_opportunity_with_context_by_system(uuid,uuid,uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_commercial_opportunity_with_context_by_system(uuid,uuid,uuid,uuid,uuid,uuid)
  to service_role;

comment on function public.create_commercial_opportunity_with_context_by_system(uuid,uuid,uuid,uuid,uuid,uuid) is
  'Writer system-only de opportunity contextual com origin_lead_id/primary_conversation_id persistidos no INSERT e replay-safe por opportunity_id.';

-- --------------------------------------------------------------------------
-- Orquestrador do primeiro contexto comercial.
--
-- Ordem de autoridade:
-- 1) active session + active commercial context já explícito;
-- 2) exatamente uma opportunity com core exato lead+conversation;
-- 3) zero histórico do customer NESTA store -> criar primeira opportunity;
-- 4) histórico sem contexto inequívoco -> retornar estado fail-closed sem
--    impedir a mensagem segura; Etapa 3.3 resolverá same/new intent.
-- --------------------------------------------------------------------------
create or replace function public.bootstrap_first_commercial_context_for_inbound_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_whatsapp_identity text,
  p_contact_name text default null
)
returns table (
  customer_id uuid,
  customer_channel_identity_id uuid,
  customer_store_link_id uuid,
  lead_customer_link_id uuid,
  commercial_opportunity_id uuid,
  normalized_whatsapp_identity text,
  bootstrap_state text,
  customer_created boolean,
  customer_channel_identity_created boolean,
  customer_store_link_created boolean,
  lead_customer_link_created boolean,
  commercial_opportunity_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := public.lead_customer_link_request_role();
  v_bootstrap record;
  v_existing_session public.conversation_sessions;
  v_existing_context public.commercial_session_context_links;
  v_existing_context_opportunity public.commercial_opportunities;
  v_contextual_count bigint := 0;
  v_customer_history_count bigint := 0;
  v_existing_contextual_opportunity_id uuid := null;
  v_contextual_opportunity record;
  v_first_opportunity_id uuid := null;
  v_state text;
  v_created_opportunity boolean := false;
begin
  if not (v_request_role = 'service_role' or session_user = 'postgres') then
    raise exception using errcode = '42501',
      message = 'first inbound commercial bootstrap by system is not authorized';
  end if;

  select * into v_bootstrap
  from public.bootstrap_commercial_identity_from_whatsapp_by_system(
    p_organization_id, p_store_id, p_lead_id, p_conversation_id,
    p_whatsapp_identity, p_contact_name
  );

  -- Serialize the semantic decision "does this customer in this store have
  -- zero commercial history?" independently of lead/conversation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:first-commercial-opportunity-per-store:v2:' ||
      p_organization_id::text || ':' || p_store_id::text || ':' ||
      v_bootstrap.customer_id::text,
      0
    )
  );

  -- Active commercial context is already an explicit decision and has priority
  -- over historical opportunities that may share the same conversation.
  select session_row.*
  into v_existing_session
  from public.conversation_sessions session_row
  where session_row.organization_id = p_organization_id
    and session_row.store_id = p_store_id
    and session_row.conversation_id = p_conversation_id
    and session_row.status = 'active'
  for update;

  if found then
    select context_row.*
    into v_existing_context
    from public.commercial_session_context_links context_row
    where context_row.organization_id = p_organization_id
      and context_row.store_id = p_store_id
      and context_row.conversation_session_id = v_existing_session.id
      and context_row.status = 'active'
    for update;

    if found then
      if v_existing_context.customer_id is distinct from v_bootstrap.customer_id
         or v_existing_context.lead_customer_link_id is distinct from v_bootstrap.lead_customer_link_id then
        raise exception using errcode = '23514',
          message = 'active commercial context identity mismatch';
      end if;

      select opportunity_row.*
      into v_existing_context_opportunity
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id = v_existing_context.commercial_opportunity_id
        and opportunity_row.organization_id = p_organization_id
        and opportunity_row.store_id = p_store_id
        and opportunity_row.customer_id = v_bootstrap.customer_id;

      if not found then
        raise exception using errcode = '23514',
          message = 'active commercial context opportunity scope mismatch';
      end if;

      return query
      select
        v_bootstrap.customer_id,
        v_bootstrap.customer_channel_identity_id,
        v_bootstrap.customer_store_link_id,
        v_bootstrap.lead_customer_link_id,
        v_existing_context.commercial_opportunity_id,
        v_bootstrap.normalized_whatsapp_identity,
        'existing_active_commercial_context'::text,
        v_bootstrap.customer_created,
        v_bootstrap.customer_channel_identity_created,
        v_bootstrap.customer_store_link_created,
        v_bootstrap.lead_customer_link_created,
        false;
      return;
    end if;
  end if;

  select pg_catalog.count(*), pg_catalog.min(opportunity_row.id::text)::uuid
  into v_contextual_count, v_existing_contextual_opportunity_id
  from public.commercial_opportunities opportunity_row
  where opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
    and opportunity_row.customer_id = v_bootstrap.customer_id
    and opportunity_row.origin_lead_id = p_lead_id
    and opportunity_row.primary_conversation_id = p_conversation_id;

  if v_contextual_count > 1 then
    v_first_opportunity_id := null;
    v_state := 'commercial_opportunity_exact_context_ambiguous';
  elsif v_contextual_count = 1 then
    v_first_opportunity_id := v_existing_contextual_opportunity_id;
    v_state := 'existing_contextual_opportunity';
  else
    select pg_catalog.count(*)
    into v_customer_history_count
    from public.commercial_opportunities opportunity_row
    where opportunity_row.organization_id = p_organization_id
      and opportunity_row.store_id = p_store_id
      and opportunity_row.customer_id = v_bootstrap.customer_id;

    if v_customer_history_count = 0 then
      v_first_opportunity_id := public.p9_deterministic_uuid_from_text(
        'zion:p9:first-contextual-opportunity:v2:' ||
        p_organization_id::text || ':' || p_store_id::text || ':' ||
        v_bootstrap.customer_id::text || ':' || p_lead_id::text || ':' ||
        p_conversation_id::text
      );

      select * into v_contextual_opportunity
      from public.create_commercial_opportunity_with_context_by_system(
        p_organization_id, p_store_id, v_bootstrap.customer_id,
        v_first_opportunity_id, p_lead_id, p_conversation_id
      );

      v_created_opportunity := true;
      v_state := 'created_first_contextual_opportunity';
    else
      v_first_opportunity_id := null;
      v_state := 'historical_context_requires_manual_resolution';
    end if;
  end if;

  return query
  select
    v_bootstrap.customer_id,
    v_bootstrap.customer_channel_identity_id,
    v_bootstrap.customer_store_link_id,
    v_bootstrap.lead_customer_link_id,
    v_first_opportunity_id,
    v_bootstrap.normalized_whatsapp_identity,
    v_state,
    v_bootstrap.customer_created,
    v_bootstrap.customer_channel_identity_created,
    v_bootstrap.customer_store_link_created,
    v_bootstrap.lead_customer_link_created,
    v_created_opportunity;
end;
$function$;

alter function public.bootstrap_first_commercial_context_for_inbound_by_system(uuid,uuid,uuid,uuid,text,text)
  owner to postgres;
revoke all on function public.bootstrap_first_commercial_context_for_inbound_by_system(uuid,uuid,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bootstrap_first_commercial_context_for_inbound_by_system(uuid,uuid,uuid,uuid,text,text)
  to service_role;

comment on function public.bootstrap_first_commercial_context_for_inbound_by_system(uuid,uuid,uuid,uuid,text,text) is
  'Orquestra identidade e primeiro contexto comercial do inbound: active context vence histórico; primeira opportunity só nasce com zero histórico por organization+store+customer; ambiguidades retornam estado seguro sem latest/first.';

commit;

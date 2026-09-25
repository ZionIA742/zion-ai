begin;



set local lock_timeout = '5s';

set local statement_timeout = '300s';

set local idle_in_transaction_session_timeout = '300s';

set local search_path = pg_catalog, pg_temp, public;



do $preflight$

begin

  if pg_catalog.to_regclass('public.external_integrations') is null then

    raise exception using

      errcode = 'P0001',

      message = 'external_integrations table is required';

  end if;



  if pg_catalog.to_regclass('public.stores') is null then

    raise exception using

      errcode = 'P0001',

      message = 'stores table is required';

  end if;



  if not exists (

    select 1

    from pg_catalog.pg_indexes index_row

    where index_row.schemaname = 'public'

      and index_row.tablename = 'external_integrations'

      and index_row.indexname = 'uq_external_integrations_store_provider'

      and index_row.indexdef ilike '%unique%'

      and index_row.indexdef ilike '%store_id%'

      and index_row.indexdef ilike '%provider%'

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'uq_external_integrations_store_provider is required';

  end if;

end;

$preflight$;



create unique index if not exists external_integrations_whatsapp_phone_number_uidx

on public.external_integrations (phone_number_id)

where provider = 'whatsapp'

  and phone_number_id is not null;



create or replace function public.materialize_store_whatsapp_embedded_signup_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_whatsapp_business_account_id text,

  p_phone_number_id text,

  p_display_phone_number text,

  p_access_token text,

  p_meta_graph_api_version text default null,

  p_meta_app_id text default null,

  p_validated_at timestamptz default now()

)

returns table (

  integration_id uuid,

  outcome text,

  provider text,

  status text,

  is_active boolean,

  phone_number_id text,

  whatsapp_business_account_id text,

  display_phone_number text

)

language plpgsql

set search_path = pg_catalog, pg_temp, public

as $function$

declare

  v_provider constant text := 'whatsapp';

  v_waba_id text := nullif(pg_catalog.btrim(coalesce(p_whatsapp_business_account_id, '')), '');

  v_phone_number_id text := nullif(pg_catalog.btrim(coalesce(p_phone_number_id, '')), '');

  v_display_phone_number text := nullif(pg_catalog.btrim(coalesce(p_display_phone_number, '')), '');

  v_access_token text := nullif(pg_catalog.btrim(coalesce(p_access_token, '')), '');

  v_meta_graph_api_version text := nullif(pg_catalog.btrim(coalesce(p_meta_graph_api_version, '')), '');

  v_meta_app_id text := nullif(pg_catalog.btrim(coalesce(p_meta_app_id, '')), '');

  v_validated_at timestamptz := coalesce(p_validated_at, pg_catalog.clock_timestamp());

  v_current public.external_integrations%rowtype;

  v_result public.external_integrations%rowtype;

  v_existing_waba text;

  v_existing_phone text;

  v_existing_display text;

  v_existing_token text;

  v_legacy_metadata boolean;

  v_safe_metadata jsonb;

  v_next_metadata jsonb;

  v_outcome text;

begin

  if p_organization_id is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_ORGANIZATION_REQUIRED';

  end if;



  if p_store_id is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_STORE_REQUIRED';

  end if;



  if v_waba_id is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_WABA_REQUIRED';

  end if;



  if v_phone_number_id is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_PHONE_REQUIRED';

  end if;



  if v_display_phone_number is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_DISPLAY_PHONE_REQUIRED';

  end if;



  if v_access_token is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_ACCESS_TOKEN_REQUIRED';

  end if;



  perform 1

  from public.stores store_row

  where store_row.id = p_store_id

    and store_row.organization_id = p_organization_id

  for key share;



  if not found then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_STORE_SCOPE_MISMATCH';

  end if;



  perform 1

  from public.external_integrations integration_row

  where integration_row.provider = v_provider

    and integration_row.phone_number_id = v_phone_number_id

    and (

      integration_row.store_id is distinct from p_store_id

      or integration_row.organization_id is distinct from p_organization_id

    )

  for key share;



  if found then

    raise exception using

      errcode = '23505',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_PHONE_ALREADY_BOUND';

  end if;



  select integration_row.*

  into v_current

  from public.external_integrations integration_row

  where integration_row.store_id = p_store_id

    and integration_row.provider = v_provider

  for update;



  if found then

    if v_current.organization_id is distinct from p_organization_id then

      raise exception using

        errcode = '23514',

        message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_EXISTING_SCOPE_MISMATCH';

    end if;



    v_existing_waba := nullif(pg_catalog.btrim(coalesce(v_current.whatsapp_business_account_id, '')), '');

    v_existing_phone := nullif(pg_catalog.btrim(coalesce(v_current.phone_number_id, '')), '');

    v_existing_display := nullif(pg_catalog.btrim(coalesce(v_current.display_phone_number, '')), '');

    v_existing_token := nullif(pg_catalog.btrim(coalesce(v_current.access_token, '')), '');

    v_legacy_metadata :=

      coalesce(v_current.metadata, '{}'::jsonb) ->> 'activation_mode' = 'manual_assisted_setup'

      or coalesce(v_current.metadata, '{}'::jsonb) ->> 'token_storage' = 'server_env_for_pilot';



    if v_existing_waba is null then

      raise exception using

        errcode = '23514',

        message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_EXISTING_WABA_REQUIRED';

    end if;



    if v_existing_waba <> v_waba_id then

      raise exception using

        errcode = '23514',

        message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_WABA_MISMATCH';

    end if;



    if v_existing_phone is not distinct from v_phone_number_id then

      if v_existing_token is not distinct from v_access_token

         and v_existing_display is not distinct from v_display_phone_number

         and coalesce(v_current.status, '') = 'active'

         and v_current.is_active is true then

        v_outcome := 'idempotent_replay';

      else

        v_outcome := 'reconnected';

      end if;

    elsif v_existing_token is null

       and coalesce(v_current.status, '') = 'active'

       and v_current.is_active is true

       and v_legacy_metadata

       and v_existing_waba = v_waba_id then

      v_outcome := 'legacy_converted';

    else

      raise exception using

        errcode = '23514',

        message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_PHONE_CHANGE_REQUIRES_SAFE_FLOW';

    end if;



    -- Preserve only explicitly approved non-secret audit/business fields.
    -- Do not carry arbitrary legacy metadata forward: nested or differently named
    -- credentials must not survive the migration into Embedded Signup.
    v_safe_metadata :=

      pg_catalog.jsonb_strip_nulls(

        pg_catalog.jsonb_build_object(

          'payment_status', coalesce(v_current.metadata, '{}'::jsonb) -> 'payment_status',

          'channel_purpose', coalesce(v_current.metadata, '{}'::jsonb) -> 'channel_purpose',

          'number_scenario', coalesce(v_current.metadata, '{}'::jsonb) -> 'number_scenario',

          'converted_from_manual_pilot', coalesce(v_current.metadata, '{}'::jsonb) -> 'converted_from_manual_pilot',

          'previous_phone_number_id', coalesce(v_current.metadata, '{}'::jsonb) -> 'previous_phone_number_id',

          'previous_display_phone_number', coalesce(v_current.metadata, '{}'::jsonb) -> 'previous_display_phone_number'

        )

      );



    v_next_metadata :=

      pg_catalog.jsonb_strip_nulls(

        v_safe_metadata

        || pg_catalog.jsonb_build_object(

          'source', 'meta_whatsapp_embedded_signup',

          'token_storage', 'external_integrations.access_token',

          'activation_mode', 'embedded_signup',

          'embedded_signup_version', 'v4',

          'meta_graph_api_version', v_meta_graph_api_version,

          'meta_app_id', v_meta_app_id,

          'validated_at', v_validated_at

        )

        || case

          when v_outcome = 'legacy_converted' then

            pg_catalog.jsonb_build_object(

              'converted_from_manual_pilot', true,

              'previous_phone_number_id', v_existing_phone,

              'previous_display_phone_number', v_existing_display

            )

          else '{}'::jsonb

        end

      );



    update public.external_integrations

    set whatsapp_business_account_id = v_waba_id,

        phone_number_id = v_phone_number_id,

        display_phone_number = v_display_phone_number,

        access_token = v_access_token,

        status = 'active',

        is_active = true,

        last_error = null,

        metadata = v_next_metadata,

        updated_at = pg_catalog.clock_timestamp()

    where id = v_current.id

    returning *

    into v_result;

  else

    v_outcome := 'inserted';

    v_next_metadata :=

      pg_catalog.jsonb_strip_nulls(

        pg_catalog.jsonb_build_object(

          'source', 'meta_whatsapp_embedded_signup',

          'token_storage', 'external_integrations.access_token',

          'activation_mode', 'embedded_signup',

          'embedded_signup_version', 'v4',

          'meta_graph_api_version', v_meta_graph_api_version,

          'meta_app_id', v_meta_app_id,

          'validated_at', v_validated_at

        )

      );



    begin

      insert into public.external_integrations (

        id,

        organization_id,

        store_id,

        provider,

        status,

        is_active,

        display_phone_number,

        phone_number_id,

        whatsapp_business_account_id,

        access_token,

        last_error,

        metadata,

        updated_at

      )

      values (

        pg_catalog.gen_random_uuid(),

        p_organization_id,

        p_store_id,

        v_provider,

        'active',

        true,

        v_display_phone_number,

        v_phone_number_id,

        v_waba_id,

        v_access_token,

        null,

        v_next_metadata,

        pg_catalog.clock_timestamp()

      )

      returning *

      into v_result;

    exception

      when unique_violation then

        raise exception using

          errcode = '23505',

          message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_CONCURRENT_CONFLICT';

    end;

  end if;



  return query

  select

    v_result.id,

    v_outcome,

    v_result.provider,

    v_result.status,

    v_result.is_active,

    v_result.phone_number_id,

    v_result.whatsapp_business_account_id,

    v_result.display_phone_number;

end;

$function$;



alter function public.materialize_store_whatsapp_embedded_signup_by_system(

  uuid,

  uuid,

  text,

  text,

  text,

  text,

  text,

  text,

  timestamptz

) owner to postgres;



revoke all on function public.materialize_store_whatsapp_embedded_signup_by_system(

  uuid,

  uuid,

  text,

  text,

  text,

  text,

  text,

  text,

  timestamptz

) from public, anon, authenticated;



grant execute on function public.materialize_store_whatsapp_embedded_signup_by_system(

  uuid,

  uuid,

  text,

  text,

  text,

  text,

  text,

  text,

  timestamptz

) to service_role;



comment on function public.materialize_store_whatsapp_embedded_signup_by_system(

  uuid,

  uuid,

  text,

  text,

  text,

  text,

  text,

  text,

  timestamptz

) is

  'P19-A Meta WhatsApp Embedded Signup server-only writer. Materializes the single operational WhatsApp integration per store in external_integrations without returning secrets.';



commit;
begin;



set local lock_timeout = '5s';

set local statement_timeout = '300s';

set local idle_in_transaction_session_timeout = '300s';

set local search_path = pg_catalog, pg_temp, public;



do $preflight$

begin

  if pg_catalog.to_regclass('public.external_integrations') is null then

    raise exception using

      errcode = 'P0001',

      message = 'external_integrations table is required';

  end if;



  if pg_catalog.to_regclass('public.stores') is null then

    raise exception using

      errcode = 'P0001',

      message = 'stores table is required';

  end if;



  if not exists (

    select 1

    from pg_catalog.pg_indexes index_row

    where index_row.schemaname = 'public'

      and index_row.tablename = 'external_integrations'

      and index_row.indexname = 'uq_external_integrations_store_provider'

      and index_row.indexdef ilike '%unique%'

      and index_row.indexdef ilike '%store_id%'

      and index_row.indexdef ilike '%provider%'

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'uq_external_integrations_store_provider is required';

  end if;

end;

$preflight$;



create unique index if not exists external_integrations_whatsapp_phone_number_uidx

on public.external_integrations (phone_number_id)

where provider = 'whatsapp'

  and phone_number_id is not null;



create or replace function public.materialize_store_whatsapp_embedded_signup_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_whatsapp_business_account_id text,

  p_phone_number_id text,

  p_display_phone_number text,

  p_access_token text,

  p_meta_graph_api_version text default null,

  p_meta_app_id text default null,

  p_validated_at timestamptz default now()

)

returns table (

  integration_id uuid,

  outcome text,

  provider text,

  status text,

  is_active boolean,

  phone_number_id text,

  whatsapp_business_account_id text,

  display_phone_number text

)

language plpgsql

set search_path = pg_catalog, pg_temp, public

as $function$

declare

  v_provider constant text := 'whatsapp';

  v_waba_id text := nullif(pg_catalog.btrim(coalesce(p_whatsapp_business_account_id, '')), '');

  v_phone_number_id text := nullif(pg_catalog.btrim(coalesce(p_phone_number_id, '')), '');

  v_display_phone_number text := nullif(pg_catalog.btrim(coalesce(p_display_phone_number, '')), '');

  v_access_token text := nullif(pg_catalog.btrim(coalesce(p_access_token, '')), '');

  v_meta_graph_api_version text := nullif(pg_catalog.btrim(coalesce(p_meta_graph_api_version, '')), '');

  v_meta_app_id text := nullif(pg_catalog.btrim(coalesce(p_meta_app_id, '')), '');

  v_validated_at timestamptz := coalesce(p_validated_at, pg_catalog.clock_timestamp());

  v_current public.external_integrations%rowtype;

  v_result public.external_integrations%rowtype;

  v_existing_waba text;

  v_existing_phone text;

  v_existing_display text;

  v_existing_token text;

  v_legacy_metadata boolean;

  v_safe_metadata jsonb;

  v_next_metadata jsonb;

  v_outcome text;

begin

  if p_organization_id is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_ORGANIZATION_REQUIRED';

  end if;



  if p_store_id is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_STORE_REQUIRED';

  end if;



  if v_waba_id is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_WABA_REQUIRED';

  end if;



  if v_phone_number_id is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_PHONE_REQUIRED';

  end if;



  if v_display_phone_number is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_DISPLAY_PHONE_REQUIRED';

  end if;



  if v_access_token is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_ACCESS_TOKEN_REQUIRED';

  end if;



  perform 1

  from public.stores store_row

  where store_row.id = p_store_id

    and store_row.organization_id = p_organization_id

  for key share;



  if not found then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_STORE_SCOPE_MISMATCH';

  end if;



  perform 1

  from public.external_integrations integration_row

  where integration_row.provider = v_provider

    and integration_row.phone_number_id = v_phone_number_id

    and (

      integration_row.store_id is distinct from p_store_id

      or integration_row.organization_id is distinct from p_organization_id

    )

  for key share;



  if found then

    raise exception using

      errcode = '23505',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_PHONE_ALREADY_BOUND';

  end if;



  select integration_row.*

  into v_current

  from public.external_integrations integration_row

  where integration_row.store_id = p_store_id

    and integration_row.provider = v_provider

  for update;



  if found then

    if v_current.organization_id is distinct from p_organization_id then

      raise exception using

        errcode = '23514',

        message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_EXISTING_SCOPE_MISMATCH';

    end if;



    v_existing_waba := nullif(pg_catalog.btrim(coalesce(v_current.whatsapp_business_account_id, '')), '');

    v_existing_phone := nullif(pg_catalog.btrim(coalesce(v_current.phone_number_id, '')), '');

    v_existing_display := nullif(pg_catalog.btrim(coalesce(v_current.display_phone_number, '')), '');

    v_existing_token := nullif(pg_catalog.btrim(coalesce(v_current.access_token, '')), '');

    v_legacy_metadata :=

      coalesce(v_current.metadata, '{}'::jsonb) ->> 'activation_mode' = 'manual_assisted_setup'

      or coalesce(v_current.metadata, '{}'::jsonb) ->> 'token_storage' = 'server_env_for_pilot';



    if v_existing_waba is null then

      raise exception using

        errcode = '23514',

        message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_EXISTING_WABA_REQUIRED';

    end if;



    if v_existing_waba <> v_waba_id then

      raise exception using

        errcode = '23514',

        message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_WABA_MISMATCH';

    end if;



    if v_existing_phone is not distinct from v_phone_number_id then

      if v_existing_token is not distinct from v_access_token

         and v_existing_display is not distinct from v_display_phone_number

         and coalesce(v_current.status, '') = 'active'

         and v_current.is_active is true then

        v_outcome := 'idempotent_replay';

      else

        v_outcome := 'reconnected';

      end if;

    elsif v_existing_token is null

       and coalesce(v_current.status, '') = 'active'

       and v_current.is_active is true

       and v_legacy_metadata

       and v_existing_waba = v_waba_id then

      v_outcome := 'legacy_converted';

    else

      raise exception using

        errcode = '23514',

        message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_PHONE_CHANGE_REQUIRES_SAFE_FLOW';

    end if;



    -- Preserve only explicitly approved non-secret audit/business fields.
    -- Do not carry arbitrary legacy metadata forward: nested or differently named
    -- credentials must not survive the migration into Embedded Signup.
    v_safe_metadata :=

      pg_catalog.jsonb_strip_nulls(

        pg_catalog.jsonb_build_object(

          'payment_status', coalesce(v_current.metadata, '{}'::jsonb) -> 'payment_status',

          'channel_purpose', coalesce(v_current.metadata, '{}'::jsonb) -> 'channel_purpose',

          'number_scenario', coalesce(v_current.metadata, '{}'::jsonb) -> 'number_scenario',

          'converted_from_manual_pilot', coalesce(v_current.metadata, '{}'::jsonb) -> 'converted_from_manual_pilot',

          'previous_phone_number_id', coalesce(v_current.metadata, '{}'::jsonb) -> 'previous_phone_number_id',

          'previous_display_phone_number', coalesce(v_current.metadata, '{}'::jsonb) -> 'previous_display_phone_number'

        )

      );



    v_next_metadata :=

      pg_catalog.jsonb_strip_nulls(

        v_safe_metadata

        || pg_catalog.jsonb_build_object(

          'source', 'meta_whatsapp_embedded_signup',

          'token_storage', 'external_integrations.access_token',

          'activation_mode', 'embedded_signup',

          'embedded_signup_version', 'v4',

          'meta_graph_api_version', v_meta_graph_api_version,

          'meta_app_id', v_meta_app_id,

          'validated_at', v_validated_at

        )

        || case

          when v_outcome = 'legacy_converted' then

            pg_catalog.jsonb_build_object(

              'converted_from_manual_pilot', true,

              'previous_phone_number_id', v_existing_phone,

              'previous_display_phone_number', v_existing_display

            )

          else '{}'::jsonb

        end

      );



    update public.external_integrations

    set whatsapp_business_account_id = v_waba_id,

        phone_number_id = v_phone_number_id,

        display_phone_number = v_display_phone_number,

        access_token = v_access_token,

        status = 'active',

        is_active = true,

        last_error = null,

        metadata = v_next_metadata,

        updated_at = pg_catalog.clock_timestamp()

    where id = v_current.id

    returning *

    into v_result;

  else

    v_outcome := 'inserted';

    v_next_metadata :=

      pg_catalog.jsonb_strip_nulls(

        pg_catalog.jsonb_build_object(

          'source', 'meta_whatsapp_embedded_signup',

          'token_storage', 'external_integrations.access_token',

          'activation_mode', 'embedded_signup',

          'embedded_signup_version', 'v4',

          'meta_graph_api_version', v_meta_graph_api_version,

          'meta_app_id', v_meta_app_id,

          'validated_at', v_validated_at

        )

      );



    begin

      insert into public.external_integrations (

        id,

        organization_id,

        store_id,

        provider,

        status,

        is_active,

        display_phone_number,

        phone_number_id,

        whatsapp_business_account_id,

        access_token,

        last_error,

        metadata,

        updated_at

      )

      values (

        pg_catalog.gen_random_uuid(),

        p_organization_id,

        p_store_id,

        v_provider,

        'active',

        true,

        v_display_phone_number,

        v_phone_number_id,

        v_waba_id,

        v_access_token,

        null,

        v_next_metadata,

        pg_catalog.clock_timestamp()

      )

      returning *

      into v_result;

    exception

      when unique_violation then

        raise exception using

          errcode = '23505',

          message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_CONCURRENT_CONFLICT';

    end;

  end if;



  return query

  select

    v_result.id,

    v_outcome,

    v_result.provider,

    v_result.status,

    v_result.is_active,

    v_result.phone_number_id,

    v_result.whatsapp_business_account_id,

    v_result.display_phone_number;

end;

$function$;



alter function public.materialize_store_whatsapp_embedded_signup_by_system(

  uuid,

  uuid,

  text,

  text,

  text,

  text,

  text,

  text,

  timestamptz

) owner to postgres;



revoke all on function public.materialize_store_whatsapp_embedded_signup_by_system(

  uuid,

  uuid,

  text,

  text,

  text,

  text,

  text,

  text,

  timestamptz

) from public, anon, authenticated;



grant execute on function public.materialize_store_whatsapp_embedded_signup_by_system(

  uuid,

  uuid,

  text,

  text,

  text,

  text,

  text,

  text,

  timestamptz

) to service_role;



comment on function public.materialize_store_whatsapp_embedded_signup_by_system(

  uuid,

  uuid,

  text,

  text,

  text,

  text,

  text,

  text,

  timestamptz

) is

  'P19-A Meta WhatsApp Embedded Signup server-only writer. Materializes the single operational WhatsApp integration per store in external_integrations without returning secrets.';



commit;

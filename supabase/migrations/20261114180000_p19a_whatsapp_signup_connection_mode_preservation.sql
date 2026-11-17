begin;

-- P19-A 6.1-E
-- Preserva a modalidade canonica existente durante replays e recovery.
-- Nao classifica registros antigos sem connection_mode.
-- Nao altera identificadores, PIN ou modo de ativacao.

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
          'connection_mode',
            case
              when coalesce(v_current.metadata, '{}'::jsonb) ->> 'connection_mode'
                in ('standard', 'business_app_coexistence')
              then coalesce(v_current.metadata, '{}'::jsonb) -> 'connection_mode'
              else null
            end,

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
  uuid, uuid, text, text, text, text, text, text, timestamptz
) owner to postgres;

revoke all on function public.materialize_store_whatsapp_embedded_signup_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;

-- Recovery must never create a new integration through the legacy materializer.
-- The existing integration and its canonical mode are locked before the legacy
-- writer is called, so valid replays remain idempotent while unclassified
-- bindings fail closed.
create or replace function public.materialize_store_whatsapp_pin_recovery_by_system(
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
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_current public.external_integrations%rowtype;
  v_mode text;
begin
  select integration_row.*
    into v_current
    from public.external_integrations integration_row
   where integration_row.organization_id = p_organization_id
     and integration_row.store_id = p_store_id
     and integration_row.provider = 'whatsapp'
     and integration_row.phone_number_id = pg_catalog.btrim(p_phone_number_id)
   for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'ZION_WHATSAPP_PIN_RECOVERY_INTEGRATION_REQUIRED';
  end if;

  v_mode := nullif(pg_catalog.btrim(coalesce(v_current.metadata ->> 'connection_mode', '')), '');
  if v_mode is null or v_mode not in ('standard', 'business_app_coexistence') then
    raise exception using
      errcode = '23514',
      message = 'ZION_WHATSAPP_PIN_RECOVERY_CONNECTION_MODE_REQUIRED';
  end if;

  -- A recuperacao da Cloud API convencional nao pode promover uma conexao
  -- enquanto a ativacao atomica do PIN ainda estiver pendente. Reutiliza o
  -- materializador pendente, que preserva is_active=false e a pendencia no
  -- mesmo escopo transacional, sem modificar o fluxo de coexistencia.
  if v_mode = 'standard'
     and v_current.metadata ->> 'pin_activation_pending' = 'true' then
    return query
    select *
      from public.materialize_store_whatsapp_signup_pending_pin_by_system(
        p_organization_id,
        p_store_id,
        p_whatsapp_business_account_id,
        p_phone_number_id,
        p_display_phone_number,
        p_access_token,
        p_meta_graph_api_version,
        p_meta_app_id,
        p_validated_at
      );
    return;
  end if;

  return query
  select *
    from public.materialize_store_whatsapp_embedded_signup_by_system(
      p_organization_id,
      p_store_id,
      p_whatsapp_business_account_id,
      p_phone_number_id,
      p_display_phone_number,
      p_access_token,
      p_meta_graph_api_version,
      p_meta_app_id,
      p_validated_at
    );
end;
$function$;

alter function public.materialize_store_whatsapp_pin_recovery_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) owner to postgres;

revoke all on function public.materialize_store_whatsapp_pin_recovery_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.materialize_store_whatsapp_pin_recovery_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) to service_role;


-- A funcao de finalizacao ja existe no Supabase e foi inspecionada via
-- pg_get_functiondef em 2026-11-16. Nunca sobrescrever uma versao divergente.
-- Fingerprint ignora apenas espacos em branco e usa SHA-256 do corpo completo.
do $zion_recovery_finalizer_source_guard$
declare
  v_oid oid;
  v_actual text;
begin
  v_oid := pg_catalog.to_regprocedure(
    'public.finalize_whatsapp_pin_recovery_materialization_by_system(uuid,uuid,uuid,uuid,text,text,text,timestamptz)'
  );
  if v_oid is null then
    raise exception using errcode='55000',
      message='ZION_PIN_RECOVERY_FINALIZER_SOURCE_NOT_FOUND';
  end if;
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(v_oid), '[[:space:]]+', '', 'g'),
    'UTF8')), 'hex')
  into v_actual;
  if v_actual is distinct from 'b772a7bbe386026ca0ed4d0e7682202c2f21ca3f2cff681471aa1a60f613b161' then
    raise exception using errcode='55000',
      message='ZION_PIN_RECOVERY_FINALIZER_SOURCE_DRIFT';
  end if;
end;
$zion_recovery_finalizer_source_guard$;

-- Redefinicao cirurgica: conserva validacoes de sessao, tentativa, token,
-- WABA e segredo pendente; altera somente a verificacao de integracao ativa.
CREATE OR REPLACE FUNCTION public.finalize_whatsapp_pin_recovery_materialization_by_system(p_attempt_id uuid, p_operation_id uuid, p_actor_user_id uuid, p_integration_id uuid, p_access_token_fingerprint text, p_meta_graph_api_version text, p_meta_app_id text, p_validated_at timestamp with time zone)
 RETURNS TABLE(attempt_id uuid, status text, integration_id uuid, replacement_secret_id uuid, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.whatsapp_pin_recovery_attempts%ROWTYPE;
        e public.external_integrations%ROWTYPE;
        v_activation record;
        v_waba text;
        v_expected_fingerprint text;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
    END IF;
    SELECT * INTO v FROM public.whatsapp_pin_recovery_attempts a
    WHERE a.id=p_attempt_id FOR UPDATE;
    IF NOT FOUND OR v.operation_id IS DISTINCT FROM p_operation_id
       OR v.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_FINALIZATION_SCOPE_INVALID' USING ERRCODE='42501';
    END IF;
    IF v.status='completed' THEN
        IF v.integration_id IS DISTINCT FROM p_integration_id THEN
            RAISE EXCEPTION 'ZION_PIN_RECOVERY_FINALIZATION_REPLAY_CONFLICT' USING ERRCODE='23505';
        END IF;
        RETURN QUERY SELECT v.id,v.status,v.integration_id,v.replacement_secret_id,'idempotent_replay'::text;
        RETURN;
    END IF;
    v_expected_fingerprint := coalesce(v.materialization_token_fingerprint,
                                       v.access_token_fingerprint);
    IF v.status <> 'remote_confirmed' OR v.replacement_secret_id IS NULL
       OR v.remote_evidence_hash IS NULL OR v.remote_http_status IS NULL OR v.remote_http_status NOT BETWEEN 200 AND 299
       OR v_expected_fingerprint IS NULL
       OR v_expected_fingerprint IS DISTINCT FROM p_access_token_fingerprint
       OR p_validated_at IS NULL
       OR p_validated_at > clock_timestamp() + interval '30 seconds'
       OR p_validated_at < clock_timestamp() - interval '10 minutes'
       OR (v.materialization_token_validated_at IS NOT NULL
           AND p_validated_at < v.materialization_token_validated_at) THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_FINALIZATION_NOT_AUTHORIZED' USING ERRCODE='42501';
    END IF;
    SELECT * INTO e FROM public.external_integrations i WHERE i.id=p_integration_id FOR SHARE;
    -- ZION_P19A_RECOVERY_PENDING_STANDARD_FINALIZATION_V1
    -- A integracao standard com PIN pendente pode permanecer inativa ate
    -- a ativacao atomica abaixo. Outros estados inativos falham fechado.
    IF NOT FOUND
       OR e.organization_id IS DISTINCT FROM v.organization_id
       OR e.store_id IS DISTINCT FROM v.store_id
       OR e.provider IS DISTINCT FROM 'whatsapp'
       OR e.status IS DISTINCT FROM 'active'
       OR NOT (
         e.is_active IS TRUE
         OR (
           e.is_active IS FALSE
           AND e.metadata ->> 'connection_mode' IS NOT DISTINCT FROM 'standard'
           AND e.metadata ->> 'pin_activation_pending' IS NOT DISTINCT FROM 'true'
         )
       )
       OR e.phone_number_id IS DISTINCT FROM v.phone_number_id THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_INTEGRATION_NOT_VALID' USING ERRCODE='42501';
    END IF;
    -- Ensure the token actually materialized by the CANONICAL writer is the one
    -- validated for this attempt. SHA-256 exists in PostgreSQL 15+ / Supabase.
    -- This is a fingerprint comparison, never a token returned or persisted here.
    IF e.access_token IS NULL OR pg_catalog.encode(
         pg_catalog.sha256(pg_catalog.convert_to(e.access_token,'UTF8')),'hex'
       ) IS DISTINCT FROM p_access_token_fingerprint THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_MATERIALIZED_TOKEN_MISMATCH' USING ERRCODE='42501';
    END IF;
    v_waba := coalesce(pg_catalog.to_jsonb(e)->>'whatsapp_business_account_id',
                       pg_catalog.to_jsonb(e)->>'waba_id',
                       pg_catalog.to_jsonb(e)->'metadata'->>'waba_id');
    IF v_waba IS DISTINCT FROM v.waba_id THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_WABA_MISMATCH' USING ERRCODE='42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.whatsapp_phone_security_secrets s
                   WHERE s.id=v.replacement_secret_id AND s.organization_id=v.organization_id
                     AND s.store_id=v.store_id AND s.phone_number_id=v.phone_number_id
                     AND s.status='pending') THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_PENDING_SECRET_MISSING' USING ERRCODE='42501';
    END IF;
    SELECT * INTO v_activation FROM public.activate_whatsapp_phone_security_secret_by_system(
        v.organization_id,v.store_id,'whatsapp',v.phone_number_id,p_integration_id
    );
    IF v_activation.secret_id IS DISTINCT FROM v.replacement_secret_id
       OR v_activation.status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_SECRET_ACTIVATION_MISMATCH' USING ERRCODE='42501';
    END IF;
    UPDATE public.whatsapp_pin_recovery_attempts a
       SET status='completed',integration_id=p_integration_id,
           finalized_at=clock_timestamp(),updated_at=clock_timestamp()
     WHERE a.id=v.id;
    INSERT INTO public.whatsapp_pin_recovery_events(attempt_id,operation_id,actor_user_id,event_type)
    VALUES(v.id,v.operation_id,v.actor_user_id,'completed');
    RETURN QUERY SELECT v.id,'completed'::text,p_integration_id,v.replacement_secret_id,'completed'::text;
END;
$function$;

alter function public.finalize_whatsapp_pin_recovery_materialization_by_system(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz
) owner to postgres;
revoke all on function public.finalize_whatsapp_pin_recovery_materialization_by_system(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.finalize_whatsapp_pin_recovery_materialization_by_system(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz
) to service_role;

commit;

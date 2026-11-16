begin;

-- P19-A 6.1-F
-- RPC especifica da primeira conexao.
-- Preserva a RPC original usada pela recuperacao do PIN.
-- Nao altera integracoes existentes retroativamente.

create or replace function public.materialize_whatsapp_first_connection_mode_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_whatsapp_business_account_id text,
  p_phone_number_id text,
  p_display_phone_number text,
  p_access_token text,
  p_meta_graph_api_version text,
  p_meta_app_id text,
  p_validated_at timestamptz,
  p_connection_mode text
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
  v_before public.external_integrations%rowtype;
  v_after public.external_integrations%rowtype;
  v_materialized record;
  v_had_integration boolean;
  v_previous_mode text;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_connection_mode is null
     or p_connection_mode not in (
       'standard',
       'business_app_coexistence'
     ) then
    raise exception using
      errcode = '22023',
      message = 'ZION_WHATSAPP_CONNECTION_MODE_INVALID';
  end if;

  -- Serializa primeiras conexoes concorrentes da mesma loja.
  -- NO KEY UPDATE evita conflito com FK KEY SHARE.
  perform 1
    from public.stores as store_row
   where store_row.id = p_store_id
     and store_row.organization_id = p_organization_id
   for no key update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'ZION_WHATSAPP_CONNECTION_MODE_STORE_SCOPE_MISMATCH';
  end if;

  select integration_row.*
    into v_before
    from public.external_integrations integration_row
   where integration_row.store_id = p_store_id
     and integration_row.provider = 'whatsapp'
   for update;

  v_had_integration := found;

  if v_had_integration then
    if v_before.organization_id is distinct from p_organization_id then
      raise exception using
        errcode = '42501',
        message = 'ZION_WHATSAPP_CONNECTION_MODE_SCOPE_MISMATCH';
    end if;

    v_previous_mode := nullif(
      pg_catalog.btrim(
        coalesce(v_before.metadata ->> 'connection_mode', '')
      ),
      ''
    );

    -- Nao reprocessar vinculos antigos sem modalidade comprovada.
    if v_previous_mode is null then
      raise exception using
        errcode = '23514',
        message = 'ZION_WHATSAPP_CONNECTION_MODE_LEGACY_UNCLASSIFIED';
    end if;
    if v_previous_mode is not null
       and v_previous_mode is distinct from p_connection_mode then
      raise exception using
        errcode = '23514',
        message = 'ZION_WHATSAPP_CONNECTION_MODE_REPLAY_MISMATCH';
    end if;
  end if;

  if p_connection_mode = 'standard' then
    select * into strict v_materialized
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
  else
    select * into strict v_materialized
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
  end if;

  if v_materialized.integration_id is null then
    raise exception using
      errcode = '23514',
      message = 'ZION_WHATSAPP_CONNECTION_MODE_MATERIALIZATION_MISSING';
  end if;

  -- Apenas uma integracao realmente nova recebe a modalidade.
  -- Integracoes anteriores sem classificacao nao sao reclassificadas.
  if not v_had_integration then
    update public.external_integrations as integration_row
       set metadata = coalesce(
             integration_row.metadata, '{}'::jsonb
           ) || pg_catalog.jsonb_build_object(
             'connection_mode', p_connection_mode
           ),
           updated_at = pg_catalog.clock_timestamp()
     where integration_row.id = v_materialized.integration_id
       and integration_row.organization_id = p_organization_id
       and integration_row.store_id = p_store_id
       and integration_row.provider = 'whatsapp'
       and integration_row.phone_number_id =
           pg_catalog.btrim(p_phone_number_id)
       and integration_row.whatsapp_business_account_id =
           pg_catalog.btrim(p_whatsapp_business_account_id)
    returning integration_row.* into v_after;
  else
    select integration_row.*
      into v_after
      from public.external_integrations integration_row
     where integration_row.id = v_materialized.integration_id
       and integration_row.organization_id = p_organization_id
       and integration_row.store_id = p_store_id
       and integration_row.provider = 'whatsapp'
       and integration_row.phone_number_id =
           pg_catalog.btrim(p_phone_number_id)
       and integration_row.whatsapp_business_account_id =
           pg_catalog.btrim(p_whatsapp_business_account_id);
  end if;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'ZION_WHATSAPP_CONNECTION_MODE_WRITER_SCOPE_MISMATCH';
  end if;

  return query select
    v_after.id,
    v_materialized.outcome::text,
    v_after.provider,
    v_after.status,
    v_after.is_active,
    v_after.phone_number_id,
    v_after.whatsapp_business_account_id,
    v_after.display_phone_number;
end;
$function$;

alter function public.materialize_whatsapp_first_connection_mode_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz, text
) owner to postgres;

revoke all on function public.materialize_whatsapp_first_connection_mode_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated;

grant execute on function public.materialize_whatsapp_first_connection_mode_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz, text
) to service_role;

commit;
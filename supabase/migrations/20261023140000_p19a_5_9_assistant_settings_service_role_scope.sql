-- ZION / Pilar 19-A / Etapa 5.9
-- Versiona as duas correcoes de autorizacao aplicadas no Supabase Production
-- em 23/10/2026. Nao modifica dados comerciais nem reprocessa mensagens.
-- (1) Permite que a leitura canônica seja executada pelo service_role.
-- (2) Autoriza o escopo server-side, preservando o isolamento loja/organizacao.
-- A verificacao interna continua sem EXECUTE direto para service_role/anon.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure(
    'public.read_store_settings_experience_policies_scoped(uuid,uuid)'
  ) IS NULL OR to_regprocedure(
    'public.assert_store_settings_experience_policies_scope(uuid,uuid)'
  ) IS NULL OR to_regprocedure(
    'public.zion_resolve_request_role_internal()'
  ) IS NULL THEN
    RAISE EXCEPTION 'P19A_5_9_REQUIRED_SETTINGS_FUNCTION_MISSING';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.assert_store_settings_experience_policies_scope(
  p_organization_id uuid,
  p_store_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
BEGIN
  IF p_organization_id IS NULL OR p_store_id IS NULL THEN
    RAISE EXCEPTION USING
      errcode = '22023',
      message = 'organization_id and store_id are required';
  END IF;

  IF v_request_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION USING
        errcode = '42501',
        message = 'settings experience policy scope is not authorized';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.memberships membership_row
      WHERE membership_row.organization_id = p_organization_id
        AND membership_row.user_id = auth.uid()
        AND membership_row.is_active IS TRUE
    ) INTO v_is_member;

    IF COALESCE(v_is_member, FALSE) IS NOT TRUE THEN
      RAISE EXCEPTION USING
        errcode = '42501',
        message = 'settings experience policy scope is not authorized';
    END IF;

  ELSIF v_request_role IN ('postgres', 'service_role') THEN
    NULL;

  ELSE
    RAISE EXCEPTION USING
      errcode = '42501',
      message = 'settings experience policy scope is not authorized';
  END IF;

  -- A autorizacao de papel nao dispensa o escopo real organizacao/loja.
  PERFORM 1
  FROM public.stores store_row
  WHERE store_row.id = p_store_id
    AND store_row.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      errcode = '42501',
      message = 'settings experience policy scope is not authorized';
  END IF;
END;
$function$;

-- A leitura externa e a unica interface autorizada ao service_role.
GRANT EXECUTE ON FUNCTION
  public.read_store_settings_experience_policies_scoped(uuid, uuid)
TO service_role;

-- A verificacao interna so e chamada pela funcao SECURITY DEFINER.
-- Preservar o bloqueio de EXECUTE direto para papeis de API.
REVOKE EXECUTE ON FUNCTION
  public.assert_store_settings_experience_policies_scope(uuid, uuid)
FROM PUBLIC, anon, authenticated, service_role;

-- Invariantes obrigatorios, com rollback automatico se nao atendidos.
DO $verify$
BEGIN
  IF NOT has_function_privilege(
    'service_role',
    'public.read_store_settings_experience_policies_scoped(uuid,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.read_store_settings_experience_policies_scoped(uuid,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.read_store_settings_experience_policies_scoped(uuid,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.assert_store_settings_experience_policies_scope(uuid,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.assert_store_settings_experience_policies_scope(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'P19A_5_9_SETTINGS_SCOPE_PRIVILEGE_INVARIANT_FAILED';
  END IF;
END;
$verify$;

COMMIT;

-- ZION | Pilar 9 | Bloco 9
-- Corrige exclusivamente a leitura do papel JWT na RPC de ativacao manual.
-- O PostgREST atual fornece claims no JSON request.jwt.claims; o acesso
-- antigo a request.jwt.claim.role nao e confiavel isoladamente.
-- A mudanca preserva funcao, grants, owner, locks e todas as demais regras.
-- Nao ativa nenhuma versao e nao altera dados de contrato.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
    v_oid oid;
    v_definition text;
    v_updated_definition text;
    v_confirmed_definition text;
    v_old_declaration text := $old$
    v_request_role text :=
        nullif(
            pg_catalog.current_setting(
                'request.jwt.claim.role',
                true
            ),
            ''
        );
$old$;
    v_new_declaration text := $new$
    v_request_role text :=
        coalesce(
            nullif(
                pg_catalog.current_setting('request.jwt.claims', true),
                ''
            )::jsonb ->> 'role',
            nullif(
                pg_catalog.current_setting('request.jwt.claim.role', true),
                ''
            )
        );
$new$;
BEGIN
    SELECT p.oid, pg_catalog.pg_get_functiondef(p.oid)
    INTO v_oid, v_definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'activate_store_contract_template_version_by_system'
      AND p.oid = 'public.activate_store_contract_template_version_by_system(uuid,uuid,uuid,uuid)'::regprocedure;

    IF v_oid IS NULL OR v_definition IS NULL THEN
        RAISE EXCEPTION 'P9_ROLE_COMPAT_MISSING_FUNCTION';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = v_oid
          AND p.prosecdef
          AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    )
    OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
    OR pg_catalog.strpos(v_definition, 'P9_CONTRACT_ACTIVATION_NOT_AUTHORIZED') = 0
    OR pg_catalog.strpos(v_definition, 'P9_CONTRACT_ACTIVATION_SOURCE_FILE_REQUIRED') = 0
    OR pg_catalog.strpos(v_definition, 'P19A_CONTRACT_VERSION_ACTIVATION_UPDATE_FAILED') = 0
    OR pg_catalog.strpos(v_definition, v_old_declaration) = 0
    OR pg_catalog.strpos(
        pg_catalog.substr(
            v_definition,
            pg_catalog.strpos(v_definition, v_old_declaration) + pg_catalog.length(v_old_declaration)
        ),
        v_old_declaration
    ) <> 0
    THEN
        RAISE EXCEPTION 'P9_ROLE_COMPAT_PRECONDITION_FAILED';
    END IF;

    -- Altera somente a declaracao que extrai o papel JWT;
    -- preserva exatamente todo o restante da RPC atual.
    v_updated_definition := pg_catalog.replace(
        v_definition,
        v_old_declaration,
        v_new_declaration
    );

    IF v_updated_definition = v_definition THEN
        RAISE EXCEPTION 'P9_ROLE_COMPAT_NO_CHANGE';
    END IF;

    EXECUTE v_updated_definition;

    SELECT pg_catalog.pg_get_functiondef(v_oid)
    INTO v_confirmed_definition;

    IF pg_catalog.strpos(v_confirmed_definition, v_new_declaration) = 0
       OR pg_catalog.strpos(v_confirmed_definition, v_old_declaration) <> 0
       OR NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_proc p
           WHERE p.oid = v_oid
             AND p.prosecdef
             AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
       )
       OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.strpos(v_confirmed_definition, 'P9_CONTRACT_ACTIVATION_NOT_AUTHORIZED') = 0
    THEN
        RAISE EXCEPTION 'P9_ROLE_COMPAT_POSTCONDITION_FAILED';
    END IF;

    RAISE NOTICE 'P9_ROLE_COMPAT_APPLIED';
END;
$migration$;

COMMIT;

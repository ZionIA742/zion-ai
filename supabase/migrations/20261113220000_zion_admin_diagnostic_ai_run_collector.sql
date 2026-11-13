-- ZION-ADM | Bloco 2 | 2.3-B.5
-- Coletor independente de erros persistidos em ai_runs.
-- Nao interfere no processamento da IA Vendedora.
-- Nao armazena texto bruto de erro.
-- Nao instala cron nem trigger.
-- Sem captura automatica.

BEGIN;

CREATE FUNCTION public.collect_zion_admin_ai_run_errors_by_system(
    p_batch_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_run record;
    v_result jsonb;

    v_selected integer := 0;
    v_registered integer := 0;
    v_already_registered integer := 0;
    v_failed integer := 0;

    v_sqlstate text;
    v_failures jsonb := '[]'::jsonb;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_batch_limit IS NULL
       OR p_batch_limit < 1
       OR p_batch_limit > 25 THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_INVALID_BATCH_LIMIT'
            USING ERRCODE = '22023';
    END IF;

    -- Buscar erros persistidos independentemente
    -- do status da execucao.
    --
    -- Nao selecionar o texto de r.error.
    -- Ele serve somente para elegibilidade.
    --
    -- Ignorar ocorrencias ja materializadas.
    FOR v_run IN
        SELECT r.id
        FROM public.ai_runs r
        WHERE NULLIF(btrim(r.error), '') IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM public.zion_admin_diagnostic_occurrences o
              WHERE o.occurrence_key =
                  'zion-b2:ai-run-error:' || r.id::text
          )
        ORDER BY
            r.created_at DESC NULLS LAST,
            r.id DESC
        LIMIT p_batch_limit
    LOOP
        v_selected := v_selected + 1;

        BEGIN
            -- O escritor valida o vinculo da loja
            -- e registra somente metadados seguros.
            v_result :=
                public.register_zion_admin_ai_run_error_by_system(
                    v_run.id
                );

            IF v_result->>'new_occurrence' = 'true' THEN
                v_registered := v_registered + 1;

            ELSIF v_result->>'new_occurrence' = 'false' THEN
                v_already_registered :=
                    v_already_registered + 1;

            ELSE
                RAISE EXCEPTION
                    'ZION_DIAGNOSTIC_WRITER_INVALID_RESULT';
            END IF;

        EXCEPTION WHEN OTHERS THEN
            -- Falhas individuais nao cancelam
            -- o processamento dos outros registros.
            --
            -- Guardar somente SQLSTATE.
            -- Nunca retornar a mensagem bruta.
            GET STACKED DIAGNOSTICS
                v_sqlstate = RETURNED_SQLSTATE;

            v_failed := v_failed + 1;

            v_failures := v_failures ||
                jsonb_build_array(
                    jsonb_build_object(
                        'source_id', v_run.id,
                        'sqlstate', v_sqlstate
                    )
                );
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'source_system', 'ai_runs',
        'batch_limit', p_batch_limit,
        'selected', v_selected,
        'registered', v_registered,
        'already_registered', v_already_registered,
        'failed', v_failed,
        'failures', v_failures
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.collect_zion_admin_ai_run_errors_by_system(integer)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.collect_zion_admin_ai_run_errors_by_system(integer)
TO service_role;

COMMIT;

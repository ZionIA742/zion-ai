-- ZION-ADM B5-6-X.31-BS
-- Imutabilidade da identidade financeira OpenAI.
-- Nao executa coleta, claim, retry ou cron.
-- Preserva atualizacoes dos campos operacionais.

BEGIN;

CREATE FUNCTION
public.zion_admin_guard_openai_cost_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
    IF NEW.operation_key
           IS DISTINCT FROM OLD.operation_key
       OR NEW.provider
           IS DISTINCT FROM OLD.provider
       OR NEW.source
           IS DISTINCT FROM OLD.source
       OR NEW.query_identity
           IS DISTINCT FROM OLD.query_identity
       OR NEW.query_parameters
           IS DISTINCT FROM OLD.query_parameters
       OR NEW.period_start
           IS DISTINCT FROM OLD.period_start
       OR NEW.period_end
           IS DISTINCT FROM OLD.period_end
       OR NEW.supersedes_operation_id
           IS DISTINCT FROM OLD.supersedes_operation_id
    THEN
        RAISE EXCEPTION
            'OPENAI_COST_OPERATION_IDENTITY_IMMUTABLE'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE TRIGGER
zaocco_guard_identity_immutable
BEFORE UPDATE
ON public.zion_admin_openai_cost_collection_operations
FOR EACH ROW
EXECUTE FUNCTION
public.zion_admin_guard_openai_cost_identity_immutable();

REVOKE ALL ON FUNCTION
public.zion_admin_guard_openai_cost_identity_immutable()
FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION
public.zion_admin_guard_openai_cost_identity_immutable()
IS 'Impede alteracoes da identidade financeira OpenAI depois da criacao da operacao.';

COMMIT;
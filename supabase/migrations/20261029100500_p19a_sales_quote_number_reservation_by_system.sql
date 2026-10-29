-- ZION / PILAR 19-A / BLOCO 6 / ETAPA 5.1-B.1
-- Reserva atomica e compartilhada do numero de orcamento.
-- Nao cria orcamento, PDF, aprovacao ou envio.
-- Somente service_role pode executar.

BEGIN;

CREATE FUNCTION public.reserve_next_sales_quote_number_by_system(
    p_organization_id uuid,
    p_store_id uuid
)
RETURNS TABLE (
    quote_number text,
    reserved_number integer,
    quote_number_prefix text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE
    v_number integer;
    v_prefix text;
    v_formatted text;
BEGIN
    IF public.zion_resolve_request_role_internal()
        IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'P19A_QUOTE_NUMBER_SYSTEM_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NULL
       OR p_store_id IS NULL THEN
        RAISE EXCEPTION
            'P19A_QUOTE_NUMBER_INVALID_SCOPE';
    END IF;

    -- Todas as autoridades que compartilham a linha
    -- de configuracao serializam pelo mesmo lock.
    SELECT
        qs.next_quote_number,
        qs.quote_number_prefix
    INTO
        v_number,
        v_prefix
    FROM public.store_quote_settings qs
    JOIN public.stores s
      ON s.id = qs.store_id
     AND s.organization_id = qs.organization_id
    WHERE qs.organization_id = p_organization_id
      AND qs.store_id = p_store_id
    FOR UPDATE OF qs;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_NUMBER_SETTINGS_NOT_FOUND';
    END IF;

    IF v_number IS NULL
       OR v_number < 1 THEN
        RAISE EXCEPTION
            'P19A_QUOTE_NUMBER_INVALID_COUNTER';
    END IF;

    IF v_number >= 2147483647 THEN
        RAISE EXCEPTION
            'P19A_QUOTE_NUMBER_COUNTER_EXHAUSTED';
    END IF;

    -- Mesmo comportamento do TypeScript:
    -- retirar espacos, fallback ORC e no minimo
    -- seis digitos, sem truncar numeros maiores.
    v_prefix := COALESCE(
        NULLIF(pg_catalog.btrim(v_prefix), ''),
        'ORC'
    );

    v_formatted :=
        v_prefix || '-' ||
        pg_catalog.lpad(
            v_number::text,
            GREATEST(
                6,
                pg_catalog.length(v_number::text)
            ),
            '0'
        );

    UPDATE public.store_quote_settings
    SET next_quote_number = v_number + 1
    WHERE organization_id = p_organization_id
      AND store_id = p_store_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_NUMBER_UPDATE_FAILED';
    END IF;

    RETURN QUERY SELECT
        v_formatted,
        v_number,
        v_prefix;
END;
$function$;

REVOKE ALL ON FUNCTION
    public.reserve_next_sales_quote_number_by_system(
        uuid, uuid
    )
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.reserve_next_sales_quote_number_by_system(
        uuid, uuid
    )
TO service_role;

COMMENT ON FUNCTION
    public.reserve_next_sales_quote_number_by_system(
        uuid, uuid
    )
IS
    'Reserva numero sequencial sob lock transacional. '
    'Uso exclusivo do backend confiavel service_role. '
    'Nao autoriza criacao, aprovacao ou envio de orcamentos.';

COMMIT;

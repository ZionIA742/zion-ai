BEGIN;

-- ZION-ADM | D.11-B
-- Desativa o writer legado de fechamento mensal.
--
-- Preserva todas as linhas historicas existentes.
-- Nao altera pre-fechamentos, receitas ou despesas.
-- Nao habilita o novo fechamento definitivo.

CREATE OR REPLACE FUNCTION public.zion_admin_close_cost_month(
    p_month date,
    p_fx_usd_brl numeric
)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    RAISE EXCEPTION
        'ZION_ADMIN_LEGACY_COST_CLOSE_DISABLED';
END;
$function$;

-- Bloqueia tambem chamadas por papeis da aplicacao.

REVOKE ALL ON FUNCTION
    public.zion_admin_close_cost_month(date,numeric)
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
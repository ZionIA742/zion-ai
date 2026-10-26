-- ZION-ADM / 8-D
-- Protecao temporaria contra fechamento
-- financeiro legado incompleto.
--
-- Nao altera valores nem registros existentes.
-- Nao interfere no atendimento das lojas.

BEGIN;

CREATE FUNCTION
public.zion_admin_block_legacy_cost_closure()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'ZION_ADMIN_LEGACY_CLOSURE_BLOCKED_PENDING_FULL_FINANCIAL_RECONCILIATION';
END;
$$;

CREATE TRIGGER
zion_admin_block_legacy_cost_closure
BEFORE INSERT
ON public.zion_admin_monthly_closures
FOR EACH ROW
EXECUTE FUNCTION
public.zion_admin_block_legacy_cost_closure();

REVOKE ALL ON FUNCTION
public.zion_admin_block_legacy_cost_closure()
FROM PUBLIC, anon, authenticated;

COMMIT;

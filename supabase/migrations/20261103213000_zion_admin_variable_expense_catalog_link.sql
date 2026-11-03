BEGIN;

-- ZION-ADM / B1 / 1.2.3
-- Vinculo entre catalogo e lancamentos financeiros.
-- Migration aditiva.
-- Preserva despesas antigas, status e auditoria.
-- Nao cria registros mensais de valor zero.

ALTER TABLE public.zion_admin_variable_expenses
ADD COLUMN IF NOT EXISTS catalog_item_id uuid;

-- Chave estrangeira sem exclusao em cascata.
-- O vinculo permanece opcional para preservar a
-- compatibilidade com operacoes antigas.

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conrelid =
            'public.zion_admin_variable_expenses'::regclass
          AND conname = 'zav_catalog_item_fk'
    ) THEN
        ALTER TABLE public.zion_admin_variable_expenses
        ADD CONSTRAINT zav_catalog_item_fk
        FOREIGN KEY (catalog_item_id)
        REFERENCES public.zion_admin_variable_expense_catalog(id)
        ON DELETE RESTRICT;
    END IF;
END;
$migration$;

-- Vincula lancamentos historicos aos itens do catalogo,
-- quando a identidade normalizada for correspondente.
-- Nao modifica valores nem competencias.

UPDATE public.zion_admin_variable_expenses AS e
SET catalog_item_id = c.id
FROM public.zion_admin_variable_expense_catalog AS c
WHERE e.catalog_item_id IS NULL
  AND lower(btrim(e.name)) = lower(btrim(c.name))
  AND lower(btrim(e.category)) = lower(btrim(c.category))
  AND e.currency = c.currency;

-- Facilita consultas por item e competencia.

CREATE INDEX IF NOT EXISTS zav_catalog_month_idx
ON public.zion_admin_variable_expenses (
    catalog_item_id,
    competence_month
)
WHERE catalog_item_id IS NOT NULL;

-- Permissoes anteriores permanecem inalteradas.
-- Nao concede escrita direta para service_role.
-- Novas mutacoes serao implementadas por RPC.

COMMIT;
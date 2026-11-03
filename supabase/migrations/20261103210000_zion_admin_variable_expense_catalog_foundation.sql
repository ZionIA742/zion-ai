BEGIN;

-- ZION-ADM / B1 / 1.2.2
-- Catalogo persistente de nomes de despesas avulsas.
-- Migration aditiva: nao modifica valores, status ou
-- historico das despesas existentes.
-- Nao cria registros mensais com valor zero.

CREATE TABLE public.zion_admin_variable_expense_catalog (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    name text NOT NULL,
    category text NOT NULL,
    currency text NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,

    CONSTRAINT zavc_name_check
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),

    CONSTRAINT zavc_category_check
        CHECK (char_length(btrim(category)) BETWEEN 1 AND 80),

    CONSTRAINT zavc_currency_check
        CHECK (currency IN ('BRL', 'USD'))
);

-- Nomes equivalentes nao podem gerar itens duplicados
-- dentro da mesma categoria e moeda.
-- O indice tambem cobre itens arquivados, permitindo
-- futura reativacao sem perder a identidade historica.

CREATE UNIQUE INDEX zavc_identity_uidx
ON public.zion_admin_variable_expense_catalog (
    lower(btrim(name)),
    lower(btrim(category)),
    currency
);

-- Recupera nomes de lancamentos antigos, inclusive
-- cancelados, sem copiar valores financeiros.
-- Se um mesmo item aparece em meses diferentes,
-- cria apenas um registro no catalogo.

INSERT INTO public.zion_admin_variable_expense_catalog (
    name,
    category,
    currency
)
SELECT DISTINCT ON (
    lower(btrim(e.name)),
    lower(btrim(e.category)),
    e.currency
)
    btrim(e.name),
    btrim(e.category),
    e.currency
FROM public.zion_admin_variable_expenses AS e
ORDER BY
    lower(btrim(e.name)),
    lower(btrim(e.category)),
    e.currency,
    e.created_at,
    e.id
ON CONFLICT DO NOTHING;

-- Segurança: clientes e usuarios das lojas nao
-- possuem acesso direto.
-- A leitura pelo backend administrativo usa service_role.
-- Escritas futuras serao feitas por RPC administrativa.

ALTER TABLE public.zion_admin_variable_expense_catalog
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON TABLE public.zion_admin_variable_expense_catalog
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
ON TABLE public.zion_admin_variable_expense_catalog
TO service_role;

COMMIT;
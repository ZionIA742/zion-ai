BEGIN;

-- ZION-ADM / B1 / 1.2.3
-- Vinculo automatico entre despesa manual e catalogo.
--
-- Preserva a assinatura e o corpo da RPC financeira.
-- Nao modifica valores, datas, status ou competencias.
-- Nao cria itens no catalogo.
-- Nao cria lancamentos financeiros de valor zero.
-- Nao altera retroativamente despesas existentes.

CREATE FUNCTION
public.zion_admin_attach_variable_expense_catalog_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_item_id uuid;
    v_archived_at timestamptz;
BEGIN
    -- Uma edicao de valor, descricao ou data que
    -- mantenha a identidade do item deve preservar
    -- exatamente o vinculo ja registrado.
    --
    -- Isso tambem permite editar despesas historicas
    -- de itens arquivados, se a competencia ainda
    -- estiver aberta e a RPC financeira permitir.

    IF TG_OP = 'UPDATE' THEN
        IF lower(btrim(NEW.name))
               IS NOT DISTINCT FROM lower(btrim(OLD.name))
           AND lower(btrim(NEW.category))
               IS NOT DISTINCT FROM lower(btrim(OLD.category))
           AND NEW.currency
               IS NOT DISTINCT FROM OLD.currency
        THEN
            NEW.catalog_item_id := OLD.catalog_item_id;
            RETURN NEW;
        END IF;

        -- A identidade mudou: nunca reaproveitar
        -- indevidamente o ID do item anterior.
        NEW.catalog_item_id := NULL;
    END IF;

    -- Mesmo lock global usado pela RPC administrativa
    -- ao cadastrar, arquivar e reativar itens.
    --
    -- Evita vincular um item enquanto outra transacao
    -- modifica seu estado no catalogo.

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('zion_admin_variable_catalog'),
        1
    );

    SELECT
        c.id,
        c.archived_at
    INTO
        v_item_id,
        v_archived_at
    FROM public.zion_admin_variable_expense_catalog AS c
    WHERE lower(btrim(c.name)) = lower(btrim(NEW.name))
      AND lower(btrim(c.category)) = lower(btrim(NEW.category))
      AND c.currency = NEW.currency
    LIMIT 1;

    IF v_item_id IS NOT NULL THEN

        -- Itens arquivados nao aceitam novos
        -- lancamentos nem mudancas de identidade
        -- que tentem associa-los novamente.

        IF v_archived_at IS NOT NULL THEN
            RAISE EXCEPTION
                'VARIABLE_CATALOG_ITEM_ARCHIVED';
        END IF;

        -- Caso um futuro fluxo envie um identificador
        -- explicito, impedir associacao com outro item.
        IF TG_OP = 'INSERT'
           AND NEW.catalog_item_id IS NOT NULL
           AND NEW.catalog_item_id <> v_item_id
        THEN
            RAISE EXCEPTION
                'VARIABLE_CATALOG_ITEM_MISMATCH';
        END IF;

        NEW.catalog_item_id := v_item_id;

    ELSE

        -- Compatibilidade temporaria com a API
        -- financeira antiga, que aceita nomes livres.
        --
        -- Novos fluxos de interface deverao selecionar
        -- itens existentes no catalogo.

        IF TG_OP = 'INSERT'
           AND NEW.catalog_item_id IS NOT NULL
        THEN
            RAISE EXCEPTION
                'VARIABLE_CATALOG_ITEM_MISMATCH';
        END IF;

        NEW.catalog_item_id := NULL;

    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER zav_catalog_link_before_write
BEFORE INSERT OR UPDATE OF name, category, currency
ON public.zion_admin_variable_expenses
FOR EACH ROW
EXECUTE FUNCTION
public.zion_admin_attach_variable_expense_catalog_item();

-- A funcao existe exclusivamente para o trigger.
-- Nenhum papel de API recebe execucao direta.

REVOKE ALL ON FUNCTION
public.zion_admin_attach_variable_expense_catalog_item()
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
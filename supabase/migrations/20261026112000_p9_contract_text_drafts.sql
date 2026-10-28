-- ZION | Pilar 9 | Editor de contratos | Etapa 3
-- Rascunho textual independente do PDF/template original.
-- Uma revisao editavel por oportunidade e versao do modelo.
-- Nenhuma rota de WhatsApp ou geracao de PDF e habilitada aqui.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Permite FK composta para impedir referencia a modelo de outra loja.
-- O indice adicional nao altera linhas nem regras dos modelos existentes.
CREATE UNIQUE INDEX store_contract_template_versions_id_org_store_draft_uidx
    ON public.store_contract_template_versions (id, organization_id, store_id);

CREATE TABLE public.sales_contract_text_drafts (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    organization_id uuid NOT NULL,
    store_id uuid NOT NULL,
    commercial_opportunity_id uuid NOT NULL,
    template_version_id uuid NOT NULL,
    draft_text text NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    created_by_user_id uuid NOT NULL,
    updated_by_user_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT sales_contract_text_drafts_text_check
        CHECK (pg_catalog.char_length(pg_catalog.btrim(draft_text)) > 0
               AND pg_catalog.char_length(draft_text) <= 500000),
    CONSTRAINT sales_contract_text_drafts_revision_check
        CHECK (revision >= 1),
    CONSTRAINT sales_contract_text_drafts_scope_unique
        UNIQUE (organization_id, store_id, commercial_opportunity_id, template_version_id),
    CONSTRAINT sales_contract_text_drafts_opportunity_fk
        FOREIGN KEY (commercial_opportunity_id, organization_id, store_id)
        REFERENCES public.commercial_opportunities (id, organization_id, store_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT sales_contract_text_drafts_template_version_fk
        FOREIGN KEY (template_version_id, organization_id, store_id)
        REFERENCES public.store_contract_template_versions (id, organization_id, store_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);

COMMENT ON TABLE public.sales_contract_text_drafts IS
    'Rascunhos editaveis de contratos, separados do modelo original e de versoes canonicas de PDF.';

-- Revisao obrigatoriamente monotona para suportar update condicional no servidor
-- (WHERE revision = revision_esperada), impedindo overwrite silencioso.
CREATE FUNCTION public.p9_guard_sales_contract_text_draft_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.store_id IS DISTINCT FROM OLD.store_id
       OR NEW.commercial_opportunity_id IS DISTINCT FROM OLD.commercial_opportunity_id
       OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.revision IS DISTINCT FROM OLD.revision
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P9_CONTRACT_TEXT_DRAFT_IMMUTABLE_FIELDS';
    END IF;

    NEW.revision := OLD.revision + 1;
    NEW.updated_at := pg_catalog.clock_timestamp();
    RETURN NEW;
END;
$function$;

CREATE TRIGGER p9_contract_text_drafts_update_guard
    BEFORE UPDATE ON public.sales_contract_text_drafts
    FOR EACH ROW
    EXECUTE FUNCTION public.p9_guard_sales_contract_text_draft_update();

ALTER TABLE public.sales_contract_text_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_contract_text_drafts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sales_contract_text_drafts
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p9_guard_sales_contract_text_draft_update()
    FROM PUBLIC, anon, authenticated;

-- Somente o backend autorizado, depois de validar usuario/loja/oportunidade,
-- podera consultar, inserir e salvar rascunhos. Sem DELETE.
GRANT SELECT, INSERT, UPDATE ON TABLE public.sales_contract_text_drafts
    TO service_role;

DO $check$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'sales_contract_text_drafts'
          AND c.relrowsecurity
          AND c.relforcerowsecurity
    ) THEN
        RAISE EXCEPTION 'P9_DRAFT_RLS_NOT_FORCED';
    END IF;
    IF pg_catalog.has_table_privilege('authenticated',
        'public.sales_contract_text_drafts', 'SELECT')
       OR pg_catalog.has_table_privilege('anon',
        'public.sales_contract_text_drafts', 'SELECT')
       OR NOT pg_catalog.has_table_privilege('service_role',
        'public.sales_contract_text_drafts', 'SELECT')
       OR NOT pg_catalog.has_table_privilege('service_role',
        'public.sales_contract_text_drafts', 'INSERT')
       OR NOT pg_catalog.has_table_privilege('service_role',
        'public.sales_contract_text_drafts', 'UPDATE')
    THEN
        RAISE EXCEPTION 'P9_DRAFT_GRANTS_INVALID';
    END IF;
END;
$check$;

COMMIT;

SELECT
    'PASS' AS resultado,
    'RASCUNHOS_TEXTO_INSTALADOS' AS componente,
    'SEM_ENVIO_WHATSAPP' AS transporte;

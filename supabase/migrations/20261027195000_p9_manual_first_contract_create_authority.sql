-- ZION | Pilar 9.9.15 | Primeiro contrato manual da oportunidade
-- INSTALACAO SOMENTE: nenhuma chamada de criacao, nenhuma mensagem WhatsApp.
-- O backend deve autenticar e autorizar o responsavel antes de chamar esta RPC
-- com service_role. Esta funcao NAO concede permissao de IA ou de envio.
-- Nao usar para contratos originados de orcamento aceito.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.sales_contracts') IS NULL
     OR pg_catalog.to_regclass('public.commercial_opportunities') IS NULL
     OR pg_catalog.to_regclass('public.sales_contract_text_drafts') IS NULL
     OR pg_catalog.to_regclass('public.store_contract_templates') IS NULL
     OR pg_catalog.to_regclass('public.store_contract_template_versions') IS NULL
     OR pg_catalog.to_regclass('public.leads') IS NULL
     OR pg_catalog.to_regclass('public.conversations') IS NULL
     OR pg_catalog.to_regclass('public.sales_quotes') IS NULL
     OR pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.p9_acquire_sales_contract_send_domain_lock(uuid,uuid,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'P9_MANUAL_CREATE_DEPENDENCY_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.sales_contracts'::regclass
      AND a.attname IN ('quote_id', 'quote_version_id')
      AND a.attnotnull AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'P9_MANUAL_CREATE_QUOTE_COLUMNS_NOT_NULL';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.create_sales_contract_manual_by_system(uuid,uuid,uuid,uuid,uuid,bigint,text,uuid)'
  ) IS NOT NULL OR pg_catalog.to_regclass(
    'public.p9_manual_contract_active_opportunity_uidx'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'P9_MANUAL_CREATE_ALREADY_INSTALLED';
  END IF;
END;
$preflight$;

-- Nao permite dois contratos manuais ativos para a mesma oportunidade.
-- Ao cancelar/expirar/falhar, uma nova preparacao humana sera permitida.
CREATE UNIQUE INDEX p9_manual_contract_active_opportunity_uidx
  ON public.sales_contracts (
    organization_id,
    store_id,
    (metadata->>'commercial_opportunity_id')
  )
  WHERE metadata->>'created_via' = 'create_sales_contract_manual_by_system'
    AND status NOT IN ('cancelled', 'expired', 'failed');

-- Preserva o discriminador de origem e seus vinculos depois da criacao.
-- O guard antigo protege contratos gerados de propostas; este protege manuais.
CREATE FUNCTION public.p9_guard_sales_contract_manual_origin_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp, public
SET row_security = off
AS $function$
BEGIN
  IF OLD.metadata->>'created_via' = 'create_sales_contract_manual_by_system'
     OR NEW.metadata->>'created_via' = 'create_sales_contract_manual_by_system'
     OR OLD.metadata->>'source' = 'responsible_text_draft'
     OR NEW.metadata->>'source' = 'responsible_text_draft' THEN

    IF OLD.metadata->>'created_via' IS DISTINCT FROM 'create_sales_contract_manual_by_system'
       OR OLD.metadata->>'source' IS DISTINCT FROM 'responsible_text_draft'
       OR NEW.metadata->>'created_via' IS DISTINCT FROM OLD.metadata->>'created_via'
       OR NEW.metadata->>'source' IS DISTINCT FROM OLD.metadata->>'source'
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.store_id IS DISTINCT FROM OLD.store_id
       OR NEW.quote_id IS NOT NULL OR NEW.quote_version_id IS NOT NULL
       OR NEW.metadata->>'commercial_opportunity_id'
            IS DISTINCT FROM OLD.metadata->>'commercial_opportunity_id'
       OR NEW.metadata->>'customer_id' IS DISTINCT FROM OLD.metadata->>'customer_id'
       OR NEW.metadata->>'draft_id' IS DISTINCT FROM OLD.metadata->>'draft_id'
       OR NEW.metadata->>'template_version_id'
            IS DISTINCT FROM OLD.metadata->>'template_version_id'
       OR NEW.metadata->>'creation_draft_revision'
            IS DISTINCT FROM OLD.metadata->>'creation_draft_revision'
       OR NEW.metadata->>'creation_draft_sha256'
            IS DISTINCT FROM OLD.metadata->>'creation_draft_sha256'
       OR NEW.metadata->>'created_by_user_id'
            IS DISTINCT FROM OLD.metadata->>'created_by_user_id'
       OR NULLIF(NEW.metadata->>'proposal_acceptance_event_id', '') IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='P9_MANUAL_CONTRACT_ORIGIN_IMMUTABLE';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER p9_sales_contract_manual_origin_immutability_guard
  BEFORE UPDATE OF organization_id, store_id, quote_id, quote_version_id, metadata
  ON public.sales_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.p9_guard_sales_contract_manual_origin_update();

CREATE FUNCTION public.create_sales_contract_manual_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_draft_id uuid,
  p_template_version_id uuid,
  p_draft_revision bigint,
  p_draft_sha256 text,
  p_actor_user_id uuid
)
RETURNS TABLE (
  outcome text,
  contract_id uuid,
  organization_id uuid,
  store_id uuid,
  commercial_opportunity_id uuid,
  draft_id uuid,
  draft_revision bigint,
  contract_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp, public
SET row_security = off
AS $function$
DECLARE
  v_role text := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    NULLIF(auth.jwt() ->> 'role', '')
  );
  v_opportunity public.commercial_opportunities%ROWTYPE;
  v_draft public.sales_contract_text_drafts%ROWTYPE;
  v_template public.store_contract_templates%ROWTYPE;
  v_version public.store_contract_template_versions%ROWTYPE;
  v_lead public.leads%ROWTYPE;
  v_conversation public.conversations%ROWTYPE;
  v_contract public.sales_contracts%ROWTYPE;
  v_count integer;
  v_draft_sha text;
  v_lead_id uuid;
  v_conversation_id uuid;
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND session_user <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='P9_MANUAL_CONTRACT_SERVICE_ROLE_REQUIRED';
  END IF;

  IF p_organization_id IS NULL OR p_store_id IS NULL
     OR p_commercial_opportunity_id IS NULL OR p_draft_id IS NULL
     OR p_template_version_id IS NULL OR p_actor_user_id IS NULL
     OR p_draft_revision IS NULL OR p_draft_revision < 1
     OR p_draft_sha256 IS NULL OR p_draft_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',
      MESSAGE='P9_MANUAL_CONTRACT_ARGUMENTS_INVALID';
  END IF;

  -- Dominio de envio antes de qualquer row lock. Falhar rapidamente em
  -- concorrencia e preferivel a criar uma linhagem manual ambigua.
  PERFORM public.p9_acquire_sales_contract_send_domain_lock(
    p_organization_id, p_store_id, p_commercial_opportunity_id
  );

  SELECT o.* INTO v_opportunity
  FROM public.commercial_opportunities o
  WHERE o.id=p_commercial_opportunity_id
    AND o.organization_id=p_organization_id AND o.store_id=p_store_id
  FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002',
      MESSAGE='P9_MANUAL_CONTRACT_OPPORTUNITY_NOT_FOUND';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.sales_contract_text_drafts d
  WHERE d.id=p_draft_id AND d.organization_id=p_organization_id
    AND d.store_id=p_store_id
    AND d.commercial_opportunity_id=p_commercial_opportunity_id
    AND d.template_version_id=p_template_version_id
  FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='P9_MANUAL_CONTRACT_DRAFT_NOT_FOUND';
  END IF;
  IF v_draft.revision IS DISTINCT FROM p_draft_revision
     OR NULLIF(pg_catalog.btrim(v_draft.draft_text), '') IS NULL
     OR pg_catalog.char_length(v_draft.draft_text) > 300000 THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='P9_MANUAL_CONTRACT_DRAFT_REVISION_OR_TEXT_INVALID';
  END IF;

  v_draft_sha := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_draft.draft_text, 'UTF8'), 'sha256'),
    'hex'
  );
  IF v_draft_sha IS DISTINCT FROM p_draft_sha256 THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='P9_MANUAL_CONTRACT_DRAFT_HASH_CHANGED';
  END IF;

  SELECT t.* INTO v_template FROM public.store_contract_templates t
  WHERE t.organization_id=p_organization_id AND t.store_id=p_store_id
    AND t.status='active' AND t.active_version_id=p_template_version_id
  FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='P9_MANUAL_CONTRACT_TEMPLATE_NOT_ACTIVE';
  END IF;
  SELECT tv.* INTO v_version FROM public.store_contract_template_versions tv
  WHERE tv.id=p_template_version_id AND tv.template_id=v_template.id
    AND tv.organization_id=p_organization_id AND tv.store_id=p_store_id
    AND tv.status='active'
  FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='P9_MANUAL_CONTRACT_TEMPLATE_VERSION_NOT_ACTIVE';
  END IF;

  v_lead_id := v_opportunity.origin_lead_id;
  v_conversation_id := v_opportunity.primary_conversation_id;
  IF v_conversation_id IS NOT NULL THEN
    SELECT c.* INTO v_conversation FROM public.conversations c
    WHERE c.id=v_conversation_id AND c.organization_id=p_organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='P9_MANUAL_CONTRACT_CONVERSATION_SCOPE_INVALID';
    END IF;
    IF v_lead_id IS NOT NULL AND v_conversation.lead_id IS DISTINCT FROM v_lead_id THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='P9_MANUAL_CONTRACT_CONVERSATION_LEAD_MISMATCH';
    END IF;
    IF v_lead_id IS NULL THEN
      v_lead_id := v_conversation.lead_id;
    END IF;
  END IF;

  IF v_lead_id IS NOT NULL THEN
    SELECT l.* INTO v_lead FROM public.leads l
    WHERE l.id=v_lead_id AND l.organization_id=p_organization_id
      AND l.store_id=p_store_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='P9_MANUAL_CONTRACT_LEAD_SCOPE_INVALID';
    END IF;
  END IF;

  -- O primeiro contrato manual nao substitui silenciosamente um contrato
  -- ativo ja associado a esta oportunidade, mesmo que tenha origem em quote.
  SELECT count(*) INTO v_count FROM public.sales_contracts c
  WHERE c.organization_id=p_organization_id AND c.store_id=p_store_id
    AND c.status NOT IN ('cancelled', 'expired', 'failed')
    AND (
      c.metadata->>'commercial_opportunity_id'=p_commercial_opportunity_id::text
      OR (c.quote_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.sales_quotes q
        WHERE q.id=c.quote_id AND q.organization_id=p_organization_id
          AND q.store_id=p_store_id
          AND q.commercial_opportunity_id=p_commercial_opportunity_id
      ))
    );

  IF v_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='P9_MANUAL_CONTRACT_MULTIPLE_ACTIVE_CONTRACTS';
  END IF;
  IF v_count = 1 THEN
    SELECT c.* INTO v_contract FROM public.sales_contracts c
    WHERE c.organization_id=p_organization_id AND c.store_id=p_store_id
      AND c.status NOT IN ('cancelled', 'expired', 'failed')
      AND (
        c.metadata->>'commercial_opportunity_id'=p_commercial_opportunity_id::text
        OR (c.quote_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.sales_quotes q
          WHERE q.id=c.quote_id AND q.organization_id=p_organization_id
            AND q.store_id=p_store_id
            AND q.commercial_opportunity_id=p_commercial_opportunity_id
        ))
      )
    LIMIT 1;
    IF v_contract.metadata->>'created_via'
          IS DISTINCT FROM 'create_sales_contract_manual_by_system'
       OR v_contract.metadata->>'draft_id' IS DISTINCT FROM p_draft_id::text
       OR v_contract.metadata->>'commercial_opportunity_id'
          IS DISTINCT FROM p_commercial_opportunity_id::text THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='P9_MANUAL_CONTRACT_EXISTING_CONTRACT_DIFFERENT_ORIGIN';
    END IF;
    RETURN QUERY SELECT 'already_exists'::text, v_contract.id,
      v_contract.organization_id, v_contract.store_id,
      p_commercial_opportunity_id, p_draft_id, v_draft.revision,
      v_contract.status;
    RETURN;
  END IF;

  -- NAO extrai nem inventa valores comerciais do texto: os centavos tecnicos
  -- exigidos por sales_contracts recebem zero e sao explicitamente marcados
  -- como NAO AUTORITATIVOS. Nenhum PDF final pode usar esses valores como preco.
  INSERT INTO public.sales_contracts (
    organization_id, store_id, lead_id, conversation_id,
    quote_id, quote_version_id, current_version_id,
    status, title, customer_name, customer_phone,
    currency, subtotal_cents, discount_cents, total_cents,
    metadata
  ) VALUES (
    p_organization_id, p_store_id, v_lead_id, v_conversation_id,
    NULL, NULL, NULL,
    'draft', 'Contrato preparado pelo responsavel',
    CASE WHEN v_lead_id IS NULL THEN NULL ELSE v_lead.name END,
    CASE WHEN v_lead_id IS NULL THEN NULL ELSE v_lead.phone END,
    'BRL', 0, 0, 0,
    pg_catalog.jsonb_build_object(
      'source', 'responsible_text_draft',
      'created_via', 'create_sales_contract_manual_by_system',
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'customer_id', v_opportunity.customer_id,
      'draft_id', p_draft_id,
      'template_version_id', p_template_version_id,
      'creation_draft_revision', p_draft_revision,
      'creation_draft_sha256', v_draft_sha,
      'created_by_user_id', p_actor_user_id,
      'commercial_amounts_authoritative', false
    )
  ) RETURNING * INTO v_contract;

  RETURN QUERY SELECT 'created'::text, v_contract.id,
    v_contract.organization_id, v_contract.store_id,
    p_commercial_opportunity_id, p_draft_id, v_draft.revision,
    v_contract.status;
END;
$function$;

ALTER FUNCTION public.p9_guard_sales_contract_manual_origin_update()
  OWNER TO postgres;
ALTER FUNCTION public.create_sales_contract_manual_by_system(
  uuid,uuid,uuid,uuid,uuid,bigint,text,uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.p9_guard_sales_contract_manual_origin_update()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_sales_contract_manual_by_system(
  uuid,uuid,uuid,uuid,uuid,bigint,text,uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_contract_manual_by_system(
  uuid,uuid,uuid,uuid,uuid,bigint,text,uuid
) TO service_role;

COMMENT ON FUNCTION public.create_sales_contract_manual_by_system(
  uuid,uuid,uuid,uuid,uuid,bigint,text,uuid
) IS 'P9: cria ou recupera primeiro contrato manual da oportunidade; sem PDF, aprovacao, quote artificial ou envio. Exige autorizacao humana no backend.';

DO $postflight$
DECLARE
  v_fn oid := pg_catalog.to_regprocedure(
    'public.create_sales_contract_manual_by_system(uuid,uuid,uuid,uuid,uuid,bigint,text,uuid)'
  );
BEGIN
  IF v_fn IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid=v_fn AND p.prosecdef
         AND p.proowner='postgres'::regrole)
     OR pg_catalog.has_function_privilege('anon',v_fn,'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',v_fn,'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role',v_fn,'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid='public.sales_contracts'::regclass
         AND t.tgname='p9_sales_contract_manual_origin_immutability_guard'
         AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'P9_MANUAL_CREATE_POSTFLIGHT_INVALID';
  END IF;
END;
$postflight$;

COMMIT;
SELECT 'PASS' AS resultado,
  'P9_MANUAL_FIRST_CONTRACT_CREATE_AUTHORITY_INSTALLED' AS componente,
  'NO_CONTRACT_CREATED_NO_WHATSAPP_SEND' AS transporte;

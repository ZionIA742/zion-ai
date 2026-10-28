-- ZION | Pilar 9.9.15 | Etapa 12-B: envio por origem de contrato
-- Instalacao atomica de 5 RPCs. Preserva o fluxo com quote, adiciona origem manual.
-- Nao cria contratos, mensagens, barreiras ou envios durante a instalacao.
-- DADOS PESSOAIS: nenhum dado de cliente precisa ser consultado por este script.
-- Requer Etapas 9, 11 e fundacao da barreira ja instaladas.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

DO $preflight$
DECLARE
  r record;
  v_fn oid;
  v_old_count integer := 0;
BEGIN
  IF pg_catalog.to_regclass('public.p9_sales_contract_send_barriers') IS NULL
     OR pg_catalog.to_regclass('public.sales_contracts') IS NULL
     OR pg_catalog.to_regclass('public.sales_contract_versions') IS NULL
     OR pg_catalog.to_regclass('public.commercial_opportunities') IS NULL
     OR pg_catalog.to_regclass('public.messages') IS NULL
     OR pg_catalog.to_regprocedure('public.create_sales_contract_manual_by_system(uuid,uuid,uuid,uuid,uuid,bigint,text,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.p9_acquire_sales_contract_send_domain_lock(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'P9_MANUAL_SEND_DEPENDENCIES_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid='public.p9_sales_contract_send_barriers'::regclass
      AND a.attname='contract_origin' AND a.attnotnull AND NOT a.attisdropped
      AND a.atttypid='text'::regtype
  ) OR (SELECT count(*) FROM pg_catalog.pg_attribute a
    WHERE a.attrelid='public.p9_sales_contract_send_barriers'::regclass
      AND a.attname IN ('sales_quote_id','sales_quote_version_id')
      AND NOT a.attnotnull AND NOT a.attisdropped) <> 2
  OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid='public.p9_sales_contract_send_barriers'::regclass
      AND c.conname='p9_sales_contract_send_barriers_scope_identity_ck'
      AND c.convalidated AND c.contype='c'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%responsible_text_draft%'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%accepted_quote_version_snapshot%'
  ) THEN
    RAISE EXCEPTION 'P9_MANUAL_SEND_BARRIER_FOUNDATION_NOT_VALIDATED';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid IN (
         'public.sales_contracts'::regclass,
         'public.sales_contract_versions'::regclass,
         'public.p9_sales_contract_send_barriers'::regclass)
        AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
        AND t.tgname IN (
          'p9_sales_contract_manual_origin_immutability_guard',
          'p9_sales_contract_version_current_proposal_guard',
          'p9_sales_contract_approval_current_proposal_guard',
          'p9_contract_send_barrier_immutability_guard')
  ) <> 4 THEN
    RAISE EXCEPTION 'P9_MANUAL_SEND_REQUIRED_GUARDS_NOT_ENABLED';
  END IF;

  -- Verifica o MD5 do pg_get_functiondef instalado, nao o arquivo local antigo.
  -- Qualquer divergencia cancela a transacao SEM substituir nenhuma funcao.
  FOR r IN
    SELECT * FROM (VALUES
    ('public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)', '8b236586cf6816b824a9778dd218f4d9', true),
    ('public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)', 'c11747791670ba1893b66bca9e36e20d', true),
    ('public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid)', '15cad4d9bd0ea0516363513a1d1749ce', true),
    ('public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text)', '57e3fe3b4f8c0be76526b5ef9b6a7d2e', true),
    ('public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)', '7569448037c2673fa6998f6cfb3d375e', true),
    ('public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)', '5e404f3f429680e6758336c662784bda', false),
    ('public.p9_assert_contract_send_domain_writable_internal(uuid,uuid,uuid)', '47f681857ec16bc0df02fa3a42a14852', false),
    ('public.p9_guard_sales_contract_manual_origin_update()', 'e0ef16efadfb1bc3c7b438a1bb7074c1', false),
    ('public.p9_guard_sales_contract_version_insert()', '6bb72899c56ec6c8edad3e0a6e347e51', false),
    ('public.p9_guard_sales_contract_approval()', '6f681435065922b0cb8f179f71c4b31c', false)
    ) AS expected(signature, definition_md5, replace_this)
  LOOP
    v_fn := pg_catalog.to_regprocedure(r.signature);
    IF v_fn IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid=v_fn AND p.prosecdef AND p.proowner='postgres'::regrole
        AND p.prolang=(SELECT l.oid FROM pg_catalog.pg_language l WHERE l.lanname='plpgsql')
        AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))=r.definition_md5
    ) THEN
      RAISE EXCEPTION 'P9_MANUAL_SEND_REMOTE_FUNCTION_CHANGED: %', r.signature;
    END IF;
    IF r.replace_this THEN
      v_old_count := v_old_count+1;
    END IF;
  END LOOP;
  IF v_old_count<>5 THEN
    RAISE EXCEPTION 'P9_MANUAL_SEND_FUNCTION_COUNT_INVALID';
  END IF;
END;
$preflight$;


-- ===== materialize_sales_contract_send_by_system =====

CREATE OR REPLACE FUNCTION public.materialize_sales_contract_send_by_system(p_organization_id uuid, p_store_id uuid, p_contract_id uuid, p_contract_version_id uuid, p_conversation_id uuid, p_message_content text, p_message_metadata jsonb, p_idempotency_key text, p_source text, p_actor_user_id uuid)
 RETURNS TABLE(message_id uuid, outbound_idempotency_key text, outbound_delivery_state text, sales_contract_id uuid, sales_contract_version_id uuid, external_message_id text, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp', 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
  v_role text := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    NULLIF(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''),
    NULLIF(auth.jwt() ->> 'role', '')
  );
  c public.sales_contracts%ROWTYPE;
  v public.sales_contract_versions%ROWTYPE;
  m public.messages%ROWTYPE;
  v_opportunity_id uuid;
  v_preliminary_quote_id uuid;
  v_lineage_opportunity_id uuid;
  v_origin text;
  v_key text := NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key, '')), '');
  v_expected_key text;
  v_guard_state text;
  v_metadata jsonb;
  v_bucket text;
  v_path text;
  v_filename text;
  v_mime text;
BEGIN
  IF (v_role IS DISTINCT FROM 'service_role') AND session_user <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'P9_CONTRACT_SEND_SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_organization_id IS NULL OR p_store_id IS NULL OR p_contract_id IS NULL OR
     p_contract_version_id IS NULL OR p_conversation_id IS NULL OR p_actor_user_id IS NULL OR
     p_source IS DISTINCT FROM 'sales_contract_send_route' OR
     NULLIF(pg_catalog.btrim(COALESCE(p_message_content, '')), '') IS NULL OR
     pg_catalog.jsonb_typeof(p_message_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'P9_CONTRACT_SEND_ARGUMENTS_INVALID';
  END IF;
  v_expected_key := 'sales_contract_send:' || p_organization_id::text || ':' ||
    p_store_id::text || ':' || p_contract_id::text || ':' || p_contract_version_id::text;
  IF v_key IS DISTINCT FROM v_expected_key OR pg_catalog.length(v_key) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'P9_CONTRACT_SEND_IDEMPOTENCY_KEY_INVALID';
  END IF;
  IF p_message_metadata ->> 'sent_by_user_id' IS DISTINCT FROM p_actor_user_id::text THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_CONTRACT_SEND_ACTOR_MISMATCH';
  END IF;

  -- Descoberta sem row lock. Para origem manual, a oportunidade precisa
  -- existir sob escopo e customer; a autoridade completa revalida sob lock.
  SELECT
    CASE WHEN c0.metadata->>'created_via' = 'create_sales_contract_manual_by_system'
           OR c0.metadata->>'source' = 'responsible_text_draft'
      THEN (
        SELECT o.id FROM public.commercial_opportunities o
        WHERE o.id::text = c0.metadata->>'commercial_opportunity_id'
          AND o.customer_id::text = c0.metadata->>'customer_id'
          AND o.organization_id = c0.organization_id AND o.store_id = c0.store_id
          AND c0.quote_id IS NULL AND c0.quote_version_id IS NULL
          AND c0.metadata->>'created_via' = 'create_sales_contract_manual_by_system'
          AND c0.metadata->>'source' = 'responsible_text_draft'
          AND c0.metadata->>'commercial_amounts_authoritative' = 'false'
      )
      ELSE (
        SELECT q.commercial_opportunity_id FROM public.sales_quotes q
        WHERE q.id = c0.quote_id
          AND q.organization_id = c0.organization_id AND q.store_id = c0.store_id
      )
    END,
    c0.quote_id
    INTO v_opportunity_id, v_preliminary_quote_id
  FROM public.sales_contracts c0
  WHERE c0.id = p_contract_id AND c0.organization_id = p_organization_id
    AND c0.store_id = p_store_id;
  IF NOT FOUND OR v_opportunity_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'P9_CONTRACT_SEND_CANONICAL_OPPORTUNITY_NOT_FOUND';
  END IF;

  -- Lock de dominio obrigatoriamente antes de qualquer row lock.
  PERFORM public.p9_acquire_sales_contract_send_domain_lock(
    p_organization_id, p_store_id, v_opportunity_id
  );
  -- Lock da idempotencia dentro do dominio e antes dos locks relacionais.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));

  SELECT * INTO c FROM public.sales_contracts
  WHERE id = p_contract_id AND organization_id = p_organization_id AND store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND OR c.quote_id IS DISTINCT FROM v_preliminary_quote_id OR
     c.conversation_id IS DISTINCT FROM p_conversation_id OR
     ( (c.metadata->>'created_via' = 'create_sales_contract_manual_by_system'
        OR c.metadata->>'source' = 'responsible_text_draft')
       AND (c.quote_id IS NOT NULL OR c.quote_version_id IS NOT NULL
            OR c.metadata->>'created_via' IS DISTINCT FROM 'create_sales_contract_manual_by_system'
            OR c.metadata->>'source' IS DISTINCT FROM 'responsible_text_draft'
            OR c.metadata->>'commercial_opportunity_id' IS DISTINCT FROM v_opportunity_id::text
            OR c.metadata->>'commercial_amounts_authoritative' IS DISTINCT FROM 'false') ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_CONTRACT_SEND_CONTRACT_SCOPE_CHANGED';
  END IF;
  v_origin := CASE WHEN c.metadata->>'created_via' = 'create_sales_contract_manual_by_system'
     AND c.metadata->>'source' = 'responsible_text_draft'
     AND c.quote_id IS NULL AND c.quote_version_id IS NULL
     THEN 'responsible_text_draft'
     ELSE 'accepted_quote_version_snapshot' END;
  SELECT * INTO v FROM public.sales_contract_versions
  WHERE id = p_contract_version_id AND contract_id = c.id
    AND organization_id = p_organization_id AND store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'P9_CONTRACT_SEND_VERSION_NOT_FOUND';
  END IF;
  v_bucket := NULLIF(pg_catalog.btrim(COALESCE(v.storage_bucket, '')), '');
  v_path := NULLIF(pg_catalog.btrim(COALESCE(v.storage_path, '')), '');
  v_filename := NULLIF(pg_catalog.btrim(COALESCE(v.original_filename, '')), '');
  v_mime := pg_catalog.lower(NULLIF(pg_catalog.btrim(COALESCE(v.mime_type, '')), ''));
  IF v_bucket IS NULL OR v_path IS NULL OR v_filename IS NULL OR v_mime IS DISTINCT FROM 'application/pdf' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_CONTRACT_SEND_PDF_INVALID';
  END IF;

  SELECT * INTO m FROM public.messages
  WHERE organization_id = p_organization_id AND store_id = p_store_id
    AND outbound_idempotency_key = v_key
  FOR UPDATE;
  IF FOUND THEN
    IF m.deleted_at IS NOT NULL OR m.conversation_id IS DISTINCT FROM p_conversation_id OR
       m.sender IS DISTINCT FROM 'human' OR m.direction IS DISTINCT FROM 'outgoing' OR
       m.message_type IS DISTINCT FROM 'document' OR m.media_url IS DISTINCT FROM v_path OR
       m.metadata ->> 'source' IS DISTINCT FROM 'sales_contract_send_route' OR
       m.metadata ->> 'outbound_origin' IS DISTINCT FROM 'sales_contract_send' OR
       m.metadata ->> 'outbound_idempotency_key' IS DISTINCT FROM v_key OR
       m.metadata ->> 'contract_id' IS DISTINCT FROM c.id::text OR
       m.metadata ->> 'sales_contract_id' IS DISTINCT FROM c.id::text OR
       m.metadata ->> 'sales_contract_version_id' IS DISTINCT FROM v.id::text OR
       m.metadata ->> 'organization_id' IS DISTINCT FROM p_organization_id::text OR
       m.metadata ->> 'store_id' IS DISTINCT FROM p_store_id::text OR
       m.metadata ->> 'storage_bucket' IS DISTINCT FROM v_bucket OR
       m.metadata ->> 'storage_path' IS DISTINCT FROM v_path OR
       m.metadata ->> 'original_file_name' IS DISTINCT FROM v_filename OR
       m.metadata ->> 'sent_by_user_id' IS DISTINCT FROM p_actor_user_id::text OR
       (v_origin = 'responsible_text_draft' AND
        m.metadata ->> 'contract_origin' IS DISTINCT FROM v_origin) OR
       m.metadata ->> 'file_kind' IS DISTINCT FROM 'sales_contract_pdf' OR
       pg_catalog.lower(COALESCE(m.metadata ->> 'mime_type', '')) IS DISTINCT FROM 'application/pdf' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_CONTRACT_SEND_EXISTING_MESSAGE_SCOPE_MISMATCH';
    END IF;
    RETURN QUERY SELECT m.id, v_key, COALESCE(m.outbound_delivery_state, 'pending'),
      c.id, v.id, m.external_message_id,
      CASE WHEN m.outbound_delivery_state = 'uncertain' THEN 'uncertain'
           WHEN m.external_message_id IS NOT NULL OR m.outbound_delivery_state = 'sent' THEN 'already_sent'
           WHEN m.outbound_delivery_state IN ('failed', 'template_required') THEN 'failed'
           ELSE 'already_queued' END;
    RETURN;
  END IF;

  -- Nao permitir origem manual parcialmente marcada ou tratada como legado.
  -- A linhagem valida a oportunidade apos locks de contrato e versao.
  SELECT lineage.guard_state, lineage.commercial_opportunity_id
    INTO v_guard_state, v_lineage_opportunity_id
  FROM public.p9_assert_sales_contract_current_proposal_lineage_internal(
    p_organization_id, p_store_id, c.id
  ) AS lineage;
  IF NOT FOUND OR v_guard_state IS DISTINCT FROM 'current'
     OR v_lineage_opportunity_id IS DISTINCT FROM v_opportunity_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_CONTRACT_SEND_CURRENT_PROPOSAL_NOT_CURRENT';
  END IF;

  IF c.status IS DISTINCT FROM 'approved' OR v.status IS DISTINCT FROM 'approved' OR
     c.current_version_id IS DISTINCT FROM v.id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_CONTRACT_SEND_NOT_APPROVED_OR_NOT_CURRENT';
  END IF;

  -- Reentrante no mesmo lock de dominio ja obtido. Nova tentativa apenas
  -- quando nao ha barreira ativa naquela oportunidade.
  PERFORM public.p9_assert_contract_send_domain_writable_internal(
    p_organization_id, p_store_id, v_opportunity_id
  );

  v_metadata := p_message_metadata || pg_catalog.jsonb_build_object(
    'source', 'sales_contract_send_route',
    'channel', 'whatsapp',
    'external_channel', 'whatsapp',
    'send_external', true,
    'outbound_origin', 'sales_contract_send',
    'contract_origin', v_origin,
    'outbound_idempotency_key', v_key,
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'contract_id', c.id,
    'contract_version_id', v.id,
    'sales_contract_id', c.id,
    'sales_contract_version_id', v.id,
    'quote_id', c.quote_id,
    'quote_version_id', c.quote_version_id,
    'attachment_kind', 'file',
    'file_kind', 'sales_contract_pdf',
    'storage_bucket', v_bucket,
    'storage_path', v_path,
    'mime_type', 'application/pdf',
    'original_file_name', v_filename,
    'generated_by', 'system',
    'sent_by_user_id', p_actor_user_id::text
  );

  SELECT * INTO m FROM public.insert_message(
    p_conversation_id, 'human', 'outgoing', 'document',
    p_message_content, NULL, v_path, v_metadata
  );
  IF m.id IS NULL OR m.organization_id IS DISTINCT FROM p_organization_id OR
     m.store_id IS DISTINCT FROM p_store_id OR m.conversation_id IS DISTINCT FROM p_conversation_id OR
     m.sender IS DISTINCT FROM 'human' OR m.direction IS DISTINCT FROM 'outgoing' OR
     m.message_type IS DISTINCT FROM 'document' OR m.media_url IS DISTINCT FROM v_path OR
     m.metadata ->> 'contract_id' IS DISTINCT FROM c.id::text OR
     m.metadata ->> 'outbound_origin' IS DISTINCT FROM 'sales_contract_send' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_CONTRACT_SEND_INSERT_SCOPE_MISMATCH';
  END IF;

  UPDATE public.messages
     SET outbound_idempotency_key = v_key,
         outbound_delivery_state = 'pending',
         outbound_claimed_at = NULL,
         outbound_claimed_by = NULL,
         outbound_attempt_started_at = NULL,
         outbound_provider_accepted_at = NULL,
         outbound_uncertain_at = NULL,
         outbound_error_text = NULL,
         outbound_commercial_finalized_at = NULL,
         outbound_commercial_error_at = NULL,
         outbound_commercial_error_text = NULL
   WHERE id = m.id AND organization_id = p_organization_id AND store_id = p_store_id
     AND deleted_at IS NULL AND external_message_id IS NULL
   RETURNING * INTO m;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'P9_CONTRACT_SEND_OUTBOUND_STATE_NOT_APPLIED';
  END IF;

  RETURN QUERY SELECT m.id, v_key, m.outbound_delivery_state, c.id, v.id,
    m.external_message_id, 'queued'::text;
END;
$function$;


-- ===== p9_activate_sales_contract_send_barrier_internal =====

CREATE OR REPLACE FUNCTION public.p9_activate_sales_contract_send_barrier_internal(p_organization_id uuid, p_store_id uuid, p_commercial_opportunity_id uuid, p_contract_id uuid, p_contract_version_id uuid, p_message_id uuid, p_idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp', 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
    v_opportunity public.commercial_opportunities%ROWTYPE;
    v_contract public.sales_contracts%ROWTYPE;
    v_version public.sales_contract_versions%ROWTYPE;
    v_quote public.sales_quotes%ROWTYPE;
    v_message public.messages%ROWTYPE;
    v_existing public.p9_sales_contract_send_barriers%ROWTYPE;
    v_key text;
    v_expected_key text;
    v_guard_state text;
    v_lineage_opportunity_id uuid;
    v_origin text;
    v_barrier_id uuid;
BEGIN
    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_commercial_opportunity_id IS NULL
       OR p_contract_id IS NULL
       OR p_contract_version_id IS NULL
       OR p_message_id IS NULL THEN
        RAISE EXCEPTION 'P9_BARRIER_ACTIVATION_SCOPE_REQUIRED';
    END IF;

    v_key := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
    v_expected_key :=
        'sales_contract_send:' || p_organization_id::text
        || ':' || p_store_id::text
        || ':' || p_contract_id::text
        || ':' || p_contract_version_id::text;

    IF v_key IS DISTINCT FROM v_expected_key THEN
        RAISE EXCEPTION 'P9_BARRIER_IDEMPOTENCY_KEY_INVALID';
    END IF;

    -- Common domain lock first; unchanged.
    PERFORM public.p9_acquire_sales_contract_send_domain_lock(
        p_organization_id, p_store_id, p_commercial_opportunity_id
    );

    -- RELATIONAL LOCK ORDER REPAIR: contract -> version -> opportunity.
    -- Approval already locks contract then version and lineage locks opportunity.
    SELECT * INTO v_contract
    FROM public.sales_contracts
    WHERE id = p_contract_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'P9_BARRIER_CONTRACT_INVALID';
    END IF;

    SELECT * INTO v_version
    FROM public.sales_contract_versions
    WHERE id = p_contract_version_id
      AND contract_id = p_contract_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'P9_BARRIER_VERSION_INVALID';
    END IF;

    SELECT * INTO v_opportunity
    FROM public.commercial_opportunities
    WHERE id = p_commercial_opportunity_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'P9_BARRIER_OPPORTUNITY_INVALID';
    END IF;

    -- Origem manual tem oportunidade propria e nenhum vinculo com quote.
    IF v_contract.metadata->>'created_via' = 'create_sales_contract_manual_by_system'
       OR v_contract.metadata->>'source' = 'responsible_text_draft' THEN
        v_origin := 'responsible_text_draft';
        IF v_contract.metadata->>'created_via' IS DISTINCT FROM 'create_sales_contract_manual_by_system'
           OR v_contract.metadata->>'source' IS DISTINCT FROM 'responsible_text_draft'
           OR v_contract.quote_id IS NOT NULL OR v_contract.quote_version_id IS NOT NULL
           OR v_contract.metadata->>'commercial_opportunity_id' IS DISTINCT FROM v_opportunity.id::text
           OR v_contract.metadata->>'customer_id' IS DISTINCT FROM v_opportunity.customer_id::text
           OR v_contract.metadata->>'commercial_amounts_authoritative' IS DISTINCT FROM 'false' THEN
            RAISE EXCEPTION 'P9_BARRIER_MANUAL_LINEAGE_INVALID';
        END IF;
    ELSE
        v_origin := 'accepted_quote_version_snapshot';
        SELECT * INTO v_quote
        FROM public.sales_quotes
        WHERE id = v_contract.quote_id
          AND organization_id = p_organization_id
          AND store_id = p_store_id
          AND commercial_opportunity_id = p_commercial_opportunity_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'P9_BARRIER_QUOTE_SCOPE_INVALID';
        END IF;
    END IF;

    SELECT * INTO v_message
    FROM public.messages
    WHERE id = p_message_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
      AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'P9_BARRIER_MESSAGE_INVALID';
    END IF;

    IF v_contract.status IS DISTINCT FROM 'approved'
       OR v_version.status IS DISTINCT FROM 'approved'
       OR v_contract.current_version_id IS DISTINCT FROM v_version.id
       OR (v_origin = 'accepted_quote_version_snapshot' AND
           (v_opportunity.current_quote_id IS DISTINCT FROM v_contract.quote_id
            OR v_opportunity.current_quote_version_id IS DISTINCT FROM v_contract.quote_version_id))
    THEN
        RAISE EXCEPTION 'P9_BARRIER_CONTRACT_NOT_CURRENT_APPROVED';
    END IF;

    IF v_message.conversation_id IS DISTINCT FROM v_contract.conversation_id
       OR v_message.sender IS DISTINCT FROM 'human'
       OR v_message.direction IS DISTINCT FROM 'outgoing'
       OR v_message.message_type IS DISTINCT FROM 'document'
       OR v_message.media_url IS DISTINCT FROM v_version.storage_path
       OR v_message.outbound_delivery_state IS DISTINCT FROM 'processing'
       OR v_message.outbound_attempt_started_at IS NOT NULL
       OR v_message.external_message_id IS NOT NULL
       OR v_message.outbound_idempotency_key IS DISTINCT FROM v_key
       OR v_message.metadata->>'source' IS DISTINCT FROM 'sales_contract_send_route'
       OR v_message.metadata->>'outbound_origin' IS DISTINCT FROM 'sales_contract_send'
       OR v_message.metadata->>'contract_id' IS DISTINCT FROM v_contract.id::text
       OR v_message.metadata->>'sales_contract_id' IS DISTINCT FROM v_contract.id::text
       OR v_message.metadata->>'sales_contract_version_id' IS DISTINCT FROM v_version.id::text
       OR v_message.metadata->>'outbound_idempotency_key' IS DISTINCT FROM v_key
       OR (v_origin = 'responsible_text_draft' AND
           v_message.metadata->>'contract_origin' IS DISTINCT FROM v_origin)
       OR v_message.metadata->>'file_kind' IS DISTINCT FROM 'sales_contract_pdf'
       OR v_message.metadata->>'storage_path' IS DISTINCT FROM v_version.storage_path
    THEN
        RAISE EXCEPTION 'P9_BARRIER_MESSAGE_SCOPE_OR_STATE_INVALID';
    END IF;

    -- Canonical contracts only: never grant legacy bypass for new outbound.
    SELECT lineage.guard_state, lineage.commercial_opportunity_id
      INTO v_guard_state, v_lineage_opportunity_id
    FROM public.p9_assert_sales_contract_current_proposal_lineage_internal(
        p_organization_id, p_store_id, p_contract_id
    ) AS lineage;
    IF NOT FOUND OR v_guard_state IS DISTINCT FROM 'current'
       OR v_lineage_opportunity_id IS DISTINCT FROM v_opportunity.id THEN
        RAISE EXCEPTION 'P9_BARRIER_CURRENT_PROPOSAL_REQUIRED';
    END IF;

    SELECT * INTO v_existing
    FROM public.p9_sales_contract_send_barriers b
    WHERE b.organization_id = p_organization_id
      AND b.store_id = p_store_id
      AND (
          b.outbound_idempotency_key = v_key
          OR b.message_id = p_message_id
          OR b.sales_contract_id = p_contract_id
          OR (b.commercial_opportunity_id = p_commercial_opportunity_id
              AND b.released_at IS NULL)
      )
    ORDER BY b.activated_at, b.id
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.outbound_idempotency_key = v_key
           AND v_existing.message_id = p_message_id
           AND v_existing.sales_contract_id = p_contract_id
           AND v_existing.sales_contract_version_id = p_contract_version_id
           AND v_existing.commercial_opportunity_id = p_commercial_opportunity_id
           AND v_existing.released_at IS NULL
           AND v_existing.contract_origin IS NOT DISTINCT FROM v_origin
           AND v_existing.sales_quote_id IS NOT DISTINCT FROM v_contract.quote_id
           AND v_existing.sales_quote_version_id IS NOT DISTINCT FROM v_contract.quote_version_id
        THEN
            RETURN v_existing.id;
        END IF;
        RAISE EXCEPTION 'P9_BARRIER_CONFLICT_OR_RELEASED_ATTEMPT';
    END IF;

    INSERT INTO public.p9_sales_contract_send_barriers (
        organization_id,
        store_id,
        sales_contract_id,
        sales_contract_version_id,
        sales_quote_id,
        sales_quote_version_id,
        contract_origin,
        commercial_opportunity_id,
        message_id,
        outbound_idempotency_key
    ) VALUES (
        p_organization_id,
        p_store_id,
        v_contract.id,
        v_version.id,
        v_contract.quote_id,
        v_contract.quote_version_id,
        v_origin,
        v_opportunity.id,
        v_message.id,
        v_key
    ) RETURNING id INTO v_barrier_id;

    IF v_barrier_id IS NULL THEN
        RAISE EXCEPTION 'P9_BARRIER_INSERT_FAILED';
    END IF;
    RETURN v_barrier_id;
END;
$function$;


-- ===== validate_or_start_sales_contract_send_by_system =====

CREATE OR REPLACE FUNCTION public.validate_or_start_sales_contract_send_by_system(p_organization_id uuid, p_store_id uuid, p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp', 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
  v_role text := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    NULLIF(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''),
    NULLIF(auth.jwt() ->> 'role', '')
  );
  v_initial public.messages%ROWTYPE;
  v_locked public.messages%ROWTYPE;
  v_contract_id uuid;
  v_version_id uuid;
  v_opportunity_id uuid;
  v_conversation_id uuid;
  v_key text;
  v_expected_key text;
  v_window jsonb;
  v_decision text;
  v_reason text;
  v_barrier_id uuid;
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND session_user <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'P9_CONTRACT_SEND_SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_organization_id IS NULL OR p_store_id IS NULL OR p_message_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'P9_PRE_META_SCOPE_REQUIRED';
  END IF;

  -- Somente descoberta sem row lock. A autoridade de ativacao obtem
  -- domain advisory lock e, depois, contrato -> versao -> oportunidade -> mensagem.
  SELECT m.* INTO v_initial FROM public.messages m
  WHERE m.id = p_message_id AND m.organization_id = p_organization_id
    AND m.store_id = p_store_id AND m.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'decision','blocked',
      'reason','message_not_found','message_id',p_message_id);
  END IF;

  IF v_initial.sender IS DISTINCT FROM 'human' OR
     v_initial.direction IS DISTINCT FROM 'outgoing' OR
     v_initial.message_type IS DISTINCT FROM 'document' OR
     v_initial.conversation_id IS NULL OR
     v_initial.outbound_delivery_state IS DISTINCT FROM 'processing' OR
     v_initial.outbound_claimed_at IS NULL OR
     v_initial.outbound_attempt_started_at IS NOT NULL OR
     v_initial.external_message_id IS NOT NULL OR
     v_initial.metadata ->> 'source' IS DISTINCT FROM 'sales_contract_send_route' OR
     v_initial.metadata ->> 'outbound_origin' IS DISTINCT FROM 'sales_contract_send' OR
     v_initial.metadata ->> 'file_kind' IS DISTINCT FROM 'sales_contract_pdf' OR
     v_initial.metadata ->> 'contract_id' IS NULL OR
     v_initial.metadata ->> 'sales_contract_id' IS NULL OR
     v_initial.metadata ->> 'sales_contract_version_id' IS NULL OR
     v_initial.metadata ->> 'contract_version_id' IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'decision','blocked',
      'reason','message_scope_or_state_invalid','message_id',p_message_id,
      'conversation_id',v_initial.conversation_id);
  END IF;

  BEGIN
    v_contract_id := NULLIF(pg_catalog.btrim(v_initial.metadata ->> 'sales_contract_id'), '')::uuid;
    v_version_id := NULLIF(pg_catalog.btrim(v_initial.metadata ->> 'sales_contract_version_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'decision','blocked',
      'reason','contract_identity_invalid','message_id',p_message_id);
  END;
  IF v_contract_id IS NULL OR v_version_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'decision','blocked',
      'reason','contract_identity_invalid','message_id',p_message_id);
  END IF;

  v_expected_key := 'sales_contract_send:' || p_organization_id::text || ':' ||
    p_store_id::text || ':' || v_contract_id::text || ':' || v_version_id::text;
  v_key := v_initial.outbound_idempotency_key;
  IF v_key IS DISTINCT FROM v_expected_key OR
     v_initial.metadata ->> 'outbound_idempotency_key' IS DISTINCT FROM v_expected_key OR
     v_initial.metadata ->> 'contract_id' IS DISTINCT FROM v_contract_id::text OR
     v_initial.metadata ->> 'contract_version_id' IS DISTINCT FROM v_version_id::text OR
     v_initial.metadata ->> 'organization_id' IS DISTINCT FROM p_organization_id::text OR
     v_initial.metadata ->> 'store_id' IS DISTINCT FROM p_store_id::text OR
     v_initial.metadata ->> 'external_channel' IS DISTINCT FROM 'whatsapp' OR
     v_initial.metadata ->> 'send_external' IS DISTINCT FROM 'true' THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'decision','blocked',
      'reason','message_identity_invalid','message_id',p_message_id);
  END IF;

  -- A autoridade da janela nao toma locks FOR UPDATE. Nao se altera a
  -- rotina compartilhada com outros envios WhatsApp.
  v_window := public.read_customer_whatsapp_24h_window_by_system(
    p_organization_id, p_store_id, p_message_id
  );
  IF v_window ->> 'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'P9_PRE_META_WINDOW_RESULT_INVALID';
  END IF;
  v_decision := v_window ->> 'decision';
  v_reason := NULLIF(pg_catalog.btrim(COALESCE(v_window ->> 'reason', '')), '');
  IF v_decision IN ('blocked','template_required') THEN
    UPDATE public.messages m
       SET outbound_delivery_state = CASE WHEN v_decision = 'template_required'
                                           THEN 'template_required' ELSE 'failed' END,
           outbound_claimed_at = NULL,
           outbound_claimed_by = NULL,
           outbound_attempt_started_at = NULL,
           outbound_uncertain_at = NULL,
           outbound_error_text = CASE WHEN v_decision = 'template_required'
                                     THEN 'ZION_EXTERNAL_SEND_TEMPLATE_REQUIRED:'
                                     ELSE 'ZION_CONTRACT_SEND_BLOCKED:' END || COALESCE(v_reason, 'window_blocked')
     WHERE m.id = p_message_id AND m.organization_id = p_organization_id
       AND m.store_id = p_store_id AND m.deleted_at IS NULL
       AND m.outbound_delivery_state = 'processing'
       AND m.outbound_attempt_started_at IS NULL AND m.external_message_id IS NULL
       AND m.outbound_idempotency_key = v_expected_key
       AND m.metadata ->> 'outbound_origin' = 'sales_contract_send';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'P9_PRE_META_WINDOW_STATE_CHANGED';
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok',true,'decision',v_decision,
      'reason',COALESCE(v_reason,'window_blocked'),
      'message_id',p_message_id,'conversation_id',v_initial.conversation_id);
  END IF;
  IF v_decision IS DISTINCT FROM 'send' THEN
    RAISE EXCEPTION 'P9_PRE_META_WINDOW_DECISION_INVALID';
  END IF;

  -- Descoberta da oportunidade SEM lock. Revalidacao integral feita pela
  -- ativacao apos adquirir o dominio e as linhas na ordem canonica.
  SELECT
    CASE WHEN c.metadata->>'created_via' = 'create_sales_contract_manual_by_system'
           OR c.metadata->>'source' = 'responsible_text_draft'
      THEN (
        SELECT o.id FROM public.commercial_opportunities o
        WHERE o.id::text = c.metadata->>'commercial_opportunity_id'
          AND o.customer_id::text = c.metadata->>'customer_id'
          AND o.organization_id = c.organization_id AND o.store_id = c.store_id
          AND c.quote_id IS NULL AND c.quote_version_id IS NULL
          AND c.metadata->>'created_via' = 'create_sales_contract_manual_by_system'
          AND c.metadata->>'source' = 'responsible_text_draft'
          AND c.metadata->>'commercial_amounts_authoritative' = 'false'
      )
      ELSE (
        SELECT q.commercial_opportunity_id FROM public.sales_quotes q
        WHERE q.id = c.quote_id AND q.organization_id = c.organization_id
          AND q.store_id = c.store_id
      )
    END,
    c.conversation_id
    INTO v_opportunity_id, v_conversation_id
  FROM public.sales_contracts c
  WHERE c.id = v_contract_id AND c.organization_id = p_organization_id
    AND c.store_id = p_store_id;
  IF NOT FOUND OR v_opportunity_id IS NULL OR
     v_conversation_id IS DISTINCT FROM v_initial.conversation_id THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'decision','blocked',
      'reason','contract_opportunity_or_conversation_invalid',
      'message_id',p_message_id,'conversation_id',v_initial.conversation_id);
  END IF;

  -- Atomico com processing -> uncertain. A ativacao cria ou reusa a
  -- barreira depois de validar proposta vigente, contrato, PDF e identidade.
  -- Se algo abaixo falhar, TODA a transacao (inclusive a insercao) reverte.
  v_barrier_id := public.p9_activate_sales_contract_send_barrier_internal(
    p_organization_id, p_store_id, v_opportunity_id,
    v_contract_id, v_version_id, p_message_id, v_expected_key
  );
  IF v_barrier_id IS NULL THEN
    RAISE EXCEPTION 'P9_PRE_META_BARRIER_NOT_ACTIVATED';
  END IF;

  -- Ultima leitura da janela sob os locks mantidos pela ativacao.
  -- Se fechar neste intervalo, rollback de toda a ativacao, sem POST.
  v_window := public.read_customer_whatsapp_24h_window_by_system(
    p_organization_id, p_store_id, p_message_id
  );
  IF v_window ->> 'ok' IS DISTINCT FROM 'true' OR
     v_window ->> 'decision' IS DISTINCT FROM 'send' THEN
    RAISE EXCEPTION 'P9_PRE_META_WINDOW_CHANGED_BEFORE_ATTEMPT';
  END IF;

  -- A mensagem ja esta sob FOR UPDATE na transacao de ativacao.
  UPDATE public.messages m
     SET outbound_delivery_state = 'uncertain',
         outbound_attempt_started_at = pg_catalog.clock_timestamp(),
         outbound_uncertain_at = pg_catalog.clock_timestamp(),
         outbound_claimed_at = NULL,
         outbound_claimed_by = NULL,
         outbound_error_text = NULL
   WHERE m.id = p_message_id AND m.organization_id = p_organization_id
     AND m.store_id = p_store_id AND m.deleted_at IS NULL
     AND m.outbound_delivery_state = 'processing'
     AND m.outbound_claimed_at IS NOT NULL
     AND m.outbound_attempt_started_at IS NULL AND m.external_message_id IS NULL
     AND m.outbound_idempotency_key = v_expected_key
     AND m.metadata ->> 'outbound_origin' = 'sales_contract_send'
   RETURNING m.* INTO v_locked;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P9_PRE_META_ATTEMPT_TRANSITION_LOST';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok',true, 'decision','send','reason','authorized',
    'message_id',v_locked.id,'conversation_id',v_locked.conversation_id,
    'barrier_id',v_barrier_id
  );
END;
$function$;


-- ===== finalize_sales_contract_send_by_system =====

CREATE OR REPLACE FUNCTION public.finalize_sales_contract_send_by_system(p_organization_id uuid, p_store_id uuid, p_contract_id uuid, p_contract_version_id uuid, p_message_id uuid, p_idempotency_key text, p_source text)
 RETURNS TABLE(sales_contract_id uuid, sales_contract_version_id uuid, message_id uuid, external_message_id text, sent_at timestamp with time zone, conversation_event_created boolean, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp', 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
  v_role text := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    NULLIF(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''),
    NULLIF(auth.jwt() ->> 'role', '')
  );
  v_contract public.sales_contracts%ROWTYPE;
  v_version public.sales_contract_versions%ROWTYPE;
  v_opportunity public.commercial_opportunities%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_barrier public.p9_sales_contract_send_barriers%ROWTYPE;
  v_origin text;
  v_guard_state text;
  v_lineage_opportunity_id uuid;
  v_opportunity_id uuid;
  v_key text := NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key,'')), '');
  v_expected_key text;
  v_sent_at timestamptz;
  v_event_created boolean := false;
  v_release_id uuid;
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND session_user <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='P9_CONTRACT_SEND_SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_organization_id IS NULL OR p_store_id IS NULL OR p_contract_id IS NULL OR
     p_contract_version_id IS NULL OR p_message_id IS NULL OR
     p_source IS DISTINCT FROM 'system_sales_contract_send_reconciliation' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='P9_CONTRACT_FINALIZATION_ARGUMENTS_INVALID';
  END IF;
  v_expected_key := 'sales_contract_send:' || p_organization_id::text || ':' ||
    p_store_id::text || ':' || p_contract_id::text || ':' || p_contract_version_id::text;
  IF v_key IS DISTINCT FROM v_expected_key OR pg_catalog.length(v_key) > 200 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='P9_CONTRACT_FINALIZATION_KEY_INVALID';
  END IF;

  -- Descobrir identificadores sem FOR UPDATE antes do advisory lock.
  -- A barreira tem identidade imutavel e FKs validadas; reler sob lock depois.
  SELECT b.* INTO v_barrier
  FROM public.p9_sales_contract_send_barriers b
  WHERE b.organization_id=p_organization_id AND b.store_id=p_store_id
    AND b.sales_contract_id=p_contract_id AND b.sales_contract_version_id=p_contract_version_id
    AND b.message_id=p_message_id AND b.outbound_idempotency_key=v_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_CONTRACT_FINALIZATION_BARRIER_MISSING';
  END IF;
  v_opportunity_id := v_barrier.commercial_opportunity_id;

  -- SEMPRE antes do primeiro lock relacional; ordem harmonizada com a
  -- ativacao, aprovacao e liberacao: contrato -> versao -> oportunidade
  -- -> mensagem -> barreira.
  PERFORM public.p9_acquire_sales_contract_send_domain_lock(
    p_organization_id,p_store_id,v_opportunity_id
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key,0));

  SELECT c.* INTO v_contract
  FROM public.sales_contracts c
  WHERE c.id=p_contract_id AND c.organization_id=p_organization_id AND c.store_id=p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_CONTRACT_FINALIZATION_CONTRACT_MISSING';
  END IF;

  SELECT v.* INTO v_version
  FROM public.sales_contract_versions v
  WHERE v.id=p_contract_version_id AND v.contract_id=p_contract_id
    AND v.organization_id=p_organization_id AND v.store_id=p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_CONTRACT_FINALIZATION_VERSION_MISSING';
  END IF;

  SELECT o.* INTO v_opportunity
  FROM public.commercial_opportunities o
  WHERE o.id=v_opportunity_id AND o.organization_id=p_organization_id AND o.store_id=p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_CONTRACT_FINALIZATION_OPPORTUNITY_MISSING';
  END IF;

  SELECT m.* INTO v_message
  FROM public.messages m
  WHERE m.id=p_message_id AND m.organization_id=p_organization_id AND m.store_id=p_store_id
    AND m.deleted_at IS NULL AND m.outbound_idempotency_key=v_key
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_CONTRACT_FINALIZATION_MESSAGE_MISSING';
  END IF;

  SELECT b.* INTO v_barrier
  FROM public.p9_sales_contract_send_barriers b
  WHERE b.organization_id=p_organization_id AND b.store_id=p_store_id
    AND b.sales_contract_id=p_contract_id AND b.sales_contract_version_id=p_contract_version_id
    AND b.message_id=p_message_id AND b.outbound_idempotency_key=v_key
    AND b.commercial_opportunity_id=v_opportunity_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_CONTRACT_FINALIZATION_BARRIER_CHANGED';
  END IF;

  -- Origem validada ANTES de qualquer replay ou mudanca de status.
  v_origin := v_barrier.contract_origin;
  IF v_origin = 'responsible_text_draft' THEN
    IF v_contract.metadata->>'created_via' IS DISTINCT FROM 'create_sales_contract_manual_by_system'
       OR v_contract.metadata->>'source' IS DISTINCT FROM 'responsible_text_draft'
       OR v_contract.quote_id IS NOT NULL OR v_contract.quote_version_id IS NOT NULL
       OR v_barrier.sales_quote_id IS NOT NULL OR v_barrier.sales_quote_version_id IS NOT NULL
       OR v_contract.metadata->>'commercial_opportunity_id' IS DISTINCT FROM v_opportunity.id::text
       OR v_contract.metadata->>'customer_id' IS DISTINCT FROM v_opportunity.customer_id::text
       OR v_contract.metadata->>'commercial_amounts_authoritative' IS DISTINCT FROM 'false'
       OR v_message.metadata->>'contract_origin' IS DISTINCT FROM v_origin THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_CONTRACT_FINALIZATION_MANUAL_ORIGIN_INVALID';
    END IF;
  ELSIF v_origin = 'accepted_quote_version_snapshot' THEN
    IF v_contract.quote_id IS NULL OR v_contract.quote_version_id IS NULL
       OR v_opportunity.current_quote_id IS DISTINCT FROM v_contract.quote_id
       OR v_opportunity.current_quote_version_id IS DISTINCT FROM v_contract.quote_version_id
       OR v_contract.metadata->>'source' = 'responsible_text_draft'
       OR v_contract.metadata->>'created_via' = 'create_sales_contract_manual_by_system'
       THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_CONTRACT_FINALIZATION_QUOTE_ORIGIN_INVALID';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_CONTRACT_FINALIZATION_ORIGIN_UNKNOWN';
  END IF;

  -- A origem manual e revalidada pela autoridade corrente.
  -- Nao apertar retroativamente o replay de contratos por orcamento.
  IF v_origin = 'responsible_text_draft' THEN
    SELECT lineage.guard_state, lineage.commercial_opportunity_id
      INTO v_guard_state, v_lineage_opportunity_id
    FROM public.p9_assert_sales_contract_current_proposal_lineage_internal(
      p_organization_id, p_store_id, p_contract_id
    ) AS lineage;
    IF NOT FOUND OR v_guard_state IS DISTINCT FROM 'current'
       OR v_lineage_opportunity_id IS DISTINCT FROM v_opportunity.id THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_CONTRACT_FINALIZATION_MANUAL_LINEAGE_CHANGED';
    END IF;
  END IF;

  -- Nao e suficiente ter status 'sent': exigir ID, aceite e escopo completos.
  IF v_contract.quote_id IS DISTINCT FROM v_barrier.sales_quote_id OR
     v_contract.quote_version_id IS DISTINCT FROM v_barrier.sales_quote_version_id OR
     v_contract.current_version_id IS DISTINCT FROM v_version.id OR
     v_message.conversation_id IS DISTINCT FROM v_contract.conversation_id OR
     v_message.sender IS DISTINCT FROM 'human' OR
     v_message.direction IS DISTINCT FROM 'outgoing' OR
     v_message.message_type IS DISTINCT FROM 'document' OR
     v_message.media_url IS DISTINCT FROM v_version.storage_path OR
     v_message.outbound_delivery_state IS DISTINCT FROM 'sent' OR
     NULLIF(pg_catalog.btrim(COALESCE(v_message.external_message_id,'')), '') IS NULL OR
     v_message.outbound_provider_accepted_at IS NULL OR
     v_message.metadata->>'source' IS DISTINCT FROM 'sales_contract_send_route' OR
     v_message.metadata->>'channel' IS DISTINCT FROM 'whatsapp' OR
     v_message.metadata->>'external_channel' IS DISTINCT FROM 'whatsapp' OR
     v_message.metadata->>'send_external' IS DISTINCT FROM 'true' OR
     v_message.metadata->>'outbound_origin' IS DISTINCT FROM 'sales_contract_send' OR
     v_message.metadata->>'outbound_idempotency_key' IS DISTINCT FROM v_key OR
     v_message.metadata->>'organization_id' IS DISTINCT FROM p_organization_id::text OR
     v_message.metadata->>'store_id' IS DISTINCT FROM p_store_id::text OR
     v_message.metadata->>'contract_id' IS DISTINCT FROM p_contract_id::text OR
     v_message.metadata->>'contract_version_id' IS DISTINCT FROM p_contract_version_id::text OR
     v_message.metadata->>'sales_contract_id' IS DISTINCT FROM p_contract_id::text OR
     v_message.metadata->>'sales_contract_version_id' IS DISTINCT FROM p_contract_version_id::text OR
     v_message.metadata->>'storage_bucket' IS DISTINCT FROM v_version.storage_bucket OR
     v_message.metadata->>'storage_path' IS DISTINCT FROM v_version.storage_path OR
     v_message.metadata->>'attachment_kind' IS DISTINCT FROM 'file' OR
     v_message.metadata->>'file_kind' IS DISTINCT FROM 'sales_contract_pdf' OR
     pg_catalog.lower(COALESCE(v_message.metadata->>'mime_type','')) IS DISTINCT FROM 'application/pdf' OR
     pg_catalog.lower(COALESCE(v_version.mime_type,'')) IS DISTINCT FROM 'application/pdf' OR
     NULLIF(pg_catalog.btrim(COALESCE(v_message.metadata->>'sent_by_user_id','')),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_CONTRACT_FINALIZATION_PROVIDER_EVIDENCE_INVALID';
  END IF;

  -- Reconciliacao idempotente exige que todo o estado ja esteja finalizado,
  -- inclusive liberacao; nunca libera silenciosamente uma barreira inesperada.
  IF v_message.outbound_commercial_finalized_at IS NOT NULL THEN
    IF v_contract.status IS DISTINCT FROM 'sent_to_customer' OR
       v_version.status IS DISTINCT FROM 'sent' OR
       v_barrier.released_at IS NULL OR
       v_barrier.release_reason IS DISTINCT FROM 'finalized' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_CONTRACT_FINALIZATION_INCONSISTENT_REPLAY';
    END IF;
    RETURN QUERY SELECT v_contract.id, v_version.id, v_message.id,
      v_message.external_message_id,
      COALESCE(v_version.sent_at,v_message.outbound_provider_accepted_at),
      false,'already_finalized'::text;
    RETURN;
  END IF;

  IF v_barrier.released_at IS NOT NULL OR
     v_contract.status IS DISTINCT FROM 'approved' OR
     v_version.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_CONTRACT_FINALIZATION_NOT_APPROVED_OR_BARRIER_RELEASED';
  END IF;

  v_sent_at := v_message.outbound_provider_accepted_at;
  UPDATE public.sales_contract_versions v
  SET status='sent', sent_at=COALESCE(v.sent_at,v_sent_at)
  WHERE v.id=p_contract_version_id AND v.contract_id=p_contract_id
    AND v.organization_id=p_organization_id AND v.store_id=p_store_id
    AND v.status='approved'
  RETURNING v.* INTO v_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P9_CONTRACT_FINALIZATION_VERSION_TRANSITION_LOST';
  END IF;

  UPDATE public.sales_contracts c
  SET status='sent_to_customer', sent_at=COALESCE(c.sent_at,v_sent_at),
      sent_by=(v_message.metadata->>'sent_by_user_id')::uuid
  WHERE c.id=p_contract_id AND c.organization_id=p_organization_id
    AND c.store_id=p_store_id AND c.status='approved'
    AND c.current_version_id=p_contract_version_id
  RETURNING c.* INTO v_contract;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P9_CONTRACT_FINALIZATION_CONTRACT_TRANSITION_LOST';
  END IF;

  IF v_contract.conversation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.conversation_events e
      WHERE e.organization_id=p_organization_id
        AND e.conversation_id=v_contract.conversation_id
        AND e.event_type='contrato_enviado'
        AND e.payload->>'message_id'=v_message.id::text
    ) THEN
    INSERT INTO public.conversation_events
      (conversation_id,organization_id,event_type,payload,created_by)
    VALUES
      (v_contract.conversation_id,p_organization_id,'contrato_enviado',
       pg_catalog.jsonb_build_object(
         'contract_id',v_contract.id,'contract_version_id',v_version.id,
         'message_id',v_message.id,'external_message_id',v_message.external_message_id,
         'outbound_idempotency_key',v_key,'status','sent'
       ),'system');
    v_event_created := true;
  END IF;

  UPDATE public.messages m
  SET outbound_commercial_finalized_at=pg_catalog.clock_timestamp(),
      outbound_commercial_error_at=NULL,
      outbound_commercial_error_text=NULL
  WHERE m.id=p_message_id AND m.organization_id=p_organization_id AND m.store_id=p_store_id
    AND m.outbound_delivery_state='sent' AND m.external_message_id=v_message.external_message_id
    AND m.outbound_provider_accepted_at IS NOT NULL AND m.outbound_commercial_finalized_at IS NULL
  RETURNING m.* INTO v_message;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P9_CONTRACT_FINALIZATION_MARKER_TRANSITION_LOST';
  END IF;

  -- MESMA transacao. A funcao interna verifica novamente contrato, proposta,
  -- comprovantes da Meta e marcador comercial antes de liberar a barreira.
  v_release_id := public.p9_release_sales_contract_send_barrier_finalized_internal(
    p_organization_id,p_store_id,p_contract_id,p_message_id,v_key
  );
  IF v_release_id IS DISTINCT FROM v_barrier.id THEN
    RAISE EXCEPTION 'P9_CONTRACT_FINALIZATION_RELEASE_MISMATCH';
  END IF;

  RETURN QUERY SELECT v_contract.id,v_version.id,v_message.id,
    v_message.external_message_id,v_sent_at,v_event_created,'finalized'::text;
END;
$function$;


-- ===== p9_release_sales_contract_send_barrier_finalized_internal =====

CREATE OR REPLACE FUNCTION public.p9_release_sales_contract_send_barrier_finalized_internal(p_organization_id uuid, p_store_id uuid, p_contract_id uuid, p_message_id uuid, p_idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp', 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
  v_barrier public.p9_sales_contract_send_barriers%ROWTYPE;
  v_locked public.p9_sales_contract_send_barriers%ROWTYPE;
  v_opportunity public.commercial_opportunities%ROWTYPE;
  v_contract public.sales_contracts%ROWTYPE;
  v_version public.sales_contract_versions%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_key text := NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key, '')), '');
  v_evidence jsonb;
  v_origin text;
BEGIN
  IF p_organization_id IS NULL OR p_store_id IS NULL OR p_contract_id IS NULL
     OR p_message_id IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'P9_BARRIER_RELEASE_SCOPE_REQUIRED';
  END IF;

  -- Identity discovery only: no row lock before the opportunity advisory lock.
  SELECT b.* INTO v_barrier
  FROM public.p9_sales_contract_send_barriers b
  WHERE b.organization_id = p_organization_id
    AND b.store_id = p_store_id
    AND b.sales_contract_id = p_contract_id
    AND b.message_id = p_message_id
    AND b.outbound_idempotency_key = v_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P9_BARRIER_RELEASE_MATCH_NOT_FOUND';
  END IF;
  IF v_key IS DISTINCT FROM
       'sales_contract_send:' || p_organization_id::text || ':' || p_store_id::text
       || ':' || p_contract_id::text || ':' || v_barrier.sales_contract_version_id::text THEN
    RAISE EXCEPTION 'P9_BARRIER_RELEASE_KEY_INVALID';
  END IF;

  PERFORM public.p9_acquire_sales_contract_send_domain_lock(
    p_organization_id, p_store_id, v_barrier.commercial_opportunity_id
  );

  -- Match approval, lineage and barrier activation relational order:
  -- contract -> version -> opportunity -> message -> barrier.
  -- The domain advisory lock above must be acquired by the calling
  -- finalizer BEFORE it takes any relational row locks.
  SELECT c.* INTO v_contract FROM public.sales_contracts c
  WHERE c.id = p_contract_id
    AND c.organization_id = p_organization_id AND c.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_RELEASE_CONTRACT_NOT_FOUND'; END IF;

  SELECT v.* INTO v_version FROM public.sales_contract_versions v
  WHERE v.id = v_barrier.sales_contract_version_id AND v.contract_id = p_contract_id
    AND v.organization_id = p_organization_id AND v.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_RELEASE_VERSION_NOT_FOUND'; END IF;

  SELECT o.* INTO v_opportunity
  FROM public.commercial_opportunities o
  WHERE o.id = v_barrier.commercial_opportunity_id
    AND o.organization_id = p_organization_id AND o.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_RELEASE_OPPORTUNITY_NOT_FOUND'; END IF;

  SELECT m.* INTO v_message FROM public.messages m
  WHERE m.id = p_message_id
    AND m.organization_id = p_organization_id AND m.store_id = p_store_id
    AND m.deleted_at IS NULL AND m.outbound_idempotency_key = v_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_RELEASE_MESSAGE_NOT_FOUND'; END IF;

  SELECT b.* INTO v_locked FROM public.p9_sales_contract_send_barriers b
  WHERE b.id = v_barrier.id
    AND b.organization_id = p_organization_id AND b.store_id = p_store_id
    AND b.sales_contract_id = p_contract_id AND b.message_id = p_message_id
    AND b.outbound_idempotency_key = v_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_RELEASE_BARRIER_CHANGED'; END IF;

  -- A liberacao revalida a mesma origem, nunca transforma manual em legado.
  v_origin := v_locked.contract_origin;
  IF v_origin = 'responsible_text_draft' THEN
    IF v_contract.metadata->>'created_via' IS DISTINCT FROM 'create_sales_contract_manual_by_system'
       OR v_contract.metadata->>'source' IS DISTINCT FROM 'responsible_text_draft'
       OR v_contract.quote_id IS NOT NULL OR v_contract.quote_version_id IS NOT NULL
       OR v_locked.sales_quote_id IS NOT NULL OR v_locked.sales_quote_version_id IS NOT NULL
       OR v_contract.metadata->>'commercial_opportunity_id' IS DISTINCT FROM v_opportunity.id::text
       OR v_contract.metadata->>'customer_id' IS DISTINCT FROM v_opportunity.customer_id::text
       OR v_contract.metadata->>'commercial_amounts_authoritative' IS DISTINCT FROM 'false'
       OR v_message.metadata->>'contract_origin' IS DISTINCT FROM v_origin THEN
      RAISE EXCEPTION 'P9_BARRIER_RELEASE_MANUAL_ORIGIN_INVALID';
    END IF;
  ELSIF v_origin = 'accepted_quote_version_snapshot' THEN
    IF v_contract.quote_id IS NULL OR v_contract.quote_version_id IS NULL
       OR v_opportunity.current_quote_id IS DISTINCT FROM v_locked.sales_quote_id
       OR v_opportunity.current_quote_version_id IS DISTINCT FROM v_locked.sales_quote_version_id
       OR v_contract.metadata->>'source' = 'responsible_text_draft'
       OR v_contract.metadata->>'created_via' = 'create_sales_contract_manual_by_system'
       THEN
      RAISE EXCEPTION 'P9_BARRIER_RELEASE_QUOTE_ORIGIN_INVALID';
    END IF;
  ELSE
    RAISE EXCEPTION 'P9_BARRIER_RELEASE_ORIGIN_UNKNOWN';
  END IF;

  IF v_locked.released_at IS NOT NULL THEN
    IF v_locked.release_reason = 'finalized' THEN
      RETURN v_locked.id; -- Idempotent finalized replay, no new external send.
    END IF;
    RAISE EXCEPTION 'P9_BARRIER_RELEASE_ALREADY_RECONCILED_OTHER_REASON';
  END IF;

  IF v_contract.current_version_id IS DISTINCT FROM v_version.id
     OR v_contract.quote_id IS DISTINCT FROM v_locked.sales_quote_id
     OR v_contract.quote_version_id IS DISTINCT FROM v_locked.sales_quote_version_id
     OR v_contract.status IS DISTINCT FROM 'sent_to_customer'
     OR v_version.status IS DISTINCT FROM 'sent'
     OR v_message.outbound_delivery_state IS DISTINCT FROM 'sent'
     OR NULLIF(pg_catalog.btrim(COALESCE(v_message.external_message_id, '')), '') IS NULL
     OR v_message.outbound_provider_accepted_at IS NULL
     OR v_message.outbound_commercial_finalized_at IS NULL
     OR v_message.conversation_id IS DISTINCT FROM v_contract.conversation_id
     OR v_message.metadata->>'outbound_origin' IS DISTINCT FROM 'sales_contract_send'
     OR v_message.metadata->>'sales_contract_id' IS DISTINCT FROM p_contract_id::text
     OR v_message.metadata->>'sales_contract_version_id' IS DISTINCT FROM v_version.id::text THEN
    RAISE EXCEPTION 'P9_BARRIER_RELEASE_NOT_COMMERCIALLY_FINALIZED';
  END IF;

  v_evidence := pg_catalog.jsonb_build_object(
    'message_id', v_message.id,
    'external_message_id', v_message.external_message_id,
    'provider_accepted_at', v_message.outbound_provider_accepted_at,
    'commercial_finalized_at', v_message.outbound_commercial_finalized_at
  );

  UPDATE public.p9_sales_contract_send_barriers b
  SET released_at = pg_catalog.clock_timestamp(),
      release_reason = 'finalized',
      release_evidence = v_evidence
  WHERE b.id = v_locked.id AND b.released_at IS NULL
  RETURNING b.* INTO v_locked;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_RELEASE_UPDATE_LOST'; END IF;
  RETURN v_locked.id;
END;
$function$;


DO $postflight$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_catalog.pg_proc p
  WHERE p.oid IN (
    'public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)'::regprocedure,
    'public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure,
    'public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid)'::regprocedure,
    'public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text)'::regprocedure,
    'public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)'::regprocedure
  )
    AND p.prosecdef AND p.proowner='postgres'::regrole
    AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp, public', 'row_security=off']::text[];
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'P9_MANUAL_SEND_POSTFLIGHT_SECURITY_CHANGED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid='public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure
      AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%contract_origin,%'
      AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%v_origin,%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid='public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)'::regprocedure
      AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%contract_origin%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid='public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text)'::regprocedure
      AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%P9_CONTRACT_FINALIZATION_MANUAL_ORIGIN_INVALID%'
  ) THEN
    RAISE EXCEPTION 'P9_MANUAL_SEND_POSTFLIGHT_ORIGIN_NOT_INSTALLED';
  END IF;
END;
$postflight$;

SELECT 'PASS' AS resultado,
       'P9_MANUAL_SEND_SQL_AUTHORITIES_INSTALLED' AS componente,
       'NO_CONTRACT_CREATED_NO_WHATSAPP_SEND' AS transporte;
COMMIT;

-- ZION | Pilar 9 | Bloco 9 | Etapa 9.3-B
-- Finalizacao canonica de envio contratual ja aceito pela Meta.
-- Forward-only, instalacao inerte: NAO envia, enfileira, materializa nem
-- finaliza nenhuma mensagem durante esta migration.
-- Contratos nao entram no seletor externo do WhatsApp nesta migration.
-- A autoridade interna de liberacao e chamada na MESMA transacao, somente
-- apos status comercial e marcador de finalizacao duravel serem gravados.
-- Estados uncertain/processing/pending nao sao finalizados nem reenviados.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

DO $preflight$
DECLARE
  v_gate oid := pg_catalog.to_regprocedure('public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid)');
  v_release oid := pg_catalog.to_regprocedure('public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)');
  v_materialize oid := pg_catalog.to_regprocedure('public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)');
BEGIN
  IF pg_catalog.to_regprocedure('public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'P9_FINALIZATION_RPC_ALREADY_EXISTS_REVIEW_REQUIRED';
  END IF;
  IF v_gate IS NULL OR v_release IS NULL OR v_materialize IS NULL OR
     pg_catalog.md5(pg_catalog.pg_get_functiondef(v_gate)) IS DISTINCT FROM '15cad4d9bd0ea0516363513a1d1749ce' OR
     pg_catalog.md5(pg_catalog.pg_get_functiondef(v_release)) IS DISTINCT FROM '7569448037c2673fa6998f6cfb3d375e' OR
     pg_catalog.md5(pg_catalog.pg_get_functiondef(v_materialize)) IS DISTINCT FROM '8b236586cf6816b824a9778dd218f4d9' THEN
    RAISE EXCEPTION 'P9_FINALIZATION_DEPENDENCY_VERSION_CHANGED';
  END IF;
  IF pg_catalog.to_regprocedure('public.p9_acquire_sales_contract_send_domain_lock(uuid,uuid,uuid)') IS NULL OR
     pg_catalog.to_regprocedure('public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)') IS NULL OR
     pg_catalog.to_regclass('public.p9_sales_contract_send_barriers') IS NULL OR
     pg_catalog.to_regclass('public.conversation_events') IS NULL THEN
    RAISE EXCEPTION 'P9_FINALIZATION_REQUIRED_DEPENDENCY_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'public.p9_sales_contract_send_barriers'::pg_catalog.regclass
      AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'P9_FINALIZATION_BARRIER_RLS_INVALID';
  END IF;
  IF pg_catalog.has_function_privilege('anon',v_release,'EXECUTE') OR
     pg_catalog.has_function_privilege('authenticated',v_release,'EXECUTE') OR
     pg_catalog.has_function_privilege('service_role',v_release,'EXECUTE') OR
     NOT pg_catalog.has_function_privilege('service_role',v_gate,'EXECUTE') OR
     NOT pg_catalog.has_function_privilege('service_role',v_materialize,'EXECUTE') THEN
    RAISE EXCEPTION 'P9_FINALIZATION_AUTHORITY_GRANTS_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.p9_sales_contract_send_barriers) OR
     EXISTS (SELECT 1 FROM public.messages
             WHERE metadata->>'outbound_origin'='sales_contract_send' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'P9_FINALIZATION_EXISTING_ATTEMPTS_REQUIRE_REVIEW';
  END IF;
  IF pg_catalog.to_regprocedure('public.get_pending_external_messages_v2(uuid,uuid,integer,integer)') IS NULL OR
     pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'public.get_pending_external_messages_v2(uuid,uuid,integer,integer)'::pg_catalog.regprocedure
     ), 'sales_contract_send') > 0 THEN
    RAISE EXCEPTION 'P9_FINALIZATION_EXTERNAL_SELECTOR_MUST_REMAIN_DISABLED';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.finalize_sales_contract_send_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_contract_id uuid,
  p_contract_version_id uuid,
  p_message_id uuid,
  p_idempotency_key text,
  p_source text
)
RETURNS TABLE (
  sales_contract_id uuid,
  sales_contract_version_id uuid,
  message_id uuid,
  external_message_id text,
  sent_at timestamptz,
  conversation_event_created boolean,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp, public
SET row_security = off
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
  v_quote_id uuid;
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

  -- Nao e suficiente ter status 'sent': exigir ID, aceite e escopo completos.
  IF v_contract.quote_id IS DISTINCT FROM v_barrier.sales_quote_id OR
     v_contract.quote_version_id IS DISTINCT FROM v_barrier.sales_quote_version_id OR
     v_contract.current_version_id IS DISTINCT FROM v_version.id OR
     v_opportunity.current_quote_id IS DISTINCT FROM v_contract.quote_id OR
     v_opportunity.current_quote_version_id IS DISTINCT FROM v_contract.quote_version_id OR
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

ALTER FUNCTION public.finalize_sales_contract_send_by_system(
  uuid,uuid,uuid,uuid,uuid,text,text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_sales_contract_send_by_system(
  uuid,uuid,uuid,uuid,uuid,text,text
) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_sales_contract_send_by_system(
  uuid,uuid,uuid,uuid,uuid,text,text
) TO service_role;

DO $postconditions$
DECLARE
  v_finalizer oid := pg_catalog.to_regprocedure('public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text)');
  v_sql text;
BEGIN
  IF v_finalizer IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid=v_finalizer AND p.prosecdef AND p.proowner='postgres'::pg_catalog.regrole
    ) OR pg_catalog.has_function_privilege('anon',v_finalizer,'EXECUTE') OR
      pg_catalog.has_function_privilege('authenticated',v_finalizer,'EXECUTE') OR
      NOT pg_catalog.has_function_privilege('service_role',v_finalizer,'EXECUTE') THEN
    RAISE EXCEPTION 'P9_FINALIZATION_SECURITY_POSTCONDITION_FAILED';
  END IF;
  v_sql := pg_catalog.pg_get_functiondef(v_finalizer);
  IF pg_catalog.strpos(v_sql,'p9_acquire_sales_contract_send_domain_lock')=0 OR
     pg_catalog.strpos(v_sql,'p9_release_sales_contract_send_barrier_finalized_internal')=0 OR
     pg_catalog.strpos(v_sql,'outbound_provider_accepted_at')=0 OR
     pg_catalog.strpos(v_sql,'outbound_commercial_finalized_at')=0 THEN
    RAISE EXCEPTION 'P9_FINALIZATION_BODY_POSTCONDITION_FAILED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.p9_sales_contract_send_barriers) OR
     EXISTS (SELECT 1 FROM public.messages
             WHERE metadata->>'outbound_origin'='sales_contract_send' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'P9_FINALIZATION_UNEXPECTED_INSTALL_SIDE_EFFECT';
  END IF;
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'public.get_pending_external_messages_v2(uuid,uuid,integer,integer)'::pg_catalog.regprocedure
     ),'sales_contract_send')>0 THEN
    RAISE EXCEPTION 'P9_FINALIZATION_EXTERNAL_PATH_UNEXPECTEDLY_ENABLED';
  END IF;
END;
$postconditions$;
COMMIT;

SELECT 'PASS' AS resultado,
       'FINALIZACAO_CANONICA_INSTALADA' AS correcao,
       pg_catalog.md5(pg_catalog.pg_get_functiondef(
         'public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text)'::pg_catalog.regprocedure
       )) AS hash_funcao,
       'NAO_HABILITADO' AS envio_externo;

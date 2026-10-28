-- ZION | Pilar 9 | Bloco 9 | Etapa 9.3-B
-- RPC do gate pre-Meta, sem habilitar a selecao externa de contratos.
-- Preflight da janela -> ativacao atomica da barreira -> revalidacao de janela
-- -> processing -> uncertain na MESMA transacao.
-- Nao executar esta funcao diretamente no SQL Editor: instalar apenas a definicao.
-- Nao habilitar get_pending_external_messages_v2 nesta migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

DO $preflight$
DECLARE
  v_activation oid := to_regprocedure('public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)');
  v_materialization oid := to_regprocedure('public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)');
  v_24h oid := to_regprocedure('public.read_customer_whatsapp_24h_window_by_system(uuid,uuid,uuid)');
BEGIN
  IF to_regprocedure('public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'P9_PRE_META_GATE_ALREADY_EXISTS';
  END IF;
  IF v_activation IS NULL OR v_materialization IS NULL OR v_24h IS NULL OR
     md5(pg_catalog.pg_get_functiondef(v_activation)) IS DISTINCT FROM 'c11747791670ba1893b66bca9e36e20d' OR
     md5(pg_catalog.pg_get_functiondef(v_materialization)) IS DISTINCT FROM '8b236586cf6816b824a9778dd218f4d9' OR
     md5(pg_catalog.pg_get_functiondef(v_24h)) IS DISTINCT FROM 'f17526de1f4d9f74727991bea0afb9af' THEN
    RAISE EXCEPTION 'P9_PRE_META_GATE_DEPENDENCY_VERSION_CHANGED';
  END IF;
  IF to_regprocedure('public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)') IS NULL OR
     md5(pg_catalog.pg_get_functiondef('public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)'::regprocedure))
       IS DISTINCT FROM '7569448037c2673fa6998f6cfb3d375e' THEN
    RAISE EXCEPTION 'P9_PRE_META_GATE_RELEASE_AUTHORITY_CHANGED';
  END IF;
  IF pg_catalog.to_regclass('public.p9_sales_contract_send_barriers') IS NULL OR
     NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_class
       WHERE oid = 'public.p9_sales_contract_send_barriers'::regclass
         AND relrowsecurity AND relforcerowsecurity
     ) THEN
    RAISE EXCEPTION 'P9_PRE_META_GATE_BARRIER_RLS_CHANGED';
  END IF;
  IF pg_catalog.has_function_privilege('service_role', v_activation, 'EXECUTE') OR
     NOT pg_catalog.has_function_privilege('service_role', v_materialization, 'EXECUTE') OR
     NOT pg_catalog.has_function_privilege('service_role', v_24h, 'EXECUTE') THEN
    RAISE EXCEPTION 'P9_PRE_META_GATE_AUTHORITY_GRANTS_CHANGED';
  END IF;
  -- Nao instalar seletor externo neste passo, nem sobrepor outras origens WhatsApp.
  IF to_regprocedure('public.get_pending_external_messages_v2(uuid,uuid,integer,integer)') IS NULL OR
     strpos(pg_catalog.pg_get_functiondef('public.get_pending_external_messages_v2(uuid,uuid,integer,integer)'::regprocedure), 'sales_contract_send') > 0 THEN
    RAISE EXCEPTION 'P9_PRE_META_GATE_EXTERNAL_SELECTOR_MUST_REMAIN_DISABLED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.p9_sales_contract_send_barriers) OR
     EXISTS (SELECT 1 FROM public.messages
             WHERE metadata ->> 'outbound_origin' = 'sales_contract_send' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'P9_PRE_META_GATE_EXISTING_ATTEMPTS_REQUIRE_REVIEW';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.validate_or_start_sales_contract_send_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_message_id uuid
)
RETURNS jsonb
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
  SELECT q.commercial_opportunity_id, c.conversation_id
    INTO v_opportunity_id, v_conversation_id
  FROM public.sales_contracts c
  JOIN public.sales_quotes q ON q.id = c.quote_id
    AND q.organization_id = c.organization_id AND q.store_id = c.store_id
  WHERE c.id = v_contract_id AND c.organization_id = p_organization_id
    AND c.store_id = p_store_id AND q.commercial_opportunity_id IS NOT NULL;
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

ALTER FUNCTION public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid)
  TO service_role;

DO $postconditions$
DECLARE
  v_oid oid := to_regprocedure('public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid)');
  v_body text;
BEGIN
  IF v_oid IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid
      AND p.prosecdef AND p.proowner = 'postgres'::regrole
    ) OR pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
      OR NOT pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'P9_PRE_META_GATE_SECURITY_POSTCONDITION_FAILED';
  END IF;
  v_body := pg_catalog.pg_get_functiondef(v_oid);
  IF strpos(v_body, 'p9_activate_sales_contract_send_barrier_internal') = 0 OR
     strpos(v_body, 'outbound_delivery_state = ''uncertain''') = 0 OR
     strpos(v_body, 'read_customer_whatsapp_24h_window_by_system') = 0 THEN
    RAISE EXCEPTION 'P9_PRE_META_GATE_BODY_POSTCONDITION_FAILED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.p9_sales_contract_send_barriers) OR
     EXISTS (SELECT 1 FROM public.messages
             WHERE metadata ->> 'outbound_origin' = 'sales_contract_send' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'P9_PRE_META_GATE_UNEXPECTED_RUNTIME_SIDE_EFFECT';
  END IF;
  IF to_regprocedure('public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text)') IS NOT NULL OR
     strpos(pg_catalog.pg_get_functiondef('public.get_pending_external_messages_v2(uuid,uuid,integer,integer)'::regprocedure),
       'sales_contract_send') > 0 THEN
    RAISE EXCEPTION 'P9_PRE_META_GATE_EXTERNAL_PATH_UNEXPECTEDLY_ENABLED';
  END IF;
END;
$postconditions$;
COMMIT;

SELECT 'PASS' AS resultado,
       'GATE_PRE_META_CANONICO_INSTALADO' AS correcao,
       md5(pg_catalog.pg_get_functiondef(
         'public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid)'::regprocedure
       )) AS hash_funcao,
       'NAO_HABILITADO' AS envio_externo;

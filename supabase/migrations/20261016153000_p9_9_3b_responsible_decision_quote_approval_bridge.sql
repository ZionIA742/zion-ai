-- ZION P9 / 9.3-B / 1F: ponte atomica entre decisao humana 1E e
-- aprovacao canonica da V2 exigida pelo envio ao cliente.
-- Corrige a promocao da V2 e impede bypass pelo approve/send legado.
-- Nao envia mensagens. Nao muda o fluxo V1.
-- IMPORTANTE: instalar APOS 20261016150000 (1E) e a autoridade 20260922183000.
BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure(
    'public.p9_decide_quote_approval_by_responsible_by_system(uuid,uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'P9_1F_REQUIRES_INSTALLED_1E_DECISION_RPC';
  END IF;
  IF to_regprocedure(
    'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'P9_1F_CANONICAL_VERSION_APPROVAL_RPC_MISSING';
  END IF;
  IF to_regclass('public.p9_accepted_quote_revisions') IS NULL THEN
    RAISE EXCEPTION 'P9_1F_ACCEPTED_REVISION_LEDGER_MISSING';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.p9_decide_quote_approval_by_responsible_by_system(
  p_request_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_responsible_id uuid,
  p_commercial_opportunity_id uuid,
  p_expected_lifecycle_cycle integer,
  p_quote_id uuid,
  p_quote_version_id uuid,
  p_decision_inbound_message_id uuid,
  p_decision_external_message_id text,
  p_decision text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  v_request public.p9_responsible_commercial_approval_requests%ROWTYPE;
  v_message public.store_assistant_messages%ROWTYPE;
  v_opportunity record;
  v_quote record;
  v_version record;
  v_responsible record;
  v_external_id text;
  v_reply_to text;
  v_normalized text;
  v_derived_decision text;
  v_phone text;
  v_responsible_phone text;
  v_active_count bigint;
  v_primary_count bigint;
  v_approved_version_count integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_SERVICE_ROLE_REQUIRED';
  END IF;

  v_external_id := NULLIF(btrim(COALESCE(p_decision_external_message_id, '')), '');
  IF p_request_id IS NULL OR p_organization_id IS NULL OR p_store_id IS NULL
     OR p_responsible_id IS NULL OR p_commercial_opportunity_id IS NULL
     OR p_expected_lifecycle_cycle IS NULL OR p_expected_lifecycle_cycle < 1
     OR p_quote_id IS NULL OR p_quote_version_id IS NULL
     OR p_decision_inbound_message_id IS NULL
     OR v_external_id IS NULL OR length(v_external_id) > 512
     OR p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_ARGUMENTS_INVALID';
  END IF;

  -- Mesma ordem de lock das autoridades de criacao e entrega da solicitacao.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'p9_quote_approval:' || p_organization_id::text || ':' || p_store_id::text
      || ':' || p_commercial_opportunity_id::text, 0
  ));

  SELECT * INTO v_request
  FROM public.p9_responsible_commercial_approval_requests r
  WHERE r.id = p_request_id
    AND r.organization_id = p_organization_id
    AND r.store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.request_kind <> 'quote_send_approval'
     OR v_request.responsible_id IS DISTINCT FROM p_responsible_id
     OR v_request.commercial_opportunity_id IS DISTINCT FROM p_commercial_opportunity_id
     OR v_request.lifecycle_cycle IS DISTINCT FROM p_expected_lifecycle_cycle
     OR v_request.quote_id IS DISTINCT FROM p_quote_id
     OR v_request.quote_version_id IS DISTINCT FROM p_quote_version_id THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_REQUEST_SCOPE_MISMATCH';
  END IF;

  -- Obter o conteudo da mensagem salva pelo inbox: NUNCA confiar no texto
  -- nem no telefone ou identificador externo passados pelo chamador.
  SELECT * INTO v_message
  FROM public.store_assistant_messages m
  WHERE m.id = p_decision_inbound_message_id
    AND m.organization_id = p_organization_id
    AND m.store_id = p_store_id
    AND m.sender_role = 'store_responsible'
    AND m.direction = 'incoming'
    AND m.message_type = 'text'
    AND m.metadata->>'origin' = 'whatsapp'
    AND m.metadata->>'responsible_id' = p_responsible_id::text
    AND m.metadata->>'external_message_id' = v_external_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_INBOUND_NOT_VERIFIED';
  END IF;

  IF length(btrim(v_message.content)) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_TEXT_INVALID';
  END IF;

  v_normalized := btrim(regexp_replace(
    translate(lower(btrim(v_message.content)),
      'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
    '[[:space:][:punct:]]+', ' ', 'g'
  ));

  -- Somente decisoes inequivocas; 'sim', 'ok', 'pode' e frases livres
  -- continuam sob a Assistente e NAO autorizam nenhuma proposta.
  IF v_normalized IN (
    'aprovo', 'aprovado', 'aprovada', 'aprovar',
    'autorizo', 'autorizado', 'autorizada',
    'aprovo o orcamento', 'aprovo este orcamento',
    'aprovado o orcamento', 'aprovo a proposta',
    'aprovada a proposta', 'autorizo o envio do orcamento',
    'autorizo o envio da proposta'
  ) THEN
    v_derived_decision := 'approved';
  ELSIF v_normalized IN (
    'rejeito', 'rejeitado', 'rejeitada', 'rejeitar',
    'recuso', 'nao aprovo', 'nao autorizo',
    'rejeito o orcamento', 'rejeito este orcamento',
    'rejeito a proposta', 'nao aprovo o orcamento',
    'nao aprovo a proposta', 'nao autorizo o envio do orcamento',
    'nao autorizo o envio da proposta'
  ) THEN
    v_derived_decision := 'rejected';
  ELSE
    RAISE EXCEPTION 'P9_QUOTE_DECISION_TEXT_AMBIGUOUS';
  END IF;

  IF v_derived_decision <> p_decision THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_DECLARED_TEXT_CONFLICT';
  END IF;

  -- Replay da MESMA mensagem ja decidida. Nenhuma nova alteracao.
  IF v_request.status IN ('approved', 'rejected') THEN
    IF v_request.status = v_derived_decision
       AND v_request.decision_inbound_message_id = v_message.id
       AND v_request.decision_external_message_id = v_external_id
       AND v_request.decision_text = v_message.content
       AND v_request.decided_at IS NOT NULL THEN
      IF v_request.status = 'approved' AND NOT EXISTS (
        SELECT 1
        FROM public.sales_quotes q
        JOIN public.sales_quote_versions v
          ON v.id = q.current_version_id
         AND v.quote_id = q.id
         AND v.organization_id = q.organization_id
         AND v.store_id = q.store_id
        WHERE q.id = p_quote_id
          AND q.organization_id = p_organization_id
          AND q.store_id = p_store_id
          AND q.current_version_id = p_quote_version_id
          AND q.status = 'approved'
          AND v.status = 'approved'
          AND v.sent_at IS NULL
      ) THEN
        RAISE EXCEPTION 'P9_QUOTE_DECISION_APPROVED_REPLAY_STATE_CONFLICT';
      END IF;

      RETURN jsonb_build_object(
        'request_id', v_request.id, 'status', v_request.status,
        'quote_version_id', v_request.quote_version_id,
        'decision_inbound_message_id', v_message.id,
        'outcome', 'replayed'
      );
    END IF;
    RAISE EXCEPTION 'P9_QUOTE_DECISION_ALREADY_DECIDED_CONFLICT';
  END IF;

  IF v_request.status <> 'awaiting_responsible' THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_REQUEST_NOT_AWAITING_RESPONSIBLE';
  END IF;

  SELECT count(*) INTO v_primary_count
  FROM public.store_responsibles r
  WHERE r.organization_id = p_organization_id AND r.store_id = p_store_id
    AND r.is_primary IS TRUE AND r.is_active IS TRUE;
  IF v_primary_count <> 1 THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_PRIMARY_RESPONSIBLE_AMBIGUOUS';
  END IF;

  SELECT r.whatsapp_number INTO v_responsible
  FROM public.store_responsibles r
  WHERE r.id = p_responsible_id AND r.organization_id = p_organization_id
    AND r.store_id = p_store_id AND r.is_primary IS TRUE AND r.is_active IS TRUE
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_RESPONSIBLE_INACTIVE';
  END IF;
  v_phone := regexp_replace(COALESCE(v_message.metadata->>'from_phone', ''), '[^0-9]', '', 'g');
  v_responsible_phone := regexp_replace(COALESCE(v_responsible.whatsapp_number, ''), '[^0-9]', '', 'g');
  IF v_phone = '' OR v_responsible_phone = '' OR v_phone <> v_responsible_phone THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_ORIGIN_PHONE_MISMATCH';
  END IF;

  SELECT o.lifecycle_cycle, o.stage INTO v_opportunity
  FROM public.commercial_opportunities o
  WHERE o.id = p_commercial_opportunity_id
    AND o.organization_id = p_organization_id AND o.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND OR v_opportunity.lifecycle_cycle <> p_expected_lifecycle_cycle
     OR v_opportunity.stage IN ('perdido', 'concluido') THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_OPPORTUNITY_STALE';
  END IF;

  SELECT q.current_version_id, q.status INTO v_quote
  FROM public.sales_quotes q
  WHERE q.id = p_quote_id AND q.commercial_opportunity_id = p_commercial_opportunity_id
    AND q.organization_id = p_organization_id AND q.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND OR v_quote.current_version_id IS DISTINCT FROM p_quote_version_id
     OR v_quote.status IN ('cancelled', 'expired', 'failed') THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_QUOTE_STALE';
  END IF;

  -- 1E aprova somente a versao revisada pela autoridade 1B,
  -- nunca a proposta inicial ou versao de outra negociacao.
  IF NOT EXISTS (
    SELECT 1 FROM public.p9_accepted_quote_revisions ar
    WHERE ar.organization_id = p_organization_id
      AND ar.store_id = p_store_id
      AND ar.commercial_opportunity_id = p_commercial_opportunity_id
      AND ar.lifecycle_cycle = p_expected_lifecycle_cycle
      AND ar.quote_id = p_quote_id
      AND ar.target_quote_version_id = p_quote_version_id
  ) THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_NOT_AN_ACCEPTED_QUOTE_REVISION';
  END IF;

  SELECT v.status, v.sent_at INTO v_version
  FROM public.sales_quote_versions v
  WHERE v.id = p_quote_version_id AND v.quote_id = p_quote_id
    AND v.organization_id = p_organization_id AND v.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND OR v_version.sent_at IS NOT NULL
     OR v_version.status IN ('sent', 'superseded', 'failed') THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_VERSION_STALE';
  END IF;

  -- Confirmar que relatorio E PDF da mesma solicitacao foram aceitos pela Meta
  -- antes da mensagem de decisao.
  IF (
    SELECT count(*)
    FROM public.p9_quote_approval_delivery_parts p
    WHERE p.request_id = v_request.id
      AND p.organization_id = p_organization_id
      AND p.store_id = p_store_id
      AND p.component IN ('report', 'pdf')
      AND p.status = 'accepted'
      AND p.accepted_at IS NOT NULL
      AND p.accepted_at <= v_message.created_at
  ) <> 2 THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_DELIVERY_NOT_CONFIRMED';
  END IF;

  v_reply_to := NULLIF(btrim(COALESCE(v_message.metadata->>'context_message_id', '')), '');
  IF v_reply_to IS NOT NULL THEN
    -- Uma resposta citando outra conversa/documento NAO pode decidir V2.
    IF NOT EXISTS (
      SELECT 1 FROM public.p9_quote_approval_delivery_parts p
      WHERE p.request_id = v_request.id
        AND p.component IN ('report', 'pdf') AND p.status = 'accepted'
        AND p.external_message_id = v_reply_to
    ) THEN
      RAISE EXCEPTION 'P9_QUOTE_DECISION_REPLY_CONTEXT_MISMATCH';
    END IF;
  ELSE
    -- Sem reply especifico: somente frase que nomeie orcamento/proposta,
    -- e somente uma solicitacao aguardando por esse responsavel.
    IF v_normalized NOT IN (
      'aprovo o orcamento', 'aprovo este orcamento',
      'aprovado o orcamento', 'aprovo a proposta',
      'aprovada a proposta', 'autorizo o envio do orcamento',
      'autorizo o envio da proposta', 'rejeito o orcamento',
      'rejeito este orcamento', 'rejeito a proposta',
      'nao aprovo o orcamento', 'nao aprovo a proposta',
      'nao autorizo o envio do orcamento',
      'nao autorizo o envio da proposta'
    ) THEN
      RAISE EXCEPTION 'P9_QUOTE_DECISION_EXPLICIT_CONTEXT_REQUIRED';
    END IF;
    SELECT count(*) INTO v_active_count
    FROM public.p9_responsible_commercial_approval_requests a
    WHERE a.organization_id = p_organization_id
      AND a.store_id = p_store_id AND a.responsible_id = p_responsible_id
      AND a.request_kind = 'quote_send_approval'
      AND a.status = 'awaiting_responsible';
    IF v_active_count <> 1 THEN
      RAISE EXCEPTION 'P9_QUOTE_DECISION_MULTIPLE_AWAITING_REQUESTS';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.p9_responsible_commercial_approval_requests a
    WHERE a.decision_inbound_message_id = v_message.id
       OR (a.organization_id = p_organization_id AND a.store_id = p_store_id
           AND a.decision_external_message_id = v_external_id)
  ) THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_MESSAGE_ALREADY_USED';
  END IF;

  -- Registrar a decisao dentro da transacao ANTES de aprovar a quote.
  -- Isso permite ao gate canonico confirmar a evidencia da mesma V2.
  -- Se a aprovacao de versao falhar, esta gravacao tambem e desfeita.
  UPDATE public.p9_responsible_commercial_approval_requests
  SET status = v_derived_decision,
      decision_inbound_message_id = v_message.id,
      decision_external_message_id = v_external_id,
      decision_text = v_message.content,
      decided_at = now(),
      updated_at = now()
  WHERE id = v_request.id AND organization_id = p_organization_id
    AND store_id = p_store_id AND status = 'awaiting_responsible';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P9_QUOTE_DECISION_CONCURRENT_STATUS_CHANGED';
  END IF;

  -- Acoplamento atomico: somente a aprovacao explicita aprova a V2 comercial.
  -- A RPC legada faz a transicao da versao atual, quote e evento de negocio;
  -- se qualquer etapa falhar, TODA esta transacao (inclusive a decisao) aborta.
  -- A identidade persistida corresponde ao responsavel que realmente respondeu,
  -- ja validado por mensagem, telefone, loja e request, nao a um usuario ficticio.
  IF v_derived_decision = 'approved' THEN
    SELECT count(*)::integer
      INTO v_approved_version_count
    FROM public.approve_sales_quote_version_by_system(
      p_organization_id,
      p_store_id,
      p_quote_id,
      p_quote_version_id,
      v_request.responsible_id
    ) AS approved_version
    WHERE approved_version.id = p_quote_version_id
      AND approved_version.quote_id = p_quote_id
      AND approved_version.status = 'approved';

    IF v_approved_version_count <> 1 THEN
      RAISE EXCEPTION 'P9_QUOTE_DECISION_VERSION_APPROVAL_NOT_CONFIRMED';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_request.id, 'status', v_derived_decision,
    'quote_version_id', v_request.quote_version_id,
    'decision_inbound_message_id', v_message.id,
    'outcome', 'decided'
  );
END;
$function$;
-- Gate SQL: nenhuma V2 materializada pela 1B pode tornar-se approved/sent
-- atraves de /approve, sender ou writer legado sem decisao humana registrada.
-- Nao se aplica a V1 nem a revisoes que nao tenham lineage 1B.
CREATE OR REPLACE FUNCTION public.p9_assert_accepted_revision_responsible_approval_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET row_security TO 'off'
AS $guard$
BEGIN
  IF NEW.status IN ('approved', 'sent')
     AND NEW.current_version_id IS NOT NULL
     AND NEW.commercial_opportunity_id IS NOT NULL
     AND (
       OLD.status IS DISTINCT FROM NEW.status
       OR OLD.current_version_id IS DISTINCT FROM NEW.current_version_id
     )
     AND EXISTS (
       SELECT 1
       FROM public.p9_accepted_quote_revisions ar
       WHERE ar.organization_id = NEW.organization_id
         AND ar.store_id = NEW.store_id
         AND ar.quote_id = NEW.id
         AND ar.commercial_opportunity_id = NEW.commercial_opportunity_id
         AND ar.target_quote_version_id = NEW.current_version_id
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.p9_responsible_commercial_approval_requests request_row
       JOIN public.commercial_opportunities opportunity_row
         ON opportunity_row.id = request_row.commercial_opportunity_id
        AND opportunity_row.organization_id = request_row.organization_id
        AND opportunity_row.store_id = request_row.store_id
        AND opportunity_row.lifecycle_cycle = request_row.lifecycle_cycle
       WHERE request_row.organization_id = NEW.organization_id
         AND request_row.store_id = NEW.store_id
         AND request_row.commercial_opportunity_id = NEW.commercial_opportunity_id
         AND request_row.quote_id = NEW.id
         AND request_row.quote_version_id = NEW.current_version_id
         AND request_row.request_kind = 'quote_send_approval'
         AND request_row.status IN ('approved', 'fulfilled')
         AND request_row.decision_inbound_message_id IS NOT NULL
         AND NULLIF(btrim(request_row.decision_external_message_id), '') IS NOT NULL
         AND request_row.decided_at IS NOT NULL
         AND request_row.invalidated_at IS NULL
     ) THEN
    RAISE EXCEPTION 'P9_ACCEPTED_QUOTE_REVISION_RESPONSIBLE_APPROVAL_REQUIRED';
  END IF;
  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS p9_accepted_revision_responsible_approval_guard
ON public.sales_quotes;

CREATE TRIGGER p9_accepted_revision_responsible_approval_guard
BEFORE UPDATE OF status, current_version_id
ON public.sales_quotes
FOR EACH ROW
EXECUTE FUNCTION public.p9_assert_accepted_revision_responsible_approval_trg();

REVOKE ALL ON FUNCTION public.p9_assert_accepted_revision_responsible_approval_trg()
FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.p9_assert_accepted_revision_responsible_approval_trg()
IS 'P9 9.3-B/1F: somente revisoes pos-aceite com decisao humana sobre a versao exata podem mudar para approved/sent. V1 permanece sem novo gate.';

REVOKE ALL ON FUNCTION public.p9_decide_quote_approval_by_responsible_by_system(
  uuid, uuid, uuid, uuid, uuid, integer, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p9_decide_quote_approval_by_responsible_by_system(
  uuid, uuid, uuid, uuid, uuid, integer, uuid, uuid, uuid, text, text
) TO service_role;

COMMENT ON FUNCTION public.p9_decide_quote_approval_by_responsible_by_system(
  uuid, uuid, uuid, uuid, uuid, integer, uuid, uuid, uuid, text, text
) IS 'ZION P9 9.3-B/1F: registra decisao humana WhatsApp; aprovacao V2 atomica pela autoridade canonica de quote/version/evento; rejeicao nao altera quote; nenhum envio externo.';

COMMIT;

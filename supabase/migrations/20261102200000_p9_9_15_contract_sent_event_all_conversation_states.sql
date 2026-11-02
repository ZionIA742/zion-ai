-- ZION | P9.9.15 | contrato_enviado e auditoria de envio.
-- Autoriza somente o evento de auditoria, sem alterar o estado da conversa.
-- Nao envia mensagens, nao toca em barreiras e nao altera outros eventos.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  v_rules oid := pg_catalog.to_regclass('public.event_state_rules');
  v_auto oid := pg_catalog.to_regclass('public.event_auto_state_transitions');
  v_events oid := pg_catalog.to_regclass('public.conversation_events');
  v_required text[] := ARRAY[
    'novo_lead', 'qualificacao', 'orcamento', 'negociacao',
    'fechamento_pagamento', 'pagamento_pendente_confirmacao',
    'agendar_visita', 'agendar_instalacao', 'pos_venda_nps',
    'perdido', 'humano_assumiu'
  ];
BEGIN
  IF v_rules IS NULL OR v_auto IS NULL OR v_events IS NULL THEN
    RAISE EXCEPTION 'P9_CONTRACT_SENT_EVENT_REQUIRED_RELATION_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = v_rules
      AND a.attname = ANY (ARRAY['event_type','state','is_allowed'])
      AND NOT a.attisdropped
    GROUP BY a.attrelid
    HAVING count(*) = 3
  ) THEN
    RAISE EXCEPTION 'P9_CONTRACT_SENT_EVENT_RULE_SCHEMA_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = v_auto
      AND a.attname = ANY (ARRAY['event_type','from_state','is_active'])
      AND NOT a.attisdropped
    GROUP BY a.attrelid
    HAVING count(*) = 3
  ) THEN
    RAISE EXCEPTION 'P9_CONTRACT_SENT_EVENT_AUTO_TRANSITION_SCHEMA_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'validate_event_allowed_for_state'
  ) THEN
    RAISE EXCEPTION 'P9_CONTRACT_SENT_EVENT_VALIDATOR_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_state_rules r
    WHERE r.event_type = 'contrato_enviado'
      AND r.state = ANY (v_required)
      AND r.is_allowed IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'P9_CONTRACT_SENT_EVENT_RULE_CONFLICT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_auto_state_transitions t
    WHERE t.event_type = 'contrato_enviado'
      AND t.from_state = ANY (v_required)
      AND t.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'P9_CONTRACT_SENT_EVENT_UNEXPECTED_AUTO_TRANSITION';
  END IF;
END;
$preflight$;

INSERT INTO public.event_state_rules (event_type, state, is_allowed)
SELECT 'contrato_enviado', states.state, true
FROM (
  VALUES
    ('novo_lead'),
    ('qualificacao'),
    ('orcamento'),
    ('negociacao'),
    ('fechamento_pagamento'),
    ('pagamento_pendente_confirmacao'),
    ('agendar_visita'),
    ('agendar_instalacao'),
    ('pos_venda_nps'),
    ('perdido'),
    ('humano_assumiu')
) AS states(state)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.event_state_rules existing
  WHERE existing.event_type = 'contrato_enviado'
    AND existing.state = states.state
);

DO $postconditions$
DECLARE
  v_required text[] := ARRAY[
    'novo_lead', 'qualificacao', 'orcamento', 'negociacao',
    'fechamento_pagamento', 'pagamento_pendente_confirmacao',
    'agendar_visita', 'agendar_instalacao', 'pos_venda_nps',
    'perdido', 'humano_assumiu'
  ];
BEGIN
  IF (
    SELECT count(*)
    FROM public.event_state_rules r
    WHERE r.event_type = 'contrato_enviado'
      AND r.state = ANY (v_required)
      AND r.is_allowed IS TRUE
  ) <> cardinality(v_required) THEN
    RAISE EXCEPTION 'P9_CONTRACT_SENT_EVENT_RULE_POSTCONDITION_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_auto_state_transitions t
    WHERE t.event_type = 'contrato_enviado'
      AND t.from_state = ANY (v_required)
      AND t.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'P9_CONTRACT_SENT_EVENT_AUTO_TRANSITION_POSTCONDITION_FAILED';
  END IF;

END;
$postconditions$;

COMMIT;

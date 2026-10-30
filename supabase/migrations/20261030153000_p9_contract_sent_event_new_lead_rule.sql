-- ZION / Pilar 9.9.15
-- Registra a regra ja aplicada no Supabase.
-- Permite registrar contrato_enviado no estado novo_lead.
-- Nao altera o estado da conversa nem envia mensagens.

BEGIN;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.event_state_rules
    WHERE event_type = 'contrato_enviado'
      AND state = 'novo_lead'
      AND is_allowed IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'P9_CONTRACT_SENT_EVENT_RULE_CONFLICT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_auto_state_transitions
    WHERE event_type = 'contrato_enviado'
      AND from_state = 'novo_lead'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'P9_CONTRACT_SENT_UNEXPECTED_AUTO_TRANSITION';
  END IF;

  INSERT INTO public.event_state_rules (
    event_type,
    state,
    is_allowed
  )
  SELECT
    'contrato_enviado',
    'novo_lead',
    true
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.event_state_rules
    WHERE event_type = 'contrato_enviado'
      AND state = 'novo_lead'
  );
END;
$migration$;

COMMIT;

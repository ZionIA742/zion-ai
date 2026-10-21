BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- P19-A / Bloco 5 / Etapa 5.9
-- Contrato de sincronizacao Painel -> WhatsApp.
-- Correcao aplicada previamente no Supabase.
-- Preserva os cinco tipos anteriores.

ALTER TABLE public.store_assistant_notification_queue
  DROP CONSTRAINT store_assistant_notification_queue_type_check,
  ADD CONSTRAINT store_assistant_notification_queue_type_check
  CHECK (
    notification_type IN (
      'morning_report',
      'evening_report',
      'important_alert',
      'post_appointment_followup',
      'manual_context',
      'assistant_panel_sync'
    )
  );

CREATE OR REPLACE FUNCTION public.assistant_enqueue_internal_notification(
  p_organization_id uuid,
  p_store_id uuid,
  p_notification_type text,
  p_title text,
  p_body text,
  p_priority text DEFAULT 'normal',
  p_context jsonb DEFAULT '{}'::jsonb,
  p_related_lead_id uuid DEFAULT NULL,
  p_related_conversation_id uuid DEFAULT NULL,
  p_related_appointment_id uuid DEFAULT NULL,
  p_event_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_thread public.store_assistant_threads;
  v_notification_id uuid;
  v_notification_type text;
  v_priority text;
  v_context jsonb;
  v_event_key text;
  v_message_kind text;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'p_organization_id nao pode ser null';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'p_store_id nao pode ser null';
  END IF;

  v_notification_type :=
    COALESCE(NULLIF(TRIM(p_notification_type), ''), '');

  IF v_notification_type NOT IN (
    'morning_report',
    'evening_report',
    'important_alert',
    'post_appointment_followup',
    'manual_context',
    'assistant_panel_sync'
  ) THEN
    RAISE EXCEPTION 'notification_type invalido: %',
      p_notification_type;
  END IF;

  v_priority :=
    COALESCE(NULLIF(TRIM(p_priority), ''), 'normal');

  IF v_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'priority invalida: %', p_priority;
  END IF;

  IF COALESCE(TRIM(p_body), '') = '' THEN
    RAISE EXCEPTION 'p_body nao pode ser vazio';
  END IF;

  v_event_key :=
    NULLIF(TRIM(COALESCE(p_event_key, '')), '');

  IF v_notification_type = 'assistant_panel_sync' THEN
    v_message_kind :=
      COALESCE(p_context ->> 'message_kind', '');

    IF COALESCE(p_context ->> 'source', '') <>
       'assistant_panel_whatsapp_sync' THEN
      RAISE EXCEPTION
        'Origem invalida para assistant_panel_sync';
    END IF;

    IF v_message_kind NOT IN ('human', 'assistant') THEN
      RAISE EXCEPTION
        'message_kind invalido para sincronizacao';
    END IF;

    IF v_event_key IS NULL OR
       v_event_key NOT LIKE (
         'assistant-panel-whatsapp:' ||
         v_message_kind || ':%'
       ) THEN
      RAISE EXCEPTION
        'event_key invalida para sincronizacao';
    END IF;

    IF COALESCE(p_context ->> 'event_key', '') <>
       v_event_key THEN
      RAISE EXCEPTION 'event_key inconsistente';
    END IF;
  END IF;

  v_thread :=
    public.assistant_get_or_create_primary_thread(
      p_organization_id,
      p_store_id
    );

  v_context :=
    COALESCE(p_context, '{}'::jsonb) ||
    jsonb_build_object(
      'source',
      CASE
        WHEN v_notification_type = 'assistant_panel_sync'
          THEN 'assistant_panel_whatsapp_sync'
        ELSE 'assistant_enqueue_internal_notification'
      END
    );

  IF v_event_key IS NOT NULL THEN
    v_context :=
      v_context ||
      jsonb_build_object('event_key', v_event_key);

    SELECT q.id
      INTO v_notification_id
    FROM public.store_assistant_notification_queue q
    WHERE q.organization_id = p_organization_id
      AND q.store_id = p_store_id
      AND q.context ->> 'event_key' = v_event_key
      AND (
        v_notification_type = 'assistant_panel_sync'
        OR q.status IN ('pending', 'processing', 'sent')
      )
    ORDER BY q.created_at DESC
    LIMIT 1;

    IF v_notification_id IS NOT NULL THEN

      IF v_notification_type = 'assistant_panel_sync' THEN
        RETURN v_notification_id;
      END IF;

      UPDATE public.store_assistant_notification_queue
      SET
        thread_id = v_thread.id,
        notification_type = v_notification_type,
        priority = v_priority,
        status = 'pending',
        title = NULLIF(TRIM(COALESCE(p_title, '')), ''),
        body = TRIM(p_body),
        context = v_context,
        related_lead_id = p_related_lead_id,
        related_conversation_id = p_related_conversation_id,
        related_appointment_id = p_related_appointment_id,
        available_at = NOW(),
        processed_at = NULL,
        error_text = NULL,
        updated_at = NOW()
      WHERE id = v_notification_id;

      RETURN v_notification_id;
    END IF;
  END IF;

  INSERT INTO public.store_assistant_notification_queue (
    organization_id,
    store_id,
    thread_id,
    notification_type,
    priority,
    status,
    title,
    body,
    context,
    related_lead_id,
    related_conversation_id,
    related_appointment_id,
    available_at,
    processed_at,
    error_text
  )
  VALUES (
    p_organization_id,
    p_store_id,
    v_thread.id,
    v_notification_type,
    v_priority,
    'pending',
    NULLIF(TRIM(COALESCE(p_title, '')), ''),
    TRIM(p_body),
    v_context,
    p_related_lead_id,
    p_related_conversation_id,
    p_related_appointment_id,
    NOW(),
    NULL,
    NULL
  )
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION
  public.assistant_enqueue_internal_notification(
    uuid, uuid, text, text, text, text,
    jsonb, uuid, uuid, uuid, text
  )
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.assistant_enqueue_internal_notification(
    uuid, uuid, text, text, text, text,
    jsonb, uuid, uuid, uuid, text
  )
TO service_role;

-- Unicidade exclusiva dos eventos de sincronizacao do painel.
CREATE UNIQUE INDEX IF NOT EXISTS
  uq_store_assistant_notification_panel_sync_event
ON public.store_assistant_notification_queue (
  organization_id,
  store_id,
  (context ->> 'event_key')
)
WHERE notification_type = 'assistant_panel_sync'
  AND NULLIF(BTRIM(context ->> 'event_key'), '') IS NOT NULL;

COMMIT;
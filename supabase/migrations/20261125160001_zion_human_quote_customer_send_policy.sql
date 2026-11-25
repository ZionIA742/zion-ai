-- Shared WhatsApp policy for explicit human quote sends.
-- Supports a selected CRM lead or an explicitly entered number.
-- No lead creation, opportunity requirement, CRM mutation or HTTP.

CREATE FUNCTION public.read_human_quote_customer_send_policy_by_system(
    p_organization_id uuid,
    p_store_id uuid,
    p_destination_phone text,
    p_phone_number_id text,
    p_lead_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE

    v_now timestamptz := clock_timestamp();

    v_digits text;
    v_lead_phone text;
    v_lead_digits text;
    v_normalized_lead_phone text;

    v_integration_count bigint;
    v_integration_number_id text;

    v_opted_out boolean;
    v_last_inbound_at timestamptz;

BEGIN

    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_destination_phone IS NULL
       OR p_destination_phone !~ '^\+[1-9][0-9]{7,14}$'
       OR (
           left(p_destination_phone,3) = '+55'
           AND char_length(p_destination_phone)
               NOT IN (13,14)
       )
       OR p_phone_number_id IS NULL
       OR p_phone_number_id !~ '^[0-9]+$'
    THEN
        RETURN jsonb_build_object(
            'allowed',false,
            'reason','CUSTOMER_SCOPE_INVALID'
        );
    END IF;

    v_digits := substring(
        p_destination_phone FROM 2
    );

    -- Verify the exact active integration.
    -- Historical integrations cannot authorize this delivery.

    SELECT count(*),min(e.phone_number_id)
    INTO v_integration_count,v_integration_number_id
    FROM public.external_integrations e
    WHERE e.organization_id = p_organization_id
      AND e.store_id = p_store_id
      AND e.provider = 'whatsapp'
      AND e.is_active IS TRUE
      AND e.status = 'active';

    IF v_integration_count <> 1
       OR v_integration_number_id
            IS DISTINCT FROM p_phone_number_id
    THEN
        RETURN jsonb_build_object(
            'allowed',false,
            'reason','CUSTOMER_INTEGRATION_INVALID'
        );
    END IF;

    -- When a lead was explicitly selected, verify its
    -- current phone without inferring an opportunity.

    IF p_lead_id IS NOT NULL THEN

        SELECT btrim(l.phone)
        INTO v_lead_phone
        FROM public.leads l
        WHERE l.id = p_lead_id
          AND l.organization_id = p_organization_id
          AND l.store_id = p_store_id;

        IF NOT FOUND
           OR v_lead_phone IS NULL
           OR v_lead_phone !~ '^\+?[0-9 ()-]+$'
        THEN
            RETURN jsonb_build_object(
                'allowed',false,
                'reason','CUSTOMER_LEAD_INVALID'
            );
        END IF;

        v_lead_digits := regexp_replace(
            v_lead_phone,'[^0-9]','','g'
        );

        v_normalized_lead_phone := CASE

            WHEN left(v_lead_phone,1) = '+'
                THEN '+' || v_lead_digits

            WHEN char_length(v_lead_digits) IN (10,11)
                THEN '+55' || v_lead_digits

            WHEN left(v_lead_digits,2) = '55'
             AND char_length(v_lead_digits) IN (12,13)
                THEN '+' || v_lead_digits

            ELSE NULL

        END;

        IF v_normalized_lead_phone
            IS DISTINCT FROM p_destination_phone
        THEN
            RETURN jsonb_build_object(
                'allowed',false,
                'reason','CUSTOMER_DESTINATION_CHANGED'
            );
        END IF;

    END IF;

    -- Respect recorded opt-outs across conversations
    -- associated with the exact destination.
    -- This lookup does not link or create CRM records.

    WITH matching_conversations AS (

        SELECT DISTINCT
            c.id,
            c.lead_id

        FROM public.conversations c

        JOIN public.leads l
          ON l.id = c.lead_id
         AND l.organization_id = p_organization_id
         AND l.store_id = p_store_id

        JOIN public.messages m
          ON m.conversation_id = c.id
         AND m.organization_id = p_organization_id
         AND m.store_id = p_store_id

        WHERE c.organization_id = p_organization_id
          AND m.sender = 'user'
          AND m.direction = 'incoming'
          AND m.external_message_id IS NOT NULL
          AND m.metadata->>'source' =
              'meta_whatsapp_webhook'
          AND m.metadata->>'channel' = 'whatsapp'
          AND m.metadata->>'external_channel' = 'whatsapp'
          AND m.metadata->>'provider' = 'meta'
          AND (
              m.metadata->>'whatsapp_from' IN (
                  v_digits,p_destination_phone
              )
              OR (
                  p_lead_id IS NOT NULL
                  AND c.lead_id = p_lead_id
              )
          )

    ), relevant_opportunities AS (

        SELECT o.id
        FROM public.commercial_opportunities o
        WHERE o.organization_id = p_organization_id
          AND o.store_id = p_store_id
          AND (
              o.origin_lead_id = p_lead_id

              OR EXISTS (
                  SELECT 1
                  FROM matching_conversations c
                  WHERE c.id = o.primary_conversation_id
                     OR c.lead_id = o.origin_lead_id
              )

              OR EXISTS (
                  SELECT 1
                  FROM public.commercial_opportunity_followup_events e
                  JOIN matching_conversations c
                    ON e.metadata->>'source_conversation_id'
                       = c.id::text
                  WHERE e.organization_id = p_organization_id
                    AND e.store_id = p_store_id
                    AND e.commercial_opportunity_id = o.id
                    AND e.event_type = 'opted_out'
              )
          )

    )

    SELECT
        EXISTS (
            SELECT 1
            FROM public.commercial_opportunity_followups f
            JOIN relevant_opportunities o
              ON o.id = f.commercial_opportunity_id
            WHERE f.organization_id = p_organization_id
              AND f.store_id = p_store_id
              AND f.status = 'opted_out'
        )
        OR EXISTS (
            SELECT 1
            FROM public.commercial_opportunity_followup_events e
            JOIN relevant_opportunities o
              ON o.id = e.commercial_opportunity_id
            WHERE e.organization_id = p_organization_id
              AND e.store_id = p_store_id
              AND e.event_type = 'opted_out'
        )

    INTO v_opted_out;

    IF v_opted_out THEN
        RETURN jsonb_build_object(
            'allowed',false,
            'reason','CUSTOMER_OPTED_OUT'
        );
    END IF;

    -- Same real inbound evidence used by the existing
    -- WhatsApp window, now bound to the exact phone
    -- and the current business phone_number_id.

    SELECT m.created_at
    INTO v_last_inbound_at

    FROM public.messages m

    JOIN public.conversations c
      ON c.id = m.conversation_id
     AND c.organization_id = p_organization_id

    JOIN public.leads l
      ON l.id = c.lead_id
     AND l.organization_id = p_organization_id
     AND l.store_id = p_store_id

    WHERE m.organization_id = p_organization_id
      AND m.store_id = p_store_id
      AND m.sender = 'user'
      AND m.direction = 'incoming'
      AND m.deleted_at IS NULL
      AND nullif(btrim(m.external_message_id),'') IS NOT NULL
      AND m.metadata->>'source' = 'meta_whatsapp_webhook'
      AND m.metadata->>'channel' = 'whatsapp'
      AND m.metadata->>'external_channel' = 'whatsapp'
      AND m.metadata->>'provider' = 'meta'

      AND m.metadata->>'whatsapp_from' IN (
          v_digits,p_destination_phone
      )

      AND m.metadata->>'phone_number_id' =
          p_phone_number_id

      AND (
          p_lead_id IS NULL
          OR c.lead_id = p_lead_id
      )

    ORDER BY m.created_at DESC NULLS FIRST,m.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'allowed',false,
            'reason','CUSTOMER_TEMPLATE_REQUIRED'
        );
    END IF;

    IF v_last_inbound_at IS NULL
       OR v_last_inbound_at > v_now
    THEN
        RETURN jsonb_build_object(
            'allowed',false,
            'reason','CUSTOMER_INBOUND_TIMESTAMP_INVALID'
        );
    END IF;

    IF v_last_inbound_at < v_now - interval '24 hours'
    THEN
        RETURN jsonb_build_object(
            'allowed',false,
            'reason','CUSTOMER_TEMPLATE_REQUIRED'
        );
    END IF;

    RETURN jsonb_build_object(
        'allowed',true,
        'reason','CUSTOMER_WINDOW_OPEN'
    );

END;
$function$;

ALTER FUNCTION public.read_human_quote_customer_send_policy_by_system(
    uuid,uuid,text,text,uuid
)
OWNER TO postgres;

REVOKE ALL PRIVILEGES
ON FUNCTION public.read_human_quote_customer_send_policy_by_system(
    uuid,uuid,text,text,uuid
)
FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE
ON FUNCTION public.read_human_quote_customer_send_policy_by_system(
    uuid,uuid,text,text,uuid
)
TO service_role;

COMMENT ON FUNCTION public.read_human_quote_customer_send_policy_by_system(
    uuid,uuid,text,text,uuid
)
IS 'Read-only recipient and WhatsApp window policy for authorized human quote sends. No provider request, contact creation or commercial mutation.';

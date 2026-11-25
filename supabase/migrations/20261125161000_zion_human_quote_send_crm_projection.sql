ALTER TABLE public.human_quote_send_operations

    ADD COLUMN crm_stage_projection jsonb,

    ADD CONSTRAINT hqso_crm_stage_projection_chk

    CHECK (
        crm_stage_projection IS NULL

        OR (
            status = 'accepted'
            AND recipient_kind = 'lead'
            AND jsonb_typeof(crm_stage_projection) = 'object'
            AND coalesce(
                crm_stage_projection->>'outcome',''
            ) IN ('moved','unchanged','skipped')
            AND nullif(
                crm_stage_projection->>'reason',''
            ) IS NOT NULL
        )
    );


CREATE FUNCTION public.project_human_quote_send_crm_by_system(
    p_organization_id uuid,
    p_store_id uuid,
    p_actor_user_id uuid,
    p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE

    v_op public.human_quote_send_operations%ROWTYPE;

    v_opportunity public.commercial_opportunities%ROWTYPE;

    v_candidates uuid[];

    v_event record;

    v_key text;

    v_result jsonb;

    v_candidate_count integer;

BEGIN

    SELECT o.*
    INTO v_op
    FROM public.human_quote_send_operations o

    WHERE o.organization_id = p_organization_id
      AND o.store_id = p_store_id
      AND o.actor_user_id = p_actor_user_id
      AND o.operation_id = p_operation_id

    FOR UPDATE;

    IF NOT FOUND THEN

        RAISE EXCEPTION
            'HUMAN_QUOTE_CRM_OPERATION_NOT_FOUND';

    END IF;

    -- Only actual provider acceptance is eligible.

    IF v_op.status <> 'accepted'
       OR v_op.provider_accepted_at IS NULL
       OR v_op.external_message_id IS NULL
    THEN

        RETURN jsonb_build_object(
            'outcome','not_eligible',
            'reason','PROVIDER_ACCEPTANCE_REQUIRED'
        );

    END IF;

    IF v_op.recipient_kind <> 'lead'
       OR v_op.recipient_lead_id IS NULL
    THEN

        RETURN jsonb_build_object(
            'outcome','not_eligible',
            'reason','CRM_LEAD_RECIPIENT_REQUIRED'
        );

    END IF;

    -- Persisted decisions cannot be reapplied.

    IF v_op.crm_stage_projection IS NOT NULL THEN

        RETURN v_op.crm_stage_projection;

    END IF;

    v_key :=
        'human_quote_send_crm:' || v_op.operation_key;

    -- Resolve only existing opportunities associated with
    -- the actual selected recipient, never an arbitrary lead.

    SELECT array_agg(o.id ORDER BY o.id)
    INTO v_candidates

    FROM public.commercial_opportunities o

    WHERE o.organization_id = v_op.organization_id
      AND o.store_id = v_op.store_id

      AND (
          o.origin_lead_id = v_op.recipient_lead_id

          OR EXISTS (
              SELECT 1
              FROM public.conversations c

              WHERE c.id = o.primary_conversation_id
                AND c.organization_id = v_op.organization_id
                AND c.lead_id = v_op.recipient_lead_id
          )
      );

    v_candidate_count :=
        coalesce(cardinality(v_candidates),0);

    IF v_candidate_count = 0 THEN

        v_result := jsonb_build_object(
            'outcome','skipped',
            'reason','NO_EXISTING_OPPORTUNITY'
        );

    ELSIF v_candidate_count > 1 THEN

        v_result := jsonb_build_object(
            'outcome','skipped',
            'reason','AMBIGUOUS_OPPORTUNITY'
        );

    ELSE

        -- Short lock limited to the opportunity being projected.

        SELECT o.*
        INTO v_opportunity
        FROM public.commercial_opportunities o

        WHERE o.id = v_candidates[1]
          AND o.organization_id = v_op.organization_id
          AND o.store_id = v_op.store_id

        FOR UPDATE;

        IF NOT FOUND THEN

            v_result := jsonb_build_object(
                'outcome','skipped',
                'reason','OPPORTUNITY_UNAVAILABLE'
            );

        ELSIF (
            v_opportunity.origin_lead_id IS NOT NULL
            AND v_opportunity.origin_lead_id
                <> v_op.recipient_lead_id
        ) OR (
            v_opportunity.primary_conversation_id IS NOT NULL

            AND NOT EXISTS (
                SELECT 1
                FROM public.conversations c

                WHERE c.id =
                    v_opportunity.primary_conversation_id

                  AND c.organization_id =
                    v_op.organization_id

                  AND c.lead_id =
                    v_op.recipient_lead_id
            )
        ) THEN

            v_result := jsonb_build_object(
                'outcome','skipped',
                'reason','OPPORTUNITY_LINK_CONFLICT'
            );

        ELSIF v_opportunity.created_at >
              v_op.attempt_started_at
        THEN

            v_result := jsonb_build_object(
                'outcome','skipped',
                'reason','OPPORTUNITY_CREATED_AFTER_SEND'
            );

        ELSIF v_opportunity.stage_changed_at >
              v_op.provider_accepted_at
        THEN

            v_result := jsonb_build_object(
                'outcome','skipped',
                'reason','NEWER_STAGE_DECISION',
                'opportunity_id',v_opportunity.id,
                'stage',v_opportunity.stage
            );

        ELSIF v_opportunity.stage NOT IN (
            'novo_lead','qualificacao'
        ) THEN

            v_result := jsonb_build_object(
                'outcome','unchanged',
                'reason','STAGE_PRESERVED',
                'opportunity_id',v_opportunity.id,
                'stage',v_opportunity.stage
            );

        ELSE

            -- Preserve the canonical lifecycle writer.
            -- Evidence is provider acceptance, not quote creation
            -- or a fabricated inbound customer request.

            SELECT *
            INTO v_event

            FROM public.apply_commercial_opportunity_stage_transition_internal(

                v_op.organization_id,

                v_op.store_id,

                v_opportunity.id,

                v_key,

                'orcamento',

                'Human quote delivery accepted by provider',

                'human_quote_send_accepted',

                NULL::uuid,

                'operation_key=' || v_op.operation_key
                    || ';quote_id=' || v_op.quote_id::text
                    || ';quote_version_id='
                    || v_op.quote_version_id::text
                    || ';actor_user_id='
                    || v_op.actor_user_id::text,

                'human_quote_send_crm_projection',

                'stage_transition',

                'system',

                NULL::uuid
            );

            IF NOT FOUND

               OR v_event.commercial_opportunity_id
                    IS DISTINCT FROM v_opportunity.id

               OR v_event.stage
                    IS DISTINCT FROM 'orcamento'

               OR v_event.lifecycle_event_id IS NULL

               OR v_event.event_type
                    IS DISTINCT FROM 'stage_transition'

            THEN

                RAISE EXCEPTION
                    'HUMAN_QUOTE_CRM_WRITER_CONTRACT_INVALID';

            END IF;

            v_result := jsonb_build_object(
                'outcome','moved',
                'reason','HUMAN_QUOTE_SEND_ACCEPTED',
                'opportunity_id',v_opportunity.id,
                'previous_stage',v_opportunity.stage,
                'stage','orcamento',
                'lifecycle_event_id',
                    v_event.lifecycle_event_id
            );

        END IF;

    END IF;

    -- Projection and lifecycle event commit together.
    -- Provider acceptance was already persisted separately.

    UPDATE public.human_quote_send_operations o

    SET crm_stage_projection = v_result

    WHERE o.organization_id = v_op.organization_id
      AND o.store_id = v_op.store_id
      AND o.actor_user_id = v_op.actor_user_id
      AND o.operation_id = v_op.operation_id;

    IF NOT FOUND THEN

        RAISE EXCEPTION
            'HUMAN_QUOTE_CRM_PROJECTION_PERSISTENCE_FAILED';

    END IF;

    RETURN v_result;

END;
$function$;


ALTER FUNCTION public.project_human_quote_send_crm_by_system(
    uuid,uuid,uuid,uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.project_human_quote_send_crm_by_system(
    uuid,uuid,uuid,uuid
) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.project_human_quote_send_crm_by_system(
    uuid,uuid,uuid,uuid
) TO service_role;

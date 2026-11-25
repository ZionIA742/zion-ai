-- ZION: registration authority for independent human quote deliveries.
-- Registration is not authorization to contact a WhatsApp recipient.
-- No transport, approval mutation or commercial projection is performed.

CREATE FUNCTION public.register_human_quote_send_operation_by_system(
    p_organization_id uuid,
    p_store_id uuid,
    p_actor_user_id uuid,
    p_operation_id uuid,
    p_quote_id uuid,
    p_quote_version_id uuid,
    p_recipient_kind text,
    p_recipient_lead_id uuid,
    p_recipient_responsible_id uuid,
    p_destination_phone text,
    p_operation_key text,
    p_request_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE
    v_quote public.sales_quotes%ROWTYPE;
    v_version public.sales_quote_versions%ROWTYPE;
    v_file public.store_files%ROWTYPE;
    v_existing public.human_quote_send_operations%ROWTYPE;

    v_lead public.leads%ROWTYPE;
    v_responsible public.store_responsibles%ROWTYPE;

    v_recipient_json text;
    v_scope_json text;

    v_operation_key text;
    v_request_fingerprint text;

    v_raw_phone text;
    v_digits text;
    v_expected_phone text;

    v_prefix text;
    v_relative_path text;
    v_stamp timestamptz;

BEGIN
    -- 1. Reject missing or invalid identities.

    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_actor_user_id IS NULL
       OR p_operation_id IS NULL
       OR p_quote_id IS NULL
       OR p_quote_version_id IS NULL
       OR '00000000-0000-0000-0000-000000000000'::uuid
          IN (
              p_organization_id,
              p_store_id,
              p_actor_user_id,
              p_operation_id,
              p_quote_id,
              p_quote_version_id
          )
    THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_SCOPE_INVALID';
    END IF;

    IF p_destination_phone IS NULL
       OR p_destination_phone !~ '^[+][1-9][0-9]{7,14}$'
       OR p_destination_phone ~ '[[:cntrl:]]'
       OR (
           p_destination_phone LIKE '+55%'
           AND p_destination_phone !~
               '^[+]55[1-9][0-9]{9,10}$'
       )
    THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_DESTINATION_INVALID';
    END IF;

    -- 2. Reconstruct the exact request contract.
    -- Recipient identities are mutually exclusive.

    CASE p_recipient_kind

        WHEN 'lead' THEN
            IF p_recipient_lead_id IS NULL
               OR p_recipient_lead_id =
                   '00000000-0000-0000-0000-000000000000'::uuid
               OR p_recipient_responsible_id IS NOT NULL
            THEN
                RAISE EXCEPTION
                    'HUMAN_QUOTE_SEND_RECIPIENT_INVALID';
            END IF;

            v_recipient_json := format(
                '{"kind":"lead","leadId":"%s"}',
                p_recipient_lead_id
            );

        WHEN 'phone' THEN
            IF p_recipient_lead_id IS NOT NULL
               OR p_recipient_responsible_id IS NOT NULL
            THEN
                RAISE EXCEPTION
                    'HUMAN_QUOTE_SEND_RECIPIENT_INVALID';
            END IF;

            v_recipient_json := format(
                '{"kind":"phone","phone":"%s"}',
                p_destination_phone
            );

        WHEN 'responsible' THEN
            IF p_recipient_lead_id IS NOT NULL
               OR p_recipient_responsible_id IS NULL
               OR p_recipient_responsible_id =
                   '00000000-0000-0000-0000-000000000000'::uuid
            THEN
                RAISE EXCEPTION
                    'HUMAN_QUOTE_SEND_RECIPIENT_INVALID';
            END IF;

            v_recipient_json := '{"kind":"responsible"}';

        ELSE
            RAISE EXCEPTION
                'HUMAN_QUOTE_SEND_RECIPIENT_INVALID';

    END CASE;

    -- 3. Recompute deterministic identities in SQL.
    -- Exact serialization matches the TypeScript contract.

    v_scope_json := format(
        '{"organizationId":"%s","storeId":"%s","actorUserId":"%s","quoteId":"%s"}',
        p_organization_id,
        p_store_id,
        p_actor_user_id,
        p_quote_id
    );

    v_operation_key :=
        'human_quote_send:v1:' ||
        encode(
            sha256(
                convert_to(
                    format(
                        '["%s","%s","%s","%s"]',
                        p_organization_id,
                        p_store_id,
                        p_actor_user_id,
                        p_operation_id
                    ),
                    'UTF8'
                )
            ),
            'hex'
        );

    v_request_fingerprint :=
        encode(
            sha256(
                convert_to(
                    format(
                        '["human_quote_send:v1",%s,"%s",%s]',
                        v_scope_json,
                        p_quote_version_id,
                        v_recipient_json
                    ),
                    'UTF8'
                )
            ),
            'hex'
        );

    IF p_operation_key IS DISTINCT FROM v_operation_key
       OR p_request_fingerprint
          IS DISTINCT FROM v_request_fingerprint
    THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_IDENTITY_MISMATCH';
    END IF;

    -- 4. Verify active organization membership.
    -- The authenticated actor must be derived by the server,
    -- never from an untrusted HTTP request body.

    PERFORM 1
    FROM public.memberships m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = p_actor_user_id
      AND m.is_active IS TRUE
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_ACTIVE_MEMBERSHIP_REQUIRED';
    END IF;

    PERFORM 1
    FROM public.stores s
    WHERE s.id = p_store_id
      AND s.organization_id = p_organization_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_STORE_SCOPE_INVALID';
    END IF;

    -- 5. Serialize concurrent registration attempts.
    -- The ledger primary key remains the final uniqueness guard.

    PERFORM pg_advisory_xact_lock(
        hashtextextended(v_operation_key, 0)
    );

    SELECT o.*
    INTO v_existing
    FROM public.human_quote_send_operations o
    WHERE o.organization_id = p_organization_id
      AND o.store_id = p_store_id
      AND o.actor_user_id = p_actor_user_id
      AND o.operation_id = p_operation_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.operation_key
               IS DISTINCT FROM v_operation_key

           OR v_existing.request_fingerprint
               IS DISTINCT FROM v_request_fingerprint

           OR v_existing.quote_id
               IS DISTINCT FROM p_quote_id

           OR v_existing.quote_version_id
               IS DISTINCT FROM p_quote_version_id

           OR v_existing.recipient_kind
               IS DISTINCT FROM p_recipient_kind

           OR v_existing.recipient_lead_id
               IS DISTINCT FROM p_recipient_lead_id

           OR v_existing.recipient_responsible_id
               IS DISTINCT FROM p_recipient_responsible_id

           OR v_existing.destination_phone
               IS DISTINCT FROM p_destination_phone

        THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_SEND_OPERATION_CONFLICT';
        END IF;

        -- Replay never creates a new attempt or changes status.

        RETURN jsonb_build_object(
            'outcome', 'existing_operation',
            'operation_id', v_existing.operation_id,
            'operation_key', v_existing.operation_key,
            'quote_id', v_existing.quote_id,
            'quote_version_id', v_existing.quote_version_id,
            'recipient_kind', v_existing.recipient_kind,
            'status', v_existing.status,
            'status_reason', v_existing.status_reason,
            'created_at', v_existing.created_at
        );
    END IF;

    -- 6. Load and lock the canonical quote.

    SELECT q.*
    INTO v_quote
    FROM public.sales_quotes q
    WHERE q.id = p_quote_id
      AND q.organization_id = p_organization_id
      AND q.store_id = p_store_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_QUOTE_NOT_FOUND';
    END IF;

    -- This independent authority is restricted to proven
    -- human-created quotes. Legacy eligibility for editing
    -- is not automatically treated as sending authority.

    IF v_quote.metadata->>'created_via'
           IS DISTINCT FROM 'api_sales_quotes_create'

       OR v_quote.metadata->>'creation_actor_kind'
           IS DISTINCT FROM 'user'

       OR COALESCE(
           v_quote.metadata->>'creation_actor_user_id',
           ''
       ) !~* (
           '^[0-9a-f]{8}-[0-9a-f]{4}-' ||
           '[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       )

       OR v_quote.metadata->>'creation_actor_user_id' =
           '00000000-0000-0000-0000-000000000000'

    THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_PROVENANCE_REQUIRED';
    END IF;

    IF v_quote.current_version_id
           IS DISTINCT FROM p_quote_version_id
    THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_VERSION_STALE';
    END IF;

    -- 7. Verify exact version and canonical PDF file.

    SELECT v.*
    INTO v_version
    FROM public.sales_quote_versions v
    WHERE v.id = p_quote_version_id
      AND v.quote_id = p_quote_id
      AND v.organization_id = p_organization_id
      AND v.store_id = p_store_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_VERSION_NOT_FOUND';
    END IF;

    IF v_version.status IN ('failed', 'superseded')
       OR v_version.store_file_id IS NULL
    THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_VERSION_UNAVAILABLE';
    END IF;

    SELECT f.*
    INTO v_file
    FROM public.store_files f
    WHERE f.id = v_version.store_file_id
      AND f.organization_id = p_organization_id
      AND f.store_id = p_store_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_FILE_NOT_FOUND';
    END IF;

    IF v_file.file_kind
           IS DISTINCT FROM 'sales_quote_pdf'

       OR v_file.storage_bucket
           IS DISTINCT FROM 'zion-store-files'

       OR v_file.mime_type
           IS DISTINCT FROM 'application/pdf'

       OR v_file.size_bytes IS NULL
       OR v_file.size_bytes <= 0

       OR v_version.storage_bucket
           IS DISTINCT FROM v_file.storage_bucket

       OR v_version.storage_path
           IS DISTINCT FROM v_file.storage_path

       OR v_version.original_filename
           IS DISTINCT FROM v_file.original_filename

       OR v_version.mime_type
           IS DISTINCT FROM v_file.mime_type

       OR v_version.size_bytes
           IS DISTINCT FROM v_file.size_bytes

    THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_FILE_IDENTITY_MISMATCH';
    END IF;

    v_prefix :=
        p_organization_id::text || '/' ||
        p_store_id::text || '/sales-quotes/' ||
        p_quote_id::text || '/';

    IF left(
        v_file.storage_path,
        char_length(v_prefix)
    ) IS DISTINCT FROM v_prefix
    THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_FILE_PATH_INVALID';
    END IF;

    v_relative_path := substring(
        v_file.storage_path
        FROM char_length(v_prefix) + 1
    );

    -- Canonical operation PDFs must have a materialized
    -- generation record matching this exact file and version.

    IF v_relative_path LIKE 'operations/%' THEN

        PERFORM 1
        FROM public.sales_quote_pdf_generation_operations g
        WHERE g.organization_id = p_organization_id
          AND g.store_id = p_store_id
          AND g.quote_id = p_quote_id
          AND g.quote_version_id = p_quote_version_id
          AND g.store_file_id = v_file.id
          AND g.status = 'materialized'
          AND g.storage_bucket = v_file.storage_bucket
          AND g.storage_path = v_file.storage_path
          AND g.original_filename = v_file.original_filename
          AND g.pdf_size_bytes = v_file.size_bytes
          AND g.pdf_sha256 ~ '^[0-9a-f]{64}$'
          AND g.materialized_at IS NOT NULL
          AND v_relative_path =
              'operations/' || g.operation_id::text || '.pdf';

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_SEND_GENERATION_EVIDENCE_REQUIRED';
        END IF;

    END IF;

    -- 8. Verify recipient references against current records.
    -- No new lead, conversation or opportunity is created.

    IF p_recipient_kind = 'lead' THEN

        SELECT l.*
        INTO v_lead
        FROM public.leads l
        WHERE l.id = p_recipient_lead_id
          AND l.organization_id = p_organization_id
          AND l.store_id = p_store_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_SEND_LEAD_NOT_FOUND';
        END IF;

        v_raw_phone := btrim(v_lead.phone);

    ELSIF p_recipient_kind = 'responsible' THEN

        SELECT r.*
        INTO v_responsible
        FROM public.store_responsibles r
        WHERE r.id = p_recipient_responsible_id
          AND r.organization_id = p_organization_id
          AND r.store_id = p_store_id
          AND r.is_primary IS TRUE
          AND r.is_active IS TRUE
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_SEND_RESPONSIBLE_INVALID';
        END IF;

        v_raw_phone := btrim(
            v_responsible.whatsapp_number
        );

    END IF;

    -- 9. Independently verify the resolved destination.
    -- A changed or ambiguous destination fails closed.

    IF p_recipient_kind IN ('lead', 'responsible') THEN

        IF v_raw_phone IS NULL
           OR char_length(v_raw_phone) > 40
           OR v_raw_phone !~ '^[+]?[0-9 ()-]+$'
           OR v_raw_phone ~ '[[:cntrl:]]'
        THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_SEND_RECIPIENT_PHONE_INVALID';
        END IF;

        v_digits := regexp_replace(
            v_raw_phone,
            '[^0-9]',
            '',
            'g'
        );

        IF left(v_raw_phone, 1) = '+' THEN

            v_expected_phone := '+' || v_digits;

        ELSIF v_digits ~ '^[1-9][0-9]{9,10}$' THEN

            v_expected_phone := '+55' || v_digits;

        ELSIF v_digits ~ '^55[1-9][0-9]{9,10}$' THEN

            v_expected_phone := '+' || v_digits;

        ELSIF p_recipient_kind = 'responsible'
              AND v_digits ~ '^[1-9][0-9]{11,14}$'
        THEN

            v_expected_phone := '+' || v_digits;

        ELSE

            RAISE EXCEPTION
                'HUMAN_QUOTE_SEND_RECIPIENT_PHONE_INVALID';

        END IF;

        IF v_expected_phone
               IS DISTINCT FROM p_destination_phone
        THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_SEND_DESTINATION_CHANGED';
        END IF;

    END IF;

    -- 10. Register only. No side effects outside the ledger.

    v_stamp := clock_timestamp();

    INSERT INTO public.human_quote_send_operations (
        operation_id,
        organization_id,
        store_id,
        actor_user_id,
        operation_key,
        request_fingerprint,
        quote_id,
        quote_version_id,
        store_file_id,
        source_quote_updated_at,
        storage_bucket,
        storage_path,
        original_filename,
        mime_type,
        size_bytes,
        recipient_kind,
        recipient_lead_id,
        recipient_responsible_id,
        destination_phone,
        status,
        created_at,
        updated_at
    )
    VALUES (
        p_operation_id,
        p_organization_id,
        p_store_id,
        p_actor_user_id,
        v_operation_key,
        v_request_fingerprint,
        p_quote_id,
        p_quote_version_id,
        v_file.id,
        v_quote.updated_at,
        v_file.storage_bucket,
        v_file.storage_path,
        v_file.original_filename,
        v_file.mime_type,
        v_file.size_bytes,
        p_recipient_kind,
        p_recipient_lead_id,
        p_recipient_responsible_id,
        p_destination_phone,
        'registered',
        v_stamp,
        v_stamp
    )
    RETURNING *
    INTO v_existing;

    RETURN jsonb_build_object(
        'outcome', 'registered',
        'operation_id', v_existing.operation_id,
        'operation_key', v_existing.operation_key,
        'quote_id', v_existing.quote_id,
        'quote_version_id', v_existing.quote_version_id,
        'recipient_kind', v_existing.recipient_kind,
        'status', v_existing.status,
        'status_reason', v_existing.status_reason,
        'created_at', v_existing.created_at
    );

END;
$function$;

ALTER FUNCTION public.register_human_quote_send_operation_by_system(
    uuid, uuid, uuid, uuid, uuid, uuid,
    text, uuid, uuid, text, text, text
)
OWNER TO postgres;

REVOKE ALL PRIVILEGES
ON FUNCTION public.register_human_quote_send_operation_by_system(
    uuid, uuid, uuid, uuid, uuid, uuid,
    text, uuid, uuid, text, text, text
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.register_human_quote_send_operation_by_system(
    uuid, uuid, uuid, uuid, uuid, uuid,
    text, uuid, uuid, text, text, text
)
TO service_role;

COMMENT ON FUNCTION public.register_human_quote_send_operation_by_system(
    uuid, uuid, uuid, uuid, uuid, uuid,
    text, uuid, uuid, text, text, text
)
IS 'Registers a scoped human quote delivery request or returns its existing operation. Does not authorize transport, grant approval, or apply commercial effects.';

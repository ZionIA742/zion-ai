-- ZION / Pilar 9 / 10.7-A0.3 — teste funcional sem gravações permanentes.
-- Execute o SQL COMPLETO em uma única chamada do Supabase SQL Editor.
-- Utiliza somente mensagens humanas já existentes; não cria fixtures comerciais.
-- As mutações do writer acontecem DENTRO de um bloco PL/pgSQL com EXCEPTION.
-- A exceção-sentinela reverte essas mutações ANTES do SELECT final.
-- Nenhum teste depende de tabelas ou sequências depois de ROLLBACK externo.

DROP TABLE IF EXISTS pg_temp.p9_10_7_a0_3_results;

CREATE TEMP TABLE p9_10_7_a0_3_results (
  test_name text NOT NULL,
  verdict text NOT NULL,
  details text NOT NULL
) ON COMMIT PRESERVE ROWS;

DO $runner$
DECLARE
  f record;
  v_row record;
  v_commitment_id uuid;
  v_repeated_id uuid;
  v_due_at timestamptz;
  v_amended_due_at timestamptz;
  v_count bigint;
  v_persisted bigint := 0;
  v_completed integer := 0;
  v_stage text := 'fixture';
  v_error text;
  v_sqlstate text;
  v_results jsonb := '[]'::jsonb;
  v_rollback_confirmed boolean := false;
  v_pass boolean := false;
  v_expected_error text;
BEGIN
  -- Pré-requisitos da migration já instalada e registrada no Supabase original.
  IF to_regclass('public.conversation_human_response_commitments') IS NULL
     OR to_regprocedure('public.record_human_response_commitment_by_system(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,boolean)') IS NULL
     OR to_regprocedure('public.transition_human_response_commitment_by_system(uuid,uuid,uuid,text,text,timestamptz)') IS NULL
     OR to_regprocedure('public.read_human_response_commitments_by_system(uuid,uuid,uuid)') IS NULL THEN
    INSERT INTO pg_temp.p9_10_7_a0_3_results VALUES
      ('preflight', 'BLOQUEADO', '10.7-A0: tabela ou RPC canônica ausente');
    RETURN;
  END IF;

  IF (SELECT count(*) = 18 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'conversation_human_response_commitments'
        AND (column_name, data_type) IN (
          ('id', 'uuid'), ('organization_id', 'uuid'), ('store_id', 'uuid'),
          ('conversation_id', 'uuid'), ('conversation_session_id', 'uuid'),
          ('source_message_id', 'uuid'), ('responsible_user_id', 'uuid'),
          ('due_at', 'timestamp with time zone'), ('status', 'text'),
          ('revision', 'integer'), ('operation_key', 'text'),
          ('last_operation_key', 'text'), ('source_kind', 'text'),
          ('created_at', 'timestamp with time zone'),
          ('updated_at', 'timestamp with time zone'),
          ('fulfilled_at', 'timestamp with time zone'),
          ('cancelled_at', 'timestamp with time zone'),
          ('expired_at', 'timestamp with time zone')
        )) IS NOT TRUE THEN
    INSERT INTO pg_temp.p9_10_7_a0_3_results VALUES
      ('preflight', 'BLOQUEADO', 'colunas ou tipos da tabela incompatíveis');
    RETURN;
  END IF;

  INSERT INTO pg_temp.p9_10_7_a0_3_results VALUES
    ('preflight', 'PASS', 'tabela, 18 colunas e três RPCs presentes');

  -- Mensagem real e explicitamente humana; preferência pela origem painel.
  -- Não selecionar conversa com compromisso ativo nem chave de teste prévia.
  SELECT candidate.*, s_other.organization_id AS alternate_organization_id,
         s_other.id AS alternate_store_id,
         s_other.responsible_user_id AS alternate_user_id
  INTO f
  FROM (
    SELECT m.organization_id, m.store_id, m.conversation_id,
           m.conversation_session_id, m.id AS source_message_id,
           CASE WHEN panel_actor.user_id IS NOT NULL THEN panel_actor.user_id
                ELSE echo_actor.user_id END AS responsible_user_id,
           CASE WHEN panel_actor.user_id IS NOT NULL THEN 'panel'::text
                ELSE 'whatsapp_human'::text END AS source_kind,
           ('microetapa-10-7-a0-3:' || m.id::text) AS operation_key,
           CASE WHEN panel_actor.user_id IS NOT NULL THEN 0 ELSE 1 END AS priority
    FROM public.messages m
    JOIN public.conversations c
      ON c.id = m.conversation_id AND c.organization_id = m.organization_id
    LEFT JOIN LATERAL (
      SELECT member.user_id
      FROM public.memberships member
      JOIN auth.users u ON u.id = member.user_id
      WHERE member.organization_id = m.organization_id
        AND (m.metadata->>'sent_by_user_id') = member.user_id::text
        AND m.metadata->>'source' = 'panel'
      LIMIT 1
    ) panel_actor ON true
    LEFT JOIN LATERAL (
      SELECT member.user_id
      FROM public.memberships member
      JOIN auth.users u ON u.id = member.user_id
      WHERE member.organization_id = m.organization_id
      ORDER BY member.user_id
      LIMIT 1
    ) echo_actor ON true
    WHERE m.sender = 'human'
      AND m.direction = 'outgoing'
      AND m.deleted_at IS NULL
      AND (
        panel_actor.user_id IS NOT NULL
        OR (
          m.metadata->>'source' = 'meta_whatsapp_webhook'
          AND m.metadata->>'channel' = 'whatsapp'
          AND m.metadata->>'origin' = 'whatsapp_business_app'
          AND m.metadata->>'event_kind' = 'message_echo'
          AND echo_actor.user_id IS NOT NULL
          AND (m.message_type IS DISTINCT FROM 'audio' OR (
            NULLIF(BTRIM(m.metadata->>'audio_transcript'), '') IS NOT NULL
            AND m.metadata->>'transcription_status' = 'succeeded'
          ))
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.conversation_human_response_commitments existing
        WHERE existing.organization_id = m.organization_id
          AND existing.store_id = m.store_id
          AND existing.conversation_id = m.conversation_id
          AND existing.status = 'active'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.conversation_human_response_commitments existing
        WHERE existing.organization_id = m.organization_id
          AND existing.operation_key LIKE
              ('microetapa-10-7-a0-3:' || m.id::text || '%')
      )
  ) candidate
  LEFT JOIN LATERAL (
    SELECT s.organization_id, s.id, member.user_id AS responsible_user_id
    FROM public.stores s
    JOIN LATERAL (
      SELECT m2.user_id FROM public.memberships m2
      JOIN auth.users u2 ON u2.id = m2.user_id
      WHERE m2.organization_id = s.organization_id
      ORDER BY m2.user_id LIMIT 1
    ) member ON true
    WHERE s.id <> candidate.store_id
    ORDER BY (s.organization_id IS DISTINCT FROM candidate.organization_id), s.id
    LIMIT 1
  ) s_other ON true
  ORDER BY candidate.priority, candidate.source_message_id
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO pg_temp.p9_10_7_a0_3_results VALUES
      ('fixture', 'BLOQUEADO', 'sem mensagem humana elegível; nenhum dado de teste criado');
    RETURN;
  END IF;
  IF f.alternate_store_id IS NULL THEN
    INSERT INTO pg_temp.p9_10_7_a0_3_results VALUES
      ('fixture', 'BLOQUEADO', 'sem loja alternativa com responsável válido; nenhum dado de teste criado');
    RETURN;
  END IF;

  INSERT INTO pg_temp.p9_10_7_a0_3_results VALUES
    ('fixture', 'PASS', 'mensagem humana e loja alternativa existentes; sem compromisso ativo');

  -- Data calculada uma única vez. A segunda chamada usa exatamente o mesmo valor.
  v_due_at := clock_timestamp() + interval '1 hour';
  v_amended_due_at := clock_timestamp() + interval '2 hours';

  -- Subtransação: QUALQUER saída por exceção reverte as gravações do writer.
  -- Resultados ficam em variável PL/pgSQL, que sobrevive ao rollback do bloco.
  BEGIN
    -- Simula a claim de serviço apenas dentro da subtransação de teste.
    -- Não demonstra os grants do JWT real; estes foram verificados no preflight.
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    v_stage := '1-explicit-registration';
    v_commitment_id := public.record_human_response_commitment_by_system(
      f.organization_id, f.store_id, f.conversation_id,
      f.conversation_session_id, f.source_message_id, f.responsible_user_id,
      v_due_at, f.operation_key, f.source_kind, true
    );
    IF v_commitment_id IS NULL THEN
      RAISE EXCEPTION 'writer retornou ID nulo';
    END IF;
    v_completed := v_completed + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'test_name', v_stage, 'verdict', 'PASS',
      'details', 'confirmação explícita aceita com mensagem humana real'));

    v_stage := '2-idempotency';
    v_repeated_id := public.record_human_response_commitment_by_system(
      f.organization_id, f.store_id, f.conversation_id,
      f.conversation_session_id, f.source_message_id, f.responsible_user_id,
      v_due_at, f.operation_key, f.source_kind, true
    );
    IF v_repeated_id IS DISTINCT FROM v_commitment_id
       OR (SELECT count(*) FROM public.conversation_human_response_commitments
           WHERE organization_id = f.organization_id AND operation_key = f.operation_key) <> 1 THEN
      RAISE EXCEPTION 'replay não retornou o mesmo ID único';
    END IF;
    v_completed := v_completed + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'test_name', v_stage, 'verdict', 'PASS',
      'details', 'replay com due_at idêntico retornou a mesma linha'));

    v_stage := '3-deadline-amendment';
    PERFORM public.transition_human_response_commitment_by_system(
      v_commitment_id, f.organization_id, f.store_id, 'active',
      f.operation_key || ':amend', v_amended_due_at
    );
    SELECT * INTO v_row
    FROM public.read_human_response_commitments_by_system(
      f.organization_id, f.store_id, f.conversation_id
    ) WHERE id = v_commitment_id;
    IF NOT FOUND OR v_row.status IS DISTINCT FROM 'active'
       OR v_row.revision IS DISTINCT FROM 2
       OR v_row.due_at IS DISTINCT FROM v_amended_due_at THEN
      RAISE EXCEPTION 'alteração não persistiu no reader canônico';
    END IF;
    v_completed := v_completed + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'test_name', v_stage, 'verdict', 'PASS',
      'details', 'alteração de prazo e revision=2 confirmadas pelo reader'));

    v_stage := '4-cancellation';
    PERFORM public.transition_human_response_commitment_by_system(
      v_commitment_id, f.organization_id, f.store_id, 'cancelled',
      f.operation_key || ':cancel', NULL
    );
    SELECT * INTO v_row
    FROM public.read_human_response_commitments_by_system(
      f.organization_id, f.store_id, f.conversation_id
    ) WHERE id = v_commitment_id;
    IF NOT FOUND OR v_row.status IS DISTINCT FROM 'cancelled'
       OR v_row.cancelled_at IS NULL THEN
      RAISE EXCEPTION 'cancelamento não confirmado pelo reader';
    END IF;
    v_completed := v_completed + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'test_name', v_stage, 'verdict', 'PASS',
      'details', 'cancelamento confirmado pela função canônica'));

    v_stage := '5-canonical-reader';
    SELECT * INTO v_row
    FROM public.read_human_response_commitments_by_system(
      f.organization_id, f.store_id, f.conversation_id
    ) WHERE id = v_commitment_id;
    IF NOT FOUND OR v_row.organization_id IS DISTINCT FROM f.organization_id
       OR v_row.store_id IS DISTINCT FROM f.store_id
       OR v_row.conversation_id IS DISTINCT FROM f.conversation_id
       OR v_row.conversation_session_id IS DISTINCT FROM f.conversation_session_id
       OR v_row.source_message_id IS DISTINCT FROM f.source_message_id
       OR v_row.source_kind IS DISTINCT FROM f.source_kind
       OR v_row.responsible_user_id IS DISTINCT FROM f.responsible_user_id THEN
      RAISE EXCEPTION 'reader não preservou escopo e proveniência';
    END IF;
    v_completed := v_completed + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'test_name', v_stage, 'verdict', 'PASS',
      'details', 'reader RPC preservou organização, loja, conversa, sessão e origem'));

    v_stage := '6-false-provenance';
    v_expected_error := CASE WHEN f.source_kind = 'panel'
      THEN 'human_response_commitment_whatsapp_echo_not_verified'
      ELSE 'human_response_commitment_panel_actor_not_verified' END;
    v_error := NULL;
    v_sqlstate := NULL;
    BEGIN
      PERFORM public.record_human_response_commitment_by_system(
        f.organization_id, f.store_id, f.conversation_id,
        f.conversation_session_id, f.source_message_id, f.responsible_user_id,
        v_due_at, f.operation_key || ':false-provenance',
        CASE WHEN f.source_kind = 'panel' THEN 'whatsapp_human' ELSE 'panel' END,
        true
      );
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE,
                              v_error = MESSAGE_TEXT;
    END;
    IF v_sqlstate IS DISTINCT FROM '23514'
       OR v_error IS DISTINCT FROM v_expected_error THEN
      RAISE EXCEPTION 'proveniência falsa não foi rejeitada conforme contrato (% / %)',
        coalesce(v_sqlstate, 'sem erro'), coalesce(v_error, 'sem erro');
    END IF;
    v_completed := v_completed + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'test_name', v_stage, 'verdict', 'PASS',
      'details', 'source_kind adulterado rejeitado com SQLSTATE 23514'));

    v_stage := '7-cross-scope-isolation';
    SELECT count(*) INTO v_count
    FROM public.read_human_response_commitments_by_system(
      f.alternate_organization_id, f.alternate_store_id, f.conversation_id
    ) WHERE id = v_commitment_id;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'reader vazou compromisso para outra loja';
    END IF;
    v_error := NULL;
    v_sqlstate := NULL;
    BEGIN
      PERFORM public.record_human_response_commitment_by_system(
        f.alternate_organization_id, f.alternate_store_id, f.conversation_id,
        f.conversation_session_id, f.source_message_id, f.alternate_user_id,
        v_due_at, f.operation_key || ':wrong-scope', f.source_kind, true
      );
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE,
                              v_error = MESSAGE_TEXT;
    END;
    IF v_sqlstate IS DISTINCT FROM '23514'
       OR v_error IS DISTINCT FROM 'human_response_commitment_source_message_not_verified' THEN
      RAISE EXCEPTION 'writer aceitou outra loja ou rejeitou pelo motivo errado (% / %)',
        coalesce(v_sqlstate, 'sem erro'), coalesce(v_error, 'sem erro');
    END IF;
    v_completed := v_completed + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'test_name', v_stage, 'verdict', 'PASS',
      'details', 'reader isolado e writer rejeitou mensagem de outra loja'));

    v_stage := '8-explicit-confirmation-required';
    v_error := NULL;
    v_sqlstate := NULL;
    BEGIN
      PERFORM public.record_human_response_commitment_by_system(
        f.organization_id, f.store_id, f.conversation_id,
        f.conversation_session_id, f.source_message_id, f.responsible_user_id,
        v_due_at, f.operation_key || ':no-confirm', f.source_kind, false
      );
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE,
                              v_error = MESSAGE_TEXT;
    END;
    IF v_sqlstate IS DISTINCT FROM '22023'
       OR v_error IS DISTINCT FROM 'human_response_commitment_explicit_confirmation_required' THEN
      RAISE EXCEPTION 'writer aceitou falta de confirmação explícita (% / %)',
        coalesce(v_sqlstate, 'sem erro'), coalesce(v_error, 'sem erro');
    END IF;
    v_completed := v_completed + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'test_name', v_stage, 'verdict', 'PASS',
      'details', 'sem confirmação explícita rejeitado com SQLSTATE 22023'));

    IF v_completed <> 8 THEN
      RAISE EXCEPTION 'contagem de testes incompleta: %', v_completed;
    END IF;

    -- Exceção intencional: reverte inclusive registro, alterações e cancelamento.
    v_stage := 'rollback';
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'P9_10_7_A0_3_INTENTIONAL_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE,
                            v_error = MESSAGE_TEXT;
    v_rollback_confirmed := true;
    IF v_sqlstate = 'P0001'
       AND v_error = 'P9_10_7_A0_3_INTENTIONAL_ROLLBACK'
       AND v_completed = 8 THEN
      v_pass := true;
    ELSE
      v_pass := false;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'test_name', v_stage, 'verdict', 'BLOQUEADO',
        'details', coalesce(v_sqlstate, 'erro') || ': ' || coalesce(v_error, 'desconhecido')));
    END IF;
  END;

  -- Já estamos FORA da subtransação revertida. Verificamos a tabela real.
  SELECT count(*) INTO v_persisted
  FROM public.conversation_human_response_commitments c
  WHERE c.organization_id = f.organization_id
    AND c.operation_key LIKE f.operation_key || '%';

  INSERT INTO pg_temp.p9_10_7_a0_3_results (test_name, verdict, details)
  SELECT item->>'test_name', item->>'verdict', item->>'details'
  FROM jsonb_array_elements(v_results) item;

  INSERT INTO pg_temp.p9_10_7_a0_3_results VALUES (
    '9-post-rollback',
    CASE WHEN v_rollback_confirmed AND v_pass
                   AND v_completed = 8 AND v_persisted = 0
              THEN 'PASS' ELSE 'BLOQUEADO' END,
    CASE WHEN v_rollback_confirmed AND v_pass
                   AND v_completed = 8 AND v_persisted = 0
              THEN 'oito testes passaram; subtransação revertida; nenhuma chave de teste persistiu'
              ELSE 'teste falhou, foi incompleto ou houve gravação persistente; contador=' ||
                   v_completed::text || ', persistidos=' || v_persisted::text END
  );
END;
$runner$;

-- Esta é a ÚNICA tabela de resultado, emitida DEPOIS da reversão interna.
SELECT test_name, verdict, details
FROM pg_temp.p9_10_7_a0_3_results
ORDER BY CASE WHEN test_name = 'preflight' THEN 0
              WHEN test_name = 'fixture' THEN 1
              WHEN test_name = '9-post-rollback' THEN 9
              ELSE 2 END, test_name;

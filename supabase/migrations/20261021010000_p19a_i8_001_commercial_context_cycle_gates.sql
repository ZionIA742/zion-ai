-- ZION / Central I8 / I8-001 -- DRAFT LOCAL PARA REVISAO (NAO EXECUTAR)
-- Objetivo: ciclo historico capturado no vinculo canonico, gates fail-closed
-- na materializacao e no sender reativo da IA Vendedora.
-- Usa alteracoes estritas em definicoes vigentes (pg_get_functiondef),
-- conservando assinatura, configuracao, owner e ACL de cada RPC.
-- NAO faz backfill historico. NAO modifica outros caminhos de envio.
-- Este artefato nao substitui validacao local, testes SQL focais ou
-- autorizacao explicita para execucao no Supabase.

BEGIN;

DO $i8_preflight$
BEGIN
  IF pg_catalog.to_regclass('public.commercial_session_context_links') IS NULL
     OR pg_catalog.to_regclass('public.commercial_opportunities') IS NULL
     OR pg_catalog.to_regclass('public.conversation_sessions') IS NULL
     OR pg_catalog.to_regclass('public.lead_customer_links') IS NULL
     OR pg_catalog.to_regclass('public.messages') IS NULL
     OR pg_catalog.to_regprocedure('public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)') IS NULL
     OR pg_catalog.to_regprocedure('public.validate_or_cancel_whatsapp_external_send_v3_by_system(uuid,uuid,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'P19A_I8_001_CONTEXT_CYCLE_DEPENDENCY_MISSING';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.commercial_session_context_links'::regclass
      AND attname = 'lifecycle_cycle' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'P19A_I8_001_CONTEXT_CYCLE_COLUMN_ALREADY_EXISTS_RECONCILE_FIRST';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'commercial_opportunities'
      AND column_name = 'lifecycle_cycle' AND data_type = 'integer'
  ) THEN
    RAISE EXCEPTION 'P19A_I8_001_OPPORTUNITY_CYCLE_CONTRACT_MISSING';
  END IF;
END;
$i8_preflight$;

-- Nullable por design: registros existentes continuam sem prova de ciclo.
ALTER TABLE public.commercial_session_context_links
  ADD COLUMN lifecycle_cycle integer NULL;
ALTER TABLE public.commercial_session_context_links
  ADD CONSTRAINT commercial_session_context_links_cycle_positive_check
  CHECK (lifecycle_cycle IS NULL OR lifecycle_cycle >= 1);
COMMENT ON COLUMN public.commercial_session_context_links.lifecycle_cycle IS
  'Ciclo imutavel capturado pelo writer canonico sob lock da oportunidade; NULL historico significa ciclo nao comprovado.';

-- Altera os corpos por substituicao literal unica, abortando sobre qualquer
-- divergencia de runtime em vez de reimplantar uma versao historica da RPC.
DO $i8_patch$
DECLARE
  v_oid oid;
  v_before text;
  v_after text;
  v_actual text;
  v_find text;
  v_replacement text;
  v_acl_before aclitem[];
  v_acl_after aclitem[];
  v_config_before text[];
  v_config_after text[];
  v_owner_before oid;
  v_owner_after oid;
  v_security_before boolean;
  v_security_after boolean;
BEGIN
  -- Patch TRIGGER preservando o contrato atual
  v_oid := pg_catalog.to_regprocedure('public.enforce_commercial_session_context_link_write_rules()');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'P19A_I8_001_FUNCTION_DEPENDENCY_MISSING: %', 'trigger';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(p.oid), p.proacl, p.proconfig,
         p.proowner, p.prosecdef
    INTO v_before, v_acl_before, v_config_before,
         v_owner_before, v_security_before
  FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_before IS NULL OR pg_catalog.pg_get_userbyid(v_owner_before) <> 'postgres' THEN
    RAISE EXCEPTION 'P19A_I8_001_OWNER_OR_SOURCE_MISMATCH';
  END IF;
  v_after := v_before;
  v_find := $i8old_trigger1$    if not found then
      raise exception using
        errcode = '23514',
        message = 'commercial session context link relation mismatch';
    end if;

    select lead_link.*$i8old_trigger1$;
  v_replacement := $i8new_trigger1$    if not found then
      raise exception using
        errcode = '23514',
        message = 'commercial session context link relation mismatch';
    end if;

    if new.lifecycle_cycle is null
       or new.lifecycle_cycle < 1
       or new.lifecycle_cycle is distinct from v_opportunity.lifecycle_cycle
       or (v_opportunity.last_reopened_at is not null
           and new.linked_at < v_opportunity.last_reopened_at) then
      raise exception using
        errcode = '23514',
        message = 'P19A_I8_CONTEXT_LINK_CYCLE_INVALID';
    end if;

    select lead_link.*$i8new_trigger1$;
  IF pg_catalog.strpos(v_after, v_find) = 0
     OR pg_catalog.length(v_after) - pg_catalog.length(pg_catalog.replace(v_after, v_find, ''))
          <> pg_catalog.length(v_find) THEN
    RAISE EXCEPTION 'P19A_I8_001_SOURCE_FRAGMENT_MISMATCH: trigger_1';
  END IF;
  v_after := pg_catalog.replace(v_after, v_find, v_replacement);
  v_find := $i8old_trigger2$       or new.lead_customer_link_id is distinct from old.lead_customer_link_id
       or new.replaces_link_id is distinct from old.replaces_link_id$i8old_trigger2$;
  v_replacement := $i8new_trigger2$       or new.lead_customer_link_id is distinct from old.lead_customer_link_id
       or new.lifecycle_cycle is distinct from old.lifecycle_cycle
       or new.replaces_link_id is distinct from old.replaces_link_id$i8new_trigger2$;
  IF pg_catalog.strpos(v_after, v_find) = 0
     OR pg_catalog.length(v_after) - pg_catalog.length(pg_catalog.replace(v_after, v_find, ''))
          <> pg_catalog.length(v_find) THEN
    RAISE EXCEPTION 'P19A_I8_001_SOURCE_FRAGMENT_MISMATCH: trigger_2';
  END IF;
  v_after := pg_catalog.replace(v_after, v_find, v_replacement);
  EXECUTE v_after;
  SELECT pg_catalog.pg_get_functiondef(p.oid), p.proacl, p.proconfig,
         p.proowner, p.prosecdef
    INTO v_actual, v_acl_after, v_config_after,
         v_owner_after, v_security_after
  FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_actual IS DISTINCT FROM v_after
     OR v_acl_after IS DISTINCT FROM v_acl_before
     OR v_config_after IS DISTINCT FROM v_config_before
     OR v_owner_after IS DISTINCT FROM v_owner_before
     OR v_security_after IS DISTINCT FROM v_security_before THEN
    RAISE EXCEPTION 'P19A_I8_001_FUNCTION_POSTCHECK_FAILED';
  END IF;
  -- Patch LINK preservando o contrato atual
  v_oid := pg_catalog.to_regprocedure('public.link_commercial_session_context(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,timestamptz)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'P19A_I8_001_FUNCTION_DEPENDENCY_MISSING: %', 'link';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(p.oid), p.proacl, p.proconfig,
         p.proowner, p.prosecdef
    INTO v_before, v_acl_before, v_config_before,
         v_owner_before, v_security_before
  FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_before IS NULL OR pg_catalog.pg_get_userbyid(v_owner_before) <> 'postgres' THEN
    RAISE EXCEPTION 'P19A_I8_001_OWNER_OR_SOURCE_MISMATCH';
  END IF;
  IF v_security_before IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P19A_I8_001_SECURITY_DEFINER_REQUIRED';
  END IF;
  v_after := v_before;
  v_find := $i8old_link1$      lead_customer_link_id,
      status,$i8old_link1$;
  v_replacement := $i8new_link1$      lead_customer_link_id,
      lifecycle_cycle,
      status,$i8new_link1$;
  IF pg_catalog.strpos(v_after, v_find) = 0
     OR pg_catalog.length(v_after) - pg_catalog.length(pg_catalog.replace(v_after, v_find, ''))
          <> pg_catalog.length(v_find) THEN
    RAISE EXCEPTION 'P19A_I8_001_SOURCE_FRAGMENT_MISMATCH: link_1';
  END IF;
  v_after := pg_catalog.replace(v_after, v_find, v_replacement);
  v_find := $i8old_link2$      p_lead_customer_link_id,
      'active',$i8old_link2$;
  v_replacement := $i8new_link2$      p_lead_customer_link_id,
      v_opportunity.lifecycle_cycle,
      'active',$i8new_link2$;
  IF pg_catalog.strpos(v_after, v_find) = 0
     OR pg_catalog.length(v_after) - pg_catalog.length(pg_catalog.replace(v_after, v_find, ''))
          <> pg_catalog.length(v_find) THEN
    RAISE EXCEPTION 'P19A_I8_001_SOURCE_FRAGMENT_MISMATCH: link_2';
  END IF;
  v_after := pg_catalog.replace(v_after, v_find, v_replacement);
  EXECUTE v_after;
  SELECT pg_catalog.pg_get_functiondef(p.oid), p.proacl, p.proconfig,
         p.proowner, p.prosecdef
    INTO v_actual, v_acl_after, v_config_after,
         v_owner_after, v_security_after
  FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_actual IS DISTINCT FROM v_after
     OR v_acl_after IS DISTINCT FROM v_acl_before
     OR v_config_after IS DISTINCT FROM v_config_before
     OR v_owner_after IS DISTINCT FROM v_owner_before
     OR v_security_after IS DISTINCT FROM v_security_before THEN
    RAISE EXCEPTION 'P19A_I8_001_FUNCTION_POSTCHECK_FAILED';
  END IF;
  -- Patch REPLACE preservando o contrato atual
  v_oid := pg_catalog.to_regprocedure('public.replace_commercial_session_context_link(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,text,text,jsonb,timestamptz)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'P19A_I8_001_FUNCTION_DEPENDENCY_MISSING: %', 'replace';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(p.oid), p.proacl, p.proconfig,
         p.proowner, p.prosecdef
    INTO v_before, v_acl_before, v_config_before,
         v_owner_before, v_security_before
  FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_before IS NULL OR pg_catalog.pg_get_userbyid(v_owner_before) <> 'postgres' THEN
    RAISE EXCEPTION 'P19A_I8_001_OWNER_OR_SOURCE_MISMATCH';
  END IF;
  IF v_security_before IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P19A_I8_001_SECURITY_DEFINER_REQUIRED';
  END IF;
  v_after := v_before;
  v_find := $i8old_replace1$      lead_customer_link_id,
      replaces_link_id,$i8old_replace1$;
  v_replacement := $i8new_replace1$      lead_customer_link_id,
      lifecycle_cycle,
      replaces_link_id,$i8new_replace1$;
  IF pg_catalog.strpos(v_after, v_find) = 0
     OR pg_catalog.length(v_after) - pg_catalog.length(pg_catalog.replace(v_after, v_find, ''))
          <> pg_catalog.length(v_find) THEN
    RAISE EXCEPTION 'P19A_I8_001_SOURCE_FRAGMENT_MISMATCH: replace_1';
  END IF;
  v_after := pg_catalog.replace(v_after, v_find, v_replacement);
  v_find := $i8old_replace2$      p_new_lead_customer_link_id,
      v_old.id,$i8old_replace2$;
  v_replacement := $i8new_replace2$      p_new_lead_customer_link_id,
      v_opportunity.lifecycle_cycle,
      v_old.id,$i8new_replace2$;
  IF pg_catalog.strpos(v_after, v_find) = 0
     OR pg_catalog.length(v_after) - pg_catalog.length(pg_catalog.replace(v_after, v_find, ''))
          <> pg_catalog.length(v_find) THEN
    RAISE EXCEPTION 'P19A_I8_001_SOURCE_FRAGMENT_MISMATCH: replace_2';
  END IF;
  v_after := pg_catalog.replace(v_after, v_find, v_replacement);
  EXECUTE v_after;
  SELECT pg_catalog.pg_get_functiondef(p.oid), p.proacl, p.proconfig,
         p.proowner, p.prosecdef
    INTO v_actual, v_acl_after, v_config_after,
         v_owner_after, v_security_after
  FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_actual IS DISTINCT FROM v_after
     OR v_acl_after IS DISTINCT FROM v_acl_before
     OR v_config_after IS DISTINCT FROM v_config_before
     OR v_owner_after IS DISTINCT FROM v_owner_before
     OR v_security_after IS DISTINCT FROM v_security_before THEN
    RAISE EXCEPTION 'P19A_I8_001_FUNCTION_POSTCHECK_FAILED';
  END IF;
  -- Patch MATERIALIZE preservando o contrato atual
  v_oid := pg_catalog.to_regprocedure('public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'P19A_I8_001_FUNCTION_DEPENDENCY_MISSING: %', 'materialize';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(p.oid), p.proacl, p.proconfig,
         p.proowner, p.prosecdef
    INTO v_before, v_acl_before, v_config_before,
         v_owner_before, v_security_before
  FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_before IS NULL OR pg_catalog.pg_get_userbyid(v_owner_before) <> 'postgres' THEN
    RAISE EXCEPTION 'P19A_I8_001_OWNER_OR_SOURCE_MISMATCH';
  END IF;
  IF v_security_before IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P19A_I8_001_SECURITY_DEFINER_REQUIRED';
  END IF;
  IF pg_catalog.strpos(v_before, 'v_request_role text := auth.role();') = 0
     OR pg_catalog.strpos(v_before, 'P19A_I8_SERVICE_ROLE_REQUIRED') = 0 THEN
    RAISE EXCEPTION 'P19A_I8_001_ROLE_ALIGNMENT_MUST_BE_PRESERVED';
  END IF;
  v_after := v_before;
  v_find := $i8old_materialize1$  if v_send_external then
    if v_anchor.commercial_session_context_link_id is null$i8old_materialize1$;
  v_replacement := $i8new_materialize1$  if v_send_external then
    if v_opportunity.id is null
       or v_opportunity.lifecycle_cycle is null
       or v_opportunity.lifecycle_cycle < 1
       or v_opportunity.stage in ('perdido', 'concluido_sem_mais_acoes')
       or v_opportunity.lost_at is not null
       or v_opportunity.current_loss_event_id is not null then
      raise exception using errcode = '23514',
        message = 'P19A_I8_EXTERNAL_OPPORTUNITY_NOT_CURRENT';
    end if;

    if v_anchor.commercial_session_context_link_id is null$i8new_materialize1$;
  IF pg_catalog.strpos(v_after, v_find) = 0
     OR pg_catalog.length(v_after) - pg_catalog.length(pg_catalog.replace(v_after, v_find, ''))
          <> pg_catalog.length(v_find) THEN
    RAISE EXCEPTION 'P19A_I8_001_SOURCE_FRAGMENT_MISMATCH: materialize_1';
  END IF;
  v_after := pg_catalog.replace(v_after, v_find, v_replacement);
  v_find := $i8old_materialize2$           and context_row.commercial_opportunity_id = p_commercial_opportunity_id
           and exists ($i8old_materialize2$;
  v_replacement := $i8new_materialize2$           and context_row.commercial_opportunity_id = p_commercial_opportunity_id
           and context_row.customer_id = v_opportunity.customer_id
           and context_row.status = 'active'
           and context_row.unlinked_at is null
           and context_row.lifecycle_cycle is not null
           and context_row.lifecycle_cycle = v_opportunity.lifecycle_cycle
           and context_row.conversation_session_id = v_anchor.conversation_session_id
           and exists ($i8new_materialize2$;
  IF pg_catalog.strpos(v_after, v_find) = 0
     OR pg_catalog.length(v_after) - pg_catalog.length(pg_catalog.replace(v_after, v_find, ''))
          <> pg_catalog.length(v_find) THEN
    RAISE EXCEPTION 'P19A_I8_001_SOURCE_FRAGMENT_MISMATCH: materialize_2';
  END IF;
  v_after := pg_catalog.replace(v_after, v_find, v_replacement);
  v_find := $i8old_materialize3$               and session_row.conversation_id = p_conversation_id
           )$i8old_materialize3$;
  v_replacement := $i8new_materialize3$               and session_row.conversation_id = p_conversation_id
               and session_row.status = 'active'
           )
           and exists (
             select 1
             from public.lead_customer_links lead_link
             where lead_link.id = context_row.lead_customer_link_id
               and lead_link.organization_id = p_organization_id
               and lead_link.store_id = p_store_id
               and lead_link.customer_id = v_opportunity.customer_id
               and lead_link.lead_id = p_lead_id
               and lead_link.status = 'active'
           )$i8new_materialize3$;
  IF pg_catalog.strpos(v_after, v_find) = 0
     OR pg_catalog.length(v_after) - pg_catalog.length(pg_catalog.replace(v_after, v_find, ''))
          <> pg_catalog.length(v_find) THEN
    RAISE EXCEPTION 'P19A_I8_001_SOURCE_FRAGMENT_MISMATCH: materialize_3';
  END IF;
  v_after := pg_catalog.replace(v_after, v_find, v_replacement);
  EXECUTE v_after;
  SELECT pg_catalog.pg_get_functiondef(p.oid), p.proacl, p.proconfig,
         p.proowner, p.prosecdef
    INTO v_actual, v_acl_after, v_config_after,
         v_owner_after, v_security_after
  FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_actual IS DISTINCT FROM v_after
     OR v_acl_after IS DISTINCT FROM v_acl_before
     OR v_config_after IS DISTINCT FROM v_config_before
     OR v_owner_after IS DISTINCT FROM v_owner_before
     OR v_security_after IS DISTINCT FROM v_security_before THEN
    RAISE EXCEPTION 'P19A_I8_001_FUNCTION_POSTCHECK_FAILED';
  END IF;
  -- Patch GATE preservando o contrato atual
  v_oid := pg_catalog.to_regprocedure('public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'P19A_I8_001_FUNCTION_DEPENDENCY_MISSING: %', 'gate';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(p.oid), p.proacl, p.proconfig,
         p.proowner, p.prosecdef
    INTO v_before, v_acl_before, v_config_before,
         v_owner_before, v_security_before
  FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_before IS NULL OR pg_catalog.pg_get_userbyid(v_owner_before) <> 'postgres' THEN
    RAISE EXCEPTION 'P19A_I8_001_OWNER_OR_SOURCE_MISMATCH';
  END IF;
  IF v_security_before IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P19A_I8_001_SECURITY_DEFINER_REQUIRED';
  END IF;
  v_after := v_before;
  v_find := $i8old_gate1$          v_block_reason := 'reactive_source_opportunity_mismatch';
        end if;
      end if;

      if v_block_reason is null then
        select exists (
          select 1
          from public.messages incoming_row$i8old_gate1$;
  v_replacement := $i8new_gate1$          v_block_reason := 'reactive_source_opportunity_mismatch';
        end if;
      end if;

      /* I8-001: recheck exact source anchor's immutable cycle and live
         session/link under the already-held opportunity lock, before
         processing transitions to uncertain or any Meta attempt. */
      if v_block_reason is null then
        if v_opportunity.lifecycle_cycle is null
           or v_opportunity.lifecycle_cycle < 1
           or v_opportunity.stage in ('perdido', 'concluido_sem_mais_acoes')
           or v_opportunity.lost_at is not null
           or v_opportunity.current_loss_event_id is not null then
          v_block_reason := 'reactive_ai_opportunity_not_current';
        elsif v_message.commercial_session_context_link_id
              is distinct from v_source_message.commercial_session_context_link_id
           or v_message.conversation_session_id
              is distinct from v_source_message.conversation_session_id then
          v_block_reason := 'reactive_ai_anchor_context_changed';
        elsif not exists (
          select 1
          from public.commercial_session_context_links context_link_row
          join public.conversation_sessions session_row
            on session_row.id = context_link_row.conversation_session_id
           and session_row.organization_id = context_link_row.organization_id
           and session_row.store_id = context_link_row.store_id
          join public.lead_customer_links lead_link
            on lead_link.id = context_link_row.lead_customer_link_id
           and lead_link.organization_id = context_link_row.organization_id
           and lead_link.store_id = context_link_row.store_id
          where context_link_row.id = v_source_message.commercial_session_context_link_id
            and context_link_row.organization_id = p_organization_id
            and context_link_row.store_id = p_store_id
            and context_link_row.status = 'active'
            and context_link_row.unlinked_at is null
            and context_link_row.lifecycle_cycle is not null
            and context_link_row.lifecycle_cycle = v_opportunity.lifecycle_cycle
            and context_link_row.commercial_opportunity_id = v_opportunity_id
            and context_link_row.customer_id = v_opportunity.customer_id
            and context_link_row.conversation_session_id = v_source_message.conversation_session_id
            and session_row.conversation_id = v_message.conversation_id
            and session_row.status = 'active'
            and lead_link.customer_id = v_opportunity.customer_id
            and lead_link.status = 'active'
            and lead_link.lead_id = (
              select conversation_row.lead_id
              from public.conversations conversation_row
              where conversation_row.id = v_message.conversation_id
                and conversation_row.organization_id = p_organization_id
            )
        ) then
          v_block_reason := 'reactive_ai_context_cycle_or_session_stale';
        end if;
      end if;

      if v_block_reason is null then
        select exists (
          select 1
          from public.messages incoming_row$i8new_gate1$;
  IF pg_catalog.strpos(v_after, v_find) = 0
     OR pg_catalog.length(v_after) - pg_catalog.length(pg_catalog.replace(v_after, v_find, ''))
          <> pg_catalog.length(v_find) THEN
    RAISE EXCEPTION 'P19A_I8_001_SOURCE_FRAGMENT_MISMATCH: gate_1';
  END IF;
  v_after := pg_catalog.replace(v_after, v_find, v_replacement);
  EXECUTE v_after;
  SELECT pg_catalog.pg_get_functiondef(p.oid), p.proacl, p.proconfig,
         p.proowner, p.prosecdef
    INTO v_actual, v_acl_after, v_config_after,
         v_owner_after, v_security_after
  FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_actual IS DISTINCT FROM v_after
     OR v_acl_after IS DISTINCT FROM v_acl_before
     OR v_config_after IS DISTINCT FROM v_config_before
     OR v_owner_after IS DISTINCT FROM v_owner_before
     OR v_security_after IS DISTINCT FROM v_security_before THEN
    RAISE EXCEPTION 'P19A_I8_001_FUNCTION_POSTCHECK_FAILED';
  END IF;

  -- O caminho original de service_role e os wrappers v2/v3 permanecem intactos.
  IF NOT has_function_privilege('service_role',
      'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon',
      'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated',
      'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'P19A_I8_001_MATERIALIZER_ACL_UNSAFE';
  END IF;
  RAISE NOTICE 'P19A_I8_001_CYCLE_GATES_LOCAL_SQL_PATCH_READY';
END;
$i8_patch$;

COMMIT;

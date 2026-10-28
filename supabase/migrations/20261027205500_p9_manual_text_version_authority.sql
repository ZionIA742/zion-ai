-- ZION | P9.9.15 | Ramo de versionamento para contrato manual.
-- Aditivo; preserva os contratos oriundos de orcamento aceito.
-- INSTALACAO SOMENTE: nao gera PDF, versao, contrato, aprovacao ou mensagem.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  v_lineage oid := pg_catalog.to_regprocedure(
    'public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)'
  );
  v_writer oid := pg_catalog.to_regprocedure(
    'public.create_sales_contract_version_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,bigint,text,jsonb)'
  );
  v_text oid := pg_catalog.to_regprocedure(
    'public.create_sales_contract_text_version_by_system(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,uuid,text,text,text,uuid,text,text,text,text,bigint,text,jsonb,boolean)'
  );
BEGIN
  IF v_lineage IS NULL OR v_writer IS NULL OR v_text IS NULL
     OR pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL
     OR pg_catalog.to_regclass('public.sales_contract_text_drafts') IS NULL
     OR pg_catalog.to_regclass('public.sales_contracts') IS NULL
     OR pg_catalog.to_regclass('public.commercial_opportunities') IS NULL
     OR pg_catalog.to_regclass('public.sales_contract_versions') IS NULL
     OR pg_catalog.to_regclass('public.store_contract_template_versions') IS NULL
     OR pg_catalog.to_regprocedure(
        'public.create_sales_contract_manual_by_system(uuid,uuid,uuid,uuid,uuid,bigint,text,uuid)'
       ) IS NULL THEN
    RAISE EXCEPTION 'P9_MANUAL_VERSION_PREFLIGHT_DEPENDENCY_MISSING';
  END IF;
  -- Funcao live foi obtida do Supabase, incluindo o guard de condicao final.
  -- Nao sobrepor uma definicao que tenha mudado depois da auditoria.
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_lineage))
       IS DISTINCT FROM '20f7a7915f9001ae5d738bd462eb52c4' THEN
    RAISE EXCEPTION 'P9_MANUAL_VERSION_LINEAGE_DRIFT';
  END IF;
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_writer))
       IS DISTINCT FROM '7e2c5bdee78239725e4cff1b472229d9' THEN
    RAISE EXCEPTION 'P9_MANUAL_VERSION_WRITER_DRIFT';
  END IF;
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_text),
       'P9_TEXT_VERSION_CONTRACT_LINEAGE_INVALID') = 0 THEN
    RAISE EXCEPTION 'P9_MANUAL_VERSION_TEXT_WRITER_DRIFT';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.p9_assert_sales_contract_current_proposal_lineage_internal(p_organization_id uuid, p_store_id uuid, p_contract_id uuid)
 RETURNS TABLE(guard_state text, commercial_opportunity_id uuid, quote_id uuid, quote_version_id uuid, acceptance_event_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp', 'public'
 SET row_security TO 'off'
AS $function$
declare
  v_base record;
  v_final record;
  v_lifecycle_cycle integer;
  v_requires_final boolean := false;
  v_manual_contract public.sales_contracts%ROWTYPE;
  v_manual_opportunity public.commercial_opportunities%ROWTYPE;
begin
  -- Isolamento explicito da origem manual. Nunca tratar como contrato legado.
  -- O contrato manual nao possui quote, aceite nem valores comerciais autoritativos.
  SELECT c.* INTO v_manual_contract
  FROM public.sales_contracts c
  WHERE c.id = p_contract_id
    AND c.organization_id = p_organization_id
    AND c.store_id = p_store_id;

  IF FOUND AND (
    v_manual_contract.metadata->>'created_via' = 'create_sales_contract_manual_by_system'
    OR v_manual_contract.metadata->>'source' = 'responsible_text_draft'
  ) THEN
    IF v_manual_contract.metadata->>'created_via'
         IS DISTINCT FROM 'create_sales_contract_manual_by_system'
       OR v_manual_contract.metadata->>'source'
         IS DISTINCT FROM 'responsible_text_draft'
       OR v_manual_contract.quote_id IS NOT NULL
       OR v_manual_contract.quote_version_id IS NOT NULL
       OR v_manual_contract.metadata->>'commercial_amounts_authoritative'
         IS DISTINCT FROM 'false'
       OR NULLIF(pg_catalog.btrim(COALESCE(v_manual_contract.metadata->>'created_by_user_id', '')), '') IS NULL
       OR NULLIF(pg_catalog.btrim(COALESCE(v_manual_contract.metadata->>'draft_id', '')), '') IS NULL
       OR NULLIF(pg_catalog.btrim(COALESCE(v_manual_contract.metadata->>'template_version_id', '')), '') IS NULL
       OR COALESCE(v_manual_contract.metadata->>'creation_draft_sha256','') !~ '^[0-9a-f]{64}$'
       OR COALESCE(v_manual_contract.metadata->>'creation_draft_revision','') !~ '^[1-9][0-9]*$'
       OR NULLIF(pg_catalog.btrim(COALESCE(v_manual_contract.metadata->>'commercial_opportunity_id','')), '') IS NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'P9_MANUAL_LINEAGE_METADATA_INVALID';
    END IF;

    -- Evita cast de UUID proveniente de metadata e comprova o escopo pelo registro real.
    SELECT o.* INTO v_manual_opportunity
    FROM public.commercial_opportunities o
    WHERE o.id::text = v_manual_contract.metadata->>'commercial_opportunity_id'
      AND o.organization_id = p_organization_id
      AND o.store_id = p_store_id
      AND o.customer_id::text = v_manual_contract.metadata->>'customer_id'
    FOR UPDATE NOWAIT;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'P9_MANUAL_LINEAGE_OPPORTUNITY_INVALID';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.sales_contract_text_drafts d
      JOIN public.store_contract_template_versions tv
        ON tv.id = d.template_version_id
       AND tv.organization_id = d.organization_id
       AND tv.store_id = d.store_id
      WHERE d.id::text = v_manual_contract.metadata->>'draft_id'
        AND d.organization_id = p_organization_id
        AND d.store_id = p_store_id
        AND d.commercial_opportunity_id = v_manual_opportunity.id
        AND d.template_version_id::text = v_manual_contract.metadata->>'template_version_id'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'P9_MANUAL_LINEAGE_DRAFT_SCOPE_INVALID';
    END IF;

    RETURN QUERY SELECT 'current'::text, v_manual_opportunity.id,
      NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  select base_row.*
  into v_base
  from public.p9_contract_lineage_pre_final_condition(
    p_organization_id,
    p_store_id,
    p_contract_id
  ) base_row;

  if not found then
    raise exception using errcode = 'P0001', message = 'P9_FINAL_CONDITION_BASE_LINEAGE_MISSING';
  end if;

  if v_base.commercial_opportunity_id is not null then
    select opportunity_row.lifecycle_cycle
    into v_lifecycle_cycle
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v_base.commercial_opportunity_id
      and opportunity_row.organization_id = p_organization_id
      and opportunity_row.store_id = p_store_id;

    if not found then
      raise exception using errcode = 'P0002', message = 'P9_FINAL_CONDITION_CONTRACT_OPPORTUNITY_NOT_FOUND';
    end if;

    select
      exists (
        select 1
        from public.commercial_final_conditions condition_row
        where condition_row.organization_id = p_organization_id
          and condition_row.store_id = p_store_id
          and condition_row.commercial_opportunity_id = v_base.commercial_opportunity_id
          and condition_row.lifecycle_cycle = v_lifecycle_cycle
      )
      or exists (
        select 1
        from public.commercial_opportunity_lifecycle_events event_row
        where event_row.organization_id = p_organization_id
          and event_row.store_id = p_store_id
          and event_row.commercial_opportunity_id = v_base.commercial_opportunity_id
          and event_row.lifecycle_cycle = v_lifecycle_cycle
          and event_row.event_type = 'stage_transition'
          and event_row.previous_stage = 'negociacao'
          and event_row.new_stage = 'fechamento_pagamento'
          and event_row.reason_code = 'accepted_negotiated_condition_required'
      )
    into v_requires_final;

    if v_requires_final then
      select final_row.*
      into v_final
      from public.p9_resolve_current_commercial_final_condition_internal(
        p_organization_id,
        p_store_id,
        v_base.commercial_opportunity_id
      ) final_row;

      if not found
         or v_final.condition_state is distinct from 'current'
         or v_final.quote_id is distinct from v_base.quote_id
         or v_final.quote_version_id is distinct from v_base.quote_version_id
         or v_final.acceptance_event_id is distinct from v_base.acceptance_event_id then
        raise exception using errcode = 'P0001', message = 'P9_FINAL_COMMERCIAL_CONDITION_STALE';
      end if;
    end if;
  end if;

  return query select
    v_base.guard_state,
    v_base.commercial_opportunity_id,
    v_base.quote_id,
    v_base.quote_version_id,
    v_base.acceptance_event_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_sales_contract_text_version_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_contract_id uuid,
  p_commercial_opportunity_id uuid,
  p_template_version_id uuid,
  p_draft_id uuid,
  p_draft_revision bigint,
  p_draft_sha256 text,
  p_expected_current_version_id uuid,
  p_operation_key text,
  p_request_fingerprint text,
  p_content_fingerprint text,
  p_store_file_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_pdf_sha256 text,
  p_contract_snapshot jsonb,
  p_allow_reopen_approved boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  contract_id uuid,
  organization_id uuid,
  store_id uuid,
  version_number integer,
  status text,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp, public
SET row_security = off
AS $function$
DECLARE
  v_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_contract public.sales_contracts%rowtype;
  v_draft public.sales_contract_text_drafts%rowtype;
  v_template public.store_contract_templates%rowtype;
  v_written record;
  v_provenance jsonb;
  v_calculated_sha256 text;
  v_replay_candidate boolean;
  v_is_manual boolean := false;
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND session_user <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'P9_TEXT_VERSION_UNAUTHORIZED';
  END IF;

  IF p_organization_id IS NULL OR p_store_id IS NULL OR p_contract_id IS NULL
     OR p_commercial_opportunity_id IS NULL OR p_template_version_id IS NULL
     OR p_draft_id IS NULL OR p_draft_revision IS NULL OR p_draft_revision < 1
     OR p_draft_sha256 IS NULL OR p_draft_sha256 !~ '^[0-9a-f]{64}$'
     OR p_pdf_sha256 IS NULL OR p_pdf_sha256 !~ '^[0-9a-f]{64}$'
     OR p_contract_snapshot IS NULL
     OR pg_catalog.jsonb_typeof(p_contract_snapshot) <> 'object'
     OR p_operation_key IS NULL OR pg_catalog.btrim(p_operation_key) = ''
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'P9_TEXT_VERSION_INVALID_ARGUMENTS';
  END IF;

  -- A oportunidade vem antes do contrato. NOWAIT evita espera circular
  -- com o writer anterior (contrato -> oportunidade).
  PERFORM 1 FROM public.commercial_opportunities o
   WHERE o.id = p_commercial_opportunity_id
     AND o.organization_id = p_organization_id AND o.store_id = p_store_id
   FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_VERSION_OPPORTUNITY_INVALID';
  END IF;

  SELECT c.* INTO v_contract FROM public.sales_contracts c
   WHERE c.id = p_contract_id AND c.organization_id = p_organization_id
     AND c.store_id = p_store_id
   FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_VERSION_CONTRACT_INVALID';
  END IF;

  -- Discriminador imutavel. O ramo antigo continua exigindo quote canonico.
  v_is_manual := (
    v_contract.metadata->>'created_via' = 'create_sales_contract_manual_by_system'
    OR v_contract.metadata->>'source' = 'responsible_text_draft'
  );

  IF v_is_manual THEN
    IF v_contract.metadata->>'created_via' IS DISTINCT FROM 'create_sales_contract_manual_by_system'
       OR v_contract.metadata->>'source' IS DISTINCT FROM 'responsible_text_draft'
       OR v_contract.metadata->>'commercial_opportunity_id' IS DISTINCT FROM p_commercial_opportunity_id::text
       OR v_contract.metadata->>'draft_id' IS DISTINCT FROM p_draft_id::text
       OR v_contract.metadata->>'template_version_id' IS DISTINCT FROM p_template_version_id::text
       OR v_contract.metadata->>'commercial_amounts_authoritative' IS DISTINCT FROM 'false'
       OR v_contract.quote_id IS NOT NULL OR v_contract.quote_version_id IS NOT NULL
       OR v_contract.subtotal_cents <> 0 OR v_contract.discount_cents <> 0
       OR v_contract.total_cents <> 0
       OR NOT EXISTS (
         SELECT 1 FROM public.commercial_opportunities o
         WHERE o.id = p_commercial_opportunity_id
           AND o.organization_id = p_organization_id AND o.store_id = p_store_id
           AND o.customer_id::text = v_contract.metadata->>'customer_id'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_MANUAL_TEXT_VERSION_LINEAGE_INVALID';
    END IF;

    -- O snapshot textual manual NAO pode inventar ID de orcamento nem aceite.
    IF p_contract_snapshot->'origin'->>'source' IS DISTINCT FROM 'responsible_text_draft'
       OR p_contract_snapshot->'origin'->>'commercial_amounts_authoritative' IS DISTINCT FROM 'false'
       OR pg_catalog.jsonb_typeof(p_contract_snapshot->'lineage'->'quote_id') IS DISTINCT FROM 'null'
       OR pg_catalog.jsonb_typeof(p_contract_snapshot->'lineage'->'quote_version_id') IS DISTINCT FROM 'null'
       OR pg_catalog.jsonb_typeof(p_contract_snapshot->'lineage'->'proposal_acceptance_event_id') IS DISTINCT FROM 'null'
       OR pg_catalog.jsonb_typeof(p_contract_snapshot->'renderer_input'->'identity'->'quoteId') IS DISTINCT FROM 'null'
       OR pg_catalog.jsonb_typeof(p_contract_snapshot->'renderer_input'->'identity'->'quoteVersionId') IS DISTINCT FROM 'null'
       OR pg_catalog.jsonb_typeof(p_contract_snapshot->'renderer_input'->'lineage'->'proposalAcceptanceEventId') IS DISTINCT FROM 'null'
       OR pg_catalog.jsonb_typeof(p_contract_snapshot->'renderer_input'->'items') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(COALESCE(
          CASE WHEN pg_catalog.jsonb_typeof(p_contract_snapshot->'renderer_input'->'items') = 'array'
               THEN p_contract_snapshot->'renderer_input'->'items' END, '[]'::jsonb)) <> 0
       OR p_contract_snapshot->'renderer_input'->'values'->>'subtotalCents' IS DISTINCT FROM '0'
       OR p_contract_snapshot->'renderer_input'->'values'->>'discountCents' IS DISTINCT FROM '0'
       OR p_contract_snapshot->'renderer_input'->'values'->>'totalCents' IS DISTINCT FROM '0'
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_MANUAL_TEXT_VERSION_SNAPSHOT_INVALID';
    END IF;
  ELSE
    -- Comportamento original de contratos gerados a partir de quote aceito.
    IF v_contract.metadata->>'created_via' IS DISTINCT FROM
          'create_sales_contract_from_current_accepted_proposal_by_system'
       OR v_contract.metadata->>'commercial_opportunity_id' IS DISTINCT FROM
          p_commercial_opportunity_id::text
       OR v_contract.quote_id IS NULL OR v_contract.quote_version_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.sales_quotes q
          WHERE q.id = v_contract.quote_id
            AND q.organization_id = p_organization_id AND q.store_id = p_store_id
            AND q.commercial_opportunity_id = p_commercial_opportunity_id
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_VERSION_CONTRACT_LINEAGE_INVALID';
    END IF;
  END IF;

  IF v_contract.status NOT IN ('draft', 'pending_review', 'approved') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_VERSION_CONTRACT_STATUS_BLOCKED';
  END IF;
  IF v_contract.status = 'approved'
     AND (v_contract.approved_at IS NULL OR v_contract.approved_by IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_VERSION_APPROVAL_AUDIT_INVALID';
  END IF;

  SELECT d.* INTO v_draft FROM public.sales_contract_text_drafts d
   WHERE d.id = p_draft_id AND d.organization_id = p_organization_id
     AND d.store_id = p_store_id
     AND d.commercial_opportunity_id = p_commercial_opportunity_id
     AND d.template_version_id = p_template_version_id
   FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_VERSION_DRAFT_NOT_FOUND';
  END IF;

  IF v_draft.revision IS DISTINCT FROM p_draft_revision THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_VERSION_DRAFT_REVISION_CHANGED';
  END IF;
  IF pg_catalog.btrim(v_draft.draft_text) = ''
     OR pg_catalog.char_length(v_draft.draft_text) > 300000 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_VERSION_DRAFT_TEXT_INVALID';
  END IF;

  v_calculated_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_draft.draft_text, 'UTF8'), 'sha256'),
    'hex'
  );
  IF v_calculated_sha256 IS DISTINCT FROM p_draft_sha256 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_VERSION_DRAFT_SHA256_CHANGED';
  END IF;

  -- Impede troca de modelo durante a versao; um lock indisponivel falha seguro.
  SELECT t.* INTO v_template FROM public.store_contract_templates t
   WHERE t.organization_id = p_organization_id AND t.store_id = p_store_id
     AND t.status = 'active' AND t.active_version_id = p_template_version_id
   FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_VERSION_TEMPLATE_INACTIVE';
  END IF;
  PERFORM 1 FROM public.store_contract_template_versions tv
   WHERE tv.id = p_template_version_id AND tv.template_id = v_template.id
     AND tv.organization_id = p_organization_id AND tv.store_id = p_store_id
     AND tv.status = 'active'
   FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_VERSION_TEMPLATE_VERSION_INACTIVE';
  END IF;

  v_provenance := p_contract_snapshot->'text_provenance';
  IF pg_catalog.jsonb_typeof(v_provenance) IS DISTINCT FROM 'object'
     OR v_provenance->>'mode' IS DISTINCT FROM 'saved_text_draft'
     OR v_provenance->>'draft_id' IS DISTINCT FROM p_draft_id::text
     OR v_provenance->>'organization_id' IS DISTINCT FROM p_organization_id::text
     OR v_provenance->>'store_id' IS DISTINCT FROM p_store_id::text
     OR v_provenance->>'commercial_opportunity_id' IS DISTINCT FROM p_commercial_opportunity_id::text
     OR v_provenance->>'template_version_id' IS DISTINCT FROM p_template_version_id::text
     OR v_provenance->>'revision' IS DISTINCT FROM p_draft_revision::text
     OR v_provenance->>'text_sha256' IS DISTINCT FROM v_calculated_sha256
     OR v_provenance->>'pdf_sha256' IS DISTINCT FROM p_pdf_sha256
     OR v_provenance->>'text_representation' IS DISTINCT FROM 'persisted_text_utf8_exact'
     OR v_provenance->>'rendered_text_representation' IS DISTINCT FROM 'line_endings_normalized_to_lf'
     OR p_contract_snapshot->'identity'->>'contract_id' IS DISTINCT FROM p_contract_id::text
     OR p_contract_snapshot->'lineage'->>'commercial_opportunity_id' IS DISTINCT FROM p_commercial_opportunity_id::text
     OR p_contract_snapshot->'template_authority'->>'template_id' IS DISTINCT FROM v_template.id::text
     OR p_contract_snapshot->'template_authority'->>'template_version_id' IS DISTINCT FROM p_template_version_id::text
     OR p_contract_snapshot->'renderer_input'->'lineage'->>'commercialOpportunityId' IS DISTINCT FROM p_commercial_opportunity_id::text
     OR p_contract_snapshot->>'content_fingerprint' IS DISTINCT FROM p_content_fingerprint
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_VERSION_PROVENANCE_INVALID';
  END IF;

  -- O replay nao deve exigir o current_version_id antigo nem mudar aprovacoes.
  -- O writer conferira a equivalencia integral do snapshot/fingerprint.
  SELECT EXISTS (
    SELECT 1 FROM public.sales_contract_versions v
     WHERE v.contract_id = p_contract_id
       AND v.organization_id = p_organization_id AND v.store_id = p_store_id
       AND (v.operation_key = pg_catalog.btrim(p_operation_key)
            OR v.content_fingerprint = p_content_fingerprint)
  ) INTO v_replay_candidate;

  IF NOT v_replay_candidate THEN
    IF v_contract.current_version_id IS DISTINCT FROM p_expected_current_version_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_VERSION_CURRENT_VERSION_CHANGED';
    END IF;
    IF v_contract.status = 'approved' AND p_allow_reopen_approved IS DISTINCT FROM true THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_VERSION_REOPEN_REQUIRES_HUMAN_ACTION';
    END IF;
  END IF;

  SELECT w.* INTO v_written
  FROM public.create_sales_contract_version_by_system(
    p_organization_id, p_store_id, p_contract_id,
    p_operation_key, p_request_fingerprint, p_content_fingerprint,
    p_store_file_id, p_storage_bucket, p_storage_path,
    p_original_filename, p_mime_type, p_size_bytes,
    p_pdf_sha256, p_contract_snapshot
  ) w;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'P9_TEXT_VERSION_WRITER_RETURNED_NO_VERSION';
  END IF;

  IF v_written.replayed IS DISTINCT FROM true THEN
    UPDATE public.sales_contracts c
       SET status = 'pending_review', approved_at = NULL, approved_by = NULL
     WHERE c.id = p_contract_id AND c.organization_id = p_organization_id
       AND c.store_id = p_store_id AND c.current_version_id = v_written.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'P9_TEXT_VERSION_REVIEW_RESET_FAILED';
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_written.id::uuid, v_written.contract_id::uuid,
    v_written.organization_id::uuid, v_written.store_id::uuid,
    v_written.version_number::integer, v_written.status::text,
    v_written.replayed::boolean;
END;
$function$;


-- Preservar SECURITY DEFINER / grants sem disponibilizar escrita a usuarios.
ALTER FUNCTION public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.create_sales_contract_text_version_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,uuid,text,text,text,
  uuid,text,text,text,text,bigint,text,jsonb,boolean
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_sales_contract_text_version_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,uuid,text,text,text,
  uuid,text,text,text,text,bigint,text,jsonb,boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_contract_text_version_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,uuid,text,text,text,
  uuid,text,text,text,text,bigint,text,jsonb,boolean
) TO service_role;

DO $postflight$
DECLARE
  v_lineage oid := pg_catalog.to_regprocedure(
    'public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)'
  );
  v_text oid := pg_catalog.to_regprocedure(
    'public.create_sales_contract_text_version_by_system(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,uuid,text,text,text,uuid,text,text,text,text,bigint,text,jsonb,boolean)'
  );
BEGIN
  IF v_lineage IS NULL OR v_text IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = v_lineage AND p.prosecdef AND p.proowner = 'postgres'::regrole)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = v_text AND p.prosecdef AND p.proowner = 'postgres'::regrole)
    OR pg_catalog.has_function_privilege('anon', v_text, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_text, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', v_text, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', v_lineage, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_lineage, 'EXECUTE')
    OR pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_lineage),
       'P9_MANUAL_LINEAGE_METADATA_INVALID') = 0
    OR pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_text),
       'P9_MANUAL_TEXT_VERSION_SNAPSHOT_INVALID') = 0
  THEN
    RAISE EXCEPTION 'P9_MANUAL_VERSION_POSTFLIGHT_INVALID';
  END IF;
END;
$postflight$;

COMMIT;
SELECT 'PASS' AS resultado,
  'P9_MANUAL_TEXT_VERSION_AUTHORITY_INSTALLED' AS componente,
  'NO_CONTRACT_CREATED_NO_WHATSAPP_SEND' AS transporte;

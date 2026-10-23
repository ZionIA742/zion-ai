-- ZION | PILAR 9 | BLOCO 9 | Contrato simplificado
-- Migration: 20261023090000_p9_contract_template_manual_activation_guard_alignment.sql
-- Alinha o trigger existente a ativacao MANUAL do arquivo original.
-- Nao altera documentos, dados existentes, templates ou outras funcoes.
-- Revisao: postcondicao tolera espacos e quebras de linha; toda a mudanca
-- ocorre em transacao e e revertida automaticamente se qualquer teste falhar.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $precondition$
DECLARE
  v_definition text;
  v_owner text;
  v_security_definer boolean;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid),
         pg_catalog.pg_get_userbyid(p.proowner),
         p.prosecdef
    INTO v_definition, v_owner, v_security_definer
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'p19a_guard_store_contract_template_version_update'
    AND p.pronargs = 0;

  IF v_definition IS NULL
     OR v_owner IS DISTINCT FROM 'postgres'
     OR v_security_definer IS DISTINCT FROM false
     OR pg_catalog.strpos(v_definition, 'P19A_CONTRACT_VERSION_HAS_NO_RULES') = 0
     OR pg_catalog.strpos(v_definition, 'P19A_CONTRACT_VERSION_HAS_PENDING_RULES') = 0
     OR pg_catalog.strpos(v_definition, 'P19A_CONTRACT_ACTIVE_VERSION_MUTATION_BLOCKED') = 0
     OR pg_catalog.strpos(v_definition, 'P19A_CONTRACT_VERSION_NOT_REJECTABLE') = 0
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'P9_CONTRACT_ACTIVATION_GUARD_PRECONDITION_FAILED';
  END IF;
END;
$precondition$;

CREATE OR REPLACE FUNCTION public.p19a_guard_store_contract_template_version_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Estados historicos/finais permanecem imutaveis.
  IF old.status IN ('archived', 'rejected', 'approved') THEN
    RAISE EXCEPTION
      'P19A_CONTRACT_VERSION_READ_ONLY: version % with status % is immutable',
      old.id, old.status;
  END IF;

  -- Versao ativa so pode transicionar para archived; demais campos imutaveis.
  IF old.status = 'active' THEN
    IF new.status <> 'archived' THEN
      RAISE EXCEPTION
        'P19A_CONTRACT_ACTIVE_VERSION_READ_ONLY: active version % can only transition to archived',
        old.id;
    END IF;

    IF (pg_catalog.to_jsonb(new) - 'status' - 'updated_at')
       IS DISTINCT FROM
       (pg_catalog.to_jsonb(old) - 'status' - 'updated_at')
    THEN
      RAISE EXCEPTION
        'P19A_CONTRACT_ACTIVE_VERSION_MUTATION_BLOCKED: active version % cannot be changed while being archived',
        old.id;
    END IF;
    RETURN new;
  END IF;

  -- Ativacao manual: nenhuma analise/revisao de regras obrigatoria.
  -- A RPC existente continua verificando sessao, escopo, arquivo e locks.
  IF new.status = 'active' AND old.status <> 'active' THEN
    IF old.status NOT IN (
      'uploaded',
      'analyzed',
      'awaiting_review'
    ) THEN
      RAISE EXCEPTION
        'P19A_CONTRACT_VERSION_NOT_ACTIVATABLE: version % cannot become active from status %',
        old.id, old.status;
    END IF;

    IF old.rejected_at IS NOT NULL THEN
      RAISE EXCEPTION
        'P19A_CONTRACT_REJECTED_VERSION_NOT_ACTIVATABLE: version % has rejected_at',
        old.id;
    END IF;
  END IF;

  -- Rejeicao continua restrita a candidatas mutaveis.
  IF new.status = 'rejected' AND old.status <> 'rejected' THEN
    IF old.status NOT IN (
      'uploaded', 'failed', 'analyzed', 'awaiting_review'
    ) THEN
      RAISE EXCEPTION
        'P19A_CONTRACT_VERSION_NOT_REJECTABLE: version % cannot be rejected from status %',
        old.id, old.status;
    END IF;
  END IF;

  RETURN new;
END;
$function$;

-- Verificar estrutura, owner, trigger e ausencia dos gates antigos.
-- Nao depender de quebra de linha/indentacao do codigo SQL.
DO $postcondition$
DECLARE
  v_definition text;
  v_owner text;
  v_security_definer boolean;
  v_normalized text;
  v_trigger_bound boolean;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid),
         pg_catalog.pg_get_userbyid(p.proowner),
         p.prosecdef
    INTO v_definition, v_owner, v_security_definer
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'p19a_guard_store_contract_template_version_update'
    AND p.pronargs = 0;

  v_normalized := pg_catalog.regexp_replace(
    coalesce(v_definition, ''),
    '[[:space:]]+', ' ', 'g'
  );

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger tg
    WHERE tg.tgrelid = 'public.store_contract_template_versions'::regclass
      AND tg.tgname = 'p19a_guard_store_contract_template_version_update_trg'
      AND tg.tgfoid =
        'public.p19a_guard_store_contract_template_version_update()'::regprocedure
      AND NOT tg.tgisinternal
      AND tg.tgenabled IN ('O', 'A')
  ) INTO v_trigger_bound;

  IF v_definition IS NULL
     OR v_owner IS DISTINCT FROM 'postgres'
     OR v_security_definer IS DISTINCT FROM false
     OR NOT v_trigger_bound
     OR pg_catalog.strpos(v_normalized, '''uploaded'', ''analyzed'', ''awaiting_review''') = 0
     OR pg_catalog.strpos(v_definition, 'P19A_CONTRACT_ACTIVE_VERSION_MUTATION_BLOCKED') = 0
     OR pg_catalog.strpos(v_definition, 'P19A_CONTRACT_VERSION_NOT_REJECTABLE') = 0
     OR pg_catalog.strpos(v_definition, 'P19A_CONTRACT_VERSION_HAS_NO_RULES') > 0
     OR pg_catalog.strpos(v_definition, 'P19A_CONTRACT_VERSION_HAS_PENDING_RULES') > 0
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'P9_CONTRACT_ACTIVATION_GUARD_POSTCONDITION_FAILED';
  END IF;

  RAISE NOTICE 'P9_CONTRACT_ACTIVATION_GUARD_ALIGNED';
END;
$postcondition$;

COMMIT;

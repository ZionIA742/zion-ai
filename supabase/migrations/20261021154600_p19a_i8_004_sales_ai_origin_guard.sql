-- ZION / CENTRAL I8 / I8-004
-- SQL complementar executado anteriormente em producao via Supabase SQL Editor.
-- ARQUIVO DE RECONCILIACAO: NAO EXECUTAR NOVAMENTE.
-- Nao registrar como migration pendente antes de reconciliar o historico remoto.
-- Restringe revisao humana a mensagens originadas pela IA Vendedora.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $i8_004$
DECLARE
  v_oid oid;

  v_before text;
  v_after text;

  v_source_before text;
  v_source_after text;

  v_owner_before oid;
  v_acl_before aclitem[];
  v_config_before text[];

  v_owner_after oid;
  v_acl_after aclitem[];
  v_config_after text[];

  v_anchor text :=
    'IF v_message.outbound_delivery_state';

  v_replacement text := $guard$
IF (
    v_message.metadata ->> 'source'
      IS DISTINCT FROM 'ai_sales_reply_set'

    OR COALESCE(
      v_message.metadata ->> 'outbound_origin',
      ''
    ) NOT IN (
      'ai_sales_reply',
      'ai_sales_customer_catalog_document',
      'ai_sales_catalog_photo'
    )

    OR COALESCE(
      v_message.metadata ->> 'outbound_kind',
      ''
    ) NOT IN (
      'reactive_ai_reply',
      'stop_contact_ack'
    )
  )
  THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = 'I8_004_NOT_SALES_AI_OUTBOUND';
  END IF;

  IF v_message.outbound_delivery_state$guard$;

BEGIN

  v_oid := pg_catalog.to_regprocedure(
    'public.record_i8_whatsapp_uncertain_review_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text,text)'
  );

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'I8_004_REVIEW_RPC_MISSING';
  END IF;

  SELECT
    pg_catalog.pg_get_functiondef(p.oid),
    p.prosrc,
    p.proowner,
    p.proacl,
    p.proconfig
  INTO
    v_before,
    v_source_before,
    v_owner_before,
    v_acl_before,
    v_config_before
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_oid
    AND p.prosecdef = true;

  IF v_before IS NULL THEN
    RAISE EXCEPTION
      'I8_004_REVIEW_RPC_AUTHORITY_MISMATCH';
  END IF;

  IF pg_catalog.pg_get_userbyid(v_owner_before)
       IS DISTINCT FROM 'postgres'
  THEN
    RAISE EXCEPTION
      'I8_004_REVIEW_RPC_OWNER_MISMATCH';
  END IF;

  IF pg_catalog.strpos(
       v_before,
       'I8_004_NOT_SALES_AI_OUTBOUND'
     ) > 0
  THEN
    RAISE EXCEPTION
      'I8_004_SCOPE_GUARD_ALREADY_EXISTS';
  END IF;

  IF (
    pg_catalog.length(v_before)
    -
    pg_catalog.length(
      pg_catalog.replace(
        v_before,
        v_anchor,
        ''
      )
    )
  ) / pg_catalog.length(v_anchor) <> 1
  THEN
    RAISE EXCEPTION
      'I8_004_UNEXPECTED_RPC_DEFINITION';
  END IF;

  IF pg_catalog.strpos(
       v_before,
       'IF v_message.direction'
     ) = 0
     OR pg_catalog.strpos(
       v_before,
       'IF v_message.direction'
     ) >= pg_catalog.strpos(
       v_before,
       v_anchor
     )
  THEN
    RAISE EXCEPTION
      'I8_004_UNEXPECTED_VALIDATION_ORDER';
  END IF;

  v_after := pg_catalog.replace(
    v_before,
    v_anchor,
    v_replacement
  );

  EXECUTE v_after;

  SELECT
    p.prosrc,
    p.proowner,
    p.proacl,
    p.proconfig
  INTO
    v_source_after,
    v_owner_after,
    v_acl_after,
    v_config_after
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_oid
    AND p.prosecdef = true;

  IF v_source_after IS DISTINCT FROM
       pg_catalog.replace(
         v_source_before,
         v_anchor,
         v_replacement
       )
     OR v_owner_after IS DISTINCT FROM v_owner_before
     OR v_acl_after IS DISTINCT FROM v_acl_before
     OR v_config_after IS DISTINCT FROM v_config_before
  THEN
    RAISE EXCEPTION
      'I8_004_RPC_POSTCHECK_FAILED';
  END IF;

  IF pg_catalog.has_function_privilege(
       'authenticated',
       v_oid,
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon',
       v_oid,
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role',
       v_oid,
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION
      'I8_004_RPC_PERMISSION_MISMATCH';
  END IF;

  RAISE NOTICE
    'I8_004_SALES_AI_SCOPE_GUARD_INSTALLED';

END;
$i8_004$;

COMMIT;

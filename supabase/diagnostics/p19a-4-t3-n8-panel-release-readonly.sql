-- P19-A / Bloco 4 / 4-T3-N.8
-- Consulta somente leitura para confirmar o contrato remoto do painel.
-- Executar no SQL Editor; o resultado aparece como tabela.

WITH target AS (
  SELECT pg_catalog.to_regprocedure(
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'
  ) AS oid
)
SELECT
  'panel_release_conversation_to_ai_scoped'::text AS diagnostic,
  target.oid::regprocedure AS signature,
  proc.prosecdef AS security_definer,
  proc.proowner::regrole AS owner_role,
  has_function_privilege('authenticated', proc.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', proc.oid, 'EXECUTE') AS service_role_execute,
  pg_catalog.pg_get_functiondef(proc.oid) AS definition,
  position('auth.uid()' IN pg_catalog.pg_get_functiondef(proc.oid)) > 0 AS requires_authenticated_identity,
  position('human takeover hard hold requires explicit release authority' IN pg_catalog.pg_get_functiondef(proc.oid)) > 0 AS rejects_hard_hold,
  position('for update of conversation_row' IN pg_catalog.pg_get_functiondef(proc.oid)) > 0 AS locks_conversation,
  position('conversation_human_takeover_leases' IN pg_catalog.pg_get_functiondef(proc.oid)) > 0 AS reads_takeover_lease
FROM target
LEFT JOIN pg_catalog.pg_proc proc ON proc.oid = target.oid;

SELECT
  'panel_release_acl_expected'::text AS diagnostic,
  'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::text AS signature,
  false AS service_role_must_execute,
  true AS authenticated_must_execute;

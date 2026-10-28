BEGIN;

-- ZION-ADM B5-6-X.27-J
-- Leitura restrita para a API de custos oficiais.
-- Nao concede acesso a anon ou authenticated.

GRANT SELECT (
    id,
    operation_key,
    provider,
    source,
    query_identity,
    period_start,
    period_end,
    state,
    snapshot_collection_id,
    supersedes_operation_id,
    confirmed_at
)
ON TABLE public.zion_admin_openai_cost_collection_operations
TO service_role;

COMMIT;

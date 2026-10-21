-- P19-A / Bloco 5 / Etapa 5.9
-- Restringe acesso anonimo ao writer da Assistente.
-- Preserva os grants de authenticated e service_role.
-- Correcao ja aplicada e validada no Supabase.

BEGIN;

REVOKE EXECUTE ON FUNCTION
  public.assistant_push_system_message(
    uuid, uuid, text, text,
    uuid, uuid, uuid, jsonb
  )
FROM PUBLIC, anon;

COMMIT;
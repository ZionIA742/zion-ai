-- P19-A / Bloco 5 / Etapa 5.4
-- Restringe a execucao publica de funcoes auxiliares de auditoria.
-- Permissoes ja corrigidas e verificadas em producao em 19/10/2026.
-- Nao altera as RPCs operacionais de claim ou recovery.
-- Funcoes opcionais: instalacoes novas podem nao possuir esses helpers.

DO $migration$
BEGIN
    IF to_regprocedure(
        'public.audit_test_enqueue_responsible_whatsapp_notification_invalid_in()'
    ) IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION
            public.audit_test_enqueue_responsible_whatsapp_notification_invalid_in()
        FROM PUBLIC, anon, authenticated;
    END IF;

    IF to_regprocedure(
        'public.audit_test_process_next_responsible_whatsapp_notification_null_()'
    ) IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION
            public.audit_test_process_next_responsible_whatsapp_notification_null_()
        FROM PUBLIC, anon, authenticated;
    END IF;
END
$migration$;

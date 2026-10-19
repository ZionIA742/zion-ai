-- P19-A / Bloco 5 / Etapa 5.9
-- Permite imagem, audio e documento no historico da Assistente.
-- Correcao aplicada previamente no Supabase de producao.
-- Preserva os seis tipos originais.
-- Nao habilita video sem suporte completo no runtime.

DO $migration$
DECLARE
    v_definition text;
BEGIN
    SELECT pg_get_constraintdef(c.oid)
    INTO v_definition
    FROM pg_constraint c
    WHERE c.conrelid =
        'public.store_assistant_messages'::regclass
      AND c.conname =
        'store_assistant_messages_message_type_check';

    IF v_definition IS NULL THEN
        RAISE EXCEPTION
            'Constraint store_assistant_messages_message_type_check ausente';
    END IF;

    IF v_definition NOT LIKE '%''image''%'
       OR v_definition NOT LIKE '%''audio''%'
       OR v_definition NOT LIKE '%''file''%'
    THEN
        ALTER TABLE public.store_assistant_messages
            DROP CONSTRAINT
                store_assistant_messages_message_type_check;

        ALTER TABLE public.store_assistant_messages
            ADD CONSTRAINT
                store_assistant_messages_message_type_check
            CHECK (
                message_type IN (
                    'text',
                    'report_morning',
                    'report_evening',
                    'alert',
                    'context',
                    'followup_summary',
                    'image',
                    'audio',
                    'file'
                )
            );
    END IF;
END
$migration$;
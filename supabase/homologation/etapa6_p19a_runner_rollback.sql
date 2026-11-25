-- ZION/P19-A ETAPA 6 - RUNNER UNICO DDL + COMPORTAMENTAL.
-- REVISAO DE SEGURANCA: executa somente as autoridades das cinco migrations
-- contra fixtures sinteticas transacionais; nenhum dado real e reutilizado.
-- Reutiliza os corpos das cinco migrations atuais, com dois guards NULL corrigidos
-- nas migrations locais 20261114170000 e 20261114180000.
-- Confirme correspondencia exata com o repositorio antes de executar.
-- IMPORTANTE: concorrencia real entre sessoes nao e falsamente simulada; o
-- resultado final a marca como PENDING. Os demais cenarios comportamentais
-- usam fixtures sinteticas e sao desfeitos pelo ROLLBACK final.
-- Nao executar sem comparar os corpos embarcados com as cinco migrations atuais.
-- Executar somente apos o PRECHECK revisado, verificacao manual de identidade,
-- historico, eventos de DDL, riscos e autorizacao consciente para DDL transacional.
-- EXECUCAO EM SUPABASE REAL: locks temporarios podem afetar sessoes ativas.
-- Nao ha garantia de efeitos externos desfeitos por ROLLBACK.
-- Se qualquer comando falhar, considere REPROVADO, mesmo se RUNNER_END aparecer.
-- A ultima tabela pode aprovar SOMENTE comportamento transacional;
-- a Etapa 6 global segue PENDENTE ate concorrencia real em duas sessoes.
-- Prova: lock consultivo de sessao adquirido SOMENTE apos todas as assercoes;
-- liberado na consulta final APOS ROLLBACK. Nao registra estado persistente.
-- Executar TODO este arquivo como UMA UNICA consulta no SQL Editor.
-- Nao executar trechos isolados; conexoes diferentes produzem FAIL seguro.
-- Comprova somente a finalizacao SQL sintetica; a autenticacao service_role
-- real e a concorrencia em duas sessoes permanecem PENDING.
-- Nao executar em producao ate revisar o precheck completo e riscos de DDL.
-- BLOQUEIO OPERACIONAL: SQL Editor pode interromper o lote antes do ROLLBACK.
-- SET LOCAL e session GUCs nao sao uma prova de cleanup depois de abort.
-- Se o lote for interrompido, executar ROLLBACK na MESMA conexao; se ela
-- morreu, confirmar o encerramento da sessao/backend e repetir o preflight de
-- colisao antes de qualquer nova execucao. O veredito abaixo nunca trata essa
-- situacao como PASS automatico.
-- PROTOCOLO READ-ONLY APOS INTERRUPCAO (fora deste lote; nao executar junto):
-- 1. Antes da execucao, na sessao A, registrar:
--    SELECT pg_backend_pid() AS original_pid, backend_start, datname, usename,
--           state, xact_start, query_start
--      FROM pg_stat_activity WHERE pid = pg_backend_pid();
-- 2. Se A for interrompida, nao usar ausencia de fixtures como prova. Na
--    sessao B, consultar somente:
--    SELECT pid, backend_start, datname, usename, state, xact_start, query_start
--      FROM pg_stat_activity WHERE pid = <original_pid>;
-- 3. Se houver uma linha com o mesmo original_pid e backend_start, a sessao
--    ainda existe: state='idle in transaction' ou 'active' e qualquer
--    xact_start nao nulo significam PENDING/BLOQUEADO. Nao executar preflight.
-- 4. Somente se a linha original nao existir, ou se o mesmo backend estiver
--    comprovadamente sem transacao aberta, consultar em B os IDs sinteticos,
--    as tabelas de fixtures e schema_migrations. PID reutilizado sem
--    backend_start igual e inconclusivo.
--    Consultas read-only propostas, depois da prova de encerramento:
--    SELECT 'auth.users' AS artifact, count(*) AS n FROM auth.users
--     WHERE id='00000000-0000-0000-0000-000000006107'::uuid
--    UNION ALL SELECT 'zion_internal_admins', count(*)
--      FROM public.zion_internal_admins
--     WHERE user_id='00000000-0000-0000-0000-000000006107'::uuid
--    UNION ALL SELECT 'organizations', count(*) FROM public.organizations
--     WHERE id IN ('00000000-0000-0000-0000-000000006101'::uuid,
--                  '00000000-0000-0000-0000-000000006103'::uuid,
--                  '00000000-0000-0000-0000-000000006105'::uuid,
--                  '00000000-0000-0000-0000-000000006108'::uuid,
--                  '00000000-0000-0000-0000-00000000610f'::uuid)
--    UNION ALL SELECT 'stores', count(*) FROM public.stores
--     WHERE id IN ('00000000-0000-0000-0000-000000006102'::uuid,
--                  '00000000-0000-0000-0000-000000006104'::uuid,
--                  '00000000-0000-0000-0000-000000006106'::uuid,
--                  '00000000-0000-0000-0000-000000006109'::uuid)
--    UNION ALL SELECT 'external_integrations', count(*)
--      FROM public.external_integrations
--     WHERE id IN ('00000000-0000-0000-0000-00000000610a'::uuid,
--                  '00000000-0000-0000-0000-000000006110'::uuid)
--        OR organization_id IN ('00000000-0000-0000-0000-000000006101'::uuid,
--                               '00000000-0000-0000-0000-000000006103'::uuid,
--                               '00000000-0000-0000-0000-000000006105'::uuid,
--                               '00000000-0000-0000-0000-000000006108'::uuid,
--                               '00000000-0000-0000-0000-00000000610f'::uuid)
--    UNION ALL SELECT 'recovery_events', count(*)
--      FROM public.whatsapp_pin_recovery_events
--     WHERE attempt_id='00000000-0000-0000-0000-00000000610b'::uuid
--        OR operation_id='00000000-0000-0000-0000-00000000610c'::uuid
--        OR actor_user_id='00000000-0000-0000-0000-000000006107'::uuid;
--    SELECT version::text FROM supabase_migrations.schema_migrations
--     WHERE version::text IN ('20261114000000','20261114030000',
--       '20261114170000','20261114180000','20261114183000');
-- 5. Qualquer timeout, desconexao, PID reutilizado, erro de permissao ou
--    consulta incompleta permanece PENDING/BLOQUEADO. Uma nova execucao exige
--    novo preflight e nova comparacao local do manifesto.
-- GATE LOCAL OBRIGATORIO (nao executavel pelo SQL Editor): comparar SHA-256
-- dos cinco arquivos locais com os valores abaixo antes de colar este lote.
-- O SQL Editor nao possui acesso ao filesystem e pg_get_functiondef() nao e
-- hash de arquivo. Hashes locais registrados em 2026-11-17:
-- 20261114000000 = E25531784FDD958EE7C7308524A866657F9C94B56D2414CAA717F9EC78205BE7
-- 20261114030000 = 542372C8588E69805EA8D3861C8C385558B19962B563567284ECAE133049D960
-- 20261114170000 = 8E87A75B609C0935EBEA457C6F81411C14CC5A04685E8CD8874019A251C38C64
-- 20261114180000 = 8043442AD0A8A8A70CCA73B0F897B6625F29900729850944EC6A2050FFF9FC03
-- 20261114183000 = B302538F96D83F6764F30A1FB09E4EC9BC59DF11CCED3BA461AEBC77C8CAE656
--
-- ALGORITMO CANONICO DOS CORPOS EMBARCADOS:
-- 1. Ler cada migration como bytes UTF-8.
-- 2. Converter CRLF e CR para LF.
-- 3. Remover somente o prefixo literal "begin;" seguido por LF, quando
--    presente, e o sufixo literal "commit;" precedido por LF, quando presente.
-- 4. Extrair o bloco entre os marcadores BEGIN/END deste runner; remover
--    somente a LF introduzida pelo marcador quando a migration fonte nao tem
--    begin;.
-- 5. Remover LF finais e acrescentar exatamente uma LF final.
-- 6. SHA-256 dos bytes UTF-8 resultantes. Nenhuma outra normalizacao e aceita.
-- Hashes canonicos dos cinco corpos, na ordem de aplicacao:
-- 20261114000000 = 58A683D24B855DE2121C9FFE3BCA393764E89C368E932B63FDB3558A6A5B9E51
-- 20261114030000 = 542372C8588E69805EA8D3861C8C385558B19962B563567284ECAE133049D960
-- 20261114170000 = 06A05C170446F0B652DE8B324FC8390D78F579B1E1EA387E0339D6C90A5F75AC
-- 20261114180000 = 8ED6FB0C56174A343442EF0F93BA9A710DBE5E4FD32732FFCCF0B23F8FB5B853
-- 20261114183000 = 35111A4D92EA325658E1323E2815A66D094FBC54ED42599B6839A01693BA4574
-- HASH AGREGADO REPRODUZIVEL:
-- SHA-256 dos bytes UTF-8 da concatenacao, sem espacos, exatamente:
-- <filename>=<canonical_body_sha256> LF, para cada arquivo na ordem acima.
-- Resultado: 648A4C93BA12BCE2C4A5CAAC7E0FE92B8C945174380C562C1D2EA74C0314CC18
-- Prelude obrigatorio na MESMA conexao, somente depois da comparacao local:
-- SET zion.etapa6.source_manifest_gate =
-- 'verified:648A4C93BA12BCE2C4A5CAAC7E0FE92B8C945174380C562C1D2EA74C0314CC18';

DO $zion_source_manifest_gate$
BEGIN
  IF current_setting('zion.etapa6.source_manifest_gate', true)
       IS DISTINCT FROM 'verified:648A4C93BA12BCE2C4A5CAAC7E0FE92B8C945174380C562C1D2EA74C0314CC18' THEN
    RAISE EXCEPTION 'ZION_ETAPA6_LOCAL_SOURCE_MANIFEST_GATE_REQUIRED';
  END IF;
END;
$zion_source_manifest_gate$;

-- Reduz falso positivo em reexecucoes: remove somente um possivel lock
-- residual deste runner na MESMA conexao. Nao libera locks de outras funcoes.
-- Este lock de prova e identificado tambem pelo PID da conexao PostgreSQL.
DO $zion_proof_reset$
BEGIN
  -- Consultar pg_locks antes de liberar evita WARNING quando nao ha lock.
  WHILE EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks l
     WHERE l.locktype = 'advisory'
       AND l.pid = pg_catalog.pg_backend_pid()
       AND l.classid = pg_catalog.hashtext('ZION_P19A_ETAPA6_DDL_PROOF_V1_20261116')::oid
       AND l.objid = pg_catalog.pg_backend_pid()::oid
       AND l.objsubid = 2
       AND l.granted
  ) LOOP
    PERFORM pg_catalog.pg_advisory_unlock(
      pg_catalog.hashtext('ZION_P19A_ETAPA6_DDL_PROOF_V1_20261116'),
      pg_catalog.pg_backend_pid()
    );
  END LOOP;
  WHILE EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks l
     WHERE l.locktype = 'advisory'
       AND l.pid = pg_catalog.pg_backend_pid()
       AND l.classid = pg_catalog.hashtext('ZION_P19A_ETAPA6_SOURCE_MANIFEST_GATE_V1_20261117')::oid
       AND l.objid = pg_catalog.pg_backend_pid()::oid
       AND l.objsubid = 2
  ) LOOP
    PERFORM pg_catalog.pg_advisory_unlock(
      pg_catalog.hashtext('ZION_P19A_ETAPA6_SOURCE_MANIFEST_GATE_V1_20261117'),
      pg_catalog.pg_backend_pid()
    );
  END LOOP;
END;
$zion_proof_reset$;

-- A GUC validada acima pode ser revertida se o SQL Editor envolver todo o
-- lote em uma transacao implicita. Registrar a prova em lock de SESSAO
-- preserva a evidencia atraves do ROLLBACK sem transformar a ausencia do
-- gate em PASS. O lock e liberado somente na consulta final.
DO $zion_source_manifest_proof_lock$
BEGIN
  PERFORM pg_catalog.pg_advisory_lock(
    pg_catalog.hashtext('ZION_P19A_ETAPA6_SOURCE_MANIFEST_GATE_V1_20261117'),
    pg_catalog.pg_backend_pid()
  );
END;
$zion_source_manifest_proof_lock$;

-- O harness e temporario, criado DENTRO da mesma transacao de teste.
-- Ao final, o ROLLBACK remove tabela, funcoes, fixtures e resultados.
-- O veredito visivel usa somente um lock consultivo de sessao, obtido
-- DEPOIS de conferir todos os resultados, liberado na consulta final.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '120s';
CREATE TEMP TABLE pg_temp.zion_etapa6_behavior_results (
  scenario text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('PASS', 'SUT_FAIL', 'HARNESS_ERROR', 'PENDING')),
  detail text
) ON COMMIT PRESERVE ROWS;

CREATE OR REPLACE FUNCTION pg_temp.zion_etapa6_record(
  p_scenario text, p_name text, p_status text, p_detail text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql AS $function$
BEGIN
  INSERT INTO pg_temp.zion_etapa6_behavior_results(scenario, name, status, detail)
  VALUES (p_scenario, p_name, p_status, p_detail)
  ; -- Duplicar o mesmo cenario e erro: nao mascarar resultados anteriores.
END;
$function$;

DO $zion_preflight$
DECLARE
  v_applied integer;
BEGIN
  IF current_setting('transaction_read_only') = 'on' THEN
    RAISE EXCEPTION 'ZION_ETAPA6_READ_ONLY_TRANSACTION';
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'ZION_ETAPA6_EXPECTED_POSTGRES_ROLE';
  END IF;
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'ZION_ETAPA6_EXPECTED_POSTGRES_DATABASE';
  END IF;
  IF pg_is_in_recovery() THEN
    RAISE EXCEPTION 'ZION_ETAPA6_REPLICA_NOT_ALLOWED';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL
     OR to_regclass('public.stores') IS NULL
     OR to_regclass('public.external_integrations') IS NULL
     OR to_regclass('public.whatsapp_phone_security_secrets') IS NULL
     OR to_regclass('public.whatsapp_pin_recovery_attempts') IS NULL
     OR to_regclass('public.whatsapp_pin_recovery_events') IS NULL
     OR to_regclass('public.whatsapp_binding_change_requests') IS NULL
     OR to_regclass('public.state_transition_log') IS NULL
     OR to_regprocedure('public.materialize_store_whatsapp_embedded_signup_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'ZION_ETAPA6_REQUIRED_BASE_OBJECT_MISSING';
  END IF;
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL
     OR to_regrole('postgres') IS NULL THEN
    RAISE EXCEPTION 'ZION_ETAPA6_EXPECTED_SUPABASE_ROLE_MISSING';
  END IF;
  -- Os seis event triggers abaixo foram inspecionados manualmente no Supabase.
  -- Triggers de extensoes sao limitados a CREATE/DROP EXTENSION, comandos
  -- ausentes das cinco migrations neste runner. Os dois watchers PostgREST
  -- usam NOTIFY, que nao e entregue se a transacao sofre ROLLBACK.
  -- FALHA FECHADO se aparecer um trigger desconhecido, alterado ou habilitado
  -- em modo diferente do encontrado na auditoria (evtenabled = 'O').
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_event_trigger e
    JOIN pg_catalog.pg_proc p ON p.oid = e.evtfoid
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE e.evtenabled <> 'D'
      AND (
        (e.evtname = 'issue_graphql_placeholder'
          AND e.evtevent = 'sql_drop' AND e.evtenabled = 'O'
          AND p.proname = 'set_graphql_placeholder'
          AND e.evttags = ARRAY['DROP EXTENSION']::text[])
        OR (e.evtname = 'issue_pg_cron_access'
          AND e.evtevent = 'ddl_command_end' AND e.evtenabled = 'O'
          AND p.proname = 'grant_pg_cron_access'
          AND e.evttags = ARRAY['CREATE EXTENSION']::text[])
        OR (e.evtname = 'issue_pg_graphql_access'
          AND e.evtevent = 'ddl_command_end' AND e.evtenabled = 'O'
          AND p.proname = 'grant_pg_graphql_access'
          AND e.evttags = ARRAY['CREATE EXTENSION']::text[])
        OR (e.evtname = 'issue_pg_net_access'
          AND e.evtevent = 'ddl_command_end' AND e.evtenabled = 'O'
          AND p.proname = 'grant_pg_net_access'
          AND e.evttags = ARRAY['CREATE EXTENSION']::text[])
        OR (e.evtname = 'pgrst_ddl_watch'
          AND e.evtevent = 'ddl_command_end' AND e.evtenabled = 'O'
          AND n.nspname = 'extensions' AND p.proname = 'pgrst_ddl_watch'
          AND e.evttags IS NULL
          AND position('NOTIFY pgrst, ''reload schema'';'
             in pg_catalog.pg_get_functiondef(e.evtfoid)) > 0)
        OR (e.evtname = 'pgrst_drop_watch'
          AND e.evtevent = 'sql_drop' AND e.evtenabled = 'O'
          AND n.nspname = 'extensions' AND p.proname = 'pgrst_drop_watch'
          AND e.evttags IS NULL
          AND position('NOTIFY pgrst, ''reload schema'';'
             in pg_catalog.pg_get_functiondef(e.evtfoid)) > 0)
      ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'ZION_ETAPA6_UNREVIEWED_DDL_EVENT_TRIGGER';
  END IF;
  -- A fase comportamental faz DML transacional em organizations, stores,
  -- external_integrations, whatsapp_phone_security_secrets e
  -- whatsapp_binding_change_requests. Se algum
  -- trigger de negocio nessas tabelas tiver transporte externo, o runner
  -- para antes de criar fixtures: ROLLBACK nao desfaz efeitos externos.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal
       AND n.nspname = 'public'
       AND c.relname IN (
         'organizations', 'stores', 'external_integrations',
         'whatsapp_phone_security_secrets',
         'state_transition_log',
         'whatsapp_binding_change_requests'
       )
       AND lower(coalesce(pg_catalog.pg_get_functiondef(p.oid), '') ||
                 coalesce(pg_catalog.pg_get_triggerdef(t.oid), ''))
           ~ '(net[.]http|pg_net|cron[.]|http_post|http_get|pg_notify|notify[[:space:]]|dblink|lo_export)'
  ) THEN
    RAISE EXCEPTION 'ZION_ETAPA6_EXTERNAL_DML_TRIGGER_NOT_SAFE_FOR_ROLLBACK';
  END IF;
  -- The synthetic recovery actor is inserted into auth.users below.  Fail
  -- closed if the reviewed application trigger is absent, duplicated, or no
  -- longer the neutralized handle_new_user() body.  This is a SQL fixture
  -- precondition only; it is not proof of a real Auth/service_role session.
  IF (
    SELECT count(*)
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'auth'
       AND c.relname = 'users'
       AND NOT t.tgisinternal
       AND t.tgenabled = 'O'
  ) <> 1
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger t
         JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
        WHERE n.nspname = 'auth'
          AND c.relname = 'users'
          AND t.tgname = 'on_auth_user_created'
          AND NOT t.tgisinternal
          AND t.tgenabled = 'O'
          AND p.oid = pg_catalog.to_regprocedure('public.handle_new_user()')
     )
  THEN
    RAISE EXCEPTION 'ZION_ETAPA6_AUTH_USERS_TRIGGER_CONTRACT_UNREVIEWED';
  END IF;
  IF pg_catalog.to_regprocedure('public.handle_new_user()') IS NULL
     OR pg_catalog.pg_get_functiondef(
          pg_catalog.to_regprocedure('public.handle_new_user()')
        ) NOT ILIKE '%return new;%'
     OR pg_catalog.pg_get_functiondef(
          pg_catalog.to_regprocedure('public.handle_new_user()')
        ) ILIKE '%insert into%'
     OR pg_catalog.pg_get_functiondef(
          pg_catalog.to_regprocedure('public.handle_new_user()')
        ) ILIKE '%update %'
  THEN
    RAISE EXCEPTION 'ZION_ETAPA6_HANDLE_NEW_USER_NOT_NEUTRALIZED';
  END IF;

  -- state_transition_log is touched by the recovery state writers. The
  -- remote 6-A.19 inventory is the only accepted contract: exactly these two
  -- enabled application triggers, with the reviewed function definitions and
  -- no SECURITY DEFINER/search_path widening.
  IF (
    SELECT count(*)
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'state_transition_log'
       AND NOT t.tgisinternal
  ) <> 2
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger t
         JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
        WHERE n.nspname = 'public'
          AND c.relname = 'state_transition_log'
          AND NOT t.tgisinternal
          AND NOT (
            (
              t.tgname = 'state_transition_log_enforce_organization_scope'
              AND t.tgenabled = 'O'
              AND p.oid = pg_catalog.to_regprocedure(
                'public.enforce_state_transition_log_organization_scope()'
              )
              AND lower(pg_catalog.pg_get_triggerdef(t.oid)) =
                 'create trigger state_transition_log_enforce_organization_scope before insert or update of conversation_id, organization_id on public.state_transition_log for each row execute function enforce_state_transition_log_organization_scope()'
              AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
                    pg_catalog.pg_get_functiondef(p.oid), 'UTF8')), 'hex') =
                '4a26366622da25ffc5376127d8dae753351b18e7571a0db7a4f78f201aced0bf'
              AND p.prosecdef IS FALSE
              AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
            )
            OR (
              t.tgname = 'state_transition_log_enforce_store_scope'
              AND t.tgenabled = 'O'
              AND p.oid = pg_catalog.to_regprocedure(
                'public.enforce_state_transition_log_store_scope()'
              )
              AND lower(pg_catalog.pg_get_triggerdef(t.oid)) =
                 'create trigger state_transition_log_enforce_store_scope before insert or update of conversation_id, store_id on public.state_transition_log for each row execute function enforce_state_transition_log_store_scope()'
              AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
                    pg_catalog.pg_get_functiondef(p.oid), 'UTF8')), 'hex') =
                'b73f2e633ffc9ac13796c5270299387e08d90786c10947397a548165a59e7c6a'
              AND p.prosecdef IS FALSE
              AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
            )
          )
     )
  THEN
    RAISE EXCEPTION 'ZION_ETAPA6_STATE_TRANSITION_TRIGGER_CONTRACT_UNREVIEWED';
  END IF;

  IF pg_catalog.to_regclass('public.zion_internal_admins') IS NULL
     OR pg_catalog.to_regclass('auth.users') IS NULL
     OR pg_catalog.to_regprocedure(
          'public.finalize_whatsapp_pin_recovery_materialization_by_system(uuid,uuid,uuid,uuid,text,text,text,timestamptz)'
        ) IS NULL
  THEN
    RAISE EXCEPTION 'ZION_ETAPA6_RECOVERY_ACTOR_OR_FINALIZER_DEPENDENCY_MISSING';
  END IF;
  SELECT count(*) INTO v_applied
    FROM supabase_migrations.schema_migrations
   WHERE version::text IN (
     '20261114000000','20261114030000','20261114170000',
     '20261114180000','20261114183000'
   );
  IF v_applied <> 0 THEN
    RAISE EXCEPTION 'ZION_ETAPA6_TARGET_MIGRATIONS_ALREADY_APPLIED_COUNT_%', v_applied;
  END IF;
END;
$zion_preflight$;

-- IDs deterministicos permitem a verificacao pos-ROLLBACK sem GUCs.
-- Qualquer colisao e bloqueio: nunca reutilizar artefato existente.
DO $zion_fixture_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.organizations
     WHERE id IN (
       '00000000-0000-0000-0000-000000006101'::uuid,
       '00000000-0000-0000-0000-000000006103'::uuid,
       '00000000-0000-0000-0000-000000006105'::uuid,
       '00000000-0000-0000-0000-000000006108'::uuid,
       '00000000-0000-0000-0000-00000000610f'::uuid
     )
     OR name LIKE 'ZION synthetic Etapa6 %'
  ) OR EXISTS (
    SELECT 1 FROM auth.users
     WHERE id = '00000000-0000-0000-0000-000000006107'::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.zion_internal_admins
     WHERE user_id = '00000000-0000-0000-0000-000000006107'::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.stores
     WHERE id IN (
       '00000000-0000-0000-0000-000000006102'::uuid,
       '00000000-0000-0000-0000-000000006104'::uuid,
       '00000000-0000-0000-0000-000000006106'::uuid,
       '00000000-0000-0000-0000-000000006109'::uuid
     )
  ) OR EXISTS (
    SELECT 1 FROM public.external_integrations
     WHERE id = '00000000-0000-0000-0000-00000000610a'::uuid
        OR id = '00000000-0000-0000-0000-000000006110'::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.whatsapp_phone_security_secrets
     WHERE id IN (
       '00000000-0000-0000-0000-00000000610d'::uuid,
       '00000000-0000-0000-0000-00000000610e'::uuid
     )
  ) OR EXISTS (
    SELECT 1 FROM public.whatsapp_binding_change_requests
     WHERE id = '00000000-0000-0000-0000-000000006111'::uuid
        OR idempotency_key = 'zion-etapa6-cutover-key'
  ) OR EXISTS (
    SELECT 1 FROM public.whatsapp_pin_recovery_attempts
     WHERE id = '00000000-0000-0000-0000-00000000610b'::uuid
        OR operation_id = '00000000-0000-0000-0000-00000000610c'::uuid
        OR actor_user_id = '00000000-0000-0000-0000-000000006107'::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.whatsapp_pin_recovery_events
     WHERE attempt_id = '00000000-0000-0000-0000-00000000610b'::uuid
        OR operation_id = '00000000-0000-0000-0000-00000000610c'::uuid
        OR actor_user_id = '00000000-0000-0000-0000-000000006107'::uuid
  ) THEN
    RAISE EXCEPTION 'ZION_ETAPA6_SYNTHETIC_ID_COLLISION';
  END IF;
END;
$zion_fixture_preflight$;

DO $zion_schema_preflight$
DECLARE
  v_required record;
  v_bad_required text;
BEGIN
  FOR v_required IN
    SELECT * FROM (VALUES
      ('auth','users','id'),
      ('public','zion_internal_admins','user_id'),
      ('public','zion_internal_admins','role'),
      ('public','zion_internal_admins','is_active'),
      ('public','organizations','id'),
      ('public','organizations','name'),
      ('public','organizations','subscription_status'),
      ('public','stores','id'),
      ('public','stores','organization_id'),
      ('public','external_integrations','id'),
      ('public','external_integrations','organization_id'),
      ('public','external_integrations','store_id'),
      ('public','external_integrations','access_token'),
      ('public','whatsapp_phone_security_secrets','id'),
      ('public','whatsapp_phone_security_secrets','external_integration_id'),
      ('public','whatsapp_pin_recovery_attempts','id'),
      ('public','whatsapp_pin_recovery_attempts','actor_user_id'),
      ('public','whatsapp_pin_recovery_events','attempt_id'),
      ('public','whatsapp_binding_change_requests','id'),
      ('public','whatsapp_binding_change_requests','organization_id'),
      ('public','whatsapp_binding_change_requests','store_id')
    ) AS required(table_schema, table_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
       WHERE c.table_schema = v_required.table_schema
         AND c.table_name = v_required.table_name
         AND c.column_name = v_required.column_name
    ) THEN
      RAISE EXCEPTION 'ZION_ETAPA6_REQUIRED_COLUMN_MISSING: %.%.%',
        v_required.table_schema, v_required.table_name, v_required.column_name;
    END IF;
  END LOOP;

  -- auth.users insertion is safe only when every other NOT NULL column is
  -- supplied by a default. The fixture intentionally supplies only a UUID.
  SELECT string_agg(c.column_name, ', ' ORDER BY c.ordinal_position)
    INTO v_bad_required
    FROM information_schema.columns c
   WHERE c.table_schema = 'auth'
     AND c.table_name = 'users'
     AND c.is_nullable = 'NO'
     AND c.column_default IS NULL
     AND c.column_name <> 'id';
  IF v_bad_required IS NOT NULL THEN
    RAISE EXCEPTION 'ZION_ETAPA6_AUTH_USERS_REQUIRED_DEFAULT_MISSING: %', v_bad_required;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class child ON child.oid = c.conrelid
      JOIN pg_catalog.pg_namespace child_ns ON child_ns.oid = child.relnamespace
      JOIN pg_catalog.pg_class parent ON parent.oid = c.confrelid
      JOIN pg_catalog.pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
     WHERE c.contype = 'f'
       AND child_ns.nspname = 'public'
       AND child.relname = 'zion_internal_admins'
       AND parent_ns.nspname = 'auth'
       AND parent.relname = 'users'
  ) THEN
    RAISE EXCEPTION 'ZION_ETAPA6_ADMIN_AUTH_USERS_FK_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class child ON child.oid = c.conrelid
      JOIN pg_catalog.pg_namespace child_ns ON child_ns.oid = child.relnamespace
     WHERE c.contype = 'f'
       AND child_ns.nspname = 'public'
       AND child.relname IN (
         'stores', 'external_integrations', 'whatsapp_phone_security_secrets',
         'whatsapp_pin_recovery_attempts', 'whatsapp_pin_recovery_events',
         'whatsapp_binding_change_requests'
       )
  ) THEN
    RAISE EXCEPTION 'ZION_ETAPA6_FIXTURE_FOREIGN_KEYS_MISSING';
  END IF;

  -- Include auth.users and the admin table in the external-side-effect guard.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal
       AND t.tgenabled = 'O'
       AND ((n.nspname = 'auth' AND c.relname = 'users')
         OR (n.nspname = 'public' AND c.relname IN (
           'zion_internal_admins', 'organizations', 'stores',
           'external_integrations', 'whatsapp_phone_security_secrets',
           'whatsapp_pin_recovery_attempts', 'whatsapp_pin_recovery_events',
           'state_transition_log',
           'whatsapp_binding_change_requests')))
       AND lower(coalesce(pg_catalog.pg_get_functiondef(p.oid), '') ||
                 coalesce(pg_catalog.pg_get_triggerdef(t.oid), ''))
           ~ '(net[.]http|pg_net|cron[.]|http_post|http_get|pg_notify|notify[[:space:]]|dblink|lo_export)'
  ) THEN
    RAISE EXCEPTION 'ZION_ETAPA6_FIXTURE_TRIGGER_EXTERNAL_EFFECT_NOT_SAFE';
  END IF;
  -- Fail closed for every other enabled application trigger on a table
  -- touched by the fixture. Unknown trigger contracts are unsafe even when
  -- their source text does not contain a known network primitive.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal
       AND t.tgenabled = 'O'
       AND ((n.nspname = 'auth' AND c.relname = 'users')
         OR (n.nspname = 'public' AND c.relname IN (
           'zion_internal_admins', 'organizations', 'stores',
           'external_integrations', 'whatsapp_phone_security_secrets',
           'whatsapp_pin_recovery_attempts', 'whatsapp_pin_recovery_events',
           'state_transition_log',
           'whatsapp_binding_change_requests')))
       AND NOT (
         n.nspname = 'auth'
         AND c.relname = 'users'
         AND t.tgname = 'on_auth_user_created'
         AND p.oid = pg_catalog.to_regprocedure('public.handle_new_user()')
       )
       AND NOT (
         n.nspname = 'public'
         AND c.relname = 'whatsapp_phone_security_secrets'
         AND t.tgname = 'whatsapp_phone_security_secrets_terminal_immutability'
         AND p.oid = pg_catalog.to_regprocedure(
           'public.guard_whatsapp_phone_security_secret_terminal_immutability_by_system()'
         )
       )
       AND NOT (
         n.nspname = 'public'
         AND c.relname = 'whatsapp_pin_recovery_events'
         AND t.tgname = 'whatsapp_pin_recovery_events_immutable'
         AND p.oid = pg_catalog.to_regprocedure(
           'public.prevent_whatsapp_pin_recovery_event_mutation()'
         )
       )
       AND NOT (
         n.nspname = 'public'
         AND c.relname = 'whatsapp_binding_change_requests'
         AND t.tgname IN (
           'whatsapp_binding_change_active_snapshot_trg',
           'whatsapp_binding_change_terminal_immutability_trg'
         )
         AND p.oid IN (
           pg_catalog.to_regprocedure(
             'public.snapshot_whatsapp_binding_change_active_by_system()'
           ),
           pg_catalog.to_regprocedure(
             'public.guard_whatsapp_binding_change_terminal_immutability_by_system()'
           )
         )
       )
        AND NOT (
          n.nspname = 'public'
          AND c.relname = 'state_transition_log'
          AND t.tgname IN (
            'state_transition_log_enforce_organization_scope',
            'state_transition_log_enforce_store_scope'
          )
          AND p.oid IN (
            pg_catalog.to_regprocedure(
              'public.enforce_state_transition_log_organization_scope()'
            ),
            pg_catalog.to_regprocedure(
              'public.enforce_state_transition_log_store_scope()'
            )
          )
        )
   ) THEN
     RAISE EXCEPTION 'ZION_ETAPA6_UNKNOWN_APPLICATION_TRIGGER_CONTRACT';
  END IF;
END;
$zion_schema_preflight$;

-- BEGIN MIGRATION BODY: 20261114000000_p19a_whatsapp_pin_materialization_atomicity.sql

-- Conventional Cloud API first connections must not become operational while
-- their mandatory two-step PIN is still pending. Coexistence intentionally
-- continues to use the original materializer and never calls this function.
create or replace function public.materialize_store_whatsapp_signup_pending_pin_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_whatsapp_business_account_id text,
  p_phone_number_id text,
  p_display_phone_number text,
  p_access_token text,
  p_meta_graph_api_version text default null,
  p_meta_app_id text default null,
  p_validated_at timestamptz default now()
)
returns table (
  integration_id uuid,
  outcome text,
  provider text,
  status text,
  is_active boolean,
  phone_number_id text,
  whatsapp_business_account_id text,
  display_phone_number text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_result record;
  v_integration public.external_integrations%rowtype;
  v_active_secret_id uuid;
begin
  select integration_row.* into v_integration
    from public.external_integrations integration_row
   where integration_row.organization_id = p_organization_id
     and integration_row.store_id = p_store_id
     and integration_row.provider = 'whatsapp'
     and integration_row.phone_number_id = btrim(p_phone_number_id)
   for update;

  if found and v_integration.is_active is true
     and v_integration.metadata ->> 'pin_activation_pending' is distinct from 'true' then
    select secret_row.id into v_active_secret_id
      from public.whatsapp_phone_security_secrets secret_row
     where secret_row.organization_id = p_organization_id
       and secret_row.store_id = p_store_id
       and secret_row.provider = 'whatsapp'
       and secret_row.phone_number_id = btrim(p_phone_number_id)
       and secret_row.external_integration_id = v_integration.id
       and secret_row.status = 'active'
     limit 1;

    if found then
      return query select
        v_integration.id,
        'idempotent_replay'::text,
        v_integration.provider,
        v_integration.status,
        v_integration.is_active,
        v_integration.phone_number_id,
        v_integration.whatsapp_business_account_id,
        v_integration.display_phone_number;
      return;
    end if;
  end if;

  select * into v_result
    from public.materialize_store_whatsapp_embedded_signup_by_system(
      p_organization_id,
      p_store_id,
      p_whatsapp_business_account_id,
      p_phone_number_id,
      p_display_phone_number,
      p_access_token,
      p_meta_graph_api_version,
      p_meta_app_id,
      p_validated_at
    );

  update public.external_integrations as integration_row
     set is_active = false,
         metadata = coalesce(integration_row.metadata, '{}'::jsonb)
           || jsonb_build_object('pin_activation_pending', true),
         updated_at = pg_catalog.clock_timestamp()
   where integration_row.id = v_result.integration_id
     and integration_row.organization_id = p_organization_id
     and integration_row.store_id = p_store_id
     and integration_row.provider = 'whatsapp'
     and integration_row.phone_number_id = btrim(p_phone_number_id)
  returning integration_row.* into v_integration;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'ZION_WHATSAPP_PIN_PENDING_INTEGRATION_SCOPE_MISMATCH';
  end if;

  return query select
    v_integration.id,
    v_result.outcome,
    v_integration.provider,
    v_integration.status,
    v_integration.is_active,
    v_integration.phone_number_id,
    v_integration.whatsapp_business_account_id,
    v_integration.display_phone_number;
end;
$function$;

alter function public.materialize_store_whatsapp_signup_pending_pin_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) owner to postgres;
revoke all on function public.materialize_store_whatsapp_signup_pending_pin_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.materialize_store_whatsapp_signup_pending_pin_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) to service_role;

-- Activation and operational promotion are one database transaction. A failed
-- promotion rolls back both the secret activation and the integration flag.
create or replace function public.activate_whatsapp_phone_security_secret_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_provider text,
  p_phone_number_id text,
  p_external_integration_id uuid
)
returns table(secret_id uuid, status text, outcome text)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_pending public.whatsapp_phone_security_secrets%rowtype;
  v_active public.whatsapp_phone_security_secrets%rowtype;
  v_integration public.external_integrations%rowtype;
  v_phone text := nullif(btrim(coalesce(p_phone_number_id, '')), '');
  v_active_count integer;
  v_was_pending boolean;
begin
  if p_organization_id is null or p_store_id is null or p_provider <> 'whatsapp'
     or v_phone is null or p_external_integration_id is null then
    raise exception using errcode = '22023', message = 'ZION_WHATSAPP_PIN_ACTIVATE_INPUT_INVALID';
  end if;

  perform 1 from public.stores
   where id = p_store_id and organization_id = p_organization_id
   for key share;
  if not found then
    raise exception using errcode = '42501', message = 'ZION_WHATSAPP_PIN_STORE_SCOPE_MISMATCH';
  end if;

  select integration_row.* into v_integration
    from public.external_integrations integration_row
   where integration_row.id = p_external_integration_id
     and integration_row.organization_id = p_organization_id
     and integration_row.store_id = p_store_id
     and integration_row.provider = p_provider
     and integration_row.phone_number_id = v_phone
     and integration_row.status = 'active'
     and (integration_row.is_active is true
       or integration_row.metadata ->> 'pin_activation_pending' = 'true')
   for update;
  if not found then
    raise exception using errcode = '42501', message = 'ZION_WHATSAPP_PIN_INTEGRATION_SCOPE_MISMATCH';
  end if;
  v_was_pending := v_integration.is_active is not true;

  select secret_row.* into v_active
    from public.whatsapp_phone_security_secrets secret_row
   where secret_row.organization_id = p_organization_id
     and secret_row.store_id = p_store_id
     and secret_row.provider = p_provider
     and secret_row.phone_number_id = v_phone
     and secret_row.external_integration_id = p_external_integration_id
     and secret_row.status = 'active'
   for update;
  if found and v_integration.is_active is true then
    secret_id := v_active.id;
    status := 'active';
    outcome := 'idempotent_replay';
    return next;
    return;
  end if;

  select secret_row.* into v_pending
    from public.whatsapp_phone_security_secrets secret_row
   where secret_row.organization_id = p_organization_id
     and secret_row.store_id = p_store_id
     and secret_row.provider = p_provider
     and secret_row.phone_number_id = v_phone
     and secret_row.status = 'pending'
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'ZION_WHATSAPP_PIN_PENDING_NOT_FOUND';
  end if;

  select count(*) into v_active_count
    from public.whatsapp_phone_security_secrets secret_row
   where secret_row.phone_number_id = v_phone and secret_row.status = 'active';
  if v_active_count > 0 then
    select secret_row.* into v_active
      from public.whatsapp_phone_security_secrets secret_row
     where secret_row.phone_number_id = v_phone and secret_row.status = 'active'
     for update;
    if v_active.organization_id is distinct from p_organization_id
       or v_active.store_id is distinct from p_store_id
       or v_active.provider is distinct from p_provider then
      raise exception using errcode = '42501', message = 'ZION_WHATSAPP_PIN_ACTIVE_SCOPE_MISMATCH';
    end if;
    update public.whatsapp_phone_security_secrets
       set status = 'invalidated', invalidated_at = clock_timestamp(), updated_at = clock_timestamp()
     where id = v_active.id;
  end if;

  update public.whatsapp_phone_security_secrets as activated_secret
     set status = 'active', external_integration_id = p_external_integration_id,
         activated_at = clock_timestamp(),
         last_rotated_at = case when v_active.id is null then last_rotated_at else clock_timestamp() end,
         updated_at = clock_timestamp()
   where activated_secret.id = v_pending.id
  returning activated_secret.id, activated_secret.status into secret_id, status;

  if v_was_pending then
    update public.external_integrations
       set is_active = true,
           metadata = metadata - 'pin_activation_pending',
           updated_at = clock_timestamp()
     where id = v_integration.id and is_active is false
       and metadata ->> 'pin_activation_pending' = 'true';
    if not found then
      raise exception using errcode = '55000', message = 'ZION_WHATSAPP_PIN_INTEGRATION_PROMOTION_FAILED';
    end if;
  end if;

  outcome := case when v_active.id is null then 'activated' else 'rotated' end;
  return next;
end;
$function$;

alter function public.activate_whatsapp_phone_security_secret_by_system(
  uuid, uuid, text, text, uuid
) owner to postgres;
revoke all on function public.activate_whatsapp_phone_security_secret_by_system(
  uuid, uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.activate_whatsapp_phone_security_secret_by_system(
  uuid, uuid, text, text, uuid
) to service_role;
-- END MIGRATION BODY: 20261114000000_p19a_whatsapp_pin_materialization_atomicity.sql

-- BEGIN MIGRATION BODY: 20261114030000_p19a_whatsapp_pin_replay_waba_scope.sql
-- The pending-PIN materializer is SECURITY DEFINER.  Its idempotent replay
-- path must establish the WABA identity independently of the HTTP route.
-- Keep this as an append-only correction so it is safe when the preceding
-- migration has already been applied in an environment.
do $migration$
declare
  v_function_oid oid;
  v_definition text;
  v_patched_definition text;
  v_marker text := $marker$
  if found and v_integration.is_active is true
     and v_integration.metadata ->> 'pin_activation_pending' is distinct from 'true' then$marker$;
  v_replacement text := $replacement$
  if found and v_integration.is_active is true
     and v_integration.metadata ->> 'pin_activation_pending' is distinct from 'true' then
    if nullif(pg_catalog.btrim(coalesce(v_integration.whatsapp_business_account_id, '')), '') is null
       or nullif(pg_catalog.btrim(coalesce(p_whatsapp_business_account_id, '')), '') is null
       or pg_catalog.btrim(v_integration.whatsapp_business_account_id)
          is distinct from pg_catalog.btrim(p_whatsapp_business_account_id) then
      raise exception using
        errcode = '42501',
        message = 'ZION_WHATSAPP_PIN_PENDING_WABA_SCOPE_MISMATCH';
    end if;$replacement$;
begin
  select pg_catalog.to_regprocedure(
    'public.materialize_store_whatsapp_signup_pending_pin_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)'
  )
    into v_function_oid;

  if v_function_oid is null then
    raise exception using
      errcode = '42883',
      message = 'ZION_WHATSAPP_PIN_PENDING_MATERIALIZER_NOT_FOUND';
  end if;

  select pg_catalog.pg_get_functiondef(v_function_oid)
    into v_definition;

  if pg_catalog.strpos(v_definition, v_marker) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_WHATSAPP_PIN_PENDING_MATERIALIZER_PATCH_PRECONDITION_FAILED';
  end if;

  v_patched_definition := pg_catalog.replace(v_definition, v_marker, v_replacement);
  execute v_patched_definition;

  select pg_catalog.pg_get_functiondef(v_function_oid)
    into v_definition;

  if pg_catalog.strpos(v_definition, 'ZION_WHATSAPP_PIN_PENDING_WABA_SCOPE_MISMATCH') = 0
     or pg_catalog.strpos(v_definition, 'p_whatsapp_business_account_id') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_WHATSAPP_PIN_PENDING_MATERIALIZER_PATCH_POSTCONDITION_FAILED';
  end if;
end;
$migration$;
-- END MIGRATION BODY: 20261114030000_p19a_whatsapp_pin_replay_waba_scope.sql

-- BEGIN MIGRATION BODY: 20261114170000_p19a_whatsapp_cutover_connection_mode_persistence.sql

-- P19-A 6.1-B
-- Persistir modalidade canonica no cutover autorizado.
-- Nao modificar conexoes existentes retroativamente.
-- Replays concluidos seguem sem nova gravacao.
-- Preservar assinatura, permissões e contratos da funcao.

create or replace function public.cutover_whatsapp_binding_change_request_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_provider text,
  p_request_id uuid,
  p_cutover_idempotency_key text,
  p_expected_active_integration_id uuid,
  p_expected_candidate_whatsapp_business_account_id text,
  p_expected_candidate_phone_number_id text,
  p_expected_candidate_display_phone_number text,
  p_fresh_access_token text,
  p_provenance jsonb default '{}'::jsonb
)
returns table (
  request_id uuid,
  outcome text,
  status text,
  active_integration_id uuid,
  provider text,
  phone_number_id text,
  whatsapp_business_account_id text,
  display_phone_number text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_request public.whatsapp_binding_change_requests%rowtype;
  v_active public.external_integrations%rowtype;
  v_active_id uuid;
  v_initial_status text;
  v_candidate_conflict boolean;
  v_key text := nullif(pg_catalog.btrim(coalesce(p_cutover_idempotency_key, '')), '');
  v_candidate_waba text := nullif(pg_catalog.btrim(coalesce(p_expected_candidate_whatsapp_business_account_id, '')), '');
  v_candidate_phone text := nullif(pg_catalog.btrim(coalesce(p_expected_candidate_phone_number_id, '')), '');
  v_candidate_display text := nullif(pg_catalog.btrim(coalesce(p_expected_candidate_display_phone_number, '')), '');
  v_fresh_access_token text := nullif(pg_catalog.btrim(coalesce(p_fresh_access_token, '')), '');
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_safe_metadata jsonb;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_provider is distinct from 'whatsapp'
     or p_request_id is null
     or p_expected_active_integration_id is null
     or v_key is null
     or v_candidate_waba is null
     or v_candidate_phone is null
     or v_candidate_display is null then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_CUTOVER_INPUT_REQUIRED';
  end if;

  if coalesce(p_provenance, '{}'::jsonb)::text ~*
     '"(access[_-]?token|refresh[_-]?token|token|authorization[_-]?code|authorization|code|bearer|app[_-]?secret|client[_-]?secret|client[_-]?token|api[_-]?key|password|secret)"[[:space:]]*:' then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_PROVENANCE_SECRET_FORBIDDEN';
  end if;

  -- First read is deliberately unlocked. Terminal replays lock only the request;
  -- non-terminal cutover work locks the active integration first and then the
  -- request, keeping one stable order for the two rows touched by cutover.
  select change_row.active_integration_id, change_row.status
    into v_active_id, v_initial_status
    from public.whatsapp_binding_change_requests change_row
   where change_row.id = p_request_id
     and change_row.organization_id = p_organization_id
     and change_row.store_id = p_store_id
     and change_row.provider = p_provider;

  if not found then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_REQUEST_NOT_FOUND';
  end if;

  if v_active_id is distinct from p_expected_active_integration_id then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_EXPECTED_BINDING_MISMATCH';
  end if;

  if v_initial_status in ('completed', 'failed', 'cancelled', 'expired') then
    select change_row.*
      into v_request
      from public.whatsapp_binding_change_requests change_row
     where change_row.id = p_request_id
       and change_row.organization_id = p_organization_id
       and change_row.store_id = p_store_id
       and change_row.provider = p_provider
     for update;

    if not found then
      raise exception using errcode = '23514',
        message = 'ZION_WHATSAPP_CHANGE_REQUEST_NOT_FOUND';
    end if;

    if v_request.status = 'completed' then
      if v_request.cutover_idempotency_key is distinct from v_key
         or v_request.candidate_whatsapp_business_account_id is distinct from v_candidate_waba
         or v_request.candidate_phone_number_id is distinct from v_candidate_phone
         or v_request.candidate_display_phone_number is distinct from v_candidate_display
         or v_request.completed_whatsapp_business_account_id is distinct from v_candidate_waba
         or v_request.completed_phone_number_id is distinct from v_candidate_phone
         or v_request.completed_display_phone_number is distinct from v_candidate_display then
        raise exception using errcode = '23505',
          message = 'ZION_WHATSAPP_CHANGE_CUTOVER_IDEMPOTENCY_CONFLICT';
      end if;

      return query
      select
        v_request.id,
        'idempotent_replay'::text,
        v_request.status,
        v_request.active_integration_id,
        v_request.provider,
        v_request.completed_phone_number_id,
        v_request.completed_whatsapp_business_account_id,
        v_request.completed_display_phone_number;
      return;
    end if;

    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_TERMINAL_REQUEST';
  end if;

  select integration_row.*
    into v_active
    from public.external_integrations integration_row
   where integration_row.id = v_active_id
     and integration_row.organization_id = p_organization_id
     and integration_row.store_id = p_store_id
     and integration_row.provider = p_provider
   for update;

  if not found then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_ACTIVE_BINDING_MISSING';
  end if;

  select change_row.*
    into v_request
    from public.whatsapp_binding_change_requests change_row
   where change_row.id = p_request_id
     and change_row.organization_id = p_organization_id
     and change_row.store_id = p_store_id
     and change_row.provider = p_provider
   for update;

  if not found then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_REQUEST_NOT_FOUND';
  end if;

  if v_request.active_integration_id is distinct from v_active.id
     or v_request.active_integration_id is distinct from p_expected_active_integration_id then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_EXPECTED_BINDING_MISMATCH';
  end if;

  -- The request may have become terminal while we were acquiring the active row.
  if v_request.status = 'completed' then
    if v_request.cutover_idempotency_key is distinct from v_key
       or v_request.candidate_whatsapp_business_account_id is distinct from v_candidate_waba
       or v_request.candidate_phone_number_id is distinct from v_candidate_phone
       or v_request.candidate_display_phone_number is distinct from v_candidate_display
       or v_request.completed_whatsapp_business_account_id is distinct from v_candidate_waba
       or v_request.completed_phone_number_id is distinct from v_candidate_phone
       or v_request.completed_display_phone_number is distinct from v_candidate_display then
      raise exception using errcode = '23505',
        message = 'ZION_WHATSAPP_CHANGE_CUTOVER_IDEMPOTENCY_CONFLICT';
    end if;

    return query
    select
      v_request.id,
      'idempotent_replay'::text,
      v_request.status,
      v_request.active_integration_id,
      v_request.provider,
      v_request.completed_phone_number_id,
      v_request.completed_whatsapp_business_account_id,
      v_request.completed_display_phone_number;
    return;
  end if;

  if v_request.status in ('failed', 'cancelled', 'expired') then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_TERMINAL_REQUEST';
  end if;

  if v_request.status <> 'ready_to_cutover' then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_NOT_READY_TO_CUTOVER';
  end if;

  if v_request.expires_at <= v_now then
    update public.whatsapp_binding_change_requests
       set status = 'expired',
           terminal_at = v_now,
           terminal_provenance = pg_catalog.jsonb_strip_nulls(
             coalesce(p_provenance, '{}'::jsonb)
             || pg_catalog.jsonb_build_object('reason', 'expires_at_reached')
           ),
           updated_at = v_now
     where id = v_request.id;

    return query
    select
      v_request.id,
      'expired'::text,
      'expired'::text,
      v_request.active_integration_id,
      p_provider,
      null::text,
      null::text,
      null::text;
    return;
  end if;

  if v_fresh_access_token is null then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_FRESH_TOKEN_REQUIRED';
  end if;

  if v_request.active_phone_number_id_snapshot is null
     or v_request.active_whatsapp_business_account_id_snapshot is null
     or v_request.active_display_phone_number_snapshot is null
     or v_request.candidate_whatsapp_business_account_id is distinct from v_candidate_waba
     or v_request.candidate_phone_number_id is distinct from v_candidate_phone
     or v_request.candidate_display_phone_number is distinct from v_candidate_display then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_EXPECTED_BINDING_MISMATCH';
  end if;

  if v_active.status <> 'active'
     or v_active.is_active is not true
     or v_active.phone_number_id is distinct from v_request.active_phone_number_id_snapshot
     or v_active.whatsapp_business_account_id is distinct from v_request.active_whatsapp_business_account_id_snapshot
     or v_active.display_phone_number is distinct from v_request.active_display_phone_number_snapshot then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_ACTIVE_BINDING_STALE';
  end if;

  -- The application exchanged and validated the fresh token against the
  -- candidate WABA and phone before this atomic writer was called.

  select exists (
    select 1
      from public.external_integrations integration_row
     where integration_row.provider = p_provider
       and integration_row.phone_number_id = v_candidate_phone
       and integration_row.id <> v_active.id
  )
  into v_candidate_conflict;

  if v_candidate_conflict then
    raise exception using errcode = '23505',
      message = 'ZION_WHATSAPP_CHANGE_CANDIDATE_PHONE_ALREADY_BOUND';
  end if;

  -- A modalidade do candidato precisa ser comprovada no cutover. Nunca
  -- herdar ou apagar silenciosamente a modalidade do vinculo anterior.
  if p_provenance is null
     or not (p_provenance ? 'connection_mode')
     or pg_catalog.jsonb_typeof(p_provenance -> 'connection_mode')
          is distinct from 'string'
     or (p_provenance ->> 'connection_mode')
          not in ('standard', 'business_app_coexistence')
  then
    raise exception using
      errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_CONNECTION_MODE_REQUIRED';
  end if;
v_safe_metadata :=
    coalesce(v_active.metadata, '{}'::jsonb)
    - 'access_token'
    - 'refresh_token'
    - 'token'
    - 'code'
    - 'authorization_code'
    - 'authorization'
    - 'bearer'
    - 'app_secret'
    - 'client_secret'
    - 'client_token'
    - 'api_key'
    - 'password'
    - 'secret'
    - 'connection_mode';

  update public.external_integrations
     set whatsapp_business_account_id = v_candidate_waba,
         phone_number_id = v_candidate_phone,
         access_token = v_fresh_access_token,
         display_phone_number = v_candidate_display,
         status = 'active',
         is_active = true,
         last_error = null,
         metadata = pg_catalog.jsonb_strip_nulls(
           v_safe_metadata
            || case
                 when p_provenance ? 'connection_mode' then
                   pg_catalog.jsonb_build_object(
                     'connection_mode',
                     p_provenance ->> 'connection_mode'
                   )
                 else '{}'::jsonb
               end
            || pg_catalog.jsonb_build_object(
             'binding_change_request_id', v_request.id,
             'binding_change_previous_phone_number_id', v_active.phone_number_id,
             'binding_change_previous_display_phone_number', v_active.display_phone_number,
             'binding_change_cutover_at', v_now,
             'binding_change_provenance', coalesce(p_provenance, '{}'::jsonb)
           )
         ),
         updated_at = v_now
   where id = v_active.id;

  update public.whatsapp_binding_change_requests
     set status = 'completed',
         cutover_idempotency_key = v_key,
         cutover_provenance = pg_catalog.jsonb_strip_nulls(
           coalesce(p_provenance, '{}'::jsonb)
           || pg_catalog.jsonb_build_object(
             'previous_phone_number_id', v_active.phone_number_id,
             'previous_display_phone_number', v_active.display_phone_number,
             'cutover_at', v_now
           )
         ),
         completed_phone_number_id = v_candidate_phone,
         completed_whatsapp_business_account_id = v_candidate_waba,
         completed_display_phone_number = v_candidate_display,
         completed_at = v_now,
         terminal_at = v_now,
         updated_at = v_now
   where id = v_request.id;

  return query
  select
    v_request.id,
    'cutover_completed'::text,
    'completed'::text,
    v_active.id,
    v_active.provider,
    v_candidate_phone,
    v_candidate_waba,
    v_candidate_display;

exception
  when unique_violation then
    if sqlerrm in (
      'ZION_WHATSAPP_CHANGE_CUTOVER_IDEMPOTENCY_CONFLICT',
      'ZION_WHATSAPP_CHANGE_CANDIDATE_PHONE_ALREADY_BOUND'
    ) then
      raise;
    end if;

    raise exception using errcode = '23505',
      message = 'ZION_WHATSAPP_CHANGE_CUTOVER_CONCURRENT_CONFLICT';
end;
$function$;
-- END MIGRATION BODY: 20261114170000_p19a_whatsapp_cutover_connection_mode_persistence.sql

-- BEGIN MIGRATION BODY: 20261114180000_p19a_whatsapp_signup_connection_mode_preservation.sql

-- P19-A 6.1-E
-- Preserva a modalidade canonica existente durante replays e recovery.
-- Nao classifica registros antigos sem connection_mode.
-- Nao altera identificadores, PIN ou modo de ativacao.

create or replace function public.materialize_store_whatsapp_embedded_signup_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_whatsapp_business_account_id text,

  p_phone_number_id text,

  p_display_phone_number text,

  p_access_token text,

  p_meta_graph_api_version text default null,

  p_meta_app_id text default null,

  p_validated_at timestamptz default now()

)

returns table (

  integration_id uuid,

  outcome text,

  provider text,

  status text,

  is_active boolean,

  phone_number_id text,

  whatsapp_business_account_id text,

  display_phone_number text

)

language plpgsql

set search_path = pg_catalog, pg_temp, public

as $function$

declare

  v_provider constant text := 'whatsapp';

  v_waba_id text := nullif(pg_catalog.btrim(coalesce(p_whatsapp_business_account_id, '')), '');

  v_phone_number_id text := nullif(pg_catalog.btrim(coalesce(p_phone_number_id, '')), '');

  v_display_phone_number text := nullif(pg_catalog.btrim(coalesce(p_display_phone_number, '')), '');

  v_access_token text := nullif(pg_catalog.btrim(coalesce(p_access_token, '')), '');

  v_meta_graph_api_version text := nullif(pg_catalog.btrim(coalesce(p_meta_graph_api_version, '')), '');

  v_meta_app_id text := nullif(pg_catalog.btrim(coalesce(p_meta_app_id, '')), '');

  v_validated_at timestamptz := coalesce(p_validated_at, pg_catalog.clock_timestamp());

  v_current public.external_integrations%rowtype;

  v_result public.external_integrations%rowtype;

  v_existing_waba text;

  v_existing_phone text;

  v_existing_display text;

  v_existing_token text;

  v_legacy_metadata boolean;

  v_safe_metadata jsonb;

  v_next_metadata jsonb;

  v_outcome text;

begin

  if p_organization_id is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_ORGANIZATION_REQUIRED';

  end if;



  if p_store_id is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_STORE_REQUIRED';

  end if;



  if v_waba_id is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_WABA_REQUIRED';

  end if;



  if v_phone_number_id is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_PHONE_REQUIRED';

  end if;



  if v_display_phone_number is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_DISPLAY_PHONE_REQUIRED';

  end if;



  if v_access_token is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_ACCESS_TOKEN_REQUIRED';

  end if;



  perform 1

  from public.stores store_row

  where store_row.id = p_store_id

    and store_row.organization_id = p_organization_id

  for key share;



  if not found then

    raise exception using

      errcode = '23514',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_STORE_SCOPE_MISMATCH';

  end if;



  perform 1

  from public.external_integrations integration_row

  where integration_row.provider = v_provider

    and integration_row.phone_number_id = v_phone_number_id

    and (

      integration_row.store_id is distinct from p_store_id

      or integration_row.organization_id is distinct from p_organization_id

    )

  for key share;



  if found then

    raise exception using

      errcode = '23505',

      message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_PHONE_ALREADY_BOUND';

  end if;



  select integration_row.*

  into v_current

  from public.external_integrations integration_row

  where integration_row.store_id = p_store_id

    and integration_row.provider = v_provider

  for update;



  if found then

    if v_current.organization_id is distinct from p_organization_id then

      raise exception using

        errcode = '23514',

        message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_EXISTING_SCOPE_MISMATCH';

    end if;



    v_existing_waba := nullif(pg_catalog.btrim(coalesce(v_current.whatsapp_business_account_id, '')), '');

    v_existing_phone := nullif(pg_catalog.btrim(coalesce(v_current.phone_number_id, '')), '');

    v_existing_display := nullif(pg_catalog.btrim(coalesce(v_current.display_phone_number, '')), '');

    v_existing_token := nullif(pg_catalog.btrim(coalesce(v_current.access_token, '')), '');

    v_legacy_metadata :=

      coalesce(v_current.metadata, '{}'::jsonb) ->> 'activation_mode' = 'manual_assisted_setup'

      or coalesce(v_current.metadata, '{}'::jsonb) ->> 'token_storage' = 'server_env_for_pilot';



    if v_existing_waba is null then

      raise exception using

        errcode = '23514',

        message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_EXISTING_WABA_REQUIRED';

    end if;



    if v_existing_waba <> v_waba_id then

      raise exception using

        errcode = '23514',

        message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_WABA_MISMATCH';

    end if;



    if v_existing_phone is not distinct from v_phone_number_id then

      if v_existing_token is not distinct from v_access_token

         and v_existing_display is not distinct from v_display_phone_number

         and coalesce(v_current.status, '') = 'active'

         and v_current.is_active is true then

        v_outcome := 'idempotent_replay';

      else

        v_outcome := 'reconnected';

      end if;

    elsif v_existing_token is null

       and coalesce(v_current.status, '') = 'active'

       and v_current.is_active is true

       and v_legacy_metadata

       and v_existing_waba = v_waba_id then

      v_outcome := 'legacy_converted';

    else

      raise exception using

        errcode = '23514',

        message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_PHONE_CHANGE_REQUIRES_SAFE_FLOW';

    end if;



    -- Preserve only explicitly approved non-secret audit/business fields.
    -- Do not carry arbitrary legacy metadata forward: nested or differently named
    -- credentials must not survive the migration into Embedded Signup.
    v_safe_metadata :=

      pg_catalog.jsonb_strip_nulls(

        pg_catalog.jsonb_build_object(

          'payment_status', coalesce(v_current.metadata, '{}'::jsonb) -> 'payment_status',

          'channel_purpose', coalesce(v_current.metadata, '{}'::jsonb) -> 'channel_purpose',

          'number_scenario', coalesce(v_current.metadata, '{}'::jsonb) -> 'number_scenario',
          'connection_mode',
            case
              when coalesce(v_current.metadata, '{}'::jsonb) ->> 'connection_mode'
                in ('standard', 'business_app_coexistence')
              then coalesce(v_current.metadata, '{}'::jsonb) -> 'connection_mode'
              else null
            end,

          'converted_from_manual_pilot', coalesce(v_current.metadata, '{}'::jsonb) -> 'converted_from_manual_pilot',

          'previous_phone_number_id', coalesce(v_current.metadata, '{}'::jsonb) -> 'previous_phone_number_id',

          'previous_display_phone_number', coalesce(v_current.metadata, '{}'::jsonb) -> 'previous_display_phone_number'

        )

      );



    v_next_metadata :=

      pg_catalog.jsonb_strip_nulls(

        v_safe_metadata

        || pg_catalog.jsonb_build_object(

          'source', 'meta_whatsapp_embedded_signup',

          'token_storage', 'external_integrations.access_token',

          'activation_mode', 'embedded_signup',

          'embedded_signup_version', 'v4',

          'meta_graph_api_version', v_meta_graph_api_version,

          'meta_app_id', v_meta_app_id,

          'validated_at', v_validated_at

        )

        || case

          when v_outcome = 'legacy_converted' then

            pg_catalog.jsonb_build_object(

              'converted_from_manual_pilot', true,

              'previous_phone_number_id', v_existing_phone,

              'previous_display_phone_number', v_existing_display

            )

          else '{}'::jsonb

        end

      );



    update public.external_integrations

    set whatsapp_business_account_id = v_waba_id,

        phone_number_id = v_phone_number_id,

        display_phone_number = v_display_phone_number,

        access_token = v_access_token,

        status = 'active',

        is_active = true,

        last_error = null,

        metadata = v_next_metadata,

        updated_at = pg_catalog.clock_timestamp()

    where id = v_current.id

    returning *

    into v_result;

  else

    v_outcome := 'inserted';

    v_next_metadata :=

      pg_catalog.jsonb_strip_nulls(

        pg_catalog.jsonb_build_object(

          'source', 'meta_whatsapp_embedded_signup',

          'token_storage', 'external_integrations.access_token',

          'activation_mode', 'embedded_signup',

          'embedded_signup_version', 'v4',

          'meta_graph_api_version', v_meta_graph_api_version,

          'meta_app_id', v_meta_app_id,

          'validated_at', v_validated_at

        )

      );



    begin

      insert into public.external_integrations (

        id,

        organization_id,

        store_id,

        provider,

        status,

        is_active,

        display_phone_number,

        phone_number_id,

        whatsapp_business_account_id,

        access_token,

        last_error,

        metadata,

        updated_at

      )

      values (

        pg_catalog.gen_random_uuid(),

        p_organization_id,

        p_store_id,

        v_provider,

        'active',

        true,

        v_display_phone_number,

        v_phone_number_id,

        v_waba_id,

        v_access_token,

        null,

        v_next_metadata,

        pg_catalog.clock_timestamp()

      )

      returning *

      into v_result;

    exception

      when unique_violation then

        raise exception using

          errcode = '23505',

          message = 'ZION_WHATSAPP_EMBEDDED_SIGNUP_CONCURRENT_CONFLICT';

    end;

  end if;



  return query

  select

    v_result.id,

    v_outcome,

    v_result.provider,

    v_result.status,

    v_result.is_active,

    v_result.phone_number_id,

    v_result.whatsapp_business_account_id,

    v_result.display_phone_number;

end;

$function$;

alter function public.materialize_store_whatsapp_embedded_signup_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) owner to postgres;

revoke all on function public.materialize_store_whatsapp_embedded_signup_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;

-- Recovery must never create a new integration through the legacy materializer.
-- The existing integration and its canonical mode are locked before the legacy
-- writer is called, so valid replays remain idempotent while unclassified
-- bindings fail closed.
create or replace function public.materialize_store_whatsapp_pin_recovery_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_whatsapp_business_account_id text,
  p_phone_number_id text,
  p_display_phone_number text,
  p_access_token text,
  p_meta_graph_api_version text default null,
  p_meta_app_id text default null,
  p_validated_at timestamptz default now()
)
returns table (
  integration_id uuid,
  outcome text,
  provider text,
  status text,
  is_active boolean,
  phone_number_id text,
  whatsapp_business_account_id text,
  display_phone_number text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_current public.external_integrations%rowtype;
  v_mode text;
begin
  select integration_row.*
    into v_current
    from public.external_integrations integration_row
   where integration_row.organization_id = p_organization_id
     and integration_row.store_id = p_store_id
     and integration_row.provider = 'whatsapp'
     and integration_row.phone_number_id = pg_catalog.btrim(p_phone_number_id)
   for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'ZION_WHATSAPP_PIN_RECOVERY_INTEGRATION_REQUIRED';
  end if;

  v_mode := nullif(pg_catalog.btrim(coalesce(v_current.metadata ->> 'connection_mode', '')), '');
  if v_mode is null or v_mode not in ('standard', 'business_app_coexistence') then
    raise exception using
      errcode = '23514',
      message = 'ZION_WHATSAPP_PIN_RECOVERY_CONNECTION_MODE_REQUIRED';
  end if;

  -- A recuperacao da Cloud API convencional nao pode promover uma conexao
  -- enquanto a ativacao atomica do PIN ainda estiver pendente. Reutiliza o
  -- materializador pendente, que preserva is_active=false e a pendencia no
  -- mesmo escopo transacional, sem modificar o fluxo de coexistencia.
  if v_mode = 'standard'
     and v_current.metadata ->> 'pin_activation_pending' = 'true' then
    return query
    select *
      from public.materialize_store_whatsapp_signup_pending_pin_by_system(
        p_organization_id,
        p_store_id,
        p_whatsapp_business_account_id,
        p_phone_number_id,
        p_display_phone_number,
        p_access_token,
        p_meta_graph_api_version,
        p_meta_app_id,
        p_validated_at
      );
    return;
  end if;

  return query
  select *
    from public.materialize_store_whatsapp_embedded_signup_by_system(
      p_organization_id,
      p_store_id,
      p_whatsapp_business_account_id,
      p_phone_number_id,
      p_display_phone_number,
      p_access_token,
      p_meta_graph_api_version,
      p_meta_app_id,
      p_validated_at
    );
end;
$function$;

alter function public.materialize_store_whatsapp_pin_recovery_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) owner to postgres;

revoke all on function public.materialize_store_whatsapp_pin_recovery_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.materialize_store_whatsapp_pin_recovery_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) to service_role;


-- A funcao de finalizacao ja existe no Supabase e foi inspecionada via
-- pg_get_functiondef em 2026-11-16. Nunca sobrescrever uma versao divergente.
-- Fingerprint ignora apenas espacos em branco e usa SHA-256 do corpo completo.
do $zion_recovery_finalizer_source_guard$
declare
  v_oid oid;
  v_actual text;
begin
  v_oid := pg_catalog.to_regprocedure(
    'public.finalize_whatsapp_pin_recovery_materialization_by_system(uuid,uuid,uuid,uuid,text,text,text,timestamptz)'
  );
  if v_oid is null then
    raise exception using errcode='55000',
      message='ZION_PIN_RECOVERY_FINALIZER_SOURCE_NOT_FOUND';
  end if;
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(v_oid), '[[:space:]]+', '', 'g'),
    'UTF8')), 'hex')
  into v_actual;
  if v_actual is distinct from 'b772a7bbe386026ca0ed4d0e7682202c2f21ca3f2cff681471aa1a60f613b161' then
    raise exception using errcode='55000',
      message='ZION_PIN_RECOVERY_FINALIZER_SOURCE_DRIFT';
  end if;
end;
$zion_recovery_finalizer_source_guard$;

-- Redefinicao cirurgica: conserva validacoes de sessao, tentativa, token,
-- WABA e segredo pendente; altera somente a verificacao de integracao ativa.
CREATE OR REPLACE FUNCTION public.finalize_whatsapp_pin_recovery_materialization_by_system(p_attempt_id uuid, p_operation_id uuid, p_actor_user_id uuid, p_integration_id uuid, p_access_token_fingerprint text, p_meta_graph_api_version text, p_meta_app_id text, p_validated_at timestamp with time zone)
 RETURNS TABLE(attempt_id uuid, status text, integration_id uuid, replacement_secret_id uuid, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.whatsapp_pin_recovery_attempts%ROWTYPE;
        e public.external_integrations%ROWTYPE;
        v_activation record;
        v_waba text;
        v_expected_fingerprint text;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
    END IF;
    SELECT * INTO v FROM public.whatsapp_pin_recovery_attempts a
    WHERE a.id=p_attempt_id FOR UPDATE;
    IF NOT FOUND OR v.operation_id IS DISTINCT FROM p_operation_id
       OR v.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_FINALIZATION_SCOPE_INVALID' USING ERRCODE='42501';
    END IF;
    IF v.status='completed' THEN
        IF v.integration_id IS DISTINCT FROM p_integration_id THEN
            RAISE EXCEPTION 'ZION_PIN_RECOVERY_FINALIZATION_REPLAY_CONFLICT' USING ERRCODE='23505';
        END IF;
        RETURN QUERY SELECT v.id,v.status,v.integration_id,v.replacement_secret_id,'idempotent_replay'::text;
        RETURN;
    END IF;
    v_expected_fingerprint := coalesce(v.materialization_token_fingerprint,
                                       v.access_token_fingerprint);
    IF v.status <> 'remote_confirmed' OR v.replacement_secret_id IS NULL
       OR v.remote_evidence_hash IS NULL OR v.remote_http_status IS NULL OR v.remote_http_status NOT BETWEEN 200 AND 299
       OR v_expected_fingerprint IS NULL
       OR v_expected_fingerprint IS DISTINCT FROM p_access_token_fingerprint
       OR p_validated_at IS NULL
       OR p_validated_at > clock_timestamp() + interval '30 seconds'
       OR p_validated_at < clock_timestamp() - interval '10 minutes'
       OR (v.materialization_token_validated_at IS NOT NULL
           AND p_validated_at < v.materialization_token_validated_at) THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_FINALIZATION_NOT_AUTHORIZED' USING ERRCODE='42501';
    END IF;
    SELECT * INTO e FROM public.external_integrations i WHERE i.id=p_integration_id FOR SHARE;
    -- ZION_P19A_RECOVERY_PENDING_STANDARD_FINALIZATION_V1
    -- A integracao standard com PIN pendente pode permanecer inativa ate
    -- a ativacao atomica abaixo. Outros estados inativos falham fechado.
    IF NOT FOUND
       OR e.organization_id IS DISTINCT FROM v.organization_id
       OR e.store_id IS DISTINCT FROM v.store_id
       OR e.provider IS DISTINCT FROM 'whatsapp'
       OR e.status IS DISTINCT FROM 'active'
       OR NOT (
         e.is_active IS TRUE
         OR (
           e.is_active IS FALSE
           AND e.metadata ->> 'connection_mode' IS NOT DISTINCT FROM 'standard'
           AND e.metadata ->> 'pin_activation_pending' IS NOT DISTINCT FROM 'true'
         )
       )
       OR e.phone_number_id IS DISTINCT FROM v.phone_number_id THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_INTEGRATION_NOT_VALID' USING ERRCODE='42501';
    END IF;
    -- Ensure the token actually materialized by the CANONICAL writer is the one
    -- validated for this attempt. SHA-256 exists in PostgreSQL 15+ / Supabase.
    -- This is a fingerprint comparison, never a token returned or persisted here.
    IF e.access_token IS NULL OR pg_catalog.encode(
         pg_catalog.sha256(pg_catalog.convert_to(e.access_token,'UTF8')),'hex'
       ) IS DISTINCT FROM p_access_token_fingerprint THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_MATERIALIZED_TOKEN_MISMATCH' USING ERRCODE='42501';
    END IF;
    v_waba := coalesce(pg_catalog.to_jsonb(e)->>'whatsapp_business_account_id',
                       pg_catalog.to_jsonb(e)->>'waba_id',
                       pg_catalog.to_jsonb(e)->'metadata'->>'waba_id');
    IF v_waba IS DISTINCT FROM v.waba_id THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_WABA_MISMATCH' USING ERRCODE='42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.whatsapp_phone_security_secrets s
                   WHERE s.id=v.replacement_secret_id AND s.organization_id=v.organization_id
                     AND s.store_id=v.store_id AND s.phone_number_id=v.phone_number_id
                     AND s.status='pending') THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_PENDING_SECRET_MISSING' USING ERRCODE='42501';
    END IF;
    SELECT * INTO v_activation FROM public.activate_whatsapp_phone_security_secret_by_system(
        v.organization_id,v.store_id,'whatsapp',v.phone_number_id,p_integration_id
    );
    IF v_activation.secret_id IS DISTINCT FROM v.replacement_secret_id
       OR v_activation.status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_SECRET_ACTIVATION_MISMATCH' USING ERRCODE='42501';
    END IF;
    UPDATE public.whatsapp_pin_recovery_attempts a
       SET status='completed',integration_id=p_integration_id,
           finalized_at=clock_timestamp(),updated_at=clock_timestamp()
     WHERE a.id=v.id;
    INSERT INTO public.whatsapp_pin_recovery_events(attempt_id,operation_id,actor_user_id,event_type)
    VALUES(v.id,v.operation_id,v.actor_user_id,'completed');
    RETURN QUERY SELECT v.id,'completed'::text,p_integration_id,v.replacement_secret_id,'completed'::text;
END;
$function$;

alter function public.finalize_whatsapp_pin_recovery_materialization_by_system(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz
) owner to postgres;
revoke all on function public.finalize_whatsapp_pin_recovery_materialization_by_system(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.finalize_whatsapp_pin_recovery_materialization_by_system(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz
) to service_role;
-- END MIGRATION BODY: 20261114180000_p19a_whatsapp_signup_connection_mode_preservation.sql

-- BEGIN MIGRATION BODY: 20261114183000_p19a_whatsapp_first_connection_mode_writer.sql

-- P19-A 6.1-F
-- RPC especifica da primeira conexao.
-- Preserva a RPC original usada pela recuperacao do PIN.
-- Nao altera integracoes existentes retroativamente.

create or replace function public.materialize_whatsapp_first_connection_mode_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_whatsapp_business_account_id text,
  p_phone_number_id text,
  p_display_phone_number text,
  p_access_token text,
  p_meta_graph_api_version text,
  p_meta_app_id text,
  p_validated_at timestamptz,
  p_connection_mode text
)
returns table (
  integration_id uuid,
  outcome text,
  provider text,
  status text,
  is_active boolean,
  phone_number_id text,
  whatsapp_business_account_id text,
  display_phone_number text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_before public.external_integrations%rowtype;
  v_after public.external_integrations%rowtype;
  v_materialized record;
  v_had_integration boolean;
  v_previous_mode text;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_connection_mode is null
     or p_connection_mode not in (
       'standard',
       'business_app_coexistence'
     ) then
    raise exception using
      errcode = '22023',
      message = 'ZION_WHATSAPP_CONNECTION_MODE_INVALID';
  end if;

  -- Serializa primeiras conexoes concorrentes da mesma loja.
  -- NO KEY UPDATE evita conflito com FK KEY SHARE.
  perform 1
    from public.stores as store_row
   where store_row.id = p_store_id
     and store_row.organization_id = p_organization_id
   for no key update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'ZION_WHATSAPP_CONNECTION_MODE_STORE_SCOPE_MISMATCH';
  end if;

  select integration_row.*
    into v_before
    from public.external_integrations integration_row
   where integration_row.store_id = p_store_id
     and integration_row.provider = 'whatsapp'
   for update;

  v_had_integration := found;

  if v_had_integration then
    if v_before.organization_id is distinct from p_organization_id then
      raise exception using
        errcode = '42501',
        message = 'ZION_WHATSAPP_CONNECTION_MODE_SCOPE_MISMATCH';
    end if;

    v_previous_mode := nullif(
      pg_catalog.btrim(
        coalesce(v_before.metadata ->> 'connection_mode', '')
      ),
      ''
    );

    -- Nao reprocessar vinculos antigos sem modalidade comprovada.
    if v_previous_mode is null then
      raise exception using
        errcode = '23514',
        message = 'ZION_WHATSAPP_CONNECTION_MODE_LEGACY_UNCLASSIFIED';
    end if;
    if v_previous_mode is not null
       and v_previous_mode is distinct from p_connection_mode then
      raise exception using
        errcode = '23514',
        message = 'ZION_WHATSAPP_CONNECTION_MODE_REPLAY_MISMATCH';
    end if;
  end if;

  if p_connection_mode = 'standard' then
    select * into strict v_materialized
      from public.materialize_store_whatsapp_signup_pending_pin_by_system(
        p_organization_id,
        p_store_id,
        p_whatsapp_business_account_id,
        p_phone_number_id,
        p_display_phone_number,
        p_access_token,
        p_meta_graph_api_version,
        p_meta_app_id,
        p_validated_at
      );
  else
    select * into strict v_materialized
      from public.materialize_store_whatsapp_embedded_signup_by_system(
        p_organization_id,
        p_store_id,
        p_whatsapp_business_account_id,
        p_phone_number_id,
        p_display_phone_number,
        p_access_token,
        p_meta_graph_api_version,
        p_meta_app_id,
        p_validated_at
      );
  end if;

  if v_materialized.integration_id is null then
    raise exception using
      errcode = '23514',
      message = 'ZION_WHATSAPP_CONNECTION_MODE_MATERIALIZATION_MISSING';
  end if;

  -- Apenas uma integracao realmente nova recebe a modalidade.
  -- Integracoes anteriores sem classificacao nao sao reclassificadas.
  if not v_had_integration then
    update public.external_integrations as integration_row
       set metadata = coalesce(
             integration_row.metadata, '{}'::jsonb
           ) || pg_catalog.jsonb_build_object(
             'connection_mode', p_connection_mode
           ),
           updated_at = pg_catalog.clock_timestamp()
     where integration_row.id = v_materialized.integration_id
       and integration_row.organization_id = p_organization_id
       and integration_row.store_id = p_store_id
       and integration_row.provider = 'whatsapp'
       and integration_row.phone_number_id =
           pg_catalog.btrim(p_phone_number_id)
       and integration_row.whatsapp_business_account_id =
           pg_catalog.btrim(p_whatsapp_business_account_id)
    returning integration_row.* into v_after;
  else
    select integration_row.*
      into v_after
      from public.external_integrations integration_row
     where integration_row.id = v_materialized.integration_id
       and integration_row.organization_id = p_organization_id
       and integration_row.store_id = p_store_id
       and integration_row.provider = 'whatsapp'
       and integration_row.phone_number_id =
           pg_catalog.btrim(p_phone_number_id)
       and integration_row.whatsapp_business_account_id =
           pg_catalog.btrim(p_whatsapp_business_account_id);
  end if;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'ZION_WHATSAPP_CONNECTION_MODE_WRITER_SCOPE_MISMATCH';
  end if;

  return query select
    v_after.id,
    v_materialized.outcome::text,
    v_after.provider,
    v_after.status,
    v_after.is_active,
    v_after.phone_number_id,
    v_after.whatsapp_business_account_id,
    v_after.display_phone_number;
end;
$function$;

alter function public.materialize_whatsapp_first_connection_mode_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz, text
) owner to postgres;

revoke all on function public.materialize_whatsapp_first_connection_mode_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated;

grant execute on function public.materialize_whatsapp_first_connection_mode_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz, text
) to service_role;
-- END MIGRATION BODY: 20261114183000_p19a_whatsapp_first_connection_mode_writer.sql



-- Validacao comportamental na mesma transacao DDL. Todos os IDs abaixo sao
-- sinteticos; os writers podem tocar somente essas linhas e o ROLLBACK final
-- desfaz as fixtures e seus efeitos transacionais.
DO $zion_behavior$
DECLARE
  v_run_id text := '6a14-p19a-synthetic-20261117';
  v_org_standard uuid := '00000000-0000-0000-0000-000000006101';
  v_store_standard uuid := '00000000-0000-0000-0000-000000006102';
  v_org_coexistence uuid := '00000000-0000-0000-0000-000000006103';
  v_store_coexistence uuid := '00000000-0000-0000-0000-000000006104';
  v_org_cutover uuid := '00000000-0000-0000-0000-000000006105';
  v_store_cutover uuid := '00000000-0000-0000-0000-000000006106';
  v_actor_user_id uuid := '00000000-0000-0000-0000-000000006107';
  v_org_recovery uuid := '00000000-0000-0000-0000-000000006108';
  v_store_recovery uuid := '00000000-0000-0000-0000-000000006109';
  v_recovery_integration_id uuid := '00000000-0000-0000-0000-00000000610a';
  v_recovery_attempt_id uuid := '00000000-0000-0000-0000-00000000610b';
  v_recovery_operation_id uuid := '00000000-0000-0000-0000-00000000610c';
  v_recovery_historical_secret_id uuid := '00000000-0000-0000-0000-00000000610d';
  v_recovery_replacement_secret_id uuid := '00000000-0000-0000-0000-00000000610e';
  v_other_org uuid := '00000000-0000-0000-0000-00000000610f';
  v_standard_phone text := 'zion-etapa6-standard-phone-' || v_run_id;
  v_standard_waba text := 'zion-etapa6-standard-waba-' || v_run_id;
  v_coexistence_phone text := 'zion-etapa6-coexistence-phone-' || v_run_id;
  v_coexistence_waba text := 'zion-etapa6-coexistence-waba-' || v_run_id;
  v_cutover_old_phone text := 'zion-etapa6-cutover-old-phone-' || v_run_id;
  v_cutover_new_phone text := 'zion-etapa6-cutover-new-phone-' || v_run_id;
  v_cutover_waba text := 'zion-etapa6-cutover-waba-' || v_run_id;
  v_recovery_phone text := 'zion-etapa6-recovery-phone-' || v_run_id;
  v_recovery_waba text := 'zion-etapa6-recovery-waba-' || v_run_id;
  v_recovery_token text := 'synthetic-recovery-token-' || v_run_id;
  v_recovery_token_fingerprint text;
  v_recovery_session_hash text := repeat('a', 64);
  v_recovery_remote_hash text := repeat('b', 64);
  v_recovery_validated_at timestamptz := clock_timestamp();
  v_recovery_event_count integer;
  v_recovery_before_count integer;
  v_recovery_after_count integer;
  v_recovery_finalize_ok boolean := false;
  v_recovery_replay_ok boolean := false;
  v_recovery_conflict_ok boolean := false;
  v_standard_id uuid;
  v_replay_id uuid;
  v_coexistence_id uuid;
  v_activation_id uuid;
  v_cutover_active_id uuid := '00000000-0000-0000-0000-000000006110';
  v_cutover_request_id uuid := '00000000-0000-0000-0000-000000006111';
  v_mode text;
  v_active_after_pin boolean;
  v_pending_marker_after_pin text;
  v_active_secret_count integer;
  v_outcome text;
  v_error text;
  v_fn oid;
  r record;
BEGIN
  INSERT INTO public.organizations(id, name, subscription_status) VALUES
    (v_org_standard, 'ZION synthetic Etapa6 standard', 'active'),
    (v_org_coexistence, 'ZION synthetic Etapa6 coexistence', 'active'),
    (v_org_cutover, 'ZION synthetic Etapa6 cutover', 'active'),
    (v_other_org, 'ZION synthetic Etapa6 other tenant', 'active');
  INSERT INTO public.stores(id, organization_id, name) VALUES
    (v_store_standard, v_org_standard, 'ZION synthetic standard store'),
    (v_store_coexistence, v_org_coexistence, 'ZION synthetic coexistence store'),
    (v_store_cutover, v_org_cutover, 'ZION synthetic cutover store');

  -- Recovery-only actor and scope.  This is direct transactional SQL fixture
  -- state, not an Auth Admin API account and not proof of real authentication.
  INSERT INTO auth.users(id) VALUES (v_actor_user_id);
  INSERT INTO public.zion_internal_admins(user_id, role, is_active)
  VALUES (v_actor_user_id, 'admin', true);
  INSERT INTO public.organizations(id, name, subscription_status)
  VALUES (v_org_recovery, 'ZION synthetic Etapa6 recovery', 'active');
  INSERT INTO public.stores(id, organization_id, name)
  VALUES (v_store_recovery, v_org_recovery, 'ZION synthetic recovery store');
  v_recovery_token_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_recovery_token, 'UTF8')), 'hex'
  );
  INSERT INTO public.external_integrations(
    id, organization_id, store_id, provider, status, is_active,
    display_phone_number, phone_number_id, whatsapp_business_account_id,
    access_token, last_error, metadata, updated_at
  ) VALUES (
    v_recovery_integration_id, v_org_recovery, v_store_recovery,
    'whatsapp', 'active', false, '+55 11 90000-6099',
    v_recovery_phone, v_recovery_waba, v_recovery_token, NULL,
    jsonb_build_object(
      'connection_mode', 'standard',
      'pin_activation_pending', 'true',
      'fixture', 'zion_etapa6_recovery'
    ), clock_timestamp()
  );
  INSERT INTO public.whatsapp_phone_security_secrets(
    id, organization_id, store_id, provider, phone_number_id,
    external_integration_id, secret_kind, ciphertext, iv, auth_tag,
    key_version, status, created_at, invalidated_at, updated_at
  ) VALUES (
    v_recovery_historical_secret_id, v_org_recovery, v_store_recovery,
    'whatsapp', v_recovery_phone, NULL, 'two_step_verification_pin',
    'synthetic-historical-ciphertext', 'synthetic-historical-iv',
    'synthetic-historical-auth-tag', 1, 'invalidated',
    clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '1 minute',
    clock_timestamp()
  );
  INSERT INTO public.whatsapp_phone_security_secrets(
    id, organization_id, store_id, provider, phone_number_id,
    external_integration_id, secret_kind, ciphertext, iv, auth_tag,
    key_version, status, created_at, updated_at
  ) VALUES (
    v_recovery_replacement_secret_id, v_org_recovery, v_store_recovery,
    'whatsapp', v_recovery_phone, NULL, 'two_step_verification_pin',
    'synthetic-replacement-ciphertext', 'synthetic-replacement-iv',
    'synthetic-replacement-auth-tag', 1, 'pending', clock_timestamp(),
    clock_timestamp()
  );
  INSERT INTO public.whatsapp_pin_recovery_attempts(
    id, operation_id, organization_id, store_id, provider, waba_id,
    phone_number_id, historical_secret_id, replacement_secret_id,
    actor_user_id, session_binding_hash, purpose, status,
    authorization_expires_at, execution_started_at, remote_result_at,
    remote_http_status, remote_request_id, remote_evidence_hash,
    meta_graph_api_version, meta_app_id, access_token_fingerprint,
    created_at, updated_at
  ) VALUES (
    v_recovery_attempt_id, v_recovery_operation_id, v_org_recovery,
    v_store_recovery, 'whatsapp', v_recovery_waba, v_recovery_phone,
    v_recovery_historical_secret_id, v_recovery_replacement_secret_id,
    v_actor_user_id, v_recovery_session_hash, 'whatsapp_pin_recovery',
    'remote_confirmed', clock_timestamp() + interval '10 minutes',
    clock_timestamp() - interval '30 seconds', v_recovery_validated_at,
    200, 'synthetic-meta-request', v_recovery_remote_hash, 'v23.0',
    'synthetic-app', v_recovery_token_fingerprint, clock_timestamp(),
    clock_timestamp()
  );
  INSERT INTO public.whatsapp_pin_recovery_events(
    attempt_id, operation_id, actor_user_id, event_type, created_at
  ) VALUES
    (v_recovery_attempt_id, v_recovery_operation_id, v_actor_user_id, 'prepared', clock_timestamp()),
    (v_recovery_attempt_id, v_recovery_operation_id, v_actor_user_id, 'authorization_consumed', clock_timestamp()),
    (v_recovery_attempt_id, v_recovery_operation_id, v_actor_user_id, 'replacement_created', clock_timestamp()),
    (v_recovery_attempt_id, v_recovery_operation_id, v_actor_user_id, 'remote_confirmed', clock_timestamp());

  -- The SQL runner may only simulate the JWT claim locally.  It must never
  -- report this as real service_role authentication proof.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  SELECT count(*) INTO v_recovery_before_count
    FROM public.whatsapp_pin_recovery_events
   WHERE attempt_id = v_recovery_attempt_id;
  BEGIN
    SELECT * INTO r FROM public.finalize_whatsapp_pin_recovery_materialization_by_system(
      v_recovery_attempt_id, v_recovery_operation_id, v_actor_user_id,
      v_recovery_integration_id, v_recovery_token_fingerprint, 'v23.0',
      'synthetic-app', v_recovery_validated_at
    );
    SELECT count(*) INTO v_recovery_event_count
      FROM public.whatsapp_pin_recovery_events
     WHERE attempt_id = v_recovery_attempt_id;
    v_recovery_finalize_ok := r.status = 'completed' AND r.outcome = 'completed'
                 AND r.integration_id = v_recovery_integration_id
                 AND r.replacement_secret_id = v_recovery_replacement_secret_id
                 AND EXISTS (
                   SELECT 1 FROM public.whatsapp_pin_recovery_attempts a
                    WHERE a.id = v_recovery_attempt_id
                      AND a.status = 'completed'
                      AND a.integration_id = v_recovery_integration_id
                 )
                 AND EXISTS (
                   SELECT 1 FROM public.external_integrations e
                    WHERE e.id = v_recovery_integration_id
                      AND e.is_active IS TRUE
                      AND e.metadata ->> 'pin_activation_pending' IS NULL
                 )
                 AND EXISTS (
                   SELECT 1 FROM public.whatsapp_phone_security_secrets s
                    WHERE s.id = v_recovery_replacement_secret_id
                      AND s.status = 'active'
                      AND s.external_integration_id = v_recovery_integration_id
                 )
                 AND EXISTS (
                   SELECT 1 FROM public.whatsapp_phone_security_secrets s
                    WHERE s.id = v_recovery_historical_secret_id
                      AND s.status = 'invalidated'
                 )
                 AND v_recovery_event_count = v_recovery_before_count + 1;
  EXCEPTION WHEN OTHERS THEN
    v_recovery_finalize_ok := false;
  END;
  BEGIN
    SELECT * INTO r FROM public.finalize_whatsapp_pin_recovery_materialization_by_system(
      v_recovery_attempt_id, v_recovery_operation_id, v_actor_user_id,
      v_recovery_integration_id, v_recovery_token_fingerprint, 'v23.0',
      'synthetic-app', v_recovery_validated_at
    );
    SELECT count(*) INTO v_recovery_after_count
      FROM public.whatsapp_pin_recovery_events
     WHERE attempt_id = v_recovery_attempt_id;
    v_recovery_replay_ok := r.outcome = 'idempotent_replay'
       AND r.status = 'completed'
       AND v_recovery_after_count = v_recovery_event_count;
    IF NOT v_recovery_replay_ok THEN
      RAISE EXCEPTION 'ZION_ETAPA6_RECOVERY_REPLAY_ASSERTION_FAILED';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_recovery_replay_ok := false;
  END;
  BEGIN
    PERFORM * FROM public.finalize_whatsapp_pin_recovery_materialization_by_system(
      v_recovery_attempt_id, v_recovery_operation_id, v_actor_user_id,
      pg_catalog.gen_random_uuid(), v_recovery_token_fingerprint, 'v23.0',
      'synthetic-app', v_recovery_validated_at
    );
    v_recovery_conflict_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_recovery_conflict_ok := sqlerrm LIKE '%ZION_PIN_RECOVERY_FINALIZATION_REPLAY_CONFLICT%';
  END;
  PERFORM pg_temp.zion_etapa6_record(
    'recovery.finalize_sql_synthetic',
    'finalizacao SQL sintetica, ativacao e replays',
    CASE WHEN v_recovery_finalize_ok AND v_recovery_replay_ok
                AND v_recovery_conflict_ok THEN 'PASS' ELSE 'SUT_FAIL' END,
    format('finalize=%s replay=%s conflict=%s auth_real=NOT_PROVEN',
      v_recovery_finalize_ok, v_recovery_replay_ok, v_recovery_conflict_ok)
  );

  -- Standard: pending PIN, modalidade canonica e replay no mesmo binding.
  BEGIN
    SELECT * INTO r FROM public.materialize_whatsapp_first_connection_mode_by_system(
      v_org_standard, v_store_standard, v_standard_waba,
      v_standard_phone, '+55 11 90000-6001', 'synthetic-token-standard',
      'v23.0', 'synthetic-app', clock_timestamp(), 'standard');
    v_standard_id := r.integration_id;
    SELECT metadata ->> 'connection_mode' INTO v_mode
      FROM public.external_integrations WHERE id = v_standard_id;
    PERFORM pg_temp.zion_etapa6_record(
      'standard.first', 'standard cria integracao',
      CASE WHEN v_mode = 'standard' AND r.is_active IS FALSE
                    AND EXISTS (SELECT 1 FROM public.external_integrations e
                                  WHERE e.id = v_standard_id
                                    AND e.metadata ->> 'pin_activation_pending' = 'true')
           THEN 'PASS' ELSE 'SUT_FAIL' END,
      row_to_json(r)::text);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record('standard.first', 'standard cria integracao', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  END;

  BEGIN
    SELECT * INTO r FROM public.materialize_whatsapp_first_connection_mode_by_system(
      v_org_standard, v_store_standard, v_standard_waba,
      v_standard_phone, '+55 11 90000-6001', 'synthetic-token-standard',
      'v23.0', 'synthetic-app', clock_timestamp(), 'standard');
    v_replay_id := r.integration_id;
    PERFORM pg_temp.zion_etapa6_record(
      'standard.replay', 'standard replay preserva binding',
      CASE WHEN v_replay_id = v_standard_id THEN 'PASS' ELSE 'SUT_FAIL' END,
      row_to_json(r)::text);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record('standard.replay', 'standard replay preserva binding', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  END;

  BEGIN
    PERFORM * FROM public.materialize_whatsapp_first_connection_mode_by_system(
      v_org_standard, v_store_standard, v_standard_waba,
      v_standard_phone, '+55 11 90000-6001', 'synthetic-token-standard',
      'v23.0', 'synthetic-app', clock_timestamp(), 'business_app_coexistence');
    PERFORM pg_temp.zion_etapa6_record('standard.mismatch', 'modalidade divergente falha fechado', 'SUT_FAIL', 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
    PERFORM pg_temp.zion_etapa6_record('standard.mismatch', 'modalidade divergente falha fechado',
      CASE WHEN v_error LIKE '%ZION_WHATSAPP_CONNECTION_MODE_REPLAY_MISMATCH%' THEN 'PASS' ELSE 'SUT_FAIL' END,
      sqlstate || ' ' || v_error);
  END;

  -- Coexistence: writer embedded permanece ativo e replay nao reclassifica.
  BEGIN
    SELECT * INTO r FROM public.materialize_whatsapp_first_connection_mode_by_system(
      v_org_coexistence, v_store_coexistence, v_coexistence_waba,
      v_coexistence_phone, '+55 11 90000-6002', 'synthetic-token-coexistence',
      'v23.0', 'synthetic-app', clock_timestamp(), 'business_app_coexistence');
    v_coexistence_id := r.integration_id;
    SELECT metadata ->> 'connection_mode' INTO v_mode
      FROM public.external_integrations WHERE id = v_coexistence_id;
    PERFORM pg_temp.zion_etapa6_record(
      'coexistence.first', 'coexistence cria integracao ativa',
      CASE WHEN v_mode = 'business_app_coexistence' AND r.is_active IS TRUE
                    AND NOT EXISTS (SELECT 1 FROM public.external_integrations e
                                     WHERE e.id = v_coexistence_id
                                       AND e.metadata ->> 'pin_activation_pending' = 'true')
           THEN 'PASS' ELSE 'SUT_FAIL' END,
      row_to_json(r)::text);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record('coexistence.first', 'coexistence cria integracao ativa', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  END;

  BEGIN
    SELECT * INTO r FROM public.materialize_whatsapp_first_connection_mode_by_system(
      v_org_coexistence, v_store_coexistence, v_coexistence_waba,
      v_coexistence_phone, '+55 11 90000-6002', 'synthetic-token-coexistence',
      'v23.0', 'synthetic-app', clock_timestamp(), 'business_app_coexistence');
    PERFORM pg_temp.zion_etapa6_record('coexistence.replay', 'coexistence replay idempotente',
      CASE WHEN r.integration_id = v_coexistence_id THEN 'PASS' ELSE 'SUT_FAIL' END,
      row_to_json(r)::text);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record('coexistence.replay', 'coexistence replay idempotente', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  END;

  -- Recovery exige modalidade e preserva a existente.
  BEGIN
    SELECT * INTO r FROM public.materialize_store_whatsapp_pin_recovery_by_system(
      v_org_standard, v_store_standard, v_standard_waba,
      v_standard_phone, '+55 11 90000-6001', 'synthetic-token-standard',
      'v23.0', 'synthetic-app', clock_timestamp());
    SELECT metadata ->> 'connection_mode',
           is_active,
           metadata ->> 'pin_activation_pending'
      INTO v_mode, v_active_after_pin, v_pending_marker_after_pin
      FROM public.external_integrations WHERE id = r.integration_id;
    -- Enquanto o PIN estiver pendente, recovery NAO pode ativar o canal.
    -- Gerar uma excecao neste subbloco reverte a escrita indevida de recovery.
    IF r.integration_id IS DISTINCT FROM v_standard_id
       OR v_mode IS DISTINCT FROM 'standard'
       OR v_active_after_pin IS DISTINCT FROM false
       OR v_pending_marker_after_pin IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = format('ZION_ETAPA6_RECOVERY_PREMATURE_ACTIVATION: same_id=%s mode=%s active=%s pending=%s',
          r.integration_id IS NOT DISTINCT FROM v_standard_id,
          coalesce(v_mode, '<null>'),
          coalesce(v_active_after_pin::text, '<null>'),
          coalesce(v_pending_marker_after_pin, '<null>'));
    END IF;
    PERFORM pg_temp.zion_etapa6_record('recovery.mode', 'recovery preserva standard e PIN pendente',
      'PASS', 'same_id=true mode=standard active=false pin_activation_pending=true');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record('recovery.mode', 'recovery preserva standard e PIN pendente',
      CASE WHEN sqlerrm LIKE 'ZION_ETAPA6_RECOVERY_PREMATURE_ACTIVATION:%'
           THEN 'SUT_FAIL' ELSE 'HARNESS_ERROR' END,
      sqlstate || ' ' || sqlerrm);
  END;

  -- PIN activation: utiliza a integracao standard criada com pending PIN.
  -- Valida segredo ativo, promocao da integracao e remocao do marcador.
  BEGIN
    v_activation_id := v_standard_id;
    PERFORM * FROM public.create_whatsapp_phone_security_secret_pending_by_system(
      v_org_standard, v_store_standard, 'whatsapp', v_standard_phone,
      'synthetic-ciphertext', 'synthetic-iv', 'synthetic-auth-tag', 1
    );
    SELECT * INTO r FROM public.activate_whatsapp_phone_security_secret_by_system(
      v_org_standard, v_store_standard, 'whatsapp',
      v_standard_phone, v_activation_id
    );
    SELECT integration_row.is_active,
           integration_row.metadata ->> 'pin_activation_pending'
      INTO v_active_after_pin, v_pending_marker_after_pin
      FROM public.external_integrations integration_row
     WHERE integration_row.id = v_activation_id
       AND integration_row.organization_id = v_org_standard
       AND integration_row.store_id = v_store_standard;
    SELECT count(*) INTO v_active_secret_count
      FROM public.whatsapp_phone_security_secrets secret_row
     WHERE secret_row.organization_id = v_org_standard
       AND secret_row.store_id = v_store_standard
       AND secret_row.provider = 'whatsapp'
       AND secret_row.phone_number_id = v_standard_phone
       AND secret_row.external_integration_id = v_activation_id
       AND secret_row.status = 'active';
    PERFORM pg_temp.zion_etapa6_record('pin.activation', 'PIN promove pending para ativo',
      CASE WHEN r.status = 'active' AND r.outcome = 'activated'
                 AND v_active_after_pin IS TRUE AND v_pending_marker_after_pin IS NULL
                 AND v_active_secret_count = 1
           THEN 'PASS' ELSE 'SUT_FAIL' END,
      format('status=%s outcome=%s integration_active=%s secret_count=%s',
             r.status, r.outcome, v_active_after_pin, v_active_secret_count));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record('pin.activation', 'PIN promove pending para ativo', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  END;

  -- Cutover: fixture de binding, happy path, replay e isolamento tenant.
  v_cutover_active_id := '00000000-0000-0000-0000-000000006110'::uuid;
  v_cutover_request_id := '00000000-0000-0000-0000-000000006111'::uuid;
  INSERT INTO public.external_integrations(
    id, organization_id, store_id, provider, status, is_active,
    display_phone_number, phone_number_id, whatsapp_business_account_id,
    access_token, last_error, metadata, updated_at
  ) VALUES (
    v_cutover_active_id, v_org_cutover, v_store_cutover, 'whatsapp', 'active', true,
    '+55 11 90000-6003', v_cutover_old_phone, v_cutover_waba,
    'synthetic-cutover-token', NULL, '{}'::jsonb, clock_timestamp()
  );
  INSERT INTO public.whatsapp_binding_change_requests(
    id, organization_id, store_id, provider, source, idempotency_key, status,
    active_integration_id, candidate_whatsapp_business_account_id,
    candidate_phone_number_id, candidate_display_phone_number, candidate_provenance,
    active_phone_number_id_snapshot, active_whatsapp_business_account_id_snapshot,
    active_display_phone_number_snapshot,
    candidate_received_at, expires_at, created_at, updated_at
  ) VALUES (
    v_cutover_request_id, v_org_cutover, v_store_cutover, 'whatsapp',
    'zion_etapa6_runner', 'zion-etapa6-cutover-key', 'ready_to_cutover',
    v_cutover_active_id, v_cutover_waba, v_cutover_new_phone,
    '+55 11 90000-6004', '{"source":"synthetic","connection_mode":"standard"}'::jsonb,
    v_cutover_old_phone, v_cutover_waba, '+55 11 90000-6003',
    clock_timestamp(), clock_timestamp() + interval '1 hour', clock_timestamp(), clock_timestamp()
  );
  BEGIN
    SELECT * INTO r FROM public.cutover_whatsapp_binding_change_request_by_system(
      v_org_cutover, v_store_cutover, 'whatsapp', v_cutover_request_id,
      'zion-etapa6-cutover-key', v_cutover_active_id, v_cutover_waba,
      v_cutover_new_phone, '+55 11 90000-6004',
      'synthetic-fresh-token', '{"source":"synthetic","connection_mode":"standard"}'::jsonb
    );
    PERFORM pg_temp.zion_etapa6_record('cutover.first', 'cutover sintetico conclui',
      CASE WHEN r.outcome = 'cutover_completed' AND r.status = 'completed'
                    AND EXISTS (SELECT 1 FROM public.external_integrations e
                                 WHERE e.id = v_cutover_active_id
                                   AND e.phone_number_id = v_cutover_new_phone
                                   AND e.whatsapp_business_account_id = v_cutover_waba
                                   AND e.metadata ->> 'connection_mode' = 'standard')
           THEN 'PASS' ELSE 'SUT_FAIL' END,
      row_to_json(r)::text);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record('cutover.first', 'cutover sintetico conclui', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  END;
  BEGIN
    SELECT * INTO r FROM public.cutover_whatsapp_binding_change_request_by_system(
      v_org_cutover, v_store_cutover, 'whatsapp', v_cutover_request_id,
      'zion-etapa6-cutover-key', v_cutover_active_id, v_cutover_waba,
      v_cutover_new_phone, '+55 11 90000-6004',
      NULL, '{"source":"synthetic","connection_mode":"standard"}'::jsonb
    );
    PERFORM pg_temp.zion_etapa6_record('cutover.replay', 'cutover replay preserva resultado',
      CASE WHEN r.outcome = 'idempotent_replay' AND r.status = 'completed' THEN 'PASS' ELSE 'SUT_FAIL' END,
      row_to_json(r)::text);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record('cutover.replay', 'cutover replay preserva resultado', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  END;
  BEGIN
    PERFORM * FROM public.cutover_whatsapp_binding_change_request_by_system(
      v_other_org, v_store_cutover, 'whatsapp', v_cutover_request_id,
      'zion-etapa6-cross-key', v_cutover_active_id, v_cutover_waba,
      v_cutover_new_phone, '+55 11 90000-6004', NULL,
      '{"source":"synthetic","connection_mode":"standard"}'::jsonb
    );
    PERFORM pg_temp.zion_etapa6_record('tenant.cutover', 'cross-tenant cutover falha fechado', 'SUT_FAIL', 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record('tenant.cutover', 'cross-tenant cutover falha fechado',
      CASE WHEN sqlerrm = 'ZION_WHATSAPP_CHANGE_REQUEST_NOT_FOUND' AND sqlstate = '23514'
           THEN 'PASS' ELSE 'SUT_FAIL' END,
      sqlstate || ' ' || sqlerrm);
  END;

  -- Isolamento na PRIMEIRA conexao: organizacao errada para loja existente.
  BEGIN
    PERFORM * FROM public.materialize_whatsapp_first_connection_mode_by_system(
      v_other_org, v_store_standard, v_standard_waba, v_standard_phone,
      '+55 11 90000-6001', 'synthetic-token-cross-tenant',
      'v23.0', 'synthetic-app', clock_timestamp(), 'standard');
    PERFORM pg_temp.zion_etapa6_record(
      'tenant.first', 'cross-tenant primeira conexao bloqueada',
      'SUT_FAIL', 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record(
      'tenant.first', 'cross-tenant primeira conexao bloqueada',
      CASE WHEN sqlstate = '42501' AND
                     sqlerrm = 'ZION_WHATSAPP_CONNECTION_MODE_STORE_SCOPE_MISMATCH'
           THEN 'PASS' ELSE 'SUT_FAIL' END,
      sqlstate || ' ' || sqlerrm);
  END;

  -- Permissoes efetivas das autoridades novas/alteradas.
  FOR v_fn IN SELECT unnest(ARRAY[
    to_regprocedure('public.materialize_store_whatsapp_signup_pending_pin_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)'),
    to_regprocedure('public.activate_whatsapp_phone_security_secret_by_system(uuid,uuid,text,text,uuid)'),
    to_regprocedure('public.materialize_store_whatsapp_pin_recovery_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)'),
    to_regprocedure('public.materialize_whatsapp_first_connection_mode_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz,text)')
  ]) LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn)
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      PERFORM pg_temp.zion_etapa6_record('permissions', 'grants e SECURITY DEFINER', 'SUT_FAIL', v_fn::text);
      RETURN;
    END IF;
  END LOOP;
  PERFORM pg_temp.zion_etapa6_record('permissions', 'grants e SECURITY DEFINER', 'PASS');
  PERFORM pg_temp.zion_etapa6_record(
    'recovery.finalize_runtime', 'finalizacao recovery com segredo pendente e evidencia Meta', 'PENDING',
    'Autenticacao service_role real nao e provada por claim SQL simulado; caller real e conexao separada permanecem fora do rollback.'
  );
  PERFORM pg_temp.zion_etapa6_record(
    'concurrency.multi_session', 'concorrencia real entre duas sessoes', 'PENDING',
    'Nao simulada; exige duas conexoes controladas fora de uma unica consulta.'
  );
END;
$zion_behavior$;

-- Validacao em transacao: prova DDL, ACLs, comportamento e marcadores.
DO $zion_asserts$
DECLARE
  r record;
  v_fn oid;
  v_body text;
  v_failures text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('materialize_store_whatsapp_signup_pending_pin_by_system',
       'public.materialize_store_whatsapp_signup_pending_pin_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)', true, true),
      ('activate_whatsapp_phone_security_secret_by_system',
       'public.activate_whatsapp_phone_security_secret_by_system(uuid,uuid,text,text,uuid)', true, true),
      ('cutover_whatsapp_binding_change_request_by_system',
       'public.cutover_whatsapp_binding_change_request_by_system(uuid,uuid,text,uuid,text,uuid,text,text,text,text,jsonb)', true, true),
      ('materialize_store_whatsapp_embedded_signup_by_system',
       'public.materialize_store_whatsapp_embedded_signup_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)', false, false),
      ('materialize_store_whatsapp_pin_recovery_by_system',
       'public.materialize_store_whatsapp_pin_recovery_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)', true, true),
      ('finalize_whatsapp_pin_recovery_materialization_by_system',
       'public.finalize_whatsapp_pin_recovery_materialization_by_system(uuid,uuid,uuid,uuid,text,text,text,timestamptz)', true, true),
      ('materialize_whatsapp_first_connection_mode_by_system',
       'public.materialize_whatsapp_first_connection_mode_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz,text)', true, true)
    ) AS fn(name, signature, expected_definer, expected_service_execute)
  LOOP
    v_fn := to_regprocedure(r.signature);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'ZION_ETAPA6_EXPECTED_FUNCTION_MISSING: %', r.name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid = v_fn AND p.prosecdef = r.expected_definer
         AND p.proowner = to_regrole('postgres')
         AND EXISTS (
           SELECT 1 FROM unnest(p.proconfig) AS cfg(line)
            WHERE (
             (r.name = 'finalize_whatsapp_pin_recovery_materialization_by_system'
              AND cfg.line IN ('search_path=', 'search_path=""'))
             OR (r.name <> 'finalize_whatsapp_pin_recovery_materialization_by_system'
                 AND cfg.line LIKE 'search_path=pg_catalog,%')
           )
         )
    ) THEN
      RAISE EXCEPTION 'ZION_ETAPA6_FUNCTION_SECURITY_MISMATCH: %', r.name;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('service_role', v_fn, 'EXECUTE') IS DISTINCT FROM r.expected_service_execute THEN
      RAISE EXCEPTION 'ZION_ETAPA6_FUNCTION_EFFECTIVE_ACL_MISMATCH: %', r.name;
    END IF;
  END LOOP;

  v_fn := to_regprocedure(
    'public.materialize_store_whatsapp_signup_pending_pin_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)');
  v_body := pg_get_functiondef(v_fn);
  IF strpos(v_body, 'ZION_WHATSAPP_PIN_PENDING_WABA_SCOPE_MISMATCH') = 0 THEN
    RAISE EXCEPTION 'ZION_ETAPA6_WABA_REPLAY_PATCH_MISSING';
  END IF;

  v_fn := to_regprocedure(
    'public.cutover_whatsapp_binding_change_request_by_system(uuid,uuid,text,uuid,text,uuid,text,text,text,text,jsonb)');
  v_body := pg_get_functiondef(v_fn);
  IF strpos(v_body, 'ZION_WHATSAPP_CHANGE_CONNECTION_MODE_REQUIRED') = 0
     OR strpos(v_body, 'not (p_provenance ? ''connection_mode'')') = 0 THEN
    RAISE EXCEPTION 'ZION_ETAPA6_CUTOVER_MODE_GATE_MISSING';
  END IF;

  v_fn := to_regprocedure(
    'public.materialize_store_whatsapp_pin_recovery_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)');
  v_body := pg_get_functiondef(v_fn);
  IF strpos(v_body, 'ZION_WHATSAPP_PIN_RECOVERY_CONNECTION_MODE_REQUIRED') = 0 THEN
    RAISE EXCEPTION 'ZION_ETAPA6_RECOVERY_MODE_GATE_MISSING';
  END IF;

  v_fn := to_regprocedure(
    'public.materialize_whatsapp_first_connection_mode_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz,text)');
  v_body := pg_get_functiondef(v_fn);
  IF strpos(v_body, 'ZION_WHATSAPP_CONNECTION_MODE_REPLAY_MISMATCH') = 0 THEN
    RAISE EXCEPTION 'ZION_ETAPA6_FIRST_MODE_REPLAY_GATE_MISSING';
  END IF;

  -- P1: em PL/pgSQL, IF NULL nao entra no THEN. Verificar os guards
  -- de NULL explicitamente, alem das mensagens de erro.
  v_fn := to_regprocedure(
    'public.cutover_whatsapp_binding_change_request_by_system(uuid,uuid,text,uuid,text,uuid,text,text,text,text,jsonb)');
  v_body := pg_get_functiondef(v_fn);
  IF strpos(v_body, 'p_provenance is null') = 0 THEN
    RAISE EXCEPTION 'ZION_ETAPA6_CUTOVER_NULL_GUARD_MISSING';
  END IF;

  v_fn := to_regprocedure(
    'public.materialize_store_whatsapp_pin_recovery_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)');
  v_body := pg_get_functiondef(v_fn);
  IF strpos(v_body, 'v_mode is null or v_mode not in') = 0 THEN
    RAISE EXCEPTION 'ZION_ETAPA6_RECOVERY_NULL_GUARD_MISSING';
  END IF;

  -- A nova regra deve estar instalada na funcao REAL, nao apenas em
  -- comentarios do arquivo. O writer nao pode concluir recovery antecipado.
  v_fn := to_regprocedure(
    'public.finalize_whatsapp_pin_recovery_materialization_by_system(uuid,uuid,uuid,uuid,text,text,text,timestamptz)');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'ZION_ETAPA6_FINALIZER_MISSING';
  END IF;
  v_body := pg_catalog.pg_get_functiondef(v_fn);
  IF strpos(v_body, 'ZION_P19A_RECOVERY_PENDING_STANDARD_FINALIZATION_V1') = 0
     OR strpos(v_body, 'e.is_active IS FALSE') = 0
     OR strpos(v_body, '''pin_activation_pending'' IS NOT DISTINCT FROM ''true''') = 0
     OR strpos(v_body, 'activate_whatsapp_phone_security_secret_by_system') = 0 THEN
    RAISE EXCEPTION 'ZION_ETAPA6_FINALIZER_PIN_GATE_MISSING';
  END IF;

  -- Sem falso positivo: conferir os 12 cenarios anteriores, a nova prova
  -- SQL sintetica PASS e as duas pendencias explicitas, ANTES de ROLLBACK.
  -- A tabela ficara vazia/desaparecera apos o ROLLBACK; jamais conte
  -- cenarios na consulta final.
  IF (SELECT count(*) FROM pg_temp.zion_etapa6_behavior_results) <> 15
     OR (SELECT count(*) FROM pg_temp.zion_etapa6_behavior_results
          WHERE status = 'PASS') <> 13
     OR (SELECT count(*) FROM pg_temp.zion_etapa6_behavior_results
          WHERE scenario IN ('concurrency.multi_session', 'recovery.finalize_runtime') AND status = 'PENDING') <> 2
     OR EXISTS (
       SELECT 1 FROM pg_temp.zion_etapa6_behavior_results
       WHERE status IN ('SUT_FAIL', 'HARNESS_ERROR')
     )
     OR EXISTS (
       SELECT 1 FROM (VALUES
         ('standard.first'), ('standard.replay'), ('standard.mismatch'),
         ('coexistence.first'), ('coexistence.replay'), ('recovery.mode'),
         ('pin.activation'), ('cutover.first'), ('cutover.replay'),
         ('tenant.cutover'), ('tenant.first'), ('permissions'),
         ('recovery.finalize_sql_synthetic')
       ) AS expected(scenario)
       LEFT JOIN pg_temp.zion_etapa6_behavior_results actual
         ON actual.scenario = expected.scenario
       WHERE actual.status IS DISTINCT FROM 'PASS'
     )
  THEN
    SELECT string_agg(
        format('%s=%s (%s)', scenario, status,
               left(coalesce(detail, ''), 220)),
        '; ' ORDER BY scenario
      ) INTO v_failures
      FROM pg_temp.zion_etapa6_behavior_results
     WHERE status IN ('SUT_FAIL', 'HARNESS_ERROR')
        OR (scenario IN ('concurrency.multi_session', 'recovery.finalize_runtime') AND status <> 'PENDING');
    RAISE EXCEPTION 'ZION_ETAPA6_BEHAVIORAL_ASSERTIONS_FAILED: %',
      coalesce(v_failures, 'missing/duplicate/unexpected scenario or status');
  END IF;

  -- O lock de sessao sobrevive ao ROLLBACK e serve SOMENTE como prova efemera
  -- de que TODAS as assercoes chegaram ate aqui nesta mesma conexao.
  -- Nao e um lock de tabela, nao altera registros e sera liberado na ultima SELECT.
  PERFORM pg_catalog.pg_advisory_lock(
    pg_catalog.hashtext('ZION_P19A_ETAPA6_DDL_PROOF_V1_20261116'),
    pg_catalog.pg_backend_pid()
  );
  -- Do not persist lookup IDs in GUCs: SET/SET LOCAL made inside an aborted
  -- transaction can be reverted. The post-rollback query uses only the fixed
  -- synthetic constants declared in this runner and therefore cannot turn a
  -- missing ID into a PASS through a NULL cast or lost setting.
  RAISE NOTICE 'ZION_ETAPA6_DDL_PASS (inside transaction; rollback follows)';
END;
$zion_asserts$;

ROLLBACK;

-- A transacao foi desfeita. A unica prova de sucesso e o lock de sessao,
-- obtido SOMENTE se os 12 cenarios anteriores e a prova SQL sintetica
-- tiveram PASS, enquanto autenticacao service_role real e concorrencia
-- ficaram PENDING e a estrutura passou.
-- Nenhuma tabela temporaria e consultada apos o ROLLBACK. Every synthetic
-- identifier is deterministic and every known fixture table is checked.
WITH manifest_proof AS MATERIALIZED (
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_locks l
     WHERE l.locktype = 'advisory'
       AND l.pid = pg_catalog.pg_backend_pid()
       AND l.classid = pg_catalog.hashtext('ZION_P19A_ETAPA6_SOURCE_MANIFEST_GATE_V1_20261117')::oid
       AND l.objid = pg_catalog.pg_backend_pid()::oid
       AND l.objsubid = 2
  ) AS source_manifest_gate_held
), proof AS MATERIALIZED (
  SELECT manifest_proof.source_manifest_gate_held,
  pg_catalog.pg_advisory_unlock(
    pg_catalog.hashtext('ZION_P19A_ETAPA6_DDL_PROOF_V1_20261116'),
    pg_catalog.pg_backend_pid()
  ) AS all_checks_completed,
  pg_catalog.pg_advisory_unlock(
    pg_catalog.hashtext('ZION_P19A_ETAPA6_SOURCE_MANIFEST_GATE_V1_20261117'),
    pg_catalog.pg_backend_pid()
  ) AS source_manifest_gate_released
  FROM manifest_proof
), state AS MATERIALIZED (
  SELECT
    pg_catalog.pg_current_xact_id_if_assigned() IS NULL AS outside_write_transaction,
    proof.source_manifest_gate_held AS local_source_manifest_verified,
    '00000000-0000-0000-0000-000000006107'::uuid IS NOT NULL
      AND '00000000-0000-0000-0000-000000006108'::uuid IS NOT NULL
      AND '00000000-0000-0000-0000-00000000610b'::uuid IS NOT NULL
      AND '00000000-0000-0000-0000-000000006111'::uuid IS NOT NULL
      AS synthetic_ids_valid,
    current_database() = 'postgres' AS expected_database,
    current_user = 'postgres' AS expected_role,
    (SELECT count(*) = 0
       FROM supabase_migrations.schema_migrations s
      WHERE s.version::text IN (
        '20261114000000','20261114030000','20261114170000',
        '20261114180000','20261114183000'
      )) AS migrations_remain_unapplied,
    NOT EXISTS (
      SELECT 1 FROM auth.users u
       WHERE u.id = '00000000-0000-0000-0000-000000006107'::uuid
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.zion_internal_admins a
       WHERE a.user_id = '00000000-0000-0000-0000-000000006107'::uuid
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.organizations o
       WHERE o.id IN (
         '00000000-0000-0000-0000-000000006101'::uuid,
         '00000000-0000-0000-0000-000000006103'::uuid,
         '00000000-0000-0000-0000-000000006105'::uuid,
         '00000000-0000-0000-0000-000000006108'::uuid,
         '00000000-0000-0000-0000-00000000610f'::uuid
       )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.stores s
       WHERE s.id IN (
         '00000000-0000-0000-0000-000000006102'::uuid,
         '00000000-0000-0000-0000-000000006104'::uuid,
         '00000000-0000-0000-0000-000000006106'::uuid,
         '00000000-0000-0000-0000-000000006109'::uuid
       )
       OR s.organization_id IN (
         '00000000-0000-0000-0000-000000006101'::uuid,
         '00000000-0000-0000-0000-000000006103'::uuid,
         '00000000-0000-0000-0000-000000006105'::uuid,
         '00000000-0000-0000-0000-000000006108'::uuid,
         '00000000-0000-0000-0000-00000000610f'::uuid
       )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.external_integrations e
       WHERE e.id = '00000000-0000-0000-0000-000000006110'::uuid
          OR e.organization_id IN (
            '00000000-0000-0000-0000-000000006101'::uuid,
            '00000000-0000-0000-0000-000000006103'::uuid,
            '00000000-0000-0000-0000-000000006105'::uuid,
            '00000000-0000-0000-0000-000000006108'::uuid,
            '00000000-0000-0000-0000-00000000610f'::uuid
          )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_phone_security_secrets s
       WHERE s.id IN (
         '00000000-0000-0000-0000-00000000610d'::uuid,
         '00000000-0000-0000-0000-00000000610e'::uuid
       )
       OR s.organization_id = '00000000-0000-0000-0000-000000006108'::uuid
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_pin_recovery_attempts a
       WHERE a.id = '00000000-0000-0000-0000-00000000610b'::uuid
          OR a.organization_id = '00000000-0000-0000-0000-000000006108'::uuid
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_pin_recovery_events e
       WHERE e.attempt_id = '00000000-0000-0000-0000-00000000610b'::uuid
          OR e.operation_id = '00000000-0000-0000-0000-00000000610c'::uuid
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_binding_change_requests r
       WHERE r.id = '00000000-0000-0000-0000-000000006111'::uuid
          OR r.organization_id = '00000000-0000-0000-0000-000000006105'::uuid
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.state_transition_log l
       WHERE l.organization_id IN (
         '00000000-0000-0000-0000-000000006101'::uuid,
         '00000000-0000-0000-0000-000000006103'::uuid,
         '00000000-0000-0000-0000-000000006105'::uuid,
         '00000000-0000-0000-0000-000000006108'::uuid,
         '00000000-0000-0000-0000-00000000610f'::uuid
       )
    ) AS recovery_fixture_rolled_back
  FROM proof
)
SELECT
  CASE WHEN proof.all_checks_completed
         AND proof.source_manifest_gate_released
         AND state.local_source_manifest_verified
         AND state.synthetic_ids_valid
         AND state.outside_write_transaction
         AND state.expected_database
         AND state.expected_role
         AND state.migrations_remain_unapplied
         AND state.recovery_fixture_rolled_back
    THEN 'ZION_ETAPA6_BEHAVIORAL_PARCIAL_PASS_FINALIZACAO_E_CONCORRENCIA_PENDENTES'
    ELSE 'ZION_ETAPA6_BEHAVIORAL_FAIL_OU_INDETERMINADO'
  END AS veredito_comportamental,
  CASE WHEN proof.all_checks_completed
         AND proof.source_manifest_gate_released
         AND state.local_source_manifest_verified
         AND state.synthetic_ids_valid
         AND state.outside_write_transaction
         AND state.expected_database
         AND state.expected_role
         AND state.migrations_remain_unapplied
         AND state.recovery_fixture_rolled_back
    THEN 'PENDENTE_FINALIZACAO_RUNTIME_E_CONCORRENCIA'
    ELSE 'NAO_APROVADO'
  END AS veredito_global_etapa6,
  proof.all_checks_completed AS assertivas_estrutura_e_comportamento_passaram,
  state.local_source_manifest_verified AS gate_manifesto_local_verificado,
  state.synthetic_ids_valid AS ids_sinteticos_validos,
  state.outside_write_transaction AS transacao_encerrada,
  state.migrations_remain_unapplied AS migrations_nao_aplicadas,
  CASE WHEN proof.all_checks_completed THEN 13 ELSE 0 END AS cenarios_comportamentais_aprovados_comprovados,
  CASE WHEN proof.all_checks_completed THEN 12 ELSE 0 END AS cenarios_anteriores_preservados,
  CASE WHEN proof.all_checks_completed THEN 1 ELSE 0 END AS finalizacao_sql_sintetica_aprovada,
  state.recovery_fixture_rolled_back AS fixture_recovery_desfeita_por_rollback,
  1 AS concorrencia_multisessao_pendente,
  1 AS finalizacao_recovery_runtime_pendente,
  pg_catalog.pg_backend_pid() AS backend_pid,
  activity.backend_start AS backend_start,
  activity.state AS backend_state,
  activity.xact_start AS backend_xact_start,
  current_database() AS banco,
  current_user AS usuario
 FROM proof
 CROSS JOIN state
LEFT JOIN pg_catalog.pg_stat_activity activity
  ON activity.pid = pg_catalog.pg_backend_pid();

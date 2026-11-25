-- ZION/P19-A ETAPA 6 - PRECHECK SINCRONIZADO: SOMENTE CONSULTAS SELECT.
-- Nao instala migrations, nao cria funcoes, nao executa writers.
-- ATENCAO: este relatorio nao autoriza automaticamente o runner DDL.
-- Confira manualmente destino, historico, roles, DDL event triggers e locks.
-- O precheck deve executar antes do runner, e nao autoriza por si so DDL no banco real.
-- As migrations locais foram revisadas quanto a NULL em connection_mode.
-- Nenhuma consulta aqui executa funcoes de negocio ou altera informacoes.

-- 1) IDENTIDADE: confirmar projeto Supabase real correto no painel.
SELECT 'SERVER_IDENTITY' AS section,
       host(inet_server_addr()) AS host,
       inet_server_port() AS port,
       current_database() AS database_name,
       session_user, current_user,
       pg_is_in_recovery() AS in_recovery,
       current_setting('transaction_read_only') AS transaction_read_only,
       current_setting('server_version') AS pg_version;

-- 2) OBJETOS, INCLUINDO HISTORICO SUPABASE. Regclass/regprocedure -> text.
WITH required(name, kind) AS (
  VALUES
    ('supabase_migrations.schema_migrations','relation'),
    ('public.stores','relation'),
    ('public.external_integrations','relation'),
    ('public.whatsapp_phone_security_secrets','relation'),
    ('public.whatsapp_binding_change_requests','relation'),
    ('public.materialize_store_whatsapp_embedded_signup_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)','function'),
    ('auth.uid()','function'),
    ('auth.role()','function')
)
SELECT 'DEPENDENCIES' AS section, name, kind,
       CASE WHEN kind='relation' THEN to_regclass(name)::text
            ELSE to_regprocedure(name)::text END AS resolved
  FROM required ORDER BY kind, name;

-- 3) HISTORICO DAS CINCO MIGRATIONS. A tabela precisa existir para seguir.
-- Se esta consulta falhar, PARE. Nao executar o runner.
WITH expected(version) AS (
  VALUES ('20261114000000'), ('20261114030000'), ('20261114170000'),
         ('20261114180000'), ('20261114183000')
)
SELECT 'TARGET_MIGRATION_HISTORY' AS section, e.version,
       EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s
                WHERE s.version::text=e.version) AS already_applied
  FROM expected e ORDER BY e.version;

-- 4) ROLES E EXTENSOES.
SELECT 'ROLES' AS section, r.rolname, r.rolsuper, r.rolcanlogin,
       r.rolbypassrls
  FROM pg_catalog.pg_roles r
 WHERE r.rolname IN ('anon','authenticated','service_role','postgres')
 ORDER BY r.rolname;

SELECT 'EXTENSIONS' AS section, extname, extversion
  FROM pg_catalog.pg_extension
 WHERE extname IN ('pgcrypto','uuid-ossp','pg_net','pg_graphql','supabase_vault')
 ORDER BY extname;

-- 5) EVENT TRIGGERS: qualquer um habilitado precisa revisao antes do DDL.
SELECT 'DDL_EVENT_TRIGGERS' AS section,
       e.evtname, e.evtevent, e.evtenabled,
       p.proname AS function_name, n.nspname AS function_schema
  FROM pg_catalog.pg_event_trigger e
  JOIN pg_catalog.pg_proc p ON p.oid=e.evtfoid
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE e.evtenabled <> 'D'
 ORDER BY e.evtname;

-- 6) TRIGGERS NAS TABELAS DE NEGOCIO: se houver, DML real exige revisao
-- de cada corpo e eventuais efeitos nao transacionais.
SELECT 'BUSINESS_TABLE_TRIGGERS' AS section,
       n.nspname AS schema_name, c.relname AS table_name,
       t.tgname, t.tgenabled,
       pn.nspname AS function_schema, p.proname AS function_name
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
  JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
 WHERE NOT t.tgisinternal AND t.tgenabled <> 'D'
   AND n.nspname='public'
   AND c.relname IN ('stores','external_integrations',
                     'whatsapp_phone_security_secrets','whatsapp_binding_change_requests')
 ORDER BY c.relname,t.tgname;

-- 7) FUNCOES: assinatura, owner, definer, search_path, ACL.
WITH targets(signature) AS (
 VALUES
 ('public.materialize_store_whatsapp_signup_pending_pin_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)'),
 ('public.activate_whatsapp_phone_security_secret_by_system(uuid,uuid,text,text,uuid)'),
 ('public.cutover_whatsapp_binding_change_request_by_system(uuid,uuid,text,uuid,text,uuid,text,text,text,text,jsonb)'),
 ('public.materialize_store_whatsapp_embedded_signup_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)'),
 ('public.materialize_store_whatsapp_pin_recovery_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)'),
 ('public.materialize_whatsapp_first_connection_mode_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz,text)')
)
SELECT 'FUNCTION_BASELINE' AS section, t.signature,
       (p.oid IS NOT NULL) AS exists_now,
       p.proowner::regrole AS owner, p.prosecdef AS security_definer,
       p.proconfig AS config,
       p.proacl::text AS acl,
       CASE WHEN p.oid IS NOT NULL THEN md5(pg_get_functiondef(p.oid)) END AS definition_md5
  FROM targets t
  LEFT JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure(t.signature)
 ORDER BY t.signature;

-- 8) RLS E TABLE GRANTS (diagnostico; nao alteram RLS).
SELECT 'RLS_BASELINE' AS section, n.nspname AS schema_name,
       c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
   AND c.relname IN ('stores','external_integrations',
                     'whatsapp_phone_security_secrets','whatsapp_binding_change_requests')
 ORDER BY c.relname;

-- 9) LOCKS EM ESPERA NESSE BANCO.
SELECT 'WAITING_LOCKS' AS section, l.pid, l.locktype,
       l.mode, l.granted, a.state,
       a.wait_event_type, a.wait_event
  FROM pg_catalog.pg_locks l
  LEFT JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid
 WHERE l.pid <> pg_backend_pid() AND l.granted IS FALSE
   AND a.datname=current_database()
 ORDER BY l.pid,l.locktype;

-- 10) RESUMO DE TENANTS E LOJAS, SEM EXPOR IDs OU TOKENS.
SELECT 'TENANT_COUNTS' AS section,
       count(DISTINCT organization_id) AS organizations,
       count(*) AS stores_count
  FROM public.stores;

SELECT 'PRECHECK_READONLY_END' AS marker,
       'REVIEW_RESULTS_MANUALLY_BEFORE_ANY_DDL' AS status;

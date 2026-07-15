-- Fase 4.1A - verificacao manual de integridade e RLS
-- Execute somente apos aplicar a migration 20260715110000_customer_identity_foundation.sql
-- Este arquivo nao grava IDs hardcoded do projeto. Substitua os placeholders por registros de teste isolados.

-- ==================================================
-- PREPARACAO
-- ==================================================
-- 1. Crie ou separe:
--    - org_a
--    - org_b
--    - store_a1 e store_a2 da org_a
--    - store_b1 da org_b
--    - user_member_a vinculado a memberships.organization_id = org_a
--    - user_member_b vinculado a memberships.organization_id = org_b
--
-- 2. Autentique-se como user_member_a para os testes RLS com authenticated.

-- ==================================================
-- TESTE 1 - customer criado dentro de uma organizacao
-- ==================================================
-- insert into public.customers (organization_id, display_name, normalized_name)
-- values ('<org_a>', 'Cliente Teste A', 'cliente teste a')
-- returning *;

-- Esperado:
-- - insert permitido para membro da org_a
-- - created_at e updated_at preenchidos

-- ==================================================
-- TESTE 2 - customer ligado a duas lojas da mesma organizacao
-- ==================================================
-- insert into public.customer_store_links (organization_id, store_id, customer_id)
-- values
--   ('<org_a>', '<store_a1>', '<customer_a>'),
--   ('<org_a>', '<store_a2>', '<customer_a>');

-- Esperado:
-- - ambos inserts permitidos
-- - unique customer_id + store_id preservado

-- ==================================================
-- TESTE 3 - tentativa de vinculo com loja de outra organizacao bloqueada
-- ==================================================
-- insert into public.customer_store_links (organization_id, store_id, customer_id)
-- values ('<org_a>', '<store_b1>', '<customer_a>');

-- Esperado:
-- - bloqueio por FK composta store_id + organization_id

-- ==================================================
-- TESTE 4 - identidade normalizada unica por organizacao e canal
-- ==================================================
-- insert into public.customer_channel_identities (
--   organization_id,
--   customer_id,
--   channel,
--   external_identity,
--   normalized_external_identity,
--   is_primary
-- ) values (
--   '<org_a>',
--   '<customer_a>',
--   'whatsapp',
--   '+55 (11) 99999-9999',
--   '5511999999999',
--   true
-- );

-- Repetir com outro customer da mesma org e mesmo channel + normalized_external_identity.
-- Esperado:
-- - segunda tentativa bloqueada pelo unique org + channel + normalized_external_identity

-- ==================================================
-- TESTE 5 - duplicidade conflitante bloqueada
-- ==================================================
-- insert into public.customer_channel_identities (
--   organization_id,
--   customer_id,
--   channel,
--   external_identity,
--   normalized_external_identity
-- ) values (
--   '<org_a>',
--   '<customer_a>',
--   'whatsapp',
--   '+55 11 99999-9999',
--   '5511999999999'
-- );

-- Esperado:
-- - bloqueado se ja existir identidade equivalente no mesmo escopo

-- ==================================================
-- TESTE 6 - leitura de outra organizacao bloqueada
-- ==================================================
-- Como user_member_a:
-- select * from public.customers where organization_id = '<org_b>';
-- select * from public.customer_channel_identities where organization_id = '<org_b>';
-- select * from public.customer_store_links where organization_id = '<org_b>';

-- Esperado:
-- - zero linhas visiveis

-- ==================================================
-- TESTE 7 - leitura entre lojas respeitando a policy definida
-- ==================================================
-- Observacao importante:
-- - nesta fase, a policy minima protege por organization_id
-- - o isolamento fino por loja e permissao de visibilidade fica para os consumidores futuros + Pilar 18
-- - portanto, o teste esperado aqui e:
--   * nenhuma leitura cross-organization
--   * vinculos por loja somente existem via customer_store_links
--
-- Select sugerido:
-- select * from public.customer_store_links
-- where organization_id = '<org_a>'
--   and store_id = '<store_a2>';

-- Esperado:
-- - apenas links reais da store_a2
-- - nenhuma inferencia automatica de dados operacionais de outra loja

-- ==================================================
-- TESTE 8 - retry de criacao nao produz duplicidade silenciosa
-- ==================================================
-- Repetir o mesmo insert de customer_store_links para (<customer_a>, <store_a1>).
-- Esperado:
-- - unique violation explicita

-- Repetir o mesmo insert de customer_channel_identities com mesma identidade normalizada.
-- Esperado:
-- - unique violation explicita

-- ==================================================
-- TESTE 9 - sem hardcode de organization_id/store_id
-- ==================================================
-- Revisao manual:
-- - confira que a migration usa apenas colunas e FKs
-- - confira ausencia de literais fixos de org/store nas policies
-- - confirme que a autorizacao depende de memberships + stores

-- ==================================================
-- TESTE 10 - politica de cross-organization em update
-- ==================================================
-- Como user_member_a:
-- update public.customers
-- set display_name = 'Nao deveria atualizar'
-- where organization_id = '<org_b>' and id = '<customer_b>';

-- Esperado:
-- - zero linhas atualizadas

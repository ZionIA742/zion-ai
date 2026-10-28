BEGIN;

-- A operacao de preparacao deve ser acessada pelas RPCs
-- sistemicas autorizadas, nao por escrita direta da aplicacao.
REVOKE ALL ON TABLE
    public.p19a_quote_preparation_operations
FROM service_role;

COMMIT;

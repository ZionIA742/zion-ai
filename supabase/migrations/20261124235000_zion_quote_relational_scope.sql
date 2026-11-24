-- ZION 2.2-M.4 | Exact candidate DDL homologated by 2.2-M.3.1.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
DO $migration$
DECLARE
  fk_names text[] := ARRAY['zion_quote_store_scope_fk','zion_quote_item_parent_scope_fk','zion_quote_version_parent_scope_fk','zion_quote_request_parent_scope_fk','zion_quote_version_file_scope_fk','zion_quote_current_version_scope_fk','zion_quote_last_request_scope_fk','zion_quote_request_version_scope_fk'];
  idx_names text[] := ARRAY['zion_quote_scope_uidx','zion_quote_version_scope_uidx','zion_quote_request_scope_uidx','zion_quote_file_scope_uidx'];
  before_counts bigint[];
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN RAISE EXCEPTION 'POSTGRES_15_REQUIRED'; END IF;
  LOCK TABLE public.sales_quotes, public.sales_quote_items, public.sales_quote_versions, public.sales_quote_change_requests, public.store_files IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname=ANY(fk_names)) OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY(idx_names)) THEN RAISE EXCEPTION 'CANDIDATE_ALREADY_EXISTS'; END IF;
  SELECT ARRAY[(SELECT count(*) FROM public.sales_quotes),(SELECT count(*) FROM public.sales_quote_items),(SELECT count(*) FROM public.sales_quote_versions),(SELECT count(*) FROM public.sales_quote_change_requests),(SELECT count(*) FROM public.store_files)] INTO before_counts;
    CREATE UNIQUE INDEX zion_quote_scope_uidx ON public.sales_quotes(id, organization_id, store_id);
    CREATE UNIQUE INDEX zion_quote_version_scope_uidx ON public.sales_quote_versions(id, quote_id, organization_id, store_id);
    CREATE UNIQUE INDEX zion_quote_request_scope_uidx ON public.sales_quote_change_requests(id, quote_id, organization_id, store_id);
    CREATE UNIQUE INDEX zion_quote_file_scope_uidx ON public.store_files(id, organization_id, store_id);
    ALTER TABLE public.sales_quotes ADD CONSTRAINT zion_quote_store_scope_fk FOREIGN KEY (store_id, organization_id) REFERENCES public.stores(id, organization_id) ON DELETE CASCADE;
    ALTER TABLE public.sales_quote_items ADD CONSTRAINT zion_quote_item_parent_scope_fk FOREIGN KEY (quote_id, organization_id, store_id) REFERENCES public.sales_quotes(id, organization_id, store_id) ON DELETE CASCADE;
    ALTER TABLE public.sales_quote_versions ADD CONSTRAINT zion_quote_version_parent_scope_fk FOREIGN KEY (quote_id, organization_id, store_id) REFERENCES public.sales_quotes(id, organization_id, store_id) ON DELETE CASCADE;
    ALTER TABLE public.sales_quote_change_requests ADD CONSTRAINT zion_quote_request_parent_scope_fk FOREIGN KEY (quote_id, organization_id, store_id) REFERENCES public.sales_quotes(id, organization_id, store_id) ON DELETE CASCADE;
    ALTER TABLE public.sales_quote_versions ADD CONSTRAINT zion_quote_version_file_scope_fk FOREIGN KEY (store_file_id, organization_id, store_id) REFERENCES public.store_files(id, organization_id, store_id) ON DELETE SET NULL (store_file_id);
    ALTER TABLE public.sales_quotes ADD CONSTRAINT zion_quote_current_version_scope_fk FOREIGN KEY (current_version_id, id, organization_id, store_id) REFERENCES public.sales_quote_versions(id, quote_id, organization_id, store_id) ON DELETE SET NULL (current_version_id);
    ALTER TABLE public.sales_quotes ADD CONSTRAINT zion_quote_last_request_scope_fk FOREIGN KEY (last_change_request_id, id, organization_id, store_id) REFERENCES public.sales_quote_change_requests(id, quote_id, organization_id, store_id) ON DELETE SET NULL (last_change_request_id);
    ALTER TABLE public.sales_quote_change_requests ADD CONSTRAINT zion_quote_request_version_scope_fk FOREIGN KEY (quote_version_id, quote_id, organization_id, store_id) REFERENCES public.sales_quote_versions(id, quote_id, organization_id, store_id) ON DELETE SET NULL (quote_version_id);
  IF (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname=ANY(fk_names) AND contype='f' AND convalidated)<>8 THEN RAISE EXCEPTION 'CONSTRAINT_VALIDATION_FAILED'; END IF;
  IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY(idx_names) AND i.indisunique AND i.indisvalid AND i.indisready)<>4 THEN RAISE EXCEPTION 'INDEX_VALIDATION_FAILED'; END IF;
  IF before_counts IS DISTINCT FROM ARRAY[(SELECT count(*) FROM public.sales_quotes),(SELECT count(*) FROM public.sales_quote_items),(SELECT count(*) FROM public.sales_quote_versions),(SELECT count(*) FROM public.sales_quote_change_requests),(SELECT count(*) FROM public.store_files)] THEN RAISE EXCEPTION 'RECORD_COUNTS_CHANGED'; END IF;
END;
$migration$;
COMMIT;

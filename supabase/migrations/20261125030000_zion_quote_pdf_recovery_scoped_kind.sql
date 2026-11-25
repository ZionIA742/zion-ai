-- ZION 3.3-F.2 | Expose only the persisted kind through the existing scoped RPC.
-- Exact candidate approved in 3.3-F.1. No table grants or data changes.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='3s';
DO $migration$
DECLARE
  fn regprocedure := 'public.get_sales_quote_pdf_generation_replay_by_system(uuid,uuid,uuid,uuid)'::regprocedure;
  old_def text; old_hash text; old_acl aclitem[]; old_owner oid; old_config text[];
  old_fragment text := $anchor$'outcome', 'existing_operation',
    'status', v_operation.status,
    'operation_id', v_operation.operation_id$anchor$;
  new_fragment text := $anchor$'outcome', 'existing_operation',
    'status', v_operation.status,
    'operation_id', v_operation.operation_id,
    'quote_kind', v_operation.quote_kind$anchor$;
BEGIN
  SELECT pg_get_functiondef(oid),md5(replace(prosrc,chr(13)||chr(10),chr(10))),proacl,proowner,proconfig
  INTO STRICT old_def,old_hash,old_acl,old_owner,old_config FROM pg_proc WHERE oid=fn AND prosecdef;
  IF NOT has_function_privilege('service_role',fn,'EXECUTE')
     OR has_function_privilege('anon',fn,'EXECUTE')
     OR has_function_privilege('authenticated',fn,'EXECUTE')
     OR has_table_privilege('service_role','public.sales_quote_pdf_generation_operations','SELECT') THEN
    RAISE EXCEPTION 'BASELINE_ACL_UNEXPECTED';
  END IF;
  IF old_hash = '03be1aef624a42011d1d3f6ad345d13f' THEN
    IF strpos(old_def,old_fragment)=0 THEN
      old_fragment:=replace(old_fragment,chr(10),chr(13)||chr(10));
      new_fragment:=replace(new_fragment,chr(10),chr(13)||chr(10));
    END IF;
    IF (length(old_def)-length(replace(old_def,old_fragment,'')))<>length(old_fragment) THEN
      RAISE EXCEPTION 'RPC_ANCHOR_NOT_UNIQUE';
    END IF;
    EXECUTE replace(old_def,old_fragment,new_fragment);
  ELSIF old_hash IS DISTINCT FROM '79065423d314e7cf81b84519abd6b0f2' THEN
    RAISE EXCEPTION 'REPLAY_BASELINE_CHANGED: %',old_hash;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=fn AND prosecdef
      AND proacl IS NOT DISTINCT FROM old_acl AND proowner=old_owner
      AND proconfig IS NOT DISTINCT FROM old_config
      AND md5(replace(prosrc,chr(13)||chr(10),chr(10)))='79065423d314e7cf81b84519abd6b0f2')
     OR NOT has_function_privilege('service_role',fn,'EXECUTE')
     OR has_function_privilege('anon',fn,'EXECUTE')
     OR has_function_privilege('authenticated',fn,'EXECUTE')
     OR has_table_privilege('service_role','public.sales_quote_pdf_generation_operations','SELECT') THEN
    RAISE EXCEPTION 'RPC_FINAL_VERIFICATION_FAILED';
  END IF;
END;
$migration$;
COMMIT;

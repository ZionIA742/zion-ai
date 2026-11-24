-- ZION 2.3-D | Exact approval guard tested in 2.3-C.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='3s';
LOCK TABLE public.sales_quotes IN SHARE ROW EXCLUSIVE MODE;
CREATE FUNCTION public.zion_quote_approval_authority_guard_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $guard$
BEGIN
  -- Browser/database client roles cannot mint or modify approval authority.
  -- Canonical server writers retain their existing authorization checks.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft'
       OR NEW.requires_human_approval IS DISTINCT FROM true
       OR NEW.approved_at IS NOT NULL OR NEW.approved_by IS NOT NULL
       OR NEW.sent_at IS NOT NULL OR NEW.current_version_id IS NOT NULL
       OR (NEW.metadata ? 'requires_human_approval_before_send_snapshot'
           AND (NEW.metadata->'requires_human_approval_before_send_snapshot') IS DISTINCT FROM 'true'::jsonb)
    THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='ZION_QUOTE_APPROVAL_AUTHORITY_FORBIDDEN';
    END IF;
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.requires_human_approval IS DISTINCT FROM OLD.requires_human_approval
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
       OR NEW.current_version_id IS DISTINCT FROM OLD.current_version_id
       OR (NEW.metadata->'requires_human_approval_before_send_snapshot')
          IS DISTINCT FROM (OLD.metadata->'requires_human_approval_before_send_snapshot')
    THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='ZION_QUOTE_APPROVAL_AUTHORITY_FORBIDDEN';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER zz_zion_quote_approval_authority_guard
BEFORE INSERT OR UPDATE ON public.sales_quotes
FOR EACH ROW EXECUTE FUNCTION public.zion_quote_approval_authority_guard_trg();
DO $verify$
BEGIN
  IF (SELECT count(*) FROM pg_trigger t
JOIN pg_proc f ON f.oid=t.tgfoid
WHERE t.tgrelid='public.sales_quotes'::regclass
 AND t.tgname='zz_zion_quote_approval_authority_guard'
 AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=23
 AND f.oid=to_regprocedure('public.zion_quote_approval_authority_guard_trg()')
 AND NOT f.prosecdef AND f.prorettype='trigger'::regtype
 AND md5(replace(f.prosrc,chr(13)||chr(10),chr(10)))='dccea29d76aed5ae8bebe31191acfe25'
 AND f.proconfig=ARRAY['search_path=pg_catalog, public']::text[]) <> 1 THEN
    RAISE EXCEPTION 'APPROVAL_GUARD_VERIFICATION_FAILED';
  END IF;
END;
$verify$;
COMMIT;

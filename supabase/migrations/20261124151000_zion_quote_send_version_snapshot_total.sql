begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $migration$
declare
  v_signature regprocedure :=
    'public.finalize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text)'::regprocedure;

  v_original_body text;
  v_definition text;
  v_modified text;

  v_anchor text := $anchor$'total_cents', v_quote.total_cents$anchor$;
  v_replacement text := $replacement$'total_cents',
          case
            when v_quote.current_version_id
                   is distinct from v_version.id
              and exists (
                select 1
                from public.sales_quote_versions revision_row
                where revision_row.id = v_quote.current_version_id
                  and revision_row.quote_id = v_quote.id
                  and revision_row.organization_id = p_organization_id
                  and revision_row.store_id = p_store_id
                  and revision_row.generated_by = 'human_revision'
              )
            then coalesce(
              case
                when jsonb_typeof(
                  v_version.quote_snapshot #> '{quote,totalCents}'
                ) = 'number'
                then v_version.quote_snapshot #> '{quote,totalCents}'
              end,
              case
                when jsonb_typeof(
                  v_version.quote_snapshot -> 'totalCents'
                ) = 'number'
                then v_version.quote_snapshot -> 'totalCents'
              end,
              case
                when jsonb_typeof(
                  v_version.quote_snapshot -> 'total_cents'
                ) = 'number'
                then v_version.quote_snapshot -> 'total_cents'
              end,
              'null'::jsonb
            )
            else to_jsonb(v_quote.total_cents)
          end$replacement$;

begin

  select p.prosrc, pg_get_functiondef(p.oid)
  into v_original_body, v_definition
  from pg_proc p
  where p.oid = v_signature
    and p.prosecdef is true
    and p.proowner = 'postgres'::regrole;

  if v_definition is null then
    raise exception 'ZION_SEND_FINALIZER_NOT_FOUND';
  end if;

  if md5(
    btrim(replace(v_original_body, chr(13), ''), E' \t\n')
  ) is distinct from '4e5e7aed6312751e893e1bfa46e6fa30'
  then
    raise exception 'ZION_SEND_FINALIZER_SOURCE_CHANGED';
  end if;

  if (
    length(v_definition)
    - length(replace(v_definition, v_anchor, ''))
  ) <> length(v_anchor) then
    raise exception 'ZION_SEND_FINALIZER_ANCHOR_INVALID';
  end if;

  v_modified := replace(
    v_definition,
    v_anchor,
    v_replacement
  );

  execute v_modified;

  if pg_get_functiondef(v_signature)
     is distinct from v_modified then
    raise exception 'ZION_SEND_FINALIZER_INSTALLATION_MISMATCH';
  end if;

end;
$migration$;

commit;

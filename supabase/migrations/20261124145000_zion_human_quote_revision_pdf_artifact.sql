begin;

create function public.assert_human_quote_revision_pdf_artifact_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_store_file_id uuid
)
returns public.store_files
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_file public.store_files%rowtype;
begin

  if p_organization_id is null
     or p_store_id is null
     or p_store_file_id is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_HUMAN_REVISION_PDF_ARGUMENTS_REQUIRED';
  end if;

  -- O arquivo deve pertencer ao escopo autorizado.
  -- O bloqueio permanece ate a conclusao do writer.
  select f.*
  into v_file
  from public.store_files f
  where f.id = p_store_file_id
    and f.organization_id = p_organization_id
    and f.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'ZION_HUMAN_REVISION_PDF_NOT_FOUND';
  end if;

  if v_file.file_kind is distinct from 'sales_quote_pdf'
     or v_file.mime_type is distinct from 'application/pdf'
     or nullif(btrim(v_file.storage_bucket), '') is null
     or nullif(btrim(v_file.storage_path), '') is null
     or nullif(btrim(v_file.original_filename), '') is null
     or v_file.size_bytes is null
     or v_file.size_bytes <= 0 then

    raise exception using
      errcode = '23514',
      message = 'ZION_HUMAN_REVISION_PDF_INVALID';

  end if;

  -- A revisao precisa de um arquivo novo.
  -- Nenhuma versao anterior pode compartilhar sua identidade
  -- ou seu caminho de armazenamento.
  if exists (
    select 1
    from public.sales_quote_versions v
    where v.store_file_id = v_file.id
       or (
         v.storage_bucket = v_file.storage_bucket
         and v.storage_path = v_file.storage_path
       )
  ) then

    raise exception using
      errcode = '23514',
      message = 'ZION_HUMAN_REVISION_PDF_ALREADY_USED';

  end if;

  -- O writer recebe os dados oficiais do arquivo,
  -- em vez de confiar em valores fornecidos pela interface.
  return v_file;

end;
$function$;

alter function
  public.assert_human_quote_revision_pdf_artifact_internal(
    uuid, uuid, uuid
  )
owner to postgres;

revoke all on function
  public.assert_human_quote_revision_pdf_artifact_internal(
    uuid, uuid, uuid
  )
from public, anon, authenticated, service_role;

comment on function
  public.assert_human_quote_revision_pdf_artifact_internal(
    uuid, uuid, uuid
  )
is
  'Internal metadata and identity guard for new human quote revision PDF artifacts. Must run in the same transaction as the revision writer.';

commit;

begin;

-- P19-A / Bloco 3 / Etapa 3.4
-- Protege o vínculo que torna um arquivo importado elegível para ser o
-- "catálogo completo" enviado aos clientes.
--
-- Motivo:
-- a UI legada de exclusão remove store_import_file_items antes de tentar
-- remover store_import_files. A FK de store_catalog_settings protege a row do
-- arquivo, mas sozinha não impede que os vínculos da importação sejam removidos
-- primeiro. Este trigger fecha essa janela no próprio banco.
--
-- Regra:
-- enquanto um arquivo estiver selecionado em store_catalog_settings com
-- allow_full_catalog_send = true, seus vínculos de importação não podem ser
-- apagados nem movidos para outro arquivo/tenant. Primeiro é obrigatório
-- remover/desabilitar a seleção canônica.

create or replace function public.protect_selected_customer_catalog_import_link()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_is_selected boolean;
begin
  if tg_op = 'UPDATE'
     and new.import_file_id is not distinct from old.import_file_id
     and new.organization_id is not distinct from old.organization_id
     and new.store_id is not distinct from old.store_id then
    return new;
  end if;

  select exists (
    select 1
    from public.store_catalog_settings settings_row
    where settings_row.organization_id = old.organization_id
      and settings_row.store_id = old.store_id
      and settings_row.allow_full_catalog_send is true
      and settings_row.customer_catalog_import_file_id = old.import_file_id
  )
  into v_is_selected;

  if coalesce(v_is_selected, false) then
    raise exception
      'selected customer catalog file links cannot be removed while full catalog sending is enabled'
      using errcode = '23503';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

alter function public.protect_selected_customer_catalog_import_link()
owner to postgres;

revoke all
on function public.protect_selected_customer_catalog_import_link()
from public, anon, authenticated, service_role;

drop trigger if exists protect_selected_customer_catalog_import_link
on public.store_import_file_items;

create trigger protect_selected_customer_catalog_import_link
before delete or update of import_file_id, organization_id, store_id
on public.store_import_file_items
for each row
execute function public.protect_selected_customer_catalog_import_link();

comment on function public.protect_selected_customer_catalog_import_link() is
  'P19-A: impede remover ou mover vínculos do arquivo importado enquanto ele estiver selecionado como catálogo completo para clientes.';

commit;

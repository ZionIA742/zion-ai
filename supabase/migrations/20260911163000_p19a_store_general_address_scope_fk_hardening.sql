-- P19-A / Bloco 3 / Etapa 3.4
-- Hardening da integridade tenant do endereco físico da loja.
-- Garante no próprio banco que o store_id pertence à organization_id da row.

alter table public.store_general_address_settings
  drop constraint if exists store_general_address_settings_store_fkey;

alter table public.store_general_address_settings
  drop constraint if exists store_general_address_settings_store_scope_fkey;

alter table public.store_general_address_settings
  add constraint store_general_address_settings_store_scope_fkey
  foreign key (store_id, organization_id)
  references public.stores(id, organization_id)
  on delete cascade;

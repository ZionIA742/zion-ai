-- PILAR 8 - STAGING DE MIDIAS DA IMPORTACAO INTELIGENTE
-- Cria tabela de assets de midia extraidos/selecionaveis.
-- Nao salva fotos finais. Nao mexe em pool_photos nem store_catalog_item_photos.

create table if not exists public.store_import_media_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  import_file_id uuid null,
  import_batch_id uuid null,
  source_file_name text null,
  source_kind text not null,
  source_image_id text null,
  source_location_key text null,
  sheet_scoped_key text null,
  worksheet_row_number integer null,
  page_number integer null,
  association_strength text not null,
  requires_user_confirmation boolean not null default true,
  original_mime_type text null,
  normalized_mime_type text null,
  file_name text not null,
  size_bytes bigint not null,
  width integer null,
  height integer null,
  checksum text null,
  storage_bucket text not null default 'store-import-files',
  storage_path text not null,
  status text not null default 'staged',
  expires_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,

  constraint store_import_media_assets_import_file_fkey
    foreign key (import_file_id)
    references public.store_import_files(id)
    on delete cascade,

  constraint store_import_media_assets_source_kind_check
    check (
      source_kind in (
        'xlsx_row_image',
        'docx_media',
        'pptx_media',
        'pdf_page_render',
        'image_file',
        'unknown'
      )
    ),

  constraint store_import_media_assets_association_strength_check
    check (
      association_strength in (
        'strong_auto',
        'weak_confirmed',
        'manual_upload',
        'visual_evidence',
        'none',
        'unknown'
      )
    ),

  constraint store_import_media_assets_status_check
    check (
      status in (
        'staged',
        'promoted',
        'expired',
        'cancelled',
        'failed'
      )
    ),

  constraint store_import_media_assets_size_bytes_positive_check
    check (size_bytes > 0),

  constraint store_import_media_assets_worksheet_row_number_positive_check
    check (worksheet_row_number is null or worksheet_row_number > 0),

  constraint store_import_media_assets_page_number_positive_check
    check (page_number is null or page_number > 0),

  constraint store_import_media_assets_width_positive_check
    check (width is null or width > 0),

  constraint store_import_media_assets_height_positive_check
    check (height is null or height > 0)
);

create unique index if not exists store_import_media_assets_storage_bucket_path_uidx
  on public.store_import_media_assets (storage_bucket, storage_path);

create index if not exists store_import_media_assets_import_file_idx
  on public.store_import_media_assets (import_file_id);

create index if not exists store_import_media_assets_import_batch_idx
  on public.store_import_media_assets (import_batch_id);

create index if not exists store_import_media_assets_org_store_status_expires_idx
  on public.store_import_media_assets (organization_id, store_id, status, expires_at);

create index if not exists store_import_media_assets_org_store_source_kind_idx
  on public.store_import_media_assets (organization_id, store_id, source_kind);

create index if not exists store_import_media_assets_source_file_sheet_row_idx
  on public.store_import_media_assets (source_file_name, sheet_scoped_key, worksheet_row_number);

create index if not exists store_import_media_assets_source_location_key_idx
  on public.store_import_media_assets (source_location_key);

create index if not exists store_import_media_assets_source_image_id_idx
  on public.store_import_media_assets (source_image_id)
  where source_image_id is not null;

create index if not exists store_import_media_assets_checksum_idx
  on public.store_import_media_assets (checksum)
  where checksum is not null;

alter table public.store_import_media_assets enable row level security;

revoke all on table public.store_import_media_assets from public;
revoke all on table public.store_import_media_assets from anon;
revoke all on table public.store_import_media_assets from authenticated;

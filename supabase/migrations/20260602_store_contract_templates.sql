create table if not exists public.store_contract_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  status text not null default 'draft',
  active_version_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_contract_templates_status_check
    check (status in ('draft', 'active', 'archived'))
);

create table if not exists public.store_contract_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.store_contract_templates(id) on delete cascade,
  organization_id uuid not null,
  store_id uuid not null,
  version_number integer not null,
  status text not null default 'uploaded',
  store_file_id uuid null references public.store_files(id) on delete set null,
  storage_bucket text not null,
  storage_path text not null,
  original_filename text null,
  mime_type text null,
  size_bytes bigint null,
  raw_extracted_text text null,
  analysis_summary text null,
  approved_at timestamptz null,
  approved_by uuid null,
  rejected_at timestamptz null,
  rejected_by uuid null,
  rejection_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_contract_template_versions_status_check
    check (
      status in (
        'uploaded',
        'analyzing',
        'analyzed',
        'awaiting_review',
        'approved',
        'active',
        'rejected',
        'archived',
        'failed'
      )
    )
);

create table if not exists public.store_contract_template_extracted_rules (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.store_contract_template_versions(id) on delete cascade,
  organization_id uuid not null,
  store_id uuid not null,
  rule_key text not null,
  rule_group text not null,
  label text not null,
  value_text text null,
  value_json jsonb not null default '{}'::jsonb,
  source_excerpt text null,
  confidence numeric null,
  review_status text not null default 'pending',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_contract_template_rules_review_status_check
    check (review_status in ('pending', 'approved', 'rejected', 'edited'))
);

create unique index if not exists store_contract_templates_org_store_uidx
  on public.store_contract_templates (organization_id, store_id);

create unique index if not exists store_contract_template_versions_template_version_uidx
  on public.store_contract_template_versions (template_id, version_number);

create index if not exists store_contract_templates_org_store_idx
  on public.store_contract_templates (organization_id, store_id);

create index if not exists store_contract_templates_active_version_idx
  on public.store_contract_templates (active_version_id);

create index if not exists store_contract_template_versions_org_store_idx
  on public.store_contract_template_versions (organization_id, store_id);

create index if not exists store_contract_template_versions_template_idx
  on public.store_contract_template_versions (template_id);

create index if not exists store_contract_template_rules_version_idx
  on public.store_contract_template_extracted_rules (template_version_id);

alter table public.store_contract_templates
  drop constraint if exists store_contract_templates_active_version_fkey;

alter table public.store_contract_templates
  add constraint store_contract_templates_active_version_fkey
  foreign key (active_version_id)
  references public.store_contract_template_versions(id)
  on delete set null;

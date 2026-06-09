create table if not exists public.store_responsible_external_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  responsible_id uuid not null,
  internal_notification_id uuid not null,
  channel text not null default 'whatsapp_responsible',
  destination text not null,
  notification_type text not null,
  priority text not null,
  status text not null default 'materialized',
  title text null,
  body text null,
  rendered_message text not null,
  context jsonb not null default '{}'::jsonb,
  source_event_key text null,
  related_lead_id uuid null,
  related_conversation_id uuid null,
  related_appointment_id uuid null,
  related_document_type text null,
  related_document_id uuid null,
  related_document_number text null,
  related_document_status text null,
  external_message_id text null,
  sent_at timestamptz null,
  delivered_at timestamptz null,
  read_at timestamptz null,
  failed_at timestamptz null,
  error_text text null,
  attempts integer not null default 0,
  locked_at timestamptz null,
  locked_by text null,
  processed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_responsible_external_notifications_internal_notification_fkey
    foreign key (internal_notification_id)
    references public.store_assistant_notification_queue(id)
    on delete cascade,
  constraint store_responsible_external_notifications_responsible_fkey
    foreign key (responsible_id)
    references public.store_responsibles(id)
    on delete restrict
);

create unique index if not exists store_responsible_external_notifications_notification_responsible_channel_uidx
  on public.store_responsible_external_notifications (
    internal_notification_id,
    responsible_id,
    channel
  );

create unique index if not exists store_responsible_external_notifications_event_key_uidx
  on public.store_responsible_external_notifications (
    organization_id,
    store_id,
    responsible_id,
    channel,
    source_event_key
  )
  where source_event_key is not null;

create index if not exists store_responsible_external_notifications_store_status_created_idx
  on public.store_responsible_external_notifications (store_id, status, created_at desc);

create index if not exists store_responsible_external_notifications_org_store_status_idx
  on public.store_responsible_external_notifications (organization_id, store_id, status);

create index if not exists store_responsible_external_notifications_document_idx
  on public.store_responsible_external_notifications (related_document_type, related_document_id);

create index if not exists store_responsible_external_notifications_source_event_key_idx
  on public.store_responsible_external_notifications (source_event_key);

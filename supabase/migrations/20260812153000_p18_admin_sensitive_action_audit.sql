create table public.zion_admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  created_at timestamptz not null default now(),
  actor_user_id uuid not null,
  action text not null,
  target_type text not null,
  target_id uuid null,
  organization_id uuid null,
  store_id uuid null,
  outcome text not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint zion_admin_audit_events_action_check
    check (
      action in (
        'account.create',
        'account.first_access_resend',
        'account.access_block',
        'account.access_reactivate',
        'store.suspend',
        'store.reactivate'
      )
    ),
  constraint zion_admin_audit_events_target_type_check
    check (
      target_type in (
        'user',
        'membership',
        'store'
      )
    ),
  constraint zion_admin_audit_events_outcome_check
    check (outcome in ('started', 'success', 'failed', 'denied')),
  constraint zion_admin_audit_events_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create index zion_admin_audit_events_created_at_idx
  on public.zion_admin_audit_events (created_at desc);

create index zion_admin_audit_events_actor_user_id_idx
  on public.zion_admin_audit_events (actor_user_id, created_at desc);

create index zion_admin_audit_events_action_idx
  on public.zion_admin_audit_events (action, created_at desc);

create index zion_admin_audit_events_target_idx
  on public.zion_admin_audit_events (target_type, target_id, created_at desc);

create index zion_admin_audit_events_organization_store_idx
  on public.zion_admin_audit_events (organization_id, store_id, created_at desc);

create index zion_admin_audit_events_operation_id_created_at_idx
  on public.zion_admin_audit_events (operation_id, created_at desc);

alter table public.zion_admin_audit_events enable row level security;

revoke all on table public.zion_admin_audit_events from public;
revoke all on table public.zion_admin_audit_events from anon;
revoke all on table public.zion_admin_audit_events from authenticated;
revoke all on table public.zion_admin_audit_events from service_role;

grant select, insert on table public.zion_admin_audit_events to service_role;

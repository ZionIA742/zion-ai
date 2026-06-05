create table if not exists public.zion_admin_login_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  invalidated_at timestamptz null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_attempt_at timestamptz null,
  ip_address text null,
  user_agent text null,
  purpose text not null default 'admin_login_stepup',
  created_at timestamptz not null default now(),
  constraint zion_admin_login_challenges_attempts_nonnegative
    check (attempts >= 0),
  constraint zion_admin_login_challenges_max_attempts_positive
    check (max_attempts > 0)
);

create index if not exists zion_admin_login_challenges_user_id_idx
  on public.zion_admin_login_challenges (user_id);

create index if not exists zion_admin_login_challenges_email_idx
  on public.zion_admin_login_challenges (email);

create index if not exists zion_admin_login_challenges_expires_at_idx
  on public.zion_admin_login_challenges (expires_at);

create index if not exists zion_admin_login_challenges_consumed_at_idx
  on public.zion_admin_login_challenges (consumed_at);

create index if not exists zion_admin_login_challenges_invalidated_at_idx
  on public.zion_admin_login_challenges (invalidated_at);

create index if not exists zion_admin_login_challenges_active_user_idx
  on public.zion_admin_login_challenges (user_id, created_at desc)
  where consumed_at is null
    and invalidated_at is null;

alter table public.zion_admin_login_challenges enable row level security;

revoke all on table public.zion_admin_login_challenges from public;
revoke all on table public.zion_admin_login_challenges from anon;
revoke all on table public.zion_admin_login_challenges from authenticated;

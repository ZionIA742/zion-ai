-- ZION | P19-A / Embedded Signup authority
-- Local foundation only. This migration is not applied remotely by this task.

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_embedded_signup_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id uuid NOT NULL,
  user_id uuid NOT NULL,
  connection_mode text NOT NULL CHECK (connection_mode IN ('standard', 'business_app_coexistence')),
  meta_app_id text NOT NULL,
  meta_config_id text NOT NULL,
  status text NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'processing', 'consumed', 'rejected', 'expired')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_embedded_signup_attempts_scope_idx
  ON public.whatsapp_embedded_signup_attempts (organization_id, store_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_embedded_signup_attempts_expiry_idx
  ON public.whatsapp_embedded_signup_attempts (expires_at, status);

ALTER TABLE public.whatsapp_embedded_signup_attempts
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.whatsapp_embedded_signup_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.whatsapp_embedded_signup_attempts TO service_role;

COMMIT;

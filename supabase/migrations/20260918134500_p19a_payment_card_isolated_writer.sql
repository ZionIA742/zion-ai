begin;

-- P19-A 3.4
-- Isolated canonical writer for the Settings > Comercial > Pagamentos card.
--
-- Ownership:
--   THIS CARD:
--     accepted_payment_methods
--     pix_key_type
--     pix_key
--     pix_holder_name
--     installments_enabled
--     max_installments
--     installment_interest_policy
--     payment_notes
--
--   PRESERVED FROM CURRENT CANONICAL AUTHORITY:
--     down_payment_mode
--     down_payment_value_type
--     down_payment_percent
--     down_payment_amount_cents
--
-- The existing canonical writer remains responsible for validation
-- and legacy mirrors.

create or replace function public.upsert_store_payment_methods_and_terms_with_legacy_mirror_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_accepted_payment_methods text[],
  p_pix_key_type text default null,
  p_pix_key text default null,
  p_pix_holder_name text default null,
  p_installments_enabled boolean default false,
  p_max_installments integer default null,
  p_installment_interest_policy text default null,
  p_payment_notes text default null
)
returns public.store_payment_settings
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
set row_security = off
as $function$
declare
  v_existing public.store_payment_settings%rowtype;
  v_result public.store_payment_settings%rowtype;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  -- Lock the latest canonical row so a Payments save cannot replay
  -- stale Entry values from the browser.
  select payment_row.*
  into v_existing
  from public.store_payment_settings payment_row
  where payment_row.organization_id = p_organization_id
    and payment_row.store_id = p_store_id
  for update;

  v_result :=
    public.upsert_store_payment_settings_with_legacy_mirror_scoped(
      p_organization_id => p_organization_id,
      p_store_id => p_store_id,

      p_accepted_payment_methods => p_accepted_payment_methods,
      p_pix_key_type => p_pix_key_type,
      p_pix_key => p_pix_key,
      p_pix_holder_name => p_pix_holder_name,

      p_down_payment_mode =>
        coalesce(v_existing.down_payment_mode, 'none'),

      p_down_payment_value_type =>
        v_existing.down_payment_value_type,

      p_down_payment_percent =>
        v_existing.down_payment_percent,

      p_down_payment_amount_cents =>
        v_existing.down_payment_amount_cents,

      p_installments_enabled =>
        coalesce(p_installments_enabled, false),

      p_max_installments =>
        p_max_installments,

      p_installment_interest_policy =>
        p_installment_interest_policy,

      p_payment_notes =>
        p_payment_notes
    );

  return v_result;
end;
$function$;

alter function public.upsert_store_payment_methods_and_terms_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  boolean,
  integer,
  text,
  text
)
owner to postgres;

revoke all
on function public.upsert_store_payment_methods_and_terms_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  boolean,
  integer,
  text,
  text
)
from public, anon, service_role;

grant execute
on function public.upsert_store_payment_methods_and_terms_with_legacy_mirror_scoped(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  boolean,
  integer,
  text,
  text
)
to authenticated;

commit;
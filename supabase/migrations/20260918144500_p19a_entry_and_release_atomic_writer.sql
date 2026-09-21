begin;

create or replace function public.upsert_store_entry_and_release_rules_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_down_payment_mode text,
  p_down_payment_value_type text,
  p_down_payment_percent numeric,
  p_down_payment_amount_cents integer,
  p_down_payment_case_rule text,
  p_entry_due_trigger text,
  p_entry_due_other text,
  p_balance_due_trigger text,
  p_balance_due_other text,
  p_payment_blocking_actions text[],
  p_payment_blocking_other text
)
returns public.store_payment_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_existing public.store_payment_settings%rowtype;
  v_result public.store_payment_settings%rowtype;

  v_down_payment_mode text :=
    nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_down_payment_mode, ''))), '');

  v_down_payment_value_type text :=
    nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_down_payment_value_type, ''))), '');

  v_down_payment_percent numeric := null;
  v_down_payment_amount_cents integer := null;

  v_down_payment_case_rule text :=
    nullif(pg_catalog.btrim(coalesce(p_down_payment_case_rule, '')), '');

  v_entry_due_trigger text :=
    nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_entry_due_trigger, ''))), '');

  v_entry_due_other text :=
    nullif(pg_catalog.btrim(coalesce(p_entry_due_other, '')), '');

  v_balance_due_trigger text :=
    nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_balance_due_trigger, ''))), '');

  v_balance_due_other text :=
    nullif(pg_catalog.btrim(coalesce(p_balance_due_other, '')), '');

  v_payment_blocking_actions text[] := '{}'::text[];

  v_payment_blocking_other text :=
    nullif(pg_catalog.btrim(coalesce(p_payment_blocking_other, '')), '');

  v_payment_extensions jsonb;
  v_payment_execution_rules jsonb;
begin
  perform public.assert_store_settings_experience_policies_scope(
    p_organization_id,
    p_store_id
  );

  select payment_row.*
  into v_existing
  from public.store_payment_settings payment_row
  where payment_row.organization_id = p_organization_id
    and payment_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message =
        'payment settings must be configured before entry and release rules';
  end if;

  if v_down_payment_mode is null
     or v_down_payment_mode not in ('none', 'optional', 'required') then
    raise exception using
      errcode = '22023',
      message = 'down payment mode is invalid';
  end if;

  if v_down_payment_mode = 'none' then
    v_down_payment_value_type := null;
    v_down_payment_percent := null;
    v_down_payment_amount_cents := null;
    v_down_payment_case_rule := null;
    v_entry_due_trigger := null;
    v_entry_due_other := null;
  else
    if v_down_payment_value_type is null
       or v_down_payment_value_type not in ('percent', 'fixed', 'case_by_case') then
      raise exception using
        errcode = '22023',
        message = 'down payment value type is required';
    end if;

    if v_down_payment_value_type = 'percent' then
      if p_down_payment_percent is null
         or p_down_payment_percent <= 0
         or p_down_payment_percent > 100 then
        raise exception using
          errcode = '22023',
          message = 'down payment percent must be greater than 0 and at most 100';
      end if;

      v_down_payment_percent := p_down_payment_percent;
      v_down_payment_amount_cents := null;
      v_down_payment_case_rule := null;

    elsif v_down_payment_value_type = 'fixed' then
      if p_down_payment_amount_cents is null
         or p_down_payment_amount_cents <= 0 then
        raise exception using
          errcode = '22023',
          message = 'down payment fixed amount must be positive';
      end if;

      v_down_payment_percent := null;
      v_down_payment_amount_cents := p_down_payment_amount_cents;
      v_down_payment_case_rule := null;

    else
      if v_down_payment_case_rule is null then
        raise exception using
          errcode = '22023',
          message = 'down payment case-by-case rule is required';
      end if;

      v_down_payment_percent := null;
      v_down_payment_amount_cents := null;
    end if;

    if v_entry_due_trigger is null
       or v_entry_due_trigger not in (
         'fechamento',
         'antes_pedido',
         'antes_agendar',
         'antes_iniciar',
         'outro'
       ) then
      raise exception using
        errcode = '22023',
        message = 'entry due trigger is invalid';
    end if;

    if v_entry_due_trigger = 'outro' then
      if v_entry_due_other is null then
        raise exception using
          errcode = '22023',
          message = 'entry due other detail is required';
      end if;
    else
      v_entry_due_other := null;
    end if;
  end if;

  if v_balance_due_trigger is null
     or v_balance_due_trigger not in (
       'fechamento',
       'antes_entrega',
       'antes_retirada',
       'antes_instalacao',
       'apos_instalacao',
       'parcelas',
       'outro'
     ) then
    raise exception using
      errcode = '22023',
      message = 'balance due trigger is invalid';
  end if;

  if v_balance_due_trigger = 'outro' then
    if v_balance_due_other is null then
      raise exception using
        errcode = '22023',
        message = 'balance due other detail is required';
    end if;
  else
    v_balance_due_other := null;
  end if;

  select coalesce(
    pg_catalog.array_agg(
      normalized_action.action_code
      order by normalized_action.first_ordinality
    ),
    '{}'::text[]
  )
  into v_payment_blocking_actions
  from (
    select
      pg_catalog.lower(
        pg_catalog.btrim(action_row.action_value)
      ) as action_code,
      min(action_row.ordinality) as first_ordinality
    from pg_catalog.unnest(
      coalesce(p_payment_blocking_actions, '{}'::text[])
    ) with ordinality as action_row(action_value, ordinality)
    where nullif(
      pg_catalog.btrim(coalesce(action_row.action_value, '')),
      ''
    ) is not null
    group by
      pg_catalog.lower(
        pg_catalog.btrim(action_row.action_value)
      )
  ) normalized_action;

  if coalesce(
       pg_catalog.array_length(v_payment_blocking_actions, 1),
       0
     ) = 0 then
    raise exception using
      errcode = '22023',
      message = 'at least one payment blocking action is required';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(v_payment_blocking_actions)
      as action_row(action_code)
    where action_row.action_code not in (
      'agendar_instalacao',
      'iniciar_instalacao',
      'liberar_entrega',
      'liberar_retirada',
      'concluir_venda',
      'nenhuma',
      'outro'
    )
  ) then
    raise exception using
      errcode = '22023',
      message = 'payment blocking action is invalid';
  end if;

  if 'nenhuma' = any(v_payment_blocking_actions)
     and coalesce(
       pg_catalog.array_length(v_payment_blocking_actions, 1),
       0
     ) <> 1 then
    raise exception using
      errcode = '22023',
      message = 'payment blocking action nenhuma must be exclusive';
  end if;

  if 'outro' = any(v_payment_blocking_actions) then
    if v_payment_blocking_other is null then
      raise exception using
        errcode = '22023',
        message = 'payment blocking other detail is required';
    end if;
  else
    v_payment_blocking_other := null;
  end if;

  v_result :=
    public.upsert_store_payment_settings_with_legacy_mirror_scoped(
      p_organization_id => p_organization_id,
      p_store_id => p_store_id,
      p_accepted_payment_methods => v_existing.accepted_payment_methods,
      p_pix_key_type => v_existing.pix_key_type,
      p_pix_key => v_existing.pix_key,
      p_pix_holder_name => v_existing.pix_holder_name,
      p_down_payment_mode => v_down_payment_mode,
      p_down_payment_value_type => v_down_payment_value_type,
      p_down_payment_percent => v_down_payment_percent,
      p_down_payment_amount_cents => v_down_payment_amount_cents,
      p_installments_enabled => v_existing.installments_enabled,
      p_max_installments => v_existing.max_installments,
      p_installment_interest_policy =>
        v_existing.installment_interest_policy,
      p_payment_notes => v_existing.payment_notes
    );

  v_payment_extensions :=
    coalesce(v_result.payment_extensions, '{}'::jsonb)
    - 'down_payment_case_rule';

  if v_down_payment_value_type = 'case_by_case' then
    v_payment_extensions :=
      v_payment_extensions
      || pg_catalog.jsonb_build_object(
        'down_payment_case_rule',
        v_down_payment_case_rule
      );
  end if;

  v_payment_execution_rules :=
    coalesce(v_result.payment_execution_rules, '{}'::jsonb)
    - 'entry_due_trigger'
    - 'entry_due_other'
    - 'balance_due_trigger'
    - 'balance_due_other'
    - 'payment_blocking_actions'
    - 'payment_blocking_other';

  if v_down_payment_mode <> 'none' then
    v_payment_execution_rules :=
      v_payment_execution_rules
      || pg_catalog.jsonb_build_object(
        'entry_due_trigger',
        v_entry_due_trigger
      );

    if v_entry_due_trigger = 'outro' then
      v_payment_execution_rules :=
        v_payment_execution_rules
        || pg_catalog.jsonb_build_object(
          'entry_due_other',
          v_entry_due_other
        );
    end if;
  end if;

  v_payment_execution_rules :=
    v_payment_execution_rules
    || pg_catalog.jsonb_build_object(
      'balance_due_trigger',
      v_balance_due_trigger,
      'payment_blocking_actions',
      pg_catalog.to_jsonb(v_payment_blocking_actions)
    );

  if v_balance_due_trigger = 'outro' then
    v_payment_execution_rules :=
      v_payment_execution_rules
      || pg_catalog.jsonb_build_object(
        'balance_due_other',
        v_balance_due_other
      );
  end if;

  if 'outro' = any(v_payment_blocking_actions) then
    v_payment_execution_rules :=
      v_payment_execution_rules
      || pg_catalog.jsonb_build_object(
        'payment_blocking_other',
        v_payment_blocking_other
      );
  end if;

  update public.store_payment_settings payment_row
  set
    payment_extensions = v_payment_extensions,
    payment_execution_rules = v_payment_execution_rules
  where payment_row.organization_id = p_organization_id
    and payment_row.store_id = p_store_id
  returning payment_row.*
  into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_entry_and_release_rules_scoped(
  uuid,
  uuid,
  text,
  text,
  numeric,
  integer,
  text,
  text,
  text,
  text,
  text,
  text[],
  text
) owner to postgres;

revoke all on function public.upsert_store_entry_and_release_rules_scoped(
  uuid,
  uuid,
  text,
  text,
  numeric,
  integer,
  text,
  text,
  text,
  text,
  text,
  text[],
  text
) from public, anon, authenticated, service_role;

grant execute on function public.upsert_store_entry_and_release_rules_scoped(
  uuid,
  uuid,
  text,
  text,
  numeric,
  integer,
  text,
  text,
  text,
  text,
  text,
  text[],
  text
) to authenticated;

comment on function public.upsert_store_entry_and_release_rules_scoped(
  uuid,
  uuid,
  text,
  text,
  numeric,
  integer,
  text,
  text,
  text,
  text,
  text,
  text[],
  text
) is
  'Atomic canonical writer for Entry and order-release payment rules. '
  'Preserves the current payment-method/Pix/installment authority server-side, '
  'normalizes dependent Entry fields, updates only owned JSON keys, '
  'and keeps the existing payment legacy mirrors through the canonical payment writer.';

notify pgrst, 'reload schema';

commit;
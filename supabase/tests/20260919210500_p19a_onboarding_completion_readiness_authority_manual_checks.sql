-- P19-A / Bloco 3 / Etapa 3.6
-- Manual checks: shared onboarding completion readiness authority
--
-- Este teste usa transação + ROLLBACK.
-- Nenhuma alteração de dados deve permanecer.

begin;

do $$
declare
  v_org_id uuid;
  v_store_id uuid;

  v_is_ready boolean;
  v_reason_code text;

  v_row public.store_onboarding%rowtype;
begin
  -- ==========================================================
  -- 1. RESOLVER LOJA DEV ZION
  -- ==========================================================

  select
    store_row.organization_id,
    store_row.id
  into
    v_org_id,
    v_store_id
  from public.stores store_row
  where store_row.name = 'ZION'
  order by store_row.created_at asc
  limit 1;

  if v_org_id is null or v_store_id is null then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: ZION store not found';
  end if;

  -- ==========================================================
  -- 2. OBJETOS CANÔNICOS DEVEM EXISTIR
  -- ==========================================================

  if to_regprocedure(
    'public.resolve_store_onboarding_completion_readiness_internal(uuid,uuid)'
  ) is null then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: internal readiness resolver missing';
  end if;

  if to_regprocedure(
    'public.read_store_onboarding_completion_readiness_scoped(uuid,uuid)'
  ) is null then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: scoped readiness reader missing';
  end if;

  if to_regprocedure(
    'public.onboarding_complete_store_onboarding_scoped(uuid,uuid)'
  ) is null then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: canonical completion writer missing';
  end if;

  -- ==========================================================
  -- 3. PRIVILÉGIOS
  -- ==========================================================

  if has_function_privilege(
    'anon',
    'public.read_store_onboarding_completion_readiness_scoped(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: anon can execute readiness reader';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.read_store_onboarding_completion_readiness_scoped(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: authenticated cannot execute readiness reader';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.read_store_onboarding_completion_readiness_scoped(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: service_role cannot execute readiness reader';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.resolve_store_onboarding_completion_readiness_internal(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: authenticated can execute internal resolver';
  end if;

  if has_function_privilege(
    'service_role',
    'public.resolve_store_onboarding_completion_readiness_internal(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: service_role can execute internal resolver';
  end if;

  -- ==========================================================
  -- 4. STORE SCOPE INVÁLIDO DEVE FALHAR NO READER
  -- ==========================================================

  begin
    perform *
    from public.read_store_onboarding_completion_readiness_scoped(
      gen_random_uuid(),
      v_store_id
    );

    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: readiness reader accepted invalid scope';
  exception
    when others then
      if sqlerrm = 'store scope is not authorized' then
        null;
      else
        raise;
      end if;
  end;

  -- ==========================================================
  -- 5. PREPARAR IN_PROGRESS TEMPORARIAMENTE
  -- ==========================================================

  insert into public.store_onboarding (
    store_id,
    organization_id,
    status,
    completed_at
  )
  values (
    v_store_id,
    v_org_id,
    'in_progress',
    null
  )
  on conflict (store_id) do update set
    organization_id = excluded.organization_id,
    status = 'in_progress',
    completed_at = null,
    updated_at = now();

  -- ==========================================================
  -- 6. HAPPY PATH DO READER ANTES DA CONCLUSÃO
  -- ==========================================================

  select
    readiness_row.is_ready,
    readiness_row.reason_code
  into
    v_is_ready,
    v_reason_code
  from public.read_store_onboarding_completion_readiness_scoped(
    v_org_id,
    v_store_id
  ) readiness_row;

  if v_is_ready is not true then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: canonical reader says valid store is not ready: %',
      coalesce(v_reason_code, '<null>');
  end if;

  if v_reason_code is not null then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: ready reader returned reason: %',
      v_reason_code;
  end if;

  -- ==========================================================
  -- 7. MESMA FALHA: READER + WRITER
  --
  -- CITY fica NULL apenas dentro do sub-bloco.
  -- A exceção reverte automaticamente a alteração temporária.
  -- ==========================================================

  begin
    update public.store_strategy_settings strategy_row
    set city = null
    where strategy_row.organization_id = v_org_id
      and strategy_row.store_id = v_store_id;

    select
      readiness_row.is_ready,
      readiness_row.reason_code
    into
      v_is_ready,
      v_reason_code
    from public.read_store_onboarding_completion_readiness_scoped(
      v_org_id,
      v_store_id
    ) readiness_row;

    if v_is_ready is not false then
      raise exception
        'P19A_36_MANUAL_CHECK_FAILED: reader accepted missing city';
    end if;

    if v_reason_code <> 'P19A_ONBOARDING_NOT_READY:CITY' then
      raise exception
        'P19A_36_MANUAL_CHECK_FAILED: reader city reason mismatch: %',
        coalesce(v_reason_code, '<null>');
    end if;

    begin
      perform public.onboarding_complete_store_onboarding_scoped(
        v_org_id,
        v_store_id
      );

      raise exception
        'P19A_36_MANUAL_CHECK_FAILED: completion accepted missing city';
    exception
      when others then
        if sqlerrm = 'P19A_ONBOARDING_NOT_READY:CITY' then
          null;
        else
          raise;
        end if;
    end;

    raise exception
      'P19A_36_EXPECTED_SUBTRANSACTION_ROLLBACK';
  exception
    when others then
      if sqlerrm = 'P19A_36_EXPECTED_SUBTRANSACTION_ROLLBACK' then
        null;
      else
        raise;
      end if;
  end;

  -- ==========================================================
  -- 8. APÓS ROLLBACK DO CENÁRIO, READER DEVE VOLTAR A READY
  -- ==========================================================

  select
    readiness_row.is_ready,
    readiness_row.reason_code
  into
    v_is_ready,
    v_reason_code
  from public.read_store_onboarding_completion_readiness_scoped(
    v_org_id,
    v_store_id
  ) readiness_row;

  if v_is_ready is not true or v_reason_code is not null then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: readiness did not recover after rollback';
  end if;

  -- ==========================================================
  -- 9. CONCLUSÃO CANÔNICA DEVE PASSAR
  -- ==========================================================

  select *
  into v_row
  from public.onboarding_complete_store_onboarding_scoped(
    v_org_id,
    v_store_id
  );

  if v_row.status <> 'completed' then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: canonical completion did not complete';
  end if;

  if v_row.completed_at is null then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: canonical completion did not write completed_at';
  end if;

  -- ==========================================================
  -- 10. REPLAY DE COMPLETED CONTINUA IDEMPOTENTE
  -- ==========================================================

  select *
  into v_row
  from public.onboarding_complete_store_onboarding_scoped(
    v_org_id,
    v_store_id
  );

  if v_row.status <> 'completed' then
    raise exception
      'P19A_36_MANUAL_CHECK_FAILED: completed replay changed state';
  end if;

  raise notice
    'P19A_36_ONBOARDING_COMPLETION_READINESS_AUTHORITY_MANUAL_CHECK_PASS';
end;
$$;

select
  'P19A_36_ONBOARDING_COMPLETION_READINESS_AUTHORITY_MANUAL_CHECK_PASS'
    as result;

rollback;
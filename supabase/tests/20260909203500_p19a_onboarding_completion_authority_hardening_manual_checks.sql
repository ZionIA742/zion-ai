-- P19-A / Bloco 3 / Passada B
-- Manual checks: onboarding completion authority hardening
--
-- Este teste usa transação + ROLLBACK.
-- Nenhuma alteração de dados deve permanecer.

begin;

do $$
declare
  v_org_id uuid;
  v_store_id uuid;
  v_row public.store_onboarding%rowtype;
  v_constraint_count integer;
begin
  -- ==========================================================
  -- 1. RESOLVER LOJA DEV ZION
  -- ==========================================================

  select store_row.organization_id, store_row.id
  into v_org_id, v_store_id
  from public.stores store_row
  where store_row.name = 'ZION'
  order by store_row.created_at asc
  limit 1;

  if v_store_id is null or v_org_id is null then
    raise exception 'P19A_MANUAL_CHECK_FAILED: ZION store not found';
  end if;

  -- ==========================================================
  -- 2. OBJETOS ESPERADOS
  -- ==========================================================

  if to_regprocedure(
    'public.onboarding_complete_store_onboarding_scoped(uuid,uuid)'
  ) is null then
    raise exception
      'P19A_MANUAL_CHECK_FAILED: canonical completion RPC missing';
  end if;

  if to_regprocedure(
    'public.onboarding_upsert_store_onboarding_scoped(uuid,uuid,text)'
  ) is null then
    raise exception
      'P19A_MANUAL_CHECK_FAILED: generic onboarding writer missing';
  end if;

  select count(*)
  into v_constraint_count
  from pg_constraint
  where conname = 'store_onboarding_store_scope_fkey'
    and conrelid = 'public.store_onboarding'::regclass;

  if v_constraint_count <> 1 then
    raise exception
      'P19A_MANUAL_CHECK_FAILED: store scope FK missing';
  end if;

  -- ==========================================================
  -- 3. PRIVILÉGIOS
  -- ==========================================================

  if has_function_privilege(
    'anon',
    'public.onboarding_complete_store_onboarding_scoped(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception
      'P19A_MANUAL_CHECK_FAILED: anon can execute completion RPC';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.onboarding_complete_store_onboarding_scoped(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception
      'P19A_MANUAL_CHECK_FAILED: authenticated cannot execute completion RPC';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.onboarding_complete_store_onboarding_scoped(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception
      'P19A_MANUAL_CHECK_FAILED: service_role cannot execute completion RPC';
  end if;

  -- ==========================================================
  -- 4. PREPARAR STATUS IN_PROGRESS TEMPORARIAMENTE
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
  -- 5. RPC GENÉRICO NÃO PODE INICIAR COMPLETED
  -- ==========================================================

  begin
    perform public.onboarding_upsert_store_onboarding_scoped(
      v_org_id,
      v_store_id,
      'completed'
    );

    raise exception
      'P19A_MANUAL_CHECK_FAILED: generic RPC accepted initial completed';
  exception
    when others then
      if sqlerrm =
        'P19A_ONBOARDING_COMPLETION_REQUIRES_CANONICAL_RPC'
      then
        null;
      else
        raise;
      end if;
  end;

  -- ==========================================================
  -- 6. STORE SCOPE INVÁLIDO DEVE FALHAR
  -- ==========================================================

  begin
    perform public.onboarding_upsert_store_onboarding_scoped(
      gen_random_uuid(),
      v_store_id,
      'in_progress'
    );

    raise exception
      'P19A_MANUAL_CHECK_FAILED: invalid store scope was accepted';
  exception
    when others then
      if sqlerrm = 'store scope is not authorized' then
        null;
      else
        raise;
      end if;
  end;

  -- ==========================================================
  -- 7. READINESS DEVE SER FAIL-CLOSED
  --
  -- Tornamos CITY temporariamente NULL.
  -- A exceção reverte automaticamente esse sub-bloco.
  -- ==========================================================

  begin
    update public.store_strategy_settings strategy_row
    set city = null
    where strategy_row.organization_id = v_org_id
      and strategy_row.store_id = v_store_id;

    perform public.onboarding_complete_store_onboarding_scoped(
      v_org_id,
      v_store_id
    );

    raise exception
      'P19A_MANUAL_CHECK_FAILED: completion accepted missing city';
  exception
    when others then
      if sqlerrm = 'P19A_ONBOARDING_NOT_READY:CITY' then
        null;
      else
        raise;
      end if;
  end;

  -- ==========================================================
  -- 8. HAPPY PATH CANÔNICO
  -- ==========================================================

  select *
  into v_row
  from public.onboarding_complete_store_onboarding_scoped(
    v_org_id,
    v_store_id
  );

  if v_row.status <> 'completed' then
    raise exception
      'P19A_MANUAL_CHECK_FAILED: canonical RPC did not complete';
  end if;

  if v_row.completed_at is null then
    raise exception
      'P19A_MANUAL_CHECK_FAILED: completed_at was not written';
  end if;

  -- ==========================================================
  -- 9. REPLAY COMPLETED VIA RPC GENÉRICO É IDEMPOTENTE
  -- ==========================================================

  select *
  into v_row
  from public.onboarding_upsert_store_onboarding_scoped(
    v_org_id,
    v_store_id,
    'completed'
  );

  if v_row.status <> 'completed' then
    raise exception
      'P19A_MANUAL_CHECK_FAILED: completed replay changed state';
  end if;

  -- ==========================================================
  -- 10. COMPLETED É TERMINAL
  --
  -- Nem chamada antiga tentando in_progress pode reabrir.
  -- ==========================================================

  select *
  into v_row
  from public.onboarding_upsert_store_onboarding_scoped(
    v_org_id,
    v_store_id,
    'in_progress'
  );

  if v_row.status <> 'completed' then
    raise exception
      'P19A_MANUAL_CHECK_FAILED: completed was downgraded';
  end if;

  raise notice
    'P19A_ONBOARDING_COMPLETION_HARDENING_MANUAL_CHECK_PASS';
end;
$$;

select
  'P19A_ONBOARDING_COMPLETION_HARDENING_MANUAL_CHECK_PASS'
    as result;

rollback;

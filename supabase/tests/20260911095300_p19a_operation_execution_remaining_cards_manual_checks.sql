begin;

create temp table p19a_operation_remaining_checks (
  check_no integer primary key,
  check_name text not null,
  status text not null check (
    status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')
  ),
  details text null
) on commit drop;

create or replace function pg_temp.p19a_record(
  p_no integer,
  p_name text,
  p_pass boolean,
  p_details text default null
)
returns void
language plpgsql
as $$
begin
  insert into p19a_operation_remaining_checks(
    check_no,
    check_name,
    status,
    details
  )
  values (
    p_no,
    p_name,
    case when p_pass then 'PASS' else 'SUT_FAIL' end,
    p_details
  );
exception when others then
  insert into p19a_operation_remaining_checks(
    check_no,
    check_name,
    status,
    details
  )
  values (
    p_no,
    p_name,
    'HARNESS_ERROR',
    sqlstate || ' ' || sqlerrm
  );
end;
$$;


do $$
declare
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();

  v_row public.store_operation_execution_policies;

  v_pool_marker timestamptz;
  v_delivery_marker timestamptz;
  v_pickup_marker timestamptz;
  v_services_marker timestamptz;

  v_delivery_before jsonb;
  v_pickup_before jsonb;
  v_services_before jsonb;

  v_count integer;
begin

  insert into public.organizations(id, name)
  values
    (v_org_a, 'P19A remaining operation org A'),
    (v_org_b, 'P19A remaining operation org B');

  insert into public.stores(id, organization_id, name)
  values
    (v_store_a, v_org_a, 'P19A remaining operation store A'),
    (v_store_b, v_org_b, 'P19A remaining operation store B');


  -- ==========================================================
  -- 1. NEVER CONFIGURED
  -- ==========================================================

  select count(*)
  into v_count
  from public.store_operation_execution_policies
  where organization_id = v_org_a
    and store_id = v_store_a;

  perform pg_temp.p19a_record(
    1,
    'cards 7-10 nao nascem implicitamente configurados',
    v_count = 0,
    format('rows=%s', v_count)
  );


  -- ==========================================================
  -- 2. CARD 7 VALID WRITE
  -- ==========================================================

  select *
  into v_row
  from public.upsert_store_operation_pool_replacement_configuration_scoped(
    v_org_a,
    v_store_a,
    true,
    jsonb_build_object(
      'situations',
        '["nova_da_loja","danificada"]'::jsonb,
      'uses_installation_team',
        'depende',
      'team_rule',
        'E2E depende da complexidade da troca',
      'duration_mode',
        'varia',
      'duration_rule',
        'E2E varia conforme retirada e preparacao',
      'removes_old',
        'sim',
      'disposal_included',
        'caso_a_caso',
      'disposal_rule',
        'E2E descarte depende do local',
      'requires_visit',
        'depende',
      'visit_rule',
        'E2E visita para validar acesso e medidas',
      'includes',
        '["desconexao","retirada_antiga","posicionamento","testes"]'::jsonb,
      'excludes',
        '["paisagismo","obra_entorno"]'::jsonb,
      'notes',
        'E2E P19-A CARD 7 TROCA'
    )
  );

  v_pool_marker := v_row.pool_replacement_configured_at;

  perform pg_temp.p19a_record(
    2,
    'card 7 grava policy canonica e marker',
    v_row.pool_replacement_configured_at is not null
      and v_row.pool_replacement_policy ->> 'duration_mode' = 'varia'
      and v_row.pool_replacement_policy ->> 'disposal_included' = 'caso_a_caso'
      and v_row.pool_replacement_policy ->> 'notes'
        = 'E2E P19-A CARD 7 TROCA',
    v_row.pool_replacement_policy::text
  );


  -- ==========================================================
  -- 3. CARD 7 REPLAY PRESERVES FIRST MARKER
  -- ==========================================================

  select *
  into v_row
  from public.upsert_store_operation_pool_replacement_configuration_scoped(
    v_org_a,
    v_store_a,
    true,
    jsonb_build_object(
      'situations',
        '["nova_da_loja","danificada"]'::jsonb,
      'uses_installation_team',
        'depende',
      'team_rule',
        'E2E depende da complexidade da troca',
      'duration_mode',
        'varia',
      'duration_rule',
        'E2E varia conforme retirada e preparacao',
      'removes_old',
        'sim',
      'disposal_included',
        'caso_a_caso',
      'disposal_rule',
        'E2E descarte depende do local',
      'requires_visit',
        'depende',
      'visit_rule',
        'E2E visita para validar acesso e medidas',
      'includes',
        '["desconexao","retirada_antiga","posicionamento","testes"]'::jsonb,
      'excludes',
        '["paisagismo","obra_entorno"]'::jsonb,
      'notes',
        'E2E P19-A CARD 7 TROCA'
    )
  );

  perform pg_temp.p19a_record(
    3,
    'card 7 replay preserva primeiro configured_at',
    v_row.pool_replacement_configured_at = v_pool_marker,
    format(
      'first=%s replay=%s',
      v_pool_marker,
      v_row.pool_replacement_configured_at
    )
  );


  -- ==========================================================
  -- 4. CARD 7 REQUIRED CONDITIONAL RULE
  -- ==========================================================

  begin
    perform public.upsert_store_operation_pool_replacement_configuration_scoped(
      v_org_a,
      v_store_a,
      true,
      jsonb_build_object(
        'situations', '["nova_da_loja"]'::jsonb,
        'uses_installation_team', 'sim',
        'duration_mode', 'varia',
        'removes_old', 'sim',
        'disposal_included', 'nao',
        'requires_visit', 'nao',
        'includes', '[]'::jsonb,
        'excludes', '[]'::jsonb,
        'notes', 'invalid missing duration rule'
      )
    );

    perform pg_temp.p19a_record(
      4,
      'card 7 varia sem duration_rule e bloqueado',
      false,
      'invalid policy accepted'
    );
  exception when check_violation then
    perform pg_temp.p19a_record(
      4,
      'card 7 varia sem duration_rule e bloqueado',
      true
    );
  end;


  -- ==========================================================
  -- 5. CARD 8 VALID, INCLUDING UI ALIGNMENT FIX
  -- ==========================================================

  select *
  into v_row
  from public.upsert_store_operation_delivery_configuration_scoped(
    v_org_a,
    v_store_a,
    true,
    jsonb_build_object(
      'items',
        '["piscina_com_instalacao","equipamentos"]'::jsonb,
      'with_installation_mode',
        'depende',
      'with_installation_notes',
        'E2E relacao com instalacao depende do projeto',
      'provider',
        'ambos',
      'provider_rule',
        'E2E pedidos grandes usam parceiro',
      'uses_installation_team',
        'depende',
      'installation_team_rule',
        'E2E equipe depende do tipo de entrega',
      'pricing_mode',
        'caso_a_caso',
      'case_factors',
        '["distancia","acesso"]'::jsonb,
      'case_rule',
        'E2E calcula por distancia e acesso',
      'release_gates',
        '["pagamento","produto","endereco"]'::jsonb,
      'unloading_mode',
        'depende',
      'notes',
        'E2E P19-A CARD 8 ENTREGA'
    )
  );

  v_delivery_marker := v_row.delivery_configured_at;

  perform pg_temp.p19a_record(
    5,
    'card 8 aceita modo depende sem timing inexistente na UI',
    v_row.delivery_configured_at is not null
      and v_row.delivery_policy ->> 'with_installation_mode' = 'depende'
      and not (v_row.delivery_policy ? 'with_installation_timing')
      and v_row.delivery_policy ->> 'pricing_mode' = 'caso_a_caso'
      and v_row.delivery_policy ->> 'notes'
        = 'E2E P19-A CARD 8 ENTREGA',
    v_row.delivery_policy::text
  );


  -- ==========================================================
  -- 6. CARD 8 DEAD LEGACY FIELD MUST FAIL
  -- ==========================================================

  begin
    perform public.upsert_store_operation_delivery_configuration_scoped(
      v_org_a,
      v_store_a,
      true,
      jsonb_build_object(
        'items', '["equipamentos"]'::jsonb,
        'provider', 'parceiro',
        'pricing_mode', 'gratuito',
        'release_gates', '[]'::jsonb,
        'unloading_mode', 'transporta',
        'coverage_mode', 'legacy_dead_field'
      )
    );

    perform pg_temp.p19a_record(
      6,
      'card 8 rejeita coverage_mode legado nao renderizado',
      false,
      'dead field accepted'
    );
  exception when check_violation then
    perform pg_temp.p19a_record(
      6,
      'card 8 rejeita coverage_mode legado nao renderizado',
      true
    );
  end;


  -- ==========================================================
  -- 7. CARD 8 FIXED FREIGHT REQUIRES VALUE
  -- ==========================================================

  begin
    perform public.upsert_store_operation_delivery_configuration_scoped(
      v_org_a,
      v_store_a,
      true,
      jsonb_build_object(
        'items', '["equipamentos"]'::jsonb,
        'provider', 'parceiro',
        'pricing_mode', 'fixo',
        'release_gates', '["pagamento"]'::jsonb,
        'unloading_mode', 'transporta'
      )
    );

    perform pg_temp.p19a_record(
      7,
      'card 8 frete fixo sem valor e bloqueado',
      false,
      'fixed freight without cents accepted'
    );
  exception when check_violation then
    perform pg_temp.p19a_record(
      7,
      'card 8 frete fixo sem valor e bloqueado',
      true
    );
  end;


  -- ==========================================================
  -- 8. CARD 9 VALID WITHOUT DEAD READY FIELDS
  -- ==========================================================

  select *
  into v_row
  from public.upsert_store_operation_pickup_configuration_scoped(
    v_org_a,
    v_store_a,
    true,
    jsonb_build_object(
      'items',
        '["piscinas","equipamentos","acessorios"]'::jsonb,
      'location_mode',
        'loja',
      'requires_appointment',
        true,
      'third_party_allowed',
        'autorizado',
      'release_gates',
        '["pagamento","separado","identificacao","autorizacao"]'::jsonb,
      'notes',
        'E2E P19-A CARD 9 RETIRADA'
    )
  );

  v_pickup_marker := v_row.pickup_configured_at;

  perform pg_temp.p19a_record(
    8,
    'card 9 grava sem ready_mode legado',
    v_row.pickup_configured_at is not null
      and not (v_row.pickup_policy ? 'ready_mode')
      and v_row.pickup_policy ->> 'location_mode' = 'loja'
      and v_row.pickup_policy ->> 'third_party_allowed' = 'autorizado'
      and v_row.pickup_policy ->> 'notes'
        = 'E2E P19-A CARD 9 RETIRADA',
    v_row.pickup_policy::text
  );


  -- ==========================================================
  -- 9. CARD 9 DEAD READY FIELD MUST FAIL
  -- ==========================================================

  begin
    perform public.upsert_store_operation_pickup_configuration_scoped(
      v_org_a,
      v_store_a,
      true,
      jsonb_build_object(
        'items', '["acessorios"]'::jsonb,
        'location_mode', 'loja',
        'requires_appointment', false,
        'third_party_allowed', 'comprador',
        'release_gates', '[]'::jsonb,
        'ready_mode', 'legacy_dead_field'
      )
    );

    perform pg_temp.p19a_record(
      9,
      'card 9 rejeita ready_mode legado nao renderizado',
      false,
      'dead field accepted'
    );
  exception when check_violation then
    perform pg_temp.p19a_record(
      9,
      'card 9 rejeita ready_mode legado nao renderizado',
      true
    );
  end;


  -- ==========================================================
  -- 10. CARD 10 VALID WITH BOTH CONDITIONAL RULES
  -- ==========================================================

  select *
  into v_row
  from public.upsert_store_operation_technical_services_configuration_scoped(
    v_org_a,
    v_store_a,
    true,
    jsonb_build_object(
      'service_types',
        '["diagnostico","instalacao_equipamento","troca_equipamento"]'::jsonb,
      'equipment_types',
        '["bombas","filtros"]'::jsonb,
      'equipment_installation_origin_policy',
        'depende',
      'equipment_installation_origin_rule',
        'E2E depende do equipamento',
      'equipment_replacement_existing',
        'caso_a_caso',
      'equipment_replacement_existing_rule',
        'E2E substitui apos avaliacao tecnica',
      'notes',
        'E2E P19-A CARD 10 SERVICOS'
    )
  );

  v_services_marker := v_row.technical_services_configured_at;

  perform pg_temp.p19a_record(
    10,
    'card 10 grava servicos e regras condicionais',
    v_row.technical_services_configured_at is not null
      and v_row.technical_services_policy
        ->> 'equipment_installation_origin_policy' = 'depende'
      and v_row.technical_services_policy
        ->> 'equipment_replacement_existing' = 'caso_a_caso'
      and v_row.technical_services_policy ->> 'notes'
        = 'E2E P19-A CARD 10 SERVICOS',
    v_row.technical_services_policy::text
  );


  -- ==========================================================
  -- 11. CARD 10 MISSING CONDITIONAL RULE
  -- ==========================================================

  begin
    perform public.upsert_store_operation_technical_services_configuration_scoped(
      v_org_a,
      v_store_a,
      true,
      jsonb_build_object(
        'service_types',
          '["instalacao_equipamento"]'::jsonb,
        'equipment_types',
          '["bombas"]'::jsonb,
        'equipment_installation_origin_policy',
          'depende',
        'notes',
          'invalid missing origin rule'
      )
    );

    perform pg_temp.p19a_record(
      11,
      'card 10 depende sem regra e bloqueado',
      false,
      'missing conditional rule accepted'
    );
  exception when check_violation then
    perform pg_temp.p19a_record(
      11,
      'card 10 depende sem regra e bloqueado',
      true
    );
  end;


  -- ==========================================================
  -- 12. CROSS-CARD ISOLATION
  -- ==========================================================

  select
    delivery_policy,
    pickup_policy,
    technical_services_policy
  into
    v_delivery_before,
    v_pickup_before,
    v_services_before
  from public.store_operation_execution_policies
  where organization_id = v_org_a
    and store_id = v_store_a;

  perform public.upsert_store_operation_pool_replacement_configuration_scoped(
    v_org_a,
    v_store_a,
    true,
    jsonb_build_object(
      'situations', '["nova_da_loja"]'::jsonb,
      'uses_installation_team', 'nao',
      'duration_mode', 'horas',
      'duration_value', 6,
      'removes_old', 'nao',
      'disposal_included', 'nao',
      'requires_visit', 'nao',
      'includes', '["posicionamento"]'::jsonb,
      'excludes', '["paisagismo"]'::jsonb,
      'notes', 'E2E P19-A CARD 7 TROCA ALTERADA'
    )
  );

  select *
  into v_row
  from public.store_operation_execution_policies
  where organization_id = v_org_a
    and store_id = v_store_a;

  perform pg_temp.p19a_record(
    12,
    'writer do card 7 nao altera cards 8 9 10',
    v_row.delivery_policy = v_delivery_before
      and v_row.pickup_policy = v_pickup_before
      and v_row.technical_services_policy = v_services_before
      and v_row.pool_replacement_configured_at = v_pool_marker,
    'cross-card policies preserved'
  );


  -- ==========================================================
  -- 13. EXPLICIT NO CLEARS ONLY POLICY, NOT MARKER
  -- ==========================================================

  select *
  into v_row
  from public.upsert_store_operation_pickup_configuration_scoped(
    v_org_a,
    v_store_a,
    false,
    null
  );

  perform pg_temp.p19a_record(
    13,
    'card 9 nao explicito limpa policy e preserva marker',
    v_row.pickup_policy is null
      and v_row.pickup_configured_at = v_pickup_marker
      and v_row.delivery_policy is not null
      and v_row.technical_services_policy is not null,
    format(
      'pickup_marker=%s',
      v_row.pickup_configured_at
    )
  );


  -- ==========================================================
  -- 14. DELIVERY REPLAY PRESERVES FIRST MARKER
  -- ==========================================================

  select *
  into v_row
  from public.upsert_store_operation_delivery_configuration_scoped(
    v_org_a,
    v_store_a,
    true,
    jsonb_build_object(
      'items',
        '["piscina_com_instalacao","equipamentos"]'::jsonb,
      'with_installation_mode',
        'depende',
      'with_installation_notes',
        'E2E relacao com instalacao depende do projeto',
      'provider',
        'ambos',
      'provider_rule',
        'E2E pedidos grandes usam parceiro',
      'uses_installation_team',
        'depende',
      'installation_team_rule',
        'E2E equipe depende do tipo de entrega',
      'pricing_mode',
        'caso_a_caso',
      'case_factors',
        '["distancia","acesso"]'::jsonb,
      'case_rule',
        'E2E calcula por distancia e acesso',
      'release_gates',
        '["pagamento","produto","endereco"]'::jsonb,
      'unloading_mode',
        'depende',
      'notes',
        'E2E P19-A CARD 8 ENTREGA'
    )
  );

  perform pg_temp.p19a_record(
    14,
    'card 8 replay preserva primeiro configured_at',
    v_row.delivery_configured_at = v_delivery_marker,
    format(
      'first=%s replay=%s',
      v_delivery_marker,
      v_row.delivery_configured_at
    )
  );


  -- ==========================================================
  -- 15. TECHNICAL SERVICES REPLAY PRESERVES FIRST MARKER
  -- ==========================================================

  select *
  into v_row
  from public.upsert_store_operation_technical_services_configuration_scoped(
    v_org_a,
    v_store_a,
    true,
    jsonb_build_object(
      'service_types',
        '["diagnostico","instalacao_equipamento","troca_equipamento"]'::jsonb,
      'equipment_types',
        '["bombas","filtros"]'::jsonb,
      'equipment_installation_origin_policy',
        'depende',
      'equipment_installation_origin_rule',
        'E2E depende do equipamento',
      'equipment_replacement_existing',
        'caso_a_caso',
      'equipment_replacement_existing_rule',
        'E2E substitui apos avaliacao tecnica',
      'notes',
        'E2E P19-A CARD 10 SERVICOS'
    )
  );

  perform pg_temp.p19a_record(
    15,
    'card 10 replay preserva primeiro configured_at',
    v_row.technical_services_configured_at = v_services_marker,
    format(
      'first=%s replay=%s',
      v_services_marker,
      v_row.technical_services_configured_at
    )
  );


  -- ==========================================================
  -- 16. READER RETURNS CANONICAL ROW
  -- ==========================================================

  select *
  into v_row
  from public.read_store_operation_execution_policies_scoped(
    v_org_a,
    v_store_a
  );

  perform pg_temp.p19a_record(
    16,
    'reader scoped retorna authorities dos cards 7-10',
    v_row.pool_replacement_configured_at is not null
      and v_row.delivery_configured_at is not null
      and v_row.pickup_configured_at is not null
      and v_row.technical_services_configured_at is not null
      and v_row.pool_replacement_policy is not null
      and v_row.delivery_policy is not null
      and v_row.pickup_policy is null
      and v_row.technical_services_policy is not null,
    v_row::text
  );


  -- ==========================================================
  -- 17. CROSS-TENANT SCOPE
  -- ==========================================================

  begin
    perform public.upsert_store_operation_delivery_configuration_scoped(
      v_org_a,
      v_store_b,
      false,
      null
    );

    perform pg_temp.p19a_record(
      17,
      'org A nao pode escrever store B',
      false,
      'cross-tenant store accepted'
    );
  exception when insufficient_privilege then
    perform pg_temp.p19a_record(
      17,
      'org A nao pode escrever store B',
      true
    );
  end;


  -- ==========================================================
  -- 18. TABLE CONSTRAINT: POLICY REQUIRES MARKER
  -- ==========================================================

  begin
    update public.store_operation_execution_policies
    set delivery_configured_at = null
    where organization_id = v_org_a
      and store_id = v_store_a;

    perform pg_temp.p19a_record(
      18,
      'policy nao pode existir sem configured_at',
      false,
      'constraint allowed policy without marker'
    );
  exception when check_violation then
    perform pg_temp.p19a_record(
      18,
      'policy nao pode existir sem configured_at',
      true
    );
  end;


  -- ==========================================================
  -- 19. WRITER GRANTS
  -- ==========================================================

  perform pg_temp.p19a_record(
    19,
    'writers somente authenticated entre roles de API testadas',
    has_function_privilege(
      'authenticated',
      'public.upsert_store_operation_pool_replacement_configuration_scoped(uuid,uuid,boolean,jsonb)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.upsert_store_operation_delivery_configuration_scoped(uuid,uuid,boolean,jsonb)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.upsert_store_operation_pickup_configuration_scoped(uuid,uuid,boolean,jsonb)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.upsert_store_operation_technical_services_configuration_scoped(uuid,uuid,boolean,jsonb)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.upsert_store_operation_delivery_configuration_scoped(uuid,uuid,boolean,jsonb)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.upsert_store_operation_delivery_configuration_scoped(uuid,uuid,boolean,jsonb)',
      'EXECUTE'
    ),
    null
  );


  -- ==========================================================
  -- 20. INTERNAL VALIDATORS NOT EXPOSED TO AUTHENTICATED
  -- ==========================================================

  perform pg_temp.p19a_record(
    20,
    'validators internos nao sao executaveis por authenticated',
    not has_function_privilege(
      'authenticated',
      'public.store_operation_pool_replacement_execution_policy_is_valid(jsonb)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.store_operation_delivery_execution_policy_is_valid(jsonb)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.store_operation_pickup_execution_policy_is_valid(jsonb)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.store_operation_technical_services_execution_policy_is_valid(jsonb)',
      'EXECUTE'
    ),
    null
  );

end;
$$;


select
  check_no,
  check_name,
  status,
  details
from p19a_operation_remaining_checks
order by check_no;

select
  count(*) filter (where status = 'PASS') as pass_count,
  count(*) filter (where status = 'SUT_FAIL') as sut_fail_count,
  count(*) filter (where status = 'HARNESS_ERROR') as harness_error_count,
  count(*) as total_count
from p19a_operation_remaining_checks;

rollback;
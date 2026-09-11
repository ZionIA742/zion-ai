begin;

create temporary table p19a_operation_execution_results (
  scenario_number integer not null,
  scenario_name text not null,
  status text not null,
  detail text not null
) on commit drop;

create temporary table p19a_operation_execution_context (
  organization_id uuid not null,
  store_id uuid not null
) on commit drop;

insert into p19a_operation_execution_context (
  organization_id,
  store_id
)
select
  store_row.organization_id,
  store_row.id
from public.stores store_row
where store_row.organization_id is not null
order by store_row.created_at nulls last, store_row.id
limit 1;

do $$
begin
  if not exists (
    select 1
    from pg_temp.p19a_operation_execution_context
  ) then
    raise exception 'HARNESS_ERROR: no DEV store available';
  end if;
end;
$$;

-- Reset only the new authority for the selected store.
-- Everything is rolled back at the end.
delete from public.store_operation_execution_policies policy_row
using pg_temp.p19a_operation_execution_context context_row
where policy_row.organization_id = context_row.organization_id
  and policy_row.store_id = context_row.store_id;


-- ============================================================
-- 1. TABLE / MARKERS / NO IMPLICIT CONFIGURATION
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_row public.store_operation_execution_policies%rowtype;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  v_row := public.read_store_operation_execution_policies_scoped(
    v_org,
    v_store
  );

  if v_row is not null then
    raise exception 'expected scoped reader to return null before explicit configuration';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    1,
    'sem save explicito nao existe configuracao rica',
    'PASS',
    'reader=null before explicit card configuration'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (1, 'sem save explicito nao existe configuracao rica', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 2. TECHNICAL VISIT TRUE / VALID POLICY
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_result public.store_operation_execution_policies%rowtype;
  v_offers boolean;
  v_pricing text;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  v_result :=
    public.upsert_store_operation_technical_visit_configuration_scoped(
      p_organization_id => v_org,
      p_store_id => v_store,
      p_offers_technical_visit => true,
      p_technical_visit_policy => jsonb_build_object(
        'required_situations', jsonb_build_array('medidas'),
        'optional_situations', jsonb_build_array('cliente_pedir'),
        'team_mode', 'dono_loja',
        'requires_appointment', true,
        'duration_mode', '60',
        'duration_minutes', 60,
        'preconfirm_items', jsonb_build_array('endereco', 'contato'),
        'notes', 'P19-A runner visita'
      ),
      p_technical_visit_pricing_mode => 'free',
      p_technical_visit_fixed_fee_cents => null,
      p_technical_visit_case_by_case_rule => null,
      p_technical_visit_fee_deductible_from_purchase => null
    );

  select
    offers_technical_visit,
    technical_visit_pricing_mode
  into
    v_offers,
    v_pricing
  from public.store_operation_settings
  where organization_id = v_org
    and store_id = v_store;

  if v_result.technical_visit_configured_at is null
     or v_result.technical_visit_policy is null
     or v_offers is distinct from true
     or v_pricing is distinct from 'free' then
    raise exception 'technical visit canonical save mismatch';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    2,
    'visita tecnica true grava policy marker e pricing',
    'PASS',
    'offers=true policy=present marker=set pricing=free'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (2, 'visita tecnica true grava policy marker e pricing', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 3. VISIT MARKER PRESERVES FIRST EXPLICIT SAVE
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_first timestamptz := '2026-01-02 03:04:05+00'::timestamptz;
  v_after timestamptz;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  update public.store_operation_execution_policies
  set technical_visit_configured_at = v_first
  where organization_id = v_org
    and store_id = v_store;

  perform public.upsert_store_operation_technical_visit_configuration_scoped(
    p_organization_id => v_org,
    p_store_id => v_store,
    p_offers_technical_visit => true,
    p_technical_visit_policy => jsonb_build_object(
      'required_situations', jsonb_build_array(),
      'optional_situations', jsonb_build_array(),
      'team_mode', 'equipe_tecnica',
      'requires_appointment', true,
      'duration_mode', '30',
      'duration_minutes', 30,
      'preconfirm_items', jsonb_build_array(),
      'notes', 'replay'
    ),
    p_technical_visit_pricing_mode => 'free',
    p_technical_visit_fixed_fee_cents => null,
    p_technical_visit_case_by_case_rule => null,
    p_technical_visit_fee_deductible_from_purchase => null
  );

  select technical_visit_configured_at
  into v_after
  from public.store_operation_execution_policies
  where organization_id = v_org
    and store_id = v_store;

  if v_after is distinct from v_first then
    raise exception 'first configured_at was overwritten';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    3,
    'replay da visita preserva primeiro configured_at',
    'PASS',
    'technical_visit_configured_at preserved'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (3, 'replay da visita preserva primeiro configured_at', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 4. VISIT INVALID POLICY: MISSING REQUIRED DURATION MODE
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_failed boolean := false;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  begin
    perform public.upsert_store_operation_technical_visit_configuration_scoped(
      p_organization_id => v_org,
      p_store_id => v_store,
      p_offers_technical_visit => true,
      p_technical_visit_policy => jsonb_build_object(
        'required_situations', jsonb_build_array(),
        'optional_situations', jsonb_build_array(),
        'team_mode', 'dono_loja',
        'requires_appointment', true,
        'preconfirm_items', jsonb_build_array()
      ),
      p_technical_visit_pricing_mode => 'free',
      p_technical_visit_fixed_fee_cents => null,
      p_technical_visit_case_by_case_rule => null,
      p_technical_visit_fee_deductible_from_purchase => null
    );
  exception
    when others then
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'missing visit duration_mode was accepted';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    4,
    'visita agendada sem duration mode falha fechado',
    'PASS',
    'invalid policy rejected'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (4, 'visita agendada sem duration mode falha fechado', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 5. PRICING FAILURE MUST ROLLBACK WHOLE VISIT SAVE
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_before_policy jsonb;
  v_before_offers boolean;
  v_after_policy jsonb;
  v_after_offers boolean;
  v_failed boolean := false;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  select technical_visit_policy
  into v_before_policy
  from public.store_operation_execution_policies
  where organization_id = v_org
    and store_id = v_store;

  select offers_technical_visit
  into v_before_offers
  from public.store_operation_settings
  where organization_id = v_org
    and store_id = v_store;

  begin
    perform public.upsert_store_operation_technical_visit_configuration_scoped(
      p_organization_id => v_org,
      p_store_id => v_store,
      p_offers_technical_visit => true,
      p_technical_visit_policy => jsonb_build_object(
        'required_situations', jsonb_build_array('viabilidade'),
        'optional_situations', jsonb_build_array(),
        'team_mode', 'dono_loja',
        'requires_appointment', true,
        'duration_mode', '90',
        'duration_minutes', 90,
        'preconfirm_items', jsonb_build_array()
      ),
      p_technical_visit_pricing_mode => 'fixed',
      p_technical_visit_fixed_fee_cents => 0,
      p_technical_visit_case_by_case_rule => null,
      p_technical_visit_fee_deductible_from_purchase => true
    );
  exception
    when others then
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'invalid fixed pricing was accepted';
  end if;

  select technical_visit_policy
  into v_after_policy
  from public.store_operation_execution_policies
  where organization_id = v_org
    and store_id = v_store;

  select offers_technical_visit
  into v_after_offers
  from public.store_operation_settings
  where organization_id = v_org
    and store_id = v_store;

  if v_after_policy is distinct from v_before_policy
     or v_after_offers is distinct from v_before_offers then
    raise exception 'partial technical visit write survived pricing failure';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    5,
    'pricing invalido reverte save inteiro da visita',
    'PASS',
    'no partial operation or execution-policy write survived'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (5, 'pricing invalido reverte save inteiro da visita', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 6. TECHNICAL VISIT FALSE IS EXPLICIT + CLEARS DEPENDENTS
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_policy jsonb;
  v_marker timestamptz;
  v_offers boolean;
  v_pricing text;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  perform public.upsert_store_operation_technical_visit_configuration_scoped(
    p_organization_id => v_org,
    p_store_id => v_store,
    p_offers_technical_visit => false,
    p_technical_visit_policy => null,
    p_technical_visit_pricing_mode => null,
    p_technical_visit_fixed_fee_cents => null,
    p_technical_visit_case_by_case_rule => null,
    p_technical_visit_fee_deductible_from_purchase => null
  );

  select
    technical_visit_policy,
    technical_visit_configured_at
  into
    v_policy,
    v_marker
  from public.store_operation_execution_policies
  where organization_id = v_org
    and store_id = v_store;

  select
    offers_technical_visit,
    technical_visit_pricing_mode
  into
    v_offers,
    v_pricing
  from public.store_operation_settings
  where organization_id = v_org
    and store_id = v_store;

  if v_marker is null
     or v_policy is not null
     or v_offers is distinct from false
     or v_pricing is not null then
    raise exception 'explicit false visit state is inconsistent';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    6,
    'visita false continua configurada e limpa dependencias',
    'PASS',
    'marker=set policy=null offers=false pricing=null'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (6, 'visita false continua configurada e limpa dependencias', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 7. INSTALLATION TRUE / VALID POLICY
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_result public.store_operation_execution_policies%rowtype;
  v_offers boolean;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  v_result :=
    public.upsert_store_operation_installation_configuration_scoped(
      p_organization_id => v_org,
      p_store_id => v_store,
      p_offers_installation => true,
      p_installation_policy => jsonb_build_object(
        'customer_can_buy_without', 'sim',
        'third_party_pool', 'nao',
        'supply_mode', 'disponivel',
        'start_lead_time_mode', '1_dia',
        'duration_mode', 'horas',
        'duration_value', 6,
        'has_multiple_teams', false,
        'concurrent_capacity', 1,
        'schedule_gates', jsonb_build_array('endereco', 'produto'),
        'start_gates', jsonb_build_array('pagamento', 'produto'),
        'includes', jsonb_build_array('entrega', 'posicionamento'),
        'excludes', jsonb_build_array('paisagismo'),
        'excludes_details', 'Paisagismo fora do escopo.',
        'notes', 'P19-A runner instalacao'
      )
    );

  select offers_installation
  into v_offers
  from public.store_operation_settings
  where organization_id = v_org
    and store_id = v_store;

  if v_result.installation_configured_at is null
     or v_result.installation_policy is null
     or v_offers is distinct from true then
    raise exception 'installation canonical save mismatch';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    7,
    'instalacao true grava policy marker e authority simples',
    'PASS',
    'offers=true policy=present marker=set'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (7, 'instalacao true grava policy marker e authority simples', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 8. INSTALLATION MARKER PRESERVES FIRST SAVE
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_first timestamptz := '2026-02-03 04:05:06+00'::timestamptz;
  v_after timestamptz;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  update public.store_operation_execution_policies
  set installation_configured_at = v_first
  where organization_id = v_org
    and store_id = v_store;

  perform public.upsert_store_operation_installation_configuration_scoped(
    p_organization_id => v_org,
    p_store_id => v_store,
    p_offers_installation => true,
    p_installation_policy => jsonb_build_object(
      'customer_can_buy_without', 'nao',
      'third_party_pool', 'nao',
      'supply_mode', 'disponivel',
      'start_lead_time_mode', 'mesmo_dia',
      'duration_mode', 'dias_uteis',
      'duration_value', 1,
      'has_multiple_teams', false,
      'concurrent_capacity', 1,
      'schedule_gates', jsonb_build_array(),
      'start_gates', jsonb_build_array(),
      'includes', jsonb_build_array(),
      'excludes', jsonb_build_array(),
      'notes', 'replay'
    )
  );

  select installation_configured_at
  into v_after
  from public.store_operation_execution_policies
  where organization_id = v_org
    and store_id = v_store;

  if v_after is distinct from v_first then
    raise exception 'first installation configured_at was overwritten';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    8,
    'replay da instalacao preserva primeiro configured_at',
    'PASS',
    'installation_configured_at preserved'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (8, 'replay da instalacao preserva primeiro configured_at', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 9. INSTALLATION MISSING REQUIRED MODE MUST FAIL
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_failed boolean := false;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  begin
    perform public.upsert_store_operation_installation_configuration_scoped(
      p_organization_id => v_org,
      p_store_id => v_store,
      p_offers_installation => true,
      p_installation_policy => jsonb_build_object(
        'customer_can_buy_without', 'sim',
        'third_party_pool', 'nao',
        'start_lead_time_mode', '1_dia',
        'duration_mode', 'horas',
        'duration_value', 4,
        'has_multiple_teams', false,
        'concurrent_capacity', 1,
        'schedule_gates', jsonb_build_array(),
        'start_gates', jsonb_build_array(),
        'includes', jsonb_build_array(),
        'excludes', jsonb_build_array()
      )
    );
  exception
    when others then
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'installation without supply_mode was accepted';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    9,
    'instalacao sem supply mode falha fechado',
    'PASS',
    'invalid policy rejected'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (9, 'instalacao sem supply mode falha fechado', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 10. SUPPLIER MODE REQUIRED FOR ORDERED/MIXED SUPPLY
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_failed boolean := false;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  begin
    perform public.upsert_store_operation_installation_configuration_scoped(
      p_organization_id => v_org,
      p_store_id => v_store,
      p_offers_installation => true,
      p_installation_policy => jsonb_build_object(
        'customer_can_buy_without', 'sim',
        'third_party_pool', 'nao',
        'supply_mode', 'sob_encomenda',
        'start_lead_time_mode', '2_3_dias',
        'duration_mode', 'dias_uteis',
        'duration_value', 2,
        'has_multiple_teams', false,
        'concurrent_capacity', 1,
        'schedule_gates', jsonb_build_array(),
        'start_gates', jsonb_build_array(),
        'includes', jsonb_build_array(),
        'excludes', jsonb_build_array()
      )
    );
  exception
    when others then
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'supplier lead-time mode omission was accepted';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    10,
    'sob encomenda exige supplier lead time mode',
    'PASS',
    'missing supplier lead-time mode rejected'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (10, 'sob encomenda exige supplier lead time mode', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 11. CAPACITY CONSISTENCY
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_failed boolean := false;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  begin
    perform public.upsert_store_operation_installation_configuration_scoped(
      p_organization_id => v_org,
      p_store_id => v_store,
      p_offers_installation => true,
      p_installation_policy => jsonb_build_object(
        'customer_can_buy_without', 'sim',
        'third_party_pool', 'nao',
        'supply_mode', 'disponivel',
        'start_lead_time_mode', '1_dia',
        'duration_mode', 'horas',
        'duration_value', 6,
        'has_multiple_teams', false,
        'concurrent_capacity', 2,
        'schedule_gates', jsonb_build_array(),
        'start_gates', jsonb_build_array(),
        'includes', jsonb_build_array(),
        'excludes', jsonb_build_array()
      )
    );
  exception
    when others then
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'single-team installation accepted capacity=2';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    11,
    'uma equipe exige capacidade exatamente 1',
    'PASS',
    'contradictory capacity rejected'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (11, 'uma equipe exige capacidade exatamente 1', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 12. CONDITIONAL "OUTRO" REQUIRES TEXT
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_failed boolean := false;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  begin
    perform public.upsert_store_operation_installation_configuration_scoped(
      p_organization_id => v_org,
      p_store_id => v_store,
      p_offers_installation => true,
      p_installation_policy => jsonb_build_object(
        'customer_can_buy_without', 'sim',
        'third_party_pool', 'nao',
        'supply_mode', 'disponivel',
        'start_lead_time_mode', '1_dia',
        'duration_mode', 'horas',
        'duration_value', 6,
        'has_multiple_teams', false,
        'concurrent_capacity', 1,
        'schedule_gates', jsonb_build_array('outro'),
        'start_gates', jsonb_build_array(),
        'includes', jsonb_build_array(),
        'excludes', jsonb_build_array()
      )
    );
  exception
    when others then
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'schedule gate outro without detail was accepted';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    12,
    'outro requisito de agendamento exige detalhe',
    'PASS',
    'conditional detail enforced'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (12, 'outro requisito de agendamento exige detalhe', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 13. CARD 6 MUST NOT ALTER CARD 5
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_visit_policy_before jsonb;
  v_visit_marker_before timestamptz;
  v_visit_offers_before boolean;
  v_visit_pricing_before text;
  v_visit_policy_after jsonb;
  v_visit_marker_after timestamptz;
  v_visit_offers_after boolean;
  v_visit_pricing_after text;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  perform public.upsert_store_operation_technical_visit_configuration_scoped(
    p_organization_id => v_org,
    p_store_id => v_store,
    p_offers_technical_visit => true,
    p_technical_visit_policy => jsonb_build_object(
      'required_situations', jsonb_build_array('medidas'),
      'optional_situations', jsonb_build_array(),
      'team_mode', 'dono_loja',
      'requires_appointment', true,
      'duration_mode', '60',
      'duration_minutes', 60,
      'preconfirm_items', jsonb_build_array()
    ),
    p_technical_visit_pricing_mode => 'free',
    p_technical_visit_fixed_fee_cents => null,
    p_technical_visit_case_by_case_rule => null,
    p_technical_visit_fee_deductible_from_purchase => null
  );

  select
    technical_visit_policy,
    technical_visit_configured_at
  into
    v_visit_policy_before,
    v_visit_marker_before
  from public.store_operation_execution_policies
  where organization_id = v_org
    and store_id = v_store;

  select
    offers_technical_visit,
    technical_visit_pricing_mode
  into
    v_visit_offers_before,
    v_visit_pricing_before
  from public.store_operation_settings
  where organization_id = v_org
    and store_id = v_store;

  perform public.upsert_store_operation_installation_configuration_scoped(
    p_organization_id => v_org,
    p_store_id => v_store,
    p_offers_installation => true,
    p_installation_policy => jsonb_build_object(
      'customer_can_buy_without', 'sim',
      'third_party_pool', 'nao',
      'supply_mode', 'disponivel',
      'start_lead_time_mode', '1_dia',
      'duration_mode', 'horas',
      'duration_value', 5,
      'has_multiple_teams', false,
      'concurrent_capacity', 1,
      'schedule_gates', jsonb_build_array(),
      'start_gates', jsonb_build_array(),
      'includes', jsonb_build_array(),
      'excludes', jsonb_build_array()
    )
  );

  select
    technical_visit_policy,
    technical_visit_configured_at
  into
    v_visit_policy_after,
    v_visit_marker_after
  from public.store_operation_execution_policies
  where organization_id = v_org
    and store_id = v_store;

  select
    offers_technical_visit,
    technical_visit_pricing_mode
  into
    v_visit_offers_after,
    v_visit_pricing_after
  from public.store_operation_settings
  where organization_id = v_org
    and store_id = v_store;

  if v_visit_policy_after is distinct from v_visit_policy_before
     or v_visit_marker_after is distinct from v_visit_marker_before
     or v_visit_offers_after is distinct from v_visit_offers_before
     or v_visit_pricing_after is distinct from v_visit_pricing_before then
    raise exception 'installation writer modified technical visit authority';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    13,
    'writer da instalacao nao altera visita tecnica',
    'PASS',
    'Card 5 policy marker offers and pricing preserved'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (13, 'writer da instalacao nao altera visita tecnica', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 14. CARD 5 MUST NOT ALTER CARD 6
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_install_policy_before jsonb;
  v_install_marker_before timestamptz;
  v_install_offers_before boolean;
  v_install_policy_after jsonb;
  v_install_marker_after timestamptz;
  v_install_offers_after boolean;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  select
    installation_policy,
    installation_configured_at
  into
    v_install_policy_before,
    v_install_marker_before
  from public.store_operation_execution_policies
  where organization_id = v_org
    and store_id = v_store;

  select offers_installation
  into v_install_offers_before
  from public.store_operation_settings
  where organization_id = v_org
    and store_id = v_store;

  perform public.upsert_store_operation_technical_visit_configuration_scoped(
    p_organization_id => v_org,
    p_store_id => v_store,
    p_offers_technical_visit => false,
    p_technical_visit_policy => null,
    p_technical_visit_pricing_mode => null,
    p_technical_visit_fixed_fee_cents => null,
    p_technical_visit_case_by_case_rule => null,
    p_technical_visit_fee_deductible_from_purchase => null
  );

  select
    installation_policy,
    installation_configured_at
  into
    v_install_policy_after,
    v_install_marker_after
  from public.store_operation_execution_policies
  where organization_id = v_org
    and store_id = v_store;

  select offers_installation
  into v_install_offers_after
  from public.store_operation_settings
  where organization_id = v_org
    and store_id = v_store;

  if v_install_policy_after is distinct from v_install_policy_before
     or v_install_marker_after is distinct from v_install_marker_before
     or v_install_offers_after is distinct from v_install_offers_before then
    raise exception 'technical visit writer modified installation authority';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    14,
    'writer da visita nao altera instalacao',
    'PASS',
    'Card 6 policy marker and offers preserved'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (14, 'writer da visita nao altera instalacao', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 15. INSTALLATION FALSE IS EXPLICIT + CLEARS POLICY
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_policy jsonb;
  v_marker timestamptz;
  v_offers boolean;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  perform public.upsert_store_operation_installation_configuration_scoped(
    p_organization_id => v_org,
    p_store_id => v_store,
    p_offers_installation => false,
    p_installation_policy => null
  );

  select
    installation_policy,
    installation_configured_at
  into
    v_policy,
    v_marker
  from public.store_operation_execution_policies
  where organization_id = v_org
    and store_id = v_store;

  select offers_installation
  into v_offers
  from public.store_operation_settings
  where organization_id = v_org
    and store_id = v_store;

  if v_marker is null
     or v_policy is not null
     or v_offers is distinct from false then
    raise exception 'explicit false installation state is inconsistent';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    15,
    'instalacao false continua configurada e limpa policy',
    'PASS',
    'marker=set policy=null offers=false'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (15, 'instalacao false continua configurada e limpa policy', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 16. READER RETURNS BOTH CARD STATES
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_row public.store_operation_execution_policies%rowtype;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  v_row := public.read_store_operation_execution_policies_scoped(
    v_org,
    v_store
  );

  if v_row is null
     or v_row.technical_visit_configured_at is null
     or v_row.installation_configured_at is null then
    raise exception 'scoped reader did not return both configured markers';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    16,
    'reader scoped retorna estado dos dois cards',
    'PASS',
    'both configured markers returned'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (16, 'reader scoped retorna estado dos dois cards', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 17. WRONG STORE MUST FAIL
-- ============================================================

do $$
declare
  v_org uuid;
  v_store uuid;
  v_failed boolean := false;
begin
  select organization_id, store_id
  into v_org, v_store
  from pg_temp.p19a_operation_execution_context;

  begin
    perform public.read_store_operation_execution_policies_scoped(
      v_org,
      gen_random_uuid()
    );
  exception
    when others then
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'wrong store scope was accepted';
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    17,
    'store fora do escopo falha fechado',
    'PASS',
    'wrong store rejected'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (17, 'store fora do escopo falha fechado', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- 18. EXECUTE GRANTS
-- ============================================================

do $$
declare
  v_auth_reader boolean;
  v_auth_visit boolean;
  v_auth_install boolean;
  v_anon_reader boolean;
  v_service_reader boolean;
begin
  select
    has_function_privilege(
      'authenticated',
      'public.read_store_operation_execution_policies_scoped(uuid,uuid)',
      'EXECUTE'
    ),
    has_function_privilege(
      'authenticated',
      'public.upsert_store_operation_technical_visit_configuration_scoped(uuid,uuid,boolean,jsonb,text,integer,text,boolean)',
      'EXECUTE'
    ),
    has_function_privilege(
      'authenticated',
      'public.upsert_store_operation_installation_configuration_scoped(uuid,uuid,boolean,jsonb)',
      'EXECUTE'
    ),
    has_function_privilege(
      'anon',
      'public.read_store_operation_execution_policies_scoped(uuid,uuid)',
      'EXECUTE'
    ),
    has_function_privilege(
      'service_role',
      'public.read_store_operation_execution_policies_scoped(uuid,uuid)',
      'EXECUTE'
    )
  into
    v_auth_reader,
    v_auth_visit,
    v_auth_install,
    v_anon_reader,
    v_service_reader;

  if not v_auth_reader
     or not v_auth_visit
     or not v_auth_install
     or v_anon_reader
     or v_service_reader then
    raise exception
      'unexpected grants auth_reader=% auth_visit=% auth_install=% anon_reader=% service_reader=%',
      v_auth_reader,
      v_auth_visit,
      v_auth_install,
      v_anon_reader,
      v_service_reader;
  end if;

  insert into pg_temp.p19a_operation_execution_results
  values (
    18,
    'permissoes publicas dos readers e writers estao restritas',
    'PASS',
    'authenticated=yes anon/service_role=no'
  );
exception
  when others then
    insert into pg_temp.p19a_operation_execution_results
    values (18, 'permissoes publicas dos readers e writers estao restritas', 'FAIL', sqlerrm);
end;
$$;


-- ============================================================
-- FINAL REPORT
-- ============================================================

select
  scenario_number,
  scenario_name,
  status,
  detail
from pg_temp.p19a_operation_execution_results
order by scenario_number;

select
  count(*) as total,
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as sut_fail
from pg_temp.p19a_operation_execution_results;

rollback;
begin;

create temp table p19a_region_checks (
  check_no integer primary key,
  check_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  details text null
) on commit drop;

create or replace function pg_temp.p19a_region_record(
  p_no integer,
  p_name text,
  p_pass boolean,
  p_details text default null
)
returns void
language plpgsql
as $$
begin
  insert into p19a_region_checks(check_no, check_name, status, details)
  values (
    p_no,
    p_name,
    case when p_pass then 'PASS' else 'SUT_FAIL' end,
    p_details
  );
exception when others then
  insert into p19a_region_checks(check_no, check_name, status, details)
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
  v_org uuid;
  v_store uuid;
  v_user uuid;

  v_before public.store_strategy_settings%rowtype;
  v_row public.store_strategy_settings%rowtype;

  v_first_configured_at timestamptz;

  v_before_non_region jsonb;
  v_after_non_region jsonb;

  v_function_signature text :=
    'public.upsert_store_strategy_region_configuration_scoped(uuid,uuid,text,text[],text,boolean,text)';
begin
  -- ----------------------------------------------------------
  -- FIXTURE REAL DEV, MAS TUDO DENTRO DE ROLLBACK
  -- ----------------------------------------------------------

  select s.organization_id, s.id
  into v_org, v_store
  from public.stores s
  where s.name = 'ZION'
  order by s.created_at
  limit 1;

  if v_org is null or v_store is null then
    raise exception 'HARNESS: loja ZION nao encontrada';
  end if;

  select m.user_id
  into v_user
  from public.memberships m
  where m.organization_id = v_org
    and m.is_active is true
  order by m.user_id
  limit 1;

  if v_user is null then
    raise exception 'HARNESS: membership ativa da organizacao ZION nao encontrada';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    v_user::text,
    true
  );

  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );

  select *
  into v_before
  from public.store_strategy_settings
  where organization_id = v_org
    and store_id = v_store;

  if not found then
    raise exception 'HARNESS: store_strategy_settings da ZION nao encontrada';
  end if;

  -- ==========================================================
  -- 01. COLUNA/MARKER EXISTE
  -- ==========================================================

  perform pg_temp.p19a_region_record(
    1,
    'marker service_region_configured_at existe',
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'store_strategy_settings'
        and column_name = 'service_region_configured_at'
        and data_type = 'timestamp with time zone'
        and is_nullable = 'YES'
    )
  );

  -- ==========================================================
  -- 02. SEM BACKFILL INSEGURO
  -- A row ZION estava sem configuracao regional explicita.
  -- ==========================================================

  perform pg_temp.p19a_region_record(
    2,
    'migration nao transforma estado historico em escolha humana',
    v_before.service_region_configured_at is null,
    'configured_at=' || coalesce(v_before.service_region_configured_at::text, 'NULL')
  );

  -- Snapshot de tudo que NAO pertence a Regiao.
  v_before_non_region :=
    to_jsonb(v_before)
    - array[
        'service_regions',
        'service_region_modes',
        'service_region_primary_mode',
        'service_region_outside_consultation',
        'service_region_notes',
        'service_region_configured_at',
        'updated_at'
      ];

  -- ==========================================================
  -- 03. FALSE EXPLICITO = NAO
  -- ==========================================================

  select *
  into v_row
  from public.upsert_store_strategy_region_configuration_scoped(
    p_organization_id => v_org,
    p_store_id => v_store,
    p_service_regions => null,
    p_service_region_modes => array['somente_cidade_loja'],
    p_service_region_primary_mode => 'somente_cidade_loja',
    p_service_region_outside_consultation => false,
    p_service_region_notes => null
  );

  perform pg_temp.p19a_region_record(
    3,
    'save explicito de Nao grava marker e policy false',
    v_row.service_region_configured_at is not null
      and v_row.service_region_outside_consultation is false
      and v_row.service_region_primary_mode = 'somente_cidade_loja'
      and 'somente_cidade_loja' = any(v_row.service_region_modes)
      and not ('sob_consulta' = any(v_row.service_region_modes)),
    to_jsonb(v_row)::text
  );

  -- ==========================================================
  -- 04. FALSE DEFAULT X FALSE HUMANO FICAM DISTINGUIVEIS
  -- ==========================================================

  perform pg_temp.p19a_region_record(
    4,
    'false humano fica distinguivel do false tecnico historico',
    v_before.service_region_configured_at is null
      and v_row.service_region_configured_at is not null
      and v_row.service_region_outside_consultation is false
  );

  v_first_configured_at := v_row.service_region_configured_at;

  -- ==========================================================
  -- 05. REPLAY PRESERVA FIRST CONFIGURED_AT
  -- ==========================================================

  perform pg_sleep(0.01);

  select *
  into v_row
  from public.upsert_store_strategy_region_configuration_scoped(
    v_org,
    v_store,
    null,
    array['somente_cidade_loja'],
    'somente_cidade_loja',
    false,
    null
  );

  perform pg_temp.p19a_region_record(
    5,
    'replay preserva primeiro configured_at',
    v_row.service_region_configured_at = v_first_configured_at,
    format(
      'first=%s replay=%s',
      v_first_configured_at,
      v_row.service_region_configured_at
    )
  );

  -- ==========================================================
  -- 06. SOB CONSULTA
  -- ==========================================================

  select *
  into v_row
  from public.upsert_store_strategy_region_configuration_scoped(
    v_org,
    v_store,
    'Suzano e cidades proximas',
    array['cidade_e_vizinhas'],
    'cidade_e_vizinhas',
    true,
    'Fora da cobertura principal somente mediante consulta.'
  );

  perform pg_temp.p19a_region_record(
    6,
    'sob consulta sincroniza boolean e mode',
    v_row.service_region_outside_consultation is true
      and 'sob_consulta' = any(v_row.service_region_modes)
      and 'cidade_e_vizinhas' = any(v_row.service_region_modes)
      and v_row.service_region_primary_mode = 'cidade_e_vizinhas'
      and v_row.service_region_configured_at = v_first_configured_at
  );

  -- ==========================================================
  -- 07. VOLTAR PARA NAO LIMPA SOB_CONSULTA
  -- ==========================================================

  select *
  into v_row
  from public.upsert_store_strategy_region_configuration_scoped(
    v_org,
    v_store,
    'Suzano e cidades proximas',
    array['cidade_e_vizinhas', 'sob_consulta'],
    'cidade_e_vizinhas',
    false,
    null
  );

  perform pg_temp.p19a_region_record(
    7,
    'trocar para Nao remove sob_consulta stale',
    v_row.service_region_outside_consultation is false
      and not ('sob_consulta' = any(v_row.service_region_modes))
      and 'cidade_e_vizinhas' = any(v_row.service_region_modes)
  );

  -- ==========================================================
  -- 08. PRIMARY MODE ENTRA NOS MODES MESMO SE OMITIDO NO ARRAY
  -- ==========================================================

  select *
  into v_row
  from public.upsert_store_strategy_region_configuration_scoped(
    v_org,
    v_store,
    null,
    '{}'::text[],
    'todo_estado',
    false,
    null
  );

  perform pg_temp.p19a_region_record(
    8,
    'writer garante primary mode dentro dos modes canonicos',
    v_row.service_region_primary_mode = 'todo_estado'
      and 'todo_estado' = any(v_row.service_region_modes)
  );

  -- ==========================================================
  -- 09. GRANDE REGIAO EXIGE TEXTO
  -- ==========================================================

  begin
    perform public.upsert_store_strategy_region_configuration_scoped(
      v_org,
      v_store,
      null,
      array['grande_regiao'],
      'grande_regiao',
      false,
      null
    );

    perform pg_temp.p19a_region_record(
      9,
      'grande regiao sem cobertura textual e bloqueada',
      false,
      'writer aceitou payload invalido'
    );
  exception
    when invalid_parameter_value then
      perform pg_temp.p19a_region_record(
        9,
        'grande regiao sem cobertura textual e bloqueada',
        sqlerrm = 'SERVICE_REGIONS_REQUIRED',
        sqlstate || ' ' || sqlerrm
      );
    when others then
      perform pg_temp.p19a_region_record(
        9,
        'grande regiao sem cobertura textual e bloqueada',
        false,
        sqlstate || ' ' || sqlerrm
      );
  end;

  -- ==========================================================
  -- 10. PRIMARY INVALIDO
  -- ==========================================================

  begin
    perform public.upsert_store_strategy_region_configuration_scoped(
      v_org,
      v_store,
      null,
      array['somente_cidade_loja'],
      'modo_inventado',
      false,
      null
    );

    perform pg_temp.p19a_region_record(
      10,
      'primary mode invalido e bloqueado',
      false,
      'writer aceitou primary invalido'
    );
  exception
    when invalid_parameter_value then
      perform pg_temp.p19a_region_record(
        10,
        'primary mode invalido e bloqueado',
        sqlerrm = 'SERVICE_REGION_PRIMARY_MODE_REQUIRED',
        sqlstate || ' ' || sqlerrm
      );
    when others then
      perform pg_temp.p19a_region_record(
        10,
        'primary mode invalido e bloqueado',
        false,
        sqlstate || ' ' || sqlerrm
      );
  end;

  -- ==========================================================
  -- 11. MODE INVALIDO
  -- ==========================================================

  begin
    perform public.upsert_store_strategy_region_configuration_scoped(
      v_org,
      v_store,
      null,
      array['modo_inventado'],
      'somente_cidade_loja',
      false,
      null
    );

    perform pg_temp.p19a_region_record(
      11,
      'region mode invalido e bloqueado',
      false,
      'writer aceitou mode invalido'
    );
  exception
    when invalid_parameter_value then
      perform pg_temp.p19a_region_record(
        11,
        'region mode invalido e bloqueado',
        sqlerrm = 'SERVICE_REGION_MODE_INVALID',
        sqlstate || ' ' || sqlerrm
      );
    when others then
      perform pg_temp.p19a_region_record(
        11,
        'region mode invalido e bloqueado',
        false,
        sqlstate || ' ' || sqlerrm
      );
  end;

  -- ==========================================================
  -- 12. OUTSIDE POLICY NAO PODE SER NULL
  -- ==========================================================

  begin
    perform public.upsert_store_strategy_region_configuration_scoped(
      v_org,
      v_store,
      null,
      array['somente_cidade_loja'],
      'somente_cidade_loja',
      null,
      null
    );

    perform pg_temp.p19a_region_record(
      12,
      'outside policy null e bloqueada',
      false,
      'writer aceitou escolha ausente'
    );
  exception
    when invalid_parameter_value then
      perform pg_temp.p19a_region_record(
        12,
        'outside policy null e bloqueada',
        sqlerrm = 'SERVICE_REGION_OUTSIDE_POLICY_REQUIRED',
        sqlstate || ' ' || sqlerrm
      );
    when others then
      perform pg_temp.p19a_region_record(
        12,
        'outside policy null e bloqueada',
        false,
        sqlstate || ' ' || sqlerrm
      );
  end;

  -- ==========================================================
  -- 13. STORE SCOPE
  -- ==========================================================

  begin
    perform public.upsert_store_strategy_region_configuration_scoped(
      v_org,
      '00000000-0000-0000-0000-000000000001'::uuid,
      null,
      array['somente_cidade_loja'],
      'somente_cidade_loja',
      false,
      null
    );

    perform pg_temp.p19a_region_record(
      13,
      'store fora do escopo e bloqueada',
      false,
      'writer aceitou store inexistente no org'
    );
  exception
    when others then
      perform pg_temp.p19a_region_record(
        13,
        'store fora do escopo e bloqueada',
        sqlerrm = 'STORE_NOT_FOUND',
        sqlstate || ' ' || sqlerrm
      );
  end;

  -- ==========================================================
  -- 14. USUARIO SEM MEMBERSHIP
  -- ==========================================================

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001',
    true
  );

  begin
    perform public.upsert_store_strategy_region_configuration_scoped(
      v_org,
      v_store,
      null,
      array['somente_cidade_loja'],
      'somente_cidade_loja',
      false,
      null
    );

    perform pg_temp.p19a_region_record(
      14,
      'usuario sem membership ativa e bloqueado',
      false,
      'writer aceitou usuario sem membership'
    );
  exception
    when others then
      perform pg_temp.p19a_region_record(
        14,
        'usuario sem membership ativa e bloqueado',
        sqlerrm = 'MEMBERSHIP_REQUIRED',
        sqlstate || ' ' || sqlerrm
      );
  end;

  -- restaura usuario valido
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    v_user::text,
    true
  );

  -- ==========================================================
  -- 15. NAO ALTERA CAMPOS DE STRATEGY FORA DE REGIAO
  -- ==========================================================

  select *
  into v_row
  from public.store_strategy_settings
  where organization_id = v_org
    and store_id = v_store;

  v_after_non_region :=
    to_jsonb(v_row)
    - array[
        'service_regions',
        'service_region_modes',
        'service_region_primary_mode',
        'service_region_outside_consultation',
        'service_region_notes',
        'service_region_configured_at',
        'updated_at'
      ];

  perform pg_temp.p19a_region_record(
    15,
    'writer regional preserva todos os demais campos de Strategy',
    v_after_non_region = v_before_non_region,
    case
      when v_after_non_region = v_before_non_region then null
      else format(
        'before=%s after=%s',
        v_before_non_region,
        v_after_non_region
      )
    end
  );

  -- ==========================================================
  -- 16. ACL AUTHENTICATED
  -- ==========================================================

  perform pg_temp.p19a_region_record(
    16,
    'authenticated possui execute no writer regional',
    has_function_privilege(
      'authenticated',
      v_function_signature,
      'EXECUTE'
    )
  );

  -- ==========================================================
  -- 17. ACL PUBLIC/ANON/SERVICE_ROLE
  -- ==========================================================

  perform pg_temp.p19a_region_record(
    17,
    'anon e service_role nao possuem execute e PUBLIC nao vaza via anon',
    not has_function_privilege(
      'anon',
      v_function_signature,
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      v_function_signature,
      'EXECUTE'
    )
  );

  -- ==========================================================
  -- 18. CONSTRAINT EXISTE
  -- ==========================================================

  perform pg_temp.p19a_region_record(
    18,
    'constraint de shape regional configurado existe',
    exists (
      select 1
      from pg_constraint c
      where c.conrelid = 'public.store_strategy_settings'::regclass
        and c.conname =
          'store_strategy_settings_region_configured_shape_valid'
    )
  );

end;
$$;

select
  check_no,
  check_name,
  status,
  details
from p19a_region_checks
order by check_no;

select
  count(*) as total,
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'SUT_FAIL') as sut_fail,
  count(*) filter (where status = 'HARNESS_ERROR') as harness_error
from p19a_region_checks;

rollback;
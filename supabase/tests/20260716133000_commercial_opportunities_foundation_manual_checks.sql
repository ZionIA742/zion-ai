-- Fase 4.1B-1 - runner manual de validacao real
-- Execute o script inteiro de uma vez no SQL Editor do Supabase.
--
-- Propriedades de seguranca deste runner:
-- - nao cria nem altera auth.users, organizations, stores, memberships ou tabelas legadas;
-- - cria registros temporarios apenas em customers e commercial_opportunities;
-- - todos os UUIDs sao gerados dinamicamente;
-- - toda escrita persistente acontece dentro de um unico bloco DO atomico;
-- - erro nao tratado, cancelamento ou queda durante o DO desfaz as escritas do bloco;
-- - a limpeza remove apenas UUIDs gerados e rastreados pelo proprio runner;
-- - se a limpeza falhar, o DO aborta em vez de confirmar residuos;
-- - o relatorio final nao exibe UUIDs nem dados pessoais.

drop table if exists pg_temp._p9_f41b1_results;
drop table if exists pg_temp._p9_f41b1_context;

create temp table _p9_f41b1_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'FAIL', 'BLOCKED')),
  detail text not null
) on commit preserve rows;

create temp table _p9_f41b1_context (
  runner_tag text not null,
  org_a uuid null,
  org_b uuid null,
  store_a1 uuid null,
  store_b1 uuid null,
  user_a_any uuid null,
  user_b_any uuid null,
  user_b_exclusive uuid null,
  customer_a_id uuid null,
  customer_b_id uuid null,
  opportunity_main_id uuid null,
  created_customer_ids uuid[] not null default '{}'::uuid[],
  created_opportunity_ids uuid[] not null default '{}'::uuid[],
  cleanup_status text not null default 'NOT_RUN'
) on commit preserve rows;

insert into _p9_f41b1_context (runner_tag)
values ('runner_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));

do $$
declare
  v_org_a uuid;
  v_org_b uuid;
  v_store_a1 uuid;
  v_store_b1 uuid;
  v_user_a_any uuid;
  v_user_b_any uuid;
  v_user_b_exclusive uuid;
  v_customer_a_id uuid;
  v_customer_b_id uuid;
  v_opportunity_main_id uuid;
  v_second_opportunity_id uuid;
  v_repeat_origin_opportunity_a_id uuid;
  v_repeat_origin_opportunity_b_id uuid;
  v_attempt_opportunity_id uuid;
  v_same_origin_lead_id uuid;
  v_before_updated_at timestamptz;
  v_after_updated_at timestamptz;
  v_before_stage_changed_at timestamptz;
  v_after_stage_changed_at timestamptz;
  v_original_stage_changed_at timestamptz;
  v_inserted_origin_lead_id uuid;
  v_inserted_primary_conversation_id uuid;
  v_auth_uid uuid;
  v_inserted_stage text;
  v_counter integer;
  v_created_customer_ids uuid[];
  v_created_opportunity_ids uuid[];
  v_stage text;
  v_allowed_stages text[] := array[
    'novo_lead',
    'qualificacao',
    'orcamento',
    'visita_tecnica',
    'negociacao',
    'fechamento_pagamento',
    'instalacao_entrega',
    'pos_venda',
    'perdido',
    'concluido_sem_mais_acoes'
  ];
begin
  with org_members as (
    select distinct on (organization_id)
      organization_id,
      user_id as any_user_id
    from public.memberships
    where user_id is not null
    order by organization_id, user_id
  ),
  ranked_stores as (
    select
      organization_id,
      id,
      row_number() over (partition by organization_id order by id) as rn
    from public.stores
  )
  select
    om.organization_id,
    om.any_user_id,
    rs.id
  into
    v_org_a,
    v_user_a_any,
    v_store_a1
  from org_members om
  join ranked_stores rs
    on rs.organization_id = om.organization_id
   and rs.rn = 1
  order by om.organization_id
  limit 1;

  with org_members as (
    select distinct on (organization_id)
      organization_id,
      user_id as any_user_id
    from public.memberships
    where user_id is not null
    order by organization_id, user_id
  ),
  ranked_stores as (
    select
      organization_id,
      id,
      row_number() over (partition by organization_id order by id) as rn
    from public.stores
  )
  select
    om.organization_id,
    om.any_user_id,
    rs.id
  into
    v_org_b,
    v_user_b_any,
    v_store_b1
  from org_members om
  join ranked_stores rs
    on rs.organization_id = om.organization_id
   and rs.rn = 1
  where om.organization_id is distinct from v_org_a
  order by om.organization_id
  limit 1;

  if v_org_a is not null and v_org_b is not null then
    select m.user_id
      into v_user_b_exclusive
    from public.memberships m
    where m.organization_id = v_org_b
      and m.user_id is not null
      and not exists (
        select 1
        from public.memberships m2
        where m2.user_id = m.user_id
          and m2.organization_id = v_org_a
      )
    order by m.user_id
    limit 1;
  end if;

  update _p9_f41b1_context
  set
    org_a = v_org_a,
    org_b = v_org_b,
    store_a1 = v_store_a1,
    store_b1 = v_store_b1,
    user_a_any = v_user_a_any,
    user_b_any = v_user_b_any,
    user_b_exclusive = v_user_b_exclusive;

  if v_org_a is null or v_store_a1 is null or v_user_a_any is null then
    insert into _p9_f41b1_results values
      (1, 'criacao de oportunidade valida', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization A with store and membership'),
      (2, 'stage padrao novo_lead', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization A with store and membership'),
      (3, 'todos os stages permitidos', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization A with store and membership'),
      (4, 'rejeicao de stage invalido', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization A with store and membership'),
      (9, 'atualizacao comum permitida', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization A with store and membership'),
      (10, 'updated_at avanca', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization A with store and membership'),
      (11, 'stage_changed_at nao muda sem mudar stage', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization A with store and membership'),
      (12, 'stage_changed_at muda quando stage muda', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization A with store and membership'),
      (15, 'authenticated nao executa DELETE', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization A with store and membership'),
      (16, 'origin_lead_id aceita null', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization A with store and membership'),
      (17, 'primary_conversation_id aceita null', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization A with store and membership'),
      (18, 'mesmo customer pode possuir duas oportunidades', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization A with store and membership'),
      (19, 'origin_lead_id pode se repetir', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization A with store and membership');
  else
    begin
      execute 'set local role authenticated';
      perform set_config('request.jwt.claim.sub', v_user_a_any::text, true);
      perform set_config('request.jwt.claim.role', 'authenticated', true);
      perform set_config(
        'request.jwt.claims',
        json_build_object('sub', v_user_a_any::text, 'role', 'authenticated')::text,
        true
      );
      select auth.uid() into v_auth_uid;

      if v_auth_uid is distinct from v_user_a_any then
        raise exception using errcode = 'P0001', message = 'auth.uid mismatch for user A';
      end if;

      v_customer_a_id := gen_random_uuid();
      insert into public.customers (id, organization_id, display_name, normalized_name)
      values (v_customer_a_id, v_org_a, null, null);

      v_opportunity_main_id := gen_random_uuid();
      insert into public.commercial_opportunities (
        id,
        organization_id,
        store_id,
        customer_id
      ) values (
        v_opportunity_main_id,
        v_org_a,
        v_store_a1,
        v_customer_a_id
      );

      select
        stage,
        origin_lead_id,
        primary_conversation_id
      into
        v_inserted_stage,
        v_inserted_origin_lead_id,
        v_inserted_primary_conversation_id
      from public.commercial_opportunities
      where id = v_opportunity_main_id;

      execute 'reset role';
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims', '', true);

      update _p9_f41b1_context
      set
        customer_a_id = v_customer_a_id,
        opportunity_main_id = v_opportunity_main_id,
        created_customer_ids = created_customer_ids || v_customer_a_id,
        created_opportunity_ids = created_opportunity_ids || v_opportunity_main_id;

      insert into _p9_f41b1_results
      values (1, 'criacao de oportunidade valida', 'PASS', 'commercial opportunity valida criada no escopo da organizacao A');

      insert into _p9_f41b1_results
      values (
        2,
        'stage padrao novo_lead',
        case when v_inserted_stage = 'novo_lead' then 'PASS' else 'FAIL' end,
        case when v_inserted_stage = 'novo_lead' then 'stage padrao aplicado corretamente' else 'stage padrao nao foi aplicado como novo_lead' end
      );

      insert into _p9_f41b1_results
      values (
        16,
        'origin_lead_id aceita null',
        case when v_inserted_origin_lead_id is null then 'PASS' else 'FAIL' end,
        case when v_inserted_origin_lead_id is null then 'origin_lead_id null foi persistido corretamente na criacao valida' else 'origin_lead_id deveria estar null na criacao valida' end
      );

      insert into _p9_f41b1_results
      values (
        17,
        'primary_conversation_id aceita null',
        case when v_inserted_primary_conversation_id is null then 'PASS' else 'FAIL' end,
        case when v_inserted_primary_conversation_id is null then 'primary_conversation_id null foi persistido corretamente na criacao valida' else 'primary_conversation_id deveria estar null na criacao valida' end
      );
    exception
      when others then
        begin
          execute 'reset role';
        exception when others then
          null;
        end;
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);

        insert into _p9_f41b1_results
        values (1, 'criacao de oportunidade valida', 'FAIL', 'unexpected sqlstate ' || sqlstate);

        if not exists (select 1 from _p9_f41b1_results where scenario_number = 2) then
          insert into _p9_f41b1_results
          values (2, 'stage padrao novo_lead', 'FAIL', 'base opportunity fixture could not be created');
        end if;

        if not exists (select 1 from _p9_f41b1_results where scenario_number = 16) then
          insert into _p9_f41b1_results
          values (16, 'origin_lead_id aceita null', 'FAIL', 'base opportunity fixture could not be created');
        end if;

        if not exists (select 1 from _p9_f41b1_results where scenario_number = 17) then
          insert into _p9_f41b1_results
          values (17, 'primary_conversation_id aceita null', 'FAIL', 'base opportunity fixture could not be created');
        end if;
    end;

    if v_org_b is not null and v_store_b1 is not null and v_user_b_any is not null then
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claim.sub', v_user_b_any::text, true);
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform set_config(
          'request.jwt.claims',
          json_build_object('sub', v_user_b_any::text, 'role', 'authenticated')::text,
          true
        );
        select auth.uid() into v_auth_uid;

        if v_auth_uid is distinct from v_user_b_any then
          raise exception using errcode = 'P0001', message = 'auth.uid mismatch for user B';
        end if;

        v_customer_b_id := gen_random_uuid();
        insert into public.customers (id, organization_id, display_name, normalized_name)
        values (v_customer_b_id, v_org_b, null, null);

        execute 'reset role';
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);

        update _p9_f41b1_context
        set
          customer_b_id = v_customer_b_id,
          created_customer_ids = created_customer_ids || v_customer_b_id;
      exception
        when others then
          begin
            execute 'reset role';
          exception when others then
            null;
          end;
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);
      end;
    end if;
  end if;

  select customer_a_id, customer_b_id, opportunity_main_id
    into v_customer_a_id, v_customer_b_id, v_opportunity_main_id
  from _p9_f41b1_context;

  if not exists (select 1 from _p9_f41b1_results where scenario_number = 3) then
    if v_opportunity_main_id is null then
      insert into _p9_f41b1_results
      values (3, 'todos os stages permitidos', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing base opportunity fixture');
    else
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claim.sub', v_user_a_any::text, true);
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform set_config(
          'request.jwt.claims',
          json_build_object('sub', v_user_a_any::text, 'role', 'authenticated')::text,
          true
        );
        select auth.uid() into v_auth_uid;

        if v_auth_uid is distinct from v_user_a_any then
          raise exception using errcode = 'P0001', message = 'auth.uid mismatch for user A';
        end if;

        foreach v_stage in array v_allowed_stages loop
          update public.commercial_opportunities
          set stage = v_stage
          where id = v_opportunity_main_id;
        end loop;

        execute 'reset role';
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);

        insert into _p9_f41b1_results
        values (3, 'todos os stages permitidos', 'PASS', 'todos os stages permitidos foram aceitos pelo check fechado');
      exception
        when others then
          begin
            execute 'reset role';
          exception when others then
            null;
          end;
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          insert into _p9_f41b1_results
          values (3, 'todos os stages permitidos', 'FAIL', 'unexpected sqlstate ' || sqlstate);
      end;
    end if;
  end if;

  if not exists (select 1 from _p9_f41b1_results where scenario_number = 4) then
    if v_opportunity_main_id is null then
      insert into _p9_f41b1_results
      values (4, 'rejeicao de stage invalido', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing base opportunity fixture');
    else
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claim.sub', v_user_a_any::text, true);
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform set_config(
          'request.jwt.claims',
          json_build_object('sub', v_user_a_any::text, 'role', 'authenticated')::text,
          true
        );
        select auth.uid() into v_auth_uid;

        if v_auth_uid is distinct from v_user_a_any then
          raise exception using errcode = 'P0001', message = 'auth.uid mismatch for user A';
        end if;

        begin
          update public.commercial_opportunities
          set stage = 'stage_invalido_runner'
          where id = v_opportunity_main_id;

          execute 'reset role';
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          insert into _p9_f41b1_results
          values (4, 'rejeicao de stage invalido', 'FAIL', 'invalid stage was accepted');
        exception
          when check_violation then
            execute 'reset role';
            perform set_config('request.jwt.claim.sub', '', true);
            perform set_config('request.jwt.claim.role', '', true);
            perform set_config('request.jwt.claims', '', true);

            insert into _p9_f41b1_results
            values (4, 'rejeicao de stage invalido', 'PASS', 'invalid stage was rejected with check violation');
        end;
      exception
        when others then
          begin
            execute 'reset role';
          exception when others then
            null;
          end;
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          if not exists (select 1 from _p9_f41b1_results where scenario_number = 4) then
            insert into _p9_f41b1_results
            values (4, 'rejeicao de stage invalido', 'FAIL', 'unexpected sqlstate ' || sqlstate);
          end if;
      end;
    end if;
  end if;

  if v_org_b is null or v_store_b1 is null then
    insert into _p9_f41b1_results values
      (5, 'bloqueio de store de outra organizacao', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization B with store'),
      (7, 'bloqueio de mudanca de organization_id por authenticated', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization B'),
      (8, 'bloqueio de mudanca de organization_id por service_role', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization B');
  end if;

  if not exists (select 1 from _p9_f41b1_results where scenario_number = 5) then
    if v_customer_a_id is null then
      insert into _p9_f41b1_results
      values (5, 'bloqueio de store de outra organizacao', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing customer fixture in organization A');
    else
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claim.sub', v_user_a_any::text, true);
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform set_config(
          'request.jwt.claims',
          json_build_object('sub', v_user_a_any::text, 'role', 'authenticated')::text,
          true
        );
        select auth.uid() into v_auth_uid;

        if v_auth_uid is distinct from v_user_a_any then
          raise exception using errcode = 'P0001', message = 'auth.uid mismatch for user A';
        end if;

        v_attempt_opportunity_id := gen_random_uuid();

        begin
          insert into public.commercial_opportunities (
            id,
            organization_id,
            store_id,
            customer_id
          ) values (
            v_attempt_opportunity_id,
            v_org_a,
            v_store_b1,
            v_customer_a_id
          );

          update _p9_f41b1_context
          set created_opportunity_ids = created_opportunity_ids || v_attempt_opportunity_id;

          execute 'reset role';
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          insert into _p9_f41b1_results
          values (5, 'bloqueio de store de outra organizacao', 'FAIL', 'cross-organization store was accepted');
        exception
          when insufficient_privilege then
            execute 'reset role';
            perform set_config('request.jwt.claim.sub', '', true);
            perform set_config('request.jwt.claim.role', '', true);
            perform set_config('request.jwt.claims', '', true);

            insert into _p9_f41b1_results
            values (5, 'bloqueio de store de outra organizacao', 'PASS', 'cross-organization store was blocked');
        end;
      exception
        when others then
          begin
            execute 'reset role';
          exception when others then
            null;
          end;
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          if not exists (select 1 from _p9_f41b1_results where scenario_number = 5) then
            insert into _p9_f41b1_results
            values (5, 'bloqueio de store de outra organizacao', 'FAIL', 'unexpected sqlstate ' || sqlstate);
          end if;
      end;
    end if;
  end if;

  if v_org_b is null or v_store_b1 is null or v_user_b_any is null then
    insert into _p9_f41b1_results
    values (6, 'bloqueio de customer de outra organizacao', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing organization B with store and membership');
  elsif v_customer_b_id is null then
    insert into _p9_f41b1_results
    values (6, 'bloqueio de customer de outra organizacao', 'FAIL', 'customer fixture for organization B could not be created');
  else
    begin
      execute 'set local role authenticated';
      perform set_config('request.jwt.claim.sub', v_user_a_any::text, true);
      perform set_config('request.jwt.claim.role', 'authenticated', true);
      perform set_config(
        'request.jwt.claims',
        json_build_object('sub', v_user_a_any::text, 'role', 'authenticated')::text,
        true
      );
      select auth.uid() into v_auth_uid;

      if v_auth_uid is distinct from v_user_a_any then
        raise exception using errcode = 'P0001', message = 'auth.uid mismatch for user A';
      end if;

      v_attempt_opportunity_id := gen_random_uuid();

      begin
        insert into public.commercial_opportunities (
          id,
          organization_id,
          store_id,
          customer_id
        ) values (
          v_attempt_opportunity_id,
          v_org_a,
          v_store_a1,
          v_customer_b_id
        );

        update _p9_f41b1_context
        set created_opportunity_ids = created_opportunity_ids || v_attempt_opportunity_id;

        execute 'reset role';
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);

        insert into _p9_f41b1_results
        values (6, 'bloqueio de customer de outra organizacao', 'FAIL', 'cross-organization customer was accepted');
      exception
        when insufficient_privilege then
          execute 'reset role';
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          insert into _p9_f41b1_results
          values (6, 'bloqueio de customer de outra organizacao', 'PASS', 'cross-organization customer was blocked');
      end;
    exception
      when others then
        begin
          execute 'reset role';
        exception when others then
          null;
        end;
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);

        if not exists (select 1 from _p9_f41b1_results where scenario_number = 6) then
          insert into _p9_f41b1_results
          values (6, 'bloqueio de customer de outra organizacao', 'FAIL', 'unexpected sqlstate ' || sqlstate);
        end if;
    end;
  end if;

  if not exists (select 1 from _p9_f41b1_results where scenario_number = 7) then
    if v_opportunity_main_id is null then
      insert into _p9_f41b1_results
      values (7, 'bloqueio de mudanca de organization_id por authenticated', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing base opportunity fixture');
    else
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claim.sub', v_user_a_any::text, true);
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform set_config(
          'request.jwt.claims',
          json_build_object('sub', v_user_a_any::text, 'role', 'authenticated')::text,
          true
        );
        select auth.uid() into v_auth_uid;

        if v_auth_uid is distinct from v_user_a_any then
          raise exception using errcode = 'P0001', message = 'auth.uid mismatch for user A';
        end if;

        begin
          update public.commercial_opportunities
          set organization_id = v_org_b
          where id = v_opportunity_main_id;

          execute 'reset role';
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          insert into _p9_f41b1_results
          values (7, 'bloqueio de mudanca de organization_id por authenticated', 'FAIL', 'organization_id update by authenticated was accepted');
        exception
          when sqlstate 'P0001' then
            execute 'reset role';
            perform set_config('request.jwt.claim.sub', '', true);
            perform set_config('request.jwt.claim.role', '', true);
            perform set_config('request.jwt.claims', '', true);

            insert into _p9_f41b1_results
            values (7, 'bloqueio de mudanca de organization_id por authenticated', 'PASS', 'organization_id update by authenticated was blocked by trigger');
        end;
      exception
        when others then
          begin
            execute 'reset role';
          exception when others then
            null;
          end;
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          if not exists (select 1 from _p9_f41b1_results where scenario_number = 7) then
            insert into _p9_f41b1_results
            values (7, 'bloqueio de mudanca de organization_id por authenticated', 'FAIL', 'unexpected sqlstate ' || sqlstate);
          end if;
      end;
    end if;
  end if;

  if not exists (select 1 from _p9_f41b1_results where scenario_number = 8) then
    if v_opportunity_main_id is null then
      insert into _p9_f41b1_results
      values (8, 'bloqueio de mudanca de organization_id por service_role', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing base opportunity fixture');
    else
      begin
        execute 'set local role service_role';
        perform set_config('request.jwt.claim.role', 'service_role', true);
        perform set_config(
          'request.jwt.claims',
          json_build_object('role', 'service_role')::text,
          true
        );

        begin
          update public.commercial_opportunities
          set organization_id = v_org_b
          where id = v_opportunity_main_id;

          execute 'reset role';
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          insert into _p9_f41b1_results
          values (8, 'bloqueio de mudanca de organization_id por service_role', 'FAIL', 'organization_id update by service_role was accepted');
        exception
          when sqlstate 'P0001' then
            execute 'reset role';
            perform set_config('request.jwt.claim.role', '', true);
            perform set_config('request.jwt.claims', '', true);

            insert into _p9_f41b1_results
            values (8, 'bloqueio de mudanca de organization_id por service_role', 'PASS', 'organization_id update by service_role was blocked by trigger');
        end;
      exception
        when others then
          begin
            execute 'reset role';
          exception when others then
            null;
          end;
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          if not exists (select 1 from _p9_f41b1_results where scenario_number = 8) then
            insert into _p9_f41b1_results
            values (8, 'bloqueio de mudanca de organization_id por service_role', 'FAIL', 'unexpected sqlstate ' || sqlstate);
          end if;
      end;
    end if;
  end if;

  if not exists (select 1 from _p9_f41b1_results where scenario_number = 9) then
    if v_opportunity_main_id is null then
      insert into _p9_f41b1_results
      values (9, 'atualizacao comum permitida', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing base opportunity fixture');
    else
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claim.sub', v_user_a_any::text, true);
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform set_config(
          'request.jwt.claims',
          json_build_object('sub', v_user_a_any::text, 'role', 'authenticated')::text,
          true
        );
        select auth.uid() into v_auth_uid;

        if v_auth_uid is distinct from v_user_a_any then
          raise exception using errcode = 'P0001', message = 'auth.uid mismatch for user A';
        end if;

        select updated_at, stage_changed_at
          into v_before_updated_at, v_before_stage_changed_at
        from public.commercial_opportunities
        where id = v_opportunity_main_id;

        perform pg_sleep(0.05);

        update public.commercial_opportunities
        set primary_conversation_id = gen_random_uuid()
        where id = v_opportunity_main_id;

        select updated_at, stage_changed_at
          into v_after_updated_at, v_after_stage_changed_at
        from public.commercial_opportunities
        where id = v_opportunity_main_id;

        v_original_stage_changed_at := v_after_stage_changed_at;

        execute 'reset role';
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);

        insert into _p9_f41b1_results
        values (9, 'atualizacao comum permitida', 'PASS', 'ordinary update preserving organization_id succeeded');

        insert into _p9_f41b1_results
        values (
          10,
          'updated_at avanca',
          case when v_after_updated_at > v_before_updated_at then 'PASS' else 'FAIL' end,
          case when v_after_updated_at > v_before_updated_at then 'updated_at advanced after ordinary update' else 'updated_at did not advance after ordinary update' end
        );

        insert into _p9_f41b1_results
        values (
          11,
          'stage_changed_at nao muda sem mudar stage',
          case when v_after_stage_changed_at = v_before_stage_changed_at then 'PASS' else 'FAIL' end,
          case when v_after_stage_changed_at = v_before_stage_changed_at then 'stage_changed_at remained stable when stage did not change' else 'stage_changed_at changed without stage change' end
        );
      exception
        when others then
          begin
            execute 'reset role';
          exception when others then
            null;
          end;
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          insert into _p9_f41b1_results
          values (9, 'atualizacao comum permitida', 'FAIL', 'unexpected sqlstate ' || sqlstate);

          if not exists (select 1 from _p9_f41b1_results where scenario_number = 10) then
            insert into _p9_f41b1_results
            values (10, 'updated_at avanca', 'FAIL', 'ordinary update fixture failed');
          end if;

          if not exists (select 1 from _p9_f41b1_results where scenario_number = 11) then
            insert into _p9_f41b1_results
            values (11, 'stage_changed_at nao muda sem mudar stage', 'FAIL', 'ordinary update fixture failed');
          end if;
      end;
    end if;
  end if;

  if not exists (select 1 from _p9_f41b1_results where scenario_number = 12) then
    if v_opportunity_main_id is null then
      insert into _p9_f41b1_results
      values (12, 'stage_changed_at muda quando stage muda', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing base opportunity fixture');
    else
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claim.sub', v_user_a_any::text, true);
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform set_config(
          'request.jwt.claims',
          json_build_object('sub', v_user_a_any::text, 'role', 'authenticated')::text,
          true
        );
        select auth.uid() into v_auth_uid;

        if v_auth_uid is distinct from v_user_a_any then
          raise exception using errcode = 'P0001', message = 'auth.uid mismatch for user A';
        end if;

        select stage_changed_at
          into v_before_stage_changed_at
        from public.commercial_opportunities
        where id = v_opportunity_main_id;

        perform pg_sleep(0.05);

        update public.commercial_opportunities
        set stage = 'negociacao'
        where id = v_opportunity_main_id;

        select stage_changed_at
          into v_after_stage_changed_at
        from public.commercial_opportunities
        where id = v_opportunity_main_id;

        execute 'reset role';
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);

        insert into _p9_f41b1_results
        values (
          12,
          'stage_changed_at muda quando stage muda',
          case when v_after_stage_changed_at > v_before_stage_changed_at then 'PASS' else 'FAIL' end,
          case when v_after_stage_changed_at > v_before_stage_changed_at then 'stage_changed_at advanced when stage changed' else 'stage_changed_at did not advance when stage changed' end
        );
      exception
        when others then
          begin
            execute 'reset role';
          exception when others then
            null;
          end;
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          insert into _p9_f41b1_results
          values (12, 'stage_changed_at muda quando stage muda', 'FAIL', 'unexpected sqlstate ' || sqlstate);
      end;
    end if;
  end if;

  if v_user_b_exclusive is null then
    insert into _p9_f41b1_results values
      (13, 'usuario de outra organizacao nao visualiza', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing user exclusive to organization B relative to organization A'),
      (14, 'usuario de outra organizacao nao insere', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing user exclusive to organization B relative to organization A');
  elsif v_opportunity_main_id is null or v_customer_a_id is null then
    insert into _p9_f41b1_results values
      (13, 'usuario de outra organizacao nao visualiza', 'FAIL', 'base opportunity fixture could not be created'),
      (14, 'usuario de outra organizacao nao insere', 'FAIL', 'base customer fixture could not be created');
  else
    begin
      execute 'set local role authenticated';
      perform set_config('request.jwt.claim.sub', v_user_b_exclusive::text, true);
      perform set_config('request.jwt.claim.role', 'authenticated', true);
      perform set_config(
        'request.jwt.claims',
        json_build_object('sub', v_user_b_exclusive::text, 'role', 'authenticated')::text,
        true
      );
      select auth.uid() into v_auth_uid;

      if v_auth_uid is distinct from v_user_b_exclusive then
        raise exception using errcode = 'P0001', message = 'auth.uid mismatch for exclusive user B';
      end if;

      select count(*)
        into v_counter
      from public.commercial_opportunities
      where id = v_opportunity_main_id;

      execute 'reset role';
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims', '', true);

      insert into _p9_f41b1_results
      values (
        13,
        'usuario de outra organizacao nao visualiza',
        case when v_counter = 0 then 'PASS' else 'FAIL' end,
        case when v_counter = 0 then 'user from another organization could not view the opportunity' else 'user from another organization unexpectedly viewed the opportunity' end
      );
    exception
      when others then
        begin
          execute 'reset role';
        exception when others then
          null;
        end;
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);

        insert into _p9_f41b1_results
        values (13, 'usuario de outra organizacao nao visualiza', 'FAIL', 'unexpected sqlstate ' || sqlstate);
    end;

    begin
      execute 'set local role authenticated';
      perform set_config('request.jwt.claim.sub', v_user_b_exclusive::text, true);
      perform set_config('request.jwt.claim.role', 'authenticated', true);
      perform set_config(
        'request.jwt.claims',
        json_build_object('sub', v_user_b_exclusive::text, 'role', 'authenticated')::text,
        true
      );
      select auth.uid() into v_auth_uid;

      if v_auth_uid is distinct from v_user_b_exclusive then
        raise exception using errcode = 'P0001', message = 'auth.uid mismatch for exclusive user B';
      end if;

      v_attempt_opportunity_id := gen_random_uuid();

      begin
        insert into public.commercial_opportunities (
          id,
          organization_id,
          store_id,
          customer_id
        ) values (
          v_attempt_opportunity_id,
          v_org_a,
          v_store_a1,
          v_customer_a_id
        );

        update _p9_f41b1_context
        set created_opportunity_ids = created_opportunity_ids || v_attempt_opportunity_id;

        execute 'reset role';
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);

        insert into _p9_f41b1_results
        values (14, 'usuario de outra organizacao nao insere', 'FAIL', 'user from another organization unexpectedly inserted opportunity in organization A');
      exception
        when insufficient_privilege then
          execute 'reset role';
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          insert into _p9_f41b1_results
          values (14, 'usuario de outra organizacao nao insere', 'PASS', 'user from another organization was blocked from inserting opportunity in organization A');
      end;
    exception
      when others then
        begin
          execute 'reset role';
        exception when others then
          null;
        end;
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);

        if not exists (select 1 from _p9_f41b1_results where scenario_number = 14) then
          insert into _p9_f41b1_results
          values (14, 'usuario de outra organizacao nao insere', 'FAIL', 'unexpected sqlstate ' || sqlstate);
        end if;
    end;
  end if;

  if not exists (select 1 from _p9_f41b1_results where scenario_number = 15) then
    if v_opportunity_main_id is null then
      insert into _p9_f41b1_results
      values (15, 'authenticated nao executa DELETE', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing base opportunity fixture');
    else
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claim.sub', v_user_a_any::text, true);
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform set_config(
          'request.jwt.claims',
          json_build_object('sub', v_user_a_any::text, 'role', 'authenticated')::text,
          true
        );
        select auth.uid() into v_auth_uid;

        if v_auth_uid is distinct from v_user_a_any then
          raise exception using errcode = 'P0001', message = 'auth.uid mismatch for user A';
        end if;

        begin
          delete from public.commercial_opportunities
          where id = v_opportunity_main_id;

          execute 'reset role';
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          insert into _p9_f41b1_results
          values (15, 'authenticated nao executa DELETE', 'FAIL', 'authenticated unexpectedly executed DELETE');
        exception
          when insufficient_privilege then
            execute 'reset role';
            perform set_config('request.jwt.claim.sub', '', true);
            perform set_config('request.jwt.claim.role', '', true);
            perform set_config('request.jwt.claims', '', true);

            insert into _p9_f41b1_results
            values (15, 'authenticated nao executa DELETE', 'PASS', 'authenticated could not execute DELETE');
        end;
      exception
        when others then
          begin
            execute 'reset role';
          exception when others then
            null;
          end;
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          if not exists (select 1 from _p9_f41b1_results where scenario_number = 15) then
            insert into _p9_f41b1_results
            values (15, 'authenticated nao executa DELETE', 'FAIL', 'unexpected sqlstate ' || sqlstate);
          end if;
      end;
    end if;
  end if;

  if not exists (select 1 from _p9_f41b1_results where scenario_number = 18) then
    if v_customer_a_id is null then
      insert into _p9_f41b1_results
      values (18, 'mesmo customer pode possuir duas oportunidades', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing customer fixture in organization A');
    else
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claim.sub', v_user_a_any::text, true);
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform set_config(
          'request.jwt.claims',
          json_build_object('sub', v_user_a_any::text, 'role', 'authenticated')::text,
          true
        );
        select auth.uid() into v_auth_uid;

        if v_auth_uid is distinct from v_user_a_any then
          raise exception using errcode = 'P0001', message = 'auth.uid mismatch for user A';
        end if;

        v_second_opportunity_id := gen_random_uuid();
        insert into public.commercial_opportunities (
          id,
          organization_id,
          store_id,
          customer_id,
          stage
        ) values (
          v_second_opportunity_id,
          v_org_a,
          v_store_a1,
          v_customer_a_id,
          'qualificacao'
        );

        execute 'reset role';
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);

        update _p9_f41b1_context
        set created_opportunity_ids = created_opportunity_ids || v_second_opportunity_id;

        insert into _p9_f41b1_results
        values (18, 'mesmo customer pode possuir duas oportunidades', 'PASS', 'same customer accepted multiple opportunities');
      exception
        when others then
          begin
            execute 'reset role';
          exception when others then
            null;
          end;
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          insert into _p9_f41b1_results
          values (18, 'mesmo customer pode possuir duas oportunidades', 'FAIL', 'unexpected sqlstate ' || sqlstate);
      end;
    end if;
  end if;

  if not exists (select 1 from _p9_f41b1_results where scenario_number = 19) then
    if v_customer_a_id is null then
      insert into _p9_f41b1_results
      values (19, 'origin_lead_id pode se repetir', 'BLOCKED', 'BLOCKED_BY_FIXTURE_PREREQUISITE: missing customer fixture in organization A');
    else
      begin
        v_same_origin_lead_id := gen_random_uuid();

        execute 'set local role authenticated';
        perform set_config('request.jwt.claim.sub', v_user_a_any::text, true);
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform set_config(
          'request.jwt.claims',
          json_build_object('sub', v_user_a_any::text, 'role', 'authenticated')::text,
          true
        );
        select auth.uid() into v_auth_uid;

        if v_auth_uid is distinct from v_user_a_any then
          raise exception using errcode = 'P0001', message = 'auth.uid mismatch for user A';
        end if;

        v_repeat_origin_opportunity_a_id := gen_random_uuid();
        insert into public.commercial_opportunities (
          id,
          organization_id,
          store_id,
          customer_id,
          origin_lead_id
        ) values (
          v_repeat_origin_opportunity_a_id,
          v_org_a,
          v_store_a1,
          v_customer_a_id,
          v_same_origin_lead_id
        );

        v_repeat_origin_opportunity_b_id := gen_random_uuid();
        insert into public.commercial_opportunities (
          id,
          organization_id,
          store_id,
          customer_id,
          origin_lead_id,
          stage
        ) values (
          v_repeat_origin_opportunity_b_id,
          v_org_a,
          v_store_a1,
          v_customer_a_id,
          v_same_origin_lead_id,
          'orcamento'
        );

        execute 'reset role';
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);

        update _p9_f41b1_context
        set created_opportunity_ids = created_opportunity_ids || v_repeat_origin_opportunity_a_id || v_repeat_origin_opportunity_b_id;

        insert into _p9_f41b1_results
        values (19, 'origin_lead_id pode se repetir', 'PASS', 'repeated origin_lead_id was accepted on multiple opportunities');
      exception
        when others then
          begin
            execute 'reset role';
          exception when others then
            null;
          end;
          perform set_config('request.jwt.claim.sub', '', true);
          perform set_config('request.jwt.claim.role', '', true);
          perform set_config('request.jwt.claims', '', true);

          insert into _p9_f41b1_results
          values (19, 'origin_lead_id pode se repetir', 'FAIL', 'unexpected sqlstate ' || sqlstate);
      end;
    end if;
  end if;

  begin
    select
      created_customer_ids,
      created_opportunity_ids
    into
      v_created_customer_ids,
      v_created_opportunity_ids
    from _p9_f41b1_context
    limit 1;

    v_created_customer_ids := coalesce(v_created_customer_ids, '{}'::uuid[]);
    v_created_opportunity_ids := coalesce(v_created_opportunity_ids, '{}'::uuid[]);

    delete from public.commercial_opportunities
    where id = any(v_created_opportunity_ids);

    delete from public.customers
    where id = any(v_created_customer_ids);

    select
      (select count(*)
       from public.commercial_opportunities
       where id = any(v_created_opportunity_ids))
      +
      (select count(*)
       from public.customers
       where id = any(v_created_customer_ids))
      into v_counter;

    update _p9_f41b1_context
    set cleanup_status = case when v_counter = 0 then 'PASS' else 'FAIL' end;

    insert into _p9_f41b1_results
    values (
      20,
      'limpeza total dos registros do runner',
      case when v_counter = 0 then 'PASS' else 'FAIL' end,
      case when v_counter = 0 then 'no runner records remained after cleanup' else 'runner cleanup left residual records' end
    );
  exception
    when others then
      raise;
  end;
end;
$$;

select
  scenario_number,
  scenario_name,
  status,
  detail
from _p9_f41b1_results
order by scenario_number;

select
  count(*) as total_scenarios,
  count(*) filter (where status = 'PASS') as total_pass,
  count(*) filter (where status = 'FAIL') as total_fail,
  count(*) filter (where status = 'BLOCKED') as total_blocked,
  (select cleanup_status from _p9_f41b1_context limit 1) as cleanup_status,
  case
    when count(*) <> 20 then 'AINDA_NAO_APROVADA'
    when count(*) filter (where status = 'FAIL') > 0 then 'AINDA_NAO_APROVADA'
    when count(*) filter (where status = 'BLOCKED') > 0 then 'BLOCKED_BY_FIXTURE_PREREQUISITE'
    else 'APROVADA'
  end as final_status
from _p9_f41b1_results;

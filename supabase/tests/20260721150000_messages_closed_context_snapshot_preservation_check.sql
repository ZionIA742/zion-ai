-- ZION / Pilar 9 / Bloco 4 / Etapa 4.16
-- Um unico teste: preservar o snapshot da mensagem apos encerrar o contexto.
--
-- Esperado:
-- - a mensagem nasce com commercial_context_capture_state = 'captured';
-- - conversation_session_id e commercial_session_context_link_id sao gravados;
-- - o contexto e encerrado pela funcao oficial;
-- - a mensagem continua apontando para a mesma sessao e para o mesmo vinculo.
--
-- O runner:
-- - reutiliza uma conversa real apenas como parent imutavel;
-- - cria uma oportunidade, uma sessao e um contexto proprios;
-- - cria uma mensagem outgoing via public.insert_message();
-- - encerra o contexto via public.close_commercial_session_context_link();
-- - confirma que o snapshot historico da mensagem foi preservado;
-- - remove todas as fixtures;
-- - confirma que a conversa permaneceu intacta;
-- - nao usa session_replication_role.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:block4:step4.16:closed_context_snapshot_preservation',
    0
  )
);

create temp table _p9_416_result (
  row_order integer primary key,
  row_type text not null,
  status text not null,
  detail text not null,
  final_status text null
) on commit preserve rows;

do $test$
declare
  v_run_id uuid := gen_random_uuid();
  v_conversation_id uuid;
  v_organization_id uuid;
  v_store_id uuid;
  v_lead_id uuid;
  v_customer_id uuid;
  v_lead_customer_link_id uuid;
  v_member_user_id uuid;
  v_conversation_before jsonb;

  v_opportunity_id uuid := gen_random_uuid();
  v_session_id uuid := gen_random_uuid();
  v_context_link_id uuid;
  v_message_id uuid;

  v_opportunity_created boolean := false;
  v_session_created boolean := false;
  v_context_created boolean := false;
  v_context_ready boolean := false;

  v_context_rpc_ok boolean := false;
  v_context_sqlstate text;
  v_context_error text;

  v_insert_ok boolean := false;
  v_insert_sqlstate text;
  v_insert_error text;
  v_initial_snapshot_ok boolean := false;

  v_close_ok boolean := false;
  v_close_sqlstate text;
  v_close_error text;
  v_context_closed boolean := false;
  v_snapshot_preserved boolean := false;

  v_last_message_trigger_disabled boolean := false;
  v_context_write_trigger_disabled boolean := false;

  v_message_residue_count bigint := 0;
  v_context_residue_count bigint := 0;
  v_session_residue_count bigint := 0;
  v_opportunity_residue_count bigint := 0;

  v_conversation_unchanged boolean := true;
  v_last_message_trigger_enabled boolean := false;
  v_fill_trigger_enabled boolean := false;
  v_context_write_trigger_enabled boolean := false;
  v_identity_clean boolean := false;
  v_cleanup_ok boolean := false;

  v_unexpected_sqlstate text;
  v_unexpected_error text;
begin
  if current_user <> 'postgres'
     or session_user <> 'postgres'
     or pg_catalog.to_regclass('public.messages') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.lead_customer_links') is null
     or pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.conversation_sessions') is null
     or pg_catalog.to_regclass('public.commercial_session_context_links') is null
     or pg_catalog.to_regprocedure(
       'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.link_commercial_session_context(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,timestamp with time zone)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.close_commercial_session_context_link(uuid,uuid,uuid,text,uuid,text,text,jsonb,uuid)'
     ) is null
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.insert_message(uuid,text,text,text,text,text,text,jsonb)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated',
       'public.link_commercial_session_context(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,timestamp with time zone)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated',
       'public.close_commercial_session_context_link(uuid,uuid,uuid,text,uuid,text,text,jsonb,uuid)',
       'EXECUTE'
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.messages'::regclass
         and not trigger_row.tgisinternal
         and trigger_row.tgname = 'trg_conversations_last_message_sync'
         and trigger_row.tgenabled = 'O'
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.messages'::regclass
         and not trigger_row.tgisinternal
         and trigger_row.tgname = 'trg_fill_messages_lead_store'
         and trigger_row.tgenabled = 'O'
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
         'public.commercial_session_context_links'::regclass
         and not trigger_row.tgisinternal
         and trigger_row.tgname =
           'commercial_session_context_links_enforce_write_rules'
         and trigger_row.tgenabled = 'O'
     ) then
    insert into pg_temp._p9_416_result values (
      1,
      'CHECK',
      'BLOCKED',
      'preflight bloqueado: usuario, objetos, permissoes ou triggers obrigatorios ausentes',
      null
    );

    insert into pg_temp._p9_416_result values (
      2,
      'CLEANUP',
      'PASS',
      'nenhuma fixture foi criada',
      null
    );

    return;
  end if;

  select
    conversation_row.id,
    conversation_row.organization_id,
    lead_row.store_id,
    lead_row.id,
    link_row.customer_id,
    link_row.id,
    membership_row.user_id,
    pg_catalog.to_jsonb(conversation_row)
  into
    v_conversation_id,
    v_organization_id,
    v_store_id,
    v_lead_id,
    v_customer_id,
    v_lead_customer_link_id,
    v_member_user_id,
    v_conversation_before
  from public.conversations conversation_row
  join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
   and lead_row.organization_id = conversation_row.organization_id
  join public.lead_customer_links link_row
    on link_row.lead_id = lead_row.id
   and link_row.organization_id = lead_row.organization_id
   and link_row.store_id = lead_row.store_id
   and link_row.status = 'active'
  join public.customers customer_row
    on customer_row.id = link_row.customer_id
   and customer_row.organization_id = link_row.organization_id
   and customer_row.merged_into_customer_id is null
  join lateral (
    select membership_candidate.user_id
    from public.memberships membership_candidate
    where membership_candidate.organization_id =
      conversation_row.organization_id
      and membership_candidate.user_id is not null
    order by membership_candidate.created_at, membership_candidate.user_id
    limit 1
  ) membership_row on true
  where lead_row.store_id is not null
    and not exists (
      select 1
      from public.conversation_sessions session_row
      where session_row.conversation_id = conversation_row.id
        and session_row.organization_id = conversation_row.organization_id
        and session_row.store_id = lead_row.store_id
        and session_row.status = 'active'
    )
  order by conversation_row.id
  limit 1
  for update of conversation_row skip locked;

  if v_conversation_id is null
     or v_customer_id is null
     or v_lead_customer_link_id is null
     or v_member_user_id is null then
    insert into pg_temp._p9_416_result values (
      1,
      'CHECK',
      'BLOCKED',
      'nenhuma conversa elegivel com cliente, vinculo ativo e membership foi encontrada',
      null
    );

    insert into pg_temp._p9_416_result values (
      2,
      'CLEANUP',
      'PASS',
      'nenhuma fixture foi criada',
      null
    );

    return;
  end if;

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    origin_lead_id,
    primary_conversation_id,
    stage
  ) values (
    v_opportunity_id,
    v_organization_id,
    v_store_id,
    v_customer_id,
    v_lead_id,
    v_conversation_id,
    'qualificacao'
  );

  v_opportunity_created := true;

  insert into public.conversation_sessions (
    id,
    organization_id,
    store_id,
    conversation_id,
    status
  ) values (
    v_session_id,
    v_organization_id,
    v_store_id,
    v_conversation_id,
    'active'
  );

  v_session_created := true;

  begin
    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      v_member_user_id::text,
      true
    );
    perform pg_catalog.set_config(
      'request.jwt.claim.role',
      'authenticated',
      true
    );
    perform pg_catalog.set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object(
        'sub', v_member_user_id::text,
        'role', 'authenticated'
      )::text,
      true
    );

    execute 'set local role authenticated';

    select (
      public.link_commercial_session_context(
        v_organization_id,
        v_store_id,
        v_session_id,
        v_customer_id,
        v_opportunity_id,
        v_lead_customer_link_id,
        'manual',
        'human',
        v_member_user_id,
        'runner Etapa 4.16',
        'runner:' || v_run_id::text || ':context',
        v_run_id,
        pg_catalog.jsonb_build_object(
          'runner_name', 'p9_block4_step4_16',
          'runner_run_id', v_run_id::text
        ),
        null
      )
    ).id
    into v_context_link_id;

    v_context_rpc_ok := true;
  exception
    when others then
      get stacked diagnostics
        v_context_sqlstate = returned_sqlstate,
        v_context_error = message_text;
      v_context_rpc_ok := false;
  end;

  begin
    execute 'reset role';
  exception
    when others then
      null;
  end;

  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);

  v_context_created :=
    v_context_rpc_ok
    and v_context_link_id is not null;

  select exists (
    select 1
    from public.commercial_session_context_links context_row
    where context_row.id = v_context_link_id
      and context_row.organization_id = v_organization_id
      and context_row.store_id = v_store_id
      and context_row.conversation_session_id = v_session_id
      and context_row.customer_id = v_customer_id
      and context_row.commercial_opportunity_id = v_opportunity_id
      and context_row.lead_customer_link_id = v_lead_customer_link_id
      and context_row.status = 'active'
      and context_row.correlation_id = v_run_id
  )
  into v_context_ready;

  if not v_context_created or not v_context_ready then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'Etapa 4.16 nao conseguiu criar contexto ativo (rpc_ok=%s, context_id=%s, ready=%s, sqlstate=%s, error=%s)',
        v_context_rpc_ok,
        coalesce(v_context_link_id::text, '<null>'),
        v_context_ready,
        coalesce(v_context_sqlstate, '<null>'),
        coalesce(v_context_error, '<null>')
      );
  end if;

  execute
    'alter table public.messages disable trigger trg_conversations_last_message_sync';
  v_last_message_trigger_disabled := true;

  begin
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config(
      'request.jwt.claim.role',
      'service_role',
      true
    );
    perform pg_catalog.set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object('role', 'service_role')::text,
      true
    );

    execute 'set local role service_role';

    select (
      public.insert_message(
        v_conversation_id,
        'human',
        'outgoing',
        'text',
        'runner Etapa 4.16 ' || v_run_id::text,
        null,
        null,
        pg_catalog.jsonb_build_object(
          'runner_name', 'p9_block4_step4_16',
          'runner_run_id', v_run_id::text,
          'runner_session_id', v_session_id::text,
          'runner_context_link_id', v_context_link_id::text
        )
      )
    ).id
    into v_message_id;

    v_insert_ok := true;
  exception
    when others then
      get stacked diagnostics
        v_insert_sqlstate = returned_sqlstate,
        v_insert_error = message_text;
      v_insert_ok := false;
  end;

  begin
    execute 'reset role';
  exception
    when others then
      null;
  end;

  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);

  select exists (
    select 1
    from public.messages message_row
    where message_row.id = v_message_id
      and message_row.conversation_id = v_conversation_id
      and message_row.organization_id = v_organization_id
      and message_row.store_id = v_store_id
      and message_row.lead_id = v_lead_id
      and message_row.sender = 'human'
      and message_row.direction = 'outgoing'
      and message_row.message_type = 'text'
      and message_row.commercial_context_capture_state = 'captured'
      and message_row.conversation_session_id = v_session_id
      and message_row.commercial_session_context_link_id =
        v_context_link_id
      and message_row.metadata @> pg_catalog.jsonb_build_object(
        'runner_name', 'p9_block4_step4_16',
        'runner_run_id', v_run_id::text,
        'runner_session_id', v_session_id::text,
        'runner_context_link_id', v_context_link_id::text
      )
      and exists (
        select 1
        from public.commercial_session_context_links context_row
        where context_row.id = v_context_link_id
          and context_row.organization_id = v_organization_id
          and context_row.store_id = v_store_id
          and context_row.conversation_session_id = v_session_id
          and context_row.status = 'active'
      )
  )
  into v_initial_snapshot_ok;


  begin
    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      v_member_user_id::text,
      true
    );
    perform pg_catalog.set_config(
      'request.jwt.claim.role',
      'authenticated',
      true
    );
    perform pg_catalog.set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object(
        'sub', v_member_user_id::text,
        'role', 'authenticated'
      )::text,
      true
    );

    execute 'set local role authenticated';

    perform public.close_commercial_session_context_link(
      v_context_link_id,
      v_organization_id,
      v_store_id,
      'human',
      v_member_user_id,
      'runner_stage_4_16',
      'runner Etapa 4.16',
      pg_catalog.jsonb_build_object(
        'runner_name', 'p9_block4_step4_16',
        'runner_run_id', v_run_id::text
      ),
      v_run_id
    );

    v_close_ok := true;
  exception
    when others then
      get stacked diagnostics
        v_close_sqlstate = returned_sqlstate,
        v_close_error = message_text;
      v_close_ok := false;
  end;

  begin
    execute 'reset role';
  exception
    when others then
      null;
  end;

  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);

  select exists (
    select 1
    from public.commercial_session_context_links context_row
    where context_row.id = v_context_link_id
      and context_row.organization_id = v_organization_id
      and context_row.store_id = v_store_id
      and context_row.conversation_session_id = v_session_id
      and context_row.customer_id = v_customer_id
      and context_row.commercial_opportunity_id = v_opportunity_id
      and context_row.lead_customer_link_id = v_lead_customer_link_id
      and context_row.status = 'inactive'
      and context_row.unlinked_at is not null
      and context_row.unlinked_by_actor_type = 'human'
      and context_row.unlinked_by_user_id = v_member_user_id
      and context_row.unlink_reason_code = 'runner_stage_4_16'
      and context_row.unlink_reason = 'runner Etapa 4.16'
      and context_row.metadata #>> '{unlink,correlation_id}' =
        v_run_id::text
  )
  into v_context_closed;

  select exists (
    select 1
    from public.messages message_row
    where message_row.id = v_message_id
      and message_row.conversation_id = v_conversation_id
      and message_row.organization_id = v_organization_id
      and message_row.store_id = v_store_id
      and message_row.lead_id = v_lead_id
      and message_row.commercial_context_capture_state = 'captured'
      and message_row.conversation_session_id = v_session_id
      and message_row.commercial_session_context_link_id =
        v_context_link_id
      and message_row.metadata @> pg_catalog.jsonb_build_object(
        'runner_name', 'p9_block4_step4_16',
        'runner_run_id', v_run_id::text,
        'runner_session_id', v_session_id::text,
        'runner_context_link_id', v_context_link_id::text
      )
      and exists (
        select 1
        from public.commercial_session_context_links context_row
        where context_row.id = v_context_link_id
          and context_row.status = 'inactive'
      )
  )
  into v_snapshot_preserved;

  insert into pg_temp._p9_416_result values (
    1,
    'CHECK',
    case
      when v_opportunity_created
       and v_session_created
       and v_context_created
       and v_context_ready
       and v_insert_ok
       and v_message_id is not null
       and v_initial_snapshot_ok
       and v_close_ok
       and v_context_closed
       and v_snapshot_preserved
      then 'PASS'
      else 'SUT_FAIL'
    end,
    pg_catalog.format(
      'conversation_id=%s | opportunity_id=%s | session_id=%s | context_link_id=%s | message_id=%s | context_ready=%s | insert_ok=%s | initial_snapshot_ok=%s | close_ok=%s | context_closed=%s | snapshot_preserved=%s | context_sqlstate=%s | context_error=%s | insert_sqlstate=%s | insert_error=%s | close_sqlstate=%s | close_error=%s',
      v_conversation_id,
      v_opportunity_id,
      v_session_id,
      coalesce(v_context_link_id::text, '<null>'),
      coalesce(v_message_id::text, '<null>'),
      v_context_ready,
      v_insert_ok,
      v_initial_snapshot_ok,
      v_close_ok,
      v_context_closed,
      v_snapshot_preserved,
      coalesce(v_context_sqlstate, '<null>'),
      coalesce(v_context_error, '<null>'),
      coalesce(v_insert_sqlstate, '<null>'),
      coalesce(v_insert_error, '<null>'),
      coalesce(v_close_sqlstate, '<null>'),
      coalesce(v_close_error, '<null>')
    ),
    null
  );

  delete from public.messages message_row
  where message_row.metadata @> pg_catalog.jsonb_build_object(
    'runner_name', 'p9_block4_step4_16',
    'runner_run_id', v_run_id::text
  );

  execute
    'alter table public.messages enable trigger trg_conversations_last_message_sync';
  v_last_message_trigger_disabled := false;

  execute
    'alter table public.commercial_session_context_links disable trigger commercial_session_context_links_enforce_write_rules';
  v_context_write_trigger_disabled := true;

  delete from public.commercial_session_context_links context_row
  where context_row.id = v_context_link_id
    and context_row.correlation_id = v_run_id;

  execute
    'alter table public.commercial_session_context_links enable trigger commercial_session_context_links_enforce_write_rules';
  v_context_write_trigger_disabled := false;

  delete from public.conversation_sessions session_row
  where session_row.id = v_session_id
    and session_row.organization_id = v_organization_id
    and session_row.store_id = v_store_id
    and session_row.conversation_id = v_conversation_id;

  delete from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_opportunity_id
    and opportunity_row.organization_id = v_organization_id
    and opportunity_row.store_id = v_store_id
    and opportunity_row.customer_id = v_customer_id;

  select count(*)
  into v_message_residue_count
  from public.messages message_row
  where message_row.metadata @> pg_catalog.jsonb_build_object(
    'runner_name', 'p9_block4_step4_16',
    'runner_run_id', v_run_id::text
  );

  select count(*)
  into v_context_residue_count
  from public.commercial_session_context_links context_row
  where context_row.correlation_id = v_run_id;

  select count(*)
  into v_session_residue_count
  from public.conversation_sessions session_row
  where session_row.id = v_session_id;

  select count(*)
  into v_opportunity_residue_count
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_opportunity_id;

  select pg_catalog.to_jsonb(conversation_row)
         is not distinct from v_conversation_before
  into v_conversation_unchanged
  from public.conversations conversation_row
  where conversation_row.id = v_conversation_id;

  select exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.messages'::regclass
      and not trigger_row.tgisinternal
      and trigger_row.tgname = 'trg_conversations_last_message_sync'
      and trigger_row.tgenabled = 'O'
  )
  into v_last_message_trigger_enabled;

  select exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.messages'::regclass
      and not trigger_row.tgisinternal
      and trigger_row.tgname = 'trg_fill_messages_lead_store'
      and trigger_row.tgenabled = 'O'
  )
  into v_fill_trigger_enabled;

  select exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
      'public.commercial_session_context_links'::regclass
      and not trigger_row.tgisinternal
      and trigger_row.tgname =
        'commercial_session_context_links_enforce_write_rules'
      and trigger_row.tgenabled = 'O'
  )
  into v_context_write_trigger_enabled;

  v_identity_clean :=
    current_user = 'postgres'
    and session_user = 'postgres'
    and nullif(
      pg_catalog.current_setting('request.jwt.claim.sub', true),
      ''
    ) is null
    and nullif(
      pg_catalog.current_setting('request.jwt.claim.role', true),
      ''
    ) is null
    and nullif(
      pg_catalog.current_setting('request.jwt.claims', true),
      ''
    ) is null;

  v_cleanup_ok :=
    v_message_residue_count = 0
    and v_context_residue_count = 0
    and v_session_residue_count = 0
    and v_opportunity_residue_count = 0
    and coalesce(v_conversation_unchanged, false)
    and v_last_message_trigger_enabled
    and v_fill_trigger_enabled
    and v_context_write_trigger_enabled
    and v_identity_clean;

  if not v_cleanup_ok then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'Etapa 4.16 cleanup failed; transaction rolled back (messages=%s, contexts=%s, sessions=%s, opportunities=%s, conversation_unchanged=%s, last_message_trigger=%s, fill_trigger=%s, context_trigger=%s, identity_clean=%s)',
        v_message_residue_count,
        v_context_residue_count,
        v_session_residue_count,
        v_opportunity_residue_count,
        v_conversation_unchanged,
        v_last_message_trigger_enabled,
        v_fill_trigger_enabled,
        v_context_write_trigger_enabled,
        v_identity_clean
      );
  end if;

  insert into pg_temp._p9_416_result values (
    2,
    'CLEANUP',
    'PASS',
    pg_catalog.format(
      'runner_messages=%s | runner_contexts=%s | runner_sessions=%s | runner_opportunities=%s | conversation_unchanged=%s | last_message_trigger_enabled=%s | fill_trigger_enabled=%s | context_trigger_enabled=%s | identity_clean=%s',
      v_message_residue_count,
      v_context_residue_count,
      v_session_residue_count,
      v_opportunity_residue_count,
      v_conversation_unchanged,
      v_last_message_trigger_enabled,
      v_fill_trigger_enabled,
      v_context_write_trigger_enabled,
      v_identity_clean
    ),
    null
  );
exception
  when others then
    get stacked diagnostics
      v_unexpected_sqlstate = returned_sqlstate,
      v_unexpected_error = message_text;

    begin
      execute 'reset role';
    exception
      when others then
        null;
    end;

    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claim.role', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);

    begin
      if not v_last_message_trigger_disabled then
        execute
          'alter table public.messages disable trigger trg_conversations_last_message_sync';
        v_last_message_trigger_disabled := true;
      end if;

      delete from public.messages message_row
      where message_row.metadata @> pg_catalog.jsonb_build_object(
        'runner_name', 'p9_block4_step4_16',
        'runner_run_id', v_run_id::text
      );

      execute
        'alter table public.messages enable trigger trg_conversations_last_message_sync';
      v_last_message_trigger_disabled := false;

      if not v_context_write_trigger_disabled then
        execute
          'alter table public.commercial_session_context_links disable trigger commercial_session_context_links_enforce_write_rules';
        v_context_write_trigger_disabled := true;
      end if;

      delete from public.commercial_session_context_links context_row
      where context_row.correlation_id = v_run_id;

      execute
        'alter table public.commercial_session_context_links enable trigger commercial_session_context_links_enforce_write_rules';
      v_context_write_trigger_disabled := false;

      if v_session_created then
        delete from public.conversation_sessions session_row
        where session_row.id = v_session_id;
      end if;

      if v_opportunity_created then
        delete from public.commercial_opportunities opportunity_row
        where opportunity_row.id = v_opportunity_id;
      end if;
    exception
      when others then
        raise exception using
          errcode = 'P0001',
          message =
            'Etapa 4.16 cleanup defensivo falhou; transacao revertida';
    end;

    select count(*)
    into v_message_residue_count
    from public.messages message_row
    where message_row.metadata @> pg_catalog.jsonb_build_object(
      'runner_name', 'p9_block4_step4_16',
      'runner_run_id', v_run_id::text
    );

    select count(*)
    into v_context_residue_count
    from public.commercial_session_context_links context_row
    where context_row.correlation_id = v_run_id;

    select count(*)
    into v_session_residue_count
    from public.conversation_sessions session_row
    where session_row.id = v_session_id;

    select count(*)
    into v_opportunity_residue_count
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v_opportunity_id;

    select exists (
      select 1
      from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.messages'::regclass
        and not trigger_row.tgisinternal
        and trigger_row.tgname = 'trg_conversations_last_message_sync'
        and trigger_row.tgenabled = 'O'
    )
    into v_last_message_trigger_enabled;

    select exists (
      select 1
      from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid =
        'public.commercial_session_context_links'::regclass
        and not trigger_row.tgisinternal
        and trigger_row.tgname =
          'commercial_session_context_links_enforce_write_rules'
        and trigger_row.tgenabled = 'O'
    )
    into v_context_write_trigger_enabled;

    if v_conversation_id is not null then
      select pg_catalog.to_jsonb(conversation_row)
             is not distinct from v_conversation_before
      into v_conversation_unchanged
      from public.conversations conversation_row
      where conversation_row.id = v_conversation_id;
    end if;

    if v_message_residue_count <> 0
       or v_context_residue_count <> 0
       or v_session_residue_count <> 0
       or v_opportunity_residue_count <> 0
       or not v_last_message_trigger_enabled
       or not v_context_write_trigger_enabled
       or not coalesce(v_conversation_unchanged, true) then
      raise exception using
        errcode = 'P0001',
        message = 'Etapa 4.16 safety gate falhou; transacao revertida';
    end if;

    insert into pg_temp._p9_416_result values (
      1,
      'CHECK',
      'HARNESS_ERROR',
      pg_catalog.format(
        'erro inesperado do runner: %s: %s',
        coalesce(v_unexpected_sqlstate, '<null>'),
        coalesce(v_unexpected_error, '<null>')
      ),
      null
    )
    on conflict (row_order) do update
    set status = excluded.status,
        detail = excluded.detail;

    insert into pg_temp._p9_416_result values (
      2,
      'CLEANUP',
      'PASS',
      'cleanup defensivo concluido sem residuos',
      null
    )
    on conflict (row_order) do update
    set status = excluded.status,
        detail = excluded.detail;
end;
$test$;

commit;

with report as (
  select
    row_order,
    row_type,
    status,
    detail,
    final_status
  from pg_temp._p9_416_result

  union all

  select
    3,
    'SUMMARY',
    case
      when count(*) filter (
        where row_type = 'CHECK'
          and status = 'PASS'
      ) = 1
       and count(*) filter (
         where row_type = 'CLEANUP'
           and status = 'PASS'
       ) = 1
      then 'APROVADA'
      else 'REPROVADA'
    end,
    pg_catalog.format(
      'check_status=%s | cleanup_status=%s',
      max(status) filter (where row_type = 'CHECK'),
      max(status) filter (where row_type = 'CLEANUP')
    ),
    case
      when count(*) filter (
        where row_type = 'CHECK'
          and status = 'PASS'
      ) = 1
       and count(*) filter (
         where row_type = 'CLEANUP'
           and status = 'PASS'
       ) = 1
      then 'APROVADA'
      else 'REPROVADA'
    end
  from pg_temp._p9_416_result
)
select
  row_type,
  status,
  detail,
  final_status
from report
order by row_order;

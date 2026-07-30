-- ZION / Pilar 9 / Bloco 4 / Etapa 4.13
-- Um unico teste: mensagem nova em conversa sem sessao ativa.
--
-- Esperado:
-- commercial_context_capture_state = 'no_active_session'
-- conversation_session_id = null
-- commercial_session_context_link_id = null
--
-- O runner reutiliza uma conversa real apenas como parent, cria uma mensagem
-- outgoing via public.insert_message(), remove a mensagem e confirma que a
-- conversa permaneceu intacta. Nao usa session_replication_role.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';
set local search_path = pg_catalog, pg_temp, public, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:block4:step4.13:no_active_session_message',
    0
  )
);

create temp table _p9_413_result (
  row_order integer primary key,
  row_type text not null,
  status text not null,
  detail text not null,
  final_status text null
) on commit preserve rows;

do $test$
declare
  v_run_id uuid := pg_catalog.gen_random_uuid();
  v_conversation_id uuid;
  v_organization_id uuid;
  v_store_id uuid;
  v_lead_id uuid;
  v_conversation_before jsonb;
  v_message_id uuid;
  v_insert_ok boolean := false;
  v_insert_sqlstate text;
  v_insert_error text;
  v_snapshot_ok boolean := false;
  v_trigger_disabled boolean := false;
  v_residue_count bigint := 0;
  v_conversation_unchanged boolean := true;
  v_trigger_enabled boolean := false;
  v_identity_clean boolean := false;
  v_cleanup_ok boolean := false;
begin
  if current_user <> 'postgres'
     or session_user <> 'postgres'
     or pg_catalog.to_regclass('public.messages') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.conversation_sessions') is null
     or pg_catalog.to_regprocedure(
       'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'
     ) is null
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.insert_message(uuid,text,text,text,text,text,text,jsonb)',
       'EXECUTE'
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.messages'::regclass
         and not trigger_row.tgisinternal
         and trigger_row.tgname = 'trg_conversations_last_message_sync'
         and trigger_row.tgenabled = 'O'
     ) then
    insert into pg_temp._p9_413_result values (
      1,
      'CHECK',
      'BLOCKED',
      'preflight bloqueado: usuario, objetos, permissao ou trigger obrigatorio ausente',
      null
    );
    insert into pg_temp._p9_413_result values (
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
    pg_catalog.to_jsonb(conversation_row)
  into
    v_conversation_id,
    v_organization_id,
    v_store_id,
    v_lead_id,
    v_conversation_before
  from public.conversations conversation_row
  join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
   and lead_row.organization_id = conversation_row.organization_id
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

  if v_conversation_id is null then
    insert into pg_temp._p9_413_result values (
      1,
      'CHECK',
      'BLOCKED',
      'nenhuma conversa elegivel sem sessao ativa foi encontrada',
      null
    );
    insert into pg_temp._p9_413_result values (
      2,
      'CLEANUP',
      'PASS',
      'nenhuma fixture foi criada',
      null
    );
    return;
  end if;

  execute
    'alter table public.messages disable trigger trg_conversations_last_message_sync';
  v_trigger_disabled := true;

  begin
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
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
        'runner Etapa 4.13 ' || v_run_id::text,
        null,
        null,
        pg_catalog.jsonb_build_object(
          'runner_name', 'p9_block4_step4_13',
          'runner_run_id', v_run_id::text
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
      and message_row.commercial_context_capture_state = 'no_active_session'
      and message_row.conversation_session_id is null
      and message_row.commercial_session_context_link_id is null
      and message_row.metadata @> pg_catalog.jsonb_build_object(
        'runner_name', 'p9_block4_step4_13',
        'runner_run_id', v_run_id::text
      )
      and not exists (
        select 1
        from public.conversation_sessions session_row
        where session_row.conversation_id = v_conversation_id
          and session_row.organization_id = v_organization_id
          and session_row.store_id = v_store_id
          and session_row.status = 'active'
      )
  )
  into v_snapshot_ok;

  insert into pg_temp._p9_413_result values (
    1,
    'CHECK',
    case
      when v_insert_ok
       and v_message_id is not null
       and v_snapshot_ok
      then 'PASS'
      else 'SUT_FAIL'
    end,
    pg_catalog.format(
      'conversation_id=%s | message_id=%s | insert_ok=%s | snapshot_ok=%s | sqlstate=%s | error=%s',
      v_conversation_id,
      coalesce(v_message_id::text, '<null>'),
      v_insert_ok,
      v_snapshot_ok,
      coalesce(v_insert_sqlstate, '<null>'),
      coalesce(v_insert_error, '<null>')
    ),
    null
  );

  delete from public.messages message_row
  where message_row.metadata @> pg_catalog.jsonb_build_object(
    'runner_name', 'p9_block4_step4_13',
    'runner_run_id', v_run_id::text
  );

  execute
    'alter table public.messages enable trigger trg_conversations_last_message_sync';
  v_trigger_disabled := false;

  select count(*)
  into v_residue_count
  from public.messages message_row
  where message_row.metadata @> pg_catalog.jsonb_build_object(
    'runner_name', 'p9_block4_step4_13',
    'runner_run_id', v_run_id::text
  );

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
  into v_trigger_enabled;

  v_identity_clean :=
    current_user = 'postgres'
    and session_user = 'postgres'
    and nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '') is null
    and nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '') is null
    and nullif(pg_catalog.current_setting('request.jwt.claims', true), '') is null;

  v_cleanup_ok :=
    v_residue_count = 0
    and coalesce(v_conversation_unchanged, false)
    and v_trigger_enabled
    and v_identity_clean;

  if not v_cleanup_ok then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'Etapa 4.13 cleanup failed; transaction rolled back (residue=%s, conversation_unchanged=%s, trigger_enabled=%s, identity_clean=%s)',
        v_residue_count,
        v_conversation_unchanged,
        v_trigger_enabled,
        v_identity_clean
      );
  end if;

  insert into pg_temp._p9_413_result values (
    2,
    'CLEANUP',
    'PASS',
    pg_catalog.format(
      'runner_messages=%s | conversation_unchanged=%s | trigger_enabled=%s | identity_clean=%s',
      v_residue_count,
      v_conversation_unchanged,
      v_trigger_enabled,
      v_identity_clean
    ),
    null
  );
exception
  when others then
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
      if not v_trigger_disabled then
        execute
          'alter table public.messages disable trigger trg_conversations_last_message_sync';
      end if;

      delete from public.messages message_row
      where message_row.metadata @> pg_catalog.jsonb_build_object(
        'runner_name', 'p9_block4_step4_13',
        'runner_run_id', v_run_id::text
      );

      execute
        'alter table public.messages enable trigger trg_conversations_last_message_sync';
    exception
      when others then
        raise exception using
          errcode = 'P0001',
          message = 'Etapa 4.13 cleanup defensivo falhou; transacao revertida';
    end;

    select count(*)
    into v_residue_count
    from public.messages message_row
    where message_row.metadata @> pg_catalog.jsonb_build_object(
      'runner_name', 'p9_block4_step4_13',
      'runner_run_id', v_run_id::text
    );

    select exists (
      select 1
      from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.messages'::regclass
        and not trigger_row.tgisinternal
        and trigger_row.tgname = 'trg_conversations_last_message_sync'
        and trigger_row.tgenabled = 'O'
    )
    into v_trigger_enabled;

    if v_conversation_id is not null then
      select pg_catalog.to_jsonb(conversation_row)
             is not distinct from v_conversation_before
      into v_conversation_unchanged
      from public.conversations conversation_row
      where conversation_row.id = v_conversation_id;
    end if;

    if v_residue_count <> 0
       or not v_trigger_enabled
       or not coalesce(v_conversation_unchanged, true) then
      raise exception using
        errcode = 'P0001',
        message = 'Etapa 4.13 safety gate falhou; transacao revertida';
    end if;

    insert into pg_temp._p9_413_result values (
      1,
      'CHECK',
      'HARNESS_ERROR',
      'erro inesperado do runner: ' || sqlstate || ': ' || sqlerrm,
      null
    )
    on conflict (row_order) do update
    set status = excluded.status,
        detail = excluded.detail;

    insert into pg_temp._p9_413_result values (
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
  from pg_temp._p9_413_result

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
  from pg_temp._p9_413_result
)
select
  row_type,
  status,
  detail,
  final_status
from report
order by row_order;

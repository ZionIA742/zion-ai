begin;

create temporary table p9_53_activation_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  detail text not null
) on commit drop;

do $runner$
declare
  v_executor text;
  v_helper text;
  v_gate text;
  v_lock_pos integer;
  v_recheck_pos integer;
  v_insert_pos integer;
  v_attempt_pos integer;
  v_helper_pos integer;
  v_external_pos integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.ai_sales_execute_canonical_followup_queue(uuid)'::regprocedure
  )
  into v_executor;

  select pg_catalog.pg_get_functiondef(
    'public.is_real_whatsapp_conversation_for_external_send(uuid,uuid,uuid)'::regprocedure
  )
  into v_helper;

  select pg_catalog.pg_get_functiondef(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'::regprocedure
  )
  into v_gate;

  insert into p9_53_activation_results
  select
    1,
    'executor continua service-only e security definer',
    case
      when p.prosecdef
       and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
       and pg_catalog.has_function_privilege(
         'service_role',
         p.oid,
         'EXECUTE'
       )
       and not pg_catalog.has_function_privilege(
         'anon',
         p.oid,
         'EXECUTE'
       )
       and not pg_catalog.has_function_privilege(
         'authenticated',
         p.oid,
         'EXECUTE'
       )
      then 'PASS' else 'FAIL'
    end,
    pg_catalog.format(
      'owner=%s secdef=%s service=%s anon=%s authenticated=%s',
      pg_catalog.pg_get_userbyid(p.proowner),
      p.prosecdef,
      pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'),
      pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
      pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
  from pg_catalog.pg_proc p
  where p.oid =
    'public.ai_sales_execute_canonical_followup_queue(uuid)'::regprocedure;

  insert into p9_53_activation_results values (
    2,
    'ativacao usa helper estrito de WhatsApp real',
    case
      when pg_catalog.strpos(
        v_executor,
        'is_real_whatsapp_conversation_for_external_send'
      ) > 0
       and pg_catalog.strpos(
        v_helper,
        'get_active_whatsapp_integration_for_external_send_by_system'
      ) > 0
      then 'PASS' else 'FAIL'
    end,
    pg_catalog.format(
      'executor_helper=%s helper_strict_reader=%s',
      pg_catalog.strpos(
        v_executor,
        'is_real_whatsapp_conversation_for_external_send'
      ) > 0,
      pg_catalog.strpos(
        v_helper,
        'get_active_whatsapp_integration_for_external_send_by_system'
      ) > 0
    )
  );

  v_helper_pos := pg_catalog.strpos(
    v_executor,
    'when public.is_real_whatsapp_conversation_for_external_send'
  );
  v_external_pos := pg_catalog.strpos(
    v_executor,
    $needle$'send_external', true$needle$
  );

  insert into p9_53_activation_results values (
    3,
    'metadata externa so existe no ramo WhatsApp comprovado',
    case
      when (
        select pg_catalog.count(*)
        from pg_catalog.regexp_matches(
          v_executor,
          $re$'send_external', true$re$,
          'g'
        )
      ) = 1
       and (
        select pg_catalog.count(*)
        from pg_catalog.regexp_matches(
          v_executor,
          $re$'external_channel', 'whatsapp'$re$,
          'g'
        )
      ) = 1
       and (
        select pg_catalog.count(*)
        from pg_catalog.regexp_matches(
          v_executor,
          $re$'outbound_kind', 'canonical_followup'$re$,
          'g'
        )
      ) = 1
       and v_helper_pos > 0
       and v_external_pos > v_helper_pos
       and pg_catalog.strpos(
         v_executor,
         $needle$else '{}'::jsonb$needle$
       ) > v_external_pos
      then 'PASS' else 'FAIL'
    end,
    pg_catalog.format(
      'helper=%s external=%s internal_else=%s',
      v_helper_pos,
      v_external_pos,
      pg_catalog.strpos(v_executor, $needle$else '{}'::jsonb$needle$)
    )
  );

  insert into p9_53_activation_results values (
    4,
    'identidade canonica de fila oportunidade e ciclo permanece no metadata',
    case
      when pg_catalog.strpos(
        v_executor,
        $needle$'action_queue_id', v_queue.id$needle$
      ) > 0
       and pg_catalog.strpos(
        v_executor,
        $needle$'commercial_opportunity_id', v_opportunity_id$needle$
      ) > 0
       and pg_catalog.strpos(
        v_executor,
        $needle$'followup_id', v_followup_id$needle$
      ) > 0
       and pg_catalog.strpos(
        v_executor,
        $needle$'followup_cycle', v_followup_cycle$needle$
      ) > 0
       and pg_catalog.strpos(
        v_executor,
        $needle$'followup_operation_key', v_followup_operation_key$needle$
      ) > 0
      then 'PASS' else 'FAIL'
    end,
    'queue/opportunity/followup/cycle/operation_key preservados'
  );

  v_lock_pos := pg_catalog.strpos(
    v_executor,
    'private_acquire_sales_contract_conversation_xact_lock'
  );
  v_recheck_pos := pg_catalog.strpos(
    v_executor,
    'message_row.created_at > v_queue.enqueued_at'
  );
  v_insert_pos := pg_catalog.strpos(
    v_executor,
    'from public.insert_message'
  );

  insert into p9_53_activation_results values (
    5,
    'barreira race-safe continua antes do insert_message',
    case
      when v_lock_pos > 0
       and v_recheck_pos > v_lock_pos
       and v_insert_pos > v_recheck_pos
      then 'PASS' else 'FAIL'
    end,
    pg_catalog.format(
      'lock=%s recheck=%s insert=%s',
      v_lock_pos,
      v_recheck_pos,
      v_insert_pos
    )
  );

  v_attempt_pos := pg_catalog.strpos(
    v_executor,
    'record_commercial_opportunity_followup_attempt_by_system'
  );

  insert into p9_53_activation_results values (
    6,
    'attempt canonico continua depois da criacao da mensagem',
    case
      when v_insert_pos > 0
       and v_attempt_pos > v_insert_pos
      then 'PASS' else 'FAIL'
    end,
    pg_catalog.format(
      'insert=%s attempt=%s',
      v_insert_pos,
      v_attempt_pos
    )
  );

  insert into p9_53_activation_results values (
    7,
    'gate final reconhece canonical_followup e exige transporte externo explicito',
    case
      when pg_catalog.strpos(v_gate, 'canonical_followup') > 0
       and pg_catalog.strpos(v_gate, 'send_external') > 0
       and pg_catalog.strpos(v_gate, 'external_channel') > 0
       and pg_catalog.strpos(
         v_executor,
         $needle$'outbound_kind', 'canonical_followup'$needle$
       ) > 0
      then 'PASS' else 'FAIL'
    end,
    'executor produz canonical_followup e gate final exige send_external/external_channel'
  );

  insert into p9_53_activation_results values (
    8,
    'ativacao externa nao introduz perda automatica',
    case
      when v_executor !~* $re$stage[[:space:]]*=[[:space:]]*'perdido'$re$
       and v_executor !~* $re$mark_.*lost$re$
       and v_executor !~* $re$write_.*loss$re$
      then 'PASS' else 'FAIL'
    end,
    'nenhum writer/assignment de Lost detectado no executor'
  );
end;
$runner$;

select
  scenario_number,
  scenario_name,
  status,
  detail
from p9_53_activation_results
order by scenario_number;

do $assert$
begin
  if exists (
    select 1
    from p9_53_activation_results
    where status <> 'PASS'
  ) then
    raise exception using
      errcode = '23514',
      message =
        'P9_53_CANONICAL_FOLLOWUP_EXTERNAL_ACTIVATION_CHECK_FAILED';
  end if;
end;
$assert$;

rollback;

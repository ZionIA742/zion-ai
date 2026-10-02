begin;



set local lock_timeout = '5s';

set local statement_timeout = '300s';

set local idle_in_transaction_session_timeout = '300s';

set local search_path = pg_catalog, pg_temp, public, auth, extensions;



create temp table pg_temp._p9_material_results (

  scenario_number integer primary key,

  scenario text not null,

  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),

  detail text

) on commit drop;



create or replace function pg_temp._p9_material_record(

  p_number integer, p_scenario text, p_ok boolean,

  p_detail text default null, p_harness boolean default false

)

returns void language plpgsql as $function$

begin

  insert into pg_temp._p9_material_results values (

    p_number, p_scenario,

    case when p_harness then 'HARNESS_ERROR'

         when p_ok then 'PASS' else 'SUT_FAIL' end,

    p_detail

  );

end;

$function$;



create temp table pg_temp._p9_material_ctx (

  org_id uuid not null,

  store_id uuid not null,

  customer_id uuid not null,

  lead_id uuid not null,

  lead_link_id uuid not null

) on commit drop;



insert into pg_temp._p9_material_ctx values (

  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),

  gen_random_uuid(), gen_random_uuid()

);



do $fixtures$

declare

  c pg_temp._p9_material_ctx%rowtype;

begin

  select * into c from pg_temp._p9_material_ctx;



  insert into public.organizations (id, name, subscription_status)

  values (c.org_id, 'P9 Material Classification Runner Org', 'active');



  insert into public.stores (id, organization_id, name)

  values (c.store_id, c.org_id, 'P9 Material Classification Runner Store');



  insert into public.customers (id, organization_id, display_name, normalized_name)

  values (c.customer_id, c.org_id, 'Material Runner Customer', 'material runner customer');



  insert into public.customer_store_links (organization_id, store_id, customer_id)

  values (c.org_id, c.store_id, c.customer_id);



  insert into public.leads (

    id, organization_id, store_id, name, phone, state, created_at, updated_at

  ) values (

    c.lead_id, c.org_id, c.store_id, 'Material Runner Lead',

    '5511998100099', 'novo_lead', now(), now()

  );



  insert into public.lead_customer_links (

    id, organization_id, store_id, lead_id, customer_id, status,

    source, linked_by_actor_type, linked_at, metadata

  ) values (

    c.lead_link_id, c.org_id, c.store_id, c.lead_id, c.customer_id,

    'active', 'manual', 'migration', now(), '{}'::jsonb

  );

end;

$fixtures$;



create or replace function pg_temp._p9_material_make_case(

  p_label text,

  p_content text,

  p_stage text default 'orcamento'

)

returns table (message_id uuid, opportunity_id uuid)

language plpgsql

as $function$

declare

  c pg_temp._p9_material_ctx%rowtype;

  v_conv uuid := gen_random_uuid();

  v_session uuid := gen_random_uuid();

  v_opp uuid := gen_random_uuid();

  v_message public.messages;

  v_link public.commercial_session_context_links;

  v_cmir record;

begin

  select * into c from pg_temp._p9_material_ctx;



  insert into public.commercial_opportunities (

    id, organization_id, store_id, customer_id, stage

  ) values (v_opp, c.org_id, c.store_id, c.customer_id, p_stage);



  insert into public.conversations (

    id, organization_id, lead_id, status, is_human_active, created_at

  ) values (v_conv, c.org_id, c.lead_id, 'open', false, now());



  insert into public.conversation_sessions (

    id, organization_id, store_id, conversation_id, status

  ) values (v_session, c.org_id, c.store_id, v_conv, 'active');



  select * into v_link

  from public.link_commercial_session_context(

    c.org_id, c.store_id, v_session, c.customer_id, v_opp, c.lead_link_id,

    'migration', 'migration', null, 'p9-material:' || p_label,

    'p9-material:' || p_label || ':context', null, '{}'::jsonb, null

  );



  select * into v_message

  from public.insert_message(

    v_conv, 'user', 'incoming', 'text', p_content,

    'p9-material:' || p_label || ':' || v_conv::text, null, '{}'::jsonb

  );



  select * into v_cmir

  from public.write_commercial_message_intent_resolution_by_system(

    c.org_id, c.store_id, v_message.id, c.customer_id, c.lead_link_id,

    'p9-material-cmir:' || p_label, 'continue_same_intent', 'same_intent',

    v_opp, null, 'ai', '{}'::jsonb, 'sales_ai.intent_resolution'

  );



  return query select v_message.id, v_opp;

end;

$function$;



create or replace function pg_temp._p9_material_classify(

  p_message_id uuid,

  p_opportunity_id uuid,

  p_material_kind text,

  p_status text,

  p_evidence text,

  p_operation_key text,

  p_supersedes uuid default null

)

returns jsonb

language plpgsql

as $function$

declare

  c pg_temp._p9_material_ctx%rowtype;

  v_row record;

begin

  select * into c from pg_temp._p9_material_ctx;

  select * into v_row

  from public.write_commercial_message_material_classification_by_system(

    c.org_id, c.store_id, p_message_id, c.customer_id, p_opportunity_id,

    p_material_kind, p_status, p_evidence, p_operation_key,

    p_supersedes, '{}'::jsonb, 'sales_ai_material_negotiation', 'v1'

  );

  return to_jsonb(v_row);

end;

$function$;



do $scenario_a$

declare

  c pg_temp._p9_material_ctx%rowtype;

  t record;

  j jsonb;

  v_row record;

begin

  select * into c from pg_temp._p9_material_ctx;

  select * into t from pg_temp._p9_material_make_case('valid', 'Você parcela?');

  j := pg_temp._p9_material_classify(t.message_id, t.opportunity_id,

    'payment_terms_negotiation', 'confirmed', 'Você parcela?', 'class-valid');

  select * into v_row

  from public.enter_commercial_opportunity_negotiation_by_system(

    c.org_id, c.store_id, t.opportunity_id, 1, 'authority-valid',

    'payment_terms_negotiation', t.message_id, 'Você parcela?',

    'material valid', 'runner'

  );

  perform pg_temp._p9_material_record(1, 'classificacao valida autoriza material correspondente',

    j ->> 'material_kind' = 'payment_terms_negotiation'

    and v_row.stage = 'negociacao'

    and v_row.material_kind = 'payment_terms_negotiation');

exception when others then

  perform pg_temp._p9_material_record(1, 'classificacao valida autoriza material correspondente',

    false, sqlstate || ' ' || sqlerrm, true);

end;

$scenario_a$;



do $scenario_b$

declare

  c pg_temp._p9_material_ctx%rowtype;

  t record;

  v_blocked boolean := false;

begin

  select * into c from pg_temp._p9_material_ctx;

  select * into t from pg_temp._p9_material_make_case('wrong-kind', 'Você parcela?');

  perform pg_temp._p9_material_classify(t.message_id, t.opportunity_id,

    'payment_terms_negotiation', 'confirmed', 'Você parcela?', 'class-wrong-kind');

  begin

    perform public.enter_commercial_opportunity_negotiation_by_system(

      c.org_id, c.store_id, t.opportunity_id, 1, 'authority-wrong-kind',

      'discount_request', t.message_id, 'Você parcela?', 'wrong kind', 'runner'

    );

  exception when others then

    v_blocked := sqlstate = '23514'

      and sqlerrm = 'ZION_MATERIAL_CLASSIFICATION_NOT_CONFIRMED';

  end;

  perform pg_temp._p9_material_record(2, 'material solicitado diferente do current e rejeitado', v_blocked);

exception when others then

  perform pg_temp._p9_material_record(2, 'material solicitado diferente do current e rejeitado',

    false, sqlstate || ' ' || sqlerrm, true);

end;

$scenario_b$;



do $scenario_c$

declare

  t record;

  j1 jsonb;

  j2 jsonb;

  c pg_temp._p9_material_ctx%rowtype;

begin

  select * into c from pg_temp._p9_material_ctx;

  select * into t from pg_temp._p9_material_make_case(

    'multiple', 'Dá para parcelar em 12 vezes e fazer por 20 mil?'

  );

  j1 := pg_temp._p9_material_classify(t.message_id, t.opportunity_id,

    'payment_terms_negotiation', 'confirmed',

    'Dá para parcelar em 12 vezes', 'class-multiple-payment');

  j2 := pg_temp._p9_material_classify(t.message_id, t.opportunity_id,

    'price_counteroffer', 'confirmed', 'fazer por 20 mil', 'class-multiple-price');

  perform pg_temp._p9_material_record(3, 'materiais distintos coexistem na mesma mensagem',

    j1 ->> 'material_kind' = 'payment_terms_negotiation'

    and j2 ->> 'material_kind' = 'price_counteroffer'

    and (select count(*) from public.commercial_message_material_classification_current

         where message_id = t.message_id) = 2);

exception when others then

  perform pg_temp._p9_material_record(3, 'materiais distintos coexistem na mesma mensagem',

    false, sqlstate || ' ' || sqlerrm, true);

end;

$scenario_c$;



do $scenario_d$

declare

  c pg_temp._p9_material_ctx%rowtype;

  t record;

  v_blocked boolean := false;

begin

  select * into c from pg_temp._p9_material_ctx;

  select * into t from pg_temp._p9_material_make_case('no-material', 'Obrigado pelo retorno.');

  perform pg_temp._p9_material_classify(t.message_id, t.opportunity_id,

    'no_material', 'confirmed', 'Obrigado pelo retorno.', 'class-no-material');

  begin

    perform public.enter_commercial_opportunity_negotiation_by_system(

      c.org_id, c.store_id, t.opportunity_id, 1, 'authority-no-material',

      'payment_terms_negotiation', t.message_id, 'Obrigado pelo retorno.',

      'no material', 'runner'

    );

  exception when others then

    v_blocked := sqlstate = '23514';

  end;

  perform pg_temp._p9_material_record(4, 'no_material não autoriza negociacao', v_blocked);

exception when others then

  perform pg_temp._p9_material_record(4, 'no_material não autoriza negociacao',

    false, sqlstate || ' ' || sqlerrm, true);

end;

$scenario_d$;



do $scenario_e$

declare

  c pg_temp._p9_material_ctx%rowtype;

  t record;

  v_blocked boolean := false;

begin

  select * into c from pg_temp._p9_material_ctx;

  select * into t from pg_temp._p9_material_make_case('ambiguous', 'Talvez dê para melhorar?');

  perform pg_temp._p9_material_classify(t.message_id, t.opportunity_id,

    'price_counteroffer', 'ambiguous', 'melhorar', 'class-ambiguous');

  begin

    perform public.enter_commercial_opportunity_negotiation_by_system(

      c.org_id, c.store_id, t.opportunity_id, 1, 'authority-ambiguous',

      'price_counteroffer', t.message_id, 'melhorar', 'ambiguous', 'runner'

    );

  exception when others then

    v_blocked := sqlstate = '23514'

      and sqlerrm = 'ZION_MATERIAL_CLASSIFICATION_NOT_CONFIRMED';

  end;

  perform pg_temp._p9_material_record(5, 'classificacao ambigua e preservada sem autorizar', v_blocked);

exception when others then

  perform pg_temp._p9_material_record(5, 'classificacao ambigua e preservada sem autorizar',

    false, sqlstate || ' ' || sqlerrm, true);

end;

$scenario_e$;



do $scenario_f$

declare

  t record;

  v_blocked boolean := false;

begin

  select * into t from pg_temp._p9_material_make_case('invalid-evidence', 'Você parcela?');

  begin

    perform pg_temp._p9_material_classify(t.message_id, t.opportunity_id,

      'payment_terms_negotiation', 'confirmed', 'fazer por 20 mil', 'class-invalid-evidence');

  exception when others then

    v_blocked := sqlstate = '23514'

      and sqlerrm = 'ZION_MATERIAL_CLASSIFICATION_EVIDENCE_INVALID';

  end;

  perform pg_temp._p9_material_record(6, 'evidence fora do texto original e rejeitada', v_blocked);

exception when others then

  perform pg_temp._p9_material_record(6, 'evidence fora do texto original e rejeitada',

    false, sqlstate || ' ' || sqlerrm, true);

end;

$scenario_f$;



do $scenario_g$

declare

  t1 record;

  t2 record;

  v_blocked boolean := false;

begin

  select * into t1 from pg_temp._p9_material_make_case('cmir-a', 'Você parcela?');

  select * into t2 from pg_temp._p9_material_make_case('cmir-b', 'Você parcela?');

  begin

    perform pg_temp._p9_material_classify(t1.message_id, t2.opportunity_id,

      'payment_terms_negotiation', 'confirmed', 'Você parcela?', 'class-cmir-mismatch');

  exception when others then

    v_blocked := sqlstate = '23514'

      and sqlerrm = 'ZION_MATERIAL_CLASSIFICATION_CMIR_MISMATCH';

  end;

  perform pg_temp._p9_material_record(7, 'contexto de opportunity diferente da CMIR rejeitado', v_blocked);

exception when others then

  perform pg_temp._p9_material_record(7, 'contexto de opportunity diferente da CMIR rejeitado',

    false, sqlstate || ' ' || sqlerrm, true);

end;

$scenario_g$;



do $scenario_h$

declare

  t record;

  j1 jsonb;

  j2 jsonb;

  v_old uuid;

begin

  select * into t from pg_temp._p9_material_make_case('supersession', 'O preço talvez possa melhorar.');

  j1 := pg_temp._p9_material_classify(t.message_id, t.opportunity_id,

    'discount_request', 'ambiguous', 'possa melhorar', 'class-supersession-1');

  v_old := (j1 ->> 'event_id')::uuid;

  j2 := pg_temp._p9_material_classify(t.message_id, t.opportunity_id,

    'discount_request', 'confirmed', 'preço talvez possa melhorar', 'class-supersession-2', v_old);

  perform pg_temp._p9_material_record(8, 'supersession preserva historico e promove current',

    j2 ->> 'supersedes_event_id' = v_old::text

    and (select count(*) from public.commercial_message_material_classification_events

         where message_id = t.message_id and material_kind = 'discount_request') = 2

    and exists (

      select 1 from public.commercial_message_material_classification_current

      where message_id = t.message_id

        and material_kind = 'discount_request'

        and current_event_id = (j2 ->> 'event_id')::uuid

    ));

exception when others then

  perform pg_temp._p9_material_record(8, 'supersession preserva historico e promove current',

    false, sqlstate || ' ' || sqlerrm, true);

end;

$scenario_h$;



do $scenario_i$

declare

  t record;

  j1 jsonb;

  j2 jsonb;

begin

  select * into t from pg_temp._p9_material_make_case('replay', 'Você parcela?');

  j1 := pg_temp._p9_material_classify(t.message_id, t.opportunity_id,

    'payment_terms_negotiation', 'confirmed', 'Você parcela?', 'class-replay');

  j2 := pg_temp._p9_material_classify(t.message_id, t.opportunity_id,

    'payment_terms_negotiation', 'confirmed', 'Você parcela?', 'class-replay');

  perform pg_temp._p9_material_record(9, 'replay idempotente não duplica classification',

    j1 ->> 'event_id' = j2 ->> 'event_id'

    and (j2 ->> 'replayed')::boolean

    and (select count(*) from public.commercial_message_material_classification_events

         where message_id = t.message_id and operation_key = 'class-replay') = 1);

exception when others then

  perform pg_temp._p9_material_record(9, 'replay idempotente não duplica classification',

    false, sqlstate || ' ' || sqlerrm, true);

end;

$scenario_i$;



do $scenario_j$

declare

  c pg_temp._p9_material_ctx%rowtype;

  t record;

  v_blocked boolean := false;

begin

  select * into c from pg_temp._p9_material_ctx;

  select * into t from pg_temp._p9_material_make_case('bypass', 'Você parcela?');

  begin

    perform public.enter_commercial_opportunity_negotiation_by_system(

      c.org_id, c.store_id, t.opportunity_id, 1, 'authority-bypass',

      'payment_terms_negotiation', t.message_id, 'Você parcela?',

      'direct p_material_kind', 'runner'

    );

  exception when others then

    v_blocked := sqlstate = '23514'

      and sqlerrm in (

        'ZION_MATERIAL_CLASSIFICATION_NOT_CONFIRMED',

        'ZION_MATERIAL_CLASSIFICATION_REQUIRED'

      );

  end;

  perform pg_temp._p9_material_record(10, 'bypass direto por p_material_kind bloqueado', v_blocked);

exception when others then

  perform pg_temp._p9_material_record(10, 'bypass direto por p_material_kind bloqueado',

    false, sqlstate || ' ' || sqlerrm, true);

end;

$scenario_j$;



do $scenario_k$

declare

  t record;

  v_content text;

begin

  select * into t from pg_temp._p9_material_make_case(

    'multiple-topics', 'Você parcela? Também fazem instalação?'

  );

  select content into v_content from public.messages where id = t.message_id;

  perform pg_temp._p9_material_record(11, 'classificacao material não descarta os demais assuntos',

    v_content = 'Você parcela? Também fazem instalação?'

   and position('instalação' in v_content) > 0);

exception when others then

  perform pg_temp._p9_material_record(11, 'classificacao material não descarta os demais assuntos',

    false, sqlstate || ' ' || sqlerrm, true);

end;

$scenario_k$;



select

  result_row.scenario_number,

  result_row.scenario,

  result_row.status,

  result_row.detail,

  count(*) filter (where result_row.status = 'PASS') over () as passed,

  count(*) filter (where result_row.status = 'SUT_FAIL') over () as sut_failed,

  count(*) filter (where result_row.status = 'HARNESS_ERROR') over () as harness_errors,

  count(*) over () as total,

  count(*) filter (where result_row.status <> 'PASS') over () as failed_scenarios,

  (count(*) filter (where result_row.status = 'PASS') over () = 11) as all_11_passed

from pg_temp._p9_material_results result_row

order by result_row.scenario_number;



rollback;

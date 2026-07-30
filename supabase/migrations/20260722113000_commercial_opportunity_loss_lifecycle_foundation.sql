-- ZION / Pilar 9 / Bloco 4 / Etapa 4.24 / Bloco 1
-- Fundacao atomica de perda e reabertura da commercial_opportunity.
--
-- Escopo:
-- - adiciona projecoes atuais de perda em commercial_opportunities;
-- - cria tabela append-only public.commercial_opportunity_lifecycle_events;
-- - cria protecao estrutural contra UPDATE livre para entrar/sair de perdido;
-- - cria RPCs atomicas de perda humana, perda objetiva interna e reabertura humana;
-- - nao altera board legado, lead.state, conversation state, conversation_sessions
--   ou commercial_session_context_links.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:commercial-opportunity-loss-lifecycle:foundation:v1',
    0
  )
);

do $preflight$
begin
  if pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.organizations') is null
     or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.conversation_sessions') is null
     or pg_catalog.to_regclass('public.commercial_session_context_links') is null
     or pg_catalog.to_regclass('public.messages') is null
     or pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('auth.users') is null then
    raise exception using
      errcode = 'P0001',
      message = 'commercial opportunity loss lifecycle prerequisites are missing';
  end if;

  if pg_catalog.to_regprocedure('pg_catalog.gen_random_uuid()') is null
     and pg_catalog.to_regprocedure('extensions.gen_random_uuid()') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: gen_random_uuid() is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles role_row
    where role_row.rolname = 'authenticated'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: role authenticated is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles role_row
    where role_row.rolname = 'service_role'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: role service_role is missing';
  end if;

  if exists (
    select 1
    from (
      values
        ('id'::text, 'uuid'::text, 'NO'::text),
        ('organization_id'::text, 'uuid'::text, 'NO'::text),
        ('store_id'::text, 'uuid'::text, 'NO'::text),
        ('customer_id'::text, 'uuid'::text, 'NO'::text),
        ('primary_conversation_id'::text, 'uuid'::text, 'YES'::text),
        ('stage'::text, 'text'::text, 'NO'::text),
        ('stage_changed_at'::text, 'timestamp with time zone'::text, 'NO'::text)
    ) as expected(column_name, data_type, is_nullable)
    left join information_schema.columns column_row
      on column_row.table_schema = 'public'
     and column_row.table_name = 'commercial_opportunities'
     and column_row.column_name = expected.column_name
    where column_row.column_name is null
       or column_row.data_type <> expected.data_type
       or column_row.is_nullable <> expected.is_nullable
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunities column contract mismatch';
  end if;

  if exists (
    select 1
    from (
      values
        ('id'::text, 'uuid'::text, 'NO'::text),
        ('organization_id'::text, 'uuid'::text, 'NO'::text),
        ('store_id'::text, 'uuid'::text, 'NO'::text),
        ('conversation_id'::text, 'uuid'::text, 'NO'::text),
        ('conversation_session_id'::text, 'uuid'::text, 'YES'::text),
        ('commercial_session_context_link_id'::text, 'uuid'::text, 'YES'::text),
        ('commercial_context_capture_state'::text, 'text'::text, 'NO'::text)
    ) as expected(column_name, data_type, is_nullable)
    left join information_schema.columns column_row
      on column_row.table_schema = 'public'
     and column_row.table_name = 'messages'
     and column_row.column_name = expected.column_name
    where column_row.column_name is null
       or column_row.data_type <> expected.data_type
       or column_row.is_nullable <> expected.is_nullable
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.messages column contract mismatch';
  end if;

  if exists (
    select 1
    from (
      values
        ('id'::text, 'uuid'::text, 'NO'::text),
        ('organization_id'::text, 'uuid'::text, 'NO'::text),
        ('store_id'::text, 'uuid'::text, 'NO'::text),
        ('conversation_id'::text, 'uuid'::text, 'NO'::text)
    ) as expected(column_name, data_type, is_nullable)
    left join information_schema.columns column_row
      on column_row.table_schema = 'public'
     and column_row.table_name = 'conversation_sessions'
     and column_row.column_name = expected.column_name
    where column_row.column_name is null
       or column_row.data_type <> expected.data_type
       or column_row.is_nullable <> expected.is_nullable
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.conversation_sessions column contract mismatch';
  end if;

  if exists (
    select 1
    from (
      values
        ('id'::text, 'uuid'::text, 'NO'::text),
        ('organization_id'::text, 'uuid'::text, 'NO'::text),
        ('store_id'::text, 'uuid'::text, 'NO'::text),
        ('conversation_session_id'::text, 'uuid'::text, 'NO'::text),
        ('customer_id'::text, 'uuid'::text, 'NO'::text),
        ('commercial_opportunity_id'::text, 'uuid'::text, 'NO'::text),
        ('status'::text, 'text'::text, 'NO'::text)
    ) as expected(column_name, data_type, is_nullable)
    left join information_schema.columns column_row
      on column_row.table_schema = 'public'
     and column_row.table_name = 'commercial_session_context_links'
     and column_row.column_name = expected.column_name
    where column_row.column_name is null
       or column_row.data_type <> expected.data_type
       or column_row.is_nullable <> expected.is_nullable
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_session_context_links column contract mismatch';
  end if;

  if exists (
    select 1
    from (
      values
        ('id'::text, 'uuid'::text, 'NO'::text)
    ) as expected(column_name, data_type, is_nullable)
    left join information_schema.columns column_row
      on column_row.table_schema = 'auth'
     and column_row.table_name = 'users'
     and column_row.column_name = expected.column_name
    where column_row.column_name is null
       or column_row.data_type <> expected.data_type
       or column_row.is_nullable <> expected.is_nullable
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: auth.users column contract mismatch';
  end if;

  if exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'organizations'
      and column_row.column_name = 'id'
      and (
        column_row.data_type <> 'uuid'
        or column_row.is_nullable <> 'NO'
      )
  )
  or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'organizations'
      and column_row.column_name = 'id'
  )
  or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_attribute attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
     and attribute_row.attnum = any (constraint_row.conkey)
    where constraint_row.conrelid = 'public.organizations'::pg_catalog.regclass
      and constraint_row.contype in ('p', 'u')
    group by constraint_row.oid
    having pg_catalog.count(*) = 1
       and pg_catalog.min(attribute_row.attname) = 'id'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.organizations column contract mismatch';
  end if;

  if exists (
    select 1
    from (
      values
        ('id'::text, 'uuid'::text, 'NO'::text),
        ('organization_id'::text, 'uuid'::text, 'NO'::text)
    ) as expected(column_name, data_type, is_nullable)
    left join information_schema.columns column_row
      on column_row.table_schema = 'public'
     and column_row.table_name = 'stores'
     and column_row.column_name = expected.column_name
    where column_row.column_name is null
       or column_row.data_type <> expected.data_type
       or column_row.is_nullable <> expected.is_nullable
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.stores column contract mismatch';
  end if;

  if exists (
    select 1
    from (
      values
        ('id'::text, 'uuid'::text, 'NO'::text),
        ('organization_id'::text, 'uuid'::text, 'NO'::text)
    ) as expected(column_name, data_type, is_nullable)
    left join information_schema.columns column_row
      on column_row.table_schema = 'public'
     and column_row.table_name = 'customers'
     and column_row.column_name = expected.column_name
    where column_row.column_name is null
       or column_row.data_type <> expected.data_type
       or column_row.is_nullable <> expected.is_nullable
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.customers column contract mismatch';
  end if;

  if exists (
    select 1
    from (
      values
        ('organization_id'::text, 'uuid'::text, 'NO'::text),
        ('user_id'::text, 'uuid'::text, 'NO'::text)
    ) as expected(column_name, data_type, is_nullable)
    left join information_schema.columns column_row
      on column_row.table_schema = 'public'
     and column_row.table_name = 'memberships'
     and column_row.column_name = expected.column_name
    where column_row.column_name is null
       or column_row.data_type <> expected.data_type
       or column_row.is_nullable <> expected.is_nullable
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.memberships column contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.messages'::pg_catalog.regclass
      and constraint_row.conname = 'messages_conversation_session_scope_fkey'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: messages_conversation_session_scope_fkey is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.messages'::pg_catalog.regclass
      and constraint_row.conname = 'messages_context_link_scope_fkey'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: messages_context_link_scope_fkey is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_session_context_links'::pg_catalog.regclass
      and constraint_row.confrelid = 'public.conversation_sessions'::pg_catalog.regclass
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial_session_context_links must reference conversation_sessions';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_session_context_links'::pg_catalog.regclass
      and constraint_row.confrelid = 'public.commercial_opportunities'::pg_catalog.regclass
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial_session_context_links must reference commercial_opportunities';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunity_lifecycle_events') is not null then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_opportunity_lifecycle_events already exists; migration must not be reapplied';
  end if;

  if pg_catalog.to_regprocedure(
       'public.mark_commercial_opportunity_lost_by_user(uuid,uuid,uuid,text,text,uuid,text,text)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.mark_commercial_opportunity_lost_by_system(uuid,uuid,uuid,text,uuid,text,text,text)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'one or more commercial opportunity lifecycle RPCs already exist';
  end if;
end;
$preflight$;

alter table public.commercial_opportunities
  add column lifecycle_cycle integer not null default 1,
  add column lost_at timestamptz null,
  add column lost_reason_code text null,
  add column lost_reason_details text null,
  add column current_loss_event_id uuid null,
  add column last_reopened_at timestamptz null;

alter table public.commercial_opportunities
  add constraint commercial_opportunities_lifecycle_cycle_check
    check (lifecycle_cycle >= 1),
  add constraint commercial_opportunities_lost_reason_code_check
    check (
      lost_reason_code is null
      or lost_reason_code in (
        'explicit_refusal',
        'bought_from_competitor',
        'confirmed_out_of_service_area',
        'confirmed_technical_infeasibility',
        'contact_opt_out',
        'other'
      )
    ),
  add constraint commercial_opportunities_loss_projection_stage_check
    check (
      (
        stage = 'perdido'
        and lost_at is not null
        and lost_reason_code is not null
        and current_loss_event_id is not null
        and (
          lost_reason_code <> 'other'
          or (
            lost_reason_details is not null
            and pg_catalog.length(pg_catalog.btrim(lost_reason_details)) > 0
          )
        )
      )
      or (
        stage <> 'perdido'
        and lost_at is null
        and lost_reason_code is null
        and lost_reason_details is null
        and current_loss_event_id is null
      )
    );

create index commercial_opportunities_current_loss_event_idx
  on public.commercial_opportunities (current_loss_event_id)
  where current_loss_event_id is not null;

create table public.commercial_opportunity_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  customer_id uuid not null,
  lifecycle_cycle integer not null,
  event_type text not null,
  previous_stage text null,
  new_stage text null,
  reason_code text null,
  reason_details text null,
  evidence_type text null,
  evidence_message_id uuid null,
  evidence_summary text null,
  actor_type text not null,
  actor_user_id uuid null,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  transaction_id bigint not null default pg_catalog.txid_current(),
  created_at timestamptz not null default now(),

  constraint commercial_opportunity_lifecycle_events_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint commercial_opportunity_lifecycle_events_store_org_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint commercial_opportunity_lifecycle_events_opportunity_scope_fkey
    foreign key (
      commercial_opportunity_id,
      organization_id,
      store_id,
      customer_id
    )
    references public.commercial_opportunities(
      id,
      organization_id,
      store_id,
      customer_id
    )
    on delete restrict,

  constraint commercial_opportunity_lifecycle_events_actor_user_fkey
    foreign key (actor_user_id)
    references auth.users(id)
    on delete restrict,

  constraint commercial_opportunity_lifecycle_events_evidence_message_fkey
    foreign key (evidence_message_id)
    references public.messages(id)
    on delete restrict,

  constraint commercial_opportunity_lifecycle_events_lifecycle_cycle_check
    check (lifecycle_cycle >= 1),

  constraint commercial_opportunity_lifecycle_events_event_type_check
    check (
      event_type in (
        'follow_up_exhausted',
        'loss_review_requested',
        'loss_review_approved',
        'loss_review_rejected',
        'marked_lost',
        'reopened'
      )
    ),

  constraint commercial_opportunity_lifecycle_events_actor_type_check
    check (
      actor_type in ('human', 'ai', 'system')
      and (
        (actor_type = 'human' and actor_user_id is not null)
        or (actor_type <> 'human' and actor_user_id is null)
      )
    ),

  constraint commercial_opportunity_lifecycle_events_reason_code_check
    check (
      reason_code is null
      or reason_code in (
        'explicit_refusal',
        'bought_from_competitor',
        'confirmed_out_of_service_area',
        'confirmed_technical_infeasibility',
        'contact_opt_out',
        'other'
      )
    ),

  constraint commercial_opportunity_lifecycle_events_source_not_blank
    check (pg_catalog.length(pg_catalog.btrim(source)) > 0),

  constraint commercial_opportunity_lifecycle_events_reason_details_not_blank
    check (
      reason_details is null
      or pg_catalog.length(pg_catalog.btrim(reason_details)) > 0
    ),

  constraint commercial_opportunity_lifecycle_events_evidence_type_not_blank
    check (
      evidence_type is null
      or pg_catalog.length(pg_catalog.btrim(evidence_type)) > 0
    ),

  constraint commercial_opportunity_lifecycle_events_evidence_summary_not_blank
    check (
      evidence_summary is null
      or pg_catalog.length(pg_catalog.btrim(evidence_summary)) > 0
    ),

  constraint commercial_opportunity_lifecycle_events_metadata_object_check
    check (pg_catalog.jsonb_typeof(metadata) = 'object'),

  constraint commercial_opportunity_lifecycle_events_marked_lost_shape_check
    check (
      event_type <> 'marked_lost'
      or (
        reason_code is not null
        and previous_stage is not null
        and previous_stage <> 'perdido'
        and new_stage = 'perdido'
        and (
          reason_code <> 'other'
          or (
            reason_details is not null
            and pg_catalog.length(pg_catalog.btrim(reason_details)) > 0
          )
        )
      )
    ),

  constraint commercial_opportunity_lifecycle_events_reopened_shape_check
    check (
      event_type <> 'reopened'
      or (
        previous_stage = 'perdido'
        and new_stage in (
          'novo_lead',
          'qualificacao',
          'orcamento',
          'visita_tecnica',
          'negociacao',
          'fechamento_pagamento',
          'instalacao_entrega',
          'pos_venda'
        )
        and new_stage <> 'perdido'
        and reason_details is not null
        and pg_catalog.length(pg_catalog.btrim(reason_details)) > 0
      )
    )
);

alter table public.commercial_opportunity_lifecycle_events owner to postgres;

create unique index commercial_opportunity_lifecycle_events_id_org_store_uidx
  on public.commercial_opportunity_lifecycle_events (
    id,
    organization_id,
    store_id
  );

create unique index commercial_opportunity_lifecycle_events_scope_identity_uidx
  on public.commercial_opportunity_lifecycle_events (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    customer_id,
    lifecycle_cycle
  );

create index commercial_opportunity_lifecycle_events_opportunity_created_idx
  on public.commercial_opportunity_lifecycle_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    created_at desc
  );

create index commercial_opportunity_lifecycle_events_cycle_created_idx
  on public.commercial_opportunity_lifecycle_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    lifecycle_cycle,
    created_at desc
  );

create index commercial_opportunity_lifecycle_events_transaction_idx
  on public.commercial_opportunity_lifecycle_events (
    transaction_id,
    commercial_opportunity_id,
    created_at desc
  );

alter table public.commercial_opportunities
  add constraint commercial_opportunities_current_loss_event_fkey
    foreign key (
      current_loss_event_id,
      organization_id,
      store_id,
      id,
      customer_id,
      lifecycle_cycle
    )
    references public.commercial_opportunity_lifecycle_events(
      id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      customer_id,
      lifecycle_cycle
    )
    on delete restrict;

create or replace function public.prevent_commercial_opportunity_lifecycle_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_op = 'UPDATE' then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_LIFECYCLE_EVENT_UPDATE_FORBIDDEN';
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_LIFECYCLE_EVENT_DELETE_FORBIDDEN';
  end if;

  return new;
end;
$function$;

alter function public.prevent_commercial_opportunity_lifecycle_event_mutation()
  owner to postgres;

revoke all on function public.prevent_commercial_opportunity_lifecycle_event_mutation()
  from public, anon, authenticated, service_role;

create or replace function public.prevent_commercial_opportunity_lifecycle_event_truncate()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'ZION_LIFECYCLE_EVENT_TRUNCATE_FORBIDDEN';
end;
$function$;

alter function public.prevent_commercial_opportunity_lifecycle_event_truncate()
  owner to postgres;

revoke all on function public.prevent_commercial_opportunity_lifecycle_event_truncate()
  from public, anon, authenticated, service_role;

create trigger commercial_opportunity_lifecycle_events_immutable_update
  before update on public.commercial_opportunity_lifecycle_events
  for each row
  execute function public.prevent_commercial_opportunity_lifecycle_event_mutation();

create trigger commercial_opportunity_lifecycle_events_immutable_delete
  before delete on public.commercial_opportunity_lifecycle_events
  for each row
  execute function public.prevent_commercial_opportunity_lifecycle_event_mutation();

create trigger commercial_opportunity_lifecycle_events_immutable_truncate
  before truncate on public.commercial_opportunity_lifecycle_events
  for each statement
  execute function public.prevent_commercial_opportunity_lifecycle_event_truncate();

create or replace function public.enforce_commercial_opportunity_lifecycle_projection()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_loss_event public.commercial_opportunity_lifecycle_events;
begin
  if new.lifecycle_cycle < 1 then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity lifecycle cycle is invalid';
  end if;

  if new.stage = 'perdido' then
    if new.lost_at is null
       or new.lost_reason_code is null
       or new.current_loss_event_id is null then
      raise exception using
        errcode = '23514',
        message = 'commercial opportunity loss projection is incomplete';
    end if;

    if new.lost_reason_code = 'other'
       and (
         new.lost_reason_details is null
         or pg_catalog.length(pg_catalog.btrim(new.lost_reason_details)) = 0
       ) then
      raise exception using
        errcode = '23514',
        message = 'commercial opportunity other loss reason requires details';
    end if;

    select lifecycle_event.*
    into v_loss_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.id = new.current_loss_event_id
      and lifecycle_event.organization_id = new.organization_id
      and lifecycle_event.store_id = new.store_id
      and lifecycle_event.commercial_opportunity_id = new.id
      and lifecycle_event.customer_id = new.customer_id
      and lifecycle_event.lifecycle_cycle = new.lifecycle_cycle;

    if not found
       or v_loss_event.organization_id is distinct from new.organization_id
       or v_loss_event.store_id is distinct from new.store_id
       or v_loss_event.commercial_opportunity_id is distinct from new.id
       or v_loss_event.customer_id is distinct from new.customer_id
       or v_loss_event.lifecycle_cycle is distinct from new.lifecycle_cycle
       or v_loss_event.event_type <> 'marked_lost'
       or v_loss_event.new_stage <> 'perdido'
       or v_loss_event.reason_code is distinct from new.lost_reason_code
       or v_loss_event.reason_details is distinct from new.lost_reason_details
       or v_loss_event.created_at is distinct from new.lost_at then
      raise exception using
        errcode = '23514',
        message = 'commercial opportunity current loss projection mismatch';
    end if;
  else
    if new.lost_at is not null
       or new.lost_reason_code is not null
       or new.lost_reason_details is not null
       or new.current_loss_event_id is not null then
      raise exception using
        errcode = '23514',
        message = 'commercial opportunity non-lost stage cannot keep loss projection';
    end if;
  end if;

  return new;
end;
$function$;

alter function public.enforce_commercial_opportunity_lifecycle_projection()
  owner to postgres;

revoke all on function public.enforce_commercial_opportunity_lifecycle_projection()
  from public, anon, authenticated, service_role;

create or replace function public.enforce_commercial_opportunity_loss_stage_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_transition_event public.commercial_opportunity_lifecycle_events;
  v_current_tx bigint := pg_catalog.txid_current();
  v_transition_count integer;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.stage is not distinct from old.stage then
    if old.stage = 'perdido'
       and (
         new.current_loss_event_id is distinct from old.current_loss_event_id
         or new.lost_at is distinct from old.lost_at
         or new.lost_reason_code is distinct from old.lost_reason_code
         or new.lost_reason_details is distinct from old.lost_reason_details
         or new.lifecycle_cycle is distinct from old.lifecycle_cycle
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_DIRECT_LOSS_STAGE_TRANSITION_FORBIDDEN';
    end if;
    return new;
  end if;

  if old.stage <> 'perdido'
     and new.stage = 'perdido' then
    if new.current_loss_event_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_DIRECT_LOSS_STAGE_TRANSITION_FORBIDDEN';
    end if;

    select lifecycle_event.*
    into v_transition_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.id = new.current_loss_event_id
      and lifecycle_event.transaction_id = v_current_tx
      and lifecycle_event.organization_id = old.organization_id
      and lifecycle_event.store_id = old.store_id
      and lifecycle_event.commercial_opportunity_id = old.id
      and lifecycle_event.customer_id = old.customer_id
      and lifecycle_event.lifecycle_cycle = old.lifecycle_cycle
      and lifecycle_event.event_type = 'marked_lost'
      and lifecycle_event.previous_stage is not distinct from old.stage
      and lifecycle_event.new_stage = 'perdido';
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_DIRECT_LOSS_STAGE_TRANSITION_FORBIDDEN';
    end if;

    select count(*)
    into v_transition_count
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.transaction_id = v_current_tx
      and lifecycle_event.organization_id = old.organization_id
      and lifecycle_event.store_id = old.store_id
      and lifecycle_event.commercial_opportunity_id = old.id
      and lifecycle_event.customer_id = old.customer_id
      and lifecycle_event.lifecycle_cycle = old.lifecycle_cycle
      and lifecycle_event.event_type = 'marked_lost';

    if v_transition_count <> 1 then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_LOSS_TRANSITION_EVENT_AMBIGUOUS';
    end if;

    if new.current_loss_event_id is distinct from v_transition_event.id
       or new.lost_at is distinct from v_transition_event.created_at
       or new.lost_reason_code is distinct from v_transition_event.reason_code
       or new.lost_reason_details is distinct from v_transition_event.reason_details
       or new.lifecycle_cycle is distinct from old.lifecycle_cycle then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_LOSS_PROJECTION_EVENT_MISMATCH';
    end if;

    return new;
  end if;

  if old.stage = 'perdido'
     and new.stage <> 'perdido' then
    select lifecycle_event.*
    into v_transition_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.transaction_id = v_current_tx
      and lifecycle_event.organization_id = old.organization_id
      and lifecycle_event.store_id = old.store_id
      and lifecycle_event.commercial_opportunity_id = old.id
      and lifecycle_event.customer_id = old.customer_id
      and lifecycle_event.lifecycle_cycle = old.lifecycle_cycle
      and lifecycle_event.event_type = 'reopened'
      and lifecycle_event.previous_stage = 'perdido'
      and lifecycle_event.new_stage = new.stage
    order by lifecycle_event.created_at desc
    limit 1;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_DIRECT_REOPEN_TRANSITION_FORBIDDEN';
    end if;

    select count(*)
    into v_transition_count
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.transaction_id = v_current_tx
      and lifecycle_event.organization_id = old.organization_id
      and lifecycle_event.store_id = old.store_id
      and lifecycle_event.commercial_opportunity_id = old.id
      and lifecycle_event.customer_id = old.customer_id
      and lifecycle_event.lifecycle_cycle = old.lifecycle_cycle
      and lifecycle_event.event_type = 'reopened';

    if v_transition_count <> 1 then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_REOPEN_TRANSITION_EVENT_AMBIGUOUS';
    end if;

    if new.lifecycle_cycle <> old.lifecycle_cycle + 1 then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_REOPEN_CYCLE_INCREMENT_REQUIRED';
    end if;

    return new;
  end if;

  return new;
end;
$function$;

alter function public.enforce_commercial_opportunity_loss_stage_transition()
  owner to postgres;

revoke all on function public.enforce_commercial_opportunity_loss_stage_transition()
  from public, anon, authenticated, service_role;

create trigger commercial_opportunities_05_enforce_lifecycle_projection
  before insert or update on public.commercial_opportunities
  for each row
  execute function public.enforce_commercial_opportunity_lifecycle_projection();

create trigger commercial_opportunities_10_enforce_loss_stage_transition
  before update on public.commercial_opportunities
  for each row
  execute function public.enforce_commercial_opportunity_loss_stage_transition();

create or replace function public.normalize_commercial_opportunity_loss_reason_code(
  p_reason_code text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_reason_code text := pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(p_reason_code, '')));
begin
  if v_reason_code = '' then
    return null;
  end if;

  if v_reason_code not in (
    'explicit_refusal',
    'bought_from_competitor',
    'confirmed_out_of_service_area',
    'confirmed_technical_infeasibility',
    'contact_opt_out',
    'other'
  ) then
    raise exception using
      errcode = '22023',
      message = 'ZION_INVALID_LOSS_REASON';
  end if;

  return v_reason_code;
end;
$function$;

alter function public.normalize_commercial_opportunity_loss_reason_code(text)
  owner to postgres;

revoke all on function public.normalize_commercial_opportunity_loss_reason_code(text)
  from public, anon, authenticated, service_role;

create or replace function public.normalize_commercial_opportunity_stage(
  p_stage text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_stage text := pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(p_stage, '')));
begin
  if v_stage = '' then
    return null;
  end if;

  if v_stage not in (
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
  ) then
    raise exception using
      errcode = '22023',
      message = 'invalid commercial opportunity stage';
  end if;

  return v_stage;
end;
$function$;

alter function public.normalize_commercial_opportunity_stage(text)
  owner to postgres;

revoke all on function public.normalize_commercial_opportunity_stage(text)
  from public, anon, authenticated, service_role;

create or replace function public.assert_commercial_opportunity_message_evidence(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_customer_id uuid,
  p_evidence_message_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_message record;
begin
  if p_evidence_message_id is null then
    return null;
  end if;

  select
    message_row.id,
    message_row.organization_id,
    message_row.conversation_id,
    message_row.conversation_session_id,
    message_row.commercial_session_context_link_id,
    message_row.commercial_context_capture_state
  into v_message
  from public.messages message_row
  where message_row.id = p_evidence_message_id
    and message_row.organization_id = p_organization_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_LOSS_EVIDENCE_OUT_OF_SCOPE';
  end if;

  if v_message.commercial_context_capture_state = 'captured'
     and v_message.conversation_session_id is not null
     and v_message.commercial_session_context_link_id is not null
     and exists (
    select 1
    from public.conversation_sessions session_row
    join public.commercial_session_context_links context_link
      on context_link.id = v_message.commercial_session_context_link_id
     and context_link.conversation_session_id = session_row.id
     and context_link.organization_id = session_row.organization_id
     and context_link.store_id = session_row.store_id
    where session_row.organization_id = p_organization_id
     and session_row.store_id = p_store_id
      and session_row.id = v_message.conversation_session_id
      and session_row.conversation_id = v_message.conversation_id
      and context_link.commercial_opportunity_id = p_commercial_opportunity_id
      and context_link.customer_id = p_customer_id
  ) then
    return v_message.id;
  end if;

  raise exception using
    errcode = '23514',
    message = 'ZION_LOSS_EVIDENCE_CONTEXT_NOT_PROVEN';
end;
$function$;

alter function public.assert_commercial_opportunity_message_evidence(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
)
  owner to postgres;

revoke all on function public.assert_commercial_opportunity_message_evidence(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
)
  from public, anon, authenticated, service_role;

create or replace function public.mark_commercial_opportunity_lost_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_reason_code text,
  p_reason_details text default null,
  p_evidence_message_id uuid default null,
  p_evidence_summary text default null,
  p_source text default 'manual_user_loss'
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  current_loss_event_id uuid,
  lost_at timestamptz,
  lost_reason_code text,
  lost_reason_details text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := pg_catalog.nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_reason_code text;
  v_reason_details text := pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_reason_details, '')), '');
  v_evidence_summary text := pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_evidence_summary, '')), '');
  v_source text := pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_source, '')), '');
  v_opportunity public.commercial_opportunities;
  v_loss_event public.commercial_opportunity_lifecycle_events;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity loss by user is not authorized';
  end if;

  if p_request_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or v_source is null then
    raise exception using
      errcode = '22023',
      message = 'commercial opportunity loss by user requires organization, store, opportunity and source';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity loss by user is not authorized';
  end if;

  v_reason_code := public.normalize_commercial_opportunity_loss_reason_code(p_reason_code);

  if v_reason_code = 'other' and v_reason_details is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_LOSS_OTHER_DETAILS_REQUIRED';
  end if;

  if v_reason_code = 'contact_opt_out' then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTACT_OPT_OUT_ATOMIC_BLOCK_REQUIRED';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity not found';
  end if;

  if v_opportunity.organization_id is distinct from p_request_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity scope mismatch';
  end if;

  if v_opportunity.stage = 'perdido' then
    raise exception using
      errcode = '23514',
      message = 'ZION_OPPORTUNITY_ALREADY_LOST';
  end if;

  perform public.assert_commercial_opportunity_message_evidence(
    p_organization_id => v_opportunity.organization_id,
    p_store_id => v_opportunity.store_id,
    p_commercial_opportunity_id => v_opportunity.id,
    p_customer_id => v_opportunity.customer_id,
    p_evidence_message_id => p_evidence_message_id
  );

  insert into public.commercial_opportunity_lifecycle_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    customer_id,
    lifecycle_cycle,
    event_type,
    previous_stage,
    new_stage,
    reason_code,
    reason_details,
    evidence_type,
    evidence_message_id,
    evidence_summary,
    actor_type,
    actor_user_id,
    source,
    metadata
  )
  values (
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    v_opportunity.customer_id,
    v_opportunity.lifecycle_cycle,
    'marked_lost',
    v_opportunity.stage,
    'perdido',
    v_reason_code,
    v_reason_details,
    case when p_evidence_message_id is null then null else 'message' end,
    p_evidence_message_id,
    v_evidence_summary,
    'human',
    v_user_id,
    v_source,
    pg_catalog.jsonb_build_object(
      'request_organization_id', p_request_organization_id,
      'requested_store_id', p_store_id
    )
  )
  returning *
  into v_loss_event;

  update public.commercial_opportunities opportunity_row
  set
    stage = 'perdido',
    lost_at = v_loss_event.created_at,
    lost_reason_code = v_loss_event.reason_code,
    lost_reason_details = v_loss_event.reason_details,
    current_loss_event_id = v_loss_event.id
  where opportunity_row.id = v_opportunity.id;

  return query
  select
    opportunity_row.id,
    opportunity_row.stage,
    opportunity_row.lifecycle_cycle,
    opportunity_row.current_loss_event_id,
    opportunity_row.lost_at,
    opportunity_row.lost_reason_code,
    opportunity_row.lost_reason_details
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_opportunity.id;
end;
$function$;

alter function public.mark_commercial_opportunity_lost_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text
)
  owner to postgres;

create or replace function public.mark_commercial_opportunity_lost_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_reason_code text,
  p_evidence_message_id uuid,
  p_evidence_summary text,
  p_actor_type text,
  p_source text
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  current_loss_event_id uuid,
  lost_at timestamptz,
  lost_reason_code text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := pg_catalog.nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_reason_code text;
  v_actor_type text := pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(p_actor_type, '')));
  v_evidence_summary text := pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_evidence_summary, '')), '');
  v_source text := pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_source, '')), '');
  v_opportunity public.commercial_opportunities;
  v_loss_event public.commercial_opportunity_lifecycle_events;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity loss by system is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_evidence_message_id is null
     or v_evidence_summary is null
     or v_source is null then
    raise exception using
      errcode = '22023',
      message = 'commercial opportunity loss by system requires scope, evidence and source';
  end if;

  if v_actor_type not in ('ai', 'system') then
    raise exception using
      errcode = '22023',
      message = 'ZION_SYSTEM_LOSS_ACTOR_INVALID';
  end if;

  v_reason_code := public.normalize_commercial_opportunity_loss_reason_code(p_reason_code);

  if v_reason_code not in (
       'explicit_refusal',
       'bought_from_competitor',
       'confirmed_out_of_service_area'
     ) then
    raise exception using
      errcode = '22023',
      message = 'ZION_SYSTEM_LOSS_REASON_FORBIDDEN';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity not found';
  end if;

  if v_opportunity.organization_id is distinct from p_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity scope mismatch';
  end if;

  if v_opportunity.stage = 'perdido' then
    raise exception using
      errcode = '23514',
      message = 'ZION_OPPORTUNITY_ALREADY_LOST';
  end if;

  perform public.assert_commercial_opportunity_message_evidence(
    p_organization_id => v_opportunity.organization_id,
    p_store_id => v_opportunity.store_id,
    p_commercial_opportunity_id => v_opportunity.id,
    p_customer_id => v_opportunity.customer_id,
    p_evidence_message_id => p_evidence_message_id
  );

  insert into public.commercial_opportunity_lifecycle_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    customer_id,
    lifecycle_cycle,
    event_type,
    previous_stage,
    new_stage,
    reason_code,
    reason_details,
    evidence_type,
    evidence_message_id,
    evidence_summary,
    actor_type,
    actor_user_id,
    source,
    metadata
  )
  values (
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    v_opportunity.customer_id,
    v_opportunity.lifecycle_cycle,
    'marked_lost',
    v_opportunity.stage,
    'perdido',
    v_reason_code,
    null,
    'message',
    p_evidence_message_id,
    v_evidence_summary,
    v_actor_type,
    null,
    v_source,
    pg_catalog.jsonb_build_object(
      'internal_operation', true
    )
  )
  returning *
  into v_loss_event;

  update public.commercial_opportunities opportunity_row
  set
    stage = 'perdido',
    lost_at = v_loss_event.created_at,
    lost_reason_code = v_loss_event.reason_code,
    lost_reason_details = null,
    current_loss_event_id = v_loss_event.id
  where opportunity_row.id = v_opportunity.id;

  return query
  select
    opportunity_row.id,
    opportunity_row.stage,
    opportunity_row.lifecycle_cycle,
    opportunity_row.current_loss_event_id,
    opportunity_row.lost_at,
    opportunity_row.lost_reason_code
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_opportunity.id;
end;
$function$;

alter function public.mark_commercial_opportunity_lost_by_system(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  text,
  text,
  text
)
  owner to postgres;

create or replace function public.reopen_commercial_opportunity_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_target_stage text,
  p_reason_details text,
  p_source text
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  current_loss_event_id uuid,
  last_reopened_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := pg_catalog.nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_target_stage text;
  v_reason_details text := pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_reason_details, '')), '');
  v_source text := pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_source, '')), '');
  v_opportunity public.commercial_opportunities;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity reopen by user is not authorized';
  end if;

  if p_request_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or v_source is null
     or v_reason_details is null then
    raise exception using
      errcode = '22023',
      message = 'commercial opportunity reopen by user requires scope, reason_details and source';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity reopen by user is not authorized';
  end if;

  v_target_stage := public.normalize_commercial_opportunity_stage(p_target_stage);

  if v_target_stage not in (
       'novo_lead',
       'qualificacao',
       'orcamento',
       'visita_tecnica',
       'negociacao',
       'fechamento_pagamento',
       'instalacao_entrega',
       'pos_venda'
     ) then
    raise exception using
      errcode = '22023',
      message = 'ZION_REOPEN_TARGET_STAGE_INVALID';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity not found';
  end if;

  if v_opportunity.organization_id is distinct from p_request_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity scope mismatch';
  end if;

  if v_opportunity.stage <> 'perdido' then
    raise exception using
      errcode = '23514',
      message = 'ZION_REOPEN_REQUIRES_LOST_STAGE';
  end if;

  insert into public.commercial_opportunity_lifecycle_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    customer_id,
    lifecycle_cycle,
    event_type,
    previous_stage,
    new_stage,
    reason_code,
    reason_details,
    evidence_type,
    evidence_message_id,
    evidence_summary,
    actor_type,
    actor_user_id,
    source,
    metadata
  )
  values (
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    v_opportunity.customer_id,
    v_opportunity.lifecycle_cycle,
    'reopened',
    'perdido',
    v_target_stage,
    null,
    v_reason_details,
    null,
    null,
    null,
    'human',
    v_user_id,
    v_source,
    pg_catalog.jsonb_build_object(
      'request_organization_id', p_request_organization_id,
      'requested_store_id', p_store_id
    )
  );

  update public.commercial_opportunities opportunity_row
  set
    lifecycle_cycle = opportunity_row.lifecycle_cycle + 1,
    stage = v_target_stage,
    lost_at = null,
    lost_reason_code = null,
    lost_reason_details = null,
    current_loss_event_id = null,
    last_reopened_at = pg_catalog.clock_timestamp()
  where opportunity_row.id = v_opportunity.id;

  return query
  select
    opportunity_row.id,
    opportunity_row.stage,
    opportunity_row.lifecycle_cycle,
    opportunity_row.current_loss_event_id,
    opportunity_row.last_reopened_at
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_opportunity.id;
end;
$function$;

alter function public.reopen_commercial_opportunity_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text
)
  owner to postgres;

alter table public.commercial_opportunity_lifecycle_events enable row level security;

revoke all on table public.commercial_opportunity_lifecycle_events
  from public, anon, authenticated, service_role;

revoke insert, update, delete, truncate on table public.commercial_opportunity_lifecycle_events
  from public, anon, authenticated, service_role;

grant select on table public.commercial_opportunity_lifecycle_events
  to authenticated, service_role;

drop policy if exists commercial_opportunity_lifecycle_events_select_by_membership
  on public.commercial_opportunity_lifecycle_events;

create policy commercial_opportunity_lifecycle_events_select_by_membership
  on public.commercial_opportunity_lifecycle_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_opportunity_lifecycle_events.organization_id
        and membership_row.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.stores store_row
      where store_row.id = commercial_opportunity_lifecycle_events.store_id
        and store_row.organization_id = commercial_opportunity_lifecycle_events.organization_id
    )
  );

revoke all on function public.mark_commercial_opportunity_lost_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text
)
  from public, anon, authenticated, service_role;

grant execute on function public.mark_commercial_opportunity_lost_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text
)
  to authenticated;

revoke all on function public.mark_commercial_opportunity_lost_by_system(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  text,
  text,
  text
)
  from public, anon, authenticated, service_role;

grant execute on function public.mark_commercial_opportunity_lost_by_system(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  text,
  text,
  text
)
  to service_role;

revoke all on function public.reopen_commercial_opportunity_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text
)
  from public, anon, authenticated, service_role;

grant execute on function public.reopen_commercial_opportunity_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text
)
  to authenticated;

commit;

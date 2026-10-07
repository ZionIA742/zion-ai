begin;

set local lock_timeout = '5s';

set local statement_timeout = '300s';

set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(

  pg_catalog.hashtextextended('20261006190000_p9_8_5_negotiation_concession_materialization', 0)

);



do $preflight$

begin

  if to_regclass('public.commercial_negotiation_concessions') is null

     or to_regclass('public.sales_quotes') is null

     or to_regclass('public.sales_quote_versions') is null

     or to_regclass('public.store_quote_settings') is null

     or to_regprocedure('public.p9_resolve_current_commercial_proposal_internal(uuid,uuid,uuid)') is null

     or to_regprocedure('public.materialize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)') is null

     or to_regprocedure('public.finalize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text)') is null then

    raise exception using errcode = 'P0001', message = 'P9_8_5_PRECONDITIONS_FAILED';

  end if;

end;

$preflight$;



create table public.commercial_negotiation_concession_materializations (

  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,

  store_id uuid not null,

  commercial_opportunity_id uuid not null,

  negotiation_cycle_id uuid not null,

  concession_id uuid not null references public.commercial_negotiation_concessions(id) on delete restrict,

  base_quote_id uuid not null,

  base_quote_version_id uuid not null,

  target_quote_id uuid,

  target_quote_version_id uuid,

  target_quote_number text,

  outbound_message_id uuid,

  reserved_concession_number integer,

  operation_key text not null,

  request_fingerprint text not null,

  state text not null,

  created_at timestamptz not null default clock_timestamp(),

  updated_at timestamptz not null default clock_timestamp(),

  materialized_at timestamptz,

  constraint p9_8_5_materialization_scope_operation_uq

    unique (organization_id, store_id, concession_id),

  constraint p9_8_5_materialization_operation_key_uq

    unique (organization_id, store_id, operation_key),

  constraint p9_8_5_materialization_state_check

    check (state in ('prepared','quote_created','version_created','send_queued','materialized','superseded')),

  constraint p9_8_5_materialization_ordinal_check

    check (reserved_concession_number is null or reserved_concession_number in (1,2)),

  constraint p9_8_5_materialization_operation_key_check

    check (operation_key = btrim(operation_key) and length(operation_key) between 1 and 240),

  constraint p9_8_5_materialization_fingerprint_check

    check (request_fingerprint ~ '^[0-9a-f]{64}$'),

  constraint p9_8_5_materialization_superseded_ordinal_check

    check (state <> 'superseded' or reserved_concession_number is null)

);

alter table public.commercial_negotiation_concession_materializations owner to postgres;

create unique index p9_8_5_materialization_active_ordinal_uq

  on public.commercial_negotiation_concession_materializations (

    organization_id, store_id, negotiation_cycle_id, reserved_concession_number

  ) where reserved_concession_number is not null;

create index p9_8_5_materialization_opportunity_idx

  on public.commercial_negotiation_concession_materializations (

    organization_id, store_id, commercial_opportunity_id, negotiation_cycle_id

  );

alter table public.commercial_negotiation_concession_materializations enable row level security;

alter table public.commercial_negotiation_concession_materializations force row level security;

revoke all on table public.commercial_negotiation_concession_materializations

from public, anon, authenticated, service_role;



create or replace function public.p9_8_5_materialization_fingerprint_internal(

  p_payload jsonb

)

returns text

language sql

immutable

strict

set search_path = pg_catalog

as $function$

  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(p_payload::text, 'UTF8'::name),
      'sha256'::text
    ),
    'hex'::text
  )

$function$;

alter function public.p9_8_5_materialization_fingerprint_internal(jsonb) owner to postgres;

revoke all on function public.p9_8_5_materialization_fingerprint_internal(jsonb)

from public, anon, authenticated, service_role;



create or replace function public.supersede_commercial_negotiation_concession_materialization_by_system(

  p_organization_id uuid,p_store_id uuid,p_commercial_opportunity_id uuid,p_materialization_id uuid

)

returns table (materialization_id uuid,state text,reserved_concession_number integer,replayed boolean)

language plpgsql security definer set search_path=pg_catalog,pg_temp,public,auth,extensions set row_security=off

as $function$

declare v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(auth.jwt()->>'role','')); v_m public.commercial_negotiation_concession_materializations%rowtype;

begin

  if v_role is distinct from 'service_role' and session_user<>'postgres' then raise exception using errcode='42501',message='P9_8_5_SUPERSEDE_NOT_AUTHORIZED'; end if;

  select * into v_m from public.commercial_negotiation_concession_materializations where id=p_materialization_id and organization_id=p_organization_id and store_id=p_store_id and commercial_opportunity_id=p_commercial_opportunity_id for update;

  if not found then raise exception using errcode='P0002',message='P9_8_5_MATERIALIZATION_NOT_FOUND'; end if;

  if v_m.state in ('materialized','superseded') then materialization_id:=v_m.id;state:=v_m.state;reserved_concession_number:=v_m.reserved_concession_number;replayed:=true;return next;return; end if;

  update public.commercial_negotiation_concession_materializations set state='superseded',reserved_concession_number=null,materialized_at=null,updated_at=clock_timestamp() where id=v_m.id;

  materialization_id:=v_m.id;state:='superseded';reserved_concession_number:=null;replayed:=false;return next;

end;

$function$;

alter function public.supersede_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid) owner to postgres;

revoke all on function public.supersede_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid) from public,anon,authenticated;

grant execute on function public.supersede_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid) to service_role;



create or replace function public.prepare_commercial_negotiation_concession_materialization_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_commercial_opportunity_id uuid,

  p_concession_id uuid

)

returns table (

  materialization_id uuid,

  operation_key text,

  request_fingerprint text,

  state text,

  negotiation_cycle_id uuid,

  base_quote_id uuid,

  base_quote_version_id uuid,

  target_quote_id uuid,

  target_quote_number text,

  reserved_concession_number integer,

  replayed boolean

)

language plpgsql

security definer

set search_path = pg_catalog, pg_temp, public, auth, extensions

set row_security = off

as $function$

declare

  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(auth.jwt() ->> 'role', ''));

  v_concession public.commercial_negotiation_concessions%rowtype;

  v_existing public.commercial_negotiation_concession_materializations%rowtype;

  v_opportunity public.commercial_opportunities%rowtype;

  v_quote public.sales_quotes%rowtype;

  v_version public.sales_quote_versions%rowtype;

  v_proposal record;

  v_settings public.store_quote_settings%rowtype;

  v_operation_key text := 'commercial_negotiation_concession_materialization:' || p_concession_id::text;

  v_fingerprint text;

  v_number integer;

  v_quote_number text;

  v_reserved integer := null;

  v_has_existing boolean := false;

  v_used_one boolean := false;

  v_used_two boolean := false;

  v_row record;

begin

  if v_role is distinct from 'service_role' and session_user <> 'postgres' then

    raise exception using errcode = '42501', message = 'P9_8_5_PREPARE_NOT_AUTHORIZED';

  end if;

  if p_organization_id is null or p_store_id is null or p_commercial_opportunity_id is null or p_concession_id is null then

    raise exception using errcode = '22023', message = 'P9_8_5_ARGUMENTS_REQUIRED';

  end if;

  select c.* into v_concession

  from public.commercial_negotiation_concessions c

  where c.id = p_concession_id and c.organization_id = p_organization_id

    and c.store_id = p_store_id and c.commercial_opportunity_id = p_commercial_opportunity_id

  for update;

  if not found then raise exception using errcode = 'P0002', message = 'P9_8_5_CONCESSION_NOT_FOUND_IN_SCOPE'; end if;

  v_fingerprint := public.p9_8_5_materialization_fingerprint_internal(jsonb_build_object(

    'organization_id',p_organization_id,'store_id',p_store_id,'commercial_opportunity_id',p_commercial_opportunity_id,

    'concession_id',v_concession.id,'negotiation_cycle_id',v_concession.negotiation_cycle_id,

    'base_quote_id',v_concession.quote_id,'base_quote_version_id',v_concession.quote_version_id,

    'authority_decision',v_concession.authority_decision,'effective_decision',v_concession.effective_decision,

    'requested_discount_percent',v_concession.requested_discount_percent,

    'requested_discount_cents',v_concession.requested_discount_cents,

    'counterpart_snapshot',v_concession.counterpart_snapshot

  ));

  select m.* into v_existing

  from public.commercial_negotiation_concession_materializations m

  where m.organization_id=p_organization_id and m.store_id=p_store_id and m.concession_id=p_concession_id

  for update;

  if found then

    v_has_existing := true;

    if v_existing.request_fingerprint is distinct from v_fingerprint then

      raise exception using errcode='23505', message='P9_8_5_MATERIALIZATION_IDEMPOTENCY_DIVERGENT';

    end if;

    if v_existing.state in ('materialized','superseded') then

      return query select v_existing.id,v_existing.operation_key,v_existing.request_fingerprint,v_existing.state,

        v_existing.negotiation_cycle_id,v_existing.base_quote_id,v_existing.base_quote_version_id,

        v_existing.target_quote_id,v_existing.target_quote_number,v_existing.reserved_concession_number,true;

      return;

    end if;

  end if;

  if v_concession.status is distinct from 'authorized' or v_concession.effective_decision is distinct from 'allowed'

     or v_concession.concession_number is not null or v_concession.materialized_at is not null then

    if v_has_existing then

      update public.commercial_negotiation_concession_materializations set state='superseded',reserved_concession_number=null,materialized_at=null,updated_at=clock_timestamp() where id=v_existing.id;

      return query select v_existing.id,v_existing.operation_key,v_existing.request_fingerprint,'superseded',v_existing.negotiation_cycle_id,v_existing.base_quote_id,v_existing.base_quote_version_id,v_existing.target_quote_id,v_existing.target_quote_number,null::integer,true;

      return;

    end if;

    raise exception using errcode='23514', message='P9_8_5_CONCESSION_NOT_AUTHORIZED';

  end if;

  if v_concession.concession_class = 'human_exception'

     and (v_concession.approval_status is distinct from 'approved' or v_concession.approval_actor_user_id is null or v_concession.approval_decided_at is null) then

    if v_has_existing then

      update public.commercial_negotiation_concession_materializations set state='superseded',reserved_concession_number=null,materialized_at=null,updated_at=clock_timestamp() where id=v_existing.id;

      return query select v_existing.id,v_existing.operation_key,v_existing.request_fingerprint,'superseded',v_existing.negotiation_cycle_id,v_existing.base_quote_id,v_existing.base_quote_version_id,v_existing.target_quote_id,v_existing.target_quote_number,null::integer,true;

      return;

    end if;

    raise exception using errcode='23514', message='P9_8_5_HUMAN_EXCEPTION_APPROVAL_REQUIRED';

  end if;

  select o.* into v_opportunity from public.commercial_opportunities o

  where o.id=p_commercial_opportunity_id and o.organization_id=p_organization_id and o.store_id=p_store_id for update;

  if not found or v_opportunity.stage is distinct from 'negociacao' then

    if v_has_existing then

      update public.commercial_negotiation_concession_materializations set state='superseded',reserved_concession_number=null,materialized_at=null,updated_at=clock_timestamp() where id=v_existing.id;

      return query select v_existing.id,v_existing.operation_key,v_existing.request_fingerprint,'superseded',v_existing.negotiation_cycle_id,v_existing.base_quote_id,v_existing.base_quote_version_id,v_existing.target_quote_id,v_existing.target_quote_number,null::integer,true;

      return;

    end if;

    raise exception using errcode='23514', message='P9_8_5_OPPORTUNITY_STALE';

  end if;

  if not exists (select 1 from public.commercial_opportunity_lifecycle_events l

    where l.id=v_concession.negotiation_cycle_id and l.organization_id=p_organization_id and l.store_id=p_store_id

      and l.commercial_opportunity_id=p_commercial_opportunity_id and l.lifecycle_cycle=v_opportunity.lifecycle_cycle

      and l.event_type='stage_transition' and l.new_stage='negociacao'

      and l.reason_code in ('concrete_offer_required','concrete_quote_objection_required','visit_viable_concrete_offer_required','renegotiation_required')) then

    if v_has_existing then

      update public.commercial_negotiation_concession_materializations set state='superseded',reserved_concession_number=null,materialized_at=null,updated_at=clock_timestamp() where id=v_existing.id;

      return query select v_existing.id,v_existing.operation_key,v_existing.request_fingerprint,'superseded',v_existing.negotiation_cycle_id,v_existing.base_quote_id,v_existing.base_quote_version_id,v_existing.target_quote_id,v_existing.target_quote_number,null::integer,true;

      return;

    end if;

    raise exception using errcode='23514', message='P9_8_5_NEGOTIATION_CYCLE_STALE';

  end if;

  select q.* into v_quote from public.sales_quotes q where q.id=v_concession.quote_id

    and q.organization_id=p_organization_id and q.store_id=p_store_id and q.commercial_opportunity_id=p_commercial_opportunity_id for update;

  if not found or v_quote.current_version_id is distinct from v_concession.quote_version_id then

    if v_has_existing then update public.commercial_negotiation_concession_materializations set state='superseded',reserved_concession_number=null,materialized_at=null,updated_at=clock_timestamp() where id=v_existing.id; return query select v_existing.id,v_existing.operation_key,v_existing.request_fingerprint,'superseded',v_existing.negotiation_cycle_id,v_existing.base_quote_id,v_existing.base_quote_version_id,v_existing.target_quote_id,v_existing.target_quote_number,null::integer,true; return; end if;

    raise exception using errcode='23514', message='P9_8_5_BASE_QUOTE_STALE';

  end if;

  select v.* into v_version from public.sales_quote_versions v where v.id=v_concession.quote_version_id

    and v.quote_id=v_concession.quote_id and v.organization_id=p_organization_id and v.store_id=p_store_id for update;

  if not found or v_version.sent_at is null or v_version.status not in ('sent','superseded') then

    if v_has_existing then update public.commercial_negotiation_concession_materializations set state='superseded',reserved_concession_number=null,materialized_at=null,updated_at=clock_timestamp() where id=v_existing.id; return query select v_existing.id,v_existing.operation_key,v_existing.request_fingerprint,'superseded',v_existing.negotiation_cycle_id,v_existing.base_quote_id,v_existing.base_quote_version_id,v_existing.target_quote_id,v_existing.target_quote_number,null::integer,true; return; end if;

    raise exception using errcode='23514', message='P9_8_5_BASE_VERSION_STALE';

  end if;

  select p.* into v_proposal from public.p9_resolve_current_commercial_proposal_internal(p_organization_id,p_store_id,p_commercial_opportunity_id) p;

  if not found or v_proposal.proposal_state is distinct from 'available'

     or v_proposal.current_quote_id is distinct from v_concession.quote_id

     or v_proposal.current_quote_version_id is distinct from v_concession.quote_version_id

     or v_proposal.lifecycle_cycle is distinct from v_opportunity.lifecycle_cycle

     or v_proposal.reason_code is distinct from 'current_proposal_authority_valid' then

    if v_has_existing then update public.commercial_negotiation_concession_materializations set state='superseded',reserved_concession_number=null,materialized_at=null,updated_at=clock_timestamp() where id=v_existing.id; return query select v_existing.id,v_existing.operation_key,v_existing.request_fingerprint,'superseded',v_existing.negotiation_cycle_id,v_existing.base_quote_id,v_existing.base_quote_version_id,v_existing.target_quote_id,v_existing.target_quote_number,null::integer,true; return; end if;

    raise exception using errcode='23514', message='P9_8_5_CURRENT_PROPOSAL_STALE';

  end if;

  if v_has_existing then

    return query select v_existing.id,v_existing.operation_key,v_existing.request_fingerprint,v_existing.state,

      v_existing.negotiation_cycle_id,v_existing.base_quote_id,v_existing.base_quote_version_id,

      v_existing.target_quote_id,v_existing.target_quote_number,v_existing.reserved_concession_number,true;

    return;

  end if;

  select s.* into v_settings from public.store_quote_settings s

  where s.organization_id=p_organization_id and s.store_id=p_store_id for update;

  if not found then raise exception using errcode='23514', message='P9_8_5_QUOTE_NUMBER_SETTINGS_MISSING'; end if;

  v_number := greatest(1, coalesce(v_settings.next_quote_number,1));

  v_quote_number := coalesce(nullif(btrim(v_settings.quote_number_prefix),''),'ORC') || '-' || lpad(v_number::text,6,'0');

  update public.store_quote_settings set next_quote_number=v_number+1, updated_at=clock_timestamp() where id=v_settings.id;

  if v_concession.concession_class='normal' then

    for v_row in select m.reserved_concession_number from public.commercial_negotiation_concession_materializations m

      where m.organization_id=p_organization_id and m.store_id=p_store_id and m.negotiation_cycle_id=v_concession.negotiation_cycle_id

        and m.reserved_concession_number is not null order by m.reserved_concession_number for update loop

      if v_row.reserved_concession_number=1 then v_used_one:=true; elsif v_row.reserved_concession_number=2 then v_used_two:=true; else raise exception using errcode='23514',message='P9_8_5_ORDINAL_STATE_INVALID'; end if;

    end loop;

    for v_row in select c.concession_number from public.commercial_negotiation_concessions c

      where c.organization_id=p_organization_id and c.store_id=p_store_id and c.commercial_opportunity_id=p_commercial_opportunity_id

        and c.negotiation_cycle_id=v_concession.negotiation_cycle_id and c.concession_class='normal'

        and c.status='materialized' and c.concession_number is not null order by c.concession_number for update loop

      if v_row.concession_number=1 then v_used_one:=true; elsif v_row.concession_number=2 then v_used_two:=true; else raise exception using errcode='23514',message='P9_8_5_ORDINAL_STATE_INVALID'; end if;

    end loop;

    if not v_used_one then v_reserved:=1; elsif not v_used_two then v_reserved:=2; else raise exception using errcode='23514',message='P9_8_5_THIRD_NORMAL_BLOCKED'; end if;

  end if;

  insert into public.commercial_negotiation_concession_materializations (

    organization_id,store_id,commercial_opportunity_id,negotiation_cycle_id,concession_id,

    base_quote_id,base_quote_version_id,target_quote_id,target_quote_number,reserved_concession_number,

    operation_key,request_fingerprint,state

  ) values (

    p_organization_id,p_store_id,p_commercial_opportunity_id,v_concession.negotiation_cycle_id,v_concession.id,

    v_concession.quote_id,v_concession.quote_version_id,gen_random_uuid(),v_quote_number,v_reserved,

    v_operation_key,v_fingerprint,'prepared'

  ) returning id,operation_key,request_fingerprint,state,negotiation_cycle_id,base_quote_id,base_quote_version_id,target_quote_id,target_quote_number,reserved_concession_number

  into materialization_id,operation_key,request_fingerprint,state,negotiation_cycle_id,base_quote_id,base_quote_version_id,target_quote_id,target_quote_number,reserved_concession_number;

  replayed:=false; return next;

exception when unique_violation then

  select m.* into v_existing from public.commercial_negotiation_concession_materializations m

  where m.organization_id=p_organization_id and m.store_id=p_store_id and m.concession_id=p_concession_id for update;

  if not found or v_existing.request_fingerprint is distinct from v_fingerprint then raise; end if;

  return query select v_existing.id,v_existing.operation_key,v_existing.request_fingerprint,v_existing.state,v_existing.negotiation_cycle_id,v_existing.base_quote_id,v_existing.base_quote_version_id,v_existing.target_quote_id,v_existing.target_quote_number,v_existing.reserved_concession_number,true;

end;

$function$;



alter function public.prepare_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid) owner to postgres;

revoke all on function public.prepare_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid) from public,anon,authenticated;

grant execute on function public.prepare_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid) to service_role;



create or replace function public.materialize_commercial_negotiation_concession_target_quote_by_system(

  p_organization_id uuid,p_store_id uuid,p_commercial_opportunity_id uuid,p_materialization_id uuid

)

returns table (materialization_id uuid,target_quote_id uuid,target_quote_number text,replayed boolean)

language plpgsql security definer set search_path=pg_catalog,pg_temp,public,auth,extensions set row_security=off

as $function$

declare

  v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(auth.jwt()->>'role',''));

  v_m public.commercial_negotiation_concession_materializations%rowtype;

  v_c public.commercial_negotiation_concessions%rowtype;

  v_base public.sales_quotes%rowtype;

  v_target public.sales_quotes%rowtype;

  v_opportunity public.commercial_opportunities%rowtype;

  v_proposal record;

  v_item record;

  v_discount bigint;

  v_previous_price bigint;

  v_proposed_price bigint;

  v_remaining bigint;

  v_added bigint;

  v_subtotal bigint:=0;

  v_discount_total bigint:=0;

  v_total bigint:=0;

begin

  if v_role is distinct from 'service_role' and session_user<>'postgres' then raise exception using errcode='42501',message='P9_8_5_TARGET_WRITER_NOT_AUTHORIZED'; end if;

  select m.* into v_m from public.commercial_negotiation_concession_materializations m where m.id=p_materialization_id and m.organization_id=p_organization_id and m.store_id=p_store_id and m.commercial_opportunity_id=p_commercial_opportunity_id for update;

  if not found then raise exception using errcode='P0002',message='P9_8_5_MATERIALIZATION_NOT_FOUND'; end if;

  select c.* into v_c from public.commercial_negotiation_concessions c where c.id=v_m.concession_id and c.organization_id=p_organization_id and c.store_id=p_store_id and c.commercial_opportunity_id=p_commercial_opportunity_id for update;

  select q.* into v_base from public.sales_quotes q where q.id=v_m.base_quote_id and q.organization_id=p_organization_id and q.store_id=p_store_id and q.commercial_opportunity_id=p_commercial_opportunity_id for update;

  if not found or v_base.current_version_id is distinct from v_m.base_quote_version_id then raise exception using errcode='23514',message='P9_8_5_BASE_QUOTE_NOT_CURRENT'; end if;

  select o.* into v_opportunity from public.commercial_opportunities o where o.id=p_commercial_opportunity_id and o.organization_id=p_organization_id and o.store_id=p_store_id for update;

  if not found or v_opportunity.stage is distinct from 'negociacao' or v_c.status is distinct from 'authorized' or v_c.effective_decision is distinct from 'allowed' then

    perform public.supersede_commercial_negotiation_concession_materialization_by_system(p_organization_id,p_store_id,p_commercial_opportunity_id,p_materialization_id); return;

  end if;

  if not exists(select 1 from public.commercial_opportunity_lifecycle_events l where l.id=v_c.negotiation_cycle_id and l.organization_id=p_organization_id and l.store_id=p_store_id and l.commercial_opportunity_id=p_commercial_opportunity_id and l.lifecycle_cycle=v_opportunity.lifecycle_cycle and l.event_type='stage_transition' and l.new_stage='negociacao') then

    perform public.supersede_commercial_negotiation_concession_materialization_by_system(p_organization_id,p_store_id,p_commercial_opportunity_id,p_materialization_id); return;

  end if;

  select p.* into v_proposal from public.p9_resolve_current_commercial_proposal_internal(p_organization_id,p_store_id,p_commercial_opportunity_id) p;

  if not found or v_proposal.proposal_state is distinct from 'available' or v_proposal.current_quote_id is distinct from v_m.base_quote_id or v_proposal.current_quote_version_id is distinct from v_m.base_quote_version_id or v_proposal.lifecycle_cycle is distinct from v_opportunity.lifecycle_cycle or v_proposal.reason_code is distinct from 'current_proposal_authority_valid' then

    perform public.supersede_commercial_negotiation_concession_materialization_by_system(p_organization_id,p_store_id,p_commercial_opportunity_id,p_materialization_id); return;

  end if;

  if v_m.state in ('quote_created','version_created','send_queued','materialized') then

    select q.* into v_target from public.sales_quotes q where q.id=v_m.target_quote_id and q.organization_id=p_organization_id and q.store_id=p_store_id and q.commercial_opportunity_id=p_commercial_opportunity_id for update;

    if not found then raise exception using errcode='23514',message='P9_8_5_TARGET_QUOTE_MISSING_ON_REPLAY'; end if;

    if not exists (select 1 from public.sales_quote_items i where i.quote_id=v_target.id and i.organization_id=p_organization_id and i.store_id=p_store_id) then raise exception using errcode='23514',message='P9_8_5_TARGET_ITEMS_MISSING_ON_REPLAY'; end if;

    materialization_id:=v_m.id;target_quote_id:=v_target.id;target_quote_number:=v_target.quote_number;replayed:=true;return next;return;

  end if;

  if v_m.state is distinct from 'prepared' or v_c.status is distinct from 'authorized' or v_c.effective_decision is distinct from 'allowed' then raise exception using errcode='23514',message='P9_8_5_TARGET_WRITER_PRECONDITION_FAILED'; end if;

  begin

    v_previous_price:=(v_c.previous_condition->>'price_cents')::bigint;

    v_proposed_price:=(v_c.proposed_condition->>'price_cents')::bigint;

  exception when invalid_text_representation or numeric_value_out_of_range then

    raise exception using errcode='23514',message='P9_8_5_PRICE_SNAPSHOT_INVALID';

  end;

  v_discount:=v_c.requested_discount_cents;

  if v_previous_price is null or v_previous_price < 0 or v_proposed_price is null or v_proposed_price < 0 or v_proposed_price >= v_previous_price or v_previous_price is distinct from v_base.total_cents or v_discount is null or v_discount < 0 or v_discount is distinct from v_previous_price-v_proposed_price then raise exception using errcode='23514',message='P9_8_5_DISCOUNT_TRANSITION_INVALID'; end if;

  v_remaining:=v_discount;

  insert into public.sales_quotes (

    id,organization_id,store_id,commercial_opportunity_id,conversation_id,lead_id,quote_number,title,status,

    customer_name,customer_phone,customer_notes,internal_notes,payment_terms,delivery_terms,warranty_terms,valid_until,

    subtotal_cents,discount_cents,total_cents,current_version_id,metadata,creation_idempotency_key,creation_request_fingerprint

  ) values (

    v_m.target_quote_id,p_organization_id,p_store_id,p_commercial_opportunity_id,v_base.conversation_id,v_base.lead_id,v_m.target_quote_number,

    coalesce(v_base.title,'Orcamento')||' - Condicao negociada','pending_review',v_base.customer_name,v_base.customer_phone,v_base.customer_notes,v_base.internal_notes,v_base.payment_terms,v_base.delivery_terms,v_base.warranty_terms,v_base.valid_until,

    v_base.subtotal_cents,v_base.discount_cents+v_discount,v_proposed_price,

    null,jsonb_build_object('created_via','p9_8_5_negotiation_concession_materialization','negotiation_cycle_id',v_m.negotiation_cycle_id,'commercial_negotiation_concession_id',v_c.id,'commercial_negotiation_concession_materialization_id',v_m.id,'base_quote_id',v_m.base_quote_id,'base_quote_version_id',v_m.base_quote_version_id,'counterpart_snapshot',v_c.counterpart_snapshot),v_m.operation_key,v_m.request_fingerprint

  );

  for v_item in select * from public.sales_quote_items where quote_id=v_m.base_quote_id and organization_id=p_organization_id and store_id=p_store_id order by sort_order,id loop

    v_added:=least(greatest(coalesce(v_item.subtotal_cents,0)-coalesce(v_item.discount_cents,0),0),v_remaining);

    insert into public.sales_quote_items (quote_id,organization_id,store_id,commercial_opportunity_id,profile_component_id,pool_id,catalog_item_id,item_type,name,description,quantity,unit_price_cents,discount_cents,subtotal_cents,total_cents,sort_order,sku,metadata)

    values (v_m.target_quote_id,p_organization_id,p_store_id,p_commercial_opportunity_id,v_item.profile_component_id,v_item.pool_id,v_item.catalog_item_id,v_item.item_type,v_item.name,v_item.description,v_item.quantity,v_item.unit_price_cents,coalesce(v_item.discount_cents,0)+v_added,v_item.subtotal_cents,coalesce(v_item.subtotal_cents,0)-coalesce(v_item.discount_cents,0)-v_added,v_item.sort_order,v_item.sku,v_item.metadata);

    v_remaining:=v_remaining-v_added; v_subtotal:=v_subtotal+coalesce(v_item.subtotal_cents,0); v_discount_total:=v_discount_total+coalesce(v_item.discount_cents,0)+v_added; v_total:=v_total+coalesce(v_item.subtotal_cents,0)-coalesce(v_item.discount_cents,0)-v_added;

  end loop;

  if v_remaining<>0 or v_subtotal<>coalesce(v_base.subtotal_cents,0) or v_discount_total<>coalesce(v_base.discount_cents,0)+v_discount or v_total<>v_proposed_price then raise exception using errcode='23514',message='P9_8_5_TARGET_ITEM_TOTALS_INCOHERENT'; end if;

  update public.commercial_negotiation_concession_materializations set state='quote_created',updated_at=clock_timestamp() where id=v_m.id;

  materialization_id:=v_m.id;target_quote_id:=v_m.target_quote_id;target_quote_number:=v_m.target_quote_number;replayed:=false;return next;

end;

$function$;

alter function public.materialize_commercial_negotiation_concession_target_quote_by_system(uuid,uuid,uuid,uuid) owner to postgres;

revoke all on function public.materialize_commercial_negotiation_concession_target_quote_by_system(uuid,uuid,uuid,uuid) from public,anon,authenticated;

grant execute on function public.materialize_commercial_negotiation_concession_target_quote_by_system(uuid,uuid,uuid,uuid) to service_role;



create or replace function public.mark_commercial_negotiation_concession_materialization_quote_created_by_system(

  p_organization_id uuid,p_store_id uuid,p_commercial_opportunity_id uuid,p_materialization_id uuid,p_target_quote_id uuid

)

returns table (materialization_id uuid,state text,replayed boolean)

language plpgsql security definer set search_path=pg_catalog,pg_temp,public,auth,extensions set row_security=off

as $function$

declare v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(auth.jwt()->>'role','')); v_m public.commercial_negotiation_concession_materializations%rowtype;

begin

  if v_role is distinct from 'service_role' and session_user<>'postgres' then raise exception using errcode='42501',message='P9_8_5_QUOTE_MARK_NOT_AUTHORIZED'; end if;

  select m.* into v_m from public.commercial_negotiation_concession_materializations m where m.id=p_materialization_id and m.organization_id=p_organization_id and m.store_id=p_store_id and m.commercial_opportunity_id=p_commercial_opportunity_id for update;

  if not found or v_m.target_quote_id is distinct from p_target_quote_id then raise exception using errcode='23514',message='P9_8_5_TARGET_QUOTE_SCOPE_MISMATCH'; end if;

  if v_m.state='prepared' then update public.commercial_negotiation_concession_materializations set state='quote_created',updated_at=clock_timestamp() where id=v_m.id; replayed:=false; else replayed:=true; end if;

  materialization_id:=v_m.id; state:=case when v_m.state='prepared' then 'quote_created' else v_m.state end; return next;

end;

$function$;

alter function public.mark_commercial_negotiation_concession_materialization_quote_created_by_system(uuid,uuid,uuid,uuid,uuid) owner to postgres;

revoke all on function public.mark_commercial_negotiation_concession_materialization_quote_created_by_system(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;

grant execute on function public.mark_commercial_negotiation_concession_materialization_quote_created_by_system(uuid,uuid,uuid,uuid,uuid) to service_role;



create or replace function public.bind_commercial_negotiation_concession_materialization_version_by_system(

  p_organization_id uuid,p_store_id uuid,p_commercial_opportunity_id uuid,p_materialization_id uuid,p_target_quote_id uuid,p_target_quote_version_id uuid

)

returns table (materialization_id uuid,state text,target_quote_id uuid,target_quote_version_id uuid,replayed boolean)

language plpgsql security definer set search_path=pg_catalog,pg_temp,public,auth,extensions set row_security=off

as $function$

declare v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(auth.jwt()->>'role','')); v_m public.commercial_negotiation_concession_materializations%rowtype; v_q public.sales_quotes%rowtype; v_v public.sales_quote_versions%rowtype; v_c public.commercial_negotiation_concessions%rowtype; v_o public.commercial_opportunities%rowtype;

begin

  if v_role is distinct from 'service_role' and session_user<>'postgres' then raise exception using errcode='42501',message='P9_8_5_BIND_NOT_AUTHORIZED'; end if;

  select m.* into v_m from public.commercial_negotiation_concession_materializations m where m.id=p_materialization_id and m.organization_id=p_organization_id and m.store_id=p_store_id and m.commercial_opportunity_id=p_commercial_opportunity_id for update;

  if not found or v_m.target_quote_id is distinct from p_target_quote_id then raise exception using errcode='23514',message='P9_8_5_TARGET_QUOTE_SCOPE_MISMATCH'; end if;

  select c.* into v_c from public.commercial_negotiation_concessions c where c.id=v_m.concession_id and c.organization_id=p_organization_id and c.store_id=p_store_id and c.commercial_opportunity_id=p_commercial_opportunity_id for update;

  select o.* into v_o from public.commercial_opportunities o where o.id=p_commercial_opportunity_id and o.organization_id=p_organization_id and o.store_id=p_store_id for update;

  if v_m.state not in ('quote_created','version_created','send_queued') or v_c.status is distinct from 'authorized' or v_c.effective_decision is distinct from 'allowed' or v_o.stage is distinct from 'negociacao' then raise exception using errcode='23514',message='P9_8_5_BIND_AUTHORITY_STALE'; end if;

  if not exists(select 1 from public.commercial_opportunity_lifecycle_events l where l.id=v_c.negotiation_cycle_id and l.organization_id=p_organization_id and l.store_id=p_store_id and l.commercial_opportunity_id=p_commercial_opportunity_id and l.lifecycle_cycle=v_o.lifecycle_cycle and l.event_type='stage_transition' and l.new_stage='negociacao') then raise exception using errcode='23514',message='P9_8_5_BIND_CYCLE_STALE'; end if;

  if v_m.target_quote_version_id is not null then

    if v_m.target_quote_version_id is distinct from p_target_quote_version_id then raise exception using errcode='23505',message='P9_8_5_TARGET_VERSION_DIVERGENT'; end if;

    materialization_id:=v_m.id;state:=v_m.state;target_quote_id:=v_m.target_quote_id;target_quote_version_id:=v_m.target_quote_version_id;replayed:=true;return next;return;

  end if;

  select q.* into v_q from public.sales_quotes q where q.id=p_target_quote_id and q.organization_id=p_organization_id and q.store_id=p_store_id and q.commercial_opportunity_id=p_commercial_opportunity_id for update;

  select v.* into v_v from public.sales_quote_versions v where v.id=p_target_quote_version_id and v.quote_id=p_target_quote_id and v.organization_id=p_organization_id and v.store_id=p_store_id for update;

  if not found or v_q.id is null then raise exception using errcode='23514',message='P9_8_5_TARGET_QUOTE_INVALID'; end if;

  if v_v.id is null or v_v.version_number is distinct from 1 or v_v.status not in ('generated','pending_review') or v_v.sent_at is not null then raise exception using errcode='23514',message='P9_8_5_TARGET_VERSION_INVALID'; end if;

  update public.commercial_negotiation_concession_materializations set target_quote_version_id=p_target_quote_version_id,state='version_created',updated_at=clock_timestamp() where id=v_m.id;

  materialization_id:=v_m.id;state:='version_created';target_quote_id:=v_m.target_quote_id;target_quote_version_id:=p_target_quote_version_id;replayed:=false;return next;

end;

$function$;

alter function public.bind_commercial_negotiation_concession_materialization_version_by_system(uuid,uuid,uuid,uuid,uuid,uuid) owner to postgres;

revoke all on function public.bind_commercial_negotiation_concession_materialization_version_by_system(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;

grant execute on function public.bind_commercial_negotiation_concession_materialization_version_by_system(uuid,uuid,uuid,uuid,uuid,uuid) to service_role;



create or replace function public.materialize_commercial_negotiation_concession_send_by_system(

  p_organization_id uuid,p_store_id uuid,p_commercial_opportunity_id uuid,p_materialization_id uuid,p_conversation_id uuid,

  p_target_quote_id uuid,p_target_quote_version_id uuid,p_message_content text,p_message_metadata jsonb

)

returns table (message_id uuid,outbound_idempotency_key text,outbound_delivery_state text,commercial_opportunity_id uuid,sales_quote_id uuid,sales_quote_version_id uuid,external_message_id text,outcome text)

language plpgsql security definer set search_path=pg_catalog,pg_temp,public,auth,extensions set row_security=off

as $function$

declare v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(auth.jwt()->>'role','')); v_m public.commercial_negotiation_concession_materializations%rowtype; v_c public.commercial_negotiation_concessions%rowtype; v_o public.commercial_opportunities%rowtype; v_target_q public.sales_quotes%rowtype; v_target_v public.sales_quote_versions%rowtype; v_result record; v_message public.messages%rowtype; v_key text;

begin

  if v_role is distinct from 'service_role' and session_user<>'postgres' then raise exception using errcode='42501',message='P9_8_5_SEND_NOT_AUTHORIZED'; end if;

  select m.* into v_m from public.commercial_negotiation_concession_materializations m where m.id=p_materialization_id and m.organization_id=p_organization_id and m.store_id=p_store_id and m.commercial_opportunity_id=p_commercial_opportunity_id for update;

  if not found or v_m.target_quote_id is distinct from p_target_quote_id or v_m.target_quote_version_id is distinct from p_target_quote_version_id or v_m.state not in ('version_created','send_queued') then raise exception using errcode='23514',message='P9_8_5_MATERIALIZATION_NOT_SENDABLE'; end if;

  select c.* into v_c from public.commercial_negotiation_concessions c where c.id=v_m.concession_id and c.organization_id=p_organization_id and c.store_id=p_store_id and c.commercial_opportunity_id=p_commercial_opportunity_id for update;

  select o.* into v_o from public.commercial_opportunities o where o.id=p_commercial_opportunity_id and o.organization_id=p_organization_id and o.store_id=p_store_id for update;

  if not found or v_o.stage is distinct from 'negociacao' or v_c.status is distinct from 'authorized' or v_c.effective_decision is distinct from 'allowed' then raise exception using errcode='23514',message='P9_8_5_SEND_AUTHORITY_INVALID'; end if;

  if v_c.concession_class='human_exception' and (v_c.approval_status is distinct from 'approved' or v_c.approval_actor_user_id is null or v_c.approval_decided_at is null) then raise exception using errcode='23514',message='P9_8_5_HUMAN_EXCEPTION_APPROVAL_REQUIRED'; end if;

  if v_c.concession_class='normal' and v_m.reserved_concession_number not in (1,2) then raise exception using errcode='23514',message='P9_8_5_ORDINAL_RESERVATION_MISSING'; end if;

  if not exists (select 1 from public.commercial_opportunity_lifecycle_events l where l.id=v_c.negotiation_cycle_id and l.organization_id=p_organization_id and l.store_id=p_store_id and l.commercial_opportunity_id=p_commercial_opportunity_id and l.lifecycle_cycle=v_o.lifecycle_cycle and l.event_type='stage_transition' and l.new_stage='negociacao') then raise exception using errcode='23514',message='P9_8_5_SEND_CYCLE_STALE'; end if;

  select q.* into v_target_q from public.sales_quotes q where q.id=p_target_quote_id and q.organization_id=p_organization_id and q.store_id=p_store_id and q.commercial_opportunity_id=p_commercial_opportunity_id for update;

  select v.* into v_target_v from public.sales_quote_versions v where v.id=p_target_quote_version_id and v.quote_id=p_target_quote_id and v.organization_id=p_organization_id and v.store_id=p_store_id for update;

  if v_target_q.id is null or v_target_q.current_version_id is distinct from p_target_quote_version_id or v_target_v.id is null or v_target_v.version_number is distinct from 1 or v_target_v.sent_at is not null then raise exception using errcode='23514',message='P9_8_5_TARGET_VERSION_NOT_CURRENT'; end if;

  if p_message_metadata ? 'commercial_negotiation_concession_id' and p_message_metadata->>'commercial_negotiation_concession_id' is distinct from v_c.id::text then raise exception using errcode='23514',message='P9_8_5_CONCESSION_METADATA_MISMATCH'; end if;

  if p_message_metadata ? 'commercial_negotiation_concession_materialization_id' and p_message_metadata->>'commercial_negotiation_concession_materialization_id' is distinct from v_m.id::text then raise exception using errcode='23514',message='P9_8_5_MATERIALIZATION_METADATA_MISMATCH'; end if;

  v_key:='sales_quote_send:'||p_organization_id::text||':'||p_store_id::text||':'||p_commercial_opportunity_id::text||':'||p_target_quote_id::text||':'||p_target_quote_version_id::text;

  select * into v_result from public.materialize_sales_quote_send_by_system(

    p_organization_id,p_store_id,p_commercial_opportunity_id,p_conversation_id,p_target_quote_id,p_target_quote_version_id,

    p_message_content,coalesce(p_message_metadata,'{}'::jsonb)||jsonb_build_object(

      'commercial_negotiation_concession_id',v_c.id,

      'commercial_negotiation_concession_materialization_id',v_m.id,

      'commercial_negotiation_concession_operation_key',v_m.operation_key

    ),v_key,'sales_quote_send_route');

  select msg.* into v_message from public.messages msg where msg.id=v_result.message_id and msg.organization_id=p_organization_id and msg.store_id=p_store_id for update;

  if not found or v_message.conversation_id is distinct from p_conversation_id or v_message.outbound_idempotency_key is distinct from v_key or v_message.metadata->>'commercial_negotiation_concession_id' is distinct from v_c.id::text or v_message.metadata->>'commercial_negotiation_concession_materialization_id' is distinct from v_m.id::text or v_message.metadata->>'sales_quote_id' is distinct from p_target_quote_id::text or v_message.metadata->>'sales_quote_version_id' is distinct from p_target_quote_version_id::text then raise exception using errcode='23514',message='P9_8_5_SEND_MESSAGE_SCOPE_MISMATCH'; end if;

  update public.commercial_negotiation_concession_materializations set state='send_queued',outbound_message_id=v_result.message_id,updated_at=clock_timestamp() where id=v_m.id and state='version_created';

  return query select v_result.message_id,v_result.outbound_idempotency_key,v_result.outbound_delivery_state,v_result.commercial_opportunity_id,v_result.sales_quote_id,v_result.sales_quote_version_id,v_result.external_message_id,v_result.outcome;

end;

$function$;

alter function public.materialize_commercial_negotiation_concession_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) owner to postgres;

revoke all on function public.materialize_commercial_negotiation_concession_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;

grant execute on function public.materialize_commercial_negotiation_concession_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;



create or replace function public.finalize_commercial_negotiation_concession_materialization_by_system(

  p_organization_id uuid,p_store_id uuid,p_commercial_opportunity_id uuid,p_materialization_id uuid,p_message_id uuid,p_target_quote_id uuid,p_target_quote_version_id uuid

)

returns table (materialization_id uuid,state text,concession_id uuid,reserved_concession_number integer,materialized_at timestamptz,replayed boolean)

language plpgsql security definer set search_path=pg_catalog,pg_temp,public,auth,extensions set row_security=off

as $function$

declare v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(auth.jwt()->>'role','')); v_m public.commercial_negotiation_concession_materializations%rowtype; v_c public.commercial_negotiation_concessions%rowtype; v_o public.commercial_opportunities%rowtype; v_q public.sales_quotes%rowtype; v_v public.sales_quote_versions%rowtype; v_msg public.messages%rowtype; v_projection record; v_now timestamptz;

begin

  if v_role is distinct from 'service_role' and session_user<>'postgres' then raise exception using errcode='42501',message='P9_8_5_FINALIZE_NOT_AUTHORIZED'; end if;

  select m.* into v_m from public.commercial_negotiation_concession_materializations m where m.id=p_materialization_id and m.organization_id=p_organization_id and m.store_id=p_store_id and m.commercial_opportunity_id=p_commercial_opportunity_id for update;

  if not found or v_m.target_quote_id is distinct from p_target_quote_id or v_m.target_quote_version_id is distinct from p_target_quote_version_id then raise exception using errcode='23514',message='P9_8_5_FINALIZE_SCOPE_MISMATCH'; end if;

  if v_m.state='materialized' then materialization_id:=v_m.id;state:=v_m.state;concession_id:=v_m.concession_id;reserved_concession_number:=v_m.reserved_concession_number;materialized_at:=v_m.materialized_at;replayed:=true;return next;return; end if;

  select c.* into v_c from public.commercial_negotiation_concessions c where c.id=v_m.concession_id and c.organization_id=p_organization_id and c.store_id=p_store_id and c.commercial_opportunity_id=p_commercial_opportunity_id for update;

  select o.* into v_o from public.commercial_opportunities o where o.id=p_commercial_opportunity_id and o.organization_id=p_organization_id and o.store_id=p_store_id for update;

  select q.* into v_q from public.sales_quotes q where q.id=p_target_quote_id and q.organization_id=p_organization_id and q.store_id=p_store_id and q.commercial_opportunity_id=p_commercial_opportunity_id for update;

  select v.* into v_v from public.sales_quote_versions v where v.id=p_target_quote_version_id and v.quote_id=p_target_quote_id and v.organization_id=p_organization_id and v.store_id=p_store_id for update;

  select m.* into v_msg from public.messages m where m.id=p_message_id and m.organization_id=p_organization_id and m.store_id=p_store_id for update;

  if v_msg.id is null or v_msg.external_message_id is null or v_msg.outbound_provider_accepted_at is null or v_msg.outbound_delivery_state is distinct from 'sent' then raise exception using errcode='23514',message='P9_8_5_PROVIDER_EVIDENCE_REQUIRED'; end if;

  if v_m.state is distinct from 'send_queued' or v_m.outbound_message_id is distinct from v_msg.id then raise exception using errcode='23514',message='P9_8_5_MATERIALIZATION_MESSAGE_STATE_MISMATCH'; end if;

  if v_msg.metadata->>'commercial_negotiation_concession_materialization_id' is distinct from v_m.id::text or v_msg.metadata->>'commercial_negotiation_concession_id' is distinct from v_c.id::text then raise exception using errcode='23514',message='P9_8_5_MESSAGE_SCOPE_MISMATCH'; end if;

  if v_o.id is null or v_o.stage is distinct from 'negociacao' or v_c.id is null or v_c.status is distinct from 'authorized' or v_c.effective_decision is distinct from 'allowed' or v_v.id is null or v_v.sent_at is null or v_v.status not in ('sent','superseded') or v_q.id is null or v_q.current_version_id is distinct from v_v.id then raise exception using errcode='23514',message='P9_8_5_FINALIZE_PRECONDITION_FAILED'; end if;

  if v_c.concession_class='human_exception' and (v_c.approval_status is distinct from 'approved' or v_c.approval_actor_user_id is null or v_c.approval_decided_at is null) then raise exception using errcode='23514',message='P9_8_5_HUMAN_EXCEPTION_APPROVAL_REQUIRED'; end if;

  if v_c.concession_class='normal' and v_m.reserved_concession_number not in (1,2) then raise exception using errcode='23514',message='P9_8_5_ORDINAL_RESERVATION_MISSING'; end if;

  if not exists (select 1 from public.commercial_opportunity_lifecycle_events l where l.id=v_c.negotiation_cycle_id and l.organization_id=p_organization_id and l.store_id=p_store_id and l.commercial_opportunity_id=p_commercial_opportunity_id and l.lifecycle_cycle=v_o.lifecycle_cycle and l.event_type='stage_transition' and l.new_stage='negociacao') then raise exception using errcode='23514',message='P9_8_5_FINALIZE_CYCLE_STALE'; end if;

  select * into v_projection from public.p9_resolve_current_commercial_proposal_internal(p_organization_id,p_store_id,p_commercial_opportunity_id) limit 1;

  if not found or v_projection.proposal_state is distinct from 'available' or v_projection.current_quote_id is distinct from v_q.id or v_projection.current_quote_version_id is distinct from v_v.id or v_projection.lifecycle_cycle is distinct from v_o.lifecycle_cycle or v_projection.reason_code is distinct from 'current_proposal_authority_valid' then raise exception using errcode='23514',message='P9_8_5_CURRENT_PROPOSAL_FINALIZE_REQUIRED'; end if;

  if v_c.concession_class='normal' and v_m.reserved_concession_number is null then raise exception using errcode='23514',message='P9_8_5_ORDINAL_RESERVATION_MISSING'; end if;

  v_now:=clock_timestamp();

  update public.commercial_negotiation_concessions set status='materialized',concession_number=case when concession_class='normal' then v_m.reserved_concession_number else null end,materialized_at=v_now,updated_at=v_now where id=v_c.id and status='authorized';

  if not found then raise exception using errcode='40001',message='P9_8_5_CONCESSION_TRANSITION_LOST'; end if;

  update public.commercial_negotiation_concession_materializations set state='materialized',outbound_message_id=p_message_id,materialized_at=v_now,updated_at=v_now where id=v_m.id;

  materialization_id:=v_m.id;state:='materialized';concession_id:=v_m.concession_id;reserved_concession_number:=v_m.reserved_concession_number;materialized_at:=v_now;replayed:=false;return next;

end;

$function$;

alter function public.finalize_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid) owner to postgres;

revoke all on function public.finalize_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;

grant execute on function public.finalize_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid) to service_role;



create or replace function public.p9_8_5_finalize_concession_after_quote_send_trigger()

returns trigger

language plpgsql

security definer

set search_path=pg_catalog,pg_temp,public,auth,extensions

set row_security=off

as $function$

declare

  v_concession_id uuid := nullif(new.metadata->>'commercial_negotiation_concession_id','')::uuid;

  v_materialization_id uuid := nullif(new.metadata->>'commercial_negotiation_concession_materialization_id','')::uuid;

  v_result record;

begin

  if old.outbound_commercial_finalized_at is null

     and new.outbound_commercial_finalized_at is not null

     and v_concession_id is not null

     and v_materialization_id is not null then

    select * into v_result from public.finalize_commercial_negotiation_concession_materialization_by_system(

      new.organization_id,new.store_id,(new.metadata->>'commercial_opportunity_id')::uuid,v_materialization_id,new.id,

      (new.metadata->>'sales_quote_id')::uuid,(new.metadata->>'sales_quote_version_id')::uuid

    );

  end if;

  return new;

end;

$function$;

alter function public.p9_8_5_finalize_concession_after_quote_send_trigger() owner to postgres;

revoke all on function public.p9_8_5_finalize_concession_after_quote_send_trigger() from public,anon,authenticated,service_role;



drop trigger if exists p9_8_5_finalize_concession_after_quote_send on public.messages;

create constraint trigger p9_8_5_finalize_concession_after_quote_send

after update of outbound_commercial_finalized_at on public.messages

deferrable initially immediate

for each row

when (old.outbound_commercial_finalized_at is null and new.outbound_commercial_finalized_at is not null)

execute function public.p9_8_5_finalize_concession_after_quote_send_trigger();



create or replace function public.p9_8_5_validate_specialized_quote_send_authority(

  p_organization_id uuid,p_store_id uuid,p_message_id uuid,p_quote_id uuid,p_version_id uuid,p_opportunity_id uuid

)

returns void language plpgsql security definer

set search_path=pg_catalog,pg_temp,public,auth,extensions set row_security=off

as $function$

declare

  v_message public.messages%rowtype;

  v_m public.commercial_negotiation_concession_materializations%rowtype;

  v_c public.commercial_negotiation_concessions%rowtype;

  v_o public.commercial_opportunities%rowtype;

  v_q public.sales_quotes%rowtype;

  v_v public.sales_quote_versions%rowtype;

  v_mid uuid;

  v_cid uuid;

begin

  select * into v_message from public.messages where id=p_message_id and organization_id=p_organization_id and store_id=p_store_id for update;

  v_mid:=nullif(v_message.metadata->>'commercial_negotiation_concession_materialization_id','')::uuid;

  v_cid:=nullif(v_message.metadata->>'commercial_negotiation_concession_id','')::uuid;

  if not found or v_mid is null or v_cid is null then raise exception using errcode='23514',message='P9_8_5_SPECIALIZED_AUTHORITY_METADATA_REQUIRED'; end if;

  select * into v_m from public.commercial_negotiation_concession_materializations where id=v_mid and organization_id=p_organization_id and store_id=p_store_id and commercial_opportunity_id=p_opportunity_id for update;

  select * into v_c from public.commercial_negotiation_concessions where id=v_cid and organization_id=p_organization_id and store_id=p_store_id and commercial_opportunity_id=p_opportunity_id for update;

  select * into v_o from public.commercial_opportunities where id=p_opportunity_id and organization_id=p_organization_id and store_id=p_store_id for update;

  select * into v_q from public.sales_quotes where id=p_quote_id and organization_id=p_organization_id and store_id=p_store_id and commercial_opportunity_id=p_opportunity_id for update;

  select * into v_v from public.sales_quote_versions where id=p_version_id and quote_id=p_quote_id and organization_id=p_organization_id and store_id=p_store_id for update;

  if v_m.id is null or v_c.id is null or v_o.id is null or v_q.id is null or v_v.id is null then raise exception using errcode='23514',message='P9_8_5_SPECIALIZED_AUTHORITY_SCOPE_MISMATCH'; end if;

  if v_m.state not in ('version_created','send_queued') or v_m.target_quote_id is distinct from p_quote_id or v_m.target_quote_version_id is distinct from p_version_id or (v_m.outbound_message_id is not null and v_m.outbound_message_id is distinct from p_message_id) then raise exception using errcode='23514',message='P9_8_5_SPECIALIZED_AUTHORITY_STATE_INVALID'; end if;

  if v_c.id is distinct from v_m.concession_id
     or v_c.status is distinct from 'authorized'
     or v_c.effective_decision is distinct from 'allowed'
     or v_o.stage is distinct from 'negociacao'
     or v_q.current_version_id is distinct from p_version_id
     or pg_catalog.lower(pg_catalog.btrim(coalesce(v_q.status, ''))) is distinct from 'pending_review'
     or v_q.sent_at is not null
     or v_q.approved_at is not null
     or v_q.approved_by is not null
     or v_v.version_number is distinct from 1
     or pg_catalog.lower(pg_catalog.btrim(coalesce(v_v.status, ''))) not in ('generated','pending_review')
     or v_v.sent_at is not null then
    raise exception using errcode='23514',message='P9_8_5_SPECIALIZED_AUTHORITY_PRECONDITION_FAILED';
  end if;

  if not exists(select 1 from public.commercial_opportunity_lifecycle_events l where l.id=v_c.negotiation_cycle_id and l.organization_id=p_organization_id and l.store_id=p_store_id and l.commercial_opportunity_id=p_opportunity_id and l.lifecycle_cycle=v_o.lifecycle_cycle and l.event_type='stage_transition' and l.new_stage='negociacao') then raise exception using errcode='23514',message='P9_8_5_SPECIALIZED_AUTHORITY_CYCLE_STALE'; end if;

  if v_c.concession_class='normal' and v_m.reserved_concession_number not in (1,2) then raise exception using errcode='23514',message='P9_8_5_SPECIALIZED_AUTHORITY_ORDINAL_INVALID'; end if;

  if v_c.concession_class='human_exception' and (v_c.approval_status is distinct from 'approved' or v_c.approval_actor_user_id is null or v_c.approval_decided_at is null) then raise exception using errcode='23514',message='P9_8_5_SPECIALIZED_AUTHORITY_APPROVAL_REQUIRED'; end if;

  if v_message.metadata->>'sales_quote_id' is distinct from p_quote_id::text or v_message.metadata->>'sales_quote_version_id' is distinct from p_version_id::text or v_message.metadata->>'commercial_opportunity_id' is distinct from p_opportunity_id::text or v_message.outbound_idempotency_key is distinct from ('sales_quote_send:'||p_organization_id::text||':'||p_store_id::text||':'||p_opportunity_id::text||':'||p_quote_id::text||':'||p_version_id::text) then raise exception using errcode='23514',message='P9_8_5_SPECIALIZED_AUTHORITY_MESSAGE_IDENTITY_INVALID'; end if;

end;

$function$;

alter function public.p9_8_5_validate_specialized_quote_send_authority(uuid,uuid,uuid,uuid,uuid,uuid) owner to postgres;

revoke all on function public.p9_8_5_validate_specialized_quote_send_authority(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;



CREATE OR REPLACE FUNCTION public.validate_or_cancel_whatsapp_external_send_v2_by_system(p_organization_id uuid, p_store_id uuid, p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp', 'public'
 SET row_security TO 'off'
AS $function$
declare
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );

  v_message public.messages%rowtype;
  v_fresh_message public.messages%rowtype;
  v_quote public.sales_quotes%rowtype;
  v_version public.sales_quote_versions%rowtype;
  v_quote_kind_readiness record;

  v_outbound_origin text;
  v_source text;
  v_quote_id uuid;
  v_version_id uuid;
  v_opportunity_id uuid;
  v_expected_key text;
  v_block_reason text;
  v_delegate_result jsonb;
  v_specialized boolean := false;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'whatsapp external send v2 gate is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_message_id is null then
    raise exception using
      errcode = '22023',
      message = 'WHATSAPP_EXTERNAL_SEND_V2_GATE_ARGUMENTS_REQUIRED';
  end if;

  -- Initial identity read. No quote lock is taken until we know this is a
  -- sales_quote_send operation and can resolve its exact quote id.
  select message_row.*
    into v_message
    from public.messages message_row
   where message_row.id = p_message_id
     and message_row.organization_id = p_organization_id
     and message_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'WHATSAPP_EXTERNAL_SEND_V2_GATE_MESSAGE_NOT_FOUND';
  end if;

  v_outbound_origin :=
    nullif(pg_catalog.btrim(coalesce(v_message.metadata ->> 'outbound_origin', '')), '');
  v_source :=
    nullif(pg_catalog.btrim(coalesce(v_message.metadata ->> 'source', '')), '');

  -- Preserve every non-quote transport path exactly as before.
  if v_outbound_origin is distinct from 'sales_quote_send' then
    return public.validate_or_cancel_whatsapp_external_send_by_system(
      p_organization_id,
      p_store_id,
      p_message_id
    );
  end if;

  begin
    v_quote_id :=
      nullif(v_message.metadata ->> 'sales_quote_id', '')::uuid;
    v_version_id :=
      nullif(v_message.metadata ->> 'sales_quote_version_id', '')::uuid;
    v_opportunity_id :=
      nullif(v_message.metadata ->> 'commercial_opportunity_id', '')::uuid;
  exception
    when invalid_text_representation then
      v_block_reason := 'sales_quote_send_identity_invalid';
  end;

  if v_block_reason is null
     and (
       v_source is distinct from 'sales_quote_send_route'
       or v_quote_id is null
       or v_version_id is null
       or v_opportunity_id is null
     ) then
    v_block_reason := 'sales_quote_send_identity_required';
  end if;

  if v_block_reason is null then
    v_expected_key :=
      'sales_quote_send:'
      || p_organization_id::text || ':'
      || p_store_id::text || ':'
      || v_opportunity_id::text || ':'
      || v_quote_id::text || ':'
      || v_version_id::text;

    if v_message.outbound_idempotency_key is distinct from v_expected_key
       or coalesce(v_message.metadata ->> 'outbound_idempotency_key', '')
            is distinct from v_expected_key then
      v_block_reason := 'sales_quote_send_idempotency_identity_mismatch';
    end if;
  end if;

  /*
   * Serialize this exact outbound operation with the same deterministic
   * advisory key used by canonical sales_quote_send materialization.
   *
   * The initial message read above is identity discovery only. No external
   * authorization depends on that unlocked snapshot.
   */
  if v_block_reason is null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_expected_key, 0)
    );
  end if;

  -- Quote lock is the serialization point shared with version creation.
  if v_block_reason is null then
    select quote_row.*
      into v_quote
      from public.sales_quotes quote_row
     where quote_row.id = v_quote_id
       and quote_row.organization_id = p_organization_id
       and quote_row.store_id = p_store_id
       and quote_row.commercial_opportunity_id = v_opportunity_id
     for update;

    if not found then
      v_block_reason := 'sales_quote_send_quote_scope_mismatch';
    end if;
  end if;

  /*
   * Keep the same quote -> version ordering already used by canonical
   * quote materialization. The version remains locked through the final
   * provider authorization boundary.
   */
  if v_block_reason is null then
    select version_row.*
      into v_version
      from public.sales_quote_versions version_row
     where version_row.id = v_version_id
       and version_row.quote_id = v_quote_id
       and version_row.organization_id = p_organization_id
       and version_row.store_id = p_store_id
     for update;

    if not found then
      v_block_reason := 'sales_quote_send_version_scope_mismatch';
    end if;
  end if;

  /*
   * insert_message and the canonical WhatsApp transport contract serialize
   * conversation mutations with this xact lock. Take it before the message
   * row lock so this wrapper does not invert conversation -> message ordering
   * when it delegates to the existing final transport gate.
   */
  if v_block_reason is null then
    perform public.private_acquire_sales_contract_conversation_xact_lock(
      v_quote.conversation_id
    );
  end if;

  -- Fresh message authority after quote/version/conversation locks are held.
  if v_block_reason is null then
    select message_row.*
      into v_fresh_message
      from public.messages message_row
     where message_row.id = p_message_id
       and message_row.organization_id = p_organization_id
       and message_row.store_id = p_store_id
     for update;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'WHATSAPP_EXTERNAL_SEND_V2_GATE_MESSAGE_DISAPPEARED';
    end if;

    if coalesce(v_fresh_message.metadata ->> 'outbound_origin', '')
          is distinct from 'sales_quote_send'
       or coalesce(v_fresh_message.metadata ->> 'source', '')
          is distinct from 'sales_quote_send_route'
       or coalesce(v_fresh_message.metadata ->> 'sales_quote_id', '')
          is distinct from v_quote_id::text
       or coalesce(v_fresh_message.metadata ->> 'sales_quote_version_id', '')
          is distinct from v_version_id::text
       or coalesce(v_fresh_message.metadata ->> 'commercial_opportunity_id', '')
          is distinct from v_opportunity_id::text
       or v_fresh_message.outbound_idempotency_key is distinct from v_expected_key
       or coalesce(v_fresh_message.metadata ->> 'outbound_idempotency_key', '')
          is distinct from v_expected_key
       or v_fresh_message.sender is distinct from 'human'
       or v_fresh_message.direction is distinct from 'outgoing'
       or pg_catalog.lower(
            pg_catalog.btrim(coalesce(v_fresh_message.message_type, ''))
          ) is distinct from 'document'
       or coalesce(v_fresh_message.metadata ->> 'send_external', 'false')
          is distinct from 'true'
       or coalesce(v_fresh_message.metadata ->> 'external_channel', '')
          is distinct from 'whatsapp'
       or coalesce(v_fresh_message.outbound_delivery_state, '')
          is distinct from 'processing'
       or v_fresh_message.outbound_attempt_started_at is not null
       or v_fresh_message.external_message_id is not null
       or v_fresh_message.deleted_at is not null then
      v_block_reason := 'sales_quote_send_message_authority_changed';
    end if;
  end if;

  if v_block_reason is null then
    if (v_fresh_message.metadata ? 'commercial_negotiation_concession_id')
         is distinct from
       (v_fresh_message.metadata ? 'commercial_negotiation_concession_materialization_id') then
      v_block_reason := 'sales_quote_send_specialized_identity_incomplete';
    else
      v_specialized :=
        v_fresh_message.metadata ? 'commercial_negotiation_concession_id'
        and v_fresh_message.metadata ? 'commercial_negotiation_concession_materialization_id';

      if v_specialized then
        perform public.p9_8_5_validate_specialized_quote_send_authority(
          p_organization_id,
          p_store_id,
          p_message_id,
          v_quote_id,
          v_version_id,
          v_opportunity_id
        );
      end if;
    end if;
  end if;

  if v_block_reason is null then
    if v_quote.conversation_id is distinct from v_fresh_message.conversation_id then
      v_block_reason := 'sales_quote_send_conversation_scope_mismatch';
    elsif v_quote.current_version_id is distinct from v_version_id then
      v_block_reason := 'sales_quote_send_version_stale';
    elsif v_quote.sent_at is not null then
      v_block_reason := 'sales_quote_send_quote_not_approved';
    elsif not v_specialized
       and (
         pg_catalog.lower(pg_catalog.btrim(coalesce(v_quote.status, '')))
           is distinct from 'approved'
         or v_quote.approved_at is null
         or v_quote.approved_by is null
       ) then
      v_block_reason := 'sales_quote_send_quote_not_approved';
    end if;
  end if;

  if v_block_reason is null then
    if v_version.sent_at is not null then
      v_block_reason := 'sales_quote_send_version_not_approved';
    elsif not v_specialized
       and pg_catalog.lower(pg_catalog.btrim(coalesce(v_version.status, '')))
             is distinct from 'approved' then
      v_block_reason := 'sales_quote_send_version_not_approved';
    elsif v_specialized
       and pg_catalog.lower(pg_catalog.btrim(coalesce(v_version.status, '')))
             not in ('generated', 'pending_review') then
      v_block_reason := 'sales_quote_send_version_not_approved';
    elsif public.sales_quote_version_is_expired(
      v_version.quote_snapshot,
      v_quote.valid_until,
      (now() at time zone 'UTC')::date
    ) then
      v_block_reason := 'sales_quote_send_version_expired';
    end if;
  end if;
  /*
   * Explicit preliminary/definitive quote kinds depend on mutable commercial
   * authority (especially technical-visit state). The HTTP route checks this
   * before materialization, but queue delay means that result cannot authorize
   * the later provider POST.
   *
   * Re-read the canonical authority while the quote/version locks are held.
   * Legacy quote_kind values remain compatible with the existing contract.
   *
   * Infrastructure/reader errors intentionally propagate. They are technical
   * pre-attempt failures, so the worker releases the claim instead of
   * terminally consuming the outbound operation.
   */
  if v_block_reason is null
     and pg_catalog.lower(pg_catalog.btrim(coalesce(v_version.quote_kind, '')))
           in ('preliminary', 'definitive') then

    select readiness_row.*
      into v_quote_kind_readiness
      from public.read_quote_kind_send_readiness_scoped(
        p_organization_id,
        p_store_id,
        v_opportunity_id,
        v_version_id
      ) readiness_row;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'SALES_QUOTE_SEND_QUOTE_KIND_READINESS_EMPTY';
    end if;

    if pg_catalog.lower(
         pg_catalog.btrim(
           coalesce(v_quote_kind_readiness.readiness_state, '')
         )
       ) is distinct from 'ready' then
      v_block_reason := 'sales_quote_send_quote_kind_not_ready';
    end if;
  end if;

  if v_block_reason is not null then
    update public.messages message_row
       set outbound_delivery_state = 'failed',
           outbound_claimed_at = null,
           outbound_claimed_by = null,
           outbound_attempt_started_at = null,
           outbound_uncertain_at = null,
           outbound_error_text =
             ('ZION_EXTERNAL_SEND_BLOCKED:' || v_block_reason)::text
     where message_row.id = p_message_id
       and message_row.organization_id = p_organization_id
       and message_row.store_id = p_store_id
       and message_row.outbound_delivery_state = 'processing'
       and message_row.outbound_attempt_started_at is null
       and message_row.external_message_id is null;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'WHATSAPP_EXTERNAL_SEND_V2_GATE_BLOCK_TRANSITION_LOST';
    end if;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'decision', 'blocked',
      'reason', v_block_reason,
      'message_id', p_message_id,
      'conversation_id', v_message.conversation_id,
      'outbound_origin', 'sales_quote_send',
      'sales_quote_id', v_quote_id,
      'sales_quote_version_id', v_version_id
    );
  end if;

  /*
   * IMPORTANT:
   * The quote row lock is still held here.
   *
   * The existing canonical transport gate atomically moves:
   *
   *     processing -> uncertain
   *
   * before returning to Node. Therefore version creation cannot pass the
   * trigger above between this quote check and the persisted attempt start.
   */
  v_delegate_result :=
    public.validate_or_cancel_whatsapp_external_send_by_system(
      p_organization_id,
      p_store_id,
      p_message_id
    );

  return v_delegate_result;
end;
$function$;

alter function public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)
  owner to postgres;

revoke all on function public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)
  to service_role;


do $postconditions$

begin

  if not exists (select 1 from pg_class where oid='public.commercial_negotiation_concession_materializations'::regclass and relrowsecurity and relforcerowsecurity)

     or has_table_privilege('service_role','public.commercial_negotiation_concession_materializations','INSERT')

     or to_regprocedure('public.prepare_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid)') is null

     or to_regprocedure('public.finalize_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid)') is null

     or to_regprocedure('public.supersede_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid)') is null

     or to_regprocedure('public.p9_8_5_finalize_concession_after_quote_send_trigger()') is null

     or to_regprocedure('public.p9_8_5_validate_specialized_quote_send_authority(uuid,uuid,uuid,uuid,uuid,uuid)') is null

     or to_regprocedure('public.materialize_commercial_negotiation_concession_target_quote_by_system(uuid,uuid,uuid,uuid)') is null

     or to_regclass('public.p9_8_5_materialization_active_ordinal_uq') is null

     or has_function_privilege('service_role','public.prepare_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid)','EXECUTE') is not true

     or has_function_privilege('service_role','public.materialize_commercial_negotiation_concession_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE') is not true

     or has_function_privilege('service_role','public.finalize_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE') is not true

     or has_function_privilege('service_role','public.materialize_commercial_negotiation_concession_target_quote_by_system(uuid,uuid,uuid,uuid)','EXECUTE') is not true

     or has_function_privilege('service_role','public.supersede_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid)','EXECUTE') is not true

     or has_function_privilege('service_role','public.p9_8_5_validate_specialized_quote_send_authority(uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE') is not false

     or position('p9_8_5_validate_specialized_quote_send_authority' in pg_get_functiondef('public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)'::regprocedure)) = 0

     or position('SALES_QUOTE_VERSION_NOT_SENDABLE' in pg_get_functiondef('public.materialize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure)) = 0 then

    raise exception using errcode='P0001',message='P9_8_5_POSTCONDITIONS_FAILED';

  end if;

end;

$postconditions$;

commit;

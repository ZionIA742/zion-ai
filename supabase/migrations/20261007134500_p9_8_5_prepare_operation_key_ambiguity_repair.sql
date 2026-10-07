-- P9 / Bloco 8 / Etapa 8.5
-- Repair aditivo para SQLSTATE 42702 em
-- prepare_commercial_negotiation_concession_materialization_by_system.
--
-- Causa:
-- nomes das colunas do INSERT ... RETURNING colidiam com os nomes das
-- colunas de saída RETURNS TABLE da função PL/pgSQL.
--
-- A migration 20261006190000_p9_8_5_negotiation_concession_materialization.sql
-- permanece imutável.

begin;

do $$
begin
  if to_regprocedure(
    'public.prepare_commercial_negotiation_concession_materialization_by_system(uuid,uuid,uuid,uuid)'
  ) is null then
    raise exception using
      errcode = 'P0002',
      message = 'P9_8_5_PREPARE_REPAIR_TARGET_FUNCTION_MISSING';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.prepare_commercial_negotiation_concession_materialization_by_system(p_organization_id uuid, p_store_id uuid, p_commercial_opportunity_id uuid, p_concession_id uuid)
 RETURNS TABLE(materialization_id uuid, operation_key text, request_fingerprint text, state text, negotiation_cycle_id uuid, base_quote_id uuid, base_quote_version_id uuid, target_quote_id uuid, target_quote_number text, reserved_concession_number integer, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp', 'public', 'auth', 'extensions'
 SET row_security TO 'off'
AS $function$

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

  insert into public.commercial_negotiation_concession_materializations as mat (

    organization_id,store_id,commercial_opportunity_id,negotiation_cycle_id,concession_id,

    base_quote_id,base_quote_version_id,target_quote_id,target_quote_number,reserved_concession_number,

    operation_key,request_fingerprint,state

  ) values (

    p_organization_id,p_store_id,p_commercial_opportunity_id,v_concession.negotiation_cycle_id,v_concession.id,

    v_concession.quote_id,v_concession.quote_version_id,gen_random_uuid(),v_quote_number,v_reserved,

    v_operation_key,v_fingerprint,'prepared'

  ) returning mat.id,mat.operation_key,mat.request_fingerprint,mat.state,mat.negotiation_cycle_id,mat.base_quote_id,mat.base_quote_version_id,mat.target_quote_id,mat.target_quote_number,mat.reserved_concession_number

  into materialization_id,operation_key,request_fingerprint,state,negotiation_cycle_id,base_quote_id,base_quote_version_id,target_quote_id,target_quote_number,reserved_concession_number;

  replayed:=false; return next;

exception when unique_violation then

  select m.* into v_existing from public.commercial_negotiation_concession_materializations m

  where m.organization_id=p_organization_id and m.store_id=p_store_id and m.concession_id=p_concession_id for update;

  if not found or v_existing.request_fingerprint is distinct from v_fingerprint then raise; end if;

  return query select v_existing.id,v_existing.operation_key,v_existing.request_fingerprint,v_existing.state,v_existing.negotiation_cycle_id,v_existing.base_quote_id,v_existing.base_quote_version_id,v_existing.target_quote_id,v_existing.target_quote_number,v_existing.reserved_concession_number,true;

end;

$function$;

commit;

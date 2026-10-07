-- P9 / Bloco 8 / Etapa 8.5
-- Repair aditivo: preservar o par de lineage de sales_quote_items ao criar a
-- target quote de uma concessão.
--
-- Bug observado no DEV:
-- o writer copiava profile_component_id do item-base, mas forçava
-- commercial_opportunity_id = p_commercial_opportunity_id.
-- Para itens legados com lineage NULL/NULL, isso produzia NULL/preenchido e
-- violava p9_sales_quote_items_profile_lineage_pair_chk.
--
-- Correção:
-- copiar commercial_opportunity_id do item-base junto com profile_component_id.
-- Assim:
--   item moderno: preenchido/preenchido permanece válido;
--   item legado:  NULL/NULL permanece válido.
--
-- As migrations já aplicadas permanecem imutáveis.

begin;

do $$
begin
  if to_regprocedure(
    'public.materialize_commercial_negotiation_concession_target_quote_by_system(uuid,uuid,uuid,uuid)'
  ) is null then
    raise exception using
      errcode = 'P0002',
      message = 'P9_8_5_TARGET_LINEAGE_REPAIR_FUNCTION_MISSING';
  end if;
end;
$$;

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

    values (v_m.target_quote_id,p_organization_id,p_store_id,v_item.commercial_opportunity_id,v_item.profile_component_id,v_item.pool_id,v_item.catalog_item_id,v_item.item_type,v_item.name,v_item.description,v_item.quantity,v_item.unit_price_cents,coalesce(v_item.discount_cents,0)+v_added,v_item.subtotal_cents,coalesce(v_item.subtotal_cents,0)-coalesce(v_item.discount_cents,0)-v_added,v_item.sort_order,v_item.sku,v_item.metadata);

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


commit;

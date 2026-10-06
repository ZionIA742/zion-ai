begin;

do $checks$
declare
  v_org uuid;
  v_store uuid;
  v_baseline numeric;
  v_count integer;
begin
  select payment.organization_id, payment.store_id, payment.down_payment_percent
    into v_org, v_store, v_baseline
  from public.store_payment_settings payment
  where payment.down_payment_mode in ('optional', 'required')
    and payment.down_payment_value_type = 'percent'
    and payment.down_payment_percent > 0
    and payment.down_payment_percent <= 100
  order by payment.organization_id, payment.store_id
  limit 1;

  if v_org is null or v_store is null then
    raise exception 'no valid percentage payment-settings fixture is available';
  end if;

  begin
    perform public.upsert_store_discount_counterpart_policy_scoped(
      v_org, v_store, true, array['pix']::text[], true, 'percent', v_baseline, null, false, null
    );
    raise exception 'expected lower/equal percentage to be rejected';
  exception when others then
    if position('expected lower/equal percentage' in sqlerrm) > 0 then raise; end if;
  end;

  perform public.upsert_store_discount_counterpart_policy_scoped(
    v_org, v_store, true, array['pix']::text[], true, 'percent', v_baseline + 1, null, false, null
  );
  perform public.upsert_store_discount_counterpart_policy_scoped(
    v_org, v_store, true, array['pix']::text[], true, 'percent', v_baseline + 1, null, false, null
  );

  select count(*) into v_count
  from public.store_discount_counterpart_policy policy
  where policy.organization_id = v_org and policy.store_id = v_store;
  if v_count <> 1 then
    raise exception 'expected exactly one scoped policy row after replay, got %', v_count;
  end if;
end;
$checks$;

rollback;

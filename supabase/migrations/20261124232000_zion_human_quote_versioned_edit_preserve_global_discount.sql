-- ZION AI.6-C: preserve existing, verified global discounts in human versioned edits.
-- No data backfill, no changes to the shared financial writer.
BEGIN;
DO $precheck$
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.apply_human_sales_quote_versioned_edit_by_system(uuid,uuid,uuid,timestamptz,uuid,text,integer,integer,integer,text,text,text,text,text,date,integer,jsonb,uuid,uuid,jsonb)') AND md5(btrim(replace(prosrc,chr(13),''),E' \t\n'))='74cdeca66bd6cfd62613e1a3e445bb6f' AND prosecdef)
    AND has_function_privilege('service_role','public.apply_human_sales_quote_versioned_edit_by_system(uuid,uuid,uuid,timestamptz,uuid,text,integer,integer,integer,text,text,text,text,text,date,integer,jsonb,uuid,uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','public.apply_human_sales_quote_versioned_edit_by_system(uuid,uuid,uuid,timestamptz,uuid,text,integer,integer,integer,text,text,text,text,text,date,integer,jsonb,uuid,uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public.apply_human_sales_quote_versioned_edit_by_system(uuid,uuid,uuid,timestamptz,uuid,text,integer,integer,integer,text,text,text,text,text,date,integer,jsonb,uuid,uuid,jsonb)','EXECUTE')
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.apply_sales_quote_change_money_and_items_by_system(uuid,uuid,uuid,text,text,integer,integer,integer,text,text,text,text,text,date,jsonb,jsonb)') AND md5(btrim(replace(prosrc,chr(13),''),E' \t\n'))='da13d55861e2cc09331896a1889c3d4f')
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.assert_human_quote_revision_pdf_artifact_internal(uuid,uuid,uuid)') AND md5(btrim(replace(prosrc,chr(13),''),E' \t\n'))='464cb8f38f49aa682378da416560aa74')
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.apply_human_sales_quote_draft_edit_by_system(uuid,uuid,uuid,timestamptz,uuid,text,integer,integer,integer,text,text,text,text,text,date,integer,jsonb)') AND md5(btrim(replace(prosrc,chr(13),''),E' \t\n'))='94fe3d55db6afd1824a7e83548841369')
  ) THEN RAISE EXCEPTION 'AI6C_PRECHECK_AUTHORITY_MISMATCH'; END IF;
END;
$precheck$;
create or replace function public.apply_human_sales_quote_versioned_edit_by_system(
  p_organization_id uuid, p_store_id uuid, p_quote_id uuid,
  p_expected_updated_at timestamptz, p_expected_current_version_id uuid,
  p_title text, p_subtotal_cents integer, p_discount_cents integer,
  p_total_cents integer, p_customer_notes text, p_internal_notes text,
  p_payment_terms text, p_delivery_terms text, p_warranty_terms text,
  p_valid_until date, p_validity_days integer, p_items jsonb,
  p_operation_id uuid, p_store_file_id uuid, p_quote_snapshot jsonb
)
returns table (
  quote_id uuid, version_id uuid, version_number integer,
  current_version_id uuid, updated_at timestamptz, quote_status text,
  replayed boolean
)
language plpgsql security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_quote public.sales_quotes%rowtype;
  v_after public.sales_quotes%rowtype;
  v_previous public.sales_quote_versions%rowtype;
  v_replay public.sales_quote_versions%rowtype;
  v_file public.store_files%rowtype;
  v_version_number integer;
  v_metadata jsonb;
  v_result record;
  v_item_photos jsonb;
  v_snapshot_items jsonb;
  v_header jsonb;
  v_fingerprint text;
  v_prefix text;
  v_old_subtotal numeric;
  v_old_discount numeric;
  v_old_total numeric;
  v_global_discount numeric;
  v_line_discount integer;
  v_line_total integer;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
              nullif(auth.jwt() ->> 'role', '')) is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using errcode='42501', message='ZION_HUMAN_VERSIONED_EDIT_FORBIDDEN';
  end if;
  if p_organization_id is null or p_store_id is null or p_quote_id is null
     or p_expected_updated_at is null or p_expected_current_version_id is null
     or p_operation_id is null or p_store_file_id is null
     or nullif(btrim(p_title), '') is null
     or p_subtotal_cents is null or p_discount_cents is null or p_total_cents is null
     or least(p_subtotal_cents,p_discount_cents,p_total_cents) < 0
     or p_validity_days < 0
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_typeof(p_quote_snapshot) is distinct from 'object'
     or p_quote_snapshot ? 'humanRevision' then
    raise exception using errcode='22023', message='ZION_HUMAN_VERSIONED_EDIT_ARGUMENTS_INVALID';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception using errcode='22023', message='ZION_HUMAN_VERSIONED_EDIT_ITEMS_REQUIRED';
  end if;
  select q.* into v_quote from public.sales_quotes q
  where q.id=p_quote_id and q.organization_id=p_organization_id and q.store_id=p_store_id
  for update;
  if not found then
    raise exception using errcode='P0002', message='ZION_HUMAN_VERSIONED_EDIT_NOT_FOUND';
  end if;
  if not public.zion_human_quote_edit_eligible(v_quote.metadata) then
    raise exception using errcode='42501', message='ZION_HUMAN_REVISION_PROVENANCE_REQUIRED';
  end if;
  -- Stable operation identity, including the exact PDF record and snapshot.
  v_fingerprint := encode(sha256(convert_to(jsonb_build_array(
    p_organization_id,p_store_id,p_quote_id,extract(epoch from p_expected_updated_at),
    p_expected_current_version_id,p_title,p_subtotal_cents,p_discount_cents,p_total_cents,
    p_customer_notes,p_internal_notes,p_payment_terms,p_delivery_terms,p_warranty_terms,
    p_valid_until,p_validity_days,p_items,p_operation_id,p_store_file_id,p_quote_snapshot
  )::text,'UTF8')),'hex');
  select v.* into v_replay from public.sales_quote_versions v
  where v.id=p_operation_id;
  if found then
    if v_replay.quote_id is distinct from p_quote_id
       or v_replay.organization_id is distinct from p_organization_id
       or v_replay.store_id is distinct from p_store_id
       or v_replay.generated_by is distinct from 'human_revision'
       or v_replay.store_file_id is distinct from p_store_file_id
       or v_replay.quote_snapshot #>> '{humanRevision,requestFingerprint}' is distinct from v_fingerprint then
      raise exception using errcode='23505', message='ZION_HUMAN_VERSIONED_EDIT_OPERATION_CONFLICT';
    end if;
    return query select p_quote_id,v_replay.id,v_replay.version_number,
      v_quote.current_version_id,v_quote.updated_at,v_quote.status,true;
    return;
  end if;
  perform public.assert_human_quote_revision_send_safe_internal(
    p_organization_id,p_store_id,p_quote_id,p_expected_updated_at,p_expected_current_version_id
  );
  select v.* into strict v_previous from public.sales_quote_versions v
  where v.id=p_expected_current_version_id and v.quote_id=p_quote_id
    and v.organization_id=p_organization_id and v.store_id=p_store_id for update;
  -- Preserve only the pre-existing, internally consistent global discount.
  -- The quote lock and stale guard have already been acquired.
  select coalesce(sum(i.subtotal_cents::numeric),0),
         coalesce(sum(i.discount_cents::numeric),0),
         coalesce(sum(i.total_cents::numeric),0)
    into v_old_subtotal,v_old_discount,v_old_total
  from public.sales_quote_items i
  where i.quote_id=p_quote_id and i.organization_id=p_organization_id and i.store_id=p_store_id;
  v_global_discount := v_quote.discount_cents::numeric - v_old_discount;
  if v_global_discount is null or v_global_discount < 0
     or (v_global_discount > 0 and (
       v_quote.subtotal_cents is distinct from v_old_subtotal
       or v_old_total is distinct from v_old_subtotal-v_old_discount
       or v_quote.total_cents::numeric is distinct from v_old_total-v_global_discount
       or coalesce(v_previous.quote_snapshot#>>'{quote,subtotalCents}',v_previous.quote_snapshot->>'subtotalCents',v_previous.quote_snapshot->>'subtotal_cents') is distinct from v_quote.subtotal_cents::text
       or coalesce(v_previous.quote_snapshot#>>'{quote,discountCents}',v_previous.quote_snapshot->>'discountCents',v_previous.quote_snapshot->>'discount_cents') is distinct from v_quote.discount_cents::text
       or coalesce(v_previous.quote_snapshot#>>'{quote,totalCents}',v_previous.quote_snapshot->>'totalCents',v_previous.quote_snapshot->>'total_cents') is distinct from v_quote.total_cents::text
     )) then
    raise exception using errcode='23514',message='ZION_HUMAN_REVISION_GLOBAL_DISCOUNT_HISTORY_INVALID';
  end if;
  if p_discount_cents::numeric < v_global_discount
     or p_total_cents::numeric+v_global_discount > 2147483647
     or p_subtotal_cents::numeric-p_discount_cents::numeric <> p_total_cents::numeric then
    raise exception using errcode='23514',message='ZION_HUMAN_REVISION_GLOBAL_DISCOUNT_INVALID';
  end if;
  v_line_discount := (p_discount_cents::numeric-v_global_discount)::integer;
  v_line_total := (p_total_cents::numeric+v_global_discount)::integer;
  select * into v_file from public.assert_human_quote_revision_pdf_artifact_internal(
    p_organization_id,p_store_id,p_store_file_id
  );
  v_prefix := p_organization_id::text || '/' || p_store_id::text || '/sales-quotes/' || p_quote_id::text || '/';
  if v_file.storage_bucket is distinct from 'zion-store-files'
     or left(v_file.storage_path,length(v_prefix)) is distinct from v_prefix
     or substring(v_file.storage_path from length(v_prefix)+1) !~ '^[A-Za-z0-9._-]+[.]pdf$' then
    raise exception using errcode='23514', message='ZION_HUMAN_VERSIONED_EDIT_PDF_PATH_INVALID';
  end if;
  -- The server allocates UUIDs for new items before rendering the PDF.
  if exists (select 1 from jsonb_to_recordset(p_items) as x(id uuid,sort_order integer)
             where x.id is null or x.sort_order is null or x.sort_order <= 0)
     or (select count(distinct x.id) from jsonb_to_recordset(p_items) as x(id uuid)) <> jsonb_array_length(p_items)
     or (select count(distinct x.sort_order) from jsonb_to_recordset(p_items) as x(sort_order integer)) <> jsonb_array_length(p_items)
     or exists (select 1 from jsonb_to_recordset(p_items) as x(id uuid)
       join public.sales_quote_items i on i.id=x.id
       where i.quote_id is distinct from p_quote_id or i.organization_id is distinct from p_organization_id or i.store_id is distinct from p_store_id) then
    raise exception using errcode='23514', message='ZION_HUMAN_VERSIONED_EDIT_ITEM_IDENTITY_INVALID';
  end if;
  -- Quote kind remains the same as the prior version. No new approval is created.
  v_header := jsonb_build_object(
    'id',p_quote_id,'quoteNumber',btrim(coalesce(v_quote.quote_number,'')),
    'title',p_title,'status','draft','quoteKind',v_previous.quote_kind,
    'customerNotes',p_customer_notes,'internalNotes',p_internal_notes,
    'paymentTerms',p_payment_terms,'deliveryTerms',p_delivery_terms,'warrantyTerms',p_warranty_terms,
    'validUntil',p_valid_until,'subtotalCents',p_subtotal_cents,'discountCents',p_discount_cents,'totalCents',p_total_cents
  );
  if (p_quote_snapshot->'quote' @> v_header) is distinct from true
     or p_quote_snapshot #>> '{store,id}' is distinct from p_store_id::text
     or p_quote_snapshot #>> '{lead,id}' is distinct from v_quote.lead_id::text
     or jsonb_typeof(p_quote_snapshot->'items') is distinct from 'array' then
    raise exception using errcode='23514', message='ZION_HUMAN_VERSIONED_EDIT_SNAPSHOT_HEADER_MISMATCH';
  end if;
  select coalesce(max(v.version_number),0)+1 into v_version_number
  from public.sales_quote_versions v where v.quote_id=p_quote_id;
  -- Insert BEFORE financial/status changes: existing trigger captures prior authority.
  insert into public.sales_quote_versions (
    id,organization_id,store_id,quote_id,version_number,status,generated_by,
    quote_kind,store_file_id,storage_bucket,storage_path,original_filename,mime_type,size_bytes,quote_snapshot
  ) values (
    p_operation_id,p_organization_id,p_store_id,p_quote_id,v_version_number,'generated','human_revision',
    v_previous.quote_kind,v_file.id,v_file.storage_bucket,v_file.storage_path,v_file.original_filename,v_file.mime_type,v_file.size_bytes,
    p_quote_snapshot || jsonb_build_object('humanRevision',jsonb_build_object('requestFingerprint',v_fingerprint,'previousVersionId',v_previous.id))
  );

  -- Preserva toda a metadata original.
  -- Somente campos comerciais editaveis sao substituidos.
  v_metadata := v_quote.metadata || jsonb_build_object(
    'payment_terms', p_payment_terms,
    'delivery_terms', p_delivery_terms,
    'warranty_terms', p_warranty_terms,
    'validity_days', p_validity_days,
    'valid_until', p_valid_until
  );

  -- Preserva referencias de fotos dos itens existentes.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'source_photo_storage_bucket', i.source_photo_storage_bucket,
        'source_photo_storage_path', i.source_photo_storage_path,
        'source_photo_public_url', i.source_photo_public_url
      )
    ),
    '[]'::jsonb
  )
  into v_item_photos
  from public.sales_quote_items i
  where i.quote_id = p_quote_id
    and i.organization_id = p_organization_id
    and i.store_id = p_store_id
    and (
      i.source_photo_storage_bucket is not null
      or i.source_photo_storage_path is not null
      or i.source_photo_public_url is not null
    );

  -- Reutiliza exclusivamente o writer de valores e itens.
  -- Nao utiliza request-change, apply-change HTTP,
  -- aprovacao humana da IA ou eventos comerciais.
  select writer_result.*
    into v_result
    from public.apply_sales_quote_change_money_and_items_by_system(
      p_organization_id,
      p_store_id,
      p_quote_id,
      p_title,
      'draft',
      p_subtotal_cents,
      v_line_discount,
      v_line_total,
      p_customer_notes,
      p_internal_notes,
      p_payment_terms,
      p_delivery_terms,
      p_warranty_terms,
      p_valid_until,
      v_metadata,
      p_items
    ) writer_result;

  if not found
     or v_result.quote_id is distinct from p_quote_id
     or v_result.item_count is distinct from jsonb_array_length(p_items)
     or v_result.subtotal_cents is distinct from p_subtotal_cents
     or v_result.discount_cents is distinct from v_line_discount
     or v_result.total_cents is distinct from v_line_total then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_HUMAN_QUOTE_EDIT_WRITER_RESULT_INVALID';
  end if;

  -- Restaura fotos somente dos itens mantidos pelo writer.
  update public.sales_quote_items i
  set source_photo_storage_bucket = photo.source_photo_storage_bucket,
      source_photo_storage_path = photo.source_photo_storage_path,
      source_photo_public_url = photo.source_photo_public_url
  from jsonb_to_recordset(v_item_photos) as photo(
    id uuid,
    source_photo_storage_bucket text,
    source_photo_storage_path text,
    source_photo_public_url text
  )
  where i.id = photo.id
    and i.quote_id = p_quote_id
    and i.organization_id = p_organization_id
    and i.store_id = p_store_id;


  -- Check exact persisted item projection against the snapshot used for rendering.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'name',i.name,'description',i.description,'quantity',i.quantity,
    'unitPriceCents',i.unit_price_cents,'discountCents',i.discount_cents,
    'subtotalCents',i.subtotal_cents,'totalCents',i.total_cents,'sku',i.sku,
    'sortOrder',i.sort_order,'metadata',i.metadata
  ) order by i.sort_order),'[]'::jsonb) into v_snapshot_items
  from public.sales_quote_items i where i.quote_id=p_quote_id
    and i.organization_id=p_organization_id and i.store_id=p_store_id;
  if v_snapshot_items is distinct from (p_quote_snapshot->'items') then
    raise exception using errcode='23514', message='ZION_HUMAN_VERSIONED_EDIT_SNAPSHOT_ITEMS_MISMATCH';
  end if;
  update public.sales_quote_versions v set status='superseded'
  where v.id=v_previous.id and v.quote_id=p_quote_id and v.organization_id=p_organization_id and v.store_id=p_store_id
    and v.status not in ('sent','failed','superseded');
  update public.sales_quotes q set current_version_id=p_operation_id,status='draft',
    discount_cents=p_discount_cents,total_cents=p_total_cents,
    approved_at=null,approved_by=null,sent_at=null,cancelled_at=null,expired_at=null
  where q.id=p_quote_id and q.organization_id=p_organization_id and q.store_id=p_store_id
  returning q.* into v_after;
  if not found or v_after.updated_at <= v_quote.updated_at
     or v_after.current_version_id is distinct from p_operation_id
     or v_after.subtotal_cents is distinct from p_subtotal_cents
     or v_after.discount_cents is distinct from p_discount_cents
     or v_after.total_cents is distinct from p_total_cents
     or v_after.status is distinct from 'draft'
     or v_after.commercial_opportunity_id is distinct from v_quote.commercial_opportunity_id
     or v_after.conversation_id is distinct from v_quote.conversation_id
     or v_after.lead_id is distinct from v_quote.lead_id then
    raise exception using errcode='P0001',message='ZION_HUMAN_VERSIONED_EDIT_POSTCONDITION_FAILED';
  end if;
  return query select p_quote_id,p_operation_id,v_version_number,
    v_after.current_version_id,v_after.updated_at,v_after.status,false;
end;
$function$;
DO $postcheck$
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.apply_human_sales_quote_versioned_edit_by_system(uuid,uuid,uuid,timestamptz,uuid,text,integer,integer,integer,text,text,text,text,text,date,integer,jsonb,uuid,uuid,jsonb)') AND md5(btrim(replace(prosrc,chr(13),''),E' \t\n'))='e493da2b77df6f56c924faab2c2268fe' AND prosecdef)
    AND has_function_privilege('service_role','public.apply_human_sales_quote_versioned_edit_by_system(uuid,uuid,uuid,timestamptz,uuid,text,integer,integer,integer,text,text,text,text,text,date,integer,jsonb,uuid,uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','public.apply_human_sales_quote_versioned_edit_by_system(uuid,uuid,uuid,timestamptz,uuid,text,integer,integer,integer,text,text,text,text,text,date,integer,jsonb,uuid,uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public.apply_human_sales_quote_versioned_edit_by_system(uuid,uuid,uuid,timestamptz,uuid,text,integer,integer,integer,text,text,text,text,text,date,integer,jsonb,uuid,uuid,jsonb)','EXECUTE')
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.apply_sales_quote_change_money_and_items_by_system(uuid,uuid,uuid,text,text,integer,integer,integer,text,text,text,text,text,date,jsonb,jsonb)') AND md5(btrim(replace(prosrc,chr(13),''),E' \t\n'))='da13d55861e2cc09331896a1889c3d4f')
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.assert_human_quote_revision_pdf_artifact_internal(uuid,uuid,uuid)') AND md5(btrim(replace(prosrc,chr(13),''),E' \t\n'))='464cb8f38f49aa682378da416560aa74')
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.apply_human_sales_quote_draft_edit_by_system(uuid,uuid,uuid,timestamptz,uuid,text,integer,integer,integer,text,text,text,text,text,date,integer,jsonb)') AND md5(btrim(replace(prosrc,chr(13),''),E' \t\n'))='94fe3d55db6afd1824a7e83548841369')
  ) THEN RAISE EXCEPTION 'AI6C_POSTCHECK_AUTHORITY_MISMATCH'; END IF;
END;
$postcheck$;
COMMIT;

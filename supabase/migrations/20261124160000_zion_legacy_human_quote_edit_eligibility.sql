begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $preflight$
begin
  if not exists (select 1 from pg_proc where oid=to_regprocedure('public.zion_human_quote_monotonic_updated_at_trg()') and md5(btrim(replace(prosrc,chr(13),''),E' \t\n'))='75b4499800b5d237d1d88de5da3447d4') then raise exception 'AH5_BASE_CHANGED: public.zion_human_quote_monotonic_updated_at_trg()'; end if;
  if not exists (select 1 from pg_proc where oid=to_regprocedure('public.apply_human_sales_quote_draft_edit_by_system(uuid,uuid,uuid,timestamptz,uuid,text,integer,integer,integer,text,text,text,text,text,date,integer,jsonb)') and md5(btrim(replace(prosrc,chr(13),''),E' \t\n'))='780ccb5a86d5b8cae26d717a9dcb8c1b') then raise exception 'AH5_BASE_CHANGED: public.apply_human_sales_quote_draft_edit_by_system(uuid,uuid,uuid,timestamptz,uuid,text,integer,integer,integer,text,text,text,text,text,date,integer,jsonb)'; end if;
  if not exists (select 1 from pg_proc where oid=to_regprocedure('public.assert_human_quote_revision_send_safe_internal(uuid,uuid,uuid,timestamptz,uuid)') and md5(btrim(replace(prosrc,chr(13),''),E' \t\n'))='10a5662dcc4eb173633afd1131b85394') then raise exception 'AH5_BASE_CHANGED: public.assert_human_quote_revision_send_safe_internal(uuid,uuid,uuid,timestamptz,uuid)'; end if;
  if not exists (select 1 from pg_proc where oid=to_regprocedure('public.apply_human_sales_quote_versioned_edit_by_system(uuid,uuid,uuid,timestamptz,uuid,text,integer,integer,integer,text,text,text,text,text,date,integer,jsonb,uuid,uuid,jsonb)') and md5(btrim(replace(prosrc,chr(13),''),E' \t\n'))='eef858d76eb4e78b5cacb98b5437a254') then raise exception 'AH5_BASE_CHANGED: public.apply_human_sales_quote_versioned_edit_by_system(uuid,uuid,uuid,timestamptz,uuid,text,integer,integer,integer,text,text,text,text,text,date,integer,jsonb,uuid,uuid,jsonb)'; end if;
end;
$preflight$;

-- Eligibility is not proof of the identity of the original creator.
create function public.zion_human_quote_edit_eligible(p_metadata jsonb)
returns boolean language sql immutable security invoker
set search_path = pg_catalog, pg_temp
as $predicate$
  select coalesce(jsonb_typeof(p_metadata)='object'
    and p_metadata->>'created_via'='api_sales_quotes_create'
    and ((p_metadata->>'creation_actor_kind'='user'
      and jsonb_typeof(p_metadata->'creation_actor_user_id')='string'
      and btrim(p_metadata->>'creation_actor_user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or (p_metadata->'legacy_human_edit_eligible'='true'::jsonb
        and not (p_metadata ? 'creation_actor_kind')
        and not (p_metadata ? 'creation_actor_user_id'))),false);
$predicate$;
alter function public.zion_human_quote_edit_eligible(jsonb) owner to postgres;
revoke all on function public.zion_human_quote_edit_eligible(jsonb) from public;
grant execute on function public.zion_human_quote_edit_eligible(jsonb) to anon, authenticated, service_role;

-- The marker is never accepted on INSERT. Only an administrative, explicit
-- promotion of an existing historical candidate is permitted. No backfill here.
create function public.zion_legacy_human_quote_eligibility_guard_trg()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $guard$
begin
  if tg_op='INSERT' then
    if coalesce(new.metadata ? 'legacy_human_edit_eligible',false) then
      raise exception using errcode='42501',message='ZION_LEGACY_QUOTE_MARKER_INSERT_FORBIDDEN';
    end if;
    return new;
  end if;
  if coalesce(old.metadata ? 'legacy_human_edit_eligible',false) then
    if old.metadata->'legacy_human_edit_eligible' is distinct from new.metadata->'legacy_human_edit_eligible'
      or old.id is distinct from new.id
      or old.organization_id is distinct from new.organization_id
      or old.store_id is distinct from new.store_id
      or old.created_at is distinct from new.created_at then
      raise exception using errcode='42501',message='ZION_LEGACY_QUOTE_MARKER_IMMUTABLE';
    end if;
    return new;
  end if;
  if coalesce(new.metadata ? 'legacy_human_edit_eligible',false) then
    if current_user <> 'postgres' or session_user <> 'postgres' then
      raise exception using errcode='42501',message='ZION_LEGACY_QUOTE_PROMOTION_FORBIDDEN';
    end if;
    if new.metadata->'legacy_human_edit_eligible' is distinct from 'true'::jsonb
      or old.metadata->>'created_via' is distinct from 'api_sales_quotes_create'
      or old.created_at is null or old.created_at >= timestamptz '2026-10-01 00:00:00+00'
      or old.created_by is distinct from 'system'
      or old.metadata ? 'creation_actor_kind' or old.metadata ? 'creation_actor_user_id'
      or old.metadata ? 'fixture' or old.metadata ? 'test_scope'
      or old.metadata is distinct from (new.metadata - 'legacy_human_edit_eligible')
      or old.id is distinct from new.id or old.organization_id is distinct from new.organization_id
      or old.store_id is distinct from new.store_id or old.created_at is distinct from new.created_at
      or exists(select 1 from public.p19a_quote_preparation_operations op where op.quote_id=old.id)
      or exists(select 1 from public.commercial_negotiation_concession_materializations m where m.target_quote_id=old.id) then
      raise exception using errcode='23514',message='ZION_LEGACY_QUOTE_NOT_ELIGIBLE';
    end if;
  end if;
  return new;
end;
$guard$;
alter function public.zion_legacy_human_quote_eligibility_guard_trg() owner to postgres;
revoke all on function public.zion_legacy_human_quote_eligibility_guard_trg() from public, anon, authenticated, service_role;
create trigger zion_legacy_human_quote_eligibility_guard
before insert or update on public.sales_quotes for each row
execute function public.zion_legacy_human_quote_eligibility_guard_trg();

create or replace function public.zion_human_quote_monotonic_updated_at_trg()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if public.zion_human_quote_edit_eligible(old.metadata) then
    new.updated_at := greatest(
      pg_catalog.clock_timestamp(),
      old.updated_at + interval '1 microsecond'
    );
  end if;

  return new;
end;
$function$;

create or replace function public.apply_human_sales_quote_draft_edit_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_quote_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_current_version_id uuid,
  p_title text,
  p_subtotal_cents integer,
  p_discount_cents integer,
  p_total_cents integer,
  p_customer_notes text,
  p_internal_notes text,
  p_payment_terms text,
  p_delivery_terms text,
  p_warranty_terms text,
  p_valid_until date,
  p_validity_days integer,
  p_items jsonb
)
returns table (
  quote_id uuid,
  item_count integer,
  subtotal_cents integer,
  discount_cents integer,
  total_cents integer,
  updated_at timestamptz,
  current_version_id uuid,
  quote_status text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );

  v_quote public.sales_quotes%rowtype;
  v_metadata jsonb;
  v_result record;
  v_updated_at timestamptz;
  v_item_photos jsonb;
begin

  -- Somente backend privilegiado ou administrador SQL.
  if v_request_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'ZION_HUMAN_QUOTE_EDIT_FORBIDDEN';
  end if;

  -- Validacao dos argumentos obrigatorios.
  if p_organization_id is null
     or p_store_id is null
     or p_quote_id is null
     or p_expected_updated_at is null
     or nullif(btrim(p_title), '') is null
     or p_subtotal_cents is null
     or p_discount_cents is null
     or p_total_cents is null
     or p_subtotal_cents < 0
     or p_discount_cents < 0
     or p_total_cents < 0
     or (p_validity_days is not null and p_validity_days <= 0)
     or p_items is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_HUMAN_QUOTE_EDIT_ARGUMENTS_INVALID';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'ZION_HUMAN_QUOTE_EDIT_ITEMS_INVALID';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception using
      errcode = '22023',
      message = 'ZION_HUMAN_QUOTE_EDIT_ITEMS_REQUIRED';
  end if;

  -- Bloqueio transacional e isolamento multi-tenant.
  select q.*
    into v_quote
    from public.sales_quotes q
   where q.id = p_quote_id
     and q.organization_id = p_organization_id
     and q.store_id = p_store_id
   for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_HUMAN_QUOTE_EDIT_NOT_FOUND';
  end if;

  -- Origem humana comprovada no registro persistido.
  if not public.zion_human_quote_edit_eligible(v_quote.metadata) then
    raise exception using
      errcode = '42501',
      message = 'ZION_HUMAN_QUOTE_EDIT_PROVENANCE_REQUIRED';
  end if;

  -- A verificacao de concorrencia ocorre com a linha bloqueada.
  if v_quote.updated_at
       is distinct from p_expected_updated_at
     or v_quote.current_version_id
       is distinct from p_expected_current_version_id then
    raise exception using
      errcode = '40001',
      message = 'ZION_HUMAN_QUOTE_EDIT_STALE';
  end if;

  -- Esta autoridade atende somente rascunhos sem PDF.
  -- Orcamentos versionados terao autoridade independente.
  if v_quote.status is distinct from 'draft'
     or v_quote.current_version_id is not null
     or exists (
       select 1
       from public.sales_quote_versions sv
       where sv.quote_id = p_quote_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'ZION_HUMAN_QUOTE_EDIT_VERSIONED_FLOW_REQUIRED';
  end if;

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
      v_quote.status,
      p_subtotal_cents,
      p_discount_cents,
      p_total_cents,
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
     or v_result.discount_cents is distinct from p_discount_cents
     or v_result.total_cents is distinct from p_total_cents then
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

  -- Confirma que o estado comercial permaneceu intacto.
  select q.updated_at
    into v_updated_at
    from public.sales_quotes q
   where q.id = p_quote_id
     and q.organization_id = p_organization_id
     and q.store_id = p_store_id
     and q.status = v_quote.status
     and q.current_version_id is null;

  if not found
     or v_updated_at is null
     or v_updated_at <= v_quote.updated_at then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_HUMAN_QUOTE_EDIT_POSTCONDITION_FAILED';
  end if;

  return query
    select
      p_quote_id,
      v_result.item_count,
      p_subtotal_cents,
      p_discount_cents,
      p_total_cents,
      v_updated_at,
      null::uuid,
      v_quote.status::text;

end;
$function$;

create or replace function public.assert_human_quote_revision_send_safe_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_quote_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_current_version_id uuid
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_quote public.sales_quotes%rowtype;
  v_version public.sales_quote_versions%rowtype;
begin

  if p_organization_id is null
     or p_store_id is null
     or p_quote_id is null
     or p_expected_updated_at is null
     or p_expected_current_version_id is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_HUMAN_REVISION_ARGUMENTS_REQUIRED';
  end if;

  -- Compartilha o bloqueio utilizado pelas autoridades
  -- existentes de materializacao e finalizacao de envio.
  select q.*
  into v_quote
  from public.sales_quotes q
  where q.id = p_quote_id
    and q.organization_id = p_organization_id
    and q.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'ZION_HUMAN_REVISION_QUOTE_NOT_FOUND';
  end if;

  -- Procedencia humana obrigatoria.
  if not public.zion_human_quote_edit_eligible(v_quote.metadata) then
    raise exception using
      errcode = '42501',
      message = 'ZION_HUMAN_REVISION_PROVENANCE_REQUIRED';
  end if;

  -- Concorrencia otimista sob bloqueio.
  if v_quote.updated_at
       is distinct from p_expected_updated_at
     or v_quote.current_version_id
       is distinct from p_expected_current_version_id then
    raise exception using
      errcode = '40001',
      message = 'ZION_HUMAN_REVISION_STALE';
  end if;

  -- Confirma a identidade exata da versao anterior.
  select v.*
  into v_version
  from public.sales_quote_versions v
  where v.id = p_expected_current_version_id
    and v.quote_id = p_quote_id
    and v.organization_id = p_organization_id
    and v.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_HUMAN_REVISION_VERSION_SCOPE_INVALID';
  end if;

  -- A edicao humana independe do estado do transporte.
  -- A autorizacao anterior e preservada pelo trigger de versao.
  -- Sem escritas ou efeitos comerciais.
  -- O bloqueio permanece ate o fim da transacao chamadora.
end;
$function$;

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
      p_discount_cents,
      p_total_cents,
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
     or v_result.discount_cents is distinct from p_discount_cents
     or v_result.total_cents is distinct from p_total_cents then
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
    approved_at=null,approved_by=null,sent_at=null,cancelled_at=null,expired_at=null
  where q.id=p_quote_id and q.organization_id=p_organization_id and q.store_id=p_store_id
  returning q.* into v_after;
  if not found or v_after.updated_at <= v_quote.updated_at
     or v_after.current_version_id is distinct from p_operation_id
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

commit;

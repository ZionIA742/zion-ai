begin;

create function public.zion_human_quote_monotonic_updated_at_trg()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if old.metadata ->> 'created_via' = 'api_sales_quotes_create'
     and old.metadata ->> 'creation_actor_kind' = 'user'
     and jsonb_typeof(
       old.metadata -> 'creation_actor_user_id'
     ) = 'string'
     and btrim(
       old.metadata ->> 'creation_actor_user_id'
     ) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    new.updated_at := greatest(
      pg_catalog.clock_timestamp(),
      old.updated_at + interval '1 microsecond'
    );
  end if;

  return new;
end;
$function$;

alter function public.zion_human_quote_monotonic_updated_at_trg()
owner to postgres;

revoke all on function
  public.zion_human_quote_monotonic_updated_at_trg()
from public, anon, authenticated;

-- Executado depois do trigger legado set_sales_quotes_updated_at.
create trigger zz_zion_human_quote_monotonic_updated_at
before update on public.sales_quotes
for each row
execute function public.zion_human_quote_monotonic_updated_at_trg();

create function public.apply_human_sales_quote_draft_edit_by_system(
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
  if (v_quote.metadata ->> 'created_via')
       is distinct from 'api_sales_quotes_create'
     or (v_quote.metadata ->> 'creation_actor_kind')
       is distinct from 'user'
     or coalesce(
       btrim(v_quote.metadata ->> 'creation_actor_user_id'),
       ''
     ) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
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

alter function public.apply_human_sales_quote_draft_edit_by_system(
  uuid, uuid, uuid, timestamptz, uuid, text,
  integer, integer, integer,
  text, text, text, text, text,
  date, integer, jsonb
) owner to postgres;

revoke all on function public.apply_human_sales_quote_draft_edit_by_system(
  uuid, uuid, uuid, timestamptz, uuid, text,
  integer, integer, integer,
  text, text, text, text, text,
  date, integer, jsonb
) from public, anon, authenticated;

grant execute on function public.apply_human_sales_quote_draft_edit_by_system(
  uuid, uuid, uuid, timestamptz, uuid, text,
  integer, integer, integer,
  text, text, text, text, text,
  date, integer, jsonb
) to service_role;

comment on function public.apply_human_sales_quote_draft_edit_by_system(
  uuid, uuid, uuid, timestamptz, uuid, text,
  integer, integer, integer,
  text, text, text, text, text,
  date, integer, jsonb
) is
  'Atomically edits human-created unversioned quote drafts with tenant scope, provenance and optimistic concurrency guards.';

commit;

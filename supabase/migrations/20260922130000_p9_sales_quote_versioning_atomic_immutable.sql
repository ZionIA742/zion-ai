-- P9 6.3: atomic and immutable sales quote versioning.



begin;



set local lock_timeout = '5s';

set local statement_timeout = '180s';



do $preflight$

declare

  v_duplicates text;

begin

  if pg_catalog.to_regclass('public.sales_quotes') is null

     or pg_catalog.to_regclass('public.sales_quote_versions') is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: sales_quotes and sales_quote_versions are required';

  end if;



  select pg_catalog.string_agg(

           duplicate_row.quote_id::text || ':' ||

           duplicate_row.version_number::text || ':' ||

           duplicate_row.row_count::text,

           ', '

         )

  into v_duplicates

  from (

    select

      version_row.quote_id,

      version_row.version_number,

      pg_catalog.count(*) as row_count

    from public.sales_quote_versions version_row

    where version_row.version_number is not null

    group by version_row.quote_id, version_row.version_number

    having pg_catalog.count(*) > 1

  ) duplicate_row;



  if v_duplicates is not null then

    raise exception using

      errcode = '23505',

      message = 'ZION_SALES_QUOTE_VERSION_NUMBER_DUPLICATES',

      detail = v_duplicates;

  end if;

end;

$preflight$;



create unique index if not exists sales_quote_versions_quote_id_version_number_uidx

  on public.sales_quote_versions (quote_id, version_number);



create or replace function public.enforce_sales_quote_version_immutability_by_system()

returns trigger

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

set row_security = off

as $function$

begin

  if tg_op = 'DELETE' then

    raise exception using

      errcode = '42501',

      message = 'ZION_SALES_QUOTE_VERSION_DELETE_FORBIDDEN';

  end if;



  if old.id is distinct from new.id

     or old.quote_id is distinct from new.quote_id

     or old.organization_id is distinct from new.organization_id

     or old.store_id is distinct from new.store_id

     or old.version_number is distinct from new.version_number

     or old.quote_kind is distinct from new.quote_kind

     or old.store_file_id is distinct from new.store_file_id

     or old.storage_bucket is distinct from new.storage_bucket

     or old.storage_path is distinct from new.storage_path

     or old.original_filename is distinct from new.original_filename

     or old.mime_type is distinct from new.mime_type

     or old.size_bytes is distinct from new.size_bytes

     or old.quote_snapshot is distinct from new.quote_snapshot

     or old.created_at is distinct from new.created_at then

    raise exception using

      errcode = '42501',

      message = 'ZION_SALES_QUOTE_VERSION_IMMUTABLE_FIELD_UPDATE_FORBIDDEN';

  end if;



  if old.sent_at is not null and old.sent_at is distinct from new.sent_at then

    raise exception using

      errcode = '42501',

      message = 'ZION_SALES_QUOTE_VERSION_SENT_AT_IMMUTABLE';

  end if;



  return new;

end;

$function$;



alter function public.enforce_sales_quote_version_immutability_by_system()

  owner to postgres;



drop trigger if exists sales_quote_versions_immutability_guard

  on public.sales_quote_versions;



create trigger sales_quote_versions_immutability_guard

before update or delete on public.sales_quote_versions

for each row

execute function public.enforce_sales_quote_version_immutability_by_system();



create or replace function public.create_sales_quote_version_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_quote_id uuid,

  p_version_status text,

  p_next_quote_status text,

  p_quote_kind text,

  p_store_file_id uuid,

  p_storage_bucket text,

  p_storage_path text,

  p_original_filename text,

  p_mime_type text,

  p_size_bytes integer,

  p_quote_snapshot jsonb

)

returns table (

  id uuid,

  quote_id uuid,

  organization_id uuid,

  store_id uuid,

  version_number integer,

  status text,

  quote_kind text,

  store_file_id uuid,

  storage_bucket text,

  storage_path text,

  original_filename text,

  mime_type text,

  size_bytes integer,

  quote_snapshot jsonb,

  created_at timestamptz,

  sent_at timestamptz

)

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

set row_security = off

as $function$

declare

  v_request_role text := coalesce(

    nullif(current_setting('request.jwt.claim.role', true), ''),

    nullif(auth.jwt() ->> 'role', '')

  );

  v_quote public.sales_quotes%rowtype;

  v_previous_version_id uuid;

  v_version public.sales_quote_versions%rowtype;

  v_next_version_number integer;

  v_updated_count integer;

begin

  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then

    raise exception using

      errcode = '42501',

      message = 'sales quote version writer is not authorized';

  end if;



  p_version_status := pg_catalog.lower(pg_catalog.btrim(coalesce(p_version_status, '')));

  p_next_quote_status := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_next_quote_status, ''))), '');

  p_quote_kind := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_quote_kind, ''))), '');

  p_storage_bucket := nullif(pg_catalog.btrim(coalesce(p_storage_bucket, '')), '');

  p_storage_path := nullif(pg_catalog.btrim(coalesce(p_storage_path, '')), '');

  p_original_filename := nullif(pg_catalog.btrim(coalesce(p_original_filename, '')), '');

  p_mime_type := nullif(pg_catalog.btrim(coalesce(p_mime_type, '')), '');



  if p_organization_id is null

     or p_store_id is null

     or p_quote_id is null

     or p_version_status not in ('generated', 'failed')

     or p_quote_snapshot is null

     or pg_catalog.jsonb_typeof(p_quote_snapshot) is distinct from 'object'

     or (p_quote_kind is not null and p_quote_kind not in ('preliminary', 'definitive')) then

    raise exception using

      errcode = '22023',

      message = 'ZION_SALES_QUOTE_VERSION_ARGUMENTS_INVALID';

  end if;



  if p_version_status = 'generated' then

    if p_next_quote_status is null

       or p_next_quote_status not in (

         'draft',

         'pending_review',

         'sent',

         'approved',

         'changes_requested',

         'failed'

       )

       or p_store_file_id is null

       or p_storage_bucket is null

       or p_storage_path is null

       or p_original_filename is null

       or p_mime_type is distinct from 'application/pdf'

       or p_size_bytes is null

       or p_size_bytes <= 0 then

      raise exception using

        errcode = '22023',

        message = 'ZION_SALES_QUOTE_VERSION_GENERATED_ARGUMENTS_INVALID';

    end if;

  else

    if p_next_quote_status is not null

       or p_store_file_id is not null

       or p_storage_bucket is not null

       or p_storage_path is not null

       or p_original_filename is not null

       or p_mime_type is not null

       or p_size_bytes is not null

       or p_quote_kind is not null then

      raise exception using

        errcode = '22023',

        message = 'ZION_SALES_QUOTE_VERSION_FAILED_ARGUMENTS_INVALID';

    end if;

  end if;



  select quote_row.*

  into v_quote

  from public.sales_quotes quote_row

  where quote_row.id = p_quote_id

    and quote_row.organization_id = p_organization_id

    and quote_row.store_id = p_store_id

  for update;



  if not found then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_VERSION_QUOTE_NOT_FOUND';

  end if;



  v_previous_version_id := v_quote.current_version_id;



  select coalesce(pg_catalog.max(version_row.version_number), 0) + 1

  into v_next_version_number

  from public.sales_quote_versions version_row

  where version_row.quote_id = p_quote_id

    and version_row.organization_id = p_organization_id

    and version_row.store_id = p_store_id;



  insert into public.sales_quote_versions (

    quote_id,

    organization_id,

    store_id,

    version_number,

    status,

    quote_kind,

    store_file_id,

    storage_bucket,

    storage_path,

    original_filename,

    mime_type,

    size_bytes,

    quote_snapshot

  )

  values (

    p_quote_id,

    p_organization_id,

    p_store_id,

    v_next_version_number,

    p_version_status,

    p_quote_kind,

    p_store_file_id,

    coalesce(p_storage_bucket, 'zion-store-files'),

    p_storage_path,

    p_original_filename,

    coalesce(p_mime_type, 'application/pdf'),

    p_size_bytes,

    p_quote_snapshot

  )

  returning *

  into v_version;



  if p_version_status = 'generated' then

    if v_previous_version_id is not null then

      update public.sales_quote_versions version_row

      set status = 'superseded'

      where version_row.id = v_previous_version_id

        and version_row.quote_id = p_quote_id

        and version_row.organization_id = p_organization_id

        and version_row.store_id = p_store_id;



      get diagnostics v_updated_count = row_count;



      if v_updated_count <> 1 then

        raise exception using

          errcode = 'P0001',

          message = 'ZION_SALES_QUOTE_VERSION_CURRENT_POINTER_INVALID';

      end if;

    end if;



    update public.sales_quotes quote_row

    set current_version_id = v_version.id,

        status = p_next_quote_status,

        updated_at = pg_catalog.clock_timestamp()

    where quote_row.id = p_quote_id

      and quote_row.organization_id = p_organization_id

      and quote_row.store_id = p_store_id;



    get diagnostics v_updated_count = row_count;



    if v_updated_count <> 1 then

      raise exception using

        errcode = 'P0001',

        message = 'ZION_SALES_QUOTE_VERSION_QUOTE_UPDATE_FAILED';

    end if;

  end if;



  id := v_version.id;

  quote_id := v_version.quote_id;

  organization_id := v_version.organization_id;

  store_id := v_version.store_id;

  version_number := v_version.version_number;

  status := v_version.status;

  quote_kind := v_version.quote_kind;

  store_file_id := v_version.store_file_id;

  storage_bucket := v_version.storage_bucket;

  storage_path := v_version.storage_path;

  original_filename := v_version.original_filename;

  mime_type := v_version.mime_type;

  size_bytes := v_version.size_bytes;

  quote_snapshot := v_version.quote_snapshot;

  created_at := v_version.created_at;

  sent_at := v_version.sent_at;



  return next;

end;

$function$;



alter function public.create_sales_quote_version_by_system(

  uuid, uuid, uuid, text, text, text, uuid, text, text, text, text, integer, jsonb

) owner to postgres;



comment on function public.create_sales_quote_version_by_system(

  uuid, uuid, uuid, text, text, text, uuid, text, text, text, text, integer, jsonb

) is

  'Creates generated or failed sales quote versions atomically under a scoped quote lock. Generated versions advance sales_quotes.current_version_id; failed versions never do.';



create or replace function public.approve_sales_quote_version_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_quote_id uuid,

  p_sales_quote_version_id uuid

)

returns table (

  id uuid,

  quote_id uuid,

  organization_id uuid,

  store_id uuid,

  version_number integer,

  status text,

  quote_kind text,

  store_file_id uuid,

  storage_bucket text,

  storage_path text,

  original_filename text,

  mime_type text,

  size_bytes integer,

  quote_snapshot jsonb,

  created_at timestamptz,

  sent_at timestamptz

)

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

set row_security = off

as $function$

declare

  v_request_role text := coalesce(

    nullif(current_setting('request.jwt.claim.role', true), ''),

    nullif(auth.jwt() ->> 'role', '')

  );

  v_quote public.sales_quotes%rowtype;

  v_version public.sales_quote_versions%rowtype;

begin

  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then

    raise exception using

      errcode = '42501',

      message = 'sales quote version approval writer is not authorized';

  end if;



  if p_organization_id is null

     or p_store_id is null

     or p_quote_id is null

     or p_sales_quote_version_id is null then

    raise exception using

      errcode = '22023',

      message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_ARGUMENTS_INVALID';

  end if;



  select quote_row.*

  into v_quote

  from public.sales_quotes quote_row

  where quote_row.id = p_quote_id

    and quote_row.organization_id = p_organization_id

    and quote_row.store_id = p_store_id

  for update;



  if not found then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_QUOTE_NOT_FOUND';

  end if;



  if v_quote.current_version_id is distinct from p_sales_quote_version_id then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_REQUIRES_CURRENT_VERSION';

  end if;



  select version_row.*

  into v_version

  from public.sales_quote_versions version_row

  where version_row.id = p_sales_quote_version_id

    and version_row.quote_id = p_quote_id

    and version_row.organization_id = p_organization_id

    and version_row.store_id = p_store_id

  for update;



  if not found then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_VERSION_NOT_FOUND';

  end if;



  if v_version.sent_at is not null

     or pg_catalog.lower(pg_catalog.btrim(coalesce(v_version.status, ''))) in (

       'sent',

       'superseded',

       'failed'

     ) then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_STATUS_INVALID';

  end if;



  if pg_catalog.lower(pg_catalog.btrim(coalesce(v_version.status, ''))) not in (

    'generated',

    'pending_review',

    'approved'

  ) then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_STATUS_INVALID';

  end if;



  update public.sales_quote_versions version_row

  set status = 'approved'

  where version_row.id = p_sales_quote_version_id

    and version_row.quote_id = p_quote_id

    and version_row.organization_id = p_organization_id

    and version_row.store_id = p_store_id

  returning *

  into v_version;



  id := v_version.id;

  quote_id := v_version.quote_id;

  organization_id := v_version.organization_id;

  store_id := v_version.store_id;

  version_number := v_version.version_number;

  status := v_version.status;

  quote_kind := v_version.quote_kind;

  store_file_id := v_version.store_file_id;

  storage_bucket := v_version.storage_bucket;

  storage_path := v_version.storage_path;

  original_filename := v_version.original_filename;

  mime_type := v_version.mime_type;

  size_bytes := v_version.size_bytes;

  quote_snapshot := v_version.quote_snapshot;

  created_at := v_version.created_at;

  sent_at := v_version.sent_at;



  return next;

end;

$function$;



alter function public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid

) owner to postgres;



comment on function public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid

) is

  'Approves the current scoped sales quote version without setting sent_at.';



revoke all on function public.create_sales_quote_version_by_system(

  uuid, uuid, uuid, text, text, text, uuid, text, text, text, text, integer, jsonb

) from public;



revoke all on function public.create_sales_quote_version_by_system(

  uuid, uuid, uuid, text, text, text, uuid, text, text, text, text, integer, jsonb

) from anon;



revoke all on function public.create_sales_quote_version_by_system(

  uuid, uuid, uuid, text, text, text, uuid, text, text, text, text, integer, jsonb

) from authenticated;



grant execute on function public.create_sales_quote_version_by_system(

  uuid, uuid, uuid, text, text, text, uuid, text, text, text, text, integer, jsonb

) to service_role;



revoke all on function public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid

) from public;



revoke all on function public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid

) from anon;



revoke all on function public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid

) from authenticated;



grant execute on function public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid

) to service_role;



revoke all on function public.enforce_sales_quote_version_immutability_by_system()

  from public;

revoke all on function public.enforce_sales_quote_version_immutability_by_system()

  from anon;

revoke all on function public.enforce_sales_quote_version_immutability_by_system()

  from authenticated;



do $sales_quote_versions_policies$

declare

  v_policy record;

begin

  for v_policy in

    select policy_row.policyname

    from pg_catalog.pg_policies policy_row

    where policy_row.schemaname = 'public'

      and policy_row.tablename = 'sales_quote_versions'

  loop

    execute pg_catalog.format(

      'drop policy if exists %I on public.sales_quote_versions',

      v_policy.policyname

    );

  end loop;

end;

$sales_quote_versions_policies$;



drop policy if exists sales_quote_versions_select_by_active_membership

  on public.sales_quote_versions;



alter table public.sales_quote_versions enable row level security;



create policy sales_quote_versions_select_by_active_membership

on public.sales_quote_versions

for select

to authenticated

using (

  exists (

    select 1

    from public.memberships membership_row

    where membership_row.organization_id = sales_quote_versions.organization_id

      and membership_row.user_id = auth.uid()

      and coalesce(membership_row.is_active, false)

  )

);



revoke all privileges on table public.sales_quote_versions from public;

revoke all privileges on table public.sales_quote_versions from anon;

revoke all privileges on table public.sales_quote_versions from authenticated;

revoke all privileges on table public.sales_quote_versions from service_role;



grant select on table public.sales_quote_versions to authenticated;

grant select on table public.sales_quote_versions to service_role;



do $verify$

declare

  v_writer_definition text;

  v_approval_definition text;

  v_role text;

  v_privilege text;

begin

  if not exists (

    select 1

    from pg_catalog.pg_indexes index_row

    where index_row.schemaname = 'public'

      and index_row.tablename = 'sales_quote_versions'

      and index_row.indexname = 'sales_quote_versions_quote_id_version_number_uidx'

      and index_row.indexdef like '%UNIQUE INDEX%'

      and index_row.indexdef like '%(quote_id, version_number)%'

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: quote/version_number unique index missing';

  end if;



  select pg_catalog.pg_get_functiondef(proc_row.oid)

  into v_writer_definition

  from pg_catalog.pg_proc proc_row

  join pg_catalog.pg_namespace namespace_row

    on namespace_row.oid = proc_row.pronamespace

  where namespace_row.nspname = 'public'

    and proc_row.proname = 'create_sales_quote_version_by_system'

    and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =

      'p_organization_id uuid, p_store_id uuid, p_quote_id uuid, p_version_status text, p_next_quote_status text, p_quote_kind text, p_store_file_id uuid, p_storage_bucket text, p_storage_path text, p_original_filename text, p_mime_type text, p_size_bytes integer, p_quote_snapshot jsonb'

    and proc_row.prosecdef is true;



  if v_writer_definition is null then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: create_sales_quote_version_by_system missing or not security definer';

  end if;



  if v_writer_definition not ilike '%for update%' then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: version writer does not lock the quote';

  end if;



  if has_function_privilege(

    'authenticated',

    'public.create_sales_quote_version_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,integer,jsonb)',

    'execute'

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: authenticated can execute sales quote version writer';

  end if;



  if not has_function_privilege(

    'service_role',

    'public.create_sales_quote_version_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,integer,jsonb)',

    'execute'

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: service_role cannot execute sales quote version writer';

  end if;



  select pg_catalog.pg_get_functiondef(proc_row.oid)

  into v_approval_definition

  from pg_catalog.pg_proc proc_row

  join pg_catalog.pg_namespace namespace_row

    on namespace_row.oid = proc_row.pronamespace

  where namespace_row.nspname = 'public'

    and proc_row.proname = 'approve_sales_quote_version_by_system'

    and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =

      'p_organization_id uuid, p_store_id uuid, p_quote_id uuid, p_sales_quote_version_id uuid'

    and proc_row.prosecdef is true;



  if v_approval_definition is null

     or v_approval_definition not ilike '%sent_at%'

     or v_approval_definition ilike '%sent_at =%' then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: approve_sales_quote_version_by_system contract mismatch';

  end if;



  if has_function_privilege(

    'authenticated',

    'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid)',

    'execute'

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: authenticated can execute sales quote approval writer';

  end if;



  if not has_function_privilege(

    'service_role',

    'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid)',

    'execute'

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: service_role cannot execute sales quote approval writer';

  end if;



  if exists (

    select 1

    from pg_catalog.pg_class class_row

    join pg_catalog.pg_namespace namespace_row

      on namespace_row.oid = class_row.relnamespace

    cross join pg_catalog.aclexplode(

      coalesce(

        class_row.relacl,

        pg_catalog.acldefault('r', class_row.relowner)

      )

    ) acl_row

    where namespace_row.nspname = 'public'

      and class_row.relname = 'sales_quote_versions'

      and acl_row.grantee = 0

      and acl_row.privilege_type in (

        'INSERT',

        'UPDATE',

        'DELETE',

        'TRUNCATE'

      )

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: public has write privilege on sales_quote_versions';

  end if;



  foreach v_role in array array['anon', 'authenticated', 'service_role']

  loop

    foreach v_privilege in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']

    loop

      if has_table_privilege(v_role, 'public.sales_quote_versions', v_privilege) then

        raise exception using

          errcode = 'P0001',

          message = pg_catalog.format(

            'postcondition failed: %s has %s on sales_quote_versions',

            v_role,

            v_privilege

          );

      end if;

    end loop;

  end loop;



  if has_table_privilege('anon', 'public.sales_quote_versions', 'SELECT') then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: anon can select sales_quote_versions';

  end if;



  if not has_table_privilege('authenticated', 'public.sales_quote_versions', 'SELECT')

     or not has_table_privilege('service_role', 'public.sales_quote_versions', 'SELECT') then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: required sales_quote_versions SELECT grant missing';

  end if;



  if exists (

    select 1

    from pg_catalog.pg_policies policy_row

    where policy_row.schemaname = 'public'

      and policy_row.tablename = 'sales_quote_versions'

      and (

        policy_row.cmd <> 'SELECT'

        or policy_row.policyname <> 'sales_quote_versions_select_by_active_membership'

      )

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: sales_quote_versions has unexpected RLS policy';

  end if;



  if not exists (

    select 1

    from pg_catalog.pg_policies policy_row

    where policy_row.schemaname = 'public'

      and policy_row.tablename = 'sales_quote_versions'

      and policy_row.policyname = 'sales_quote_versions_select_by_active_membership'

      and policy_row.cmd = 'SELECT'

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: sales_quote_versions select policy missing';

  end if;

end;

$verify$;



commit;

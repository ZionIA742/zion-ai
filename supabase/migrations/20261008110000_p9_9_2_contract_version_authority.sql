-- ZION / P9 / 9.2-B1
-- Contract-version authority: scoped history, immutable content, and atomic writer.
-- IMPORTANT: install together with / immediately before 9.2-B2 route cutover.
-- The pre-B2 route still performs direct version INSERT/current-pointer orchestration
-- and attempts DELETE rollback; the append-only guard below intentionally rejects DELETE.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    '20261008110000_p9_9_2_contract_version_authority',
    0
  )
);

do $preflight$
begin
  if to_regclass('public.sales_contracts') is null
     or to_regclass('public.sales_contract_versions') is null
     or to_regclass('public.store_files') is null
     or to_regclass('public.store_contract_templates') is null
     or to_regclass('public.store_contract_template_versions') is null
     or to_regclass('public.store_contract_template_extracted_rules') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_9_2_REQUIRED_TABLES_MISSING';
  end if;

  if to_regprocedure(
       'public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_9_2_CURRENT_PROPOSAL_AUTHORITY_MISSING';
  end if;

  if exists (
    select 1
    from public.sales_contract_versions v
    left join public.sales_contracts c
      on c.id = v.contract_id
    where c.id is null
       or v.organization_id is distinct from c.organization_id
       or v.store_id is distinct from c.store_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_9_2_VERSION_SCOPE_INVALID';
  end if;

  if exists (
    select 1
    from public.sales_contracts c
    left join public.sales_contract_versions v
      on v.id = c.current_version_id
    where c.current_version_id is not null
      and (
        v.id is null
        or v.contract_id is distinct from c.id
        or v.organization_id is distinct from c.organization_id
        or v.store_id is distinct from c.store_id
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_9_2_CURRENT_VERSION_INVALID';
  end if;

  if exists (
    select 1
    from public.sales_contract_versions
    group by contract_id, version_number
    having count(*) > 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_9_2_DUPLICATE_VERSION_NUMBER';
  end if;

  if exists (
    select 1
    from public.sales_contract_versions
    where contract_snapshot is null
       or jsonb_typeof(contract_snapshot) <> 'object'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_9_2_INVALID_CONTRACT_SNAPSHOT';
  end if;
end;
$preflight$;

alter table public.sales_contracts
  add constraint sales_contracts_id_organization_store_key
  unique (id, organization_id, store_id);

alter table public.sales_contract_versions
  add constraint sales_contract_versions_id_contract_scope_key
  unique (id, contract_id, organization_id, store_id);

do $drop_old_fks$
declare
  r record;
begin
  for r in
    select con.conname, con.conrelid::regclass as rel
    from pg_constraint con
    where con.contype = 'f'
      and con.confrelid = 'public.sales_contracts'::regclass
      and con.conrelid = 'public.sales_contract_versions'::regclass
      and con.conkey = array[
        (
          select attnum
          from pg_attribute
          where attrelid = con.conrelid
            and attname = 'contract_id'
        )
      ]
  loop
    execute format(
      'alter table %s drop constraint %I',
      r.rel,
      r.conname
    );
  end loop;

  for r in
    select con.conname, con.conrelid::regclass as rel
    from pg_constraint con
    where con.contype = 'f'
      and con.conrelid = 'public.sales_contracts'::regclass
      and con.conkey = array[
        (
          select attnum
          from pg_attribute
          where attrelid = con.conrelid
            and attname = 'current_version_id'
        )
      ]
  loop
    execute format(
      'alter table %s drop constraint %I',
      r.rel,
      r.conname
    );
  end loop;
end;
$drop_old_fks$;

alter table public.sales_contract_versions
  add constraint sales_contract_versions_contract_scope_fkey
  foreign key (contract_id, organization_id, store_id)
  references public.sales_contracts (id, organization_id, store_id)
  on delete restrict;

alter table public.sales_contracts
  add constraint sales_contracts_current_version_scope_fkey
  foreign key (current_version_id, id, organization_id, store_id)
  references public.sales_contract_versions (
    id,
    contract_id,
    organization_id,
    store_id
  )
  on delete restrict;

alter table public.sales_contract_versions
  add column operation_key text,
  add column request_fingerprint text,
  add column content_fingerprint text,
  add column pdf_sha256 text;

alter table public.sales_contract_versions
  add constraint sales_contract_versions_operation_key_check
    check (
      operation_key is null
      or (
        btrim(operation_key) <> ''
        and length(operation_key) <= 200
      )
    ),
  add constraint sales_contract_versions_request_fingerprint_check
    check (
      request_fingerprint is null
      or request_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  add constraint sales_contract_versions_content_fingerprint_check
    check (
      content_fingerprint is null
      or content_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  add constraint sales_contract_versions_pdf_sha256_check
    check (
      pdf_sha256 is null
      or pdf_sha256 ~ '^[0-9a-f]{64}$'
    ),
  add constraint sales_contract_versions_authority_shape_check
    check (
      (
        operation_key is null
        and request_fingerprint is null
        and content_fingerprint is null
        and pdf_sha256 is null
      )
      or
      (
        operation_key is not null
        and request_fingerprint is not null
        and content_fingerprint is not null
        and pdf_sha256 is not null
      )
    );

create unique index sales_contract_versions_contract_operation_uidx
  on public.sales_contract_versions (contract_id, operation_key)
  where operation_key is not null;

create unique index sales_contract_versions_contract_content_uidx
  on public.sales_contract_versions (contract_id, content_fingerprint)
  where content_fingerprint is not null;

create or replace function public.p9_guard_sales_contract_version_immutability()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'P9_9_2_CONTRACT_VERSION_DELETE_FORBIDDEN';
  end if;

  if new.id is distinct from old.id
     or new.contract_id is distinct from old.contract_id
     or new.organization_id is distinct from old.organization_id
     or new.store_id is distinct from old.store_id
     or new.version_number is distinct from old.version_number
     or new.store_file_id is distinct from old.store_file_id
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path
     or new.original_filename is distinct from old.original_filename
     or new.mime_type is distinct from old.mime_type
     or new.size_bytes is distinct from old.size_bytes
     or new.generated_by is distinct from old.generated_by
     or new.generated_at is distinct from old.generated_at
     or new.contract_snapshot is distinct from old.contract_snapshot
     or new.created_at is distinct from old.created_at
     or new.operation_key is distinct from old.operation_key
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.content_fingerprint is distinct from old.content_fingerprint
     or new.pdf_sha256 is distinct from old.pdf_sha256
     or new.metadata is distinct from old.metadata then
    raise exception using
      errcode = 'P0001',
      message = 'P9_9_2_CONTRACT_VERSION_IMMUTABLE_FIELD';
  end if;

  return new;
end;
$function$;

alter function public.p9_guard_sales_contract_version_immutability()
  owner to postgres;

revoke all
  on function public.p9_guard_sales_contract_version_immutability()
  from public, anon, authenticated, service_role;

drop trigger if exists p9_sales_contract_version_immutability_guard
  on public.sales_contract_versions;

create trigger p9_sales_contract_version_immutability_guard
before update or delete
on public.sales_contract_versions
for each row
execute function public.p9_guard_sales_contract_version_immutability();

revoke truncate
  on table public.sales_contract_versions
  from service_role;

-- DELETE remains granted temporarily because pre-B2 application code still has a
-- best-effort delete rollback path. The trigger rejects every version DELETE.
-- B2 must remove that route rollback and can then tighten grants further.

create or replace function public.create_sales_contract_version_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_contract_id uuid,
  p_operation_key text,
  p_request_fingerprint text,
  p_content_fingerprint text,
  p_store_file_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_pdf_sha256 text,
  p_contract_snapshot jsonb
)
returns table (
  id uuid,
  contract_id uuid,
  organization_id uuid,
  store_id uuid,
  version_number integer,
  status text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_contract public.sales_contracts%rowtype;
  v_existing public.sales_contract_versions%rowtype;
  v_version public.sales_contract_versions%rowtype;
  v_template public.store_contract_templates%rowtype;
  v_template_version public.store_contract_template_versions%rowtype;

  v_operation_key text := nullif(btrim(p_operation_key), '');
  v_storage_bucket text := nullif(btrim(p_storage_bucket), '');
  v_storage_path text := nullif(btrim(p_storage_path), '');
  v_original_filename text := nullif(btrim(p_original_filename), '');
  v_mime_type text := lower(nullif(btrim(p_mime_type), ''));

  v_guard_state text;
  v_request_role text;
  v_next integer;
  v_rules jsonb;
  v_snapshot_stable jsonb;
  v_existing_snapshot_stable jsonb;
begin
  v_request_role :=
    nullif(
      current_setting('request.jwt.claim.role', true),
      ''
    );

  if v_request_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'P9_9_2_UNAUTHORIZED_CALLER';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_contract_id is null
     or v_operation_key is null
     or length(v_operation_key) > 200
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
     or p_content_fingerprint is null
     or p_content_fingerprint !~ '^[0-9a-f]{64}$'
     or p_pdf_sha256 is null
     or p_pdf_sha256 !~ '^[0-9a-f]{64}$'
     or p_store_file_id is null
     or v_storage_bucket is null
     or v_storage_path is null
     or v_original_filename is null
     or v_mime_type <> 'application/pdf'
     or p_size_bytes is null
     or p_size_bytes <= 0
     or p_contract_snapshot is null
     or jsonb_typeof(p_contract_snapshot) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'P9_9_2_INVALID_VERSION_ARGUMENTS';
  end if;

  select c.*
  into v_contract
  from public.sales_contracts c
  where c.id = p_contract_id
    and c.organization_id = p_organization_id
    and c.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'P9_9_2_CONTRACT_NOT_FOUND';
  end if;

  -- The storage artifact is part of the version identity. Validate scope and
  -- metadata instead of trusting a globally valid store_file_id.
  if not exists (
    select 1
    from public.store_files sf
    where sf.id = p_store_file_id
      and sf.organization_id = p_organization_id
      and sf.store_id = p_store_id
      and sf.file_kind = 'sales_contract_pdf'
      and btrim(sf.storage_bucket) = v_storage_bucket
      and btrim(sf.storage_path) = v_storage_path
      and btrim(sf.original_filename) = v_original_filename
      and lower(btrim(sf.mime_type)) = v_mime_type
      and sf.size_bytes = p_size_bytes
  ) then
    raise exception using
      errcode = '23514',
      message = 'P9_9_2_STORE_FILE_SCOPE_INVALID';
  end if;

  -- Validate the stable V2 envelope and the duplicated renderer lineage before
  -- any replay branch. The DB does not recalculate the application JSON hash,
  -- but it rejects inconsistent identity/lineage and stores the hash immutably.
  if p_contract_snapshot->>'schema'
       is distinct from 'zion.sales_contract_snapshot.v2'
     or jsonb_typeof(p_contract_snapshot->'identity') <> 'object'
     or jsonb_typeof(p_contract_snapshot->'lineage') <> 'object'
     or jsonb_typeof(p_contract_snapshot->'template_authority') <> 'object'
     or jsonb_typeof(p_contract_snapshot->'renderer_input') <> 'object'
     or jsonb_typeof(
          p_contract_snapshot->'renderer_input'->'identity'
        ) <> 'object'
     or jsonb_typeof(
          p_contract_snapshot->'renderer_input'->'templateAuthority'
        ) <> 'object'
     or nullif(btrim(p_contract_snapshot->>'materialized_at'), '') is null
     or p_contract_snapshot->>'content_fingerprint'
          is distinct from p_content_fingerprint
     or p_contract_snapshot->'identity'->>'contract_id'
          is distinct from p_contract_id::text
     or p_contract_snapshot->'identity'->>'organization_id'
          is distinct from p_organization_id::text
     or p_contract_snapshot->'identity'->>'store_id'
          is distinct from p_store_id::text
     or p_contract_snapshot->'lineage'->>'quote_id'
          is distinct from v_contract.quote_id::text
     or p_contract_snapshot->'lineage'->>'quote_version_id'
          is distinct from v_contract.quote_version_id::text
     or p_contract_snapshot->'renderer_input'->'identity'->>'contractId'
          is distinct from p_contract_id::text
     or p_contract_snapshot->'renderer_input'->'identity'->>'organizationId'
          is distinct from p_organization_id::text
     or p_contract_snapshot->'renderer_input'->'identity'->>'storeId'
          is distinct from p_store_id::text
     or p_contract_snapshot->'renderer_input'->'identity'->>'quoteId'
          is distinct from v_contract.quote_id::text
     or p_contract_snapshot->'renderer_input'->'identity'->>'quoteVersionId'
          is distinct from v_contract.quote_version_id::text
     or (
       nullif(
         btrim(v_contract.metadata->>'commercial_opportunity_id'),
         ''
       ) is not null
       and p_contract_snapshot->'lineage'->>'commercial_opportunity_id'
             is distinct from
             nullif(
               btrim(v_contract.metadata->>'commercial_opportunity_id'),
               ''
             )
     )
     or (
       nullif(
         btrim(v_contract.metadata->>'proposal_acceptance_event_id'),
         ''
       ) is not null
       and p_contract_snapshot->'lineage'->>'proposal_acceptance_event_id'
             is distinct from
             nullif(
               btrim(v_contract.metadata->>'proposal_acceptance_event_id'),
               ''
             )
     ) then
    raise exception using
      errcode = '23514',
      message = 'P9_9_2_SNAPSHOT_AUTHORITY_INVALID';
  end if;

  v_snapshot_stable :=
    p_contract_snapshot - 'materialized_at';

  -- Same logical attempt: replay the existing durable version when the stable
  -- request/content identity is unchanged. A retry may have produced another
  -- temporary storage object or a fresh materialized_at; those are not allowed
  -- to turn a successful logical attempt into a false conflict.
  select v.*
  into v_existing
  from public.sales_contract_versions v
  where v.contract_id = p_contract_id
    and v.operation_key = v_operation_key;

  if found then
    v_existing_snapshot_stable :=
      v_existing.contract_snapshot - 'materialized_at';

    if v_existing.request_fingerprint
         is distinct from p_request_fingerprint
       or v_existing.content_fingerprint
         is distinct from p_content_fingerprint
       or v_existing_snapshot_stable
         is distinct from v_snapshot_stable then
      raise exception using
        errcode = '23505',
        message = 'P9_9_2_OPERATION_KEY_CONFLICT';
    end if;

    return query
    select
      v_existing.id,
      v_existing.contract_id,
      v_existing.organization_id,
      v_existing.store_id,
      v_existing.version_number,
      v_existing.status,
      true;
    return;
  end if;

  -- New logical operation must still be current at the commercial authority.
  select guard_state
  into v_guard_state
  from public.p9_assert_sales_contract_current_proposal_lineage_internal(
    p_organization_id,
    p_store_id,
    p_contract_id
  );

  if v_guard_state is distinct from 'current' then
    raise exception using
      errcode = 'P0001',
      message = 'P9_9_2_CURRENT_PROPOSAL_NOT_CURRENT';
  end if;

  select t.*
  into v_template
  from public.store_contract_templates t
  where t.id::text =
        nullif(
          btrim(
            p_contract_snapshot
              ->'template_authority'
              ->>'template_id'
          ),
          ''
        )
    and t.organization_id = p_organization_id
    and t.store_id = p_store_id
    and t.status = 'active'
    and t.active_version_id::text =
        nullif(
          btrim(
            p_contract_snapshot
              ->'template_authority'
              ->>'template_version_id'
          ),
          ''
        );

  if not found then
    raise exception using
      errcode = '23514',
      message = 'P9_9_2_TEMPLATE_AUTHORITY_INVALID';
  end if;

  select tv.*
  into v_template_version
  from public.store_contract_template_versions tv
  where tv.id = v_template.active_version_id
    and tv.template_id = v_template.id
    and tv.organization_id = p_organization_id
    and tv.store_id = p_store_id
    and tv.status = 'active';

  if not found then
    raise exception using
      errcode = '23514',
      message = 'P9_9_2_TEMPLATE_VERSION_INVALID';
  end if;

  v_rules :=
    p_contract_snapshot
      ->'template_authority'
      ->'rules';

  if jsonb_typeof(v_rules) <> 'array'
     or jsonb_array_length(v_rules) = 0
     or (
       p_contract_snapshot
         ->'template_authority'
         ->>'template_version_number'
     ) is distinct from v_template_version.version_number::text
     or (
       p_contract_snapshot
         ->'renderer_input'
         ->'templateAuthority'
         ->>'templateId'
     ) is distinct from v_template.id::text
     or (
       p_contract_snapshot
         ->'renderer_input'
         ->'templateAuthority'
         ->>'templateVersionId'
     ) is distinct from v_template_version.id::text
     or (
       p_contract_snapshot
         ->'renderer_input'
         ->'templateAuthority'
         ->>'templateVersionNumber'
     ) is distinct from v_template_version.version_number::text
     or (
       p_contract_snapshot
         ->'renderer_input'
         ->'templateAuthority'
         ->'rules'
     ) is distinct from v_rules then
    raise exception using
      errcode = '23514',
      message = 'P9_9_2_TEMPLATE_AUTHORITY_SNAPSHOT_MISMATCH';
  end if;

  if nullif(
       btrim(
         p_contract_snapshot
           ->'renderer_input'
           ->'templateAuthority'
           ->>'clauses'
       ),
       ''
     ) is null
     or lower(
          btrim(
            p_contract_snapshot
              ->'renderer_input'
              ->'templateAuthority'
              ->>'clauses'
          )
        ) = 'a definir pela loja.' then
    raise exception using
      errcode = '23514',
      message = 'P9_9_2_TEMPLATE_CLAUSES_INVALID';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(v_rules) r
  ) <> (
    select count(distinct r->>'rule_id')
    from jsonb_array_elements(v_rules) r
  ) then
    raise exception using
      errcode = '23514',
      message = 'P9_9_2_TEMPLATE_RULES_DUPLICATED';
  end if;

  -- 9.2-A sanitizes value_text before it enters renderer_input/snapshot.
  -- Reimplementing that text sanitizer in SQL would create a second authority.
  -- Therefore SQL validates rule identity, scope, final review state and the
  -- immutable metadata copied from the canonical row, while requiring the
  -- sanitized snapshot value_text to be non-empty.
  if exists (
    select 1
    from jsonb_array_elements(v_rules) r
    left join public.store_contract_template_extracted_rules er
      on er.id::text = r->>'rule_id'
     and er.template_version_id = v_template_version.id
     and er.organization_id = p_organization_id
     and er.store_id = p_store_id
    where jsonb_typeof(r) <> 'object'
       or er.id is null
       or lower(btrim(coalesce(r->>'review_status', '')))
            not in ('approved', 'edited')
       or lower(btrim(coalesce(er.review_status, '')))
            not in ('approved', 'edited')
       or lower(btrim(coalesce(r->>'review_status', '')))
            is distinct from
            lower(btrim(coalesce(er.review_status, '')))
       or nullif(btrim(r->>'value_text'), '') is null
       or r->>'rule_key' is distinct from er.rule_key
       or r->>'rule_group' is distinct from er.rule_group
       or r->>'label' is distinct from er.label
       or r->>'sort_order'
            is distinct from
            case
              when er.sort_order is null then null
              else er.sort_order::text
            end
  ) then
    raise exception using
      errcode = '23514',
      message = 'P9_9_2_TEMPLATE_RULES_INVALID';
  end if;

  -- Equivalent canonical content under another operation reuses the existing
  -- durable version. A hash collision / forged duplicate is rejected if the
  -- stable snapshot differs.
  select v.*
  into v_existing
  from public.sales_contract_versions v
  where v.contract_id = p_contract_id
    and v.content_fingerprint = p_content_fingerprint;

  if found then
    v_existing_snapshot_stable :=
      v_existing.contract_snapshot - 'materialized_at';

    if v_existing_snapshot_stable
         is distinct from v_snapshot_stable then
      raise exception using
        errcode = '23505',
        message = 'P9_9_2_CONTENT_FINGERPRINT_CONFLICT';
    end if;

    return query
    select
      v_existing.id,
      v_existing.contract_id,
      v_existing.organization_id,
      v_existing.store_id,
      v_existing.version_number,
      v_existing.status,
      true;
    return;
  end if;

  select coalesce(max(version_number), 0) + 1
  into v_next
  from public.sales_contract_versions
  where contract_id = p_contract_id;

  insert into public.sales_contract_versions (
    contract_id,
    organization_id,
    store_id,
    version_number,
    status,
    store_file_id,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    generated_by,
    generated_at,
    contract_snapshot,
    operation_key,
    request_fingerprint,
    content_fingerprint,
    pdf_sha256
  )
  values (
    p_contract_id,
    p_organization_id,
    p_store_id,
    v_next,
    'generated',
    p_store_file_id,
    v_storage_bucket,
    v_storage_path,
    v_original_filename,
    'application/pdf',
    p_size_bytes,
    'system',
    clock_timestamp(),
    p_contract_snapshot,
    v_operation_key,
    p_request_fingerprint,
    p_content_fingerprint,
    p_pdf_sha256
  )
  returning *
  into v_version;

  update public.sales_contracts
  set current_version_id = v_version.id
  where id = p_contract_id
    and organization_id = p_organization_id
    and store_id = p_store_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'P9_9_2_CURRENT_VERSION_UPDATE_FAILED';
  end if;

  return query
  select
    v_version.id,
    v_version.contract_id,
    v_version.organization_id,
    v_version.store_id,
    v_version.version_number,
    v_version.status,
    false;
end;
$function$;

alter function public.create_sales_contract_version_by_system(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  text,
  jsonb
)
owner to postgres;

revoke all
  on function public.create_sales_contract_version_by_system(
    uuid,
    uuid,
    uuid,
    text,
    text,
    text,
    uuid,
    text,
    text,
    text,
    text,
    bigint,
    text,
    jsonb
  )
  from public, anon, authenticated;

grant execute
  on function public.create_sales_contract_version_by_system(
    uuid,
    uuid,
    uuid,
    text,
    text,
    text,
    uuid,
    text,
    text,
    text,
    text,
    bigint,
    text,
    jsonb
  )
  to service_role;

comment on function public.create_sales_contract_version_by_system(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  text,
  jsonb
) is
  'P9 9.2-B1 atomic canonical contract-version writer. operation_key identifies the logical attempt; request/content fingerprints are stable request/content identities. The V2 snapshot and PDF hash originate in 9.2-A. SQL validates scoped storage, snapshot lineage, active template/version, authorized rule identity/metadata, immutable history and atomic current_version advancement without reimplementing the TypeScript sanitizer/hash canonicalization.';

commit;

begin;

do $preconditions$
declare
  v_missing text[] := '{}'::text[];
begin
  if pg_catalog.to_regclass('public.commercial_opportunities') is null then
    v_missing := pg_catalog.array_append(v_missing, 'public.commercial_opportunities');
  end if;

  if pg_catalog.to_regclass('public.sales_quotes') is null then
    v_missing := pg_catalog.array_append(v_missing, 'public.sales_quotes');
  end if;

  if pg_catalog.to_regclass('public.sales_quote_versions') is null then
    v_missing := pg_catalog.array_append(v_missing, 'public.sales_quote_versions');
  end if;

  if pg_catalog.to_regclass('public.messages') is null then
    v_missing := pg_catalog.array_append(v_missing, 'public.messages');
  end if;

  if pg_catalog.to_regclass('public.customers') is null then
    v_missing := pg_catalog.array_append(v_missing, 'public.customers');
  end if;

  if pg_catalog.to_regclass('public.memberships') is null then
    v_missing := pg_catalog.array_append(v_missing, 'public.memberships');
  end if;

  if pg_catalog.to_regprocedure(
       'public.assert_commercial_opportunity_message_evidence(uuid,uuid,uuid,uuid,uuid)'
     ) is null then
    v_missing := pg_catalog.array_append(
      v_missing,
      'public.assert_commercial_opportunity_message_evidence(uuid,uuid,uuid,uuid,uuid)'
    );
  end if;

  if pg_catalog.to_regprocedure(
       'public.read_current_commercial_proposal_by_system(uuid,uuid,uuid)'
     ) is null then
    v_missing := pg_catalog.array_append(
      v_missing,
      'public.read_current_commercial_proposal_by_system(uuid,uuid,uuid)'
    );
  end if;
  if coalesce(pg_catalog.array_length(v_missing, 1), 0) > 0 then
    raise exception using
      errcode = 'P0001',
      message =
        'P9 6.8 precondition failed: '
        || pg_catalog.array_to_string(v_missing, ', ');
  end if;
end;
$preconditions$;

create table public.commercial_proposal_acceptance_events (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,
  store_id uuid not null,

  commercial_opportunity_id uuid not null,

  customer_id uuid not null,

  lifecycle_cycle integer not null
    check (lifecycle_cycle >= 1),

  quote_id uuid not null,

  quote_version_id uuid not null,

  source_message_id uuid not null
    references public.messages(id)
    on update no action
    on delete restrict,

  constraint commercial_proposal_acceptance_events_customer_scope_fk
    foreign key (
      customer_id,
      organization_id
    )
    references public.customers (
      id,
      organization_id
    )
    on update no action
    on delete restrict,

  constraint commercial_proposal_acceptance_events_opportunity_scope_fk
    foreign key (
      commercial_opportunity_id,
      organization_id,
      store_id,
      customer_id
    )
    references public.commercial_opportunities (
      id,
      organization_id,
      store_id,
      customer_id
    )
    on update no action
    on delete restrict,

  constraint commercial_proposal_acceptance_events_quote_scope_fk
    foreign key (
      quote_id,
      commercial_opportunity_id,
      organization_id,
      store_id
    )
    references public.sales_quotes (
      id,
      commercial_opportunity_id,
      organization_id,
      store_id
    )
    on update no action
    on delete restrict,

  constraint commercial_proposal_acceptance_events_quote_version_scope_fk
    foreign key (
      quote_version_id,
      quote_id,
      organization_id,
      store_id
    )
    references public.sales_quote_versions (
      id,
      quote_id,
      organization_id,
      store_id
    )
    on update no action
    on delete restrict,

  signal_kind text not null default 'customer_accepted_quote'
    check (signal_kind = 'customer_accepted_quote'),

  customer_signal_at timestamptz not null,

  confirmed_by_user_id uuid not null,
  accepted_at timestamptz not null default pg_catalog.clock_timestamp(),

  created_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint commercial_proposal_acceptance_events_exact_proposal_uidx
    unique (
      organization_id,
      store_id,
      commercial_opportunity_id,
      lifecycle_cycle,
      quote_id,
      quote_version_id
    )
);

create index commercial_proposal_acceptance_events_opportunity_idx
  on public.commercial_proposal_acceptance_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    lifecycle_cycle
  );

create index commercial_proposal_acceptance_events_quote_version_idx
  on public.commercial_proposal_acceptance_events (
    organization_id,
    store_id,
    quote_id,
    quote_version_id
  );

create index commercial_proposal_acceptance_events_source_message_idx
  on public.commercial_proposal_acceptance_events (
    organization_id,
    store_id,
    source_message_id
  );

alter table public.commercial_proposal_acceptance_events
  enable row level security;

revoke all on table public.commercial_proposal_acceptance_events
  from public, anon, authenticated, service_role;


create or replace function public.prevent_commercial_proposal_acceptance_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp, public
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_APPEND_ONLY';
end;
$function$;

alter function public.prevent_commercial_proposal_acceptance_event_mutation()
  owner to postgres;

revoke all on function public.prevent_commercial_proposal_acceptance_event_mutation()
  from public, anon, authenticated, service_role;

create trigger commercial_proposal_acceptance_events_append_only
before update or delete
on public.commercial_proposal_acceptance_events
for each row
execute function public.prevent_commercial_proposal_acceptance_event_mutation();


create or replace function public.accept_current_commercial_proposal_customer_signal_by_user(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_expected_lifecycle_cycle integer,
  p_quote_id uuid,
  p_quote_version_id uuid,
  p_source_message_id uuid
)
returns table (
  acceptance_event_id uuid,
  commercial_opportunity_id uuid,
  lifecycle_cycle integer,
  quote_id uuid,
  quote_version_id uuid,
  source_message_id uuid,
  customer_signal_at timestamptz,
  confirmed_by_user_id uuid,
  accepted_at timestamptz,
  outcome text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();

  v_request_role text :=
    coalesce(
      nullif(
        pg_catalog.current_setting('request.jwt.claim.role', true),
        ''
      ),
      nullif(auth.jwt() ->> 'role', '')
    );

  v_opportunity public.commercial_opportunities%rowtype;
  v_quote public.sales_quotes%rowtype;
  v_quote_version public.sales_quote_versions%rowtype;
  v_message public.messages%rowtype;
  v_existing public.commercial_proposal_acceptance_events%rowtype;
begin
  if v_user_id is null
     or v_request_role is distinct from 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'commercial proposal acceptance by user is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_expected_lifecycle_cycle is null
     or p_expected_lifecycle_cycle < 1
     or p_quote_id is null
     or p_quote_version_id is null
     or p_source_message_id is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_ARGUMENTS_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_organization_id
      and membership_row.user_id = v_user_id
      and membership_row.is_active is true
  ) then
    raise exception using
      errcode = '42501',
      message = 'commercial proposal acceptance by user is not authorized';
  end if;

  /*
   * Autoridade concorrente:
   * o mesmo row lock usado pela Current Commercial Proposal serializa
   * aceite versus novo envio/projecao da proposta vigente.
   */
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

  if v_opportunity.customer_id is null then
    raise exception using
      errcode = '23514',
      message = 'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_CUSTOMER_REQUIRED';
  end if;

  if v_opportunity.lifecycle_cycle is distinct from p_expected_lifecycle_cycle then
    raise exception using
      errcode = '23514',
      message = 'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_LIFECYCLE_STALE';
  end if;

  /*
   * P9 6.7 deliberadamente considera lifecycle > 1 não ancorado:
   * o pointer atual ainda não prova a qual ciclo a proposta pertence.
   * Acceptance não pode enfraquecer essa authority upstream.
   */
  if v_opportunity.lifecycle_cycle > 1 then
    raise exception using
      errcode = '23514',
      message = 'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_CURRENT_PROPOSAL_CYCLE_UNANCHORED';
  end if;

  if v_opportunity.current_quote_id is null
     or v_opportunity.current_quote_version_id is null then
    raise exception using
      errcode = '23514',
      message = 'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_CURRENT_PROPOSAL_MISSING';
  end if;

  if v_opportunity.current_quote_id is distinct from p_quote_id
     or v_opportunity.current_quote_version_id is distinct from p_quote_version_id then
    raise exception using
      errcode = '23514',
      message = 'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_PROPOSAL_STALE';
  end if;

  select quote_row.*
  into v_quote
  from public.sales_quotes quote_row
  where quote_row.id = p_quote_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'sales quote not found';
  end if;

  if v_quote.organization_id is distinct from p_organization_id
     or v_quote.store_id is distinct from p_store_id
     or v_quote.commercial_opportunity_id is distinct from v_opportunity.id then
    raise exception using
      errcode = '23514',
      message = 'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_QUOTE_SCOPE_INVALID';
  end if;

  select version_row.*
  into v_quote_version
  from public.sales_quote_versions version_row
  where version_row.id = p_quote_version_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'sales quote version not found';
  end if;

  if v_quote_version.organization_id is distinct from p_organization_id
     or v_quote_version.store_id is distinct from p_store_id
     or v_quote_version.quote_id is distinct from v_quote.id then
    raise exception using
      errcode = '23514',
      message = 'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_VERSION_SCOPE_INVALID';
  end if;

  /*
   * Aceite so pode referenciar versao efetivamente apresentada.
   * Uma revisao posterior pode ter marcado a apresentada como superseded;
   * sent_at continua sendo a evidence canonica de apresentacao.
   */
  if v_quote_version.sent_at is null
     or pg_catalog.lower(
          pg_catalog.btrim(
            coalesce(v_quote_version.status, '')
          )
        ) not in ('sent', 'superseded') then
    raise exception using
      errcode = '23514',
      message = 'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_VERSION_NOT_SENT';
  end if;

  select message_row.*
  into v_message
  from public.messages message_row
  where message_row.id = p_source_message_id
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_MESSAGE_OUT_OF_SCOPE';
  end if;

  /*
   * O validator compartilhado prova customer/opportunity.
   * Aqui exigimos adicionalmente que a evidence seja realmente
   * uma mensagem inbound do cliente.
   */
  if pg_catalog.lower(
       pg_catalog.btrim(coalesce(v_message.sender, ''))
     ) <> 'user'
     or pg_catalog.lower(
          pg_catalog.btrim(coalesce(v_message.direction, ''))
        ) <> 'incoming' then
    raise exception using
      errcode = '23514',
      message = 'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_MESSAGE_NOT_CUSTOMER_INBOUND';
  end if;

  if v_message.created_at is null
     or v_message.created_at < v_quote_version.sent_at then
    raise exception using
      errcode = '23514',
      message = 'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_MESSAGE_PREDATES_PROPOSAL';
  end if;

  perform public.assert_commercial_opportunity_message_evidence(
    p_organization_id,
    p_store_id,
    v_opportunity.id,
    v_opportunity.customer_id,
    v_message.id
  );

  /*
   * Uma proposta exata so precisa de um primeiro aceite canonico.
   * Replays posteriores retornam o mesmo fato, sem duplicar evidence.
   */
  select acceptance_row.*
  into v_existing
  from public.commercial_proposal_acceptance_events acceptance_row
  where acceptance_row.organization_id = p_organization_id
    and acceptance_row.store_id = p_store_id
    and acceptance_row.commercial_opportunity_id = v_opportunity.id
    and acceptance_row.lifecycle_cycle = v_opportunity.lifecycle_cycle
    and acceptance_row.quote_id = v_quote.id
    and acceptance_row.quote_version_id = v_quote_version.id;

  if found then
    return query
    select
      v_existing.id,
      v_existing.commercial_opportunity_id,
      v_existing.lifecycle_cycle,
      v_existing.quote_id,
      v_existing.quote_version_id,
      v_existing.source_message_id,
      v_existing.customer_signal_at,
      v_existing.confirmed_by_user_id,
      v_existing.accepted_at,
      'already_accepted'::text;

    return;
  end if;

  insert into public.commercial_proposal_acceptance_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    customer_id,
    lifecycle_cycle,
    quote_id,
    quote_version_id,
    source_message_id,
    signal_kind,
    customer_signal_at,
    confirmed_by_user_id,
    accepted_at
  )
  values (
    p_organization_id,
    p_store_id,
    v_opportunity.id,
    v_opportunity.customer_id,
    v_opportunity.lifecycle_cycle,
    v_quote.id,
    v_quote_version.id,
    v_message.id,
    'customer_accepted_quote',
    v_message.created_at,
    v_user_id,
    pg_catalog.clock_timestamp()
  )
  returning *
  into v_existing;

  return query
  select
    v_existing.id,
    v_existing.commercial_opportunity_id,
    v_existing.lifecycle_cycle,
    v_existing.quote_id,
    v_existing.quote_version_id,
    v_existing.source_message_id,
    v_existing.customer_signal_at,
    v_existing.confirmed_by_user_id,
    v_existing.accepted_at,
    'accepted'::text;
end;
$function$;

alter function public.accept_current_commercial_proposal_customer_signal_by_user(
  uuid,
  uuid,
  uuid,
  integer,
  uuid,
  uuid,
  uuid
)
  owner to postgres;

revoke all on function public.accept_current_commercial_proposal_customer_signal_by_user(
  uuid,
  uuid,
  uuid,
  integer,
  uuid,
  uuid,
  uuid
)
  from public, anon, authenticated, service_role;

grant execute on function public.accept_current_commercial_proposal_customer_signal_by_user(
  uuid,
  uuid,
  uuid,
  integer,
  uuid,
  uuid,
  uuid
)
  to authenticated;


create or replace function public.read_current_commercial_proposal_acceptance_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  commercial_opportunity_id uuid,
  lifecycle_cycle integer,
  current_quote_id uuid,
  current_quote_version_id uuid,
  acceptance_state text,
  reason_code text,
  acceptance_event_id uuid,
  source_message_id uuid,
  customer_signal_at timestamptz,
  confirmed_by_user_id uuid,
  accepted_at timestamptz,
  stale_acceptance_count bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text :=
    coalesce(
      nullif(
        pg_catalog.current_setting('request.jwt.claim.role', true),
        ''
      ),
      nullif(auth.jwt() ->> 'role', '')
    );

  v_current_proposal record;
  v_acceptance public.commercial_proposal_acceptance_events%rowtype;
  v_stale_count bigint := 0;
begin
  if v_request_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message =
        'current commercial proposal acceptance reader is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message =
        'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_READER_ARGUMENTS_REQUIRED';
  end if;

  /*
   * Authority upstream:
   * P9 6.7 é a única responsável por decidir se a Current Commercial
   * Proposal existe, se o pointer é íntegro, se há evidence canônica
   * de envio e se o lifecycle possui lineage suficiente.
   *
   * A 6.8 não reinterpreta esses fatos.
   */
  select *
  into v_current_proposal
  from public.read_current_commercial_proposal_by_system(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  );

  if not found then
    raise exception using
      errcode = 'P0001',
      message =
        'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_CURRENT_PROPOSAL_READER_NO_ROW';
  end if;

  /*
   * Histórico é stale sempre que sua identidade não coincide
   * exatamente com lifecycle + quote + version definidos pela 6.7.
   */
  select pg_catalog.count(*)
  into v_stale_count
  from public.commercial_proposal_acceptance_events acceptance_row
  where acceptance_row.organization_id = p_organization_id
    and acceptance_row.store_id = p_store_id
    and acceptance_row.commercial_opportunity_id =
      p_commercial_opportunity_id
    and (
      acceptance_row.lifecycle_cycle
        is distinct from v_current_proposal.lifecycle_cycle
      or acceptance_row.quote_id
        is distinct from v_current_proposal.current_quote_id
      or acceptance_row.quote_version_id
        is distinct from v_current_proposal.current_quote_version_id
    );

  /*
   * Se a Current Commercial Proposal não está AVAILABLE,
   * acceptance não pode transformar ou suavizar esse estado.
   *
   * Propagamos diretamente a authority da 6.7.
   */
  if v_current_proposal.proposal_state is distinct from 'available' then
    return query
    select
      v_current_proposal.commercial_opportunity_id::uuid,
      v_current_proposal.lifecycle_cycle::integer,
      v_current_proposal.current_quote_id::uuid,
      v_current_proposal.current_quote_version_id::uuid,
      case
        when v_current_proposal.proposal_state in (
          'none',
          'conflict',
          'needs_resolution'
        )
          then v_current_proposal.proposal_state::text
        else 'conflict'::text
      end,
      case
        when v_current_proposal.proposal_state in (
          'none',
          'conflict',
          'needs_resolution'
        )
          then v_current_proposal.reason_code::text
        else 'current_proposal_upstream_state_unknown'::text
      end,
      null::uuid,
      null::uuid,
      null::timestamptz,
      null::uuid,
      null::timestamptz,
      v_stale_count;

    return;
  end if;

  /*
   * Somente proposal_state=available pode possuir acceptance vigente.
   * A identidade vem integralmente da 6.7.
   */
  select acceptance_row.*
  into v_acceptance
  from public.commercial_proposal_acceptance_events acceptance_row
  where acceptance_row.organization_id = p_organization_id
    and acceptance_row.store_id = p_store_id
    and acceptance_row.commercial_opportunity_id =
      v_current_proposal.commercial_opportunity_id
    and acceptance_row.lifecycle_cycle =
      v_current_proposal.lifecycle_cycle
    and acceptance_row.quote_id =
      v_current_proposal.current_quote_id
    and acceptance_row.quote_version_id =
      v_current_proposal.current_quote_version_id;

  if found then
    return query
    select
      v_current_proposal.commercial_opportunity_id::uuid,
      v_current_proposal.lifecycle_cycle::integer,
      v_current_proposal.current_quote_id::uuid,
      v_current_proposal.current_quote_version_id::uuid,
      'accepted'::text,
      'current_proposal_accepted'::text,
      v_acceptance.id,
      v_acceptance.source_message_id,
      v_acceptance.customer_signal_at,
      v_acceptance.confirmed_by_user_id,
      v_acceptance.accepted_at,
      v_stale_count;

    return;
  end if;

  return query
  select
    v_current_proposal.commercial_opportunity_id::uuid,
    v_current_proposal.lifecycle_cycle::integer,
    v_current_proposal.current_quote_id::uuid,
    v_current_proposal.current_quote_version_id::uuid,
    'none'::text,
    case
      when v_stale_count > 0
        then 'current_proposal_acceptance_stale'
      else 'current_proposal_not_accepted'
    end,
    null::uuid,
    null::uuid,
    null::timestamptz,
    null::uuid,
    null::timestamptz,
    v_stale_count;
end;
$function$;

alter function public.read_current_commercial_proposal_acceptance_by_system(
  uuid,
  uuid,
  uuid
)
  owner to postgres;

revoke all on function public.read_current_commercial_proposal_acceptance_by_system(
  uuid,
  uuid,
  uuid
)
  from public, anon, authenticated, service_role;

grant execute on function public.read_current_commercial_proposal_acceptance_by_system(
  uuid,
  uuid,
  uuid
)
  to service_role;


comment on table public.commercial_proposal_acceptance_events is
  'P9 6.8 append-only authority de aceite humano confirmado da proposta comercial exata apresentada ao cliente. Fatos antigos permanecem historicos e tornam-se stale quando lifecycle/current proposal muda.';

comment on function public.accept_current_commercial_proposal_customer_signal_by_user(
  uuid,
  uuid,
  uuid,
  integer,
  uuid,
  uuid,
  uuid
) is
  'P9 6.8 writer autenticado de aceite da Current Commercial Proposal exata. Serializa pela opportunity, exige lifecycle e quote/version vigentes, evidence inbound do cliente posterior ao envio e confirmacao humana.';

comment on function public.read_current_commercial_proposal_acceptance_by_system(
  uuid,
  uuid,
  uuid
) is
  'P9 6.8 reader service-role da acceptance vigente. Delega identidade, integridade, sent evidence e lifecycle da Current Commercial Proposal ao reader canonico P9 6.7; somente proposal_state=available pode ser resolvida como accepted ou not_accepted. Fatos anteriores aparecem apenas como stale_acceptance_count.';


do $postconditions$
declare
  v_definition text;
  v_proc record;
begin
  if pg_catalog.to_regclass(
       'public.commercial_proposal_acceptance_events'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: acceptance events table missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.accept_current_commercial_proposal_customer_signal_by_user(uuid,uuid,uuid,integer,uuid,uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: acceptance writer missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.read_current_commercial_proposal_acceptance_by_system(uuid,uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: acceptance reader missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.read_current_commercial_proposal_by_system(uuid,uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message =
        'postcondition failed: canonical current proposal reader dependency missing';
  end if;

  select
    procedure_row.prosecdef,
    procedure_row.provolatile
  into v_proc
  from pg_catalog.pg_proc procedure_row
  where procedure_row.oid =
    'public.read_current_commercial_proposal_acceptance_by_system(uuid,uuid,uuid)'::pg_catalog.regprocedure;

  if v_proc.prosecdef is distinct from true
     or v_proc.provolatile is distinct from 's'::"char" then
    raise exception using
      errcode = 'P0001',
      message =
        'postcondition failed: acceptance reader security/volatility mismatch';
  end if;

  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.read_current_commercial_proposal_acceptance_by_system(uuid,uuid,uuid)'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_definition;

  if v_definition not like
       '%read_current_commercial_proposal_by_system%'
     or v_definition not like '%proposal_state%'
     or v_definition not like '%current_proposal_acceptance_stale%'
     or v_definition like '%from public.commercial_opportunities%'
     or v_definition like '%from public.sales_quotes%'
     or v_definition like '%from public.sales_quote_versions%' then
    raise exception using
      errcode = 'P0001',
      message =
        'postcondition failed: acceptance reader bypasses canonical current proposal authority';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation_row
      on relation_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = relation_row.relnamespace
    where namespace_row.nspname = 'public'
      and relation_row.relname =
        'commercial_proposal_acceptance_events'
      and trigger_row.tgname =
        'commercial_proposal_acceptance_events_append_only'
      and not trigger_row.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message =
        'postcondition failed: append-only acceptance trigger missing';
  end if;
end;
$postconditions$;

commit;

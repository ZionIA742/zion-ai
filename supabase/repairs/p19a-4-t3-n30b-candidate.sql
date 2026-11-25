-- N30B: install after N29C, only inside the integrated rehearsal for now.
-- Preserve the legacy writer for ordinary messages; reserve panel reply provenance.
do $n30b_patch$
declare
  v_def text;
  v_anchor text;
  v_new text;
begin
  v_def := pg_catalog.pg_get_functiondef('public.assistant_push_system_message(uuid,uuid,text,text,uuid,uuid,uuid,jsonb)'::regprocedure);
  if pg_catalog.md5(v_def) is distinct from 'c39880e4516986f3d3667be4c304e710' then raise exception 'N30B_SYSTEM_WRITER_DRIFT'; end if;
  v_anchor := $a$  if coalesce(trim(p_content), '') = '' then$a$;
  v_new := $a$  -- Reserved reply provenance can only be written by the trusted backend.
  if pg_catalog.left(coalesce(p_metadata ->> 'source_external_message_id', ''), 6) = 'panel:'
     and coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
                  nullif(auth.jwt() ->> 'role', '')) is distinct from 'service_role' then
    raise exception using errcode='42501', message='N30B_RESERVED_PANEL_REPLY_PROVENANCE';
  end if;
  if coalesce(trim(p_content), '') = '' then$a$;
  if (length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor) <> 1 then raise exception 'N30B_SYSTEM_WRITER_ANCHOR'; end if;
  execute replace(v_def,v_anchor,v_new);

  v_def := pg_catalog.pg_get_functiondef('public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)'::regprocedure);
  if pg_catalog.md5(v_def) is distinct from '1b6d6beacab34f8997023f7092169c69' then raise exception 'N30B_PANEL_TRANSITION_DRIFT'; end if;
  v_anchor := $a$v_request_role <> 'authenticated'$a$;
  v_new := $a$coalesce(v_request_role, nullif(auth.jwt() ->> 'role', '')) is distinct from 'authenticated'$a$;
  if (length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor) <> 1 then raise exception 'N30B_PANEL_TRANSITION_ANCHOR'; end if;
  execute replace(v_def,v_anchor,v_new);
end;
$n30b_patch$;

create table public.assistant_human_control_command_receipts (
  human_message_id uuid primary key,
  organization_id uuid not null,
  store_id uuid not null,
  thread_id uuid not null,
  conversation_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('takeover_temporary','create_hard_hold','release_ai')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (human_message_id,organization_id,store_id,thread_id)
    references public.store_assistant_messages(id,organization_id,store_id,thread_id) on delete restrict,
  foreign key (conversation_id,organization_id) references public.conversations(id,organization_id) on delete restrict,
  foreign key (store_id,organization_id) references public.stores(id,organization_id) on delete restrict
);
alter table public.assistant_human_control_command_receipts enable row level security;
revoke all on public.assistant_human_control_command_receipts from public,anon,authenticated,service_role;

create function public.execute_assistant_human_control_command_scoped(
  p_organization_id uuid, p_store_id uuid, p_human_message_id uuid
) returns table(outcome text, command_action text, target_conversation_id uuid)
language plpgsql security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $n30b$
declare
  v_user uuid := auth.uid();
  v_role text := coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.role',true),''),nullif(auth.jwt()->>'role',''));
  v_message public.store_assistant_messages%rowtype;
  v_receipt public.assistant_human_control_command_receipts%rowtype;
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
  v_has_lease boolean;
  v_normal text;
  v_parts text[];
  v_action text;
  v_name text;
  v_target uuid;
  v_matches bigint;
  v_reason text;
  v_active boolean;
begin
  if v_user is null or v_role is distinct from 'authenticated'
    or not exists (select 1 from public.memberships m where m.organization_id=p_organization_id and m.user_id=v_user and m.is_active is true and public._conversation_transition_role_is_allowed(m.role::text)) then
    raise exception using errcode='42501',message='N30B_COMMAND_NOT_AUTHORIZED';
  end if;
  select m.* into v_message from public.store_assistant_messages m
  join public.store_assistant_threads t on t.id=m.thread_id and t.organization_id=m.organization_id and t.store_id=m.store_id
  where m.id=p_human_message_id and m.organization_id=p_organization_id and m.store_id=p_store_id
    and m.sender='human' and m.sender_role='store_responsible' and m.direction='incoming' and m.message_type='text'
    and m.metadata->>'origin'='panel' and m.metadata->>'channel'='panel' and m.metadata->>'actor_user_id'=v_user::text
    and t.thread_type='primary' and t.status='active'
  for update of m;
  if not found then raise exception using errcode='42501',message='N30B_COMMAND_SOURCE_INVALID'; end if;
  -- The source lock serializes retries, including retries after a new takeover.
  select r.* into v_receipt from public.assistant_human_control_command_receipts r where r.human_message_id=p_human_message_id;
  if found then
    if v_receipt.actor_user_id is distinct from v_user or v_receipt.organization_id is distinct from p_organization_id or v_receipt.store_id is distinct from p_store_id or v_receipt.thread_id is distinct from v_message.thread_id then
      raise exception using errcode='42501',message='N30B_COMMAND_RECEIPT_SCOPE';
    end if;
    return query select 'replayed'::text,v_receipt.action,v_receipt.conversation_id;
    return;
  end if;
  -- First execution only: short-lived, exact affirmative command and exact target.
  if v_message.created_at is null or v_message.created_at > pg_catalog.clock_timestamp() or v_message.created_at < pg_catalog.clock_timestamp()-interval '10 minutes' then
    raise exception using errcode='55000',message='N30B_COMMAND_EXPIRED';
  end if;
  if exists (select 1 from public.store_assistant_messages newer
    where newer.organization_id=p_organization_id and newer.store_id=p_store_id and newer.thread_id=v_message.thread_id
    and newer.sender='human' and newer.direction='incoming' and newer.created_at>v_message.created_at) then
    raise exception using errcode='55000',message='N30B_COMMAND_SUPERSEDED';
  end if;
  v_normal := pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.lower(pg_catalog.btrim(v_message.content)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[[:space:]]+', ' ', 'g');
  v_parts := pg_catalog.regexp_match(v_normal, '^(eu vou cuidar|vou cuidar eu mesmo|vou assumir o atendimento|nao responda|pare de responder|mantenha em espera|pode assumir|pode voltar a responder|libere a ia|retome a ia) para (.+)$');
  if v_parts is null then raise exception using errcode='22023',message='N30B_COMMAND_EXPLICIT_TARGET_REQUIRED'; end if;
  v_action := case when v_parts[1] in ('eu vou cuidar','vou cuidar eu mesmo','vou assumir o atendimento') then 'takeover_temporary'
    when v_parts[1] in ('nao responda','pare de responder','mantenha em espera') then 'create_hard_hold' else 'release_ai' end;
  v_name := pg_catalog.btrim(v_parts[2]);
  -- Exact name only, no fuzzy ranking, no last-customer guessing. Every matching
  -- conversation counts, even if inactive. UUID syntax is for technical use.
  select count(*), min(c.id::text)::uuid into v_matches,v_target
  from public.conversations c join public.leads l on l.id=c.lead_id and l.organization_id=c.organization_id
  join public.stores s on s.id=l.store_id and s.organization_id=l.organization_id
  where c.organization_id=p_organization_id and s.id=p_store_id and (
    (v_name ~ '^conversa [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and v_name='conversa '||c.id::text)
    or (v_name !~ '^conversa [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and
      pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.lower(pg_catalog.btrim(l.name)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[[:space:]]+', ' ', 'g')=v_name)
  );
  if v_matches <> 1 then raise exception using errcode='55000',message='N30B_COMMAND_TARGET_NOT_UNIQUE'; end if;
  select c.* into v_conversation from public.conversations c join public.leads l on l.id=c.lead_id and l.organization_id=c.organization_id
  where c.id=v_target and c.organization_id=p_organization_id and l.store_id=p_store_id for update of c;
  if not found then raise exception using errcode='42501',message='N30B_COMMAND_TARGET_SCOPE'; end if;
  select h.* into v_lease from public.conversation_human_takeover_leases h where h.conversation_id=v_target for update;
  v_has_lease := found;
  if v_has_lease and (v_lease.organization_id is distinct from p_organization_id or v_lease.store_id is distinct from p_store_id) then
    raise exception using errcode='42501',message='N30B_COMMAND_LEASE_SCOPE';
  end if;
  -- Reject commands issued before a subsequent human intervention or release.
  if v_has_lease and (v_message.created_at < v_lease.takeover_started_at or v_message.created_at < v_lease.last_human_activity_at or (v_action='release_ai' and v_message.created_at < v_lease.updated_at) or (v_lease.released_at is not null and v_message.created_at <= v_lease.released_at)) then
    raise exception using errcode='55000',message='N30B_COMMAND_STALE_CONTROL';
  end if;
  v_active := v_conversation.is_human_active is true and v_has_lease and v_lease.released_at is null;
  v_reason := 'assistant_human_command:'||p_human_message_id::text;
  if v_action='takeover_temporary' then
    if not v_active then
      perform public.panel_transition_conversation_state_scoped(p_organization_id,v_target,'humano_assumiu',v_reason);
    end if;
    if not exists (select 1 from public.conversations c join public.conversation_human_takeover_leases h on h.conversation_id=c.id where c.id=v_target and c.is_human_active is true and h.released_at is null and h.organization_id=p_organization_id and h.store_id=p_store_id) then raise exception 'N30B_TAKEOVER_POSTCONDITION'; end if;
  elsif v_action='create_hard_hold' then
    if not v_active then raise exception using errcode='55000',message='N30B_COMMAND_ACTIVE_TAKEOVER_REQUIRED'; end if;
    perform public.create_human_takeover_hard_hold_scoped(p_organization_id,p_store_id,v_target,v_reason,'human-command:'||p_human_message_id::text||':create_hard_hold');
  else
    if not v_active then raise exception using errcode='55000',message='N30B_COMMAND_ACTIVE_TAKEOVER_REQUIRED'; end if;
    if v_lease.hard_hold is true then raise exception using errcode='42501',message='N30B_COMMAND_HARD_HOLD_ACTIVE'; end if;
    perform public.panel_release_conversation_to_ai_scoped(p_organization_id,v_target,case when v_conversation.status='humano_assumiu' then null else v_conversation.status::text end,v_reason);
    if not exists (select 1 from public.conversations c join public.conversation_human_takeover_leases h on h.conversation_id=c.id where c.id=v_target and c.is_human_active is false and h.released_at is not null and h.hard_hold is false) then raise exception 'N30B_RELEASE_POSTCONDITION'; end if;
  end if;
  insert into public.assistant_human_control_command_receipts(human_message_id,organization_id,store_id,thread_id,conversation_id,actor_user_id,action)
  values(p_human_message_id,p_organization_id,p_store_id,v_message.thread_id,v_target,v_user,v_action);
  return query select 'applied'::text,v_action,v_target;
end;
$n30b$;
alter function public.execute_assistant_human_control_command_scoped(uuid,uuid,uuid) owner to postgres;
revoke all on function public.execute_assistant_human_control_command_scoped(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.execute_assistant_human_control_command_scoped(uuid,uuid,uuid) to authenticated;

do $n30b_catalog$
begin
  if not pg_catalog.has_function_privilege('authenticated','public.execute_assistant_human_control_command_scoped(uuid,uuid,uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','public.execute_assistant_human_control_command_scoped(uuid,uuid,uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('service_role','public.execute_assistant_human_control_command_scoped(uuid,uuid,uuid)','EXECUTE')
    or pg_catalog.has_table_privilege('authenticated','public.assistant_human_control_command_receipts','INSERT')
    or pg_catalog.has_table_privilege('service_role','public.assistant_human_control_command_receipts','INSERT') then raise exception 'N30B_ACL_FAILED'; end if;
end;
$n30b_catalog$;

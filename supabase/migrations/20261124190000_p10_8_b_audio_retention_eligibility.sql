begin;

create or replace function public.mark_audio_retention_eligible_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_message_id uuid,
  p_fact_extraction_status text,
  p_completed_at timestamptz default clock_timestamp()
)
returns table (
  message_id uuid,
  marked_at timestamptz,
  outcome text,
  fact_extraction_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text := nullif(btrim(p_fact_extraction_status), '');
  v_completed_at timestamptz := coalesce(p_completed_at, clock_timestamp());
begin
  if v_status is null or v_status not in ('completed_with_facts', 'completed_no_relevant_facts') then
    raise exception using errcode = '22023', message = 'audio_fact_extraction_status_invalid';
  end if;

  return query
  update public.messages as m
     set metadata = coalesce(m.metadata, '{}'::jsonb)
       || jsonb_build_object(
            'audio_retention_eligible_at', v_completed_at,
            'audio_fact_extraction_status', v_status
          )
   where m.id = p_message_id
     and m.organization_id = p_organization_id
     and m.store_id = p_store_id
     and m.conversation_id = p_conversation_id
     and m.message_type = 'audio'
     and m.sender in ('user', 'human')
     and m.deleted_at is null
     and coalesce(m.metadata, '{}'::jsonb)->>'attachment_kind' = 'audio'
     and nullif(btrim(coalesce(m.metadata, '{}'::jsonb)->>'storage_bucket'), '') is not null
     and nullif(btrim(coalesce(m.metadata, '{}'::jsonb)->>'storage_path'), '') is not null
     and nullif(btrim(coalesce(m.metadata, '{}'::jsonb)->>'audio_transcript'), '') is not null
     and lower(coalesce(m.metadata, '{}'::jsonb)->>'transcription_status') = 'succeeded'
     and coalesce(m.metadata, '{}'::jsonb)->>'audio_retention_eligible_at' is null
  returning m.id, v_completed_at, 'marked'::text, v_status;

  if found then
    return;
  end if;

  return query
  select m.id,
         nullif(m.metadata->>'audio_retention_eligible_at', '')::timestamptz,
         'already_marked'::text,
         m.metadata->>'audio_fact_extraction_status'
    from public.messages as m
   where m.id = p_message_id
     and m.organization_id = p_organization_id
     and m.store_id = p_store_id
     and m.conversation_id = p_conversation_id
     and m.message_type = 'audio'
     and m.sender in ('user', 'human')
     and m.deleted_at is null
     and m.metadata->>'audio_retention_eligible_at' is not null;

  if not found then
    raise exception using errcode = '42501', message = 'audio_retention_eligibility_precondition_failed';
  end if;
end;
$function$;

revoke all on function public.mark_audio_retention_eligible_by_system(uuid, uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_audio_retention_eligible_by_system(uuid, uuid, uuid, uuid, text, timestamptz)
  to service_role;

comment on function public.mark_audio_retention_eligible_by_system(uuid, uuid, uuid, uuid, text, timestamptz)
  is 'Atomically marks a fully processed inbound audio for future retention cleanup; preserves the first eligibility timestamp.';

commit;

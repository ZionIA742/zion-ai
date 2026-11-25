begin;

create or replace function public.claim_audio_retention_deletion_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_message_id uuid,
  p_claim_token uuid,
  p_now timestamptz default clock_timestamp()
)
returns table (
  message_id uuid,
  storage_bucket text,
  storage_path text,
  claim_token uuid,
  outcome text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
begin
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'audio_retention_claim_token_required';
  end if;

  return query
  update public.messages as m
     set metadata = coalesce(m.metadata, '{}'::jsonb)
       || jsonb_build_object(
            'audio_retention_deletion_status', 'claimed',
            'audio_retention_deletion_claimed_at', v_now,
            'audio_retention_deletion_claim_token', p_claim_token
          )
   where m.id = p_message_id
     and m.organization_id = p_organization_id
     and m.store_id = p_store_id
     and m.message_type = 'audio'
     and m.sender in ('user', 'human')
     and m.deleted_at is null
      and coalesce(m.metadata, '{}'::jsonb)->>'attachment_kind' = 'audio'
     and coalesce(m.metadata, '{}'::jsonb)->>'media_origin' in ('customer', 'human')
     and coalesce(m.metadata, '{}'::jsonb)->>'storage_bucket' = 'zion-store-files'
     and nullif(btrim(coalesce(m.metadata, '{}'::jsonb)->>'storage_path'), '') is not null
     and (coalesce(m.metadata, '{}'::jsonb)->>'storage_path') like (m.organization_id::text || '/' || m.store_id::text || '/whatsapp-inbound/%')
      and not exists (
        select 1
          from public.messages as shared
         where shared.id <> m.id
           and shared.organization_id = m.organization_id
           and shared.store_id = m.store_id
           and coalesce(shared.metadata, '{}'::jsonb)->>'storage_bucket' = coalesce(m.metadata, '{}'::jsonb)->>'storage_bucket'
           and coalesce(shared.metadata, '{}'::jsonb)->>'storage_path' = coalesce(m.metadata, '{}'::jsonb)->>'storage_path'
      )
     and nullif(btrim(coalesce(m.metadata, '{}'::jsonb)->>'audio_transcript'), '') is not null
     and lower(coalesce(m.metadata, '{}'::jsonb)->>'transcription_status') = 'succeeded'
     and coalesce(m.metadata, '{}'::jsonb)->>'audio_fact_extraction_status' in ('completed_with_facts', 'completed_no_relevant_facts')
     and case
           when pg_catalog.pg_input_is_valid(nullif(btrim(coalesce(m.metadata, '{}'::jsonb)->>'audio_retention_eligible_at'), ''), 'timestamptz')
           then nullif(btrim(coalesce(m.metadata, '{}'::jsonb)->>'audio_retention_eligible_at'), '')::timestamptz
         end <= v_now - interval '24 hours'
     and (
       coalesce(m.metadata, '{}'::jsonb)->>'audio_retention_deletion_status' is null
       or (
         coalesce(m.metadata, '{}'::jsonb)->>'audio_retention_deletion_status' = 'failed'
         and (
           nullif(btrim(coalesce(m.metadata, '{}'::jsonb)->>'audio_retention_next_attempt_at'), '') is null
           or case
                when pg_catalog.pg_input_is_valid(nullif(btrim(coalesce(m.metadata, '{}'::jsonb)->>'audio_retention_next_attempt_at'), ''), 'timestamptz')
                then nullif(btrim(coalesce(m.metadata, '{}'::jsonb)->>'audio_retention_next_attempt_at'), '')::timestamptz
              end <= v_now
         )
       )
       or (
         coalesce(m.metadata, '{}'::jsonb)->>'audio_retention_deletion_status' = 'claimed'
         and case
               when pg_catalog.pg_input_is_valid(nullif(btrim(coalesce(m.metadata, '{}'::jsonb)->>'audio_retention_deletion_claimed_at'), ''), 'timestamptz')
               then nullif(btrim(coalesce(m.metadata, '{}'::jsonb)->>'audio_retention_deletion_claimed_at'), '')::timestamptz
             end <= v_now - interval '1 hour'
       )
     )
  returning m.id,
            coalesce(m.metadata, '{}'::jsonb)->>'storage_bucket',
            coalesce(m.metadata, '{}'::jsonb)->>'storage_path',
            p_claim_token,
            'claimed'::text;
end;
$function$;

create or replace function public.finish_audio_retention_deletion_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_message_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error text default null,
  p_now timestamptz default clock_timestamp()
)
returns table (message_id uuid, outcome text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_outcome text := nullif(btrim(p_outcome), '');
begin
  if v_outcome is null or v_outcome not in ('deleted', 'failed') then
    raise exception using errcode = '22023', message = 'audio_retention_deletion_outcome_invalid';
  end if;

  return query
  update public.messages as m
     set metadata = coalesce(m.metadata, '{}'::jsonb)
       || jsonb_build_object(
            'audio_retention_deletion_status', v_outcome,
            'audio_retention_deletion_finished_at', v_now,
            'audio_retention_file_deleted', (v_outcome = 'deleted'),
            'audio_retention_deletion_error', case when v_outcome = 'failed' then nullif(btrim(coalesce(p_error, '')), '') else null end,
            'audio_retention_next_attempt_at', case when v_outcome = 'failed' then v_now + interval '1 hour' else null end
          )
   where m.id = p_message_id
     and m.organization_id = p_organization_id
     and m.store_id = p_store_id
     and coalesce(m.metadata, '{}'::jsonb)->>'audio_retention_deletion_claim_token' = p_claim_token::text
     and coalesce(m.metadata, '{}'::jsonb)->>'audio_retention_deletion_status' = 'claimed'
  returning m.id, v_outcome;

  if found then
    return;
  end if;

  return query
  select m.id, m.metadata->>'audio_retention_deletion_status'
    from public.messages as m
   where m.id = p_message_id
     and m.organization_id = p_organization_id
     and m.store_id = p_store_id
     and m.metadata->>'audio_retention_deletion_status' = v_outcome;
end;
$function$;

revoke all on function public.claim_audio_retention_deletion_by_system(uuid, uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_audio_retention_deletion_by_system(uuid, uuid, uuid, uuid, timestamptz)
  to service_role;

revoke all on function public.finish_audio_retention_deletion_by_system(uuid, uuid, uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.finish_audio_retention_deletion_by_system(uuid, uuid, uuid, uuid, text, text, timestamptz)
  to service_role;

commit;

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationPaths = [
  "supabase/migrations/20261124190000_p10_8_b_audio_retention_eligibility.sql",
  "supabase/migrations/20261124200000_p10_8_c_audio_retention_executor.sql",
];
const outputPath = "supabase/homologation/20261124210000_p10_8_d_audio_retention_integrated_runner.sql";

function migrationBody(filePath) {
  const source = fs.readFileSync(path.join(root, filePath), "utf8").replace(/^\uFEFF/, "");
  return source
    .replace(/^\s*begin;\s*/i, "")
    .replace(/\s*commit;\s*$/i, "")
    .trim();
}

const [eligibilityMigration, executorMigration] = migrationPaths.map(migrationBody);
const runner = `-- MICROETAPA 10.8-D
-- Homologacao integrada e temporaria de 10.8-B + 10.8-C.
--
-- Somente leitura do ambiente fora da subtransacao. As migrations e fixtures
-- sao instaladas dentro de um bloco PL/pgSQL com rollback por subtransacao.
-- Nenhum storage real e acessado: a exclusao fisica e simulada por finish(deleted).
-- Nao executar com ZION_AUDIO_RETENTION_EXECUTOR_ENABLED=true.

set lock_timeout = '5s';
set statement_timeout = '30s';
drop table if exists pg_temp.p10_8_d_results;
create temp table p10_8_d_results (
  test_name text not null,
  verdict text not null,
  details text not null
) on commit preserve rows;

do $runner$
declare
  v_org uuid;
  v_store uuid;
  v_conversation uuid;
  v_message uuid;
  v_claim_a uuid := gen_random_uuid();
  v_claim_b uuid := gen_random_uuid();
  v_claim_c uuid := gen_random_uuid();
  v_now timestamptz := timestamptz '2026-11-24 12:00:00+00';
  v_eligible timestamptz;
  v_invalid text;
  v_marked_at timestamptz;
  v_replay_marked_at timestamptz;
  v_claim_path text;
  v_claim_outcome text;
  v_claim_replay_count integer;
  v_shared_message uuid;
  v_status text;
  v_status_after_failed text;
  v_status_after_deleted text;
  v_marker_before boolean;
  v_claim_before boolean;
  v_finish_before boolean;
  v_metadata_before jsonb;
  v_shared_metadata_before jsonb;
  v_metadata_after jsonb;
  v_eligibility_pass boolean := false;
  v_claim_pass boolean := false;
  v_identity_pass boolean := false;
  v_status_validation_pass boolean := false;
  v_outcome_validation_pass boolean := false;
  v_sqlstate text;
  v_error text;
  v_verdict text := 'BLOQUEADO';
  v_details text := 'ensaio nao concluido';
begin
  select to_regprocedure('public.mark_audio_retention_eligible_by_system(uuid,uuid,uuid,uuid,text,timestamptz)') is not null
    into v_marker_before;
  select to_regprocedure('public.claim_audio_retention_deletion_by_system(uuid,uuid,uuid,uuid,timestamptz)') is not null
    into v_claim_before;
  select to_regprocedure('public.finish_audio_retention_deletion_by_system(uuid,uuid,uuid,uuid,text,text,timestamptz)') is not null
    into v_finish_before;

  begin
    -- BEGIN implicito da subtransacao: todo DDL/DML abaixo e revertido pelo
    -- erro-sentinela, preservando somente os resultados inseridos depois.
    ${eligibilityMigration}
    ${executorMigration}

    if to_regclass('public.messages') is null then
      raise exception using errcode = 'P10D0', message = 'public.messages ausente';
    end if;

    select m.organization_id, m.store_id, m.conversation_id, m.id, m.metadata
      into v_org, v_store, v_conversation, v_message, v_metadata_before
    from public.messages m
    where m.deleted_at is null
    order by m.created_at nulls last, m.id
    limit 1;
    if v_message is null or v_org is null or v_store is null or v_conversation is null then
      raise exception using errcode = 'P10D0', message = 'fixture segura de messages ausente';
    end if;

    select m.id, m.metadata
      into v_shared_message, v_shared_metadata_before
    from public.messages m
    where m.deleted_at is null
      and m.organization_id = v_org
      and m.store_id = v_store
      and m.id <> v_message
    order by m.created_at nulls last, m.id
    limit 1;
    if v_shared_message is null then
      raise exception using errcode = 'P10D0', message = 'fixture segura para objeto compartilhado ausente';
    end if;

    v_eligible := v_now - interval '24 hours';
    update public.messages
       set sender = 'user',
           message_type = 'audio',
           metadata = (coalesce(v_metadata_before, '{}'::jsonb) - array[
             'audio_retention_eligible_at',
             'audio_retention_deletion_status',
             'audio_retention_deletion_claimed_at',
             'audio_retention_deletion_claim_token',
             'audio_retention_deletion_finished_at',
             'audio_retention_file_deleted',
             'audio_retention_deletion_error',
             'audio_retention_next_attempt_at'
           ])
             || jsonb_build_object(
                  'p10_8_d_fixture', true,
                  'attachment_kind', 'audio',
                  'media_origin', 'customer',
                  'storage_bucket', 'zion-store-files',
                  'storage_path', v_org::text || '/' || v_store::text || '/whatsapp-inbound/' || v_conversation::text || '/p10-8-d-synthetic.webm',
                  'mime_type', 'audio/webm',
                  'original_file_name', 'p10-8-d-synthetic.webm',
                  'sha256', 'p10-8-d-synthetic-sha256',
                  'size_bytes', 128,
                  'downloaded_from_meta', true,
                  'voice', true,
                  'is_voice_message', true,
                  'audio_transcript', 'fixture de homologacao',
                  'transcription_status', 'succeeded',
                  'audio_fact_extraction_status', 'completed_no_relevant_facts',
                  'audio_retention_eligible_at', v_eligible
                )
     where id = v_message;

    select marked_at into v_marked_at
    from public.mark_audio_retention_eligible_by_system(
      v_org, v_store, v_conversation, v_message,
      'completed_no_relevant_facts', v_eligible
    );
    if v_marked_at is null then
      raise exception using errcode = 'P10D0', message = 'marcador de elegibilidade nao retornou timestamp';
    end if;

    select marked_at into v_replay_marked_at
    from public.mark_audio_retention_eligible_by_system(
      v_org, v_store, v_conversation, v_message,
      'completed_with_facts', v_now
    );
    if v_replay_marked_at is distinct from v_marked_at then
      raise exception using errcode = 'P10D0', message = 'replay reiniciou o prazo de retencao';
    end if;

    for v_invalid in select input_value from (values
      ('invalid-timestamp'::text),
      (null::text),
      (''::text)
    ) as timestamp_inputs(input_value) loop
      update public.messages
         set metadata = metadata || jsonb_build_object('audio_retention_eligible_at', v_invalid)
       where id = v_message;
      select count(*) into v_claim_replay_count
      from public.claim_audio_retention_deletion_by_system(v_org, v_store, v_message, gen_random_uuid(), v_now);
      if v_claim_replay_count <> 0 then
        raise exception using errcode = 'P10D0', message = 'timestamp invalido/nulo/vazio foi aceito';
      end if;
    end loop;
    update public.messages
       set metadata = metadata || jsonb_build_object('audio_retention_eligible_at', v_eligible)
     where id = v_message;

    v_status_validation_pass := true;
    begin
      perform * from public.mark_audio_retention_eligible_by_system(
        v_org, v_store, v_conversation, v_message, null, v_eligible
      );
      v_status_validation_pass := false;
    exception when sqlstate '22023' then
      null;
    end;
    begin
      perform * from public.mark_audio_retention_eligible_by_system(
        v_org, v_store, v_conversation, v_message, '', v_eligible
      );
      v_status_validation_pass := false;
    exception when sqlstate '22023' then
      null;
    end;
    if not v_status_validation_pass then
      raise exception using errcode = 'P10D0', message = 'status nulo/vazio foi aceito';
    end if;

    update public.messages
       set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
         'storage_bucket', 'zion-store-files',
         'storage_path', v_org::text || '/' || v_store::text || '/whatsapp-inbound/' || v_conversation::text || '/p10-8-d-synthetic.webm'
       )
     where id = v_shared_message;
    select count(*) into v_claim_replay_count
    from public.claim_audio_retention_deletion_by_system(v_org, v_store, v_message, gen_random_uuid(), v_now);
    if v_claim_replay_count <> 0 then
      raise exception using errcode = 'P10D0', message = 'objeto compartilhado foi aceito pelo claim';
    end if;
    update public.messages
       set metadata = v_shared_metadata_before
     where id = v_shared_message;

    select storage_path, outcome into v_claim_path, v_claim_outcome
    from public.claim_audio_retention_deletion_by_system(v_org, v_store, v_message, v_claim_a, v_now);
    if v_claim_outcome is distinct from 'claimed'
       then
      raise exception using errcode = 'P10D0', message = 'claim recusado: elegibilidade em 24h ou estado concorrente falhou';
    end if;
    v_eligibility_pass := true;
    if v_claim_path is distinct from v_org::text || '/' || v_store::text || '/whatsapp-inbound/' || v_conversation::text || '/p10-8-d-synthetic.webm' then
      raise exception using errcode = 'P10D0', message = 'claim retornou caminho/bucket incompatível com a fixture';
    end if;
    v_claim_pass := true;
    v_identity_pass := true;

    v_outcome_validation_pass := true;
    begin
      perform * from public.finish_audio_retention_deletion_by_system(
        v_org, v_store, v_message, v_claim_a, null, null, v_now
      );
      v_outcome_validation_pass := false;
    exception when sqlstate '22023' then
      null;
    end;
    begin
      perform * from public.finish_audio_retention_deletion_by_system(
        v_org, v_store, v_message, v_claim_a, '', null, v_now
      );
      v_outcome_validation_pass := false;
    exception when sqlstate '22023' then
      null;
    end;
    if not v_outcome_validation_pass then
      raise exception using errcode = 'P10D0', message = 'outcome nulo/vazio foi aceito';
    end if;

    select count(*) into v_claim_replay_count
    from public.claim_audio_retention_deletion_by_system(v_org, v_store, v_message, v_claim_b, v_now);
    if v_claim_replay_count <> 0 then
      raise exception using errcode = 'P10D0', message = 'claim concorrente/replay nao foi bloqueado';
    end if;

    perform * from public.finish_audio_retention_deletion_by_system(
      v_org, v_store, v_message, v_claim_a, 'failed', 'storage_simulated_failure', v_now
    );
    select metadata->>'audio_retention_deletion_status' into v_status_after_failed
    from public.messages where id = v_message;
    if v_status_after_failed is distinct from 'failed' then
      raise exception using errcode = 'P10D0', message = 'falha simulada nao foi persistida';
    end if;

    select storage_path, outcome into v_claim_path, v_claim_outcome
    from public.claim_audio_retention_deletion_by_system(v_org, v_store, v_message, v_claim_c, v_now + interval '1 hour');
    if v_claim_outcome is distinct from 'claimed' then
      raise exception using errcode = 'P10D0', message = 'retry apos falha nao foi permitido';
    end if;

    -- A exclusao fisica real e deliberadamente simulada; finish(deleted) apenas
    -- grava o estado persistente e preserva storage_path para auditoria/recuperacao.
    perform * from public.finish_audio_retention_deletion_by_system(
      v_org, v_store, v_message, v_claim_c, 'deleted', null, v_now + interval '1 hour'
    );
    select metadata->>'audio_retention_deletion_status' into v_status_after_deleted
    from public.messages where id = v_message;
    if v_status_after_deleted is distinct from 'deleted' then
      raise exception using errcode = 'P10D0', message = 'confirmacao persistente de deleted falhou';
    end if;

    select count(*) into v_claim_replay_count
    from public.claim_audio_retention_deletion_by_system(v_org, v_store, v_message, gen_random_uuid(), v_now + interval '48 hours');
    if v_claim_replay_count <> 0 then
      raise exception using errcode = 'P10D0', message = 'objeto deleted foi reaberto';
    end if;

    select metadata into v_metadata_after from public.messages where id = v_message;
    if v_metadata_after->>'audio_transcript' is distinct from 'fixture de homologacao'
       or v_metadata_after->>'storage_path' is null
       or v_metadata_after->>'p10_8_d_fixture' is distinct from 'true' then
      raise exception using errcode = 'P10D0', message = 'mensagem/transcricao/referencia nao preservadas';
    end if;

    raise exception using errcode = 'P10D1', message = 'P10_8_D_INTENTIONAL_ROLLBACK';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_error = message_text;
    if v_sqlstate = 'P10D1' and v_error = 'P10_8_D_INTENTIONAL_ROLLBACK' then
      v_verdict := 'PASS';
      v_details := 'eligibilidade 24h, claim atomico, falha/retry, replay, preservacao e rollback passaram; storage real nao acessado';
    else
      v_details := coalesce(v_sqlstate, 'erro') || ': ' || coalesce(v_error, 'desconhecido');
    end if;
  end;

  insert into pg_temp.p10_8_d_results values
    ('eligibility', case when v_eligibility_pass then 'PASS' else 'BLOQUEADO' end,
     case when v_eligibility_pass then 'timestamp valido atingiu exatamente 24 horas; valores invalido/nulo/vazio recusados' else v_details end);
  insert into pg_temp.p10_8_d_results values
    ('claim', case when v_claim_pass then 'PASS' else 'BLOQUEADO' end,
       case when v_claim_pass then 'claim atomico aceito, replay concorrente, objeto compartilhado e validacoes recusados' else v_details end);
  insert into pg_temp.p10_8_d_results values
    ('object_identity', case when v_identity_pass then 'PASS' else 'BLOQUEADO' end,
     case when v_identity_pass then 'bucket, prefix tenant/store e storage_path conferidos' else v_details end);
  insert into pg_temp.p10_8_d_results values
    ('transactional_homologation', v_verdict, v_details);
  insert into pg_temp.p10_8_d_results values
    ('rollback_objects',
     case when (to_regprocedure('public.mark_audio_retention_eligible_by_system(uuid,uuid,uuid,uuid,text,timestamptz)') is not null) = v_marker_before
             and (to_regprocedure('public.claim_audio_retention_deletion_by_system(uuid,uuid,uuid,uuid,timestamptz)') is not null) = v_claim_before
             and (to_regprocedure('public.finish_audio_retention_deletion_by_system(uuid,uuid,uuid,uuid,text,text,timestamptz)') is not null) = v_finish_before
          then 'PASS' else 'BLOQUEADO' end,
     'marker_before=' || v_marker_before::text || ', claim_before=' || v_claim_before::text || ', finish_before=' || v_finish_before::text);
end;
$runner$;

select test_name, verdict, details
from pg_temp.p10_8_d_results
order by test_name;

-- Homologacao futura com storage real: usar um objeto sintetico exclusivo no
-- bucket zion-store-files, sob org/store/whatsapp-inbound/<conversation>/,
-- nunca um audio real. Executar em sessoes separadas somente apos autorizacao.
-- A sessao deve observar o mesmo claim_token e confirmar remove + finish.
`;

fs.mkdirSync(path.dirname(path.join(root, outputPath)), { recursive: true });
fs.writeFileSync(path.join(root, outputPath), runner, "utf8");
console.log(outputPath);

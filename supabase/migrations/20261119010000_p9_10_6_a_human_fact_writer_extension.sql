begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

-- Extensao contratual minima: reutiliza as duas funcoes canonicas existentes
-- e preserva suas assinaturas, locks, idempotencia, conflitos e grants.
do $migration$
declare
  v_internal_signature constant text :=
    'public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)';
  v_system_signature constant text :=
    'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)';
  v_definition text;
  v_old text;
  v_new text;
begin
  -- The three canonical checks are part of this same atomic migration. Identify
  -- them by catalog identity and validate the installed pre-10.6 definition
  -- before replacing it; do not silently patch a renamed or drifted constraint.
  declare
    v_constraint record;
    v_literal_count integer;
    v_definition text;
  begin
    for v_constraint in
      select
        c.conrelid::pg_catalog.regclass as relation_name,
        c.conname,
        c.contype,
        pg_catalog.pg_get_constraintdef(c.oid, true) as definition
      from pg_catalog.pg_constraint c
      where c.conrelid in (
          'public.commercial_opportunity_qualification_fact_events'::regclass,
          'public.commercial_opportunity_qualification_facts_current'::regclass
        )
        and c.conname in (
          'p9_qfact_events_source_type_chk',
          'p9_qfact_current_source_type_chk',
          'p9_qfact_events_resolution_chk'
        )
      order by c.conname
    loop
      if v_constraint.contype <> 'c' then
        raise exception using
          errcode = 'P0001',
          message = format('precondition failed: canonical constraint %I is not a CHECK', v_constraint.conname);
      end if;

      v_definition := pg_catalog.lower(v_constraint.definition);
      select count(*)
      into v_literal_count
      from pg_catalog.regexp_matches(v_definition, '''[^'']+''', 'g');

      if v_constraint.conname = 'p9_qfact_events_source_type_chk'
         and (
           v_constraint.relation_name <> 'commercial_opportunity_qualification_fact_events'::pg_catalog.regclass
           or v_literal_count <> 5
           or pg_catalog.strpos(v_definition, 'source_type') = 0
           or pg_catalog.strpos(v_definition, '''incoming_customer_message''') = 0
           or pg_catalog.strpos(v_definition, '''crm_manual''') = 0
           or pg_catalog.strpos(v_definition, '''system_inference''') = 0
           or pg_catalog.strpos(v_definition, '''system_correction''') = 0
           or pg_catalog.strpos(v_definition, '''migration_backfill''') = 0
           or pg_catalog.strpos(v_definition, '''human_message''') > 0
         ) then
        raise exception using errcode = 'P0001', message = 'precondition failed: events source_type CHECK definition diverged';
      end if;

      if v_constraint.conname = 'p9_qfact_current_source_type_chk'
         and (
           v_constraint.relation_name <> 'commercial_opportunity_qualification_facts_current'::pg_catalog.regclass
           or v_literal_count <> 5
           or pg_catalog.strpos(v_definition, 'source_type') = 0
           or pg_catalog.strpos(v_definition, '''incoming_customer_message''') = 0
           or pg_catalog.strpos(v_definition, '''crm_manual''') = 0
           or pg_catalog.strpos(v_definition, '''system_inference''') = 0
           or pg_catalog.strpos(v_definition, '''system_correction''') = 0
           or pg_catalog.strpos(v_definition, '''migration_backfill''') = 0
           or pg_catalog.strpos(v_definition, '''human_message''') > 0
         ) then
        raise exception using errcode = 'P0001', message = 'precondition failed: current source_type CHECK definition diverged';
      end if;

      if v_constraint.conname = 'p9_qfact_events_resolution_chk'
         and (
           v_constraint.relation_name <> 'commercial_opportunity_qualification_fact_events'::pg_catalog.regclass
           or v_literal_count <> 4
           or pg_catalog.strpos(v_definition, 'resolves_conflict') = 0
           or pg_catalog.strpos(v_definition, 'assertion_level') = 0
           or pg_catalog.strpos(v_definition, '''confirmed''') = 0
           or pg_catalog.strpos(v_definition, '''incoming_customer_message''') = 0
           or pg_catalog.strpos(v_definition, '''crm_manual''') = 0
           or pg_catalog.strpos(v_definition, '''system_correction''') = 0
           or pg_catalog.strpos(v_definition, '''human_message''') > 0
         ) then
        raise exception using errcode = 'P0001', message = 'precondition failed: events resolution CHECK definition diverged';
      end if;
    end loop;

    if (
      select count(*)
      from pg_catalog.pg_constraint c
      where c.conrelid in (
          'public.commercial_opportunity_qualification_fact_events'::regclass,
          'public.commercial_opportunity_qualification_facts_current'::regclass
        )
        and c.conname in (
          'p9_qfact_events_source_type_chk',
          'p9_qfact_current_source_type_chk',
          'p9_qfact_events_resolution_chk'
        )
    ) <> 3 then
      raise exception using errcode = 'P0001', message = 'precondition failed: canonical CHECK constraint identity is incomplete';
    end if;

    alter table public.commercial_opportunity_qualification_fact_events
      drop constraint p9_qfact_events_source_type_chk,
      drop constraint p9_qfact_events_resolution_chk;
    alter table public.commercial_opportunity_qualification_facts_current
      drop constraint p9_qfact_current_source_type_chk;

    alter table public.commercial_opportunity_qualification_fact_events
      add constraint p9_qfact_events_source_type_chk
      check (
        source_type in (
          'incoming_customer_message',
          'crm_manual',
          'system_inference',
          'system_correction',
          'migration_backfill',
          'human_message'
        )
        and (
          source_type <> 'human_message'
          or (source_message_id is not null and source_conversation_id is not null)
        )
      ),
      add constraint p9_qfact_events_resolution_chk
      check (
        resolves_conflict is false
        or (
          assertion_level = 'confirmed'
          and source_type in (
            'incoming_customer_message',
            'crm_manual',
            'system_correction',
            'human_message'
          )
        )
      );
    alter table public.commercial_opportunity_qualification_facts_current
      add constraint p9_qfact_current_source_type_chk
      check (
        source_type in (
          'incoming_customer_message',
          'crm_manual',
          'system_inference',
          'system_correction',
          'migration_backfill',
          'human_message'
        )
        and (
          source_type <> 'human_message'
          or (source_message_id is not null and source_conversation_id is not null)
        )
      );

    if (
      select count(*)
      from pg_catalog.pg_constraint c
      where c.conrelid in (
          'public.commercial_opportunity_qualification_fact_events'::regclass,
          'public.commercial_opportunity_qualification_facts_current'::regclass
        )
        and c.conname in (
          'p9_qfact_events_source_type_chk',
          'p9_qfact_current_source_type_chk',
          'p9_qfact_events_resolution_chk'
        )
        and pg_catalog.pg_get_constraintdef(c.oid, true) ilike '%human_message%'
    ) <> 3 then
      raise exception using errcode = 'P0001', message = 'postcondition failed: canonical human CHECK constraints were not installed';
    end if;
  end;

  if pg_catalog.to_regprocedure(v_internal_signature) is null
     or pg_catalog.to_regprocedure(v_system_signature) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical qualification fact writers are missing';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(v_internal_signature)
  );

  if pg_catalog.strpos(v_definition, '''human_message''') > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: human_message already present in internal writer';
  end if;

  v_old := $$    'migration_backfill'$$;
  v_new := $$    'migration_backfill',
    'human_message'$$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) <> pg_catalog.length(v_old) then
    raise exception using errcode = 'P0001', message = 'precondition failed: internal source list replacement is not unique';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $$     or (v_source_type = 'system_correction' and v_assertion_level <> 'confirmed') then$$;
  v_new := $$     or (v_source_type = 'system_correction' and v_assertion_level <> 'confirmed')
     or (v_source_type = 'human_message' and v_assertion_level <> 'confirmed') then$$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) <> pg_catalog.length(v_old) then
    raise exception using errcode = 'P0001', message = 'precondition failed: internal assertion replacement is not unique';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $$         'system_correction'
       )$$;
  v_new := $$         'system_correction',
         'human_message'
       )$$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) <> pg_catalog.length(v_old) then
    raise exception using errcode = 'P0001', message = 'precondition failed: internal conflict-source replacement is not unique';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $$  if v_source_type = 'incoming_customer_message'
     and p_source_message_id is null then
    raise exception using
      errcode = '23514',
      message = 'ZION_QFACT_INCOMING_PROVENANCE_REQUIRED';
  end if;$$;
  v_new := $$  if v_source_type = 'incoming_customer_message'
     and p_source_message_id is null then
    raise exception using
      errcode = '23514',
      message = 'ZION_QFACT_INCOMING_PROVENANCE_REQUIRED';
  end if;

  if v_source_type = 'human_message'
     and p_source_message_id is null then
    raise exception using
      errcode = '23514',
      message = 'ZION_QFACT_HUMAN_PROVENANCE_REQUIRED';
  end if;$$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) <> pg_catalog.length(v_old) then
    raise exception using errcode = 'P0001', message = 'precondition failed: internal provenance replacement is not unique';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $$    if v_source_type = 'incoming_customer_message'
       and (
         pg_catalog.lower(pg_catalog.btrim(coalesce(v_message_sender, ''))) <> 'user'
         or pg_catalog.lower(pg_catalog.btrim(coalesce(v_message_direction, ''))) <> 'incoming'
       ) then
      raise exception using
        errcode = '23514',
        message = 'qualification incoming source is not a customer inbound message';
    end if;$$;
  v_new := $$    if v_source_type = 'incoming_customer_message'
       and (
         pg_catalog.lower(pg_catalog.btrim(coalesce(v_message_sender, ''))) <> 'user'
         or pg_catalog.lower(pg_catalog.btrim(coalesce(v_message_direction, ''))) <> 'incoming'
       ) then
      raise exception using
        errcode = '23514',
        message = 'qualification incoming source is not a customer inbound message';
    end if;

    if v_source_type = 'human_message'
       and (
         pg_catalog.lower(pg_catalog.btrim(coalesce(v_message_sender, ''))) <> 'human'
         or pg_catalog.lower(pg_catalog.btrim(coalesce(v_message_direction, ''))) <> 'outgoing'
       ) then
      raise exception using
        errcode = '23514',
        message = 'ZION_QFACT_HUMAN_PROVENANCE_INVALID';
    end if;$$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) <> pg_catalog.length(v_old) then
    raise exception using errcode = 'P0001', message = 'precondition failed: internal sender validation replacement is not unique';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  if pg_catalog.strpos(v_definition, '''human_message''') = 0
     or pg_catalog.strpos(v_definition, 'ZION_QFACT_HUMAN_PROVENANCE_INVALID') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal human provenance extension was not generated';
  end if;

  if pg_catalog.strpos(v_definition, $$    'migration_backfill',
    'human_message'$$) = 0
     or pg_catalog.strpos(v_definition, $$     or (v_source_type = 'human_message' and v_assertion_level <> 'confirmed') then$$) = 0
     or pg_catalog.strpos(v_definition, $$         'system_correction',
         'human_message'
       )$$) = 0
     or pg_catalog.strpos(v_definition, 'ZION_QFACT_HUMAN_PROVENANCE_REQUIRED') = 0
     or pg_catalog.strpos(v_definition, $$         or pg_catalog.lower(pg_catalog.btrim(coalesce(v_message_direction, ''))) <> 'outgoing'$$) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: one or more internal replacements were not applied';
  end if;

  execute v_definition;

  v_definition := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(v_system_signature)
  );

  if pg_catalog.strpos(v_definition, '''human_message''') > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: human_message already present in system writer';
  end if;

  v_old := $$    'system_correction'
  )$$;
  v_new := $$    'system_correction',
    'human_message'
  )$$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) <> pg_catalog.length(v_old) then
    raise exception using errcode = 'P0001', message = 'precondition failed: system source list replacement is not unique';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  if pg_catalog.strpos(v_definition, '''human_message''') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: system human source authorization was not generated';
  end if;

  if pg_catalog.strpos(v_definition, $$    'system_correction',
    'human_message'
  )$$) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: system source replacement was not applied';
  end if;

  execute v_definition;
end;
$migration$;

do $postconditions$
declare
  v_internal_oid oid := pg_catalog.to_regprocedure(
    'public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)'
  );
  v_system_oid oid := pg_catalog.to_regprocedure(
    'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)'
  );
  v_internal text := pg_catalog.pg_get_functiondef(
    'public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)'::pg_catalog.regprocedure
  );
  v_system text := pg_catalog.pg_get_functiondef(
    'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)'::pg_catalog.regprocedure
  );
begin
  if pg_catalog.strpos(v_internal, '''human_message''') = 0
     or pg_catalog.strpos(v_internal, 'sender') = 0
     or pg_catalog.strpos(v_internal, 'direction') = 0
     or pg_catalog.strpos(v_internal, 'ZION_QFACT_HUMAN_PROVENANCE_INVALID') = 0
     or pg_catalog.strpos(v_system, '''human_message''') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: human qualification writer contract incomplete';
  end if;

  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: canonical system writer grants changed';
  end if;

  if pg_catalog.pg_get_userbyid((select proowner from pg_catalog.pg_proc where oid = v_internal_oid)) <> 'postgres'
     or pg_catalog.pg_get_userbyid((select proowner from pg_catalog.pg_proc where oid = v_system_oid)) <> 'postgres'
     or not (select prosecdef from pg_catalog.pg_proc where oid = v_internal_oid)
     or not (select prosecdef from pg_catalog.pg_proc where oid = v_system_oid)
     or pg_catalog.has_function_privilege('service_role', v_internal_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_internal_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_internal_oid, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: canonical writer owner, security definer or internal grants changed';
  end if;
end;
$postconditions$;

commit;

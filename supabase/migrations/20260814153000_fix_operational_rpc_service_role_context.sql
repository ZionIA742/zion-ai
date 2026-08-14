do $migration$
declare
  v_targets constant jsonb := jsonb_build_array(
    jsonb_build_object(
      'signature',
      'public.log_schedule_conversation_event(uuid,uuid,text,text,jsonb)',
      'label',
      'public.log_schedule_conversation_event(uuid,uuid,text,text,jsonb)'
    ),
    jsonb_build_object(
      'signature',
      'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)',
      'label',
      'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)'
    ),
    jsonb_build_object(
      'signature',
      'public.get_latest_conversation_for_lead(uuid,uuid)',
      'label',
      'public.get_latest_conversation_for_lead(uuid,uuid)'
    )
  );
  v_target jsonb;
  v_signature text;
  v_label text;
  v_proc_oid oid;
  v_definition text;
  v_updated_definition text;
  v_fragile_occurrences integer;
  v_robust_occurrences integer;
  v_fragile_fragment text :=
    'coalesce(nullif(pg_catalog.current_setting(''request.jwt.claim.role'', true), ''''), '''')';
  v_robust_fragment text :=
    'coalesce(nullif(pg_catalog.current_setting(''request.jwt.claim.role'', true), ''''), nullif(auth.jwt() ->> ''role'', ''''), '''')';
begin
  for v_target in
    select value
    from jsonb_array_elements(v_targets)
  loop
    v_signature := v_target ->> 'signature';
    v_label := v_target ->> 'label';
    v_proc_oid := pg_catalog.to_regprocedure(v_signature);

    if v_proc_oid is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('precondition failed: %s is missing', v_label);
    end if;

    select pg_catalog.pg_get_functiondef(v_proc_oid)
    into v_definition;

    if v_definition is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('precondition failed: %s definition is unavailable', v_label);
    end if;

    v_fragile_occurrences :=
      (
        pg_catalog.length(v_definition)
        - pg_catalog.length(replace(v_definition, v_fragile_fragment, ''))
      ) / pg_catalog.length(v_fragile_fragment);
    v_robust_occurrences :=
      (
        pg_catalog.length(v_definition)
        - pg_catalog.length(replace(v_definition, v_robust_fragment, ''))
      ) / pg_catalog.length(v_robust_fragment);

    if v_robust_occurrences > 0 then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('precondition failed: %s already uses the hardened role resolver', v_label);
    end if;

    if v_fragile_occurrences <> 1 then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: %s must contain exactly 1 fragile role resolver occurrence, found %s',
          v_label,
          v_fragile_occurrences
        );
    end if;

    v_updated_definition := replace(
      v_definition,
      v_fragile_fragment,
      v_robust_fragment
    );

    if v_updated_definition = v_definition then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('precondition failed: %s definition was not rewritten', v_label);
    end if;

    execute v_updated_definition;
  end loop;

  for v_target in
    select value
    from jsonb_array_elements(v_targets)
  loop
    v_signature := v_target ->> 'signature';
    v_label := v_target ->> 'label';
    v_proc_oid := pg_catalog.to_regprocedure(v_signature);

    select pg_catalog.pg_get_functiondef(v_proc_oid)
    into v_definition;

    v_fragile_occurrences :=
      (
        pg_catalog.length(v_definition)
        - pg_catalog.length(replace(v_definition, v_fragile_fragment, ''))
      ) / pg_catalog.length(v_fragile_fragment);
    v_robust_occurrences :=
      (
        pg_catalog.length(v_definition)
        - pg_catalog.length(replace(v_definition, v_robust_fragment, ''))
      ) / pg_catalog.length(v_robust_fragment);

    if v_robust_occurrences <> 1 then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'postcondition failed: %s must contain exactly 1 hardened role resolver occurrence, found %s',
          v_label,
          v_robust_occurrences
        );
    end if;

    if v_fragile_occurrences <> 0 then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'postcondition failed: %s must contain exactly 0 fragile role resolver occurrences, found %s',
          v_label,
          v_fragile_occurrences
        );
    end if;
  end loop;
end;
$migration$;

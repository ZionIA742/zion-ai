-- P19-A / Block 3 / Operation
-- Forward hardening for required execution-policy modes.
--
-- PostgreSQL CHECK/IF expressions can evaluate to NULL when a JSON key is
-- absent. NULL is not equivalent to FALSE for a CHECK constraint and is not
-- TRUE inside PL/pgSQL IF. These supplemental constraints make required
-- execution modes explicitly fail-closed.
--
-- Do not backfill or alter configured markers.

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class table_row
      on table_row.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'public'
      and table_row.relname = 'store_operation_execution_policies'
      and constraint_row.conname =
        'store_operation_execution_policies_technical_visit_required_modes'
  ) then
    alter table public.store_operation_execution_policies
      add constraint store_operation_execution_policies_technical_visit_required_modes
      check (
        technical_visit_policy is null
        or coalesce(
          (
            technical_visit_policy -> 'requires_appointment' = 'false'::jsonb
          )
          or (
            technical_visit_policy -> 'requires_appointment' = 'true'::jsonb
            and nullif(
              pg_catalog.btrim(
                coalesce(technical_visit_policy ->> 'duration_mode', '')
              ),
              ''
            ) in (
              '30',
              '60',
              '90',
              '120',
              'personalizado',
              'varia'
            )
          ),
          false
        )
      )
      not valid;
  end if;
end;
$$;

alter table public.store_operation_execution_policies
  validate constraint
    store_operation_execution_policies_technical_visit_required_modes;


do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class table_row
      on table_row.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'public'
      and table_row.relname = 'store_operation_execution_policies'
      and constraint_row.conname =
        'store_operation_execution_policies_installation_required_modes'
  ) then
    alter table public.store_operation_execution_policies
      add constraint store_operation_execution_policies_installation_required_modes
      check (
        installation_policy is null
        or (
          coalesce(
            nullif(
              pg_catalog.btrim(
                coalesce(installation_policy ->> 'supply_mode', '')
              ),
              ''
            ) in (
              'disponivel',
              'sob_encomenda',
              'misto'
            ),
            false
          )

          and coalesce(
            nullif(
              pg_catalog.btrim(
                coalesce(
                  installation_policy ->> 'start_lead_time_mode',
                  ''
                )
              ),
              ''
            ) in (
              'mesmo_dia',
              '1_dia',
              '2_3_dias',
              '4_7_dias',
              'varia',
              'outro'
            ),
            false
          )

          and coalesce(
            nullif(
              pg_catalog.btrim(
                coalesce(
                  installation_policy ->> 'duration_mode',
                  ''
                )
              ),
              ''
            ) in (
              'horas',
              'dias_uteis',
              'dias_corridos',
              'varia'
            ),
            false
          )

          and coalesce(
            (
              nullif(
                pg_catalog.btrim(
                  coalesce(installation_policy ->> 'supply_mode', '')
                ),
                ''
              ) = 'disponivel'
            )
            or (
              nullif(
                pg_catalog.btrim(
                  coalesce(installation_policy ->> 'supply_mode', '')
                ),
                ''
              ) in ('sob_encomenda', 'misto')
              and coalesce(
                nullif(
                  pg_catalog.btrim(
                    coalesce(
                      installation_policy ->> 'supplier_lead_time_mode',
                      ''
                    )
                  ),
                  ''
                ) in (
                  '1_3',
                  '4_7',
                  '8_15',
                  'varia',
                  'outro'
                ),
                false
              )
            ),
            false
          )
        )
      )
      not valid;
  end if;
end;
$$;

alter table public.store_operation_execution_policies
  validate constraint
    store_operation_execution_policies_installation_required_modes;

comment on constraint
  store_operation_execution_policies_technical_visit_required_modes
  on public.store_operation_execution_policies
is
  'Fail-closed guard: an offered scheduled technical visit must carry an explicit canonical duration mode.';

comment on constraint
  store_operation_execution_policies_installation_required_modes
  on public.store_operation_execution_policies
is
  'Fail-closed guard: installation policies require explicit supply, start-lead-time and duration modes; supplier lead-time mode is mandatory when supply depends on supplier/factory.';
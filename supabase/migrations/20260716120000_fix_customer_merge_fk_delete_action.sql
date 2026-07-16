-- ZION / Pilar 9 / Fase 4.1A
-- Corrige a acao ON DELETE da FK de merge sem alterar dados.

begin;

do $$
declare
  v_definition text;
begin
  select pg_get_constraintdef(con.oid, true)
    into v_definition
  from pg_constraint con
  join pg_class rel
    on rel.oid = con.conrelid
  join pg_namespace nsp
    on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'customers'
    and con.conname = 'customers_merged_into_customer_same_org_fkey';

  if v_definition is null then
    raise exception
      'Constraint public.customers.customers_merged_into_customer_same_org_fkey not found';
  end if;

  if position(
    'ON DELETE SET NULL (merged_into_customer_id)'
    in v_definition
  ) > 0 then
    return;
  end if;

  alter table public.customers
    drop constraint customers_merged_into_customer_same_org_fkey;

  alter table public.customers
    add constraint customers_merged_into_customer_same_org_fkey
    foreign key (merged_into_customer_id, organization_id)
    references public.customers(id, organization_id)
    on delete set null (merged_into_customer_id);
end;
$$;

commit;
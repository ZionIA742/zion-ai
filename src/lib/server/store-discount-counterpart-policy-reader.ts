import {
  normalizeStoreDiscountCounterpartPolicyRow,
  type StoreDiscountCounterpartPolicyRow,
} from "../store-discount-counterpart-policy";

type ReaderClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

export async function readStoreDiscountCounterpartPolicyBySystem(args: {
  supabase: ReaderClient;
  organizationId: string;
  storeId: string;
}): Promise<
  | { ok: true; policy: StoreDiscountCounterpartPolicyRow | null }
  | { ok: false; error: string }
> {
  const { data, error } = await args.supabase.rpc(
    "read_store_discount_counterpart_policy_scoped",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
    },
  );
  if (error) return { ok: false, error: error.message };

  const rows = Array.isArray(data) ? data : data == null ? [] : [data];
  if (rows.length > 1) {
    return { ok: false, error: "Mais de uma policy de contrapartida foi retornada." };
  }
  if (rows.length === 0) return { ok: true, policy: null };

  const row = rows[0] as StoreDiscountCounterpartPolicyRow;
  if (row.organization_id !== args.organizationId || row.store_id !== args.storeId) {
    return { ok: false, error: "Policy de contrapartida fora do escopo da loja." };
  }
  if (!normalizeStoreDiscountCounterpartPolicyRow(row)) {
    return { ok: false, error: "Policy de contrapartida inválida." };
  }
  return { ok: true, policy: row };
}

import {
  createStoreDiscountSettingsInputFromSources,
  normalizeStoreDiscountSettingsInput,
  type StoreDiscountSettingsRow,
  type StoreHighValueDiscountSettingsRow,
  type NormalizedStoreDiscountSettingsInput,
} from "../store-discount-settings";

export type StoreDiscountSettingsReaderResult =
  | {
      ok: true;
      settings: StoreDiscountSettingsRow | null;
      highValueSettings: StoreHighValueDiscountSettingsRow | null;
      normalized: NormalizedStoreDiscountSettingsInput | null;
    }
  | { ok: false; error: string };

type ReaderQuery = {
  eq: (column: string, value: string) => ReaderQuery;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type StoreDiscountSettingsReaderClient = {
  from: (table: string) => { select: (columns: string) => ReaderQuery };
};

function belongsToScope(row: unknown, organizationId: string, storeId: string) {
  if (row == null) return true;
  if (typeof row !== "object") return false;
  const candidate = row as { organization_id?: unknown; store_id?: unknown };
  return candidate.organization_id === organizationId && candidate.store_id === storeId;
}

export async function readStoreDiscountSettingsBySystem(args: {
  supabase: StoreDiscountSettingsReaderClient;
  organizationId: string;
  storeId: string;
}): Promise<StoreDiscountSettingsReaderResult> {
  const scoped = (table: string, columns: string) =>
    args.supabase
      .from(table)
      .select(columns)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .maybeSingle();

  const [discountResult, highValueResult] = await Promise.all([
    scoped(
      "store_discount_settings",
      "organization_id, store_id, default_discount_percent, max_discount_percent, allow_ask_above_max_discount, discount_autonomy_mode, discount_special_rules, created_at, updated_at",
    ),
    scoped(
      "store_high_value_discount_settings",
      "organization_id, store_id, enabled, threshold_amount_cents, discount_percent, created_at, updated_at",
    ),
  ]);

  if (discountResult.error) return { ok: false, error: discountResult.error.message };
  if (highValueResult.error) return { ok: false, error: highValueResult.error.message };
  if (!belongsToScope(discountResult.data, args.organizationId, args.storeId)) {
    return { ok: false, error: "Discount settings scope mismatch." };
  }
  if (!belongsToScope(highValueResult.data, args.organizationId, args.storeId)) {
    return { ok: false, error: "High-value discount settings scope mismatch." };
  }

  const settings = (discountResult.data ?? null) as StoreDiscountSettingsRow | null;
  const highValueSettings =
    (highValueResult.data ?? null) as StoreHighValueDiscountSettingsRow | null;
  const normalizedResult = normalizeStoreDiscountSettingsInput(
    createStoreDiscountSettingsInputFromSources({ settings, highValueSettings }),
  );

  return {
    ok: true,
    settings,
    highValueSettings,
    normalized: normalizedResult.ok ? normalizedResult.value : null,
  };
}

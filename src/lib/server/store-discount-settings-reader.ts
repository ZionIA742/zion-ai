import type { StoreDiscountSettingsRow } from "../store-discount-settings";

export const STORE_DISCOUNT_SETTINGS_COLUMNS =
  "organization_id, store_id, default_discount_percent, max_discount_percent, allow_ask_above_max_discount, discount_autonomy_mode, discount_special_rules, created_at, updated_at";

export type StoreDiscountSettingsReaderError = {
  message: string;
};

type StoreDiscountSettingsQuery = {
  eq(column: string, value: unknown): StoreDiscountSettingsQuery;
  maybeSingle(): Promise<{
    data: StoreDiscountSettingsRow | null;
    error: StoreDiscountSettingsReaderError | null;
  }>;
};

export type StoreDiscountSettingsReaderClient = {
  from(table: "store_discount_settings"): {
    select(columns: string): StoreDiscountSettingsQuery;
  };
};

export async function readStoreDiscountSettingsBySystem(args: {
  supabase: StoreDiscountSettingsReaderClient;
  organizationId: string | null | undefined;
  storeId: string | null | undefined;
}) {
  return args.supabase
    .from("store_discount_settings")
    .select(STORE_DISCOUNT_SETTINGS_COLUMNS)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();
}

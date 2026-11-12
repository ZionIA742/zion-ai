import {
  adaptStoreSettingsReadinessSources,
  type OperationExecutionPoliciesReadinessRow,
  type OperationSettingsReadinessRow,
  type PaymentSettingsReadinessRow,
  type DiscountSettingsReadinessSourceData,
  type ChannelSettingsReadinessRow,
  type CommercialAiSettingsReadinessRow,
  type StrategySettingsReadinessRow,
  type SettingsReadinessSource,
  type StoreSettingsReadinessSources,
} from "./settings-readiness-source-adapter";
import {
  resolveStoreSettingsReadiness,
  type StoreSettingsReadinessResolution,
} from "./settings-readiness-resolution";
import { readStoreDiscountSettingsBySystem } from "@/lib/server/store-discount-settings-reader";

type QueryBuilder = {
  eq: (column: string, value: string) => QueryBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type SettingsReadinessOverviewClient = {
  from: (table: string) => {
    select: (columns: string) => QueryBuilder;
  };
  rpc: (
    name: string,
    params: Record<string, string>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

function sourceError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim() || "Settings source unavailable.";
}

function normalizeReaderRow<T>(value: unknown): T | null {
  const rows = value == null ? [] : Array.isArray(value) ? value : [value];
  return rows.length === 1 ? (rows[0] as T) : null;
}

function scopeError(row: unknown, organizationId: string, storeId: string) {
  if (row == null || typeof row !== "object" || Array.isArray(row)) {
    return null;
  }

  const candidate = row as {
    organization_id?: unknown;
    store_id?: unknown;
  };

  if (
    candidate.organization_id !== undefined &&
    candidate.organization_id !== organizationId
  ) {
    return "Settings source organization scope mismatch.";
  }

  if (candidate.store_id !== undefined && candidate.store_id !== storeId) {
    return "Settings source store scope mismatch.";
  }

  return null;
}

async function safeRpcSource<T>(args: {
  supabase: SettingsReadinessOverviewClient;
  name: string;
  organizationId: string;
  storeId: string;
}): Promise<SettingsReadinessSource<T>> {
  try {
    const result = await args.supabase.rpc(args.name, {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
    });

    if (result.error) {
      return { ok: false, error: sourceError(result.error.message) };
    }

    const row = normalizeReaderRow<T>(result.data);
    const mismatch = scopeError(row, args.organizationId, args.storeId);
    return mismatch
      ? { ok: false, error: mismatch }
      : { ok: true, data: row };
  } catch (error) {
    return { ok: false, error: sourceError(error) };
  }
}

async function safeTableSource<T>(args: {
  supabase: SettingsReadinessOverviewClient;
  table: string;
  columns: string;
  organizationId: string;
  storeId: string;
}): Promise<SettingsReadinessSource<T>> {
  try {
    const result = await args.supabase
      .from(args.table)
      .select(args.columns)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .maybeSingle();

    if (result.error) {
      return { ok: false, error: sourceError(result.error.message) };
    }

    const mismatch = scopeError(result.data, args.organizationId, args.storeId);
    return mismatch
      ? { ok: false, error: mismatch }
      : { ok: true, data: result.data as T | null };
  } catch (error) {
    return { ok: false, error: sourceError(error) };
  }
}

async function safeDiscountSource(args: {
  supabase: SettingsReadinessOverviewClient;
  organizationId: string;
  storeId: string;
}): Promise<SettingsReadinessSource<DiscountSettingsReadinessSourceData>> {
  try {
    const result = await readStoreDiscountSettingsBySystem(args);
    if (!result.ok) return result;

    return {
      ok: true,
      data: {
        settings: result.settings,
        highValueSettings: result.highValueSettings,
      },
    };
  } catch (error) {
    return { ok: false, error: sourceError(error) };
  }
}

export async function loadStoreSettingsReadiness(args: {
  supabase: SettingsReadinessOverviewClient;
  organizationId: string;
  storeId: string;
}): Promise<StoreSettingsReadinessResolution> {
  const [operationSettings, operationExecutionPolicies, payment, discount, channel, commercialAi, strategy] =
    await Promise.all([
      safeTableSource<OperationSettingsReadinessRow>({
        ...args,
        table: "store_operation_settings",
        columns: "organization_id, store_id, offers_installation, offers_technical_visit",
      }),
      safeRpcSource<OperationExecutionPoliciesReadinessRow>({
        ...args,
        name: "read_store_operation_execution_policies_by_system",
      }),
      safeRpcSource<PaymentSettingsReadinessRow>({
        ...args,
        name: "read_store_payment_settings_by_system",
      }),
      safeDiscountSource(args),
      safeRpcSource<ChannelSettingsReadinessRow>({
        ...args,
        name: "read_store_channel_settings_by_system",
      }),
      safeTableSource<CommercialAiSettingsReadinessRow>({
        ...args,
        table: "store_commercial_ai_settings",
        columns:
          "organization_id, store_id, price_answer_policy, price_context_requirements, price_policy_configured_at, complementary_suggestions_configured_at, complementary_suggestions_enabled, complementary_scope_mode, complementary_category_keys, complementary_line_keys, complementary_allowed_moments",
      }),
      safeRpcSource<StrategySettingsReadinessRow>({
        ...args,
        name: "read_store_strategy_settings_by_system",
      }),
    ]);

  const sources: StoreSettingsReadinessSources = {
    operation: {
      settings: operationSettings,
      executionPolicies: operationExecutionPolicies,
    },
    payment,
    discount,
    channel,
    commercialAi,
    strategy,
  };

  return resolveStoreSettingsReadiness(
    adaptStoreSettingsReadinessSources(sources),
  );
}

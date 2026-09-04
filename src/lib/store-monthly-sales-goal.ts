export type StoreMonthlySalesGoalRow = {
  organization_id: string;
  store_id: string;
  monthly_goal_enabled: boolean | null;
  monthly_goal_amount_cents: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type StoreMonthlySalesGoalInput = {
  enabled: boolean;
  amountCents: number | null;
};

export type StoreMonthlySalesGoalState = StoreMonthlySalesGoalInput & {
  configured: boolean;
  revenueKnown: boolean;
  progressPercent: number | null;
  remainingCents: number | null;
};

function toInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }

  return null;
}

export function normalizeMonthlySalesGoalInput(
  input: StoreMonthlySalesGoalInput,
): StoreMonthlySalesGoalInput {
  if (!input.enabled) {
    return {
      enabled: false,
      amountCents: null,
    };
  }

  const amountCents = toInteger(input.amountCents);
  if (amountCents == null || amountCents <= 0) {
    throw new Error("MONTHLY_SALES_GOAL_AMOUNT_REQUIRED");
  }

  return {
    enabled: true,
    amountCents,
  };
}

export function normalizeStoreMonthlySalesGoalRow(
  row: StoreMonthlySalesGoalRow | null | undefined,
): StoreMonthlySalesGoalInput {
  if (!row || row.monthly_goal_enabled !== true) {
    return {
      enabled: false,
      amountCents: null,
    };
  }

  const amountCents = toInteger(row.monthly_goal_amount_cents);
  if (amountCents == null || amountCents <= 0) {
    return {
      enabled: false,
      amountCents: null,
    };
  }

  return {
    enabled: true,
    amountCents,
  };
}

export function buildMonthlySalesGoalState(args: {
  row: StoreMonthlySalesGoalRow | null | undefined;
  currentRevenueCents: number | null | undefined;
}): StoreMonthlySalesGoalState {
  const normalized = normalizeStoreMonthlySalesGoalRow(args.row);
  const parsedRevenueCents = toInteger(args.currentRevenueCents);
  const revenueKnown = parsedRevenueCents != null;
  const currentRevenueCents = Math.max(0, parsedRevenueCents ?? 0);

  const configured =
    args.row != null &&
    (
      (
        args.row.monthly_goal_enabled === false &&
        args.row.monthly_goal_amount_cents === null
      ) ||
      (
        args.row.monthly_goal_enabled === true &&
        normalized.enabled === true &&
        normalized.amountCents != null
      )
    );

  if (!normalized.enabled || normalized.amountCents == null) {
    return {
      ...normalized,
      configured,
      revenueKnown,
      progressPercent: null,
      remainingCents: null,
    };
  }

  if (!revenueKnown) {
    return {
      ...normalized,
      configured: true,
      revenueKnown: false,
      progressPercent: null,
      remainingCents: null,
    };
  }

  const remainingCents = Math.max(0, normalized.amountCents - currentRevenueCents);
  const progressPercent = Math.min(
    999,
    Math.round((currentRevenueCents / normalized.amountCents) * 100),
  );

  return {
    ...normalized,
    configured: true,
    revenueKnown: true,
    progressPercent,
    remainingCents,
  };
}

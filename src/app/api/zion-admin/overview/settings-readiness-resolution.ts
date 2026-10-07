export const STORE_SETTINGS_READINESS_FAMILIES = [
  "operation",
  "payment",
  "discount",
  "channel",
  "commercial_ai",
  "strategy",
] as const;

export type StoreSettingsReadinessFamily =
  (typeof STORE_SETTINGS_READINESS_FAMILIES)[number];

export type StoreSettingsReadinessState =
  | "ready"
  | "attention"
  | "blocked"
  | "unknown";

export type StoreSettingsReadinessIssue = {
  code: string;
  message: string;
};

export type StoreSettingsReadinessFamilyInput = {
  state: StoreSettingsReadinessState;
  issues?: readonly StoreSettingsReadinessIssue[];
};

export type StoreSettingsReadinessInput = Readonly<
  Record<StoreSettingsReadinessFamily, StoreSettingsReadinessFamilyInput>
>;

export type StoreSettingsReadinessResolvedFamily = {
  family: StoreSettingsReadinessFamily;
  state: StoreSettingsReadinessState;
  issues: StoreSettingsReadinessIssue[];
};

export type StoreSettingsReadinessResolvedIssue =
  StoreSettingsReadinessIssue & {
    family: StoreSettingsReadinessFamily;
    state: Exclude<StoreSettingsReadinessState, "ready">;
  };

export type StoreSettingsReadinessResolution = {
  overall: StoreSettingsReadinessState;
  counts: Record<StoreSettingsReadinessState, number>;
  families: StoreSettingsReadinessResolvedFamily[];
  issues: StoreSettingsReadinessResolvedIssue[];
};

const STATE_PRIORITY: Record<StoreSettingsReadinessState, number> = {
  ready: 0,
  attention: 1,
  unknown: 2,
  blocked: 3,
};

export function resolveStoreSettingsReadiness(
  input: StoreSettingsReadinessInput,
): StoreSettingsReadinessResolution {
  const families: StoreSettingsReadinessResolvedFamily[] =
    STORE_SETTINGS_READINESS_FAMILIES.map((family) => ({
      family,
      state: input[family].state,
      issues: [...(input[family].issues ?? [])],
    }));

  const counts: Record<StoreSettingsReadinessState, number> = {
    ready: 0,
    attention: 0,
    blocked: 0,
    unknown: 0,
  };

  let overall: StoreSettingsReadinessState = "ready";

  for (const family of families) {
    counts[family.state] += 1;

    if (STATE_PRIORITY[family.state] > STATE_PRIORITY[overall]) {
      overall = family.state;
    }
  }

  const issues: StoreSettingsReadinessResolvedIssue[] = families.flatMap(
    (family) => {
      if (family.state === "ready") {
        return [];
      }

      const state: Exclude<StoreSettingsReadinessState, "ready"> =
        family.state;

      return family.issues.map((issue) => ({
        ...issue,
        family: family.family,
        state,
      }));
    },
  );

  return {
    overall,
    counts,
    families,
    issues,
  };
}
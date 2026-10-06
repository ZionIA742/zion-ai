export type StoreIntegrityIssueCode =
  | "organization_missing"
  | "owner_missing"
  | "owner_ambiguous"
  | "owner_inactive"
  | "owner_profile_missing"
  | "subscription_missing"
  | "subscription_multiple";

export type StoreIntegrityIssue = {
  code: StoreIntegrityIssueCode;
  severity: "warning" | "error";
  scope: "store" | "organization" | "owner" | "subscription";
};

export type StoreIntegrity = {
  state: "healthy" | "warning" | "broken" | "unknown";
  issues: StoreIntegrityIssue[];
  organization: {
    state: "present" | "missing" | "unknown";
  };
  owner: {
    state: "valid" | "missing" | "inactive" | "ambiguous" | "unknown";
    count: number | null;
  };
  subscription: {
    state: "single" | "missing" | "multiple" | "unknown";
    status: string | null;
  };
};

type OwnerMembership = {
  id: string;
  user_id: string;
  is_active: boolean | null;
};

type OwnerProfile = {
  user_id: string;
};

type Subscription = {
  status: string | null;
};

export function resolveStoreIntegrity(args: {
  organizationState: "present" | "missing" | "unknown";
  ownerMemberships: OwnerMembership[] | null;
  ownerProfiles: OwnerProfile[] | null;
  subscriptions: Subscription[] | null;
}): StoreIntegrity {
  const issues: StoreIntegrityIssue[] = [];
  const organization = { state: args.organizationState };

  let owner: StoreIntegrity["owner"];
  if (args.ownerMemberships === null) {
    owner = { state: "unknown", count: null };
  } else if (args.ownerMemberships.length === 0) {
    owner = { state: "missing", count: 0 };
    issues.push({ code: "owner_missing", severity: "error", scope: "owner" });
  } else if (args.ownerMemberships.length > 1) {
    owner = { state: "ambiguous", count: args.ownerMemberships.length };
    issues.push({ code: "owner_ambiguous", severity: "error", scope: "owner" });
  } else {
    const membership = args.ownerMemberships[0];
    const profileExists = args.ownerProfiles?.some(
      (profile) => profile.user_id === membership.user_id,
    );
    const inactive = membership.is_active !== true;

    owner = { state: inactive ? "inactive" : "valid", count: 1 };

    if (inactive) {
      issues.push({ code: "owner_inactive", severity: "warning", scope: "owner" });
    }
    if (args.ownerProfiles !== null && !profileExists) {
      issues.push({
        code: "owner_profile_missing",
        severity: "warning",
        scope: "owner",
      });
    }
  }

  let subscription: StoreIntegrity["subscription"];
  if (args.subscriptions === null) {
    subscription = { state: "unknown", status: null };
  } else if (args.subscriptions.length === 0) {
    subscription = { state: "missing", status: null };
    issues.push({
      code: "subscription_missing",
      severity: "warning",
      scope: "subscription",
    });
  } else if (args.subscriptions.length > 1) {
    subscription = { state: "multiple", status: null };
    issues.push({
      code: "subscription_multiple",
      severity: "error",
      scope: "subscription",
    });
  } else {
    subscription = {
      state: "single",
      status: args.subscriptions[0]?.status ?? null,
    };
  }

  if (args.organizationState === "missing") {
    issues.unshift({
      code: "organization_missing",
      severity: "error",
      scope: "organization",
    });
  }

  const hasError = issues.some((issue) => issue.severity === "error");
  const hasUnknown =
    args.organizationState === "unknown" ||
    args.ownerMemberships === null ||
    args.ownerProfiles === null ||
    args.subscriptions === null;

  return {
    state: hasError ? "broken" : hasUnknown ? "unknown" : issues.length > 0 ? "warning" : "healthy",
    issues,
    organization,
    owner,
    subscription,
  };
}

import type { StoreDiscountSettingsRow } from "../store-discount-settings";

export const TRANSACTIONAL_COMMERCIAL_AUTHORITY_STATES = [
  "allowed",
  "human_approval_required",
  "blocked",
  "unconfigured",
] as const;

export type TransactionalCommercialAuthorityState =
  (typeof TRANSACTIONAL_COMMERCIAL_AUTHORITY_STATES)[number];

export const TRANSACTIONAL_COMMERCIAL_AUTHORITY_ACTIONS = [
  "apply_discount",
] as const;

export type TransactionalCommercialAuthorityAction =
  (typeof TRANSACTIONAL_COMMERCIAL_AUTHORITY_ACTIONS)[number];

export type TransactionalCommercialAuthorityScope = {
  organizationId?: string | null;
  storeId?: string | null;
  commercialOpportunityId?: string | null;
  quoteId?: string | null;
  quoteVersionId?: string | null;
};

export type TransactionalCommercialAuthorityProvenance = {
  policyFingerprint?: string | null;
  policyVersion?: string | null;
  source?: string | null;
  issuedAt?: string | null;
  validUntil?: string | null;
};

export type TransactionalCommercialAuthority = {
  action: string;
  requestedDiscountPercent: number | null;
  state: TransactionalCommercialAuthorityState;
  canOffer: boolean;
  canApply: boolean;
  canRequestApproval: boolean;
  requiresHumanApproval: boolean;
  scope: TransactionalCommercialAuthorityScope;
  provenance: TransactionalCommercialAuthorityProvenance;
  reasonCode: string;
};

export type TransactionalCommercialAuthorityInput = {
  action: unknown;
  requestedDiscountPercent: unknown;
  settings?: StoreDiscountSettingsRow | null;
  /** Offer capability is supplied by the behavior layer and never grants apply. */
  canOffer?: unknown;
  scope?: unknown;
  provenance?: unknown;
};

const VALID_AUTONOMY_MODES = new Set([
  "approval_required",
  "default_step_autonomous",
  "within_policy_autonomous",
]);

const VALID_ACTIONS = new Set<string>(
  TRANSACTIONAL_COMMERCIAL_AUTHORITY_ACTIONS,
);

function cleanText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function readScope(value: unknown): TransactionalCommercialAuthorityScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const source = value as Record<string, unknown>;
  return {
    organizationId: cleanText(source.organizationId),
    storeId: cleanText(source.storeId),
    commercialOpportunityId: cleanText(source.commercialOpportunityId),
    quoteId: cleanText(source.quoteId),
    quoteVersionId: cleanText(source.quoteVersionId),
  };
}

function readProvenance(
  value: unknown,
): TransactionalCommercialAuthorityProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const source = value as Record<string, unknown>;
  return {
    policyFingerprint: cleanText(source.policyFingerprint),
    policyVersion: cleanText(source.policyVersion),
    source: cleanText(source.source),
    issuedAt: cleanText(source.issuedAt),
    validUntil: cleanText(source.validUntil),
  };
}

function isFinitePercent(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

function failClosedIdentity(args: {
  action: string;
  requestedDiscountPercent: number;
  reasonCode: string;
  scope: TransactionalCommercialAuthorityScope;
  provenance: TransactionalCommercialAuthorityProvenance;
}): TransactionalCommercialAuthority {
  return failClosed({
    action: args.action,
    requestedDiscountPercent: args.requestedDiscountPercent,
    state: "blocked",
    reasonCode: args.reasonCode,
    scope: args.scope,
    provenance: args.provenance,
  });
}

function failClosed(args: {
  action: string;
  requestedDiscountPercent: number | null;
  state: TransactionalCommercialAuthorityState;
  reasonCode: string;
  scope: TransactionalCommercialAuthorityScope;
  provenance: TransactionalCommercialAuthorityProvenance;
}): TransactionalCommercialAuthority {
  return {
    action: args.action,
    requestedDiscountPercent: args.requestedDiscountPercent,
    state: args.state,
    canOffer: false,
    canApply: false,
    canRequestApproval: false,
    requiresHumanApproval: false,
    scope: args.scope,
    provenance: args.provenance,
    reasonCode: args.reasonCode,
  };
}

function decision(args: {
  action: string;
  requestedDiscountPercent: number;
  state: "allowed" | "human_approval_required";
  canOffer: boolean;
  scope: TransactionalCommercialAuthorityScope;
  provenance: TransactionalCommercialAuthorityProvenance;
  reasonCode: string;
}): TransactionalCommercialAuthority {
  const requiresHumanApproval = args.state === "human_approval_required";
  return {
    action: args.action,
    requestedDiscountPercent: args.requestedDiscountPercent,
    state: args.state,
    canOffer: args.canOffer,
    canApply: !requiresHumanApproval,
    canRequestApproval: requiresHumanApproval,
    requiresHumanApproval,
    scope: args.scope,
    provenance: args.provenance,
    reasonCode: args.reasonCode,
  };
}

/**
 * Evaluates only the transactional discount limit from canonical store
 * Settings. It does not decide whether a commercial strategy should offer it.
 */
export function resolveTransactionalCommercialAuthority(
  input: TransactionalCommercialAuthorityInput,
): TransactionalCommercialAuthority {
  const action = cleanText(input?.action) ?? "unknown";
  const scope = readScope(input?.scope);
  const provenance = readProvenance(input?.provenance);
  const requestedDiscountPercent = input?.requestedDiscountPercent;

  if (!VALID_ACTIONS.has(action)) {
    return failClosed({
      action,
      requestedDiscountPercent: null,
      state: "blocked",
      reasonCode: "TRANSACTIONAL_AUTHORITY_ACTION_INVALID",
      scope,
      provenance,
    });
  }

  if (!isFinitePercent(requestedDiscountPercent)) {
    return failClosed({
      action,
      requestedDiscountPercent: null,
      state: "blocked",
      reasonCode: "TRANSACTIONAL_AUTHORITY_DISCOUNT_INVALID",
      scope,
      provenance,
    });
  }

  if (requestedDiscountPercent === 0) {
    return failClosed({
      action,
      requestedDiscountPercent,
      state: "blocked",
      reasonCode: "TRANSACTIONAL_AUTHORITY_NO_DISCOUNT_REQUESTED",
      scope,
      provenance,
    });
  }

  const settings = input?.settings;
  if (!settings) {
    return failClosed({
      action,
      requestedDiscountPercent,
      state: "unconfigured",
      reasonCode: "TRANSACTIONAL_AUTHORITY_POLICY_UNCONFIGURED",
      scope,
      provenance,
    });
  }

  const policyOrganizationId = cleanText(settings.organization_id);
  const policyStoreId = cleanText(settings.store_id);
  if (!scope.organizationId || !scope.storeId || !policyOrganizationId || !policyStoreId) {
    return failClosedIdentity({
      action,
      requestedDiscountPercent,
      reasonCode: "TRANSACTIONAL_AUTHORITY_POLICY_IDENTITY_UNCONFIGURED",
      scope,
      provenance,
    });
  }

  if (scope.organizationId !== policyOrganizationId) {
    return failClosedIdentity({
      action,
      requestedDiscountPercent,
      reasonCode: "TRANSACTIONAL_AUTHORITY_ORGANIZATION_MISMATCH",
      scope,
      provenance,
    });
  }

  if (scope.storeId !== policyStoreId) {
    return failClosedIdentity({
      action,
      requestedDiscountPercent,
      reasonCode: "TRANSACTIONAL_AUTHORITY_STORE_MISMATCH",
      scope,
      provenance,
    });
  }

  const mode = cleanText(settings.discount_autonomy_mode);
  const defaultDiscountPercent = settings.default_discount_percent;
  const maxDiscountPercent = settings.max_discount_percent;
  const modeIsInvalid = mode !== null && !VALID_AUTONOMY_MODES.has(mode);
  const policyIsValid =
    mode !== null &&
    !modeIsInvalid &&
    isFinitePercent(defaultDiscountPercent) &&
    isFinitePercent(maxDiscountPercent) &&
    defaultDiscountPercent <= maxDiscountPercent &&
    typeof settings.allow_ask_above_max_discount === "boolean";

  if (!policyIsValid) {
    return failClosed({
      action,
      requestedDiscountPercent,
      state: modeIsInvalid ? "blocked" : "unconfigured",
      reasonCode: modeIsInvalid
        ? "TRANSACTIONAL_AUTHORITY_MODE_INVALID"
        : "TRANSACTIONAL_AUTHORITY_POLICY_INVALID",
      scope,
      provenance,
    });
  }

  const canOffer = booleanValue(input?.canOffer);

  if (mode === "approval_required") {
    return decision({
      action,
      requestedDiscountPercent,
      state: "human_approval_required",
      canOffer,
      scope,
      provenance,
      reasonCode: "TRANSACTIONAL_AUTHORITY_APPROVAL_REQUIRED",
    });
  }

  if (requestedDiscountPercent <= maxDiscountPercent) {
    if (
      mode === "within_policy_autonomous" ||
      requestedDiscountPercent <= defaultDiscountPercent
    ) {
      return decision({
        action,
        requestedDiscountPercent,
        state: "allowed",
        canOffer,
        scope,
        provenance,
        reasonCode: "TRANSACTIONAL_AUTHORITY_WITHIN_POLICY",
      });
    }

    return decision({
      action,
      requestedDiscountPercent,
      state: "human_approval_required",
      canOffer,
      scope,
      provenance,
      reasonCode: "TRANSACTIONAL_AUTHORITY_ABOVE_DEFAULT_REQUIRES_APPROVAL",
    });
  }

  if (settings.allow_ask_above_max_discount) {
    return decision({
      action,
      requestedDiscountPercent,
      state: "human_approval_required",
      canOffer,
      scope,
      provenance,
      reasonCode: "TRANSACTIONAL_AUTHORITY_ABOVE_MAX_REQUIRES_APPROVAL",
    });
  }

  return failClosed({
    action,
    requestedDiscountPercent,
    state: "blocked",
    reasonCode: "TRANSACTIONAL_AUTHORITY_ABOVE_MAX_BLOCKED",
    scope,
    provenance,
  });
}

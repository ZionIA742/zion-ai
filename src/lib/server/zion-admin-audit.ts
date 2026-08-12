import { createServiceSupabaseClient } from "./zion-account-provisioning";

export type ZionAdminAuditAction =
  | "account.create"
  | "account.first_access_resend"
  | "account.access_block"
  | "account.access_reactivate"
  | "store.suspend"
  | "store.reactivate";

export type ZionAdminAuditTargetType = "user" | "membership" | "store";

export type ZionAdminAuditOutcome = "started" | "success" | "failed" | "denied";

type ZionAdminAuditStateValue = "active" | "blocked" | "unavailable" | "suspended";
type ZionAdminAuditSubscriptionStatus = "active" | "suspended" | "unavailable";

type ZionAdminAuditMetadata = {
  reason_code?: string;
  membership_id?: string;
  user_id?: string;
  subscription_id?: string;
  previous_state?: ZionAdminAuditStateValue;
  next_state?: ZionAdminAuditStateValue;
  membership_is_active?: boolean;
  profile_is_blocked?: boolean;
  subscription_status?: ZionAdminAuditSubscriptionStatus;
  external_integrations_disabled?: boolean;
};

export type WriteZionAdminAuditEventParams = {
  actorUserId: string;
  action: ZionAdminAuditAction;
  targetType: ZionAdminAuditTargetType;
  targetId?: string | null;
  organizationId?: string | null;
  storeId?: string | null;
  outcome: ZionAdminAuditOutcome;
  operationId?: string | null;
  reasonCode?: string | null;
  membershipId?: string | null;
  userId?: string | null;
  subscriptionId?: string | null;
  previousState?: ZionAdminAuditStateValue | null;
  nextState?: ZionAdminAuditStateValue | null;
  membershipIsActive?: boolean | null;
  profileIsBlocked?: boolean | null;
  subscriptionStatus?: ZionAdminAuditSubscriptionStatus | null;
  externalIntegrationsDisabled?: boolean | null;
  serviceSupabase?: ReturnType<typeof createServiceSupabaseClient>;
};

type ZionAdminAuditOperationParams = Omit<WriteZionAdminAuditEventParams, "outcome" | "operationId">;
type ZionAdminAuditOperationTerminalParams = Omit<WriteZionAdminAuditEventParams, "operationId"> & {
  operationId: string;
  outcome: Exclude<ZionAdminAuditOutcome, "started">;
};

function normalizeUuidLike(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeMetadata(params: WriteZionAdminAuditEventParams): ZionAdminAuditMetadata {
  const metadata: ZionAdminAuditMetadata = {};

  const reasonCode = String(params.reasonCode || "").trim();
  const membershipId = normalizeUuidLike(params.membershipId);
  const userId = normalizeUuidLike(params.userId);
  const subscriptionId = normalizeUuidLike(params.subscriptionId);
  const previousState = params.previousState ?? null;
  const nextState = params.nextState ?? null;
  const membershipIsActive =
    typeof params.membershipIsActive === "boolean" ? params.membershipIsActive : null;
  const profileIsBlocked =
    typeof params.profileIsBlocked === "boolean" ? params.profileIsBlocked : null;
  const subscriptionStatus = params.subscriptionStatus ?? null;
  const externalIntegrationsDisabled =
    typeof params.externalIntegrationsDisabled === "boolean"
      ? params.externalIntegrationsDisabled
      : null;

  if (reasonCode) {
    metadata.reason_code = reasonCode;
  }

  if (membershipId) {
    metadata.membership_id = membershipId;
  }

  if (userId) {
    metadata.user_id = userId;
  }

  if (subscriptionId) {
    metadata.subscription_id = subscriptionId;
  }

  if (previousState) {
    metadata.previous_state = previousState;
  }

  if (nextState) {
    metadata.next_state = nextState;
  }

  if (membershipIsActive !== null) {
    metadata.membership_is_active = membershipIsActive;
  }

  if (profileIsBlocked !== null) {
    metadata.profile_is_blocked = profileIsBlocked;
  }

  if (subscriptionStatus) {
    metadata.subscription_status = subscriptionStatus;
  }

  if (externalIntegrationsDisabled !== null) {
    metadata.external_integrations_disabled = externalIntegrationsDisabled;
  }

  return metadata;
}

export async function writeZionAdminAuditEvent(
  params: WriteZionAdminAuditEventParams,
) {
  const actorUserId = normalizeUuidLike(params.actorUserId);
  const operationId = normalizeUuidLike(params.operationId) ?? crypto.randomUUID();

  if (!actorUserId) {
    throw new Error("actorUserId is required for zion admin audit.");
  }

  const serviceSupabase =
    params.serviceSupabase ?? createServiceSupabaseClient();

  const { error } = await serviceSupabase.from("zion_admin_audit_events").insert({
    operation_id: operationId,
    actor_user_id: actorUserId,
    action: params.action,
    target_type: params.targetType,
    target_id: normalizeUuidLike(params.targetId),
    organization_id: normalizeUuidLike(params.organizationId),
    store_id: normalizeUuidLike(params.storeId),
    outcome: params.outcome,
    metadata: normalizeMetadata(params),
  });

  if (error) {
    throw error;
  }

  return operationId;
}

export async function startZionAdminAuditOperation(
  params: ZionAdminAuditOperationParams,
) {
  return writeZionAdminAuditEvent({
    ...params,
    outcome: "started",
  });
}

export async function finishZionAdminAuditOperation(
  params: ZionAdminAuditOperationTerminalParams,
) {
  return writeZionAdminAuditEvent(params);
}

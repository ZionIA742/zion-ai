import {
  type AuthAdminUser,
  type FirstAccessAttemptState,
  FIRST_ACCESS_SUCCESS_MESSAGE,
  getInvalidFirstAccessAttemptMessage,
  maskEmail,
  type PasswordFlowState,
  type PasswordLoginRequirementResolution,
  type PasswordLoginRequirementState,
  PROVISIONING_SOURCE,
  type ProvisioningStatus,
  type TrustedPasswordFlowResolution,
} from "../zion-account-provisioning-shared";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

export const FIRST_ACCESS_INVITE_COOLDOWN_MS = 60_000;
export const AUTH_ADMIN_RETRY_ATTEMPTS = 3;
export const AUTH_ADMIN_RETRY_DELAY_MS = 120;
export {
  FIRST_ACCESS_SUCCESS_MESSAGE,
  PROVISIONING_SOURCE,
  getInvalidFirstAccessAttemptMessage,
  maskEmail,
};
export type {
  AuthAdminUser,
  FirstAccessAttemptState,
  PasswordFlowState,
  PasswordLoginRequirementResolution,
  PasswordLoginRequirementState,
  ProvisioningStatus,
  TrustedPasswordFlowResolution,
};

type ServiceSupabaseClient = ReturnType<typeof createServiceSupabaseClient>;

function normalizeAppMetadata(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return value ? { ...value } : {};
}

function normalizeMetadataString(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function readProvisioningStatus(
  metadata: Record<string, unknown>,
): ProvisioningStatus | null {
  const value = metadata.zion_provisioning_status;

  return value === "pending" || value === "provisioned" || value === "failed"
    ? value
    : null;
}

function readCompletedAt(metadata: Record<string, unknown>) {
  return normalizeMetadataString(metadata.zion_first_access_completed_at);
}

export function createServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service role nao configurada.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function mergeProvisioningAppMetadata(
  currentMetadata: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
) {
  return {
    ...normalizeAppMetadata(currentMetadata),
    ...patch,
  };
}

export async function getAuthAdminUserById(
  serviceSupabase: ServiceSupabaseClient,
  userId: string,
) {
  const { data, error } = await serviceSupabase.auth.admin.getUserById(userId);

  if (error || !data.user) {
    throw error || new Error("Auth user not found.");
  }

  return data.user as AuthAdminUser;
}

export function createFirstAccessAttemptId() {
  const randomUuid =
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : typeof randomUUID === "function"
        ? randomUUID()
        : randomBytes(16).toString("hex");

  return `fia_${randomUuid.replace(/[^a-zA-Z0-9]/g, "")}`;
}

function getBaseSiteUrl() {
  const rawBaseUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_VERCEL_URL?.trim() ||
    "";

  if (!rawBaseUrl) {
    return null;
  }

  return /^https?:\/\//i.test(rawBaseUrl)
    ? rawBaseUrl
    : `https://${rawBaseUrl}`;
}

export function getFirstAccessInviteRedirectTo(attemptId: string) {
  const baseSiteUrl = getBaseSiteUrl();

  if (!baseSiteUrl) {
    return undefined;
  }

  const callbackUrl = new URL("/auth/callback", baseSiteUrl.replace(/\/+$/, ""));
  callbackUrl.searchParams.set("next", "/auth/set-initial-password");
  callbackUrl.searchParams.set("attempt", attemptId);
  return callbackUrl.toString();
}

export function getRecoveryRedirectTo() {
  const baseSiteUrl = getBaseSiteUrl();

  if (!baseSiteUrl) {
    return undefined;
  }

  const callbackUrl = new URL("/auth/callback", baseSiteUrl.replace(/\/+$/, ""));
  callbackUrl.searchParams.set("next", "/auth/reset-password");
  return callbackUrl.toString();
}

export function readFirstAccessInviteId(
  metadata: Record<string, unknown> | null | undefined,
) {
  return normalizeMetadataString(metadata?.zion_first_access_invite_id);
}

export function readFirstAccessInviteSentAt(
  metadata: Record<string, unknown> | null | undefined,
) {
  return normalizeMetadataString(metadata?.zion_first_access_invite_sent_at);
}

export function readFirstAccessInviteSentBy(
  metadata: Record<string, unknown> | null | undefined,
) {
  return normalizeMetadataString(metadata?.zion_first_access_invite_sent_by);
}

export function readPasswordLoginRequiredAfter(
  metadata: Record<string, unknown> | null | undefined,
) {
  return normalizeMetadataString(metadata?.zion_password_login_required_after);
}

function parseIsoTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isFirstAccessInviteCooldownActive(
  metadata: Record<string, unknown> | null | undefined,
  now = Date.now(),
) {
  const sentAt = readFirstAccessInviteSentAt(metadata);

  if (!sentAt) {
    return false;
  }

  const parsed = new Date(sentAt).getTime();

  if (!Number.isFinite(parsed)) {
    return false;
  }

  return now - parsed < FIRST_ACCESS_INVITE_COOLDOWN_MS;
}

export function getFirstAccessInviteCooldownRemainingMs(
  metadata: Record<string, unknown> | null | undefined,
  now = Date.now(),
) {
  const sentAt = readFirstAccessInviteSentAt(metadata);

  if (!sentAt) {
    return 0;
  }

  const parsed = new Date(sentAt).getTime();

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, FIRST_ACCESS_INVITE_COOLDOWN_MS - (now - parsed));
}

export function createFirstAccessInviteMetadataPatch(params: {
  attemptId: string;
  sentAt: string;
  sentBy: string;
  status: ProvisioningStatus;
}) {
  return {
    provisioned_via: PROVISIONING_SOURCE,
    zion_provisioning_status: params.status,
    zion_first_access_required: true,
    zion_first_access_invite_id: params.attemptId,
    zion_first_access_invite_sent_at: params.sentAt,
    zion_first_access_invite_sent_by: params.sentBy,
  };
}

export function getPasswordLoginRequiredMessage() {
  return "Sua senha ja foi criada. Entre novamente com seu e-mail e sua nova senha.";
}

export function resolveTrustedPasswordFlow(
  user: AuthAdminUser,
  options?: { attemptId?: string | null },
): TrustedPasswordFlowResolution {
  const metadata = normalizeAppMetadata(user.app_metadata);
  const source = metadata.provisioned_via;
  const status = readProvisioningStatus(metadata);
  const firstAccessRequired = metadata.zion_first_access_required === true;
  const expectedAttemptId = readFirstAccessInviteId(metadata);
  const receivedAttemptId = normalizeMetadataString(options?.attemptId);

  if (source === PROVISIONING_SOURCE) {
    if (status === "pending") {
      return {
        flow: "provisioning_pending",
        message:
          "O provisionamento da sua conta ainda esta pendente de conclusao administrativa.",
        expectedAttemptId,
        attemptState: "not_applicable",
      };
    }

    if (status === "failed") {
      return {
        flow: "provisioning_failed",
        message:
          "O provisionamento da sua conta exige revisao interna antes de qualquer acesso.",
        expectedAttemptId,
        attemptState: "not_applicable",
      };
    }

    if (status === "provisioned" && firstAccessRequired) {
      const attemptState = receivedAttemptId
        ? expectedAttemptId && expectedAttemptId === receivedAttemptId
          ? "valid"
          : "mismatch"
        : expectedAttemptId
          ? "missing"
          : "mismatch";

      return {
        flow: "first_access",
        message: "Defina sua primeira senha para concluir o acesso inicial.",
        expectedAttemptId,
        attemptState,
      };
    }

    if (status === "provisioned") {
      return {
        flow: "recovery",
        message: readCompletedAt(metadata)
          ? "Digite sua nova senha para concluir a recuperacao."
          : "Digite sua nova senha para concluir a recuperacao.",
        expectedAttemptId,
        attemptState: "not_applicable",
      };
    }

    return {
      flow: "invalid_account",
      message:
        "A conta possui marcadores administrativos incompletos e precisa de revisao interna.",
      expectedAttemptId,
      attemptState: "not_applicable",
    };
  }

  return {
    flow: "recovery",
    message: "Digite sua nova senha para concluir a recuperacao.",
    expectedAttemptId: null,
    attemptState: "not_applicable",
  };
}

export function resolvePasswordLoginRequirement(
  user: AuthAdminUser,
  jwtIssuedAtSeconds: number | null | undefined,
): PasswordLoginRequirementResolution {
  const metadata = normalizeAppMetadata(user.app_metadata);

  if (metadata.provisioned_via !== PROVISIONING_SOURCE) {
    return {
      state: "not_applicable",
      requiredAfterIso: null,
    };
  }

  const requiredAfterIso = readPasswordLoginRequiredAfter(metadata);

  if (!requiredAfterIso) {
    return {
      state: "not_applicable",
      requiredAfterIso: null,
    };
  }

  const requiredAfterMs = parseIsoTimestamp(requiredAfterIso);

  if (requiredAfterMs === null) {
    return {
      state: "invalid_marker",
      requiredAfterIso,
    };
  }

  if (!Number.isFinite(jwtIssuedAtSeconds) || Number(jwtIssuedAtSeconds) <= 0) {
    return {
      state: "login_required",
      requiredAfterIso,
    };
  }

  const jwtIssuedAtMs = Number(jwtIssuedAtSeconds) * 1000;

  return jwtIssuedAtMs < requiredAfterMs
    ? {
        state: "login_required",
        requiredAfterIso,
      }
    : {
        state: "satisfied",
        requiredAfterIso,
      };
}

export function getProvisioningAccountAccessSummary(user: AuthAdminUser) {
  const metadata = normalizeAppMetadata(user.app_metadata);
  const status = readProvisioningStatus(metadata);
  const firstAccessRequired = metadata.zion_first_access_required === true;
  const completedAt = readCompletedAt(metadata);

  if (metadata.provisioned_via !== PROVISIONING_SOURCE || !status) {
    return {
      status: "invalid_account" as const,
      label: "Marcadores administrativos invalidos",
      canResend: false,
      completedAt: null,
      sentAt: readFirstAccessInviteSentAt(metadata),
    };
  }

  if (status === "pending") {
    return {
      status: "provisioning_pending" as const,
      label: "Provisionamento pendente",
      canResend: false,
      completedAt: null,
      sentAt: readFirstAccessInviteSentAt(metadata),
    };
  }

  if (status === "failed") {
    return {
      status: "provisioning_failed" as const,
      label: "Provisionamento com falha",
      canResend: false,
      completedAt: null,
      sentAt: readFirstAccessInviteSentAt(metadata),
    };
  }

  if (firstAccessRequired) {
    return {
      status: "first_access_pending" as const,
      label: "Aguardando definicao da primeira senha",
      canResend: true,
      completedAt: null,
      sentAt: readFirstAccessInviteSentAt(metadata),
    };
  }

  return {
    status: "first_access_completed" as const,
    label: "Acesso configurado",
    canResend: false,
    completedAt,
    sentAt: readFirstAccessInviteSentAt(metadata),
  };
}

export function buildCompletedFirstAccessMetadata(
  currentMetadata: Record<string, unknown> | null | undefined,
  completedAtIso: string,
) {
  return mergeProvisioningAppMetadata(currentMetadata, {
    provisioned_via: PROVISIONING_SOURCE,
    zion_provisioning_status: "provisioned",
    zion_first_access_required: false,
    zion_first_access_completed_at: completedAtIso,
    zion_first_access_invite_id: null,
    zion_password_login_required_after: completedAtIso,
  });
}

export async function sleep(ms: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function getAuthAdminUserByIdWithRetry(
  serviceSupabase: ServiceSupabaseClient,
  userId: string,
  options?: {
    maxAttempts?: number;
    delayMs?: number;
    shouldRetry?: (user: AuthAdminUser) => boolean;
  },
) {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? AUTH_ADMIN_RETRY_ATTEMPTS);
  const delayMs = Math.max(0, options?.delayMs ?? AUTH_ADMIN_RETRY_DELAY_MS);
  let lastUser: AuthAdminUser | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const user = await getAuthAdminUserById(serviceSupabase, userId);
    lastUser = user;

    if (!options?.shouldRetry || !options.shouldRetry(user) || attempt === maxAttempts) {
      return user;
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return lastUser as AuthAdminUser;
}

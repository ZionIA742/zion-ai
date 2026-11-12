export type EmbeddedSignupRecoverySession = {
  whatsappBusinessAccountId: string;
  phoneNumberId?: string;
};

export type EmbeddedSignupRecoveryStatus = {
  ok: boolean;
  connected?: boolean;
  status?: string | null;
  isActive?: boolean;
  phoneNumberId?: string | null;
  whatsappBusinessAccountId?: string | null;
};

export type EmbeddedSignupRecoveryResult =
  | { outcome: "active"; status: EmbeddedSignupRecoveryStatus }
  | { outcome: "absent"; status: EmbeddedSignupRecoveryStatus | null }
  | { outcome: "inconclusive"; status: EmbeddedSignupRecoveryStatus | null };

export const EMBEDDED_SIGNUP_SUBMISSION_TIMEOUT_MS = 30_000;
export const EMBEDDED_SIGNUP_STATUS_RECOVERY_ATTEMPTS = 3;
export const EMBEDDED_SIGNUP_STATUS_RECOVERY_DELAY_MS = 500;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function isEmbeddedSignupStatusForSession(
  status: EmbeddedSignupRecoveryStatus | null,
  session: EmbeddedSignupRecoverySession,
) {
  if (
    !status ||
    status.ok !== true ||
    status.connected !== true ||
    status.isActive !== true ||
    clean(status.status).toLowerCase() !== "active"
  ) {
    return false;
  }

  if (
    clean(status.whatsappBusinessAccountId) &&
    clean(status.whatsappBusinessAccountId) !== clean(session.whatsappBusinessAccountId)
  ) {
    return false;
  }

  if (session.phoneNumberId && clean(status.phoneNumberId) !== clean(session.phoneNumberId)) {
    return false;
  }

  return Boolean(clean(status.phoneNumberId));
}

export async function recoverEmbeddedSignupStatus(args: {
  session: EmbeddedSignupRecoverySession;
  fetchStatus: () => Promise<EmbeddedSignupRecoveryStatus | null>;
  isMounted: () => boolean;
  wait?: (delayMs: number) => Promise<void>;
  attempts?: number;
  delayMs?: number;
}): Promise<EmbeddedSignupRecoveryResult> {
  const attempts = Math.max(1, args.attempts ?? EMBEDDED_SIGNUP_STATUS_RECOVERY_ATTEMPTS);
  const delayMs = Math.max(0, args.delayMs ?? EMBEDDED_SIGNUP_STATUS_RECOVERY_DELAY_MS);
  const wait = args.wait ?? ((delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay)));
  let lastStatus: EmbeddedSignupRecoveryStatus | null = null;
  let receivedAnyStatus = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!args.isMounted()) return { outcome: "inconclusive", status: lastStatus };

    const status = await args.fetchStatus();
    if (status) {
      receivedAnyStatus = true;
      lastStatus = status;
      if (isEmbeddedSignupStatusForSession(status, args.session)) {
        return { outcome: "active", status };
      }
    }

    if (attempt + 1 < attempts) {
      await wait(delayMs);
    }
  }

  return receivedAnyStatus
    ? { outcome: "absent", status: lastStatus }
    : { outcome: "inconclusive", status: null };
}

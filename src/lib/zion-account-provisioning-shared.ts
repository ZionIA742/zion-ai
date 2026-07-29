export const PROVISIONING_SOURCE = "zion-admin";
export const FIRST_ACCESS_SUCCESS_MESSAGE =
  "Senha criada com sucesso. Entre com seu e-mail e sua nova senha.";

export type ProvisioningStatus = "pending" | "provisioned" | "failed";

export type PasswordFlowState =
  | "first_access"
  | "recovery"
  | "provisioning_pending"
  | "provisioning_failed"
  | "invalid_account";

export type FirstAccessAttemptState =
  | "not_applicable"
  | "valid"
  | "missing"
  | "mismatch";

export type PasswordLoginRequirementState =
  | "not_applicable"
  | "login_required"
  | "satisfied"
  | "invalid_marker";

export type AuthAdminUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  invited_at?: string | null;
  last_sign_in_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
};

export type TrustedPasswordFlowResolution = {
  flow: PasswordFlowState;
  message: string;
  expectedAttemptId: string | null;
  attemptState: FirstAccessAttemptState;
};

export type PasswordLoginRequirementResolution = {
  state: PasswordLoginRequirementState;
  requiredAfterIso: string | null;
};

export function getInvalidFirstAccessAttemptMessage(state: FirstAccessAttemptState) {
  if (state === "missing") {
    return "O link recebido esta incompleto ou nao e mais valido. Peca um novo convite.";
  }

  if (state === "mismatch") {
    return "Este link foi substituido, expirou ou ja nao e mais valido. Peca um novo convite.";
  }

  return "Nao foi possivel validar este primeiro acesso. Peca um novo convite.";
}

export function maskEmail(email: string | null | undefined) {
  const normalized = String(email || "").trim().toLowerCase();

  if (!normalized || !normalized.includes("@")) {
    return "E-mail indisponivel";
  }

  const [localPart, domain] = normalized.split("@");

  if (!localPart || !domain) {
    return "E-mail indisponivel";
  }

  if (localPart.length <= 2) {
    return `${localPart[0] || "*"}***@${domain}`;
  }

  return `${localPart[0]}***${localPart[localPart.length - 1]}@${domain}`;
}

export type StoreAccountAccess = {
  membershipId: string | null;
  responsibleName: string | null;
  emailMasked: string;
  userId: string | null;
  isMembershipActive: boolean | null;
  isProfileBlocked: boolean | null;
  accessState: "active" | "blocked" | "unavailable";
  accessStateLabel: string;
  status:
    | "first_access_pending"
    | "first_access_completed"
    | "provisioning_pending"
    | "provisioning_failed"
    | "invalid_account"
    | "ambiguous"
    | "missing";
  statusLabel: string;
  canResend: boolean;
  lastInviteSentAt: string | null;
  firstAccessCompletedAt: string | null;
  lastInviteHistoryStatus?: "available" | "unavailable";
  firstAccessHistoryStatus?: "available" | "unavailable";
  cooldownRemainingMs: number;
};

export type FirstAccessControlState = {
  label: string;
  disabled: boolean;
  reason: string | null;
  confirmMessage: string | null;
};

function normalizeText(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function getFirstAccessControlState(args: {
  accountAccess: StoreAccountAccess | null | undefined;
  canManageAccounts: boolean;
  isBusy: boolean;
}) : FirstAccessControlState {
  const access = args.accountAccess ?? null;

  if (!args.canManageAccounts) {
    return {
      label: "Primeiro acesso indisponivel",
      disabled: true,
      reason: "Seu perfil atual nao pode reenviar o primeiro acesso.",
      confirmMessage: null,
    };
  }

  if (!access) {
    return {
      label: "Primeiro acesso indisponivel",
      disabled: true,
      reason: "Conta responsavel indisponivel no momento.",
      confirmMessage: null,
    };
  }

  if (access.status === "first_access_completed") {
    return {
      label: "Primeiro acesso concluido",
      disabled: true,
      reason: "A conta responsavel ja criou a primeira senha.",
      confirmMessage: null,
    };
  }

  if (access.accessState === "blocked") {
    return {
      label: normalizeText(access.lastInviteSentAt)
        ? "Reenviar primeiro acesso"
        : "Enviar primeiro acesso",
      disabled: true,
      reason: "A conta da loja esta bloqueada e nao pode receber novo primeiro acesso.",
      confirmMessage: null,
    };
  }

  if (access.status === "ambiguous") {
    return {
      label: "Primeiro acesso indisponivel",
      disabled: true,
      reason: "Existe mais de uma conta owner candidata para esta loja.",
      confirmMessage: null,
    };
  }

  if (access.status === "missing") {
    return {
      label: "Primeiro acesso indisponivel",
      disabled: true,
      reason: "A loja nao possui conta responsavel canonicamente resolvida.",
      confirmMessage: null,
    };
  }

  if (access.status !== "first_access_pending" || !access.canResend) {
    return {
      label: "Primeiro acesso indisponivel",
      disabled: true,
      reason:
        normalizeText(access.statusLabel) ||
        "O primeiro acesso nao esta disponivel para envio nesta conta.",
      confirmMessage: null,
    };
  }

  return {
    label: normalizeText(access.lastInviteSentAt)
      ? "Reenviar primeiro acesso"
      : "Enviar primeiro acesso",
    disabled: args.isBusy,
    reason: normalizeText(access.lastInviteSentAt)
      ? "Envia um novo link e invalida a tentativa anterior."
      : "Envia o link inicial para a conta responsavel definir a primeira senha.",
    confirmMessage: `Reenviar um novo link para ${access.emailMasked}? O link anterior sera substituido.`,
  };
}

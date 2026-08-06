export type RequestedAccessDomain = "public" | "zion_admin" | "store_area";

export type AccessDomain =
  | "anonymous"
  | "zion_admin"
  | "store_area"
  | "unresolved";

export type AccessStatus =
  | "anonymous"
  | "account_blocked"
  | "zion_admin_allowed"
  | "store_first_access_required"
  | "store_password_login_required"
  | "store_provisioning_pending"
  | "store_provisioning_failed"
  | "store_invalid_account"
  | "store_missing_profile"
  | "store_missing_membership"
  | "inactive_membership"
  | "store_missing_store"
  | "store_multi_org_unsupported"
  | "store_multi_store_unsupported"
  | "store_commercial_blocked"
  | "store_ready_onboarding_required"
  | "store_ready_active"
  | "cross_domain_forbidden"
  | "access_resolution_unavailable";

export type AccessApiDecision =
  | "allow"
  | "deny_401"
  | "deny_403"
  | "deny_409"
  | "deny_503";

export type OrganizationResolution =
  | "none"
  | "single"
  | "multi_unsupported"
  | "invalid";

export type StoreResolution =
  | "none"
  | "single"
  | "multi_unsupported"
  | "invalid";

export type CommercialAccess = "allowed" | "blocked" | "unknown";

export type ProvisioningStatus =
  | "pending"
  | "provisioned"
  | "failed"
  | "invalid"
  | "unknown"
  | null;

export type AccessResolutionUnavailableReasonCode =
  | "request_auth_unavailable"
  | "service_client_unavailable"
  | "zion_admin_lookup_unavailable"
  | "auth_admin_lookup_unavailable"
  | "profile_lookup_unavailable"
  | "memberships_lookup_unavailable"
  | "organization_lookup_unavailable"
  | "stores_lookup_unavailable"
  | "commercial_access_lookup_unavailable"
  | "onboarding_lookup_unavailable"
  | "malformed_auth_admin_user"
  | "malformed_memberships_contract"
  | "malformed_stores_contract"
  | "malformed_commercial_access_contract"
  | "malformed_onboarding_contract";

export type AccessReasonCode =
  | "anonymous"
  | "account_blocked"
  | "zion_admin_allowed"
  | "store_user_cannot_access_zion_admin"
  | "zion_admin_cannot_access_store_area"
  | "first_access_required"
  | "password_login_required"
  | "provisioning_pending"
  | "provisioning_failed"
  | "invalid_session_user_id"
  | "invalid_account_metadata"
  | "missing_profile"
  | "invalid_membership_count"
  | "invalid_distinct_organization_count"
  | "missing_membership"
  | "inactive_membership"
  | "invalid_membership_organization_counts"
  | "multi_org_unsupported"
  | "organization_id_required"
  | "organization_invalid"
  | "invalid_store_count"
  | "missing_store"
  | "multi_store_unsupported"
  | "store_id_required"
  | "commercial_access_unknown"
  | "commercial_access_blocked"
  | "onboarding_required"
  | "ready_active"
  | AccessResolutionUnavailableReasonCode;

export type AccessResolutionFailure = {
  reasonCode: AccessResolutionUnavailableReasonCode;
  message: string;
};

export type AccessResolution = {
  domain: AccessDomain;
  status: AccessStatus;
  sessionUserId: string | null;
  safeHtmlDestination:
    | "/login"
    | "/zion-admin/login"
    | "/zion-admin"
    | "/auth/reset-password"
    | "/onboarding"
    | "/crm"
    | "/account/access-blocked"
    | "/account/access-unavailable";
  apiDecision: AccessApiDecision;
  organizationResolution: OrganizationResolution;
  storeResolution: StoreResolution;
  organizationId: string | null;
  storeId: string | null;
  commercialAccess: CommercialAccess;
  reasonCode: AccessReasonCode;
  message: string;
};

export type ResolveAccessStateInput = {
  requestedDomain: RequestedAccessDomain;
  hasSession: boolean;
  isActiveZionAdmin: boolean;
  provisioningStatus: ProvisioningStatus;
  firstAccessRequired: boolean;
  passwordLoginRequired: boolean;
  hasProfile: boolean;
  isProfileBlocked: boolean;
  hasAnyMemberships: boolean;
  membershipCount: number;
  distinctOrganizationCount: number;
  organizationExists: boolean;
  storeCount: number;
  commercialAccess: CommercialAccess;
  onboardingRequired: boolean;
  sessionUserId: string | null;
  organizationId: string | null;
  storeId: string | null;
  resolutionFailure: AccessResolutionFailure | null;
};

function shouldHideStoreContext(
  domain: AccessDomain,
  status: AccessStatus,
): boolean {
  return (
    domain === "zion_admin" ||
    domain === "unresolved" ||
    status === "cross_domain_forbidden" ||
    status === "access_resolution_unavailable"
  );
}

function deriveOrganizationResolution(
  input: ResolveAccessStateInput,
): OrganizationResolution {
  if (input.membershipCount <= 0) return "none";
  if (input.distinctOrganizationCount > 1) return "multi_unsupported";
  if (input.distinctOrganizationCount === 1 && input.organizationExists) {
    return "single";
  }
  return "invalid";
}

function deriveStoreResolution(
  input: ResolveAccessStateInput,
): StoreResolution {
  if (input.membershipCount <= 0) return "none";
  if (input.distinctOrganizationCount > 1) return "none";
  if (!input.organizationExists) return "invalid";
  if (input.storeCount <= 0) return "none";
  if (input.storeCount > 1) return "multi_unsupported";
  return "single";
}

function buildResolution(
  input: ResolveAccessStateInput,
  overrides: Pick<
    AccessResolution,
    | "domain"
    | "status"
    | "safeHtmlDestination"
    | "apiDecision"
    | "reasonCode"
    | "message"
  >,
): AccessResolution {
  const hideStoreContext = shouldHideStoreContext(
    overrides.domain,
    overrides.status,
  );

  return {
    domain: overrides.domain,
    status: overrides.status,
    sessionUserId: input.hasSession ? input.sessionUserId : null,
    safeHtmlDestination: overrides.safeHtmlDestination,
    apiDecision: overrides.apiDecision,
    organizationResolution: hideStoreContext
      ? "none"
      : deriveOrganizationResolution(input),
    storeResolution: hideStoreContext ? "none" : deriveStoreResolution(input),
    organizationId:
      overrides.status === "store_ready_onboarding_required" ||
      overrides.status === "store_ready_active"
        ? input.organizationId
        : null,
    storeId:
      overrides.status === "store_ready_onboarding_required" ||
      overrides.status === "store_ready_active"
        ? input.storeId
        : null,
    commercialAccess: hideStoreContext ? "unknown" : input.commercialAccess,
    reasonCode: overrides.reasonCode,
    message: overrides.message,
  };
}

function isInvalidNonNegativeInteger(value: number): boolean {
  return !Number.isFinite(value) || !Number.isInteger(value) || value < 0;
}

function resolveStoreAreaState(
  input: ResolveAccessStateInput,
): AccessResolution {
  if (input.firstAccessRequired) {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_first_access_required",
      safeHtmlDestination: "/auth/reset-password",
      apiDecision: "deny_409",
      reasonCode: "first_access_required",
      message:
        "A conta precisa concluir o primeiro acesso antes de usar a area da loja.",
    });
  }

  if (input.passwordLoginRequired) {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_password_login_required",
      safeHtmlDestination: "/login",
      apiDecision: "deny_409",
      reasonCode: "password_login_required",
      message:
        "A conta precisa entrar novamente com a nova senha antes de usar a area da loja.",
    });
  }

  if (input.provisioningStatus === "pending") {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_provisioning_pending",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "provisioning_pending",
      message:
        "A conta ainda esta com provisionamento pendente e nao pode entrar na area da loja.",
    });
  }

  if (input.provisioningStatus === "failed") {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_provisioning_failed",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "provisioning_failed",
      message:
        "A conta exige revisao interna porque o provisionamento falhou.",
    });
  }

  if (!input.hasProfile) {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_missing_profile",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "missing_profile",
      message:
        "A conta autenticada nao possui profile operacional valido.",
    });
  }

  if (isInvalidNonNegativeInteger(input.membershipCount)) {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_invalid_account",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "invalid_membership_count",
      message:
        "A conta apresentou um contador de memberships invalido para a resolucao de acesso.",
    });
  }

  if (isInvalidNonNegativeInteger(input.distinctOrganizationCount)) {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_invalid_account",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "invalid_distinct_organization_count",
      message:
        "A conta apresentou um contador invalido de organizacoes distintas.",
    });
  }

  if (input.membershipCount === 0) {
    if (input.distinctOrganizationCount > 0) {
      return buildResolution(input, {
        domain: "store_area",
        status: "store_invalid_account",
        safeHtmlDestination: "/account/access-blocked",
        apiDecision: "deny_409",
        reasonCode: "invalid_membership_organization_counts",
        message:
          "A conta apresentou contadores inconsistentes entre memberships e organizacoes distintas.",
      });
    }

    if (input.hasAnyMemberships) {
      return buildResolution(input, {
        domain: "store_area",
        status: "inactive_membership",
        safeHtmlDestination: "/account/access-blocked",
        apiDecision: "deny_403",
        reasonCode: "inactive_membership",
        message:
          "A conta possui memberships, mas nenhuma delas esta ativa para acesso.",
      });
    }

    return buildResolution(input, {
      domain: "store_area",
      status: "store_missing_membership",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "missing_membership",
      message:
        "A conta autenticada nao possui membership valida na area da loja.",
    });
  }

  if (
    input.distinctOrganizationCount <= 0 ||
    input.distinctOrganizationCount > input.membershipCount
  ) {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_invalid_account",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "invalid_membership_organization_counts",
      message:
        "A conta apresentou contadores inconsistentes entre memberships e organizacoes distintas.",
    });
  }

  if (input.distinctOrganizationCount > 1) {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_multi_org_unsupported",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "multi_org_unsupported",
      message:
        "A conta possui multiplas organizacoes e esse contrato ainda nao suporta selecionar contexto automaticamente.",
    });
  }

  if (!input.organizationId || input.organizationId.trim().length === 0) {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_invalid_account",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "organization_id_required",
      message:
        "A conta possui uma unica organizacao valida, mas o organizationId nao foi informado.",
    });
  }

  if (!input.organizationExists) {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_invalid_account",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "organization_invalid",
      message:
        "A membership da conta aponta para uma organizacao invalida.",
    });
  }

  if (isInvalidNonNegativeInteger(input.storeCount)) {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_invalid_account",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "invalid_store_count",
      message:
        "A conta apresentou um contador invalido de lojas para a resolucao de acesso.",
    });
  }

  if (input.storeCount === 0) {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_missing_store",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "missing_store",
      message:
        "A organizacao da conta ainda nao possui loja valida para acesso.",
    });
  }

  if (input.storeCount > 1) {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_multi_store_unsupported",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "multi_store_unsupported",
      message:
        "A conta possui mais de uma loja e esse contrato ainda nao suporta selecao automatica.",
    });
  }

  if (!input.storeId || input.storeId.trim().length === 0) {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_invalid_account",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "store_id_required",
      message:
        "A conta possui uma unica loja valida, mas o storeId nao foi informado.",
    });
  }

  if (input.commercialAccess === "unknown") {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_invalid_account",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "commercial_access_unknown",
      message:
        "O acesso comercial da organizacao ainda nao foi resolvido de forma confiavel.",
    });
  }

  if (input.commercialAccess === "blocked") {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_commercial_blocked",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_403",
      reasonCode: "commercial_access_blocked",
      message: "O acesso comercial da organizacao esta bloqueado.",
    });
  }

  if (input.onboardingRequired) {
    return buildResolution(input, {
      domain: "store_area",
      status: "store_ready_onboarding_required",
      safeHtmlDestination: "/onboarding",
      apiDecision: "deny_409",
      reasonCode: "onboarding_required",
      message:
        "A conta esta valida, mas ainda precisa concluir o onboarding inicial.",
    });
  }

  return buildResolution(input, {
    domain: "store_area",
    status: "store_ready_active",
    safeHtmlDestination: "/crm",
    apiDecision: "allow",
    reasonCode: "ready_active",
    message: "A conta esta valida e com acesso liberado para a area da loja.",
  });
}

export function resolveAccessState(
  input: ResolveAccessStateInput,
): AccessResolution {
  const hasNonEmptySessionUserId =
    typeof input.sessionUserId === "string" &&
    input.sessionUserId.trim().length > 0;

  if (input.resolutionFailure) {
    return buildResolution(input, {
      domain: "unresolved",
      status: "access_resolution_unavailable",
      safeHtmlDestination: "/account/access-unavailable",
      apiDecision: "deny_503",
      reasonCode: input.resolutionFailure.reasonCode,
      message: input.resolutionFailure.message,
    });
  }

  if (!input.hasSession) {
    return {
      domain: "anonymous",
      status: "anonymous",
      sessionUserId: null,
      safeHtmlDestination:
        input.requestedDomain === "zion_admin" ? "/zion-admin/login" : "/login",
      apiDecision: "deny_401",
      organizationResolution: "none",
      storeResolution: "none",
      organizationId: null,
      storeId: null,
      commercialAccess: "unknown",
      reasonCode: "anonymous",
      message: "A requisicao exige uma sessao autenticada.",
    };
  }

  if (!hasNonEmptySessionUserId) {
    return buildResolution(input, {
      domain: input.isActiveZionAdmin ? "zion_admin" : "store_area",
      status: "store_invalid_account",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      reasonCode: "invalid_session_user_id",
      message:
        "A sessao autenticada nao informou um identificador de usuario valido.",
    });
  }

  if (input.hasProfile && input.isProfileBlocked) {
    return buildResolution(input, {
      domain:
        input.requestedDomain === "zion_admin" ||
        (input.requestedDomain === "public" && input.isActiveZionAdmin)
          ? "zion_admin"
          : "store_area",
      status: "account_blocked",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_403",
      reasonCode: "account_blocked",
      message: "O profile da conta esta bloqueado para acesso.",
    });
  }

  if (input.requestedDomain === "zion_admin") {
    if (input.isActiveZionAdmin) {
      return buildResolution(input, {
        domain: "zion_admin",
        status: "zion_admin_allowed",
        safeHtmlDestination: "/zion-admin",
        apiDecision: "allow",
        reasonCode: "zion_admin_allowed",
        message: "A sessao interna do ZION esta autorizada.",
      });
    }

    return buildResolution(input, {
      domain: "store_area",
      status: "cross_domain_forbidden",
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_403",
      reasonCode: "store_user_cannot_access_zion_admin",
      message:
        "A sessao autenticada nao possui acesso ao dominio interno do ZION.",
    });
  }

  if (input.requestedDomain === "store_area") {
    return resolveStoreAreaState(input);
  }

  if (input.isActiveZionAdmin) {
    return buildResolution(input, {
      domain: "zion_admin",
      status: "zion_admin_allowed",
      safeHtmlDestination: "/zion-admin",
      apiDecision: "allow",
      reasonCode: "zion_admin_allowed",
      message: "A sessao interna do ZION esta autorizada.",
    });
  }

  return resolveStoreAreaState(input);
}

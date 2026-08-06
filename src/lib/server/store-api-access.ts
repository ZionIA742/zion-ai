import {
  type AccessReasonCode,
  type AccessResolution,
} from "../account-access-resolution";
import { createSupabaseServerClient } from "../supabaseServer";
import { resolveAccessForRequest } from "./account-access-resolver";

export type StoreApiAccessRequirement =
  | "active"
  | "onboarding"
  | "active_or_onboarding";

type StoreApiScopedStatus =
  | "store_ready_active"
  | "store_ready_onboarding_required";

type StoreApiDeniedHttpStatus = 401 | 403 | 409 | 503;

type StoreApiDeniedPayload = {
  ok: false;
  error: string;
  message: string;
  status: AccessResolution["status"];
  reasonCode: AccessResolution["reasonCode"];
};

type StoreApiDeniedResolution = Pick<
  AccessResolution,
  | "domain"
  | "status"
  | "safeHtmlDestination"
  | "apiDecision"
  | "organizationResolution"
  | "storeResolution"
  | "commercialAccess"
  | "reasonCode"
  | "message"
> & {
  sessionUserId: null;
  organizationId: null;
  storeId: null;
};

export type StoreApiGrantedResolution = Pick<
  AccessResolution,
  | "safeHtmlDestination"
  | "apiDecision"
  | "reasonCode"
  | "message"
> & {
  domain: "store_area";
  status: StoreApiScopedStatus;
  sessionUserId: string;
  organizationResolution: "single";
  storeResolution: "single";
  organizationId: string;
  storeId: string;
  commercialAccess: "allowed";
};

export type StoreApiAccessGranted = {
  ok: true;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  resolution: StoreApiGrantedResolution;
  sessionUserId: string;
  organizationId: string;
  storeId: string;
};

export type StoreApiAccessDenied = {
  ok: false;
  resolution: StoreApiDeniedResolution;
  httpStatus: StoreApiDeniedHttpStatus;
  payload: StoreApiDeniedPayload;
};

export type StoreApiAccessResult =
  | StoreApiAccessGranted
  | StoreApiAccessDenied;

export type ResolveStoreApiAccessDeps = {
  createSupabase: typeof createSupabaseServerClient;
  resolveAccess: typeof resolveAccessForRequest;
};

export type ResolveStoreApiAccessParams = {
  requirement: StoreApiAccessRequirement;
  deps?: Partial<ResolveStoreApiAccessDeps>;
};

const DEFAULT_TECHNICAL_REASON_CODE: AccessReasonCode =
  "request_auth_unavailable";

function createSafeTechnicalResolution(
  reasonCode: AccessReasonCode = DEFAULT_TECHNICAL_REASON_CODE,
): AccessResolution {
  return {
    domain: "unresolved",
    status: "access_resolution_unavailable",
    sessionUserId: null,
    safeHtmlDestination: "/account/access-unavailable",
    apiDecision: "deny_503",
    organizationResolution: "none",
    storeResolution: "none",
    organizationId: null,
    storeId: null,
    commercialAccess: "unknown",
    reasonCode,
    message: "Nao foi possivel validar o acesso da API da loja no momento.",
  };
}

function createGrantedResolution(
  resolution: AccessResolution & { status: StoreApiScopedStatus },
  sessionUserId: string,
  organizationId: string,
  storeId: string,
): StoreApiGrantedResolution {
  return {
    domain: "store_area",
    status: resolution.status,
    sessionUserId,
    safeHtmlDestination: resolution.safeHtmlDestination,
    apiDecision: resolution.apiDecision,
    organizationResolution: "single",
    storeResolution: "single",
    organizationId,
    storeId,
    commercialAccess: "allowed",
    reasonCode: resolution.reasonCode,
    message: resolution.message,
  };
}

function isAllowedForRequirement(
  requirement: StoreApiAccessRequirement,
  status: AccessResolution["status"],
): status is StoreApiScopedStatus {
  switch (requirement) {
    case "active":
      return status === "store_ready_active";
    case "onboarding":
      return status === "store_ready_onboarding_required";
    case "active_or_onboarding":
      return (
        status === "store_ready_active" ||
        status === "store_ready_onboarding_required"
      );
    default:
      return false;
  }
}

function mapDeniedHttpStatus(
  status: AccessResolution["status"],
): StoreApiDeniedHttpStatus {
  if (status === "anonymous") return 401;
  if (
    status === "account_blocked" ||
    status === "inactive_membership" ||
    status === "cross_domain_forbidden" ||
    status === "store_commercial_blocked"
  ) {
    return 403;
  }
  if (status === "access_resolution_unavailable") return 503;
  return 409;
}

function buildDeniedPayload(
  resolution: AccessResolution,
  requirement: StoreApiAccessRequirement,
): StoreApiDeniedPayload {
  if (resolution.status === "anonymous") {
    return {
      ok: false,
      error: "STORE_API_UNAUTHENTICATED",
      message: "Faca login para acessar esta API da loja.",
      status: resolution.status,
      reasonCode: resolution.reasonCode,
    };
  }

  if (resolution.status === "access_resolution_unavailable") {
    return {
      ok: false,
      error: "STORE_API_ACCESS_UNAVAILABLE",
      message:
        "Nao foi possivel validar o acesso desta API da loja no momento.",
      status: resolution.status,
      reasonCode: resolution.reasonCode,
    };
  }

  if (resolution.status === "cross_domain_forbidden") {
    return {
      ok: false,
      error: "STORE_API_FORBIDDEN",
      message: "Sua conta nao pode acessar esta API da loja.",
      status: resolution.status,
      reasonCode: resolution.reasonCode,
    };
  }

  if (
    resolution.status === "account_blocked" ||
    resolution.status === "inactive_membership"
  ) {
    return {
      ok: false,
      error: "STORE_API_FORBIDDEN",
      message: "Sua conta nao esta liberada para acessar esta API da loja.",
      status: resolution.status,
      reasonCode: resolution.reasonCode,
    };
  }

  if (resolution.status === "store_commercial_blocked") {
    return {
      ok: false,
      error: "STORE_API_FORBIDDEN",
      message: "Sua conta nao esta liberada para acessar esta API da loja.",
      status: resolution.status,
      reasonCode: resolution.reasonCode,
    };
  }

  if (
    (requirement === "active" &&
      resolution.status === "store_ready_onboarding_required") ||
    (requirement === "onboarding" &&
      resolution.status === "store_ready_active")
  ) {
    return {
      ok: false,
      error: "STORE_API_REQUIREMENT_MISMATCH",
      message:
        "Sua conta nao atende ao requisito comercial desta API da loja.",
      status: resolution.status,
      reasonCode: resolution.reasonCode,
    };
  }

  return {
    ok: false,
    error: "STORE_API_ACCESS_DENIED",
    message: "Sua conta nao pode executar esta operacao nesta API da loja.",
    status: resolution.status,
    reasonCode: resolution.reasonCode,
  };
}

function createDeniedResult(
  resolution: AccessResolution,
  requirement: StoreApiAccessRequirement,
): StoreApiAccessDenied {
  const safeResolution: StoreApiDeniedResolution = {
    domain: resolution.domain,
    status: resolution.status,
    sessionUserId: null,
    safeHtmlDestination: resolution.safeHtmlDestination,
    apiDecision: resolution.apiDecision,
    organizationResolution: resolution.organizationResolution,
    storeResolution: resolution.storeResolution,
    organizationId: null,
    storeId: null,
    commercialAccess: resolution.commercialAccess,
    reasonCode: resolution.reasonCode,
    message: resolution.message,
  };

  return {
    ok: false,
    resolution: safeResolution,
    httpStatus: mapDeniedHttpStatus(safeResolution.status),
    payload: buildDeniedPayload(safeResolution, requirement),
  };
}

export async function resolveStoreApiAccess({
  requirement,
  deps,
}: ResolveStoreApiAccessParams): Promise<StoreApiAccessResult> {
  const createSupabase = deps?.createSupabase ?? createSupabaseServerClient;
  const resolveAccess = deps?.resolveAccess ?? resolveAccessForRequest;

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;

  try {
    supabase = await createSupabase();
  } catch {
    return createDeniedResult(
      createSafeTechnicalResolution(DEFAULT_TECHNICAL_REASON_CODE),
      requirement,
    );
  }

  let resolution: AccessResolution;

  try {
    resolution = await resolveAccess({
      requestedDomain: "store_area",
      supabase,
    });
  } catch {
    return createDeniedResult(
      createSafeTechnicalResolution(DEFAULT_TECHNICAL_REASON_CODE),
      requirement,
    );
  }

  if (!isAllowedForRequirement(requirement, resolution.status)) {
    return createDeniedResult(resolution, requirement);
  }

  const sessionUserId = resolution.sessionUserId?.trim() || null;
  const organizationId = resolution.organizationId?.trim() || null;
  const storeId = resolution.storeId?.trim() || null;

  if (
    resolution.domain !== "store_area" ||
    resolution.organizationResolution !== "single" ||
    resolution.storeResolution !== "single" ||
    resolution.commercialAccess !== "allowed" ||
    !sessionUserId ||
    !organizationId ||
    !storeId
  ) {
    return createDeniedResult(
      createSafeTechnicalResolution(DEFAULT_TECHNICAL_REASON_CODE),
      requirement,
    );
  }

  const grantedSourceResolution: AccessResolution & {
    status: StoreApiScopedStatus;
  } = resolution as AccessResolution & {
    status: StoreApiScopedStatus;
  };

  const grantedResolution = createGrantedResolution(
    grantedSourceResolution,
    sessionUserId,
    organizationId,
    storeId,
  );

  return {
    ok: true,
    supabase,
    resolution: grantedResolution,
    sessionUserId,
    organizationId,
    storeId,
  };
}

import {
  type AccessReasonCode,
  type AccessResolution,
} from "../account-access-resolution";
import { createSupabaseServerClient } from "../supabaseServer";
import { resolveAccessForRequest } from "./account-access-resolver";

type ZionAdminDeniedHttpStatus = 401 | 403 | 409 | 503;

type ZionAdminDeniedPayload = {
  ok: false;
  error: string;
  message: string;
  status: AccessResolution["status"];
  reasonCode: AccessResolution["reasonCode"];
};

type ZionAdminDeniedResolution = Pick<
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

export type ZionAdminApiGrantedResolution = Pick<
  AccessResolution,
  | "safeHtmlDestination"
  | "apiDecision"
  | "reasonCode"
  | "message"
> & {
  domain: "zion_admin";
  status: "zion_admin_allowed";
  sessionUserId: string;
  organizationResolution: "none";
  storeResolution: "none";
  organizationId: null;
  storeId: null;
  commercialAccess: "unknown";
};

export type ZionAdminApiAccessGranted = {
  ok: true;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  resolution: ZionAdminApiGrantedResolution;
  sessionUserId: string;
};

export type ZionAdminApiAccessDenied = {
  ok: false;
  resolution: ZionAdminDeniedResolution;
  httpStatus: ZionAdminDeniedHttpStatus;
  payload: ZionAdminDeniedPayload;
};

export type ZionAdminApiAccessResult =
  | ZionAdminApiAccessGranted
  | ZionAdminApiAccessDenied;

export type ResolveZionAdminApiAccessDeps = {
  createSupabase: typeof createSupabaseServerClient;
  resolveAccess: typeof resolveAccessForRequest;
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
    message: "Nao foi possivel validar o acesso da API interna do ZION no momento.",
  };
}

function createGrantedResolution(
  resolution: AccessResolution & { status: "zion_admin_allowed" },
  sessionUserId: string,
): ZionAdminApiGrantedResolution {
  return {
    domain: "zion_admin",
    status: "zion_admin_allowed",
    sessionUserId,
    safeHtmlDestination: resolution.safeHtmlDestination,
    apiDecision: resolution.apiDecision,
    organizationResolution: "none",
    storeResolution: "none",
    organizationId: null,
    storeId: null,
    commercialAccess: "unknown",
    reasonCode: resolution.reasonCode,
    message: resolution.message,
  };
}

function mapDeniedHttpStatus(
  status: AccessResolution["status"],
): ZionAdminDeniedHttpStatus {
  if (status === "anonymous") return 401;
  if (status === "cross_domain_forbidden" || status === "account_blocked") {
    return 403;
  }
  if (status === "access_resolution_unavailable") return 503;
  return 409;
}

function buildDeniedPayload(
  resolution: ZionAdminDeniedResolution,
): ZionAdminDeniedPayload {
  if (resolution.status === "anonymous") {
    return {
      ok: false,
      error: "ZION_ADMIN_API_UNAUTHENTICATED",
      message: "Faca login para acessar esta API interna do ZION.",
      status: resolution.status,
      reasonCode: resolution.reasonCode,
    };
  }

  if (resolution.status === "cross_domain_forbidden") {
    return {
      ok: false,
      error: "ZION_ADMIN_API_FORBIDDEN",
      message: "Sua conta nao pode acessar esta API interna do ZION.",
      status: resolution.status,
      reasonCode: resolution.reasonCode,
    };
  }

  if (resolution.status === "account_blocked") {
    return {
      ok: false,
      error: "ZION_ADMIN_API_FORBIDDEN",
      message: "Sua conta nao pode acessar esta API interna do ZION.",
      status: resolution.status,
      reasonCode: resolution.reasonCode,
    };
  }

  if (resolution.status === "access_resolution_unavailable") {
    return {
      ok: false,
      error: "ZION_ADMIN_API_ACCESS_UNAVAILABLE",
      message:
        "Nao foi possivel validar o acesso desta API interna do ZION no momento.",
      status: resolution.status,
      reasonCode: resolution.reasonCode,
    };
  }

  return {
    ok: false,
    error: "ZION_ADMIN_API_ACCESS_DENIED",
    message: "Sua conta nao pode executar esta operacao nesta API interna do ZION.",
    status: resolution.status,
    reasonCode: resolution.reasonCode,
  };
}

function createDeniedResult(
  resolution: AccessResolution,
): ZionAdminApiAccessDenied {
  const safeResolution: ZionAdminDeniedResolution = {
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
    payload: buildDeniedPayload(safeResolution),
  };
}

export async function resolveZionAdminApiAccess(
  deps?: Partial<ResolveZionAdminApiAccessDeps>,
): Promise<ZionAdminApiAccessResult> {
  const createSupabase = deps?.createSupabase ?? createSupabaseServerClient;
  const resolveAccess = deps?.resolveAccess ?? resolveAccessForRequest;

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;

  try {
    supabase = await createSupabase();
  } catch {
    return createDeniedResult(
      createSafeTechnicalResolution(DEFAULT_TECHNICAL_REASON_CODE),
    );
  }

  let resolution: AccessResolution;

  try {
    resolution = await resolveAccess({
      requestedDomain: "zion_admin",
      supabase,
    });
  } catch {
    return createDeniedResult(
      createSafeTechnicalResolution(DEFAULT_TECHNICAL_REASON_CODE),
    );
  }

  if (resolution.status !== "zion_admin_allowed") {
    return createDeniedResult(resolution);
  }

  const sessionUserId = resolution.sessionUserId?.trim() || null;

  if (
    resolution.domain !== "zion_admin" ||
    resolution.apiDecision !== "allow" ||
    resolution.reasonCode !== "zion_admin_allowed" ||
    !sessionUserId ||
    resolution.organizationResolution !== "none" ||
    resolution.storeResolution !== "none" ||
    resolution.organizationId !== null ||
    resolution.storeId !== null ||
    resolution.commercialAccess !== "unknown"
  ) {
    return createDeniedResult(
      createSafeTechnicalResolution(DEFAULT_TECHNICAL_REASON_CODE),
    );
  }

  const grantedSourceResolution = resolution as AccessResolution & {
    status: "zion_admin_allowed";
  };
  const grantedResolution = createGrantedResolution(
    grantedSourceResolution,
    sessionUserId,
  );

  return {
    ok: true,
    supabase,
    resolution: grantedResolution,
    sessionUserId,
  };
}

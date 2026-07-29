import type { AccessResolution } from "@/lib/account-access-resolution";
import type { createSupabaseServerClient } from "@/lib/supabaseServer";
import type { resolveAccessForRequest } from "@/lib/server/account-access-resolver";

type EnsureSetupDestination = "/crm" | "/onboarding" | "/auth/reset-password";

export type EnsureSetupPayload = {
  ok: boolean;
  status: AccessResolution["status"];
  message: string;
  destination: EnsureSetupDestination | null;
  error?: string;
  details?: string;
  reasonCode: AccessResolution["reasonCode"];
  organizationId: string | null;
  storeId: string | null;
  apiDecision: AccessResolution["apiDecision"];
  safeHtmlDestination: AccessResolution["safeHtmlDestination"];
};

export type EnsureSetupRouteDeps = {
  createSupabase: typeof createSupabaseServerClient;
  resolveAccess: typeof resolveAccessForRequest;
};

function jsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function isNavigableStatus(status: AccessResolution["status"]) {
  return (
    status === "store_first_access_required" ||
    status === "store_ready_onboarding_required" ||
    status === "store_ready_active"
  );
}

function getDestination(
  status: AccessResolution["status"],
): EnsureSetupDestination | null {
  switch (status) {
    case "store_first_access_required":
      return "/auth/reset-password";
    case "store_ready_onboarding_required":
      return "/onboarding";
    case "store_ready_active":
      return "/crm";
    default:
      return null;
  }
}

function shouldExposeIds(status: AccessResolution["status"]) {
  return (
    status === "store_ready_onboarding_required" ||
    status === "store_ready_active"
  );
}

function getHttpStatus(resolution: AccessResolution) {
  switch (resolution.status) {
    case "store_first_access_required":
    case "store_ready_onboarding_required":
    case "store_ready_active":
      return 200;
    case "anonymous":
      return 401;
    case "cross_domain_forbidden":
    case "store_commercial_blocked":
      return 403;
    case "access_resolution_unavailable":
      return 503;
    default:
      return 409;
  }
}

function buildPayload(resolution: AccessResolution): EnsureSetupPayload {
  const ok = isNavigableStatus(resolution.status);
  const exposeIds = shouldExposeIds(resolution.status);
  const message = resolution.message;

  return {
    ok,
    status: resolution.status,
    message,
    destination: getDestination(resolution.status),
    error:
      ok
        ? undefined
        : resolution.status === "anonymous"
          ? "Usuario nao autenticado."
          : message,
    details: ok ? undefined : message,
    reasonCode: resolution.reasonCode,
    organizationId: exposeIds ? resolution.organizationId : null,
    storeId: exposeIds ? resolution.storeId : null,
    apiDecision: resolution.apiDecision,
    safeHtmlDestination: resolution.safeHtmlDestination,
  };
}

function getErrorDiagnostics(error: unknown) {
  const value = error as {
    message?: string | null;
    code?: string | null;
    details?: string | null;
    hint?: string | null;
  } | null;

  return {
    message: value?.message ?? null,
    code: value?.code ?? null,
    details: value?.details ?? null,
    hint: value?.hint ?? null,
  };
}

export async function handleEnsureSetup(
  deps: EnsureSetupRouteDeps,
): Promise<Response> {
  try {
    const supabase = await deps.createSupabase();
    const resolution = await deps.resolveAccess({
      requestedDomain: "store_area",
      supabase,
    });

    return jsonResponse(buildPayload(resolution), getHttpStatus(resolution));
  } catch (error: unknown) {
    console.error("[account/ensure-setup] error:", getErrorDiagnostics(error));

    return jsonResponse(
      {
        ok: false,
        status: "access_resolution_unavailable",
        message: "Falha tecnica ao resolver o acesso da conta.",
        destination: null,
        error: "Falha tecnica ao resolver o acesso da conta.",
        details: "Falha tecnica ao resolver o acesso da conta.",
        reasonCode: "service_client_unavailable",
        organizationId: null,
        storeId: null,
        apiDecision: "deny_503",
        safeHtmlDestination: "/account/access-unavailable",
      } satisfies EnsureSetupPayload,
      503,
    );
  }
}

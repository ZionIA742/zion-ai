export type BackendDiagnosticInput = Readonly<{
  route: unknown;
  method: unknown;
  kind: unknown;
  status?: unknown;
  frameworkControlFlow?: unknown;
}>;

export type BackendDiagnosticEvent = Readonly<{
  schemaVersion: 1;
  sourceSystem: "backend_api";
  route: string;
  method: string;
  kind: "unhandled_exception" | "http_response";
  httpStatus: number | null;
  errorCode:
    | "BACKEND_UNHANDLED_EXCEPTION"
    | "BACKEND_HTTP_5XX";
  severity: "error";
  causeConfidence: "unknown";
  attribution: "unverified";
}>;

export type BackendDiagnosticDecision =
  | {
      disposition: "capture";
      event: BackendDiagnosticEvent;
    }
  | {
      disposition: "diagnostic_health";
      reason: "diagnostic_component_failure";
    }
  | {
      disposition: "ignore";
      reason:
        | "invalid_context"
        | "unknown_route"
        | "invalid_method"
        | "invalid_kind"
        | "framework_control_flow"
        | "invalid_status"
        | "non_server_error";
    };

const METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const DIAGNOSTIC_ROUTES = new Set([
  "/api/zion-admin/diagnostics",
  "/api/cron/zion-admin-diagnostic-ai-runs",
  "/api/diagnostics/client-browser",
  "/api/zion-admin/diagnostics/scheduler",
  "/api/cron/zion-admin-diagnostic-operational",
]);

// Only canonical route templates supplied by trusted
// server adapters may be accepted.
// Never use the raw URL, request body or query string.

const ROUTE_TEMPLATE =
  /^\/api(?:\/(?:[A-Za-z0-9_-]+|\[(?:\.\.\.)?[A-Za-z0-9_-]+\]|\[\[\.\.\.[A-Za-z0-9_-]+\]\]))+$/;

export function classifyBackendDiagnostic(
  input: BackendDiagnosticInput,
  knownRoutes: ReadonlySet<string>,
): BackendDiagnosticDecision {
  if (!input || typeof input !== "object") {
    return {
      disposition: "ignore",
      reason: "invalid_context",
    };
  }

  const { route, method, kind, status } = input;

  if (
    typeof route !== "string" ||
    route.length > 200 ||
    !ROUTE_TEMPLATE.test(route) ||
    !knownRoutes.has(route)
  ) {
    return {
      disposition: "ignore",
      reason: "unknown_route",
    };
  }

  if (
    typeof method !== "string" ||
    !METHODS.has(method)
  ) {
    return {
      disposition: "ignore",
      reason: "invalid_method",
    };
  }

  if (
    kind !== "unhandled_exception" &&
    kind !== "http_response"
  ) {
    return {
      disposition: "ignore",
      reason: "invalid_kind",
    };
  }

  let httpStatus: number | null = null;

  if (kind === "unhandled_exception") {
    // This flag must come from trusted framework detection,
    // never from customer-controlled request data.
    if (input.frameworkControlFlow === true) {
      return {
        disposition: "ignore",
        reason: "framework_control_flow",
      };
    }
  } else {
    if (
      typeof status !== "number" ||
      !Number.isInteger(status) ||
      status < 100 ||
      status > 599
    ) {
      return {
        disposition: "ignore",
        reason: "invalid_status",
      };
    }

    if (status < 500) {
      return {
        disposition: "ignore",
        reason: "non_server_error",
      };
    }

    httpStatus = status;
  }

  // A failure in the diagnostic subsystem must not
  // recursively call the same failing diagnostic writer.
  if (DIAGNOSTIC_ROUTES.has(route)) {
    return {
      disposition: "diagnostic_health",
      reason: "diagnostic_component_failure",
    };
  }

  return {
    disposition: "capture",
    event: {
      schemaVersion: 1,
      sourceSystem: "backend_api",
      route,
      method,
      kind,
      httpStatus,
      errorCode:
        kind === "unhandled_exception"
          ? "BACKEND_UNHANDLED_EXCEPTION"
          : "BACKEND_HTTP_5XX",
      severity: "error",
      causeConfidence: "unknown",
      attribution: "unverified",
    },
  };
}
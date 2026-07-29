export type MiddlewareAuthState =
  | "authenticated"
  | "anonymous"
  | "unavailable";

export type MiddlewarePolicyDecision =
  | { action: "next"; destination: null }
  | {
      action: "redirect";
      destination: string;
      preserveRedirectTo: boolean;
    };

const PUBLIC_PATHS = new Set([
  "/login",
  "/auth/callback",
  "/auth/reset-password",
  "/auth/set-initial-password",
  "/account/access-blocked",
  "/account/access-unavailable",
  "/zion-admin/login",
  "/privacy-policy",
  "/terms-of-service",
  "/data-deletion",
  "/api/webhooks/whatsapp",
  "/api/internal/ai-sales-reply",
  "/api/internal/assistant/responsible-external-notifications/materialize",
  "/api/internal/assistant/responsible-external-notifications/send",
  "/api/internal/assistant/responsible-external-notifications/list",
  "/api/internal/assistant/responsible-external-notifications/prepare",
  "/api/internal/assistant/responsible-external-notifications/cancel",
  "/api/internal/whatsapp/process-inbox",
  "/api/internal/whatsapp/process-pending",
  "/api/internal/assistant-operational-tasks/process",
  "/api/cron/assistant-operational-tasks",
  "/api/cron/whatsapp-process-all",
]);

export const KNOWN_PUBLIC_MIDDLEWARE_PATHS = Array.from(PUBLIC_PATHS);

const NEXT: MiddlewarePolicyDecision = {
  action: "next",
  destination: null,
};

function redirect(
  destination: string,
  preserveRedirectTo: boolean,
): MiddlewarePolicyDecision {
  return {
    action: "redirect",
    destination,
    preserveRedirectTo,
  };
}

export function normalizeMiddlewarePathname(pathname: string): string {
  const trimmed = pathname.trim();
  const normalized = trimmed.replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : "/";
}

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}

export function resolveAccountAccessMiddlewarePolicy(
  pathname: string,
  authState: MiddlewareAuthState,
): MiddlewarePolicyDecision {
  const normalizedPath = normalizeMiddlewarePathname(pathname);

  if (isPublicPath(normalizedPath)) {
    return NEXT;
  }

  if (authState === "authenticated") {
    return NEXT;
  }

  if (authState === "unavailable") {
    return redirect("/account/access-unavailable", false);
  }

  if (
    normalizedPath === "/zion-admin" ||
    normalizedPath.startsWith("/zion-admin/")
  ) {
    return redirect("/zion-admin/login", true);
  }

  return redirect("/login", true);
}

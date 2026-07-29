import type { createSupabaseServerClient } from "@/lib/supabaseServer";
import type {
  createServiceSupabaseClient,
  getAuthAdminUserByIdWithRetry,
  getInvalidFirstAccessAttemptMessage,
  readFirstAccessInviteId,
  resolveTrustedPasswordFlow,
} from "@/lib/server/zion-account-provisioning";

const DEFAULT_NEXT_PATH = "/auth/reset-password";
const LOGIN_PATH = "/login";
const ALLOWED_NEXT_PATHS = new Set([
  "/auth/reset-password",
  "/auth/set-initial-password",
  "/crm",
  "/onboarding",
  "/login",
]);
const MISSING_CODE_ERROR_MESSAGE =
  "Nao foi possivel validar o link recebido. Peca um novo e-mail.";
const RECOVERY_LINK_ERROR_MESSAGE =
  "O link de recuperacao expirou ou nao e mais valido. Peca um novo e-mail.";
const CALLBACK_ERROR_MESSAGE =
  "Nao foi possivel concluir a autenticacao. Tente novamente a partir do login.";

export type CallbackHandlerDeps = {
  createSupabaseClient: typeof createSupabaseServerClient;
  createServiceClient: typeof createServiceSupabaseClient;
  getAuthAdminUserByIdWithRetry: typeof getAuthAdminUserByIdWithRetry;
  getInvalidFirstAccessAttemptMessage: typeof getInvalidFirstAccessAttemptMessage;
  readFirstAccessInviteId: typeof readFirstAccessInviteId;
  resolveTrustedPasswordFlow: typeof resolveTrustedPasswordFlow;
};

function createRedirectResponse(url: URL) {
  return new Response(null, {
    status: 307,
    headers: {
      location: url.toString(),
    },
  });
}

async function redirectToLoginWithClearedSession(
  deps: CallbackHandlerDeps,
  request: Request,
  message: string,
) {
  const supabase = await deps.createSupabaseClient();
  await supabase.auth.signOut();

  const loginUrl = new URL(LOGIN_PATH, request.url);
  loginUrl.searchParams.set("authError", message);
  return createRedirectResponse(loginUrl);
}

function getSafeNextPath(value: string | null) {
  if (!value) return DEFAULT_NEXT_PATH;

  try {
    const decoded = decodeURIComponent(value);

    if (!decoded.startsWith("/") || decoded.startsWith("//")) {
      return DEFAULT_NEXT_PATH;
    }

    return ALLOWED_NEXT_PATHS.has(decoded) ? decoded : DEFAULT_NEXT_PATH;
  } catch {
    if (value.startsWith("/") && !value.startsWith("//")) {
      return ALLOWED_NEXT_PATHS.has(value) ? value : DEFAULT_NEXT_PATH;
    }

    return DEFAULT_NEXT_PATH;
  }
}

export async function handleAuthCallback(
  request: Request,
  deps: CallbackHandlerDeps,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = getSafeNextPath(requestUrl.searchParams.get("next"));
  const attemptId = requestUrl.searchParams.get("attempt");
  const callbackError =
    requestUrl.searchParams.get("error_description") ||
    requestUrl.searchParams.get("error_code") ||
    requestUrl.searchParams.get("error");

  console.info("[auth/callback] incoming request", {
    pathname: requestUrl.pathname,
    hasCode: Boolean(code),
    nextPath,
    hasAttempt: Boolean(attemptId),
  });

  if (callbackError) {
    return redirectToLoginWithClearedSession(
      deps,
      request,
      CALLBACK_ERROR_MESSAGE,
    );
  }

  if (!code) {
    return redirectToLoginWithClearedSession(
      deps,
      request,
      MISSING_CODE_ERROR_MESSAGE,
    );
  }

  const supabase = await deps.createSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const exchangeError = error as {
      message?: string | null;
      status?: number | null;
      code?: string | null;
    } | null;

    console.error("[auth/callback] exchangeCodeForSession error", {
      nextPath,
      message: exchangeError?.message ?? null,
      status: exchangeError?.status ?? null,
      code: exchangeError?.code ?? null,
    });

    return redirectToLoginWithClearedSession(
      deps,
      request,
      RECOVERY_LINK_ERROR_MESSAGE,
    );
  }

  if (nextPath === "/auth/set-initial-password") {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return redirectToLoginWithClearedSession(
        deps,
        request,
        RECOVERY_LINK_ERROR_MESSAGE,
      );
    }

    const serviceSupabase = deps.createServiceClient();
    const authUser = await deps.getAuthAdminUserByIdWithRetry(
      serviceSupabase,
      user.id,
      {
        shouldRetry: (candidate) =>
          !deps.readFirstAccessInviteId(candidate.app_metadata),
      },
    );
    const resolved = deps.resolveTrustedPasswordFlow(authUser, { attemptId });

    if (resolved.flow !== "first_access" || resolved.attemptState !== "valid") {
      return redirectToLoginWithClearedSession(
        deps,
        request,
        resolved.flow !== "first_access"
          ? RECOVERY_LINK_ERROR_MESSAGE
          : deps.getInvalidFirstAccessAttemptMessage(resolved.attemptState),
      );
    }

    const redirectUrl = new URL(nextPath, request.url);
    redirectUrl.searchParams.set("attempt", attemptId || "");
    return createRedirectResponse(redirectUrl);
  }

  const redirectUrl = new URL(nextPath, request.url);
  return createRedirectResponse(redirectUrl);
}

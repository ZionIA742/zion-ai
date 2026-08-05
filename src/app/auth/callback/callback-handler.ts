import type { createSupabaseServerClient } from "@/lib/supabaseServer";
import type {
  createServiceSupabaseClient,
  getAuthAdminUserByIdWithRetry,
  getInvalidFirstAccessAttemptMessage,
  readFirstAccessInviteId,
  resolveTrustedPasswordFlow,
} from "@/lib/server/zion-account-provisioning";

const LOGIN_PATH = "/login";
const RESET_PASSWORD_PATH = "/auth/reset-password";
const MISSING_CODE_ERROR_MESSAGE =
  "Nao foi possivel validar o link recebido. Peca um novo e-mail.";
const RECOVERY_LINK_ERROR_MESSAGE =
  "O link de recuperacao expirou ou nao e mais valido. Peca um novo e-mail.";
const CALLBACK_ERROR_MESSAGE =
  "Nao foi possivel concluir a autenticacao. Tente novamente a partir do login.";
const FIRST_ACCESS_PATH = "/auth/set-initial-password";
const SUPPORTED_TOKEN_HASH_TYPES = ["recovery", "invite"] as const;

type SupportedTokenHashType = (typeof SUPPORTED_TOKEN_HASH_TYPES)[number];

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
  if (!value) return null;

  try {
    const decoded = decodeURIComponent(value);

    if (!decoded.startsWith("/") || decoded.startsWith("//")) {
      return null;
    }

    return decoded === RESET_PASSWORD_PATH || decoded === FIRST_ACCESS_PATH
      ? decoded
      : null;
  } catch {
    if (
      value.startsWith("/") &&
      !value.startsWith("//") &&
      (value === RESET_PASSWORD_PATH || value === FIRST_ACCESS_PATH)
    ) {
      return value;
    }

    return null;
  }
}

async function resolveAuthenticatedFirstAccessRedirect(args: {
  request: Request;
  deps: CallbackHandlerDeps;
  supabase: Awaited<ReturnType<CallbackHandlerDeps["createSupabaseClient"]>>;
  attemptId: string | null;
}): Promise<Response> {
  const {
    data: { user },
    error: userError,
  } = await args.supabase.auth.getUser();

  if (userError || !user) {
    return redirectToLoginWithClearedSession(
      args.deps,
      args.request,
      RECOVERY_LINK_ERROR_MESSAGE,
    );
  }

  const serviceSupabase = args.deps.createServiceClient();
  const authUser = await args.deps.getAuthAdminUserByIdWithRetry(
    serviceSupabase,
    user.id,
    {
      shouldRetry: (candidate) =>
        !args.deps.readFirstAccessInviteId(candidate.app_metadata),
    },
  );
  const resolved = args.deps.resolveTrustedPasswordFlow(authUser, {
    attemptId: args.attemptId,
  });

  if (resolved.flow !== "first_access" || resolved.attemptState !== "valid") {
    return redirectToLoginWithClearedSession(
      args.deps,
      args.request,
      resolved.flow !== "first_access"
        ? RECOVERY_LINK_ERROR_MESSAGE
        : args.deps.getInvalidFirstAccessAttemptMessage(resolved.attemptState),
    );
  }

  const redirectUrl = new URL(FIRST_ACCESS_PATH, args.request.url);
  redirectUrl.searchParams.set("attempt", args.attemptId || "");
  return createRedirectResponse(redirectUrl);
}

function getSupportedTokenHashType(
  value: string | null,
): SupportedTokenHashType | null {
  return SUPPORTED_TOKEN_HASH_TYPES.find((candidate) => candidate === value) ?? null;
}

export async function handleAuthCallback(
  request: Request,
  deps: CallbackHandlerDeps,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpType = getSupportedTokenHashType(requestUrl.searchParams.get("type"));
  const nextPath = getSafeNextPath(requestUrl.searchParams.get("next"));
  const attemptId = requestUrl.searchParams.get("attempt");
  const callbackError =
    requestUrl.searchParams.get("error_description") ||
    requestUrl.searchParams.get("error_code") ||
    requestUrl.searchParams.get("error");

  console.info("[auth/callback] incoming request", {
    pathname: requestUrl.pathname,
    hasCode: Boolean(code),
    hasTokenHash: Boolean(tokenHash),
    otpType,
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

  if (tokenHash) {
    if (!nextPath) {
      return redirectToLoginWithClearedSession(
        deps,
        request,
        CALLBACK_ERROR_MESSAGE,
      );
    }

    if (!otpType) {
      return redirectToLoginWithClearedSession(
        deps,
        request,
        CALLBACK_ERROR_MESSAGE,
      );
    }

    if (otpType === "invite" && nextPath !== FIRST_ACCESS_PATH) {
      return redirectToLoginWithClearedSession(
        deps,
        request,
        CALLBACK_ERROR_MESSAGE,
      );
    }

    if (otpType === "invite" && !attemptId) {
      return redirectToLoginWithClearedSession(
        deps,
        request,
        deps.getInvalidFirstAccessAttemptMessage("missing"),
      );
    }

    const supabase = await deps.createSupabaseClient();
    await supabase.auth.signOut();

    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });

    if (error) {
      const verifyError = error as {
        message?: string | null;
        status?: number | null;
        code?: string | null;
      } | null;

      console.error("[auth/callback] verifyOtp error", {
        otpType,
        hasAttempt: Boolean(attemptId),
        message: verifyError?.message ?? null,
        status: verifyError?.status ?? null,
        code: verifyError?.code ?? null,
      });

      return redirectToLoginWithClearedSession(
        deps,
        request,
        RECOVERY_LINK_ERROR_MESSAGE,
      );
    }

    if (nextPath === FIRST_ACCESS_PATH) {
      if (!attemptId) {
        return redirectToLoginWithClearedSession(
          deps,
          request,
          deps.getInvalidFirstAccessAttemptMessage("missing"),
        );
      }

      return resolveAuthenticatedFirstAccessRedirect({
        request,
        deps,
        supabase,
        attemptId,
      });
    }

    const redirectUrl = new URL(RESET_PASSWORD_PATH, request.url);
    return createRedirectResponse(redirectUrl);
  }

  if (!code) {
    return redirectToLoginWithClearedSession(
      deps,
      request,
      MISSING_CODE_ERROR_MESSAGE,
    );
  }

  if (!nextPath) {
    return redirectToLoginWithClearedSession(
      deps,
      request,
      CALLBACK_ERROR_MESSAGE,
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

  if (nextPath === FIRST_ACCESS_PATH) {
    if (!attemptId) {
      return redirectToLoginWithClearedSession(
        deps,
        request,
        deps.getInvalidFirstAccessAttemptMessage("missing"),
      );
    }

    return resolveAuthenticatedFirstAccessRedirect({
      request,
      deps,
      supabase,
      attemptId,
    });
  }

  const redirectUrl = new URL(nextPath, request.url);
  return createRedirectResponse(redirectUrl);
}
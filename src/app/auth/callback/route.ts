import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

const DEFAULT_NEXT_PATH = "/auth/reset-password";
const LOGIN_PATH = "/login";
const MISSING_CODE_ERROR_MESSAGE =
  "Nao foi possivel validar o link recebido. Peca um novo e-mail.";
const RECOVERY_LINK_ERROR_MESSAGE =
  "O link de recuperacao expirou ou nao e mais valido. Peca um novo e-mail.";
const CALLBACK_ERROR_MESSAGE =
  "Nao foi possivel concluir a autenticacao. Tente novamente a partir do login.";

async function redirectToLoginWithClearedSession(request: NextRequest, message: string) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  const loginUrl = new URL(LOGIN_PATH, request.url);
  loginUrl.searchParams.set("authError", message);
  return NextResponse.redirect(loginUrl);
}

function getSafeNextPath(value: string | null) {
  if (!value) return DEFAULT_NEXT_PATH;

  try {
    const decoded = decodeURIComponent(value);

    if (!decoded.startsWith("/") || decoded.startsWith("//")) {
      return DEFAULT_NEXT_PATH;
    }

    return decoded;
  } catch {
    if (value.startsWith("/") && !value.startsWith("//")) {
      return value;
    }

    return DEFAULT_NEXT_PATH;
  }
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = getSafeNextPath(requestUrl.searchParams.get("next"));
  const callbackError =
    requestUrl.searchParams.get("error_description") ||
    requestUrl.searchParams.get("error_code") ||
    requestUrl.searchParams.get("error");

  console.info("[auth/callback] incoming request", {
    pathname: requestUrl.pathname,
    hasCode: Boolean(code),
    nextPath,
  });

  if (callbackError) {
    return redirectToLoginWithClearedSession(request, CALLBACK_ERROR_MESSAGE);
  }

  if (!code) {
    return redirectToLoginWithClearedSession(request, MISSING_CODE_ERROR_MESSAGE);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback] exchangeCodeForSession error", {
      nextPath,
      message: error.message,
      status: error.status ?? null,
      code: error.code ?? null,
    });

    return redirectToLoginWithClearedSession(request, RECOVERY_LINK_ERROR_MESSAGE);
  }

  const redirectUrl = new URL(nextPath, request.url);
  return NextResponse.redirect(redirectUrl);
}

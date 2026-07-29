import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  createServiceSupabaseClient,
  getAuthAdminUserById,
  getInvalidFirstAccessAttemptMessage,
  resolveTrustedPasswordFlow,
} from "@/lib/server/zion-account-provisioning";

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

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Usuario nao autenticado." }, { status: 401 });
    }

    const attemptId = new URL(request.url).searchParams.get("attempt");
    const serviceSupabase = createServiceSupabaseClient();
    const authUser = await getAuthAdminUserById(serviceSupabase, user.id);
    const resolved = resolveTrustedPasswordFlow(authUser, { attemptId });

    return NextResponse.json({
      flow: resolved.flow,
      message:
        resolved.flow === "first_access" && resolved.attemptState !== "valid"
          ? getInvalidFirstAccessAttemptMessage(resolved.attemptState)
          : resolved.message,
      attemptValid:
        resolved.flow === "first_access" ? resolved.attemptState === "valid" : null,
      requiresNewLogin: false,
    });
  } catch (error: unknown) {
    console.error("[account/password-flow] error:", getErrorDiagnostics(error));

    return NextResponse.json(
      {
        error: "Falha tecnica ao verificar o fluxo seguro da conta.",
      },
      { status: 500 },
    );
  }
}

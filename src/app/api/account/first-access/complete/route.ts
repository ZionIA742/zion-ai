import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  buildCompletedFirstAccessMetadata,
  createServiceSupabaseClient,
  getAuthAdminUserById,
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

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Usuario nao autenticado." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const attemptId = String(body?.attempt || "").trim() || null;

    const serviceSupabase = createServiceSupabaseClient();
    const authUser = await getAuthAdminUserById(serviceSupabase, user.id);
    const resolved = resolveTrustedPasswordFlow(authUser, { attemptId });

    if (resolved.flow !== "first_access") {
      return NextResponse.json(
        {
          error: "Esta conta nao esta aguardando conclusao de primeiro acesso.",
        },
        { status: 409 },
      );
    }

    if (resolved.attemptState !== "valid") {
      return NextResponse.json(
        {
          error:
            "Este convite nao e mais valido para concluir a primeira senha. Solicite um novo envio ao administrador.",
        },
        { status: 409 },
      );
    }

    const nextMetadata = buildCompletedFirstAccessMetadata(
      authUser.app_metadata,
      new Date().toISOString(),
    );

    const { error: updateError } = await serviceSupabase.auth.admin.updateUserById(user.id, {
      app_metadata: nextMetadata,
    });

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("[account/first-access/complete] error:", getErrorDiagnostics(error));

    return NextResponse.json(
      {
        error:
          "A senha foi criada, mas ainda nao foi possivel concluir a liberacao segura do primeiro acesso.",
      },
      { status: 500 },
    );
  }
}

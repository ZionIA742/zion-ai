import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runOnboardingIntelligentImport } from "@/lib/server/onboarding-intelligent-import";
import {
  buildUnsupportedIntelligentImportFileMessage,
  isSupportedIntelligentImportExtension,
} from "@/lib/server/onboarding-file-extractors";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MembershipRow = {
  organization_id: string;
};

function createServiceSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variaveis de ambiente."
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function authenticateAndAuthorizeImport(args: {
  organizationId: string;
  storeId: string;
}) {
  const sessionSupabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await sessionSupabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false as const,
      status: 401,
      error: "UNAUTHENTICATED",
      message: "Usuario nao autenticado.",
    };
  }

  const { data: memberships, error: membershipError } = await sessionSupabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id);

  if (membershipError) {
    return {
      ok: false as const,
      status: 500,
      error: "LOAD_MEMBERSHIPS_FAILED",
      message: membershipError.message,
    };
  }

  const organizationIds = Array.from(
    new Set(
      ((memberships ?? []) as MembershipRow[])
        .map((row) => String(row.organization_id || "").trim())
        .filter(Boolean)
    )
  );

  if (!organizationIds.includes(args.organizationId)) {
    return {
      ok: false as const,
      status: 403,
      error: "NO_ORGANIZATION_ACCESS",
      message: "Usuario sem acesso a organizacao informada.",
    };
  }

  const serviceSupabase = createServiceSupabaseClient();
  const { data: store, error: storeError } = await serviceSupabase
    .from("stores")
    .select("id, organization_id")
    .eq("id", args.storeId)
    .in("organization_id", organizationIds)
    .maybeSingle();

  if (storeError) {
    return {
      ok: false as const,
      status: 500,
      error: "LOAD_STORE_FAILED",
      message: storeError.message,
    };
  }

  if (!store || String(store.organization_id || "").trim() !== args.organizationId) {
    return {
      ok: false as const,
      status: 403,
      error: "STORE_FORBIDDEN",
      message: "Loja nao encontrada ou fora do escopo do usuario.",
    };
  }

  return {
    ok: true as const,
    userId: user.id,
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const organizationId = String(formData.get("organizationId") || "").trim();
    const storeId = String(formData.get("storeId") || "").trim();
    const debugParserRaw = String(formData.get("debugParser") || "").trim().toLowerCase();
    const debugParser =
      debugParserRaw === "1" || debugParserRaw === "true" || debugParserRaw === "yes";

    const auth = await authenticateAndAuthorizeImport({
      organizationId,
      storeId,
    });

    if (!auth.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: auth.error,
          message: auth.message,
        },
        { status: auth.status }
      );
    }

    const uploadedEntries = formData.getAll("files");
    const invalidFileNames = uploadedEntries
      .map((entry) => {
        if (!(entry instanceof File)) return "";
        const extension = entry.name.includes(".") ? entry.name.split(".").pop() || "" : "";
        return isSupportedIntelligentImportExtension(extension) ? "" : entry.name;
      })
      .filter(Boolean);

    if (invalidFileNames.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "ONBOARDING_INTELLIGENT_IMPORT_UNSUPPORTED_FILE",
          message: buildUnsupportedIntelligentImportFileMessage(invalidFileNames),
        },
        { status: 400 }
      );
    }

    const files = await Promise.all(
      uploadedEntries.map(async (entry) => {
        if (!(entry instanceof File)) {
          throw new Error("Um dos arquivos enviados é inválido.");
        }

        const arrayBuffer = await entry.arrayBuffer();

        return {
          fileName: entry.name,
          mimeType: entry.type || "application/octet-stream",
          buffer: Buffer.from(arrayBuffer),
        };
      })
    );

    const result = await runOnboardingIntelligentImport({
      organizationId,
      storeId,
      files,
      debugParser,
      uploadedBy: auth.userId,
      persistRawFiles: true,
      source: "onboarding_intelligent_import",
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          message: result.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Importação inteligente processada com sucesso.",
      summary: result.summary,
      importedFileIds: result.importedFileIds,
      importedFiles: result.importedFiles,
      rawFilePersistenceWarnings: result.rawFilePersistenceWarnings,
      extractedPreview: result.extractedPreview,
      extractedImagePreview: result.extractedImagePreview,
      imageDiagnostics: result.imageDiagnostics,
      normalizedPreview: result.normalizedPreview,
      dedupedPreview: result.dedupedPreview,
      parserDebug: result.parserDebug,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ONBOARDING_INTELLIGENT_IMPORT_ROUTE_FAILED",
        message:
          error?.message ||
          "Erro interno ao processar rota de importação inteligente.",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "onboarding/intelligent-import",
    method: "POST",
    message: "Rota de importação inteligente publicada.",
  });
}

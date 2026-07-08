import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_EXPIRATION_SECONDS = 60 * 5;

type MembershipRow = {
  organization_id: string;
};

type PreviewRequestBody = {
  importBatchId?: string | null;
  importFileId?: string | null;
  organizationId?: string | null;
  stagingAssetId?: string | null;
  storeId?: string | null;
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
    supabase: serviceSupabase,
  };
}

function buildErrorResponse(params: {
  importBatchId: string | null;
  importFileId: string | null;
  message: string;
  stagingAssetId: string;
  state: "expired" | "invalid" | "missing" | "unavailable";
  status: number;
}) {
  return NextResponse.json(
    {
      ok: false,
      importBatchId: params.importBatchId,
      importFileId: params.importFileId,
      message: params.message,
      stagingAssetId: params.stagingAssetId,
      state: params.state,
    },
    {
      status: params.status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PreviewRequestBody;
    const organizationId = String(body.organizationId || "").trim();
    const storeId = String(body.storeId || "").trim();
    const stagingAssetId = String(body.stagingAssetId || "").trim();
    const importBatchId = String(body.importBatchId || "").trim() || null;
    const importFileId = String(body.importFileId || "").trim() || null;

    if (!organizationId || !storeId || !stagingAssetId || !importBatchId || !importFileId) {
      return buildErrorResponse({
        importBatchId,
        importFileId,
        message: "Preview staged DOCX exige organizationId, storeId, stagingAssetId, importBatchId e importFileId.",
        stagingAssetId: stagingAssetId || "__missing__",
        state: "invalid",
        status: 400,
      });
    }

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
          stagingAssetId,
          state: "unavailable",
        },
        {
          status: auth.status,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const { data: asset, error: assetError } = await auth.supabase
      .from("store_import_media_assets")
      .select(
        "id, organization_id, store_id, import_batch_id, import_file_id, source_kind, association_strength, requires_user_confirmation, status, expires_at, storage_bucket, storage_path"
      )
      .eq("id", stagingAssetId)
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("import_batch_id", importBatchId)
      .eq("import_file_id", importFileId)
      .maybeSingle();

    if (assetError) {
      return buildErrorResponse({
        importBatchId,
        importFileId,
        message: assetError.message,
        stagingAssetId,
        state: "unavailable",
        status: 500,
      });
    }

    if (!asset) {
      return buildErrorResponse({
        importBatchId,
        importFileId,
        message: "O asset staged DOCX desta importacao nao foi encontrado para preview.",
        stagingAssetId,
        state: "missing",
        status: 404,
      });
    }

    const sourceKind = String(asset.source_kind || "").trim().toLowerCase();
    const associationStrength = String(asset.association_strength || "").trim().toLowerCase();
    const status = String(asset.status || "").trim().toLowerCase();
    const storageBucket = String(asset.storage_bucket || "").trim().toLowerCase();
    const storagePath = String(asset.storage_path || "").trim();

    if (
      sourceKind !== "docx_media" ||
      associationStrength !== "visual_evidence" ||
      asset.requires_user_confirmation !== true ||
      status !== "staged"
    ) {
      return buildErrorResponse({
        importBatchId,
        importFileId,
        message: "O asset informado nao representa uma midia DOCX staged revisavel desta importacao.",
        stagingAssetId,
        state: "invalid",
        status: 400,
      });
    }

    const expiresAt = String(asset.expires_at || "").trim();
    const expiresAtMs = Date.parse(expiresAt);
    if (!expiresAt || !Number.isFinite(expiresAtMs)) {
      return buildErrorResponse({
        importBatchId,
        importFileId,
        message: "A expiracao do asset staged e invalida. Reimporte o arquivo para restaurar a preview.",
        stagingAssetId,
        state: "invalid",
        status: 422,
      });
    }

    if (expiresAtMs <= Date.now()) {
      return buildErrorResponse({
        importBatchId,
        importFileId,
        message: "A preview staged desta midia expirou. Reimporte o arquivo para gerar uma nova URL segura.",
        stagingAssetId,
        state: "expired",
        status: 410,
      });
    }

    const expectedPathPrefix = `${organizationId}/${storeId}/${importBatchId}/media/`;
    if (
      storageBucket !== "store-import-files" ||
      !storagePath ||
      !storagePath.startsWith(expectedPathPrefix)
    ) {
      return buildErrorResponse({
        importBatchId,
        importFileId,
        message: "O asset staged nao atende aos requisitos de storage seguro desta importacao.",
        stagingAssetId,
        state: "invalid",
        status: 422,
      });
    }

    const { data: signedData, error: signedError } = await auth.supabase.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRATION_SECONDS);

    if (signedError || !signedData?.signedUrl) {
      return buildErrorResponse({
        importBatchId,
        importFileId,
        message:
          signedError?.message ||
          "Nao foi possivel emitir a URL assinada da preview staged desta importacao.",
        stagingAssetId,
        state: "unavailable",
        status: 502,
      });
    }

    return NextResponse.json(
      {
        ok: true,
        expiresAt,
        importBatchId,
        importFileId,
        signedUrl: signedData.signedUrl,
        stagingAssetId,
        state: "ready",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ONBOARDING_INTELLIGENT_IMPORT_STAGED_MEDIA_PREVIEW_ROUTE_FAILED",
        message:
          error?.message ||
          "Erro interno ao gerar preview staged seguro da importacao inteligente.",
        state: "unavailable",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}

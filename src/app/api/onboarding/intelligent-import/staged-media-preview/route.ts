import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_EXPIRATION_SECONDS = 60 * 5;

type PreviewRequestBody = {
  importBatchId?: string | null;
  importFileId?: string | null;
  organizationId?: string | null;
  stagingAssetId?: string | null;
  storeId?: string | null;
};

type StoreImportMediaAssetRow = {
  id: string | null;
  organization_id: string | null;
  store_id: string | null;
  import_batch_id: string | null;
  import_file_id: string | null;
  source_kind: string | null;
  association_strength: string | null;
  requires_user_confirmation: boolean | null;
  status: string | null;
  expires_at: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
};

type CreateSignedUrlResult = {
  data: { signedUrl?: string | null } | null;
  error: { message: string } | null;
};

type PrivilegedClient = ReturnType<typeof createClient>;

type StagedMediaPreviewRouteDeps = {
  resolveAccess: (params: {
    requirement: "active_or_onboarding";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createPrivilegedClient: () => PrivilegedClient;
};

function createPrivilegedClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variaveis de ambiente.",
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
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
    },
  );
}

export function createStagedMediaPreviewPostHandler(
  deps: Partial<StagedMediaPreviewRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createClientWithPrivileges =
    deps.createPrivilegedClient ?? createPrivilegedClient;

  return async function POST(request: Request) {
    const access = await resolveAccess({
      requirement: "active_or_onboarding",
    });

    if (!access.ok) {
      return createStoreApiDeniedResponse(access);
    }

    try {
      const body = (await request.json()) as PreviewRequestBody;
      const stagingAssetId = String(body.stagingAssetId || "").trim();
      const importBatchId = String(body.importBatchId || "").trim() || null;
      const importFileId = String(body.importFileId || "").trim() || null;
      const organizationId = access.organizationId;
      const storeId = access.storeId;

      if (!stagingAssetId || !importBatchId || !importFileId) {
        return buildErrorResponse({
          importBatchId,
          importFileId,
          message:
            "Preview staged DOCX exige stagingAssetId, importBatchId e importFileId.",
          stagingAssetId: stagingAssetId || "__missing__",
          state: "invalid",
          status: 400,
        });
      }

      const supabase = createClientWithPrivileges();
      const { data: asset, error: assetError } = await supabase
        .from("store_import_media_assets")
        .select(
          "id, organization_id, store_id, import_batch_id, import_file_id, source_kind, association_strength, requires_user_confirmation, status, expires_at, storage_bucket, storage_path",
        )
        .eq("id", stagingAssetId)
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .eq("import_batch_id", importBatchId)
        .eq("import_file_id", importFileId)
        .maybeSingle<StoreImportMediaAssetRow>();

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
          message:
            "A expiracao do asset staged e invalida. Reimporte o arquivo para restaurar a preview.",
          stagingAssetId,
          state: "invalid",
          status: 422,
        });
      }

      if (expiresAtMs <= Date.now()) {
        return buildErrorResponse({
          importBatchId,
          importFileId,
          message:
            "A preview staged desta midia expirou. Reimporte o arquivo para gerar uma nova URL segura.",
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

      const signedUrlResult = (await supabase.storage
        .from(storageBucket)
        .createSignedUrl(
          storagePath,
          SIGNED_URL_EXPIRATION_SECONDS,
        )) as CreateSignedUrlResult;

      if (signedUrlResult.error || !signedUrlResult.data?.signedUrl) {
        return buildErrorResponse({
          importBatchId,
          importFileId,
          message:
            signedUrlResult.error?.message ||
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
          signedUrl: signedUrlResult.data.signedUrl,
          stagingAssetId,
          state: "ready",
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
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
        },
      );
    }
  };
}

export const POST = createStagedMediaPreviewPostHandler();

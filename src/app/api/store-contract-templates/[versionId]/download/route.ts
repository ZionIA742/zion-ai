import { NextResponse } from "next/server";
import {
  resolveStoreApiAccess,
  type StoreApiAccessDenied,
  type StoreApiAccessResult,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_EXPIRATION_SECONDS = 60 * 15;

type ContractTemplateDownloadDeps = {
  resolveAccess: (args: {
    requirement: "active_or_onboarding";
  }) => Promise<StoreApiAccessResult>;
};

type TemplateRow = {
  id: string;
  organization_id: string;
  store_id: string;
};

type VersionRow = {
  id: string;
  template_id: string;
  organization_id: string;
  store_id: string;
  store_file_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
};

type StoreFileRow = {
  id: string;
  organization_id: string;
  store_id: string;
  file_kind: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function errorResponse(status: number, error: string, message: string) {
  return json({ ok: false, error, message }, status);
}

export function createContractTemplateDownloadGetHandler(
  deps: Partial<ContractTemplateDownloadDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;

  return async function GET(
    request: Request,
    context: { params: Promise<{ versionId: string }> },
  ) {
    const access = await resolveAccess({ requirement: "active_or_onboarding" });
    if (!access.ok) {
      return createStoreApiDeniedResponse(access as StoreApiAccessDenied);
    }

    try {
      const url = new URL(request.url);
      const requestedStoreId = String(url.searchParams.get("storeId") || "").trim();
      const versionId = String((await context.params).versionId || "").trim();

      if (!versionId) {
        return errorResponse(400, "INVALID_TEMPLATE_VERSION_ID", "Versao do contrato nao informada.");
      }
      if (!requestedStoreId) {
        return errorResponse(400, "INVALID_STORE_ID", "Store ID nao informado.");
      }
      if (requestedStoreId !== access.storeId) {
        return errorResponse(403, "STORE_FORBIDDEN", "Loja nao encontrada ou fora do escopo do usuario.");
      }

      const { data: template, error: templateError } = await access.supabase
        .from("store_contract_templates")
        .select("id, organization_id, store_id")
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<TemplateRow>();

      if (templateError) {
        return errorResponse(500, "LOAD_CONTRACT_TEMPLATE_FAILED", templateError.message);
      }
      if (!template) {
        return errorResponse(404, "CONTRACT_TEMPLATE_NOT_FOUND", "A loja ainda nao possui um modelo de contrato.");
      }
      if (
        template.organization_id !== access.organizationId ||
        template.store_id !== access.storeId
      ) {
        return errorResponse(403, "CONTRACT_TEMPLATE_SCOPE_MISMATCH", "O modelo esta fora do escopo autorizado.");
      }

      const { data: version, error: versionError } = await access.supabase
        .from("store_contract_template_versions")
        .select("id, template_id, organization_id, store_id, store_file_id, storage_bucket, storage_path, original_filename, mime_type")
        .eq("id", versionId)
        .eq("template_id", template.id)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<VersionRow>();

      if (versionError) {
        return errorResponse(500, "LOAD_CONTRACT_TEMPLATE_VERSION_FAILED", versionError.message);
      }
      if (!version) {
        return errorResponse(404, "CONTRACT_TEMPLATE_VERSION_NOT_FOUND", "A versao do contrato nao foi encontrada.");
      }
      if (
        version.organization_id !== access.organizationId ||
        version.store_id !== access.storeId ||
        version.template_id !== template.id
      ) {
        return errorResponse(403, "CONTRACT_TEMPLATE_SCOPE_MISMATCH", "A versao esta fora do escopo autorizado.");
      }

      if (!version.store_file_id) {
        return errorResponse(422, "CONTRACT_TEMPLATE_FILE_MISSING", "Essa versao nao possui arquivo original armazenado.");
      }

      const { data: storeFile, error: storeFileError } = await access.supabase
        .from("store_files")
        .select("id, organization_id, store_id, file_kind, storage_bucket, storage_path, original_filename, mime_type")
        .eq("id", version.store_file_id)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<StoreFileRow>();

      if (storeFileError) {
        return errorResponse(500, "LOAD_CONTRACT_TEMPLATE_FILE_FAILED", storeFileError.message);
      }

      if (
        !storeFile ||
        storeFile.file_kind !== "store_contract_template_source" ||
        !storeFile.storage_bucket ||
        !storeFile.storage_path ||
        storeFile.storage_bucket !== version.storage_bucket ||
        storeFile.storage_path !== version.storage_path ||
        storeFile.organization_id !== access.organizationId ||
        storeFile.store_id !== access.storeId
      ) {
        return errorResponse(403, "CONTRACT_TEMPLATE_FILE_SCOPE_MISMATCH", "O arquivo original esta fora do escopo autorizado.");
      }

      const { data: signedData, error: signedError } = await access.supabase.storage
        .from(storeFile.storage_bucket)
        .createSignedUrl(storeFile.storage_path, SIGNED_URL_EXPIRATION_SECONDS);

      if (signedError || !signedData?.signedUrl) {
        return errorResponse(
          500,
          "SIGNED_URL_GENERATION_FAILED",
          signedError?.message || "Nao foi possivel gerar o link temporario do contrato.",
        );
      }

      return json({
        ok: true,
        signedUrl: signedData.signedUrl,
        originalFilename: storeFile.original_filename || version.original_filename || null,
        mimeType: storeFile.mime_type || version.mime_type || null,
        expiresIn: SIGNED_URL_EXPIRATION_SECONDS,
      });
    } catch (error) {
      return errorResponse(
        500,
        "CONTRACT_TEMPLATE_DOWNLOAD_FAILED",
        error instanceof Error ? error.message : "Nao foi possivel abrir o contrato original.",
      );
    }
  };
}

export const GET = createContractTemplateDownloadGetHandler();

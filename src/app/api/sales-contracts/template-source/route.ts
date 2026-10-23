import { NextResponse } from "next/server";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";
import { createServiceSupabaseClient } from "@/lib/server/store-contract-templates/template-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_EXPIRATION_SECONDS = 60 * 15;

type RouteError = {
  status: number;
  code: string;
  message: string;
};

type ContractTemplateSourceGetDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createServiceClient: typeof createServiceSupabaseClient;
};

type TemplateRow = {
  id: string;
  organization_id: string;
  store_id: string;
  status: string;
  active_version_id: string | null;
};

type TemplateVersionRow = {
  id: string;
  template_id: string;
  organization_id: string;
  store_id: string;
  status: string;
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
  file_kind: string;
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

function missingTemplateResponse() {
  return json({
    ok: true,
    available: false,
    message: "A loja ainda nao possui um modelo de contrato ativo.",
  });
}

function throwRouteError(status: number, code: string, message: string): never {
  throw { status, code, message } satisfies RouteError;
}

function buildErrorResponse(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    "code" in error &&
    "message" in error
  ) {
    const routeError = error as RouteError;
    return json(
      { ok: false, error: routeError.code, message: routeError.message },
      routeError.status,
    );
  }

  return json(
    {
      ok: false,
      error: "CONTRACT_TEMPLATE_SOURCE_FAILED",
      message: error instanceof Error ? error.message : "Nao foi possivel abrir o modelo de contrato.",
    },
    500,
  );
}

export function createContractTemplateSourceGetHandler(
  deps: Partial<ContractTemplateSourceGetDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createServiceClient = deps.createServiceClient ?? createServiceSupabaseClient;

  return async function GET(request: Request) {
    const access = await resolveAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);

    try {
      const url = new URL(request.url);
      const leadId = String(url.searchParams.get("leadId") || "").trim();
      const commercialOpportunityId = String(
        url.searchParams.get("commercialOpportunityId") || "",
      ).trim();

      if (!leadId || !commercialOpportunityId) {
        return json(
          {
            ok: false,
            error: "MISSING_CONTRACT_SCOPE",
            message: "Lead e oportunidade sao obrigatorios para abrir o modelo.",
          },
          400,
        );
      }

      const { data: lead, error: leadError } = await access.supabase
        .from("leads")
        .select("id, organization_id, store_id")
        .eq("id", leadId)
        .eq("organization_id", access.organizationId)
        .maybeSingle<{ id: string; organization_id: string; store_id: string | null }>();

      if (leadError) throwRouteError(500, "LOAD_LEAD_FAILED", leadError.message);
      if (
        !lead ||
        lead.organization_id !== access.organizationId ||
        lead.store_id !== access.storeId
      ) {
        throwRouteError(403, "CONTRACT_SCOPE_MISMATCH", "A lead esta fora do escopo autorizado.");
      }

      const { data: opportunity, error: opportunityError } = await access.supabase
        .from("commercial_opportunities")
        .select("id, organization_id, store_id, origin_lead_id")
        .eq("id", commercialOpportunityId)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .eq("origin_lead_id", lead.id)
        .maybeSingle<{
          id: string;
          organization_id: string;
          store_id: string;
          origin_lead_id: string | null;
        }>();

      if (opportunityError) {
        throwRouteError(500, "LOAD_OPPORTUNITY_FAILED", opportunityError.message);
      }
      if (
        !opportunity ||
        opportunity.organization_id !== access.organizationId ||
        opportunity.store_id !== access.storeId ||
        opportunity.origin_lead_id !== lead.id
      ) {
        throwRouteError(
          403,
          "CONTRACT_SCOPE_MISMATCH",
          "A oportunidade esta fora do escopo autorizado.",
        );
      }

      // The access client proves the tenant/store scope above. Contract
      // templates and their files are private system data, so read them with
      // the service client rather than relying on end-user table grants.
      const privateSupabase = createServiceClient();

      const { data: template, error: templateError } = await privateSupabase
        .from("store_contract_templates")
        .select("id, organization_id, store_id, status, active_version_id")
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<TemplateRow>();

      if (templateError) throwRouteError(500, "LOAD_CONTRACT_TEMPLATE_FAILED", templateError.message);
      if (
        template &&
        (template.organization_id !== access.organizationId ||
          template.store_id !== access.storeId)
      ) {
        throwRouteError(
          403,
          "CONTRACT_TEMPLATE_SCOPE_MISMATCH",
          "O modelo esta fora do escopo autorizado.",
        );
      }
      if (!template || template.status !== "active" || !template.active_version_id) {
        return missingTemplateResponse();
      }

      const { data: version, error: versionError } = await privateSupabase
        .from("store_contract_template_versions")
        .select(
          "id, template_id, organization_id, store_id, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type",
        )
        .eq("id", template.active_version_id)
        .eq("template_id", template.id)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<TemplateVersionRow>();

      if (versionError) throwRouteError(500, "LOAD_CONTRACT_TEMPLATE_VERSION_FAILED", versionError.message);
      if (!version || version.status !== "active" || !version.store_file_id) {
        return missingTemplateResponse();
      }

      if (
        version.organization_id !== access.organizationId ||
        version.store_id !== access.storeId
      ) {
        throwRouteError(
          403,
          "CONTRACT_TEMPLATE_SCOPE_MISMATCH",
          "A versao do modelo esta fora do escopo autorizado.",
        );
      }

      const { data: storeFile, error: storeFileError } = await privateSupabase
        .from("store_files")
        .select(
          "id, organization_id, store_id, file_kind, storage_bucket, storage_path, original_filename, mime_type",
        )
        .eq("id", version.store_file_id)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<StoreFileRow>();

      if (storeFileError) throwRouteError(500, "LOAD_CONTRACT_TEMPLATE_FILE_FAILED", storeFileError.message);
      if (!storeFile) return missingTemplateResponse();

      if (
        storeFile.organization_id !== access.organizationId ||
        storeFile.store_id !== access.storeId ||
        storeFile.file_kind !== "store_contract_template_source" ||
        !storeFile.storage_bucket ||
        !storeFile.storage_path ||
        storeFile.storage_bucket !== version.storage_bucket ||
        storeFile.storage_path !== version.storage_path
      ) {
        throwRouteError(
          403,
          "CONTRACT_TEMPLATE_FILE_SCOPE_MISMATCH",
          "O arquivo do modelo esta fora do escopo autorizado.",
        );
      }

      const { data: signedData, error: signedError } = await privateSupabase.storage
        .from(storeFile.storage_bucket)
        .createSignedUrl(storeFile.storage_path, SIGNED_URL_EXPIRATION_SECONDS);

      if (signedError || !signedData?.signedUrl) {
        throwRouteError(
          500,
          "SIGNED_URL_GENERATION_FAILED",
          signedError?.message || "Nao foi possivel gerar o link temporario do modelo.",
        );
      }

      return json({
        ok: true,
        available: true,
        signedUrl: signedData.signedUrl,
        originalFilename: storeFile.original_filename || version.original_filename || null,
        mimeType: storeFile.mime_type || version.mime_type || null,
        expiresIn: SIGNED_URL_EXPIRATION_SECONDS,
      });
    } catch (error) {
      return buildErrorResponse(error);
    }
  };
}

export const GET = createContractTemplateSourceGetHandler();

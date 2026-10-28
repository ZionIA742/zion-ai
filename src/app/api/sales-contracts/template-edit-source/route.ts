import { NextResponse } from "next/server";
import { extractContractTextFromStoredFile } from "@/lib/server/store-contract-templates/contract-text-analysis";
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

// A separate, read-only source for the contract text editor. Do not extend
// /template-source: its response intentionally exposes a signed PDF, not text.
type EditSourceDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createServiceClient: typeof createServiceSupabaseClient;
  extractText: typeof extractContractTextFromStoredFile;
};

type ScopedLead = {
  id: string;
  organization_id: string;
  store_id: string | null;
};

type ScopedOpportunity = {
  id: string;
  organization_id: string;
  store_id: string;
  origin_lead_id: string | null;
};

type Template = {
  id: string;
  organization_id: string;
  store_id: string;
  status: string;
  active_version_id: string | null;
};

type TemplateVersion = {
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
  raw_extracted_text: string | null;
};

type StoreFile = {
  id: string;
  organization_id: string;
  store_id: string;
  file_kind: string;
  storage_bucket: string | null;
  storage_path: string | null;
  original_filename: string | null;
};

type RouteError = { status: number; code: string; message: string };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function fail(status: number, code: string, message: string): never {
  throw { status, code, message } satisfies RouteError;
}

export function createContractTemplateEditSourceGetHandler(
  deps: Partial<EditSourceDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createServiceClient = deps.createServiceClient ?? createServiceSupabaseClient;
  const extractText = deps.extractText ?? extractContractTextFromStoredFile;

  return async function GET(request: Request) {
    const access = await resolveAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);

    try {
      const url = new URL(request.url);
      const leadId = (url.searchParams.get("leadId") ?? "").trim();
      const opportunityId = (url.searchParams.get("commercialOpportunityId") ?? "").trim();
      if (!leadId || !opportunityId) {
        return json({
          ok: false,
          error: "MISSING_CONTRACT_SCOPE",
          message: "Lead e oportunidade sao obrigatorios para editar o modelo.",
        }, 400);
      }

      const { data: lead, error: leadError } = await access.supabase
        .from("leads")
        .select("id, organization_id, store_id")
        .eq("id", leadId)
        .eq("organization_id", access.organizationId)
        .maybeSingle<ScopedLead>();
      if (leadError) fail(500, "LOAD_LEAD_FAILED", leadError.message);
      if (
        !lead || lead.id !== leadId ||
        lead.organization_id !== access.organizationId ||
        lead.store_id !== access.storeId
      ) fail(403, "CONTRACT_SCOPE_MISMATCH", "Lead fora do escopo autorizado.");

      const { data: opportunity, error: opportunityError } = await access.supabase
        .from("commercial_opportunities")
        .select("id, organization_id, store_id, origin_lead_id")
        .eq("id", opportunityId)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .eq("origin_lead_id", lead.id)
        .maybeSingle<ScopedOpportunity>();
      if (opportunityError) fail(500, "LOAD_OPPORTUNITY_FAILED", opportunityError.message);
      if (
        !opportunity || opportunity.id !== opportunityId ||
        opportunity.organization_id !== access.organizationId ||
        opportunity.store_id !== access.storeId ||
        opportunity.origin_lead_id !== lead.id
      ) fail(403, "CONTRACT_SCOPE_MISMATCH", "Oportunidade fora do escopo autorizado.");

      // The browser client proves tenant, store, lead and opportunity before
      // any privileged lookup of the private template/version/file records.
      const privateSupabase = createServiceClient();
      const { data: template, error: templateError } = await privateSupabase
        .from("store_contract_templates")
        .select("id, organization_id, store_id, status, active_version_id")
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<Template>();
      if (templateError) fail(500, "LOAD_CONTRACT_TEMPLATE_FAILED", templateError.message);
      if (
        template && (template.organization_id !== access.organizationId ||
        template.store_id !== access.storeId)
      ) fail(403, "CONTRACT_TEMPLATE_SCOPE_MISMATCH", "Modelo fora do escopo autorizado.");
      if (!template || template.status !== "active" || !template.active_version_id) {
        return json({ ok: true, available: false, message: "A loja nao possui modelo ativo." });
      }

      const { data: version, error: versionError } = await privateSupabase
        .from("store_contract_template_versions")
        .select("id, template_id, organization_id, store_id, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, raw_extracted_text")
        .eq("id", template.active_version_id)
        .eq("template_id", template.id)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<TemplateVersion>();
      if (versionError) fail(500, "LOAD_CONTRACT_TEMPLATE_VERSION_FAILED", versionError.message);
      if (
        version && (version.id !== template.active_version_id ||
        version.organization_id !== access.organizationId ||
        version.store_id !== access.storeId || version.template_id !== template.id)
      ) fail(403, "CONTRACT_TEMPLATE_SCOPE_MISMATCH", "Versao fora do escopo autorizado.");
      if (!version || version.status !== "active" || !version.store_file_id) {
        return json({ ok: true, available: false, message: "Modelo ativo sem versao utilizavel." });
      }

      const { data: storeFile, error: storeFileError } = await privateSupabase
        .from("store_files")
        .select("id, organization_id, store_id, file_kind, storage_bucket, storage_path, original_filename")
        .eq("id", version.store_file_id)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<StoreFile>();
      if (storeFileError) fail(500, "LOAD_CONTRACT_TEMPLATE_FILE_FAILED", storeFileError.message);
      if (
        !storeFile || storeFile.id !== version.store_file_id ||
        storeFile.organization_id !== access.organizationId ||
        storeFile.store_id !== access.storeId ||
        storeFile.file_kind !== "store_contract_template_source" ||
        !storeFile.storage_bucket || !storeFile.storage_path ||
        storeFile.storage_bucket !== version.storage_bucket ||
        storeFile.storage_path !== version.storage_path
      ) fail(403, "CONTRACT_TEMPLATE_FILE_SCOPE_MISMATCH", "Arquivo fora do escopo autorizado.");

      // Legacy approved templates can have no saved extraction. Recover a
      // READ-ONLY PREVIEW from the scoped private original; never change
      // status, approval, raw_extracted_text or the stored PDF in this GET.
      let extractedText = version.raw_extracted_text;
      let recoveredFromFile = false;
      if (typeof extractedText !== "string" || !extractedText.trim()) {
        let fileData: Blob | null = null;
        try {
          const result = await privateSupabase.storage
            .from(storeFile.storage_bucket)
            .download(storeFile.storage_path);
          if (result.error || !result.data) {
            return json({ ok: false, error: "CONTRACT_TEMPLATE_RECOVERY_DOWNLOAD_FAILED",
              message: "Nao foi possivel ler o PDF original em armazenamento privado." }, 409);
          }
          fileData = result.data;
        } catch {
          return json({ ok: false, error: "CONTRACT_TEMPLATE_RECOVERY_DOWNLOAD_FAILED",
            message: "Nao foi possivel ler o PDF original em armazenamento privado." }, 409);
        }
        if (!fileData) {
          return json({ ok: false, error: "CONTRACT_TEMPLATE_RECOVERY_DOWNLOAD_FAILED",
            message: "Nao foi possivel ler o PDF original em armazenamento privado." }, 409);
        }
        try {
          const recovered = await extractText({
            fileName: storeFile.original_filename || version.original_filename || "modelo.pdf",
            mimeType: version.mime_type || "application/pdf",
            buffer: Buffer.from(await fileData.arrayBuffer()),
          });
          extractedText = recovered.text;
        } catch {
          return json({ ok: false, error: "CONTRACT_TEMPLATE_RECOVERY_EXTRACT_FAILED",
            message: "O PDF original nao forneceu texto legivel. Verifique se permite selecionar texto." }, 409);
        }
        if (typeof extractedText !== "string" || !extractedText.trim()) {
          return json({ ok: false, error: "CONTRACT_TEMPLATE_RECOVERY_TEXT_EMPTY",
            message: "A extracao do PDF original nao encontrou texto legivel." }, 409);
        }
        recoveredFromFile = true;
      }
      if (extractedText.length > 300_000) {
        return json({
          ok: false,
          error: "CONTRACT_TEMPLATE_TEXT_TOO_LARGE",
          message: "O texto do modelo excede o limite de edicao. Nenhum trecho foi omitido.",
        }, 413);
      }

      return json({
        ok: true,
        available: true,
        templateId: template.id,
        templateVersionId: version.id,
        originalFilename: storeFile.original_filename || version.original_filename || null,
        text: extractedText,
        recoveredFromFile,
        reviewRequired: recoveredFromFile,
      });
    } catch (error) {
      if (
        error && typeof error === "object" &&
        "status" in error && "code" in error && "message" in error
      ) {
        const routeError = error as RouteError;
        return json({ ok: false, error: routeError.code, message: routeError.message }, routeError.status);
      }
      return json({
        ok: false,
        error: "CONTRACT_TEMPLATE_EDIT_SOURCE_FAILED",
        message: error instanceof Error ? error.message : "Falha ao carregar texto do contrato.",
      }, 500);
    }
  };
}

export const GET = createContractTemplateEditSourceGetHandler();

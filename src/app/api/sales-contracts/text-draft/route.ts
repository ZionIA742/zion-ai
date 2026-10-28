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
import { hashPersistedText } from "@/lib/server/sales-contracts/contract-text-draft-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Drafts are per organization/store/opportunity/active-template-version.
// The source template and previously generated contract versions stay untouched.
const MAX_DRAFT_LENGTH = 300_000; // Same maximum as template-edit-source.

type HandlerDeps = {
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
type Version = {
  id: string;
  template_id: string;
  organization_id: string;
  store_id: string;
  status: string;
  store_file_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  raw_extracted_text: string | null;
  original_filename: string | null;
  mime_type: string | null;
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
type Draft = {
  id: string;
  organization_id: string;
  store_id: string;
  commercial_opportunity_id: string;
  template_version_id: string;
  draft_text: string;
  revision: number;
  updated_at: string;
};
type ApiError = { status: number; code: string; message: string };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function reject(status: number, code: string, message: string): never {
  throw { status, code, message } satisfies ApiError;
}
function respondError(error: unknown) {
  if (error && typeof error === "object" && "status" in error && "code" in error && "message" in error) {
    const e = error as ApiError;
    return json({ ok: false, error: e.code, message: e.message }, e.status);
  }
  return json({ ok: false, error: "CONTRACT_TEXT_DRAFT_FAILED", message: "Nao foi possivel acessar o rascunho do contrato." }, 500);
}
function presentDraft(draft: Draft) {
  return {
    draftId: draft.id,
    draftSha256: hashPersistedText(draft.draft_text),
    text: draft.draft_text,
    revision: draft.revision,
    templateVersionId: draft.template_version_id,
    updatedAt: draft.updated_at,
  };
}

function draftIdentity(draft: ReturnType<typeof presentDraft> | null) {
  return {
    draftId: draft?.draftId ?? null,
    draftSha256: draft?.draftSha256 ?? null,
  };
}

export function createContractTextDraftHandlers(deps: Partial<HandlerDeps> = {}) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createServiceClient = deps.createServiceClient ?? createServiceSupabaseClient;
  const extractText = deps.extractText ?? extractContractTextFromStoredFile;

  async function resolveScope(leadId: string, opportunityId: string, allowMissingSourceText = false) {
    const access = await resolveAccess({ requirement: "active" });
    if (!access.ok) return { denied: createStoreApiDeniedResponse(access) } as const;

    if (!leadId || !opportunityId) {
      reject(400, "MISSING_CONTRACT_SCOPE", "Lead e oportunidade sao obrigatorios.");
    }
    const { data: lead, error: leadError } = await access.supabase
      .from("leads").select("id, organization_id, store_id")
      .eq("id", leadId).eq("organization_id", access.organizationId)
      .maybeSingle<ScopedLead>();
    if (leadError) reject(500, "LOAD_LEAD_FAILED", "Nao foi possivel conferir o lead.");
    if (!lead || lead.id !== leadId || lead.organization_id !== access.organizationId || lead.store_id !== access.storeId) {
      reject(403, "CONTRACT_SCOPE_MISMATCH", "Lead fora do escopo autorizado.");
    }
    const { data: opportunity, error: oppError } = await access.supabase
      .from("commercial_opportunities").select("id, organization_id, store_id, origin_lead_id")
      .eq("id", opportunityId).eq("organization_id", access.organizationId)
      .eq("store_id", access.storeId).eq("origin_lead_id", lead.id)
      .maybeSingle<ScopedOpportunity>();
    if (oppError) reject(500, "LOAD_OPPORTUNITY_FAILED", "Nao foi possivel conferir a oportunidade.");
    if (!opportunity || opportunity.id !== opportunityId || opportunity.organization_id !== access.organizationId || opportunity.store_id !== access.storeId || opportunity.origin_lead_id !== lead.id) {
      reject(403, "CONTRACT_SCOPE_MISMATCH", "Oportunidade fora do escopo autorizado.");
    }

    // Privileged table access is only used after scoped membership and ownership checks.
    const admin = createServiceClient();
    const { data: template, error: templateError } = await admin
      .from("store_contract_templates").select("id, organization_id, store_id, status, active_version_id")
      .eq("organization_id", access.organizationId).eq("store_id", access.storeId)
      .maybeSingle<Template>();
    if (templateError) reject(500, "LOAD_CONTRACT_TEMPLATE_FAILED", "Nao foi possivel conferir o modelo da loja.");
    if (!template || template.status !== "active" || !template.active_version_id) {
      reject(409, "CONTRACT_TEMPLATE_NOT_ACTIVE", "A loja nao possui modelo ativo para edicao.");
    }
    if (template.organization_id !== access.organizationId || template.store_id !== access.storeId) {
      reject(403, "CONTRACT_TEMPLATE_SCOPE_MISMATCH", "Modelo fora do escopo autorizado.");
    }
    const { data: version, error: versionError } = await admin
      .from("store_contract_template_versions")
      .select("id, template_id, organization_id, store_id, status, store_file_id, storage_bucket, storage_path, raw_extracted_text, original_filename, mime_type")
      .eq("id", template.active_version_id).eq("template_id", template.id)
      .eq("organization_id", access.organizationId).eq("store_id", access.storeId)
      .maybeSingle<Version>();
    if (versionError) reject(500, "LOAD_CONTRACT_TEMPLATE_VERSION_FAILED", "Nao foi possivel conferir a versao do modelo.");
    if (!version || version.status !== "active" || !version.store_file_id || version.id !== template.active_version_id || version.template_id !== template.id || version.organization_id !== access.organizationId || version.store_id !== access.storeId) {
      reject(409, "CONTRACT_TEMPLATE_VERSION_UNAVAILABLE", "A versao ativa do modelo nao esta disponivel.");
    }
    const { data: file, error: fileError } = await admin
      .from("store_files").select("id, organization_id, store_id, file_kind, storage_bucket, storage_path, original_filename")
      .eq("id", version.store_file_id).eq("organization_id", access.organizationId)
      .eq("store_id", access.storeId).maybeSingle<StoreFile>();
    if (fileError) reject(500, "LOAD_CONTRACT_TEMPLATE_FILE_FAILED", "Nao foi possivel conferir o arquivo do modelo.");
    if (!file || file.id !== version.store_file_id || file.organization_id !== access.organizationId || file.store_id !== access.storeId || file.file_kind !== "store_contract_template_source" || !file.storage_bucket || !file.storage_path || file.storage_bucket !== version.storage_bucket || file.storage_path !== version.storage_path) {
      reject(403, "CONTRACT_TEMPLATE_FILE_SCOPE_MISMATCH", "Arquivo fora do escopo autorizado.");
    }
    // A read-only draft lookup must work for approved legacy PDFs that lack
    // raw_extracted_text. PUT remains blocked until preview is reviewed.
    if ((!allowMissingSourceText && !version.raw_extracted_text?.trim()) ||
        (version.raw_extracted_text && version.raw_extracted_text.length > MAX_DRAFT_LENGTH)) {
      reject(409, "CONTRACT_TEMPLATE_TEXT_UNAVAILABLE", "Texto original indisponivel ou acima do limite; revise a extracao.");
    }

    const scope = { organization_id: access.organizationId, store_id: access.storeId,
      commercial_opportunity_id: opportunity.id, template_version_id: version.id };
    return { admin, access, scope, version, file } as const;
  }

  function draftQuery(admin: ReturnType<typeof createServiceSupabaseClient>, scope: {
    organization_id: string; store_id: string; commercial_opportunity_id: string; template_version_id: string;
  }) {
    return admin.from("sales_contract_text_drafts")
      .select("id, organization_id, store_id, commercial_opportunity_id, template_version_id, draft_text, revision, updated_at")
      .eq("organization_id", scope.organization_id).eq("store_id", scope.store_id)
      .eq("commercial_opportunity_id", scope.commercial_opportunity_id)
      .eq("template_version_id", scope.template_version_id);
  }

  async function GET(request: Request) {
    try {
      const url = new URL(request.url);
      const resolved = await resolveScope(
        String(url.searchParams.get("leadId") || "").trim(),
        String(url.searchParams.get("commercialOpportunityId") || "").trim(),
        true,
      );
      if ("denied" in resolved) return resolved.denied ?? json({ ok: false, error: "CONTRACT_SCOPE_RESOLUTION_FAILED", message: "Nao foi possivel validar o escopo." }, 500);
      const { data, error } = await draftQuery(resolved.admin, resolved.scope).maybeSingle<Draft>();
      if (error) reject(500, "LOAD_CONTRACT_DRAFT_FAILED", "Nao foi possivel carregar o rascunho.");
      const draft = data ? presentDraft(data) : null;
      return json({ ok: true, templateVersionId: resolved.scope.template_version_id,
        draft, ...draftIdentity(draft) });
    } catch (error) { return respondError(error); }
  }

  async function PUT(request: Request) {
    try {
      // Authenticate before interpreting user-controlled payload.
      const access = await resolveAccess({ requirement: "active" });
      if (!access.ok) return createStoreApiDeniedResponse(access);
      let input: Record<string, unknown>;
      try {
        const parsed: unknown = await request.json();
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid payload");
        input = parsed as Record<string, unknown>;
      } catch {
        reject(400, "CONTRACT_DRAFT_BODY_INVALID", "Corpo JSON invalido.");
      }
      const leadId = typeof input.leadId === "string" ? input.leadId.trim() : "";
      const oppId = typeof input.commercialOpportunityId === "string" ? input.commercialOpportunityId.trim() : "";
      const versionId = typeof input.templateVersionId === "string" ? input.templateVersionId.trim() : "";
      const text = input.text;
      const expectedRevision = input.expectedRevision;
      if (!leadId || !oppId || !versionId || typeof text !== "string" || !text.trim() || text.length > MAX_DRAFT_LENGTH) {
        reject(400, "CONTRACT_DRAFT_INPUT_INVALID", "Texto, oportunidade ou versao invalida.");
      }
      if (expectedRevision !== null && (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
        reject(400, "CONTRACT_DRAFT_REVISION_INVALID", "A revisao esperada deve ser nula ou um inteiro positivo.");
      }
      const resolved = await resolveScope(leadId, oppId, true);
      if ("denied" in resolved) return resolved.denied ?? json({ ok: false, error: "CONTRACT_SCOPE_RESOLUTION_FAILED", message: "Nao foi possivel validar o escopo." }, 500);
      if (resolved.scope.template_version_id !== versionId) {
        reject(409, "CONTRACT_TEMPLATE_VERSION_CHANGED", "O modelo ativo mudou. Reabra o editor antes de salvar.");
      }
      // Actor comes exclusively from authenticated server access, never body input.
      const actorId = access.sessionUserId;
      if (!actorId || actorId !== resolved.access.sessionUserId) {
        reject(403, "CONTRACT_DRAFT_ACTOR_REQUIRED", "Usuario autenticado nao identificado.");
      }
      const admin = resolved.admin;
      // For legacy approved PDFs with no stored extraction, the first draft
      // requires an explicit human review and an exact server-side re-extraction.
      // Nothing here writes to the template, approval or original PDF.
      if (expectedRevision === null && !resolved.version.raw_extracted_text?.trim()) {
        const reviewedSourceText = input.reviewedSourceText;
        if (input.recoveryReviewed !== true || typeof reviewedSourceText !== "string" ||
            !reviewedSourceText.trim() || reviewedSourceText.length > MAX_DRAFT_LENGTH) {
          reject(409, "CONTRACT_DRAFT_RECOVERY_REVIEW_REQUIRED",
            "Confira o texto com o PDF original e confirme antes do primeiro salvamento.");
        }
        let recoveredText: string;
        try {
          const downloaded = await admin.storage.from(resolved.file.storage_bucket!).download(resolved.file.storage_path!);
          if (downloaded.error || !downloaded.data) {
            reject(409, "CONTRACT_DRAFT_RECOVERY_UNAVAILABLE", "Nao foi possivel verificar o PDF original.");
          }
          const extracted = await extractText({
            fileName: resolved.file.original_filename || resolved.version.original_filename || "modelo.pdf",
            mimeType: resolved.version.mime_type || "application/pdf",
            buffer: Buffer.from(await downloaded.data.arrayBuffer()),
          });
          recoveredText = extracted.text;
        } catch {
          reject(409, "CONTRACT_DRAFT_RECOVERY_UNAVAILABLE", "Nao foi possivel verificar o texto do PDF original.");
        }
        if (!recoveredText.trim() || recoveredText.length > MAX_DRAFT_LENGTH ||
            recoveredText !== reviewedSourceText) {
          reject(409, "CONTRACT_DRAFT_RECOVERY_CHANGED",
            "A extracao do PDF mudou ou nao corresponde a previa conferida. Reabra o editor.");
        }
      }
      if (expectedRevision === null) {
        const { data, error } = await admin.from("sales_contract_text_drafts")
          .insert({ ...resolved.scope, draft_text: text, created_by_user_id: actorId, updated_by_user_id: actorId })
          .select("id, organization_id, store_id, commercial_opportunity_id, template_version_id, draft_text, revision, updated_at")
          .single<Draft>();
        if (error?.code === "23505") {
          reject(409, "CONTRACT_DRAFT_REVISION_CONFLICT", "Ja existe um rascunho. Recarregue antes de salvar.");
        }
        if (error || !data) reject(500, "SAVE_CONTRACT_DRAFT_FAILED", "Nao foi possivel salvar o rascunho.");
        const draft = presentDraft(data);
        return json({ ok: true, draft, ...draftIdentity(draft) });
      }
      // Atomic compare-and-update: the SQL trigger increments revision exactly once.
      const { data, error } = await admin.from("sales_contract_text_drafts")
        .update({ draft_text: text, updated_by_user_id: actorId })
        .eq("organization_id", resolved.scope.organization_id)
        .eq("store_id", resolved.scope.store_id)
        .eq("commercial_opportunity_id", resolved.scope.commercial_opportunity_id)
        .eq("template_version_id", resolved.scope.template_version_id)
        .eq("revision", expectedRevision)
        .select("id, organization_id, store_id, commercial_opportunity_id, template_version_id, draft_text, revision, updated_at")
        .maybeSingle<Draft>();
      if (error) reject(500, "SAVE_CONTRACT_DRAFT_FAILED", "Nao foi possivel salvar o rascunho.");
      if (!data) reject(409, "CONTRACT_DRAFT_REVISION_CONFLICT", "O rascunho foi alterado em outra sessao. Recarregue antes de salvar.");
      if (data.revision !== expectedRevision + 1) reject(500, "CONTRACT_DRAFT_REVISION_FAILED", "O banco nao confirmou a nova revisao.");
      const draft = presentDraft(data);
      return json({ ok: true, draft, ...draftIdentity(draft) });
    } catch (error) { return respondError(error); }
  }
  return { GET, PUT };
}

const handlers = createContractTextDraftHandlers();
export const GET = handlers.GET;
export const PUT = handlers.PUT;

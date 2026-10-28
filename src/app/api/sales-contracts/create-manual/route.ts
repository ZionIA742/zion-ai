import { createHash } from "node:crypto";
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

const MAX_DRAFT_LENGTH = 300_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

type RouteError = { status: number; code: string; message: string };
type Body = {
  commercialOpportunityId?: unknown;
  draftId?: unknown;
  templateVersionId?: unknown;
  draftRevision?: unknown;
  draftSha256?: unknown;
};
type Opportunity = { id: string; organization_id: string; store_id: string };
type Draft = {
  id: string;
  organization_id: string;
  store_id: string;
  commercial_opportunity_id: string;
  template_version_id: string;
  draft_text: string;
  revision: number;
};
type Template = { id: string; organization_id: string; store_id: string; status: string; active_version_id: string | null };
type TemplateVersion = { id: string; template_id: string; organization_id: string; store_id: string; status: string };
type WriterRow = {
  outcome?: unknown;
  contract_id?: unknown;
  organization_id?: unknown;
  store_id?: unknown;
  commercial_opportunity_id?: unknown;
  draft_id?: unknown;
  draft_revision?: unknown;
  contract_status?: unknown;
};

type CreateManualContractDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createServiceClient: typeof createServiceSupabaseClient;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function throwRouteError(status: number, code: string, message: string): never {
  throw { status, code, message } satisfies RouteError;
}

function respondError(error: unknown) {
  if (error && typeof error === "object" && "status" in error && "code" in error && "message" in error) {
    const routeError = error as RouteError;
    return json({ ok: false, error: routeError.code, message: routeError.message }, routeError.status);
  }
  return json({ ok: false, error: "MANUAL_CONTRACT_CREATE_FAILED", message: "Nao foi possivel criar o contrato manual." }, 500);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readWriterRow(data: unknown): WriterRow | null {
  if (Array.isArray(data)) return (data[0] ?? null) as WriterRow | null;
  return (data ?? null) as WriterRow | null;
}

function extractRpcCode(error: { message?: string | null; details?: string | null; hint?: string | null; code?: string | null }) {
  for (const candidate of [error.message, error.details, error.hint, error.code]) {
    const match = String(candidate || "").match(/P9_MANUAL_CONTRACT_[A-Z0-9_]+/);
    if (match) return match[0];
  }
  return null;
}

function validateWriterRow(data: unknown, args: {
  organizationId: string;
  storeId: string;
  opportunityId: string;
  draftId: string;
  draftRevision: number;
}) {
  const row = readWriterRow(data);
  const outcome = text(row?.outcome);
  const contractId = text(row?.contract_id);
  if (!row || !["created", "already_exists"].includes(outcome) || !UUID_PATTERN.test(contractId)) {
    throw new Error("A RPC de criacao manual retornou um resultado invalido.");
  }
  if (
    row.organization_id !== args.organizationId ||
    row.store_id !== args.storeId ||
    row.commercial_opportunity_id !== args.opportunityId ||
    row.draft_id !== args.draftId ||
    row.draft_revision !== args.draftRevision ||
    !text(row.contract_status)
  ) {
    throw new Error("A RPC de criacao manual retornou identidade fora do escopo.");
  }
  return { ...row, outcome, contract_id: contractId };
}

export function createCreateManualContractPostHandler(deps: Partial<CreateManualContractDeps> = {}) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createServiceClient = deps.createServiceClient ?? createServiceSupabaseClient;

  return async function POST(request: Request) {
    try {
      const access = await resolveAccess({ requirement: "active" });
      if (!access.ok) return createStoreApiDeniedResponse(access);

      let body: Body;
      try {
        const parsed: unknown = await request.json();
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
        body = parsed as Body;
      } catch {
        throwRouteError(400, "MANUAL_CONTRACT_BODY_INVALID", "Corpo JSON invalido.");
      }

      const opportunityId = text(body.commercialOpportunityId);
      const draftId = text(body.draftId);
      const templateVersionId = text(body.templateVersionId);
      const draftSha256 = text(body.draftSha256).toLowerCase();
      const draftRevision = body.draftRevision;
      if (
        !UUID_PATTERN.test(opportunityId) ||
        !UUID_PATTERN.test(draftId) ||
        !UUID_PATTERN.test(templateVersionId) ||
        !SHA256_PATTERN.test(draftSha256) ||
        typeof draftRevision !== "number" ||
        !Number.isSafeInteger(draftRevision) ||
        draftRevision < 1
      ) {
        throwRouteError(400, "MANUAL_CONTRACT_INPUT_INVALID", "Oportunidade, rascunho, modelo, revisao ou SHA-256 invalido.");
      }

      const { data: opportunity, error: opportunityError } = await access.supabase
        .from("commercial_opportunities")
        .select("id, organization_id, store_id")
        .eq("id", opportunityId)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<Opportunity>();
      if (opportunityError) throw new Error(opportunityError.message);
      if (!opportunity || opportunity.id !== opportunityId || opportunity.organization_id !== access.organizationId || opportunity.store_id !== access.storeId) {
        throwRouteError(403, "CONTRACT_SCOPE_MISMATCH", "A oportunidade esta fora do escopo autorizado.");
      }

      const admin = createServiceClient();
      const { data: draft, error: draftError } = await admin
        .from("sales_contract_text_drafts")
        .select("id, organization_id, store_id, commercial_opportunity_id, template_version_id, draft_text, revision")
        .eq("id", draftId)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .eq("commercial_opportunity_id", opportunityId)
        .eq("template_version_id", templateVersionId)
        .maybeSingle<Draft>();
      if (draftError) throw new Error(draftError.message);
      if (!draft || draft.id !== draftId || draft.organization_id !== access.organizationId || draft.store_id !== access.storeId || draft.commercial_opportunity_id !== opportunityId || draft.template_version_id !== templateVersionId) {
        throwRouteError(409, "MANUAL_CONTRACT_DRAFT_NOT_FOUND", "O rascunho nao pertence ao escopo informado.");
      }
      if (draft.revision !== draftRevision || !draft.draft_text.trim() || draft.draft_text.length > MAX_DRAFT_LENGTH) {
        throwRouteError(409, "MANUAL_CONTRACT_DRAFT_REVISION_INVALID", "A revisao do rascunho mudou ou o texto nao e valido.");
      }
      const actualSha256 = createHash("sha256").update(draft.draft_text, "utf8").digest("hex");
      if (actualSha256 !== draftSha256) {
        throwRouteError(409, "MANUAL_CONTRACT_DRAFT_HASH_CHANGED", "O SHA-256 do rascunho nao corresponde ao texto salvo.");
      }

      const { data: template, error: templateError } = await admin
        .from("store_contract_templates")
        .select("id, organization_id, store_id, status, active_version_id")
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<Template>();
      if (templateError) throw new Error(templateError.message);
      if (!template || template.organization_id !== access.organizationId || template.store_id !== access.storeId || template.status !== "active" || template.active_version_id !== templateVersionId) {
        throwRouteError(409, "MANUAL_CONTRACT_TEMPLATE_NOT_ACTIVE", "O modelo informado nao e o modelo ativo da loja.");
      }

      const { data: version, error: versionError } = await admin
        .from("store_contract_template_versions")
        .select("id, template_id, organization_id, store_id, status")
        .eq("id", templateVersionId)
        .eq("template_id", template.id)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<TemplateVersion>();
      if (versionError) throw new Error(versionError.message);
      if (!version || version.id !== templateVersionId || version.template_id !== template.id || version.organization_id !== access.organizationId || version.store_id !== access.storeId || version.status !== "active") {
        throwRouteError(409, "MANUAL_CONTRACT_TEMPLATE_VERSION_NOT_ACTIVE", "A versao do modelo nao esta ativa.");
      }

      const { data, error } = await admin.rpc("create_sales_contract_manual_by_system", {
        p_organization_id: access.organizationId,
        p_store_id: access.storeId,
        p_commercial_opportunity_id: opportunityId,
        p_draft_id: draftId,
        p_template_version_id: templateVersionId,
        p_draft_revision: draftRevision,
        p_draft_sha256: draftSha256,
        p_actor_user_id: access.sessionUserId,
      });
      if (error) {
        const code = extractRpcCode(error);
        if (code) throwRouteError(409, code, error.message || "A criacao manual foi recusada pela autoridade canonica.");
        throw new Error(error.message || "Falha na autoridade de criacao manual.");
      }

      const result = validateWriterRow(data, {
        organizationId: access.organizationId,
        storeId: access.storeId,
        opportunityId,
        draftId,
        draftRevision,
      });
      return json({ ok: true, operation: result });
    } catch (error) {
      return respondError(error);
    }
  };
}

export const POST = createCreateManualContractPostHandler();

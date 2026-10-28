import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_CONTRACT_TEXT_DRAFT_CHARS = 300_000;

/**
 * Identifiers already resolved by authenticated server-side access control.
 * These values are not a substitute for authorization; this reader also
 * revalidates every tenant, opportunity, template and active-version link.
 */
export type AuthorizedContractTextDraftScope = {
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  templateVersionId: string;
  revision: number;
};

export type ContractTextDraftSource = {
  draftId: string;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  templateVersionId: string;
  revision: number;
  text: string;
  sha256: string;
};

export type ContractTextDraftSourceErrorCode =
  | "INVALID_AUTHORIZED_SCOPE"
  | "OPPORTUNITY_NOT_FOUND"
  | "OPPORTUNITY_SCOPE_MISMATCH"
  | "CONTRACT_TEMPLATE_NOT_AUTHORIZED"
  | "CONTRACT_TEMPLATE_VERSION_NOT_AUTHORIZED"
  | "DRAFT_NOT_FOUND"
  | "DRAFT_SCOPE_MISMATCH"
  | "DRAFT_REVISION_MISMATCH"
  | "DRAFT_TEXT_INVALID"
  | "DRAFT_SOURCE_READ_FAILED";

export class ContractTextDraftSourceError extends Error {
  constructor(
    public readonly code: ContractTextDraftSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContractTextDraftSourceError";
  }
}

type DraftReadClient = Pick<SupabaseClient, "from">;

type OpportunityRow = {
  id: string;
  organization_id: string;
  store_id: string;
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
};

type DraftRow = {
  id: string;
  organization_id: string;
  store_id: string;
  commercial_opportunity_id: string;
  template_version_id: string;
  draft_text: string;
  revision: number;
};

function fail(code: ContractTextDraftSourceErrorCode, message: string): never {
  throw new ContractTextDraftSourceError(code, message);
}

function requireScope(scope: AuthorizedContractTextDraftScope): void {
  const values = [
    scope?.organizationId,
    scope?.storeId,
    scope?.commercialOpportunityId,
    scope?.templateVersionId,
  ];
  if (
    values.some((value) => typeof value !== "string" || value.trim().length === 0) ||
    !Number.isSafeInteger(scope?.revision) ||
    scope.revision < 1
  ) {
    fail("INVALID_AUTHORIZED_SCOPE", "O escopo autorizado do rascunho e invalido.");
  }
}

export function hashPersistedText(text: string): string {
  // Deterministic representation: exact JavaScript string encoded as UTF-8;
  // no trimming, line-ending conversion, Unicode normalization, or replacement.
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/**
 * Reads one exact persisted draft for a server-authorized scope.
 *
 * This is deliberately non-transactional and read-only. A future SQL writer
 * must revalidate the same lineage atomically before creating a canonical
 * contract version; this function is not that guarantee.
 */
export async function readContractTextDraftSource(args: {
  supabase: DraftReadClient;
  authorizedScope: AuthorizedContractTextDraftScope;
}): Promise<ContractTextDraftSource> {
  const scope = args.authorizedScope;
  requireScope(scope);

  const opportunityResult = await args.supabase
    .from("commercial_opportunities")
    .select("id, organization_id, store_id")
    .eq("id", scope.commercialOpportunityId)
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.storeId)
    .maybeSingle<OpportunityRow>();
  if (opportunityResult.error) {
    fail("DRAFT_SOURCE_READ_FAILED", "Nao foi possivel validar a oportunidade comercial.");
  }
  const opportunity = opportunityResult.data;
  if (!opportunity) fail("OPPORTUNITY_NOT_FOUND", "A oportunidade comercial nao foi encontrada no escopo.");
  if (
    opportunity.id !== scope.commercialOpportunityId ||
    opportunity.organization_id !== scope.organizationId ||
    opportunity.store_id !== scope.storeId
  ) {
    fail("OPPORTUNITY_SCOPE_MISMATCH", "A oportunidade comercial esta fora do escopo autorizado.");
  }

  const templateResult = await args.supabase
    .from("store_contract_templates")
    .select("id, organization_id, store_id, status, active_version_id")
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.storeId)
    .maybeSingle<TemplateRow>();
  if (templateResult.error) {
    fail("DRAFT_SOURCE_READ_FAILED", "Nao foi possivel validar o modelo contratual.");
  }
  const template = templateResult.data;
  if (
    !template ||
    template.organization_id !== scope.organizationId ||
    template.store_id !== scope.storeId ||
    template.status !== "active" ||
    template.active_version_id !== scope.templateVersionId
  ) {
    fail("CONTRACT_TEMPLATE_NOT_AUTHORIZED", "O modelo contratual nao possui autoridade ativa para esta operacao.");
  }

  const versionResult = await args.supabase
    .from("store_contract_template_versions")
    .select("id, template_id, organization_id, store_id, status")
    .eq("id", scope.templateVersionId)
    .eq("template_id", template.id)
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.storeId)
    .maybeSingle<TemplateVersionRow>();
  if (versionResult.error) {
    fail("DRAFT_SOURCE_READ_FAILED", "Nao foi possivel validar a versao do modelo contratual.");
  }
  const version = versionResult.data;
  if (
    !version ||
    version.id !== scope.templateVersionId ||
    version.template_id !== template.id ||
    version.organization_id !== scope.organizationId ||
    version.store_id !== scope.storeId ||
    version.status !== "active"
  ) {
    fail("CONTRACT_TEMPLATE_VERSION_NOT_AUTHORIZED", "A versao do modelo nao possui autoridade ativa para esta operacao.");
  }

  const draftResult = await args.supabase
    .from("sales_contract_text_drafts")
    .select("id, organization_id, store_id, commercial_opportunity_id, template_version_id, draft_text, revision")
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.storeId)
    .eq("commercial_opportunity_id", scope.commercialOpportunityId)
    .eq("template_version_id", scope.templateVersionId)
    .maybeSingle<DraftRow>();
  if (draftResult.error) {
    fail("DRAFT_SOURCE_READ_FAILED", "Nao foi possivel carregar o rascunho contratual.");
  }
  const draft = draftResult.data;
  if (!draft) fail("DRAFT_NOT_FOUND", "Nao existe rascunho para o escopo solicitado.");
  if (
    draft.organization_id !== scope.organizationId ||
    draft.store_id !== scope.storeId ||
    draft.commercial_opportunity_id !== scope.commercialOpportunityId ||
    draft.template_version_id !== scope.templateVersionId
  ) {
    fail("DRAFT_SCOPE_MISMATCH", "O rascunho esta vinculado a um escopo diferente.");
  }
  if (draft.revision !== scope.revision) {
    fail("DRAFT_REVISION_MISMATCH", "A revisao solicitada nao corresponde a revisao persistida.");
  }
  if (
    typeof draft.draft_text !== "string" ||
    draft.draft_text.trim().length === 0 ||
    draft.draft_text.length > MAX_CONTRACT_TEXT_DRAFT_CHARS
  ) {
    fail("DRAFT_TEXT_INVALID", "O texto persistido do rascunho esta vazio ou excede o limite permitido.");
  }

  return {
    draftId: draft.id,
    organizationId: draft.organization_id,
    storeId: draft.store_id,
    commercialOpportunityId: draft.commercial_opportunity_id,
    templateVersionId: draft.template_version_id,
    revision: draft.revision,
    text: draft.draft_text,
    sha256: hashPersistedText(draft.draft_text),
  };
}

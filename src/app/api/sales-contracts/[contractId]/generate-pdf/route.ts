import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { loadStoreBrandVisualPolicy } from "@/lib/server/store-brand-visual-policy";
import { buildContractPdf, loadStoreLogoForContractPdf } from "@/lib/server/sales-contracts/build-contract-pdf";
import {
  buildCanonicalContractRendererInput,
  buildContractSnapshotV2,
  computeContractContentFingerprint,
} from "@/lib/server/sales-contracts/canonical-contract-renderer";
import {
  ContractAccessError,
  resolveExistingContractForAuthorizedStoreScope,
  type ContractAuthorizedStoreScope,
} from "@/lib/server/sales-contracts/contract-auth";
import { registerContractBusinessEvent } from "@/lib/server/sales-contracts/contract-events";
import { storeContractPdfFile } from "@/lib/server/sales-contracts/contract-storage";
import {
  readContractTextDraftSource,
  type ContractTextDraftSource,
} from "@/lib/server/sales-contracts/contract-text-draft-source";
import { renderContractTextDraftVersion } from "@/lib/server/sales-contracts/render-contract-text-draft-version";
import { buildContractTextDraftCanonicalSnapshot } from "@/lib/server/sales-contracts/contract-text-draft-canonical-snapshot";
import { pushAssistantDocumentReviewMessage } from "@/lib/server/assistant/document-review-messages";
import {
  type ContractQuoteSnapshotItem,
  createSalesContractVersionBySystem,
  markContractPendingReview,
  reconcileSupersededContractVersion,
} from "@/lib/server/sales-contracts/contract-versioning";
import { resolveContractTemplateTerms } from "@/lib/server/sales-contracts/contract-template-terms";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NON_EDITABLE_CONTRACT_STATUSES = new Set([
  "sent_to_customer",
  "customer_signed",
  "store_signed",
  "completed",
  "cancelled",
  "expired",
  "failed",
]);
const PDF_REGENERATION_BLOCKED_MESSAGE =
  "Este contrato ja foi enviado ou assinado e nao pode ter o PDF regenerado. Para alterar, crie um novo contrato ou cancele o contrato atual conforme o fluxo permitido.";

type GenerateContractPdfDeps = {
  buildContractPdf: typeof buildContractPdf;
  createSalesContractVersionBySystem: typeof createSalesContractVersionBySystem;
  loadStoreBrandVisualPolicy: typeof loadStoreBrandVisualPolicy;
  loadStoreLogoForContractPdf: typeof loadStoreLogoForContractPdf;
  markContractPendingReview: typeof markContractPendingReview;
  pushAssistantDocumentReviewMessage: typeof pushAssistantDocumentReviewMessage;
  registerContractBusinessEvent: typeof registerContractBusinessEvent;
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  resolveContract: typeof resolveExistingContractForAuthorizedStoreScope;
  resolveContractTemplateTerms: typeof resolveContractTemplateTerms;
  reconcileSupersededContractVersion: typeof reconcileSupersededContractVersion;
  storeContractPdfFile: typeof storeContractPdfFile;
  createSalesContractTextVersionBySystem: typeof createTextSalesContractVersionBySystem;
  readContractTextDraftSource: typeof readContractTextDraftSource;
  renderContractTextDraftVersion: typeof renderContractTextDraftVersion;
  buildContractTextDraftCanonicalSnapshot: typeof buildContractTextDraftCanonicalSnapshot;
};

const defaultGenerateContractPdfDeps: GenerateContractPdfDeps = {
  buildContractPdf,
  createSalesContractVersionBySystem,
  loadStoreBrandVisualPolicy,
  loadStoreLogoForContractPdf,
  markContractPendingReview,
  pushAssistantDocumentReviewMessage,
  registerContractBusinessEvent,
  resolveAccess: resolveStoreApiAccess,
  resolveContract: resolveExistingContractForAuthorizedStoreScope,
  resolveContractTemplateTerms,
  reconcileSupersededContractVersion,
  storeContractPdfFile,
  createSalesContractTextVersionBySystem: createTextSalesContractVersionBySystem,
  readContractTextDraftSource,
  renderContractTextDraftVersion,
  buildContractTextDraftCanonicalSnapshot,
};

function buildErrorResponse(error: unknown) {
  if (error instanceof ContractTextVersionError) {
    return NextResponse.json(
      { ok: false, error: error.code, message: error.message },
      { status: error.status },
    );
  }
  if (error instanceof ContractAccessError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        message: error.message,
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: "UNEXPECTED_ERROR",
      message:
        error instanceof Error ? error.message : "Erro inesperado ao gerar PDF do contrato.",
    },
    { status: 500 }
  );
}

export class ContractTextVersionError extends Error {
  readonly name = "ContractTextVersionError";

  constructor(
    readonly status: 409 | 500 | 503,
    readonly code: string,
    message: string,
    readonly authorityOutcome: "pre_rpc" | "uncertain" = "pre_rpc",
  ) {
    super(message);
  }
}

const TEXT_VERSION_CONFLICTS: Record<string, string> = {
  P9_TEXT_VERSION_INVALID_ARGUMENTS: "Os argumentos da versao textual sao invalidos.",
  P9_TEXT_VERSION_OPPORTUNITY_INVALID: "A oportunidade comercial nao pertence ao escopo autorizado.",
  P9_TEXT_VERSION_CONTRACT_INVALID: "O contrato nao pertence ao escopo autorizado.",
  P9_TEXT_VERSION_CONTRACT_LINEAGE_INVALID: "A lineage comercial do contrato e invalida.",
  P9_TEXT_VERSION_CONTRACT_STATUS_BLOCKED: "O estado atual do contrato bloqueia esta geracao.",
  P9_TEXT_VERSION_APPROVAL_AUDIT_INVALID: "A auditoria de aprovacao do contrato e invalida.",
  P9_TEXT_VERSION_DRAFT_NOT_FOUND: "A revisao textual persistida nao foi encontrada.",
  P9_TEXT_VERSION_DRAFT_REVISION_CHANGED: "A revisao textual persistida mudou antes da materializacao.",
  P9_TEXT_VERSION_DRAFT_TEXT_INVALID: "O texto persistido do contrato e invalido.",
  P9_TEXT_VERSION_DRAFT_SHA256_CHANGED: "O hash do texto persistido nao confere.",
  P9_TEXT_VERSION_TEMPLATE_INACTIVE: "O template do contrato nao esta ativo.",
  P9_TEXT_VERSION_TEMPLATE_VERSION_INACTIVE: "A versao do template nao esta ativa.",
  P9_TEXT_VERSION_PROVENANCE_INVALID: "A proveniencia textual do contrato e invalida.",
  P9_TEXT_VERSION_CURRENT_VERSION_CHANGED: "O contrato foi alterado por outra operacao.",
  P9_TEXT_VERSION_REOPEN_REQUIRES_HUMAN_ACTION: "Acao humana explicita obrigatoria para reabrir contrato aprovado.",
  P9_TEXT_VERSION_WRITER_RETURNED_NO_VERSION: "A autoridade textual nao materializou uma versao.",
  P9_TEXT_VERSION_REVIEW_RESET_FAILED: "Nao foi possivel atualizar a revisao do contrato.",
  P9_TEXT_VERSION_UNAUTHORIZED: "A autoridade textual recusou esta operacao.",
};

function textVersionRpcError(error: { message?: unknown }) {
  const message = String(error?.message || "");
  const code = Object.keys(TEXT_VERSION_CONFLICTS).find((candidate) => message.includes(candidate));
  if (code) {
    return new ContractTextVersionError(409, code, TEXT_VERSION_CONFLICTS[code]);
  }
  return new ContractTextVersionError(
    500,
    "CONTRACT_TEXT_VERSION_FAILED",
    "Nao foi possivel materializar a versao textual do contrato.",
  );
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function isResponsibleTextDraftContract(contract: {
  quote_id?: string | null;
  quote_version_id?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const metadata = isRecord(contract.metadata) ? contract.metadata : null;
  return (
    metadata?.source === "responsible_text_draft" &&
    metadata?.created_via === "create_sales_contract_manual_by_system"
  );
}

function assertManualContractOrigin(contract: {
  quote_id?: string | null;
  quote_version_id?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const metadata = isRecord(contract.metadata) ? contract.metadata : null;
  const opportunityId = normalizeOptionalText(metadata?.commercial_opportunity_id);

  if (
    !isResponsibleTextDraftContract(contract) ||
    normalizeOptionalText(contract.quote_id) ||
    normalizeOptionalText(contract.quote_version_id) ||
    !opportunityId ||
    metadata?.commercial_amounts_authoritative !== false ||
    !normalizeOptionalText(metadata?.draft_id) ||
    !normalizeOptionalText(metadata?.template_version_id) ||
    !Number.isSafeInteger(Number(metadata?.creation_draft_revision)) ||
    Number(metadata?.creation_draft_revision) < 1 ||
    !/^[0-9a-f]{64}$/.test(String(metadata?.creation_draft_sha256 || ""))
  ) {
    throw new ContractAccessError(
      409,
      "CONTRACT_MANUAL_ORIGIN_INVALID",
      "A origem manual do contrato nao possui metadados canonicos validos.",
    );
  }

  return opportunityId;
}

function assertManualContractDraftMetadata(
  contract: { metadata?: Record<string, unknown> | null },
  draft: ContractTextDraftSource,
  templateVersionId: string,
) {
  const metadata = isRecord(contract.metadata) ? contract.metadata : null;
  if (
    String(metadata?.commercial_opportunity_id || "") !== draft.commercialOpportunityId ||
    String(metadata?.draft_id || "") !== draft.draftId ||
    String(metadata?.template_version_id || "") !== templateVersionId ||
    String(metadata?.creation_draft_revision || "") !== String(draft.revision) ||
    String(metadata?.creation_draft_sha256 || "") !== draft.sha256
  ) {
    throw new ContractAccessError(
      409,
      "CONTRACT_MANUAL_ORIGIN_INVALID",
      "A origem manual do contrato nao corresponde a revisao textual persistida.",
    );
  }
}

function resolveOperationId(headerValue: string | null) {
  const operationId = String(headerValue || "").trim();
  if (!operationId) return randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    throw new ContractAccessError(
      409,
      "CONTRACT_OPERATION_ID_INVALID",
      "O identificador da operacao de geracao do contrato e invalido.",
    );
  }
  return operationId.toLowerCase();
}

function buildRequestFingerprint(args: {
  organizationId: string;
  storeId: string;
  contractId: string;
  rendererInput: ReturnType<typeof buildCanonicalContractRendererInput>;
  contentFingerprint: string;
  mode?: "canonical" | "saved_text_draft";
  draftId?: string | null;
  draftRevision?: number | null;
}) {
  const orderedRequest = [
    "zion.contract-pdf.request.v1",
    args.organizationId,
    args.storeId,
    args.contractId,
    args.rendererInput.identity.quoteId,
    args.rendererInput.identity.quoteVersionId,
    args.rendererInput.templateAuthority.templateId,
    args.rendererInput.templateAuthority.templateVersionId,
    args.contentFingerprint,
    args.mode ?? "canonical",
    args.draftId ?? null,
    args.draftRevision ?? null,
  ];
  return createHash("sha256")
    .update(JSON.stringify(orderedRequest))
    .digest("hex");
}

type TextVersionWriterResult = Awaited<ReturnType<typeof createSalesContractVersionBySystem>>;

async function createTextSalesContractVersionBySystem(args: {
  supabase: Parameters<typeof createSalesContractVersionBySystem>[0]["supabase"];
  organizationId: string;
  storeId: string;
  contractId: string;
  commercialOpportunityId: string;
  templateVersionId: string;
  draftId: string;
  draftRevision: number;
  draftSha256: string;
  expectedCurrentVersionId: string | null;
  operationKey: string;
  requestFingerprint: string;
  contentFingerprint: string;
  storeFileId: string;
  storageBucket: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  pdfSha256: string;
  contractSnapshot: Record<string, unknown>;
  allowReopenApproved: boolean;
  onAuthorityResolved?: (result: { versionId: string; replayed: boolean }) => void;
  onAuthorityUncertain?: () => void;
}): Promise<TextVersionWriterResult> {
  let rpcResult: Awaited<ReturnType<typeof args.supabase.rpc>>;
  try {
    rpcResult = await args.supabase.rpc(
      "create_sales_contract_text_version_by_system",
      {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_contract_id: args.contractId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
      p_template_version_id: args.templateVersionId,
      p_draft_id: args.draftId,
      p_draft_revision: args.draftRevision,
      p_draft_sha256: args.draftSha256,
      p_expected_current_version_id: args.expectedCurrentVersionId,
      p_operation_key: args.operationKey,
      p_request_fingerprint: args.requestFingerprint,
      p_content_fingerprint: args.contentFingerprint,
      p_store_file_id: args.storeFileId,
      p_storage_bucket: args.storageBucket,
      p_storage_path: args.storagePath,
      p_original_filename: args.originalFilename,
      p_mime_type: args.mimeType,
      p_size_bytes: args.sizeBytes,
      p_pdf_sha256: args.pdfSha256,
      p_contract_snapshot: args.contractSnapshot,
      p_allow_reopen_approved: args.allowReopenApproved,
      },
    );
  } catch {
    args.onAuthorityUncertain?.();
    throw new ContractTextVersionError(
      503,
      "CONTRACT_TEXT_VERSION_AUTHORITY_UNCERTAIN",
      "A autoridade textual nao confirmou o resultado; o arquivo foi preservado para reconciliacao.",
      "uncertain",
    );
  }
  const { data, error } = rpcResult;
  if (error) throw textVersionRpcError(error);
  const row = Array.isArray(data) ? data.length === 1 ? data[0] : null : data;
  if (!row || typeof row.id !== "string" || row.contract_id !== args.contractId ||
      row.organization_id !== args.organizationId || row.store_id !== args.storeId ||
      !Number.isInteger(Number(row.version_number)) || Number(row.version_number) < 1 ||
      typeof row.status !== "string" || typeof row.replayed !== "boolean") {
    args.onAuthorityUncertain?.();
    throw new ContractTextVersionError(
      503,
      "CONTRACT_TEXT_VERSION_AUTHORITY_UNCERTAIN",
      "A autoridade textual nao confirmou uma resposta reconciliavel; o arquivo foi preservado.",
      "uncertain",
    );
  }
  args.onAuthorityResolved?.({ versionId: row.id, replayed: row.replayed });
  const { data: version, error: versionError } = await args.supabase
    .from("sales_contract_versions")
    .select("*")
    .eq("id", row.id)
    .eq("contract_id", args.contractId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();
  if (versionError || !version?.id || Number(version.version_number) !== Number(row.version_number)) {
    throw new ContractTextVersionError(
      503,
      "CONTRACT_TEXT_VERSION_RECONCILIATION_REQUIRED",
      "A versao textual foi materializada, mas nao pode ser reconciliada com seguranca.",
    );
  }
  return { version: version as TextVersionWriterResult["version"], replayed: row.replayed };
}

function isSavedTextDraftRequest(value: unknown): value is {
  mode: "saved_text_draft";
  expectedDraftRevision: number;
  humanAction?: "reopen_approved_contract";
} {
  if (!isRecord(value) || value.mode !== "saved_text_draft") return false;
  return typeof value.expectedDraftRevision === "number" &&
    Number.isSafeInteger(value.expectedDraftRevision) && value.expectedDraftRevision >= 1 &&
    (value.humanAction == null || value.humanAction === "reopen_approved_contract");
}

async function readGenerationRequest(request: Request) {
  const raw = await request.text();
  if (!raw.trim()) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.mode !== "saved_text_draft") return null;
  if (!isSavedTextDraftRequest(parsed)) {
    throw new ContractAccessError(400, "CONTRACT_TEXT_DRAFT_REQUEST_INVALID", "A geracao textual exige mode saved_text_draft e expectedDraftRevision valido.");
  }
  return parsed;
}

function buildDurableStoreFile(version: Awaited<ReturnType<typeof createSalesContractVersionBySystem>>["version"]) {
  if (
    !version.store_file_id ||
    !version.storage_bucket ||
    !version.storage_path ||
    !version.original_filename ||
    version.size_bytes == null
  ) {
    throw new Error("A versao canonica nao possui identidade completa de storage.");
  }
  return {
    storeFileId: version.store_file_id,
    storageBucket: version.storage_bucket,
    storagePath: version.storage_path,
    originalFilename: version.original_filename,
    sizeBytes: version.size_bytes,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown, fieldName: string) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  throw new ContractAccessError(
    409,
    "CONTRACT_QUOTE_SNAPSHOT_INVALID",
    `quote_snapshot.items possui ${fieldName} invalido.`
  );
}

function nullableNumber(value: unknown, fieldName: string) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new ContractAccessError(
    409,
    "CONTRACT_QUOTE_SNAPSHOT_INVALID",
    `quote_snapshot.items possui ${fieldName} invalido.`
  );
}

function nullableMetadata(value: unknown) {
  if (value == null) return null;
  if (isRecord(value)) return value;
  throw new ContractAccessError(
    409,
    "CONTRACT_QUOTE_SNAPSHOT_INVALID",
    "quote_snapshot.items possui metadata invalido."
  );
}

function normalizeQuoteSnapshotItems(items: unknown): ContractQuoteSnapshotItem[] {
  if (!Array.isArray(items)) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_SNAPSHOT_ITEMS_INVALID",
      "quote_snapshot.items precisa ser um array."
    );
  }

  return items.map((item, index) => {
    if (!isRecord(item)) {
      throw new ContractAccessError(
        409,
        "CONTRACT_QUOTE_SNAPSHOT_INVALID",
        `quote_snapshot.items[${index}] precisa ser um objeto.`
      );
    }

    return {
      id: nullableString(item.id, "id"),
      name: nullableString(item.name, "name"),
      description: nullableString(item.description, "description"),
      quantity: nullableNumber(item.quantity, "quantity"),
      unitPriceCents: nullableNumber(item.unitPriceCents, "unitPriceCents"),
      discountCents: nullableNumber(item.discountCents, "discountCents"),
      subtotalCents: nullableNumber(item.subtotalCents, "subtotalCents"),
      totalCents: nullableNumber(item.totalCents, "totalCents"),
      sku: nullableString(item.sku, "sku"),
      sortOrder: nullableNumber(item.sortOrder, "sortOrder"),
      metadata: nullableMetadata(item.metadata),
    };
  });
}

async function loadContractQuoteSnapshotItems(
  scope: Awaited<ReturnType<typeof resolveExistingContractForAuthorizedStoreScope>>,
  canonicalScope: { organizationId: string; storeId: string },
) {
  const quoteId = normalizeOptionalText(scope.contract.quote_id);
  const quoteVersionId = normalizeOptionalText(scope.contract.quote_version_id);

  if (!quoteId) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_ID_REQUIRED_FOR_PDF",
      "Contrato sem quote_id nao pode gerar PDF com lineage comprovada."
    );
  }

  if (!quoteVersionId) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_VERSION_ID_REQUIRED_FOR_PDF",
      "Contrato sem quote_version_id nao pode gerar PDF com lineage comprovada."
    );
  }

  const { data: quoteVersion, error: quoteVersionError } = await scope.supabase
    .from("sales_quote_versions")
    .select("id, quote_id, organization_id, store_id, status, sent_at, quote_snapshot")
    .eq("id", quoteVersionId)
    .eq("quote_id", quoteId)
    .eq("organization_id", canonicalScope.organizationId)
    .eq("store_id", canonicalScope.storeId)
    .maybeSingle();

  if (quoteVersionError) {
    throw new Error(
      `Falha ao carregar versao exata do orcamento do contrato: ${quoteVersionError.message}`
    );
  }

  if (!quoteVersion) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_VERSION_NOT_FOUND",
      "Versao exata do orcamento do contrato nao encontrada."
    );
  }

  if (
    quoteVersion.id !== quoteVersionId ||
    quoteVersion.quote_id !== quoteId ||
    quoteVersion.organization_id !== canonicalScope.organizationId ||
    quoteVersion.store_id !== canonicalScope.storeId
  ) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_VERSION_LINEAGE_MISMATCH",
      "Versao do orcamento nao corresponde a lineage do contrato."
    );
  }

  const normalizedStatus = String(quoteVersion.status || "").trim().toLowerCase();
  if (normalizedStatus !== "sent" && normalizedStatus !== "superseded") {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_VERSION_STATUS_INVALID",
      "Versao do orcamento precisa estar sent ou superseded para gerar PDF do contrato."
    );
  }

  if (!normalizeOptionalText(quoteVersion.sent_at)) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_VERSION_SENT_AT_REQUIRED",
      "Versao do orcamento precisa ter sent_at para gerar PDF do contrato."
    );
  }

  const quoteSnapshot = quoteVersion.quote_snapshot;
  if (!isRecord(quoteSnapshot)) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_SNAPSHOT_INVALID",
      "quote_snapshot da versao do orcamento precisa ser um objeto."
    );
  }

  if (!isRecord(quoteSnapshot.quote)) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_SNAPSHOT_INVALID",
      "quote_snapshot.quote precisa ser um objeto."
    );
  }

  if (String(quoteSnapshot.quote.id || "").trim() !== quoteId) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_SNAPSHOT_LINEAGE_MISMATCH",
      "quote_snapshot.quote.id nao corresponde ao quote_id do contrato."
    );
  }

  return {
    quoteSnapshot,
    items: normalizeQuoteSnapshotItems(quoteSnapshot.items),
  };
}

export function createGenerateContractPdfPostHandler(
  deps: Partial<GenerateContractPdfDeps> = {},
) {
  const buildContractPdf =
    deps.buildContractPdf ?? defaultGenerateContractPdfDeps.buildContractPdf;
  const createCanonicalVersion =
    deps.createSalesContractVersionBySystem ??
    defaultGenerateContractPdfDeps.createSalesContractVersionBySystem;
  const loadStoreBrandVisualPolicy =
    deps.loadStoreBrandVisualPolicy ??
    defaultGenerateContractPdfDeps.loadStoreBrandVisualPolicy;
  const loadStoreLogoForContractPdf =
    deps.loadStoreLogoForContractPdf ??
    defaultGenerateContractPdfDeps.loadStoreLogoForContractPdf;
  const markContractPendingReview =
    deps.markContractPendingReview ??
    defaultGenerateContractPdfDeps.markContractPendingReview;
  const pushDocumentReviewMessage =
    deps.pushAssistantDocumentReviewMessage ??
    defaultGenerateContractPdfDeps.pushAssistantDocumentReviewMessage;
  const registerBusinessEvent =
    deps.registerContractBusinessEvent ??
    defaultGenerateContractPdfDeps.registerContractBusinessEvent;
  const resolveAccess = deps.resolveAccess ?? defaultGenerateContractPdfDeps.resolveAccess;
  const resolveContract = deps.resolveContract ?? defaultGenerateContractPdfDeps.resolveContract;
  const resolveTemplateTerms =
    deps.resolveContractTemplateTerms ??
    defaultGenerateContractPdfDeps.resolveContractTemplateTerms;
  const reconcilePreviousVersion =
    deps.reconcileSupersededContractVersion ??
    defaultGenerateContractPdfDeps.reconcileSupersededContractVersion;
  const storeContractPdfFile =
    deps.storeContractPdfFile ?? defaultGenerateContractPdfDeps.storeContractPdfFile;
  const createTextVersion =
    deps.createSalesContractTextVersionBySystem ??
    defaultGenerateContractPdfDeps.createSalesContractTextVersionBySystem;
  const readTextDraft =
    deps.readContractTextDraftSource ?? defaultGenerateContractPdfDeps.readContractTextDraftSource;
  const renderTextDraft =
    deps.renderContractTextDraftVersion ?? defaultGenerateContractPdfDeps.renderContractTextDraftVersion;
  const buildTextSnapshot =
    deps.buildContractTextDraftCanonicalSnapshot ??
    defaultGenerateContractPdfDeps.buildContractTextDraftCanonicalSnapshot;

  return async function POST(
    request: Request,
    context: { params: Promise<{ contractId: string }> }
  ) {
  let scope:
    | Awaited<ReturnType<typeof resolveExistingContractForAuthorizedStoreScope>>
    | null = null;
  let canonicalOrganizationId: string | null = null;
  let canonicalStoreId: string | null = null;
  let authorityState: "unconfirmed" | "uncertain" | "committed_new" | "committed_replay" =
    "unconfirmed";
  let isTextDraftGeneration = false;
  let storeFileToRollback:
    | {
        storeFileId: string;
        storageBucket: string;
        storagePath: string;
      }
    | null = null;

  try {
    const access = await resolveAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);
    canonicalOrganizationId = access.organizationId;
    canonicalStoreId = access.storeId;

    const { contractId: rawContractId } = await context.params;
    const contractId = String(rawContractId || "").trim();
    const authorizedScope: ContractAuthorizedStoreScope = {
      organizationId: access.organizationId,
      storeId: access.storeId,
      sessionUserId: access.sessionUserId,
    };
    scope = await resolveContract(contractId, authorizedScope);

    if (
      scope.organizationId !== access.organizationId ||
      scope.store.id !== access.storeId ||
      scope.store.organization_id !== access.organizationId ||
      scope.contract.organization_id !== access.organizationId ||
      scope.contract.store_id !== access.storeId
    ) {
      throw new ContractAccessError(
        403,
        "CONTRACT_SCOPE_MISMATCH",
        "O contrato retornado esta fora do escopo canonico autorizado.",
      );
    }

    const normalizedStatus = String(scope.contract.status || "").trim().toLowerCase();
    const generationRequest = await readGenerationRequest(request);
    isTextDraftGeneration = generationRequest?.mode === "saved_text_draft";
    const isManualContract = isResponsibleTextDraftContract(scope.contract);
    if (isManualContract && !isTextDraftGeneration) {
      throw new ContractAccessError(
        409,
        "CONTRACT_MANUAL_REQUIRES_SAVED_TEXT_DRAFT",
        "Contrato manual exige a revisao textual persistida para preparacao.",
      );
    }
    const allowReopenApproved =
      isTextDraftGeneration &&
      normalizedStatus === "approved" &&
      generationRequest?.humanAction === "reopen_approved_contract";
    const sentAt = normalizeOptionalText(scope.contract.sent_at);
    const customerSignedAt = normalizeOptionalText(scope.contract.customer_signed_at);
    const storeSignedAt = normalizeOptionalText(scope.contract.store_signed_at);
    const completedAt = normalizeOptionalText(scope.contract.completed_at);

    if (
      NON_EDITABLE_CONTRACT_STATUSES.has(normalizedStatus) ||
      sentAt ||
      customerSignedAt ||
      storeSignedAt ||
      completedAt
    ) {
      throw new ContractAccessError(
        409,
        "CONTRACT_STATUS_NOT_GENERATABLE",
        PDF_REGENERATION_BLOCKED_MESSAGE
      );
    }

    const manualOpportunityId = isManualContract
      ? assertManualContractOrigin(scope.contract)
      : null;
    const { quoteSnapshot, items } = isManualContract
      ? { quoteSnapshot: { quote: {} }, items: [] as ContractQuoteSnapshotItem[] }
      : await loadContractQuoteSnapshotItems(scope, {
          organizationId: access.organizationId,
          storeId: access.storeId,
        });
    const operationId = resolveOperationId(
      request.headers.get("x-zion-contract-operation-id"),
    );
    const operationKey = `p9:contract-pdf:${scope.contract.id}:${operationId}`;
    if (operationKey.length > 200) {
      throw new ContractAccessError(
        409,
        "CONTRACT_OPERATION_KEY_INVALID",
        "A chave da operacao de geracao do contrato e invalida.",
      );
    }

    const templateTerms = await resolveTemplateTerms({
      supabase: scope.supabase,
      organizationId: access.organizationId,
      storeId: access.storeId,
    });

    if (
      !templateTerms.contractTemplateUsed ||
      !templateTerms.templateId ||
      !templateTerms.templateVersionId ||
      !templateTerms.generatedContractTerms
    ) {
      throw new ContractAccessError(
        409,
        "CONTRACT_TEMPLATE_AUTHORITY_REQUIRED",
        templateTerms.warning ||
          "Template ativo e regras finais sao obrigatorios para gerar uma versao canonica do contrato."
      );
    }

    const brandVisualPolicy = await loadStoreBrandVisualPolicy({
      supabase: access.supabase,
      organizationId: access.organizationId,
      storeId: access.storeId,
    });

    const storeLogo =
      !brandVisualPolicy.configured || brandVisualPolicy.useLogoOnContracts === true
        ? await loadStoreLogoForContractPdf({
            supabase: scope.supabase,
            organizationId: access.organizationId,
            storeId: access.storeId,
          })
        : null;

    const rendererInput = buildCanonicalContractRendererInput({
      contract: scope.contract,
      store: scope.store,
      lead: scope.lead,
      quoteSnapshot,
      items,
      templateTerms,
      brandVisual: brandVisualPolicy.configured
        ? {
            primaryColor: brandVisualPolicy.primaryColor,
            secondaryColor: brandVisualPolicy.secondaryColor,
            documentFooter: brandVisualPolicy.documentFooter,
          }
        : null,
      logo: storeLogo,
    });
    let textSource: ContractTextDraftSource | null = null;
    let renderedTextDraft: Awaited<ReturnType<typeof renderContractTextDraftVersion>> | null = null;
    let contentFingerprint = computeContractContentFingerprint(rendererInput);
    let snapshot = buildContractSnapshotV2({
      input: rendererInput,
      contentFingerprint,
      materializedAt: new Date().toISOString(),
      ...(isManualContract
        ? {
            origin: {
              source: "responsible_text_draft" as const,
              commercialAmountsAuthoritative: false as const,
            },
          }
        : {}),
    });
    if (generationRequest?.mode === "saved_text_draft") {
      const commercialOpportunityId = manualOpportunityId || normalizeOptionalText(
        isRecord(scope.contract.metadata) ? scope.contract.metadata.commercial_opportunity_id : null,
      );
      if (!commercialOpportunityId) {
        throw new ContractAccessError(
          409,
          "CONTRACT_COMMERCIAL_OPPORTUNITY_REQUIRED",
          "Contrato sem oportunidade comercial canonica para geracao textual.",
        );
      }
      textSource = await readTextDraft({
        supabase: scope.supabase,
        authorizedScope: {
          organizationId: access.organizationId,
          storeId: access.storeId,
          commercialOpportunityId,
          templateVersionId: templateTerms.templateVersionId,
          revision: generationRequest.expectedDraftRevision,
        },
      });
      if (isManualContract) {
        assertManualContractDraftMetadata(
          scope.contract,
          textSource,
          templateTerms.templateVersionId,
        );
      }
      renderedTextDraft = await renderTextDraft(textSource);
      const textSnapshot = buildTextSnapshot({
        snapshot,
        provenance: renderedTextDraft.provenance,
      });
      contentFingerprint = textSnapshot.contentFingerprint;
      snapshot = textSnapshot.snapshot;
    }

    const requestFingerprint = buildRequestFingerprint({
      organizationId: access.organizationId,
      storeId: access.storeId,
      contractId: scope.contract.id,
      rendererInput,
      contentFingerprint,
      mode: isTextDraftGeneration ? "saved_text_draft" : "canonical",
      draftId: textSource?.draftId,
      draftRevision: textSource?.revision,
    });

    const pdfBytes = renderedTextDraft?.pdfBytes ?? await buildContractPdf(rendererInput);
    const pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");

    const storedFile = await storeContractPdfFile({
      supabase: scope.supabase,
      organizationId: access.organizationId,
      storeId: access.storeId,
      contractId: scope.contract.id,
      contractNumber: scope.contract.contract_number,
      contentFingerprint,
      pdfBytes,
    });

    storeFileToRollback = {
      storeFileId: storedFile.storeFileId,
      storageBucket: storedFile.storageBucket,
      storagePath: storedFile.storagePath,
    };

    const canonicalResult = isTextDraftGeneration && textSource && renderedTextDraft
      ? await createTextVersion({
      supabase: scope.supabase,
      organizationId: access.organizationId,
      storeId: access.storeId,
      contractId: scope.contract.id,
      commercialOpportunityId: textSource.commercialOpportunityId,
      templateVersionId: textSource.templateVersionId,
      draftId: textSource.draftId,
      draftRevision: textSource.revision,
      draftSha256: textSource.sha256,
      expectedCurrentVersionId: scope.contract.current_version_id || null,
      operationKey: `p9:contract-text-pdf:${scope.contract.id}:${operationId}`,
      requestFingerprint,
      contentFingerprint,
      storeFileId: storedFile.storeFileId,
      storageBucket: storedFile.storageBucket,
      storagePath: storedFile.storagePath,
      originalFilename: storedFile.originalFilename,
      mimeType: "application/pdf",
      sizeBytes: storedFile.sizeBytes,
      pdfSha256,
      contractSnapshot: snapshot as Record<string, unknown>,
      allowReopenApproved,
      onAuthorityResolved: ({ replayed }) => {
        authorityState = replayed ? "committed_replay" : "committed_new";
      },
      onAuthorityUncertain: () => {
        authorityState = "uncertain";
      },
    })
      : await createCanonicalVersion({
      supabase: scope.supabase,
      organizationId: access.organizationId,
      storeId: access.storeId,
      contractId: scope.contract.id,
      operationKey,
      requestFingerprint,
      contentFingerprint,
      storeFileId: storedFile.storeFileId,
      storageBucket: storedFile.storageBucket,
      storagePath: storedFile.storagePath,
      originalFilename: storedFile.originalFilename,
      mimeType: "application/pdf",
      sizeBytes: storedFile.sizeBytes,
      pdfSha256,
      contractSnapshot: snapshot as Record<string, unknown>,
      onAuthorityResolved: ({ replayed }) => {
        authorityState = replayed ? "committed_replay" : "committed_new";
      },
    });
    const version = canonicalResult.version;
    const durableStoreFile = buildDurableStoreFile(version);

    const temporaryArtifactIsDurable =
      durableStoreFile.storeFileId === storedFile.storeFileId ||
      (durableStoreFile.storageBucket === storedFile.storageBucket &&
        durableStoreFile.storagePath === storedFile.storagePath);
    if (canonicalResult.replayed && !temporaryArtifactIsDurable) {
      try {
        await scope.supabase.storage
          .from(storedFile.storageBucket)
          .remove([storedFile.storagePath]);
        await scope.supabase
          .from("store_files")
          .delete()
          .eq("id", storedFile.storeFileId)
          .eq("organization_id", access.organizationId)
          .eq("store_id", access.storeId);
      } catch {
        // best effort: the canonical replay artifact remains authoritative
      }
    }
    storeFileToRollback = null;

    if (canonicalResult.replayed && isTextDraftGeneration) {
      const { data: currentContract, error: currentContractError } = await scope.supabase
        .from("sales_contracts")
        .select("*")
        .eq("id", scope.contract.id)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle();
      if (currentContractError || !currentContract?.id) {
        throw new ContractTextVersionError(
          503,
          "CONTRACT_TEXT_VERSION_RECONCILIATION_REQUIRED",
          "O replay foi confirmado, mas o estado atual do contrato nao pode ser reconciliado.",
        );
      }
      storeFileToRollback = null;
      return NextResponse.json({
        ok: true,
        replayed: true,
        contract: {
          ...scope.contract,
          ...currentContract,
        },
        version,
        currentVersion: currentContract.current_version_id === version.id ? version : null,
        storeFile: durableStoreFile,
      });
    }

    if (!isTextDraftGeneration) {
      await reconcilePreviousVersion({
        supabase: scope.supabase,
        organizationId: access.organizationId,
        storeId: access.storeId,
        contractId: scope.contract.id,
        versionNumber: version.version_number,
      });
      await markContractPendingReview({
        supabase: scope.supabase,
        organizationId: access.organizationId,
        storeId: access.storeId,
        contractId: scope.contract.id,
        expectedCurrentVersionId: version.id,
      });
    }

    if (!canonicalResult.replayed && version.version_number === 1) {
      await registerBusinessEvent({
        supabase: scope.supabase,
        organizationId: access.organizationId,
        storeId: access.storeId,
        eventKey: "contrato_gerado",
        actorType: "human",
        leadId: scope.lead?.id || scope.contract.lead_id || null,
        conversationId: scope.conversation?.id || scope.contract.conversation_id || null,
        actorUserId: access.sessionUserId,
        eventPayload: {
          contract_id: scope.contract.id,
          contract_number: scope.contract.contract_number,
          version_id: version.id,
          version_number: version.version_number,
          stage: "first_pdf_generated",
        },
        });
    }

    try {
      await pushDocumentReviewMessage({
        supabase: scope.supabase,
        organizationId: access.organizationId,
        storeId: access.storeId,
        documentType: "contract",
        documentId: scope.contract.id,
        documentVersionId: version.id,
        documentNumber:
          String(scope.contract.contract_number || "").trim() || scope.contract.id,
        documentStatus: "pending_review",
        relatedQuoteId: scope.contract.quote_id || null,
        relatedContractId: scope.contract.id,
        relatedLeadId: scope.lead?.id || scope.contract.lead_id || null,
        relatedConversationId:
          scope.conversation?.id || scope.contract.conversation_id || null,
        customerName: scope.contract.customer_name || scope.lead?.name || null,
        customerPhone: scope.contract.customer_phone || scope.lead?.phone || null,
        originalFileName: durableStoreFile.originalFilename,
        fileKind: "sales_contract_pdf",
        mimeType: "application/pdf",
        storageBucket: durableStoreFile.storageBucket,
        storagePath: durableStoreFile.storagePath,
      });
    } catch (assistantMessageError) {
      console.warn(
        "[sales-contracts/generate-pdf] falha ao criar mensagem document_review da assistente:",
        assistantMessageError
      );
    }

    return NextResponse.json({
      ok: true,
      contract: {
        ...scope.contract,
        current_version_id: version.id,
        status: "pending_review",
      },
      version,
      storeFile: durableStoreFile,
    });
  } catch (error) {
    const shouldRollbackTemporaryArtifact =
      authorityState === "unconfirmed" ||
      (!isTextDraftGeneration && authorityState === "committed_replay");

    if (scope && storeFileToRollback && shouldRollbackTemporaryArtifact) {
      try {
        await scope.supabase.storage
          .from(storeFileToRollback.storageBucket)
          .remove([storeFileToRollback.storagePath]);
        await scope.supabase
          .from("store_files")
          .delete()
          .eq("id", storeFileToRollback.storeFileId)
          .eq("organization_id", canonicalOrganizationId)
          .eq("store_id", canonicalStoreId);
      } catch {
        // best effort
      }
    }

    return buildErrorResponse(error);
  }
  };
}

export const POST = createGenerateContractPdfPostHandler();

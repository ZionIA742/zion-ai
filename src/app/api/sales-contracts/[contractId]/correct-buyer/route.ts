import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  ContractAccessError,
  resolveExistingContractForAuthorizedStoreScope,
  type ContractAuthorizedStoreScope,
} from "@/lib/server/sales-contracts/contract-auth";
import { HistoricalContractTextError, prepareBuyerCorrectionVersion, readHistoricalContractText } from "@/lib/server/sales-contracts/buyer-correction-version";
import { storeContractPdfFile } from "@/lib/server/sales-contracts/contract-storage";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PERSONAL_FIELDS = ["name", "phone", "document", "email", "address"] as const;

type Buyer = Record<(typeof PERSONAL_FIELDS)[number], string | null>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorResponse(error: unknown) {
  if (error instanceof ContractAccessError) {
    return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof HistoricalContractTextError) {
    return NextResponse.json({ ok: false, error: `HISTORICAL_TEXT_${error.code}`, message: error.message }, { status: 409 });
  }
  return NextResponse.json(
    { ok: false, error: "BUYER_CORRECTION_FAILED", message: error instanceof Error ? error.message : "Nao foi possivel corrigir o contrato." },
    { status: 409 },
  );
}

function parseBuyer(value: unknown, fieldName: string): Buyer {
  if (!isRecord(value)) throw new ContractAccessError(400, "BUYER_DATA_INVALID", `${fieldName} invalido.`);
  const result = {} as Buyer;
  for (const field of PERSONAL_FIELDS) {
    const item = value[field];
    if (item !== undefined && item !== null && typeof item !== "string") {
      throw new ContractAccessError(400, "BUYER_DATA_INVALID", `${fieldName} invalido.`);
    }
    result[field] = item == null ? null : item;
  }
  return result;
}

async function readRequest(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { throw new ContractAccessError(400, "BUYER_CORRECTION_REQUEST_INVALID", "Dados da correcao invalidos."); }
  if (!isRecord(body)) throw new ContractAccessError(400, "BUYER_CORRECTION_REQUEST_INVALID", "Dados da correcao invalidos.");
  const expectedVersionId = String(body.expectedSentVersionId || "").trim().toLowerCase();
  if (!UUID.test(expectedVersionId)) throw new ContractAccessError(400, "EXPECTED_VERSION_INVALID", "A versao enviada esperada e invalida.");
  return {
    expectedVersionId,
    previousBuyer: parseBuyer(body.previousBuyer, "Dados anteriores"),
    correctedBuyer: parseBuyer(body.correctedBuyer, "Dados corrigidos"),
  };
}

function operationKey(request: Request, contractId: string) {
  const supplied = String(request.headers.get("x-zion-contract-operation-id") || "").trim().toLowerCase();
  const id = supplied || randomUUID();
  if (!UUID.test(id)) throw new ContractAccessError(400, "OPERATION_ID_INVALID", "O identificador da operacao e invalido.");
  return `p9:contract-buyer-correction:${contractId}:${id}`;
}

function isManualSentContract(contract: Record<string, unknown>) {
  const metadata = isRecord(contract.metadata) ? contract.metadata : null;
  return contract.quote_id == null && contract.quote_version_id == null &&
    metadata?.source === "responsible_text_draft" &&
    metadata?.created_via === "create_sales_contract_manual_by_system";
}

type Deps = {
  resolveAccess: (params: { requirement: "active"; deps?: Partial<ResolveStoreApiAccessDeps> }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  resolveContract: typeof resolveExistingContractForAuthorizedStoreScope;
  prepare: typeof prepareBuyerCorrectionVersion;
  readHistoricalText: typeof readHistoricalContractText;
  storePdf: typeof storeContractPdfFile;
};

export function createBuyerCorrectionPostHandler(deps: Partial<Deps> = {}) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const resolveContract = deps.resolveContract ?? resolveExistingContractForAuthorizedStoreScope;
  const prepare = deps.prepare ?? prepareBuyerCorrectionVersion;
  const readHistoricalText = deps.readHistoricalText ?? readHistoricalContractText;
  const storePdf = deps.storePdf ?? storeContractPdfFile;

  return async function POST(request: Request, context: { params: Promise<{ contractId: string }> }) {
    try {
      const access = await resolveAccess({ requirement: "active" });
      if (!access.ok) return createStoreApiDeniedResponse(access);
      const input = await readRequest(request);
      const { contractId: rawContractId } = await context.params;
      const contractId = String(rawContractId || "").trim();
      const scope = await resolveContract(contractId, {
        organizationId: access.organizationId,
        storeId: access.storeId,
        sessionUserId: access.sessionUserId,
      } satisfies ContractAuthorizedStoreScope);
      if (scope.organizationId !== access.organizationId || scope.store.id !== access.storeId || scope.contract.organization_id !== access.organizationId || scope.contract.store_id !== access.storeId) {
        throw new ContractAccessError(403, "CONTRACT_SCOPE_MISMATCH", "O contrato esta fora do escopo autorizado.");
      }
      if (!isManualSentContract(scope.contract as unknown as Record<string, unknown>) || scope.contract.status !== "sent_to_customer") {
        throw new ContractAccessError(409, "CONTRACT_NOT_CORRECTABLE", "Somente contratos manuais enviados podem ser corrigidos.");
      }
      if (scope.contract.current_version_id !== input.expectedVersionId || !scope.currentVersion || scope.currentVersion.id !== input.expectedVersionId || scope.currentVersion.status !== "sent") {
        throw new ContractAccessError(409, "CONTRACT_VERSION_CHANGED", "A versao enviada esperada nao e mais a versao vigente.");
      }
      const version = scope.currentVersion as typeof scope.currentVersion & { pdf_sha256?: string | null };
      if (!version.store_file_id || !version.storage_bucket || !version.storage_path || !version.pdf_sha256 || !isRecord(version.contract_snapshot)) {
        throw new ContractAccessError(409, "CONTRACT_HISTORY_UNAVAILABLE", "O PDF e o snapshot historicos nao estao disponiveis para correcao.");
      }
      const snapshot = version.contract_snapshot;
      const provenance = isRecord(snapshot.text_provenance) ? snapshot.text_provenance : null;
      const metadata = isRecord(scope.contract.metadata) ? scope.contract.metadata : null;
      const commercialOpportunityId = String(metadata?.commercial_opportunity_id || "").trim();
      const templateVersionId = String(provenance?.template_version_id || "").trim();
      const historicalRevision = typeof provenance?.revision === "number" && Number.isSafeInteger(provenance.revision) && provenance.revision >= 1 ? provenance.revision : null;
      if (provenance?.mode !== "saved_text_draft" || typeof provenance.draft_id !== "string" || historicalRevision === null || typeof provenance.text_sha256 !== "string" || !commercialOpportunityId || !templateVersionId) {
        throw new ContractAccessError(409, "HISTORICAL_TEXT_PROVENANCE_INVALID", "A versao enviada nao possui proveniencia textual historica valida.");
      }
      const historicalText = await readHistoricalText({
        supabase: scope.supabase,
        draftId: provenance.draft_id,
        revision: historicalRevision,
        expectedSha256: provenance.text_sha256,
        organizationId: access.organizationId,
        storeId: access.storeId,
        commercialOpportunityId,
        templateVersionId,
      });
      const prepared = await prepare({ previousSnapshot: version.contract_snapshot, previousVersionId: input.expectedVersionId, previousPdfSha256: version.pdf_sha256, actorUserId: access.sessionUserId, originalText: historicalText, previousBuyer: input.previousBuyer, correctedBuyer: input.correctedBuyer });
      const stored = await storePdf({ supabase: scope.supabase, organizationId: access.organizationId, storeId: access.storeId, contractId, contractNumber: scope.contract.contract_number, contentFingerprint: prepared.contentFingerprint, pdfBytes: prepared.pdfBytes });
      const { data, error } = await scope.supabase.rpc("create_sales_contract_buyer_correction_version_by_system", {
        p_organization_id: access.organizationId, p_store_id: access.storeId, p_contract_id: contractId,
        p_expected_sent_version_id: input.expectedVersionId, p_human_actor_id: access.sessionUserId,
        p_corrected_buyer: input.correctedBuyer, p_operation_key: operationKey(request, contractId),
        p_request_fingerprint: prepared.requestFingerprint, p_content_fingerprint: prepared.contentFingerprint,
        p_store_file_id: stored.storeFileId, p_storage_bucket: stored.storageBucket, p_storage_path: stored.storagePath,
        p_original_filename: stored.originalFilename, p_size_bytes: stored.sizeBytes, p_pdf_sha256: prepared.pdfSha256,
        p_contract_snapshot: prepared.correctedSnapshot,
      });
      if (error) throw new ContractAccessError(409, "BUYER_CORRECTION_AUTHORITY_REJECTED", "A autoridade do contrato rejeitou a correcao.");
      const row = Array.isArray(data) ? data.length === 1 ? data[0] : null : data;
      if (!row || row.contract_id !== contractId || row.organization_id !== access.organizationId || row.store_id !== access.storeId || typeof row.id !== "string" || typeof row.replayed !== "boolean") throw new ContractAccessError(503, "BUYER_CORRECTION_AUTHORITY_UNCERTAIN", "A autoridade do contrato nao confirmou a correcao.");
      return NextResponse.json({ ok: true, versionId: row.id, status: row.status, replayed: row.replayed });
    } catch (error) { return errorResponse(error); }
  };
}

export const POST = createBuyerCorrectionPostHandler();

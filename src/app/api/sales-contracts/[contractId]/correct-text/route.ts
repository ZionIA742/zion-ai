import { NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import {
  ContractAccessError,
  resolveExistingContractForAuthorizedStoreScope,
} from "@/lib/server/sales-contracts/contract-auth";
import {
  HistoricalContractTextError,
  readHistoricalContractText,
} from "@/lib/server/sales-contracts/buyer-correction-version";
import { prepareContractTextCorrectionVersion } from "@/lib/server/sales-contracts/contract-text-correction-version";
import { storeContractPdfFile } from "@/lib/server/sales-contracts/contract-storage";
import {
  resolveStoreApiAccess,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function errorResponse(error: unknown) {
  if (error instanceof ContractAccessError) return json({ ok: false, error: error.code, message: error.message }, error.status);
  if (error instanceof HistoricalContractTextError) return json({ ok: false, error: `HISTORICAL_TEXT_${error.code}`, message: error.message }, 409);
  return json({ ok: false, error: "CONTRACT_TEXT_CORRECTION_FAILED", message: error instanceof Error ? error.message : "Nao foi possivel corrigir o texto do contrato." }, 409);
}

function manualSentContract(scope: Awaited<ReturnType<typeof resolveExistingContractForAuthorizedStoreScope>>) {
  const metadata = isRecord(scope.contract.metadata) ? scope.contract.metadata : null;
  return scope.contract.status === "sent_to_customer" &&
    scope.contract.quote_id == null && scope.contract.quote_version_id == null &&
    metadata?.source === "responsible_text_draft" &&
    metadata?.created_via === "create_sales_contract_manual_by_system";
}

function operationKey(request: Request, contractId: string) {
  const supplied = String(request.headers.get("x-zion-contract-operation-id") || "").trim().toLowerCase();
  const id = supplied || randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) {
    throw new ContractAccessError(400, "CONTRACT_OPERATION_ID_INVALID", "O identificador da operacao e invalido.");
  }
  return `p9:contract-text-correction:${contractId}:${id}`;
}

async function resolveHistorical(scope: Awaited<ReturnType<typeof resolveExistingContractForAuthorizedStoreScope>>, organizationId: string, storeId: string) {
  const currentVersion = scope.currentVersion;
  if (!manualSentContract(scope) || !currentVersion || currentVersion.status !== "sent" ||
      scope.contract.current_version_id !== currentVersion.id) {
    throw new ContractAccessError(409, "CONTRACT_NOT_CORRECTABLE", "Somente contratos manuais enviados podem ser corrigidos.");
  }
  const snapshot = currentVersion.contract_snapshot;
  if (!isRecord(snapshot)) throw new ContractAccessError(409, "CONTRACT_HISTORY_UNAVAILABLE", "O snapshot historico nao esta disponivel.");
  const previousPdfSha256 = String((currentVersion as typeof currentVersion & { pdf_sha256?: string | null }).pdf_sha256 || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(previousPdfSha256)) {
    throw new ContractAccessError(409, "HISTORICAL_TEXT_PROVENANCE_INVALID", "A proveniencia do PDF historico e invalida.");
  }
  const provenance = isRecord(snapshot.text_provenance) ? snapshot.text_provenance : null;
  const metadata = isRecord(scope.contract.metadata) ? scope.contract.metadata : null;
  const opportunityId = String(metadata?.commercial_opportunity_id || "").trim();
  const templateVersionId = String(provenance?.template_version_id || "").trim();
  const revision = typeof provenance?.revision === "number" && Number.isSafeInteger(provenance.revision) ? provenance.revision : null;
  if (!opportunityId || !templateVersionId || revision === null || typeof provenance?.draft_id !== "string" || typeof provenance.text_sha256 !== "string") {
    throw new ContractAccessError(409, "HISTORICAL_TEXT_PROVENANCE_INVALID", "A proveniencia textual historica e invalida.");
  }
  const text = await readHistoricalContractText({
    supabase: scope.supabase,
    draftId: provenance.draft_id,
    revision,
    expectedSha256: provenance.text_sha256,
    organizationId,
    storeId,
    commercialOpportunityId: opportunityId,
    templateVersionId,
  });
  return { snapshot, provenance, text, opportunityId, templateVersionId, revision, currentVersion, previousPdfSha256 };
}

export async function GET(_request: Request, context: { params: Promise<{ contractId: string }> }) {
  try {
    const access = await resolveStoreApiAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);
    const { contractId: rawContractId } = await context.params;
    const contractId = String(rawContractId || "").trim();
    const scope = await resolveExistingContractForAuthorizedStoreScope(contractId, {
      organizationId: access.organizationId,
      storeId: access.storeId,
      sessionUserId: access.sessionUserId,
    });
    const historical = await resolveHistorical(scope, access.organizationId, access.storeId);
    return json({ ok: true, contractId, expectedSentVersionId: historical.currentVersion.id, text: historical.text, revision: historical.revision, templateVersionId: historical.templateVersionId });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ contractId: string }> }) {
  let storedFile: { storeFileId: string; storageBucket: string; storagePath: string } | null = null;
  let cleanupSupabase: Awaited<ReturnType<typeof resolveExistingContractForAuthorizedStoreScope>>["supabase"] | null = null;
  let cleanupOrganizationId = "";
  let cleanupStoreId = "";
  try {
    const access = await resolveStoreApiAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);
    const { contractId: rawContractId } = await context.params;
    const contractId = String(rawContractId || "").trim();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const expectedVersionId = String(body?.expectedSentVersionId || "").trim();
    const text = body?.text;
    const expectedTextSha256 = String(body?.expectedHistoricalTextSha256 || "").trim().toLowerCase();
    if (!expectedVersionId || typeof text !== "string" || !/^[0-9a-f]{64}$/u.test(expectedTextSha256)) {
      throw new ContractAccessError(400, "CONTRACT_TEXT_CORRECTION_REQUEST_INVALID", "Os dados da correcao textual sao invalidos.");
    }
    const scope = await resolveExistingContractForAuthorizedStoreScope(contractId, {
      organizationId: access.organizationId,
      storeId: access.storeId,
      sessionUserId: access.sessionUserId,
    });
    cleanupSupabase = scope.supabase;
    cleanupOrganizationId = access.organizationId;
    cleanupStoreId = access.storeId;
    const historical = await resolveHistorical(scope, access.organizationId, access.storeId);
    if (historical.currentVersion.id !== expectedVersionId || createHash("sha256").update(historical.text, "utf8").digest("hex") !== expectedTextSha256) {
      throw new ContractAccessError(409, "CONTRACT_VERSION_CHANGED", "O contrato mudou desde a abertura do editor.");
    }
    const prepared = await prepareContractTextCorrectionVersion({
      previousSnapshot: historical.snapshot,
      previousVersionId: expectedVersionId,
      previousPdfSha256: historical.previousPdfSha256,
      actorUserId: access.sessionUserId,
      originalText: historical.text,
      correctedText: text,
    });
    const stored = await storeContractPdfFile({
      supabase: scope.supabase,
      organizationId: access.organizationId,
      storeId: access.storeId,
      contractId,
      contractNumber: scope.contract.contract_number,
      contentFingerprint: prepared.contentFingerprint,
      pdfBytes: prepared.pdfBytes,
    });
    storedFile = stored;
    const { data, error } = await scope.supabase.rpc("create_sales_contract_text_correction_version_by_system", {
      p_organization_id: access.organizationId,
      p_store_id: access.storeId,
      p_contract_id: contractId,
      p_expected_sent_version_id: expectedVersionId,
      p_human_actor_id: access.sessionUserId,
      p_operation_key: operationKey(request, contractId),
      p_request_fingerprint: prepared.requestFingerprint,
      p_content_fingerprint: prepared.contentFingerprint,
      p_store_file_id: stored.storeFileId,
      p_storage_bucket: stored.storageBucket,
      p_storage_path: stored.storagePath,
      p_original_filename: stored.originalFilename,
      p_size_bytes: stored.sizeBytes,
      p_pdf_sha256: prepared.pdfSha256,
      p_contract_snapshot: prepared.correctedSnapshot,
    });
    if (error) throw new Error("A autoridade do contrato rejeitou a nova versao textual.");
    const row = Array.isArray(data) ? data.length === 1 ? data[0] : null : data;
    if (!row?.id || row.contract_id !== contractId || row.replayed !== false && row.replayed !== true) throw new Error("A autoridade nao confirmou a nova versao.");
    if (row.replayed === true && storedFile) {
      await scope.supabase.from("store_files").delete().eq("id", storedFile.storeFileId)
        .eq("organization_id", access.organizationId).eq("store_id", access.storeId)
        .eq("storage_bucket", storedFile.storageBucket).eq("storage_path", storedFile.storagePath);
      await scope.supabase.storage.from(storedFile.storageBucket).remove([storedFile.storagePath]);
      storedFile = null;
    }
    storedFile = null;
    return json({ ok: true, versionId: row.id, replayed: row.replayed, status: row.status });
  } catch (error) {
    if (storedFile && cleanupSupabase) {
      try {
        await cleanupSupabase.from("store_files").delete().eq("id", storedFile.storeFileId)
          .eq("organization_id", cleanupOrganizationId).eq("store_id", cleanupStoreId)
          .eq("storage_bucket", storedFile.storageBucket).eq("storage_path", storedFile.storagePath);
        await cleanupSupabase.storage.from(storedFile.storageBucket).remove([storedFile.storagePath]);
      } catch {
        // Best effort only; the RPC remains the authority for contract state.
      }
    }
    return errorResponse(error);
  }
}

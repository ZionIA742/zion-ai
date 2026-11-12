/** ZION-ADM D.7: coleta validada e persistencia autorizada; sem execucao automatica. */
import { createHash } from "node:crypto";
import { createServiceSupabaseClient } from "./zion-account-provisioning";
import {
  captureValidatedPtaxCollection,
  type ValidatedPtaxCapture,
  type ValidatedPtaxEvidence,
} from "./zion-admin-ptax-evidence-capture";
import type { PtaxFetcher } from "./zion-admin-ptax-daily";

export type PtaxEvidenceEnvelope = ValidatedPtaxEvidence & {
  collectionKey: string;
};

type RpcResult = { data: unknown; error: unknown };
export type PtaxEvidenceWriter = (
  evidence: PtaxEvidenceEnvelope,
) => Promise<RpcResult>;

type CollectionOptions = {
  fetcher?: PtaxFetcher;
  clock?: () => Date;
  writer?: PtaxEvidenceWriter;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const fields = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${fields.join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("PTAX_EVIDENCE_NON_JSON_VALUE");
  }
  return serialized;
}

/** Identidade da coleta: mesmo JSON + mesmos metadados => mesma chave. */
export function buildPtaxEvidenceEnvelope(
  evidence: ValidatedPtaxEvidence,
): PtaxEvidenceEnvelope {
  if (evidence.source !== "bcb_ptax_venda") {
    throw new Error("PTAX_EVIDENCE_INVALID_SOURCE");
  }
  const fields: ValidatedPtaxEvidence = {
    source: evidence.source,
    requestedFrom: evidence.requestedFrom,
    requestedTo: evidence.requestedTo,
    requestStartedAt: evidence.requestStartedAt,
    requestFinishedAt: evidence.requestFinishedAt,
    endpointUrl: evidence.endpointUrl,
    responsePayload: evidence.responsePayload,
    resultCount: evidence.resultCount,
  };
  const digest = createHash("sha256")
    .update(stableJson(fields))
    .digest("hex");
  return { collectionKey: `bcb_ptax_venda:v1:${digest}`, ...fields };
}

async function writeViaServiceRole(
  evidence: PtaxEvidenceEnvelope,
): Promise<RpcResult> {
  const client = createServiceSupabaseClient();
  // Adaptador estreito ate a tipagem gerada refletir a RPC SQL recem-instalada.
  const rpc = client.rpc.bind(client) as unknown as (
    name: "zion_admin_register_ptax_collection_evidence_by_system",
    args: { p_evidence: PtaxEvidenceEnvelope },
  ) => PromiseLike<RpcResult>;
  return await rpc(
    "zion_admin_register_ptax_collection_evidence_by_system",
    { p_evidence: evidence },
  );
}

export async function persistValidatedPtaxCapture(
  capture: ValidatedPtaxCapture,
  writer: PtaxEvidenceWriter = writeViaServiceRole,
): Promise<{
  report: ValidatedPtaxCapture["report"];
  collectionId: string;
  collectionKey: string;
  outcome: "inserted" | "replayed";
}> {
  if (capture.report.source !== capture.evidence.source) {
    throw new Error("PTAX_EVIDENCE_SOURCE_MISMATCH");
  }
  const envelope = buildPtaxEvidenceEnvelope(capture.evidence);
  const { data, error } = await writer(envelope);
  if (error !== null) {
    throw new Error("PTAX_EVIDENCE_RPC_FAILED");
  }
  if (
    data === null ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    throw new Error("PTAX_EVIDENCE_INVALID_RPC_RESULT");
  }
  const result = data as Record<string, unknown>;
  if (
    (result.outcome !== "inserted" && result.outcome !== "replayed") ||
    typeof result.collection_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.collection_id) ||
    result.collection_key !== envelope.collectionKey ||
    result.result_count !== envelope.resultCount
  ) {
    throw new Error("PTAX_EVIDENCE_INVALID_RPC_RESULT");
  }
  return {
    report: capture.report,
    collectionId: result.collection_id,
    collectionKey: envelope.collectionKey,
    outcome: result.outcome,
  };
}

/** Explicitamente invocavel por um fluxo controlado; rotas de leitura nao chamam. */
export async function collectAndPersistValidatedPtax(
  from: string,
  to: string,
  options: CollectionOptions = {},
) {
  const capture = await captureValidatedPtaxCollection(
    from,
    to,
    options.fetcher,
    options.clock,
  );
  return persistValidatedPtaxCapture(capture, options.writer);
}

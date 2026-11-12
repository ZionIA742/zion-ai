/** D.10: reinterpreta resposta PTAX armazenada; nao consulta BCB nem habilita fechamento. */
import { createServiceSupabaseClient } from "./zion-account-provisioning";
import { buildPtaxEvidenceEnvelope } from "./zion-admin-ptax-evidence-persist";
import {
  loadDailyPtaxRates,
  type DailyPtaxReport,
} from "./zion-admin-ptax-daily";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^bcb_ptax_venda:v1:[0-9a-f]{64}$/;

type EvidenceReadResult = { data: unknown; error: unknown };
type EvidenceReader = (collectionKey: string) => Promise<EvidenceReadResult>;

export type PtaxPersistedCollection = {
  collectionId: string;
  collectionKey: string;
  report: DailyPtaxReport;
};

type ReconciliationOptions = {
  reader?: EvidenceReader;
  parse?: typeof loadDailyPtaxRates;
};

function invalid(): never {
  throw new Error("PTAX_EVIDENCE_RECONCILIATION_FAILED");
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function timestamp(value: unknown): string {
  if (typeof value !== "string") invalid();
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) invalid();
  return time.toISOString();
}

async function readStoredEvidence(collectionKey: string): Promise<EvidenceReadResult> {
  const db = createServiceSupabaseClient();
  // Fronteira tipada ate o schema Supabase gerado incluir a tabela financeira.
  const from = db.from.bind(db) as unknown as (table: "zion_admin_ptax_collection_evidence") => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<EvidenceReadResult>;
      };
    };
  };
  return await from("zion_admin_ptax_collection_evidence")
    .select("id,collection_key,source,requested_from,requested_to,request_started_at,request_finished_at,endpoint_url,response_payload,result_count")
    .eq("collection_key", collectionKey)
    .maybeSingle();
}

/**
 * Independente do writer: busca a linha persistida, confere identidade,
 * hash canonico e reprocessa o JSON pelo leitor PTAX validado.
 * A verificacao de armazenamento NAO prova sozinha HTTPS ou fatura.
 */
export async function reconcilePersistedPtaxCollection(
  from: string,
  to: string,
  captured: PtaxPersistedCollection,
  options: ReconciliationOptions = {},
): Promise<PtaxPersistedCollection> {
  if (
    !captured ||
    typeof captured.collectionId !== "string" ||
    !UUID.test(captured.collectionId) ||
    typeof captured.collectionKey !== "string" ||
    !KEY.test(captured.collectionKey) ||
    !isRecord(captured.report) ||
    captured.report.source !== "bcb_ptax_venda" ||
    !Array.isArray(captured.report.daily)
  ) invalid();

  const reader = options.reader ?? readStoredEvidence;
  const result = await reader(captured.collectionKey);
  if (!result || result.error != null || !isRecord(result.data)) invalid();
  const row = result.data;

  if (
    row.id !== captured.collectionId ||
    row.collection_key !== captured.collectionKey ||
    row.source !== "bcb_ptax_venda" ||
    row.requested_from !== from ||
    row.requested_to !== to ||
    typeof row.endpoint_url !== "string" ||
    !isRecord(row.response_payload) ||
    !Array.isArray(row.response_payload.value) ||
    typeof row.result_count !== "number" ||
    !Number.isSafeInteger(row.result_count) ||
    row.result_count !== row.response_payload.value.length
  ) invalid();

  const started = timestamp(row.request_started_at);
  const finished = timestamp(row.request_finished_at);
  if (finished < started) invalid();

  const envelope = buildPtaxEvidenceEnvelope({
    source: "bcb_ptax_venda",
    requestedFrom: from,
    requestedTo: to,
    requestStartedAt: started,
    requestFinishedAt: finished,
    endpointUrl: row.endpoint_url,
    responsePayload: row.response_payload,
    resultCount: row.result_count,
  });
  if (envelope.collectionKey !== captured.collectionKey) invalid();

  let requested = false;
  const parse = options.parse ?? loadDailyPtaxRates;
  let rebuilt: DailyPtaxReport;
  try {
    rebuilt = await parse(from, to, async (url) => {
      if (requested || url !== row.endpoint_url) invalid();
      requested = true;
      return {
        ok: true,
        async json() { return row.response_payload; },
      };
    });
  } catch {
    invalid();
  }

  if (
    !requested ||
    rebuilt.source !== "bcb_ptax_venda" ||
    JSON.stringify(rebuilt.daily) !== JSON.stringify(captured.report.daily)
  ) invalid();

  return {
    collectionId: captured.collectionId,
    collectionKey: captured.collectionKey,
    report: rebuilt,
  };
}

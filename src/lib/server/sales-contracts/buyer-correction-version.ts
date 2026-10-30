import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeContractContentFingerprint,
  type CanonicalContractRendererInput,
} from "./canonical-contract-renderer";
import {
  correctAndRenderContractText,
  type ContractBuyerData,
} from "./correct-and-render-contract-text";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class HistoricalContractTextError extends Error {
  constructor(public readonly code: "PROVENANCE_INVALID" | "NOT_FOUND" | "SCOPE_MISMATCH" | "REVISION_MISMATCH" | "HASH_MISMATCH" | "READ_FAILED", message: string) {
    super(message);
    this.name = "HistoricalContractTextError";
  }
}

export async function readHistoricalContractText(args: {
  supabase: Pick<SupabaseClient, "from">;
  draftId: string;
  revision: number;
  expectedSha256: string;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  templateVersionId?: string | null;
}) {
  if (!args.draftId || !Number.isSafeInteger(args.revision) || args.revision < 1 || !/^[0-9a-f]{64}$/u.test(args.expectedSha256)) {
    throw new HistoricalContractTextError("PROVENANCE_INVALID", "A proveniencia textual historica e invalida.");
  }
  let result: { data: Record<string, unknown> | null; error: { message?: string } | null };
  try {
    let query = args.supabase
      .from("sales_contract_text_drafts")
      .select("id, organization_id, store_id, commercial_opportunity_id, template_version_id, draft_text, revision")
      .eq("id", args.draftId)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("commercial_opportunity_id", args.commercialOpportunityId);
    if (args.templateVersionId) query = query.eq("template_version_id", args.templateVersionId);
    result = await query.maybeSingle();
  } catch {
    throw new HistoricalContractTextError("READ_FAILED", "Nao foi possivel ler o texto historico do contrato.");
  }
  if (result.error) throw new HistoricalContractTextError("READ_FAILED", "Nao foi possivel ler o texto historico do contrato.");
  const draft = result.data;
  if (!draft) throw new HistoricalContractTextError("NOT_FOUND", "O texto historico do contrato nao foi encontrado.");
  if (draft.organization_id !== args.organizationId || draft.store_id !== args.storeId || draft.commercial_opportunity_id !== args.commercialOpportunityId || (args.templateVersionId && draft.template_version_id !== args.templateVersionId)) {
    throw new HistoricalContractTextError("SCOPE_MISMATCH", "O texto historico do contrato esta fora do escopo.");
  }
  if (draft.revision !== args.revision) throw new HistoricalContractTextError("REVISION_MISMATCH", "A revisao do texto historico nao corresponde a versao enviada.");
  if (typeof draft.draft_text !== "string" || !draft.draft_text.trim()) throw new HistoricalContractTextError("READ_FAILED", "O texto historico do contrato esta vazio.");
  if (sha256(draft.draft_text) !== args.expectedSha256) throw new HistoricalContractTextError("HASH_MISMATCH", "O hash do texto historico nao corresponde a versao enviada.");
  return draft.draft_text;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export async function prepareBuyerCorrectionVersion(args: {
  previousSnapshot: RecordValue;
  previousVersionId: string;
  previousPdfSha256: string;
  actorUserId: string;
  originalText: string;
  previousBuyer: ContractBuyerData;
  correctedBuyer: ContractBuyerData;
}) {
  const snapshot = clone(args.previousSnapshot);
  const rendererInput = snapshot.renderer_input;
  const previousProvenance = snapshot.text_provenance;
  if (!isRecord(rendererInput) || !isRecord(rendererInput.customer)) {
    throw new Error("O snapshot enviado nao possui renderer_input.customer valido.");
  }
  if (!isRecord(previousProvenance)) {
    throw new Error("O snapshot enviado nao possui proveniencia textual valida.");
  }
  if (
    previousProvenance.text_representation !== "persisted_text_utf8_exact" ||
    typeof previousProvenance.text_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(previousProvenance.text_sha256) ||
    previousProvenance.pdf_sha256 !== args.previousPdfSha256
  ) {
    throw new Error("A proveniencia textual da versao enviada nao pode ser reconciliada.");
  }
  if (sha256(args.originalText) !== previousProvenance.text_sha256) {
    throw new Error("O texto recuperado do PDF nao corresponde ao texto historico persistido.");
  }

  const rendered = await correctAndRenderContractText({
    originalText: args.originalText,
    previousBuyer: args.previousBuyer,
    correctedBuyer: args.correctedBuyer,
  });
  const correctedRendererInput = {
    ...rendererInput,
    customer: {
      ...rendererInput.customer,
      ...args.correctedBuyer,
    },
  } as CanonicalContractRendererInput;
  const contentFingerprint = computeContractContentFingerprint(correctedRendererInput);
  const correctedSnapshot: RecordValue = {
    ...snapshot,
    renderer_input: correctedRendererInput,
    content_fingerprint: contentFingerprint,
    materialized_at: new Date().toISOString(),
    text_provenance: {
      ...previousProvenance,
      text_sha256: rendered.renderedTextSha256,
      pdf_sha256: rendered.pdfSha256,
      text_representation: "buyer_corrected_text_utf8_exact",
    },
    buyer_correction: {
      previous_version_id: args.previousVersionId,
      actor_user_id: args.actorUserId,
      previous_text_sha256: previousProvenance.text_sha256,
      corrected_text_sha256: rendered.renderedTextSha256,
      kind: "buyer_data",
    },
  };

  return {
    ...rendered,
    correctedSnapshot,
    contentFingerprint,
    requestFingerprint: sha256(
      JSON.stringify({
        operation: "zion.sales_contract_buyer_correction.v1",
        previousVersionId: args.previousVersionId,
        actorUserId: args.actorUserId,
        previousSnapshot: args.previousSnapshot,
        correctedBuyer: args.correctedBuyer,
        contentFingerprint,
        textSha256: rendered.renderedTextSha256,
        pdfSha256: rendered.pdfSha256,
      }),
    ),
  };
}

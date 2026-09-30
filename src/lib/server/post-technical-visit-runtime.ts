import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { extractPostTechnicalVisitResult } from "./post-technical-visit-result-extraction";
import { decidePostTechnicalVisitBySystem } from "./post-technical-visit-decision";

type CanonicalResponseRow = {
  id?: unknown;
  organization_id?: unknown;
  store_id?: unknown;
  raw_content?: unknown;
};

type RpcLike = {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string | null } | null }>;
};

type RuntimeExtraction = Awaited<ReturnType<typeof extractPostTechnicalVisitResult>>;

type DecidedPostTechnicalVisitRuntimeResult = {
  status: "decided";
  responseId: string;
  resultEventId: string;
  decisionId: string;
  decisionKind: string;
  decisionReason: string;
};

type SupersededPostTechnicalVisitRuntimeResult = {
  status: "superseded";
  responseId: string;
  resultEventId: string;
};

export type PostTechnicalVisitRuntimeResult =
  | DecidedPostTechnicalVisitRuntimeResult
  | SupersededPostTechnicalVisitRuntimeResult;

type RuntimeDependencies = {
  extract?: (rawContent: string) => Promise<RuntimeExtraction>;
  persist?: (args: {
    supabase: RpcLike;
    responseId: string;
    extraction: RuntimeExtraction["extraction"];
    operationKey: string;
    organizationId: string;
    storeId: string;
  }) => Promise<{ eventId: string }>;
  decide?: (args: {
    supabase: RpcLike;
    resultEventId: string;
    operationKey: string;
  }) => Promise<Awaited<ReturnType<typeof decidePostTechnicalVisitBySystem>>>;
  findExistingResult?: (args: {
    supabase: SupabaseClient;
    organizationId: string;
    storeId: string;
    responseId: string;
  }) => Promise<{
    status: "current" | "superseded";
    eventId: string;
  } | null>;
  openai?: { responses: { create(args: unknown): Promise<unknown> } };
  model?: string;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials are missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function readSingleRow(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0];
  return row && typeof row === "object" && !Array.isArray(row)
    ? (row as Record<string, unknown>)
    : null;
}

async function readCanonicalResponse(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  responseId: string;
}) {
  const { data, error } = await args.supabase
    .from("schedule_post_appointment_followup_responses")
    .select("id, organization_id, store_id, raw_content")
    .eq("id", args.responseId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle<CanonicalResponseRow>();

  if (error) throw new Error(`POST_TECHNICAL_VISIT_RESPONSE_READ_FAILED: ${error.message}`);
  if (
    !data ||
    clean(data.id) !== args.responseId ||
    clean(data.organization_id) !== args.organizationId ||
    clean(data.store_id) !== args.storeId
  ) {
    throw new Error("POST_TECHNICAL_VISIT_RESPONSE_SCOPE_MISMATCH");
  }

  const rawContent = clean(data.raw_content);
  if (!rawContent) throw new Error("POST_TECHNICAL_VISIT_RESPONSE_RAW_CONTENT_MISSING");
  return rawContent;
}

async function readExistingResultEvent(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  responseId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_technical_visit_result_events")
    .select("id, organization_id, store_id, appointment_id, source_response_id")
    .eq("source_response_id", args.responseId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle<{
      id?: unknown;
      organization_id?: unknown;
      store_id?: unknown;
      appointment_id?: unknown;
      source_response_id?: unknown;
    }>();

  if (error) {
    throw new Error(`POST_TECHNICAL_VISIT_RESULT_READ_FAILED: ${error.message}`);
  }

  if (!data) return null;

  const eventId = clean(data.id);
  const appointmentId = clean(data.appointment_id);
  if (
    !eventId ||
    !appointmentId ||
    clean(data.organization_id) !== args.organizationId ||
    clean(data.store_id) !== args.storeId ||
    clean(data.source_response_id) !== args.responseId
  ) {
    throw new Error("POST_TECHNICAL_VISIT_RESULT_SCOPE_MISMATCH");
  }

  const { data: current, error: currentError } = await args.supabase
    .from("store_technical_visit_result_current")
    .select("organization_id, store_id, appointment_id, current_result_event_id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("appointment_id", appointmentId)
    .maybeSingle<{
      organization_id?: unknown;
      store_id?: unknown;
      appointment_id?: unknown;
      current_result_event_id?: unknown;
    }>();

  if (currentError) {
    throw new Error(`POST_TECHNICAL_VISIT_RESULT_CURRENT_READ_FAILED: ${currentError.message}`);
  }

  if (!current) {
    throw new Error("POST_TECHNICAL_VISIT_RESULT_CURRENT_MISSING");
  }

  const currentOrganizationId = clean(current.organization_id);
  const currentStoreId = clean(current.store_id);
  const currentAppointmentId = clean(current.appointment_id);
  const currentResultEventId = clean(current.current_result_event_id);

  if (
    !currentOrganizationId ||
    !currentStoreId ||
    !currentAppointmentId ||
    !currentResultEventId ||
    currentOrganizationId !== args.organizationId ||
    currentStoreId !== args.storeId ||
    currentAppointmentId !== appointmentId
  ) {
    throw new Error("POST_TECHNICAL_VISIT_RESULT_CURRENT_INVALID");
  }

  const isCurrent = currentResultEventId === eventId;

  return {
    status: isCurrent ? ("current" as const) : ("superseded" as const),
    eventId,
  };
}

export async function persistPostTechnicalVisitResultBySystem(args: {
  supabase: RpcLike;
  responseId: string;
  extraction: RuntimeExtraction["extraction"];
  operationKey: string;
}) {
  const { data, error } = await args.supabase.rpc(
    "persist_post_technical_visit_result_by_system",
    {
      p_source_response_id: args.responseId,
      p_result_kind: args.extraction.resultKind,
      p_evidence_text: args.extraction.evidenceText,
      p_adjustment_summary: args.extraction.adjustmentSummary,
      p_uncertainty_reason: args.extraction.uncertaintyReason,
      p_occurrence: args.extraction.occurrence,
      p_occurrence_evidence_text: args.extraction.occurrenceEvidenceText,
      p_operation_key: args.operationKey,
      p_metadata: {
        authority: "p9_7_5_runtime_v1",
        source_response_id: args.responseId,
      },
    },
  );
  if (error) throw new Error(`POST_TECHNICAL_VISIT_RESULT_PERSIST_FAILED: ${error.message}`);
  const row = readSingleRow(data);
  const eventId = clean(row?.event_id);
  if (!eventId) throw new Error("POST_TECHNICAL_VISIT_RESULT_PERSIST_INVALID_RESPONSE");
  return { eventId };
}

export async function runPostTechnicalVisitRuntime(args: {
  supabase?: SupabaseClient;
  organizationId: string;
  storeId: string;
  responseId: string;
  dependencies?: RuntimeDependencies;
}): Promise<PostTechnicalVisitRuntimeResult> {
  const organizationId = clean(args.organizationId);
  const storeId = clean(args.storeId);
  const responseId = clean(args.responseId);
  if (!organizationId || !storeId || !responseId) {
    throw new Error("POST_TECHNICAL_VISIT_RUNTIME_INVALID_INPUT");
  }

  const supabase = args.supabase || getSupabaseAdmin();
  const rawContent = await readCanonicalResponse({
    supabase,
    organizationId,
    storeId,
    responseId,
  });

  const dependencies = args.dependencies || {};
  const resultOperationKey = `p9:post-technical-visit-result:${responseId}`;
  const existingResult = dependencies.findExistingResult
    ? await dependencies.findExistingResult({
        supabase,
        organizationId,
        storeId,
        responseId,
      })
    : await readExistingResultEvent({
        supabase,
        organizationId,
        storeId,
        responseId,
      });

  let resultEventId: string;
  if (existingResult) {
    resultEventId = existingResult.eventId;
    if (existingResult.status === "superseded") {
      return {
        status: "superseded",
        responseId,
        resultEventId,
      };
    }
  } else {
    const extractionResult = dependencies.extract
      ? await dependencies.extract(rawContent)
      : await extractPostTechnicalVisitResult({
          openai: dependencies.openai || new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
          model: dependencies.model || process.env.ZION_AI_ASSISTANT_MODEL || "gpt-4.1-mini",
          responsibleMessage: rawContent,
        });
    if (extractionResult.failureReason) {
      throw new Error(`POST_TECHNICAL_VISIT_EXTRACTION_FAILED: ${extractionResult.failureReason}`);
    }

    const persisted = dependencies.persist
      ? await dependencies.persist({
          supabase,
          responseId,
          extraction: extractionResult.extraction,
          operationKey: resultOperationKey,
          organizationId,
          storeId,
        })
      : await persistPostTechnicalVisitResultBySystem({
          supabase,
          responseId,
          extraction: extractionResult.extraction,
          operationKey: resultOperationKey,
        });
    resultEventId = persisted.eventId;
  }

  const decisionOperationKey = `p9:post-technical-visit-decision:${responseId}`;
  const decided = dependencies.decide
    ? await dependencies.decide({
        supabase,
        resultEventId,
        operationKey: decisionOperationKey,
      })
    : await decidePostTechnicalVisitBySystem({
        supabase,
        resultEventId,
        operationKey: decisionOperationKey,
        metadata: {
          organization_id: organizationId,
          store_id: storeId,
          source_response_id: responseId,
        },
      });

  if (!decided.ok) throw new Error(`POST_TECHNICAL_VISIT_DECISION_FAILED: ${decided.message}`);

  return {
    status: "decided",
    responseId,
    resultEventId,
    decisionId: decided.decision.decisionId,
    decisionKind: decided.decision.decisionKind,
    decisionReason: decided.decision.decisionReason,
  };
}

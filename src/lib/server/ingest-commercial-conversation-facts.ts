import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractDeterministicQualificationCandidates,
  validateQualificationFactCandidate,
  type QualificationFactCandidate,
} from "./sales-qualification-fact-extraction";
import {
  readCommercialConversationFactEvents,
  writeCommercialConversationFactEvent,
  type CommercialConversationFactWriteResult,
} from "./commercial-conversation-fact-events";

export type CommercialFactMessage = {
  id: string;
  sender: string | null;
  content?: string | null;
  message_type?: string | null;
  metadata?: Record<string, unknown> | null;
  conversation_session_id?: string | null;
  commercial_session_context_link_id?: string | null;
  commercial_opportunity_id?: string | null;
};

const USEFUL_FACT_KEYS = new Set([
  "space_text",
  "requested_area_m2",
  "interested_product_reference",
  "need_summary",
  "relevant_objection_text",
  "customer_preferences_text",
  "preferred_period_text",
  "installation_interest",
  "payment_interest",
  "technical_visit_interest",
  "measurements_confirmation_required",
]);

const SENTENCE = /[^.!?\n]+[.!?]?/g;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEvidence(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

function actorFor(sender: string | null): "customer" | "human" | null {
  const normalized = text(sender).toLowerCase();
  if (normalized === "user" || normalized === "customer") return "customer";
  if (normalized === "human") return "human";
  return null;
}

function transcriptOrText(message: CommercialFactMessage): { value: string; media: "text" | "audio" } | null {
  const media = text(message.message_type).toLowerCase();
  if (media === "audio") {
    const transcript = text(message.metadata?.audio_transcript);
    return transcript ? { value: transcript, media: "audio" } : null;
  }
  if (media !== "text") return null;
  const content = text(message.content);
  return content ? { value: content, media: "text" } : null;
}

function textualCandidates(value: string): QualificationFactCandidate[] {
  const candidates: QualificationFactCandidate[] = [];
  for (const sentence of value.match(SENTENCE) || []) {
    const evidenceText = sentence.trim();
    if (!evidenceText) continue;
    const normalizedEvidence = normalizeEvidence(evidenceText);
    const normalized = normalizedEvidence;
    if (/\b(piscina|modelo|produto)\b/.test(normalizedEvidence)) {
      candidates.push({
        factKey: "interested_product_reference",
        valueKind: "text",
        valueJson: evidenceText,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText,
      });
    }
    if (/\b(preciso|necessito|necessidade|gostaria de|quero)\b/.test(normalizedEvidence)) {
      candidates.push({
        factKey: "need_summary",
        valueKind: "text",
        valueJson: evidenceText,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText,
      });
    }
    if (/\b(nao posso|não posso|impedimento|problema|nao cabe|não cabe|sem espaco|sem espaço|orcamento|orçamento)\b/.test(normalized)) {
      candidates.push({
        factKey: "relevant_objection_text",
        valueKind: "text",
        valueJson: evidenceText,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText,
      });
    }
    if (/\b(prefiro|preferencia|preferência|gostaria|sem instalacao|sem instalação|com instalacao|com instalação)\b/.test(normalized)) {
      candidates.push({
        factKey: "customer_preferences_text",
        valueKind: "text",
        valueJson: evidenceText,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText,
      });
    }
  }
  return candidates;
}

function uniqueCandidates(candidates: QualificationFactCandidate[]): QualificationFactCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.factKey}:${candidate.valueKind}:${JSON.stringify(candidate.valueJson)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isCorrection(value: string): boolean {
  return /\b(corrig|correc|na verdade|errei|ajuste)\w*/i.test(normalizeEvidence(value));
}

export type CommercialConversationFactIngestionResult = {
  status: "created" | "replayed" | "skipped" | "partial";
  reason?: "unsupported_message" | "audio_transcript_unavailable" | "missing_session_scope";
  writes: CommercialConversationFactWriteResult[];
  errors: string[];
};

export type CommercialConversationFactReconciliationResult = {
  status: "reconciled" | "skipped" | "failed";
  attempted: number;
  created: number;
  replayed: number;
  skipped: number;
  errors: string[];
};

function extractValidatedCandidates(message: CommercialFactMessage) {
  const actorType = actorFor(message.sender);

  if (
    actorType === "human" &&
    message.metadata?.source === "panel" &&
    message.metadata?.catalog_message_purpose === "catalog_product_presentation"
  ) {
    return null;
  }
  const source = transcriptOrText(message);
  if (!actorType || !source) return null;

  const candidates = uniqueCandidates(
    extractDeterministicQualificationCandidates(source.value)
      .concat(textualCandidates(source.value))
      .filter((candidate) => USEFUL_FACT_KEYS.has(candidate.factKey))
      .map((candidate) => validateQualificationFactCandidate({ candidate, anchorMessage: source.value }))
      .filter((candidate): candidate is QualificationFactCandidate => !!candidate),
  );
  return { actorType, source, candidates };
}

export async function ingestCommercialConversationFactsFromMessage(args: {
  supabase: Pick<SupabaseClient, "rpc">;
  message: CommercialFactMessage;
  organizationId: string;
  storeId: string;
  leadId: string;
  conversationId: string;
  conversationSessionId?: string | null;
  commercialSessionContextLinkId?: string | null;
  commercialOpportunityId?: string | null;
}): Promise<CommercialConversationFactIngestionResult> {
  const extracted = extractValidatedCandidates(args.message);
  if (!extracted) {
    return {
      status: "skipped",
      reason: actorFor(args.message.sender) && text(args.message.message_type).toLowerCase() === "audio"
        ? "audio_transcript_unavailable"
        : "unsupported_message",
      writes: [],
      errors: [],
    };
  }
  const { actorType, source, candidates: validated } = extracted;
  const sessionId = text(args.conversationSessionId || args.message.conversation_session_id);
  if (!sessionId) {
    return { status: "skipped", reason: "missing_session_scope", writes: [], errors: [] };
  }

  const writes: CommercialConversationFactWriteResult[] = [];
  const errors: string[] = [];
  for (const candidate of validated) {
    try {
      writes.push(await writeCommercialConversationFactEvent({
        supabase: args.supabase,
        input: {
          organizationId: args.organizationId,
          storeId: args.storeId,
          conversationId: args.conversationId,
          leadId: args.leadId,
          conversationSessionId: sessionId,
          commercialSessionContextLinkId: args.commercialSessionContextLinkId || args.message.commercial_session_context_link_id,
          commercialOpportunityId: args.commercialOpportunityId || args.message.commercial_opportunity_id,
          operationKey: `p9_10_5_fact_event_v1:${args.message.id}:${candidate.factKey}:${createHash("sha256").update(JSON.stringify(candidate.valueJson)).digest("hex").slice(0, 16)}`,
          factKey: candidate.factKey,
          value: candidate.valueJson,
          sourceMessageId: args.message.id,
          sourceMediaType: source.media,
          actorType,
          evidenceLevel: "confirmed",
          eventKind: actorType === "human" && isCorrection(source.value) ? "correction" : "assertion",
        },
      }));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "COMMERCIAL_CONVERSATION_FACT_WRITE_FAILED");
    }
  }
  return {
    status: errors.length > 0 ? (writes.length > 0 ? "partial" : "partial") : writes.some((write) => write.outcome === "created") ? "created" : writes.length > 0 ? "replayed" : "skipped",
    writes,
    errors,
  };
}

export async function reconcileCommercialConversationFactsFromMessages(args: {
  supabase: Pick<SupabaseClient, "rpc">;
  messages: Array<CommercialFactMessage & { direction?: string | null }>;
  organizationId: string;
  storeId: string;
  leadId: string;
  conversationId: string;
  commercialOpportunityByContextLinkId?: ReadonlyMap<string, string | null>;
}): Promise<CommercialConversationFactReconciliationResult> {
  const candidates = args.messages.filter((message) => {
    if (text(message.sender).toLowerCase() !== "human") return false;
    if (text(message.direction).toLowerCase() !== "outgoing") return false;
    return Boolean(extractValidatedCandidates(message)?.candidates.length);
  });

  if (candidates.length === 0) {
    return {
      status: "skipped",
      attempted: 0,
      created: 0,
      replayed: 0,
      skipped: 0,
      errors: [],
    };
  }

  const grouped = new Map<string, {
    message: CommercialFactMessage & { direction?: string | null };
    sessionId: string;
    contextLinkId: string | null;
    opportunityId: string | null;
  }[]>();
  const errors: string[] = [];

  for (const message of candidates) {
    const sessionId = text(message.conversation_session_id);
    const contextLinkId = text(message.commercial_session_context_link_id) || null;
    const contextOpportunity = contextLinkId
      ? args.commercialOpportunityByContextLinkId?.get(contextLinkId) ?? null
      : null;
    const opportunityId = text(message.commercial_opportunity_id) || contextOpportunity;
    if (!sessionId || (contextLinkId && !opportunityId)) {
      errors.push(`${message.id}:commercial_conversation_fact_scope_missing`);
      continue;
    }
    const key = [sessionId, contextLinkId || "", opportunityId || ""].join(":");
    const rows = grouped.get(key) || [];
    rows.push({ message, sessionId, contextLinkId, opportunityId });
    grouped.set(key, rows);
  }

  const alreadyWritten = new Set<string>();
  for (const rows of grouped.values()) {
    const first = rows[0];
    if (!first) continue;
    try {
      const existing = await readCommercialConversationFactEvents({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        conversationId: args.conversationId,
        leadId: args.leadId,
        conversationSessionId: first.sessionId,
        commercialSessionContextLinkId: first.contextLinkId,
        commercialOpportunityId: first.opportunityId,
      });
      for (const event of existing) {
        alreadyWritten.add(`${event.sourceMessageId}:${event.factKey}`);
      }
    } catch {
      errors.push(`${first.message.id}:commercial_conversation_fact_reader_failed`);
    }
  }

  let created = 0;
  let replayed = 0;
  let skipped = 0;

  for (const message of candidates) {
    const contextLinkId = text(message.commercial_session_context_link_id) || null;
    const contextOpportunity = contextLinkId
      ? args.commercialOpportunityByContextLinkId?.get(contextLinkId) ?? null
      : null;
    const extracted = extractValidatedCandidates(message);
    const candidateKeys = extracted?.candidates.map((candidate) => `${message.id}:${candidate.factKey}`) || [];
    if (candidateKeys.length > 0 && candidateKeys.every((key) => alreadyWritten.has(key))) {
      skipped += 1;
      continue;
    }
    try {
      const result = await ingestCommercialConversationFactsFromMessage({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        leadId: args.leadId,
        conversationId: args.conversationId,
        conversationSessionId: message.conversation_session_id,
        commercialSessionContextLinkId: contextLinkId,
        commercialOpportunityId: message.commercial_opportunity_id || contextOpportunity,
        message,
      });
      if (result.errors.length > 0 || result.reason === "missing_session_scope") {
        errors.push(`${message.id}:commercial_conversation_fact_reconciliation_failed`);
        continue;
      }
      if (result.writes.some((write) => write.outcome === "created")) created += 1;
      if (result.writes.length > 0 && result.writes.every((write) => write.outcome === "replayed")) replayed += 1;
      if (result.status === "skipped") skipped += 1;
    } catch {
      errors.push(`${message.id}:commercial_conversation_fact_reconciliation_failed`);
    }
  }

  return {
    status: errors.length > 0 ? "failed" : candidates.length > 0 ? "reconciled" : "skipped",
    attempted: candidates.length,
    created,
    replayed,
    skipped,
    errors,
  };
}

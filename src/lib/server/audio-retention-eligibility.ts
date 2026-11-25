import type { SupabaseClient } from "@supabase/supabase-js";

export type AudioFactExtractionStatus =
  | "completed_with_facts"
  | "completed_no_relevant_facts";

export function resolveAudioFactExtractionStatus(args: {
  status: "created" | "replayed" | "skipped" | "partial";
  reason?: string;
  errors: string[];
  writes: Array<{ outcome?: string }>;
}): AudioFactExtractionStatus | null {
  if (args.errors.length > 0 || args.reason === "missing_session_scope" || args.reason === "audio_transcript_unavailable") {
    return null;
  }
  return args.writes.some((write) => write.outcome === "created")
    ? "completed_with_facts"
    : "completed_no_relevant_facts";
}

export async function markAudioRetentionEligibleBySystem(args: {
  supabase: Pick<SupabaseClient, "rpc">;
  organizationId: string;
  storeId: string;
  conversationId: string;
  messageId: string;
  factExtractionStatus: AudioFactExtractionStatus;
}) {
  const { data, error } = await args.supabase.rpc("mark_audio_retention_eligible_by_system", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_conversation_id: args.conversationId,
    p_message_id: args.messageId,
    p_fact_extraction_status: args.factExtractionStatus,
  });
  if (error) throw new Error(`audio_retention_eligibility_mark_failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.message_id || !row?.marked_at || !["marked", "already_marked"].includes(row.outcome)) {
    throw new Error("audio_retention_eligibility_mark_invalid_result");
  }
  return row as {
    message_id: string;
    marked_at: string;
    outcome: "marked" | "already_marked";
    fact_extraction_status: AudioFactExtractionStatus;
  };
}

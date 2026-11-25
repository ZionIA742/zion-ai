import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_BUCKET = "zion-store-files";
const RETENTION_MS = 24 * 60 * 60 * 1000;
const AUDIO_PATH_MARKER = "/whatsapp-inbound/";

type AudioRetentionSupabase = Pick<SupabaseClient, "from" | "rpc"> & {
  storage: SupabaseClient["storage"];
};

type AudioCandidate = {
  id: string;
  organization_id: string;
  store_id: string;
  metadata: Record<string, unknown> | null;
};

export type AudioRetentionExecutorResult = {
  scanned: number;
  claimed: number;
  deleted: number;
  failed: number;
  skipped: number;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isEligibleCandidate(args: { row: AudioCandidate; now: Date }) {
  const metadata = args.row.metadata || {};
  const eligibleAt = Date.parse(text(metadata.audio_retention_eligible_at));
  const path = text(metadata.storage_path);
  return (
    text(metadata.attachment_kind) === "audio" &&
    text(metadata.media_origin) in { customer: true, human: true } &&
    text(metadata.storage_bucket) === STORAGE_BUCKET &&
    path.startsWith(`${args.row.organization_id}/${args.row.store_id}${AUDIO_PATH_MARKER}`) &&
    text(metadata.audio_transcript).length > 0 &&
    text(metadata.transcription_status).toLowerCase() === "succeeded" &&
    ["completed_with_facts", "completed_no_relevant_facts"].includes(text(metadata.audio_fact_extraction_status)) &&
    Number.isFinite(eligibleAt) &&
    eligibleAt <= args.now.getTime() - RETENTION_MS &&
    text(metadata.audio_retention_deletion_status) !== "deleted" &&
    (text(metadata.audio_retention_deletion_status) !== "claimed" ||
      (() => {
        const claimedAt = Date.parse(text(metadata.audio_retention_deletion_claimed_at));
        return Number.isFinite(claimedAt) && claimedAt <= args.now.getTime() - 60 * 60 * 1000;
      })())
  );
}

export async function executeAudioRetention(args: {
  supabase: AudioRetentionSupabase;
  organizationId: string;
  storeId: string;
  now?: Date;
  limit?: number;
}): Promise<AudioRetentionExecutorResult> {
  const now = args.now || new Date();
  const limit = Math.max(1, Math.min(Math.trunc(args.limit || 50), 200));
  const { data, error } = await args.supabase
    .from("messages")
    .select("id, organization_id, store_id, metadata")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("message_type", "audio")
    .in("sender", ["user", "human"])
    .is("deleted_at", null)
    .limit(limit);
  if (error) throw new Error(`audio_retention_scan_failed: ${error.message}`);

  const result: AudioRetentionExecutorResult = { scanned: 0, claimed: 0, deleted: 0, failed: 0, skipped: 0 };
  for (const row of (data || []) as AudioCandidate[]) {
    result.scanned += 1;
    if (!isEligibleCandidate({ row, now })) {
      result.skipped += 1;
      continue;
    }

    const claimToken = randomUUID();
    const { data: claimData, error: claimError } = await args.supabase.rpc("claim_audio_retention_deletion_by_system", {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_message_id: row.id,
      p_claim_token: claimToken,
      p_now: now.toISOString(),
    });
    if (claimError) {
      result.failed += 1;
      continue;
    }
    const claim = Array.isArray(claimData) ? claimData[0] : claimData;
    if (!claim?.storage_bucket || !claim.storage_path || claim.outcome !== "claimed") {
      result.skipped += 1;
      continue;
    }
    result.claimed += 1;

    let outcome: "deleted" | "failed" = "deleted";
    let deletionError: string | null = null;
    if (
      claim.storage_bucket !== STORAGE_BUCKET ||
      !String(claim.storage_path).startsWith(`${args.organizationId}/${args.storeId}${AUDIO_PATH_MARKER}`)
    ) {
      outcome = "failed";
      deletionError = "audio_retention_storage_identity_invalid";
    } else {
      const { error: removeError } = await args.supabase.storage
        .from(claim.storage_bucket)
        .remove([claim.storage_path]);
      if (removeError) {
        outcome = "failed";
        deletionError = removeError.message;
      }
    }

    const { error: finishError } = await args.supabase.rpc("finish_audio_retention_deletion_by_system", {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_message_id: row.id,
      p_claim_token: claimToken,
      p_outcome: outcome,
      p_error: deletionError,
      p_now: now.toISOString(),
    });
    if (finishError) {
      result.failed += 1;
      continue;
    }
    if (outcome === "deleted") result.deleted += 1;
    else result.failed += 1;
  }
  return result;
}

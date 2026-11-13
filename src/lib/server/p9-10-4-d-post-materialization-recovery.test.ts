import assert from "node:assert/strict";
import test from "node:test";
import { recoverConfirmedSalesAiReplySetPostCommitEffects } from "./generate-and-save-ai-sales-reply";

test("durable post-materialization recovery defers without writers during hard hold", async () => {
  const writes: string[] = [];
  const row = {
    response_set_id: "set-recovery-1",
    text_message_id: "message-recovery-1",
    document_message_ids: [],
    photo_message_id: null,
    request_fingerprint: "r".repeat(64),
    materialization_state: "confirmed",
    payload: { caller_payload: { post_commit_recovery: {} } },
  };
  const systemSupabase = {
    async rpc(name: string) {
      assert.equal(name, "read_sales_ai_reply_set_by_anchor");
      return { data: row, error: null };
    },
  };
  const supabase = {
    from(table: string) {
      if (table === "conversations") {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return {
              data: {
                id: "conv-1",
                organization_id: "org-1",
                lead_id: "lead-1",
                is_human_active: false,
                leads: { organization_id: "org-1", store_id: "store-1" },
              },
              error: null,
            };
          },
        };
      }
      if (table === "stores") {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return { data: { id: "store-1", organization_id: "org-1" }, error: null };
          },
        };
      }
      if (table === "conversation_human_takeover_leases") {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return { data: { hard_hold: true, released_at: null }, error: null };
          },
        };
      }
      writes.push(table);
      throw new Error(`unexpected writer table ${table}`);
    },
  };

  const result = await recoverConfirmedSalesAiReplySetPostCommitEffects({
    supabase,
    systemSupabase,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "anchor-1",
  });

  assert.deepEqual(result, { status: "deferred", complete: false });
  assert.deepEqual(writes, []);
});

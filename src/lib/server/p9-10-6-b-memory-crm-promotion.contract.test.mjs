import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const moduleSource = readFileSync(
  join(root, "src/lib/server/promote-commercial-memory-to-opportunity.ts"),
  "utf8",
);
const salesSource = readFileSync(
  join(root, "src/lib/server/generate-ai-sales-reply.ts"),
  "utf8",
);

assert.match(moduleSource, /readCommercialConversationFactEvents/);
assert.match(moduleSource, /read_commercial_opportunity_qualification_facts_by_system/);
assert.match(moduleSource, /write_commercial_opportunity_qualification_fact_by_system/);
assert.match(moduleSource, /human_message/);
assert.match(moduleSource, /sourceMessageId/);
assert.match(moduleSource, /conflictState === "consistent"/);
assert.match(moduleSource, /ZION_P9_10_6_A_REMOTE_INSTALLED/);
assert.match(moduleSource, /p9_10_6_b_memory_promotion:v1/);
assert.match(salesSource, /promoteCommercialMemoryToOpportunity/);
assert.match(moduleSource, /shouldPromoteCommercialMemoryForDecision/);
assert.match(salesSource, /shouldPromoteCommercialMemoryForDecision/);
assert.match(salesSource, /responseAnchorCommercialContext\.conversationSessionId/);
assert.doesNotMatch(salesSource, /human_release_conversation_to_ai/);

console.log("PASS p9-10.6-B CRM memory promotion contract");

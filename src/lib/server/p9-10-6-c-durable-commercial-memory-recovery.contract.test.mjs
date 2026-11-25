import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const durableRecoverySource = readFileSync(
  join(root, "src/lib/server/generate-and-save-ai-sales-reply.ts"),
  "utf8",
);
const workerSource = readFileSync(
  join(root, "src/lib/server/process-ai-run-queue.ts"),
  "utf8",
);

assert.match(durableRecoverySource, /commercial_memory_promotion/);
assert.match(durableRecoverySource, /buildDurableCommercialMemoryPromotionPayload/);
assert.match(durableRecoverySource, /promoteCommercialMemoryToOpportunity/);
assert.match(durableRecoverySource, /recoveryWriteStillAuthorized/);
assert.match(durableRecoverySource, /isCommercialMemoryCrmPromotionEnabled/);
assert.match(durableRecoverySource, /promotion\.status === "partial"/);
assert.match(durableRecoverySource, /promotion\.status === "disabled"/);
assert.match(workerSource, /input\.type === "sales_ai_post_materialization_recovery"/);
assert.match(workerSource, /outcome: "retryable"/);
assert.match(workerSource, /WORKER_MAX_ATTEMPTS/);

console.log("PASS p9-10.6-C durable commercial memory recovery contract");

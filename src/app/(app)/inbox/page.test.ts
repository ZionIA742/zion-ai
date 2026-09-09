import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

const pagePath = join(process.cwd(), "src/app/(app)/inbox/page.tsx");

function readPageSource() {
  return readFileSync(pagePath, "utf8");
}

function countOccurrences(source: string, needle: string) {
  return source.split(needle).length - 1;
}

function legacyListRpcName() {
  return ["panel", "list", "followup", "candidates", "scoped"].join("_");
}

function legacyEnqueueRpcName() {
  return ["panel", "enqueue", "followup", "scoped"].join("_");
}

function getFollowupCandidateRowBlock(source: string) {
  const start = source.indexOf("type FollowupCandidateRow = {");
  assert.equal(start > -1, true, "FollowupCandidateRow not found");
  const end = source.indexOf("};", start);
  assert.equal(end > start, true, "FollowupCandidateRow end not found");
  return source.slice(start, end);
}

function getLoadFollowupCandidatesBlock(source: string) {
  const start = source.indexOf("  const loadFollowupCandidates = useCallback(async () => {");
  assert.equal(start > -1, true, "loadFollowupCandidates not found");
  const end = source.indexOf("  const loadCommercialHandoffIndicators = useCallback(", start);
  assert.equal(end > start, true, "loadFollowupCandidates end not found");
  return source.slice(start, end);
}

function getTriggerManualFollowupBlock(source: string) {
  const start = source.indexOf("  async function triggerManualFollowup(candidate: FollowupCandidateRow) {");
  assert.equal(start > -1, true, "triggerManualFollowup not found");
  const end = source.indexOf("  function toggleSection", start);
  assert.equal(end > start, true, "triggerManualFollowup end not found");
  return source.slice(start, end);
}

function getFollowupRowsRenderBlock(source: string) {
  const start = source.indexOf("                  sortedFollowupRows.map((row) => {");
  assert.equal(start > -1, true, "follow-up render map not found");
  const end = source.indexOf("                )}", start);
  assert.equal(end > start, true, "follow-up render map end not found");
  return source.slice(start, end);
}

const tests: TestCase[] = [
  {
    name: "follow-up candidate row preserves canonical opportunity identity",
    run: () => {
      const block = getFollowupCandidateRowBlock(readPageSource());

      assert.equal(block.includes("commercial_opportunity_id: string;"), true);
      assert.equal(block.includes("commercial_opportunity_id?: string;"), false);
    },
  },
  {
    name: "follow-up reader uses canonical opportunity RPC and compatibility filters",
    run: () => {
      const source = readPageSource();
      const block = getLoadFollowupCandidatesBlock(source);

      assert.equal(block.includes('"panel_list_followup_opportunity_candidates_scoped"'), true);
      assert.equal(block.includes('p_followup_type: "offer"'), true);
      assert.equal(block.includes("p_min_hours_since_customer: 24"), true);
      assert.equal(block.includes("p_limit: 100"), true);
      assert.equal(source.includes(legacyListRpcName()), false);
    },
  },
  {
    name: "manual enqueue sends opportunity and conversation to canonical RPC",
    run: () => {
      const block = getTriggerManualFollowupBlock(readPageSource());

      assert.equal(block.includes('"panel_enqueue_followup_opportunity_scoped"'), true);
      assert.equal(block.includes("p_store_id: activeStoreId"), true);
      assert.equal(block.includes("p_commercial_opportunity_id: candidate.commercial_opportunity_id"), true);
      assert.equal(block.includes("p_conversation_id: candidate.conversation_id"), true);
      assert.equal(block.includes("p_followup_type: followupType"), true);
      assert.equal(block.includes(legacyEnqueueRpcName()), false);
    },
  },
  {
    name: "manual enqueue fail-closes before writer without store or canonical ids",
    run: () => {
      const block = getTriggerManualFollowupBlock(readPageSource());
      const storeGuardIndex = block.indexOf("if (!activeStoreId)");
      const identityGuardIndex = block.indexOf("if (!candidate.commercial_opportunity_id || !candidate.conversation_id)");
      const writerIndex = block.indexOf('"panel_enqueue_followup_opportunity_scoped"');

      assert.equal(storeGuardIndex > -1, true);
      assert.equal(identityGuardIndex > -1, true);
      assert.equal(storeGuardIndex < writerIndex, true);
      assert.equal(identityGuardIndex < writerIndex, true);
    },
  },
  {
    name: "manual enqueue creates one operation key and future default cadence payload",
    run: () => {
      const block = getTriggerManualFollowupBlock(readPageSource());

      assert.equal(block.includes("const cadenceIntervalMinutes = 1440;"), true);
      assert.equal(countOccurrences(block, "const operationKey ="), 1);
      assert.equal(block.includes("`inbox-manual:${crypto.randomUUID()}`"), true);
      assert.equal(countOccurrences(block, "const nextActionAt ="), 1);
      assert.equal(
        block.includes("new Date(Date.now() + cadenceIntervalMinutes * 60 * 1000).toISOString()"),
        true
      );
      assert.equal(block.includes("p_operation_key: operationKey"), true);
      assert.equal(block.includes("p_cadence_interval_minutes: cadenceIntervalMinutes"), true);
      assert.equal(block.includes("p_next_action_at: nextActionAt"), true);
    },
  },
  {
    name: "ok false is handled before success text",
    run: () => {
      const block = getTriggerManualFollowupBlock(readPageSource());
      const okFalseIndex = block.indexOf("if (!result.ok)");
      const successTextIndex = block.lastIndexOf("setFollowupStatusText(");

      assert.equal(okFalseIndex > -1, true);
      assert.equal(successTextIndex > okFalseIndex, true);
    },
  },
  {
    name: "pending and row identity are opportunity based",
    run: () => {
      const source = readPageSource();
      const renderBlock = getFollowupRowsRenderBlock(source);

      assert.equal(source.includes("triggeringConversationId"), false);
      assert.equal(source.includes("setTriggeringConversationId"), false);
      assert.equal(renderBlock.includes("triggeringOpportunityId === row.commercial_opportunity_id"), true);
      assert.equal(renderBlock.includes("key={row.commercial_opportunity_id}"), true);
      assert.equal(renderBlock.includes("key={row.conversation_id}"), false);
    },
  },
  {
    name: "legacy follow-up RPC names are absent from active page source",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes(legacyListRpcName()), false);
      assert.equal(source.includes(legacyEnqueueRpcName()), false);
    },
  },
];

let passed = 0;

for (const test of tests) {
  try {
    test.run();
    passed += 1;
    console.log(`ok - ${test.name}`);
  } catch (error) {
    console.error(`not ok - ${test.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} inbox follow-up page tests passed`);

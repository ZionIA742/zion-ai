import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAssistantStoreScopeKey } from "./staleness-scope";

type TestCase = {
  name: string;
  run: () => void;
};

type PendingRequest = {
  scopeKey: string | null;
  seq: number;
};

class AssistantStalenessHarness {
  scopeKey: string | null = null;
  loadSeq = 0;
  prioritySeq = 0;
  olderSeq = 0;
  summary: string | null = null;
  messages: string[] = [];
  priorityByOpportunity: Record<string, string> = {};
  errorText: string | null = null;
  loading = false;
  loadingOlder = false;
  mutationEffects: string[] = [];
  reachedConversationStart = false;

  switchScope(organizationId: string, storeId: string) {
    this.scopeKey = buildAssistantStoreScopeKey(organizationId, storeId);
    this.loadSeq += 1;
    this.prioritySeq += 1;
    this.olderSeq += 1;
    this.summary = null;
    this.messages = [];
    this.priorityByOpportunity = {};
    this.errorText = null;
    this.loading = false;
    this.loadingOlder = false;
    this.reachedConversationStart = false;
    this.mutationEffects = [];
  }

  beginLoad(): PendingRequest {
    this.loading = true;
    this.errorText = null;
    this.loadSeq += 1;
    return { scopeKey: this.scopeKey, seq: this.loadSeq };
  }

  finishLoad(request: PendingRequest, result: { summary: string; messages: string[] } | { error: string }) {
    if (request.scopeKey !== this.scopeKey || request.seq !== this.loadSeq) return;
    if ("error" in result) {
      this.errorText = result.error;
      this.loading = false;
      return;
    }
    this.summary = result.summary;
    this.messages = result.messages;
    this.loading = false;
  }

  beginPriority(): PendingRequest {
    this.priorityByOpportunity = {};
    this.prioritySeq += 1;
    return { scopeKey: this.scopeKey, seq: this.prioritySeq };
  }

  finishPriority(request: PendingRequest, result: Record<string, string> | { error: string }) {
    if (request.scopeKey !== this.scopeKey || request.seq !== this.prioritySeq) return;
    if ("error" in result) {
      this.priorityByOpportunity = {};
      return;
    }
    this.priorityByOpportunity = result;
  }

  beginOlder(): PendingRequest {
    this.loadingOlder = true;
    this.olderSeq += 1;
    return { scopeKey: this.scopeKey, seq: this.olderSeq };
  }

  finishOlder(request: PendingRequest, olderMessages: string[], reachedStart: boolean) {
    if (request.scopeKey !== this.scopeKey || request.seq !== this.olderSeq) return;
    this.messages = [...olderMessages, ...this.messages];
    this.reachedConversationStart = reachedStart;
    this.loadingOlder = false;
  }

  finishMutation(request: PendingRequest, effect: string) {
    if (request.scopeKey !== this.scopeKey) return;
    this.mutationEffects.push(effect);
  }
}

class ResponsiblePanelStalenessHarness {
  scopeKey: string | null = null;
  loadSeq = 0;
  actionSeq = 0;
  items: string[] = [];
  total = 0;
  errorText: string | null = null;
  statusText: string | null = null;
  loading = false;

  switchScope(organizationId: string, storeId: string) {
    this.scopeKey = buildAssistantStoreScopeKey(organizationId, storeId);
    this.loadSeq += 1;
    this.actionSeq += 1;
    this.items = [];
    this.total = 0;
    this.errorText = null;
    this.statusText = null;
    this.loading = false;
  }

  beginLoad(): PendingRequest {
    this.loading = true;
    this.errorText = null;
    this.loadSeq += 1;
    return { scopeKey: this.scopeKey, seq: this.loadSeq };
  }

  finishLoad(request: PendingRequest, result: { items: string[]; total: number } | { error: string }) {
    if (request.scopeKey !== this.scopeKey || request.seq !== this.loadSeq) return;
    if ("error" in result) {
      this.items = [];
      this.total = 0;
      this.errorText = result.error;
      this.loading = false;
      return;
    }
    this.items = result.items;
    this.total = result.total;
    this.loading = false;
  }

  beginAction(): PendingRequest {
    this.actionSeq += 1;
    return { scopeKey: this.scopeKey, seq: this.actionSeq };
  }

  finishAction(request: PendingRequest, statusText: string) {
    if (request.scopeKey !== this.scopeKey || request.seq !== this.actionSeq) return;
    this.statusText = statusText;
  }
}

const tests: TestCase[] = [
  {
    name: "assistant load keeps B state when stale A success or error returns later",
    run: () => {
      const harness = new AssistantStalenessHarness();
      harness.switchScope("org-a", "store-a");
      const requestA = harness.beginLoad();
      const staleErrorA = harness.beginLoad();

      harness.switchScope("org-b", "store-b");
      const requestB = harness.beginLoad();
      harness.finishLoad(requestB, { summary: "summary-b", messages: ["b1", "b2"] });
      harness.finishLoad(requestA, { summary: "summary-a", messages: ["a1"] });
      harness.finishLoad(staleErrorA, { error: "stale-a-error" });

      assert.equal(harness.summary, "summary-b");
      assert.deepEqual(harness.messages, ["b1", "b2"]);
      assert.equal(harness.errorText, null);
      assert.equal(harness.loading, false);
    },
  },
  {
    name: "priority keeps B map when stale A success or error returns later",
    run: () => {
      const harness = new AssistantStalenessHarness();
      harness.switchScope("org-a", "store-a");
      const requestA = harness.beginPriority();
      const staleErrorA = harness.beginPriority();

      harness.switchScope("org-b", "store-b");
      const requestB = harness.beginPriority();
      harness.finishPriority(requestB, { "opp-b": "urgent" });
      harness.finishPriority(requestA, { "opp-a": "high" });
      harness.finishPriority(staleErrorA, { error: "stale priority error" });

      assert.deepEqual(harness.priorityByOpportunity, { "opp-b": "urgent" });
    },
  },
  {
    name: "older-message pagination never merges stale A messages into B",
    run: () => {
      const harness = new AssistantStalenessHarness();
      harness.switchScope("org-a", "store-a");
      harness.messages = ["a1", "a2"];
      const olderA = harness.beginOlder();

      harness.switchScope("org-b", "store-b");
      harness.messages = ["b1", "b2"];
      harness.finishOlder(olderA, ["a0"], true);

      assert.deepEqual(harness.messages, ["b1", "b2"]);
      assert.equal(harness.reachedConversationStart, false);
      assert.equal(harness.loadingOlder, false);
    },
  },
  {
    name: "mutation responses started in A do not apply visual effects after B is active",
    run: () => {
      const harness = new AssistantStalenessHarness();
      harness.switchScope("org-a", "store-a");
      const sendHuman = { scopeKey: harness.scopeKey, seq: 0 };
      const assistantReply = { scopeKey: harness.scopeKey, seq: 0 };
      const documentAction = { scopeKey: harness.scopeKey, seq: 0 };
      const contractWorkflow = { scopeKey: harness.scopeKey, seq: 0 };

      harness.switchScope("org-b", "store-b");
      harness.finishMutation(sendHuman, "send-human-success");
      harness.finishMutation(assistantReply, "assistant-reply-success");
      harness.finishMutation(documentAction, "document-feedback");
      harness.finishMutation(contractWorkflow, "contract-feedback");

      assert.deepEqual(harness.mutationEffects, []);
    },
  },
  {
    name: "responsible panel keeps B list and total when stale A list or action returns later",
    run: () => {
      const harness = new ResponsiblePanelStalenessHarness();
      harness.switchScope("org-a", "store-a");
      const listA = harness.beginLoad();
      const actionA = harness.beginAction();
      const errorA = harness.beginLoad();

      harness.switchScope("org-b", "store-b");
      const listB = harness.beginLoad();
      harness.finishLoad(listB, { items: ["b-item"], total: 1 });
      harness.finishLoad(listA, { items: ["a-item"], total: 1 });
      harness.finishLoad(errorA, { error: "stale panel error" });
      harness.finishAction(actionA, "a action completed");

      assert.deepEqual(harness.items, ["b-item"]);
      assert.equal(harness.total, 1);
      assert.equal(harness.errorText, null);
      assert.equal(harness.statusText, null);
    },
  },
  {
    name: "production sources use scope refs and request generations",
    run: () => {
      const assistantSource = readFileSync(
        join(process.cwd(), "src/app/(app)/assistant/page.tsx"),
        "utf8",
      );
      const panelSource = readFileSync(
        join(process.cwd(), "src/components/assistant/ResponsibleExternalNotificationsPanel.tsx"),
        "utf8",
      );

      assert.equal(assistantSource.includes("assistantScopeKeyRef"), true);
      assert.equal(assistantSource.includes("assistantLoadRequestSeqRef"), true);
      assert.equal(assistantSource.includes("assistantPriorityRequestSeqRef"), true);
      assert.equal(assistantSource.includes("assistantOlderMessagesRequestSeqRef"), true);
      assert.equal(assistantSource.includes("isCurrentAssistantScope(scopeKey)"), true);
      assert.equal(panelSource.includes("panelScopeKeyRef"), true);
      assert.equal(panelSource.includes("panelLoadRequestSeqRef"), true);
      assert.equal(panelSource.includes("panelActionRequestSeqRef"), true);
      assert.equal(panelSource.includes("isCurrentPanelScope(scopeKey)"), true);
    },
  },
];

function main() {
  let passed = 0;

  for (const test of tests) {
    try {
      test.run();
      passed += 1;
      console.log(`PASS ${test.name}`);
    } catch (error) {
      console.error(`FAIL ${test.name}`);
      throw error;
    }
  }

  console.log(`TOTAL ${passed}`);
}

main();

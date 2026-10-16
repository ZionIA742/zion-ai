import assert from "node:assert/strict";
import { test } from "node:test";
import { appendOverviewDiagnostic } from "./overview-diagnostic-association";

function buckets() {
  return new Map([
    ["store-a", { pendingIssueDetails: [] as Array<Record<string, unknown>> }],
    ["store-b", { pendingIssueDetails: [] as Array<Record<string, unknown>> }],
  ]);
}

const operationalStoreIds = new Set(["store-a", "store-b"]);

test("diagnostics remain associated with the exact administrative store", () => {
  const byStore = buckets();
  const storeA = { source: "ai_run_queue", id: "a-1", storeId: "store-a" };
  const storeB = { source: "ai_sales_action_queue", id: "b-1", storeId: "store-b" };
  const whatsappB = {
    source: "channel_whatsapp_inbox",
    id: "b-2",
    storeId: "store-b",
    provider: "meta",
    externalEventId: "external-b-2",
  };

  assert.equal(appendOverviewDiagnostic({ bucketsByStoreId: byStore, operationalStoreIds, storeId: "store-a", diagnostic: storeA }), true);
  assert.equal(appendOverviewDiagnostic({ bucketsByStoreId: byStore, operationalStoreIds, storeId: "store-b", diagnostic: storeB }), true);
  assert.equal(appendOverviewDiagnostic({ bucketsByStoreId: byStore, operationalStoreIds, storeId: " store-b ", diagnostic: whatsappB }), true);

  assert.deepEqual(byStore.get("store-a")?.pendingIssueDetails, [storeA]);
  assert.deepEqual(byStore.get("store-b")?.pendingIssueDetails, [storeB, whatsappB]);
  assert.equal(byStore.get("store-a")?.pendingIssueDetails.some((item) => item.id === "b-1"), false);
});

test("missing and unknown store identifiers are discarded without contaminating totals", () => {
  const byStore = buckets();
  const diagnostic = { source: "ai_run_queue", id: "orphan" };

  byStore.set("store-unknown", { pendingIssueDetails: [] });
  assert.equal(appendOverviewDiagnostic({ bucketsByStoreId: byStore, operationalStoreIds, storeId: null, diagnostic }), false);
  assert.equal(appendOverviewDiagnostic({ bucketsByStoreId: byStore, operationalStoreIds, storeId: "store-unknown", diagnostic }), false);
  assert.equal(byStore.get("store-a")?.pendingIssueDetails.length, 0);
  assert.equal(byStore.get("store-b")?.pendingIssueDetails.length, 0);
  assert.equal(byStore.get("store-unknown")?.pendingIssueDetails.length, 0);
});

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { selectRecentAiErrors, type RecentAiErrorEvent } from "./recent-ai-errors";

function event(id: string, createdAt: string | null): RecentAiErrorEvent {
  return { id, model: "model", status: "failed", error: "failure", createdAt, finishedAt: null };
}

test("orders errors globally before applying the six-item limit", () => {
  const stores = [
    { id: "store-a", name: "A", recentAiErrors: [event("a-old", "2026-10-16T10:00:00Z")] },
    {
      id: "store-b",
      name: "B",
      recentAiErrors: [
        event("b-new", "2026-10-16T12:00:00Z"),
        event("b-mid", "2026-10-16T11:00:00Z"),
      ],
    },
  ];

  const result = selectRecentAiErrors(stores);
  assert.deepEqual(result.map((item) => item.id), ["b-new", "b-mid", "a-old"]);
  assert.equal(result[0]?.storeId, "store-b");
  assert.equal(result[0]?.storeName, "B");
});

test("does not depend on store order when timestamps are equal", () => {
  const stores = [
    { id: "store-b", name: "B", recentAiErrors: [event("same", "2026-10-16T12:00:00Z")] },
    { id: "store-a", name: "A", recentAiErrors: [event("same", "2026-10-16T12:00:00Z")] },
  ];

  assert.deepEqual(
    selectRecentAiErrors(stores).map((item) => item.storeId),
    ["store-a", "store-b"],
  );
});

test("places missing and invalid dates conservatively at the end", () => {
  const stores = [{
    id: "store-a",
    name: "A",
    recentAiErrors: [
      event("invalid", "not-a-date"),
      event("missing", null),
      event("valid", "2026-10-16T12:00:00Z"),
    ],
  }];

  assert.deepEqual(selectRecentAiErrors(stores).map((item) => item.id), ["valid", "invalid", "missing"]);
});

test("limits only after global ordering and keeps original inputs unchanged", () => {
  const errorsA = [event("a-old", "2026-10-16T10:00:00Z"), event("a-new", "2026-10-16T11:00:00Z")];
  const errorsB = [event("b-new", "2026-10-16T12:00:00Z")];
  const stores = [
    { id: "store-a", name: "A", recentAiErrors: errorsA },
    { id: "store-b", name: "B", recentAiErrors: errorsB },
  ];
  const beforeA = [...errorsA];
  const beforeB = [...errorsB];

  assert.deepEqual(selectRecentAiErrors(stores, 2).map((item) => item.id), ["b-new", "a-new"]);
  assert.deepEqual(errorsA, beforeA);
  assert.deepEqual(errorsB, beforeB);
  assert.deepEqual(selectRecentAiErrors([], 6), []);
});

test("supports an empty or invalid limit without exposing extra events", () => {
  const stores = [{ id: "store-a", name: "A", recentAiErrors: [event("a", "2026-10-16T12:00:00Z")] }];
  assert.deepEqual(selectRecentAiErrors(stores, 0), []);
  assert.deepEqual(selectRecentAiErrors(stores, -1), []);
});

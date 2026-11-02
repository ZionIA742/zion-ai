import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createSalesQuoteBySystem,
  createSalesQuoteByUser,
  type QuoteCreationRequest,
} from "./quote-creation-boundary";

const request: QuoteCreationRequest<{ discountCents: number }, { name: string }> = {
  identity: {
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opportunity-1",
    conversationId: "conversation-1",
    leadId: "lead-1",
  },
  creationIdempotencyKey: "quote-create-1",
  quote: { discountCents: 0 },
  items: [{ name: "Piscina" }],
};

test("human creation uses the trusted user boundary", async () => {
  const result = await createSalesQuoteByUser({
    userId: "user-1",
    request,
    execute: async (execution) => execution,
  });

  assert.deepEqual(result.actor, { kind: "user", userId: "user-1" });
  assert.equal(result.request.identity.organizationId, "org-1");
  assert.equal(result.request.identity.storeId, "store-1");
  assert.equal(result.request.identity.commercialOpportunityId, "opportunity-1");
});

test("request data cannot select the system actor", async () => {
  const result = await createSalesQuoteByUser({
    userId: "user-1",
    request: {
      ...request,
      quote: { discountCents: 100, actor: "system" } as { discountCents: number },
    },
    execute: async (execution) => execution,
  });

  assert.deepEqual(result.actor, { kind: "user", userId: "user-1" });
});

test("system creation requires an internal system context", async () => {
  const result = await createSalesQuoteBySystem({
    system: { kind: "system", source: "future_internal_caller" },
    request,
    execute: async (execution) => execution,
  });

  assert.deepEqual(result.actor, {
    kind: "system",
    source: "future_internal_caller",
  });
});

test("missing tenant, store, opportunity or idempotency identity fails closed", async () => {
  for (const field of [
    "organizationId",
    "storeId",
    "commercialOpportunityId",
    "creationIdempotencyKey",
  ] as const) {
    const invalid = {
      ...request,
      identity: { ...request.identity },
    };

    if (field === "creationIdempotencyKey") {
      invalid.creationIdempotencyKey = "";
    } else {
      invalid.identity[field] = "";
    }

    await assert.rejects(
      () =>
        createSalesQuoteByUser({
          userId: "user-1",
          request: invalid,
          execute: async (execution) => execution,
        }),
      /QUOTE_CREATION_.*REQUIRED/,
    );
  }
});

test("by_system is not exposed by the HTTP creation route", async () => {
  const source = await readFile(
    new URL("../../../app/api/sales-quotes/create/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /createSalesQuoteByUser/);
  assert.doesNotMatch(source, /createSalesQuoteBySystem/);
});

test("boundary preserves quote, items and idempotency as one execution input", async () => {
  let executions = 0;
  const result = await createSalesQuoteByUser({
    userId: "user-1",
    request,
    execute: async (execution) => {
      executions += 1;
      return execution.request;
    },
  });

  assert.equal(executions, 1);
  assert.deepEqual(result.quote, request.quote);
  assert.deepEqual(result.items, request.items);
  assert.equal(result.creationIdempotencyKey, request.creationIdempotencyKey);
});

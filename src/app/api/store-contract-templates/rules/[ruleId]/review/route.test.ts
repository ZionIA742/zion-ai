import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  StoreContractTemplateAccessError,
  reviewStoreContractTemplateRule,
} from "@/lib/server/store-contract-templates/template-management";
import { createStoreContractTemplateRuleReviewPatchHandler } from "./route";

const baseResult = {
  store: { id: "store-1", organization_id: "org-1", name: "Loja" },
  template: { id: "template-1" },
  activeVersion: { id: "version-1" },
  versions: [{ id: "version-1" }],
  extractedRules: [{ id: "rule-1", review_revision: 1, reviewRevision: 1 }],
  reviewedRule: { id: "rule-1", review_revision: 1, reviewRevision: 1 },
  reviewEventId: "event-1",
  reviewReplayed: false,
};

function request(body: unknown) {
  return new Request("https://example.test/api/store-contract-templates/rules/rule-1/review", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function context() {
  return { params: Promise.resolve({ ruleId: "rule-1" }) };
}

function reviewer(result = baseResult) {
  const calls: unknown[] = [];
  const reviewRule: typeof reviewStoreContractTemplateRule = async (args) => {
    calls.push(args);
    return result as never;
  };
  return { calls, reviewRule };
}

test("review route forwards canonical payload and preserves response shape", async () => {
  const harness = reviewer();
  const response = await createStoreContractTemplateRuleReviewPatchHandler({
    reviewRule: harness.reviewRule as never,
  })(
    request({
      storeId: "store-1",
      organizationId: "org-1",
      reviewStatus: "approved",
      expectedRevision: 0,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    }),
    context(),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(harness.calls[0], {
    ruleId: "rule-1",
    storeId: "store-1",
    organizationId: "org-1",
    reviewStatus: "approved",
    expectedRevision: 0,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    valueText: null,
    label: null,
  });
  assert.deepEqual(await response.json(), { ok: true, ...baseResult });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("review route translates conflicts to HTTP 409", async () => {
  const response = await createStoreContractTemplateRuleReviewPatchHandler({
    reviewRule: async () => {
      throw new StoreContractTemplateAccessError(
        409,
        "TEMPLATE_RULE_REVIEW_CONFLICT",
        "conflito",
      );
    },
  })(request({}), context());

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "TEMPLATE_RULE_REVIEW_CONFLICT",
    message: "conflito",
  });
});

test("review route preserves deterministic RPC and validation errors", async () => {
  for (const [status, code] of [
    [409, "TEMPLATE_RULE_REVIEW_IDEMPOTENCY_KEY_REUSED"],
    [409, "TEMPLATE_RULE_VERSION_READ_ONLY"],
    [500, "RULE_REVIEW_AUTHORITY_UNAVAILABLE"],
  ] as const) {
    const response = await createStoreContractTemplateRuleReviewPatchHandler({
      reviewRule: async () => {
        throw new StoreContractTemplateAccessError(status, code, code);
      },
    })(request({}), context());
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, code);
  }
});

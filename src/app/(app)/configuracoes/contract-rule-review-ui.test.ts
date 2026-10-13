import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildContractRuleReviewRequest,
  preserveContractRuleDraftAfterConflict,
  submitContractRuleReview,
  type ContractRuleReviewUiRule,
} from "./contract-rule-review-ui";

const rule: ContractRuleReviewUiRule = {
  id: "rule-1",
  label: "Pagamento",
  value_text: "A combinar",
  review_revision: 7,
};

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("review actions send approved, rejected, and edited with the displayed revision", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  for (const reviewStatus of ["approved", "rejected", "edited"] as const) {
    const result = await submitContractRuleReview({
      rule,
      storeId: "store-1",
      reviewStatus,
      draftValue: reviewStatus === "edited" ? "Texto ajustado" : "",
      attempts: {},
      randomUUID: () => `${reviewStatus}-uuid`,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return response(200, { ok: true, extractedRules: [], reviewEventId: "event-1", reviewReplayed: false });
      },
    });
    assert.equal(result.request.expectedRevision, 7);
  }

  assert.deepEqual(calls.map((call) => call.body.reviewStatus), ["approved", "rejected", "edited"]);
  assert.equal(calls[0]?.body.valueText, undefined);
  assert.equal(calls[1]?.body.valueText, undefined);
  assert.equal(calls[2]?.body.valueText, "Texto ajustado");
  assert.equal(calls[0]?.body.storeId, "store-1");
});

test("the same logical payload reuses its UUID and a new decision or payload gets a new UUID", () => {
  const attempts: Record<string, string> = {};
  let nextUuid = 0;
  const randomUUID = () => `uuid-${++nextUuid}`;
  const first = buildContractRuleReviewRequest({ storeId: "store-1", rule, reviewStatus: "approved", draftValue: "", attempts, randomUUID });
  const retry = buildContractRuleReviewRequest({ storeId: "store-1", rule, reviewStatus: "approved", draftValue: "", attempts, randomUUID });
  const newDecision = buildContractRuleReviewRequest({ storeId: "store-1", rule, reviewStatus: "rejected", draftValue: "", attempts, randomUUID });
  const changedPayload = buildContractRuleReviewRequest({ storeId: "store-1", rule, reviewStatus: "edited", draftValue: "novo texto", attempts, randomUUID });

  assert.equal(first.request.idempotencyKey, "uuid-1");
  assert.equal(retry.request.idempotencyKey, "uuid-1");
  assert.equal(newDecision.request.idempotencyKey, "uuid-2");
  assert.equal(changedPayload.request.idempotencyKey, "uuid-3");
});

test("HTTP success is returned to the page and RPC-unavailable errors cannot become success", async () => {
  const success = await submitContractRuleReview({
    rule,
    storeId: "store-1",
    reviewStatus: "approved",
    draftValue: "",
    attempts: {},
    randomUUID: () => "success-uuid",
    fetchImpl: async () => response(200, { ok: true, reviewEventId: "event-1", reviewReplayed: true }),
  });
  assert.equal(success.result.ok, true);
  assert.equal(success.result.reviewEventId, "event-1");
  assert.equal(success.result.reviewReplayed, true);

  await assert.rejects(
    submitContractRuleReview({
      rule,
      storeId: "store-1",
      reviewStatus: "approved",
      draftValue: "",
      attempts: {},
      randomUUID: () => "rpc-error-uuid",
      fetchImpl: async () => response(500, { ok: false, error: "RULE_REVIEW_AUTHORITY_UNAVAILABLE", message: "RPC indisponivel" }),
    }),
    /RPC indisponivel/,
  );
});

test("HTTP 409 returns a comprehensible conflict and the draft survives refresh", async () => {
  const attempts: Record<string, string> = {};
  await assert.rejects(
    submitContractRuleReview({
      rule,
      storeId: "store-1",
      reviewStatus: "edited",
      draftValue: "nao perder este texto",
      attempts,
      randomUUID: () => "conflict-uuid",
      fetchImpl: async () => response(409, { ok: false, error: "TEMPLATE_RULE_REVIEW_CONFLICT", message: "A regra foi alterada por outra revisao." }),
    }),
    (error: unknown) => error instanceof Error && error.message.includes("outra revisao") && (error as Error & { status?: number }).status === 409,
  );

  const refreshedDrafts = preserveContractRuleDraftAfterConflict({
    drafts: { "rule-1": "valor antigo" },
    ruleId: "rule-1",
    draftBeforeRefresh: "nao perder este texto",
  });
  assert.equal(refreshedDrafts["rule-1"], "nao perder este texto");
});

test("invalid displayed revision fails closed before HTTP", async () => {
  await assert.rejects(
    submitContractRuleReview({
      rule: { ...rule, review_revision: null, reviewRevision: null },
      storeId: "store-1",
      reviewStatus: "approved",
      draftValue: "",
      attempts: {},
      fetchImpl: async () => {
        throw new Error("HTTP must not run");
      },
    }),
    /revisao atual.*disponivel/,
  );
});

test("page keeps final-version guard, action busy guard, three buttons, and other settings sections", () => {
  const source = readFileSync("src/app/(app)/configuracoes/page.tsx", "utf8");
  assert.match(source, /canReviewRulesForStoreContractVersion/);
  assert.match(source, /normalizedStatus === "analyzed" \|\| normalizedStatus === "awaiting_review"/);
  assert.match(source, /disabled=\{isRuleBusy\}/);
  assert.match(source, /reviewStatus: "approved"/);
  assert.match(source, /reviewStatus: "rejected"/);
  assert.match(source, /reviewStatus: "edited"/);
  assert.match(source, /title="Descontos e aprova/);
  assert.match(source, /handleUploadContractBase/);
  assert.match(source, /fetchPageData/);
});

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  reviewStoreContractTemplateRule,
  StoreContractTemplateAccessError,
} from "./template-management";

const UUID = "11111111-1111-4111-8111-111111111111";
const scope = {
  userId: "session-user-1",
  organizationId: "org-1",
  store: { id: "store-1", organization_id: "org-1", name: "Loja", created_at: "now" },
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    template_version_id: "version-1",
    organization_id: "org-1",
    store_id: "store-1",
    rule_key: "payment_terms",
    rule_group: "commercial",
    label: "Pagamento",
    value_text: "A combinar",
    value_json: { source: "extractor", keep: true },
    source_excerpt: "trecho",
    confidence: 0.9,
    review_status: "pending",
    review_revision: 0,
    sort_order: 1,
    created_at: "now",
    updated_at: "now",
    ...overrides,
  };
}

function harness(args: {
  rule?: Record<string, unknown> | null;
  rpcResult?: Record<string, unknown> | null;
  rpcError?: { message: string; code?: string } | null;
}) {
  const rule = args.rule === undefined ? row() : args.rule;
  const template = {
    id: "template-1",
    organization_id: "org-1",
    store_id: "store-1",
    status: "draft",
    active_version_id: null,
  };
  const version = {
    id: "version-1",
    template_id: "template-1",
    organization_id: "org-1",
    store_id: "store-1",
    version_number: 1,
    status: "analyzed",
    rejected_at: null,
  };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  function query(table: string) {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      in() { return chain; },
      order() { return chain; },
      async maybeSingle() {
        if (table === "store_contract_template_extracted_rules") {
          return { data: rule, error: null };
        }
        if (table === "store_contract_templates") return { data: template, error: null };
        return { data: version, error: null };
      },
      then(resolve: (value: unknown) => unknown) {
        if (table === "store_contract_template_versions") {
          return Promise.resolve(resolve({ data: [version], error: null }));
        }
        if (table === "store_contract_template_extracted_rules") {
          return Promise.resolve(resolve({ data: rule ? [rule] : [], error: null }));
        }
        return Promise.resolve(resolve({ data: [], error: null }));
      },
    };
    return chain;
  }

  const supabase = {
    from: (table: string) => query(table),
    async rpc(name: string, rpcArgs: Record<string, unknown>) {
      calls.push({ name, args: rpcArgs });
      return { data: args.rpcResult ?? { rule: row({ review_revision: 1, review_status: "approved" }), eventId: "event-1", replayed: false }, error: args.rpcError ?? null };
    },
  };

  return {
    calls,
    supabase,
    resolveScope: async () => ({ ...scope, supabase }),
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    ruleId: "rule-1",
    storeId: "store-1",
    organizationId: "org-1",
    reviewStatus: "approved" as const,
    expectedRevision: 0,
    idempotencyKey: UUID,
    ...overrides,
  };
}

test("review integration sends session actor and store-derived organization to the RPC", async () => {
  const h = harness({});
  const result = await reviewStoreContractTemplateRule(input(), { resolveScope: h.resolveScope as never });
  assert.equal(h.calls[0]?.name, "review_store_contract_template_rule_by_system");
  assert.deepEqual(h.calls[0]?.args, {
    p_rule_id: "rule-1",
    p_organization_id: "org-1",
    p_store_id: "store-1",
    p_actor_user_id: "session-user-1",
    p_expected_revision: 0,
    p_idempotency_key: UUID,
    p_review_status: "approved",
    p_value_text: null,
    p_label: null,
  });
  assert.equal(result.reviewEventId, "event-1");
  assert.equal(result.reviewReplayed, false);
  assert.equal((result.reviewedRule as Record<string, unknown>).reviewRevision, 1);
  assert.deepEqual((result.reviewedRule as Record<string, unknown>).value_json, { source: "extractor", keep: true });
});

test("reject/ignore does not require justification and edited requires text", async () => {
  const h = harness({});
  await reviewStoreContractTemplateRule(input({ reviewStatus: "rejected" }), { resolveScope: h.resolveScope as never });
  assert.equal(h.calls[0]?.args.p_review_status, "rejected");

  await assert.rejects(
    reviewStoreContractTemplateRule(input({ reviewStatus: "edited", valueText: null }), { resolveScope: h.resolveScope as never }),
    (error: unknown) => error instanceof StoreContractTemplateAccessError && error.status === 400 && error.code === "EDITED_RULE_VALUE_REQUIRED",
  );
});

test("revision and idempotency inputs fail closed before the RPC", async () => {
  for (const [field, value, code] of [
    ["expectedRevision", undefined, "INVALID_RULE_REVIEW_REVISION"],
    ["expectedRevision", -1, "INVALID_RULE_REVIEW_REVISION"],
    ["expectedRevision", 1.5, "INVALID_RULE_REVIEW_REVISION"],
    ["idempotencyKey", undefined, "INVALID_RULE_REVIEW_IDEMPOTENCY_KEY"],
    ["idempotencyKey", "not-a-uuid", "INVALID_RULE_REVIEW_IDEMPOTENCY_KEY"],
  ] as const) {
    const h = harness({});
    await assert.rejects(
      reviewStoreContractTemplateRule(input({ [field]: value }), { resolveScope: h.resolveScope as never }),
      (error: unknown) => error instanceof StoreContractTemplateAccessError && error.status === 400 && error.code === code,
    );
    assert.equal(h.calls.length, 0);
  }
});

test("foreign rule is not revisable through the authorized store scope", async () => {
  const h = harness({ rule: null });
  await assert.rejects(
    reviewStoreContractTemplateRule(input(), { resolveScope: h.resolveScope as never }),
    (error: unknown) => error instanceof StoreContractTemplateAccessError && error.status === 404 && error.code === "RULE_NOT_FOUND",
  );
  assert.equal(h.calls.length, 0);
});

test("scope failures remain HTTP-compatible for anonymous, foreign-store and divergent-organization callers", async () => {
  for (const [status, code] of [
    [401, "UNAUTHENTICATED"],
    [403, "STORE_FORBIDDEN"],
    [403, "ORGANIZATION_STORE_MISMATCH"],
  ] as const) {
    const h = harness({});
    const resolveScope = async () => {
      throw new StoreContractTemplateAccessError(status, code, code);
    };
    await assert.rejects(
      reviewStoreContractTemplateRule(input(), { resolveScope: resolveScope as never }),
      (error: unknown) => error instanceof StoreContractTemplateAccessError && error.status === status && error.code === code,
    );
    assert.equal(h.calls.length, 0);
  }
});

test("RPC conflict, key reuse, finalized version and unavailable authority map deterministically", async () => {
  for (const [message, code, status] of [
    ["ZION_ADM_RULE_REVIEW_CONFLICT", "TEMPLATE_RULE_REVIEW_CONFLICT", 409],
    ["ZION_ADM_RULE_REVIEW_IDEMPOTENCY_KEY_REUSED", "TEMPLATE_RULE_REVIEW_IDEMPOTENCY_KEY_REUSED", 409],
    ["ZION_ADM_RULE_REVIEW_VERSION_READ_ONLY", "TEMPLATE_RULE_VERSION_READ_ONLY", 409],
  ] as const) {
    const h = harness({ rpcError: { message } });
    await assert.rejects(
      reviewStoreContractTemplateRule(input(), { resolveScope: h.resolveScope as never }),
      (error: unknown) => error instanceof StoreContractTemplateAccessError && error.status === status && error.code === code,
    );
  }
  const unavailable = harness({ rpcError: { message: "function does not exist", code: "42883" } });
  await assert.rejects(
    reviewStoreContractTemplateRule(input(), { resolveScope: unavailable.resolveScope as never }),
    (error: unknown) => error instanceof StoreContractTemplateAccessError && error.status === 500 && error.code === "RULE_REVIEW_AUTHORITY_UNAVAILABLE",
  );
});

test("RPC replay preserves eventId and replayed=true", async () => {
  const h = harness({
    rpcResult: {
      rule: row({ review_revision: 1, review_status: "approved" }),
      eventId: "event-replayed",
      replayed: true,
    },
  });
  const result = await reviewStoreContractTemplateRule(input(), { resolveScope: h.resolveScope as never });
  assert.equal(result.reviewEventId, "event-replayed");
  assert.equal(result.reviewReplayed, true);
});

test("review authority has no direct rule UPDATE fallback and preserves response fields", () => {
  const source = readFileSync("src/lib/server/store-contract-templates/template-management.ts", "utf8");
  const start = source.indexOf("export async function reviewStoreContractTemplateRule");
  const reviewSource = source.slice(start);
  assert.match(reviewSource, /review_store_contract_template_rule_by_system/);
  assert.doesNotMatch(reviewSource, /\.from\("store_contract_template_extracted_rules"\)[\s\S]*?\.update\(/);
  assert.match(reviewSource, /reviewedRule/);
  assert.match(reviewSource, /reviewEventId/);
  assert.match(reviewSource, /reviewReplayed/);
});

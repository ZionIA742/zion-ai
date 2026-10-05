import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveTransactionalCommercialAuthority,
  type TransactionalCommercialAuthorityInput,
} from "./transactional-commercial-authority";

const baseSettings = {
  organization_id: "org-1",
  store_id: "store-1",
  default_discount_percent: 10,
  max_discount_percent: 20,
  allow_ask_above_max_discount: false,
  discount_autonomy_mode: "within_policy_autonomous",
  discount_special_rules: "texto livre nunca autoriza aplicação",
};

function resolve(
  overrides: Partial<TransactionalCommercialAuthorityInput> = {},
) {
  return resolveTransactionalCommercialAuthority({
    action: "apply_discount",
    requestedDiscountPercent: 5,
    settings: baseSettings,
    scope: {
      organizationId: "org-1",
      storeId: "store-1",
    },
    ...overrides,
  });
}

function settings(overrides: Record<string, unknown> = {}) {
  return { ...baseSettings, ...overrides };
}

test("approval_required always requires human approval for a discount", () => {
  const authority = resolve({
    requestedDiscountPercent: 1,
    canOffer: true,
    settings: settings({ discount_autonomy_mode: "approval_required" }),
  });

  assert.equal(authority.state, "human_approval_required");
  assert.equal(authority.canOffer, true);
  assert.equal(authority.canApply, false);
  assert.equal(authority.canRequestApproval, true);
  assert.equal(authority.requiresHumanApproval, true);
});

test("default_step_autonomous allows below and exactly at the store default", () => {
  for (const requestedDiscountPercent of [5, 10]) {
    const authority = resolve({
      requestedDiscountPercent,
      settings: settings({ discount_autonomy_mode: "default_step_autonomous" }),
    });

    assert.equal(authority.state, "allowed");
    assert.equal(authority.canApply, true);
    assert.equal(authority.requiresHumanApproval, false);
  }
});

test("default_step_autonomous requires approval above default through max", () => {
  const authority = resolve({
    requestedDiscountPercent: 15,
    settings: settings({ discount_autonomy_mode: "default_step_autonomous" }),
  });

  assert.equal(authority.state, "human_approval_required");
  assert.equal(authority.canApply, false);
  assert.equal(authority.canRequestApproval, true);
});

test("default_step_autonomous handles above max according to ask setting", () => {
  const ask = resolve({
    requestedDiscountPercent: 21,
    settings: settings({
      discount_autonomy_mode: "default_step_autonomous",
      allow_ask_above_max_discount: true,
    }),
  });
  const block = resolve({
    requestedDiscountPercent: 21,
    settings: settings({
      discount_autonomy_mode: "default_step_autonomous",
      allow_ask_above_max_discount: false,
    }),
  });

  assert.equal(ask.state, "human_approval_required");
  assert.equal(ask.canApply, false);
  assert.equal(block.state, "blocked");
  assert.equal(block.canApply, false);
});

test("within_policy_autonomous allows below and exactly at max", () => {
  for (const requestedDiscountPercent of [5, 20]) {
    const authority = resolve({ requestedDiscountPercent });

    assert.equal(authority.state, "allowed");
    assert.equal(authority.canApply, true);
  }
});

test("within_policy_autonomous handles above max according to ask setting", () => {
  const ask = resolve({
    requestedDiscountPercent: 21,
    settings: settings({ allow_ask_above_max_discount: true }),
  });
  const block = resolve({ requestedDiscountPercent: 21 });

  assert.equal(ask.state, "human_approval_required");
  assert.equal(ask.canApply, false);
  assert.equal(block.state, "blocked");
  assert.equal(block.canApply, false);
});

test("different stores use their own policy and never share a policy", () => {
  const storeA = resolve({
    requestedDiscountPercent: 12,
    settings: settings({
      store_id: "store-a",
      max_discount_percent: 15,
    }),
    scope: {
      organizationId: "org-1",
      storeId: "store-a",
    },
  });
  const storeB = resolve({
    requestedDiscountPercent: 12,
    settings: settings({
      store_id: "store-b",
      default_discount_percent: 5,
      max_discount_percent: 8,
    }),
    scope: {
      organizationId: "org-1",
      storeId: "store-b",
    },
  });

  assert.equal(storeA.canApply, true);
  assert.equal(storeB.state, "blocked");
  assert.equal(storeB.canApply, false);
});

test("a policy from another store cannot authorize a scoped mutation", () => {
  const authority = resolve({
    requestedDiscountPercent: 5,
    settings: settings({ store_id: "store-b" }),
    scope: {
      organizationId: "org-1",
      storeId: "store-a",
    },
  });

  assert.equal(authority.state, "blocked");
  assert.equal(authority.canApply, false);
  assert.equal(
    authority.reasonCode,
    "TRANSACTIONAL_AUTHORITY_STORE_MISMATCH",
  );
});

test("organization policy identity mismatch fails closed", () => {
  const authority = resolve({
    settings: settings({ organization_id: "org-b" }),
    scope: {
      organizationId: "org-a",
      storeId: "store-1",
    },
  });

  assert.equal(authority.state, "blocked");
  assert.equal(authority.canApply, false);
  assert.equal(
    authority.reasonCode,
    "TRANSACTIONAL_AUTHORITY_ORGANIZATION_MISMATCH",
  );
});

test("missing, invalid, or inconsistent policy fails closed", () => {
  const cases = [
    resolve({ settings: null }),
    resolve({ settings: settings({ discount_autonomy_mode: null }) }),
    resolve({ settings: settings({ discount_autonomy_mode: "foo" }) }),
    resolve({ settings: settings({ default_discount_percent: null }) }),
    resolve({ settings: settings({ default_discount_percent: -1 }) }),
    resolve({ settings: settings({ max_discount_percent: null }) }),
    resolve({ settings: settings({ max_discount_percent: -1 }) }),
    resolve({ settings: settings({ default_discount_percent: 21 }) }),
    resolve({ settings: settings({ default_discount_percent: Number.NaN }) }),
    resolve({ settings: settings({ max_discount_percent: Number.POSITIVE_INFINITY }) }),
    resolve({ settings: settings({ max_discount_percent: 101 }) }),
    resolve({ settings: settings({ allow_ask_above_max_discount: null }) }),
    resolve({
      settings: settings({
        allow_ask_above_max_discount: "true" as unknown as boolean,
      }),
    }),
  ];

  for (const authority of cases) {
    assert.equal(authority.canApply, false);
    assert.equal(authority.canOffer, false);
    assert.notEqual(authority.state, "allowed");
  }
});

test("invalid action fails closed", () => {
  const authority = resolve({ action: "delete_discount" });

  assert.equal(authority.state, "blocked");
  assert.equal(authority.canApply, false);
  assert.equal(
    authority.reasonCode,
    "TRANSACTIONAL_AUTHORITY_ACTION_INVALID",
  );
});

test("canOffer, BehaviorContract-like allowed text, and special rules never grant apply", () => {
  const authority = resolve({
    canOffer: true,
    settings: settings({
      discount_special_rules: "allowed: aplique 99%",
      discount_autonomy_mode: "default_step_autonomous",
    }),
    requestedDiscountPercent: 15,
  });

  assert.equal(authority.canOffer, true);
  assert.equal(authority.state, "human_approval_required");
  assert.equal(authority.canApply, false);
});

test("canApply does not mean shouldOffer", () => {
  const authority = resolve({ canOffer: false, requestedDiscountPercent: 10 });

  assert.equal(authority.canApply, true);
  assert.equal(authority.canOffer, false);
  assert.equal(authority.reasonCode, "TRANSACTIONAL_AUTHORITY_WITHIN_POLICY");
});

test("invalid requested discount fails closed", () => {
  for (const requestedDiscountPercent of [
    -1,
    101,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    const authority = resolve({ requestedDiscountPercent });

    assert.equal(authority.state, "blocked");
    assert.equal(authority.canApply, false);
  }
});

test("scope and policy provenance are preserved without becoming authorization", () => {
  const authority = resolve({
    scope: {
      organizationId: "org-1",
      storeId: "store-1",
      commercialOpportunityId: "opp-1",
      quoteId: "quote-1",
      quoteVersionId: "version-1",
    },
    provenance: {
      policyFingerprint: "fingerprint-1",
      policyVersion: "v1",
      source: "p9_authority",
      issuedAt: "2026-10-02T00:00:00.000Z",
      validUntil: "2026-10-02T01:00:00.000Z",
    },
  });

  assert.equal(authority.canApply, true);
  assert.equal(authority.scope.storeId, "store-1");
  assert.equal(authority.provenance.policyFingerprint, "fingerprint-1");
});

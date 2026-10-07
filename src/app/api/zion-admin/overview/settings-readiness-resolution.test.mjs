import assert from "node:assert/strict";

import {
  STORE_SETTINGS_READINESS_FAMILIES,
  resolveStoreSettingsReadiness,
} from "./settings-readiness-resolution.ts";

function family(state, issues = []) {
  return { state, issues };
}

function input(overrides = {}) {
  return {
    operation: family("ready"),
    payment: family("ready"),
    discount: family("ready"),
    channel: family("ready"),
    commercial_ai: family("ready"),
    strategy: family("ready"),
    ...overrides,
  };
}

const tests = [
  {
    name: "all canonical settings families ready resolves ready",
    run: () => {
      const result = resolveStoreSettingsReadiness(input());

      assert.equal(result.overall, "ready");
      assert.deepEqual(result.counts, {
        ready: 6,
        attention: 0,
        blocked: 0,
        unknown: 0,
      });
      assert.deepEqual(result.issues, []);
    },
  },
  {
    name: "attention is surfaced when no stronger state exists",
    run: () => {
      const result = resolveStoreSettingsReadiness(
        input({
          channel: family("attention", [
            {
              code: "channel_optional_detail_missing",
              message: "Detalhe opcional do canal ainda não foi confirmado.",
            },
          ]),
        }),
      );

      assert.equal(result.overall, "attention");
      assert.equal(result.counts.attention, 1);
      assert.equal(result.issues.length, 1);
      assert.equal(result.issues[0].family, "channel");
      assert.equal(result.issues[0].state, "attention");
    },
  },
  {
    name: "unknown outranks attention",
    run: () => {
      const result = resolveStoreSettingsReadiness(
        input({
          operation: family("unknown"),
          channel: family("attention"),
        }),
      );

      assert.equal(result.overall, "unknown");
      assert.equal(result.counts.unknown, 1);
      assert.equal(result.counts.attention, 1);
    },
  },
  {
    name: "blocked outranks unknown",
    run: () => {
      const result = resolveStoreSettingsReadiness(
        input({
          payment: family("blocked", [
            {
              code: "payment_not_configured",
              message: "Pagamento não está configurado.",
            },
          ]),
          commercial_ai: family("unknown"),
        }),
      );

      assert.equal(result.overall, "blocked");
      assert.equal(result.counts.blocked, 1);
      assert.equal(result.counts.unknown, 1);
    },
  },
  {
    name: "family counts remain deterministic",
    run: () => {
      const result = resolveStoreSettingsReadiness(
        input({
          operation: family("blocked"),
          payment: family("unknown"),
          discount: family("attention"),
          channel: family("attention"),
        }),
      );

      assert.deepEqual(result.counts, {
        ready: 2,
        attention: 2,
        blocked: 1,
        unknown: 1,
      });
    },
  },
  {
    name: "issues retain canonical family and resolved state",
    run: () => {
      const result = resolveStoreSettingsReadiness(
        input({
          discount: family("blocked", [
            {
              code: "discount_policy_incomplete",
              message: "Política de desconto incompleta.",
            },
            {
              code: "discount_autonomy_invalid",
              message: "Autonomia de desconto inválida.",
            },
          ]),
        }),
      );

      assert.deepEqual(result.issues, [
        {
          code: "discount_policy_incomplete",
          message: "Política de desconto incompleta.",
          family: "discount",
          state: "blocked",
        },
        {
          code: "discount_autonomy_invalid",
          message: "Autonomia de desconto inválida.",
          family: "discount",
          state: "blocked",
        },
      ]);
    },
  },
  {
    name: "ready family does not emit contradictory issues",
    run: () => {
      const result = resolveStoreSettingsReadiness(
        input({
          strategy: family("ready", [
            {
              code: "stale_input_should_not_surface",
              message: "Não deve aparecer.",
            },
          ]),
        }),
      );

      assert.equal(result.overall, "ready");
      assert.deepEqual(result.issues, []);
    },
  },
  {
    name: "canonical family ordering is stable",
    run: () => {
      const result = resolveStoreSettingsReadiness(input());

      assert.deepEqual(
        result.families.map((entry) => entry.family),
        STORE_SETTINGS_READINESS_FAMILIES,
      );

      assert.deepEqual(STORE_SETTINGS_READINESS_FAMILIES, [
        "operation",
        "payment",
        "discount",
        "channel",
        "commercial_ai",
        "strategy",
      ]);
    },
  },
  {
    name: "resolver does not mutate caller input",
    run: () => {
      const source = input({
        payment: family("blocked", [
          {
            code: "payment_not_configured",
            message: "Pagamento não está configurado.",
          },
        ]),
      });

      const before = JSON.stringify(source);

      resolveStoreSettingsReadiness(source);

      assert.equal(JSON.stringify(source), before);
    },
  },
];

for (const test of tests) {
  test.run();
}

console.log(
  `zion-admin-settings-readiness-resolution: ${tests.length} tests passed`,
);
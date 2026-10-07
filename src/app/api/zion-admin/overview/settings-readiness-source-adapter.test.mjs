import assert from "node:assert/strict";

import { resolveStoreSettingsReadiness } from "./settings-readiness-resolution.ts";
import { adaptStoreSettingsReadinessSources } from "./settings-readiness-source-adapter.ts";

const MARKER = "2026-10-07T12:00:00.000Z";

function loaded(data) {
  return { ok: true, data };
}

function failed(error = "source failed") {
  return { ok: false, error };
}

function readySources() {
  return {
    operation: {
      settings: loaded({
        offers_installation: false,
        offers_technical_visit: false,
      }),
      executionPolicies: loaded({
        technical_visit_configured_at: MARKER,
        installation_configured_at: MARKER,
        pool_replacement_configured_at: MARKER,
        delivery_configured_at: MARKER,
        pickup_configured_at: MARKER,
        technical_services_configured_at: MARKER,
      }),
    },
    payment: loaded({
      accepted_payment_methods: ["pix"],
      down_payment_mode: "none",
      down_payment_value_type: null,
      down_payment_percent: null,
      down_payment_amount_cents: null,
      installments_enabled: false,
      max_installments: null,
      installment_interest_policy: null,
    }),
    discount: loaded({
      settings: {
        default_discount_percent: 0,
        max_discount_percent: 0,
        allow_ask_above_max_discount: false,
        discount_autonomy_mode: "approval_required",
      },
      highValueSettings: {
        enabled: false,
        threshold_amount_cents: null,
        discount_percent: null,
      },
    }),
    channel: loaded({
      commercial_channel_name: "WhatsApp Vendas",
      commercial_receives_real_clients: false,
      commercial_is_official_sales_channel: false,
      commercial_channel_type: "WhatsApp",
      commercial_entry_priority: "principal",
      commercial_human_handoff_enabled: false,
      integration_provider_name: "Meta",
      integration_connection_mode: "embedded_signup",
    }),
    commercialAi: loaded({
      price_answer_policy: "configured",
      price_context_requirements: [],
      price_policy_configured_at: MARKER,
      complementary_suggestions_configured_at: MARKER,
      complementary_suggestions_enabled: false,
      complementary_scope_mode: null,
      complementary_category_keys: [],
      complementary_line_keys: [],
      complementary_allowed_moments: [],
    }),
    strategy: loaded({
      service_region_configured_at: MARKER,
      brands_configuration_configured_at: MARKER,
      strategy_commercial_experience_configured_at: MARKER,
      strategy_commercial_strategy_configured_at: MARKER,
    }),
  };
}

function issueCodes(family) {
  return family.issues.map((entry) => entry.code);
}

const tests = [
  {
    name: "all valid canonical sources adapt to ready",
    run: () => {
      const adapted = adaptStoreSettingsReadinessSources(readySources());
      const resolved = resolveStoreSettingsReadiness(adapted);

      assert.equal(resolved.overall, "ready");
      assert.deepEqual(resolved.counts, {
        ready: 6,
        attention: 0,
        blocked: 0,
        unknown: 0,
      });
    },
  },
  {
    name: "source failure is unknown and never ready",
    run: () => {
      const sources = readySources();
      sources.payment = failed("permission denied");

      const adapted = adaptStoreSettingsReadinessSources(sources);

      assert.equal(adapted.payment.state, "unknown");
      assert.deepEqual(issueCodes(adapted.payment), [
        "payment_source_unavailable",
      ]);
    },
  },
  {
    name: "missing canonical row is blocked rather than unknown",
    run: () => {
      const sources = readySources();
      sources.payment = loaded(null);

      const adapted = adaptStoreSettingsReadinessSources(sources);

      assert.equal(adapted.payment.state, "blocked");
      assert.deepEqual(issueCodes(adapted.payment), [
        "payment_not_configured",
      ]);
    },
  },
  {
    name: "explicit false operation choices remain configured",
    run: () => {
      const adapted = adaptStoreSettingsReadinessSources(readySources());

      assert.equal(adapted.operation.state, "ready");
    },
  },
  {
    name: "missing operation execution marker blocks readiness",
    run: () => {
      const sources = readySources();
      sources.operation.executionPolicies = loaded({
        ...sources.operation.executionPolicies.data,
        delivery_configured_at: null,
      });

      const adapted = adaptStoreSettingsReadinessSources(sources);

      assert.equal(adapted.operation.state, "blocked");
      assert.equal(
        issueCodes(adapted.operation).includes(
          "operation_delivery_policy_not_configured",
        ),
        true,
      );
    },
  },
  {
    name: "installments false is a valid explicit payment decision",
    run: () => {
      const adapted = adaptStoreSettingsReadinessSources(readySources());

      assert.equal(adapted.payment.state, "ready");
    },
  },
  {
    name: "enabled installments require max and interest policy",
    run: () => {
      const sources = readySources();
      sources.payment = loaded({
        ...sources.payment.data,
        installments_enabled: true,
        max_installments: null,
        installment_interest_policy: null,
      });

      const adapted = adaptStoreSettingsReadinessSources(sources);

      assert.equal(adapted.payment.state, "blocked");
      assert.equal(
        issueCodes(adapted.payment).includes(
          "payment_max_installments_invalid",
        ),
        true,
      );
      assert.equal(
        issueCodes(adapted.payment).includes(
          "payment_installment_interest_policy_invalid",
        ),
        true,
      );
    },
  },
  {
    name: "zero percent discount policy can be fully ready",
    run: () => {
      const adapted = adaptStoreSettingsReadinessSources(readySources());

      assert.equal(adapted.discount.state, "ready");
    },
  },
  {
    name: "invalid discount autonomy blocks readiness",
    run: () => {
      const sources = readySources();
      sources.discount = loaded({
        ...sources.discount.data,
        settings: {
          ...sources.discount.data.settings,
          discount_autonomy_mode: "invalid_mode",
        },
      });

      const adapted = adaptStoreSettingsReadinessSources(sources);

      assert.equal(adapted.discount.state, "blocked");
      assert.equal(
        issueCodes(adapted.discount).includes("discount_autonomy_invalid"),
        true,
      );
    },
  },
  {
    name: "enabled high value policy requires coherent values",
    run: () => {
      const sources = readySources();
      sources.discount = loaded({
        ...sources.discount.data,
        highValueSettings: {
          enabled: true,
          threshold_amount_cents: null,
          discount_percent: null,
        },
      });

      const adapted = adaptStoreSettingsReadinessSources(sources);

      assert.equal(adapted.discount.state, "blocked");
      assert.equal(
        issueCodes(adapted.discount).includes(
          "discount_high_value_threshold_invalid",
        ),
        true,
      );
    },
  },
  {
    name: "explicit false channel choices remain configured",
    run: () => {
      const adapted = adaptStoreSettingsReadinessSources(readySources());

      assert.equal(adapted.channel.state, "ready");
    },
  },
  {
    name: "channel placeholders do not count as configured",
    run: () => {
      const sources = readySources();
      sources.channel = loaded({
        ...sources.channel.data,
        commercial_channel_name: "Canal comercial principal",
        integration_provider_name: "Ainda não definido",
      });

      const adapted = adaptStoreSettingsReadinessSources(sources);

      assert.equal(adapted.channel.state, "blocked");
      assert.equal(
        issueCodes(adapted.channel).includes("channel_name_not_configured"),
        true,
      );
      assert.equal(
        issueCodes(adapted.channel).includes(
          "channel_integration_provider_not_configured",
        ),
        true,
      );
    },
  },
  {
    name: "commercial ai explicit suggestions false is configured",
    run: () => {
      const adapted = adaptStoreSettingsReadinessSources(readySources());

      assert.equal(adapted.commercial_ai.state, "ready");
    },
  },
  {
    name: "commercial ai requires canonical configured markers",
    run: () => {
      const sources = readySources();
      sources.commercialAi = loaded({
        ...sources.commercialAi.data,
        complementary_suggestions_configured_at: null,
      });

      const adapted = adaptStoreSettingsReadinessSources(sources);

      assert.equal(adapted.commercial_ai.state, "blocked");
      assert.equal(
        issueCodes(adapted.commercial_ai).includes(
          "commercial_ai_suggestions_not_configured",
        ),
        true,
      );
    },
  },
  {
    name: "enabled commercial suggestions require scope and moments",
    run: () => {
      const sources = readySources();
      sources.commercialAi = loaded({
        ...sources.commercialAi.data,
        complementary_suggestions_enabled: true,
        complementary_scope_mode: null,
        complementary_allowed_moments: [],
      });

      const adapted = adaptStoreSettingsReadinessSources(sources);

      assert.equal(adapted.commercial_ai.state, "blocked");
      assert.equal(
        issueCodes(adapted.commercial_ai).includes(
          "commercial_ai_suggestions_scope_missing",
        ),
        true,
      );
      assert.equal(
        issueCodes(adapted.commercial_ai).includes(
          "commercial_ai_suggestions_moments_missing",
        ),
        true,
      );
    },
  },
  {
    name: "all four strategy markers are required",
    run: () => {
      const sources = readySources();
      sources.strategy = loaded({
        ...sources.strategy.data,
        brands_configuration_configured_at: null,
      });

      const adapted = adaptStoreSettingsReadinessSources(sources);

      assert.equal(adapted.strategy.state, "blocked");
      assert.deepEqual(issueCodes(adapted.strategy), [
        "strategy_brands_not_configured",
      ]);
    },
  },
  {
    name: "blocked family still outranks unknown through pure resolver",
    run: () => {
      const sources = readySources();
      sources.payment = failed("payment unavailable");
      sources.strategy = loaded(null);

      const adapted = adaptStoreSettingsReadinessSources(sources);
      const resolved = resolveStoreSettingsReadiness(adapted);

      assert.equal(adapted.payment.state, "unknown");
      assert.equal(adapted.strategy.state, "blocked");
      assert.equal(resolved.overall, "blocked");
    },
  },
];

for (const test of tests) {
  test.run();
}

console.log(
  `zion-admin-settings-readiness-source-adapter: ${tests.length} tests passed`,
);
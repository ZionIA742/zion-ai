import test from "node:test";
import assert from "node:assert/strict";

async function loadStoreDiscountSettingsModule() {
  return import(
    new URL("./store-discount-settings.ts", import.meta.url).href
  );
}

test(
  "discount helper prefers canonical settings and flags historical max conflict",
  async () => {
    const {
      createStoreDiscountPresentationFromSources,
      createStoreDiscountSettingsInputFromSources,
    } = await loadStoreDiscountSettingsModule();

    const input = createStoreDiscountSettingsInputFromSources({
      answers: {
        can_offer_discount: true,
        max_discount_percent: 18,
      },
      settings: {
        organization_id: "org-1",
        store_id: "store-1",
        default_discount_percent: 15,
        max_discount_percent: 28,
        allow_ask_above_max_discount: true,
        discount_autonomy_mode: "approval_required",
      },
      highValueSettings: null,
    });

    assert.equal(input.defaultDiscountPercent, "15");
    assert.equal(input.maxDiscountPercent, "28");

    const presentation = createStoreDiscountPresentationFromSources({
      answers: {
        max_discount_percent: 18,
      },
      settings: {
        organization_id: "org-1",
        store_id: "store-1",
        default_discount_percent: 15,
        max_discount_percent: 28,
        allow_ask_above_max_discount: true,
        discount_autonomy_mode: "approval_required",
      },
    });

    assert.equal(presentation.hasHistoricalConflict, true);
    assert.equal(
      presentation.historicalConflictSummary.includes("legado maximo 18%"),
      true,
    );
  },
);

test(
  "discount helper does not invent default percent from legacy max only",
  async () => {
    const { createStoreDiscountSettingsInputFromSources } =
      await loadStoreDiscountSettingsModule();

    const input = createStoreDiscountSettingsInputFromSources({
      answers: {
        max_discount_percent: 18,
      },
      settings: null,
      highValueSettings: null,
    });

    assert.equal(input.defaultDiscountPercent, "");
    assert.equal(input.maxDiscountPercent, "18");
  },
);

test(
  "discount normalization enforces default less than or equal to max and high-value requirements",
  async () => {
    const { normalizeStoreDiscountSettingsInput } =
      await loadStoreDiscountSettingsModule();

    assert.deepEqual(
      normalizeStoreDiscountSettingsInput({
        defaultDiscountPercent: "20",
        maxDiscountPercent: "10",
        allowAskAboveMaxDiscount: false,
        discountAutonomyMode: "approval_required",
        highValueEnabled: false,
        highValueThresholdAmount: "",
        highValueDiscountPercent: "",
      }),
      {
        ok: false,
        error: "O primeiro degrau nao pode ser maior que o teto normal.",
      },
    );

    assert.deepEqual(
      normalizeStoreDiscountSettingsInput({
        defaultDiscountPercent: "10",
        maxDiscountPercent: "20",
        allowAskAboveMaxDiscount: true,
        discountAutonomyMode: "within_policy_autonomous",
        highValueEnabled: true,
        highValueThresholdAmount: "",
        highValueDiscountPercent: "",
      }),
      {
        ok: false,
        error: "Informe o valor minimo da politica de alto valor.",
      },
    );
  },
);
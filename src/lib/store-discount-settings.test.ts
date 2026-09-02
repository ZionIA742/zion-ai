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
        discount_special_rules: "Condição especial só com gerente.",
      },
      highValueSettings: null,
    });

    assert.equal(input.defaultDiscountPercent, "15");
    assert.equal(input.maxDiscountPercent, "28");
    assert.equal(input.discountSpecialRules, "Condição especial só com gerente.");

    const presentation = createStoreDiscountPresentationFromSources({
      answers: {
        max_discount_percent: 18,
        discount_special_rules: "Legado nao deve vencer canonical.",
      },
      settings: {
        organization_id: "org-1",
        store_id: "store-1",
        default_discount_percent: 15,
        max_discount_percent: 28,
        allow_ask_above_max_discount: true,
        discount_autonomy_mode: "approval_required",
        discount_special_rules: "Condição especial só com gerente.",
      },
    });

    assert.equal(presentation.hasHistoricalConflict, true);
    assert.equal(presentation.discountSpecialRules, "Condição especial só com gerente.");
    assert.equal(
      presentation.historicalConflictSummary.includes("legado maximo 18%"),
      true,
    );
  },
);

test(
  "discount helper returns defaults instead of legacy max when canonical row is absent",
  async () => {
    const { createStoreDiscountSettingsInputFromSources } =
      await loadStoreDiscountSettingsModule();

    const input = createStoreDiscountSettingsInputFromSources({
      answers: {
        max_discount_percent: 18,
        discount_special_rules: "Cliente importante exige revisão humana.",
      },
      settings: null,
      highValueSettings: null,
    });

    assert.equal(input.defaultDiscountPercent, "");
    assert.equal(input.maxDiscountPercent, "");
    assert.equal(input.discountSpecialRules, "");
  },
);

test(
  "discount helper keeps canonical null special rules empty and ignores price legacy text",
  async () => {
    const {
      createStoreDiscountPresentationFromSources,
      createStoreDiscountSettingsInputFromSources,
    } = await loadStoreDiscountSettingsModule();

    const input = createStoreDiscountSettingsInputFromSources({
      answers: {
        discount_special_rules: "Legado correto sem canonical.",
        price_direct_rule: "So depois de entender medidas.",
        price_must_understand_before: ["so_apos_entender_medidas"],
      },
      settings: {
        organization_id: "org-1",
        store_id: "store-1",
        default_discount_percent: 5,
        max_discount_percent: 10,
        allow_ask_above_max_discount: false,
        discount_autonomy_mode: "approval_required",
        discount_special_rules: null,
      },
      highValueSettings: null,
    });

    assert.equal(input.discountSpecialRules, "");

    const presentation = createStoreDiscountPresentationFromSources({
      answers: {
        discount_special_rules: "Legado correto sem canonical.",
        price_direct_rule: "So depois de entender medidas.",
        price_must_understand_before: ["so_apos_entender_medidas"],
      },
      settings: {
        organization_id: "org-1",
        store_id: "store-1",
        default_discount_percent: 5,
        max_discount_percent: 10,
        allow_ask_above_max_discount: false,
        discount_autonomy_mode: "approval_required",
        discount_special_rules: null,
      },
      highValueSettings: null,
    });

    assert.equal(presentation.discountSpecialRules, null);
  },
);

test(
  "discount helper does not promote semantic discount legacy when canonical row is absent",
  async () => {
    const { createStoreDiscountSettingsInputFromSources } =
      await loadStoreDiscountSettingsModule();

    const input = createStoreDiscountSettingsInputFromSources({
      answers: {
        discount_special_rules: "Apenas gerente aprova excecao.",
        price_direct_rule_other: "So depois de entender o que o cliente quer.",
        negotiation_rules_summary: "Negociar depois de qualificar.",
      },
      settings: null,
      highValueSettings: null,
    });

    assert.equal(input.discountSpecialRules, "");
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
        discountSpecialRules: "",
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
        discountSpecialRules: "",
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

test("discount normalization keeps special rules textual and blanks become null", async () => {
  const { normalizeStoreDiscountSettingsInput } =
    await loadStoreDiscountSettingsModule();

  assert.deepEqual(
    normalizeStoreDiscountSettingsInput({
      defaultDiscountPercent: "5",
      maxDiscountPercent: "10",
      allowAskAboveMaxDiscount: true,
      discountAutonomyMode: "within_policy_autonomous",
      discountSpecialRules: "  Condição especial apenas com aprovação.  ",
      highValueEnabled: false,
      highValueThresholdAmount: "",
      highValueDiscountPercent: "",
    }),
    {
      ok: true,
      value: {
        defaultDiscountPercent: 5,
        maxDiscountPercent: 10,
        allowAskAboveMaxDiscount: true,
        discountAutonomyMode: "within_policy_autonomous",
        discountSpecialRules: "Condição especial apenas com aprovação.",
        highValueEnabled: false,
        highValueThresholdAmountCents: null,
        highValueDiscountPercent: null,
      },
    },
  );

  const blankResult = normalizeStoreDiscountSettingsInput({
    defaultDiscountPercent: "5",
    maxDiscountPercent: "10",
    allowAskAboveMaxDiscount: false,
    discountAutonomyMode: "approval_required",
    discountSpecialRules: "   ",
    highValueEnabled: false,
    highValueThresholdAmount: "",
    highValueDiscountPercent: "",
  });

  assert.equal(blankResult.ok, true);
  if (blankResult.ok) {
    assert.equal(blankResult.value.discountSpecialRules, null);
  }
});

test("discount normalization accepts explicit zero policy for no normal discounts", async () => {
  const { normalizeStoreDiscountSettingsInput } =
    await loadStoreDiscountSettingsModule();

  assert.deepEqual(
    normalizeStoreDiscountSettingsInput({
      defaultDiscountPercent: "0",
      maxDiscountPercent: "0",
      allowAskAboveMaxDiscount: false,
      discountAutonomyMode: "approval_required",
      discountSpecialRules: "",
      highValueEnabled: false,
      highValueThresholdAmount: "",
      highValueDiscountPercent: "",
    }),
    {
      ok: true,
      value: {
        defaultDiscountPercent: 0,
        maxDiscountPercent: 0,
        allowAskAboveMaxDiscount: false,
        discountAutonomyMode: "approval_required",
        discountSpecialRules: null,
        highValueEnabled: false,
        highValueThresholdAmountCents: null,
        highValueDiscountPercent: null,
      },
    },
  );
});

test("discount helper keeps canonical zero policy instead of legacy can offer", async () => {
  const { createStoreDiscountSettingsInputFromSources } =
    await loadStoreDiscountSettingsModule();

  const input = createStoreDiscountSettingsInputFromSources({
    answers: {
      can_offer_discount: true,
      max_discount_percent: "25",
      discount_special_rules: "Legado nao deve vencer.",
    },
    settings: {
      organization_id: "org-1",
      store_id: "store-1",
      default_discount_percent: 0,
      max_discount_percent: 0,
      allow_ask_above_max_discount: false,
      discount_autonomy_mode: "approval_required",
      discount_special_rules: null,
    },
    highValueSettings: null,
  });

  assert.equal(input.defaultDiscountPercent, "0");
  assert.equal(input.maxDiscountPercent, "0");
  assert.equal(input.allowAskAboveMaxDiscount, false);
  assert.equal(input.discountSpecialRules, "");
});

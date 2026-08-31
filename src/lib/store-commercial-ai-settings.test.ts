import test from "node:test";
import assert from "node:assert/strict";

async function loadStoreCommercialAiSettingsModule() {
  return import(
    new URL("./store-commercial-ai-settings.ts", import.meta.url).href
  );
}

test("commercial AI helper prefers canonical policy over legacy price summaries", async () => {
  const {
    createStoreCommercialAiSettingsInputFromSources,
    deriveStoreCommercialAiLegacyMirrors,
    normalizeStoreCommercialAiSettingsInput,
  } = await loadStoreCommercialAiSettingsModule();

  const input = createStoreCommercialAiSettingsInputFromSources({
    answers: {
      ai_can_send_price_directly: false,
      price_needs_human_help: "sim",
      price_talk_mode: "nao_falar_sozinha",
      price_direct_rule: "Resumo legado nao deve mandar no canonical.",
      price_direct_rule_other: "Texto legado livre",
      price_must_understand_before: ["so_apos_identificar_interesse_real"],
    },
    settings: {
      organization_id: "org-1",
      store_id: "store-1",
      price_answer_policy: "direct_when_asked",
      price_context_requirements: [
        "space_or_measurements",
        "need_summary",
      ],
    },
  });

  assert.equal(input.priceAnswerPolicy, "direct_when_asked");
  assert.deepEqual(input.priceContextRequirements, [
    "space_or_measurements",
    "need_summary",
  ]);

  const normalized = normalizeStoreCommercialAiSettingsInput(input);
  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;

  assert.deepEqual(deriveStoreCommercialAiLegacyMirrors(normalized.value), {
    price_talk_mode: "quando_cliente_perguntar",
    ai_can_send_price_directly: true,
    price_needs_human_help: "nao",
    price_must_understand_before: [
      "so_apos_entender_medidas",
      "so_apos_entender_objetivo",
    ],
    price_direct_conditions: [
      "so_apos_entender_medidas",
      "so_apos_entender_objetivo",
      "quando_cliente_perguntar",
    ],
    price_direct_rule:
      "So depois de entender medidas ou porte do projeto, So depois de entender o que o cliente quer | Pode falar preco quando o cliente perguntar | Nao precisa de ajuda humana para falar preco na regra normal.",
  });
});

test("commercial AI helper infers the minimal canonical policy from legacy fields", async () => {
  const { createStoreCommercialAiSettingsInputFromSources } =
    await loadStoreCommercialAiSettingsModule();

  assert.deepEqual(
    createStoreCommercialAiSettingsInputFromSources({
      answers: {
        ai_can_send_price_directly: true,
        price_needs_human_help: "nao",
        price_talk_mode: "apenas_faixa_inicial",
        price_must_understand_before: [
          "so_apos_entender_objetivo",
          "so_apos_identificar_interesse_real",
          "so_apos_entender_tipo",
        ],
      },
      settings: null,
    }),
    {
      priceAnswerPolicy: "range_only_when_asked",
      priceContextRequirements: [
        "need_summary",
        "interested_product_reference",
      ],
    },
  );

  assert.deepEqual(
    createStoreCommercialAiSettingsInputFromSources({
      answers: {
        ai_can_send_price_directly: true,
        price_needs_human_help: "nao",
        price_talk_mode: "quando_cliente_perguntar",
      },
      settings: null,
    }).priceAnswerPolicy,
    "direct_when_asked",
  );

  assert.deepEqual(
    createStoreCommercialAiSettingsInputFromSources({
      answers: {
        ai_can_send_price_directly: true,
        price_needs_human_help: "sim",
        price_talk_mode: "quando_cliente_perguntar",
      },
      settings: null,
    }).priceAnswerPolicy,
    "human_required_for_price",
  );
});

test("commercial AI helper rejects invalid canonical policy on normalization", async () => {
  const { normalizeStoreCommercialAiSettingsInput } =
    await loadStoreCommercialAiSettingsModule();

  assert.deepEqual(
    normalizeStoreCommercialAiSettingsInput({
      priceAnswerPolicy: "legacy_free_text",
      priceContextRequirements: [],
    }),
    {
      ok: false,
      error: "Politica de resposta de preco invalida.",
    },
  );
});

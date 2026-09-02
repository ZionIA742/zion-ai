import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260825103000_p19a_store_payment_settings_canonical.sql",
);

function readMigrationSource() {
  return readFileSync(migrationPath, "utf8");
}

async function loadStorePaymentSettingsModule() {
  return import(new URL("./store-payment-settings.ts", import.meta.url).href);
}

const tests: TestCase[] = [
  {
    name: "normalizer clears conditional children when parent settings are disabled",
    run: async () => {
      const { normalizeStorePaymentSettingsInput } =
        await loadStorePaymentSettingsModule();
      const result = normalizeStorePaymentSettingsInput({
        acceptedPaymentMethods: ["boleto", "transferencia"],
        pixKeyType: "email",
        pixKey: "financeiro@example.com",
        pixHolderName: "Piscinas Exemplo",
        downPaymentMode: "none",
        downPaymentValueType: "fixed",
        downPaymentPercent: "",
        downPaymentAmount: "8400",
        installmentsEnabled: "nao",
        maxInstallments: "12",
        installmentInterestPolicy: "with_interest",
        paymentNotes: "Somente boleto e transferencia",
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.deepEqual(result.value.acceptedPaymentMethods, [
        "boleto",
        "transferencia",
      ]);
      assert.equal(result.value.pixKeyType, null);
      assert.equal(result.value.pixKey, null);
      assert.equal(result.value.pixHolderName, null);
      assert.equal(result.value.downPaymentValueType, null);
      assert.equal(result.value.downPaymentAmountCents, null);
      assert.equal(result.value.installmentsEnabled, false);
      assert.equal(result.value.maxInstallments, null);
      assert.equal(result.value.installmentInterestPolicy, null);
    },
  },
  {
    name: "summary is derived from the structured payload instead of free text authority",
    run: async () => {
      const {
        deriveStorePaymentSettingsSummary,
        normalizeStorePaymentSettingsInput,
      } = await loadStorePaymentSettingsModule();
      const result = normalizeStorePaymentSettingsInput({
        acceptedPaymentMethods: ["pix", "cartao_credito"],
        pixKeyType: "email",
        pixKey: "financeiro@example.com",
        pixHolderName: "Piscinas Exemplo",
        downPaymentMode: "required",
        downPaymentValueType: "percent",
        downPaymentPercent: "30",
        downPaymentAmount: "",
        installmentsEnabled: "sim",
        maxInstallments: "10",
        installmentInterestPolicy: "interest_free",
        paymentNotes: "Entrada combinada conforme projeto",
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(
        deriveStorePaymentSettingsSummary(result.value),
        "Pix, Cartao de credito | parcelamento em ate 10x sem juros | Entrada obrigatoria 30% | Entrada combinada conforme projeto",
      );
    },
  },
  {
    name: "legacy payment selections are split between canonical methods and legacy condition tags",
    run: async () => {
      const {
        coerceLegacyPaymentConditionTags,
        coerceStorePaymentMethods,
      } =
        await loadStorePaymentSettingsModule();

      assert.deepEqual(
        coerceStorePaymentMethods([
          "p",
          "i",
          "x",
          "financiamento",
          "parcelado",
          "sinal_mais_parcelas",
          "FINANCIAMENTO",
        ]),
        ["pix", "financiamento"],
      );
      assert.deepEqual(
        coerceLegacyPaymentConditionTags([
          "p",
          "i",
          "x",
          "financiamento",
          "parcelado",
          "sinal_mais_parcelas",
          "FINANCIAMENTO",
        ]),
        ["parcelado", "sinal_mais_parcelas"],
      );
    },
  },
  {
    name: "missing canonical settings return empty defaults without legacy payment fallback",
    run: async () => {
      const { createStorePaymentSettingsInputFromSources } =
        await loadStorePaymentSettingsModule();

      const input = createStorePaymentSettingsInputFromSources({
        answers: {
          accepted_payment_methods: [
            "p",
            "i",
            "x",
            "financiamento",
            "parcelado",
            "sinal_mais_parcelas",
          ],
          accepted_payment_methods_summary:
            "Pix, financiamento, parcelado e sinal + parcelas",
        },
      });

      assert.deepEqual(input.acceptedPaymentMethods, []);
      assert.deepEqual(input.legacyPaymentConditionTags ?? [], []);
      assert.equal(
        input.paymentNotes,
        "",
      );
    },
  },
  {
    name: "legacy parcelado tag is not promoted when canonical settings are absent",
    run: async () => {
      const { createStorePaymentSettingsInputFromSources } =
        await loadStorePaymentSettingsModule();

      const input = createStorePaymentSettingsInputFromSources({
        answers: {
          accepted_payment_methods: ["pix", "parcelado"],
        },
      });

      assert.deepEqual(input.acceptedPaymentMethods, []);
      assert.deepEqual(input.legacyPaymentConditionTags ?? [], []);
      assert.equal(input.installmentsEnabled, "nao");
      assert.equal(input.maxInstallments, "");
      assert.equal(input.installmentInterestPolicy, "");
    },
  },
  {
    name: "legacy sinal_mais_parcelas tag is not promoted when canonical settings are absent",
    run: async () => {
      const { createStorePaymentSettingsInputFromSources } =
        await loadStorePaymentSettingsModule();

      const input = createStorePaymentSettingsInputFromSources({
        answers: {
          accepted_payment_methods: ["pix", "sinal_mais_parcelas"],
        },
      });

      assert.deepEqual(input.acceptedPaymentMethods, []);
      assert.deepEqual(input.legacyPaymentConditionTags ?? [], []);
      assert.equal(input.downPaymentMode, "none");
      assert.equal(input.downPaymentValueType, "");
      assert.equal(input.downPaymentPercent, "");
      assert.equal(input.downPaymentAmount, "");
      assert.equal(input.installmentsEnabled, "nao");
    },
  },
  {
    name: "display presentation prefers canonical settings and never concatenates legacy summaries when the row exists",
    run: async () => {
      const { createStorePaymentPresentationFromSources } =
        await loadStorePaymentSettingsModule();

      const presentation = createStorePaymentPresentationFromSources({
        answers: {
          accepted_payment_methods: ["p", "i", "x", "pix", "parcelado"],
          accepted_payment_methods_summary: "LEGACY NAO DEVE CONCATENAR",
          payment_methods_summary: "LEGACY SECUNDARIO",
        },
        settings: {
          organization_id: "org-1",
          store_id: "store-1",
          accepted_payment_methods: ["pix", "cartao_debito", "dinheiro"],
          pix_key_type: "email",
          pix_key: "financeiro@example.com",
          pix_holder_name: "Piscinas Exemplo",
          down_payment_mode: "none",
          down_payment_value_type: null,
          down_payment_percent: null,
          down_payment_amount_cents: null,
          installments_enabled: false,
          max_installments: null,
          installment_interest_policy: null,
          payment_notes: null,
        },
      });

      assert.equal(
        presentation.paymentSummary,
        "Pix, Cartao de debito, Dinheiro",
      );
      assert.deepEqual(presentation.legacyPaymentConditionTags, []);
      assert.equal(presentation.paymentSummary.includes("LEGACY"), false);
      assert.equal(presentation.paymentSummary.includes("p, i, x"), false);
    },
  },
  {
    name: "display presentation stays empty when canonical payment settings are absent",
    run: async () => {
      const { createStorePaymentPresentationFromSources } =
        await loadStorePaymentSettingsModule();

      const presentation = createStorePaymentPresentationFromSources({
        answers: {
          accepted_payment_methods: [
            "p",
            "i",
            "x",
            "pix",
            "financiamento",
            "parcelado",
            "sinal_mais_parcelas",
          ],
          accepted_payment_methods_summary: "Resumo legado nao deve duplicar Pix",
        },
        settings: null,
      });

      assert.equal(presentation.paymentSummary, "");
      assert.deepEqual(presentation.canonicalPaymentMethods, []);
      assert.deepEqual(presentation.legacyPaymentConditionTags, []);
      assert.equal(presentation.legacyConditionNotice, "");
    },
  },
  {
    name: "display presentation does not promote legacy summary text into canonical payment methods",
    run: async () => {
      const { createStorePaymentPresentationFromSources } =
        await loadStorePaymentSettingsModule();

      const presentation = createStorePaymentPresentationFromSources({
        answers: {
          accepted_payment_methods: ["a_vista", "sob_analise"],
          accepted_payment_methods_summary: "Pix e cartao conforme combinado",
          payment_methods_summary: "fallback secundario",
        },
        settings: null,
      });

      assert.equal(presentation.paymentSummary, "");
      assert.deepEqual(presentation.canonicalPaymentMethods, []);
      assert.deepEqual(presentation.legacyPaymentConditionTags, []);
    },
  },
  {
    name: "derived summary uses only canonical methods and never infers installment structure from legacy tags",
    run: async () => {
      const {
        deriveStorePaymentSettingsSummary,
        normalizeStorePaymentSettingsInput,
      } = await loadStorePaymentSettingsModule();

      const result = normalizeStorePaymentSettingsInput({
        acceptedPaymentMethods: ["pix", "financiamento"],
        pixKeyType: "",
        pixKey: "",
        pixHolderName: "",
        downPaymentMode: "none",
        downPaymentValueType: "",
        downPaymentPercent: "",
        downPaymentAmount: "",
        installmentsEnabled: "nao",
        maxInstallments: "",
        installmentInterestPolicy: "",
        paymentNotes: "",
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(
        deriveStorePaymentSettingsSummary(result.value),
        "Pix, Financiamento",
      );
    },
  },
  {
    name: "migration keeps canonical writes human scoped and preserves legacy compatibility",
    run: () => {
      const source = readMigrationSource();

      assert.equal(
        source.includes(
          "create table if not exists public.store_payment_settings",
        ),
        true,
      );
      assert.equal(
        source.includes("foreign key (store_id, organization_id)"),
        true,
      );
      assert.equal(
        source.includes(
          "constraint store_payment_settings_down_payment_value_type_required",
        ),
        true,
      );
      assert.equal(
        source.includes(
          "grant select on table public.store_payment_settings to authenticated;",
        ),
        true,
      );
      assert.equal(
        source.includes(
          "grant select, insert, update on table public.store_payment_settings to authenticated;",
        ),
        false,
      );
      assert.equal(
        source.includes(
          "create policy store_payment_settings_insert_by_active_membership",
        ),
        false,
      );
      assert.equal(
        source.includes(
          "create policy store_payment_settings_update_by_active_membership",
        ),
        false,
      );
      assert.equal(
        source.includes(
          "grant execute on function public.upsert_store_payment_settings_scoped",
        ),
        true,
      );
      assert.equal(
        source.includes("p_question_key => 'accepted_payment_methods_summary'"),
        true,
      );
      assert.equal(
        source.includes("p_question_key => 'accepted_payment_methods'"),
        true,
      );
      assert.equal(
        source.includes("public.store_payment_settings_build_legacy_summary("),
        true,
      );
      assert.equal(source.includes("'financiamento'"), true);
      assert.equal(source.includes("'parcelado'"), true);
      assert.equal(source.includes("'sinal_mais_parcelas'"), true);
      assert.equal(
        source.includes("from public.store_onboarding_answers answer_row"),
        true,
      );
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`store-payment-settings: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

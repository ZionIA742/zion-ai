import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260828170000_p19a_store_strategy_settings_canonical.sql",
);

function readMigrationSource() {
  return readFileSync(migrationPath, "utf8");
}

async function loadStoreStrategySettingsModule() {
  return import(new URL("./store-strategy-settings.ts", import.meta.url).href);
}

const tests: TestCase[] = [
  {
    name: "canonical strategy input prefers the structured row over legacy answers",
    run: async () => {
      const { createStoreStrategySettingsInputFromSources } =
        await loadStoreStrategySettingsModule();

      const input = createStoreStrategySettingsInputFromSources({
        answers: {
          city: "LEGACY CITY",
          service_regions: "LEGACY REGION",
          store_services: ["venda_piscinas"],
          strategy_positioning: "LEGACY POSITION",
          strategy_ai_priorities: "LEGACY PRIORITIES",
        },
        settings: {
          organization_id: "org-1",
          store_id: "store-1",
          city: "Ribeirao Preto",
          state: "SP",
          service_regions: "Interior paulista",
          service_region_modes: ["cidade_e_vizinhas", "sob_consulta"],
          service_region_primary_mode: "cidade_e_vizinhas",
          service_region_outside_consultation: true,
          service_region_notes: "Consulta fora da rota",
          store_services: ["venda_piscinas", "visita_tecnica"],
          store_services_other: "Reformas",
          store_description: "Loja consultiva",
          main_store_brand: "Sodramar",
          brands_worked: "Sodramar, Brustec",
          strategy_service_exclusions: "Nao faz obra civil",
          strategy_primary_focus: "Piscinas residenciais",
          strategy_sell_more: "Automacao",
          strategy_common_customer: "Residencial",
          strategy_ideal_customer: "Ticket medio",
          strategy_ticket_range: "30k-80k",
          strategy_positioning: "Premium tecnico",
          strategy_priority_brands: "Sodramar",
          strategy_non_worked_brands: "Marca X",
          strategy_top_lines: "Aquecimento",
          strategy_top_products: "Filtros",
          strategy_differentials: "Equipe propria",
          strategy_promise_limits: "Prazo depende da visita",
          strategy_ai_presentation: "Apresente com tom consultivo",
          strategy_ai_priorities: "Entender contexto antes do preco",
          strategy_ai_never_forget: "Nao prometer prazo fechado",
        },
      });

      assert.equal(input.city, "Ribeirao Preto");
      assert.deepEqual(input.serviceRegionModes, [
        "cidade_e_vizinhas",
        "sob_consulta",
      ]);
      assert.deepEqual(input.storeServices, [
        "venda_piscinas",
        "visita_tecnica",
      ]);
      assert.equal(input.strategyPositioning, "Premium tecnico");
      assert.equal(
        input.strategyAiPriorities,
        "Entender contexto antes do preco",
      );
    },
  },
  {
    name: "legacy answers remain the fallback while there is no canonical row",
    run: async () => {
      const { createStoreStrategySettingsInputFromSources } =
        await loadStoreStrategySettingsModule();

      const input = createStoreStrategySettingsInputFromSources({
        answers: {
          city: "Campinas",
          state: "SP",
          service_regions: "Campinas e regiao",
          service_region_modes: ["cidade_e_vizinhas", "sob_consulta"],
          service_region_primary_mode: "cidade_e_vizinhas",
          service_region_outside_consultation: true,
          store_services: ["venda_piscinas", "instalacao_piscinas"],
          strategy_positioning: "Consultiva",
          strategy_ai_presentation: "Fale como especialista",
        },
      });

      assert.equal(input.city, "Campinas");
      assert.equal(input.state, "SP");
      assert.deepEqual(input.serviceRegionModes, [
        "cidade_e_vizinhas",
        "sob_consulta",
      ]);
      assert.equal(input.strategyPositioning, "Consultiva");
      assert.equal(input.strategyAiPresentation, "Fale como especialista");
    },
  },
  {
    name: "legacy summary and excluded fields do not override canonical strategy authority",
    run: async () => {
      const { createStoreStrategySettingsInputFromSources } =
        await loadStoreStrategySettingsModule();

      const input = createStoreStrategySettingsInputFromSources({
        answers: {
          strategy_ai_store_summary: "LEGACY SUMMARY",
          strategy_requires_visit: "LEGACY VISIT",
          strategy_requires_human: "LEGACY HUMAN",
          strategy_exception_cases: "LEGACY EXCEPTION",
          strategy_positioning: "LEGACY POSITION",
        },
        settings: {
          organization_id: "org-1",
          store_id: "store-1",
          city: null,
          state: null,
          service_regions: null,
          service_region_modes: [],
          service_region_primary_mode: null,
          service_region_outside_consultation: false,
          service_region_notes: null,
          store_services: [],
          store_services_other: null,
          store_description: null,
          main_store_brand: null,
          brands_worked: null,
          strategy_service_exclusions: null,
          strategy_primary_focus: null,
          strategy_sell_more: null,
          strategy_common_customer: null,
          strategy_ideal_customer: null,
          strategy_ticket_range: null,
          strategy_positioning: "CANONICAL POSITION",
          strategy_priority_brands: null,
          strategy_non_worked_brands: null,
          strategy_top_lines: null,
          strategy_top_products: null,
          strategy_differentials: null,
          strategy_promise_limits: null,
          strategy_ai_presentation: null,
          strategy_ai_priorities: null,
          strategy_ai_never_forget: null,
        },
      });

      assert.equal(input.strategyPositioning, "CANONICAL POSITION");
      assert.equal("strategyAiStoreSummary" in input, false);
      assert.equal("strategyRequiresVisit" in input, false);
      assert.equal("strategyRequiresHuman" in input, false);
      assert.equal("strategyExceptionCases" in input, false);
    },
  },
  {
    name: "normalizer keeps structured arrays deterministic and derives the ai store summary without promoting it to authority",
    run: async () => {
      const {
        deriveStoreStrategyAiStoreSummary,
        normalizeStoreStrategySettingsInput,
      } = await loadStoreStrategySettingsModule();

      const normalized = normalizeStoreStrategySettingsInput({
        city: "  Franca ",
        state: " SP ",
        serviceRegions: " Interior ",
        serviceRegionModes: ["sob_consulta", "cidade_e_vizinhas", "invalido"],
        serviceRegionPrimaryMode: "cidade_e_vizinhas",
        serviceRegionOutsideConsultation: true,
        serviceRegionNotes: "  Sob consulta fora da rota ",
        storeServices: ["visita_tecnica", "foo", "venda_piscinas"],
        storeServicesOther: "  Reformas ",
        storeDescription: "  Loja premium ",
        mainStoreBrand: "  Sodramar ",
        brandsWorked: "  Sodramar, Brustec ",
        strategyServiceExclusions: "  Nao faz obra civil ",
        strategyPrimaryFocus: "  Piscinas ",
        strategySellMore: "  Aquecimento ",
        strategyCommonCustomer: "",
        strategyIdealCustomer: "",
        strategyTicketRange: "",
        strategyPositioning: "  Consultiva ",
        strategyPriorityBrands: "  Sodramar ",
        strategyNonWorkedBrands: "",
        strategyTopLines: "",
        strategyTopProducts: "",
        strategyDifferentials: "  Equipe propria ",
        strategyPromiseLimits: "  Prazo depende da visita ",
        strategyAiPresentation: "  Tom tecnico ",
        strategyAiPriorities: "  Contexto antes do preco ",
        strategyAiNeverForget: "  Nao inventar prazo ",
      });

      assert.equal(normalized.ok, true);
      if (!normalized.ok) return;
      assert.deepEqual(normalized.value.serviceRegionModes, [
        "sob_consulta",
        "cidade_e_vizinhas",
      ]);
      assert.deepEqual(normalized.value.storeServices, [
        "visita_tecnica",
        "venda_piscinas",
      ]);

      const summary = deriveStoreStrategyAiStoreSummary(normalized.value);
      assert.equal(summary.includes("Loja premium"), true);
      assert.equal(summary.includes("Contexto antes do preco"), false);
      assert.equal(summary.includes("Cidade"), false);
    },
  },
  {
    name: "migration keeps only permanent human strategy fields canonical and mirrors the derived summary back to legacy answers",
    run: () => {
      const source = readMigrationSource();

      assert.equal(
        source.includes("create table if not exists public.store_strategy_settings"),
        true,
      );
      assert.equal(source.includes("service_region_modes text[]"), true);
      assert.equal(source.includes("store_services text[]"), true);
      assert.equal(
        source.includes("grant select on table public.store_strategy_settings to authenticated;"),
        true,
      );
      assert.equal(
        source.includes("grant select, insert, update on table public.store_strategy_settings to authenticated;"),
        false,
      );
      assert.equal(
        source.includes("upsert_store_strategy_settings_with_legacy_mirror_scoped"),
        true,
      );
      assert.equal(
        source.includes("p_question_key => 'strategy_ai_store_summary'"),
        true,
      );
      assert.equal(
        source.includes("p_question_key => 'strategy_requires_visit'"),
        false,
      );
      assert.equal(
        source.includes("p_question_key => 'strategy_requires_human'"),
        false,
      );
      assert.equal(
        source.includes("p_question_key => 'strategy_exception_cases'"),
        false,
      );
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`store-strategy-settings: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

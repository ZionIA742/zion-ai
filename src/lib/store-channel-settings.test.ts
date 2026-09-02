import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260828110000_p19a_store_channel_settings_canonical.sql",
);

function readMigrationSource() {
  return readFileSync(migrationPath, "utf8");
}

async function loadStoreChannelSettingsModule() {
  return import(new URL("./store-channel-settings.ts", import.meta.url).href);
}

const tests: TestCase[] = [
  {
    name: "canonical settings input prefers the structured row over legacy answers",
    run: async () => {
      const { createStoreChannelSettingsInputFromSources } =
        await loadStoreChannelSettingsModule();

      const input = createStoreChannelSettingsInputFromSources({
        answers: {
          commercial_channel_name: "LEGACY",
          commercial_receives_real_clients: "Não",
          commercial_is_official_sales_channel: "Não",
          commercial_channel_type: "LEGACY TYPE",
          commercial_entry_priority: "LEGACY PRIORITY",
          commercial_human_handoff_enabled: "Não",
          commercial_channel_notes: "LEGACY NOTES",
          integration_provider_name: "LEGACY PROVIDER",
          integration_connection_mode: "LEGACY CONNECTION",
          integrations_notes: "LEGACY INTEGRATIONS",
        },
        settings: {
          organization_id: "org-1",
          store_id: "store-1",
          commercial_channel_name: "Canal Oficial",
          commercial_receives_real_clients: true,
          commercial_is_official_sales_channel: true,
          commercial_channel_type: "WhatsApp dedicado",
          commercial_entry_priority: "Principal",
          commercial_human_handoff_enabled: false,
          commercial_channel_notes: "Atende clientes finais",
          integration_provider_name: "Evolution API",
          integration_connection_mode: "API / webhook",
          integrations_notes: "Operação humana permanente",
        },
      });

      assert.equal(input.commercialChannelName, "Canal Oficial");
      assert.equal(input.commercialReceivesRealClients, "Sim");
      assert.equal(input.commercialIsOfficialSalesChannel, "Sim");
      assert.equal(input.commercialHumanHandoffEnabled, "Não");
      assert.equal(input.integrationProviderName, "Evolution API");
      assert.equal(input.integrationsNotes, "Operação humana permanente");
    },
  },
  {
    name: "missing canonical channel settings return defaults without legacy fallback",
    run: async () => {
      const { createStoreChannelSettingsInputFromSources } =
        await loadStoreChannelSettingsModule();

      const input = createStoreChannelSettingsInputFromSources({
        answers: {
          commercial_channel_name: "Canal Comercial Loja",
          commercial_receives_real_clients: "Sim",
          commercial_is_official_sales_channel: "Não",
          commercial_channel_type: "WhatsApp comercial",
          commercial_entry_priority: "Entrada primária",
          commercial_human_handoff_enabled: "Sim",
          commercial_channel_notes: "Fallback legado",
          integration_provider_name: "W-API",
          integration_connection_mode: "Webhook",
          integrations_notes: "Sem segredos aqui",
        },
      });

      assert.equal(input.commercialChannelName, "Canal comercial principal");
      assert.equal(input.commercialReceivesRealClients, "Não definido");
      assert.equal(input.commercialIsOfficialSalesChannel, "Não definido");
      assert.equal(input.integrationProviderName, "Ainda não definido");
      assert.equal(input.integrationConnectionMode, "API / webhook");
    },
  },
  {
    name: "normalizer trims notes and rejects invalid yes-no values",
    run: async () => {
      const { normalizeStoreChannelSettingsInput } =
        await loadStoreChannelSettingsModule();

      const invalid = normalizeStoreChannelSettingsInput({
        commercialChannelName: "Canal 1",
        commercialReceivesRealClients: "Talvez",
        commercialIsOfficialSalesChannel: "Sim",
        commercialChannelType: "WhatsApp",
        commercialEntryPriority: "Principal",
        commercialHumanHandoffEnabled: "Sim",
        commercialChannelNotes: "",
        integrationProviderName: "Evolution",
        integrationConnectionMode: "Webhook",
        integrationsNotes: "",
      });

      assert.equal(invalid.ok, false);
      if (invalid.ok) return;
      assert.equal(
        invalid.error,
        "Defina se o canal comercial realmente recebe clientes.",
      );

      const valid = normalizeStoreChannelSettingsInput({
        commercialChannelName: "  Canal 1  ",
        commercialReceivesRealClients: "Sim",
        commercialIsOfficialSalesChannel: "Não",
        commercialChannelType: "  WhatsApp  ",
        commercialEntryPriority: "  Principal  ",
        commercialHumanHandoffEnabled: "Não",
        commercialChannelNotes: "  Observação humana  ",
        integrationProviderName: "  Evolution  ",
        integrationConnectionMode: "  API / webhook  ",
        integrationsNotes: "  Sem status vivo  ",
      });

      assert.equal(valid.ok, true);
      if (!valid.ok) return;
      assert.equal(valid.value.commercialChannelName, "Canal 1");
      assert.equal(valid.value.commercialReceivesRealClients, true);
      assert.equal(valid.value.commercialIsOfficialSalesChannel, false);
      assert.equal(valid.value.commercialHumanHandoffEnabled, false);
      assert.equal(valid.value.commercialChannelNotes, "Observação humana");
      assert.equal(valid.value.integrationsNotes, "Sem status vivo");
    },
  },
  {
    name: "migration keeps only the permanent human fields canonical and mirrors them back to legacy answers",
    run: () => {
      const source = readMigrationSource();

      assert.equal(
        source.includes("create table if not exists public.store_channel_settings"),
        true,
      );
      assert.equal(source.includes("foreign key (store_id, organization_id)"), true);
      assert.equal(
        source.includes("commercial_receives_real_clients boolean"),
        true,
      );
      assert.equal(
        source.includes("commercial_is_official_sales_channel boolean"),
        true,
      );
      assert.equal(
        source.includes("grant select on table public.store_channel_settings to authenticated;"),
        true,
      );
      assert.equal(
        source.includes("grant select, insert, update on table public.store_channel_settings to authenticated;"),
        false,
      );
      assert.equal(
        source.includes("grant execute on function public.upsert_store_channel_settings_scoped("),
        false,
      );
      assert.equal(
        source.includes("grant execute on function public.upsert_store_channel_settings_with_legacy_mirror_scoped("),
        true,
      );
      assert.equal(
        source.includes("upsert_store_channel_settings_with_legacy_mirror_scoped"),
        true,
      );
      assert.equal(
        source.includes("COMMERCIAL_RECEIVES_REAL_CLIENTS_REQUIRED"),
        true,
      );
      assert.equal(
        source.includes("COMMERCIAL_IS_OFFICIAL_SALES_CHANNEL_REQUIRED"),
        true,
      );
      assert.equal(
        source.includes("COMMERCIAL_HUMAN_HANDOFF_ENABLED_REQUIRED"),
        true,
      );
      assert.equal(
        source.includes("p_question_key => 'commercial_channel_name'"),
        true,
      );
      assert.equal(
        source.includes("p_question_key => 'integration_provider_name'"),
        true,
      );
      assert.equal(
        source.includes("p_question_key => 'commercial_whatsapp'"),
        false,
      );
      assert.equal(
        source.includes("p_question_key => 'responsible_whatsapp'"),
        false,
      );
      assert.equal(
        source.includes("p_question_key => 'integration_test_status'"),
        false,
      );
      assert.equal(
        source.includes("p_question_key => 'webhook_inbound_status'"),
        false,
      );
      assert.equal(
        source.includes("p_question_key => 'assistant_alerts_route'"),
        false,
      );
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`store-channel-settings: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export type StoreChannelSettingsRow = {
  organization_id: string;
  store_id: string;
  commercial_channel_name: string | null;
  commercial_receives_real_clients: boolean | null;
  commercial_is_official_sales_channel: boolean | null;
  commercial_channel_type: string | null;
  commercial_entry_priority: string | null;
  commercial_human_handoff_enabled: boolean | null;
  commercial_channel_notes: string | null;
  integration_provider_name: string | null;
  integration_connection_mode: string | null;
  integrations_notes: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type StoreChannelSettingsInput = {
  commercialChannelName: string;
  commercialReceivesRealClients: string;
  commercialIsOfficialSalesChannel: string;
  commercialChannelType: string;
  commercialEntryPriority: string;
  commercialHumanHandoffEnabled: string;
  commercialChannelNotes: string;
  integrationProviderName: string;
  integrationConnectionMode: string;
  integrationsNotes: string;
};

export type NormalizedStoreChannelSettingsInput = {
  commercialChannelName: string;
  commercialReceivesRealClients: boolean;
  commercialIsOfficialSalesChannel: boolean;
  commercialChannelType: string;
  commercialEntryPriority: string;
  commercialHumanHandoffEnabled: boolean;
  commercialChannelNotes: string | null;
  integrationProviderName: string;
  integrationConnectionMode: string;
  integrationsNotes: string | null;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeText(value: unknown) {
  return cleanText(value).toLowerCase();
}

function booleanToYesNo(value: boolean | null | undefined, fallback: string) {
  if (value === true) return "Sim";
  if (value === false) return "Não";
  return fallback;
}

function yesNoToBoolean(
  value: unknown,
): { ok: true; value: boolean } | { ok: false } {
  const normalized = normalizeText(value);
  if (["sim", "true", "1"].includes(normalized)) {
    return { ok: true, value: true };
  }
  if (["não", "nao", "false", "0"].includes(normalized)) {
    return { ok: true, value: false };
  }
  return { ok: false };
}

export function createDefaultStoreChannelSettingsInput(): StoreChannelSettingsInput {
  return {
    commercialChannelName: "Canal comercial principal",
    commercialReceivesRealClients: "Não definido",
    commercialIsOfficialSalesChannel: "Não definido",
    commercialChannelType: "WhatsApp comercial da loja",
    commercialEntryPriority: "Canal principal de entrada de clientes",
    commercialHumanHandoffEnabled: "Sim",
    commercialChannelNotes: "",
    integrationProviderName: "Ainda não definido",
    integrationConnectionMode: "API / webhook",
    integrationsNotes:
      "As integrações devem respeitar a separação entre canal comercial da IA vendedora e canal do responsável para a IA assistente.",
  };
}

export function normalizeStoreChannelSettingsInput(
  input: StoreChannelSettingsInput,
): { ok: true; value: NormalizedStoreChannelSettingsInput } | { ok: false; error: string } {
  const commercialChannelName = cleanText(input.commercialChannelName);
  if (!commercialChannelName) {
    return { ok: false, error: "Informe o nome do canal comercial principal." };
  }

  const commercialReceivesRealClients = yesNoToBoolean(
    input.commercialReceivesRealClients,
  );
  if (!commercialReceivesRealClients.ok) {
    return {
      ok: false,
      error: "Defina se o canal comercial realmente recebe clientes.",
    };
  }

  const commercialIsOfficialSalesChannel = yesNoToBoolean(
    input.commercialIsOfficialSalesChannel,
  );
  if (!commercialIsOfficialSalesChannel.ok) {
    return {
      ok: false,
      error: "Defina se este e o canal oficial da IA vendedora.",
    };
  }

  const commercialChannelType = cleanText(input.commercialChannelType);
  if (!commercialChannelType) {
    return { ok: false, error: "Informe o tipo do canal comercial." };
  }

  const commercialEntryPriority = cleanText(input.commercialEntryPriority);
  if (!commercialEntryPriority) {
    return {
      ok: false,
      error: "Explique a prioridade de entrada do canal comercial.",
    };
  }

  const commercialHumanHandoffEnabled = yesNoToBoolean(
    input.commercialHumanHandoffEnabled,
  );
  if (!commercialHumanHandoffEnabled.ok) {
    return {
      ok: false,
      error: "Defina se o canal comercial permite transbordo para humano.",
    };
  }

  const integrationProviderName = cleanText(input.integrationProviderName);
  if (!integrationProviderName) {
    return {
      ok: false,
      error: "Informe qual provedor ou integracao principal a loja usa.",
    };
  }

  const integrationConnectionMode = cleanText(input.integrationConnectionMode);
  if (!integrationConnectionMode) {
    return { ok: false, error: "Informe o modo de conexao da integracao." };
  }

  return {
    ok: true,
    value: {
      commercialChannelName,
      commercialReceivesRealClients: commercialReceivesRealClients.value,
      commercialIsOfficialSalesChannel:
        commercialIsOfficialSalesChannel.value,
      commercialChannelType,
      commercialEntryPriority,
      commercialHumanHandoffEnabled: commercialHumanHandoffEnabled.value,
      commercialChannelNotes: cleanText(input.commercialChannelNotes) || null,
      integrationProviderName,
      integrationConnectionMode,
      integrationsNotes: cleanText(input.integrationsNotes) || null,
    },
  };
}

export function createStoreChannelSettingsInputFromSources(args: {
  answers?: Record<string, unknown> | null;
  settings?: StoreChannelSettingsRow | null;
}): StoreChannelSettingsInput {
  const answers = args.answers ?? {};
  const settings = args.settings ?? null;
  const defaults = createDefaultStoreChannelSettingsInput();
  const commercialWhatsapp = cleanText(answers.commercial_whatsapp);

  if (settings) {
    return {
      commercialChannelName:
        cleanText(settings.commercial_channel_name) ||
        defaults.commercialChannelName,
      commercialReceivesRealClients: booleanToYesNo(
        settings.commercial_receives_real_clients,
        commercialWhatsapp ? "Sim" : defaults.commercialReceivesRealClients,
      ),
      commercialIsOfficialSalesChannel: booleanToYesNo(
        settings.commercial_is_official_sales_channel,
        commercialWhatsapp
          ? "Sim"
          : defaults.commercialIsOfficialSalesChannel,
      ),
      commercialChannelType:
        cleanText(settings.commercial_channel_type) ||
        defaults.commercialChannelType,
      commercialEntryPriority:
        cleanText(settings.commercial_entry_priority) ||
        defaults.commercialEntryPriority,
      commercialHumanHandoffEnabled: booleanToYesNo(
        settings.commercial_human_handoff_enabled,
        defaults.commercialHumanHandoffEnabled,
      ),
      commercialChannelNotes:
        cleanText(settings.commercial_channel_notes) ||
        defaults.commercialChannelNotes,
      integrationProviderName:
        cleanText(settings.integration_provider_name) ||
        defaults.integrationProviderName,
      integrationConnectionMode:
        cleanText(settings.integration_connection_mode) ||
        defaults.integrationConnectionMode,
      integrationsNotes:
        cleanText(settings.integrations_notes) || defaults.integrationsNotes,
    };
  }

  return {
    commercialChannelName:
      cleanText(answers.commercial_channel_name) ||
      defaults.commercialChannelName,
    commercialReceivesRealClients:
      cleanText(answers.commercial_receives_real_clients) ||
      (commercialWhatsapp ? "Sim" : defaults.commercialReceivesRealClients),
    commercialIsOfficialSalesChannel:
      cleanText(answers.commercial_is_official_sales_channel) ||
      (commercialWhatsapp ? "Sim" : defaults.commercialIsOfficialSalesChannel),
    commercialChannelType:
      cleanText(answers.commercial_channel_type) ||
      defaults.commercialChannelType,
    commercialEntryPriority:
      cleanText(answers.commercial_entry_priority) ||
      defaults.commercialEntryPriority,
    commercialHumanHandoffEnabled:
      cleanText(answers.commercial_human_handoff_enabled) ||
      defaults.commercialHumanHandoffEnabled,
    commercialChannelNotes: cleanText(answers.commercial_channel_notes),
    integrationProviderName:
      cleanText(answers.integration_provider_name) ||
      defaults.integrationProviderName,
    integrationConnectionMode:
      cleanText(answers.integration_connection_mode) ||
      defaults.integrationConnectionMode,
    integrationsNotes:
      cleanText(answers.integrations_notes) || defaults.integrationsNotes,
  };
}

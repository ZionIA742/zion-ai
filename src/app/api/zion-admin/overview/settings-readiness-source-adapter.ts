import type {
  StoreSettingsReadinessFamilyInput,
  StoreSettingsReadinessInput,
  StoreSettingsReadinessIssue,
} from "./settings-readiness-resolution";

export type SettingsReadinessSource<T> =
  | {
      ok: true;
      data: T | null;
    }
  | {
      ok: false;
      error: string;
    };

export type OperationSettingsReadinessRow = {
  offers_installation?: boolean | null;
  offers_technical_visit?: boolean | null;
};

export type OperationExecutionPoliciesReadinessRow = {
  technical_visit_configured_at?: string | null;
  installation_configured_at?: string | null;
  pool_replacement_configured_at?: string | null;
  delivery_configured_at?: string | null;
  pickup_configured_at?: string | null;
  technical_services_configured_at?: string | null;
};

export type PaymentSettingsReadinessRow = {
  accepted_payment_methods?: unknown;
  down_payment_mode?: string | null;
  down_payment_value_type?: string | null;
  down_payment_percent?: number | null;
  down_payment_amount_cents?: number | null;
  installments_enabled?: boolean | null;
  max_installments?: number | null;
  installment_interest_policy?: string | null;
};

export type DiscountSettingsReadinessRow = {
  default_discount_percent?: number | null;
  max_discount_percent?: number | null;
  allow_ask_above_max_discount?: boolean | null;
  discount_autonomy_mode?: string | null;
};

export type HighValueDiscountSettingsReadinessRow = {
  enabled?: boolean | null;
  threshold_amount_cents?: number | null;
  discount_percent?: number | null;
};

export type DiscountSettingsReadinessSourceData = {
  settings: DiscountSettingsReadinessRow | null;
  highValueSettings: HighValueDiscountSettingsReadinessRow | null;
};

export type ChannelSettingsReadinessRow = {
  commercial_channel_name?: string | null;
  commercial_receives_real_clients?: boolean | null;
  commercial_is_official_sales_channel?: boolean | null;
  commercial_channel_type?: string | null;
  commercial_entry_priority?: string | null;
  commercial_human_handoff_enabled?: boolean | null;
  integration_provider_name?: string | null;
  integration_connection_mode?: string | null;
};

export type CommercialAiSettingsReadinessRow = {
  price_answer_policy?: string | null;
  price_context_requirements?: unknown;
  price_policy_configured_at?: string | null;
  complementary_suggestions_configured_at?: string | null;
  complementary_suggestions_enabled?: boolean | null;
  complementary_scope_mode?: string | null;
  complementary_category_keys?: unknown;
  complementary_line_keys?: unknown;
  complementary_allowed_moments?: unknown;
};

export type StrategySettingsReadinessRow = {
  service_region_configured_at?: string | null;
  brands_configuration_configured_at?: string | null;
  strategy_commercial_experience_configured_at?: string | null;
  strategy_commercial_strategy_configured_at?: string | null;
};

export type StoreSettingsReadinessSources = {
  operation: {
    settings: SettingsReadinessSource<OperationSettingsReadinessRow>;
    executionPolicies: SettingsReadinessSource<OperationExecutionPoliciesReadinessRow>;
  };
  payment: SettingsReadinessSource<PaymentSettingsReadinessRow>;
  discount: SettingsReadinessSource<DiscountSettingsReadinessSourceData>;
  channel: SettingsReadinessSource<ChannelSettingsReadinessRow>;
  commercialAi: SettingsReadinessSource<CommercialAiSettingsReadinessRow>;
  strategy: SettingsReadinessSource<StrategySettingsReadinessRow>;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function issue(code: string, message: string): StoreSettingsReadinessIssue {
  return { code, message };
}

function ready(): StoreSettingsReadinessFamilyInput {
  return { state: "ready" };
}

function blocked(...issues: StoreSettingsReadinessIssue[]): StoreSettingsReadinessFamilyInput {
  return {
    state: "blocked",
    issues,
  };
}

function unknown(
  family: string,
  errors: readonly string[],
): StoreSettingsReadinessFamilyInput {
  const details = errors.map(cleanText).filter(Boolean).join(" | ");

  return {
    state: "unknown",
    issues: [
      issue(
        `${family}_source_unavailable`,
        details
          ? `Não foi possível verificar ${family}: ${details}`
          : `Não foi possível verificar ${family}.`,
      ),
    ],
  };
}

function hasMarker(value: unknown) {
  return cleanText(value).length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function explicitBoolean(value: unknown): value is boolean {
  return value === true || value === false;
}

function adaptOperation(
  source: StoreSettingsReadinessSources["operation"],
): StoreSettingsReadinessFamilyInput {
  const sourceErrors: string[] = [];

  if (!source.settings.ok) sourceErrors.push(source.settings.error);
  if (!source.executionPolicies.ok) sourceErrors.push(source.executionPolicies.error);

  if (sourceErrors.length > 0) {
    return unknown("operation", sourceErrors);
  }

  if (!source.settings.data) {
    return blocked(
      issue(
        "operation_settings_not_configured",
        "As configurações operacionais da loja não estão configuradas.",
      ),
    );
  }

  if (!source.executionPolicies.data) {
    return blocked(
      issue(
        "operation_execution_policies_not_configured",
        "As políticas operacionais de execução não estão configuradas.",
      ),
    );
  }

  const settings = source.settings.data;
  const policies = source.executionPolicies.data;
  const issues: StoreSettingsReadinessIssue[] = [];

  if (!explicitBoolean(settings.offers_installation)) {
    issues.push(
      issue(
        "operation_installation_choice_missing",
        "A decisão sobre oferecer instalação não foi configurada.",
      ),
    );
  }

  if (!explicitBoolean(settings.offers_technical_visit)) {
    issues.push(
      issue(
        "operation_technical_visit_choice_missing",
        "A decisão sobre oferecer visita técnica não foi configurada.",
      ),
    );
  }

  const requiredMarkers: Array<
    [
      keyof OperationExecutionPoliciesReadinessRow,
      string,
      string,
    ]
  > = [
    [
      "technical_visit_configured_at",
      "operation_technical_visit_policy_not_configured",
      "A política de visita técnica não foi configurada.",
    ],
    [
      "installation_configured_at",
      "operation_installation_policy_not_configured",
      "A política de instalação não foi configurada.",
    ],
    [
      "pool_replacement_configured_at",
      "operation_pool_replacement_policy_not_configured",
      "A política de troca/substituição não foi configurada.",
    ],
    [
      "delivery_configured_at",
      "operation_delivery_policy_not_configured",
      "A política de entrega não foi configurada.",
    ],
    [
      "pickup_configured_at",
      "operation_pickup_policy_not_configured",
      "A política de retirada não foi configurada.",
    ],
    [
      "technical_services_configured_at",
      "operation_technical_services_policy_not_configured",
      "A política de serviços técnicos não foi configurada.",
    ],
  ];

  for (const [field, code, message] of requiredMarkers) {
    if (!hasMarker(policies[field])) {
      issues.push(issue(code, message));
    }
  }

  return issues.length > 0 ? blocked(...issues) : ready();
}

function adaptPayment(
  source: SettingsReadinessSource<PaymentSettingsReadinessRow>,
): StoreSettingsReadinessFamilyInput {
  if (!source.ok) {
    return unknown("payment", [source.error]);
  }

  if (!source.data) {
    return blocked(
      issue(
        "payment_not_configured",
        "As configurações de pagamento não estão configuradas.",
      ),
    );
  }

  const row = source.data;
  const issues: StoreSettingsReadinessIssue[] = [];

  const acceptedMethods = Array.isArray(row.accepted_payment_methods)
    ? row.accepted_payment_methods.filter(
        (entry): entry is string => typeof entry === "string" && cleanText(entry).length > 0,
      )
    : [];

  if (acceptedMethods.length === 0) {
    issues.push(
      issue(
        "payment_methods_not_configured",
        "Nenhuma forma de pagamento válida foi configurada.",
      ),
    );
  }

  const downPaymentMode = cleanText(row.down_payment_mode);

  if (!["none", "optional", "required"].includes(downPaymentMode)) {
    issues.push(
      issue(
        "payment_down_payment_mode_invalid",
        "A política de entrada está ausente ou inválida.",
      ),
    );
  } else if (downPaymentMode === "none") {
    if (
      cleanText(row.down_payment_value_type) ||
      row.down_payment_percent != null ||
      row.down_payment_amount_cents != null
    ) {
      issues.push(
        issue(
          "payment_down_payment_none_inconsistent",
          "A política de entrada está inconsistente com o modo sem entrada.",
        ),
      );
    }
  } else {
    const valueType = cleanText(row.down_payment_value_type);

    if (!["percent", "fixed", "case_by_case"].includes(valueType)) {
      issues.push(
        issue(
          "payment_down_payment_value_type_invalid",
          "A forma de cálculo da entrada está ausente ou inválida.",
        ),
      );
    } else if (valueType === "percent") {
      if (
        !finiteNumber(row.down_payment_percent) ||
        row.down_payment_percent <= 0 ||
        row.down_payment_percent > 100
      ) {
        issues.push(
          issue(
            "payment_down_payment_percent_invalid",
            "O percentual de entrada está ausente ou inválido.",
          ),
        );
      }

      if (row.down_payment_amount_cents != null) {
        issues.push(
          issue(
            "payment_down_payment_percent_inconsistent",
            "A entrada percentual possui valor fixo incompatível.",
          ),
        );
      }
    } else if (valueType === "fixed") {
      if (
        !finiteNumber(row.down_payment_amount_cents) ||
        row.down_payment_amount_cents <= 0
      ) {
        issues.push(
          issue(
            "payment_down_payment_amount_invalid",
            "O valor fixo de entrada está ausente ou inválido.",
          ),
        );
      }

      if (row.down_payment_percent != null) {
        issues.push(
          issue(
            "payment_down_payment_fixed_inconsistent",
            "A entrada fixa possui percentual incompatível.",
          ),
        );
      }
    } else if (
      row.down_payment_percent != null ||
      row.down_payment_amount_cents != null
    ) {
      issues.push(
        issue(
          "payment_down_payment_case_by_case_inconsistent",
          "A entrada definida caso a caso possui valores fixos incompatíveis.",
        ),
      );
    }
  }

  if (!explicitBoolean(row.installments_enabled)) {
    issues.push(
      issue(
        "payment_installments_choice_missing",
        "A decisão sobre parcelamento não foi configurada.",
      ),
    );
  } else if (row.installments_enabled === false) {
    if (
      row.max_installments != null ||
      cleanText(row.installment_interest_policy)
    ) {
      issues.push(
        issue(
          "payment_installments_disabled_inconsistent",
          "O parcelamento está desativado, mas mantém regras filhas configuradas.",
        ),
      );
    }
  } else {
    if (
      !Number.isInteger(row.max_installments) ||
      (row.max_installments ?? 0) < 1 ||
      (row.max_installments ?? 0) > 360
    ) {
      issues.push(
        issue(
          "payment_max_installments_invalid",
          "O número máximo de parcelas está ausente ou inválido.",
        ),
      );
    }

    if (
      !["interest_free", "with_interest", "case_by_case"].includes(
        cleanText(row.installment_interest_policy),
      )
    ) {
      issues.push(
        issue(
          "payment_installment_interest_policy_invalid",
          "A política de juros do parcelamento está ausente ou inválida.",
        ),
      );
    }
  }

  return issues.length > 0 ? blocked(...issues) : ready();
}

function adaptDiscount(
  source: SettingsReadinessSource<DiscountSettingsReadinessSourceData>,
): StoreSettingsReadinessFamilyInput {
  if (!source.ok) {
    return unknown("discount", [source.error]);
  }

  if (!source.data?.settings) {
    return blocked(
      issue(
        "discount_not_configured",
        "A política de desconto não está configurada.",
      ),
    );
  }

  const row = source.data.settings;
  const highValue = source.data.highValueSettings;
  const issues: StoreSettingsReadinessIssue[] = [];

  if (
    !finiteNumber(row.default_discount_percent) ||
    row.default_discount_percent < 0
  ) {
    issues.push(
      issue(
        "discount_default_percent_invalid",
        "O primeiro degrau de desconto está ausente ou inválido.",
      ),
    );
  }

  if (
    !finiteNumber(row.max_discount_percent) ||
    row.max_discount_percent < 0
  ) {
    issues.push(
      issue(
        "discount_max_percent_invalid",
        "O teto de desconto está ausente ou inválido.",
      ),
    );
  }

  if (
    finiteNumber(row.default_discount_percent) &&
    finiteNumber(row.max_discount_percent) &&
    row.default_discount_percent > row.max_discount_percent
  ) {
    issues.push(
      issue(
        "discount_policy_range_invalid",
        "O primeiro degrau de desconto é maior que o teto configurado.",
      ),
    );
  }

  if (!explicitBoolean(row.allow_ask_above_max_discount)) {
    issues.push(
      issue(
        "discount_above_max_choice_missing",
        "A decisão sobre consultar acima do teto não foi configurada.",
      ),
    );
  }

  if (
    ![
      "approval_required",
      "default_step_autonomous",
      "within_policy_autonomous",
    ].includes(cleanText(row.discount_autonomy_mode))
  ) {
    issues.push(
      issue(
        "discount_autonomy_invalid",
        "O modo de autonomia de desconto está ausente ou inválido.",
      ),
    );
  }

  if (highValue?.enabled === true) {
    if (
      !finiteNumber(highValue.threshold_amount_cents) ||
      highValue.threshold_amount_cents <= 0
    ) {
      issues.push(
        issue(
          "discount_high_value_threshold_invalid",
          "O valor mínimo da política de alto valor está ausente ou inválido.",
        ),
      );
    }

    if (
      !finiteNumber(highValue.discount_percent) ||
      highValue.discount_percent <= 0 ||
      highValue.discount_percent > 100
    ) {
      issues.push(
        issue(
          "discount_high_value_percent_invalid",
          "O percentual da política de alto valor está ausente ou inválido.",
        ),
      );
    }
  } else if (
    highValue &&
    highValue.enabled !== false &&
    highValue.enabled != null
  ) {
    issues.push(
      issue(
        "discount_high_value_enabled_invalid",
        "A política de alto valor possui estado inválido.",
      ),
    );
  }

  return issues.length > 0 ? blocked(...issues) : ready();
}

function normalizePlaceholder(value: unknown) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isPlaceholder(value: unknown, placeholders: readonly string[]) {
  const normalized = normalizePlaceholder(value);
  return !normalized || placeholders.includes(normalized);
}

function adaptChannel(
  source: SettingsReadinessSource<ChannelSettingsReadinessRow>,
): StoreSettingsReadinessFamilyInput {
  if (!source.ok) {
    return unknown("channel", [source.error]);
  }

  if (!source.data) {
    return blocked(
      issue(
        "channel_not_configured",
        "O canal comercial não está configurado.",
      ),
    );
  }

  const row = source.data;
  const issues: StoreSettingsReadinessIssue[] = [];

  if (
    isPlaceholder(row.commercial_channel_name, [
      "nao definido",
      "ainda nao definido",
      "canal comercial principal",
    ])
  ) {
    issues.push(
      issue(
        "channel_name_not_configured",
        "O nome do canal comercial não foi definido.",
      ),
    );
  }

  if (!explicitBoolean(row.commercial_receives_real_clients)) {
    issues.push(
      issue(
        "channel_receives_real_clients_choice_missing",
        "A decisão sobre receber clientes reais não foi configurada.",
      ),
    );
  }

  if (!explicitBoolean(row.commercial_is_official_sales_channel)) {
    issues.push(
      issue(
        "channel_official_sales_choice_missing",
        "A decisão sobre ser canal oficial de vendas não foi configurada.",
      ),
    );
  }

  if (
    isPlaceholder(row.commercial_channel_type, [
      "nao definido",
      "ainda nao definido",
      "whatsapp comercial da loja",
    ])
  ) {
    issues.push(
      issue(
        "channel_type_not_configured",
        "O tipo do canal comercial não foi definido.",
      ),
    );
  }

  if (
    isPlaceholder(row.commercial_entry_priority, [
      "nao definido",
      "ainda nao definido",
      "canal principal de entrada de clientes",
    ])
  ) {
    issues.push(
      issue(
        "channel_entry_priority_not_configured",
        "A prioridade de entrada do canal comercial não foi definida.",
      ),
    );
  }

  if (!explicitBoolean(row.commercial_human_handoff_enabled)) {
    issues.push(
      issue(
        "channel_human_handoff_choice_missing",
        "A decisão sobre transferência para atendimento humano não foi configurada.",
      ),
    );
  }

  if (
    isPlaceholder(row.integration_provider_name, [
      "nao definido",
      "ainda nao definido",
    ])
  ) {
    issues.push(
      issue(
        "channel_integration_provider_not_configured",
        "O provedor principal de integração não foi definido.",
      ),
    );
  }

  return issues.length > 0 ? blocked(...issues) : ready();
}

function adaptCommercialAi(
  source: SettingsReadinessSource<CommercialAiSettingsReadinessRow>,
): StoreSettingsReadinessFamilyInput {
  if (!source.ok) {
    return unknown("commercial_ai", [source.error]);
  }

  if (!source.data) {
    return blocked(
      issue(
        "commercial_ai_not_configured",
        "As configurações da IA comercial não estão configuradas.",
      ),
    );
  }

  const row = source.data;
  const issues: StoreSettingsReadinessIssue[] = [];

  if (!hasMarker(row.price_policy_configured_at)) {
    issues.push(
      issue(
        "commercial_ai_price_policy_not_configured",
        "A política de resposta de preço não foi confirmada.",
      ),
    );
  }

  if (!hasMarker(row.complementary_suggestions_configured_at)) {
    issues.push(
      issue(
        "commercial_ai_suggestions_not_configured",
        "A política de sugestões comerciais não foi confirmada.",
      ),
    );
  }

  if (
    hasMarker(row.complementary_suggestions_configured_at) &&
    !explicitBoolean(row.complementary_suggestions_enabled)
  ) {
    issues.push(
      issue(
        "commercial_ai_suggestions_choice_invalid",
        "A decisão sobre sugestões comerciais está ausente ou inválida.",
      ),
    );
  }

  if (row.complementary_suggestions_enabled === true) {
    if (!cleanText(row.complementary_scope_mode)) {
      issues.push(
        issue(
          "commercial_ai_suggestions_scope_missing",
          "O escopo das sugestões comerciais não foi definido.",
        ),
      );
    }

    const moments = Array.isArray(row.complementary_allowed_moments)
      ? row.complementary_allowed_moments.filter(
          (entry) => typeof entry === "string" && cleanText(entry),
        )
      : [];

    if (moments.length === 0) {
      issues.push(
        issue(
          "commercial_ai_suggestions_moments_missing",
          "Os momentos permitidos para sugestões comerciais não foram definidos.",
        ),
      );
    }
  }

  return issues.length > 0 ? blocked(...issues) : ready();
}

function adaptStrategy(
  source: SettingsReadinessSource<StrategySettingsReadinessRow>,
): StoreSettingsReadinessFamilyInput {
  if (!source.ok) {
    return unknown("strategy", [source.error]);
  }

  if (!source.data) {
    return blocked(
      issue(
        "strategy_not_configured",
        "As configurações estratégicas da loja não estão configuradas.",
      ),
    );
  }

  const row = source.data;
  const issues: StoreSettingsReadinessIssue[] = [];

  const requiredMarkers: Array<
    [keyof StrategySettingsReadinessRow, string, string]
  > = [
    [
      "service_region_configured_at",
      "strategy_service_region_not_configured",
      "A região de atendimento não foi configurada.",
    ],
    [
      "brands_configuration_configured_at",
      "strategy_brands_not_configured",
      "A configuração de marcas não foi concluída.",
    ],
    [
      "strategy_commercial_experience_configured_at",
      "strategy_commercial_experience_not_configured",
      "A experiência comercial não foi configurada.",
    ],
    [
      "strategy_commercial_strategy_configured_at",
      "strategy_commercial_strategy_not_configured",
      "A estratégia comercial não foi configurada.",
    ],
  ];

  for (const [field, code, message] of requiredMarkers) {
    if (!hasMarker(row[field])) {
      issues.push(issue(code, message));
    }
  }

  return issues.length > 0 ? blocked(...issues) : ready();
}

export function adaptStoreSettingsReadinessSources(
  sources: StoreSettingsReadinessSources,
): StoreSettingsReadinessInput {
  return {
    operation: adaptOperation(sources.operation),
    payment: adaptPayment(sources.payment),
    discount: adaptDiscount(sources.discount),
    channel: adaptChannel(sources.channel),
    commercial_ai: adaptCommercialAi(sources.commercialAi),
    strategy: adaptStrategy(sources.strategy),
  };
}
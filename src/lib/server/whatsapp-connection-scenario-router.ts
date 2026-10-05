export type WhatsappConnectionScenario =
  | "standard_first_connection"
  | "existing_zion_binding"
  | "zion_number_change_required"
  | "business_app_meta_flow"
  | "personal_whatsapp_guidance_required"
  | "external_bsp_migration_required"
  | "coexistence_not_yet_supported"
  | "unknown_meta_state"
  | "recoverable_error"
  | "blocking_error";

export type WhatsappConnectionScenarioSeverity = "info" | "warning" | "error";

export type WhatsappConnectionScenarioResult = {
  scenario: WhatsappConnectionScenario;
  severity: WhatsappConnectionScenarioSeverity;
  userMessageKey: string;
  canRetry: boolean;
  requiresUserAction: boolean;
  requiresSupport: boolean;
  requiresBusinessApp: boolean;
  requiresExternalMigration: boolean;
};

export type WhatsappConnectionMetaErrorEvidence = {
  httpStatus?: number;
  metaCode?: string | null;
  metaSubcode?: string | null;
  metaType?: string | null;
  operation?: string | null;
  normalizedCode?: string | null;
};

export type WhatsappConnectionScenarioEvidence = {
  hasActiveZionBinding?: boolean;
  hasExistingChangeRequest?: boolean;
  metaErrorCode?: unknown;
  metaErrorMessage?: unknown;
  metaErrorType?: unknown;
  metaErrorSubcode?: unknown;
  metaBusinessAppDetected?: boolean;
  metaPersonalWhatsappDetected?: boolean;
  metaExternalBspDetected?: boolean;
  metaErrorEvidence?: WhatsappConnectionMetaErrorEvidence;
};

function clean(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function result(
  scenario: WhatsappConnectionScenario,
  overrides: Partial<WhatsappConnectionScenarioResult> = {},
): WhatsappConnectionScenarioResult {
  return {
    scenario,
    severity: "error",
    userMessageKey: "whatsapp.connection.generic_error",
    canRetry: false,
    requiresUserAction: true,
    requiresSupport: false,
    requiresBusinessApp: false,
    requiresExternalMigration: false,
    ...overrides,
  };
}

export function classifyWhatsappConnectionScenario(
  evidence: WhatsappConnectionScenarioEvidence = {},
): WhatsappConnectionScenarioResult {
  if (evidence.hasActiveZionBinding === true) {
    return result("existing_zion_binding", {
      severity: "info",
      userMessageKey: "whatsapp.connection.existing_zion_binding",
      canRetry: false,
      requiresUserAction: false,
    });
  }

  if (evidence.hasExistingChangeRequest === true) {
    return result("zion_number_change_required", {
      severity: "info",
      userMessageKey: "whatsapp.connection.number_change_required",
      canRetry: false,
      requiresUserAction: true,
    });
  }

  if (evidence.metaBusinessAppDetected === true) {
    return result("business_app_meta_flow", {
      severity: "warning",
      userMessageKey: "whatsapp.connection.business_app_meta_flow",
      canRetry: false,
      requiresUserAction: true,
      requiresBusinessApp: true,
    });
  }

  if (evidence.metaPersonalWhatsappDetected === true) {
    return result("personal_whatsapp_guidance_required", {
      severity: "warning",
      userMessageKey: "whatsapp.connection.personal_whatsapp_guidance_required",
      canRetry: false,
      requiresUserAction: true,
      requiresBusinessApp: true,
    });
  }

  if (evidence.metaExternalBspDetected === true) {
    return result("external_bsp_migration_required", {
      severity: "warning",
      userMessageKey: "whatsapp.connection.external_bsp_migration_required",
      canRetry: false,
      requiresUserAction: true,
      requiresExternalMigration: true,
    });
  }

  if (
    clean(evidence.metaErrorCode) ||
    clean(evidence.metaErrorMessage) ||
    clean(evidence.metaErrorType) ||
    clean(evidence.metaErrorSubcode)
  ) {
    const text = [
      evidence.metaErrorCode,
      evidence.metaErrorMessage,
      evidence.metaErrorType,
      evidence.metaErrorSubcode,
    ]
      .map(clean)
      .join(" ");

    if (/business.?app|coexist/.test(text)) {
      return result("business_app_meta_flow", {
        severity: "warning",
        userMessageKey: "whatsapp.connection.business_app_meta_flow",
        requiresUserAction: true,
        requiresBusinessApp: true,
      });
    }

    if (/timeout|temporar|unavailable|rate.?limit|5\d\d|network/.test(text)) {
      return result("recoverable_error", {
        severity: "warning",
        userMessageKey: "whatsapp.connection.recoverable_error",
        canRetry: true,
      });
    }

    if (/permission|forbidden|invalid|not.?authorized|access.?denied|policy/.test(text)) {
      return result("blocking_error", {
        userMessageKey: "whatsapp.connection.blocking_error",
        requiresSupport: true,
      });
    }

    return result("unknown_meta_state", {
      requiresSupport: true,
      userMessageKey: "whatsapp.connection.unknown_meta_state",
    });
  }

  return result("standard_first_connection", {
    severity: "info",
    userMessageKey: "whatsapp.connection.standard_first_connection",
    canRetry: true,
    requiresUserAction: true,
  });
}

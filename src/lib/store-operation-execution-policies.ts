export type TechnicalVisitExecutionPolicy = {
  required_situations: string[];
  required_other?: string;
  optional_situations: string[];
  optional_other?: string;
  team_mode: string;
  team_rule?: string;
  requires_appointment: boolean;
  duration_mode?: string;
  duration_minutes?: number | null;
  duration_rule?: string;
  preconfirm_items: string[];
  preconfirm_other?: string;
  notes?: string;
};

export type InstallationExecutionPolicy = {
  customer_can_buy_without: "sim" | "nao" | "depende";
  customer_can_buy_without_rule?: string;
  third_party_pool: "sim" | "nao" | "depende";
  third_party_pool_rule?: string;
  supply_mode: string;
  supplier_lead_time_mode?: string;
  supplier_lead_time_value?: string;
  supplier_lead_time_rule?: string;
  start_lead_time_mode: string;
  start_lead_time_value?: string;
  start_lead_time_rule?: string;
  duration_mode: string;
  duration_value?: number | null;
  duration_rule?: string;
  has_multiple_teams: boolean;
  concurrent_capacity: number;
  schedule_gates: string[];
  schedule_gates_other?: string;
  start_gates: string[];
  start_gates_other?: string;
  includes: string[];
  includes_other?: string;
  excludes: string[];
  excludes_details?: string;
  notes?: string;
};

export type StoreOperationExecutionPoliciesRow = {
  organization_id: string;
  store_id: string;
  technical_visit_policy: TechnicalVisitExecutionPolicy | null;
  installation_policy: InstallationExecutionPolicy | null;
  pool_replacement_policy: PoolReplacementExecutionPolicy | null;
  delivery_policy: DeliveryExecutionPolicy | null;
  pickup_policy: PickupExecutionPolicy | null;
  technical_services_policy: TechnicalServicesExecutionPolicy | null;
  technical_visit_configured_at: string | null;
  installation_configured_at: string | null;
  pool_replacement_configured_at: string | null;
  delivery_configured_at: string | null;
  pickup_configured_at: string | null;
  technical_services_configured_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type TechnicalVisitDraft = {
  visit_required_situations: string[];
  visit_required_other: string;
  visit_optional_situations: string[];
  visit_optional_other: string;
  visit_team_mode: string;
  visit_team_rule: string;
  visit_requires_appointment: string;
  visit_duration_mode: string;
  visit_duration_minutes: string;
  visit_duration_rule: string;
  visit_pricing_mode: string;
  visit_fixed_fee: string;
  visit_case_by_case_rule: string;
  visit_deductible: string;
  visit_preconfirm_items: string[];
  visit_preconfirm_other: string;
  visit_other_notes: string;
};

type InstallationDraft = {
  installation_customer_can_buy_without: string;
  installation_customer_can_buy_without_rule: string;
  installation_third_party_pool: string;
  installation_third_party_pool_rule: string;
  installation_supply_mode: string;
  installation_supplier_lead_time_mode: string;
  installation_supplier_lead_time_value: string;
  installation_supplier_lead_time_rule: string;
  installation_start_lead_time_mode: string;
  installation_start_lead_time_days: string;
  installation_start_lead_time_rule: string;
  installation_duration_mode: string;
  installation_duration_value: string;
  installation_duration_unit: string;
  installation_duration_rule: string;
  installation_has_multiple_teams: string;
  installation_concurrent_capacity: string;
  installation_schedule_gates: string[];
  installation_schedule_gates_other: string;
  installation_start_gates: string[];
  installation_start_gates_other: string;
  installation_includes: string[];
  installation_includes_other: string;
  installation_excludes_options: string[];
  installation_excludes: string;
  installation_notes: string;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => cleanText(item))
        .filter(Boolean),
    ),
  );
}

function yesNoToBoolean(value: string): boolean | null {
  const normalized = cleanText(value).toLocaleLowerCase("pt-BR");

  if (normalized === "sim") return true;
  if (normalized === "não" || normalized === "nao") return false;

  return null;
}

function yesNoDependsToCanonical(
  value: string,
): "sim" | "nao" | "depende" | null {
  const normalized = cleanText(value).toLocaleLowerCase("pt-BR");

  if (normalized === "sim") return "sim";
  if (normalized === "não" || normalized === "nao") return "nao";
  if (normalized === "depende") return "depende";

  return null;
}

function positiveInteger(value: string): number | null {
  const normalized = cleanText(value);

  if (!/^\d+$/.test(normalized)) return null;

  const parsed = Number(normalized);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseVisitFixedFeeToCents(value: string): number | null {
  const raw = cleanText(value);

  if (!raw) return null;

  const normalized = raw
    .replace(/\s/g, "")
    .replace(/^R\$/i, "")
    .replace(/\./g, "")
    .replace(",", ".");

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const amount = Number(normalized);
  const cents = Math.round(amount * 100);

  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function formatVisitFixedFeeFromCents(
  cents: number | null | undefined,
): string {
  if (!Number.isSafeInteger(cents) || !cents || cents <= 0) return "";

  return (cents / 100).toFixed(2).replace(".", ",");
}

export function buildTechnicalVisitExecutionPolicy(
  draft: TechnicalVisitDraft,
):
  | { ok: true; value: TechnicalVisitExecutionPolicy }
  | { ok: false; error: string } {
  const requiresAppointment = yesNoToBoolean(
    draft.visit_requires_appointment,
  );

  if (requiresAppointment == null) {
    return {
      ok: false,
      error: "Defina se a visita técnica precisa ser agendada.",
    };
  }

  const teamMode = cleanText(draft.visit_team_mode);

  if (!teamMode) {
    return {
      ok: false,
      error: "Defina quem normalmente realiza a visita técnica.",
    };
  }

  const policy: TechnicalVisitExecutionPolicy = {
    required_situations: cleanArray(draft.visit_required_situations),
    optional_situations: cleanArray(draft.visit_optional_situations),
    team_mode: teamMode,
    requires_appointment: requiresAppointment,
    preconfirm_items: cleanArray(draft.visit_preconfirm_items),
  };

  if (policy.required_situations.includes("outro")) {
    const detail = cleanText(draft.visit_required_other);
    if (!detail) {
      return {
        ok: false,
        error: "Especifique a outra situação em que a visita é obrigatória.",
      };
    }
    policy.required_other = detail;
  }

  if (policy.optional_situations.includes("outro")) {
    const detail = cleanText(draft.visit_optional_other);
    if (!detail) {
      return {
        ok: false,
        error: "Especifique a outra situação em que a visita pode ser oferecida.",
      };
    }
    policy.optional_other = detail;
  }

  if (teamMode === "outro_time" || teamMode === "caso_a_caso") {
    const teamRule = cleanText(draft.visit_team_rule);
    if (!teamRule) {
      return {
        ok: false,
        error: "Explique quem realiza a visita técnica nessa situação.",
      };
    }
    policy.team_rule = teamRule;
  }

  if (requiresAppointment) {
    const durationMode = cleanText(draft.visit_duration_mode);

    if (!durationMode) {
      return {
        ok: false,
        error: "Defina quanto tempo deve ser reservado para a visita.",
      };
    }

    policy.duration_mode = durationMode;

    if (["30", "60", "90", "120"].includes(durationMode)) {
      policy.duration_minutes = Number(durationMode);
    } else if (durationMode === "personalizado") {
      const minutes = positiveInteger(draft.visit_duration_minutes);

      if (minutes == null) {
        return {
          ok: false,
          error: "Informe um tempo válido em minutos para a visita.",
        };
      }

      policy.duration_minutes = minutes;
    } else if (durationMode === "varia") {
      const rule = cleanText(draft.visit_duration_rule);

      if (!rule) {
        return {
          ok: false,
          error: "Explique o que faz a duração da visita variar.",
        };
      }

      policy.duration_rule = rule;
    } else {
      return {
        ok: false,
        error: "Modo de duração da visita inválido.",
      };
    }
  }

  if (policy.preconfirm_items.includes("outro")) {
    const detail = cleanText(draft.visit_preconfirm_other);

    if (!detail) {
      return {
        ok: false,
        error: "Especifique o outro requisito antes do agendamento.",
      };
    }

    policy.preconfirm_other = detail;
  }

  const notes = cleanText(draft.visit_other_notes);
  if (notes) policy.notes = notes;

  return { ok: true, value: policy };
}

export function buildInstallationExecutionPolicy(
  draft: InstallationDraft,
):
  | { ok: true; value: InstallationExecutionPolicy }
  | { ok: false; error: string } {
  const customerCanBuyWithout = yesNoDependsToCanonical(
    draft.installation_customer_can_buy_without,
  );
  const thirdPartyPool = yesNoDependsToCanonical(
    draft.installation_third_party_pool,
  );

  if (!customerCanBuyWithout) {
    return {
      ok: false,
      error: "Defina se o cliente pode comprar sem contratar a instalação.",
    };
  }

  if (!thirdPartyPool) {
    return {
      ok: false,
      error: "Defina se a loja instala piscinas compradas de terceiros.",
    };
  }

  const supplyMode = cleanText(draft.installation_supply_mode);
  const startLeadTimeMode = cleanText(
    draft.installation_start_lead_time_mode,
  );
  const durationMode = cleanText(draft.installation_duration_mode);
  const hasMultipleTeams = yesNoToBoolean(
    draft.installation_has_multiple_teams,
  );

  if (!supplyMode) {
    return { ok: false, error: "Defina como a piscina fica disponível." };
  }

  if (!startLeadTimeMode) {
    return {
      ok: false,
      error: "Defina o prazo normal para iniciar a instalação.",
    };
  }

  if (!durationMode) {
    return {
      ok: false,
      error: "Defina por quanto tempo a instalação ocupa uma equipe.",
    };
  }

  if (hasMultipleTeams == null) {
    return {
      ok: false,
      error: "Defina se existem equipes simultâneas de instalação.",
    };
  }

  const capacity = positiveInteger(
    draft.installation_concurrent_capacity,
  );

  if (capacity == null) {
    return {
      ok: false,
      error: "Informe uma capacidade simultânea válida.",
    };
  }

  if (!hasMultipleTeams && capacity !== 1) {
    return {
      ok: false,
      error: "Uma única equipe deve ter capacidade simultânea igual a 1.",
    };
  }

  if (hasMultipleTeams && capacity < 2) {
    return {
      ok: false,
      error: "Mais de uma equipe exige capacidade simultânea de pelo menos 2.",
    };
  }

  const policy: InstallationExecutionPolicy = {
    customer_can_buy_without: customerCanBuyWithout,
    third_party_pool: thirdPartyPool,
    supply_mode: supplyMode,
    start_lead_time_mode: startLeadTimeMode,
    duration_mode: durationMode,
    has_multiple_teams: hasMultipleTeams,
    concurrent_capacity: capacity,
    schedule_gates: cleanArray(draft.installation_schedule_gates),
    start_gates: cleanArray(draft.installation_start_gates),
    includes: cleanArray(draft.installation_includes),
    excludes: cleanArray(draft.installation_excludes_options),
  };

  if (customerCanBuyWithout === "depende") {
    const rule = cleanText(
      draft.installation_customer_can_buy_without_rule,
    );

    if (!rule) {
      return {
        ok: false,
        error: "Explique quando a compra sem instalação é permitida.",
      };
    }

    policy.customer_can_buy_without_rule = rule;
  }

  if (thirdPartyPool === "depende") {
    const rule = cleanText(draft.installation_third_party_pool_rule);

    if (!rule) {
      return {
        ok: false,
        error: "Explique quando piscinas de terceiros são instaladas.",
      };
    }

    policy.third_party_pool_rule = rule;
  }

  if (supplyMode === "sob_encomenda" || supplyMode === "misto") {
    const supplierMode = cleanText(
      draft.installation_supplier_lead_time_mode,
    );

    if (!supplierMode) {
      return {
        ok: false,
        error: "Defina o prazo da fábrica ou fornecedor.",
      };
    }

    policy.supplier_lead_time_mode = supplierMode;

    if (supplierMode === "outro") {
      const value = cleanText(
        draft.installation_supplier_lead_time_value,
      );

      if (!value) {
        return {
          ok: false,
          error: "Informe o outro prazo da fábrica ou fornecedor.",
        };
      }

      policy.supplier_lead_time_value = value;
    }

    if (supplierMode === "varia") {
      const rule = cleanText(
        draft.installation_supplier_lead_time_rule,
      );

      if (!rule) {
        return {
          ok: false,
          error: "Explique o que faz o prazo do fornecedor variar.",
        };
      }

      policy.supplier_lead_time_rule = rule;
    }
  }

  if (startLeadTimeMode === "outro") {
    const value = cleanText(draft.installation_start_lead_time_days);

    if (!value) {
      return {
        ok: false,
        error: "Informe o outro prazo para iniciar a instalação.",
      };
    }

    policy.start_lead_time_value = value;
  }

  if (startLeadTimeMode === "varia") {
    const rule = cleanText(draft.installation_start_lead_time_rule);

    if (!rule) {
      return {
        ok: false,
        error: "Explique o que define quando a instalação pode começar.",
      };
    }

    policy.start_lead_time_rule = rule;
  }

  if (durationMode === "varia") {
    const rule = cleanText(draft.installation_duration_rule);

    if (!rule) {
      return {
        ok: false,
        error: "Explique o que faz o tempo de instalação variar.",
      };
    }

    policy.duration_rule = rule;
  } else {
    const durationValue = positiveInteger(
      draft.installation_duration_value,
    );

    if (durationValue == null) {
      return {
        ok: false,
        error: "Informe um tempo de ocupação válido para a instalação.",
      };
    }

    policy.duration_value = durationValue;
  }

  if (policy.schedule_gates.includes("outro")) {
    const detail = cleanText(
      draft.installation_schedule_gates_other,
    );

    if (!detail) {
      return {
        ok: false,
        error: "Especifique o outro requisito antes de agendar.",
      };
    }

    policy.schedule_gates_other = detail;
  }

  if (policy.start_gates.includes("outro")) {
    const detail = cleanText(draft.installation_start_gates_other);

    if (!detail) {
      return {
        ok: false,
        error: "Especifique o outro requisito antes de iniciar.",
      };
    }

    policy.start_gates_other = detail;
  }

  if (policy.includes.includes("outro")) {
    const detail = cleanText(draft.installation_includes_other);

    if (!detail) {
      return {
        ok: false,
        error: "Especifique o outro item incluído na instalação.",
      };
    }

    policy.includes_other = detail;
  }

  const excludesDetails = cleanText(draft.installation_excludes);

  if (policy.excludes.includes("outro") && !excludesDetails) {
    return {
      ok: false,
      error: "Especifique o outro item não incluído na instalação.",
    };
  }

  if (excludesDetails) policy.excludes_details = excludesDetails;

  const notes = cleanText(draft.installation_notes);
  if (notes) policy.notes = notes;

  return { ok: true, value: policy };
}

export function technicalVisitPolicyToDraftPatch(
  policy: TechnicalVisitExecutionPolicy | null,
  pricing?: {
    mode?: string | null;
    fixedFeeCents?: number | null;
    caseByCaseRule?: string | null;
    deductible?: boolean | null;
  },
): Partial<TechnicalVisitDraft> {
  if (!policy) {
    return {
      visit_required_situations: [],
      visit_required_other: "",
      visit_optional_situations: [],
      visit_optional_other: "",
      visit_team_mode: "",
      visit_team_rule: "",
      visit_requires_appointment: "",
      visit_duration_mode: "",
      visit_duration_minutes: "",
      visit_duration_rule: "",
      visit_pricing_mode: "",
      visit_fixed_fee: "",
      visit_case_by_case_rule: "",
      visit_deductible: "",
      visit_preconfirm_items: [],
      visit_preconfirm_other: "",
      visit_other_notes: "",
    };
  }

  return {
    visit_required_situations: cleanArray(policy.required_situations),
    visit_required_other: cleanText(policy.required_other),
    visit_optional_situations: cleanArray(policy.optional_situations),
    visit_optional_other: cleanText(policy.optional_other),
    visit_team_mode: cleanText(policy.team_mode),
    visit_team_rule: cleanText(policy.team_rule),
    visit_requires_appointment: policy.requires_appointment ? "Sim" : "Não",
    visit_duration_mode: cleanText(policy.duration_mode),
    visit_duration_minutes:
      typeof policy.duration_minutes === "number"
        ? String(policy.duration_minutes)
        : "",
    visit_duration_rule: cleanText(policy.duration_rule),
    visit_pricing_mode: cleanText(pricing?.mode),
    visit_fixed_fee: formatVisitFixedFeeFromCents(
      pricing?.fixedFeeCents,
    ),
    visit_case_by_case_rule: cleanText(pricing?.caseByCaseRule),
    visit_deductible:
      pricing?.deductible === true
        ? "Sim"
        : pricing?.deductible === false
          ? "Não"
          : "",
    visit_preconfirm_items: cleanArray(policy.preconfirm_items),
    visit_preconfirm_other: cleanText(policy.preconfirm_other),
    visit_other_notes: cleanText(policy.notes),
  };
}

export function installationPolicyToDraftPatch(
  policy: InstallationExecutionPolicy | null,
): Partial<InstallationDraft> {
  if (!policy) {
    return {
      installation_customer_can_buy_without: "",
      installation_customer_can_buy_without_rule: "",
      installation_third_party_pool: "",
      installation_third_party_pool_rule: "",
      installation_supply_mode: "",
      installation_supplier_lead_time_mode: "",
      installation_supplier_lead_time_value: "",
      installation_supplier_lead_time_rule: "",
      installation_start_lead_time_mode: "",
      installation_start_lead_time_days: "",
      installation_start_lead_time_rule: "",
      installation_duration_mode: "",
      installation_duration_value: "",
      installation_duration_rule: "",
      installation_has_multiple_teams: "",
      installation_concurrent_capacity: "",
      installation_schedule_gates: [],
      installation_schedule_gates_other: "",
      installation_start_gates: [],
      installation_start_gates_other: "",
      installation_includes: [],
      installation_includes_other: "",
      installation_excludes_options: [],
      installation_excludes: "",
      installation_notes: "",
    };
  }

  const fromCanonicalYesNoDepends = (
    value: "sim" | "nao" | "depende",
  ) => (value === "sim" ? "Sim" : value === "nao" ? "Não" : "depende");

  return {
    installation_customer_can_buy_without:
      fromCanonicalYesNoDepends(policy.customer_can_buy_without),
    installation_customer_can_buy_without_rule: cleanText(
      policy.customer_can_buy_without_rule,
    ),
    installation_third_party_pool:
      fromCanonicalYesNoDepends(policy.third_party_pool),
    installation_third_party_pool_rule: cleanText(
      policy.third_party_pool_rule,
    ),
    installation_supply_mode: cleanText(policy.supply_mode),
    installation_supplier_lead_time_mode: cleanText(
      policy.supplier_lead_time_mode,
    ),
    installation_supplier_lead_time_value: cleanText(
      policy.supplier_lead_time_value,
    ),
    installation_supplier_lead_time_rule: cleanText(
      policy.supplier_lead_time_rule,
    ),
    installation_start_lead_time_mode: cleanText(
      policy.start_lead_time_mode,
    ),
    installation_start_lead_time_days: cleanText(
      policy.start_lead_time_value,
    ),
    installation_start_lead_time_rule: cleanText(
      policy.start_lead_time_rule,
    ),
    installation_duration_mode: cleanText(policy.duration_mode),
    installation_duration_value:
      typeof policy.duration_value === "number"
        ? String(policy.duration_value)
        : "",
    installation_duration_unit:
      policy.duration_mode === "horas"
        ? "horas"
        : policy.duration_mode === "dias_uteis"
          ? "dias_uteis"
          : policy.duration_mode === "dias_corridos"
            ? "dias_corridos"
            : "horas",
    installation_duration_rule: cleanText(policy.duration_rule),
    installation_has_multiple_teams:
      policy.has_multiple_teams ? "Sim" : "Não",
    installation_concurrent_capacity: String(policy.concurrent_capacity),
    installation_schedule_gates: cleanArray(policy.schedule_gates),
    installation_schedule_gates_other: cleanText(
      policy.schedule_gates_other,
    ),
    installation_start_gates: cleanArray(policy.start_gates),
    installation_start_gates_other: cleanText(policy.start_gates_other),
    installation_includes: cleanArray(policy.includes),
    installation_includes_other: cleanText(policy.includes_other),
    installation_excludes_options: cleanArray(policy.excludes),
    installation_excludes: cleanText(policy.excludes_details),
    installation_notes: cleanText(policy.notes),
  };
}

export type PoolReplacementExecutionPolicy = {
  situations: string[];
  situations_other?: string;
  uses_installation_team: "sim" | "nao" | "depende";
  team_rule?: string;
  duration_mode: "horas" | "dias" | "varia";
  duration_value?: number;
  duration_rule?: string;
  removes_old: "sim" | "nao" | "caso_a_caso";
  removes_old_rule?: string;
  disposal_included: "sim" | "nao" | "caso_a_caso";
  disposal_rule?: string;
  requires_visit: "sim" | "nao" | "depende";
  visit_rule?: string;
  includes: string[];
  excludes: string[];
  excludes_details?: string;
  notes?: string;
};

export type DeliveryExecutionPolicy = {
  items: string[];
  items_other?: string;
  with_installation_mode?: "parte_instalacao" | "separado" | "depende";
  with_installation_timing?: string;
  with_installation_notes?: string;
  provider: "propria" | "parceiro" | "ambos" | "caso_a_caso";
  provider_rule?: string;
  uses_installation_team?: "sim" | "nao" | "depende";
  installation_team_rule?: string;
  pricing_mode:
    | "gratuito"
    | "incluido"
    | "fixo"
    | "destino"
    | "parceiro"
    | "caso_a_caso";
  pricing_destination_mode?: string;
  pricing_destination_rule?: string;
  partner_pricing_mode?: string;
  partner_pricing_rule?: string;
  case_factors?: string[];
  case_rule?: string;
  fixed_fee_cents?: number;
  release_gates: string[];
  release_gates_other?: string;
  unloading_mode: "transporta" | "descarrega" | "posiciona" | "depende";
  notes?: string;
};

export type PickupExecutionPolicy = {
  items: string[];
  items_other?: string;
  location_mode: "loja" | "outro";
  other_location?: string;
  requires_appointment: boolean;
  third_party_allowed: "comprador" | "autorizado";
  release_gates: string[];
  release_gates_other?: string;
  notes?: string;
};

export type TechnicalServicesExecutionPolicy = {
  service_types: string[];
  services_other?: string;
  equipment_types: string[];
  equipment_other?: string;
  equipment_installation_origin_policy?:
    | "somente_loja"
    | "tambem_cliente"
    | "depende";
  equipment_installation_origin_rule?: string;
  equipment_replacement_existing?: "sim" | "nao" | "caso_a_caso";
  equipment_replacement_existing_rule?: string;
  notes?: string;
};

type PoolReplacementDraft = {
  pool_replacement_enabled: string;
  pool_replacement_situations: string[];
  pool_replacement_situations_other: string;
  pool_replacement_removes_old: string;
  pool_replacement_removes_old_rule: string;
  pool_replacement_disposal_included: string;
  pool_replacement_disposal_rule: string;
  pool_replacement_requires_visit: string;
  pool_replacement_visit_rule: string;
  pool_replacement_uses_installation_team: string;
  pool_replacement_team_rule: string;
  pool_replacement_duration_mode: string;
  pool_replacement_duration_value: string;
  pool_replacement_duration_rule: string;
  pool_replacement_includes: string[];
  pool_replacement_excludes_options: string[];
  pool_replacement_excludes: string;
  pool_replacement_notes: string;
};

type DeliveryDraft = {
  delivery_enabled: string;
  delivery_items: string[];
  delivery_items_other: string;
  delivery_with_installation_mode: string;
  delivery_with_installation_timing: string;
  delivery_with_installation_notes: string;
  delivery_provider: string;
  delivery_provider_rule: string;
  delivery_uses_installation_team: string;
  delivery_installation_team_rule: string;
  delivery_coverage_mode: string;
  delivery_pricing_mode: string;
  delivery_pricing_destination_mode: string;
  delivery_pricing_destination_rule: string;
  delivery_partner_pricing_mode: string;
  delivery_partner_pricing_rule: string;
  delivery_case_factors: string[];
  delivery_case_rule: string;
  delivery_fixed_fee: string;
  delivery_requires_appointment: string;
  delivery_lead_time_mode: string;
  delivery_lead_time_days: string;
  delivery_release_gates: string[];
  delivery_release_gates_other: string;
  delivery_unloading_mode: string;
  delivery_notes: string;
};

type PickupDraft = {
  pickup_enabled: string;
  pickup_items: string[];
  pickup_items_other: string;
  pickup_location_mode: string;
  pickup_other_location: string;
  pickup_requires_appointment: string;
  pickup_ready_mode: string;
  pickup_ready_value: string;
  pickup_third_party_allowed: string;
  pickup_release_gates: string[];
  pickup_release_gates_other: string;
  pickup_notes: string;
};

type TechnicalServicesDraft = {
  technical_services_enabled: string;
  technical_service_types: string[];
  technical_services_other: string;
  technical_equipment_types: string[];
  technical_equipment_other: string;
  equipment_installation_origin_policy: string;
  equipment_installation_origin_rule: string;
  equipment_replacement_existing: string;
  equipment_replacement_existing_rule: string;
  technical_services_notes: string;
};

function yesNoCaseToCanonical(
  value: string,
): "sim" | "nao" | "caso_a_caso" | null {
  const normalized = cleanText(value).toLocaleLowerCase("pt-BR");

  if (normalized === "sim") return "sim";
  if (normalized === "não" || normalized === "nao") return "nao";
  if (normalized === "caso_a_caso") return "caso_a_caso";

  return null;
}

function canonicalYesNoDependsToUi(value: unknown): string {
  if (value === "sim") return "Sim";
  if (value === "nao") return "Não";
  if (value === "depende") return "depende";
  return "";
}

function canonicalYesNoCaseToUi(value: unknown): string {
  if (value === "sim") return "Sim";
  if (value === "nao") return "Não";
  if (value === "caso_a_caso") return "caso_a_caso";
  return "";
}

function configuredPolicyEnabledToUi(
  configured: boolean,
  policy: unknown,
): string {
  if (!configured) return "Não definido";
  return policy == null ? "Não" : "Sim";
}

export function parseDeliveryFixedFeeToCents(value: string): number | null {
  return parseVisitFixedFeeToCents(value);
}

export function formatDeliveryFixedFeeFromCents(
  cents: number | null | undefined,
): string {
  return formatVisitFixedFeeFromCents(cents);
}

export function buildPoolReplacementExecutionPolicy(
  draft: PoolReplacementDraft,
):
  | { ok: true; value: PoolReplacementExecutionPolicy }
  | { ok: false; error: string } {
  const usesInstallationTeam = yesNoDependsToCanonical(
    draft.pool_replacement_uses_installation_team,
  );

  if (!usesInstallationTeam) {
    return {
      ok: false,
      error: "Defina se a troca utiliza uma das equipes de instalação.",
    };
  }

  const removesOld = yesNoCaseToCanonical(
    draft.pool_replacement_removes_old,
  );

  if (!removesOld) {
    return {
      ok: false,
      error: "Defina se a loja remove a piscina antiga.",
    };
  }

  const disposalIncluded = yesNoCaseToCanonical(
    draft.pool_replacement_disposal_included,
  );

  if (!disposalIncluded) {
    return {
      ok: false,
      error: "Defina se o descarte da piscina antiga está incluído.",
    };
  }

  const requiresVisit = yesNoDependsToCanonical(
    draft.pool_replacement_requires_visit,
  );

  if (!requiresVisit) {
    return {
      ok: false,
      error: "Defina se a troca exige visita técnica.",
    };
  }

  const durationMode = cleanText(draft.pool_replacement_duration_mode);

  if (
    durationMode !== "horas" &&
    durationMode !== "dias" &&
    durationMode !== "varia"
  ) {
    return {
      ok: false,
      error: "Defina quanto tempo a troca normalmente ocupa a equipe.",
    };
  }

  const policy: PoolReplacementExecutionPolicy = {
    situations: cleanArray(draft.pool_replacement_situations),
    uses_installation_team: usesInstallationTeam,
    duration_mode: durationMode,
    removes_old: removesOld,
    disposal_included: disposalIncluded,
    requires_visit: requiresVisit,
    includes: cleanArray(draft.pool_replacement_includes),
    excludes: cleanArray(draft.pool_replacement_excludes_options),
  };

  if (policy.situations.includes("caso_a_caso")) {
    const detail = cleanText(draft.pool_replacement_situations_other);

    if (!detail) {
      return {
        ok: false,
        error: "Explique quais outros tipos de troca são avaliados.",
      };
    }

    policy.situations_other = detail;
  }

  if (usesInstallationTeam === "depende") {
    const detail = cleanText(draft.pool_replacement_team_rule);

    if (!detail) {
      return {
        ok: false,
        error: "Explique em quais casos a troca usa a equipe de instalação.",
      };
    }

    policy.team_rule = detail;
  }

  if (durationMode === "varia") {
    const rule = cleanText(draft.pool_replacement_duration_rule);

    if (!rule) {
      return {
        ok: false,
        error: "Explique o que define quanto tempo a troca ocupa a equipe.",
      };
    }

    policy.duration_rule = rule;
  } else {
    const durationValue = positiveInteger(
      draft.pool_replacement_duration_value,
    );

    if (durationValue == null) {
      return {
        ok: false,
        error: "Informe um tempo de ocupação válido para a troca.",
      };
    }

    policy.duration_value = durationValue;
  }

  if (removesOld === "caso_a_caso") {
    const rule = cleanText(draft.pool_replacement_removes_old_rule);

    if (!rule) {
      return {
        ok: false,
        error: "Explique em quais casos a loja remove a piscina antiga.",
      };
    }

    policy.removes_old_rule = rule;
  }

  if (disposalIncluded === "caso_a_caso") {
    const rule = cleanText(draft.pool_replacement_disposal_rule);

    if (!rule) {
      return {
        ok: false,
        error: "Explique em quais casos o descarte está incluído.",
      };
    }

    policy.disposal_rule = rule;
  }

  if (requiresVisit === "depende") {
    const rule = cleanText(draft.pool_replacement_visit_rule);

    if (!rule) {
      return {
        ok: false,
        error: "Explique em quais casos a troca exige visita técnica.",
      };
    }

    policy.visit_rule = rule;
  }

  const excludesDetails = cleanText(draft.pool_replacement_excludes);

  if (policy.excludes.includes("outro") && !excludesDetails) {
    return {
      ok: false,
      error: "Especifique o outro serviço que a loja não faz durante a troca.",
    };
  }

  if (excludesDetails) {
    policy.excludes_details = excludesDetails;
  }

  const notes = cleanText(draft.pool_replacement_notes);

  if (policy.includes.includes("outro") && !notes) {
    return {
      ok: false,
      error: "Especifique o outro serviço incluído na troca.",
    };
  }

  if (notes) {
    policy.notes = notes;
  }

  return { ok: true, value: policy };
}

export function buildDeliveryExecutionPolicy(
  draft: DeliveryDraft,
):
  | { ok: true; value: DeliveryExecutionPolicy }
  | { ok: false; error: string } {
  const items = cleanArray(draft.delivery_items);

  if (!items.length) {
    return {
      ok: false,
      error: "Selecione pelo menos um tipo de produto que a loja entrega.",
    };
  }

  const provider = cleanText(draft.delivery_provider);

  if (
    provider !== "propria" &&
    provider !== "parceiro" &&
    provider !== "ambos" &&
    provider !== "caso_a_caso"
  ) {
    return {
      ok: false,
      error: "Defina quem normalmente realiza a entrega.",
    };
  }

  const pricingMode = cleanText(draft.delivery_pricing_mode);

  if (
    pricingMode !== "gratuito" &&
    pricingMode !== "incluido" &&
    pricingMode !== "fixo" &&
    pricingMode !== "destino" &&
    pricingMode !== "parceiro" &&
    pricingMode !== "caso_a_caso"
  ) {
    return {
      ok: false,
      error: "Defina como o frete é cobrado.",
    };
  }

  const unloadingMode = cleanText(draft.delivery_unloading_mode);

  if (
    unloadingMode !== "transporta" &&
    unloadingMode !== "descarrega" &&
    unloadingMode !== "posiciona" &&
    unloadingMode !== "depende"
  ) {
    return {
      ok: false,
      error: "Defina o que a equipe faz no local da entrega.",
    };
  }

  const policy: DeliveryExecutionPolicy = {
    items,
    provider,
    pricing_mode: pricingMode,
    release_gates: cleanArray(draft.delivery_release_gates),
    unloading_mode: unloadingMode,
  };

  if (items.includes("outros")) {
    const detail = cleanText(draft.delivery_items_other);

    if (!detail) {
      return {
        ok: false,
        error: "Especifique quais outros produtos a loja entrega.",
      };
    }

    policy.items_other = detail;
  }

  if (items.includes("piscina_com_instalacao")) {
    const mode = cleanText(draft.delivery_with_installation_mode);

    if (
      mode !== "parte_instalacao" &&
      mode !== "separado" &&
      mode !== "depende"
    ) {
      return {
        ok: false,
        error: "Defina como entrega e instalação se relacionam.",
      };
    }

    policy.with_installation_mode = mode;

    if (mode === "parte_instalacao") {
      const timing = cleanText(draft.delivery_with_installation_timing);

      if (
        timing !== "mesmo_dia" &&
        timing !== "antes" &&
        timing !== "depende"
      ) {
        return {
          ok: false,
          error: "Defina quando a entrega acontece em relação à instalação.",
        };
      }

      policy.with_installation_timing = timing;
    } else if (mode === "separado") {
      const timing = yesNoDependsToCanonical(
        draft.delivery_with_installation_timing,
      );

      if (!timing) {
        return {
          ok: false,
          error: "Defina se a entrega separada precisa acontecer antes.",
        };
      }

      policy.with_installation_timing = timing;
    }

    if (
      mode === "depende" ||
      policy.with_installation_timing === "depende"
    ) {
      const detail = cleanText(draft.delivery_with_installation_notes);

      if (!detail) {
        return {
          ok: false,
          error: "Explique de que depende a relação entre entrega e instalação.",
        };
      }

      policy.with_installation_notes = detail;
    }
  }

  if (provider === "ambos" || provider === "caso_a_caso") {
    const rule = cleanText(draft.delivery_provider_rule);

    if (!rule) {
      return {
        ok: false,
        error: "Explique como a forma de entrega é definida.",
      };
    }

    policy.provider_rule = rule;
  }

  if (
    provider === "propria" ||
    provider === "ambos" ||
    provider === "caso_a_caso"
  ) {
    const usesInstallationTeam = yesNoDependsToCanonical(
      draft.delivery_uses_installation_team,
    );

    if (!usesInstallationTeam) {
      return {
        ok: false,
        error: "Defina se a entrega usa uma das equipes de instalação.",
      };
    }

    policy.uses_installation_team = usesInstallationTeam;

    if (usesInstallationTeam === "depende") {
      const rule = cleanText(draft.delivery_installation_team_rule);

      if (!rule) {
        return {
          ok: false,
          error: "Explique quando a entrega usa a equipe de instalação.",
        };
      }

      policy.installation_team_rule = rule;
    }
  }

  if (pricingMode === "fixo") {
    const cents = parseDeliveryFixedFeeToCents(
      draft.delivery_fixed_fee,
    );

    if (cents == null) {
      return {
        ok: false,
        error: "Informe um valor fixo de frete válido.",
      };
    }

    policy.fixed_fee_cents = cents;
  }

  if (pricingMode === "destino") {
    const mode = cleanText(draft.delivery_pricing_destination_mode);

    if (
      mode !== "distancia" &&
      mode !== "regiao" &&
      mode !== "faixa" &&
      mode !== "outra"
    ) {
      return {
        ok: false,
        error: "Defina como o frete por destino é calculado.",
      };
    }

    policy.pricing_destination_mode = mode;

    const rule = cleanText(draft.delivery_pricing_destination_rule);

    if (mode === "outra" && !rule) {
      return {
        ok: false,
        error: "Descreva a outra regra usada para calcular o frete.",
      };
    }

    if (rule) {
      policy.pricing_destination_rule = rule;
    }
  }

  if (pricingMode === "parceiro") {
    const mode = cleanText(draft.delivery_partner_pricing_mode);

    if (
      mode !== "repasse" &&
      mode !== "loja_define" &&
      mode !== "depende"
    ) {
      return {
        ok: false,
        error: "Defina como a cotação do parceiro chega ao cliente.",
      };
    }

    policy.partner_pricing_mode = mode;

    if (mode === "depende") {
      const rule = cleanText(draft.delivery_partner_pricing_rule);

      if (!rule) {
        return {
          ok: false,
          error: "Explique de que depende o valor cobrado ao cliente.",
        };
      }

      policy.partner_pricing_rule = rule;
    }
  }

  if (pricingMode === "caso_a_caso") {
    const factors = cleanArray(draft.delivery_case_factors);

    if (!factors.length) {
      return {
        ok: false,
        error: "Selecione o que a equipe considera para calcular o frete.",
      };
    }

    const rule = cleanText(draft.delivery_case_rule);

    if (!rule) {
      return {
        ok: false,
        error: "Explique como a equipe calcula o frete caso a caso.",
      };
    }

    policy.case_factors = factors;
    policy.case_rule = rule;
  }

  if (policy.release_gates.includes("outro")) {
    const detail = cleanText(draft.delivery_release_gates_other);

    if (!detail) {
      return {
        ok: false,
        error: "Especifique o outro requisito antes de liberar a entrega.",
      };
    }

    policy.release_gates_other = detail;
  }

  const notes = cleanText(draft.delivery_notes);

  if (unloadingMode === "depende" && !notes) {
    return {
      ok: false,
      error: "Explique quando a equipe transporta, descarrega ou posiciona.",
    };
  }

  if (notes) {
    policy.notes = notes;
  }

  return { ok: true, value: policy };
}

export function buildPickupExecutionPolicy(
  draft: PickupDraft,
):
  | { ok: true; value: PickupExecutionPolicy }
  | { ok: false; error: string } {
  const items = cleanArray(draft.pickup_items);

  if (!items.length) {
    return {
      ok: false,
      error: "Selecione pelo menos um tipo de item que pode ser retirado.",
    };
  }

  const locationMode = cleanText(draft.pickup_location_mode);

  if (locationMode !== "loja" && locationMode !== "outro") {
    return {
      ok: false,
      error: "Defina onde a retirada acontece.",
    };
  }

  const requiresAppointment = yesNoToBoolean(
    draft.pickup_requires_appointment,
  );

  if (requiresAppointment == null) {
    return {
      ok: false,
      error: "Defina se a retirada precisa ser agendada.",
    };
  }

  const thirdPartyAllowed = cleanText(
    draft.pickup_third_party_allowed,
  );

  if (
    thirdPartyAllowed !== "comprador" &&
    thirdPartyAllowed !== "autorizado"
  ) {
    return {
      ok: false,
      error: "Defina quem pode retirar o produto.",
    };
  }

  const policy: PickupExecutionPolicy = {
    items,
    location_mode: locationMode,
    requires_appointment: requiresAppointment,
    third_party_allowed: thirdPartyAllowed,
    release_gates: cleanArray(draft.pickup_release_gates),
  };

  if (items.includes("outros")) {
    const detail = cleanText(draft.pickup_items_other);

    if (!detail) {
      return {
        ok: false,
        error: "Especifique quais outros itens podem ser retirados.",
      };
    }

    policy.items_other = detail;
  }

  if (locationMode === "outro") {
    const detail = cleanText(draft.pickup_other_location);

    if (!detail) {
      return {
        ok: false,
        error: "Informe o outro local de retirada.",
      };
    }

    policy.other_location = detail;
  }

  if (policy.release_gates.includes("outro")) {
    const detail = cleanText(draft.pickup_release_gates_other);

    if (!detail) {
      return {
        ok: false,
        error: "Especifique o outro requisito antes de liberar a retirada.",
      };
    }

    policy.release_gates_other = detail;
  }

  const notes = cleanText(draft.pickup_notes);
  if (notes) policy.notes = notes;

  return { ok: true, value: policy };
}

export function buildTechnicalServicesExecutionPolicy(
  draft: TechnicalServicesDraft,
):
  | { ok: true; value: TechnicalServicesExecutionPolicy }
  | { ok: false; error: string } {
  const serviceTypes = cleanArray(draft.technical_service_types);
  const equipmentTypes = cleanArray(draft.technical_equipment_types);

  if (!serviceTypes.length) {
    return {
      ok: false,
      error: "Selecione pelo menos um serviço técnico realizado pela loja.",
    };
  }

  if (!equipmentTypes.length) {
    return {
      ok: false,
      error: "Selecione pelo menos um tipo de equipamento atendido.",
    };
  }

  const policy: TechnicalServicesExecutionPolicy = {
    service_types: serviceTypes,
    equipment_types: equipmentTypes,
  };

  if (serviceTypes.includes("outro")) {
    const detail = cleanText(draft.technical_services_other);

    if (!detail) {
      return {
        ok: false,
        error: "Especifique o outro serviço técnico realizado pela loja.",
      };
    }

    policy.services_other = detail;
  }

  if (equipmentTypes.includes("outros")) {
    const detail = cleanText(draft.technical_equipment_other);

    if (!detail) {
      return {
        ok: false,
        error: "Especifique os outros equipamentos atendidos.",
      };
    }

    policy.equipment_other = detail;
  }

  if (serviceTypes.includes("instalacao_equipamento")) {
    const originPolicy = cleanText(
      draft.equipment_installation_origin_policy,
    );

    if (
      originPolicy !== "somente_loja" &&
      originPolicy !== "tambem_cliente" &&
      originPolicy !== "depende"
    ) {
      return {
        ok: false,
        error: "Defina a origem permitida para equipamentos instalados.",
      };
    }

    policy.equipment_installation_origin_policy = originPolicy;

    if (originPolicy === "depende") {
      const rule = cleanText(
        draft.equipment_installation_origin_rule,
      );

      if (!rule) {
        return {
          ok: false,
          error: "Explique de quais equipamentos depende a instalação.",
        };
      }

      policy.equipment_installation_origin_rule = rule;
    }
  }

  if (serviceTypes.includes("troca_equipamento")) {
    const replacementPolicy = yesNoCaseToCanonical(
      draft.equipment_replacement_existing,
    );

    if (!replacementPolicy) {
      return {
        ok: false,
        error: "Defina se a loja substitui equipamentos existentes.",
      };
    }

    policy.equipment_replacement_existing = replacementPolicy;

    if (replacementPolicy === "caso_a_caso") {
      const rule = cleanText(
        draft.equipment_replacement_existing_rule,
      );

      if (!rule) {
        return {
          ok: false,
          error: "Explique em quais casos a loja substitui equipamentos existentes.",
        };
      }

      policy.equipment_replacement_existing_rule = rule;
    }
  }

  const notes = cleanText(draft.technical_services_notes);
  if (notes) policy.notes = notes;

  return { ok: true, value: policy };
}

export function poolReplacementPolicyToDraftPatch(
  policy: PoolReplacementExecutionPolicy | null,
  configured: boolean,
): Partial<PoolReplacementDraft> {
  const enabled = configuredPolicyEnabledToUi(configured, policy);

  if (!policy) {
    return {
      pool_replacement_enabled: enabled,
      pool_replacement_situations: [],
      pool_replacement_situations_other: "",
      pool_replacement_removes_old: "",
      pool_replacement_removes_old_rule: "",
      pool_replacement_disposal_included: "",
      pool_replacement_disposal_rule: "",
      pool_replacement_requires_visit: "",
      pool_replacement_visit_rule: "",
      pool_replacement_uses_installation_team: "",
      pool_replacement_team_rule: "",
      pool_replacement_duration_mode: "",
      pool_replacement_duration_value: "",
      pool_replacement_duration_rule: "",
      pool_replacement_includes: [],
      pool_replacement_excludes_options: [],
      pool_replacement_excludes: "",
      pool_replacement_notes: "",
    };
  }

  return {
    pool_replacement_enabled: enabled,
    pool_replacement_situations: cleanArray(policy.situations),
    pool_replacement_situations_other: cleanText(policy.situations_other),
    pool_replacement_removes_old: canonicalYesNoCaseToUi(
      policy.removes_old,
    ),
    pool_replacement_removes_old_rule: cleanText(
      policy.removes_old_rule,
    ),
    pool_replacement_disposal_included: canonicalYesNoCaseToUi(
      policy.disposal_included,
    ),
    pool_replacement_disposal_rule: cleanText(policy.disposal_rule),
    pool_replacement_requires_visit: canonicalYesNoDependsToUi(
      policy.requires_visit,
    ),
    pool_replacement_visit_rule: cleanText(policy.visit_rule),
    pool_replacement_uses_installation_team: canonicalYesNoDependsToUi(
      policy.uses_installation_team,
    ),
    pool_replacement_team_rule: cleanText(policy.team_rule),
    pool_replacement_duration_mode: cleanText(policy.duration_mode),
    pool_replacement_duration_value:
      typeof policy.duration_value === "number"
        ? String(policy.duration_value)
        : "",
    pool_replacement_duration_rule: cleanText(policy.duration_rule),
    pool_replacement_includes: cleanArray(policy.includes),
    pool_replacement_excludes_options: cleanArray(policy.excludes),
    pool_replacement_excludes: cleanText(policy.excludes_details),
    pool_replacement_notes: cleanText(policy.notes),
  };
}

export function deliveryPolicyToDraftPatch(
  policy: DeliveryExecutionPolicy | null,
  configured: boolean,
): Partial<DeliveryDraft> {
  const enabled = configuredPolicyEnabledToUi(configured, policy);

  if (!policy) {
    return {
      delivery_enabled: enabled,
      delivery_items: [],
      delivery_items_other: "",
      delivery_with_installation_mode: "",
      delivery_with_installation_timing: "",
      delivery_with_installation_notes: "",
      delivery_provider: "",
      delivery_provider_rule: "",
      delivery_uses_installation_team: "",
      delivery_installation_team_rule: "",
      delivery_coverage_mode: "",
      delivery_pricing_mode: "",
      delivery_pricing_destination_mode: "",
      delivery_pricing_destination_rule: "",
      delivery_partner_pricing_mode: "",
      delivery_partner_pricing_rule: "",
      delivery_case_factors: [],
      delivery_case_rule: "",
      delivery_fixed_fee: "",
      delivery_requires_appointment: "",
      delivery_lead_time_mode: "",
      delivery_lead_time_days: "",
      delivery_release_gates: [],
      delivery_release_gates_other: "",
      delivery_unloading_mode: "",
      delivery_notes: "",
    };
  }

  let installationTiming = cleanText(
    policy.with_installation_timing,
  );

  if (
    policy.with_installation_mode === "separado" &&
    installationTiming
  ) {
    installationTiming = canonicalYesNoDependsToUi(
      installationTiming,
    );
  }

  return {
    delivery_enabled: enabled,
    delivery_items: cleanArray(policy.items),
    delivery_items_other: cleanText(policy.items_other),
    delivery_with_installation_mode: cleanText(
      policy.with_installation_mode,
    ),
    delivery_with_installation_timing: installationTiming,
    delivery_with_installation_notes: cleanText(
      policy.with_installation_notes,
    ),
    delivery_provider: cleanText(policy.provider),
    delivery_provider_rule: cleanText(policy.provider_rule),
    delivery_uses_installation_team: canonicalYesNoDependsToUi(
      policy.uses_installation_team,
    ),
    delivery_installation_team_rule: cleanText(
      policy.installation_team_rule,
    ),
    delivery_coverage_mode: "",
    delivery_pricing_mode: cleanText(policy.pricing_mode),
    delivery_pricing_destination_mode: cleanText(
      policy.pricing_destination_mode,
    ),
    delivery_pricing_destination_rule: cleanText(
      policy.pricing_destination_rule,
    ),
    delivery_partner_pricing_mode: cleanText(
      policy.partner_pricing_mode,
    ),
    delivery_partner_pricing_rule: cleanText(
      policy.partner_pricing_rule,
    ),
    delivery_case_factors: cleanArray(policy.case_factors),
    delivery_case_rule: cleanText(policy.case_rule),
    delivery_fixed_fee: formatDeliveryFixedFeeFromCents(
      policy.fixed_fee_cents,
    ),
    delivery_requires_appointment: "",
    delivery_lead_time_mode: "",
    delivery_lead_time_days: "",
    delivery_release_gates: cleanArray(policy.release_gates),
    delivery_release_gates_other: cleanText(
      policy.release_gates_other,
    ),
    delivery_unloading_mode: cleanText(policy.unloading_mode),
    delivery_notes: cleanText(policy.notes),
  };
}

export function pickupPolicyToDraftPatch(
  policy: PickupExecutionPolicy | null,
  configured: boolean,
): Partial<PickupDraft> {
  const enabled = configuredPolicyEnabledToUi(configured, policy);

  if (!policy) {
    return {
      pickup_enabled: enabled,
      pickup_items: [],
      pickup_items_other: "",
      pickup_location_mode: "",
      pickup_other_location: "",
      pickup_requires_appointment: "",
      pickup_ready_mode: "",
      pickup_ready_value: "",
      pickup_third_party_allowed: "",
      pickup_release_gates: [],
      pickup_release_gates_other: "",
      pickup_notes: "",
    };
  }

  return {
    pickup_enabled: enabled,
    pickup_items: cleanArray(policy.items),
    pickup_items_other: cleanText(policy.items_other),
    pickup_location_mode: cleanText(policy.location_mode),
    pickup_other_location: cleanText(policy.other_location),
    pickup_requires_appointment:
      policy.requires_appointment ? "Sim" : "Não",
    pickup_ready_mode: "",
    pickup_ready_value: "",
    pickup_third_party_allowed: cleanText(
      policy.third_party_allowed,
    ),
    pickup_release_gates: cleanArray(policy.release_gates),
    pickup_release_gates_other: cleanText(
      policy.release_gates_other,
    ),
    pickup_notes: cleanText(policy.notes),
  };
}

export function technicalServicesPolicyToDraftPatch(
  policy: TechnicalServicesExecutionPolicy | null,
  configured: boolean,
): Partial<TechnicalServicesDraft> {
  const enabled = configuredPolicyEnabledToUi(configured, policy);

  if (!policy) {
    return {
      technical_services_enabled: enabled,
      technical_service_types: [],
      technical_services_other: "",
      technical_equipment_types: [],
      technical_equipment_other: "",
      equipment_installation_origin_policy: "",
      equipment_installation_origin_rule: "",
      equipment_replacement_existing: "",
      equipment_replacement_existing_rule: "",
      technical_services_notes: "",
    };
  }

  return {
    technical_services_enabled: enabled,
    technical_service_types: cleanArray(policy.service_types),
    technical_services_other: cleanText(policy.services_other),
    technical_equipment_types: cleanArray(policy.equipment_types),
    technical_equipment_other: cleanText(policy.equipment_other),
    equipment_installation_origin_policy: cleanText(
      policy.equipment_installation_origin_policy,
    ),
    equipment_installation_origin_rule: cleanText(
      policy.equipment_installation_origin_rule,
    ),
    equipment_replacement_existing: canonicalYesNoCaseToUi(
      policy.equipment_replacement_existing,
    ),
    equipment_replacement_existing_rule: cleanText(
      policy.equipment_replacement_existing_rule,
    ),
    technical_services_notes: cleanText(policy.notes),
  };
}

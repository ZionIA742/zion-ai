export type ContractWorkflowDecisionTrigger =
  | "human_explicit_request"
  | "customer_requested_contract"
  | "customer_accepted_quote"
  | "post_visit_human_confirmed"
  | "crm_closing_stage"
  | "system_suggestion"
  | "unknown";

export type ContractWorkflowDecisionQuote = {
  id?: string | null;
  status?: string | null;
  lead_id?: string | null;
  conversation_id?: string | null;
  store_id?: string | null;
  organization_id?: string | null;
  total_cents?: number | null;
  current_version_id?: string | null;
};

export type ContractWorkflowDecisionAppointment = {
  id?: string | null;
  appointment_type?: string | null;
  status?: string | null;
};

export type ContractWorkflowDecisionStoreSettings = {
  requiresTechnicalVisitBeforeContract?: boolean | null;
};

export type ContractWorkflowDecisionExistingContract = {
  id?: string | null;
  status?: string | null;
};

export type ContractWorkflowDecisionInput = {
  quote?: ContractWorkflowDecisionQuote | null;
  trigger?: ContractWorkflowDecisionTrigger | null;
  hasHumanConfirmation?: boolean;
  crmStage?: string | null;
  appointments?: ContractWorkflowDecisionAppointment[] | null;
  storeSettings?: ContractWorkflowDecisionStoreSettings | null;
  existingContracts?: ContractWorkflowDecisionExistingContract[] | null;
};

export type ContractWorkflowDecisionResult = {
  allowed: boolean;
  needsHumanConfirmation: boolean;
  reasonCode: string;
  reasonMessage: string;
  missingRequirements: string[];
  warnings: string[];
  recommendedNextAction: string;
};

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeText(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isQuoteReadyForContract(status: string | null | undefined) {
  const normalizedStatus = normalizeText(status);
  return normalizedStatus === "approved" || normalizedStatus === "sent";
}

function isTechnicalVisitAppointment(appointment: ContractWorkflowDecisionAppointment) {
  return normalizeText(appointment.appointment_type) === "technical_visit";
}

function isCompletedTechnicalVisitStatus(status: string | null | undefined) {
  const normalizedStatus = normalizeText(status);
  return (
    normalizedStatus === "completed" ||
    normalizedStatus === "fully_completed" ||
    normalizedStatus === "confirmed" ||
    normalizedStatus === "done"
  );
}

function hasCompletedTechnicalVisit(
  appointments: ContractWorkflowDecisionAppointment[] | null | undefined
) {
  return (appointments || []).some((appointment) => {
    return (
      isTechnicalVisitAppointment(appointment) &&
      isCompletedTechnicalVisitStatus(appointment.status)
    );
  });
}

function buildBaseResult(
  overrides: Partial<ContractWorkflowDecisionResult>
): ContractWorkflowDecisionResult {
  return {
    allowed: false,
    needsHumanConfirmation: true,
    reasonCode: "NEEDS_HUMAN_CONFIRMATION",
    reasonMessage: "Essa tentativa precisa de confirmacao humana antes de iniciar o fluxo contratual.",
    missingRequirements: [],
    warnings: [],
    recommendedNextAction: "ask_human_to_confirm_contract_generation",
    ...overrides,
  };
}

export function evaluateContractWorkflowDecision(
  input: ContractWorkflowDecisionInput
): ContractWorkflowDecisionResult {
  const quote = input.quote || null;
  const trigger = input.trigger || "unknown";
  const hasHumanConfirmation = input.hasHumanConfirmation === true;
  const missingRequirements: string[] = [];

  if (!quote) {
    return buildBaseResult({
      allowed: false,
      needsHumanConfirmation: true,
      reasonCode: "QUOTE_NOT_FOUND",
      reasonMessage: "Nenhum orcamento foi informado para avaliar o inicio do fluxo contratual.",
      missingRequirements: ["quote"],
      recommendedNextAction: "load_quote_before_contract_decision",
    });
  }

  const quoteId = cleanText(quote.id);
  const leadId = cleanText(quote.lead_id);
  const storeId = cleanText(quote.store_id);
  const organizationId = cleanText(quote.organization_id);
  const currentVersionId = cleanText(quote.current_version_id);

  if (!quoteId) missingRequirements.push("quote.id");
  if (!leadId) missingRequirements.push("quote.lead_id");
  if (!storeId) missingRequirements.push("quote.store_id");
  if (!organizationId) missingRequirements.push("quote.organization_id");
  if (!currentVersionId) missingRequirements.push("quote.current_version_id");

  if (!quoteId) {
    return buildBaseResult({
      allowed: false,
      needsHumanConfirmation: true,
      reasonCode: "QUOTE_NOT_FOUND",
      reasonMessage: "O orcamento informado nao possui identificador valido.",
      missingRequirements,
      recommendedNextAction: "load_quote_before_contract_decision",
    });
  }

  if (!currentVersionId) {
    return buildBaseResult({
      allowed: false,
      needsHumanConfirmation: true,
      reasonCode: "QUOTE_HAS_NO_CURRENT_VERSION",
      reasonMessage: "O orcamento ainda nao possui versao atual pronta para servir de base ao contrato.",
      missingRequirements,
      recommendedNextAction: "generate_or_load_current_quote_version",
    });
  }

  if (missingRequirements.length > 0) {
    return buildBaseResult({
      allowed: false,
      needsHumanConfirmation: true,
      reasonCode: "QUOTE_DATA_INCOMPLETE",
      reasonMessage: "Faltam dados minimos do orcamento para iniciar o fluxo contratual com seguranca.",
      missingRequirements,
      recommendedNextAction: "complete_quote_context_before_contract_decision",
    });
  }

  if (!isQuoteReadyForContract(quote.status)) {
    return buildBaseResult({
      allowed: false,
      needsHumanConfirmation: true,
      reasonCode: "QUOTE_NOT_READY_FOR_CONTRACT",
      reasonMessage: "O orcamento ainda nao esta no estado minimo exigido para iniciar o fluxo contratual.",
      recommendedNextAction: "approve_or_send_quote_before_contract",
    });
  }

  const existingContracts = input.existingContracts || [];
  const completedContract = existingContracts.find((contract) => {
    return normalizeText(contract.status) === "completed";
  });
  if (completedContract?.id) {
    return buildBaseResult({
      allowed: false,
      needsHumanConfirmation: false,
      reasonCode: "CONTRACT_ALREADY_COMPLETED",
      reasonMessage: "Ja existe contrato concluido para este orcamento.",
      recommendedNextAction: "review_completed_contract",
    });
  }

  const pendingReviewContract = existingContracts.find((contract) => {
    return normalizeText(contract.status) === "pending_review";
  });
  if (pendingReviewContract?.id) {
    return buildBaseResult({
      allowed: false,
      needsHumanConfirmation: false,
      reasonCode: "CONTRACT_ALREADY_PENDING_REVIEW",
      reasonMessage: "Ja existe contrato em revisao pendente para este orcamento.",
      recommendedNextAction: "review_existing_contract",
    });
  }

  const inProgressContract = existingContracts.find((contract) => {
    const normalizedStatus = normalizeText(contract.status);
    return (
      normalizedStatus === "draft" ||
      normalizedStatus === "approved" ||
      normalizedStatus === "sent" ||
      normalizedStatus === "sent_to_customer" ||
      normalizedStatus === "customer_signed" ||
      normalizedStatus === "partially_signed"
    );
  });
  if (inProgressContract?.id) {
    return buildBaseResult({
      allowed: false,
      needsHumanConfirmation: false,
      reasonCode: "CONTRACT_ALREADY_IN_PROGRESS",
      reasonMessage: "Ja existe contrato em andamento para este orcamento.",
      recommendedNextAction: "review_existing_contract",
    });
  }

  const requiresTechnicalVisitBeforeContract =
    input.storeSettings?.requiresTechnicalVisitBeforeContract === true;
  if (
    requiresTechnicalVisitBeforeContract &&
    !hasCompletedTechnicalVisit(input.appointments)
  ) {
    return buildBaseResult({
      allowed: false,
      needsHumanConfirmation: true,
      reasonCode: "TECHNICAL_VISIT_REQUIRED_BEFORE_CONTRACT",
      reasonMessage: "A loja exige visita tecnica concluida antes de iniciar o contrato.",
      warnings: [
        "Nao encontrei visita tecnica concluida ou confirmada para liberar o fluxo contratual.",
      ],
      recommendedNextAction: "confirm_or_complete_technical_visit_before_contract",
    });
  }

  if (trigger === "human_explicit_request") {
    return buildBaseResult({
      allowed: true,
      needsHumanConfirmation: false,
      reasonCode: "HUMAN_EXPLICIT_REQUEST_ALLOWED",
      reasonMessage: "A solicitacao humana explicita permite iniciar o fluxo contratual.",
      warnings: hasHumanConfirmation
        ? []
        : ["A origem ja foi tratada como comando humano explicito."],
      recommendedNextAction: "create_contract_from_quote",
    });
  }

  if (trigger === "post_visit_human_confirmed") {
    return buildBaseResult({
      allowed: true,
      needsHumanConfirmation: false,
      reasonCode: "POST_VISIT_HUMAN_CONFIRMED_ALLOWED",
      reasonMessage: "A confirmacao humana apos a visita permite iniciar o fluxo contratual.",
      recommendedNextAction: "create_contract_from_quote",
    });
  }

  if (trigger === "customer_requested_contract") {
    return buildBaseResult({
      allowed: false,
      needsHumanConfirmation: true,
      reasonCode: "CUSTOMER_SIGNAL_REQUIRES_HUMAN_CONFIRMATION",
      reasonMessage: "O cliente pediu contrato, mas ainda e necessaria confirmacao humana antes de iniciar o fluxo.",
      recommendedNextAction: "ask_human_to_confirm_contract_generation",
    });
  }

  if (trigger === "customer_accepted_quote") {
    return buildBaseResult({
      allowed: false,
      needsHumanConfirmation: true,
      reasonCode: "CUSTOMER_SIGNAL_REQUIRES_HUMAN_CONFIRMATION",
      reasonMessage: "O cliente sinalizou aceite do orcamento, mas o contrato ainda depende de confirmacao humana.",
      recommendedNextAction: "ask_human_to_confirm_contract_generation",
    });
  }

  if (trigger === "crm_closing_stage") {
    return buildBaseResult({
      allowed: false,
      needsHumanConfirmation: true,
      reasonCode: "CRM_CLOSING_REQUIRES_HUMAN_CONFIRMATION",
      reasonMessage: "A etapa de CRM sugere fechamento, mas ainda e necessaria confirmacao humana antes do contrato.",
      warnings: cleanText(input.crmStage)
        ? [`Etapa atual do CRM: ${cleanText(input.crmStage)}`]
        : [],
      recommendedNextAction: "ask_human_to_confirm_contract_generation",
    });
  }

  if (trigger === "system_suggestion" || trigger === "unknown") {
    return buildBaseResult({
      allowed: false,
      needsHumanConfirmation: true,
      reasonCode: "NEEDS_HUMAN_CONFIRMATION",
      reasonMessage: "O sistema nao deve iniciar contrato automaticamente sem um sinal humano ou operacional forte.",
      recommendedNextAction: "ask_human_to_confirm_contract_generation",
    });
  }

  return buildBaseResult({
    allowed: false,
    needsHumanConfirmation: true,
    reasonCode: "NEEDS_HUMAN_CONFIRMATION",
    reasonMessage: "A tentativa de iniciar contrato exige confirmacao humana.",
    recommendedNextAction: "ask_human_to_confirm_contract_generation",
  });
}

export function canStartContractWorkflow(input: ContractWorkflowDecisionInput) {
  return evaluateContractWorkflowDecision(input);
}

export type LeadCommercialOpportunityOption = {
  id: string;
  stage: string | null;
  primaryConversationId: string | null;
};

export type CommercialOpportunitySelectOption = {
  value: string;
  label: string;
  stage: string | null;
};

export function buildCommercialOpportunitySelectOptions(args: {
  opportunities: LeadCommercialOpportunityOption[];
  selectedConversationId: string | null;
}): CommercialOpportunitySelectOption[] {
  const selectedConversationId =
    String(args.selectedConversationId || "").trim() || null;

  return args.opportunities
    .filter((opportunity) => {
      if (!selectedConversationId) return true;
      return opportunity.primaryConversationId === selectedConversationId;
    })
    .map((opportunity) => {
      const value = String(opportunity.id || "").trim();
      if (!value) return null;

      const stage = String(opportunity.stage || "").trim() || "sem_stage";
      const shortId =
        value.length > 13
          ? `${value.slice(0, 8)}…${value.slice(-4)}`
          : value;
      const conversationBadge =
        selectedConversationId &&
        opportunity.primaryConversationId === selectedConversationId
          ? " • conversa principal"
          : "";

      return {
        value,
        label: `${shortId}${conversationBadge}`,
        stage: stage === "sem_stage" ? null : stage,
      } satisfies CommercialOpportunitySelectOption;
    })
    .filter((option): option is CommercialOpportunitySelectOption => option !== null);
}

export function isCommercialOpportunitySelectionCompatible(args: {
  selectedCommercialOpportunityId: string;
  availableCommercialOpportunities: LeadCommercialOpportunityOption[];
}): boolean {
  const selectedCommercialOpportunityId =
    String(args.selectedCommercialOpportunityId || "").trim() || "";

  if (!selectedCommercialOpportunityId) {
    return true;
  }

  return args.availableCommercialOpportunities.some(
    (opportunity) =>
      String(opportunity.id || "").trim() === selectedCommercialOpportunityId,
  );
}

export function resolveCommercialOpportunityIdForAppointmentCreate(args: {
  appointmentType: string;
  selectedCommercialOpportunityId: string;
  availableCommercialOpportunities: LeadCommercialOpportunityOption[];
}):
  | { ok: true; commercialOpportunityId: string | null }
  | { ok: false; errorMessage: string } {
  const appointmentType = String(args.appointmentType || "").trim().toLowerCase();
  const selectedCommercialOpportunityId =
    String(args.selectedCommercialOpportunityId || "").trim() || "";

  if (appointmentType !== "technical_visit") {
    return { ok: true, commercialOpportunityId: null };
  }

  const validOpportunityIds = new Set(
    args.availableCommercialOpportunities
      .map((opportunity) => String(opportunity.id || "").trim())
      .filter(Boolean),
  );

  if (!selectedCommercialOpportunityId) {
    if (validOpportunityIds.size > 0) {
      return {
        ok: false,
        errorMessage:
          "Selecione explicitamente a opportunity comercial desta visita tecnica antes de salvar.",
      };
    }

    return { ok: true, commercialOpportunityId: null };
  }

  if (!validOpportunityIds.has(selectedCommercialOpportunityId)) {
    return {
      ok: false,
      errorMessage:
        "A opportunity comercial selecionada ficou invalida. Recarregue as opcoes e selecione novamente.",
    };
  }

  return {
    ok: true,
    commercialOpportunityId: selectedCommercialOpportunityId,
  };
}

import type {
  AppointmentRow,
  AssistantCandidateOption,
  StoreAssistantContextStateRow,
} from "./types";

function normalizeSelectionText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function buildAppointmentCandidateOptions(args: {
  candidateIndexes: number[];
  openAppointments: AppointmentRow[];
}) {
  return args.candidateIndexes.slice(0, 8).map((candidateIndex) => {
    const appointment = args.openAppointments[candidateIndex];
    return {
      option_number: candidateIndex + 1,
      source_index: candidateIndex,
      appointment_id: appointment?.id || "",
      title: appointment?.title || null,
      appointment_type: appointment?.appointment_type || null,
      status: appointment?.status || null,
      scheduled_start: appointment?.scheduled_start || null,
      scheduled_end: appointment?.scheduled_end || null,
      customer_name: appointment?.customer_name || null,
      customer_phone: appointment?.customer_phone || null,
      lead_id: appointment?.lead_id || null,
      conversation_id: appointment?.conversation_id || null,
    } satisfies AssistantCandidateOption;
  }).filter((item) => item.appointment_id);
}

export function readAssistantCandidateOptions(contextState?: StoreAssistantContextStateRow | null) {
  const raw = contextState?.candidate_options;
  if (!Array.isArray(raw)) return [];

  return (raw as AssistantCandidateOption[]).filter((option) => {
    const optionNumber = Number(option?.option_number);
    const sourceIndex = Number(option?.source_index);
    const appointmentId = String(option?.appointment_id || "").trim();
    return (
      Number.isInteger(optionNumber) &&
      optionNumber >= 1 &&
      Number.isInteger(sourceIndex) &&
      sourceIndex >= 0 &&
      Boolean(appointmentId)
    );
  });
}

export function resolveExplicitAppointmentItemIndex(text: string, totalItems: number) {
  const t = normalizeSelectionText(text);
  if (totalItems <= 0) return null;

  const plainNumberMatch = String(text || "").trim().match(/^\s*(\d{1,2})\s*[.)]?\s*$/);
  if (plainNumberMatch) {
    const numericIndex = Number(plainNumberMatch[1]);
    if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= totalItems) {
      return numericIndex - 1;
    }
  }

  const patterns = [
    /\b(?:item|opcao|opção|numero|número|n|compromisso|visita|agenda)\s*(?:de\s*)?(?:numero|número|n)?\s*(\d{1,2})\b/,
    /\b(?:item|opcao|opção|compromisso|visita)\s*#?\s*(\d{1,2})\b/,
    /\b(?:o|a)?\s*(\d{1,2})\s*(?:da lista|da opcao|da opção|da agenda)\b/,
  ];

  const ordinalMap: Record<string, number> = {
    primeiro: 1,
    primeira: 1,
    segundo: 2,
    segunda: 2,
    terceiro: 3,
    terceira: 3,
    quarto: 4,
    quarta: 4,
    quinto: 5,
    quinta: 5,
    sexto: 6,
    sexta: 6,
    setimo: 7,
    sétimo: 7,
    setima: 7,
    sétima: 7,
    oitavo: 8,
    oitava: 8,
    nono: 9,
    nona: 9,
    decimo: 10,
    décimo: 10,
    decima: 10,
    décima: 10,
  };

  for (const [word, number] of Object.entries(ordinalMap)) {
    if (t.includes(word) && number >= 1 && number <= totalItems) {
      return number - 1;
    }
  }

  for (const pattern of patterns) {
    const match = t.match(pattern);
    if (!match) continue;
    const numericIndex = Number(match[1]);
    if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= totalItems) {
      return numericIndex - 1;
    }
  }

  return null;
}

export function resolveAppointmentSelectionFromContextFirst(args: {
  text: string;
  openAppointments: AppointmentRow[];
  contextState?: StoreAssistantContextStateRow | null;
}) {
  const contextStatus = normalizeSelectionText(args.contextState?.active_status || "");
  const contextTopic = normalizeSelectionText(args.contextState?.active_topic || "");
  const options = readAssistantCandidateOptions(args.contextState);

  if (
    contextStatus !== "waiting_user_choice" ||
    !["appointment_management", "appointment_reschedule"].includes(contextTopic) ||
    !options.length
  ) {
    return { type: "not_applicable" as const };
  }

  const highestOptionNumber = options.reduce((max, option) => {
    const optionNumber = Number(option.option_number);
    return Number.isFinite(optionNumber) ? Math.max(max, optionNumber) : max;
  }, options.length);
  const selectedOptionIndex = resolveExplicitAppointmentItemIndex(args.text, highestOptionNumber);
  if (selectedOptionIndex !== null) {
    const optionNumber = selectedOptionIndex + 1;
    const matchedOption = options.find((option) => Number(option.option_number) === optionNumber);
    const appointmentId = String(matchedOption?.appointment_id || "").trim();
    const matchedIndex = appointmentId
      ? args.openAppointments.findIndex((appointment) => appointment.id === appointmentId)
      : -1;

    if (matchedIndex >= 0) {
      return { type: "unique" as const, index: matchedIndex };
    }

    return { type: "invalid_choice" as const };
  }

  const requestedOptionIndex = resolveExplicitAppointmentItemIndex(args.text, Math.max(highestOptionNumber, 99));
  if (requestedOptionIndex !== null) {
    return { type: "invalid_choice" as const };
  }

  return { type: "not_applicable" as const };
}

function resolveAssistantCandidateOptionNumber(args: {
  text: string;
  options: AssistantCandidateOption[];
}) {
  const highestOptionNumber = args.options.reduce((max, option) => {
    const optionNumber = Number(option.option_number);
    return Number.isFinite(optionNumber) ? Math.max(max, optionNumber) : max;
  }, args.options.length);

  const selectedOptionIndex = resolveExplicitAppointmentItemIndex(args.text, highestOptionNumber);
  return selectedOptionIndex !== null ? selectedOptionIndex + 1 : null;
}

export function getSelectedAssistantCandidateOption(args: {
  text: string;
  contextState?: StoreAssistantContextStateRow | null;
}) {
  const contextStatus = normalizeSelectionText(args.contextState?.active_status || "");
  const contextTopic = normalizeSelectionText(args.contextState?.active_topic || "");
  if (contextTopic !== "appointment_management" || contextStatus !== "waiting_user_choice") return null;

  const options = readAssistantCandidateOptions(args.contextState);
  if (!options.length) return null;

  const optionNumber = resolveAssistantCandidateOptionNumber({
    text: args.text,
    options,
  });
  if (optionNumber === null) return null;

  return options.find((option) => Number(option.option_number) === optionNumber) || null;
}

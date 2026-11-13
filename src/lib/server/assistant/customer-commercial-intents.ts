export type CustomerMediaIntent = "payment_proof" | "unknown";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: unknown) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const PAYMENT_CONTEXT = /\b(pix|transfer|transferir|transferencia|pagamento|paguei|pago|pagar|deposit|entrada|parcela|boleto|chave)\b/u;
const CANCELLATION_INTENT = /\b(quero cancelar|preciso cancelar|cancelar a compra|cancelar o pedido|desistir do contrato|nao vou querer mais|não vou querer mais|quero desistir)\b/u;
const CANCELLATION_REASON = /\b(?:porque|pois|motivo|devido a|por causa de)\s+(.{3,})/iu;

export function hasRecentPaymentContext(values: unknown[]) {
  return values.some((value) => PAYMENT_CONTEXT.test(normalize(value)));
}

export function classifyCustomerMediaForPayment(args: {
  messageType: string;
  mimeType?: string | null;
  fileName?: string | null;
  caption?: string | null;
  recentConversationText?: string[];
}): {
  intent: CustomerMediaIntent;
  confidence: "high" | "medium" | "low";
  reason: string;
  requiresCustomerConfirmation: boolean;
} {
  const type = normalize(args.messageType);
  const mime = normalize(args.mimeType);
  const name = normalize(args.fileName);
  const caption = normalize(args.caption);
  const compatible = type === "image" || type === "document" || mime.startsWith("image/") || mime === "application/pdf";
  if (!compatible) return { intent: "unknown", confidence: "low", reason: "media_type_not_supported", requiresCustomerConfirmation: false };
  const directSignal = /\b(comprovante|recibo|receipt|pix|pagamento|transferencia|boleto)\b/u.test(`${name} ${caption}`);
  if (directSignal && hasRecentPaymentContext(args.recentConversationText || [])) {
    return { intent: "payment_proof", confidence: "high", reason: "payment_context_and_media_signal", requiresCustomerConfirmation: false };
  }
  if (mime === "application/pdf" && hasRecentPaymentContext(args.recentConversationText || [])) {
    return { intent: "payment_proof", confidence: "high", reason: "payment_context_and_pdf", requiresCustomerConfirmation: false };
  }
  if (hasRecentPaymentContext(args.recentConversationText || [])) {
    return { intent: "payment_proof", confidence: "medium", reason: "payment_context_compatible_media", requiresCustomerConfirmation: true };
  }
  return { intent: "unknown", confidence: "low", reason: "payment_context_absent", requiresCustomerConfirmation: false };
}

export function detectCustomerCancellationRequest(text: unknown) {
  const value = clean(text);
  if (!CANCELLATION_INTENT.test(value)) return null;
  const reason = value.match(CANCELLATION_REASON)?.[1]?.trim() || null;
  return { reason, needsReason: !reason };
}

export function isCustomerCancellationReasonRefusal(text: unknown) {
  const value = normalize(text);
  return /\b(nao quero|não quero|prefiro nao|prefiro não|nao vou|não vou|sem informar|nao quero dizer|não quero dizer|prefiro nao dizer|prefiro não dizer)\b/.test(value);
}

export function renderPaymentProofClarificationQuestion() {
  return "Esse e o comprovante do pagamento?";
}

export function renderCancellationReasonQuestion() {
  return "Entendi. Posso saber o que te levou a querer cancelar?";
}

export function renderPaymentProofAlert(args: { customerName?: string | null; reference?: string | null }) {
  const customer = clean(args.customerName) || "O cliente";
  const reference = clean(args.reference);
  return [
    `${customer} enviou um possivel comprovante de pagamento.`,
    reference ? `Referencia: ${reference}.` : null,
    "O pagamento ainda nao foi confirmado.",
    "Confira o arquivo recebido e responda SIM para confirmar ou NAO para rejeitar.",
  ].filter(Boolean).join("\n");
}

export type CancellationCommercialFacts = {
  opportunityStatus: "identified" | "not_identified" | "ambiguous" | "unknown";
  opportunityStage?: string | null;
  quoteNumber?: string | null;
  contractStatus: "identified" | "not_identified" | "ambiguous" | "unknown";
  contractNumber?: string | null;
  contractStatusValue?: string | null;
  signatureStatus: "confirmed" | "not_confirmed" | "unknown";
  financialStatus: "recorded" | "not_recorded" | "unknown";
  financialEventCount?: number | null;
};

function contractStatusLabel(value: string | null | undefined) {
  const normalized = normalize(value);
  if (normalized === "customer_signed") return "assinado pelo cliente";
  if (normalized === "completed") return "concluido";
  if (normalized === "sent" || normalized === "sent_to_customer") return "enviado ao cliente";
  if (normalized === "pending_review") return "em revisao";
  if (normalized) return normalized;
  return "status nao identificado";
}

export function renderCancellationAlert(args: {
  customerName?: string | null;
  reference?: string | null;
  reason?: string | null;
  facts?: CancellationCommercialFacts | null;
}) {
  const customer = clean(args.customerName) || "O cliente";
  const reference = clean(args.reference);
  const reason = clean(args.reason) || "nao informado";
  const facts = args.facts || null;
  const lines = [`${customer} solicitou o cancelamento da compra${reference ? ` (${reference})` : ""}.`];

  if (facts?.opportunityStatus === "identified") {
    lines.push(`Oportunidade comercial identificada${facts.opportunityStage ? ` (estagio: ${facts.opportunityStage})` : ""}.`);
  } else if (facts?.opportunityStatus === "ambiguous") {
    lines.push("Ha mais de uma oportunidade comercial possivel; a associacao permanece ambigua.");
  } else if (facts?.opportunityStatus === "not_identified") {
    lines.push("Oportunidade comercial: nao identificada.");
  } else {
    lines.push("Oportunidade comercial: dados indisponiveis para confirmacao.");
  }

  if (facts?.quoteNumber) lines.push(`Orcamento relacionado: ${facts.quoteNumber}.`);

  if (facts?.contractStatus === "identified") {
    const number = clean(facts.contractNumber);
    const status = contractStatusLabel(facts.contractStatusValue);
    lines.push(`Contrato${number ? ` ${number}` : " relacionado"}: ${status}.`);
  } else if (facts?.contractStatus === "ambiguous") {
    lines.push("Contrato relacionado: ha mais de um contrato possivel; nao foi escolhido arbitrariamente.");
  } else if (facts?.contractStatus === "not_identified") {
    lines.push("Contrato relacionado: nao identificado.");
  } else {
    lines.push("Contrato relacionado: dados indisponiveis para confirmacao.");
  }

  if (facts?.signatureStatus === "confirmed") {
    lines.push("Assinatura do cliente: confirmada no sistema.");
  } else if (facts?.signatureStatus === "not_confirmed") {
    lines.push("Assinatura do cliente: nao comprovada no sistema.");
  } else {
    lines.push("Assinatura do cliente: nao identificada.");
  }

  if (facts?.financialStatus === "recorded") {
    const count = Number.isInteger(facts.financialEventCount) ? ` (${facts.financialEventCount} registro${facts.financialEventCount === 1 ? "" : "s"})` : "";
    lines.push(`Situacao financeira: ha registro financeiro no sistema${count}; isso nao confirma quitacao.`);
  } else if (facts?.financialStatus === "not_recorded") {
    lines.push("Situacao financeira: nenhum lancamento financeiro identificado.");
  } else {
    lines.push("Situacao financeira: nao identificada com seguranca.");
  }

  lines.push(`Motivo informado: ${reason}.`);
  lines.push("Nenhum cancelamento, reembolso ou estorno foi executado automaticamente.");
  return lines.join("\n");
}

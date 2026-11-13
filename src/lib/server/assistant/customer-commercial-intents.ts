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

export function renderCancellationAlert(args: { customerName?: string | null; reference?: string | null; reason?: string | null }) {
  const customer = clean(args.customerName) || "O cliente";
  const reference = clean(args.reference);
  const reason = clean(args.reason) || "nao informado";
  return [
    `${customer} solicitou o cancelamento da compra${reference ? ` (${reference})` : ""}.`,
    `Motivo informado: ${reason}.`,
    "Nenhum cancelamento, reembolso ou estorno foi executado automaticamente.",
  ].join("\n");
}

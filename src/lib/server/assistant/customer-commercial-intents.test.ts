import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCustomerMediaForPayment,
  detectCustomerCancellationRequest,
  isCustomerCancellationReasonRefusal,
  renderCancellationReasonQuestion,
  renderPaymentProofClarificationQuestion,
  renderCancellationAlert,
} from "./customer-commercial-intents";

test("payment context classifies a compatible image without treating every image as proof", () => {
  const ambiguous = classifyCustomerMediaForPayment({ messageType: "image", caption: null, recentConversationText: ["vou fazer o Pix hoje"] });
  assert.equal(ambiguous.intent, "payment_proof");
  assert.equal(ambiguous.requiresCustomerConfirmation, true);
  assert.equal(classifyCustomerMediaForPayment({ messageType: "image", caption: null, recentConversationText: ["olha a piscina"] }).intent, "unknown");
});

test("payment PDF and cancellation preserve uncertainty and reason", () => {
  assert.equal(classifyCustomerMediaForPayment({ messageType: "document", mimeType: "application/pdf", fileName: "comprovante.pdf", recentConversationText: ["me envie a chave Pix"] }).confidence, "high");
  assert.deepEqual(detectCustomerCancellationRequest("Quero cancelar a compra porque não conseguirei pagar"), { reason: "não conseguirei pagar", needsReason: false });
  assert.match(renderCancellationAlert({ customerName: "Joao" }), /Nenhum cancelamento/);
});

test("PDF with payment context is sufficient while ambiguous images ask once", () => {
  const pdf = classifyCustomerMediaForPayment({ messageType: "document", mimeType: "application/pdf", fileName: "extrato.pdf", recentConversationText: ["fiz a transferencia"] });
  assert.equal(pdf.requiresCustomerConfirmation, false);
  assert.equal(renderPaymentProofClarificationQuestion(), "Esse e o comprovante do pagamento?");
});

test("cancellation reason refusal is preserved as not informed", () => {
  assert.equal(isCustomerCancellationReasonRefusal("prefiro não informar"), true);
  assert.equal(isCustomerCancellationReasonRefusal("foi por causa do prazo"), false);
  assert.equal(renderCancellationReasonQuestion(), "Entendi. Posso saber o que te levou a querer cancelar?");
});

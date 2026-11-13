import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCustomerMediaForPayment,
  detectCustomerCancellationRequest,
  renderCancellationAlert,
} from "./customer-commercial-intents";

test("payment context classifies a compatible image without treating every image as proof", () => {
  assert.equal(classifyCustomerMediaForPayment({ messageType: "image", caption: null, recentConversationText: ["vou fazer o Pix hoje"] }).intent, "payment_proof");
  assert.equal(classifyCustomerMediaForPayment({ messageType: "image", caption: null, recentConversationText: ["olha a piscina"] }).intent, "unknown");
});

test("payment PDF and cancellation preserve uncertainty and reason", () => {
  assert.equal(classifyCustomerMediaForPayment({ messageType: "document", mimeType: "application/pdf", fileName: "comprovante.pdf", recentConversationText: ["me envie a chave Pix"] }).confidence, "high");
  assert.deepEqual(detectCustomerCancellationRequest("Quero cancelar a compra porque não conseguirei pagar"), { reason: "não conseguirei pagar", needsReason: false });
  assert.match(renderCancellationAlert({ customerName: "Joao" }), /Nenhum cancelamento/);
});

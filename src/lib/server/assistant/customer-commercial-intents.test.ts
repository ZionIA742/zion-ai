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

test("cancellation alert includes supplied facts without claiming quitacao", () => {
  const alert = renderCancellationAlert({
    customerName: "Regina",
    reason: "nao conseguirei pagar",
    facts: {
      opportunityStatus: "identified",
      opportunityStage: "fechamento_pagamento",
      quoteNumber: "ORC-42",
      contractStatus: "identified",
      contractNumber: "CTR-42",
      contractStatusValue: "customer_signed",
      signatureStatus: "confirmed",
      financialStatus: "recorded",
      financialEventCount: 1,
    },
  });
  assert.match(alert, /Regina solicitou o cancelamento/);
  assert.match(alert, /ORC-42/);
  assert.match(alert, /CTR-42/);
  assert.match(alert, /Assinatura do cliente: confirmada/);
  assert.match(alert, /ha registro financeiro/);
  assert.match(alert, /nao confirma quitacao/);
  assert.match(alert, /Nenhum cancelamento, reembolso ou estorno/);
});

test("cancellation alert preserves ambiguity and unknown financial state", () => {
  const alert = renderCancellationAlert({
    customerName: "Regina",
    facts: {
      opportunityStatus: "ambiguous",
      contractStatus: "ambiguous",
      signatureStatus: "unknown",
      financialStatus: "unknown",
    },
  });
  assert.match(alert, /associacao permanece ambigua/);
  assert.match(alert, /nao foi escolhido arbitrariamente/);
  assert.match(alert, /nao identificada com seguranca/);
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

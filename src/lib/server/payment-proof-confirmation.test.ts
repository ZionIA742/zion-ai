import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPaymentProofHumanDecision,
  createPaymentProofPendingRecord,
  preparePaymentRecordingCommand,
} from "./payment-proof-confirmation.ts";

const base = {
  organizationId: "org-1",
  storeId: "store-1",
  commercialOpportunityId: "opportunity-1",
  lifecycleCycle: 3,
  sourceMessageId: "message-1",
  storageBucket: "whatsapp-inbox",
  storagePath: "org-1/store-1/conversation-1/message-1.pdf",
  responsibleId: "responsible-1",
  responsibleNotificationId: "notification-1",
  now: "2026-11-09T12:00:00.000Z",
};

test("cria pendencia escopada, preserva a midia e gera chave idempotente", () => {
  const record = createPaymentProofPendingRecord(base);
  assert.equal(record.status, "pending");
  assert.equal(record.storagePath, base.storagePath);
  assert.match(record.operationKey, /org-1:store-1:message-1$/);
  assert.equal(record.decision, null);
});

test("nega comprovante sem criar evento financeiro", () => {
  const record = createPaymentProofPendingRecord(base);
  const result = applyPaymentProofHumanDecision(record, {
    decision: "no",
    actorResponsibleId: "responsible-1",
    decisionMessageId: "decision-message-1",
    decisionExternalMessageId: "wamid-decision-1",
    now: "2026-11-09T12:01:00.000Z",
  });
  assert.equal(result.record.status, "rejected");
  assert.equal(result.record.amountCents, null);
  assert.equal(result.record.paymentKind, null);
  assert.throws(() => preparePaymentRecordingCommand(result.record), /not_ready/);
});

test("SIM exige valor e tipo informados pelo responsável antes do registro", () => {
  const record = createPaymentProofPendingRecord(base);
  const awaitingDetails = applyPaymentProofHumanDecision(record, {
    decision: "yes",
    actorResponsibleId: "responsible-1",
    decisionMessageId: "decision-message-1",
    decisionExternalMessageId: "wamid-decision-1",
    now: "2026-11-09T12:01:00.000Z",
  });
  assert.equal(awaitingDetails.record.status, "awaiting_details");
  assert.equal(awaitingDetails.record.decision, "yes");
  assert.equal(awaitingDetails.record.amountCents, null);
  assert.equal(awaitingDetails.record.paymentKind, null);

  const result = applyPaymentProofHumanDecision(awaitingDetails.record, {
    decision: "yes",
    actorResponsibleId: "responsible-1",
    decisionMessageId: "decision-message-2",
    decisionExternalMessageId: "wamid-decision-2",
    amountCents: 12500,
    paymentKind: "entry",
    now: "2026-11-09T12:02:00.000Z",
  });
  assert.equal(result.record.status, "ready_for_recording");
  assert.equal(result.record.amountCents, 12500);
  assert.equal(result.record.paymentKind, "entry");
});

test("registro preparado usa a autoridade financeira existente e mantém o comprovante como referência", () => {
  const record = applyPaymentProofHumanDecision(
    createPaymentProofPendingRecord(base),
    {
      decision: "yes",
      actorResponsibleId: "responsible-1",
      decisionMessageId: "decision-message-1",
      decisionExternalMessageId: "wamid-decision-1",
      amountCents: 12500,
      paymentKind: "partial",
      now: "2026-11-09T12:02:00.000Z",
    },
  ).record;
  const command = preparePaymentRecordingCommand(record);
  assert.equal(command.rpc, "record_commercial_opportunity_payment_by_user");
  assert.equal(command.params.p_amount_cents, 12500);
  assert.equal(command.params.p_metadata.source_message_id, "message-1");
  assert.equal(command.params.p_metadata.storage_path, base.storagePath);
  assert.equal(command.params.p_payment_method, "pix");
});

test("replay idempotente repete SIM e conflito nao troca decisao", () => {
  const record = applyPaymentProofHumanDecision(
    createPaymentProofPendingRecord(base),
    {
      decision: "yes",
      actorResponsibleId: "responsible-1",
      decisionMessageId: "decision-message-1",
      decisionExternalMessageId: "wamid-decision-1",
      amountCents: 1000,
      paymentKind: "other",
      now: "2026-11-09T12:02:00.000Z",
    },
  ).record;
  const replay = applyPaymentProofHumanDecision(record, {
    decision: "yes",
    actorResponsibleId: "responsible-1",
    decisionMessageId: "decision-message-1",
    decisionExternalMessageId: "wamid-decision-1",
    amountCents: 1000,
    paymentKind: "other",
  });
  assert.equal(replay.idempotentReplay, true);
  assert.throws(
    () => applyPaymentProofHumanDecision(record, {
      decision: "no",
      actorResponsibleId: "responsible-1",
      decisionMessageId: "decision-message-2",
      decisionExternalMessageId: "wamid-decision-2",
    }),
    /decision_conflict/,
  );
});

test("SIM sem detalhes permanece aguardando, sem aceitar saldo fornecido pelo chamador", () => {
  const record = createPaymentProofPendingRecord(base);
  const result = applyPaymentProofHumanDecision(record, {
    decision: "yes",
    actorResponsibleId: "responsible-1",
    decisionMessageId: "decision-message-1",
    decisionExternalMessageId: "wamid-decision-1",
  });
  assert.equal(result.record.status, "awaiting_details");
  assert.equal(result.record.amountCents, null);
  assert.equal(result.record.paymentKind, null);
});

export type PaymentProofDecision = "yes" | "no";
export type PaymentProofKind = "entry" | "full" | "partial" | "other";
export type PaymentProofStatus =
  | "pending"
  | "awaiting_details"
  | "rejected"
  | "ready_for_recording";

export type PaymentProofPendingRecord = {
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  lifecycleCycle: number;
  sourceMessageId: string;
  storageBucket: string;
  storagePath: string;
  responsibleId: string;
  responsibleNotificationId: string;
  status: PaymentProofStatus;
  decision: PaymentProofDecision | null;
  decisionActorResponsibleId: string | null;
  decisionMessageId: string | null;
  decisionExternalMessageId: string | null;
  paymentKind: PaymentProofKind | null;
  amountCents: number | null;
  operationKey: string;
  createdAt: string;
  decidedAt: string | null;
};

export type PaymentProofDecisionInput = {
  decision: PaymentProofDecision;
  actorResponsibleId: string;
  decisionMessageId: string;
  decisionExternalMessageId: string;
  amountCents?: number | null;
  paymentKind?: PaymentProofKind | null;
  now?: string;
};

function required(value: unknown, field: string) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
}

function normalizeCycle(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error("lifecycle_cycle_invalid");
  }
  return Number(value);
}

function normalizeNow(value: unknown) {
  const normalized = required(value || new Date().toISOString(), "timestamp");
  if (!Number.isFinite(Date.parse(normalized))) throw new Error("timestamp_invalid");
  return normalized;
}

function normalizeAmount(value: unknown) {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error("amount_cents_invalid");
  }
  return Number(value);
}

function normalizePaymentKind(value: unknown): PaymentProofKind {
  if (value !== "entry" && value !== "full" && value !== "partial" && value !== "other") {
    throw new Error("payment_kind_invalid");
  }
  return value;
}

function assertNoMutationAfterTerminalState(
  record: PaymentProofPendingRecord,
  input: PaymentProofDecisionInput,
) {
  if (record.status === "rejected" || record.status === "ready_for_recording") {
    if (
      record.decision !== input.decision ||
      (input.decision === "yes" &&
        (record.amountCents !== (input.amountCents ?? null) ||
          record.paymentKind !== (input.paymentKind ?? null))) ||
      record.decisionMessageId !== input.decisionMessageId ||
      record.decisionExternalMessageId !== input.decisionExternalMessageId ||
      record.decisionActorResponsibleId !== input.actorResponsibleId
    ) {
      throw new Error("payment_proof_decision_conflict");
    }
    return true;
  }
  return false;
}

export function createPaymentProofPendingRecord(input: {
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  lifecycleCycle: number;
  sourceMessageId: string;
  storageBucket: string;
  storagePath: string;
  responsibleId: string;
  responsibleNotificationId: string;
  now?: string;
}): PaymentProofPendingRecord {
  const organizationId = required(input.organizationId, "organization_id");
  const storeId = required(input.storeId, "store_id");
  const commercialOpportunityId = required(
    input.commercialOpportunityId,
    "commercial_opportunity_id",
  );
  const sourceMessageId = required(input.sourceMessageId, "source_message_id");
  const storageBucket = required(input.storageBucket, "storage_bucket");
  const storagePath = required(input.storagePath, "storage_path");
  const responsibleId = required(input.responsibleId, "responsible_id");
  const responsibleNotificationId = required(
    input.responsibleNotificationId,
    "responsible_notification_id",
  );
  const lifecycleCycle = normalizeCycle(input.lifecycleCycle);
  const createdAt = normalizeNow(input.now);

  return {
    organizationId,
    storeId,
    commercialOpportunityId,
    lifecycleCycle,
    sourceMessageId,
    storageBucket,
    storagePath,
    responsibleId,
    responsibleNotificationId,
    status: "pending",
    decision: null,
    decisionActorResponsibleId: null,
    decisionMessageId: null,
    decisionExternalMessageId: null,
    paymentKind: null,
    amountCents: null,
    operationKey: `p9_9_5_a1:payment-proof:${organizationId}:${storeId}:${sourceMessageId}`,
    createdAt,
    decidedAt: null,
  };
}

export function applyPaymentProofHumanDecision(
  record: PaymentProofPendingRecord,
  input: PaymentProofDecisionInput,
) {
  const actorResponsibleId = required(input.actorResponsibleId, "actor_responsible_id");
  const decisionMessageId = required(input.decisionMessageId, "decision_message_id");
  const decisionExternalMessageId = required(
    input.decisionExternalMessageId,
    "decision_external_message_id",
  );
  if (input.decision !== "yes" && input.decision !== "no") {
    throw new Error("payment_proof_decision_invalid");
  }

  if (assertNoMutationAfterTerminalState(record, input)) {
    return { record, idempotentReplay: true as const };
  }

  if (record.decision && record.decision !== input.decision) {
    throw new Error("payment_proof_decision_conflict");
  }

  const decidedAt = normalizeNow(input.now);
  if (input.decision === "no") {
    return {
      idempotentReplay: false as const,
      record: {
        ...record,
        status: "rejected" as const,
        decision: "no" as const,
        decisionActorResponsibleId: actorResponsibleId,
        decisionMessageId,
        decisionExternalMessageId,
        paymentKind: null,
        amountCents: null,
        decidedAt,
      },
    };
  }

  if (input.paymentKind == null && input.amountCents == null) {
    return {
      idempotentReplay: false as const,
      record: {
        ...record,
        status: "awaiting_details" as const,
        decision: "yes" as const,
        decisionActorResponsibleId: actorResponsibleId,
        decisionMessageId,
        decisionExternalMessageId,
        decidedAt,
      },
    };
  }

  if (input.paymentKind == null || input.amountCents == null) {
    throw new Error("payment_details_incomplete");
  }

  const paymentKind = normalizePaymentKind(input.paymentKind);
  const amountCents = normalizeAmount(input.amountCents);

  return {
    idempotentReplay: false as const,
    record: {
      ...record,
      status: "ready_for_recording" as const,
      decision: "yes" as const,
      decisionActorResponsibleId: actorResponsibleId,
      decisionMessageId,
      decisionExternalMessageId,
      paymentKind,
      amountCents,
      decidedAt,
    },
  };
}

export function preparePaymentRecordingCommand(record: PaymentProofPendingRecord) {
  if (record.status !== "ready_for_recording" || record.decision !== "yes") {
    throw new Error("payment_proof_not_ready_for_recording");
  }
  if (!record.decisionActorResponsibleId || !record.amountCents || !record.paymentKind) {
    throw new Error("payment_proof_recording_details_missing");
  }

  return {
    rpc: "record_commercial_opportunity_payment_by_user" as const,
    params: {
      p_organization_id: record.organizationId,
      p_store_id: record.storeId,
      p_commercial_opportunity_id: record.commercialOpportunityId,
      p_expected_lifecycle_cycle: record.lifecycleCycle,
      p_operation_key: record.operationKey,
      p_request_fingerprint: [
        "p9_9_5_a1",
        record.sourceMessageId,
        record.amountCents,
        record.paymentKind,
      ].join(":"),
      p_event_type: "confirmation" as const,
      p_amount_cents: record.amountCents,
      p_payment_method: "pix",
      p_reversed_payment_event_id: null,
      p_notes: "Confirmacao humana de comprovante recebido pelo WhatsApp",
      p_metadata: {
        source: "whatsapp_payment_proof_confirmation",
        source_message_id: record.sourceMessageId,
        storage_bucket: record.storageBucket,
        storage_path: record.storagePath,
        payment_kind: record.paymentKind,
        decision_actor_responsible_id: record.decisionActorResponsibleId,
      },
    },
  };
}

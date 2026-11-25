import {
  registerHumanQuoteSendInternal,
} from "./human-quote-send-registration";

import {
  prepareHumanQuoteCustomerTransport,
} from "./human-quote-customer-transport";

import {
  createHumanQuoteSendAttemptCallbacks,
} from "./human-quote-send-attempt";

import {
  executeHumanQuoteTransport,
} from "./human-quote-send-transport";

import {
  assertSalesQuoteVersionNotExpired,
} from "./quote-expiration";

import {
  parseHumanQuoteSendRequest,
} from "./human-quote-send-contract";

const POLICY_DENIALS = new Set([
  "CUSTOMER_SCOPE_INVALID",
  "CUSTOMER_INTEGRATION_INVALID",
  "CUSTOMER_LEAD_INVALID",
  "CUSTOMER_DESTINATION_CHANGED",
  "CUSTOMER_OPTED_OUT",
  "CUSTOMER_TEMPLATE_REQUIRED",
  "CUSTOMER_INBOUND_TIMESTAMP_INVALID",
]);

const HISTORY_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function validHistoryUuid(value: unknown): boolean {
  return typeof value === "string"
    && HISTORY_UUID.test(value)
    && value !== "00000000-0000-0000-0000-000000000000";
}

const HISTORY_BINDING_SKIPS = new Set([
  "NO_PROVEN_CONVERSATION",
  "AMBIGUOUS_CONVERSATION",
]);

const HISTORY_PROJECTION_SKIPS = new Set([
  ...HISTORY_BINDING_SKIPS,
  "PRE_SEND_BINDING_UNAVAILABLE",
  "BOUND_CONVERSATION_UNAVAILABLE",
  "BOUND_EVIDENCE_UNAVAILABLE",
]);

/**
 * Authorized human customer document send.
 *
 * This service has no public route.
 * It must be called only for an explicit human send action.
 *
 * Provider acceptance is not delivery confirmation.
 * No artificial lead, approval or CRM stage writes.
 */
export async function executeHumanQuoteCustomerSend(args: {
  quoteId: string;
  body: unknown;
}) {

  const request = parseHumanQuoteSendRequest(args.body);

  if (request.recipient.kind === "responsible") {
    throw new Error("HUMAN_QUOTE_CUSTOMER_RECIPIENT_INVALID");
  }

  const context = await registerHumanQuoteSendInternal({
    quoteId: args.quoteId,
    body: request,
  });

  const registered = context.registration;

  const historyScope = {
    p_organization_id: context.scope.organizationId,
    p_store_id: context.scope.storeId,
    p_actor_user_id: context.scope.actorUserId,
    p_operation_id: registered.operationId,
  };

  async function bindLeadHistory(phoneNumberId: string): Promise<void> {

    if (request.recipient.kind !== "lead") {
      return;
    }

    const response = await context.supabase.rpc(
      "bind_human_quote_send_history_by_system",
      {
        ...historyScope,
        p_phone_number_id: phoneNumberId,
      }
    );

    const binding = response.data;

    if (
      response.error ||
      !binding ||
      typeof binding !== "object" ||
      Array.isArray(binding) ||
      binding.phone_number_id !== phoneNumberId
    ) {
      throw new Error("HUMAN_QUOTE_HISTORY_BINDING_UNAVAILABLE");
    }

    if (
      binding.outcome === "bound" &&
      binding.reason === "PROVEN_WHATSAPP_CONVERSATION" &&
      validHistoryUuid(binding.conversation_id) &&
      validHistoryUuid(binding.inbound_message_id)
    ) {
      return;
    }

    if (
      binding.outcome === "skipped" &&
      HISTORY_BINDING_SKIPS.has(binding.reason) &&
      !("conversation_id" in binding) &&
      !("inbound_message_id" in binding)
    ) {
      return;
    }

    throw new Error("HUMAN_QUOTE_HISTORY_BINDING_INVALID");
  }

  async function projectAcceptedHistory(status: string): Promise<
    "recorded" | "skipped" | "pending" | "not_applicable"
  > {

    if (
      status !== "accepted" ||
      request.recipient.kind !== "lead"
    ) {
      return "not_applicable";
    }

    try {

      const response = await context.supabase.rpc(
        "project_human_quote_send_history_by_system",
        historyScope
      );

      const projection = response.data;

      if (
        response.error ||
        !projection ||
        typeof projection !== "object" ||
        Array.isArray(projection)
      ) {
        return "pending";
      }

      if (
        projection.outcome === "recorded" &&
        projection.reason === "ACCEPTED_DOCUMENT_RECORDED" &&
        validHistoryUuid(projection.message_id) &&
        validHistoryUuid(projection.conversation_id)
      ) {
        return "recorded";
      }

      if (
        projection.outcome === "skipped" &&
        HISTORY_PROJECTION_SKIPS.has(projection.reason) &&
        !("message_id" in projection)
      ) {
        return "skipped";
      }

      return "pending";

    } catch {

      return "pending";

    }
  }

  /**
   * The delivery ledger is the authority for acceptance.
   * CRM projection is a separate, idempotent operation.
   * A CRM failure must never repeat provider transport.
   */
  async function projectAcceptedLead(status: string): Promise<
    "moved" |
    "unchanged" |
    "skipped" |
    "pending" |
    "not_applicable"
  > {

    if (
      status !== "accepted" ||
      request.recipient.kind !== "lead"
    ) {
      return "not_applicable";
    }

    try {

      const projection = await context.supabase.rpc(
        "project_human_quote_send_crm_by_system",
        {
          p_organization_id: context.scope.organizationId,
          p_store_id: context.scope.storeId,
          p_actor_user_id: context.scope.actorUserId,
          p_operation_id: registered.operationId,
        }
      );

      if (
        projection.error ||
        !projection.data ||
        typeof projection.data !== "object" ||
        Array.isArray(projection.data)
      ) {
        return "pending";
      }

      const decision = projection.data;

      if (
        typeof decision.reason !== "string" ||
        !decision.reason.trim()
      ) {
        return "pending";
      }

      if (
        decision.outcome === "moved" &&
        decision.stage === "orcamento" &&
        (
          decision.previous_stage === "novo_lead" ||
          decision.previous_stage === "qualificacao"
        )
      ) {
        return "moved";
      }

      if (
        decision.outcome === "unchanged" ||
        decision.outcome === "skipped"
      ) {
        return decision.outcome;
      }

      return "pending";

    } catch {

      return "pending";

    }
  }

  if (context.replayOnly || registered.status !== "registered") {
    return {
      operationId: registered.operationId,
      quoteId: registered.quoteId,
      quoteVersionId: registered.quoteVersionId,
      status: registered.status,
      reason: registered.statusReason,
      providerRequestAttempted: false,
      crmProjection: await projectAcceptedLead(
        registered.status
      ),
      historyProjection: await projectAcceptedHistory(
        registered.status
      ),
    };
  }

  if (
    context.recipient.kind !== request.recipient.kind ||
    (
      request.recipient.kind === "lead" &&
      context.recipient.leadId !== request.recipient.leadId
    ) ||
    (
      request.recipient.kind === "phone" &&
      context.recipient.candidatePhone !== request.recipient.phone
    )
  ) {
    throw new Error("HUMAN_QUOTE_CUSTOMER_RECIPIENT_MISMATCH");
  }

  if (
    typeof context.quote.status !== "string" ||
    ["cancelled","expired","failed"].includes(
      context.quote.status
    )
  ) {
    throw new Error("HUMAN_QUOTE_CUSTOMER_QUOTE_UNAVAILABLE");
  }

  assertSalesQuoteVersionNotExpired({
    quote: context.quote,
    version: context.version,
  });

  const prepared = await prepareHumanQuoteCustomerTransport({
    supabase: context.supabase,
    pdfInput: context.pdfInput,
    destinationPhone: context.recipient.candidatePhone,
  });

  let reason: string | null = null;

  const callbacks = createHumanQuoteSendAttemptCallbacks({
    supabase: context.supabase,
    scope: context.scope,
    request,
    storeFileId: context.pdf.storeFileId,
    destinationPhone: context.recipient.candidatePhone,

    async authorizeStart() {

      const response = await context.supabase.rpc(
        "read_human_quote_customer_send_policy_by_system",
        {
          p_organization_id: context.scope.organizationId,
          p_store_id: context.scope.storeId,
          p_destination_phone: context.recipient.candidatePhone,
          p_phone_number_id: prepared.phoneNumberId,
          p_lead_id:
            request.recipient.kind === "lead"
              ? request.recipient.leadId
              : null,
        }
      );

      if (response.error) {
        throw new Error("HUMAN_QUOTE_CUSTOMER_POLICY_UNAVAILABLE");
      }

      const decision = response.data;

      if (
        !decision ||
        typeof decision !== "object" ||
        Array.isArray(decision)
      ) {
        throw new Error("HUMAN_QUOTE_CUSTOMER_POLICY_INVALID");
      }

      if (
        decision.allowed === true &&
        decision.reason === "CUSTOMER_WINDOW_OPEN"
      ) {

        await bindLeadHistory(prepared.phoneNumberId);

        return {allowed:true};
      }

      if (
        decision.allowed === false &&
        typeof decision.reason === "string" &&
        POLICY_DENIALS.has(decision.reason)
      ) {
        reason = decision.reason;

        return {
          allowed:false,
          reason:decision.reason,
        };
      }

      throw new Error("HUMAN_QUOTE_CUSTOMER_POLICY_INVALID");
    },
  });

  const result = await executeHumanQuoteTransport({
    ...callbacks,
    send: prepared.send,
  });

  return {
    operationId: registered.operationId,
    quoteId: registered.quoteId,
    quoteVersionId: registered.quoteVersionId,
    status: result.status,
    reason:
      result.status === "blocked"
        ? reason
        : null,
    providerRequestAttempted: result.providerRequestAttempted,
    crmProjection: await projectAcceptedLead(
      result.status
    ),
    historyProjection: await projectAcceptedHistory(
      result.status
    ),
  };
}

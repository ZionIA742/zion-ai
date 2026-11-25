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

  if (registered.status !== "registered") {
    return {
      operationId: registered.operationId,
      quoteId: registered.quoteId,
      quoteVersionId: registered.quoteVersionId,
      status: registered.status,
      reason: registered.statusReason,
      providerRequestAttempted: false,
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
  };
}

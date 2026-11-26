import {
  registerHumanQuoteSendInternal,
} from "./human-quote-send-registration";

import {
  createHumanQuoteSendAttemptCallbacks,
} from "./human-quote-send-attempt";

import {
  executeHumanQuoteTransport,
} from "./human-quote-send-transport";

import {
  parseHumanQuoteSendRequest,
  normalizeHumanQuoteSendPhone,
} from "./human-quote-send-contract";

import {
  assertSalesQuoteVersionNotExpired,
} from "./quote-expiration";

import {
  resolveResponsibleWhatsappOutboundPolicy,
} from "../assistant/responsible-whatsapp-outbound-policy";

import {
  sendResponsibleWhatsappPayload,
} from "../assistant/responsible-external-notifications-sender";

/**
 * Explicit human document send to the canonical store responsible.
 *
 * No customer delivery event, CRM stage change, artificial lead,
 * AI approval request or automatic notification.
 *
 * The operation ledger owns delivery-attempt persistence.
 */
export async function executeHumanQuoteResponsibleSend(args:{
  quoteId:string;
  body:unknown;
}) {

  const request=parseHumanQuoteSendRequest(args.body);

  if(request.recipient.kind!=="responsible"){
    throw new Error("HUMAN_QUOTE_RESPONSIBLE_RECIPIENT_REQUIRED");
  }

  const context=await registerHumanQuoteSendInternal({
    quoteId:args.quoteId,
    body:request,
  });

  const registered=context.registration;


  async function recoverAcceptedIngress(status: string): Promise<boolean> {

    if (status !== "accepted") {
      return true;
    }

    try {

      const response = await context.supabase.rpc(
        "recover_human_quote_status_ingress_by_system",
        {
          p_organization_id: context.scope.organizationId,
          p_store_id: context.scope.storeId,
          p_actor_user_id: context.scope.actorUserId,
          p_operation_id: registered.operationId,
        }
      );

      const data = response.data;

      if (
        response.error ||
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        data.reason !== "SCOPED_STATUS_INGRESS_RECOVERY" ||
        ![
          data.recovered_count,
          data.existing_count,
          data.conflict_count
        ].every(n =>
          typeof n === "number" &&
          Number.isSafeInteger(n) &&
          n >= 0
        ) ||
        data.conflict_count !== 0
      ) {
        return false;
      }

      return (
        (
          data.outcome === "recovered" &&
          data.recovered_count > 0
        ) ||
        (
          data.outcome === "unchanged" &&
          data.recovered_count === 0
        )
      );

    } catch {

      return false;
    }
  }

  /**
   * Reconcile only persisted, proven status evidence.
   * A reconciliation failure cannot invalidate acceptance
   * or authorize another provider request.
   */
  async function reconcileAcceptedInbox(
    status: string,
    ready = true
  ): Promise<
    "reconciled" | "unchanged" | "pending" | "not_applicable"
  > {

    if (status !== "accepted") {
      return "not_applicable";
    }

    if (!ready) {
      return "pending";
    }

    try {

      const response = await context.supabase.rpc(
        "reconcile_human_quote_status_inbox_by_system",
        {
          p_organization_id: context.scope.organizationId,
          p_store_id: context.scope.storeId,
          p_actor_user_id: context.scope.actorUserId,
          p_operation_id: registered.operationId,
        }
      );

      const data = response.data;

      if (
        response.error ||
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        data.reason !== "SCOPED_STATUS_RECONCILIATION" ||
        typeof data.reconciled_count !== "number" ||
        !Number.isSafeInteger(data.reconciled_count) ||
        data.reconciled_count < 0
      ) {
        return "pending";
      }

      if (
        data.outcome === "reconciled" &&
        data.reconciled_count > 0
      ) {
        return "reconciled";
      }

      if (
        data.outcome === "unchanged" &&
        data.reconciled_count === 0
      ) {
        return "unchanged";
      }

      return "pending";

    } catch {

      return "pending";
    }
  }


  if(context.replayOnly || registered.status!=="registered"){
    const ingressReady = await recoverAcceptedIngress(registered.status);

    return {
      operationId:registered.operationId,
      quoteId:registered.quoteId,
      quoteVersionId:registered.quoteVersionId,
      status:registered.status,
      reason:registered.statusReason,
      providerRequestAttempted:false,
      inboxReconciliation: await reconcileAcceptedInbox(registered.status, ingressReady),
    };
  }

  const responsibleId=context.recipient.responsibleId;
  const phone=context.recipient.candidatePhone;

  if(
    context.recipient.kind!=="responsible" ||
    !responsibleId ||
    context.recipient.leadId!==null ||
    normalizeHumanQuoteSendPhone(phone)!==phone
  ){
    throw new Error("HUMAN_QUOTE_RESPONSIBLE_SCOPE_INVALID");
  }

  const destination=phone.slice(1);

  if(
    typeof context.quote.status!=="string" ||
    ["cancelled","expired","failed"].includes(
      context.quote.status
    )
  ){
    throw new Error("HUMAN_QUOTE_RESPONSIBLE_QUOTE_UNAVAILABLE");
  }

  assertSalesQuoteVersionNotExpired({
    quote:context.quote,
    version:context.version,
  });

  const signed=await context.supabase.storage
    .from(context.pdf.storageBucket)
    .createSignedUrl(context.pdf.storagePath,900);

  if(signed.error || !signed.data?.signedUrl){
    throw new Error("HUMAN_QUOTE_RESPONSIBLE_PDF_UNAVAILABLE");
  }

  const documentUrl=signed.data.signedUrl;

  let parsedUrl:URL;

  try{
    parsedUrl=new URL(documentUrl);
  }catch{
    throw new Error("HUMAN_QUOTE_RESPONSIBLE_PDF_URL_INVALID");
  }

  if(
    parsedUrl.protocol!=="https:" ||
    parsedUrl.username ||
    parsedUrl.password
  ){
    throw new Error("HUMAN_QUOTE_RESPONSIBLE_PDF_URL_INVALID");
  }

  // Resolve the exact provider channel before acquiring
  // an attempt. Never use an environment-token fallback.

  const integration=await context.supabase.rpc(
    "get_active_whatsapp_integration_for_external_send_by_system",
    {
      p_organization_id:context.scope.organizationId,
      p_store_id:context.scope.storeId,
    }
  );

  if(integration.error){
    throw new Error("HUMAN_QUOTE_RESPONSIBLE_CHANNEL_UNAVAILABLE");
  }

  const rows=Array.isArray(integration.data)
    ? integration.data
    : integration.data
      ? [integration.data]
      : [];

  if(rows.length!==1){
    throw new Error("HUMAN_QUOTE_RESPONSIBLE_CHANNEL_UNAVAILABLE");
  }

  const channel=rows[0];

  const phoneNumberId=
    typeof channel?.phone_number_id==="string"
      ? channel.phone_number_id.trim()
      : "";

  if(
    !/^[0-9]{1,128}$/.test(phoneNumberId) ||
    typeof channel?.access_token!=="string" ||
    !channel.access_token.trim()
  ){
    throw new Error("HUMAN_QUOTE_RESPONSIBLE_CHANNEL_INVALID");
  }

  let reason:string|null=null;

  const callbacks=createHumanQuoteSendAttemptCallbacks({
    supabase:context.supabase,
    scope:context.scope,
    request,
    storeFileId:context.pdf.storeFileId,
    destinationPhone:phone,
    phoneNumberId,

    async authorizeStart(){

      const policy=await resolveResponsibleWhatsappOutboundPolicy({
        supabase:context.supabase,
        organizationId:context.scope.organizationId,
        storeId:context.scope.storeId,
        responsibleId,
        destination,
        expectedPhoneNumberId:phoneNumberId,
      });

      if(!policy.ok){

        reason=
          typeof policy.reason==="string" &&
          /^RESPONSIBLE_[A-Z0-9_]{1,120}$/.test(policy.reason)
            ? policy.reason
            : "RESPONSIBLE_WHATSAPP_POLICY_DENIED";

        return {
          allowed:false,
          reason,
        };
      }

      if(
        policy.responsible.id!==responsibleId ||
        policy.responsible.whatsappNumber!==destination
      ){

        reason="RESPONSIBLE_WHATSAPP_DESTINATION_CHANGED";

        return {
          allowed:false,
          reason,
        };
      }

      if(policy.mode!=="free_form"){

        reason="RESPONSIBLE_WHATSAPP_TEMPLATE_REQUIRED";

        return {
          allowed:false,
          reason,
        };
      }

      return {allowed:true};
    },
  });

  const result=await executeHumanQuoteTransport({
    ...callbacks,

    async send(){

      const response=await sendResponsibleWhatsappPayload({
        organizationId:context.scope.organizationId,
        storeId:context.scope.storeId,
        responsibleId,
        destination,
        expectedPhoneNumberId:phoneNumberId,
        payload:{
          type:"document",
          link:documentUrl,
          filename:context.pdf.originalFilename,
          caption:"Segue o or?amento solicitado no ZION.",
        },
      });

      if(response.ok){

        return {
          outcome:"accepted",
          externalMessageId:response.externalMessageId,
        };
      }

      if([
        "RESPONSIBLE_WHATSAPP_SEND_INVALID_INPUT",
        "RESPONSIBLE_WHATSAPP_DESTINATION_SCOPE_MISMATCH",
        "RESPONSIBLE_WHATSAPP_DESTINATION_CHANGED",
      ].includes(response.reason)){

        return {outcome:"failed"};
      }

      // The existing sender may return a generic failure
      // without sufficient evidence of provider rejection.
      // Preserve uncertainty rather than allowing blind retry.

      return {outcome:"uncertain"};
    },
  });

  const ingressReady = await recoverAcceptedIngress(result.status);

  return {
    operationId:registered.operationId,
    quoteId:registered.quoteId,
    quoteVersionId:registered.quoteVersionId,
    status:result.status,
    reason:result.status==="blocked"?reason:null,
    providerRequestAttempted:result.providerRequestAttempted,
    inboxReconciliation: await reconcileAcceptedInbox(result.status, ingressReady),
  };
}

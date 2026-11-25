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

  if(context.replayOnly || registered.status!=="registered"){
    return {
      operationId:registered.operationId,
      quoteId:registered.quoteId,
      quoteVersionId:registered.quoteVersionId,
      status:registered.status,
      reason:registered.statusReason,
      providerRequestAttempted:false,
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

  let reason:string|null=null;

  const callbacks=createHumanQuoteSendAttemptCallbacks({
    supabase:context.supabase,
    scope:context.scope,
    request,
    storeFileId:context.pdf.storeFileId,
    destinationPhone:phone,

    async authorizeStart(){

      const policy=await resolveResponsibleWhatsappOutboundPolicy({
        supabase:context.supabase,
        organizationId:context.scope.organizationId,
        storeId:context.scope.storeId,
        responsibleId,
        destination,
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

  return {
    operationId:registered.operationId,
    quoteId:registered.quoteId,
    quoteVersionId:registered.quoteVersionId,
    status:result.status,
    reason:result.status==="blocked"?reason:null,
    providerRequestAttempted:result.providerRequestAttempted,
  };
}

import { NextResponse } from "next/server";
import { withBackendDiagnosticRoute } from "../../../../../lib/server/zion-admin-diagnostic-backend-next";
import { QuoteAccessError } from "@/lib/server/sales-quotes/quote-auth";
import {
  HumanQuoteSendContractError,
  parseHumanQuoteSendRequest,
} from "@/lib/server/sales-quotes/human-quote-send-contract";
import {
  executeHumanQuoteCustomerSend,
} from "@/lib/server/sales-quotes/human-quote-customer-send";
import {
  executeHumanQuoteResponsibleSend,
} from "@/lib/server/sales-quotes/human-quote-responsible-send";

import { HumanQuoteSendRegistrationError } from "@/lib/server/sales-quotes/human-quote-send-registration";
import { HumanQuoteSendPdfError } from "@/lib/server/sales-quotes/human-quote-send-pdf";
import { HumanQuoteSendRecipientError } from "@/lib/server/sales-quotes/human-quote-send-recipient";
import { HumanQuoteEditProvenanceError } from "@/lib/server/sales-quotes/human-quote-edit-provenance";

const blockedMessages=new Map([
  ["CUSTOMER_TEMPLATE_REQUIRED",
    "O destinatario precisa retomar a conversa no WhatsApp antes do envio do PDF."],
  ["CUSTOMER_OPTED_OUT",
    "O destinatario nao autorizou o recebimento de mensagens."],
  ["CUSTOMER_DESTINATION_CHANGED",
    "O telefone do destinatario foi alterado. Revise o contato."],
  ["CUSTOMER_INTEGRATION_INVALID",
    "A integracao WhatsApp da loja esta indisponivel."]
]);

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const statuses=new Set([
  "registered","attempt_started","accepted",
  "blocked","failed","uncertain","unconfirmed"
]);

type SendDeps={
  customer?:typeof executeHumanQuoteCustomerSend;
  responsible?:typeof executeHumanQuoteResponsibleSend;
};

function failure(status:number,code:string,message:string,operationId?:string){
  return NextResponse.json({
    ok:false,
    error:code,
    message,
    ...(operationId?{operationId}:{})
  },{
    status,
    headers:{"Cache-Control":"no-store"}
  });
}

function validQuoteId(value:unknown):value is string{
  return typeof value==="string" &&
    UUID.test(value) &&
    value!=="00000000-0000-0000-0000-000000000000";
}

export function createHumanQuoteSendPostHandler(deps:SendDeps={}){

  const customer=deps.customer ?? executeHumanQuoteCustomerSend;
  const responsible=deps.responsible ?? executeHumanQuoteResponsibleSend;

  return async function POST(
    request:Request,
    context:{params:Promise<{quoteId:string}>}
  ){

    let operationId:string|undefined;

    try{

      const {quoteId:rawId}=await context.params;

      if(!validQuoteId(rawId)){
        return failure(400,"INVALID_QUOTE_ID","Identificador do orcamento invalido.");
      }

      const quoteId=rawId.toLowerCase();

      let body:unknown;

      try{
        body=await request.json();
      }catch{
        return failure(400,"INVALID_JSON","Conteudo do envio invalido.");
      }

      const input=parseHumanQuoteSendRequest(body);

      operationId=input.operationId;

      // Both services enforce authenticated tenant access,
      // provenance, version and recipient authority internally.
      const result=input.recipient.kind==="responsible"
        ? await responsible({quoteId,body:input})
        : await customer({quoteId,body:input});

      if(
        !result ||
        result.operationId!==input.operationId ||
        result.quoteId!==quoteId ||
        result.quoteVersionId!==input.quoteVersionId ||
        !statuses.has(result.status) ||
        typeof result.providerRequestAttempted!=="boolean"
      ){
        return failure(
          500,
          "HUMAN_QUOTE_SEND_RESULT_UNCONFIRMED",
          "Resultado nao confirmado. Consulte a mesma operacao antes de reenviar.",
          operationId
        );
      }

      const accepted=result.status==="accepted";
      const processing=
        result.status==="registered" ||
        result.status==="attempt_started";

      const rawReason=
        typeof result.reason==="string"
          ? result.reason
          : "";

      const reason=result.status==="blocked"
        ? blockedMessages.has(rawReason)
          ? rawReason
          : "HUMAN_QUOTE_SEND_BLOCKED"
        : null;

      const message=accepted
        ? "Envio aceito pelo WhatsApp."
        : processing
          ? "Operacao em andamento. Consulte a mesma operacao."
          : result.status==="blocked"
            ? blockedMessages.get(rawReason) ||
              "Envio bloqueado. Revise o destinatario e a integracao WhatsApp."
            : result.status==="failed"
              ? "O envio falhou. Revise a operacao antes de uma nova tentativa."
              : "Envio nao confirmado. Consulte a mesma operacao antes de reenviar.";

      // Acceptance is not proof of delivery.
      return NextResponse.json({
        ok:accepted,
        operationId:result.operationId,
        quoteId:result.quoteId,
        quoteVersionId:result.quoteVersionId,
        status:result.status,
        reason,
        message,
        providerAccepted:accepted,
        providerRequestAttempted:result.providerRequestAttempted,
        inboxReconciliation:result.inboxReconciliation,
        ...("crmProjection" in result
          ? {crmProjection:result.crmProjection}
          : {}),
        ...("historyProjection" in result
          ? {historyProjection:result.historyProjection}
          : {})
      },{
        status:accepted?200:processing?202:409,
        headers:{"Cache-Control":"no-store"}
      });

    }catch(error){

      if(error instanceof HumanQuoteSendContractError){
        return failure(400,error.code,"Revise os dados do envio.",operationId);
      }

      if(error instanceof HumanQuoteEditProvenanceError){
        return failure(
          403,
          "HUMAN_QUOTE_EDIT_PROVENANCE_REQUIRED",
          "Este orcamento nao possui origem humana comprovada.",
          operationId
        );
      }

      if(error instanceof HumanQuoteSendPdfError){
        return failure(
          409,
          "HUMAN_QUOTE_SEND_PDF_INVALID",
          "Revise o PDF do orcamento antes de enviar.",
          operationId
        );
      }

      if(error instanceof HumanQuoteSendRecipientError){
        return failure(
          409,
          "HUMAN_QUOTE_SEND_RECIPIENT_INVALID",
          "Revise o destinatario do orcamento.",
          operationId
        );
      }

      if(error instanceof HumanQuoteSendRegistrationError){

        if(error.code==="HUMAN_QUOTE_SEND_VERSION_STALE"){
          return failure(
            409,
            "HUMAN_QUOTE_SEND_VERSION_STALE",
            "Abra a versao mais recente do orcamento.",
            operationId
          );
        }

        const status=[400,401,403,404,409,429,503]
          .includes(error.status)
            ? error.status
            : 500;

        return failure(
          status,
          "HUMAN_QUOTE_SEND_REGISTRATION_UNAVAILABLE",
          status===401 || status===403
            ? "Voce nao possui autorizacao para este envio."
            : "Nao foi possivel confirmar a operacao. Revise ou consulte a mesma operacao.",
          operationId
        );
      }

      if(error instanceof QuoteAccessError){
        return failure(
          error.status,
          error.code,
          "Nao foi possivel autorizar o envio deste orcamento.",
          operationId
        );
      }

      // Never expose raw database errors, credentials,
      // provider responses or private storage information.
      return failure(
        500,
        "HUMAN_QUOTE_SEND_UNCONFIRMED",
        "Nao foi possivel confirmar o envio. Consulte a mesma operacao antes de reenviar.",
        operationId
      );
    }
  };
}

const zionBackendOriginalPOST=createHumanQuoteSendPostHandler();

const zionBackendObservedPOST=withBackendDiagnosticRoute(
  "/api/sales-quotes/[quoteId]/send-human",
  "POST",
  zionBackendOriginalPOST
);

export const POST:typeof zionBackendOriginalPOST=async function POST(
  request,
  context
){
  return zionBackendObservedPOST(request,context);
};

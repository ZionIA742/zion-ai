import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sendSinglePendingMessage,
} from "../whatsapp-external-sender";

import {
  normalizeHumanQuoteSendPhone,
} from "./human-quote-send-contract";

import {
  validateHumanQuoteSendPdf,
} from "./human-quote-send-pdf";

type CustomerProviderResult =
  | { outcome:"accepted"; externalMessageId:string }
  | { outcome:"failed" }
  | { outcome:"uncertain" };

/**
 * Internal customer document transport preparation.
 *
 * The caller must resolve the authenticated operation,
 * recipient, consent and WhatsApp window, and acquire the
 * durable attempt before invoking send().
 *
 * Preparation alone never sends a WhatsApp message.
 */
export async function prepareHumanQuoteCustomerTransport(args: {
  supabase: SupabaseClient;
  pdfInput: Parameters<typeof validateHumanQuoteSendPdf>[0];
  destinationPhone: string;
}): Promise<{
  phoneNumberId: string;
  send: () => Promise<CustomerProviderResult>;
}> {

  const pdf=validateHumanQuoteSendPdf(args.pdfInput);

  const phone=normalizeHumanQuoteSendPhone(
    args.destinationPhone
  );

  if (phone !== args.destinationPhone) {
    throw new Error("HUMAN_QUOTE_CUSTOMER_PHONE_NOT_CANONICAL");
  }

  const integrationResult=await args.supabase.rpc(
    "get_active_whatsapp_integration_for_external_send_by_system",
    {
      p_organization_id:pdf.organizationId,
      p_store_id:pdf.storeId,
    }
  );

  if (integrationResult.error) {
    throw new Error("HUMAN_QUOTE_CUSTOMER_INTEGRATION_UNAVAILABLE");
  }

  const rows=Array.isArray(integrationResult.data)
    ? integrationResult.data
    : integrationResult.data
      ? [integrationResult.data]
      : [];

  if (rows.length !== 1) {
    throw new Error("HUMAN_QUOTE_CUSTOMER_INTEGRATION_AMBIGUOUS");
  }

  const row=rows[0];

  const accessToken=
    typeof row?.access_token === "string"
      ? row.access_token.trim()
      : "";

  const phoneNumberId=
    typeof row?.phone_number_id === "string"
      ? row.phone_number_id.trim()
      : "";

  // New independent sends require store-specific credentials.
  // Never fall back to a token belonging to an unknown store.

  if (!accessToken || !/^[0-9]+$/.test(phoneNumberId)) {
    throw new Error("HUMAN_QUOTE_CUSTOMER_INTEGRATION_INVALID");
  }

  const signed=await args.supabase.storage
    .from(pdf.storageBucket)
    .createSignedUrl(pdf.storagePath,900);

  if (signed.error || !signed.data?.signedUrl) {
    throw new Error("HUMAN_QUOTE_CUSTOMER_PDF_UNAVAILABLE");
  }

  const documentUrl=signed.data.signedUrl;

  let url:URL;

  try {
    url=new URL(documentUrl);
  } catch {
    throw new Error("HUMAN_QUOTE_CUSTOMER_PDF_URL_INVALID");
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("HUMAN_QUOTE_CUSTOMER_PDF_URL_INVALID");
  }

  const integration={accessToken,phoneNumberId};

  let invoked=false;

  return {
    phoneNumberId,
    async send() {

      if (invoked) {
        return {outcome:"uncertain"};
      }

      invoked=true;

      try {

        const externalMessageId=await sendSinglePendingMessage(
          integration,
          {
            mode:"document",
            to:phone.slice(1),
            documentUrl,
            filename:pdf.originalFilename,
            caption:"Segue o or?amento.",
          }
        );

        if (
          typeof externalMessageId !== "string" ||
          externalMessageId.length < 1 ||
          externalMessageId.length > 512 ||
          /[\s\x00-\x1f\x7f]/.test(externalMessageId)
        ) {
          return {outcome:"uncertain"};
        }

        return {
          outcome:"accepted",
          externalMessageId,
        };

      } catch (error) {

        const rejection=error as {
          name?:string;
          httpStatus?:number;
          retryable?:boolean;
        } | null;

        if (
          rejection?.name === "KnownWhatsappSendFailure" &&
          rejection.retryable === false &&
          [400,401,403,404,422].includes(
            rejection.httpStatus ?? 0
          )
        ) {
          return {outcome:"failed"};
        }

        return {outcome:"uncertain"};
      }

    },
  };
}

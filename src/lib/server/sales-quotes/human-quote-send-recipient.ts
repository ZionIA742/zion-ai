import type { SupabaseClient } from "@supabase/supabase-js";

import {
  normalizeHumanQuoteSendPhone,
  type HumanQuoteSendRecipient,
} from "./human-quote-send-contract";

import {
  loadCanonicalActivePrimaryStoreResponsible,
} from "../store-responsibles";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class HumanQuoteSendRecipientError extends Error {
  readonly status = 409;

  constructor(readonly code: string) {
    super(code);
    this.name = "HumanQuoteSendRecipientError";
  }
}

export type HumanQuoteResolvedRecipient =
  | {
      kind: "lead";
      leadId: string;
      responsibleId: null;
      candidatePhone: string;
      crmEffectEligible: true;
    }
  | {
      kind: "phone";
      leadId: null;
      responsibleId: null;
      candidatePhone: string;
      crmEffectEligible: false;
    }
  | {
      kind: "responsible";
      leadId: null;
      responsibleId: string;
      candidatePhone: string;
      crmEffectEligible: false;
    };

function fail(code: string): never {
  throw new HumanQuoteSendRecipientError(code);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    UUID_PATTERN.test(value) &&
    value !== "00000000-0000-0000-0000-000000000000"
  );
}

function normalizeCandidate(
  value: unknown,
  code: string,
): string {
  try {
    return normalizeHumanQuoteSendPhone(value);
  } catch {
    return fail(code);
  }
}

/**
 * Resolves recipient candidates within an already authorized store.
 *
 * This is NOT an external send authorization.
 * A later authority must verify the canonical WhatsApp destination,
 * consent, the applicable messaging window, and operation state.
 *
 * No lead, conversation or commercial opportunity is created here.
 */
export async function resolveHumanQuoteSendRecipient(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  recipient: HumanQuoteSendRecipient;
}): Promise<HumanQuoteResolvedRecipient> {
  const {
    supabase,
    organizationId,
    storeId,
    recipient,
  } = args;

  if (!isUuid(organizationId) || !isUuid(storeId)) {
    return fail("HUMAN_QUOTE_SEND_RECIPIENT_SCOPE_INVALID");
  }

  if (!recipient || typeof recipient !== "object") {
    return fail("HUMAN_QUOTE_SEND_RECIPIENT_INVALID");
  }

  if (recipient.kind === "phone") {
    const candidatePhone = normalizeCandidate(
      recipient.phone,
      "HUMAN_QUOTE_SEND_RECIPIENT_PHONE_INVALID",
    );

    if (candidatePhone !== recipient.phone) {
      return fail("HUMAN_QUOTE_SEND_RECIPIENT_PHONE_NOT_CANONICAL");
    }

    return {
      kind: "phone",
      leadId: null,
      responsibleId: null,
      candidatePhone,
      crmEffectEligible: false,
    };
  }

  if (recipient.kind === "lead") {
    if (!isUuid(recipient.leadId)) {
      return fail("HUMAN_QUOTE_SEND_RECIPIENT_LEAD_INVALID");
    }

    const result = await (async () => {
      try {
        return await supabase
          .from("leads")
          .select("id,organization_id,store_id,phone")
          .eq("id", recipient.leadId)
          .eq("organization_id", organizationId)
          .eq("store_id", storeId)
          .maybeSingle();
      } catch {
        return fail("HUMAN_QUOTE_SEND_RECIPIENT_LEAD_LOOKUP_FAILED");
      }
    })();

    if (result.error) {
      return fail("HUMAN_QUOTE_SEND_RECIPIENT_LEAD_LOOKUP_FAILED");
    }

    const lead = result.data;

    if (
      !lead ||
      lead.id !== recipient.leadId ||
      lead.organization_id !== organizationId ||
      lead.store_id !== storeId
    ) {
      return fail("HUMAN_QUOTE_SEND_RECIPIENT_LEAD_NOT_FOUND");
    }

    const candidatePhone = normalizeCandidate(
      lead.phone,
      "HUMAN_QUOTE_SEND_RECIPIENT_LEAD_PHONE_INVALID",
    );

    return {
      kind: "lead",
      leadId: lead.id,
      responsibleId: null,
      candidatePhone,
      crmEffectEligible: true,
    };
  }

  if (recipient.kind === "responsible") {
    const result = await (async () => {
      try {
        return await loadCanonicalActivePrimaryStoreResponsible({
          supabase,
          organizationId,
          storeId,
        });
      } catch {
        return fail("HUMAN_QUOTE_SEND_RECIPIENT_RESPONSIBLE_LOOKUP_FAILED");
      }
    })();

    if (!result.ok) {
      return fail(
        "HUMAN_QUOTE_SEND_RECIPIENT_" +
        result.reason.toUpperCase(),
      );
    }

    if (!isUuid(result.responsible.id)) {
      return fail("HUMAN_QUOTE_SEND_RECIPIENT_RESPONSIBLE_INVALID");
    }

    const digits = result.responsible.whatsappNumber;

    if (!/^[1-9][0-9]{7,14}$/.test(digits)) {
      return fail("HUMAN_QUOTE_SEND_RECIPIENT_RESPONSIBLE_PHONE_INVALID");
    }

    // The canonical responsible authority returns international digits.
    // Restore the explicit country-code marker before normalizing.
    const candidatePhone = normalizeCandidate(
      "+" + digits,
      "HUMAN_QUOTE_SEND_RECIPIENT_RESPONSIBLE_PHONE_INVALID",
    );

    return {
      kind: "responsible",
      leadId: null,
      responsibleId: result.responsible.id,
      candidatePhone,
      crmEffectEligible: false,
    };
  }

  return fail("HUMAN_QUOTE_SEND_RECIPIENT_KIND_INVALID");
}

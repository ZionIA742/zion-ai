import {
  resolveAuthorizedExistingQuote,
} from "./quote-auth";

import { resolveStoreApiAccess } from "../store-api-access";

import {
  parseHumanQuoteSendRequest,
  buildHumanQuoteSendIdentity,
} from "./human-quote-send-contract";

import {
  validateHumanQuoteSendPdf,
} from "./human-quote-send-pdf";

import {
  resolveHumanQuoteSendRecipient,
} from "./human-quote-send-recipient";

import {
  assertHumanQuoteEditProvenance,
} from "./human-quote-edit-provenance";

import type {
  SalesQuoteVersionRow,
  StoreFileRow,
} from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const OPERATION_STATES = [
  "registered",
  "blocked",
  "attempt_started",
  "accepted",
  "failed",
  "uncertain",
] as const;

type OperationState = typeof OPERATION_STATES[number];

export class HumanQuoteSendRegistrationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "HumanQuoteSendRegistrationError";
  }
}

export type HumanQuoteSendRegistrationResult = {
  outcome: "registered" | "existing_operation";
  operationId: string;
  quoteId: string;
  quoteVersionId: string;
  recipientKind: "lead" | "phone" | "responsible";
  status: OperationState;
  statusReason: string | null;
  createdAt: string;
};

function fail(status: number, code: string): never {
  throw new HumanQuoteSendRegistrationError(status, code);
}

/**
 * Internal registration adapter only.
 *
 * Does not expose an HTTP route or authorize transport.
 * No approval, commercial effects or WhatsApp requests.
 */
export async function registerHumanQuoteSend(args: {
  quoteId: string;
  body: unknown;
}): Promise<HumanQuoteSendRegistrationResult> {
  const registered = await registerHumanQuoteSendInternal(args);
  return registered.registration;
}

/**
 * Backend-only registration context.
 * Never serialize this result to an HTTP response.
 */
export async function registerHumanQuoteSendInternal(args: {
  quoteId: string;
  body: unknown;
}) {

  const quoteId =
    typeof args.quoteId === "string"
      ? args.quoteId.trim().toLowerCase()
      : "";

  if (
    !UUID_PATTERN.test(quoteId) ||
    quoteId === "00000000-0000-0000-0000-000000000000"
  ) {
    return fail(400, "HUMAN_QUOTE_SEND_QUOTE_ID_INVALID");
  }

  const request = parseHumanQuoteSendRequest(args.body);

  // Validate commercial access before privileged quote lookup.
  const access = await resolveStoreApiAccess({
    requirement: "active",
  });

  if (!access.ok) {
    return fail(
      access.httpStatus,
      "HUMAN_QUOTE_SEND_STORE_ACCESS_DENIED",
    );
  }

  if (access.resolution.status !== "store_ready_active") {
    return fail(403, "HUMAN_QUOTE_SEND_STORE_ACCESS_DENIED");
  }

  // The actor and privileged client come from server authentication.
  // Neither is accepted from the request body.
  const scope = await resolveAuthorizedExistingQuote(quoteId);

  const organizationId = scope.organizationId;
  const storeId = scope.store.id;
  const actorUserId = scope.user.id;
  const quote = scope.quote;

  // Both authenticated authorities must resolve the same scope.
  if (
    access.sessionUserId !== actorUserId ||
    access.organizationId !== organizationId ||
    access.storeId !== storeId
  ) {
    return fail(403, "HUMAN_QUOTE_SEND_STORE_ACCESS_SCOPE_MISMATCH");
  }

  if (
    quote.id !== quoteId ||
    quote.organization_id !== organizationId ||
    quote.store_id !== storeId ||
    scope.store.organization_id !== organizationId ||
    !scope.organizationIds.includes(organizationId)
  ) {
    return fail(403, "HUMAN_QUOTE_SEND_AUTHORIZED_SCOPE_MISMATCH");
  }

  // Require visibility through the authenticated session as well.
  // Privileged organization membership alone is not sufficient here.
  const visibleQuote = await scope.sessionSupabase
    .from("sales_quotes")
    .select("id,organization_id,store_id")
    .eq("id", quoteId)
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (visibleQuote.error) {
    return fail(503, "HUMAN_QUOTE_SEND_SESSION_SCOPE_LOOKUP_FAILED");
  }

  if (
    !visibleQuote.data ||
    visibleQuote.data.id !== quoteId ||
    visibleQuote.data.organization_id !== organizationId ||
    visibleQuote.data.store_id !== storeId
  ) {
    return fail(403, "HUMAN_QUOTE_SEND_SESSION_SCOPE_DENIED");
  }

  assertHumanQuoteEditProvenance(quote);

  const identity = buildHumanQuoteSendIdentity(
    {
      organizationId,
      storeId,
      actorUserId,
      quoteId,
    },
    request,
  );

  // Recover the immutable request before checking mutable
  // document versions or current recipient contact details.
  // Authentication, store access and session visibility
  // remain mandatory for every replay.

  const replay = await scope.supabase.rpc(
    "lookup_human_quote_send_replay_by_system",
    {
      p_organization_id: organizationId,
      p_store_id: storeId,
      p_actor_user_id: actorUserId,
      p_operation_id: request.operationId,
      p_quote_id: quoteId,
      p_quote_version_id: request.quoteVersionId,
      p_operation_key: identity.operationKey,
      p_request_fingerprint: identity.requestFingerprint,
    }
  );

  if (replay.error) {

    const code = replay.error.message;

    if (
      replay.error.code === "P0001" &&
      typeof code === "string" &&
      /^HUMAN_QUOTE_SEND_[A-Z0-9_]{1,100}$/.test(code)
    ) {
      return fail(409, code);
    }

    return fail(503, "HUMAN_QUOTE_SEND_REPLAY_LOOKUP_FAILED");
  }

  if (replay.data !== null) {

    const row = replay.data;

    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      row.outcome !== "existing_operation" ||
      row.operation_id !== request.operationId ||
      row.operation_key !== identity.operationKey ||
      row.quote_id !== quoteId ||
      row.quote_version_id !== request.quoteVersionId ||
      row.recipient_kind !== request.recipient.kind ||
      !OPERATION_STATES.includes(row.status) ||
      row.status === "registered" ||
      (
        row.status_reason !== null &&
        (
          typeof row.status_reason !== "string" ||
          !/^[A-Za-z0-9_:-]{1,160}$/.test(row.status_reason)
        )
      ) ||
      typeof row.created_at !== "string" ||
      !Number.isFinite(Date.parse(row.created_at))
    ) {
      return fail(
        503,
        "HUMAN_QUOTE_SEND_REPLAY_RESPONSE_INVALID"
      );
    }

    const registration: HumanQuoteSendRegistrationResult = {
      outcome: "existing_operation",
      operationId: row.operation_id,
      quoteId: row.quote_id,
      quoteVersionId: row.quote_version_id,
      recipientKind: row.recipient_kind,
      status: row.status,
      statusReason: row.status_reason,
      createdAt: row.created_at,
    };

    // Deliberately omit the PDF and recipient transport
    // context. A replay-only result cannot authorize send.

    return {
      replayOnly: true as const,
      registration,
      supabase: scope.supabase,
      scope: {
        organizationId,
        storeId,
        actorUserId,
        quoteId,
      },
      request,
    };
  }

  if (quote.current_version_id !== request.quoteVersionId) {
    return fail(409, "HUMAN_QUOTE_SEND_VERSION_STALE");
  }

  const versionResult = await scope.supabase
    .from("sales_quote_versions")
    .select(
      "id,quote_id,organization_id,store_id,status," +
      "store_file_id,storage_bucket,storage_path," +
      "original_filename,mime_type,size_bytes,quote_snapshot"
    )
    .eq("id", request.quoteVersionId)
    .eq("quote_id", quoteId)
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (versionResult.error) {
    return fail(503, "HUMAN_QUOTE_SEND_VERSION_LOOKUP_FAILED");
  }

  const version =
    versionResult.data as SalesQuoteVersionRow | null;

  if (
    !version ||
    !version.store_file_id ||
    version.status === "failed" ||
    version.status === "superseded"
  ) {
    return fail(409, "HUMAN_QUOTE_SEND_VERSION_UNAVAILABLE");
  }

  if (
    version.id !== request.quoteVersionId ||
    version.quote_id !== quoteId ||
    version.organization_id !== organizationId ||
    version.store_id !== storeId
  ) {
    return fail(409, "HUMAN_QUOTE_SEND_VERSION_SCOPE_MISMATCH");
  }

  const fileResult = await scope.supabase
    .from("store_files")
    .select(
      "id,organization_id,store_id,file_kind," +
      "storage_bucket,storage_path,original_filename," +
      "mime_type,size_bytes"
    )
    .eq("id", version.store_file_id)
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (fileResult.error) {
    return fail(503, "HUMAN_QUOTE_SEND_FILE_LOOKUP_FAILED");
  }

  const pdfInput = {
    organizationId,
    storeId,
    quoteId,
    quoteVersionId: request.quoteVersionId,
    quote,
    version,
    storeFile: fileResult.data as StoreFileRow | null,
  };

  const pdf = validateHumanQuoteSendPdf(pdfInput);

  const recipient = await resolveHumanQuoteSendRecipient({
    supabase: scope.supabase,
    organizationId,
    storeId,
    recipient: request.recipient,
  });

  if (
    recipient.kind !== request.recipient.kind ||
    (
      request.recipient.kind === "lead" &&
      recipient.leadId !== request.recipient.leadId
    ) ||
    (
      request.recipient.kind === "phone" &&
      recipient.candidatePhone !== request.recipient.phone
    )
  ) {
    return fail(409, "HUMAN_QUOTE_SEND_RECIPIENT_MISMATCH");
  }

  // The database revalidates the authoritative rows and hashes.
  // The file identity is not supplied by the caller.
  const rpc = await scope.supabase.rpc(
    "register_human_quote_send_operation_by_system",
    {
      p_organization_id: organizationId,
      p_store_id: storeId,
      p_actor_user_id: actorUserId,
      p_operation_id: request.operationId,
      p_quote_id: quoteId,
      p_quote_version_id: request.quoteVersionId,
      p_recipient_kind: recipient.kind,
      p_recipient_lead_id: recipient.leadId,
      p_recipient_responsible_id: recipient.responsibleId,
      p_destination_phone: recipient.candidatePhone,
      p_operation_key: identity.operationKey,
      p_request_fingerprint: identity.requestFingerprint,
    },
  );

  if (rpc.error) {
    const code = rpc.error.message;

    if (
      rpc.error.code === "P0001" &&
      typeof code === "string" &&
      /^HUMAN_QUOTE_SEND_[A-Z0-9_]{1,100}$/.test(code)
    ) {
      return fail(409, code);
    }

    return fail(503, "HUMAN_QUOTE_SEND_REGISTRATION_FAILED");
  }

  const row = rpc.data;

  if (
    !row ||
    typeof row !== "object" ||
    Array.isArray(row) ||
    (
      row.outcome !== "registered" &&
      row.outcome !== "existing_operation"
    ) ||
    row.operation_id !== request.operationId ||
    row.operation_key !== identity.operationKey ||
    row.quote_id !== quoteId ||
    row.quote_version_id !== request.quoteVersionId ||
    row.recipient_kind !== recipient.kind ||
    !OPERATION_STATES.includes(row.status) ||
    (
      row.outcome === "registered" &&
      row.status !== "registered"
    ) ||
    (
      row.status_reason !== null &&
      (
        typeof row.status_reason !== "string" ||
        !/^[A-Za-z0-9_:-]{1,160}$/.test(row.status_reason)
      )
    ) ||
    typeof row.created_at !== "string" ||
    !Number.isFinite(Date.parse(row.created_at))
  ) {
    return fail(503, "HUMAN_QUOTE_SEND_REGISTRATION_RESPONSE_INVALID");
  }

  // Return a minimal status projection.
  // Do not expose destination, storage path or attempt token.
  const registration: HumanQuoteSendRegistrationResult = {
    outcome: row.outcome,
    operationId: row.operation_id,
    quoteId: row.quote_id,
    quoteVersionId: row.quote_version_id,
    recipientKind: row.recipient_kind,
    status: row.status,
    statusReason: row.status_reason,
    createdAt: row.created_at,
  };

  return {
    replayOnly: false as const,
    registration,
    supabase: scope.supabase,
    scope: {
      organizationId,
      storeId,
      actorUserId,
      quoteId,
    },
    request,
    recipient,
    pdf,
    pdfInput,
    quote,
    version,
  };
}

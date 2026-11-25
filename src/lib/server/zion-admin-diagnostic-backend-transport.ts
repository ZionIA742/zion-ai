import type {
  BackendDiagnosticEvent,
} from "./zion-admin-diagnostic-backend-classifier";

import type {
  BackendTechnicalEvidence,
} from "./zion-admin-diagnostic-backend-evidence";

import {
  createBackendDiagnosticIdentity,
  type BackendDiagnosticScope,
} from "./zion-admin-diagnostic-backend-identity";

export const BACKEND_DIAGNOSTIC_WRITER =
  "register_zion_admin_backend_failure_by_system";

export type BackendWriterArguments = Readonly<{
  p_event_id: string;
  p_incident_key: string;
  p_scope: BackendDiagnosticScope["scope"];
  p_organization_id: string | null;
  p_store_id: string | null;
  p_route: string;
  p_method: string;
  p_kind: BackendDiagnosticEvent["kind"];
  p_http_status: number | null;
  p_occurred_at: string;
  p_evidence: BackendTechnicalEvidence;
}>;

export type BackendDiagnosticRpc = (
  args: BackendWriterArguments,
  signal: AbortSignal,
) => PromiseLike<unknown>;

export type BackendTransportResult =
  | Readonly<{
      status: "registered";
      incidentId: string;
      occurrenceId: string;
      eventId: string;
      newIncident: boolean;
      newOccurrence: boolean;
    }>
  | Readonly<{
      status: "unconfirmed";
      reason:
        | "timeout"
        | "rpc_error"
        | "transport_error"
        | "invalid_response";
    }>
  | Readonly<{
      status: "not_attempted";
      reason: "invalid_timeout";
    }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_TIMEOUT_MS = 2000;
const MAX_TIMEOUT_MS = 20000;

// Accept only outputs of trusted internal classification
// and evidence extraction. Never accept request bodies here.
//
// Create the registration envelope once per observed event.
// All subsequent attempts must reuse the same envelope.

export function prepareBackendWriterArguments(
  event: BackendDiagnosticEvent,
  evidence: BackendTechnicalEvidence,
  trustedScope: BackendDiagnosticScope,
): BackendWriterArguments {
  const identity = createBackendDiagnosticIdentity(
    event,
    evidence,
    trustedScope,
  );

  const frames = Object.freeze(
    evidence.frames.map(frame =>
      Object.freeze({
        sourceFile: frame.sourceFile,
        line: frame.line,
        column: frame.column,
      }),
    ),
  );

  const safeEvidence: BackendTechnicalEvidence =
    Object.freeze({
      schemaVersion: 1,
      errorName: evidence.errorName,
      reportedErrorCode: evidence.reportedErrorCode,
      sanitizedMessage: evidence.sanitizedMessage,
      frames,
      rawMessageStored: false,
      rawStackStored: false,
    });

  return Object.freeze({
    p_event_id: identity.eventId,
    p_incident_key: identity.incidentKey,
    p_scope: identity.scope.scope,
    p_organization_id:
      identity.scope.organizationId,
    p_store_id:
      identity.scope.storeId,
    p_route: event.route,
    p_method: event.method,
    p_kind: event.kind,
    p_http_status: event.httpStatus,
    p_occurred_at: new Date().toISOString(),
    p_evidence: safeEvidence,
  });
}

function asRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseRpcResponse(
  value: unknown,
  eventId: string,
): BackendTransportResult {
  const response = asRecord(value);

  if (!response) {
    return {
      status: "unconfirmed",
      reason: "invalid_response",
    };
  }

  if (response.error !== null) {
    return {
      status: "unconfirmed",
      reason: response.error === undefined
        ? "invalid_response"
        : "rpc_error",
    };
  }

  const data = asRecord(response.data);

  if (
    !data ||
    data.source_system !== "backend_api" ||
    data.event_id !== eventId ||
    typeof data.incident_id !== "string" ||
    !UUID_PATTERN.test(data.incident_id) ||
    typeof data.occurrence_id !== "string" ||
    !UUID_PATTERN.test(data.occurrence_id) ||
    typeof data.new_incident !== "boolean" ||
    typeof data.new_occurrence !== "boolean" ||
    (
      data.new_incident === true &&
      data.new_occurrence === false
    )
  ) {
    return {
      status: "unconfirmed",
      reason: "invalid_response",
    };
  }

  return {
    status: "registered",
    incidentId: data.incident_id,
    occurrenceId: data.occurrence_id,
    eventId,
    newIncident: data.new_incident,
    newOccurrence: data.new_occurrence,
  };
}

// A timeout does not prove the database rolled back.
// The server may have committed before the reply was lost.
//
// No automatic retries here. A later retry must reuse
// the original event ID, timestamp and evidence.

export async function sendBackendDiagnostic(
  args: BackendWriterArguments,
  rpc: BackendDiagnosticRpc,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<BackendTransportResult> {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    return {
      status: "not_attempted",
      reason: "invalid_timeout",
    };
  }

  const controller = new AbortController();

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<BackendTransportResult>(
      resolve => {
        timer = setTimeout(() => {
          resolve({
            status: "unconfirmed",
            reason: "timeout",
          });

          controller.abort();
        }, timeoutMs);
      },
    );

    const request = Promise.resolve()
      .then(() =>
        rpc(args, controller.signal),
      )
      .then(response =>
        parseRpcResponse(
          response,
          args.p_event_id,
        ),
      )
      .catch(
        (): BackendTransportResult => ({
          status: "unconfirmed",
          reason: "transport_error",
        }),
      );

    return await Promise.race([
      request,
      timeout,
    ]);
  } catch {
    return {
      status: "unconfirmed",
      reason: "transport_error",
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
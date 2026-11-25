import { createHash, randomUUID } from "node:crypto";

import type {
  BackendDiagnosticEvent,
} from "./zion-admin-diagnostic-backend-classifier";

import type {
  BackendTechnicalEvidence,
} from "./zion-admin-diagnostic-backend-evidence";

export type BackendDiagnosticScope =
  | Readonly<{
      scope: "system";
      organizationId: null;
      storeId: null;
    }>
  | Readonly<{
      scope: "organization";
      organizationId: string;
      storeId: null;
    }>
  | Readonly<{
      scope: "store";
      organizationId: string;
      storeId: string;
    }>;

export type BackendDiagnosticIdentity = Readonly<{
  schemaVersion: 1;
  incidentKey: string;
  occurrenceKey: string;
  eventId: string;
  scope: BackendDiagnosticScope;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canonicalUuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !UUID_PATTERN.test(value)
  ) {
    throw new Error(
      "BACKEND_DIAGNOSTIC_INVALID_SCOPE",
    );
  }

  return value.toLowerCase();
}

// Scope must be supplied by a trusted server adapter.
// UUID validation alone does not prove tenant ownership.
// The database writer must validate the actual relationship.

function normalizeScope(
  value: BackendDiagnosticScope,
): BackendDiagnosticScope {
  if (!value || typeof value !== "object") {
    throw new Error(
      "BACKEND_DIAGNOSTIC_INVALID_SCOPE",
    );
  }

  switch (value.scope) {
    case "system":
      if (
        value.organizationId === null &&
        value.storeId === null
      ) {
        return {
          scope: "system",
          organizationId: null,
          storeId: null,
        };
      }
      break;

    case "organization":
      if (value.storeId === null) {
        return {
          scope: "organization",
          organizationId: canonicalUuid(
            value.organizationId,
          ),
          storeId: null,
        };
      }
      break;

    case "store":
      return {
        scope: "store",
        organizationId: canonicalUuid(
          value.organizationId,
        ),
        storeId: canonicalUuid(value.storeId),
      };
  }

  throw new Error(
    "BACKEND_DIAGNOSTIC_INVALID_SCOPE",
  );
}

// The fingerprint is a grouping heuristic, not proof
// that different occurrences share an identical root cause.
//
// Inputs must already have passed classification
// and technical evidence extraction.

export function buildBackendIncidentKey(
  event: BackendDiagnosticEvent,
  evidence: BackendTechnicalEvidence,
  trustedScope: BackendDiagnosticScope,
): string {
  const scope = normalizeScope(trustedScope);

  const firstFrame = evidence.frames[0] ?? null;

  const fingerprintInput = [
    "zion-backend-fingerprint-v1",
    scope.scope,
    scope.organizationId,
    scope.storeId,
    event.sourceSystem,
    event.route,
    event.method,
    event.kind,
    event.httpStatus,
    event.errorCode,
    evidence.errorName,
    evidence.reportedErrorCode,
    firstFrame?.sourceFile ?? null,
    firstFrame?.line ?? null,
  ];

  const digest = createHash("sha256")
    .update(JSON.stringify(fingerprintInput), "utf8")
    .digest("hex");

  return "zion-b2:backend:v1:" + digest;
}

// Generate exactly once for each observed failure.
// Transport retries must reuse the returned identity;
// they must not call this function again.

export function createBackendDiagnosticIdentity(
  event: BackendDiagnosticEvent,
  evidence: BackendTechnicalEvidence,
  trustedScope: BackendDiagnosticScope,
): BackendDiagnosticIdentity {
  const scope = normalizeScope(trustedScope);

  const incidentKey = buildBackendIncidentKey(
    event,
    evidence,
    scope,
  );

  const eventId = randomUUID();

  return {
    schemaVersion: 1,
    incidentKey,
    occurrenceKey:
      "zion-b2:backend-event:" + eventId,
    eventId,
    scope,
  };
}
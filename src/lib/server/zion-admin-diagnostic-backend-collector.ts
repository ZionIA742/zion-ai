import "server-only";

import {
  classifyBackendDiagnostic,
  type BackendDiagnosticInput,
  type BackendDiagnosticDecision,
} from "./zion-admin-diagnostic-backend-classifier";

import {
  extractBackendTechnicalEvidence,
} from "./zion-admin-diagnostic-backend-evidence";

import type {
  BackendDiagnosticScope,
} from "./zion-admin-diagnostic-backend-identity";

import {
  prepareBackendWriterArguments,
  sendBackendDiagnostic,
  type BackendWriterArguments,
  type BackendDiagnosticRpc,
  type BackendTransportResult,
} from "./zion-admin-diagnostic-backend-transport";

import {
  createBackendDiagnosticRpc,
} from "./zion-admin-diagnostic-backend-supabase";

type IgnoreReason = Extract<
  BackendDiagnosticDecision,
  { disposition: "ignore" }
>["reason"];

type HealthReason =
  | "diagnostic_component_failure"
  | "preparation_error"
  | "rpc_unavailable"
  | "timeout"
  | "rpc_error"
  | "transport_error"
  | "invalid_response"
  | "invalid_timeout";

export type BackendDiagnosticHealth = Readonly<{
  component: "backend_diagnostic_collector";
  reason: HealthReason;
  eventId: string | null;
}>;

export type BackendCapturePreparation =
  | Readonly<{
      status: "ready";
      args: BackendWriterArguments;
    }>
  | Readonly<{
      status: "disabled";
    }>
  | Readonly<{
      status: "ignored";
      reason: IgnoreReason;
    }>
  | Readonly<{
      status: "diagnostic_health";
      reason: "diagnostic_component_failure";
    }>
  | Readonly<{
      status: "not_attempted";
      reason: "preparation_error";
    }>;

export type BackendCaptureResult =
  | Exclude<
      BackendCapturePreparation,
      { status: "ready" }
    >
  | (
      BackendTransportResult &
      Readonly<{ eventId: string }>
    )
  | Readonly<{
      status: "not_attempted";
      reason: "rpc_unavailable";
      eventId: string;
    }>;

export type BackendCollectorOptions = Readonly<{
  enabled: boolean;
  knownRoutes: ReadonlySet<string>;
  knownSourceFiles: ReadonlySet<string>;
  createRpc?: () => BackendDiagnosticRpc;
  reportHealth?: (
    health: BackendDiagnosticHealth,
  ) => unknown;
  timeoutMs?: number;
}>;

const SYSTEM_SCOPE: BackendDiagnosticScope =
  Object.freeze({
    scope: "system",
    organizationId: null,
    storeId: null,
  });

export function createBackendDiagnosticCollector(
  options: BackendCollectorOptions,
) {
  const enabled = options.enabled === true;

  const knownRoutes =
    new Set(options.knownRoutes);

  const knownSourceFiles =
    new Set(options.knownSourceFiles);

  const createRpc =
    options.createRpc ?? createBackendDiagnosticRpc;

  const reporter =
    options.reportHealth ??
    ((health: BackendDiagnosticHealth) => {
      console.warn(
        "ZION_BACKEND_DIAGNOSTIC_HEALTH",
        health,
      );
    });

  // Never send diagnostic subsystem failures back
  // through the same diagnostic writer.
  function notify(
    reason: HealthReason,
    eventId: string | null = null,
  ): void {
    const health: BackendDiagnosticHealth = {
      component: "backend_diagnostic_collector",
      reason,
      eventId,
    };

    try {
      // A custom reporter must not delay the operation.
      void Promise.resolve(
        reporter(health),
      ).catch(() => {});
    } catch {
      // Reporter failures must not propagate.
    }
  }

  // Prepare synchronously, using trusted server context.
  // Do not retain the raw error or request.
  function prepare(
    input: BackendDiagnosticInput,
    error: unknown,
    trustedScope: BackendDiagnosticScope = SYSTEM_SCOPE,
  ): BackendCapturePreparation {
    if (!enabled) {
      return { status: "disabled" };
    }

    try {
      const decision =
        classifyBackendDiagnostic(
          input,
          knownRoutes,
        );

      if (decision.disposition === "ignore") {
        return {
          status: "ignored",
          reason: decision.reason,
        };
      }

      if (
        decision.disposition === "diagnostic_health"
      ) {
        notify(decision.reason);

        return {
          status: "diagnostic_health",
          reason: decision.reason,
        };
      }

      const evidence =
        extractBackendTechnicalEvidence(
          error,
          knownSourceFiles,
        );

      const args =
        prepareBackendWriterArguments(
          decision.event,
          evidence,
          trustedScope,
        );

      return Object.freeze({
        status: "ready",
        args,
      });
    } catch {
      notify("preparation_error");

      return {
        status: "not_attempted",
        reason: "preparation_error",
      };
    }
  }

  // Persist separately from preparation.
  // A framework adapter can schedule this after response.
  // Explicit retries must reuse the prepared object.
  async function persist(
    prepared: BackendCapturePreparation,
  ): Promise<BackendCaptureResult> {
    if (!enabled) {
      return { status: "disabled" };
    }

    if (prepared.status !== "ready") {
      return prepared;
    }

    const args = prepared.args;
    const eventId = args.p_event_id;

    let rpc: BackendDiagnosticRpc;

    try {
      rpc = createRpc();
    } catch {
      notify("rpc_unavailable", eventId);

      return {
        status: "not_attempted",
        reason: "rpc_unavailable",
        eventId,
      };
    }

    try {
      const result =
        await sendBackendDiagnostic(
          args,
          rpc,
          options.timeoutMs,
        );

      if (result.status !== "registered") {
        notify(result.reason, eventId);
      }

      return {
        ...result,
        eventId,
      };
    } catch {
      notify("transport_error", eventId);

      return {
        status: "unconfirmed",
        reason: "transport_error",
        eventId,
      };
    }
  }

  return Object.freeze({
    prepare,
    persist,
  });
}
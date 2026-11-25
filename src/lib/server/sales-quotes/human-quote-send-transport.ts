/**
 * Shared internal lifecycle for explicit human quote sends.
 *
 * The destination-specific backend must bind these callbacks
 * to the authorized, registered operation.
 *
 * begin() must perform the actual final transport policy checks
 * and acquire the durable attempt before any provider request.
 *
 * No HTTP route, direct provider integration or automatic retry.
 */

type OperationStatus =
  | "registered"
  | "blocked"
  | "attempt_started"
  | "accepted"
  | "failed"
  | "uncertain";

type ExistingStatus = Exclude<OperationStatus,"registered">;

type BeginResult =
  | {
      outcome: "attempt_created";
      attemptToken: string;
    }
  | {
      outcome: "existing_state";
      status: ExistingStatus;
    };

type ProviderResult =
  | {
      outcome: "accepted";
      externalMessageId: string;
    }
  | {
      outcome: "failed";
    }
  | {
      outcome: "uncertain";
    };

type FinishInput =
  | {
      action: "accept";
      attemptToken: string;
      externalMessageId: string;
    }
  | {
      action: "fail" | "uncertain";
      attemptToken: string;
      reason: string;
    };

type TransportDependencies = {
  begin: () => Promise<BeginResult>;
  send: () => Promise<ProviderResult>;
  finish: (
    input: FinishInput
  ) => Promise<{status:OperationStatus}>;
};

export type HumanQuoteTransportResult = {
  status: ExistingStatus | "unconfirmed";
  providerRequestAttempted: boolean;
};

function validToken(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    && value !== "00000000-0000-0000-0000-000000000000";
}

function validExternalId(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 512
    && !/[\s\x00-\x1f\x7f]/.test(value);
}

export async function executeHumanQuoteTransport(
  deps: TransportDependencies,
): Promise<HumanQuoteTransportResult> {

  let claim: BeginResult;

  try {
    claim = await deps.begin();
  } catch {
    return {
      status:"unconfirmed",
      providerRequestAttempted:false,
    };
  }

  if (claim?.outcome === "existing_state") {

    const status = claim.status;

    if (![
      "blocked",
      "attempt_started",
      "accepted",
      "failed",
      "uncertain",
    ].includes(status)) {
      return {
        status:"unconfirmed",
        providerRequestAttempted:false,
      };
    }

    return {
      status,
      providerRequestAttempted:false,
    };
  }

  if (
    claim?.outcome !== "attempt_created"
    || !validToken(claim.attemptToken)
  ) {
    return {
      status:"unconfirmed",
      providerRequestAttempted:false,
    };
  }

  const attemptToken = claim.attemptToken;

  let providerResult: ProviderResult;

  // Exactly one provider call.
  // A thrown error never authorizes a retry.
  try {
    providerResult = await deps.send();
  } catch {
    providerResult = {outcome:"uncertain"};
  }

  let finishInput: FinishInput;
  let expectedStatus: ExistingStatus;

  if (
    providerResult?.outcome === "accepted"
    && validExternalId(providerResult.externalMessageId)
  ) {

    finishInput = {
      action:"accept",
      attemptToken,
      externalMessageId:providerResult.externalMessageId,
    };

    expectedStatus = "accepted";

  } else if (providerResult?.outcome === "failed") {

    // Only adapters with definitive rejection evidence may
    // classify a provider result as failed.
    finishInput = {
      action:"fail",
      attemptToken,
      reason:"PROVIDER_REJECTED",
    };

    expectedStatus = "failed";

  } else {

    finishInput = {
      action:"uncertain",
      attemptToken,
      reason:"PROVIDER_RESULT_UNCERTAIN",
    };

    expectedStatus = "uncertain";
  }

  try {

    const final = await deps.finish(finishInput);

    if (final?.status !== expectedStatus) {
      return {
        status:"unconfirmed",
        providerRequestAttempted:true,
      };
    }

    return {
      status:expectedStatus,
      providerRequestAttempted:true,
    };

  } catch {

    // Provider acceptance may have happened even if the
    // database response was lost. Never send again.
    return {
      status:"unconfirmed",
      providerRequestAttempted:true,
    };

  }
}

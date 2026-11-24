import { createClient } from "@supabase/supabase-js";

export const DIAGNOSTIC_OPERATIONAL_BATCH_LIMIT = 20;
const MAX_BATCH_LIMIT = 25;
const SOURCE_SYSTEM = "operational_failure_events";

export type DiagnosticOperationalRpcName =
  | "discover_zion_admin_operational_capture_attempts_by_system"
  | "process_zion_admin_operational_capture_attempts_by_system";

export type DiagnosticOperationalRpc = (
  name: DiagnosticOperationalRpcName,
  args: { p_batch_limit: number },
) => Promise<{ data: unknown; error: unknown }>;

export type DiagnosticOperationalCronDependencies = {
  rpc?: DiagnosticOperationalRpc;
  batchLimit?: number;
};

export type DiagnosticOperationalCronResult = {
  status: "inactive" | "processed";
  batchLimit: number;
  discovered: number;
  selected: number;
  registered: number;
  retryScheduled: number;
  needsReview: number;
  noLongerEligible: number;
};

export type DiagnosticOperationalCronErrorCode =
  | "INVALID_BATCH_LIMIT"
  | "SUPABASE_CONFIGURATION_UNAVAILABLE"
  | "DISCOVERY_RPC_FAILED"
  | "DISCOVERY_RESULT_INVALID"
  | "PROCESSOR_RPC_FAILED"
  | "PROCESSOR_RESULT_INVALID";

export class DiagnosticOperationalCronError extends Error {
  constructor(
    public readonly code: DiagnosticOperationalCronErrorCode,
  ) {
    super(code);
    this.name = "DiagnosticOperationalCronError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function readCount(
  result: Record<string, unknown>,
  key: string,
  limit: number,
  errorCode: DiagnosticOperationalCronErrorCode,
): number {
  const value = result[key];

  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > limit
  ) {
    throw new DiagnosticOperationalCronError(errorCode);
  }

  return value;
}

function validateEnvelope(
  data: unknown,
  batchLimit: number,
  expectedStatus: string,
  errorCode: DiagnosticOperationalCronErrorCode,
): Record<string, unknown> {
  if (
    !isRecord(data) ||
    data.source_system !== SOURCE_SYSTEM ||
    data.batch_limit !== batchLimit ||
    data.status !== expectedStatus
  ) {
    throw new DiagnosticOperationalCronError(errorCode);
  }

  return data;
}

function createDefaultRpc(): DiagnosticOperationalRpc {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new DiagnosticOperationalCronError(
      "SUPABASE_CONFIGURATION_UNAVAILABLE",
    );
  }

  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return async (name, args) => {
    const response = await client.rpc(name, args);

    return {
      data: response.data,
      error: response.error,
    };
  };
}

/**
 * Executor independente de diagnosticos operacionais.
 *
 * - Nao ativa captura nem altera as filas originais.
 * - Nao chama Meta, OpenAI ou IAs comerciais.
 * - Executa descoberta e depois processamento.
 * - Nao processa quando a descoberta informa inatividade.
 * - Um lote por operacao, com limite maximo de 25.
 * - Falhas sao codigos controlados, sem mensagens brutas.
 *
 * A rota HTTP deve autenticar e verificar sua propria flag.
 */
export async function runDiagnosticOperationalCaptureCron(
  dependencies: DiagnosticOperationalCronDependencies = {},
): Promise<DiagnosticOperationalCronResult> {
  const batchLimit =
    dependencies.batchLimit ?? DIAGNOSTIC_OPERATIONAL_BATCH_LIMIT;

  if (
    !Number.isSafeInteger(batchLimit) ||
    batchLimit < 1 ||
    batchLimit > MAX_BATCH_LIMIT
  ) {
    throw new DiagnosticOperationalCronError("INVALID_BATCH_LIMIT");
  }

  const rpc = dependencies.rpc ?? createDefaultRpc();

  let discoveryResponse: Awaited<ReturnType<DiagnosticOperationalRpc>>;

  try {
    discoveryResponse = await rpc(
      "discover_zion_admin_operational_capture_attempts_by_system",
      { p_batch_limit: batchLimit },
    );
  } catch {
    throw new DiagnosticOperationalCronError("DISCOVERY_RPC_FAILED");
  }

  if (discoveryResponse?.error) {
    throw new DiagnosticOperationalCronError("DISCOVERY_RPC_FAILED");
  }

  if (!isRecord(discoveryResponse?.data)) {
    throw new DiagnosticOperationalCronError("DISCOVERY_RESULT_INVALID");
  }

  const discoveryStatus = discoveryResponse.data.status;

  if (
    discoveryStatus !== "inactive" &&
    discoveryStatus !== "active"
  ) {
    throw new DiagnosticOperationalCronError("DISCOVERY_RESULT_INVALID");
  }

  const discovery = validateEnvelope(
    discoveryResponse.data,
    batchLimit,
    discoveryStatus,
    "DISCOVERY_RESULT_INVALID",
  );

  const discovered = readCount(
    discovery,
    "discovered",
    batchLimit,
    "DISCOVERY_RESULT_INVALID",
  );

  if (discoveryStatus === "inactive") {
    if (discovered !== 0) {
      throw new DiagnosticOperationalCronError(
        "DISCOVERY_RESULT_INVALID",
      );
    }

    return {
      status: "inactive",
      batchLimit,
      discovered: 0,
      selected: 0,
      registered: 0,
      retryScheduled: 0,
      needsReview: 0,
      noLongerEligible: 0,
    };
  }

  let processorResponse: Awaited<ReturnType<DiagnosticOperationalRpc>>;

  try {
    processorResponse = await rpc(
      "process_zion_admin_operational_capture_attempts_by_system",
      { p_batch_limit: batchLimit },
    );
  } catch {
    throw new DiagnosticOperationalCronError("PROCESSOR_RPC_FAILED");
  }

  if (processorResponse?.error) {
    throw new DiagnosticOperationalCronError("PROCESSOR_RPC_FAILED");
  }

  const processed = validateEnvelope(
    processorResponse?.data,
    batchLimit,
    "processed",
    "PROCESSOR_RESULT_INVALID",
  );

  const selected = readCount(
    processed,
    "selected",
    batchLimit,
    "PROCESSOR_RESULT_INVALID",
  );

  const registered = readCount(
    processed,
    "registered",
    batchLimit,
    "PROCESSOR_RESULT_INVALID",
  );

  const retryScheduled = readCount(
    processed,
    "retry_scheduled",
    batchLimit,
    "PROCESSOR_RESULT_INVALID",
  );

  const needsReview = readCount(
    processed,
    "needs_review",
    batchLimit,
    "PROCESSOR_RESULT_INVALID",
  );

  const noLongerEligible = readCount(
    processed,
    "no_longer_eligible",
    batchLimit,
    "PROCESSOR_RESULT_INVALID",
  );

  if (
    registered +
      retryScheduled +
      needsReview +
      noLongerEligible !==
    selected
  ) {
    throw new DiagnosticOperationalCronError(
      "PROCESSOR_RESULT_INVALID",
    );
  }

  return {
    status: "processed",
    batchLimit,
    discovered,
    selected,
    registered,
    retryScheduled,
    needsReview,
    noLongerEligible,
  };
}
import { createClient } from "@supabase/supabase-js";

export const DIAGNOSTIC_AI_RUN_BATCH_LIMIT = 20;
const MAX_BATCH_LIMIT = 25;

export type DiagnosticAiRunRpcName =
  | "discover_zion_admin_ai_run_capture_attempts_by_system"
  | "process_zion_admin_ai_run_capture_attempts_by_system";

export type DiagnosticAiRunRpc = (
  name: DiagnosticAiRunRpcName,
  args: { p_batch_limit: number },
) => Promise<{ data: unknown; error: unknown }>;

export type DiagnosticAiRunCronResult = {
  status: "inactive" | "processed";
  batchLimit: number;
  discovered: number;
  selected: number;
  registered: number;
  retryScheduled: number;
  needsReview: number;
  noLongerEligible: number;
};

export type DiagnosticAiRunCronDependencies = {
  rpc?: DiagnosticAiRunRpc;
  batchLimit?: number;
};

export type DiagnosticAiRunCronErrorCode =
  | "INVALID_BATCH_LIMIT"
  | "SUPABASE_CONFIGURATION_UNAVAILABLE"
  | "DISCOVERY_RPC_FAILED"
  | "DISCOVERY_RESULT_INVALID"
  | "PROCESSOR_RPC_FAILED"
  | "PROCESSOR_RESULT_INVALID";

export class DiagnosticAiRunCronError extends Error {
  constructor(public readonly code: DiagnosticAiRunCronErrorCode) {
    super(code);
    this.name = "DiagnosticAiRunCronError";
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
  errorCode: DiagnosticAiRunCronErrorCode,
): number {
  const value = result[key];

  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > limit
  ) {
    throw new DiagnosticAiRunCronError(errorCode);
  }

  return value;
}

function validateEnvelope(
  data: unknown,
  batchLimit: number,
  errorCode: DiagnosticAiRunCronErrorCode,
): Record<string, unknown> {
  if (
    !isRecord(data) ||
    data.source_system !== "ai_runs" ||
    data.batch_limit !== batchLimit
  ) {
    throw new DiagnosticAiRunCronError(errorCode);
  }

  return data;
}

function createDefaultRpc(): DiagnosticAiRunRpc {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new DiagnosticAiRunCronError(
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
 * Executor administrativo independente.
 *
 * - Nunca chama a funcao de ativacao.
 * - Nunca e chamado diretamente pelas IAs comerciais.
 * - Nao armazena erros brutos, mensagens ou stacks.
 * - Se a captura estiver inativa, nao chama o processador.
 * - Executa no maximo um lote por RPC a cada invocacao.
 * - Falhas nao sao convertidas em falso sucesso.
 *
 * A rota HTTP aplicara autenticacao e seu proprio
 * controle de habilitacao antes de chamar este executor.
 */
export async function runDiagnosticAiRunCaptureCron(
  dependencies: DiagnosticAiRunCronDependencies = {},
): Promise<DiagnosticAiRunCronResult> {
  const batchLimit =
    dependencies.batchLimit ?? DIAGNOSTIC_AI_RUN_BATCH_LIMIT;

  if (
    !Number.isSafeInteger(batchLimit) ||
    batchLimit < 1 ||
    batchLimit > MAX_BATCH_LIMIT
  ) {
    throw new DiagnosticAiRunCronError("INVALID_BATCH_LIMIT");
  }

  const rpc = dependencies.rpc ?? createDefaultRpc();

  let discoveryResponse: Awaited<ReturnType<DiagnosticAiRunRpc>>;

  try {
    discoveryResponse = await rpc(
      "discover_zion_admin_ai_run_capture_attempts_by_system",
      { p_batch_limit: batchLimit },
    );
  } catch {
    throw new DiagnosticAiRunCronError("DISCOVERY_RPC_FAILED");
  }

  if (discoveryResponse?.error) {
    throw new DiagnosticAiRunCronError("DISCOVERY_RPC_FAILED");
  }

  const discovery = validateEnvelope(
    discoveryResponse?.data,
    batchLimit,
    "DISCOVERY_RESULT_INVALID",
  );

  const discovered = readCount(
    discovery,
    "discovered",
    batchLimit,
    "DISCOVERY_RESULT_INVALID",
  );

  if (discovery.capture_active === false) {
    if (discovered !== 0) {
      throw new DiagnosticAiRunCronError(
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

  if (discovery.capture_active !== true) {
    throw new DiagnosticAiRunCronError(
      "DISCOVERY_RESULT_INVALID",
    );
  }

  let processorResponse: Awaited<ReturnType<DiagnosticAiRunRpc>>;

  try {
    processorResponse = await rpc(
      "process_zion_admin_ai_run_capture_attempts_by_system",
      { p_batch_limit: batchLimit },
    );
  } catch {
    throw new DiagnosticAiRunCronError("PROCESSOR_RPC_FAILED");
  }

  if (processorResponse?.error) {
    throw new DiagnosticAiRunCronError("PROCESSOR_RPC_FAILED");
  }

  const processed = validateEnvelope(
    processorResponse?.data,
    batchLimit,
    "PROCESSOR_RESULT_INVALID",
  );

  const selected = readCount(
    processed, "selected", batchLimit, "PROCESSOR_RESULT_INVALID",
  );

  const registered = readCount(
    processed, "registered", batchLimit, "PROCESSOR_RESULT_INVALID",
  );

  const retryScheduled = readCount(
    processed, "retry_scheduled", batchLimit, "PROCESSOR_RESULT_INVALID",
  );

  const needsReview = readCount(
    processed, "needs_review", batchLimit, "PROCESSOR_RESULT_INVALID",
  );

  const noLongerEligible = readCount(
    processed, "no_longer_eligible", batchLimit,
    "PROCESSOR_RESULT_INVALID",
  );

  if (
    registered +
    retryScheduled +
    needsReview +
    noLongerEligible !== selected
  ) {
    throw new DiagnosticAiRunCronError(
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
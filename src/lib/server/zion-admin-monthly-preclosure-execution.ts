/**
 * ZION-ADM / 8-E.5
 *
 * Integra leitor, preparador e writer do pre-fechamento.
 *
 * Nao cria endpoint ou cron.
 * Nao consulta diretamente fornecedores externos.
 * Nao realiza fechamento financeiro definitivo.
 * Somente o RPC protegido pode registrar o snapshot.
 */

import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";
import { readMonthlyPreclosureSources } from "@/lib/server/zion-admin-monthly-preclosure-source-reader";
import { prepareMonthlyPreclosureSnapshot } from "@/lib/server/zion-admin-monthly-preclosure-preparation";

type RegisterInput = {
  month: string;
  sourceSnapshot: Record<string, unknown>;
  pendingSources: string[];
  reason: string;
};

type RegisterResponse = {
  data: unknown;
  error: unknown;
};

type ExecutionDependencies = {
  now: () => Date;
  readSources: typeof readMonthlyPreclosureSources;
  register: (input: RegisterInput) => Promise<RegisterResponse>;
};

export type MonthlyPreclosureExecutionResult = {
  status:
    | "created"
    | "revised"
    | "unchanged"
    | "skipped"
    | "needs_review";
  month: string | null;
  revision?: number;
  reason?: "not_due" | "invalid_clock" | "source_failure" |
    "writer_failure" | "invalid_writer_response";
};

function saoPauloClock(now: Date) {
  // Date pode vir de outro contexto JavaScript nos testes.
  // getTime.call valida o objeto sem depender de instanceof.
  let timestamp: number;

  try {
    timestamp = Date.prototype.getTime.call(now);
  } catch {
    throw new Error("INVALID_PRECLOSURE_CLOCK");
  }

  if (!Number.isFinite(timestamp)) {
    throw new Error("INVALID_PRECLOSURE_CLOCK");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const fields = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  const year = Number(fields.year);
  const monthNumber = Number(fields.month);
  const day = Number(fields.day);
  const hour = Number(fields.hour);

  if (
    !Number.isInteger(year) ||
    year < 2020 ||
    year > 2100 ||
    !Number.isInteger(monthNumber) ||
    monthNumber < 1 ||
    monthNumber > 12 ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23
  ) {
    throw new Error("INVALID_PRECLOSURE_CLOCK");
  }

  const lastDay = new Date(
    Date.UTC(year, monthNumber, 0),
  ).getUTCDate();

  if (day < 1 || day > lastDay) {
    throw new Error("INVALID_PRECLOSURE_CLOCK");
  }

  return {
    month: `${year}-${String(monthNumber).padStart(2, "0")}-01`,
    isDue: day === lastDay && hour >= 20,
  };
}

async function registerInDatabase(
  input: RegisterInput,
): Promise<RegisterResponse> {
  const db = createServiceSupabaseClient();

  const result = await db.rpc(
    "zion_admin_register_monthly_preclosure_by_system",
    {
      p_month: input.month,
      p_source_snapshot: input.sourceSnapshot,
      p_pending_sources: input.pendingSources,
      p_reason: input.reason,
    },
  );

  return {
    data: result.data,
    error: result.error,
  };
}

export function createMonthlyPreclosureExecutionRunner(
  overrides: Partial<ExecutionDependencies> = {},
) {
  const now = overrides.now ?? (() => new Date());
  const readSources =
    overrides.readSources ?? readMonthlyPreclosureSources;
  const register =
    overrides.register ?? registerInDatabase;

  return async function runMonthlyPreclosure():
    Promise<MonthlyPreclosureExecutionResult> {
    let clock: ReturnType<typeof saoPauloClock>;

    try {
      clock = saoPauloClock(now());
    } catch {
      return {
        status: "needs_review",
        month: null,
        reason: "invalid_clock",
      };
    }

    // Nunca ler ou gravar antes da janela autorizada.
    // O RPC SQL valida novamente o horario no banco.
    if (!clock.isDue) {
      return {
        status: "skipped",
        month: clock.month,
        reason: "not_due",
      };
    }

    let prepared: ReturnType<
      typeof prepareMonthlyPreclosureSnapshot
    >;

    try {
      const sources = await readSources(clock.month);
      prepared = prepareMonthlyPreclosureSnapshot(
        clock.month,
        sources,
      );
    } catch {
      return {
        status: "needs_review",
        month: clock.month,
        reason: "source_failure",
      };
    }

    // Registro sempre preliminar, mesmo com fontes completas.
    // Meta ainda e obrigatoriamente pendente.
    if (
      prepared.readyForFinalClose !== false ||
      !prepared.pendingSources.includes("meta_invoice")
    ) {
      return {
        status: "needs_review",
        month: clock.month,
        reason: "source_failure",
      };
    }

    let result: RegisterResponse;

    try {
      result = await register({
        month: clock.month,
        sourceSnapshot: prepared.sourceSnapshot,
        pendingSources: prepared.pendingSources,
        reason: "automatic_month_end_preclosure",
      });
    } catch {
      return {
        status: "needs_review",
        month: clock.month,
        reason: "writer_failure",
      };
    }

    if (result.error) {
      return {
        status: "needs_review",
        month: clock.month,
        reason: "writer_failure",
      };
    }

    const data = result.data;

    if (
      !data ||
      typeof data !== "object" ||
      !("ok" in data) ||
      data.ok !== true ||
      !("status" in data) ||
      (data.status !== "created" &&
        data.status !== "revised" &&
        data.status !== "unchanged") ||
      !("month" in data) ||
      data.month !== clock.month ||
      !("revision" in data) ||
      typeof data.revision !== "number" ||
      !Number.isSafeInteger(data.revision) ||
      data.revision < 1
    ) {
      return {
        status: "needs_review",
        month: clock.month,
        reason: "invalid_writer_response",
      };
    }

    return {
      status: data.status,
      month: clock.month,
      revision: data.revision,
    };
  };
}

// Uso futuro apenas pelo acionamento financeiro autorizado.
// Esta exportacao NAO executa o pre-fechamento por si so.
export const runMonthlyPreclosureBySystem =
  createMonthlyPreclosureExecutionRunner();
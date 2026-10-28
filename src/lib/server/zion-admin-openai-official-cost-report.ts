type QueryResult<T> = { data: T[] | null; error: unknown };

type QueryBuilder<T> = {
  lt(column: string, value: string): QueryBuilder<T>;
  gt(column: string, value: string): QueryBuilder<T>;
  order(column: string, options: { ascending: boolean }): QueryBuilder<T>;
  range(from: number, to: number): PromiseLike<QueryResult<T>>;
};

export type OfficialCostClient = {
  from<T>(table: string): { select(columns: string): QueryBuilder<T> };
};

type OperationRow = {
  id: string;
  operation_key: string;
  provider: string;
  source: string;
  query_identity: string;
  period_start: string;
  period_end: string;
  state: string;
  snapshot_collection_id: string | null;
  supersedes_operation_id: string | null;
  confirmed_at: string | null;
};

type CollectionRow = {
  id: string;
  collection_key: string;
  provider: string;
  source: string;
  query_identity: string;
  period_start: string;
  period_end: string;
  provider_timezone: string;
  status: string;
  result_count: number;
  collected_at: string;
};

type LineRow = {
  id: string;
  collection_id: string;
  period_start: string;
  period_end: string;
  currency: string;
  amount_decimal_text: string;
};

export type OfficialCostDay = {
  date: string;
  status: "available" | "confirmed_empty" | "not_collected" | "unavailable";
  totalUsd: string | null;
  financialLineCount: number;
  operationIds: string[];
  snapshotIds: string[];
};

export type OfficialCostReport = {
  source: "openai_organization_costs";
  period: { from: string; to: string; timezone: "UTC" };
  totalUsd: string | null;
  totalFinancialLines: number;
  daily: OfficialCostDay[];
  collectedDays: string[];
  missingDays: string[];
  availability: "complete" | "partial" | "unavailable";
  completeness: "complete" | "partial" | "unavailable";
  metadata: {
    operationIds: string[];
    snapshotIds: string[];
    queryIdentities: string[];
    collectedAt: string[];
  };
};

export class OfficialCostReportError extends Error {
  constructor(readonly code: "SOURCE_UNAVAILABLE" | "INVALID_LEDGER") {
    super(code);
    this.name = "OfficialCostReportError";
  }
}

const PAGE_SIZE = 1000;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function addDecimal(a: string, b: string): string {
  if (!DECIMAL.test(a) || !DECIMAL.test(b)) {
    throw new OfficialCostReportError("INVALID_LEDGER");
  }
  const [aw, af = ""] = a.split(".");
  const [bw, bf = ""] = b.split(".");
  const scale = Math.max(af.length, bf.length);
  const ai = BigInt(`${aw}${af.padEnd(scale, "0")}`);
  const bi = BigInt(`${bw}${bf.padEnd(scale, "0")}`);
  const sum = (ai + bi).toString().padStart(scale + 1, "0");
  if (scale === 0) return sum;
  const whole = sum.slice(0, -scale) || "0";
  const fraction = sum.slice(-scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return isoDate(date);
}

function dates(from: string, to: string) {
  const result: string[] = [];
  for (let current = from; current <= to; current = nextDate(current)) {
    result.push(current);
  }
  return result;
}

function coversDay(start: string, end: string, day: string) {
  const dayStart = Date.parse(`${day}T00:00:00.000Z`);
  const dayEnd = Date.parse(`${nextDate(day)}T00:00:00.000Z`);
  const periodStart = Date.parse(start);
  const periodEnd = Date.parse(end);
  return Number.isFinite(periodStart) && Number.isFinite(periodEnd) &&
    periodStart <= dayStart && periodEnd >= dayEnd;
}

async function loadAll<T>(
  client: OfficialCostClient,
  table: string,
  columns: string,
  start: string,
  endExclusive: string,
) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await client.from<T>(table).select(columns)
      .lt("period_start", endExclusive)
      .gt("period_end", start)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (result.error || !Array.isArray(result.data)) {
      throw new OfficialCostReportError("SOURCE_UNAVAILABLE");
    }
    const page = result.data;
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function buildOfficialOpenAiCostReport(
  client: OfficialCostClient,
  from: string,
  to: string,
): Promise<OfficialCostReport> {
  const utcStart = `${from}T00:00:00.000Z`;
  const utcEndExclusive = `${nextDate(to)}T00:00:00.000Z`;

  const [operations, collections, lines] = await Promise.all([
    loadAll<OperationRow>(client, "zion_admin_openai_cost_collection_operations", "id,operation_key,provider,source,query_identity,period_start,period_end,state,snapshot_collection_id,supersedes_operation_id,confirmed_at", utcStart, utcEndExclusive),
    loadAll<CollectionRow>(client, "zion_admin_provider_cost_collections", "id,collection_key,provider,source,query_identity,period_start,period_end,provider_timezone,status,result_count,collected_at", utcStart, utcEndExclusive),
    loadAll<LineRow>(client, "zion_admin_provider_cost_lines", "id,collection_id,period_start,period_end,currency,amount_decimal_text", utcStart, utcEndExclusive),
  ]);

  const dayList = dates(from, to);
  const superseded = new Set(
    operations.filter((row) => row.state === "confirmed")
      .map((row) => row.supersedes_operation_id)
      .filter((value): value is string => Boolean(value)),
  );
  const collectionById = new Map(collections.map((row) => [row.id, row]));
  const linesByCollection = new Map<string, LineRow[]>();
  for (const line of lines) {
    const bucket = linesByCollection.get(line.collection_id) ?? [];
    bucket.push(line);
    linesByCollection.set(line.collection_id, bucket);
  }

  const daily: OfficialCostDay[] = dayList.map((date) => {
    const relevant = operations.filter((operation) =>
      operation.provider === "openai" &&
      operation.source === "openai_organization_costs" &&
      operation.state === "confirmed" &&
      operation.snapshot_collection_id &&
      !superseded.has(operation.id) &&
      coversDay(operation.period_start, operation.period_end, date),
    );
    const invalid = operations.some((operation) =>
      operation.provider === "openai" &&
      operation.source === "openai_organization_costs" &&
      operation.state !== "confirmed" &&
      operation.state !== "pending" &&
      coversDay(operation.period_start, operation.period_end, date),
    );
    const candidates = relevant.map((operation) => ({
      operation,
      collection: collectionById.get(operation.snapshot_collection_id as string),
    }));
    const valid = candidates.filter(({ operation, collection }) =>
      collection?.provider === "openai" &&
      collection.source === "openai_organization_costs" &&
      collection.query_identity === operation.query_identity &&
      collection.provider_timezone === "UTC" &&
      collection.id === operation.snapshot_collection_id &&
      Date.parse(collection.period_start) === Date.parse(operation.period_start) &&
      Date.parse(collection.period_end) === Date.parse(operation.period_end) &&
      Date.parse(operation.period_start) === Date.parse(`${date}T00:00:00.000Z`) &&
      Date.parse(operation.period_end) === Date.parse(`${nextDate(date)}T00:00:00.000Z`) &&
      (collection.status === "available" || collection.status === "confirmed_empty") &&
      coversDay(collection.period_start, collection.period_end, date),
    );
    if (invalid || valid.length !== candidates.length || valid.length > 1) {
      return { date, status: "unavailable", totalUsd: null, financialLineCount: 0, operationIds: [], snapshotIds: [] };
    }
    if (valid.length === 0) {
      return { date, status: "not_collected", totalUsd: null, financialLineCount: 0, operationIds: [], snapshotIds: [] };
    }
    const { operation, collection } = valid[0];
    const collectionLines = linesByCollection.get(collection!.id) ?? [];
    if (collection!.status === "confirmed_empty") {
      if (collection!.result_count !== 0 || collectionLines.length !== 0) {
        return { date, status: "unavailable", totalUsd: null, financialLineCount: 0, operationIds: [], snapshotIds: [] };
      }
      return { date, status: "confirmed_empty", totalUsd: "0", financialLineCount: 0, operationIds: [operation.id], snapshotIds: [collection!.id] };
    }
    if (
      collection!.result_count !== collectionLines.length ||
      collectionLines.length === 0 ||
      collectionLines.some((line) =>
        line.collection_id !== collection!.id ||
        Date.parse(line.period_start) !== Date.parse(collection!.period_start) ||
        Date.parse(line.period_end) !== Date.parse(collection!.period_end)
      )
    ) {
      return { date, status: "unavailable", totalUsd: null, financialLineCount: 0, operationIds: [], snapshotIds: [] };
    }
    try {
      let total = "0";
      for (const line of collectionLines) {
        if (line.currency !== "USD") throw new OfficialCostReportError("INVALID_LEDGER");
        total = addDecimal(total, line.amount_decimal_text);
      }
      return { date, status: "available", totalUsd: total, financialLineCount: collectionLines.length, operationIds: [operation.id], snapshotIds: [collection!.id] };
    } catch {
      return { date, status: "unavailable", totalUsd: null, financialLineCount: 0, operationIds: [], snapshotIds: [] };
    }
  });

  const unavailable = daily.some((day) => day.status === "unavailable");
  const missingDays = daily.filter((day) => day.status === "not_collected").map((day) => day.date);
  const collectedDays = daily.filter((day) => day.status !== "not_collected" && day.status !== "unavailable").map((day) => day.date);
  const complete = !unavailable && missingDays.length === 0;
  let totalUsd: string | null = null;
  if (complete) totalUsd = daily.reduce((sum, day) => addDecimal(sum, day.totalUsd ?? "0"), "0");
  const chosenOperationIds = [...new Set(daily.flatMap((day) => day.operationIds))];
  const chosenSnapshotIds = [...new Set(daily.flatMap((day) => day.snapshotIds))];
  const chosenOperations = operations.filter((row) => chosenOperationIds.includes(row.id));
  return {
    source: "openai_organization_costs",
    period: { from, to, timezone: "UTC" },
    totalUsd,
    totalFinancialLines: daily.reduce((sum, day) => sum + day.financialLineCount, 0),
    daily,
    collectedDays,
    missingDays,
    availability: unavailable ? "unavailable" : complete ? "complete" : "partial",
    completeness: unavailable ? "unavailable" : complete ? "complete" : "partial",
    metadata: {
      operationIds: chosenOperationIds,
      snapshotIds: chosenSnapshotIds,
      queryIdentities: [...new Set(chosenOperations.map((row) => row.query_identity))],
      collectedAt: [...new Set(chosenSnapshotIds.map((id) => collectionById.get(id)?.collected_at).filter((value): value is string => Boolean(value)))],
    },
  };
}

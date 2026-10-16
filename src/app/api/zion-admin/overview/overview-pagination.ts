export const OVERVIEW_LOAD_ERROR = "Falha tecnica ao carregar dados complementares do overview.";
export const OVERVIEW_MAX_PAGES = 1_000;
export const OVERVIEW_IN_CHUNK_SIZE = 100;

export type OverviewDataAvailability = "available" | "unavailable" | "partial";

export type OverviewLoadResult<T> = {
  rows: T[];
  error: string | null;
  availability: OverviewDataAvailability;
};

export function worstOverviewAvailability(
  ...values: OverviewDataAvailability[]
): OverviewDataAvailability {
  if (values.length > 0 && values.every((value) => value === "available")) {
    return "available";
  }
  if (values.length > 0 && values.every((value) => value === "unavailable")) {
    return "unavailable";
  }
  return "partial";
}

type OverviewPageResult<T> = {
  data: T[] | null;
  error: unknown | null;
};

export async function loadAllOverviewRows<T>(
  loadPage: (
    from: number,
    to: number,
  ) => PromiseLike<OverviewPageResult<T>> | OverviewPageResult<T>,
  pageSize = 500,
): Promise<OverviewLoadResult<T>> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return { rows: [], error: OVERVIEW_LOAD_ERROR, availability: "unavailable" };
  }

  const rows: T[] = [];

  for (let page = 0; page < OVERVIEW_MAX_PAGES; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await loadPage(from, to);

    if (error) {
      return {
        rows: [],
        error: OVERVIEW_LOAD_ERROR,
        availability: page === 0 ? "unavailable" : "partial",
      };
    }

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      return { rows, error: null, availability: "available" };
    }
  }

  return {
    rows: [],
    error: OVERVIEW_LOAD_ERROR,
    availability: rows.length > 0 ? "partial" : "unavailable",
  };
}

export async function loadAllOverviewRowsByChunks<T>(args: {
  values: readonly string[];
  loadPage: (values: readonly string[], from: number, to: number) =>
    | PromiseLike<OverviewPageResult<T>>
    | OverviewPageResult<T>;
  chunkSize?: number;
}): Promise<OverviewLoadResult<T>> {
  const chunkSize = args.chunkSize ?? OVERVIEW_IN_CHUNK_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    return { rows: [], error: OVERVIEW_LOAD_ERROR, availability: "unavailable" };
  }

  const values = Array.from(new Set(args.values.filter((value) => Boolean(value))));
  const rows: T[] = [];

  for (let start = 0; start < values.length; start += chunkSize) {
    const result = await loadAllOverviewRows<T>((from, to) =>
      args.loadPage(values.slice(start, start + chunkSize), from, to),
    );

    if (result.error) {
      return {
        rows: [],
        error: OVERVIEW_LOAD_ERROR,
        availability:
          start === 0 && result.availability === "unavailable"
            ? "unavailable"
            : "partial",
      };
    }

    rows.push(...result.rows);
  }

  return { rows, error: null, availability: "available" };
}

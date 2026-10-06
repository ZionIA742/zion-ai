export const OVERVIEW_LOAD_ERROR = "Falha tecnica ao carregar dados complementares do overview.";
export const OVERVIEW_MAX_PAGES = 1_000;
export const OVERVIEW_IN_CHUNK_SIZE = 100;

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
): Promise<{ rows: T[]; error: string | null }> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return { rows: [], error: OVERVIEW_LOAD_ERROR };
  }

  const rows: T[] = [];

  for (let page = 0; page < OVERVIEW_MAX_PAGES; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await loadPage(from, to);

    if (error) {
      return { rows: [], error: OVERVIEW_LOAD_ERROR };
    }

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      return { rows, error: null };
    }
  }

  return { rows: [], error: OVERVIEW_LOAD_ERROR };
}

export async function loadAllOverviewRowsByChunks<T>(args: {
  values: readonly string[];
  loadPage: (values: readonly string[], from: number, to: number) =>
    | PromiseLike<OverviewPageResult<T>>
    | OverviewPageResult<T>;
  chunkSize?: number;
}): Promise<{ rows: T[]; error: string | null }> {
  const chunkSize = args.chunkSize ?? OVERVIEW_IN_CHUNK_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    return { rows: [], error: OVERVIEW_LOAD_ERROR };
  }

  const values = Array.from(new Set(args.values.filter((value) => Boolean(value))));
  const rows: T[] = [];

  for (let start = 0; start < values.length; start += chunkSize) {
    const result = await loadAllOverviewRows<T>((from, to) =>
      args.loadPage(values.slice(start, start + chunkSize), from, to),
    );

    if (result.error) {
      return { rows: [], error: OVERVIEW_LOAD_ERROR };
    }

    rows.push(...result.rows);
  }

  return { rows, error: null };
}

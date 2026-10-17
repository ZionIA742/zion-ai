export type RecentAiErrorEvent = {
  id: string;
  model: string | null;
  status: string | null;
  error: string | null;
  createdAt: string | null;
  finishedAt: string | null;
};

export type RecentAiErrorStore = {
  id: string;
  name: string;
  recentAiErrors?: RecentAiErrorEvent[] | null;
};

export type GlobalRecentAiError = RecentAiErrorEvent & {
  storeId: string;
  storeName: string;
};

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function selectRecentAiErrors(
  stores: RecentAiErrorStore[],
  limit = 6,
): GlobalRecentAiError[] {
  const boundedLimit = Number.isInteger(limit) && limit > 0 ? limit : 0;

  return stores
    .flatMap((store) =>
      (store.recentAiErrors ?? []).map((event) => ({
        ...event,
        storeId: store.id,
        storeName: store.name,
      })),
    )
    .sort((left, right) => {
      const leftTime = timestamp(left.createdAt);
      const rightTime = timestamp(right.createdAt);

      if (leftTime === null && rightTime !== null) return 1;
      if (leftTime !== null && rightTime === null) return -1;
      if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
        return rightTime - leftTime;
      }

      const idOrder = left.id.localeCompare(right.id);
      if (idOrder !== 0) return idOrder;
      return left.storeId.localeCompare(right.storeId);
    })
    .slice(0, boundedLimit);
}

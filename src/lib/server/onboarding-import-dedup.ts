import type { NormalizedImportItem } from "./onboarding-import-normalizers";

export type DedupedImportItem = NormalizedImportItem & {
  dedupKey: string;
  duplicateOf?: string;
  isDuplicate: boolean;
};

function normalizeForKey(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function completenessScore(item: NormalizedImportItem) {
  const metadata = item.metadata || {};
  return [
    metadata.clean_description,
    metadata.price,
    metadata.dimensions,
    metadata.depth,
    metadata.capacity,
    metadata.material,
    metadata.brand,
    metadata.notes,
  ].filter(Boolean).length;
}

function buildDedupKey(item: NormalizedImportItem) {
  const type = normalizeForKey(item.type);
  const title = normalizeForKey(item.title);
  const category = normalizeForKey(item.metadata?.categoria || item.metadata?.destination || "");
  return `${type}::${category}::${title}`;
}

export function dedupNormalizedItems(items: NormalizedImportItem[]): DedupedImportItem[] {
  const chosenByKey = new Map<string, { title: string; score: number }>();

  for (const item of items) {
    const dedupKey = buildDedupKey(item);
    const score = completenessScore(item);
    const existing = chosenByKey.get(dedupKey);
    if (!existing || score > existing.score) {
      chosenByKey.set(dedupKey, { title: item.title, score });
    }
  }

  return items.map((item) => {
    const dedupKey = buildDedupKey(item);
    const winner = chosenByKey.get(dedupKey);
    const isWinner = winner?.title === item.title;
    return {
      ...item,
      dedupKey,
      duplicateOf: isWinner ? undefined : winner?.title,
      isDuplicate: !isWinner,
    };
  });
}

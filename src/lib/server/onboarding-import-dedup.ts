
import type { NormalizedImportItem } from "./onboarding-import-normalizers"

export type DedupedImportItem = NormalizedImportItem & {
  dedupKey: string;
  duplicateOf?: string;
  isDuplicate: boolean;
};

function normalizeForKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDedupKey(item: NormalizedImportItem) {
  const destination = normalizeForKey(
    item.metadata?.destination || item.metadata?.categoria || item.type
  );
  const title = normalizeForKey(item.title);
  return `${destination}::${title}`;
}

function scoreItem(item: NormalizedImportItem) {
  let score = 0;
  score += item.confidence * 100;
  score += Math.min((item.rawText || "").length / 50, 20);

  const metadataValues = Object.values(item.metadata || {}).filter(Boolean).length;
  score += metadataValues * 3;

  if (item.type === "pool") score += 10;
  if (item.type === "catalog_item") score += 6;
  if ((item.metadata?.price || "").trim()) score += 4;
  if ((item.metadata?.dimensions || "").trim()) score += 4;
  if ((item.metadata?.capacity || "").trim()) score += 4;
  if ((item.metadata?.material || "").trim()) score += 2;

  return score;
}

export function dedupNormalizedItems(items: NormalizedImportItem[]): DedupedImportItem[] {
  const bestByKey = new Map<string, { index: number; score: number; title: string }>();
  const keys = items.map(buildDedupKey);

  items.forEach((item, index) => {
    const dedupKey = keys[index];
    const score = scoreItem(item);
    const existing = bestByKey.get(dedupKey);

    if (!existing || score > existing.score) {
      bestByKey.set(dedupKey, {
        index,
        score,
        title: item.title,
      });
    }
  });

  return items.map((item, index) => {
    const dedupKey = keys[index];
    const best = bestByKey.get(dedupKey);
    const isDuplicate = best ? best.index !== index : false;

    return {
      ...item,
      dedupKey,
      duplicateOf: isDuplicate ? best?.title : undefined,
      isDuplicate,
    };
  });
}

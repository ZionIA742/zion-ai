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

function field(item: NormalizedImportItem, key: string) {
  return normalizeForKey(item.metadata?.[key] || "");
}

function buildDedupKey(item: NormalizedImportItem) {
  const type = normalizeForKey(item.type);
  const destination = field(item, "destination");
  const title = normalizeForKey(item.title);
  const dimensions = field(item, "dimensions");
  const capacity = field(item, "capacity");
  const material = field(item, "material");
  const sku = field(item, "sku");
  const raw = normalizeForKey(item.rawText).slice(0, 140);

  return [type, destination, title, dimensions, capacity, material, sku, raw]
    .filter(Boolean)
    .join("::");
}

function scoreCompleteness(item: NormalizedImportItem) {
  let score = 0;
  if (item.title) score += 3;
  if (item.rawText && item.rawText.length > 40) score += 3;
  if (item.metadata?.price) score += 1;
  if (item.metadata?.dimensions) score += 2;
  if (item.metadata?.capacity) score += 1;
  if (item.metadata?.material) score += 1;
  if (item.metadata?.shape) score += 1;
  if (item.metadata?.sku) score += 1;
  return score + item.confidence;
}

export function dedupNormalizedItems(
  items: NormalizedImportItem[]
): DedupedImportItem[] {
  const seen = new Map<string, { title: string; index: number; score: number }>();
  const result: DedupedImportItem[] = [];

  for (const item of items) {
    const dedupKey = buildDedupKey(item);
    const score = scoreCompleteness(item);
    const existing = seen.get(dedupKey);

    if (!existing) {
      seen.set(dedupKey, { title: item.title, index: result.length, score });
      result.push({
        ...item,
        dedupKey,
        isDuplicate: false,
      });
      continue;
    }

    if (score > existing.score) {
      result[existing.index] = {
        ...item,
        dedupKey,
        isDuplicate: false,
      };

      result.push({
        ...result[existing.index],
        dedupKey,
        duplicateOf: item.title,
        isDuplicate: true,
      });

      seen.set(dedupKey, { title: item.title, index: existing.index, score });
      continue;
    }

    result.push({
      ...item,
      dedupKey,
      duplicateOf: existing.title,
      isDuplicate: true,
    });
  }

  return result;
}

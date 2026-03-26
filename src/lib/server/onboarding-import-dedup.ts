import type { NormalizedImportItem } from "./onboarding-import-normalizers";

export type DedupedImportItem = NormalizedImportItem & {
  dedupKey: string;
  duplicateOf?: string;
  isDuplicate: boolean;
};

function normalizeForKey(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDedupKey(item: NormalizedImportItem) {
  const type = normalizeForKey(item.type);
  const title = normalizeForKey(item.title);
  const raw = normalizeForKey(item.rawText).slice(0, 180);

  return `${type}::${title}::${raw}`;
}

export function dedupNormalizedItems(
  items: NormalizedImportItem[]
): DedupedImportItem[] {
  const seen = new Map<string, string>();

  return items.map((item) => {
    const dedupKey = buildDedupKey(item);
    const existing = seen.get(dedupKey);

    if (existing) {
      return {
        ...item,
        dedupKey,
        duplicateOf: existing,
        isDuplicate: true,
      };
    }

    seen.set(dedupKey, item.title);

    return {
      ...item,
      dedupKey,
      isDuplicate: false,
    };
  });
}
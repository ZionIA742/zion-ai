import type { NormalizedImportItem } from "./onboarding-import-normalizers";
import {
  buildImportDedupIdentity,
  normalizeImportDedupSku,
} from "../onboarding-import-dedup-identity";

export type DedupedImportItem = NormalizedImportItem & {
  dedupKey: string;
  duplicateOf?: string;
  isDuplicate: boolean;
};

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

function extractNormalizedItemSku(item: NormalizedImportItem) {
  return normalizeImportDedupSku(
    item.metadata?.sku || item.metadata?.SKU || item.metadata?.codigo || item.metadata?.["cÃ³digo"] || ""
  );
}

function buildDedupKey(item: NormalizedImportItem) {
  return buildImportDedupIdentity({
    type: item.type,
    category: item.metadata?.categoria || item.metadata?.destination || "",
    title: item.title,
    sku: extractNormalizedItemSku(item),
  });
}

export function dedupNormalizedItems(items: NormalizedImportItem[]): DedupedImportItem[] {
  const chosenByKey = new Map<string, { index: number; title: string; score: number }>();

  for (const [index, item] of items.entries()) {
    const dedupKey = buildDedupKey(item);
    const score = completenessScore(item);
    const existing = chosenByKey.get(dedupKey);
    if (!existing || score > existing.score) {
      chosenByKey.set(dedupKey, { index, title: item.title, score });
    }
  }

  return items.map((item, index) => {
    const dedupKey = buildDedupKey(item);
    const winner = chosenByKey.get(dedupKey);
    const isWinner = winner?.index === index;
    return {
      ...item,
      dedupKey,
      duplicateOf: isWinner ? undefined : winner?.title,
      isDuplicate: !isWinner,
    };
  });
}

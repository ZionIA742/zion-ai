export function normalizeImportDedupText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeImportDedupSku(value: string | null | undefined) {
  return String(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

export function buildImportDedupIdentity(args: {
  type: string | null | undefined;
  category: string | null | undefined;
  title: string | null | undefined;
  sku: string | null | undefined;
}) {
  const normalizedSku = normalizeImportDedupSku(args.sku);
  if (normalizedSku) {
    return `sku::${normalizedSku}`;
  }

  const normalizedType = normalizeImportDedupText(args.type);
  const normalizedCategory = normalizeImportDedupText(args.category);
  const normalizedTitle = normalizeImportDedupText(args.title);

  return `title::${normalizedType}::${normalizedCategory}::${normalizedTitle}`;
}

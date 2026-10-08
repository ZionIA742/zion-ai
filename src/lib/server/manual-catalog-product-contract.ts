import { createHash } from "node:crypto";

export const MANUAL_CATALOG_OPERATION_PREFIX = "crm_manual_catalog_photo:";

export type ManualCatalogSourceKind = "pool" | "catalog_item";

export function normalizeManualCatalogText(value: unknown) {
  return String(value ?? "").trim();
}

export function parseManualCatalogSourceKind(value: unknown): ManualCatalogSourceKind | null {
  const normalized = normalizeManualCatalogText(value);
  return normalized === "pool" || normalized === "catalog_item" ? normalized : null;
}

export function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalizeManualCatalogText(value),
  );
}

export function normalizeManualCatalogOperationId(value: unknown) {
  const normalized = normalizeManualCatalogText(value);
  return isUuid(normalized) ? normalized.toLowerCase() : null;
}

export function buildManualCatalogIdempotencyKey(operationId: string) {
  return `${MANUAL_CATALOG_OPERATION_PREFIX}${operationId}`;
}

export function buildManualCatalogPayloadFingerprint(input: {
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string;
  actorUserId: string;
  sourceKind: ManualCatalogSourceKind;
  sourceId: string;
  content: string;
  sendExternal: boolean;
}) {
  const canonical = JSON.stringify({
    organizationId: normalizeManualCatalogText(input.organizationId),
    storeId: normalizeManualCatalogText(input.storeId),
    conversationId: normalizeManualCatalogText(input.conversationId),
    leadId: normalizeManualCatalogText(input.leadId),
    actorUserId: normalizeManualCatalogText(input.actorUserId),
    sourceKind: input.sourceKind,
    sourceId: normalizeManualCatalogText(input.sourceId),
    content: normalizeManualCatalogText(input.content),
    sendExternal: input.sendExternal,
  });

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

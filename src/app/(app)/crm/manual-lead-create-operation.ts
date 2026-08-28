export type ManualCommercialLeadCreationSnapshotInput = {
  name: string | null;
  phone: string | null;
};

type PendingManualCommercialLeadCreationOperation = {
  operationId: string;
  requestSnapshot: string;
};

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function normalizeText(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};

    for (const key of Object.keys(record).sort()) {
      normalized[key] = canonicalizeValue(record[key]);
    }

    return normalized;
  }

  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

export function buildManualCommercialLeadCreationSnapshot(
  input: ManualCommercialLeadCreationSnapshotInput,
) {
  return stableStringify({
    name: normalizeText(input.name),
    phone: normalizeText(input.phone),
  });
}

export function buildManualCommercialLeadCreationStorageKey(args: {
  organizationId: string;
  storeId: string | null;
}) {
  return [
    "zion",
    "manual-commercial-lead-create",
    normalizeText(args.organizationId) || "no-org",
    normalizeText(args.storeId) || "no-store",
  ].join(":");
}

export function getOrCreatePendingManualCommercialLeadCreationOperation(args: {
  storage: StorageLike;
  storageKey: string;
  requestSnapshot: string;
  createOperationId: () => string;
}) {
  const raw = args.storage.getItem(args.storageKey);

  if (raw) {
    try {
      const parsed =
        JSON.parse(raw) as PendingManualCommercialLeadCreationOperation | null;
      const operationId = normalizeText(parsed?.operationId);
      const requestSnapshot = normalizeText(parsed?.requestSnapshot);

      if (operationId && requestSnapshot === args.requestSnapshot) {
        return {
          operationId,
          reused: true,
        };
      }
    } catch {
      args.storage.removeItem(args.storageKey);
    }
  }

  const operationId = normalizeText(args.createOperationId());

  if (!operationId) {
    throw new Error(
      "Nao foi possivel gerar a operation id da criacao do lead comercial.",
    );
  }

  args.storage.setItem(
    args.storageKey,
    JSON.stringify({
      operationId,
      requestSnapshot: args.requestSnapshot,
    } satisfies PendingManualCommercialLeadCreationOperation),
  );

  return {
    operationId,
    reused: false,
  };
}

export function clearPendingManualCommercialLeadCreationOperation(args: {
  storage: StorageLike;
  storageKey: string;
}) {
  args.storage.removeItem(args.storageKey);
}

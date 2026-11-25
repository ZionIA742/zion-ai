import {
  buildManualQuoteCreationSnapshot,
  clearPendingManualQuoteCreationOperation,
  getOrCreatePendingManualQuoteCreationOperation,
  type ManualQuoteCreationSnapshotInput,
} from "./lead/[id]/quote-create-operation";

import {
  convertReaisToCents,
  parseQuoteQuantityValue,
  type QuoteFormItem,
} from "./quote-editor-model";

type StorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type ManualQuotePdfPayload = Omit<
  ManualQuoteCreationSnapshotInput,
  "discount_cents"
>;

const QUOTE_PDF_OPERATION_KEY_PREFIX =
  "zion:quote-pdf-operation:";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function getQuotePdfOperationId(
  quoteId: string,
  storage: StorageLike = window.sessionStorage,
  createOperationId: () => string =
    () => window.crypto.randomUUID(),
) {
  const key = QUOTE_PDF_OPERATION_KEY_PREFIX + quoteId;
  const existing = storage.getItem(key) || "";

  if (UUID_PATTERN.test(existing)) {
    return existing;
  }

  const operationId = createOperationId();

  if (!UUID_PATTERN.test(operationId)) {
    throw new Error("Identidade de geracao de PDF invalida.");
  }

  storage.setItem(key, operationId);

  return operationId;
}

export function clearQuotePdfOperationId(
  quoteId: string,
  storage: StorageLike = window.sessionStorage,
) {
  storage.removeItem(
    QUOTE_PDF_OPERATION_KEY_PREFIX + quoteId
  );
}

export function normalizeManualQuoteItems(
  items: QuoteFormItem[],
): ManualQuotePdfPayload["items"] {
  return items.map((item) => ({
    item_type: item.itemType === "service"
      ? "service"
      : "custom",
    name: item.name.trim(),
    description: item.description.trim() || null,
    quantity: parseQuoteQuantityValue(item.quantity),
    unit_price_cents: convertReaisToCents(item.unitPriceReais),
    discount_cents: convertReaisToCents(item.discountReais),
  }));
}

type SubmitManualQuotePdfArgs = {
  payload: ManualQuotePdfPayload;
  pendingOperationStorageKey: string;
  requestSnapshot: string;
  storage: StorageLike;
  createUuid: () => string;
  fetcher?: typeof fetch;
};

export async function submitManualQuotePdf(
  args: SubmitManualQuotePdfArgs,
) {
  const {
    payload,
    pendingOperationStorageKey,
    requestSnapshot,
    storage,
    createUuid,
    fetcher = fetch,
  } = args;

  // The server remains the authorization authority.
  // This check protects the browser retry identity.

  if (!payload.organizationId || !payload.storeId) {
    throw new Error("Escopo da loja ausente.");
  }

  const expectedSnapshot =
    buildManualQuoteCreationSnapshot({
      ...payload,
      discount_cents: 0,
    });

  if (requestSnapshot !== expectedSnapshot) {
    throw new Error("Identidade local do orcamento divergente.");
  }

  const creationOperation =
    getOrCreatePendingManualQuoteCreationOperation({
      storage,
      storageKey: pendingOperationStorageKey,
      requestSnapshot,
      createIdempotencyKey:
        () => "quote_create:" + createUuid(),
    });

  const createResponse = await fetcher(
    "/api/sales-quotes/create",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
        creationIdempotencyKey:
          creationOperation.idempotencyKey,
      }),
    },
  );

  const createResult =
    await createResponse.json().catch(() => null);

  if (
    !createResponse.ok ||
    !createResult?.ok ||
    typeof createResult.quoteId !== "string" ||
    !createResult.quoteId.trim()
  ) {
    throw new Error(
      createResult?.message ||
      createResult?.error ||
      "Nao foi possivel criar o orcamento."
    );
  }

  const quoteId: string = createResult.quoteId;

  const generatePdfResponse = await fetcher(
    "/api/sales-quotes/" +
      encodeURIComponent(quoteId) +
      "/generate-pdf",
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "x-zion-quote-operation-id":
          getQuotePdfOperationId(
            quoteId,
            storage,
            createUuid,
          ),
      },
    },
  );

  const generatePdfResult =
    await generatePdfResponse.json().catch(() => null);

  if (
    !generatePdfResponse.ok ||
    !generatePdfResult?.ok
  ) {
    throw new Error(
      generatePdfResult?.message ||
      generatePdfResult?.error ||
      "O orcamento foi criado, mas nao foi possivel gerar o PDF."
    );
  }

  // Only clear retry identities after confirmed success.

  clearQuotePdfOperationId(quoteId, storage);

  clearPendingManualQuoteCreationOperation({
    storage,
    storageKey: pendingOperationStorageKey,
  });

  return { quoteId };
}

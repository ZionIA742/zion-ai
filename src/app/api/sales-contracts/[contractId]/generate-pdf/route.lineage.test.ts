import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createGenerateContractPdfPostHandler } from "./route";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type SupabaseCall = {
  table: string;
  operation: string;
  filters?: Array<{ column: string; value: unknown }>;
  payload?: Record<string, unknown>;
};

type TestState = {
  scope: ReturnType<typeof createScope>;
  calls: SupabaseCall[];
  pdfInputs: Array<Record<string, unknown>>;
  storedFiles: Array<Record<string, unknown>>;
};

let state: TestState;

function createQuoteVersionRow(overrides?: Record<string, unknown>) {
  return {
    id: "version-accepted-v1",
    quote_id: "quote-1",
    organization_id: "org-1",
    store_id: "store-1",
    status: "sent",
    sent_at: "2026-09-24T10:00:00.000Z",
    quote_snapshot: {
      quote: {
        id: "quote-1",
        quoteNumber: "ORC-1",
        title: "Contrato da quote",
        customerName: "Cliente da quote",
        customerPhone: "5511888888888",
        currency: "BRL",
        paymentTerms: "Pix pela quote",
        deliveryTerms: "Entrega pela quote",
        warrantyTerms: "Garantia pela quote",
        validUntil: "2026-10-24",
        subtotalCents: 86415,
        discountCents: 345,
        totalCents: 86070,
      },
      items: [
        {
          id: "snapshot-item-v1",
          name: "ITEM IMUTAVEL V1",
          description: "Snapshot v1",
          quantity: 7,
          unitPriceCents: 12345,
          discountCents: 345,
          subtotalCents: 86415,
          totalCents: 86070,
          sku: "SKU-V1",
          sortOrder: 12,
          metadata: {
            marker: "snapshot-only-v1",
          },
        },
      ],
    },
    ...overrides,
  };
}

function createSupabaseMock(args: {
  quoteVersionRow: Record<string, unknown> | null;
  calls: SupabaseCall[];
  writer?: {
    versionNumber?: number;
    replayed?: boolean;
    error?: { message: string } | null;
    durableReadError?: { message: string } | null;
    workflowError?: { message: string } | null;
  };
}) {
  const writer = args.writer || {};
  function makeThenable(result: { data: unknown; error: unknown }) {
    return {
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve(result).then(resolve, reject);
      },
    };
  }

  return {
    storage: {
      from(bucket: string) {
        return {
          remove: async (paths: string[]) => {
            args.calls.push({ table: `storage:${bucket}`, operation: "remove", payload: { paths } });
            return { data: null, error: null };
          },
        };
      },
    },
    rpc(name: string, payload: Record<string, unknown>) {
      args.calls.push({ table: name, operation: "rpc", payload });
      return Promise.resolve({
        data: writer.error ? null : [{
          id: "contract-version-1",
          contract_id: payload.p_contract_id,
          organization_id: payload.p_organization_id,
          store_id: payload.p_store_id,
          version_number: writer.versionNumber || 1,
          status: "generated",
          replayed: writer.replayed === true,
        }],
        error: writer.error || null,
      });
    },
    from(table: string) {
      if (table === "sales_quote_items") {
        throw new Error("sales_quote_items must not be queried by contract PDF generation");
      }

      const filters: Array<{ column: string; value: unknown }> = [];

      if (table === "sales_quote_versions") {
        return {
          select() {
            const builder = {
              eq(column: string, value: unknown) {
                filters.push({ column, value });
                const call = args.calls[args.calls.length - 1];
                if (call) call.filters = [...filters];
                return builder;
              },
              maybeSingle: async () => {
                args.calls.push({
                  table,
                  operation: "maybeSingle",
                  filters: [...filters],
                });
                return { data: args.quoteVersionRow, error: null };
              },
            };
            return builder;
          },
        };
      }

      if (table === "sales_contract_versions") {
        return {
          select() {
            const selectBuilder = {
              eq(column: string, value: unknown) {
                filters.push({ column, value });
                return selectBuilder;
              },
              order() {
                return selectBuilder;
              },
              limit() {
                args.calls.push({
                  table,
                  operation: "select",
                  filters: [...filters],
                });
                return makeThenable({ data: [], error: null });
              },
              maybeSingle: async () => {
                args.calls.push({ table, operation: "maybeSingle", filters: [...filters] });
                return {
                  data: {
                    id: "contract-version-1",
                    contract_id: "contract-1",
                    organization_id: "org-1",
                    store_id: "store-1",
                    version_number: writer.versionNumber || 1,
                    status: "generated",
                    store_file_id: writer.replayed ? "store-file-durable" : "store-file-1",
                    storage_bucket: "contracts",
                    storage_path: writer.replayed
                      ? "contracts/durable-contract-1.pdf"
                      : "contracts/contract-1.pdf",
                    original_filename: writer.replayed
                      ? "durable-contract-1.pdf"
                      : "contract-1.pdf",
                    mime_type: "application/pdf",
                    size_bytes: 4,
                    contract_snapshot:
                      args.calls.find((call) => call.table === "create_sales_contract_version_by_system")
                        ?.payload?.p_contract_snapshot || null,
                  },
                  error: writer.durableReadError || null,
                };
              },
            };
            return selectBuilder;
          },
          update(payload: Record<string, unknown>) {
            args.calls.push({
              table,
              operation: "update",
              payload,
            });
            const builder = {
              eq(column: string, value: unknown) {
                filters.push({ column, value });
                const call = args.calls[args.calls.length - 1];
                if (call) call.filters = [...filters];
                return builder;
              },
              select() { return builder; },
              maybeSingle: async () => ({ data: { id: "contract-version-previous" }, error: null }),
            };
            return builder;
          },
        };
      }

      if (table === "sales_contracts" || table === "store_files") {
        return {
          update(payload: Record<string, unknown>) {
            args.calls.push({
              table,
              operation: "update",
              payload,
            });
            const builder = {
              eq(column: string, value: unknown) {
                filters.push({ column, value });
                const call = args.calls[args.calls.length - 1];
                if (call) call.filters = [...filters];
                return builder;
              },
              select() { return builder; },
              maybeSingle: async () => ({
                data: writer.workflowError ? null : { id: "contract-1" },
                error: writer.workflowError || null,
              }),
            };
            return builder;
          },
          delete() {
            const builder = {
              eq() {
                args.calls.push({ table, operation: "delete" });
                return builder;
              },
            };
            return builder;
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

function createScope(overrides?: {
  contract?: Record<string, unknown>;
  quoteVersionRow?: Record<string, unknown> | null;
  writer?: {
    versionNumber?: number;
    replayed?: boolean;
    error?: { message: string } | null;
    durableReadError?: { message: string } | null;
    workflowError?: { message: string } | null;
  };
}) {
  const calls: SupabaseCall[] = [];
  const quoteVersionRow =
    "quoteVersionRow" in (overrides ?? {})
      ? overrides?.quoteVersionRow ?? null
      : createQuoteVersionRow();

  const supabase = createSupabaseMock({
    quoteVersionRow,
    calls,
    writer: overrides?.writer,
  });

  const contract = {
    id: "contract-1",
    organization_id: "org-1",
    store_id: "store-1",
    lead_id: "lead-1",
    conversation_id: "conversation-1",
    quote_id: "quote-1",
    quote_version_id: "version-accepted-v1",
    current_version_id: null,
    contract_number: "CTR-1",
    title: "Contrato",
    status: "draft",
    customer_name: "Cliente",
    customer_phone: "5511999999999",
    currency: "BRL",
    subtotal_cents: 86415,
    discount_cents: 345,
    total_cents: 86070,
    payment_terms: "Pix",
    delivery_terms: "Entrega",
    warranty_terms: "Garantia",
    contract_terms: "Termos",
    valid_until: "2026-10-24",
    sent_at: null,
    customer_signed_at: null,
    store_signed_at: null,
    completed_at: null,
    metadata: {
      quote_number: "ORC-1",
      fake_current_mutable_version_id: "version-v2",
    },
    created_at: "2026-09-24T09:00:00.000Z",
    updated_at: "2026-09-24T09:00:00.000Z",
    ...overrides?.contract,
  };

  return {
    user: { id: "user-1" },
    userId: "user-1",
    organizationIds: ["org-1"],
    supabase,
    sessionSupabase: supabase,
    organizationId: "org-1",
    store: { id: "store-1", organization_id: "org-1", name: "Store 1" },
    conversation: { id: "conversation-1" },
    lead: { id: "lead-1", name: "Cliente", phone: "5511999999999" },
    contract,
    currentVersion: null,
    calls,
  };
}

function resetState(args?: Parameters<typeof createScope>[0]) {
  const scope = createScope(args);
  state = {
    scope,
    calls: scope.calls,
    pdfInputs: [],
    storedFiles: [],
  };
}

async function callRoute(args?: { headers?: Record<string, string> }) {
  const handler = createGenerateContractPdfPostHandler({
    buildContractPdf: async (input: Record<string, unknown>) => {
      state.pdfInputs.push(input);
      return new Uint8Array([37, 80, 68, 70]);
    },
    loadStoreBrandVisualPolicy: async () => ({
      configured: false,
      useLogoOnContracts: null,
      useLogoOnQuotes: null,
      primaryColor: null,
      secondaryColor: null,
      documentFooter: null,
    }),
    loadStoreLogoForContractPdf: async () => null,
    pushAssistantDocumentReviewMessage: async () => ({
      ok: true,
      deduped: false,
      threadId: "thread-1",
      messageId: "message-1",
    }),
    registerContractBusinessEvent: async (input) => {
      state.calls.push({ table: "business_event", operation: "rpc", payload: input });
    },
    resolveAuthorizedExistingContract: async () => state.scope,
    resolveContractTemplateTerms: async () => ({
      contractTemplateUsed: true,
      templateId: "template-1",
      templateVersionId: "template-version-1",
      templateVersionNumber: 1,
      generatedContractTerms: "CLAUSULAS DA AUTHORITY DO TEMPLATE",
      rulesUsed: [{
        rule_id: "rule-1",
        rule_key: "pagamento",
        rule_group: "pagamento",
        label: "Pagamento",
        value_text: "CLAUSULAS DA AUTHORITY DO TEMPLATE",
        review_status: "approved",
        sort_order: 1,
      }],
      snapshotGeneratedAt: "2026-09-24T12:00:00.000Z",
      warning: null,
    }),
    storeContractPdfFile: async (input: Record<string, unknown>) => {
      state.storedFiles.push(input);
      return {
        storeFileId: "store-file-1",
        storageBucket: "contracts",
        storagePath: "contracts/contract-1.pdf",
        originalFilename: "contract-1.pdf",
        sizeBytes: 4,
      };
    },
  });

  const response = await handler(
    new Request("https://example.test", { method: "POST", headers: args?.headers }),
    { params: Promise.resolve({ contractId: "contract-1" }) },
  );
  const body = await response.json();
  return { response, body };
}

function insertedContractSnapshot() {
  const insert = state.calls.find(
    (call) => call.table === "create_sales_contract_version_by_system" && call.operation === "rpc",
  );
  return insert?.payload?.p_contract_snapshot as Record<string, unknown> | undefined;
}

function quoteVersionRead() {
  return state.calls.find(
    (call) => call.table === "sales_quote_versions" && call.operation === "maybeSingle",
  );
}

function assertNoMutableQuoteItemsQuery() {
  assert.equal(
    state.calls.some((call) => call.table === "sales_quote_items"),
    false,
    "contract PDF generation must not query sales_quote_items",
  );
}

const tests: TestCase[] = [
  {
    name: "uses exact immutable quote version snapshot items for PDF and persisted contract snapshot",
    run: async () => {
      resetState();
      const { response, body } = await callRoute();

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assertNoMutableQuoteItemsQuery();

      assert.deepEqual(quoteVersionRead()?.filters, [
        { column: "id", value: "version-accepted-v1" },
        { column: "quote_id", value: "quote-1" },
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
      ]);
      assert.notEqual(
        quoteVersionRead()?.filters?.some((filter) => filter.value === "version-v2"),
        true,
      );

      assert.deepEqual((state.pdfInputs[0]?.items as unknown[])[0], {
        id: "snapshot-item-v1",
        name: "ITEM IMUTAVEL V1",
        description: "Snapshot v1",
        quantity: 7,
        unitPriceCents: 12345,
        discountCents: 345,
        totalCents: 86070,
        metadata: {
          marker: "snapshot-only-v1",
        },
      });

      const snapshot = insertedContractSnapshot();
      const rendererInput = snapshot?.renderer_input as Record<string, unknown>;
      const snapshotItem = (rendererInput.items as Array<Record<string, unknown>>)[0];
      assert.deepEqual(
        snapshotItem,
        (state.pdfInputs[0]?.items as Array<Record<string, unknown>> | undefined)?.[0],
      );
      assert.equal(
        (rendererInput.templateAuthority as Record<string, unknown>).clauses,
        "CLAUSULAS DA AUTHORITY DO TEMPLATE",
      );
      assert.equal(snapshot?.schema, "zion.sales_contract_snapshot.v2");
      assert.equal(typeof snapshot?.content_fingerprint, "string");
      assert.equal(state.storedFiles.length, 1);
      const rpcCall = state.calls.find(
        (call) => call.table === "create_sales_contract_version_by_system" && call.operation === "rpc",
      );
      assert.ok(rpcCall);
      assert.match(String(rpcCall.payload?.p_operation_key), /^p9:contract-pdf:contract-1:/);
      assert.match(String(rpcCall.payload?.p_request_fingerprint), /^[0-9a-f]{64}$/);
      assert.match(String(rpcCall.payload?.p_content_fingerprint), /^[0-9a-f]{64}$/);
      assert.equal(
        rpcCall.payload?.p_pdf_sha256,
        createHash("sha256").update(new Uint8Array([37, 80, 68, 70])).digest("hex"),
      );
      assert.equal(
        state.calls.some((call) => call.table === "sales_contract_versions" && call.operation === "insert"),
        false,
      );
      assert.equal(
        state.calls.some((call) => call.table === "sales_contract_versions" && call.operation === "delete"),
        false,
      );
      assert.equal(
        state.calls.some((call) => call.table === "business_event"),
        true,
      );
      const pending = state.calls.find(
        (call) => call.table === "sales_contracts" && call.operation === "update",
      );
      assert.deepEqual(pending?.filters, [
        { column: "id", value: "contract-1" },
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
        { column: "current_version_id", value: "contract-version-1" },
      ]);
    },
  },
  {
    name: "request fingerprint is deterministic while operation keys remain per action",
    run: async () => {
      resetState();
      await callRoute({
        headers: { "x-zion-contract-operation-id": "11111111-1111-4111-8111-111111111111" },
      });
      const first = state.calls.find((call) => call.table === "create_sales_contract_version_by_system")?.payload;
      resetState();
      await callRoute({
        headers: { "x-zion-contract-operation-id": "22222222-2222-4222-8222-222222222222" },
      });
      const second = state.calls.find((call) => call.table === "create_sales_contract_version_by_system")?.payload;
      assert.equal(first?.p_request_fingerprint, second?.p_request_fingerprint);
      assert.notEqual(first?.p_operation_key, second?.p_operation_key);
    },
  },
  {
    name: "replayed RPC cleans only the temporary artifact and responds with durable storage",
    run: async () => {
      resetState({ writer: { versionNumber: 2, replayed: true } });
      const { response, body } = await callRoute();
      assert.equal(response.status, 200);
      assert.equal(body.storeFile.storagePath, "contracts/durable-contract-1.pdf");
      assert.equal(
        state.calls.some(
          (call) => call.table === "storage:contracts" && call.operation === "remove",
        ),
        true,
      );
      assert.equal(state.calls.some((call) => call.table === "store_files" && call.operation === "delete"), true);
      assert.equal(state.calls.some((call) => call.table === "business_event"), false);
      assert.equal(state.calls.some((call) => call.table === "sales_contract_versions" && call.operation === "delete"), false);
      const superseded = state.calls.find(
        (call) => call.table === "sales_contract_versions" && call.operation === "update",
      );
      assert.deepEqual(superseded?.filters, [
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
        { column: "contract_id", value: "contract-1" },
        { column: "version_number", value: 1 },
      ]);
    },
  },
  {
    name: "new authority commit survives durable version read failure",
    run: async () => {
      resetState({
        writer: {
          replayed: false,
          durableReadError: { message: "durable version read failed" },
        },
      });

      const { response } = await callRoute();

      assert.equal(response.status, 500);
      assert.equal(
        state.calls.some(
          (call) => call.table === "storage:contracts" && call.operation === "remove",
        ),
        false,
      );
      assert.equal(
        state.calls.some((call) => call.table === "store_files" && call.operation === "delete"),
        false,
      );
      assert.equal(
        state.calls.some((call) => call.table === "sales_contract_versions" && call.operation === "delete"),
        false,
      );
    },
  },
  {
    name: "replayed authority commit removes only the new temporary artifact after durable read failure",
    run: async () => {
      resetState({
        writer: {
          replayed: true,
          durableReadError: { message: "durable version read failed" },
        },
      });

      const { response } = await callRoute();

      assert.equal(response.status, 500);
      assert.equal(
        state.calls.some(
          (call) => call.table === "storage:contracts" && call.operation === "remove",
        ),
        true,
      );
      assert.equal(
        state.calls.some((call) => call.table === "store_files" && call.operation === "delete"),
        true,
      );
      assert.equal(
        state.calls.some((call) => call.table === "sales_contract_versions" && call.operation === "delete"),
        false,
      );
    },
  },
  {
    name: "workflow failure after new authority commit preserves durable artifact and version",
    run: async () => {
      resetState({
        writer: {
          replayed: false,
          workflowError: { message: "pending review update failed" },
        },
      });

      const { response } = await callRoute();

      assert.equal(response.status, 500);
      assert.equal(
        state.calls.some(
          (call) => call.table === "storage:contracts" && call.operation === "remove",
        ),
        false,
      );
      assert.equal(
        state.calls.some((call) => call.table === "store_files" && call.operation === "delete"),
        false,
      );
      assert.equal(
        state.calls.some((call) => call.table === "sales_contract_versions" && call.operation === "delete"),
        false,
      );
    },
  },
  {
    name: "RPC failure cleans the temporary artifact without deleting a contract version",
    run: async () => {
      resetState({ writer: { error: { message: "writer failed" } } });
      const { response } = await callRoute();
      assert.equal(response.status, 500);
      assert.equal(
        state.calls.some(
          (call) => call.table === "storage:contracts" && call.operation === "remove",
        ),
        true,
      );
      assert.equal(state.calls.some((call) => call.table === "store_files" && call.operation === "delete"), true);
      assert.equal(state.calls.some((call) => call.table === "sales_contract_versions" && call.operation === "delete"), false);
    },
  },
  {
    name: "generation source has no legacy version or direct version-row authority",
    run: () => {
      const routeSource = readFileSync(
        join(process.cwd(), "src/app/api/sales-contracts/[contractId]/generate-pdf/route.ts"),
        "utf8",
      );
      const versioningSource = readFileSync(
        join(process.cwd(), "src/lib/server/sales-contracts/contract-versioning.ts"),
        "utf8",
      );
      assert.equal(routeSource.includes("getNextContractVersionNumber"), false);
      assert.equal(routeSource.includes("createContractVersion"), false);
      assert.equal(routeSource.includes("setContractCurrentVersion"), false);
      assert.equal(routeSource.includes('.from("sales_contract_versions").delete'), false);
      assert.equal(versioningSource.includes("getNextContractVersionNumber"), false);
      assert.equal(versioningSource.includes("createContractVersion"), false);
      assert.equal(versioningSource.includes("setContractCurrentVersion"), false);
    },
  },
  {
    name: "snapshot without items array fails closed before PDF storage or contract version",
    run: async () => {
      resetState({
        quoteVersionRow: createQuoteVersionRow({
          quote_snapshot: { quote: { id: "quote-1" } },
        }),
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_QUOTE_SNAPSHOT_ITEMS_INVALID");
      assert.equal(state.pdfInputs.length, 0);
      assert.equal(state.storedFiles.length, 0);
      assert.equal(insertedContractSnapshot(), undefined);
    },
  },
  {
    name: "snapshot quote id mismatch fails closed",
    run: async () => {
      resetState({
        quoteVersionRow: createQuoteVersionRow({
          quote_snapshot: { quote: { id: "quote-other" }, items: [] },
        }),
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_QUOTE_SNAPSHOT_LINEAGE_MISMATCH");
      assert.equal(state.pdfInputs.length, 0);
      assert.equal(state.storedFiles.length, 0);
      assert.equal(insertedContractSnapshot(), undefined);
    },
  },
  {
    name: "missing contract quote_version_id fails before PDF storage or contract version",
    run: async () => {
      resetState({
        contract: { quote_version_id: null },
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_QUOTE_VERSION_ID_REQUIRED_FOR_PDF");
      assert.equal(quoteVersionRead(), undefined);
      assert.equal(state.pdfInputs.length, 0);
      assert.equal(state.storedFiles.length, 0);
      assert.equal(insertedContractSnapshot(), undefined);
    },
  },
  {
    name: "missing contract quote_id fails before quote version read, PDF storage or contract version",
    run: async () => {
      resetState({
        contract: { quote_id: null },
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_QUOTE_ID_REQUIRED_FOR_PDF");
      assert.equal(quoteVersionRead(), undefined);
      assert.equal(state.pdfInputs.length, 0);
      assert.equal(state.storedFiles.length, 0);
      assert.equal(insertedContractSnapshot(), undefined);
    },
  },
  {
    name: "missing exact quote version fails closed",
    run: async () => {
      resetState({
        quoteVersionRow: null,
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_QUOTE_VERSION_NOT_FOUND");
      assert.deepEqual(quoteVersionRead()?.filters?.[0], {
        column: "id",
        value: "version-accepted-v1",
      });
      assert.equal(state.pdfInputs.length, 0);
      assert.equal(state.storedFiles.length, 0);
      assert.equal(insertedContractSnapshot(), undefined);
    },
  },
  {
    name: "exact quote version with invalid status fails closed",
    run: async () => {
      resetState({
        quoteVersionRow: createQuoteVersionRow({
          status: "approved",
          sent_at: "2026-09-24T10:00:00.000Z",
        }),
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_QUOTE_VERSION_STATUS_INVALID");
      assert.deepEqual(quoteVersionRead()?.filters?.[0], {
        column: "id",
        value: "version-accepted-v1",
      });
      assert.equal(state.pdfInputs.length, 0);
      assert.equal(state.storedFiles.length, 0);
      assert.equal(insertedContractSnapshot(), undefined);
    },
  },
  {
    name: "exact sent quote version without sent_at fails closed",
    run: async () => {
      resetState({
        quoteVersionRow: createQuoteVersionRow({
          status: "sent",
          sent_at: null,
        }),
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_QUOTE_VERSION_SENT_AT_REQUIRED");
      assert.deepEqual(quoteVersionRead()?.filters?.[0], {
        column: "id",
        value: "version-accepted-v1",
      });
      assert.equal(state.pdfInputs.length, 0);
      assert.equal(state.storedFiles.length, 0);
      assert.equal(insertedContractSnapshot(), undefined);
    },
  },
  {
    name: "superseded exact quote version with sent_at remains valid historical lineage",
    run: async () => {
      resetState({
        quoteVersionRow: createQuoteVersionRow({
          status: "superseded",
          sent_at: "2026-09-24T10:00:00.000Z",
        }),
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assertNoMutableQuoteItemsQuery();
      assert.equal(
        ((state.pdfInputs[0]?.items as Array<Record<string, unknown>>)[0]).name,
        "ITEM IMUTAVEL V1",
      );
      assert.ok(insertedContractSnapshot());
    },
  },
];

void (async () => {
  const failures: string[] = [];

  for (const testCase of tests) {
    try {
      await testCase.run();
      process.stdout.write(`ok - ${testCase.name}\n`);
    } catch (error) {
      failures.push(
        `not ok - ${testCase.name}\n${error instanceof Error ? error.stack || error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  }
})();

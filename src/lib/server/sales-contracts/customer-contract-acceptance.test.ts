import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContractAccessError } from "./contract-auth";
import {
  findEligibleSentContractForCustomerAcceptance,
  signSalesContractAsCustomer,
} from "./customer-contract-acceptance";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function createScope(overrides?: Partial<Record<string, unknown>>) {
  return {
    supabase: null,
    organizationId: "org-1",
    store: {
      id: "store-1",
    },
    contract: {
      id: "contract-1",
      organization_id: "org-1",
      store_id: "store-1",
      lead_id: "lead-1",
      quote_id: "quote-1",
      conversation_id: "conv-1",
      contract_number: "CTR-001",
      customer_name: "Cliente",
      customer_phone: "5511999999999",
      current_version_id: "version-1",
      status: "sent_to_customer",
      customer_signed_at: null,
    },
    currentVersion: {
      id: "version-1",
      contract_id: "contract-1",
      organization_id: "org-1",
      store_id: "store-1",
      status: "sent_to_customer",
      original_filename: "contrato.pdf",
      mime_type: "application/pdf",
      storage_bucket: "contracts",
      storage_path: "contracts/ctr-001.pdf",
    },
    lead: {
      id: "lead-1",
      name: "Cliente",
      phone: "5511999999999",
    },
    conversation: {
      id: "conv-1",
    },
    ...overrides,
  };
}

function createSupabaseRpcStub(
  rpcResult: Record<string, unknown> | null,
  rpcError: Record<string, unknown> | null = null,
) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  return {
    rpcCalls,
    supabase: {
      async rpc(fn: string, args: Record<string, unknown>) {
        rpcCalls.push({ fn, args });
        return {
          data: rpcResult,
          error: rpcError,
        };
      },
      from() {
        throw new Error("signSalesContractAsCustomer should not use direct table writes");
      },
    },
  };
}

function createDocumentReviewResult() {
  return {
    ok: true as const,
    deduped: false,
    threadId: "thread-1",
    messageId: "message-1",
  };
}

function createFinderSupabaseStub(config: {
  signatures?: Array<Record<string, unknown>>;
  contracts?: Array<Record<string, unknown>>;
  contractVersions?: Array<Record<string, unknown>>;
  leads?: Array<Record<string, unknown>>;
  conversations?: Array<Record<string, unknown>>;
}) {
  const queryLog: Array<{
    table: string;
    filters: Array<{ op: string; column: string; value: unknown }>;
  }> = [];

  const tables: Record<string, Array<Record<string, unknown>>> = {
    sales_contract_signatures: config.signatures || [],
    sales_contracts: config.contracts || [],
    sales_contract_versions: config.contractVersions || [],
    leads: config.leads || [],
    conversations: config.conversations || [],
  };

  const applyFilters = (
    rows: Array<Record<string, unknown>>,
    filters: Array<{ op: string; column: string; value: unknown }>,
  ) =>
    rows.filter((row) =>
      filters.every((filter) => {
        if (filter.op === "eq") {
          return row[filter.column] === filter.value;
        }

        if (filter.op === "not-null") {
          return row[filter.column] !== null && row[filter.column] !== undefined;
        }

        return true;
      }),
    );

  return {
    queryLog,
    supabase: {
      from(table: string) {
        const filters: Array<{ op: string; column: string; value: unknown }> = [];

        const finalize = (single: boolean) => {
          queryLog.push({
            table,
            filters: [...filters],
          });
          const rows = applyFilters(tables[table] || [], filters);

          return Promise.resolve({
            data: single ? rows[0] || null : rows,
            error: null,
          });
        };

        return {
          select(_selection: string) {
            return this;
          },
          eq(column: string, value: unknown) {
            filters.push({ op: "eq", column, value });
            return this;
          },
          not(column: string, operator: string, value: unknown) {
            if (operator === "is" && value === null) {
              filters.push({ op: "not-null", column, value });
            }
            return this;
          },
          async maybeSingle() {
            return finalize(true);
          },
          then(resolve: (value: { data: unknown; error: null }) => unknown) {
            return finalize(false).then(resolve);
          },
        };
      },
    },
  };
}

function createEligibleContractRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "contract-1",
    organization_id: "org-1",
    store_id: "store-1",
    lead_id: "lead-1",
    conversation_id: "conv-1",
    contract_number: "CTR-001",
    current_version_id: "version-1",
    status: "sent_to_customer",
    sent_at: "2026-07-29T12:00:00.000Z",
    updated_at: "2026-07-29T12:00:00.000Z",
    created_at: "2026-07-29T12:00:00.000Z",
    customer_name: "Cliente",
    customer_phone: "5511999999999",
    ...overrides,
  };
}

function createEligibleVersionRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "version-1",
    contract_id: "contract-1",
    organization_id: "org-1",
    store_id: "store-1",
    status: "sent_to_customer",
    original_filename: "contrato.pdf",
    mime_type: "application/pdf",
    storage_bucket: "contracts",
    storage_path: "contracts/ctr-001.pdf",
    ...overrides,
  };
}

const tests: TestCase[] = [
  {
    name: "signed outcome calls canonical RPC and maps customer_signed",
    run: async () => {
      const recorder = createSupabaseRpcStub({
        outcome: "signed",
        replayed: false,
        reconciled: false,
        contract_id: "contract-1",
        contract_version_id: "version-1",
        signature_id: "signature-1",
        contract_status: "signed_by_customer",
        version_status: "signed_by_customer",
        signed_at: "2026-07-29T12:00:00.000Z",
      });
      const businessEvents: Array<Record<string, unknown>> = [];
      const reviewMessages: Array<Record<string, unknown>> = [];

      const result = await signSalesContractAsCustomer(
        {
          scope: createScope({
            supabase: recorder.supabase,
          }) as never,
          signerEmail: "cliente@example.com",
          acceptanceText: "Aceito formalmente",
          ipAddress: "127.0.0.1",
          userAgent: "test-agent",
          expectedAnchorMessageId: "msg-a1",
          metadataSource: "assistant",
          metadata: {
            source: "forged-source",
            ip_capture_available: false,
            accepted_via: "forged",
            trigger_message_id: "msg-forged",
            custom_flag: "kept",
          },
        },
        {
          registerBusinessEvent: async (payload) => {
            businessEvents.push(payload as unknown as Record<string, unknown>);
          },
          pushDocumentReviewMessage: async (payload) => {
            reviewMessages.push(payload as unknown as Record<string, unknown>);
            return createDocumentReviewResult();
          },
        },
      );

      assert.equal(recorder.rpcCalls.length, 1);
      assert.equal(recorder.rpcCalls[0]?.fn, "sign_sales_contract_as_customer_atomic");
      assert.deepEqual(recorder.rpcCalls[0]?.args, {
        p_organization_id: "org-1",
        p_store_id: "store-1",
        p_conversation_id: "conv-1",
        p_contract_id: "contract-1",
        p_expected_contract_version_id: "version-1",
        p_expected_anchor_message_id: "msg-a1",
        p_signer_name: "Cliente",
        p_signer_phone: "5511999999999",
        p_signer_email: "cliente@example.com",
        p_acceptance_text: "Aceito formalmente",
        p_ip_address: "127.0.0.1",
        p_user_agent: "test-agent",
        p_metadata: {
          source: "assistant",
          ip_capture_available: true,
          accepted_via: "conversation_text",
          trigger_message_id: "msg-a1",
          custom_flag: "kept",
        },
      });
      assert.equal(result.outcome, "signed");
      assert.equal(result.contractStatus, "customer_signed");
      assert.equal(result.versionStatus, "customer_signed");
      assert.equal(result.acceptedAt, "2026-07-29T12:00:00.000Z");
      assert.equal(result.signedAt, "2026-07-29T12:00:00.000Z");
      assert.equal(result.contract.status, "customer_signed");
      assert.equal(result.currentVersion.status, "customer_signed");
      assert.equal(result.signature.metadata?.accepted_via, "conversation_text");
      assert.equal(result.signature.metadata?.trigger_message_id, "msg-a1");
      assert.equal(result.signature.metadata?.custom_flag, "kept");
      assert.equal(businessEvents.length, 1);
      assert.equal(reviewMessages.length, 1);
      assert.deepEqual(result.sideEffects, {
        businessEvent: "completed",
        documentReview: "completed",
      });
    },
  },
  {
    name: "manual acceptance sends null expected anchor and keeps side effects off for already applied",
    run: async () => {
      const recorder = createSupabaseRpcStub({
        outcome: "already_applied",
        replayed: true,
        reconciled: false,
        contract_id: "contract-1",
        contract_version_id: "version-1",
        signature_id: "signature-1",
        contract_status: "customer_signed",
        version_status: "customer_signed",
        signed_at: "2026-07-29T12:00:00.000Z",
      });
      let businessEventCount = 0;
      let reviewMessageCount = 0;

      const result = await signSalesContractAsCustomer(
        {
          scope: createScope({
            supabase: recorder.supabase,
          }) as never,
          metadata: {
            source: "forged-source",
            ip_capture_available: true,
            accepted_via: "forged",
            trigger_message_id: "msg-manual",
            channel: "manual-panel",
          },
        },
        {
          registerBusinessEvent: async () => {
            businessEventCount += 1;
          },
          pushDocumentReviewMessage: async () => {
            reviewMessageCount += 1;
            return createDocumentReviewResult();
          },
        },
      );

      assert.equal(recorder.rpcCalls[0]?.args.p_expected_anchor_message_id, null);
      assert.equal(
        (recorder.rpcCalls[0]?.args.p_metadata as Record<string, unknown>).accepted_via,
        "manual_direct",
      );
      assert.equal(
        "trigger_message_id" in
          ((recorder.rpcCalls[0]?.args.p_metadata as Record<string, unknown>) || {}),
        false,
      );
      assert.equal(
        (recorder.rpcCalls[0]?.args.p_metadata as Record<string, unknown>).channel,
        "manual-panel",
      );
      assert.equal(
        (recorder.rpcCalls[0]?.args.p_metadata as Record<string, unknown>).source,
        "api_sales_contracts_customer_sign",
      );
      assert.equal(
        (recorder.rpcCalls[0]?.args.p_metadata as Record<string, unknown>).ip_capture_available,
        false,
      );
      assert.equal(result.outcome, "already_applied");
      assert.equal(result.replayed, true);
      assert.equal(result.contractStatus, "customer_signed");
      assert.equal(businessEventCount, 0);
      assert.equal(reviewMessageCount, 0);
      assert.deepEqual(result.sideEffects, {
        businessEvent: "skipped",
        documentReview: "skipped",
      });
    },
  },
  {
    name: "reconciled partial state returns success without duplicating local side effects",
    run: async () => {
      const recorder = createSupabaseRpcStub({
        outcome: "reconciled_partial_state",
        replayed: false,
        reconciled: true,
        contract_id: "contract-1",
        contract_version_id: "version-1",
        signature_id: "signature-1",
        contract_status: "customer_signed",
        version_status: "customer_signed",
        signed_at: "2026-07-29T12:00:00.000Z",
      });
      let businessEventCount = 0;
      let reviewMessageCount = 0;

      const result = await signSalesContractAsCustomer(
        {
          scope: createScope({
            supabase: recorder.supabase,
          }) as never,
        },
        {
          registerBusinessEvent: async () => {
            businessEventCount += 1;
          },
          pushDocumentReviewMessage: async () => {
            reviewMessageCount += 1;
            return createDocumentReviewResult();
          },
        },
      );

      assert.equal(result.outcome, "reconciled_partial_state");
      assert.equal(result.reconciled, true);
      assert.equal(result.contractStatus, "customer_signed");
      assert.equal(businessEventCount, 0);
      assert.equal(reviewMessageCount, 0);
      assert.deepEqual(result.sideEffects, {
        businessEvent: "skipped",
        documentReview: "skipped",
      });
    },
  },
  {
    name: "business event failure does not turn persisted signature into error",
    run: async () => {
      const recorder = createSupabaseRpcStub({
        outcome: "signed",
        replayed: false,
        reconciled: false,
        contract_id: "contract-1",
        contract_version_id: "version-1",
        signature_id: "signature-1",
        contract_status: "customer_signed",
        version_status: "customer_signed",
        signed_at: "2026-07-29T12:00:00.000Z",
      });

      const result = await signSalesContractAsCustomer(
        {
          scope: createScope({
            supabase: recorder.supabase,
          }) as never,
        },
        {
          registerBusinessEvent: async () => {
            throw new Error("event failed");
          },
          pushDocumentReviewMessage: async () => createDocumentReviewResult(),
        },
      );

      assert.equal(result.outcome, "signed");
      assert.deepEqual(result.sideEffects, {
        businessEvent: "failed",
        documentReview: "completed",
      });
    },
  },
  {
    name: "document review failure does not turn persisted signature into error",
    run: async () => {
      const recorder = createSupabaseRpcStub({
        outcome: "signed",
        replayed: false,
        reconciled: false,
        contract_id: "contract-1",
        contract_version_id: "version-1",
        signature_id: "signature-1",
        contract_status: "customer_signed",
        version_status: "customer_signed",
        signed_at: "2026-07-29T12:00:00.000Z",
      });

      const result = await signSalesContractAsCustomer(
        {
          scope: createScope({
            supabase: recorder.supabase,
          }) as never,
        },
        {
          registerBusinessEvent: async () => undefined,
          pushDocumentReviewMessage: async () => {
            throw new Error("review failed");
          },
        },
      );

      assert.equal(result.outcome, "signed");
      assert.deepEqual(result.sideEffects, {
        businessEvent: "completed",
        documentReview: "failed",
      });
    },
  },
  {
    name: "finder replays the anchored signature only when the contract belongs to the same conversation",
    run: async () => {
      const recorder = createFinderSupabaseStub({
        signatures: [
          {
            id: "signature-1",
            organization_id: "org-1",
            store_id: "store-1",
            signer_type: "customer",
            trigger_message_id: "msg-a1",
            contract_id: "contract-1",
            contract_version_id: "version-1",
          },
        ],
        contracts: [createEligibleContractRow()],
        contractVersions: [createEligibleVersionRow()],
        leads: [
          {
            id: "lead-1",
            organization_id: "org-1",
            store_id: "store-1",
            name: "Cliente",
            phone: "5511999999999",
          },
        ],
        conversations: [
          {
            id: "conv-1",
            organization_id: "org-1",
          },
        ],
      });

      const result = await findEligibleSentContractForCustomerAcceptance({
        supabase: recorder.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        conversationId: "conv-1",
        leadId: "lead-1",
        anchorMessageId: "msg-a1",
        allowLeadFallback: false,
      });

      assert.equal(result.outcome, "single");
      if (result.outcome === "single") {
        assert.equal(result.matchedBy, "conversation");
        assert.equal(result.contractId, "contract-1");
        assert.equal(result.scope.contract.id, "contract-1");
      }
      assert.equal(
        recorder.queryLog.some(
          (entry) =>
            entry.table === "sales_contracts" &&
            entry.filters.some(
              (filter) => filter.op === "eq" && filter.column === "conversation_id",
            ),
        ),
        false,
      );
    },
  },
  {
    name: "finder ignores replay signatures from another conversation and does not fallback to lead when disabled",
    run: async () => {
      const recorder = createFinderSupabaseStub({
        signatures: [
          {
            id: "signature-1",
            organization_id: "org-1",
            store_id: "store-1",
            signer_type: "customer",
            trigger_message_id: "msg-a1",
            contract_id: "contract-1",
            contract_version_id: "version-1",
          },
        ],
        contracts: [
          createEligibleContractRow({
            conversation_id: "conv-other",
          }),
        ],
        contractVersions: [createEligibleVersionRow()],
        leads: [
          {
            id: "lead-1",
            organization_id: "org-1",
            store_id: "store-1",
            name: "Cliente",
            phone: "5511999999999",
          },
        ],
        conversations: [
          {
            id: "conv-other",
            organization_id: "org-1",
          },
        ],
      });

      const result = await findEligibleSentContractForCustomerAcceptance({
        supabase: recorder.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        conversationId: "conv-1",
        leadId: "lead-1",
        anchorMessageId: "msg-a1",
        allowLeadFallback: false,
      });

      assert.deepEqual(result, {
        outcome: "none",
        candidateCount: 0,
        matchedBy: "conversation",
      });
      assert.equal(
        recorder.queryLog.some(
          (entry) =>
            entry.table === "sales_contracts" &&
            entry.filters.some(
              (filter) => filter.op === "eq" && filter.column === "lead_id",
            ),
        ),
        false,
      );
    },
  },
  {
    name: "finder queries conversation contracts directly when there is no replay signature",
    run: async () => {
      const recorder = createFinderSupabaseStub({
        signatures: [],
        contracts: [createEligibleContractRow()],
        contractVersions: [createEligibleVersionRow()],
        leads: [
          {
            id: "lead-1",
            organization_id: "org-1",
            store_id: "store-1",
            name: "Cliente",
            phone: "5511999999999",
          },
        ],
        conversations: [
          {
            id: "conv-1",
            organization_id: "org-1",
          },
        ],
      });

      const result = await findEligibleSentContractForCustomerAcceptance({
        supabase: recorder.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        conversationId: "conv-1",
        leadId: "lead-1",
        anchorMessageId: "msg-missing",
        allowLeadFallback: false,
      });

      assert.equal(result.outcome, "single");
      assert.equal(
        recorder.queryLog.some(
          (entry) =>
            entry.table === "sales_contracts" &&
            entry.filters.some(
              (filter) =>
                filter.op === "eq" &&
                filter.column === "conversation_id" &&
                filter.value === "conv-1",
            ),
        ),
        true,
      );
    },
  },
  {
    name: "finder uses lead fallback only when it is explicitly enabled",
    run: async () => {
      const recorder = createFinderSupabaseStub({
        signatures: [],
        contracts: [
          createEligibleContractRow({
            id: "contract-lead",
            conversation_id: null,
            lead_id: "lead-1",
            contract_number: "CTR-LEAD",
            current_version_id: "version-lead",
          }),
        ],
        contractVersions: [
          createEligibleVersionRow({
            id: "version-lead",
            contract_id: "contract-lead",
          }),
        ],
        leads: [
          {
            id: "lead-1",
            organization_id: "org-1",
            store_id: "store-1",
            name: "Cliente",
            phone: "5511999999999",
          },
        ],
        conversations: [],
      });

      const result = await findEligibleSentContractForCustomerAcceptance({
        supabase: recorder.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        conversationId: "conv-without-contract",
        leadId: "lead-1",
        allowLeadFallback: true,
      });

      assert.equal(result.outcome, "single");
      if (result.outcome === "single") {
        assert.equal(result.matchedBy, "lead");
        assert.equal(result.contractId, "contract-lead");
      }
      assert.equal(
        recorder.queryLog.some(
          (entry) =>
            entry.table === "sales_contracts" &&
            entry.filters.some(
              (filter) =>
                filter.op === "eq" &&
                filter.column === "lead_id" &&
                filter.value === "lead-1",
            ),
        ),
        true,
      );
    },
  },
  {
    name: "rpc sqlstate is preserved and no fallback write runs",
    run: async () => {
      const recorder = createSupabaseRpcStub(null, {
        code: "ZCB19",
        message: "ANCHOR_MESSAGE_ORDER_AMBIGUOUS",
        details: "anchor id duplicated",
      });

      await assert.rejects(
        () =>
          signSalesContractAsCustomer({
            scope: createScope({
              supabase: recorder.supabase,
            }) as never,
          }),
        (error: unknown) => {
          assert.equal(error instanceof Error, true);
          assert.equal(
            (error as ContractAccessError & { code?: string }).code,
            "ZCB19",
          );
          assert.equal(
            (error as ContractAccessError).message,
            "Nao foi possivel concluir o aceite do cliente (ZCB19: ANCHOR_MESSAGE_ORDER_AMBIGUOUS).",
          );
          assert.equal(
            (error as ContractAccessError & { details?: unknown }).details,
            "anchor id duplicated",
          );
          return true;
        },
      );

      assert.equal(recorder.rpcCalls.length, 1);
    },
  },
  {
    name: "source contains only canonical RPC call for persistence path",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/sales-contracts/customer-contract-acceptance.ts"),
        "utf8",
      );

      assert.equal(source.includes("scope.supabase.rpc"), true);
      assert.equal(source.includes('"sign_sales_contract_as_customer_atomic"'), true);
      assert.equal(source.includes('from("sales_contract_signatures")'), true);
      assert.equal(
        source.includes('from("sales_contract_signatures").insert('),
        false,
      );
      assert.equal(
        source.includes('from("sales_contract_signatures").update('),
        false,
      );
      assert.equal(
        source.includes('from("sales_contract_signatures").delete('),
        false,
      );
      assert.equal(
        source.includes('from("sales_contract_signatures").upsert('),
        false,
      );
      assert.equal(source.includes('from("sales_contracts").update('), false);
      assert.equal(source.includes('from("sales_contract_versions").update('), false);
    },
  },
];

async function main() {
  let passed = 0;

  for (const test of tests) {
    await test.run();
    passed += 1;
  }

  console.log(
    `customer-contract-acceptance: ${passed}/${tests.length} tests passed`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

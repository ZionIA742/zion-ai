import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  decideQuoteApprovalFromPersistedInbound,
  QUOTE_APPROVAL_DECISION_RPC,
} from "./quote-approval-decision";

const request = {
  id: "request-1",
  organization_id: "org-1",
  store_id: "store-1",
  responsible_id: "responsible-1",
  commercial_opportunity_id: "opportunity-1",
  lifecycle_cycle: 2,
  quote_id: "quote-1",
  quote_version_id: "version-2",
  status: "awaiting_responsible" as const,
};

function query(data: unknown, error: { message: string } | null = null) {
  const builder = {
    eq() {
      return builder;
    },
    in() {
      return builder;
    },
    select() {
      return builder;
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve({ data, error }).then(resolve, reject);
    },
  };
  return builder;
}

function createSupabase(args?: {
  requests?: unknown;
  contextParts?: unknown;
  rpcData?: unknown;
  rpcError?: { message: string } | null;
}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      if (table === "p9_responsible_commercial_approval_requests") {
        return query(args?.requests ?? [request]);
      }
      return query(args?.contextParts ?? [{ request_id: request.id }]);
    },
    async rpc(name: string, rpcArgs: Record<string, unknown>) {
      rpcCalls.push({ name, args: rpcArgs });
      return {
        data:
          args?.rpcData ?? [
            {
              outcome: "decided",
              status: "approved",
              request_id: request.id,
              quote_version_id: request.quote_version_id,
            },
          ],
        error: args?.rpcError ?? null,
      };
    },
  };
  return { client: client as never, rpcCalls };
}

const base = {
  organizationId: "org-1",
  storeId: "store-1",
  responsibleId: "responsible-1",
  inboundMessageId: "inbound-1",
  externalMessageId: "wamid.decision-1",
  content: "Aprovo o orçamento",
};

test("short approval without context does not call the canonical RPC", async () => {
  const supabase = createSupabase();
  const result = await decideQuoteApprovalFromPersistedInbound({
    supabase: supabase.client,
    ...base,
    content: "Aprovo",
  });

  assert.equal(result, null);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("short approval replying to the correct PDF calls the canonical RPC", async () => {
  const supabase = createSupabase();
  const result = await decideQuoteApprovalFromPersistedInbound({
    supabase: supabase.client,
    ...base,
    content: "Aprovo",
    contextMessageId: "wamid.pdf-1",
  });

  assert.deepEqual(result, {
    outcome: "decided",
    status: "approved",
    requestId: "request-1",
    quoteVersionId: "version-2",
  });
  assert.equal(supabase.rpcCalls.length, 1);
  assert.equal(supabase.rpcCalls[0]?.name, QUOTE_APPROVAL_DECISION_RPC);
  assert.deepEqual(supabase.rpcCalls[0]?.args, {
    p_request_id: "request-1",
    p_organization_id: "org-1",
    p_store_id: "store-1",
    p_responsible_id: "responsible-1",
    p_commercial_opportunity_id: "opportunity-1",
    p_expected_lifecycle_cycle: 2,
    p_quote_id: "quote-1",
    p_quote_version_id: "version-2",
    p_decision_inbound_message_id: "inbound-1",
    p_decision_external_message_id: "wamid.decision-1",
    p_decision: "approved",
  });
});

test("full proposal approval without context is accepted for one awaiting request", async () => {
  const supabase = createSupabase();
  const result = await decideQuoteApprovalFromPersistedInbound({
    supabase: supabase.client,
    ...base,
    content: "Aprovo a proposta",
  });

  assert.equal(result?.outcome, "decided");
  assert.equal(supabase.rpcCalls.length, 1);
});

test("rejected decision and replay are accepted only with the matching canonical result", async () => {
  const rejected = createSupabase({
    rpcData: [
      {
        outcome: "decided",
        status: "rejected",
        request_id: request.id,
        quote_version_id: request.quote_version_id,
      },
    ],
  });
  const rejectedResult = await decideQuoteApprovalFromPersistedInbound({
    supabase: rejected.client,
    ...base,
    content: "Não autorizo o envio da proposta",
  });
  assert.equal(rejectedResult?.status, "rejected");

  const replayed = createSupabase({
    requests: [
      {
        ...request,
        status: "approved" as const,
        decision_inbound_message_id: base.inboundMessageId,
        decision_external_message_id: base.externalMessageId,
      },
    ],
    rpcData: [
      {
        outcome: "replayed",
        status: "approved",
        request_id: request.id,
        quote_version_id: request.quote_version_id,
      },
    ],
  });
  const replayResult = await decideQuoteApprovalFromPersistedInbound({
    supabase: replayed.client,
    ...base,
  });
  assert.equal(replayResult?.outcome, "replayed");
});

test("an old approved request does not interfere with a new awaiting request", async () => {
  const oldRequest = {
    ...request,
    id: "request-old",
    status: "approved" as const,
    decision_inbound_message_id: "inbound-old",
    decision_external_message_id: "wamid.old",
  };
  const newRequest = { ...request, id: "request-new", status: "awaiting_responsible" as const };
  const supabase = createSupabase({
    requests: [oldRequest, newRequest],
    rpcData: [
      {
        outcome: "decided",
        status: "approved",
        request_id: newRequest.id,
        quote_version_id: newRequest.quote_version_id,
      },
    ],
  });

  const result = await decideQuoteApprovalFromPersistedInbound({
    supabase: supabase.client,
    ...base,
    content: "Aprovo a proposta",
  });

  assert.equal(result?.requestId, newRequest.id);
  assert.equal(supabase.rpcCalls[0]?.args.p_request_id, newRequest.id);
});

test("a new message for an old approved request is not treated as replay", async () => {
  const oldRequest = {
    ...request,
    status: "approved" as const,
    decision_inbound_message_id: "inbound-old",
    decision_external_message_id: "wamid.old",
  };
  const supabase = createSupabase({ requests: [oldRequest] });
  const result = await decideQuoteApprovalFromPersistedInbound({
    supabase: supabase.client,
    ...base,
    content: "Aprovo a proposta",
    inboundMessageId: "inbound-new",
    externalMessageId: "wamid.new",
  });

  assert.equal(result, null);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("two awaiting requests, or an uncorrelated response, do not call the decision RPC", async () => {
  const ambiguous = createSupabase();
  const ambiguousResult = await decideQuoteApprovalFromPersistedInbound({
    supabase: ambiguous.client,
    ...base,
    content: "Pode seguir",
  });
  assert.equal(ambiguousResult, null);
  assert.equal(ambiguous.rpcCalls.length, 0);

  const twoAwaiting = createSupabase({
    requests: [request, { ...request, id: "request-2" }],
  });
  const twoAwaitingResult = await decideQuoteApprovalFromPersistedInbound({
    supabase: twoAwaiting.client,
    ...base,
    content: "Aprovo a proposta",
  });
  assert.equal(twoAwaitingResult, null);
  assert.equal(twoAwaiting.rpcCalls.length, 0);

  const uncorrelated = createSupabase({ requests: [request], contextParts: [] });
  const uncorrelatedResult = await decideQuoteApprovalFromPersistedInbound({
    supabase: uncorrelated.client,
    ...base,
    contextMessageId: "wamid.other-message",
  });
  assert.equal(uncorrelatedResult, null);
  assert.equal(uncorrelated.rpcCalls.length, 0);

  const absent = createSupabase({ requests: [] });
  const absentResult = await decideQuoteApprovalFromPersistedInbound({
    supabase: absent.client,
    ...base,
  });
  assert.equal(absentResult, null);
  assert.equal(absent.rpcCalls.length, 0);
});

test("RPC failure and invalid RPC result fail closed without success", async () => {
  const failed = createSupabase({ rpcError: { message: "stale_version" } });
  await assert.rejects(
    decideQuoteApprovalFromPersistedInbound({ supabase: failed.client, ...base }),
    /P9_QUOTE_DECISION_RPC_FAILED:stale_version/,
  );

  const invalid = createSupabase({ rpcData: [{ outcome: "decided", status: "approved" }] });
  await assert.rejects(
    decideQuoteApprovalFromPersistedInbound({ supabase: invalid.client, ...base }),
    /P9_QUOTE_DECISION_RPC_RETURN_INVALID/,
  );
});

test("inbound routing invokes the decision hook only after the message insert has an id", () => {
  const source = readFileSync(
    "src/lib/server/assistant/responsible-whatsapp-conversation.ts",
    "utf8",
  );
  assert.ok(
    source.indexOf("const { data: insertedInbound") <
      source.indexOf("if (args.onInboundPersisted"),
  );
  assert.match(source, /sender_role: "store_responsible"/);
  assert.match(source, /origin: "whatsapp"/);
  assert.match(source, /external_message_id: externalMessageId/);
  assert.match(source, /context_message_id/);
});

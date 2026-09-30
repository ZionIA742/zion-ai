import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runPostTechnicalVisitRuntime } from "./post-technical-visit-runtime";

type Chain = {
  responseId: string;
  appointmentId: string;
  opportunityId: string;
  lifecycleCycle: number;
  resultEventId: string;
  decisionId: string;
  resultKind: "viable" | "pending";
};

type ResultEvent = {
  id: string;
  organization_id: string;
  store_id: string;
  appointment_id: string;
  source_response_id: string;
};

function createIntegrationStore(chains: Chain[]) {
  const responses = new Map(
    chains.map((chain) => [
      chain.responseId,
      {
        id: chain.responseId,
        organization_id: "org-7-6",
        store_id: "store-7-6",
        raw_content: `resposta da visita ${chain.opportunityId}`,
      },
    ]),
  );
  const results = new Map<string, ResultEvent>();
  const current = new Map<string, { organization_id: string; store_id: string; appointment_id: string; current_result_event_id: string }>();
  const queryLog: Array<{ table: string; filters: Array<[string, unknown]>; ordered: boolean }> = [];
  const decisions: Array<{ decisionId: string; resultEventId: string; opportunityId: string; lifecycleCycle: number }> = [];
  const effects: string[] = [];

  const supabase = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let ordered = false;
      const query = {
        select() {
          return query;
        },
        eq(field: string, value: unknown) {
          filters.push([field, value]);
          return query;
        },
        order() {
          ordered = true;
          return query;
        },
        maybeSingle() {
          queryLog.push({ table, filters: [...filters], ordered });
          const source = table === "schedule_post_appointment_followup_responses"
            ? [...responses.values()]
            : table === "store_technical_visit_result_events"
              ? [...results.values()]
              : [...current.values()];
          const data = source.find((row) =>
            filters.every(([field, value]) => (row as Record<string, unknown>)[field] === value),
          ) || null;
          return Promise.resolve({ data, error: null });
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;

  function persist(responseId: string) {
    const chain = chains.find((candidate) => candidate.responseId === responseId);
    assert.ok(chain, `unknown response ${responseId}`);
    const event: ResultEvent = {
      id: chain.resultEventId,
      organization_id: "org-7-6",
      store_id: "store-7-6",
      appointment_id: chain.appointmentId,
      source_response_id: chain.responseId,
    };
    results.set(responseId, event);
    current.set(chain.appointmentId, {
      organization_id: "org-7-6",
      store_id: "store-7-6",
      appointment_id: chain.appointmentId,
      current_result_event_id: chain.resultEventId,
    });
    return { eventId: chain.resultEventId };
  }

  function decide(resultEventId: string) {
    const event = [...results.values()].find((candidate) => candidate.id === resultEventId);
    assert.ok(event, `unknown result ${resultEventId}`);
    const chain = chains.find((candidate) => candidate.resultEventId === resultEventId);
    assert.ok(chain, `result is not linked to a known chain: ${resultEventId}`);
    const pointer = current.get(event.appointment_id);
    assert.equal(pointer?.current_result_event_id, resultEventId);
    decisions.push({
      decisionId: chain.decisionId,
      resultEventId,
      opportunityId: chain.opportunityId,
      lifecycleCycle: chain.lifecycleCycle,
    });
    return {
      ok: true as const,
      decision: {
        decisionId: chain.decisionId,
        organizationId: "org-7-6",
        storeId: "store-7-6",
        appointmentId: chain.appointmentId,
        commercialOpportunityId: chain.opportunityId,
        lifecycleCycle: chain.lifecycleCycle,
        resultEventId,
        decisionKind: "needs_resolution" as const,
        decisionReason: "technical_visit_result_pending",
        decisionBasis: {},
        replayed: decisions.filter((candidate) => candidate.resultEventId === resultEventId).length > 1,
      },
    };
  }

  return { chains, supabase, results, current, queryLog, decisions, effects, persist, decide };
}

function extraction(resultKind: Chain["resultKind"]) {
  return {
    extraction: {
      resultKind,
      evidenceText: resultKind === "pending" ? "aguardando confirmação" : "visita viável",
      adjustmentSummary: null,
      uncertaintyReason: null,
      occurrence: "occurred" as const,
      occurrenceEvidenceText: "a visita ocorreu",
    },
    response: null,
    failureReason: null,
  };
}

test("7.6 integrates two explicit opportunity chains without cross-context lookup", async () => {
  const chains: Chain[] = [
    {
      responseId: "response-a",
      appointmentId: "appointment-a",
      opportunityId: "opportunity-a",
      lifecycleCycle: 1,
      resultEventId: "result-a",
      decisionId: "decision-a",
      resultKind: "viable",
    },
    {
      responseId: "response-b",
      appointmentId: "appointment-b",
      opportunityId: "opportunity-b",
      lifecycleCycle: 2,
      resultEventId: "result-b",
      decisionId: "decision-b",
      resultKind: "pending",
    },
  ];
  const store = createIntegrationStore(chains);
  const extractCalls: string[] = [];
  const persistCalls: string[] = [];
  const decideCalls: string[] = [];

  const run = (chain: Chain) => runPostTechnicalVisitRuntime({
    supabase: store.supabase,
    organizationId: "org-7-6",
    storeId: "store-7-6",
    responseId: chain.responseId,
    dependencies: {
      extract: async (rawContent) => {
        extractCalls.push(rawContent);
        return extraction(chain.resultKind);
      },
      persist: async (args) => {
        persistCalls.push(args.responseId);
        return store.persist(args.responseId);
      },
      decide: async (args) => {
        decideCalls.push(args.resultEventId);
        return store.decide(args.resultEventId);
      },
    },
  });

  const resultA = await run(chains[0]);
  const resultB = await run(chains[1]);

  assert.equal(resultA.resultEventId, "result-a");
  assert.equal(resultB.resultEventId, "result-b");
  assert.deepEqual(persistCalls, ["response-a", "response-b"]);
  assert.deepEqual(decideCalls, ["result-a", "result-b"]);
  assert.deepEqual(
    store.decisions.map(({ decisionId, resultEventId, opportunityId, lifecycleCycle }) => ({
      decisionId,
      resultEventId,
      opportunityId,
      lifecycleCycle,
    })),
    [
      { decisionId: "decision-a", resultEventId: "result-a", opportunityId: "opportunity-a", lifecycleCycle: 1 },
      { decisionId: "decision-b", resultEventId: "result-b", opportunityId: "opportunity-b", lifecycleCycle: 2 },
    ],
  );
  assert.equal(store.effects.length, 0);

  const responseQueries = store.queryLog.filter((query) => query.table === "schedule_post_appointment_followup_responses");
  const resultQueries = store.queryLog.filter((query) => query.table === "store_technical_visit_result_events");
  assert.equal(responseQueries.length, 2);
  assert.equal(resultQueries.length, 2);
  assert.deepEqual(resultQueries.map((query) => query.filters), [
    [
      ["source_response_id", "response-a"],
      ["organization_id", "org-7-6"],
      ["store_id", "store-7-6"],
    ],
    [
      ["source_response_id", "response-b"],
      ["organization_id", "org-7-6"],
      ["store_id", "store-7-6"],
    ],
  ]);
  assert.equal(store.queryLog.some((query) => query.ordered), false);
});

test("7.6 retry reuses response A result and decision without a second result", async () => {
  const chain: Chain = {
    responseId: "response-a",
    appointmentId: "appointment-a",
    opportunityId: "opportunity-a",
    lifecycleCycle: 1,
    resultEventId: "result-a",
    decisionId: "decision-a",
    resultKind: "pending",
  };
  const store = createIntegrationStore([chain]);
  let extractCalls = 0;
  let persistCalls = 0;
  let decideCalls = 0;

  const run = () => runPostTechnicalVisitRuntime({
    supabase: store.supabase,
    organizationId: "org-7-6",
    storeId: "store-7-6",
    responseId: chain.responseId,
    dependencies: {
      extract: async () => {
        extractCalls += 1;
        return extraction(chain.resultKind);
      },
      persist: async (args) => {
        persistCalls += 1;
        return store.persist(args.responseId);
      },
      decide: async (args) => {
        decideCalls += 1;
        return store.decide(args.resultEventId);
      },
    },
  });

  const first = await run();
  const replay = await run();

  assert.equal(first.resultEventId, "result-a");
  assert.equal(replay.resultEventId, "result-a");
  assert.equal(extractCalls, 1);
  assert.equal(persistCalls, 1);
  assert.equal(decideCalls, 2);
  assert.equal(store.results.size, 1);
  assert.equal(store.decisions.length, 2);
  assert.equal(store.decisions[1].opportunityId, "opportunity-a");
  assert.equal(store.effects.length, 0);
});

test("7.6 superseded result is terminal and current missing fails closed", async () => {
  const chain: Chain = {
    responseId: "response-a",
    appointmentId: "appointment-a",
    opportunityId: "opportunity-a",
    lifecycleCycle: 1,
    resultEventId: "result-old",
    decisionId: "decision-a",
    resultKind: "pending",
  };
  const store = createIntegrationStore([chain]);
  store.results.set(chain.responseId, {
    id: chain.resultEventId,
    organization_id: "org-7-6",
    store_id: "store-7-6",
    appointment_id: chain.appointmentId,
    source_response_id: chain.responseId,
  });
  store.current.set(chain.appointmentId, {
    organization_id: "org-7-6",
    store_id: "store-7-6",
    appointment_id: chain.appointmentId,
    current_result_event_id: "result-new",
  });

  let extractCalls = 0;
  let persistCalls = 0;
  let decideCalls = 0;
  const run = () => runPostTechnicalVisitRuntime({
    supabase: store.supabase,
    organizationId: "org-7-6",
    storeId: "store-7-6",
    responseId: chain.responseId,
    dependencies: {
      extract: async () => { extractCalls += 1; return extraction(chain.resultKind); },
      persist: async () => { persistCalls += 1; return { eventId: "wrong" }; },
      decide: async () => { decideCalls += 1; return store.decide(chain.resultEventId); },
    },
  });

  assert.deepEqual(await run(), {
    status: "superseded",
    responseId: chain.responseId,
    resultEventId: chain.resultEventId,
  });
  assert.equal(extractCalls, 0);
  assert.equal(persistCalls, 0);
  assert.equal(decideCalls, 0);

  store.current.delete(chain.appointmentId);
  await assert.rejects(run(), /POST_TECHNICAL_VISIT_RESULT_CURRENT_MISSING/);
  assert.equal(extractCalls, 0);
  assert.equal(persistCalls, 0);
  assert.equal(decideCalls, 0);
  assert.equal(store.effects.length, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runPostTechnicalVisitRuntime, persistPostTechnicalVisitResultBySystem } from "./post-technical-visit-runtime";

function canonicalSupabase(
  response: unknown,
  existingResult: unknown = null,
  resultError: { message: string } | null = null,
  currentResult: unknown = null,
) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const query = {
        select() { return query; },
        eq(field: string, value: unknown) {
          filters.push([field, value]);
          return query;
        },
        maybeSingle() {
          const source = table === "store_technical_visit_result_events"
            ? existingResult
            : table === "store_technical_visit_result_current"
              ? currentResult
              : response;
          const data = source && typeof source === "object" &&
            filters.every(([field, value]) => (source as Record<string, unknown>)[field] === value)
            ? source
            : null;
          return Promise.resolve({
            data,
            error: table === "store_technical_visit_result_events"
              ? resultError
              : null,
          });
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

function decision(resultEventId: string) {
  return {
    ok: true as const,
    decision: {
      decisionId: "decision-1",
      organizationId: "org-1",
      storeId: "store-1",
      appointmentId: "appointment-1",
      commercialOpportunityId: "opportunity-1",
      lifecycleCycle: 1,
      resultEventId,
      decisionKind: "needs_resolution" as const,
      decisionReason: "technical_visit_occurrence_unclear",
      decisionBasis: {},
      replayed: false,
    },
  };
}

test("runtime uses the canonical response and runs result before decision", async () => {
  const calls: string[] = [];
  let extractedRaw = "";
  let resultOperationKey = "";
  let decisionOperationKey = "";

  const result = await runPostTechnicalVisitRuntime({
    supabase: canonicalSupabase({
      id: "response-1",
      organization_id: "org-1",
      store_id: "store-1",
      raw_content: "A visita ocorreu, mas depende de confirmacao.",
    }),
    organizationId: "org-1",
    storeId: "store-1",
    responseId: "response-1",
    dependencies: {
      extract: async (raw) => {
        calls.push("extract");
        extractedRaw = raw;
        return {
          extraction: {
            resultKind: "pending",
            evidenceText: "depende de confirmacao",
            adjustmentSummary: null,
            uncertaintyReason: null,
            occurrence: "occurred",
            occurrenceEvidenceText: "A visita ocorreu",
          },
          response: null,
          failureReason: null,
        };
      },
      persist: async (args) => {
        calls.push("persist");
        resultOperationKey = args.operationKey;
        assert.equal(args.responseId, "response-1");
        return { eventId: "result-event-1" };
      },
      decide: async (args) => {
        calls.push("decide");
        decisionOperationKey = args.operationKey;
        assert.equal(args.resultEventId, "result-event-1");
        return decision("result-event-1");
      },
    },
  });

  assert.equal(extractedRaw, "A visita ocorreu, mas depende de confirmacao.");
  assert.deepEqual(calls, ["extract", "persist", "decide"]);
  assert.equal(resultOperationKey, "p9:post-technical-visit-result:response-1");
  assert.equal(decisionOperationKey, "p9:post-technical-visit-decision:response-1");
  assert.deepEqual(result, {
    status: "decided",
    responseId: "response-1",
    resultEventId: "result-event-1",
    decisionId: "decision-1",
    decisionKind: "needs_resolution",
    decisionReason: "technical_visit_occurrence_unclear",
  });
});

test("runtime fails closed for response scope and raw content", async () => {
  await assert.rejects(
    runPostTechnicalVisitRuntime({
      supabase: canonicalSupabase({
        id: "response-1",
        organization_id: "other-org",
        store_id: "store-1",
        raw_content: "texto",
      }),
      organizationId: "org-1",
      storeId: "store-1",
      responseId: "response-1",
      dependencies: { extract: async () => { throw new Error("must not run"); } },
    }),
    /SCOPE_MISMATCH/,
  );
  await assert.rejects(
    runPostTechnicalVisitRuntime({
      supabase: canonicalSupabase({
        id: "response-1",
        organization_id: "org-1",
        store_id: "store-1",
        raw_content: "",
      }),
      organizationId: "org-1",
      storeId: "store-1",
      responseId: "response-1",
    }),
    /RAW_CONTENT_MISSING/,
  );
});

test("extractor, result writer, and decision failures stop the chain", async () => {
  const base = {
    supabase: canonicalSupabase({
      id: "response-1",
      organization_id: "org-1",
      store_id: "store-1",
      raw_content: "resposta canônica",
    }),
    organizationId: "org-1",
    storeId: "store-1",
    responseId: "response-1",
  };

  let persistCalls = 0;
  await assert.rejects(
    runPostTechnicalVisitRuntime({
      ...base,
      dependencies: {
        extract: async () => ({
          extraction: {} as never,
          response: null,
          failureReason: "invalid_structured_extraction",
        }),
        persist: async () => { persistCalls += 1; return { eventId: "never" }; },
      },
    }),
    /EXTRACTION_FAILED/,
  );
  assert.equal(persistCalls, 0);

  let writerCalls = 0;
  let writerDecisionCalls = 0;
  await assert.rejects(
    runPostTechnicalVisitRuntime({
      ...base,
      dependencies: {
        extract: async () => ({ extraction: {} as never, response: null, failureReason: null }),
        persist: async () => {
          writerCalls += 1;
          throw new Error("result writer transport");
        },
        decide: async () => {
          writerDecisionCalls += 1;
          return decision("never");
        },
      },
    }),
    /result writer transport/,
  );
  assert.equal(writerCalls, 1);
  assert.equal(writerDecisionCalls, 0);

  let decideCalls = 0;
  await assert.rejects(
    runPostTechnicalVisitRuntime({
      ...base,
      dependencies: {
        extract: async () => ({ extraction: {} as never, response: null, failureReason: null }),
        persist: async () => ({ eventId: "result-1" }),
        decide: async () => { decideCalls += 1; throw new Error("decision transport"); },
      },
    }),
    /decision transport/,
  );
  assert.equal(decideCalls, 1);
});

test("runtime retries an unmaterialized response through extraction, result, and decision", async () => {
  const calls: string[] = [];
  const result = await runPostTechnicalVisitRuntime({
    supabase: canonicalSupabase({
      id: "response-1",
      organization_id: "org-1",
      store_id: "store-1",
      raw_content: "ocorreu",
    }),
    organizationId: "org-1",
    storeId: "store-1",
    responseId: "response-1",
    dependencies: {
      extract: async () => {
        calls.push("extract");
        return { extraction: {} as never, response: null, failureReason: null };
      },
      persist: async () => {
        calls.push("persist");
        return { eventId: "result-1" };
      },
      decide: async () => {
        calls.push("decide");
        return decision("result-1");
      },
    },
  });

  assert.deepEqual(calls, ["extract", "persist", "decide"]);
  assert.equal(result.resultEventId, "result-1");
});

test("runtime reuses the result event for the same response without extraction or persistence", async () => {
  const calls: string[] = [];
  const result = await runPostTechnicalVisitRuntime({
    supabase: canonicalSupabase({
      id: "response-1",
      organization_id: "org-1",
      store_id: "store-1",
      raw_content: "ocorreu",
    }, {
      id: "result-existing",
      organization_id: "org-1",
      store_id: "store-1",
      appointment_id: "appointment-1",
      source_response_id: "response-1",
    }, null, {
      organization_id: "org-1",
      store_id: "store-1",
      appointment_id: "appointment-1",
      current_result_event_id: "result-existing",
    }),
    organizationId: "org-1",
    storeId: "store-1",
    responseId: "response-1",
    dependencies: {
      extract: async () => {
        calls.push("extract");
        throw new Error("extractor must not run");
      },
      persist: async () => {
        calls.push("persist");
        return { eventId: "wrong" };
      },
      decide: async (args) => {
        calls.push(`decide:${args.resultEventId}`);
        return decision(args.resultEventId);
      },
    },
  });

  assert.deepEqual(calls, ["decide:result-existing"]);
  assert.equal(result.resultEventId, "result-existing");
});

test("runtime returns superseded when current points to another result event", async () => {
  const calls: string[] = [];
  const run = () => runPostTechnicalVisitRuntime({
    supabase: canonicalSupabase({
      id: "response-1",
      organization_id: "org-1",
      store_id: "store-1",
      raw_content: "ocorreu",
    }, {
      id: "result-old",
      organization_id: "org-1",
      store_id: "store-1",
      appointment_id: "appointment-1",
      source_response_id: "response-1",
    }, null, {
      organization_id: "org-1",
      store_id: "store-1",
      appointment_id: "appointment-1",
      current_result_event_id: "result-new",
    }),
    organizationId: "org-1",
    storeId: "store-1",
    responseId: "response-1",
    dependencies: {
      extract: async () => { calls.push("extract"); throw new Error("must not extract"); },
      persist: async () => { calls.push("persist"); return { eventId: "wrong" }; },
      decide: async () => { calls.push("decide"); return decision("wrong"); },
    },
  });

  const first = await run();
  const second = await run();
  assert.deepEqual(first, {
    status: "superseded",
    responseId: "response-1",
    resultEventId: "result-old",
  });
  assert.deepEqual(second, first);
  assert.deepEqual(calls, []);
});

test("runtime fails closed when an existing result has no current pointer", async () => {
  const calls: string[] = [];
  const run = () => runPostTechnicalVisitRuntime({
    supabase: canonicalSupabase({
      id: "response-1",
      organization_id: "org-1",
      store_id: "store-1",
      raw_content: "ocorreu",
    }, {
      id: "result-orphan",
      organization_id: "org-1",
      store_id: "store-1",
      appointment_id: "appointment-1",
      source_response_id: "response-1",
    }),
    organizationId: "org-1",
    storeId: "store-1",
    responseId: "response-1",
    dependencies: {
      extract: async () => { calls.push("extract"); throw new Error("must not extract"); },
      persist: async () => { calls.push("persist"); return { eventId: "wrong" }; },
      decide: async () => { calls.push("decide"); return decision("wrong"); },
    },
  });

  await assert.rejects(run(), /POST_TECHNICAL_VISIT_RESULT_CURRENT_MISSING/);
  await assert.rejects(run(), /POST_TECHNICAL_VISIT_RESULT_CURRENT_MISSING/);
  assert.deepEqual(calls, []);
});

test("runtime fails closed when the current pointer row is structurally invalid", async () => {
  await assert.rejects(
    runPostTechnicalVisitRuntime({
      supabase: canonicalSupabase({
        id: "response-1", organization_id: "org-1", store_id: "store-1", raw_content: "ocorreu",
      }, {
        id: "result-orphan", organization_id: "org-1", store_id: "store-1", appointment_id: "appointment-1", source_response_id: "response-1",
      }, null, {
        organization_id: "org-1", store_id: "store-1", appointment_id: "appointment-1",
      }),
      organizationId: "org-1",
      storeId: "store-1",
      responseId: "response-1",
    }),
    /POST_TECHNICAL_VISIT_RESULT_CURRENT_INVALID/,
  );
});

test("runtime filters existing result lookup by explicit tenant and store scope", async () => {
  let extractCalls = 0;
  const result = await runPostTechnicalVisitRuntime({
    supabase: canonicalSupabase({
      id: "response-1",
      organization_id: "org-1",
      store_id: "store-1",
      raw_content: "ocorreu",
    }, {
      id: "result-other-scope",
      organization_id: "org-2",
      store_id: "store-2",
      appointment_id: "appointment-1",
      source_response_id: "response-1",
    }),
    organizationId: "org-1",
    storeId: "store-1",
    responseId: "response-1",
    dependencies: {
      extract: async () => {
        extractCalls += 1;
        return { extraction: {} as never, response: null, failureReason: null };
      },
      persist: async () => ({ eventId: "result-scoped" }),
      decide: async () => decision("result-scoped"),
    },
  });
  assert.equal(result.status, "decided");
  assert.equal(extractCalls, 1);
});

test("runtime result lookup is scoped by response id and never uses latest", async () => {
  const source = readFileSync("src/lib/server/post-technical-visit-runtime.ts", "utf8");
  assert.match(source, /from\("store_technical_visit_result_events"\)/);
  assert.match(source, /eq\("source_response_id", args\.responseId\)/);
  assert.doesNotMatch(source, /order\([^\n]*created_at/);
  assert.doesNotMatch(source, /latest/i);
});

test("runtime reuses persisted result when only the prior decision failed", async () => {
  let run = 0;
  let extractCalls = 0;
  let persistCalls = 0;
  const base = {
    organizationId: "org-1",
    storeId: "store-1",
    responseId: "response-1",
  };

  await assert.rejects(
    runPostTechnicalVisitRuntime({
      ...base,
      supabase: canonicalSupabase({
        id: "response-1", organization_id: "org-1", store_id: "store-1", raw_content: "ocorreu",
      }),
      dependencies: {
        extract: async () => { extractCalls += 1; return { extraction: {} as never, response: null, failureReason: null }; },
        persist: async () => { persistCalls += 1; return { eventId: "result-1" }; },
        decide: async () => { run += 1; throw new Error("decision failed"); },
      },
    }),
    /decision failed/,
  );

  const retry = await runPostTechnicalVisitRuntime({
    ...base,
    supabase: canonicalSupabase({
      id: "response-1", organization_id: "org-1", store_id: "store-1", raw_content: "ocorreu",
    }, {
      id: "result-1", organization_id: "org-1", store_id: "store-1", appointment_id: "appointment-1", source_response_id: "response-1",
    }, null, {
      organization_id: "org-1", store_id: "store-1", appointment_id: "appointment-1", current_result_event_id: "result-1",
    }),
    dependencies: {
      extract: async () => { extractCalls += 1; throw new Error("must not re-extract"); },
      persist: async () => { persistCalls += 1; return { eventId: "wrong" }; },
      decide: async (args) => { run += 1; return decision(args.resultEventId); },
    },
  });

  assert.equal(retry.resultEventId, "result-1");
  assert.equal(extractCalls, 1);
  assert.equal(persistCalls, 1);
  assert.equal(run, 2);
});

test("result adapter maps only canonical extractor fields and preserves rpc output", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve({
        data: [{ event_id: "event-1" }],
        error: null,
      });
    },
  };
  const result = await persistPostTechnicalVisitResultBySystem({
    supabase,
    responseId: "response-1",
    operationKey: "p9:post-technical-visit-result:response-1",
    extraction: {
      resultKind: "viable",
      evidenceText: "viável",
      adjustmentSummary: null,
      uncertaintyReason: null,
      occurrence: "occurred",
      occurrenceEvidenceText: "ocorreu",
    },
  });
  assert.equal(result.eventId, "event-1");
  assert.equal(calls[0].name, "persist_post_technical_visit_result_by_system");
  assert.deepEqual(calls[0].args, {
    p_source_response_id: "response-1",
    p_result_kind: "viable",
    p_evidence_text: "viável",
    p_adjustment_summary: null,
    p_uncertainty_reason: null,
    p_occurrence: "occurred",
    p_occurrence_evidence_text: "ocorreu",
    p_operation_key: "p9:post-technical-visit-result:response-1",
    p_metadata: {
      authority: "p9_7_5_runtime_v1",
      source_response_id: "response-1",
    },
  });
});

test("inbox calls 7.5 runtime before marking the responsible inbound processed", () => {
  const source = readFileSync("src/lib/server/whatsapp-inbox-processor.ts", "utf8");
  const responsibleBranch = source.indexOf("if (result.handled) {");
  const runtimeIndex = source.indexOf("const runtime = await runPostTechnicalVisitRuntime({", responsibleBranch);
  const processedIndex = source.indexOf("await markInboxProcessed(supabase, inbox.id)", runtimeIndex);
  assert.ok(runtimeIndex >= 0);
  assert.ok(processedIndex > runtimeIndex);
});

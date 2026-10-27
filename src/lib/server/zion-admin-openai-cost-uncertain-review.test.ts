import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENAI_COST_REVIEW_RPC,
  OpenAiCostReviewError,
  recordUncertainOpenAiCostReview,
} from "./zion-admin-openai-cost-uncertain-review";

import type {
  OpenAiCostReviewDependencies,
  OpenAiCostReviewInput,
  OpenAiCostReviewRpc,
} from "./zion-admin-openai-cost-uncertain-review";

import type {
  ZionAdminApiAccessResult,
} from "./zion-admin-api-access";

const USER = "11111111-1111-4111-8111-111111111111";
const OP = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";

function input(
  changes: Partial<OpenAiCostReviewInput> = {},
): OpenAiCostReviewInput {
  return {
    operationId: OP,
    reviewKey: "review:2026-10-27:1",
    finding: "insufficient_evidence",
    reason: "Evidencias insuficientes para concluir a operacao.",
    evidence: {
      inspection: "manual",
      candidates: 0,
    },
    ...changes,
  };
}

function granted(
  options: {
    allowed?: boolean;
    capability?: boolean;
    actor?: string;
    resolvedActor?: string;
  } = {},
): ZionAdminApiAccessResult {
  const actor = options.actor ?? USER;

  return {
    ok: options.allowed ?? true,
    sessionUserId: actor,
    resolution: {
      domain: "zion_admin",
      status: "zion_admin_allowed",
      sessionUserId: options.resolvedActor ?? actor,
      capabilities: options.capability === false
        ? []
        : ["manage_accounts"],
    },
  } as unknown as ZionAdminApiAccessResult;
}

function fresh(changes: Record<string, unknown> = {}) {
  return {
    outcome: "review_recorded",
    operation_id: OP,
    review_event_id: EVENT,
    idempotent_replay: false,
    state: "uncertain",
    review_finding: "insufficient_evidence",
    operation_modified: false,
    snapshot_modified: false,
    financial_confirmation_performed: false,
    retry_authorized: false,
    retry_scheduled: false,
    resolution: "requires_manual_reconciliation",
    ...changes,
  };
}

function replay(changes: Record<string, unknown> = {}) {
  return {
    outcome: "review_already_recorded",
    operation_id: OP,
    review_event_id: EVENT,
    idempotent_replay: true,
    state: "uncertain",
    operation_modified: false,
    snapshot_modified: false,
    financial_confirmation_performed: false,
    retry_authorized: false,
    retry_scheduled: false,
    ...changes,
  };
}

function harness(
  data: unknown = fresh(),
  changes: Partial<OpenAiCostReviewDependencies> = {},
) {
  const calls: string[] = [];

  const dependencies: OpenAiCostReviewDependencies = {
    resolveAccess: async () => {
      calls.push("access");
      return granted();
    },
    rpc: async (name, parameters) => {
      calls.push("rpc");
      assert.equal(name, OPENAI_COST_REVIEW_RPC);
      assert.deepEqual(parameters, {
        p_operation_id: OP,
        p_review_key: "review:2026-10-27:1",
        p_review_finding: "insufficient_evidence",
        p_review_reason:
          "Evidencias insuficientes para concluir a operacao.",
        p_review_evidence: {
          inspection: "manual",
          candidates: 0,
        },
        p_actor: USER,
      });
      return { data, error: null };
    },
    ...changes,
  };

  return {
    calls,
    run: (request = input()) =>
      recordUncertainOpenAiCostReview(request, dependencies),
  };
}

function rejectsCode(
  action: () => Promise<unknown>,
  code: string,
) {
  return assert.rejects(
    action,
    (error: unknown) =>
      error instanceof OpenAiCostReviewError &&
      error.code === code,
  );
}

test("records a new review without changing finances", async () => {
  const h = harness();
  const value = await h.run();

  assert.equal(value.outcome, "review_recorded");
  assert.equal(value.reviewEventId, EVENT);
  assert.equal(value.operationModified, false);
  assert.equal(value.snapshotModified, false);
  assert.equal(value.financialConfirmationPerformed, false);
  assert.equal(value.retryAuthorized, false);
  assert.equal(value.retryScheduled, false);
  assert.deepEqual(h.calls, ["access", "rpc"]);
});

test("idempotent replay returns existing audit event", async () => {
  const h = harness(replay());
  const value = await h.run();

  assert.equal(value.outcome, "review_already_recorded");
  assert.equal(value.idempotentReplay, true);
  assert.equal(value.reviewEventId, EVENT);
  assert.deepEqual(h.calls, ["access", "rpc"]);
});

test("all four SQL review findings are accepted", async () => {
  const findings = [
    "insufficient_evidence",
    "matching_candidates_observed",
    "external_confirmation_required",
    "no_financial_effect_observed",
  ] as const;

  for (const finding of findings) {
    let count = 0;

    const value = await recordUncertainOpenAiCostReview(
      input({ finding }),
      {
        resolveAccess: async () => granted(),
        rpc: async (_, params) => {
          count++;
          assert.equal(params.p_review_finding, finding);
          return {
            data: fresh({ review_finding: finding }),
            error: null,
          };
        },
      },
    );

    assert.equal(value.outcome, "review_recorded");
    assert.equal(count, 1);
  }
});

test("invalid operation IDs are rejected before authorization", async () => {
  for (const operationId of ["", "invalid", OP + "x"]) {
    const h = harness();

    await rejectsCode(
      () => h.run(input({ operationId })),
      "OPENAI_COST_REVIEW_INPUT_INVALID",
    );

    assert.deepEqual(h.calls, []);
  }
});

test("review key must be bounded and trimmed", async () => {
  for (const reviewKey of [
    "",
    " bad",
    "bad ",
    "x".repeat(129),
  ]) {
    const h = harness();

    await rejectsCode(
      () => h.run(input({ reviewKey })),
      "OPENAI_COST_REVIEW_INPUT_INVALID",
    );

    assert.deepEqual(h.calls, []);
  }
});

test("unknown review finding is rejected", async () => {
  const h = harness();

  await rejectsCode(
    () => h.run(input({
      finding: "approve_retry" as OpenAiCostReviewInput["finding"],
    })),
    "OPENAI_COST_REVIEW_INPUT_INVALID",
  );

  assert.deepEqual(h.calls, []);
});

test("reason must be trimmed and between 12 and 2000 characters", async () => {
  for (const reason of [
    "",
    "too short",
    " invalid reason text",
    "invalid reason text ",
    "x".repeat(2001),
  ]) {
    const h = harness();

    await rejectsCode(
      () => h.run(input({ reason })),
      "OPENAI_COST_REVIEW_INPUT_INVALID",
    );

    assert.deepEqual(h.calls, []);
  }
});

test("evidence must be a nonempty JSON object", async () => {
  for (const evidence of [
    null,
    [],
    {},
    "text",
    { invalid: undefined },
    { invalid: Number.NaN },
  ]) {
    const h = harness();

    await rejectsCode(
      () => h.run(input({
        evidence: evidence as Record<string, unknown>,
      })),
      "OPENAI_COST_REVIEW_INPUT_INVALID",
    );

    assert.deepEqual(h.calls, []);
  }
});

test("oversized evidence is rejected locally", async () => {
  const h = harness();

  await rejectsCode(
    () => h.run(input({
      evidence: { detail: "x".repeat(17000) },
    })),
    "OPENAI_COST_REVIEW_INPUT_INVALID",
  );

  assert.deepEqual(h.calls, []);
});

test("denied administrator never reaches review RPC", async () => {
  const h = harness(fresh(), {
    resolveAccess: async () => granted({ allowed: false }),
  });

  await rejectsCode(
    h.run,
    "OPENAI_COST_REVIEW_ACCESS_DENIED",
  );

  assert.deepEqual(h.calls, []);
});

test("manage_accounts capability is mandatory", async () => {
  const h = harness(fresh(), {
    resolveAccess: async () => granted({ capability: false }),
  });

  await rejectsCode(
    h.run,
    "OPENAI_COST_REVIEW_ACCESS_DENIED",
  );

  assert.deepEqual(h.calls, []);
});

test("actor must agree with administrative resolution", async () => {
  const h = harness(fresh(), {
    resolveAccess: async () => granted({
      resolvedActor: OP,
    }),
  });

  await rejectsCode(
    h.run,
    "OPENAI_COST_REVIEW_ACCESS_DENIED",
  );

  assert.deepEqual(h.calls, []);
});

test("authorization errors fail closed", async () => {
  const h = harness(fresh(), {
    resolveAccess: async () => {
      throw new Error("session unavailable");
    },
  });

  await rejectsCode(
    h.run,
    "OPENAI_COST_REVIEW_ACCESS_UNAVAILABLE",
  );

  assert.deepEqual(h.calls, []);
});

test("RPC failure remains unconfirmed", async () => {
  let calls = 0;

  const rpc: OpenAiCostReviewRpc = async () => {
    calls++;
    return {
      data: null,
      error: { code: "RPC_UNAVAILABLE" },
    };
  };

  await rejectsCode(
    () => recordUncertainOpenAiCostReview(input(), {
      resolveAccess: async () => granted(),
      rpc,
    }),
    "OPENAI_COST_REVIEW_UNCONFIRMED",
  );

  assert.equal(calls, 1);
});

test("transport uncertainty is never retried", async () => {
  let calls = 0;

  await rejectsCode(
    () => recordUncertainOpenAiCostReview(input(), {
      resolveAccess: async () => granted(),
      rpc: async () => {
        calls++;
        throw new Error("response lost after insert");
      },
    }),
    "OPENAI_COST_REVIEW_UNCONFIRMED",
  );

  assert.equal(calls, 1);
});

test("malformed envelopes are rejected", async () => {
  for (const data of [
    null,
    [],
    "ok",
    {},
    fresh({ outcome: "confirmed" }),
    fresh({ unexpected: true }),
  ]) {
    const h = harness(data);

    await rejectsCode(
      h.run,
      "OPENAI_COST_REVIEW_UNCONFIRMED",
    );
  }
});

test("operation identity mismatch is rejected", async () => {
  const h = harness(fresh({
    operation_id: USER,
  }));

  await rejectsCode(
    h.run,
    "OPENAI_COST_REVIEW_UNCONFIRMED",
  );
});

test("review event ID must be a UUID", async () => {
  const h = harness(fresh({
    review_event_id: "invalid",
  }));

  await rejectsCode(
    h.run,
    "OPENAI_COST_REVIEW_UNCONFIRMED",
  );
});

test("financial or retry effects cannot be returned as success", async () => {
  const flags = [
    "operation_modified",
    "snapshot_modified",
    "financial_confirmation_performed",
    "retry_authorized",
    "retry_scheduled",
  ];

  for (const flag of flags) {
    const h = harness(fresh({ [flag]: true }));

    await rejectsCode(
      h.run,
      "OPENAI_COST_REVIEW_UNCONFIRMED",
    );
  }
});

test("new review must retain exact finding and resolution", async () => {
  for (const changes of [
    { review_finding: "external_confirmation_required" },
    { resolution: "resolved" },
    { idempotent_replay: true },
  ]) {
    const h = harness(fresh(changes));

    await rejectsCode(
      h.run,
      "OPENAI_COST_REVIEW_UNCONFIRMED",
    );
  }
});

test("replay must not pretend to be a new review", async () => {
  for (const changes of [
    { idempotent_replay: false },
    { review_finding: "insufficient_evidence" },
    { resolution: "requires_manual_reconciliation" },
  ]) {
    const h = harness(replay(changes));

    await rejectsCode(
      h.run,
      "OPENAI_COST_REVIEW_UNCONFIRMED",
    );
  }
});

test("one authorized review issues exactly one RPC", async () => {
  let calls = 0;

  const value = await recordUncertainOpenAiCostReview(input(), {
    resolveAccess: async () => granted(),
    rpc: async () => {
      calls++;
      return {
        data: fresh(),
        error: null,
      };
    },
  });

  assert.equal(value.outcome, "review_recorded");
  assert.equal(calls, 1);
});

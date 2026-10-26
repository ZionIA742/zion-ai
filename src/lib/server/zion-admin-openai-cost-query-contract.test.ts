import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOpenAiCostQueryContract,
  OpenAiCostQueryContractError,
  parseOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

const request = {
  startTime: 1792886400,
  endTime: 1793059200,
  groupBy: [
    "project_id",
    "line_item",
  ] as Array<"project_id" | "line_item">,
  projectIds: ["proj-z", "proj-a"],
  apiKeyIds: ["key-a"],
  lineItems: ["responses"],
  limit: 180,
};

function invalid(fn: () => unknown) {
  assert.throws(
    fn,
    (error: unknown) =>
      error instanceof OpenAiCostQueryContractError &&
      error.code === "OPENAI_COST_QUERY_CONTRACT_INVALID",
  );
}

test("constructs provider-compatible canonical identity", () => {
  const result = buildOpenAiCostQueryContract(request);

  assert.equal(
    result.queryIdentity,
    "openai_organization_costs:v1:" +
      "start_time=1792886400&end_time=1793059200" +
      "&bucket_width=1d&limit=180" +
      "&group_by=line_item&group_by=project_id" +
      "&project_ids=proj-a&project_ids=proj-z" +
      "&api_key_ids=key-a&line_items=responses",
  );

  assert.equal(
    result.queryParameters.query_identity,
    result.queryIdentity,
  );

  assert.equal(
    result.queryParameters.start_time,
    request.startTime,
  );

  assert.equal(
    result.queryParameters.end_time,
    request.endTime,
  );

  assert.equal(
    result.queryParameters.financial_competence,
    null,
  );

  assert.match(result.periodStart, /Z$/);
  assert.match(result.periodEnd, /Z$/);
});

test("round trip reconstructs the exact claimed query", () => {
  const expected = buildOpenAiCostQueryContract(request);

  const result = parseOpenAiCostQueryContract(
    expected.queryIdentity,
    JSON.parse(JSON.stringify(expected.queryParameters)),
  );

  assert.deepEqual(result, expected);
});

test("different input ordering yields the same contract", () => {
  const a = buildOpenAiCostQueryContract(request);

  const b = buildOpenAiCostQueryContract({
    ...request,
    groupBy: ["line_item", "project_id"],
    projectIds: ["proj-a", "proj-z"],
  });

  assert.deepEqual(a, b);
});

test("absence of optional filters is canonical", () => {
  const result = buildOpenAiCostQueryContract({
    startTime: request.startTime,
    endTime: request.endTime,
  });

  assert.deepEqual(
    result.queryParameters.group_by,
    [],
  );

  assert.equal(
    "project_ids" in result.queryParameters,
    false,
  );

  assert.equal(
    "limit" in result.queryParameters,
    false,
  );

  assert.deepEqual(
    parseOpenAiCostQueryContract(
      result.queryIdentity,
      result.queryParameters,
    ),
    result,
  );
});

test("rejects mismatched identity or changed date", () => {
  const result = buildOpenAiCostQueryContract(request);

  invalid(() => parseOpenAiCostQueryContract(
    result.queryIdentity + "tampered",
    result.queryParameters,
  ));

  invalid(() => parseOpenAiCostQueryContract(
    result.queryIdentity,
    {
      ...result.queryParameters,
      start_time: request.startTime + 1,
    },
  ));
});

test("rejects missing filters and unexpected financial fields", () => {
  const result = buildOpenAiCostQueryContract(request);

  const withoutProjects = {
    ...result.queryParameters,
  };

  delete withoutProjects.project_ids;

  invalid(() => parseOpenAiCostQueryContract(
    result.queryIdentity,
    withoutProjects,
  ));

  invalid(() => parseOpenAiCostQueryContract(
    result.queryIdentity,
    {
      ...result.queryParameters,
      amount: 100,
    },
  ));

  invalid(() => parseOpenAiCostQueryContract(
    result.queryIdentity,
    {
      ...result.queryParameters,
      financial_competence: "2026-10",
    },
  ));
});

test("rejects reordered or duplicated stored filters", () => {
  const result = buildOpenAiCostQueryContract(request);

  invalid(() => parseOpenAiCostQueryContract(
    result.queryIdentity,
    {
      ...result.queryParameters,
      project_ids: ["proj-z", "proj-a"],
    },
  ));

  invalid(() => buildOpenAiCostQueryContract({
    ...request,
    projectIds: ["proj-a", "proj-a"],
  }));
});

test("rejects unknown groupings, invalid ranges and limits", () => {
  invalid(() => buildOpenAiCostQueryContract({
    ...request,
    groupBy: ["model" as never],
  }));

  invalid(() => buildOpenAiCostQueryContract({
    ...request,
    endTime: request.startTime,
  }));

  invalid(() => buildOpenAiCostQueryContract({
    ...request,
    limit: 181,
  }));

  invalid(() => buildOpenAiCostQueryContract({
    ...request,
    startTime: Number.MAX_SAFE_INTEGER,
  }));
});

test("rejects malformed or incomplete persisted parameters", () => {
  const result = buildOpenAiCostQueryContract(request);

  invalid(() => parseOpenAiCostQueryContract(
    result.queryIdentity,
    {
      ...result.queryParameters,
      group_by: null,
    },
  ));

  invalid(() => parseOpenAiCostQueryContract(
    result.queryIdentity,
    {
      ...result.queryParameters,
      end_time: "1793059200",
    },
  ));

  invalid(() => parseOpenAiCostQueryContract(
    result.queryIdentity,
    {
      ...result.queryParameters,
      bucket_width: "1h",
    },
  ));
});

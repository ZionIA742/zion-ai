import { strict as assert } from "node:assert";
import {
  completeNumberChangeLink,
  requestNumberChangeLinkStart,
  resolveNumberChangeResumeState,
} from "./number-change-link-start";

function mockResponse(body: unknown, ok: boolean) {
  return { ok, json: async () => body };
}

const tests = [
  {
    name: "valid link allows continuing",
    httpOk: true,
    body: { ok: true, status: "started" },
    expectedOk: true,
  },
  {
    name: "expired link blocks",
    httpOk: false,
    body: { ok: false, error: "WHATSAPP_NUMBER_CHANGE_LINK_EXPIRED" },
    expectedOk: false,
  },
  {
    name: "revoked link blocks",
    httpOk: false,
    body: { ok: false, error: "WHATSAPP_NUMBER_CHANGE_LINK_REVOKED" },
    expectedOk: false,
  },
  {
    name: "unauthorized link blocks",
    httpOk: false,
    body: { ok: false, error: "WHATSAPP_NUMBER_CHANGE_LINK_UNAUTHORIZED" },
    expectedOk: false,
  },
  {
    name: "network-equivalent failed HTTP response blocks",
    httpOk: false,
    body: { ok: false, error: "WHATSAPP_NUMBER_CHANGE_LINK_START_FAILED" },
    expectedOk: false,
  },
  {
    name: "invalid API response blocks",
    httpOk: true,
    body: { ok: true },
    expectedOk: false,
  },
];

for (const test of tests) {
  const run = () =>
    requestNumberChangeLinkStart({
      token: "test-token",
      fetcher: async () => mockResponse(test.body, test.httpOk),
    });

  if (test.expectedOk) {
    await run();
  } else {
    await assert.rejects(run, /./, test.name);
  }
}

await assert.rejects(
  () =>
    requestNumberChangeLinkStart({
      token: "test-token",
      fetcher: async () => {
        throw new Error("network failed");
      },
    }),
  /network failed/,
  "network failure blocks",
);

console.log(`whatsapp-number-change start: ${tests.length + 1} tests passed`);

const baseRequest = {
  id: "request-1",
  organization_id: "org-1",
  store_id: "store-1",
  provider: "whatsapp",
  status: "candidate_received",
  candidate_whatsapp_business_account_id: "waba-1",
  candidate_phone_number_id: "phone-1",
  candidate_display_phone_number: "+5511999999999",
};

assert.deepEqual(
  resolveNumberChangeResumeState({ requestId: null, changeRequest: null }),
  { requestId: null, phase: "initial", blocked: false },
  "new link loads the initial phase",
);
assert.equal(
  resolveNumberChangeResumeState({
    requestId: "request-1",
    changeRequest: baseRequest,
  }).phase,
  "cutover",
  "existing candidate restores the cutover phase",
);
assert.equal(
  resolveNumberChangeResumeState({
    requestId: "request-1",
    changeRequest: baseRequest,
  }).requestId,
  "request-1",
  "existing request id is restored",
);
for (const status of ["expired", "revoked", "cancelled"]) {
  const result = resolveNumberChangeResumeState({
    linkStatus: status === "cancelled" ? "started" : status,
    requestId: "request-1",
    changeRequest: { ...baseRequest, status },
  });
  assert.equal(result.blocked, true, `${status} state blocks resume`);
}
assert.equal(
  resolveNumberChangeResumeState({
    requestId: "request-1",
    changeRequest: { ...baseRequest, store_id: "other-store" },
    organizationId: "org-1",
    storeId: "store-1",
  }).blocked,
  true,
  "another store cannot restore the request",
);
assert.equal(
  resolveNumberChangeResumeState({
    requestId: "request-1",
    changeRequest: { ...baseRequest, organization_id: "other-org" },
    organizationId: "org-1",
    storeId: "store-1",
  }).blocked,
  true,
  "another responsible scope cannot restore the request",
);
assert.equal(
  resolveNumberChangeResumeState({
    requestId: "request-1",
    changeRequest: { ...baseRequest, candidate_phone_number_id: null },
  }).blocked,
  true,
  "inconsistent candidate state blocks safely",
);
console.log("whatsapp-number-change resume: 8 tests passed");

assert.equal(
  resolveNumberChangeResumeState({
    linkStatus: "started",
    requestId: "request-1",
    changeRequest: { ...baseRequest, status: "completed" },
  }).phase,
  "complete_link",
  "completed cutover with started link resumes only link completion",
);
assert.equal(
  resolveNumberChangeResumeState({
    linkStatus: "issued",
    requestId: "request-1",
    changeRequest: { ...baseRequest, status: "completed" },
  }).blocked,
  true,
  "inconsistent completed request cannot invent link progress",
);

let completionCalls = 0;
await completeNumberChangeLink({
  token: "token-without-storage",
  fetcher: async (_input, init) => {
    completionCalls += 1;
    assert.equal(init.method, "POST");
    assert.equal(init.body, JSON.stringify({ action: "complete" }));
    return mockResponse({ ok: true, status: "completed" }, true);
  },
});
assert.equal(completionCalls, 1, "link recovery performs one server-side completion call");
await assert.rejects(
  () => completeNumberChangeLink({ token: "token", fetcher: async () => mockResponse({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_LINK_COMPLETION_FAILED" }, false) }),
  /WHATSAPP_NUMBER_CHANGE_LINK_COMPLETION_FAILED/,
  "link completion failure is not reported as success",
);
console.log("whatsapp-number-change completion recovery: 4 tests passed");

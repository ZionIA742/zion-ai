import { strict as assert } from "node:assert";
import { requestNumberChangeLinkStart } from "./number-change-link-start";

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

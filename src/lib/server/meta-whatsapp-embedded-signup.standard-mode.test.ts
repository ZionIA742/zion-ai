import { strict as assert } from "node:assert";
import test from "node:test";

import {
  confirmMetaWhatsappStandardConnection,
  MetaWhatsappEmbeddedSignupError,
  type MetaWhatsappEmbeddedSignupValidationResult,
  type MetaWhatsappEmbeddedSignupDeps,
} from "./meta-whatsapp-embedded-signup";

const validated: MetaWhatsappEmbeddedSignupValidationResult = {
  accessToken: "synthetic-token-sentinel",
  whatsappBusinessAccountId: "waba-test",
  phoneNumberId: "phone-standard-test",
  connectionMode: "standard",
  displayPhoneNumber: "+5511999999999",
  graphApiVersion: "v99.0",
  appId: "app-test",
  validatedAt: "2026-11-14T12:00:00.000Z",
};

const validState: Record<string, unknown> = {
  id: "phone-standard-test",
  platform_type: "CLOUD_API",
  is_on_biz_app: false,
};

function responder(
  body: Record<string, unknown>,
  status = 200,
) {
  const calls: Array<{
    url: string;
    method: string;
    authorization: string | null;
  }> = [];

  const fetchMock = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization"),
    });

    return Response.json(body, { status });
  }) as typeof fetch;

  const deps: Partial<MetaWhatsappEmbeddedSignupDeps> = {
    fetch: fetchMock,
  };

  return { calls, deps };
}

test("standard confirmation accepts explicit Meta false", async () => {
  const { calls, deps } = responder(validState);

  await confirmMetaWhatsappStandardConnection(validated, { deps });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(
    calls[0].authorization,
    "Bearer synthetic-token-sentinel",
  );
  assert.match(
    calls[0].url,
    /phone-standard-test\?fields=id%2Cis_on_biz_app%2Cplatform_type$/,
  );
});

const invalidCases: Array<{
  name: string;
  body: Record<string, unknown>;
}> = [
  {
    name: "standard confirmation rejects Meta coexistence true",
    body: { ...validState, is_on_biz_app: true },
  },
  {
    name: "standard confirmation rejects missing is_on_biz_app",
    body: {
      id: "phone-standard-test",
      platform_type: "CLOUD_API",
    },
  },
  {
    name: "standard confirmation rejects nonboolean is_on_biz_app",
    body: { ...validState, is_on_biz_app: "false" },
  },
  {
    name: "standard confirmation rejects mismatched phone identity",
    body: { ...validState, id: "different-phone" },
  },
  {
    name: "standard confirmation rejects non Cloud API platform",
    body: { ...validState, platform_type: "ON_PREMISE" },
  },
];

for (const scenario of invalidCases) {
  test(scenario.name, async () => {
    const { calls, deps } = responder(scenario.body);

    await assert.rejects(
      confirmMetaWhatsappStandardConnection(validated, { deps }),
      (error: unknown) =>
        error instanceof MetaWhatsappEmbeddedSignupError &&
        error.code === "META_STANDARD_CONNECTION_UNCONFIRMED" &&
        error.httpStatus === 422,
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
  });
}

test("standard confirmation rejects Meta HTTP failure", async () => {
  const { calls, deps } = responder(
    { error: { message: "synthetic-meta-error" } },
    503,
  );

  await assert.rejects(
    confirmMetaWhatsappStandardConnection(validated, { deps }),
    (error: unknown) =>
      error instanceof MetaWhatsappEmbeddedSignupError &&
      error.code === "META_UNAVAILABLE" &&
      error.httpStatus === 502 &&
      error.evidence.operation === "read_standard_connection_state",
  );

  assert.equal(calls.length, 1);
});

test("standard confirmation rejects network failure", async () => {
  let requests = 0;

  const failingFetch = (async (): Promise<Response> => {
    requests++;
    throw new Error("synthetic-network-failure");
  }) as typeof fetch;

  await assert.rejects(
    confirmMetaWhatsappStandardConnection(validated, {
      deps: { fetch: failingFetch },
    }),
  );

  assert.equal(requests, 1);
});

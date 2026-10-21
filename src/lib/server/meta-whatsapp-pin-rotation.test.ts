import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const requireModule = createRequire(import.meta.url);
const { setMetaWhatsappTwoStepVerificationPin } = requireModule("./meta-whatsapp-pin-rotation.ts") as typeof import("./meta-whatsapp-pin-rotation");

const input = {
  graphApiVersion: "v24.0",
  phoneNumberId: "123456789012345",
  accessToken: "token-private-sentinel",
  newPin: "004217",
};

function mock(response: Response) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchMock = async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return response;
  };
  return { requests, fetchMock: fetchMock as typeof fetch };
}

test("uses Meta's two-step PIN endpoint, never register, and confirms only success=true", async () => {
  const { requests, fetchMock } = mock(Response.json({ success: true }, {
    headers: { "x-fb-trace-id": "trace-1" },
  }));
  const result = await setMetaWhatsappTwoStepVerificationPin(input, { fetch: fetchMock });
  assert.equal(result.result, "confirmed");
  assert.equal(result.httpStatus, 200);
  assert.equal(result.requestId, "trace-1");
  assert.match(result.evidenceHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://graph.facebook.com/v24.0/123456789012345");
  assert.equal(requests[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { pin: "004217" });
  assert.equal((requests[0].init?.headers as Record<string, string>).Authorization,
    "Bearer token-private-sentinel");
  assert.equal(requests[0].init?.redirect, "error");
});

test("success-shaped status without success=true is uncertain", async () => {
  const { fetchMock } = mock(Response.json({ success: "true" }));
  assert.equal((await setMetaWhatsappTwoStepVerificationPin(input, { fetch: fetchMock })).result,
    "uncertain");
});

test("explicit Meta 400 error is rejected with evidence but no secret", async () => {
  const { fetchMock } = mock(Response.json({ error: { code: 190, message: "bad" } },
    { status: 400 }));
  const result = await setMetaWhatsappTwoStepVerificationPin(input, { fetch: fetchMock });
  assert.equal(result.result, "rejected");
  assert.equal(result.metaErrorCode, "190");
  assert.equal(JSON.stringify(result).includes(input.newPin), false);
  assert.equal(JSON.stringify(result).includes(input.accessToken), false);
});

test("rate limit, ambiguous failure and malformed body never become confirmed", async () => {
  for (const response of [
    Response.json({ error: { code: 80007 } }, { status: 429 }),
    Response.json({}, { status: 400 }),
    new Response("not json", { status: 200 }),
    new Response(null, { status: 204 }),
  ]) {
    const { fetchMock } = mock(response);
    const result = await setMetaWhatsappTwoStepVerificationPin(input, { fetch: fetchMock });
    assert.equal(result.result, "uncertain");
  }
});

test("network error is uncertain; remote adapter never retries", async () => {
  let calls = 0;
  const result = await setMetaWhatsappTwoStepVerificationPin(input, {
    fetch: (async () => { calls++; throw new Error("network reset"); }) as typeof fetch,
  });
  assert.equal(result.result, "uncertain");
  assert.equal(calls, 1);
});

test("invalid input blocks calls without leaking PIN or token", async () => {
  let calls = 0;
  const failIfCalled = (async () => { calls++; throw new Error("called"); }) as typeof fetch;
  for (const bad of [
    { ...input, newPin: "12345" },
    { ...input, graphApiVersion: "http://bad" },
    { ...input, phoneNumberId: "../../other" },
    { ...input, accessToken: " " },
  ]) {
    await assert.rejects(setMetaWhatsappTwoStepVerificationPin(bad, { fetch: failIfCalled }),
      /ZION_WHATSAPP_PIN_ROTATION_REMOTE_INPUT_INVALID/);
  }
  assert.equal(calls, 0);
});

test("invalid timeout also fails before Meta request", async () => {
  const { requests, fetchMock } = mock(Response.json({ success: true }));
  await assert.rejects(setMetaWhatsappTwoStepVerificationPin(input,
    { fetch: fetchMock, timeoutMs: -1 }), /TIMEOUT_INVALID/);
  assert.equal(requests.length, 0);
});

test("timeout is uncertain and no blind retry occurs", async () => {
  let calls = 0;
  const result = await setMetaWhatsappTwoStepVerificationPin(input, {
    timeoutMs: 15,
    fetch: ((_: unknown, init?: RequestInit) => {
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }) as typeof fetch,
  });
  assert.equal(result.result, "uncertain");
  assert.equal(calls, 1);
});

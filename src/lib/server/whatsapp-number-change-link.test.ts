import { strict as assert } from "node:assert";
import test from "node:test";
import {
  buildWhatsappNumberChangeLink,
  createConfiguredWhatsappNumberChangeEmailTransport,
  createResendWhatsappNumberChangeEmailTransport,
  createSimulatedWhatsappNumberChangeEmailTransport,
  createWhatsappNumberChangeToken,
  hashWhatsappNumberChangeToken,
} from "./whatsapp-number-change-link.ts";

test("number change tokens are unpredictable, hashed, and scoped to the link URL", async () => {
  const first = createWhatsappNumberChangeToken();
  const second = createWhatsappNumberChangeToken();
  assert.notEqual(first, second);
  assert.notEqual(first, hashWhatsappNumberChangeToken(first));
  assert.equal(hashWhatsappNumberChangeToken(first), hashWhatsappNumberChangeToken(first));
  assert.match(buildWhatsappNumberChangeLink("https://example.test", first), /\/whatsapp-number-change\?token=/);
});

test("simulated transport captures the exact recipient and message without external delivery", async () => {
  const messages: unknown[] = [];
  const transport = createSimulatedWhatsappNumberChangeEmailTransport((message) => messages.push(message));
  const result = await transport.send({
    recipient: "owner@example.com",
    storeName: "Loja Teste",
    link: "https://example.test/whatsapp-number-change?token=test",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  assert.deepEqual(result, { delivered: true });
  assert.deepEqual(messages, [{
    recipient: "owner@example.com",
    storeName: "Loja Teste",
    link: "https://example.test/whatsapp-number-change?token=test",
    expiresAt: "2099-01-01T00:00:00.000Z",
  }]);
});

test("invalid Resend configuration stays disabled without calling the provider", async () => {
  let calls = 0;
  const transport = createResendWhatsappNumberChangeEmailTransport({
    apiKey: "not-a-resend-key",
    from: "invalid",
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 200 });
    },
  });
  const result = await transport.send({
    recipient: "owner@example.com",
    storeName: "Loja",
    link: "https://example.test/whatsapp-number-change?token=test",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  assert.deepEqual(result, { delivered: false });
  assert.equal(calls, 0);
});

test("Resend transport sends only the canonical recipient and complete link payload", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const transport = createResendWhatsappNumberChangeEmailTransport({
    apiKey: "re_test_key",
    from: "no-reply@example.com",
    fetchImpl: async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
    },
  });
  const result = await transport.send({
    recipient: "owner@example.com",
    storeName: "Loja & Teste",
    link: "https://example.test/whatsapp-number-change?token=test",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  assert.deepEqual(result, { delivered: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, "https://api.resend.com/emails");
  assert.equal(calls[0]?.init?.headers && (calls[0].init.headers as Record<string, string>).Authorization, "Bearer re_test_key");
  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.deepEqual(body.to, ["owner@example.com"]);
  assert.equal(body.from, "no-reply@example.com");
  assert.match(body.text, /https:\/\/example\.test\/whatsapp-number-change/);
  assert.match(body.html, /Loja &amp; Teste/);
});

test("configured transport reads private environment variables without changing existing auth mail flows", async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.RESEND_FROM_EMAIL;
  const originalFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  process.env.RESEND_API_KEY = "re_env_key";
  process.env.RESEND_FROM_EMAIL = "no-reply@example.com";
  globalThis.fetch = async (_input, init) => {
    calls.push(init ?? {});
    return new Response(null, { status: 202 });
  };
  try {
    const result = await createConfiguredWhatsappNumberChangeEmailTransport().send({
      recipient: "owner@example.com",
      storeName: "Loja",
      link: "https://example.test/whatsapp-number-change?token=test",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    assert.deepEqual(result, { delivered: true });
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previousFrom;
  }
});

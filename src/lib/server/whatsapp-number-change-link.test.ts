import { strict as assert } from "node:assert";
import test from "node:test";
import {
  buildWhatsappNumberChangeLink,
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

import assert from "node:assert/strict";
import test from "node:test";
import { resolveHumanCommand } from "./human-command-resolver";

const context = {
  organizationId: "org-1",
  storeId: "store-1",
  conversationId: "conversation-1",
};

function operator(text: string, overrides: Record<string, unknown> = {}) {
  return resolveHumanCommand({
    messageId: "message-1",
    text,
    actorUserId: "user-1",
    actor: "panel_human",
    channel: "crm_panel",
    destination: "assistant",
    context,
    ...overrides,
  });
}

test("recognizes explicit human takeover without executing anything", () => {
  const result = operator("Eu vou cuidar");
  assert.equal(result.action, "takeover_temporary");
  assert.equal(result.confidence, "explicit");
  assert.equal(result.decisionKey, "human-command:message-1:takeover_temporary");
});

test("recognizes explicit hard hold", () => {
  const result = operator("Não responda");
  assert.equal(result.action, "create_hard_hold");
  assert.equal(result.reasonCode, "EXPLICIT_HARD_HOLD");
});

test("recognizes AI release only with active human takeover context", () => {
  const result = operator("Pode assumir", { context: { ...context, humanTakeoverActive: true } });
  assert.equal(result.action, "release_ai");

  const missingTakeover = operator("Pode assumir");
  assert.equal(missingTakeover.action, "ambiguous");
  assert.equal(missingTakeover.reasonCode, "AI_RELEASE_WITHOUT_ACTIVE_TAKEOVER");
});

test("customer messages and WhatsApp messages never execute a command", () => {
  for (const overrides of [
    { actor: "customer", channel: "whatsapp", destination: "assistant" },
    { actor: "panel_human", channel: "whatsapp", destination: "assistant" },
    { actor: "panel_human", channel: "crm_panel", destination: "customer" },
  ]) {
    const result = operator("Eu vou cuidar", overrides);
    assert.equal(result.action, "ambiguous");
    assert.equal(result.reasonCode, "ACTOR_NOT_AUTHORIZED");
  }
});

test("missing identity or tenant/conversation context fails closed", () => {
  const result = operator("Não responda", {
    actorUserId: null,
    context: { ...context, conversationId: null },
  });
  assert.equal(result.action, "ambiguous");
  assert.equal(result.reasonCode, "CONTEXT_REQUIRED");
});

test("ordinary, composite and unrelated phrases remain ambiguous", () => {
  for (const text of ["oi", "eu vou cuidar do orçamento", "pode assumir que está tudo bem"]) {
    const result = operator(text);
    assert.equal(result.action, "ambiguous");
    assert.equal(result.reasonCode, "MESSAGE_NOT_A_COMMAND");
  }
});

test("same identified message produces the same decision and no side effects", () => {
  const first = operator("Eu vou cuidar");
  const second = operator("Eu vou cuidar");
  assert.deepEqual(second, first);
});

test("different conversations remain isolated in the decision", () => {
  const result = operator("Eu vou cuidar", {
    messageId: "message-2",
    context: { ...context, conversationId: "conversation-2" },
  });
  assert.equal(result.conversationId, "conversation-2");
  assert.equal(result.decisionKey, "human-command:message-2:takeover_temporary");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_SALES_BEHAVIOR,
  buildBehaviorInstructionBlock,
  detectCustomerMood,
} from "./ai-sales-behavior";

test("detectCustomerMood returns neutral for empty input", () => {
  assert.equal(detectCustomerMood(""), "neutral");
});

test("detectCustomerMood detects irritated customer", () => {
  assert.equal(detectCustomerMood("que absurdo"), "irritated");
});

test("detectCustomerMood gives irritated precedence over hurry", () => {
  assert.equal(
    detectCustomerMood("que absurdo, manda logo"),
    "irritated",
  );
});

test("detectCustomerMood detects customer in a hurry", () => {
  assert.equal(detectCustomerMood("manda logo"), "in_a_hurry");
});

test("detectCustomerMood detects confused customer", () => {
  assert.equal(detectCustomerMood("como assim"), "confused");
});

test("detectCustomerMood detects short dry customer", () => {
  assert.equal(detectCustomerMood("ok"), "dry");
});

test("detectCustomerMood keeps ordinary longer message neutral", () => {
  assert.equal(
    detectCustomerMood(
      "Tenho interesse em conhecer algumas opções para minha casa",
    ),
    "neutral",
  );
});

test("behavior block injects the rules for the detected customer mood", () => {
  const block = buildBehaviorInstructionBlock("que absurdo");

  assert.match(block, /AJUSTE PELO ESTADO DO CLIENTE: irritated/);

  for (const rule of AI_SALES_BEHAVIOR.moodRules.irritated) {
    assert.equal(block.includes(rule), true);
  }
});

test("behavior block always includes variation rules", () => {
  const block = buildBehaviorInstructionBlock("Tenho interesse nas piscinas");

  for (const rule of AI_SALES_BEHAVIOR.variationRules) {
    assert.equal(block.includes(rule), true);
  }
});

test("behavior block always includes closing rules", () => {
  const block = buildBehaviorInstructionBlock("Tenho interesse nas piscinas");

  for (const rule of AI_SALES_BEHAVIOR.closingRules) {
    assert.equal(block.includes(rule), true);
  }
});

test("behavior block includes prohibited and preferred language guidance", () => {
  const block = buildBehaviorInstructionBlock("Tenho interesse nas piscinas");

  for (const rule of AI_SALES_BEHAVIOR.prohibitedPhrases) {
    assert.equal(block.includes(rule), true);
  }

  for (const rule of AI_SALES_BEHAVIOR.preferredPhrases) {
    assert.equal(block.includes(rule), true);
  }
});
test("ordinary installation duration question is not irritated", () => {
  assert.equal(
    detectCustomerMood("Quanto tempo demora a instalação?"),
    "neutral",
  );
});

test("ordinary today availability question is not treated as hurry", () => {
  assert.equal(
    detectCustomerMood("Tem disponibilidade hoje?"),
    "neutral",
  );
});

test("ordinary use of agora is not treated as hurry", () => {
  assert.equal(
    detectCustomerMood("Quero ver algumas opções agora"),
    "neutral",
  );
});

test("friendly greeting is not treated as dry", () => {
  assert.equal(
    detectCustomerMood("Bom dia, tudo bem?"),
    "neutral",
  );
});

test("short direct price question remains dry", () => {
  assert.equal(
    detectCustomerMood("Qual o valor?"),
    "dry",
  );
});
test("genuine delay complaint remains irritated", () => {
  assert.equal(
    detectCustomerMood("Que demora!"),
    "irritated",
  );
});

test("explicit need for immediate response remains hurry", () => {
  assert.equal(
    detectCustomerMood("Preciso agora"),
    "in_a_hurry",
  );
});
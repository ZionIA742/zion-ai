import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generate AI sales reply enforces behavior contract output guard before customer success", async () => {
  const source = await readFile(
    "src/lib/server/generate-ai-sales-reply.ts",
    "utf8",
  );

  assert.equal(
    source.includes("findSalesAiBehaviorContractOutputViolation"),
    true,
    "runtime must import and use the deterministic Behavior Contract output guard",
  );

  const finalAiTextIndex = source.indexOf("const finalAiText =");

  const guardCallIndex = source.indexOf(
    "findSalesAiBehaviorContractOutputViolation({",
  );

  const behaviorGuardErrorIndex = source.indexOf(
    'error: "SALES_AI_BEHAVIOR_CONTRACT_OUTPUT_VIOLATION"',
  );

  const successIndex = source.indexOf(
    "aiText: finalAiText,",
    finalAiTextIndex,
  );

  assert.equal(
    finalAiTextIndex >= 0,
    true,
    "finalAiText must exist",
  );

  assert.equal(
    guardCallIndex > finalAiTextIndex,
    true,
    "Behavior Contract output guard must inspect finalAiText after all reply overrides",
  );

  assert.equal(
    behaviorGuardErrorIndex > guardCallIndex,
    true,
    "a detected violation must fail closed with a dedicated runtime error",
  );

  assert.equal(
    successIndex > behaviorGuardErrorIndex,
    true,
    "Behavior Contract guard must execute before customer-facing success return",
  );

  const guardWindow = source.slice(
    guardCallIndex,
    behaviorGuardErrorIndex + 500,
  );

  assert.equal(
    guardWindow.includes("text: finalAiText"),
    true,
    "guard must validate the actual final text being returned",
  );

  assert.equal(
    guardWindow.includes("contract: salesAiBehaviorContract"),
    true,
    "guard must use the effective canonical Behavior Contract built for this turn",
  );
});

console.log(
  "generate AI sales reply behavior contract output guard authority: 1 test passed",
);
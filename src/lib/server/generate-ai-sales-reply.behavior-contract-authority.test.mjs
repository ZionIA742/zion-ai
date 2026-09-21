import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src/lib/server/generate-ai-sales-reply.ts"),
  "utf8",
);

assert.equal(
  source.includes('from "./sales-ai-behavior-contract"'),
  true,
  "Sales AI must import the canonical behavior contract",
);

assert.equal(
  source.includes("buildSalesAiBehaviorContract"),
  true,
  "Sales AI must build the behavior contract from canonical settings",
);

assert.equal(
  source.includes("buildSalesAiBehaviorContractPromptBlock"),
  true,
  "Sales AI must render an explicit behavior contract prompt block",
);

assert.match(
  source,
  /const\s+salesAiBehaviorContract\s*=\s*buildSalesAiBehaviorContract\s*\(\s*\{[\s\S]*?paymentSettings:\s*canonicalPaymentSettings[\s\S]*?discountSettings:\s*canonicalDiscountSettings[\s\S]*?highValueDiscountSettings:\s*canonicalHighValueDiscountSettings[\s\S]*?\}\s*\)/,
  "Behavior contract must consume the raw canonical payment and discount authorities",
);

assert.equal(
  source.includes("behaviorContract: SalesAiBehaviorContract"),
  true,
  "Runtime decision helpers must consume the typed behavior contract",
);

assert.equal(
  source.includes("salesAiBehaviorContractBlock: string"),
  true,
  "Final instructions must receive the rendered behavior contract",
);

assert.equal(
  source.includes("${args.salesAiBehaviorContractBlock}"),
  true,
  "Final Sales AI prompt must include the behavior contract block",
);

assert.equal(
  source.includes("function hasConfiguredPixKey("),
  false,
  "Legacy Pix boolean helper must be removed",
);

assert.equal(
  source.includes("function hasConfiguredDownPaymentRule("),
  false,
  "Legacy down-payment boolean helper must be removed",
);

assert.equal(
  source.includes("hasConfiguredPixKey: hasConfiguredPixKey("),
  false,
  "Response priority must not receive the legacy Pix boolean",
);

assert.equal(
  source.includes(
    "hasConfiguredDownPaymentRule: hasConfiguredDownPaymentRule(",
  ),
  false,
  "Response priority must not receive the legacy down-payment boolean",
);

console.log(
  "generate AI sales reply behavior contract authority: 1 test passed",
);
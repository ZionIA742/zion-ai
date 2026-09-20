import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const file = join(process.cwd(), "src/lib/server/store-readiness.ts");
const source = readFileSync(file, "utf8");

assert.equal(
  source.includes('"onboarding_activation"'),
  true,
  "store readiness must expose a distinct onboarding_activation capability",
);

assert.equal(
  source.includes("resolveOnboardingActivationCapability"),
  true,
  "store readiness must have an onboarding activation projection",
);

assert.equal(
  source.includes("read_store_onboarding_completion_readiness_scoped"),
  true,
  "onboarding activation readiness must consume the canonical SQL reader",
);

assert.equal(
  source.includes("resolveOnboardingMinimumCapability"),
  true,
  "existing onboarding_minimum capability must remain separate",
);

console.log("store readiness onboarding activation authority: 1 test passed");
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src/app/onboarding/page.tsx"),
  "utf8",
);

assert.equal(
  source.includes('fetch("/api/store/readiness"'),
  true,
  "Onboarding must consume the canonical store readiness route",
);

assert.equal(
  source.includes("capabilities_by_key?.onboarding_activation?.state"),
  true,
  "Onboarding must consume onboarding_activation from canonical readiness",
);

assert.equal(
  source.includes(
    'onboardingActivationState === "ready"',
  ),
  true,
  "activation button must depend on canonical onboarding activation readiness",
);

assert.equal(
  source.includes("const essentialsReady = useMemo"),
  false,
  "legacy local essentials gate must not remain as a second readiness truth",
);

assert.equal(
  source.includes("const whatsappConnected = useMemo"),
  false,
  "legacy local WhatsApp gate must not remain as a second readiness truth",
);

assert.equal(
  source.includes('"onboarding_complete_store_onboarding_scoped"'),
  true,
  "canonical completion writer must remain the final activation authority",
);

assert.equal(
  source.includes("disabled={saving || !canActivate}"),
  true,
  "activation button must stay disabled when canonical readiness is not ready",
);

console.log("onboarding activation canonical readiness: 1 test passed");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routeFile =
  "src/app/api/sales-contracts/[contractId]/generate-pdf/route.ts";

const source = readFileSync(
  join(process.cwd(), routeFile),
  "utf8"
);

assert.equal(
  source.includes(
    'import { loadStoreBrandVisualPolicy } from "@/lib/server/store-brand-visual-policy";'
  ),
  true,
  "contract route must import canonical brand visual policy reader"
);

assert.equal(
  source.includes(
    "const brandVisualPolicy = await loadStoreBrandVisualPolicy({"
  ),
  true,
  "contract route must load canonical brand visual policy"
);

assert.equal(
  source.includes("supabase: scope.sessionSupabase,"),
  true,
  "contract route must use authenticated session client for canonical reader"
);

assert.equal(
  source.includes("organizationId: scope.organizationId,"),
  true,
  "contract route must preserve organization scope"
);

assert.equal(
  source.includes("storeId: scope.store.id,"),
  true,
  "contract route must preserve store scope"
);

assert.equal(
  source.includes(
    "!brandVisualPolicy.configured || brandVisualPolicy.useLogoOnContracts === true"
  ),
  true,
  "contract route must preserve legacy behavior when unconfigured and obey explicit contract logo policy"
);

assert.equal(
  source.includes("supabase: scope.supabase,"),
  true,
  "contract route must keep privileged client for physical logo loading"
);
assert.match(
  source,
  /brandVisual:\s*brandVisualPolicy\.configured\s*\?\s*\{\s*primaryColor:\s*brandVisualPolicy\.primaryColor,\s*secondaryColor:\s*brandVisualPolicy\.secondaryColor,\s*documentFooter:\s*brandVisualPolicy\.documentFooter,\s*\}\s*:\s*null,/m,
  "contract route must pass canonical brand colors and footer to PDF only when configured"
);

const policyIndex = source.indexOf(
  "const brandVisualPolicy = await loadStoreBrandVisualPolicy({"
);

const logoIndex = source.indexOf(
  "const storeLogo =",
  policyIndex
);

const pdfIndex = source.indexOf(
  "const pdfBytes = await buildContractPdf({",
  logoIndex
);

assert.ok(
  policyIndex >= 0,
  "canonical brand policy read not found"
);

assert.ok(
  logoIndex > policyIndex,
  "logo must be resolved only after canonical policy"
);

assert.ok(
  pdfIndex > logoIndex,
  "policy and logo must be resolved before contract PDF build"
);

console.log("PASS contract brand visual policy runtime regression");
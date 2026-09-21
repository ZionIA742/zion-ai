import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routeFiles = [
  "src/app/api/sales-quotes/[quoteId]/generate-pdf/route.ts",
  "src/app/api/sales-quotes/[quoteId]/apply-change/route.ts",
];

for (const routeFile of routeFiles) {
  const source = readFileSync(join(process.cwd(), routeFile), "utf8");

  assert.equal(
    source.includes(
      'import { loadStoreBrandVisualPolicy } from "@/lib/server/store-brand-visual-policy";'
    ),
    true,
    `${routeFile} must import canonical brand visual policy reader`
  );

  assert.equal(
    source.includes("const brandVisualPolicy = await loadStoreBrandVisualPolicy({"),
    true,
    `${routeFile} must load canonical brand visual policy`
  );

  assert.equal(
    source.includes("supabase: scope.sessionSupabase,"),
    true,
    `${routeFile} must use authenticated session client for canonical reader`
  );

  assert.equal(
    source.includes("organizationId: scope.organizationId,"),
    true,
    `${routeFile} must preserve organization scope`
  );

  assert.equal(
    source.includes("storeId: scope.store.id,"),
    true,
    `${routeFile} must preserve store scope`
  );

  assert.equal(
    source.includes(
      "!brandVisualPolicy.configured || brandVisualPolicy.useLogoOnQuotes === true"
    ),
    true,
    `${routeFile} must preserve legacy logo behavior when unconfigured and obey explicit quote logo policy`
  );

  assert.equal(
    source.includes("supabase: scope.supabase,"),
    true,
    `${routeFile} must keep privileged client for physical logo loading`
  );
  assert.match(
    source,
    /brandVisual:\s*brandVisualPolicy\.configured\s*\?\s*\{\s*primaryColor:\s*brandVisualPolicy\.primaryColor,\s*secondaryColor:\s*brandVisualPolicy\.secondaryColor,\s*documentFooter:\s*brandVisualPolicy\.documentFooter,\s*\}\s*:\s*null,/m,
    `${routeFile} must pass canonical brand colors and footer to PDF only when configured`
  );

  const policyIndex = source.indexOf(
    "const brandVisualPolicy = await loadStoreBrandVisualPolicy({"
  );
  const logoIndex = source.indexOf("const storeLogo =", policyIndex);
  const pdfIndex = source.indexOf("const pdfBytes = await buildQuotePdf({", logoIndex);

  assert.ok(policyIndex >= 0, `${routeFile} policy read not found`);
  assert.ok(
    logoIndex > policyIndex,
    `${routeFile} must resolve logo only after canonical policy`
  );
  assert.ok(
    pdfIndex > logoIndex,
    `${routeFile} must resolve policy/logo before building PDF`
  );
}

console.log("PASS quote brand visual policy runtime regression");
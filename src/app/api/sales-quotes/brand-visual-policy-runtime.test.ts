import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routeFiles = [
  "src/app/api/sales-quotes/[quoteId]/generate-pdf/route.ts",
  "src/app/api/sales-quotes/[quoteId]/apply-change/route-handler.ts",
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
  if (routeFile.endsWith("/generate-pdf/route.ts")) {
    assert.match(source, /const brandVisual = brandVisualPolicy\.configured\s*\?\s*\{\s*primaryColor:\s*brandVisualPolicy\.primaryColor,\s*secondaryColor:\s*brandVisualPolicy\.secondaryColor,\s*documentFooter:\s*brandVisualPolicy\.documentFooter,\s*\}\s*:\s*null;/m);
    assert.match(source, /const persistedSnapshot = \{[\s\S]*?pdfRendering:\s*\{\s*brandVisual,\s*logoSha256,\s*\}/);
    assert.match(source, /p_quote_snapshot:\s*persistedSnapshot,/);
    assert.match(source, /const renderSnapshot =\s*operation\.outcome === "reclaimed" && operation\.quote_snapshot && typeof operation\.quote_snapshot === "object"\s*\? operation\.quote_snapshot as Record<string, any>\s*:\s*persistedSnapshot;/);
    assert.match(source, /const rendering = snapshot\.pdfRendering \|\| \{\};/);
    assert.match(source, /brandVisual:\s*rendering\.brandVisual \|\| null,/);
    assert.match(source, /const pdfBytes = await buildQuotePdf\(\s*buildPdfInputFromSnapshot\(renderSnapshot, storeLogo\),\s*\);/);
    assert.match(source, /if \(savedLogoSha256 !== logoSha256\) \{\s*throw new Error\("P19A_PDF_RENDER_INPUT_CHANGED"\);\s*\}/);
    const visualIndex = source.indexOf("const brandVisual = brandVisualPolicy.configured");
    const persistedIndex = source.indexOf("const persistedSnapshot =", visualIndex);
    const renderIndex = source.indexOf("const renderSnapshot =", persistedIndex);
    const guardIndex = source.indexOf("if (savedLogoSha256 !== logoSha256)", renderIndex);
    const buildIndex = source.indexOf("const pdfBytes = await buildQuotePdf(", guardIndex);
    assert.ok(visualIndex >= 0 && persistedIndex > visualIndex && renderIndex > persistedIndex && guardIndex > renderIndex && buildIndex > guardIndex, "brand snapshot and logo integrity must precede PDF rendering");
  } else {
    assert.match(
      source,
      /brandVisual:\s*brandVisualPolicy\.configured\s*\?\s*\{\s*primaryColor:\s*brandVisualPolicy\.primaryColor,\s*secondaryColor:\s*brandVisualPolicy\.secondaryColor,\s*documentFooter:\s*brandVisualPolicy\.documentFooter,\s*\}\s*:\s*null,/m,
      `${routeFile} must pass canonical brand colors and footer to PDF only when configured`
    );
  }

  const policyIndex = source.indexOf(
    "const brandVisualPolicy = await loadStoreBrandVisualPolicy({"
  );
  const logoIndex = source.indexOf("const storeLogo =", policyIndex);
  const pdfIndex = source.indexOf(
    routeFile.endsWith("/generate-pdf/route.ts")
      ? "const pdfBytes = await buildQuotePdf("
      : "const pdfBytes = await buildQuotePdf({",
    logoIndex,
  );

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
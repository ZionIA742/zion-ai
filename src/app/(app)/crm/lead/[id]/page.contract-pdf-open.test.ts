import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "page.tsx"), "utf8");
const openStart = source.indexOf("async function openGeneratedContractPdf(");
const openEnd = source.indexOf("function openContractTextEditor", openStart);
assert.notEqual(openStart, -1);
assert.notEqual(openEnd, -1);
const openSource = source.slice(openStart, openEnd);

assert.match(openSource, /expectedContractVersionId\?: string \| null/);
assert.match(openSource, /expectedContractVersionId=\$\{encodeURIComponent\(expectedVersionId\)\}/);
assert.match(openSource, /result\.contractVersionId\.toLowerCase\(\) !== expectedVersionId\.toLowerCase\(\)/);
assert.match(openSource, /window\.open\("about:blank", "_blank"\)/);
assert.match(openSource, /pdfWindow\.location\.replace\(signedUrl\.toString\(\)\)/);
assert.match(openSource, /setBlockedContractPdf\(/);
assert.match(openSource, /setContractPreview\(\{[\s\S]*signedUrl: signedUrl\.toString\(\)/);
assert.match(source, /Abrir PDF em nova aba/);
assert.match(openSource, /pdfWindow\.close\(\)/);
assert.ok(
  openSource.indexOf('window.open("about:blank", "_blank")') <
    openSource.indexOf("await fetch"),
  "the temporary tab must open before the signed URL request",
);
assert.match(source, /openGeneratedContractPdf\([\s\S]*?contract\.id,[\s\S]*?contract\.current_version_id,/);
assert.match(source, /openGeneratedContractPdf\(target\.id, generatedContracts, undefined, false\)/);

console.log("contract PDF opening uses the current version contract");

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
assert.match(openSource, /setContractActionError\(message\)/);
assert.match(source, /openGeneratedContractPdf\([\s\S]*?contract\.id,[\s\S]*?contract\.current_version_id,/);

console.log("contract PDF opening uses the current version contract");

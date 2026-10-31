import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/app/(app)/crm/lead/[id]/page.tsx"), "utf8");
const approvalStart = source.indexOf("async function approveGeneratedContract(");
const approvalEnd = source.indexOf("async function sendGeneratedContractToCustomer(", approvalStart);

assert.notEqual(approvalStart, -1);
assert.notEqual(approvalEnd, -1);

const approvalSource = source.slice(approvalStart, approvalEnd);
assert.match(approvalSource, /expectedContractVersionId: string \| null \| undefined/);
assert.match(approvalSource, /body: JSON\.stringify\(\{ expectedContractVersionId: expectedVersionId \}\)/);
assert.match(approvalSource, /headers: \{ "Content-Type": "application\/json" \}/);
assert.match(source, /approveGeneratedContract\(\s*contract\.id,\s*contract\.status,\s*contract\.current_version_id,/);

console.log("contract approval sends the current contract version identity");

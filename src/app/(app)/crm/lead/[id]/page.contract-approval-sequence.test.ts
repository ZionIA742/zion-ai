import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/app/(app)/crm/lead/[id]/page.tsx"), "utf8");
const contractsStart = source.indexOf("{generatedContracts.map((contract) => {");
const contractsEnd = source.indexOf("const canRegisterCustomerAcceptance", contractsStart);

assert.notEqual(contractsStart, -1);
assert.notEqual(contractsEnd, -1);

const conditions = source.slice(contractsStart, contractsEnd);
assert.match(conditions, /hasSavedTextDraft/);
assert.match(conditions, /\(!hasCurrentVersion \|\| normalizedStatus === "approved"\)/);
assert.match(
  conditions,
  /const canApprove =\s*\(normalizedStatus === "pending_review" \|\|\s*normalizedStatus === "draft"\) &&\s*hasCurrentVersion;/,
);
assert.doesNotMatch(
  conditions.match(/const canApprove =[^;]+;/s)?.[0] || "",
  /!canTextContractAction/,
);

const confirmationStart = source.indexOf("async function confirmPreparedTextContractSend");
const confirmationEnd = source.indexOf("async function approveGeneratedContract", confirmationStart);
const confirmationSource = source.slice(confirmationStart, confirmationEnd);
assert.match(confirmationSource, /confirmManualContractSendFlow\(\{/);
assert.match(confirmationSource, /approve: async/);
assert.match(confirmationSource, /send: async/);

console.log("pending contract review exposes approval before manual send");

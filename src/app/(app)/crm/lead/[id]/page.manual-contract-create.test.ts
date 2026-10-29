import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

const source = readFileSync(join(process.cwd(), "src/app/(app)/crm/lead/[id]/page.tsx"), "utf8");

const selectorStart = source.indexOf("function selectManualContractForOpportunity");
const selectorEnd = source.indexOf("function createQuoteFormItemId", selectorStart);
assert.notEqual(selectorStart, -1);
assert.notEqual(selectorEnd, -1);
const selectorModule = { exports: {} as Record<string, unknown> };
const selectorCode = ts.transpileModule(
  `${source.slice(selectorStart, selectorEnd)}\nmodule.exports = { selectManualContractForOpportunity };`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText;
new Function("module", "exports", selectorCode)(selectorModule, selectorModule.exports);
const selectManualContractForOpportunity = selectorModule.exports
  .selectManualContractForOpportunity as (contracts: Array<Record<string, unknown>>, opportunityId: string) => {
    contract: Record<string, unknown> | null;
    ambiguous: boolean;
  };

const manualContract = (id: string, opportunityId: string) => ({
  id,
  quote_id: null,
  quote_version_id: null,
  manual_provenance: {
    source: "responsible_text_draft",
    created_via: "create_sales_contract_manual_by_system",
    commercial_opportunity_id: opportunityId,
  },
});

const quoteContract = {
  id: "quote-contract",
  quote_id: "quote-1",
  quote_version_id: "quote-version-1",
  manual_provenance: null,
};

const emptySelection = selectManualContractForOpportunity([], "opp-1");
assert.equal(emptySelection.contract, null);
assert.equal(emptySelection.ambiguous, false);

const quoteOnlySelection = selectManualContractForOpportunity([quoteContract], "opp-1");
assert.equal(quoteOnlySelection.contract, null);
assert.equal(quoteOnlySelection.ambiguous, false);

const manual = manualContract("manual-1", "opp-1");
const manualSelection = selectManualContractForOpportunity([manual], "opp-1");
assert.equal(manualSelection.contract, manual);
assert.equal(manualSelection.ambiguous, false);

const coexistenceSelection = selectManualContractForOpportunity(
  [quoteContract, manual],
  "opp-1",
);
assert.equal(coexistenceSelection.contract, manual);
assert.equal(coexistenceSelection.ambiguous, false);

const ambiguousSelection = selectManualContractForOpportunity(
  [manual, manualContract("manual-2", "opp-1")],
  "opp-1",
);
assert.equal(ambiguousSelection.contract, null);
assert.equal(ambiguousSelection.ambiguous, true);

const otherOpportunitySelection = selectManualContractForOpportunity(
  [manualContract("manual-other", "opp-2")],
  "opp-1",
);
assert.equal(otherOpportunitySelection.contract, null);
assert.equal(otherOpportunitySelection.ambiguous, false);

const createStart = source.indexOf("async function createOrRecoverManualContract()");
const createEnd = source.indexOf("async function prepareTextContractSend", createStart);
assert.notEqual(createStart, -1);
assert.notEqual(createEnd, -1);
const createSource = source.slice(createStart, createEnd);

assert.match(createSource, /fetch\("\/api\/sales-contracts\/create-manual"/);
assert.match(createSource, /draftId:\s*draftState\.draftId/);
assert.match(createSource, /draftSha256:\s*draftState\.draftSha256/);
assert.match(createSource, /templateVersionId:\s*draftState\.templateVersionId/);
assert.match(createSource, /draftRevision:\s*draftState\.revision/);
assert.match(createSource, /\["created",\s*"already_exists"\]\.includes\(outcome\)/);
assert.match(createSource, /manualContractCreateInFlightRef\.current/);
assert.match(createSource, /await fetchGeneratedContracts\(\{ silent: true \}\)/);
assert.match(createSource, /selectManualContractForOpportunity\(/);
assert.doesNotMatch(createSource, /return generatedContracts\[0\]/);
assert.match(createSource, /selection\.ambiguous/);
assert.doesNotMatch(createSource, /if \(generatedContracts\.length > 0\)/);
assert.match(createSource, /if \(selection\.contract\) \{/);
assert.ok(
  createSource.indexOf("const selection = selectManualContractForOpportunity(") <
    createSource.indexOf("const draftState ="),
);
assert.match(
  createSource,
  /if \(selection\.contract\) \{[\s\S]*?return selection\.contract;/,
);
assert.doesNotMatch(createSource, /\/generate-pdf/);
assert.doesNotMatch(createSource, /\/approve/);
assert.doesNotMatch(createSource, /\/send/);

assert.match(source, /async function handleContractSend\(contract: GeneratedContractSummary \| null\)/);
assert.match(source, /prepareManualContractSendFlow\(\{/);
assert.match(source, /createOrRecover: createOrRecoverManualContract/);
assert.match(source, /prepare: prepareTextContractSend/);
assert.match(source, /onClick=\{\(\) => void handleContractSend\(null\)\}/);
assert.match(source, /Nenhum contrato canonico gerado ainda/);
assert.match(source, /!contractDraftState\.draftId/);
assert.match(source, /!contractDraftState\.draftSha256/);
assert.match(source, /provenance\??\.draftId !== draftState\.draftId/);
assert.match(source, /provenance\??\.textSha256 !== draftState\.draftSha256/);
assert.match(source, /provenance\??\.templateVersionId !== draftState\.templateVersionId/);
assert.match(source, /A versao conferida foi invalidada porque o rascunho mudou/);
assert.match(source, /contractSendInFlightRef\.current/);
assert.match(source, /currentVersionMatchesDraft/);
assert.match(source, /requiresApproval: false/);
assert.match(source, /requiresApproval: true/);
assert.match(source, /if \(!value\.requiresApproval\) return true/);
assert.match(source, /manual_provenance\.commercial_opportunity_id === commercialOpportunityId/);
assert.match(source, /manual_provenance\.created_via === "create_sales_contract_manual_by_system"/);

const prepareStart = source.indexOf("async function prepareTextContractSend");
const confirmStart = source.indexOf("async function confirmPreparedTextContractSend");
const approveCall = source.indexOf("/approve`,", confirmStart);
const sendCall = source.indexOf("/send`,", confirmStart);
assert.ok(prepareStart < confirmStart);
assert.ok(approveCall > confirmStart);
assert.ok(sendCall > approveCall);
assert.match(source.slice(confirmStart, sendCall), /window\.confirm\(/);
assert.match(source.slice(confirmStart, sendCall), /expectedContractVersionId: value\.contractVersionId/);
assert.doesNotMatch(
  source.slice(prepareStart, confirmStart).match(/currentVersionMatchesDraft[\s\S]*?return \{ handled: true, prepared \};/)?.[0] || "",
  /generate-pdf/,
);
assert.match(source.slice(sendCall), /body \}/);
assert.match(source, /Nenhum retry automatico foi executado/);
assert.match(source, /Envio solicitado para a versao conferida/);

console.log("P9 manual contract CRM creation boundary: source checks PASS");

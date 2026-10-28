import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/app/(app)/crm/lead/[id]/page.tsx"), "utf8");

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

const prepareStart = source.indexOf("async function prepareTextContractSend");
const confirmStart = source.indexOf("async function confirmPreparedTextContractSend");
const approveCall = source.indexOf("/approve`,", confirmStart);
const sendCall = source.indexOf("/send`,", confirmStart);
assert.ok(prepareStart < confirmStart);
assert.ok(approveCall > confirmStart);
assert.ok(sendCall > approveCall);
assert.match(source.slice(confirmStart, sendCall), /window\.confirm\(/);
assert.match(source.slice(confirmStart, sendCall), /expectedContractVersionId: value\.contractVersionId/);
assert.match(source.slice(sendCall), /body \}/);
assert.match(source, /Nenhum retry automatico foi executado/);
assert.match(source, /Envio solicitado para a versao conferida/);

console.log("P9 manual contract CRM creation boundary: source checks PASS");

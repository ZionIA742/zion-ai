import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /normalizedStatus === "sent_to_customer"/);
assert.match(source, /source === "responsible_text_draft"/);
assert.match(source, /created_via === "create_sales_contract_manual_by_system"/);
assert.match(source, /\/api\/sales-contracts\/\$\{encodeURIComponent\(contractId\)\}/);
assert.match(source, /contract_snapshot/);
assert.match(source, /renderer_input/);
assert.match(source, /expectedSentVersionId: buyerCorrection\.expectedSentVersionId/);
assert.match(source, /previousBuyer: buyerCorrection\.previousBuyer/);
assert.match(source, /correctedBuyer: buyerCorrection\.correctedBuyer/);
assert.match(source, /\/correct-buyer/);
assert.match(source, /x-zion-contract-operation-id/);
assert.match(source, /Corrigir dados/);
assert.match(source, /Cancelar/);
assert.match(source, /Salvar correção/);
assert.match(source, /\["name", "phone", "document", "email", "address"\]/);
assert.match(source, /A nova versão está pendente de aprovação humana/);
assert.match(source, /openGeneratedContractPdf\(correctedContractId, refreshedContracts\)/);

console.log("ok - buyer correction UI contract is wired to the existing endpoint");

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pagePath = join(process.cwd(), "src/app/(app)/crm/lead/[id]/page.tsx");
const source = readFileSync(pagePath, "utf8");

assert.equal(source.includes("function openContractPanel()"), true);
assert.equal(source.includes('setActiveGeneratedPdfTab("contracts")'), true);
assert.equal(source.includes('setActiveDetailsTab("pdfs")'), true);
assert.equal(/Contrato\s*<\/button>/.test(source), true);
assert.equal(source.includes('Dados do comprador para consulta'), true);
assert.equal(source.includes("function CompactInfoList("), true);
assert.equal(source.includes('label: "Nome", value: lead.name?.trim() || "Nao informado"'), true);
assert.equal(source.includes('label: "CPF", value: "Nao informado"'), true);
assert.equal(source.includes('label: "Telefone", value: lead.phone?.trim() || "Nao informado"'), true);
assert.equal(source.includes("selectedRouteDestinationAddress || \"Nao informado\""), true);
assert.equal(source.includes("/api/sales-contracts/template-source?"), true);
assert.equal(source.includes("Modelo original da loja"), true);
assert.equal(source.includes("Abrir arquivo original"), true);
assert.equal(source.includes("contractTemplateSource.originalFilename"), true);
assert.equal(source.includes("contractTemplateSource.mimeType"), true);
assert.equal(source.includes("reconstrói"), true);

assert.equal(source.includes("contractPreview"), true);
assert.equal(source.includes("Visualizacao segura do PDF especifico deste comprador."), true);
assert.equal(source.includes('setContractPreview({ contractId: safeContractId, signedUrl: result.signedUrl })'), true);
assert.equal(source.includes('sendGeneratedContractToCustomer(contract.id, contract.status)'), true);
assert.equal(source.includes('normalizedStatus === "approved"'), true);
assert.equal(source.includes('activeDetailsTab === "pdfs" ? "max-w-[96vw] lg:h-[96vh]"'), true);
assert.equal(source.includes("lg:grid-cols-[minmax(0,7fr)_minmax(250px,3fr)]"), true);
assert.equal(source.includes("lg:col-start-2 lg:row-start-1"), true);
assert.equal(source.includes("lg:col-start-1 lg:row-start-1"), true);

const contractAction = source.slice(
  source.indexOf("function openContractPanel()"),
  source.indexOf("function closePaymentModal()"),
);
assert.equal(contractAction.includes("fetch("), false);
assert.equal(contractAction.includes("/api/"), false);

const contractMenu = source.slice(
  source.indexOf("Contrato") - 600,
  source.indexOf("Contrato") + 80,
);
assert.equal(contractMenu.includes("selectedOpportunity"), false);

console.log("contract panel: focused tests passed");

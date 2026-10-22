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
assert.equal(source.includes('label="Nome" value={lead.name?.trim() || "Nao informado"}'), true);
assert.equal(source.includes('label="CPF" value="Nao informado"'), true);
assert.equal(source.includes('label="Telefone" value={lead.phone?.trim() || "Nao informado"}'), true);
assert.equal(source.includes("selectedRouteDestinationAddress || \"Nao informado\""), true);

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

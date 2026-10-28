import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src/app/(app)/crm/lead/[id]");
const page = readFileSync(join(root, "page.tsx"), "utf8");
const editor = readFileSync(join(root, "contract-template-text-editor.tsx"), "utf8");

assert.match(page, /activeDetailsTab === "pdfs" \? "px-4 py-4 lg:px-10 lg:py-8"/);
assert.match(page, /!max-h-\[90dvh\] h-\[90dvh\] max-w-\[1480px\] !rounded-2xl/);
assert.match(page, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(320px,360px\)\]/);
assert.match(page, /Dados do cliente/);
assert.match(page, /Ainda não coletado/);
assert.doesNotMatch(page, /Fechar visualizacao/);
assert.doesNotMatch(page, /Consulte apenas os dados realmente disponiveis durante o preenchimento manual/);
assert.match(page, /function ContractCustomerInfoList\(/);
assert.match(page, /<ContractCustomerInfoList/);
assert.match(page, /function CompactInfoList\(/);
assert.match(editor, /Localizar no contrato/);
assert.match(editor, /Salvar edição/);
assert.match(editor, /recoveryReviewed/);
assert.match(editor, /O modelo original da loja permanece intacto/);
assert.doesNotMatch(editor, /Ampliar editor|Sair da tela ampliada|setExpanded|\bfixed inset-2 z-/);
console.log("ZION P9 layout documental: tela inteira, dados lado a lado e textos compactos PASS");

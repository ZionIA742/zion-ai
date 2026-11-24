const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { PDFDocument } = require("pdf-lib");
const previousLoader = require.extensions[".ts"];
const originalLoad = Module._load;
const srcRoot = path.resolve(__dirname, "../../..");
Module._load = function(request, parent, isMain) {
  if (request.startsWith("@/")) request = path.join(srcRoot, request.slice(2));
  return originalLoad.call(this, request, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};
let render, map;
try {
  const m = require("./human-quote-versioned-edit-pdf-render.ts");
  render = m.renderHumanQuoteRevisionPdf;
  map = m.buildHumanRevisionPdfInput;
} finally {
  Module._load = originalLoad;
  if (previousLoader) require.extensions[".ts"] = previousLoader;
  else delete require.extensions[".ts"];
}
function fixture() {
  const snapshot = {
    quote: {
      id: "11111111-1111-4111-8111-111111111111", quoteNumber: "100", title: "Piscina revisada",
      status: "draft", quoteKind: "definitive", quoteKindNotice: null,
      customerName: "Cliente teste", customerPhone: null, createdAt: "2026-11-24T12:00:00Z",
      validUntil: "2026-12-24", subtotalCents: 200000, discountCents: 10000, totalCents: 190000,
      customerNotes: "Observacao", internalNotes: "NAO EXIBIR", paymentTerms: "Pix",
      deliveryTerms: "Entrega combinada", warrantyTerms: "Garantia contratual",
    },
    store: { id: "22222222-2222-4222-8222-222222222222", name: "Loja teste" },
    lead: { id: null, name: null, phone: null },
    items: [{ id: "33333333-3333-4333-8333-333333333333", name: "Piscina", description: "Modelo teste", quantity: 2, unitPriceCents: 100000, discountCents: 10000, subtotalCents: 200000, totalCents: 190000, sku: null, sortOrder: 1, metadata: {} }],
    settings: {}, generatedAt: "2026-11-24T12:01:00.000Z", generationError: null,
  };
  return { prepared: { snapshot, rpc: { p_quote_snapshot: snapshot, p_total_cents: 190000 } }, brandVisual: { primaryColor: "#0055AA", documentFooter: "Rodape teste" }, storeLogo: null };
}
test("mapeia dados comerciais sem expor observacao interna", () => {
  const f = fixture(), i = map(f.prepared.snapshot, f);
  assert.equal(i.totalCents, 190000); assert.equal(i.subtotalCents, 200000); assert.equal(i.discountCents, 10000);
  assert.deepEqual(i.items, [{name: "Piscina", description: "Modelo teste", quantity: 2, unitPriceCents: 100000, discountCents: 10000, totalCents: 190000}]);
  assert.equal(i.paymentTerms, "Pix"); assert.equal(i.deliveryTerms, "Entrega combinada");
  assert.equal(i.warrantyTerms, "Garantia contratual"); assert.equal(i.validUntil, "2026-12-24");
  assert.equal(i.brandVisual.primaryColor, "#0055AA"); assert.equal("internalNotes" in i, false);
});
test("renderizador real gera PDF legivel pelo pdf-lib", async () => {
  const f = fixture(), r = await render(f);
  assert.equal(Buffer.from(r.pdfBytes.subarray(0,5)).toString(), "%PDF-");
  const d = await PDFDocument.load(r.pdfBytes, {updateMetadata:false});
  assert.ok(d.getPageCount() >= 1);
  assert.equal(d.getCreationDate().toISOString(), f.prepared.snapshot.generatedAt);
  assert.equal(d.getModificationDate().toISOString(), f.prepared.snapshot.generatedAt);
});
test("renderizacao repetida produz bytes iguais apos mudanca do relogio", async () => {
  const f = fixture(), a = await render(f);
  await new Promise(resolve => setTimeout(resolve, 1100));
  const b = await render(f);
  assert.deepEqual(a.pdfBytes, b.pdfBytes); assert.deepEqual(a.rpc, b.rpc);
});
test("alteracao de valor e item produz PDF diferente", async () => {
  const f = fixture(), a = await render(f);
  f.prepared.snapshot.quote.totalCents = 180000;
  f.prepared.snapshot.quote.discountCents = 20000;
  f.prepared.snapshot.items[0].discountCents = 20000;
  f.prepared.snapshot.items[0].totalCents = 180000;
  f.prepared.rpc.p_total_cents = 180000;
  const b = await render(f); assert.notDeepEqual(a.pdfBytes, b.pdfBytes);
});
test("preserva aviso preliminar e permite ausencia de lead", () => {
  const f = fixture(); f.prepared.snapshot.quote.quoteKind = "preliminary"; f.prepared.snapshot.quote.customerName = null;
  const i = map(f.prepared.snapshot, f);
  assert.ok(i.quoteKindNotice); assert.equal(i.customerName, null);
});
test("snapshot final inclui identidade visual e nao altera a entrada", async () => {
  const f = fixture(), before = JSON.stringify(f), r = await render(f);
  assert.equal(JSON.stringify(f), before); assert.equal(r.rpc.p_quote_snapshot, r.snapshot);
  assert.equal(r.snapshot.pdfRendering.brandVisual.documentFooter, "Rodape teste");
  assert.equal(r.snapshot.pdfRendering.logoSha256, null);
  assert.equal(r.snapshot.quote.totalCents, r.rpc.p_total_cents);
});
test("rejeita data invalida antes de renderizar", async () => {
  const f = fixture(); f.prepared.snapshot.generatedAt = "invalid";
  await assert.rejects(render(f), /HUMAN_REVISION_PDF_DATE_INVALID/);
});

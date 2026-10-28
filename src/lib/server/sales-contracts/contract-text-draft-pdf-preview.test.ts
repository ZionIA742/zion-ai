import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContractTextDraftPdfPreviewHandler } from "./contract-text-draft-pdf-preview";

const leadId = "199278f2-0f6b-4479-af11-d661ab917d2d";
const commercialOpportunityId = "c720a5cc-67ff-5f4b-a148-2e12ac1e39f6";
const templateVersionId = "c6c18878-1127-4bd5-82b6-018bc79b654b";
const url = `http://localhost/api/sales-contracts/text-draft/pdf-preview?leadId=${leadId}&commercialOpportunityId=${commercialOpportunityId}`;
const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
const saved = (text = "Clausula numero 1 - contrato privado") => Response.json({
  ok: true,
  templateVersionId,
  draft: { text, revision: 2, templateVersionId, updatedAt: "2026-10-26T20:06:54.748Z" },
});
const req = (u = url) => new Request(u);

type Loader = (request: Request) => Promise<Response>;
type Renderer = (input: { text: string }) => Promise<Uint8Array>;
function make(load: Loader = async () => saved(), render: Renderer = async () => pdf) {
  return createContractTextDraftPdfPreviewHandler({ getAuthorizedDraft: load, renderPdf: render });
}

async function main() {
  let passed = 0;
  const check = async (name: string, run: () => Promise<void>) => {
    await run(); passed++;
  };
  await check("missing scope", async () => {
    let reads = 0;
    const r = await make(async () => { reads++; return saved(); })(req("http://localhost/api/sales-contracts/text-draft/pdf-preview"));
    assert.equal(r.status, 400); assert.equal(reads, 0);
  });
  await check("invalid scope", async () => {
    const r = await make()(req(`${url}&leadId=../../something`)); assert.equal(r.status, 400);
  });
  await check("auth denial", async () => {
    let rendered = false;
    const r = await make(async () => Response.json({ ok: false, secret: "do not leak" }, { status: 403 }),
      async () => { rendered = true; return pdf; })(req());
    assert.equal(r.status, 403); assert.equal(rendered, false); assert.doesNotMatch(await r.text(), /do not leak/);
  });
  await check("upstream server failure", async () => {
    const r = await make(async () => Response.json({}, { status: 500 }))(req()); assert.equal(r.status, 500);
  });
  await check("bad JSON", async () => {
    const r = await make(async () => new Response("{bad-json"))(req()); assert.equal(r.status, 502);
  });
  await check("no saved draft", async () => {
    const r = await make(async () => Response.json({ ok: true, templateVersionId, draft: null }))(req()); assert.equal(r.status, 409);
  });
  await check("unsaved version mismatch", async () => {
    const r = await make(async () => Response.json({ ok: true, templateVersionId: leadId, draft: {
      text: "Test", revision: 1, templateVersionId,
    } }))(req()); assert.equal(r.status, 409);
  });
  await check("empty saved text", async () => {
    const r = await make(async () => saved("   "))(req()); assert.equal(r.status, 409);
  });
  await check("oversized saved text", async () => {
    const r = await make(async () => saved("a".repeat(300_001)))(req()); assert.equal(r.status, 409);
  });
  await check("invalid revision", async () => {
    const r = await make(async () => Response.json({ ok: true, templateVersionId,
      draft: { text: "ok", revision: 0, templateVersionId },
    }))(req()); assert.equal(r.status, 409);
  });
  await check("exact saved text rendered", async () => {
    let actual: string | undefined;
    const r = await make(async () => saved("Linha 1\nLinha 2"), async (input) => {
      actual = input.text; return pdf;
    })(req());
    assert.equal(r.status, 200); assert.equal(actual, "Linha 1\nLinha 2");
    assert.equal(r.headers.get("content-type"), "application/pdf");
    assert.equal(r.headers.get("x-zion-draft-revision"), "2");
    assert.match(r.headers.get("content-disposition") || "", /revisao-2.pdf/);
    assert.match(r.headers.get("cache-control") || "", /no-store/);
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), pdf);
  });
  await check("unsupported PDF glyph fails closed", async () => {
    const r = await make(async () => saved(), async () => {
      throw Object.assign(new Error("unsupported data"), { code: "UNSUPPORTED_CHARACTER" });
    })(req());
    assert.equal(r.status, 422); assert.doesNotMatch(await r.text(), /unsupported data/);
  });
  await check("unexpected render failure", async () => {
    const r = await make(async () => saved(), async () => { throw Error("secret"); })(req());
    assert.equal(r.status, 500); assert.doesNotMatch(await r.text(), /secret/);
  });
  await check("empty PDF output rejected", async () => {
    const r = await make(async () => saved(), async () => new Uint8Array())(req()); assert.equal(r.status, 500);
  });
  await check("route no write or message side effects", async () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/sales-contracts/text-draft/pdf-preview/route.ts"), "utf8");
    assert.match(route, /createContractTextDraftHandlers\(\)\.GET/);
    assert.doesNotMatch(route, /\.insert\(|\.update\(|\.delete\(|send[A-Z]|storeContractPdfFile|markContractPendingReview/);
  });
  console.log(`ZION P9 previa PDF somente leitura: ${passed}/${passed} PASS; sem persistencia ou envio`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

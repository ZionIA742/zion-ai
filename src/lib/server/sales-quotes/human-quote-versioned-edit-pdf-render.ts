import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { buildQuotePdf, type BuildQuotePdfInput } from "./build-quote-pdf";
import { buildQuoteKindNotice } from "./quote-versioning";
import type { prepareHumanQuoteVersionedSnapshot } from "./human-quote-versioned-edit-snapshot";

type Prepared = ReturnType<typeof prepareHumanQuoteVersionedSnapshot>;
type Visual = Pick<BuildQuotePdfInput, "storeLogo" | "brandVisual">;

// Only server-resolved branding and the authorized, normalized snapshot enter here.
export function buildHumanRevisionPdfInput(snapshot: Prepared["snapshot"], visual: Visual): BuildQuotePdfInput {
  const q = snapshot.quote;
  return {
    storeName: snapshot.store.name || null,
    storeLogo: visual.storeLogo ?? null,
    brandVisual: visual.brandVisual ?? null,
    quoteNumber: q.quoteNumber.trim() || q.id,
    quoteKind: q.quoteKind ?? null,
    quoteKindNotice: q.quoteKindNotice || buildQuoteKindNotice(q.quoteKind),
    title: q.title || null,
    customerName: q.customerName || null,
    customerPhone: q.customerPhone || null,
    createdAt: q.createdAt || null,
    validUntil: q.validUntil || null,
    items: snapshot.items.map((i) => ({
      name: i.name || null,
      description: i.description || null,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      discountCents: i.discountCents,
      totalCents: i.totalCents,
    })),
    subtotalCents: q.subtotalCents,
    discountCents: q.discountCents,
    totalCents: q.totalCents,
    customerNotes: q.customerNotes || null,
    paymentTerms: q.paymentTerms || null,
    deliveryTerms: q.deliveryTerms || null,
    warrantyTerms: q.warrantyTerms || null,
    settings: snapshot.settings,
  };
}

export async function renderHumanQuoteRevisionPdf(args: { prepared: Prepared } & Visual) {
  // Clone the exact snapshot so asynchronous rendering cannot change its inputs.
  const snapshot = structuredClone(args.prepared.snapshot);
  const timestamp = new Date(snapshot.generatedAt);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("HUMAN_REVISION_PDF_DATE_INVALID");
  const storeLogo = args.storeLogo ? {
    bytes: Uint8Array.from(args.storeLogo.bytes), mimeType: args.storeLogo.mimeType,
  } : null;
  const brandVisual = args.brandVisual ? {
    primaryColor: args.brandVisual.primaryColor ?? null,
    secondaryColor: args.brandVisual.secondaryColor ?? null,
    documentFooter: args.brandVisual.documentFooter ?? null,
  } : null;
  const pdfRendering = {
    brandVisual,
    logoSha256: storeLogo ? createHash("sha256").update(storeLogo.bytes).digest("hex") : null,
  };
  const rendered = await buildQuotePdf(buildHumanRevisionPdfInput(snapshot, { storeLogo, brandVisual }));
  // Keep the legacy renderer unchanged; canonicalize only this new document's dates.
  const doc = await PDFDocument.load(rendered, { updateMetadata: false });
  doc.setCreationDate(timestamp);
  doc.setModificationDate(timestamp);
  const pdfBytes = await doc.save();
  const finalSnapshot = { ...snapshot, pdfRendering };
  return { pdfBytes, snapshot: finalSnapshot, rpc: { ...args.prepared.rpc, p_quote_snapshot: finalSnapshot } };
}

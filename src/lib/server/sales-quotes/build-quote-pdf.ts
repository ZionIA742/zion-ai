import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { QuoteSettings } from "./types";

type QuotePdfItem = {
  name: string | null;
  description: string | null;
  quantity: number | null;
  unitPriceCents: number | null;
  discountCents: number | null;
  totalCents: number | null;
};

export type BuildQuotePdfInput = {
  storeName: string | null;
  storeLogo?: {
    bytes: Uint8Array;
    mimeType: string;
  } | null;
  quoteNumber: string;
  title: string | null;
  customerName: string | null;
  customerPhone: string | null;
  createdAt: string | null;
  validUntil: string | null;
  items: QuotePdfItem[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  customerNotes: string | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  warrantyTerms: string | null;
  settings: QuoteSettings;
};

type Cursor = {
  page: PDFPage;
  y: number;
};

const PAGE_MARGIN = 48;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const ROW_HEIGHT = 18;
const FONT_SIZE = 10;
const SMALL_FONT_SIZE = 9;
const SECTION_GAP = 18;
const LOGO_MAX_WIDTH = 110;
const LOGO_MAX_HEIGHT = 52;

type StoreBrandingSettingsRow = {
  logo_storage_bucket: string | null;
  logo_storage_path: string | null;
  logo_mime_type: string | null;
};

function formatCurrency(cents: number | null | undefined) {
  const safeValue = Number.isFinite(cents) ? Number(cents) / 100 : 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(safeValue);
}

function formatDate(value: string | null | undefined) {
  const safeValue = String(value || "").trim();
  if (!safeValue) return "-";

  const date = new Date(safeValue);
  if (Number.isNaN(date.getTime())) return safeValue;

  return date.toLocaleDateString("pt-BR");
}

function wrapText(text: string, maxCharsPerLine: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
    }

    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function addPage(pdfDoc: PDFDocument): Cursor {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return {
    page,
    y: PAGE_HEIGHT - PAGE_MARGIN,
  };
}

function scaleLogoDimensions(args: { width: number; height: number }) {
  const safeWidth = Math.max(1, args.width);
  const safeHeight = Math.max(1, args.height);
  const widthRatio = LOGO_MAX_WIDTH / safeWidth;
  const heightRatio = LOGO_MAX_HEIGHT / safeHeight;
  const scale = Math.min(widthRatio, heightRatio, 1);

  return {
    width: safeWidth * scale,
    height: safeHeight * scale,
  };
}

async function embedStoreLogo(pdfDoc: PDFDocument, storeLogo: BuildQuotePdfInput["storeLogo"]) {
  if (!storeLogo?.bytes?.length) {
    return null;
  }

  const normalizedMimeType = String(storeLogo.mimeType || "").trim().toLowerCase();

  if (normalizedMimeType === "image/png") {
    return pdfDoc.embedPng(storeLogo.bytes);
  }

  if (normalizedMimeType === "image/jpeg" || normalizedMimeType === "image/jpg") {
    return pdfDoc.embedJpg(storeLogo.bytes);
  }

  return null;
}

export async function loadStoreLogoForPdf(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
}) {
  try {
    const { data, error } = await args.supabase
      .from("store_branding_settings")
      .select("logo_storage_bucket, logo_storage_path, logo_mime_type")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const branding = (data ?? null) as StoreBrandingSettingsRow | null;
    const bucket = String(branding?.logo_storage_bucket || "").trim();
    const path = String(branding?.logo_storage_path || "").trim();
    const mimeType = String(branding?.logo_mime_type || "").trim().toLowerCase();

    if (!bucket || !path) {
      return null;
    }

    if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/jpg") {
      return null;
    }

    const { data: fileData, error: downloadError } = await args.supabase.storage
      .from(bucket)
      .download(path);

    if (downloadError) {
      throw downloadError;
    }

    const arrayBuffer = await fileData.arrayBuffer();
    return {
      bytes: new Uint8Array(arrayBuffer),
      mimeType,
    };
  } catch (error) {
    console.error("[buildQuotePdf] logo fallback sem imagem:", error);
    return null;
  }
}

function drawTextBlock(args: {
  cursor: Cursor;
  title?: string | null;
  body: string | null | undefined;
  font: PDFFont;
  boldFont: PDFFont;
  pdfDoc: PDFDocument;
}) {
  const safeBody = String(args.body || "").trim();
  if (!safeBody) {
    return args.cursor;
  }

  let cursor = args.cursor;

  if (args.title) {
    cursor.page.drawText(args.title, {
      x: PAGE_MARGIN,
      y: cursor.y,
      size: SMALL_FONT_SIZE,
      font: args.boldFont,
      color: rgb(0.15, 0.15, 0.15),
    });
    cursor.y -= 14;
  }

  const lines = wrapText(safeBody, 90);
  for (const line of lines) {
    if (cursor.y < PAGE_MARGIN + 40) {
      cursor = addPage(args.pdfDoc);
    }

    cursor.page.drawText(line, {
      x: PAGE_MARGIN,
      y: cursor.y,
      size: FONT_SIZE,
      font: args.font,
      color: rgb(0.2, 0.2, 0.2),
    });
    cursor.y -= 13;
  }

  cursor.y -= 6;
  return cursor;
}

export async function buildQuotePdf(input: BuildQuotePdfInput) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const embeddedLogo = await embedStoreLogo(pdfDoc, input.storeLogo || null);

  let cursor = addPage(pdfDoc);
  let headerBottomY = cursor.y;

  if (embeddedLogo) {
    const logoDimensions = scaleLogoDimensions({
      width: embeddedLogo.width,
      height: embeddedLogo.height,
    });
    const logoTopY = cursor.y;
    const logoBottomY = logoTopY - logoDimensions.height;

    cursor.page.drawImage(embeddedLogo, {
      x: PAGE_MARGIN,
      y: logoBottomY,
      width: logoDimensions.width,
      height: logoDimensions.height,
    });

    const storeNameX = PAGE_MARGIN + logoDimensions.width + 16;
    const storeNameY = logoTopY - Math.min(logoDimensions.height / 2, 18);

    cursor.page.drawText(input.storeName || "Loja", {
      x: storeNameX,
      y: storeNameY,
      size: 20,
      font: boldFont,
      color: rgb(0.07, 0.07, 0.07),
    });

    headerBottomY = Math.min(logoBottomY, storeNameY - 8);
  } else {
    cursor.page.drawText(input.storeName || "Loja", {
      x: PAGE_MARGIN,
      y: cursor.y,
      size: 20,
      font: boldFont,
      color: rgb(0.07, 0.07, 0.07),
    });
    headerBottomY = cursor.y - 26;
  }

  cursor.y = headerBottomY - 8;

  cursor.page.drawText(input.title || "Orcamento", {
    x: PAGE_MARGIN,
    y: cursor.y,
    size: 13,
    font: boldFont,
    color: rgb(0.18, 0.18, 0.18),
  });
  cursor.y -= 22;

  const headerLines = [
    `Numero: ${input.quoteNumber}`,
    `Data: ${formatDate(input.createdAt)}`,
    `Validade: ${formatDate(input.validUntil)}`,
    `Cliente: ${input.customerName || "-"}`,
    `Telefone: ${input.customerPhone || "-"}`,
  ];

  for (const line of headerLines) {
    cursor.page.drawText(line, {
      x: PAGE_MARGIN,
      y: cursor.y,
      size: FONT_SIZE,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    cursor.y -= 14;
  }

  cursor.y -= 8;

  cursor.page.drawRectangle({
    x: PAGE_MARGIN,
    y: cursor.y - 18,
    width: CONTENT_WIDTH,
    height: 22,
    color: rgb(0.94, 0.95, 0.97),
  });

  const headerY = cursor.y - 12;
  cursor.page.drawText("Item", {
    x: PAGE_MARGIN + 6,
    y: headerY,
    size: SMALL_FONT_SIZE,
    font: boldFont,
  });
  cursor.page.drawText("Qtd.", {
    x: PAGE_MARGIN + 250,
    y: headerY,
    size: SMALL_FONT_SIZE,
    font: boldFont,
  });
  cursor.page.drawText("Unit.", {
    x: PAGE_MARGIN + 300,
    y: headerY,
    size: SMALL_FONT_SIZE,
    font: boldFont,
  });
  cursor.page.drawText("Desc.", {
    x: PAGE_MARGIN + 395,
    y: headerY,
    size: SMALL_FONT_SIZE,
    font: boldFont,
  });
  cursor.page.drawText("Total", {
    x: PAGE_MARGIN + 480,
    y: headerY,
    size: SMALL_FONT_SIZE,
    font: boldFont,
  });
  cursor.y -= 30;

  for (const item of input.items) {
    if (cursor.y < PAGE_MARGIN + 80) {
      cursor = addPage(pdfDoc);
    }

    const itemName = String(item.name || "").trim() || "Item";
    const itemDescription = String(item.description || "").trim();
    const itemLines = wrapText(
      itemDescription ? `${itemName} - ${itemDescription}` : itemName,
      42
    );
    const rowHeight = Math.max(ROW_HEIGHT, itemLines.length * 12 + 4);

    cursor.page.drawRectangle({
      x: PAGE_MARGIN,
      y: cursor.y - rowHeight + 6,
      width: CONTENT_WIDTH,
      height: rowHeight,
      borderWidth: 0.5,
      borderColor: rgb(0.87, 0.88, 0.9),
    });

    let lineY = cursor.y - 10;
    for (const line of itemLines) {
      cursor.page.drawText(line, {
        x: PAGE_MARGIN + 6,
        y: lineY,
        size: SMALL_FONT_SIZE,
        font,
        color: rgb(0.18, 0.18, 0.18),
      });
      lineY -= 11;
    }

    cursor.page.drawText(String(item.quantity ?? 0), {
      x: PAGE_MARGIN + 252,
      y: cursor.y - 10,
      size: SMALL_FONT_SIZE,
      font,
    });
    cursor.page.drawText(formatCurrency(item.unitPriceCents), {
      x: PAGE_MARGIN + 300,
      y: cursor.y - 10,
      size: SMALL_FONT_SIZE,
      font,
    });
    cursor.page.drawText(formatCurrency(item.discountCents), {
      x: PAGE_MARGIN + 392,
      y: cursor.y - 10,
      size: SMALL_FONT_SIZE,
      font,
    });
    cursor.page.drawText(formatCurrency(item.totalCents), {
      x: PAGE_MARGIN + 478,
      y: cursor.y - 10,
      size: SMALL_FONT_SIZE,
      font: boldFont,
    });

    cursor.y -= rowHeight + 6;
  }

  if (cursor.y < PAGE_MARGIN + 100) {
    cursor = addPage(pdfDoc);
  }

  cursor.y -= 4;
  const totalsX = PAGE_MARGIN + 320;
  const totalLines = [
    ["Subtotal", formatCurrency(input.subtotalCents)],
    ["Desconto", formatCurrency(input.discountCents)],
    ["Total", formatCurrency(input.totalCents)],
  ] as const;

  for (const [label, value] of totalLines) {
    const isTotal = label === "Total";
    cursor.page.drawText(label, {
      x: totalsX,
      y: cursor.y,
      size: isTotal ? 11 : FONT_SIZE,
      font: isTotal ? boldFont : font,
    });
    cursor.page.drawText(value, {
      x: totalsX + 120,
      y: cursor.y,
      size: isTotal ? 11 : FONT_SIZE,
      font: isTotal ? boldFont : font,
    });
    cursor.y -= 16;
  }

  cursor.y -= SECTION_GAP;
  cursor = drawTextBlock({
    cursor,
    title: "Condicoes de pagamento",
    body: input.paymentTerms,
    font,
    boldFont,
    pdfDoc,
  });
  cursor = drawTextBlock({
    cursor,
    title: "Condicoes de entrega",
    body: input.deliveryTerms,
    font,
    boldFont,
    pdfDoc,
  });
  cursor = drawTextBlock({
    cursor,
    title: "Garantia",
    body: input.warrantyTerms,
    font,
    boldFont,
    pdfDoc,
  });
  cursor = drawTextBlock({
    cursor,
    title: "Observacoes para o cliente",
    body: input.customerNotes,
    font,
    boldFont,
    pdfDoc,
  });

  const footerText =
    "Valores e condicoes sujeitos a confirmacao da loja enquanto o orcamento nao estiver aprovado.";
  const footerLines = wrapText(footerText, 95);
  const footerStartY = PAGE_MARGIN - 6 + footerLines.length * 10;

  footerLines.forEach((line, index) => {
    cursor.page.drawText(line, {
      x: PAGE_MARGIN,
      y: footerStartY - index * 10,
      size: SMALL_FONT_SIZE,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
  });

  return pdfDoc.save();
}

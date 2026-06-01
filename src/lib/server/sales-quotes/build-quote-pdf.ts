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

type StoreBrandingSettingsRow = {
  logo_storage_bucket: string | null;
  logo_storage_path: string | null;
  logo_mime_type: string | null;
};

const PAGE_MARGIN = 48;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const ROW_HEIGHT = 24;
const FONT_SIZE = 10;
const SMALL_FONT_SIZE = 9;
const SECTION_GAP = 18;
const LOGO_MAX_WIDTH = 110;
const LOGO_MAX_HEIGHT = 52;

const COLOR_TEXT = rgb(0.17, 0.2, 0.24);
const COLOR_MUTED = rgb(0.41, 0.47, 0.53);
const COLOR_BORDER = rgb(0.84, 0.87, 0.91);
const COLOR_PANEL = rgb(0.97, 0.98, 0.99);
const COLOR_PANEL_STRONG = rgb(0.92, 0.95, 0.98);
const COLOR_ACCENT = rgb(0.11, 0.32, 0.55);
const COLOR_TOTAL_BG = rgb(0.11, 0.32, 0.55);

const TABLE_INNER_LEFT = PAGE_MARGIN + 12;
const TABLE_INNER_RIGHT = PAGE_MARGIN + CONTENT_WIDTH - 18;

const TABLE_ITEM_X = TABLE_INNER_LEFT + 4;
const TABLE_QTY_X = PAGE_MARGIN + 292;
const TABLE_UNIT_X = PAGE_MARGIN + 348;
const TABLE_DISCOUNT_X = PAGE_MARGIN + 438;

const TABLE_QTY_WIDTH = 34;
const TABLE_UNIT_WIDTH = 74;
const TABLE_DISCOUNT_WIDTH = 74;

const TABLE_UNIT_RIGHT_X = TABLE_UNIT_X + TABLE_UNIT_WIDTH;
const TABLE_DISCOUNT_RIGHT_X = Math.min(TABLE_DISCOUNT_X + TABLE_DISCOUNT_WIDTH, TABLE_INNER_RIGHT);

const TABLE_ITEM_NAME_WRAP_CHARS = 34;
const TABLE_ITEM_DESCRIPTION_WRAP_CHARS = 42;

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

function clampText(text: string, maxLength: number) {
  const safeText = String(text || "").trim();
  if (safeText.length <= maxLength) {
    return safeText;
  }

  return `${safeText.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function addPage(pdfDoc: PDFDocument): Cursor {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return {
    page,
    y: PAGE_HEIGHT - PAGE_MARGIN,
  };
}

function ensureSpace(cursor: Cursor, pdfDoc: PDFDocument, requiredHeight: number) {
  if (cursor.y >= PAGE_MARGIN + requiredHeight) {
    return cursor;
  }

  return addPage(pdfDoc);
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

function drawRightAlignedText(args: {
  page: PDFPage;
  text: string;
  rightX: number;
  y: number;
  size: number;
  font: PDFFont;
  color?: ReturnType<typeof rgb>;
}) {
  const width = args.font.widthOfTextAtSize(args.text, args.size);
  args.page.drawText(args.text, {
    x: args.rightX - width,
    y: args.y,
    size: args.size,
    font: args.font,
    color: args.color ?? COLOR_TEXT,
  });
}

function drawCenteredText(args: {
  page: PDFPage;
  text: string;
  x: number;
  width: number;
  y: number;
  size: number;
  font: PDFFont;
  color?: ReturnType<typeof rgb>;
}) {
  const textWidth = args.font.widthOfTextAtSize(args.text, args.size);
  const safeX = args.x + Math.max(0, (args.width - textWidth) / 2);
  args.page.drawText(args.text, {
    x: safeX,
    y: args.y,
    size: args.size,
    font: args.font,
    color: args.color ?? COLOR_TEXT,
  });
}

function drawLabeledValue(args: {
  page: PDFPage;
  label: string;
  value: string;
  x: number;
  y: number;
  labelFont: PDFFont;
  valueFont: PDFFont;
  labelSize?: number;
  valueSize?: number;
}) {
  const labelSize = args.labelSize ?? 8;
  const valueSize = args.valueSize ?? 10;

  args.page.drawText(args.label, {
    x: args.x,
    y: args.y,
    size: labelSize,
    font: args.labelFont,
    color: COLOR_MUTED,
  });

  args.page.drawText(args.value, {
    x: args.x,
    y: args.y - 13,
    size: valueSize,
    font: args.valueFont,
    color: COLOR_TEXT,
  });
}

function drawSectionCard(args: {
  cursor: Cursor;
  title: string;
  body: string | null | undefined;
  font: PDFFont;
  boldFont: PDFFont;
  pdfDoc: PDFDocument;
}) {
  const safeBody = String(args.body || "").trim();
  if (!safeBody) {
    return args.cursor;
  }

  const lines = wrapText(safeBody, 92);
  const cardHeight = 30 + lines.length * 12;
  let cursor = ensureSpace(args.cursor, args.pdfDoc, cardHeight + 14);

  cursor.page.drawRectangle({
    x: PAGE_MARGIN,
    y: cursor.y - cardHeight,
    width: CONTENT_WIDTH,
    height: cardHeight,
    color: COLOR_PANEL,
    borderWidth: 0.7,
    borderColor: COLOR_BORDER,
  });

  cursor.page.drawText(args.title, {
    x: PAGE_MARGIN + 14,
    y: cursor.y - 15,
    size: SMALL_FONT_SIZE,
    font: args.boldFont,
    color: COLOR_ACCENT,
  });

  let lineY = cursor.y - 30;
  for (const line of lines) {
    cursor.page.drawText(line, {
      x: PAGE_MARGIN + 14,
      y: lineY,
      size: FONT_SIZE,
      font: args.font,
      color: COLOR_TEXT,
    });
    lineY -= 12;
  }

  cursor.y -= cardHeight + 8;
  return cursor;
}

function drawItemsTableHeader(args: { cursor: Cursor; boldFont: PDFFont }) {
  args.cursor.page.drawRectangle({
    x: PAGE_MARGIN,
    y: args.cursor.y - 24,
    width: CONTENT_WIDTH,
    height: 24,
    color: COLOR_PANEL_STRONG,
    borderWidth: 0.7,
    borderColor: COLOR_BORDER,
  });

  const headerY = args.cursor.y - 15;
  args.cursor.page.drawText("Item", {
    x: TABLE_ITEM_X,
    y: headerY,
    size: SMALL_FONT_SIZE,
    font: args.boldFont,
    color: COLOR_ACCENT,
  });

  drawCenteredText({
    page: args.cursor.page,
    text: "Qtd.",
    x: TABLE_QTY_X,
    width: TABLE_QTY_WIDTH,
    y: headerY,
    size: SMALL_FONT_SIZE,
    font: args.boldFont,
    color: COLOR_ACCENT,
  });

  drawRightAlignedText({
    page: args.cursor.page,
    text: "Unitário",
    rightX: TABLE_UNIT_RIGHT_X,
    y: headerY,
    size: SMALL_FONT_SIZE,
    font: args.boldFont,
    color: COLOR_ACCENT,
  });

  drawRightAlignedText({
    page: args.cursor.page,
    text: "Desconto",
    rightX: TABLE_DISCOUNT_RIGHT_X,
    y: headerY,
    size: SMALL_FONT_SIZE,
    font: args.boldFont,
    color: COLOR_ACCENT,
  });
}

function drawTextBlock(args: {
  cursor: Cursor;
  title?: string | null;
  body: string | null | undefined;
  font: PDFFont;
  boldFont: PDFFont;
  pdfDoc: PDFDocument;
}) {
  const title = String(args.title || "").trim() || "Informações";
  return drawSectionCard({
    cursor: args.cursor,
    title,
    body: args.body,
    font: args.font,
    boldFont: args.boldFont,
    pdfDoc: args.pdfDoc,
  });
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

export async function buildQuotePdf(input: BuildQuotePdfInput) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const embeddedLogo = await embedStoreLogo(pdfDoc, input.storeLogo || null);

  let cursor = addPage(pdfDoc);
  const safeStoreName = String(input.storeName || "").trim() || "Loja";
  const safeTitle = String(input.title || "").trim() || "Orçamento";
  const safeCustomerName = String(input.customerName || "").trim() || "-";
  const safeCustomerPhone = String(input.customerPhone || "").trim() || "-";
  const safeQuoteNumber = String(input.quoteNumber || "").trim() || "-";

  cursor.page.drawRectangle({
    x: PAGE_MARGIN,
    y: cursor.y + 18,
    width: CONTENT_WIDTH,
    height: 4,
    color: COLOR_ACCENT,
  });

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

    cursor.page.drawText(safeStoreName, {
      x: storeNameX,
      y: storeNameY,
      size: 20,
      font: boldFont,
      color: COLOR_TEXT,
    });

    cursor.page.drawText("Proposta comercial", {
      x: storeNameX,
      y: storeNameY - 16,
      size: SMALL_FONT_SIZE,
      font,
      color: COLOR_MUTED,
    });

    headerBottomY = Math.min(logoBottomY, storeNameY - 18);
  } else {
    cursor.page.drawText(safeStoreName, {
      x: PAGE_MARGIN,
      y: cursor.y,
      size: 20,
      font: boldFont,
      color: COLOR_TEXT,
    });

    cursor.page.drawText("Proposta comercial", {
      x: PAGE_MARGIN,
      y: cursor.y - 16,
      size: SMALL_FONT_SIZE,
      font,
      color: COLOR_MUTED,
    });

    headerBottomY = cursor.y - 26;
  }

  const summaryCardWidth = 190;
  const summaryCardHeight = 74;
  const summaryCardX = PAGE_MARGIN + CONTENT_WIDTH - summaryCardWidth;
  const summaryCardTopY = PAGE_HEIGHT - PAGE_MARGIN - 2;
  cursor.page.drawRectangle({
    x: summaryCardX,
    y: summaryCardTopY - summaryCardHeight,
    width: summaryCardWidth,
    height: summaryCardHeight,
    color: COLOR_PANEL,
    borderWidth: 0.8,
    borderColor: COLOR_BORDER,
  });

  cursor.page.drawText("Orçamento", {
    x: summaryCardX + 14,
    y: summaryCardTopY - 18,
    size: 16,
    font: boldFont,
    color: COLOR_ACCENT,
  });

  drawLabeledValue({
    page: cursor.page,
    label: "Número",
    value: safeQuoteNumber,
    x: summaryCardX + 14,
    y: summaryCardTopY - 34,
    labelFont: boldFont,
    valueFont: boldFont,
    valueSize: 10,
  });

  drawLabeledValue({
    page: cursor.page,
    label: "Data",
    value: formatDate(input.createdAt),
    x: summaryCardX + 14,
    y: summaryCardTopY - 55,
    labelFont: boldFont,
    valueFont: font,
    valueSize: 9,
  });

  drawLabeledValue({
    page: cursor.page,
    label: "Validade",
    value: formatDate(input.validUntil),
    x: summaryCardX + 96,
    y: summaryCardTopY - 55,
    labelFont: boldFont,
    valueFont: font,
    valueSize: 9,
  });

  cursor.y = Math.min(headerBottomY, summaryCardTopY - summaryCardHeight) - 12;

  cursor.page.drawText(clampText(safeTitle, 80), {
    x: PAGE_MARGIN,
    y: cursor.y,
    size: 14,
    font: boldFont,
    color: COLOR_TEXT,
  });
  cursor.y -= 18;

  const infoCardHeight = 56;
  const infoCardGap = 12;
  const leftCardWidth = Math.floor((CONTENT_WIDTH - infoCardGap) * 0.56);
  const rightCardWidth = CONTENT_WIDTH - leftCardWidth - infoCardGap;
  const rightCardX = PAGE_MARGIN + leftCardWidth + infoCardGap;

  cursor.page.drawRectangle({
    x: PAGE_MARGIN,
    y: cursor.y - infoCardHeight,
    width: leftCardWidth,
    height: infoCardHeight,
    color: COLOR_PANEL,
    borderWidth: 0.7,
    borderColor: COLOR_BORDER,
  });

  cursor.page.drawRectangle({
    x: rightCardX,
    y: cursor.y - infoCardHeight,
    width: rightCardWidth,
    height: infoCardHeight,
    color: COLOR_PANEL,
    borderWidth: 0.7,
    borderColor: COLOR_BORDER,
  });

  cursor.page.drawText("Cliente", {
    x: PAGE_MARGIN + 14,
    y: cursor.y - 16,
    size: SMALL_FONT_SIZE,
    font: boldFont,
    color: COLOR_ACCENT,
  });

  cursor.page.drawText(safeCustomerName, {
    x: PAGE_MARGIN + 14,
    y: cursor.y - 31,
    size: 11.5,
    font: boldFont,
    color: COLOR_TEXT,
  });

  cursor.page.drawText(`Telefone: ${safeCustomerPhone}`, {
    x: PAGE_MARGIN + 14,
    y: cursor.y - 46,
    size: FONT_SIZE,
    font,
    color: COLOR_TEXT,
  });

  cursor.page.drawText("Resumo", {
    x: rightCardX + 14,
    y: cursor.y - 16,
    size: SMALL_FONT_SIZE,
    font: boldFont,
    color: COLOR_ACCENT,
  });

  drawLabeledValue({
    page: cursor.page,
    label: "Número",
    value: safeQuoteNumber,
    x: rightCardX + 14,
    y: cursor.y - 34,
    labelFont: boldFont,
    valueFont: font,
    valueSize: 9,
  });

  drawLabeledValue({
    page: cursor.page,
    label: "Validade",
    value: formatDate(input.validUntil),
    x: rightCardX + 108,
    y: cursor.y - 34,
    labelFont: boldFont,
    valueFont: font,
    valueSize: 9,
  });

  cursor.y -= infoCardHeight + 12;

  drawItemsTableHeader({
    cursor,
    boldFont,
  });
  cursor.y -= 34;

  for (const [index, item] of input.items.entries()) {
    const itemName = String(item.name || "").trim() || "Item";
    const itemDescription = String(item.description || "").trim();
    const itemNameLines = wrapText(itemName, TABLE_ITEM_NAME_WRAP_CHARS);
    const itemDescriptionLines = itemDescription ? wrapText(itemDescription, TABLE_ITEM_DESCRIPTION_WRAP_CHARS) : [];
    const lineCount = itemNameLines.length + itemDescriptionLines.length;
    const rowHeight = Math.max(ROW_HEIGHT, 14 + lineCount * 12);

    if (cursor.y < PAGE_MARGIN + rowHeight + 130) {
      cursor = addPage(pdfDoc);
      drawItemsTableHeader({
        cursor,
        boldFont,
      });
      cursor.y -= 34;
    }

    cursor.page.drawRectangle({
      x: PAGE_MARGIN,
      y: cursor.y - rowHeight,
      width: CONTENT_WIDTH,
      height: rowHeight,
      color: index % 2 === 0 ? rgb(1, 1, 1) : rgb(0.989, 0.992, 0.996),
      borderWidth: 0.6,
      borderColor: COLOR_BORDER,
    });

    let lineY = cursor.y - 15;
    for (const line of itemNameLines) {
      cursor.page.drawText(line, {
        x: TABLE_ITEM_X,
        y: lineY,
        size: FONT_SIZE,
        font: boldFont,
        color: COLOR_TEXT,
      });
      lineY -= 12;
    }

    for (const line of itemDescriptionLines) {
      cursor.page.drawText(line, {
        x: TABLE_ITEM_X,
        y: lineY,
        size: SMALL_FONT_SIZE,
        font,
        color: COLOR_MUTED,
      });
      lineY -= 11;
    }

    drawCenteredText({
      page: cursor.page,
      text: String(item.quantity ?? 0),
      x: TABLE_QTY_X,
      width: TABLE_QTY_WIDTH,
      y: cursor.y - 16,
      size: SMALL_FONT_SIZE,
      font,
      color: COLOR_TEXT,
    });

    drawRightAlignedText({
      page: cursor.page,
      text: formatCurrency(item.unitPriceCents),
      rightX: TABLE_UNIT_RIGHT_X,
      y: cursor.y - 16,
      size: SMALL_FONT_SIZE,
      font,
      color: COLOR_TEXT,
    });

    drawRightAlignedText({
      page: cursor.page,
      text: formatCurrency(item.discountCents),
      rightX: TABLE_DISCOUNT_RIGHT_X,
      y: cursor.y - 16,
      size: SMALL_FONT_SIZE,
      font,
      color: COLOR_TEXT,
    });

    cursor.y -= rowHeight + 6;
  }

  cursor = ensureSpace(cursor, pdfDoc, 190);
  cursor.y -= 0;

  const totalsCardWidth = 220;
  const totalsCardHeight = 96;
  const totalsX = PAGE_MARGIN + CONTENT_WIDTH - totalsCardWidth;

  cursor.page.drawRectangle({
    x: totalsX,
    y: cursor.y - totalsCardHeight,
    width: totalsCardWidth,
    height: totalsCardHeight,
    color: COLOR_PANEL,
    borderWidth: 0.8,
    borderColor: COLOR_BORDER,
  });

  cursor.page.drawText("Totais", {
    x: totalsX + 14,
    y: cursor.y - 16,
    size: SMALL_FONT_SIZE,
    font: boldFont,
    color: COLOR_ACCENT,
  });

  const subtotalY = cursor.y - 36;
  const discountY = cursor.y - 56;
  const totalBarY = cursor.y - 88;
  const totalTextY = totalBarY + 10;

  cursor.page.drawText("Subtotal", {
    x: totalsX + 14,
    y: subtotalY,
    size: FONT_SIZE,
    font,
    color: COLOR_TEXT,
  });

  drawRightAlignedText({
    page: cursor.page,
    text: formatCurrency(input.subtotalCents),
    rightX: totalsX + totalsCardWidth - 16,
    y: subtotalY,
    size: FONT_SIZE,
    font,
    color: COLOR_TEXT,
  });

  cursor.page.drawText("Desconto", {
    x: totalsX + 14,
    y: discountY,
    size: FONT_SIZE,
    font,
    color: COLOR_TEXT,
  });

  drawRightAlignedText({
    page: cursor.page,
    text: formatCurrency(input.discountCents),
    rightX: totalsX + totalsCardWidth - 16,
    y: discountY,
    size: FONT_SIZE,
    font,
    color: COLOR_TEXT,
  });

  cursor.page.drawRectangle({
    x: totalsX + 10,
    y: totalBarY,
    width: totalsCardWidth - 20,
    height: 26,
    color: COLOR_TOTAL_BG,
  });

  cursor.page.drawText("TOTAL", {
    x: totalsX + 16,
    y: totalTextY,
    size: 11,
    font: boldFont,
    color: rgb(1, 1, 1),
  });

  drawRightAlignedText({
    page: cursor.page,
    text: formatCurrency(input.totalCents),
    rightX: totalsX + totalsCardWidth - 18,
    y: totalTextY,
    size: 11,
    font: boldFont,
    color: rgb(1, 1, 1),
  });

  cursor.y -= totalsCardHeight + 12;

  cursor = drawTextBlock({
    cursor,
    title: "Condições de pagamento",
    body: input.paymentTerms,
    font,
    boldFont,
    pdfDoc,
  });

  cursor = drawTextBlock({
    cursor,
    title: "Condições de entrega",
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
    title: "Observações para o cliente",
    body: input.customerNotes,
    font,
    boldFont,
    pdfDoc,
  });

  cursor = drawTextBlock({
    cursor,
    title: "Validade",
    body: input.validUntil ? `Este orçamento é válido até ${formatDate(input.validUntil)}.` : null,
    font,
    boldFont,
    pdfDoc,
  });

  const footerText =
    "Orçamento gerado pela loja. Valores sujeitos à confirmação enquanto a proposta não estiver aprovada.";
  const footerLines = wrapText(footerText, 95);
  const footerBaseY = Math.max(PAGE_MARGIN + 6, cursor.y - 8);

  cursor.page.drawLine({
    start: { x: PAGE_MARGIN, y: footerBaseY + 12 },
    end: { x: PAGE_MARGIN + CONTENT_WIDTH, y: footerBaseY + 12 },
    thickness: 0.8,
    color: COLOR_BORDER,
  });

  footerLines.forEach((line, index) => {
    cursor.page.drawText(line, {
      x: PAGE_MARGIN,
      y: footerBaseY - index * 10,
      size: SMALL_FONT_SIZE,
      font,
      color: COLOR_MUTED,
    });
  });

  return pdfDoc.save();
}

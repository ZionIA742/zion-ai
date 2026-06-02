import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { ContractPdfItem } from "./types";

export type BuildContractPdfInput = {
  storeName: string | null;
  storeLogo?: {
    bytes: Uint8Array;
    mimeType: string;
  } | null;
  contractNumber: string | null;
  quoteNumber?: string | null;
  title?: string | null;
  customerName: string | null;
  customerPhone: string | null;
  createdAt: string | null;
  validUntil: string | null;
  items: ContractPdfItem[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  warrantyTerms: string | null;
  contractTerms: string | null;
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

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const COLOR_TEXT = rgb(0.13, 0.16, 0.2);
const COLOR_MUTED = rgb(0.39, 0.44, 0.5);
const COLOR_BORDER = rgb(0.82, 0.86, 0.9);
const COLOR_PANEL = rgb(0.97, 0.98, 0.99);
const COLOR_ACCENT = rgb(0.07, 0.27, 0.48);

function formatCurrency(cents: number | null | undefined) {
  const safeValue = Number.isFinite(cents) ? Number(cents) / 100 : 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(safeValue);
}

function formatDate(value: string | null | undefined) {
  const safeValue = String(value || "").trim();
  if (!safeValue) return "Nao informado";

  const date = new Date(safeValue);
  if (Number.isNaN(date.getTime())) return safeValue;
  return date.toLocaleDateString("pt-BR");
}

function toDisplayText(value: string | null | undefined, fallback = "Nao informado") {
  const safeValue = String(value || "").trim();
  return safeValue || fallback;
}

function wrapText(text: string, maxCharsPerLine: number) {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return [""];
  }

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

function ensureSpace(cursor: Cursor, pdfDoc: PDFDocument, requiredHeight: number) {
  if (cursor.y >= PAGE_MARGIN + requiredHeight) {
    return cursor;
  }

  return addPage(pdfDoc);
}

function drawParagraph(args: {
  cursor: Cursor;
  pdfDoc: PDFDocument;
  text: string;
  font: PDFFont;
  size?: number;
  color?: ReturnType<typeof rgb>;
  title?: string | null;
  boldFont?: PDFFont;
}) {
  const lines = wrapText(args.text, 96);
  const title = String(args.title || "").trim();
  const size = args.size ?? 10;
  const height = (title ? 20 : 0) + lines.length * 12 + 8;
  let cursor = ensureSpace(args.cursor, args.pdfDoc, height);

  if (title && args.boldFont) {
    cursor.page.drawText(title, {
      x: PAGE_MARGIN,
      y: cursor.y,
      size: 10,
      font: args.boldFont,
      color: COLOR_ACCENT,
    });
    cursor.y -= 16;
  }

  for (const line of lines) {
    cursor.page.drawText(line, {
      x: PAGE_MARGIN,
      y: cursor.y,
      size,
      font: args.font,
      color: args.color ?? COLOR_TEXT,
    });
    cursor.y -= 12;
  }

  cursor.y -= 8;
  return cursor;
}

async function embedStoreLogo(pdfDoc: PDFDocument, storeLogo: BuildContractPdfInput["storeLogo"]) {
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

function drawSectionBox(args: {
  cursor: Cursor;
  pdfDoc: PDFDocument;
  title: string;
  lines: string[];
  font: PDFFont;
  boldFont: PDFFont;
}) {
  const height = 28 + args.lines.length * 12;
  let cursor = ensureSpace(args.cursor, args.pdfDoc, height + 8);

  cursor.page.drawRectangle({
    x: PAGE_MARGIN,
    y: cursor.y - height,
    width: CONTENT_WIDTH,
    height,
    color: COLOR_PANEL,
    borderColor: COLOR_BORDER,
    borderWidth: 0.7,
  });

  cursor.page.drawText(args.title, {
    x: PAGE_MARGIN + 12,
    y: cursor.y - 16,
    size: 9,
    font: args.boldFont,
    color: COLOR_ACCENT,
  });

  let lineY = cursor.y - 31;
  for (const line of args.lines) {
    cursor.page.drawText(line, {
      x: PAGE_MARGIN + 12,
      y: lineY,
      size: 10,
      font: args.font,
      color: COLOR_TEXT,
    });
    lineY -= 12;
  }

  cursor.y -= height + 10;
  return cursor;
}

function drawKeyValue(args: {
  page: PDFPage;
  label: string;
  value: string;
  x: number;
  y: number;
  labelFont: PDFFont;
  valueFont: PDFFont;
}) {
  args.page.drawText(args.label, {
    x: args.x,
    y: args.y,
    size: 8,
    font: args.labelFont,
    color: COLOR_MUTED,
  });

  args.page.drawText(args.value, {
    x: args.x,
    y: args.y - 12,
    size: 10,
    font: args.valueFont,
    color: COLOR_TEXT,
  });
}

function scaleLogoDimensions(args: { width: number; height: number }) {
  const maxWidth = 100;
  const maxHeight = 48;
  const safeWidth = Math.max(1, args.width);
  const safeHeight = Math.max(1, args.height);
  const ratio = Math.min(maxWidth / safeWidth, maxHeight / safeHeight, 1);

  return {
    width: safeWidth * ratio,
    height: safeHeight * ratio,
  };
}

export async function loadStoreLogoForContractPdf(args: {
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
    console.error("[buildContractPdf] logo fallback sem imagem:", error);
    return null;
  }
}

export async function buildContractPdf(input: BuildContractPdfInput) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const embeddedLogo = await embedStoreLogo(pdfDoc, input.storeLogo || null);

  let cursor = addPage(pdfDoc);
  const storeName = toDisplayText(input.storeName, "Loja");
  const contractNumber = toDisplayText(input.contractNumber, "Nao informado");
  const quoteNumber = toDisplayText(input.quoteNumber, "Nao informado");
  const customerName = toDisplayText(input.customerName);
  const customerPhone = toDisplayText(input.customerPhone);
  const title =
    toDisplayText(
      input.title,
      "CONTRATO DE COMPRA E VENDA / PRESTACAO DE SERVICO"
    );

  cursor.page.drawRectangle({
    x: PAGE_MARGIN,
    y: cursor.y + 14,
    width: CONTENT_WIDTH,
    height: 4,
    color: COLOR_ACCENT,
  });

  let headerBottomY = cursor.y - 10;
  if (embeddedLogo) {
    const size = scaleLogoDimensions({
      width: embeddedLogo.width,
      height: embeddedLogo.height,
    });
    const logoBottom = cursor.y - size.height + 6;

    cursor.page.drawImage(embeddedLogo, {
      x: PAGE_MARGIN,
      y: logoBottom,
      width: size.width,
      height: size.height,
    });

    cursor.page.drawText(storeName, {
      x: PAGE_MARGIN + size.width + 14,
      y: cursor.y - 4,
      size: 18,
      font: boldFont,
      color: COLOR_TEXT,
    });

    cursor.page.drawText("Documento contratual gerado pela loja", {
      x: PAGE_MARGIN + size.width + 14,
      y: cursor.y - 20,
      size: 9,
      font,
      color: COLOR_MUTED,
    });

    headerBottomY = Math.min(logoBottom, cursor.y - 24);
  } else {
    cursor.page.drawText(storeName, {
      x: PAGE_MARGIN,
      y: cursor.y,
      size: 18,
      font: boldFont,
      color: COLOR_TEXT,
    });

    cursor.page.drawText("Documento contratual gerado pela loja", {
      x: PAGE_MARGIN,
      y: cursor.y - 16,
      size: 9,
      font,
      color: COLOR_MUTED,
    });

    headerBottomY = cursor.y - 26;
  }

  cursor.y = headerBottomY - 10;
  cursor.page.drawText(title, {
    x: PAGE_MARGIN,
    y: cursor.y,
    size: 14,
    font: boldFont,
    color: COLOR_TEXT,
  });
  cursor.y -= 20;

  cursor.page.drawRectangle({
    x: PAGE_MARGIN,
    y: cursor.y - 62,
    width: CONTENT_WIDTH,
    height: 62,
    color: COLOR_PANEL,
    borderColor: COLOR_BORDER,
    borderWidth: 0.7,
  });

  drawKeyValue({
    page: cursor.page,
    label: "Contrato",
    value: contractNumber,
    x: PAGE_MARGIN + 12,
    y: cursor.y - 14,
    labelFont: boldFont,
    valueFont: boldFont,
  });

  drawKeyValue({
    page: cursor.page,
    label: "Orcamento de referencia",
    value: quoteNumber,
    x: PAGE_MARGIN + 180,
    y: cursor.y - 14,
    labelFont: boldFont,
    valueFont: font,
  });

  drawKeyValue({
    page: cursor.page,
    label: "Emitido em",
    value: formatDate(input.createdAt),
    x: PAGE_MARGIN + 12,
    y: cursor.y - 39,
    labelFont: boldFont,
    valueFont: font,
  });

  drawKeyValue({
    page: cursor.page,
    label: "Validade",
    value: formatDate(input.validUntil),
    x: PAGE_MARGIN + 180,
    y: cursor.y - 39,
    labelFont: boldFont,
    valueFont: font,
  });

  cursor.y -= 76;

  cursor = drawSectionBox({
    cursor,
    pdfDoc,
    title: "PARTES",
    lines: [
      `Loja contratante: ${storeName}`,
      `Cliente: ${customerName}`,
      `Telefone do cliente: ${customerPhone}`,
    ],
    font,
    boldFont,
  });

  const itemLines =
    input.items.length > 0
      ? input.items.flatMap((item, index) => {
          const name = toDisplayText(item.name, "Item nao informado");
          const description = toDisplayText(item.description, "A definir pela loja");
          return [
            `${index + 1}. ${name}`,
            `Qtd.: ${Number(item.quantity || 0) || 0} | Unit.: ${formatCurrency(
              item.unit_price_cents
            )} | Desc.: ${formatCurrency(item.discount_cents)} | Total: ${formatCurrency(
              item.total_cents
            )}`,
            description,
          ];
        })
      : ["Itens principais nao informados. A definir pela loja."];

  cursor = drawSectionBox({
    cursor,
    pdfDoc,
    title: "OBJETO E ITENS PRINCIPAIS",
    lines: itemLines,
    font,
    boldFont,
  });

  cursor = drawSectionBox({
    cursor,
    pdfDoc,
    title: "VALORES",
    lines: [
      `Subtotal: ${formatCurrency(input.subtotalCents)}`,
      `Desconto: ${formatCurrency(input.discountCents)}`,
      `Total: ${formatCurrency(input.totalCents)}`,
    ],
    font,
    boldFont,
  });

  cursor = drawParagraph({
    cursor,
    pdfDoc,
    title: "CONDICOES DE PAGAMENTO",
    text: toDisplayText(input.paymentTerms, "A definir pela loja"),
    font,
    boldFont,
  });

  cursor = drawParagraph({
    cursor,
    pdfDoc,
    title: "ENTREGA / INSTALACAO",
    text: toDisplayText(input.deliveryTerms, "A definir pela loja"),
    font,
    boldFont,
  });

  cursor = drawParagraph({
    cursor,
    pdfDoc,
    title: "GARANTIA",
    text: toDisplayText(input.warrantyTerms, "A definir pela loja"),
    font,
    boldFont,
  });

  cursor = drawParagraph({
    cursor,
    pdfDoc,
    title: "CLAUSULAS E TERMOS",
    text: toDisplayText(
      input.contractTerms,
      "Contrato gerado em versao inicial. Validacao final e uso conforme regras da loja."
    ),
    font,
    boldFont,
  });

  cursor = drawParagraph({
    cursor,
    pdfDoc,
    title: "VALIDADE",
    text: input.validUntil
      ? `Este contrato permanece em analise ate ${formatDate(input.validUntil)}.`
      : "Prazo de validade nao informado.",
    font,
    boldFont,
  });

  cursor = ensureSpace(cursor, pdfDoc, 130);
  cursor.page.drawRectangle({
    x: PAGE_MARGIN,
    y: cursor.y - 54,
    width: CONTENT_WIDTH,
    height: 54,
    color: COLOR_PANEL,
    borderColor: COLOR_BORDER,
    borderWidth: 0.7,
  });
  cursor.page.drawText("ACEITE DO CLIENTE", {
    x: PAGE_MARGIN + 12,
    y: cursor.y - 16,
    size: 9,
    font: boldFont,
    color: COLOR_ACCENT,
  });
  cursor.page.drawText(
    "Espaco reservado para aceite rastreavel do cliente. A IA nao assina este contrato.",
    {
      x: PAGE_MARGIN + 12,
      y: cursor.y - 32,
      size: 10,
      font,
      color: COLOR_TEXT,
    }
  );
  cursor.y -= 66;

  cursor = ensureSpace(cursor, pdfDoc, 130);
  cursor.page.drawRectangle({
    x: PAGE_MARGIN,
    y: cursor.y - 54,
    width: CONTENT_WIDTH,
    height: 54,
    color: COLOR_PANEL,
    borderColor: COLOR_BORDER,
    borderWidth: 0.7,
  });
  cursor.page.drawText("ASSINATURA / CONFIRMACAO DA LOJA", {
    x: PAGE_MARGIN + 12,
    y: cursor.y - 16,
    size: 9,
    font: boldFont,
    color: COLOR_ACCENT,
  });
  cursor.page.drawText(
    "Espaco reservado para assinatura ou confirmacao humana da loja apos o aceite do cliente.",
    {
      x: PAGE_MARGIN + 12,
      y: cursor.y - 32,
      size: 10,
      font,
      color: COLOR_TEXT,
    }
  );
  cursor.y -= 68;

  const footerLines = wrapText(
    "Documento gerado pelo ZION para apoio operacional da loja. O uso final deste contrato depende da validacao e das regras comerciais, juridicas e operacionais aplicaveis.",
    95
  );
  cursor = ensureSpace(cursor, pdfDoc, 60);
  cursor.page.drawLine({
    start: { x: PAGE_MARGIN, y: cursor.y + 8 },
    end: { x: PAGE_MARGIN + CONTENT_WIDTH, y: cursor.y + 8 },
    thickness: 0.8,
    color: COLOR_BORDER,
  });

  footerLines.forEach((line, index) => {
    cursor.page.drawText(line, {
      x: PAGE_MARGIN,
      y: cursor.y - index * 10,
      size: 8.5,
      font,
      color: COLOR_MUTED,
    });
  });

  return pdfDoc.save();
}

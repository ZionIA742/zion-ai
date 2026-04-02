import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";

const DEBUG_INTELLIGENT_IMPORT =
  process.env.NODE_ENV !== "production" ||
  process.env.DEBUG_INTELLIGENT_IMPORT === "1";

function debugIntelligentImport(...args: unknown[]) {
  if (!DEBUG_INTELLIGENT_IMPORT) return;
  console.log("[ZION][intelligent-import][extractors]", ...args);
}

export type ExtractedImageAsset = {
  fileName: string;
  source: "docx" | "xlsx" | "pptx" | "pdf" | "image_file";
  mimeType: string;
  dataUrl: string;
};

export type ExtractedFileContent = {
  fileName: string;
  mimeType: string;
  extension: string;
  text: string;
  extractedImages?: ExtractedImageAsset[];
};

function getExtension(fileName: string) {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function getImageMimeTypeFromExtension(fileName: string) {
  const extension = getExtension(fileName);

  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "bmp") return "image/bmp";
  if (extension === "svg") return "image/svg+xml";

  return "application/octet-stream";
}

function bufferToDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function cleanInlineText(value: string) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractImagesFromZip(params: {
  buffer: Buffer;
  mediaPrefix: string;
  source: ExtractedImageAsset["source"];
}) {
  const zip = await JSZip.loadAsync(params.buffer);
  const assets: ExtractedImageAsset[] = [];

  for (const [path, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    if (!path.startsWith(params.mediaPrefix)) continue;

    const buffer = await zipEntry.async("nodebuffer");
    const fileName = path.split("/").pop() || "image";
    const mimeType = getImageMimeTypeFromExtension(fileName);

    assets.push({
      fileName,
      source: params.source,
      mimeType,
      dataUrl: bufferToDataUrl(buffer, mimeType),
    });
  }

  debugIntelligentImport("extractImagesFromZip", {
    source: params.source,
    mediaPrefix: params.mediaPrefix,
    count: assets.length,
    fileNamesPreview: assets.slice(0, 12).map((asset) => asset.fileName),
  });

  return assets;
}

async function extractTextFromDocx(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  const text = cleanInlineText(result.value || "");
  debugIntelligentImport("extractTextFromDocx", {
    textLength: text.length,
    preview: text.slice(0, 300),
  });
  return text;
}

async function extractTextFromTxt(buffer: Buffer) {
  const text = cleanInlineText(buffer.toString("utf-8"));
  debugIntelligentImport("extractTextFromTxt", {
    textLength: text.length,
    preview: text.slice(0, 300),
  });
  return text;
}

function normalizeHeaderLabel(value: unknown, index: number) {
  const label = String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return label || `campo_${index + 1}`;
}

function isUsefulRow(row: unknown[]) {
  return row.some((cell) => String(cell ?? "").trim() !== "");
}

function chooseHeaderRow(rows: unknown[][]) {
  const firstRows = rows.slice(0, Math.min(10, rows.length));

  let bestIndex = 0;
  let bestScore = -1;

  for (let index = 0; index < firstRows.length; index += 1) {
    const row = firstRows[index];
    const nonEmpty = row.filter((cell) => String(cell ?? "").trim() !== "").length;
    if (nonEmpty === 0) continue;

    const score =
      nonEmpty * 3 +
      row.filter((cell) => {
        const value = String(cell ?? "").trim();
        return value.length > 2 && !/^\d+([.,]\d+)?$/.test(value);
      }).length * 2;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function buildItemBlocksFromSheet(sheetName: string, rows: unknown[][]) {
  const usefulRows = rows.filter(isUsefulRow);
  if (usefulRows.length === 0) return [];

  const headerIndex = chooseHeaderRow(usefulRows);
  const headerRow = usefulRows[headerIndex] || [];
  const headers = headerRow.map((cell, index) => normalizeHeaderLabel(cell, index));
  const dataRows = usefulRows.slice(headerIndex + 1);

  const blocks: string[] = [];

  dataRows.forEach((row, index) => {
    const pairs: string[] = [];

    headers.forEach((header, columnIndex) => {
      const value = String(row[columnIndex] ?? "")
        .replace(/\r/g, "")
        .replace(/\n+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!value) return;
      pairs.push(`${header}: ${value}`);
    });

    if (pairs.length === 0) return;

    blocks.push(
      [
        `=== ITEM ${index + 1} | PLANILHA: ${sheetName} ===`,
        ...pairs,
      ].join("\n")
    );
  });

  debugIntelligentImport("buildItemBlocksFromSheet", {
    sheetName,
    usefulRows: usefulRows.length,
    headerIndex,
    headerPreview: headers.slice(0, 20),
    dataRows: dataRows.length,
    blocks: blocks.length,
    firstBlockPreview: blocks[0]?.slice(0, 300) ?? "",
    lastBlockPreview: blocks[blocks.length - 1]?.slice(0, 300) ?? "",
  });

  return blocks;
}

async function extractTextFromXlsx(buffer: Buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    raw: false,
    dense: false,
  });

  const parts: string[] = [];

  debugIntelligentImport("extractTextFromXlsx:start", {
    sheetNames: workbook.SheetNames,
  });

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    }) as unknown[][];

    const itemBlocks = buildItemBlocksFromSheet(sheetName, rows);

    parts.push(`PLANILHA: ${sheetName}`);

    if (itemBlocks.length > 0) {
      parts.push(...itemBlocks);
    } else {
      const fallback = rows
        .filter(isUsefulRow)
        .map((row) =>
          row
            .map((cell) => String(cell ?? "").trim())
            .filter(Boolean)
            .join(" | ")
        )
        .filter(Boolean);

      debugIntelligentImport("extractTextFromXlsx:fallbackSheet", {
        sheetName,
        rows: rows.length,
        fallbackRows: fallback.length,
        firstFallbackPreview: fallback[0]?.slice(0, 300) ?? "",
      });

      parts.push(...fallback);
    }

    parts.push("");
  }

  const text = cleanInlineText(parts.join("\n"));

  debugIntelligentImport("extractTextFromXlsx:done", {
    sheetNames: workbook.SheetNames,
    textLength: text.length,
    itemMarkers: (text.match(/=== ITEM/gi) || []).length,
    preview: text.slice(0, 500),
  });

  return text;
}

async function extractTextFromPptx(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const parts: string[] = [];

  for (const slidePath of slides) {
    const file = zip.files[slidePath];
    if (!file) continue;

    const xml = await file.async("text");
    const texts = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map((match) =>
      match[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim()
    );

    const slideNumberMatch = slidePath.match(/slide(\d+)\.xml/i);
    const slideNumber = slideNumberMatch ? slideNumberMatch[1] : "?";

    parts.push(`SLIDE: ${slideNumber}`);

    const slideText = texts.filter(Boolean).join("\n").trim();
    if (slideText) {
      parts.push(slideText);
    }

    parts.push("");
  }

  const text = cleanInlineText(parts.join("\n"));
  debugIntelligentImport("extractTextFromPptx", {
    slides: slides.length,
    textLength: text.length,
    preview: text.slice(0, 300),
  });
  return text;
}

async function extractTextFromPdf(buffer: Buffer) {
  try {
    const pdfParseModule = await import("pdf-parse");
    const pdfParseFn: any = (pdfParseModule as any).default ?? (pdfParseModule as any);
    const result = await pdfParseFn(buffer);
    const text = cleanInlineText(result?.text || "");
    debugIntelligentImport("extractTextFromPdf", {
      textLength: text.length,
      preview: text.slice(0, 300),
    });
    return text;
  } catch (error) {
    debugIntelligentImport("extractTextFromPdf:error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

async function extractImagesFromDocx(buffer: Buffer) {
  return extractImagesFromZip({
    buffer,
    mediaPrefix: "word/media/",
    source: "docx",
  });
}

async function extractImagesFromXlsx(buffer: Buffer) {
  return extractImagesFromZip({
    buffer,
    mediaPrefix: "xl/media/",
    source: "xlsx",
  });
}

async function extractImagesFromPptx(buffer: Buffer) {
  return extractImagesFromZip({
    buffer,
    mediaPrefix: "ppt/media/",
    source: "pptx",
  });
}

async function extractImagesFromPdf(_buffer: Buffer) {
  debugIntelligentImport("extractImagesFromPdf", { count: 0 });
  return [] as ExtractedImageAsset[];
}

async function extractTextFromImage(_buffer: Buffer) {
  debugIntelligentImport("extractTextFromImage", { textLength: 0 });
  return "";
}

async function extractImageFile(buffer: Buffer, fileName: string) {
  const mimeType = getImageMimeTypeFromExtension(fileName);

  const assets = [
    {
      fileName,
      source: "image_file" as const,
      mimeType,
      dataUrl: bufferToDataUrl(buffer, mimeType),
    },
  ];

  debugIntelligentImport("extractImageFile", {
    fileName,
    mimeType,
    count: assets.length,
  });

  return assets;
}

export async function extractTextFromFile(params: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<ExtractedFileContent> {
  const { fileName, mimeType, buffer } = params;
  const extension = getExtension(fileName);

  let text = "";
  let extractedImages: ExtractedImageAsset[] = [];

  debugIntelligentImport("extractTextFromFile:start", {
    fileName,
    mimeType,
    extension,
    bufferBytes: buffer.length,
  });

  if (extension === "pdf") {
    text = await extractTextFromPdf(buffer);
    extractedImages = await extractImagesFromPdf(buffer);
  } else if (extension === "docx") {
    text = await extractTextFromDocx(buffer);
    extractedImages = await extractImagesFromDocx(buffer);
  } else if (extension === "txt") {
    text = await extractTextFromTxt(buffer);
  } else if (extension === "xlsx" || extension === "xls") {
    text = await extractTextFromXlsx(buffer);
    extractedImages = await extractImagesFromXlsx(buffer);
  } else if (extension === "pptx") {
    text = await extractTextFromPptx(buffer);
    extractedImages = await extractImagesFromPptx(buffer);
  } else if (
    ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(extension) ||
    mimeType.startsWith("image/")
  ) {
    text = await extractTextFromImage(buffer);
    extractedImages = await extractImageFile(buffer, fileName);
  } else {
    throw new Error(`Tipo de arquivo não suportado: ${fileName}`);
  }

  debugIntelligentImport("extractTextFromFile:done", {
    fileName,
    extension,
    textLength: text.trim().length,
    extractedImages: extractedImages.length,
    imageNamesPreview: extractedImages.slice(0, 12).map((image) => image.fileName),
  });

  return {
    fileName,
    mimeType,
    extension,
    text: text.trim(),
    extractedImages,
  };
}

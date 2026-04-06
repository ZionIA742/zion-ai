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
  sheetName?: string;
  rowIndex?: number;
  columnIndex?: number;
  anchorCell?: string;
  drawingName?: string;
  imageRelationshipId?: string;
  imageOrder?: number;
};

export type ExtractedFileContent = {
  fileName: string;
  mimeType: string;
  extension: string;
  text: string;
  extractedImages?: ExtractedImageAsset[];
  diagnostics?: ExtractedFileDiagnostics;
};

export type XlsxImageExtractionDiagnostics = {
  workbookSheetNames: string[];
  workbookRelationshipsCount: number;
  worksheetXmlCount: number;
  worksheetRelationshipCount: number;
  drawingRelationshipCount: number;
  mediaFileCount: number;
  anchoredImageCount: number;
  mappedImageCount: number;
  missingSheetMappings: string[];
  sheetsWithDrawings: Array<{
    sheetName: string;
    drawingPath: string;
    anchors: number;
  }>;
  preview: Array<{
    fileName: string;
    sheetName?: string;
    rowIndex?: number;
    columnIndex?: number;
    anchorCell?: string;
    drawingName?: string;
    imageOrder?: number;
  }>;
};

export type ExtractedFileDiagnostics = {
  xlsxImageDiagnostics?: XlsxImageExtractionDiagnostics;
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
      [`=== ITEM ${index + 1} | PLANILHA: ${sheetName} ===`, ...pairs].join("\n")
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

function columnNumberToLetters(columnNumberZeroBased: number) {
  let n = columnNumberZeroBased + 1;
  let result = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function buildAnchorCell(columnIndexZeroBased: number, rowIndexZeroBased: number) {
  return `${columnNumberToLetters(columnIndexZeroBased)}${rowIndexZeroBased + 1}`;
}

function xmlDecode(value: string) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeZipPath(path: string) {
  const input = String(path || "").replace(/\\/g, "/").trim();
  if (!input) return "";

  const segments: string[] = [];
  for (const rawSegment of input.split("/")) {
    const segment = rawSegment.trim();
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0) segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.join("/");
}

function resolveZipTargetPath(baseFilePath: string, target: string) {
  const cleanTarget = String(target || "").trim();
  if (!cleanTarget) return "";

  if (cleanTarget.startsWith("/")) {
    return normalizeZipPath(cleanTarget.replace(/^\//, ""));
  }

  const baseDirectory = String(baseFilePath || "").includes("/")
    ? String(baseFilePath).slice(0, String(baseFilePath).lastIndexOf("/") + 1)
    : "";

  return normalizeZipPath(`${baseDirectory}${cleanTarget}`);
}

function parseXmlAttributes(tag: string) {
  const attributes: Record<string, string> = {};

  for (const match of tag.matchAll(/([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    const attributeName = match[1];
    const attributeValue = match[3] ?? match[4] ?? "";
    attributes[attributeName] = xmlDecode(attributeValue);
  }

  return attributes;
}

type XlsxDrawingAnchor = {
  relationshipId: string;
  drawingName?: string;
  rowIndex?: number;
  columnIndex?: number;
  anchorCell?: string;
  imageOrder: number;
};

async function extractImagesFromXlsx(
  buffer: Buffer
): Promise<{ assets: ExtractedImageAsset[]; diagnostics: XlsxImageExtractionDiagnostics }> {
  const zip = await JSZip.loadAsync(buffer);

  const workbookXmlPath = "xl/workbook.xml";
  const workbookXml = zip.files[workbookXmlPath]
    ? await zip.files[workbookXmlPath].async("text")
    : "";

  const workbookRelsPath = "xl/_rels/workbook.xml.rels";
  const workbookRelsXml = zip.files[workbookRelsPath]
    ? await zip.files[workbookRelsPath].async("text")
    : "";

  const workbookRelMap = new Map<string, string>();
  let workbookRelationshipsCount = 0;

  for (const match of workbookRelsXml.matchAll(/<Relationship\b[\s\S]*?\/>/gi)) {
    const attrs = parseXmlAttributes(match[0]);
    const relId = attrs.Id;
    const target = attrs.Target;

    if (!relId || !target) continue;
    workbookRelationshipsCount += 1;
    workbookRelMap.set(relId, resolveZipTargetPath(workbookXmlPath, target));
  }

  const workbookSheetNames: string[] = [];
  const sheetPathToName = new Map<string, string>();
  const missingSheetMappings = new Set<string>();

  for (const match of workbookXml.matchAll(/<sheet\b[\s\S]*?\/>/gi)) {
    const attrs = parseXmlAttributes(match[0]);
    const sheetName = attrs.name ? xmlDecode(attrs.name) : "";
    const relId = attrs["r:id"] || attrs.id || "";
    const targetPath = relId ? workbookRelMap.get(relId) : undefined;

    if (!sheetName) continue;
    workbookSheetNames.push(sheetName);

    if (!targetPath) {
      missingSheetMappings.add(sheetName);
      continue;
    }

    sheetPathToName.set(normalizeZipPath(targetPath), sheetName);
  }

  const worksheetXmlPaths = Object.keys(zip.files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(normalizeZipPath(path)))
    .map((path) => normalizeZipPath(path))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const mediaBuffers = new Map<string, { buffer: Buffer; fileName: string; mimeType: string }>();
  for (const [path, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    const normalizedPath = normalizeZipPath(path);
    if (!normalizedPath.startsWith("xl/media/")) continue;

    const fileName = normalizedPath.split("/").pop() || "image";
    const mimeType = getImageMimeTypeFromExtension(fileName);
    const fileBuffer = await zipEntry.async("nodebuffer");

    mediaBuffers.set(normalizedPath, {
      buffer: fileBuffer,
      fileName,
      mimeType,
    });
  }

  const drawingMediaMap = new Map<
    string,
    { fileName: string; mimeType: string; dataUrl: string }
  >();

  for (const [path, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    const normalizedPath = normalizeZipPath(path);
    if (!/^xl\/drawings\/_rels\/drawing\d+\.xml\.rels$/i.test(normalizedPath)) continue;

    const xml = await zipEntry.async("text");
    const drawingXmlPath = normalizedPath
      .replace(/^xl\/drawings\/_rels\//, "xl/drawings/")
      .replace(/\.rels$/i, "");

    for (const match of xml.matchAll(/<Relationship\b[\s\S]*?\/>/gi)) {
      const attrs = parseXmlAttributes(match[0]);
      const relId = attrs.Id;
      const target = attrs.Target;
      if (!relId || !target) continue;

      const mediaPath = resolveZipTargetPath(drawingXmlPath, target);
      const media = mediaBuffers.get(mediaPath);
      if (!media) continue;

      drawingMediaMap.set(`${drawingXmlPath}::${relId}`, {
        fileName: media.fileName,
        mimeType: media.mimeType,
        dataUrl: bufferToDataUrl(media.buffer, media.mimeType),
      });
    }
  }

  const sheetDrawingAnchors = new Map<string, XlsxDrawingAnchor[]>();
  let worksheetRelationshipCount = 0;
  let drawingRelationshipCount = 0;
  let anchoredImageCount = 0;

  const sheetsWithDrawings: Array<{
    sheetName: string;
    drawingPath: string;
    anchors: number;
  }> = [];

  for (const normalizedSheetPath of worksheetXmlPaths) {
    const sheetName = sheetPathToName.get(normalizedSheetPath);

    if (!sheetName) {
      missingSheetMappings.add(normalizedSheetPath);
      continue;
    }

    const relsPath = normalizeZipPath(
      normalizedSheetPath.replace(/^xl\/worksheets\//, "xl/worksheets/_rels/") + ".rels"
    );
    const relsXml = zip.files[relsPath] ? await zip.files[relsPath].async("text") : "";

    if (relsXml) {
      worksheetRelationshipCount += 1;
    }

    const drawingTargets: string[] = [];

    for (const match of relsXml.matchAll(/<Relationship\b[\s\S]*?\/>/gi)) {
      const attrs = parseXmlAttributes(match[0]);
      const relationshipType = attrs.Type || "";
      const target = attrs.Target || "";

      if (!relationshipType.includes("/drawing") || !target) continue;

      drawingRelationshipCount += 1;
      drawingTargets.push(resolveZipTargetPath(normalizedSheetPath, target));
    }

    if (drawingTargets.length === 0) continue;

    for (const drawingPath of drawingTargets) {
      const drawingXmlEntry = zip.files[drawingPath];
      if (!drawingXmlEntry) continue;

      const drawingXml = await drawingXmlEntry.async("text");
      const anchors: XlsxDrawingAnchor[] = [];

      const anchorRegex =
        /<(?:xdr:)?(?:twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/(?:xdr:)?(?:twoCellAnchor|oneCellAnchor)>/gi;

      let anchorIndex = 0;
      for (const anchorMatch of drawingXml.matchAll(anchorRegex)) {
        const anchorXml = anchorMatch[1] || "";
        const rowMatch = anchorXml.match(/<(?:xdr:)?row>(\d+)<\/(?:xdr:)?row>/i);
        const colMatch = anchorXml.match(/<(?:xdr:)?col>(\d+)<\/(?:xdr:)?col>/i);
        const blipMatch = anchorXml.match(/<(?:a:)?blip[^>]*(?:r:embed|embed)="([^"]+)"/i);
        const nameMatch =
          anchorXml.match(/<(?:xdr:)?cNvPr[^>]*name="([^"]+)"/i) ||
          anchorXml.match(/<xdr:cNvPr[^>]*name="([^"]+)"/i);

        if (!blipMatch) continue;

        const rowIndex =
          rowMatch && Number.isFinite(Number(rowMatch[1])) ? Number(rowMatch[1]) : undefined;
        const columnIndex =
          colMatch && Number.isFinite(Number(colMatch[1])) ? Number(colMatch[1]) : undefined;

        anchors.push({
          relationshipId: blipMatch[1],
          drawingName: nameMatch ? xmlDecode(nameMatch[1]) : undefined,
          rowIndex,
          columnIndex,
          anchorCell:
            typeof rowIndex === "number" && typeof columnIndex === "number"
              ? buildAnchorCell(columnIndex, rowIndex)
              : undefined,
          imageOrder: anchorIndex,
        });

        anchorIndex += 1;
      }

      anchors.sort((a, b) => {
        const rowA = a.rowIndex ?? Number.MAX_SAFE_INTEGER;
        const rowB = b.rowIndex ?? Number.MAX_SAFE_INTEGER;
        if (rowA !== rowB) return rowA - rowB;

        const colA = a.columnIndex ?? Number.MAX_SAFE_INTEGER;
        const colB = b.columnIndex ?? Number.MAX_SAFE_INTEGER;
        if (colA !== colB) return colA - colB;

        return a.imageOrder - b.imageOrder;
      });

      if (anchors.length > 0) {
        anchoredImageCount += anchors.length;
        sheetDrawingAnchors.set(`${sheetName}::${drawingPath}`, anchors);
        sheetsWithDrawings.push({
          sheetName,
          drawingPath,
          anchors: anchors.length,
        });
      }
    }
  }

  const assets: ExtractedImageAsset[] = [];

  for (const [sheetDrawingKey, anchors] of sheetDrawingAnchors.entries()) {
    const separatorIndex = sheetDrawingKey.indexOf("::");
    const sheetName =
      separatorIndex >= 0 ? sheetDrawingKey.slice(0, separatorIndex) : sheetDrawingKey;
    const drawingPath = separatorIndex >= 0 ? sheetDrawingKey.slice(separatorIndex + 2) : "";

    for (const anchor of anchors) {
      const mapped = drawingMediaMap.get(`${drawingPath}::${anchor.relationshipId}`);
      if (!mapped) continue;

      assets.push({
        fileName: mapped.fileName,
        source: "xlsx",
        mimeType: mapped.mimeType,
        dataUrl: mapped.dataUrl,
        sheetName,
        rowIndex: anchor.rowIndex,
        columnIndex: anchor.columnIndex,
        anchorCell: anchor.anchorCell,
        drawingName: anchor.drawingName,
        imageRelationshipId: anchor.relationshipId,
        imageOrder: anchor.imageOrder,
      });
    }
  }

  const diagnostics: XlsxImageExtractionDiagnostics = {
    workbookSheetNames,
    workbookRelationshipsCount,
    worksheetXmlCount: worksheetXmlPaths.length,
    worksheetRelationshipCount,
    drawingRelationshipCount,
    mediaFileCount: mediaBuffers.size,
    anchoredImageCount,
    mappedImageCount: assets.length,
    missingSheetMappings: Array.from(missingSheetMappings),
    sheetsWithDrawings,
    preview: assets.slice(0, 20).map((asset) => ({
      fileName: asset.fileName,
      sheetName: asset.sheetName,
      rowIndex: asset.rowIndex,
      columnIndex: asset.columnIndex,
      anchorCell: asset.anchorCell,
      drawingName: asset.drawingName,
      imageOrder: asset.imageOrder,
    })),
  };

  debugIntelligentImport("extractImagesFromXlsx", {
    workbookSheetsMapped: Array.from(sheetPathToName.entries()).map(([sheetPath, mappedSheetName]) => ({
      sheetName: mappedSheetName,
      sheetPath,
    })),
    mediaBuffers: mediaBuffers.size,
    drawingMediaLinks: drawingMediaMap.size,
    count: assets.length,
    diagnostics,
  });

  return {
    assets,
    diagnostics,
  };
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
  let diagnostics: ExtractedFileDiagnostics | undefined;

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
  } else if (extension === "xlsx") {
    text = await extractTextFromXlsx(buffer);
    const xlsxExtraction = await extractImagesFromXlsx(buffer);
    extractedImages = xlsxExtraction.assets;
    diagnostics = { xlsxImageDiagnostics: xlsxExtraction.diagnostics };
  } else if (extension === "xls") {
    text = await extractTextFromXlsx(buffer);
    extractedImages = [];
    diagnostics = {
      xlsxImageDiagnostics: {
        workbookSheetNames: [],
        workbookRelationshipsCount: 0,
        worksheetXmlCount: 0,
        worksheetRelationshipCount: 0,
        drawingRelationshipCount: 0,
        mediaFileCount: 0,
        anchoredImageCount: 0,
        mappedImageCount: 0,
        missingSheetMappings: [
          "Formato .xls detectado: extração de imagens embutidas desativada neste pipeline; use .xlsx para imagens.",
        ],
        sheetsWithDrawings: [],
        preview: [],
      },
    };
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
    imagePreview: extractedImages.slice(0, 12).map((image) => ({
      fileName: image.fileName,
      sheetName: image.sheetName,
      rowIndex: image.rowIndex,
      columnIndex: image.columnIndex,
      anchorCell: image.anchorCell,
    })),
    diagnostics,
  });

  return {
    fileName,
    mimeType,
    extension,
    text: text.trim(),
    extractedImages,
    diagnostics,
  };
}
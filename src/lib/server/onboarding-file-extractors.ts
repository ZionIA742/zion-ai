import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const nodeRequire = createRequire(`${process.cwd()}/package.json`);
const MAX_RENDERED_PDF_IMAGE_PAGES = 150;
const PDF_RENDER_SCALE = 0.75;
export const SUPPORTED_INTELLIGENT_IMPORT_EXTENSIONS = [
  "pdf",
  "docx",
  "txt",
  "xlsx",
  "xlsm",
  "xls",
  "pptx",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "svg",
] as const;

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
  sourceKind?: string;
  placement?: "inline_table" | "inline_anchor" | "inline_document" | "unknown";
  evidenceType?: "visual_evidence";
  associationState?: "evidence_confirmable" | "evidence_ambiguous" | "evidence_unmatched";
  sheetName?: string;
  rowIndex?: number;
  columnIndex?: number;
  anchorCell?: string;
  drawingName?: string;
  imageRelationshipId?: string;
  imageOrder?: number;
  worksheetRowNumber?: number;
  sheetScopedKey?: string;
  docxRelId?: string;
  docxMediaPath?: string;
  docxBodyIndex?: number;
  docxTableIndex?: number;
  docxTableCell?: string;
  documentOrderKey?: string;
  docxBlockKey?: string;
};

export type ExtractedFileContent = {
  fileName: string;
  mimeType: string;
  extension: string;
  text: string;
  positionalTextBlocks?: ExtractedPositionalTextBlock[];
  extractedImages?: ExtractedImageAsset[];
  diagnostics?: ExtractedFileDiagnostics;
};

export type ExtractedPositionalTextBlock = {
  pageNumber: number;
  blockIndex: number;
  text: string;
  source: "pdf_positional";
  layout: "column_region" | "table_row" | "line_group";
  confidence: "high" | "medium";
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

export function isSupportedIntelligentImportExtension(extension: string) {
  return SUPPORTED_INTELLIGENT_IMPORT_EXTENSIONS.includes(
    String(extension || "").trim().toLowerCase() as (typeof SUPPORTED_INTELLIGENT_IMPORT_EXTENSIONS)[number]
  );
}

export function buildUnsupportedIntelligentImportFileMessage(fileNames: string[]) {
  const cleanedNames = Array.from(
    new Set(
      fileNames
        .map((fileName) => String(fileName || "").trim())
        .filter(Boolean)
    )
  );
  const supportedFormatsLabel =
    "PDF, DOCX, TXT, XLS/XLSX/XLSM, PPTX, PNG, JPG, JPEG, WEBP, GIF, BMP ou SVG";

  if (cleanedNames.length === 0) {
    return `Arquivo nao suportado. Use ${supportedFormatsLabel}.`;
  }

  if (cleanedNames.length === 1) {
    return `Arquivo nao suportado: ${cleanedNames[0]}. Use ${supportedFormatsLabel}.`;
  }

  return `Arquivos nao suportados: ${cleanedNames.join(", ")}. Use ${supportedFormatsLabel}.`;
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

type PdfPositionalWord = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  endX: number;
};

type PdfPositionalLineCell = {
  text: string;
  x: number;
  endX: number;
  width: number;
  words: PdfPositionalWord[];
};

type PdfPositionalLine = {
  y: number;
  height: number;
  words: PdfPositionalWord[];
  cells: PdfPositionalLineCell[];
};

type PdfPagePositionalLayout = {
  pageNumber: number;
  width: number;
  height: number;
  lines: PdfPositionalLine[];
};

const importPdfJsModule = new Function("specifier", "return import(specifier);") as (
  specifier: string
) => Promise<any>;

function resolvePdfJsAssetPath(relativePath: string) {
  const candidates = [
    path.resolve(process.cwd(), "node_modules/pdf-parse/node_modules/pdfjs-dist", relativePath),
    path.resolve(process.cwd(), "node_modules/pdfjs-dist", relativePath),
  ];

  const matched = candidates.find((candidate) => existsSync(candidate));
  return matched ?? candidates[candidates.length - 1];
}

function median(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 === 0 ? (clean[middle - 1] + clean[middle]) / 2 : clean[middle];
}

function normalizePdfWordSpacing(text: string) {
  return cleanInlineText(String(text || "").replace(/\s+/g, " "));
}

function joinPdfWords(left: string, right: string, gap: number, charWidth: number) {
  const cleanLeft = String(left || "");
  const cleanRight = String(right || "");
  if (!cleanLeft) return cleanRight;
  if (!cleanRight) return cleanLeft;
  if (/[-/(\[]$/.test(cleanLeft) || /^[,.;:)\]]/.test(cleanRight)) {
    return `${cleanLeft}${cleanRight}`;
  }
  const spacingThreshold = Math.max(charWidth * 0.9, 2);
  return gap <= spacingThreshold ? `${cleanLeft}${cleanRight}` : `${cleanLeft} ${cleanRight}`;
}

function buildPdfPositionalLines(params: {
  items: Array<{ str?: string; width?: number; height?: number; transform?: number[] }>;
  pageNumber: number;
  pageWidth: number;
}) {
  const words = params.items
    .map((item) => {
      const text = normalizePdfWordSpacing(item.str || "");
      const x = Number(item.transform?.[4]);
      const y = Number(item.transform?.[5]);
      const width = Number(item.width || 0);
      const height = Math.abs(Number(item.height || 0)) || Math.abs(Number(item.transform?.[3] || 0));
      if (!text || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      const safeHeight = Number.isFinite(height) && height > 0 ? height : 8;
      const safeWidth = Number.isFinite(width) && width > 0 ? width : text.length * Math.max(safeHeight * 0.42, 3);
      return {
        text,
        x,
        y,
        width: safeWidth,
        height: safeHeight,
        endX: x + safeWidth,
      } satisfies PdfPositionalWord;
    })
    .filter(Boolean) as PdfPositionalWord[];

  if (words.length === 0) {
    return null;
  }

  const lineTolerance = Math.max(2.5, Math.min(12, median(words.map((word) => word.height)) * 0.65 || 4));
  const sorted = [...words].sort((left, right) => {
    if (Math.abs(right.y - left.y) > lineTolerance) return right.y - left.y;
    return left.x - right.x;
  });

  const lines: PdfPositionalLine[] = [];
  for (const word of sorted) {
    const targetLine = lines.find((line) => Math.abs(line.y - word.y) <= lineTolerance);
    if (!targetLine) {
      lines.push({
        y: word.y,
        height: word.height,
        words: [word],
        cells: [],
      });
      continue;
    }

    targetLine.words.push(word);
    targetLine.y = (targetLine.y * (targetLine.words.length - 1) + word.y) / targetLine.words.length;
    targetLine.height = Math.max(targetLine.height, word.height);
  }

  const charWidth = Math.max(
    2,
    median(
      words
        .map((word) => (word.text.length > 0 ? word.width / word.text.length : 0))
        .filter((value) => value > 0)
    ) || 4
  );

  const pageGapThreshold = Math.max(params.pageWidth * 0.08, charWidth * 10, 36);

  lines.forEach((line) => {
    const sortedWords = [...line.words].sort((left, right) => left.x - right.x);
    const gapTolerance = Math.max(line.height * 0.9, charWidth * 2.4, 4);
    const cells: PdfPositionalLineCell[] = [];

    for (const word of sortedWords) {
      const currentCell = cells[cells.length - 1];
      if (!currentCell) {
        cells.push({
          text: word.text,
          x: word.x,
          endX: word.endX,
          width: word.width,
          words: [word],
        });
        continue;
      }

      const gap = word.x - currentCell.endX;
      if (gap >= pageGapThreshold) {
        cells.push({
          text: word.text,
          x: word.x,
          endX: word.endX,
          width: word.width,
          words: [word],
        });
        continue;
      }

      currentCell.text = joinPdfWords(currentCell.text, word.text, gap, charWidth);
      currentCell.endX = Math.max(currentCell.endX, word.endX);
      currentCell.width = currentCell.endX - currentCell.x;
      currentCell.words.push(word);
    }

    line.cells = cells
      .map((cell) => ({
        ...cell,
        text: normalizePdfWordSpacing(cell.text),
      }))
      .filter((cell) => Boolean(cell.text));
  });

  return {
    pageNumber: params.pageNumber,
    width: params.pageWidth,
    height: median(lines.map((line) => line.height)) || 8,
    lines: lines
      .map((line) => ({
        ...line,
        cells: line.cells.filter((cell) => Boolean(cell.text)),
      }))
      .filter((line) => line.cells.length > 0)
      .sort((left, right) => right.y - left.y),
  } satisfies PdfPagePositionalLayout;
}

function normalizePdfHeaderLabel(value: string) {
  return String(value || "")
    .replace(/[|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPdfTableRowBlocks(page: PdfPagePositionalLayout) {
  const blocks: ExtractedPositionalTextBlock[] = [];
  const usedLineIndexes = new Set<number>();
  const anchorTolerance = Math.max(page.width * 0.018, page.height * 1.4, 10);

  const lines = page.lines;
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    if (header.cells.length < 3) continue;

    const rowIndexes: number[] = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const row = lines[next];
      if (row.cells.length < Math.max(2, header.cells.length - 2)) break;
      const comparableColumns = Math.min(header.cells.length, row.cells.length, 4);
      const alignedColumns = Array.from({ length: comparableColumns }).filter((_, columnIndex) => {
        const headerCell = header.cells[columnIndex];
        const rowCell = row.cells[columnIndex];
        if (!headerCell || !rowCell) return false;
        return Math.abs(headerCell.x - rowCell.x) <= anchorTolerance;
      }).length;
      if (alignedColumns < Math.max(2, comparableColumns - 1)) break;
      rowIndexes.push(next);
    }

    if (rowIndexes.length < 2) continue;

    const headerLabels = header.cells.map((cell) => normalizePdfHeaderLabel(cell.text));
    for (const rowIndex of rowIndexes) {
      const row = lines[rowIndex];
      const rowParts = row.cells
        .map((cell) => {
          const headerIndex = header.cells.reduce((bestIndex, headerCell, candidateIndex) => {
            const bestCell = header.cells[bestIndex];
            const bestDistance = bestCell ? Math.abs(bestCell.x - cell.x) : Number.POSITIVE_INFINITY;
            const candidateDistance = Math.abs(headerCell.x - cell.x);
            return candidateDistance < bestDistance ? candidateIndex : bestIndex;
          }, 0);
          const label = headerLabels[headerIndex];
          const value = normalizePdfWordSpacing(cell.text);
          if (!value) return "";
          if (!label || label.length > 60 || isPrimaryPdfDescriptionLabel(label)) return value;
          return `${label}: ${value}`;
        })
        .filter(Boolean);
      const text = cleanInlineText(rowParts.join("\n"));
      if (!text) continue;
      blocks.push({
        pageNumber: page.pageNumber,
        blockIndex: blocks.length,
        text,
        source: "pdf_positional",
        layout: "table_row",
        confidence: "high",
      });
      usedLineIndexes.add(rowIndex);
    }

    usedLineIndexes.add(index);
    index = rowIndexes[rowIndexes.length - 1];
  }

  return {
    blocks,
    usedLineIndexes,
  };
}

function clusterNumericValues(values: number[], tolerance: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const clusters: Array<{ mean: number; values: number[] }> = [];
  for (const value of sorted) {
    const targetCluster = clusters.find((cluster) => Math.abs(cluster.mean - value) <= tolerance);
    if (!targetCluster) {
      clusters.push({ mean: value, values: [value] });
      continue;
    }
    targetCluster.values.push(value);
    targetCluster.mean =
      targetCluster.values.reduce((sum, current) => sum + current, 0) / targetCluster.values.length;
  }
  return clusters;
}

function dedupeConsecutivePdfLines(lines: string[]) {
  const deduped: string[] = [];
  for (const rawLine of lines) {
    const normalized = normalizePdfWordSpacing(rawLine);
    if (!normalized) continue;
    if (deduped[deduped.length - 1] === normalized) continue;
    deduped.push(normalized);
  }
  return deduped;
}

function normalizePdfSignalText(text: string) {
  return normalizePdfWordSpacing(text)
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toLowerCase();
}

function isLikelyPdfDetailLine(text: string) {
  return /^(?:preco|sku|ref\.?|estoque|categoria|medidas?|largura|comprimento|profundidade|valor|nota|sem preco|apenas informa)/i.test(
    normalizePdfSignalText(text)
  );
}

function isLikelyPdfTitleLine(text: string) {
  const normalized = normalizePdfWordSpacing(text);
  const signal = normalizePdfSignalText(text);
  if (!normalized || normalized.length < 6 || normalized.length > 120) return false;
  if (isLikelyPdfDetailLine(normalized)) return false;
  if (/^(?:coluna|catalogo|nota|pagina|itens\b)/.test(signal)) return false;
  if (!/[a-z]/.test(signal)) return false;
  if (signal.split(/\s+/).length < 2) return false;
  return true;
}

function isPrimaryPdfDescriptionLabel(label: string) {
  return /(?:produto|descricao)/i.test(normalizePdfSignalText(label));
}

function hasPdfProductSignals(text: string) {
  return /\b(?:sku|ref\.?|preco|r\$\s*\d|estoque|categoria|medidas?|largura|comprimento|profundidade)\b/i.test(
    normalizePdfSignalText(text)
  );
}

function buildPdfColumnRegionBlocks(page: PdfPagePositionalLayout, skipLineIndexes: Set<number>) {
  const eligible = page.lines
    .map((line, lineIndex) => ({ line, lineIndex }))
    .filter(({ line, lineIndex }) => !skipLineIndexes.has(lineIndex) && line.cells.length >= 2);

  if (eligible.length < 2) {
    return {
      blocks: [] as ExtractedPositionalTextBlock[],
      usedLineIndexes: new Set<number>(),
    };
  }

  const significantGapThreshold = Math.max(page.width * 0.08, page.height * 5, 40);
  const splitCenters = eligible.flatMap(({ line }) => {
    const centers: number[] = [];
    for (let index = 0; index < line.cells.length - 1; index += 1) {
      const left = line.cells[index];
      const right = line.cells[index + 1];
      const gap = right.x - left.endX;
      if (gap >= significantGapThreshold) {
        centers.push(left.endX + gap / 2);
      }
    }
    return centers;
  });

  const clusters = clusterNumericValues(splitCenters, Math.max(page.width * 0.03, page.height * 1.8, 18)).filter(
    (cluster) => cluster.values.length >= 2
  );
  if (clusters.length === 0) {
    return {
      blocks: [] as ExtractedPositionalTextBlock[],
      usedLineIndexes: new Set<number>(),
    };
  }

  const splitBoundaries = clusters.map((cluster) => cluster.mean).sort((left, right) => left - right);
  const linesByRegion = new Map<number, Array<{ lineIndex: number; y: number; text: string }>>();
  const usedLineIndexes = new Set<number>();
  page.lines.forEach((line, lineIndex) => {
    if (skipLineIndexes.has(lineIndex)) return;
    const cellsByRegion = new Map<number, string[]>();
    for (const cell of line.cells) {
      const regionIndex = splitBoundaries.filter((boundary) => cell.x >= boundary).length;
      const current = cellsByRegion.get(regionIndex) ?? [];
      current.push(cell.text);
      cellsByRegion.set(regionIndex, current);
    }

    for (const [regionIndex, regionCells] of cellsByRegion.entries()) {
      const text = normalizePdfWordSpacing(regionCells.join(" "));
      if (!text) continue;
      const current = linesByRegion.get(regionIndex) ?? [];
      current.push({
        lineIndex,
        y: line.y,
        text,
      });
      linesByRegion.set(regionIndex, current);
      usedLineIndexes.add(lineIndex);
    }
  });

  return {
    blocks: Array.from(linesByRegion.entries()).flatMap(([regionIndex, lines]) => {
      const orderedLines = dedupeConsecutivePdfLines(
        lines.sort((left, right) => left.lineIndex - right.lineIndex).map((line) => line.text)
      );
      if (orderedLines.length === 0) return [];

      const sourceLines = lines.sort((left, right) => left.lineIndex - right.lineIndex);
      const gaps = sourceLines
        .slice(1)
        .map((line, index) => Math.abs(sourceLines[index].y - line.y))
        .filter((gap) => gap > 0);
      const medianGap = median(gaps);
      const blockGapThreshold = Math.max(page.height * 1.7, medianGap * 1.9, 16);

      const groupedLines: string[][] = [];
      for (let index = 0; index < orderedLines.length; index += 1) {
        const lineText = orderedLines[index];
        const currentGroup = groupedLines[groupedLines.length - 1];
        const currentSource = sourceLines[index];
        const previousSource = index > 0 ? sourceLines[index - 1] : null;
        const verticalGap = currentSource && previousSource ? Math.abs(previousSource.y - currentSource.y) : 0;
        const currentGroupHasSignals = Boolean(currentGroup?.some((entry) => hasPdfProductSignals(entry)));
        const startsNewGroup =
          !currentGroup ||
          verticalGap >= blockGapThreshold ||
          (currentGroupHasSignals && !isLikelyPdfDetailLine(lineText) && isLikelyPdfTitleLine(lineText));

        if (startsNewGroup) {
          groupedLines.push([lineText]);
          continue;
        }

        currentGroup.push(lineText);
      }

      const refinedGroups: string[][] = [];
      for (const group of groupedLines) {
        let currentGroup: string[] = [];
        for (const lineText of group) {
          const signal = normalizePdfSignalText(lineText);
          const shouldSplitCurrentGroup =
            currentGroup.length > 0 &&
            ((/\b(?:sku|cod)\b/.test(signal) && !isLikelyPdfDetailLine(lineText)) ||
              (currentGroup.some((entry) => hasPdfProductSignals(entry)) &&
                !isLikelyPdfDetailLine(lineText) &&
                isLikelyPdfTitleLine(lineText)));

          if (shouldSplitCurrentGroup) {
            refinedGroups.push(currentGroup);
            currentGroup = [lineText];
            continue;
          }

          currentGroup.push(lineText);
        }

        if (currentGroup.length > 0) {
          refinedGroups.push(currentGroup);
        }
      }

      const mergedGroups: string[][] = [];
      for (const group of refinedGroups) {
        const previousGroup = mergedGroups[mergedGroups.length - 1];
        const previousLastLine = previousGroup?.[previousGroup.length - 1] ?? "";
        if (previousGroup && isLikelyPdfDetailLine(group[0]) && isLikelyPdfTitleLine(previousLastLine)) {
          previousGroup.push(...group);
          continue;
        }
        mergedGroups.push(group);
      }

      return mergedGroups
        .map((groupLines, groupIndex) => {
          const trimmedLines =
            groupLines.length > 1 && /^(?:coluna|catalogo)\b/i.test(normalizePdfSignalText(groupLines[0]))
              ? groupLines.slice(1)
              : groupLines;
          return {
            pageNumber: page.pageNumber,
            blockIndex: regionIndex * 100 + groupIndex,
            text: cleanInlineText(trimmedLines.join("\n")),
            source: "pdf_positional" as const,
            layout: "column_region" as const,
            confidence: "medium" as const,
          };
        })
        .filter((block) => Boolean(block.text));
    })
    .filter((block) => Boolean(block.text)),
    usedLineIndexes,
  };
}

function buildPdfLineGroupBlocks(page: PdfPagePositionalLayout, skipLineIndexes: Set<number>) {
  return page.lines
    .map((line, lineIndex) => ({ line, lineIndex }))
    .filter(({ lineIndex }) => !skipLineIndexes.has(lineIndex))
    .map(({ line }, index) => ({
      pageNumber: page.pageNumber,
      blockIndex: index,
      text: cleanInlineText(line.cells.map((cell) => cell.text).join(" ")),
      source: "pdf_positional" as const,
      layout: "line_group" as const,
      confidence: "medium" as const,
    }))
    .filter((block) => Boolean(block.text));
}

async function extractPositionalTextBlocksFromPdf(buffer: Buffer) {
  try {
    const pdfjs = await importPdfJsModule(
      pathToFileURL(resolvePdfJsAssetPath("legacy/build/pdf.mjs")).href
    );
    const standardFontDirectoryUrl = pathToFileURL(
      resolvePdfJsAssetPath("standard_fonts")
    ).href;
    const standardFontDataUrl = standardFontDirectoryUrl.endsWith("/")
      ? standardFontDirectoryUrl
      : `${standardFontDirectoryUrl}/`;
    const document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorker: false,
      standardFontDataUrl,
    }).promise;

    const blocks: ExtractedPositionalTextBlock[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const pageLayout = buildPdfPositionalLines({
        items: Array.isArray(textContent.items) ? (textContent.items as any[]) : [],
        pageNumber,
        pageWidth: viewport.width,
      });
      if (!pageLayout) continue;

      const tableBlocks = buildPdfTableRowBlocks(pageLayout);
      const usedLineIndexes = new Set<number>(tableBlocks.usedLineIndexes);
      const columnRegionResult = buildPdfColumnRegionBlocks(pageLayout, usedLineIndexes);
      columnRegionResult.usedLineIndexes.forEach((lineIndex) => usedLineIndexes.add(lineIndex));
      const lineGroupBlocks = buildPdfLineGroupBlocks(pageLayout, usedLineIndexes);

      blocks.push(...tableBlocks.blocks, ...columnRegionResult.blocks, ...lineGroupBlocks);
    }

    const orderedBlocks = blocks
      .map((block, index) => ({
        ...block,
        blockIndex: index,
      }))
      .filter((block) => Boolean(block.text));

    debugIntelligentImport("extractPositionalTextBlocksFromPdf", {
      count: orderedBlocks.length,
      preview: orderedBlocks.slice(0, 20).map((block) => ({
        pageNumber: block.pageNumber,
        layout: block.layout,
        confidence: block.confidence,
        text: block.text.slice(0, 140),
      })),
    });

    return orderedBlocks;
  } catch (error) {
    debugIntelligentImport("extractPositionalTextBlocksFromPdf:error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [] as ExtractedPositionalTextBlock[];
  }
}

type DocxStructuralEntry =
  | {
      kind: "paragraph";
      text: string;
      bodyIndex: number;
    }
  | {
      kind: "table";
      rows: string[][];
      bodyIndex: number;
      tableIndex: number;
      blockKey: string | null;
      documentOrderKey: string | null;
    };

type DocxTableFieldPair = {
  label: string;
  value: string;
  canonicalKey: string;
};

type DocxProductTableCandidate = {
  pairs: DocxTableFieldPair[];
  recognizedFieldCount: number;
  primaryFieldCount: number;
  score: number;
};

type DocxInlineImageReference = {
  relId: string;
  placement: ExtractedImageAsset["placement"];
  bodyIndex: number;
  tableIndex: number | null;
  tableCell: string | null;
  imageIndexWithinCell: number;
  documentOrderKey: string;
};

type DocxStructuredExtractionResult = {
  entries: DocxStructuralEntry[];
  images: ExtractedImageAsset[];
};

const DOCX_COMMERCIAL_FIELD_ALIASES: Record<string, string[]> = {
  sku: ["sku", "codigo", "código", "cod", "cod/ref", "referencia", "referência", "ref"],
  nome: ["nome", "nome do produto", "nome comercial", "produto", "item", "titulo", "título"],
  preco: [
    "preco",
    "preço",
    "preco venda",
    "preço venda",
    "preco venda r",
    "preço venda r",
    "preco venda r$",
    "preço venda r$",
    "valor",
    "valor final",
  ],
  categoria: ["categoria", "cat", "familia", "família", "tipo"],
  estoque: ["estoque", "quantidade", "quantidade atual", "qtd", "qtd?"],
  dosagem: ["dosagem"],
  aplicacao: ["aplicacao", "aplicação", "uso", "uso / observacao", "uso / observação"],
  descricao: ["descricao", "descrição", "descricao detalhada", "descrição detalhada"],
  observacoes: ["observacoes", "observações", "observacoes tecnicas", "observações técnicas", "obs"],
  embalagem: ["embalagem", "packaging"],
  volume: ["peso/volume", "peso / volume", "peso", "volume", "capacidade"],
  linha: ["linha", "marca", "marca / linha", "marca e linha"],
  composicao: ["composicao", "composição"],
  indicacao: ["indicacao", "indicação"],
};

const DOCX_CANONICAL_LABEL_BY_KEY: Record<string, string> = {
  sku: "SKU",
  nome: "Nome do produto",
  preco: "Preço venda (R$)",
  categoria: "Categoria",
  estoque: "Estoque",
  dosagem: "Dosagem",
  aplicacao: "Aplicação",
  descricao: "Descrição detalhada",
  observacoes: "Observações técnicas",
  embalagem: "Embalagem",
  volume: "Peso/Volume",
  linha: "Linha",
  composicao: "Composição",
  indicacao: "Indicação",
};

const DOCX_LABEL_KEY_TO_CANONICAL_KEY = Object.entries(DOCX_COMMERCIAL_FIELD_ALIASES).reduce<
  Record<string, string>
>((acc, [canonicalKey, aliases]) => {
  aliases.forEach((alias) => {
    acc[normalizeLooseKey(alias)] = canonicalKey;
  });
  return acc;
}, {});

function collectDocxXmlText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) {
    return node.map((entry) => collectDocxXmlText(entry)).join("");
  }
  if (!node || typeof node !== "object") return "";

  let output = "";
  for (const [key, value] of Object.entries(node)) {
    if (key === "#text") {
      output += String(value || "");
      continue;
    }
    if (key === "w:t") {
      output += collectDocxXmlText(value);
      continue;
    }
    if (key === "w:tab") {
      output += "\t";
      continue;
    }
    if (key === "w:br" || key === "w:cr") {
      output += "\n";
      continue;
    }
    if (key === ":@") continue;
    output += collectDocxXmlText(value);
  }

  return output;
}

function extractDocxParagraphText(paragraphNode: unknown) {
  return cleanInlineText(collectDocxXmlText(paragraphNode));
}

function extractDocxTableRows(tableNode: unknown) {
  if (!Array.isArray(tableNode)) return [] as string[][];

  const rows: string[][] = [];

  for (const entry of tableNode) {
    if (!entry || typeof entry !== "object" || !("w:tr" in entry)) continue;
    const tableRow = (entry as Record<string, unknown>)["w:tr"];
    if (!Array.isArray(tableRow)) continue;

    const rowCells: string[] = [];
    for (const rowEntry of tableRow) {
      if (!rowEntry || typeof rowEntry !== "object" || !("w:tc" in rowEntry)) continue;
      const tableCell = (rowEntry as Record<string, unknown>)["w:tc"];
      const cellText = extractDocxParagraphText(tableCell);
      rowCells.push(cellText);
    }

    if (rowCells.some((cell) => cell.trim() !== "")) {
      rows.push(rowCells.map((cell) => cleanInlineText(cell)));
    }
  }

  return rows;
}

function buildDocxBlockKey(tableIndex: number, bodyIndex: number, tableCell?: string | null) {
  const baseKey = `docx::table::${tableIndex + 1}::body::${bodyIndex + 1}`;
  return tableCell ? `${baseKey}::cell::${tableCell}` : baseKey;
}

function buildDocxDocumentOrderKey(args: {
  bodyIndex: number;
  tableIndex?: number | null;
  tableCell?: string | null;
  imageIndexWithinCell?: number | null;
}) {
  const parts = [`body-${args.bodyIndex + 1}`];
  if (typeof args.tableIndex === "number" && args.tableIndex >= 0) {
    parts.push(`table-${args.tableIndex + 1}`);
  }
  if (args.tableCell) {
    parts.push(`cell-${args.tableCell}`);
  }
  if (typeof args.imageIndexWithinCell === "number" && args.imageIndexWithinCell >= 0) {
    parts.push(`image-${args.imageIndexWithinCell + 1}`);
  }
  return parts.join("::");
}

async function extractDocxImageRelationshipTargets(zip: JSZip) {
  const relationshipsXml = await zip.file("word/_rels/document.xml.rels")?.async("text");
  if (!relationshipsXml) return new Map<string, string>();

  const targets = new Map<string, string>();
  for (const match of relationshipsXml.matchAll(
    /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*>/gi
  )) {
    const relId = String(match[1] || "").trim();
    const target = String(match[2] || "").trim();
    if (!relId || !target) continue;
    const resolvedPath = resolveZipTargetPath("word/document.xml", target);
    if (resolvedPath.startsWith("word/media/")) {
      targets.set(relId, resolvedPath);
    }
  }
  return targets;
}

function extractDocxAttributeValue(node: unknown, attributeName: string): string {
  if (Array.isArray(node)) {
    for (const entry of node) {
      const value = extractDocxAttributeValue(entry, attributeName);
      if (value) return value;
    }
    return "";
  }
  if (!node || typeof node !== "object") return "";
  const record = node as Record<string, unknown>;
  const directValue = String(record[attributeName] || "").trim();
  if (directValue) return directValue;
  const attrs = record[":@"];
  if (attrs && typeof attrs === "object") {
    const attrValue = String((attrs as Record<string, unknown>)[attributeName] || "").trim();
    if (attrValue) return attrValue;
  }
  return "";
}

function collectDocxInlineImageReferences(
  node: unknown,
  context: {
    bodyIndex: number;
    tableIndex: number | null;
    tableCell: string | null;
    placement: ExtractedImageAsset["placement"];
  },
  acc: DocxInlineImageReference[],
  seen: Set<string>,
  state = { imageIndexWithinCell: 0 }
) {
  if (Array.isArray(node)) {
    node.forEach((entry) => collectDocxInlineImageReferences(entry, context, acc, seen, state));
    return;
  }

  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    const nextPlacement =
      key === "wp:inline"
        ? ("inline_table" as const)
        : key === "wp:anchor"
          ? ("inline_anchor" as const)
          : context.placement;

    if (key === "a:blip") {
      const relId =
        extractDocxAttributeValue(value, "@_r:embed") ||
        extractDocxAttributeValue(value, "@_r:link") ||
        extractDocxAttributeValue(record, "@_r:embed") ||
        extractDocxAttributeValue(record, "@_r:link");
      if (relId) {
        const imageIndexWithinCell = state.imageIndexWithinCell;
        state.imageIndexWithinCell += 1;
        const documentOrderKey = buildDocxDocumentOrderKey({
          bodyIndex: context.bodyIndex,
          tableIndex: context.tableIndex,
          tableCell: context.tableCell,
          imageIndexWithinCell,
        });
        const dedupeKey = [
          relId,
          context.bodyIndex,
          context.tableIndex ?? "",
          context.tableCell ?? "",
          documentOrderKey,
        ].join("::");
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          acc.push({
            relId,
            placement: nextPlacement || context.placement || "unknown",
            bodyIndex: context.bodyIndex,
            tableIndex: context.tableIndex,
            tableCell: context.tableCell,
            imageIndexWithinCell,
            documentOrderKey,
          });
        }
      }
    }

    collectDocxInlineImageReferences(
      value,
      {
        ...context,
        placement: nextPlacement || context.placement,
      },
      acc,
      seen,
      state
    );
  }
}

async function extractStructuralEntriesFromDocx(buffer: Buffer): Promise<DocxStructuredExtractionResult> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("text");

  if (!documentXml) {
    return {
      entries: [],
      images: [],
    };
  }

  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    processEntities: true,
    trimValues: false,
  });
  const parsed = parser.parse(documentXml) as Array<Record<string, unknown>>;
  const documentNode = parsed.find((entry) => "w:document" in entry)?.["w:document"];
  const bodyNode =
    Array.isArray(documentNode) &&
    documentNode.find(
      (entry) => entry && typeof entry === "object" && "w:body" in (entry as Record<string, unknown>)
    );
  const bodyEntries =
    bodyNode && typeof bodyNode === "object" && "w:body" in bodyNode
      ? ((bodyNode as Record<string, unknown>)["w:body"] as Array<Record<string, unknown>>)
      : [];
  const relationshipTargets = await extractDocxImageRelationshipTargets(zip);

  const entries: DocxStructuralEntry[] = [];
  const imageReferences: DocxInlineImageReference[] = [];
  const seenImageReferences = new Set<string>();
  let tableIndex = 0;

  for (const [bodyIndex, bodyEntry] of (bodyEntries || []).entries()) {
    if ("w:p" in bodyEntry) {
      collectDocxInlineImageReferences(
        bodyEntry["w:p"],
        {
          bodyIndex,
          tableIndex: null,
          tableCell: null,
          placement: "inline_document",
        },
        imageReferences,
        seenImageReferences
      );
      entries.push({
        kind: "paragraph",
        text: extractDocxParagraphText(bodyEntry["w:p"]),
        bodyIndex,
      });
      continue;
    }

    if ("w:tbl" in bodyEntry) {
      const currentTableIndex = tableIndex;
      tableIndex += 1;
      const tableNode = bodyEntry["w:tbl"];
      if (Array.isArray(tableNode)) {
        let rowNumber = 0;
        for (const rowEntry of tableNode) {
          if (!rowEntry || typeof rowEntry !== "object" || !("w:tr" in rowEntry)) continue;
          const tableRow = (rowEntry as Record<string, unknown>)["w:tr"];
          if (!Array.isArray(tableRow)) continue;
          rowNumber += 1;
          let cellNumber = 0;
          for (const cellEntry of tableRow) {
            if (!cellEntry || typeof cellEntry !== "object" || !("w:tc" in cellEntry)) continue;
            cellNumber += 1;
            const tableCell = (cellEntry as Record<string, unknown>)["w:tc"];
            collectDocxInlineImageReferences(
              tableCell,
              {
                bodyIndex,
                tableIndex: currentTableIndex,
                tableCell: `r${rowNumber}c${cellNumber}`,
                placement: "inline_table",
              },
              imageReferences,
              seenImageReferences
            );
          }
        }
      }
      entries.push({
        kind: "table",
        rows: extractDocxTableRows(bodyEntry["w:tbl"]),
        bodyIndex,
        tableIndex: currentTableIndex,
        blockKey: null,
        documentOrderKey: buildDocxDocumentOrderKey({
          bodyIndex,
          tableIndex: currentTableIndex,
        }),
      });
    }
  }

  const images: ExtractedImageAsset[] = [];
  for (const [imageIndex, imageReference] of imageReferences.entries()) {
    const mediaPath = relationshipTargets.get(imageReference.relId) || "";
    const fileName = mediaPath.split("/").pop() || `docx-image-${imageIndex + 1}`;
    const zipEntry = mediaPath ? zip.file(mediaPath) : null;
    if (!zipEntry) continue;
    const mediaBuffer = await zipEntry.async("nodebuffer");
    const mimeType = getImageMimeTypeFromExtension(fileName);
    const isInlineTable =
      imageReference.tableIndex != null && imageReference.placement === "inline_table";
    images.push({
      fileName,
      source: "docx",
      sourceKind: "docx_inline_table_image",
      mimeType,
      dataUrl: bufferToDataUrl(mediaBuffer, mimeType),
      placement: imageReference.placement || "unknown",
      evidenceType: "visual_evidence",
      associationState: isInlineTable ? "evidence_confirmable" : "evidence_unmatched",
      imageOrder: imageIndex,
      docxRelId: imageReference.relId,
      docxMediaPath: mediaPath || undefined,
      docxBodyIndex: imageReference.bodyIndex + 1,
      docxTableIndex:
        typeof imageReference.tableIndex === "number" && imageReference.tableIndex >= 0
          ? imageReference.tableIndex + 1
          : undefined,
      docxTableCell: imageReference.tableCell || undefined,
      documentOrderKey: imageReference.documentOrderKey,
      docxBlockKey:
        typeof imageReference.tableIndex === "number" && imageReference.tableIndex >= 0
          ? buildDocxBlockKey(
              imageReference.tableIndex,
              imageReference.bodyIndex,
              imageReference.tableCell
            )
          : undefined,
    });
  }

  return {
    entries,
    images,
  };
}

function canonicalizeDocxFieldLabel(value: string) {
  return DOCX_LABEL_KEY_TO_CANONICAL_KEY[normalizeLooseKey(value)] || "";
}

function buildDocxProductTableCandidate(rows: string[][]): DocxProductTableCandidate {
  const pairs: DocxTableFieldPair[] = [];
  const recognizedKeys = new Set<string>();
  const primaryKeys = new Set<string>();

  rows.forEach((row) => {
    const cells = row.map((cell) => cleanInlineText(cell)).filter(Boolean);
    if (cells.length < 2) return;

    const label = cleanInlineText(cells[0] || "");
    const value = cleanInlineText(cells.slice(1).join(" | "));
    if (!label || !value) return;

    const canonicalKey = canonicalizeDocxFieldLabel(label);
    if (canonicalKey) {
      recognizedKeys.add(canonicalKey);
      if (["sku", "nome", "preco", "categoria"].includes(canonicalKey)) {
        primaryKeys.add(canonicalKey);
      }
    }

    pairs.push({
      label,
      value,
      canonicalKey,
    });
  });

  return {
    pairs,
    recognizedFieldCount: recognizedKeys.size,
    primaryFieldCount: primaryKeys.size,
    score: recognizedKeys.size * 2 + primaryKeys.size,
  };
}

function isDocxProductTableCandidate(candidate: DocxProductTableCandidate) {
  return (
    candidate.pairs.length >= 4 &&
    candidate.recognizedFieldCount >= 4 &&
    candidate.primaryFieldCount >= 2 &&
    candidate.score >= 10
  );
}

function appendDocxField(fieldLines: string[], seenKeys: Set<string>, label: string, value: string) {
  const cleanedLabel = cleanInlineText(label);
  const cleanedValue = cleanInlineText(value);
  if (!cleanedLabel || !cleanedValue) return;

  const dedupeKey = `${normalizeLooseKey(cleanedLabel)}::${normalizeLooseKey(cleanedValue)}`;
  if (seenKeys.has(dedupeKey)) return;
  seenKeys.add(dedupeKey);
  fieldLines.push(`${cleanedLabel}: ${cleanedValue}`);
}

function classifyDocxNarrativeParagraph(text: string) {
  const cleaned = cleanInlineText(text);
  if (!cleaned) {
    return {
      label: "",
      value: "",
    };
  }

  const labeledMatch = cleaned.match(/^([^:]{2,60}):\s*(.+)$/u);
  if (labeledMatch) {
    const rawLabel = cleanInlineText(labeledMatch[1] || "");
    const value = cleanInlineText(labeledMatch[2] || "");
    const canonicalKey = canonicalizeDocxFieldLabel(rawLabel);

    if (canonicalKey) {
      return {
        label: DOCX_CANONICAL_LABEL_BY_KEY[canonicalKey] || rawLabel,
        value,
      };
    }

    return {
      label: rawLabel,
      value,
    };
  }

  return {
    label: "Descrição detalhada",
    value: cleaned,
  };
}

function buildDocxNarrativeCellFieldLines(text: string) {
  const cleaned = cleanInlineText(text);
  if (!cleaned) return [] as string[];

  const labeledText = cleaned.replace(
    /(?<!^)(?=(?:Tipo|Formato|Medidas|Profundidade|Capacidade|Prazo estimado|Faixa de pre[cç]o|Acabamento|Observa(?:c|ç)(?:o|õ)es)\s*:)/giu,
    "\n"
  );
  const lines = labeledText
    .split(/\n+/)
    .map((line) => cleanInlineText(line))
    .filter(Boolean);
  if (lines.length < 2) return [];

  const title = lines[0] || "";
  const labeledLines = lines.slice(1).filter((line) => /^[^:]{2,40}:\s*.+$/u.test(line));
  if (!title || labeledLines.length < 3) return [];

  return [title, ...labeledLines];
}

function buildStructuredDocxText(entries: DocxStructuralEntry[]) {
  const productBlocks: string[] = [];
  let nonProductTables = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.kind !== "table") continue;

    const tableCandidate = buildDocxProductTableCandidate(entry.rows);
    if (!isDocxProductTableCandidate(tableCandidate)) {
      const cellBlocks: string[] = [];
      entry.rows.forEach((row, rowIndex) => {
        row.forEach((cell, cellIndex) => {
          const fieldLines = buildDocxNarrativeCellFieldLines(cell);
          if (fieldLines.length === 0) return;
          const cellKey = `r${rowIndex + 1}c${cellIndex + 1}`;
          const blockKey = buildDocxBlockKey(entry.tableIndex, entry.bodyIndex, cellKey);
          const documentOrderKey = buildDocxDocumentOrderKey({
            bodyIndex: entry.bodyIndex,
            tableIndex: entry.tableIndex,
            tableCell: cellKey,
          });
          cellBlocks.push([
            `=== ITEM ${productBlocks.length + cellBlocks.length + 1} | DOCX ===`,
            `DOCX Block Key: ${blockKey}`,
            `Document Order Key: ${documentOrderKey}`,
            `DOCX Body Index: ${entry.bodyIndex + 1}`,
            `DOCX Table Index: ${entry.tableIndex + 1}`,
            ...fieldLines,
          ].join("\n"));
        });
      });
      if (cellBlocks.length > 0) {
        productBlocks.push(...cellBlocks);
        continue;
      }
      nonProductTables += 1;
      continue;
    }

    const previousEntry = entries[index - 1];
    const contextualTitle =
      previousEntry && previousEntry.kind === "paragraph" ? cleanInlineText(previousEntry.text) : "";

    const fieldLines: string[] = [];
    const seenKeys = new Set<string>();
    const blockKey = buildDocxBlockKey(entry.tableIndex, entry.bodyIndex);
    const documentOrderKey =
      entry.documentOrderKey ||
      buildDocxDocumentOrderKey({
        bodyIndex: entry.bodyIndex,
        tableIndex: entry.tableIndex,
      });

    appendDocxField(fieldLines, seenKeys, "DOCX Block Key", blockKey);
    appendDocxField(fieldLines, seenKeys, "Document Order Key", documentOrderKey);
    appendDocxField(fieldLines, seenKeys, "DOCX Body Index", String(entry.bodyIndex + 1));
    appendDocxField(fieldLines, seenKeys, "DOCX Table Index", String(entry.tableIndex + 1));

    if (contextualTitle) {
      appendDocxField(fieldLines, seenKeys, "Título", contextualTitle);
    }

    tableCandidate.pairs.forEach((pair) => {
      const label = pair.canonicalKey
        ? DOCX_CANONICAL_LABEL_BY_KEY[pair.canonicalKey] || pair.label
        : pair.label;
      appendDocxField(fieldLines, seenKeys, label, pair.value);
    });

    let trailingIndex = index + 1;
    while (trailingIndex < entries.length) {
      const nextEntry = entries[trailingIndex];
      if (nextEntry.kind === "table") {
        const nextCandidate = buildDocxProductTableCandidate(nextEntry.rows);
        if (isDocxProductTableCandidate(nextCandidate)) break;
        trailingIndex += 1;
        continue;
      }

      const paragraphText = cleanInlineText(nextEntry.text);
      if (!paragraphText) break;

      const classified = classifyDocxNarrativeParagraph(paragraphText);
      appendDocxField(fieldLines, seenKeys, classified.label, classified.value);
      trailingIndex += 1;
    }

    if (fieldLines.length === 0) continue;

    productBlocks.push(
      [`=== ITEM ${productBlocks.length + 1} | DOCX ===`, ...fieldLines].join("\n")
    );
  }

  const structuredText = cleanInlineText(productBlocks.join("\n\n"));
  const looksReliable =
    productBlocks.length > 0 &&
    productBlocks.length >= Math.max(1, nonProductTables === 0 ? 1 : Math.floor(nonProductTables / 3));

  return {
    text: structuredText,
    blockCount: productBlocks.length,
    nonProductTables,
    looksReliable,
  };
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
  const structuralExtraction = await extractStructuralEntriesFromDocx(buffer);
  const structuredDocx = buildStructuredDocxText(structuralExtraction.entries);

  if (structuredDocx.looksReliable) {
    debugIntelligentImport("extractTextFromDocx:structured", {
      blockCount: structuredDocx.blockCount,
      nonProductTables: structuredDocx.nonProductTables,
      entryCount: structuralExtraction.entries.length,
      preview: structuredDocx.text.slice(0, 500),
    });
    return structuredDocx.text;
  }

  const result = await mammoth.extractRawText({ buffer });
  const text = cleanInlineText(result.value || "");
  debugIntelligentImport("extractTextFromDocx", {
    usedFallback: true,
    structuralBlocks: structuredDocx.blockCount,
    structuralNonProductTables: structuredDocx.nonProductTables,
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

function normalizeLooseKey(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

type XlsxWorksheetLogicalRowEntry = {
  row: unknown[];
  physicalWorksheetRowNumber: number;
  logicalWorksheetRowNumber: number;
};

type XlsxWorksheetLogicalCoordinates = {
  itemBlocks: string[];
  physicalToLogicalRowMap: Map<number, number>;
  usefulRowsCount: number;
  headerIndex: number;
  dataRowsCount: number;
  headerPreview: string[];
  looksLikeStructuredProductSheet: boolean;
};

const XLSX_PRODUCT_HEADER_GROUPS = [
  ["sku", "codigo", "codigo de barras", "referencia", "ref"],
  ["nome", "nome do item", "nome do produto", "produto", "item"],
  ["categoria", "subcategoria", "tipo", "grupo", "linha"],
  ["descricao curta", "descricao detalhada", "descricao", "aplicacao principal"],
  ["preco custo", "preco venda", "preco", "valor"],
  ["estoque inicial", "estoque minimo", "estoque"],
];

function countStructuredProductHeaderSignals(headers: string[]) {
  const normalizedHeaders = headers.map((header) => normalizeLooseKey(header));
  let matchedGroups = 0;

  for (const aliases of XLSX_PRODUCT_HEADER_GROUPS) {
    const matched = aliases.some((alias) =>
      normalizedHeaders.some(
        (header) => header === normalizeLooseKey(alias) || header.includes(normalizeLooseKey(alias))
      )
    );
    if (matched) matchedGroups += 1;
  }

  return matchedGroups;
}

function looksLikeStructuredProductSheet(args: {
  sheetName: string;
  headers: string[];
  dataRowsCount: number;
}) {
  const matchedHeaderGroups = countStructuredProductHeaderSignals(args.headers);
  const normalizedSheetName = normalizeLooseKey(args.sheetName);
  const sheetNameLooksLikeGuide =
    normalizedSheetName.includes("legenda") ||
    normalizedSheetName.includes("guia") ||
    normalizedSheetName.includes("instrucao") ||
    normalizedSheetName.includes("instrucoes") ||
    normalizedSheetName.includes("observacao");

  if (matchedHeaderGroups >= 4) return true;
  if (matchedHeaderGroups >= 3 && args.dataRowsCount >= 5 && !sheetNameLooksLikeGuide) return true;
  return false;
}

function getWorksheetDisplayValue(cell: XLSX.CellObject | undefined) {
  if (!cell) return "";
  if (typeof cell.w === "string") return cell.w;
  if (cell.v == null) return "";
  if (typeof cell.v === "string") return cell.v;
  return XLSX.utils.format_cell(cell);
}

function readWorksheetRowsPreservingPhysicalLayout(sheet: XLSX.WorkSheet) {
  const ref = String(sheet["!ref"] || "").trim();
  if (!ref) return [] as unknown[][];

  const range = XLSX.utils.decode_range(ref);
  const rows: unknown[][] = [];

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row: unknown[] = [];

    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      row.push(getWorksheetDisplayValue(sheet[cellAddress]));
    }

    rows.push(row);
  }

  return rows;
}

function buildSheetLogicalCoordinates(
  sheetName: string,
  rows: unknown[][]
): XlsxWorksheetLogicalCoordinates {
  const usefulRows = rows
    .map((row, physicalIndex) => ({
      row,
      physicalWorksheetRowNumber: physicalIndex + 1,
    }))
    .filter((entry) => isUsefulRow(entry.row))
    .map((entry, usefulIndex) => ({
      ...entry,
      logicalWorksheetRowNumber: usefulIndex + 1,
    }));

  if (usefulRows.length === 0) {
    return {
      itemBlocks: [],
      physicalToLogicalRowMap: new Map<number, number>(),
      usefulRowsCount: 0,
      headerIndex: 0,
      dataRowsCount: 0,
      headerPreview: [],
      looksLikeStructuredProductSheet: false,
    };
  }

  const headerIndex = chooseHeaderRow(usefulRows.map((entry) => entry.row));
  const headerRow = usefulRows[headerIndex]?.row || [];
  const headers = headerRow.map((cell, index) => normalizeHeaderLabel(cell, index));
  const dataRows = usefulRows.slice(headerIndex + 1);
  const isStructuredProductSheet = looksLikeStructuredProductSheet({
    sheetName,
    headers,
    dataRowsCount: dataRows.length,
  });

  if (!isStructuredProductSheet) {
    debugIntelligentImport("buildItemBlocksFromSheet:skipped_non_product_sheet", {
      sheetName,
      usefulRows: usefulRows.length,
      headerIndex,
      headerPreview: headers.slice(0, 20),
      dataRows: dataRows.length,
    });
    return {
      itemBlocks: [],
      physicalToLogicalRowMap: new Map<number, number>(),
      usefulRowsCount: usefulRows.length,
      headerIndex,
      dataRowsCount: dataRows.length,
      headerPreview: headers.slice(0, 20),
      looksLikeStructuredProductSheet: false,
    };
  }

  const blocks: string[] = [];
  const physicalToLogicalRowMap = new Map<number, number>();

  dataRows.forEach(({ row, logicalWorksheetRowNumber, physicalWorksheetRowNumber }, index) => {
    const pairs: string[] = [];
    const sheetScopedKey = `${normalizeLooseKey(sheetName)}::row::${logicalWorksheetRowNumber}`;

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
    physicalToLogicalRowMap.set(physicalWorksheetRowNumber, logicalWorksheetRowNumber);

    blocks.push(
      [
        `=== ITEM ${index + 1} | PLANILHA: ${sheetName} | LINHA: ${logicalWorksheetRowNumber} ===`,
        `Planilha: ${sheetName}`,
        `Linha da planilha: ${logicalWorksheetRowNumber}`,
        `Sheet scoped key: ${sheetScopedKey}`,
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
    rowMapPreview: Array.from(physicalToLogicalRowMap.entries())
      .slice(0, 5)
      .map(([physicalWorksheetRowNumber, logicalWorksheetRowNumber]) => ({
        physicalWorksheetRowNumber,
        logicalWorksheetRowNumber,
      })),
  });

  return {
    itemBlocks: blocks,
    physicalToLogicalRowMap,
    usefulRowsCount: usefulRows.length,
    headerIndex,
    dataRowsCount: dataRows.length,
    headerPreview: headers.slice(0, 20),
    looksLikeStructuredProductSheet: true,
  };
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

    const rows = readWorksheetRowsPreservingPhysicalLayout(sheet);
    const { itemBlocks, looksLikeStructuredProductSheet } = buildSheetLogicalCoordinates(sheetName, rows);
    if (!looksLikeStructuredProductSheet) {
      continue;
    }

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
  let itemIndex = 0;

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

    const slideText = texts.filter(Boolean).join("\n").trim();
    if (slideText) {
      const looksLikeItemSlide =
        /\b(?:PSC|QMC|ACC|OUT|OTR)[-\s]?\d{3,4}\b/i.test(slideText) ||
        /^\s*(?:piscina|qu[ií]mico|acess[oó]rio)\b[\s\S]*\b\d{3,4}\b/im.test(slideText);

      if (looksLikeItemSlide) {
        itemIndex += 1;
        parts.push(`=== ITEM ${itemIndex} | SLIDE: ${slideNumber} ===`);
      } else {
        parts.push(`SLIDE: ${slideNumber}`);
      }

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
    const pdfParseModule = nodeRequire("pdf-parse");
    let result: any = null;
    const PDFParse = (pdfParseModule as any).PDFParse;

    if (typeof PDFParse === "function") {
      const parser = new PDFParse({ data: buffer });
      try {
        result = await parser.getText();
      } finally {
        await parser.destroy?.();
      }
    } else {
      const pdfParseFn: any = (pdfParseModule as any).default ?? (pdfParseModule as any);
      if (typeof pdfParseFn === "function") {
        result = await pdfParseFn(buffer);
      }
    }

    const text = cleanInlineText(
      typeof result === "string" ? result : result?.text || ""
    );
    const positionalTextBlocks = await extractPositionalTextBlocksFromPdf(buffer);
    debugIntelligentImport("extractTextFromPdf", {
      textLength: text.length,
      preview: text.slice(0, 300),
      positionalBlocks: positionalTextBlocks.length,
    });
    return {
      text,
      positionalTextBlocks,
    };
  } catch (error) {
    debugIntelligentImport("extractTextFromPdf:error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      text: "",
      positionalTextBlocks: [] as ExtractedPositionalTextBlock[],
    };
  }
}

async function extractImagesFromDocx(buffer: Buffer) {
  const structuralExtraction = await extractStructuralEntriesFromDocx(buffer);
  debugIntelligentImport("extractImagesFromDocx:structured", {
    count: structuralExtraction.images.length,
    preview: structuralExtraction.images.slice(0, 12).map((image) => ({
      fileName: image.fileName,
      docxRelId: image.docxRelId,
      docxBodyIndex: image.docxBodyIndex,
      docxTableIndex: image.docxTableIndex,
      docxTableCell: image.docxTableCell,
      documentOrderKey: image.documentOrderKey,
      docxBlockKey: image.docxBlockKey,
      associationState: image.associationState,
    })),
  });
  return structuralExtraction.images;
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

const XML_OPTIONAL_PREFIX_PATTERN = String.raw`(?:[A-Za-z_][A-Za-z0-9_.-]*:)?`;

function buildOptionalPrefixedXmlTagPattern(tagNames: string | string[], flags: string) {
  const names = Array.isArray(tagNames) ? tagNames : [tagNames];
  const tagPattern = names.join("|");

  return new RegExp(
    `<${XML_OPTIONAL_PREFIX_PATTERN}(?:${tagPattern})\\b[^>]*>([\\s\\S]*?)<\\/${XML_OPTIONAL_PREFIX_PATTERN}(?:${tagPattern})>`,
    flags
  );
}

function matchOptionalPrefixedXmlTag(xml: string, tagName: string) {
  return xml.match(
    new RegExp(
      `<${XML_OPTIONAL_PREFIX_PATTERN}${tagName}>([\\s\\S]*?)<\\/${XML_OPTIONAL_PREFIX_PATTERN}${tagName}>`,
      "i"
    )
  );
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
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    raw: false,
    dense: false,
  });
  const zip = await JSZip.loadAsync(buffer);
  const sheetLogicalCoordinatesByName = new Map<
    string,
    ReturnType<typeof buildSheetLogicalCoordinates>
  >();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = readWorksheetRowsPreservingPhysicalLayout(sheet);
    sheetLogicalCoordinatesByName.set(sheetName, buildSheetLogicalCoordinates(sheetName, rows));
  }

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

  for (const match of workbookXml.matchAll(/<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?sheet\b[\s\S]*?\/>/gi)) {
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

      const anchorRegex = buildOptionalPrefixedXmlTagPattern(
        ["twoCellAnchor", "oneCellAnchor"],
        "gi"
      );

      let anchorIndex = 0;
      for (const anchorMatch of drawingXml.matchAll(anchorRegex)) {
        const anchorXml = anchorMatch[1] || "";
        const rowMatch = matchOptionalPrefixedXmlTag(anchorXml, "row");
        const colMatch = matchOptionalPrefixedXmlTag(anchorXml, "col");
        const blipMatch = anchorXml.match(/<(?:a:)?blip[^>]*(?:r:embed|embed)="([^"]+)"/i);
        const nameMatch = anchorXml.match(
          new RegExp(`<${XML_OPTIONAL_PREFIX_PATTERN}cNvPr[^>]*name="([^"]+)"`, "i")
        );

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
    const logicalCoordinates = sheetLogicalCoordinatesByName.get(sheetName);
    const physicalToLogicalRowMap = logicalCoordinates?.physicalToLogicalRowMap;

    for (const anchor of anchors) {
      const mapped = drawingMediaMap.get(`${drawingPath}::${anchor.relationshipId}`);
      if (!mapped) continue;

      const physicalWorksheetRowNumber =
        typeof anchor.rowIndex === "number" ? anchor.rowIndex + 1 : undefined;
      const worksheetRowNumber =
        typeof physicalWorksheetRowNumber === "number"
          ? physicalToLogicalRowMap?.get(physicalWorksheetRowNumber)
          : undefined;
      const sheetScopedKey =
        sheetName && typeof worksheetRowNumber === "number"
          ? `${normalizeLooseKey(sheetName)}::row::${worksheetRowNumber}`
          : undefined;

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
        worksheetRowNumber,
        sheetScopedKey,
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
    sheetLogicalCoordinates: Array.from(sheetLogicalCoordinatesByName.entries()).map(
      ([sheetName, logicalCoordinates]) => ({
        sheetName,
        usefulRows: logicalCoordinates.usefulRowsCount,
        headerIndex: logicalCoordinates.headerIndex,
        dataRows: logicalCoordinates.dataRowsCount,
        mappedRows: logicalCoordinates.physicalToLogicalRowMap.size,
        rowMapPreview: Array.from(logicalCoordinates.physicalToLogicalRowMap.entries())
          .slice(0, 5)
          .map(([physicalWorksheetRowNumber, logicalWorksheetRowNumber]) => ({
            physicalWorksheetRowNumber,
            logicalWorksheetRowNumber,
          })),
      })
    ),
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

function buildPdfRenderedPageFileName(fileName: string, pageNumber: number) {
  const baseName = String(fileName || "pdf")
    .replace(/\.[^.]+$/i, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "pdf";

  return `${baseName}-page-${String(pageNumber).padStart(3, "0")}.png`;
}

async function extractImagesFromPdf(buffer: Buffer, fileName: string) {
  try {
    const pdfParseModule = nodeRequire("pdf-parse");
    const PDFParse = (pdfParseModule as any).PDFParse;
    if (typeof PDFParse !== "function") {
      return [] as ExtractedImageAsset[];
    }

    const parser = new PDFParse({ data: buffer });
    const assets: ExtractedImageAsset[] = [];

    try {
      const screenshot = await parser.getScreenshot({
        first: MAX_RENDERED_PDF_IMAGE_PAGES,
        scale: PDF_RENDER_SCALE,
        imageDataUrl: true,
        imageBuffer: true,
      });

      for (const page of screenshot.pages ?? []) {
        const pageNumber = Number(page.pageNumber || assets.length + 1);
        const pageDataUrl =
          typeof page.dataUrl === "string" && page.dataUrl
            ? page.dataUrl
            : page.data
              ? bufferToDataUrl(Buffer.from(page.data), "image/png")
              : "";

        if (!pageDataUrl) continue;

        assets.push({
          fileName: buildPdfRenderedPageFileName(fileName, pageNumber),
          source: "pdf",
          mimeType: "image/png",
          dataUrl: pageDataUrl,
          sheetName: "PDF",
          imageOrder: pageNumber - 1,
          worksheetRowNumber: pageNumber,
          sheetScopedKey: `pdf::page::${pageNumber}`,
        });
      }

      debugIntelligentImport("extractImagesFromPdf", {
        pages: Number(screenshot.total || 0),
        renderedPages: assets.length,
        maxPages: MAX_RENDERED_PDF_IMAGE_PAGES,
        scale: PDF_RENDER_SCALE,
        firstImageBytes: assets[0]?.dataUrl?.length ?? 0,
        lastImageBytes: assets[assets.length - 1]?.dataUrl?.length ?? 0,
      });
    } finally {
      await parser.destroy?.();
    }

    return assets;
  } catch (error) {
    debugIntelligentImport("extractImagesFromPdf:error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [] as ExtractedImageAsset[];
  }
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
  let positionalTextBlocks: ExtractedPositionalTextBlock[] | undefined;
  let extractedImages: ExtractedImageAsset[] = [];
  let diagnostics: ExtractedFileDiagnostics | undefined;

  debugIntelligentImport("extractTextFromFile:start", {
    fileName,
    mimeType,
    extension,
    bufferBytes: buffer.length,
  });

  if (extension === "pdf") {
    const pdfExtraction = await extractTextFromPdf(buffer);
    text = pdfExtraction.text;
    positionalTextBlocks = pdfExtraction.positionalTextBlocks;
    extractedImages = await extractImagesFromPdf(buffer, fileName);
  } else if (extension === "docx") {
    text = await extractTextFromDocx(buffer);
    extractedImages = await extractImagesFromDocx(buffer);
  } else if (extension === "txt") {
    text = await extractTextFromTxt(buffer);
  } else if (extension === "xlsx" || extension === "xlsm") {
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
    ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(extension)
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
    positionalBlocks: positionalTextBlocks?.length ?? 0,
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
    positionalTextBlocks,
    extractedImages,
    diagnostics,
  };
}

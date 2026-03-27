import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import sharp from "sharp";
import { XMLParser } from "fast-xml-parser";
import { createHash } from "crypto";
import {
  createCanvas,
  DOMMatrix as NapiDOMMatrix,
  ImageData as NapiImageData,
  Path2D as NapiPath2D,
} from "@napi-rs/canvas";

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

function normalizeInlineText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isPoolCardStart(line: string) {
  return /^piscina\b/i.test(line.trim());
}

function isPoolFieldLine(line: string) {
  return /^(tipo|formato|medidas|profundidade|capacidade|prazo estimado|faixa de preço|faixa de preco|acabamento|observações|observacoes)\b\s*[:|]/iu.test(
    line.trim()
  );
}

function pushCurrentSection(sections: string[], currentLines: string[]) {
  const normalized = currentLines
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized) {
    sections.push(normalized);
  }

  currentLines.length = 0;
}

function getDataUrlPayload(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) return dataUrl;
  return dataUrl.slice(commaIndex + 1);
}

function hashDataUrl(dataUrl: string) {
  return createHash("sha1").update(getDataUrlPayload(dataUrl)).digest("hex");
}

function dedupeExtractedImages(images: ExtractedImageAsset[]) {
  const seen = new Set<string>();
  const deduped: ExtractedImageAsset[] = [];

  for (const image of images) {
    if (!image?.dataUrl) continue;

    const key = `${image.mimeType}:${hashDataUrl(image.dataUrl)}`;
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(image);
  }

  return deduped;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function logPdfDebug(step: string, details?: Record<string, unknown>) {
  if (details) {
    console.log(`[onboarding-pdf] ${step}`, details);
    return;
  }

  console.log(`[onboarding-pdf] ${step}`);
}

function logPdfError(
  step: string,
  error: unknown,
  details?: Record<string, unknown>
) {
  console.error(`[onboarding-pdf] ${step}`, {
    ...(details || {}),
    error: getErrorMessage(error),
  });
}

function ensurePdfNodeCanvasGlobals() {
  if (!(globalThis as any).DOMMatrix) {
    (globalThis as any).DOMMatrix = NapiDOMMatrix;
  }

  if (!(globalThis as any).ImageData) {
    (globalThis as any).ImageData = NapiImageData;
  }

  if (!(globalThis as any).Path2D) {
    (globalThis as any).Path2D = NapiPath2D;
  }
}

async function extractImagesFromZip(params: {
  buffer: Buffer;
  mediaPrefix: string;
  source: "docx" | "xlsx" | "pptx";
}): Promise<ExtractedImageAsset[]> {
  const { buffer, mediaPrefix, source } = params;

  const zip = await JSZip.loadAsync(buffer);

  const mediaFiles = Object.keys(zip.files)
    .filter((name) => name.startsWith(mediaPrefix))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const images: ExtractedImageAsset[] = [];

  for (const mediaPath of mediaFiles) {
    const file = zip.files[mediaPath];
    if (!file || file.dir) continue;

    const fileName = mediaPath.split("/").pop() || mediaPath;
    const mimeType = getImageMimeTypeFromExtension(fileName);

    if (!mimeType.startsWith("image/")) continue;

    const content = await file.async("nodebuffer");

    images.push({
      fileName,
      source,
      mimeType,
      dataUrl: bufferToDataUrl(content, mimeType),
    });
  }

  return images;
}

async function extractTextFromPdfWithPdfParse(buffer: Buffer) {
  try {
    ensurePdfNodeCanvasGlobals();

    const imported: any = await import("pdf-parse");
    const pdfParse =
      typeof imported?.default === "function"
        ? imported.default
        : typeof imported === "function"
          ? imported
          : null;

    if (!pdfParse) return "";

    const result = await pdfParse(buffer);
    return normalizeExtractedText(result?.text || "");
  } catch (error) {
    logPdfError("extractTextFromPdfWithPdfParse failed", error);
    return "";
  }
}

async function extractTextFromPdfWithPdfJs(buffer: Buffer) {
  try {
    ensurePdfNodeCanvasGlobals();

    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
      standardFontDataUrl: undefined,
    });

    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();

      const items = Array.isArray(textContent?.items)
        ? (textContent.items as Array<any>)
        : [];

      const pageText = items
        .map((item) => String(item?.str || "").trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (pageText) {
        pages.push(pageText);
      }
    }

    return normalizeExtractedText(pages.join("\n\n"));
  } catch (error) {
    logPdfError("extractTextFromPdfWithPdfJs failed", error);
    return "";
  }
}

async function extractTextFromPdfWithPdf2Json(buffer: Buffer) {
  try {
    const imported: any = await import("pdf2json");
    const PDFParserClass = imported?.default || imported;
    const parser = new PDFParserClass(undefined, true);

    const text = await new Promise<string>((resolve) => {
      parser.on("pdfParser_dataError", (parserError: unknown) => {
        logPdfError("extractTextFromPdfWithPdf2Json parser error", parserError);
        resolve("");
      });

      parser.on("pdfParser_dataReady", (pdfData: any) => {
        try {
          const pages = Array.isArray(pdfData?.Pages) ? pdfData.Pages : [];
          const chunks: string[] = [];

          for (const page of pages) {
            const texts = Array.isArray(page?.Texts) ? page.Texts : [];

            for (const textItem of texts) {
              const runs = Array.isArray(textItem?.R) ? textItem.R : [];
              const line = runs
                .map((run: any) => decodeURIComponent(String(run?.T || "")))
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();

              if (line) {
                chunks.push(line);
              }
            }

            chunks.push("");
          }

          resolve(normalizeExtractedText(chunks.join("\n")));
        } catch (error) {
          logPdfError(
            "extractTextFromPdfWithPdf2Json read ready data failed",
            error
          );
          resolve("");
        }
      });

      parser.parseBuffer(buffer);
    });

    return text;
  } catch (error) {
    logPdfError("extractTextFromPdfWithPdf2Json failed", error);
    return "";
  }
}

function extractReadableStringsFromPdfBinary(buffer: Buffer) {
  try {
    const raw = buffer.toString("latin1");
    const matches = raw.match(/[\x20-\x7EÀ-ÿ]{8,}/g) || [];

    const cleaned = matches
      .map((item) => item.replace(/\s+/g, " ").trim())
      .filter((item) => {
        const lower = item.toLowerCase();
        return (
          item.length >= 8 &&
          !lower.includes("obj") &&
          !lower.includes("endobj") &&
          !lower.includes("/type") &&
          !lower.includes("/page") &&
          !lower.includes("/font") &&
          !lower.includes("stream") &&
          !lower.includes("endstream")
        );
      })
      .join("\n");

    return normalizeExtractedText(cleaned);
  } catch (error) {
    logPdfError("extractReadableStringsFromPdfBinary failed", error);
    return "";
  }
}

async function extractTextFromPdf(buffer: Buffer) {
  const attempts = [
    await extractTextFromPdfWithPdfParse(buffer),
    await extractTextFromPdfWithPdfJs(buffer),
    await extractTextFromPdfWithPdf2Json(buffer),
    extractReadableStringsFromPdfBinary(buffer),
  ];

  const ranked = attempts
    .map((text) => normalizeExtractedText(text))
    .sort((a, b) => b.length - a.length);

  const best = ranked[0] || "";

  logPdfDebug("extractTextFromPdf summary", {
    candidates: ranked.map((text, index) => ({
      index,
      length: text.length,
    })),
    selectedLength: best.length,
  });

  return best;
}

function inferRawChannels(dataLength: number, width: number, height: number) {
  const pixels = width * height;

  if (pixels <= 0) return 0;
  if (dataLength === pixels * 4) return 4;
  if (dataLength === pixels * 3) return 3;
  if (dataLength === pixels) return 1;

  return 0;
}

async function rawPdfImageToDataUrl(imageData: any) {
  try {
    const width = Number(imageData?.width || imageData?.w || 0);
    const height = Number(imageData?.height || imageData?.h || 0);

    if (!width || !height) return null;

    const data = imageData?.data;
    if (!data) return null;

    const rawBuffer = Buffer.isBuffer(data)
      ? data
      : data instanceof Uint8Array || data instanceof Uint8ClampedArray
        ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : Array.isArray(data)
          ? Buffer.from(data)
          : null;

    if (!rawBuffer) return null;

    const channels = inferRawChannels(rawBuffer.length, width, height);
    if (!channels) return null;

    const png = await sharp(rawBuffer, {
      raw: {
        width,
        height,
        channels,
      },
    })
      .png()
      .toBuffer();

    return bufferToDataUrl(png, "image/png");
  } catch (error) {
    logPdfError("rawPdfImageToDataUrl failed", error);
    return null;
  }
}

async function resolvePdfJsObject(store: any, key: string) {
  if (!store || !key) return null;

  try {
    const syncValue = store.get(key);
    if (syncValue) return syncValue;
  } catch {}

  return await new Promise<any>((resolve) => {
    let resolved = false;

    try {
      store.get(key, (value: any) => {
        if (resolved) return;
        resolved = true;
        resolve(value || null);
      });
    } catch {
      resolve(null);
      return;
    }

    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      resolve(null);
    }, 300);
  });
}

async function extractEmbeddedImagesFromPdf(
  buffer: Buffer
): Promise<ExtractedImageAsset[]> {
  try {
    ensurePdfNodeCanvasGlobals();

    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const OPS = pdfjs.OPS || {};
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
      standardFontDataUrl: undefined,
    });

    const pdf = await loadingTask.promise;
    const images: ExtractedImageAsset[] = [];
    const seen = new Set<string>();
    let imageIndex = 0;

    logPdfDebug("extractEmbeddedImagesFromPdf started", {
      numPages: pdf.numPages,
    });

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const operatorList = await page.getOperatorList();

      const fnArray: number[] = Array.isArray(operatorList?.fnArray)
        ? operatorList.fnArray
        : [];
      const argsArray: any[] = Array.isArray(operatorList?.argsArray)
        ? operatorList.argsArray
        : [];

      let pageHits = 0;

      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];
        const args = argsArray[i];

        if (fn === OPS.paintInlineImageXObject && args?.data) {
          const dataUrl = await rawPdfImageToDataUrl(args);

          if (dataUrl) {
            imageIndex += 1;
            pageHits += 1;
            images.push({
              fileName: `pdf-inline-page-${pageNumber}-image-${imageIndex}.png`,
              source: "pdf",
              mimeType: "image/png",
              dataUrl,
            });
          }

          continue;
        }

        if (
          fn === OPS.paintImageXObject ||
          fn === OPS.paintJpegXObject ||
          fn === OPS.paintImageXObjectRepeat
        ) {
          const objectKey = Array.isArray(args)
            ? String(args[0] || "")
            : String(args || "");

          if (!objectKey) continue;

          const seenKey = `${pageNumber}:${objectKey}`;
          if (seen.has(seenKey)) continue;
          seen.add(seenKey);

          const pdfImage =
            (await resolvePdfJsObject(page.objs, objectKey)) ||
            (await resolvePdfJsObject(page.commonObjs, objectKey));

          const dataUrl = await rawPdfImageToDataUrl(pdfImage);

          if (dataUrl) {
            imageIndex += 1;
            pageHits += 1;
            images.push({
              fileName: `pdf-page-${pageNumber}-embedded-${imageIndex}.png`,
              source: "pdf",
              mimeType: "image/png",
              dataUrl,
            });
          }
        }
      }

      logPdfDebug("extractEmbeddedImagesFromPdf page processed", {
        pageNumber,
        pageHits,
      });
    }

    logPdfDebug("extractEmbeddedImagesFromPdf finished", {
      totalEmbeddedImages: images.length,
    });

    return images;
  } catch (error) {
    logPdfError("extractEmbeddedImagesFromPdf failed", error);
    return [];
  }
}

type RuntimeCanvasModule = {
  createCanvas: typeof createCanvas;
};

function getRuntimeCanvasModule(): RuntimeCanvasModule | null {
  try {
    ensurePdfNodeCanvasGlobals();

    logPdfDebug("getRuntimeCanvasModule success", {
      available: true,
    });

    return {
      createCanvas,
    };
  } catch (error) {
    logPdfError("getRuntimeCanvasModule failed", error, {
      available: false,
    });
    return null;
  }
}

async function renderPdfPagesAsImages(
  buffer: Buffer
): Promise<ExtractedImageAsset[]> {
  try {
    ensurePdfNodeCanvasGlobals();

    const canvasModule = getRuntimeCanvasModule();

    if (!canvasModule) {
      logPdfDebug("renderPdfPagesAsImages aborted", {
        reason: "canvas_module_unavailable",
      });
      return [];
    }

    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
      standardFontDataUrl: undefined,
    });

    const pdf = await loadingTask.promise;
    const images: ExtractedImageAsset[] = [];

    logPdfDebug("renderPdfPagesAsImages started", {
      numPages: pdf.numPages,
    });

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);

      const baseViewport = page.getViewport({ scale: 1 });
      const maxWidth = 1400;
      const scale = Math.min(2, Math.max(1.15, maxWidth / baseViewport.width));
      const viewport = page.getViewport({ scale });

      logPdfDebug("renderPdfPagesAsImages page start", {
        pageNumber,
        width: Math.ceil(viewport.width),
        height: Math.ceil(viewport.height),
        scale,
      });

      const canvas = canvasModule.createCanvas(
        Math.max(1, Math.ceil(viewport.width)),
        Math.max(1, Math.ceil(viewport.height))
      );

      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      const imageBuffer = canvas.toBuffer("image/jpeg", 88);

      images.push({
        fileName: `pdf-render-page-${pageNumber}.jpg`,
        source: "pdf",
        mimeType: "image/jpeg",
        dataUrl: bufferToDataUrl(imageBuffer, "image/jpeg"),
      });

      logPdfDebug("renderPdfPagesAsImages page success", {
        pageNumber,
        imageBytes: imageBuffer.length,
      });
    }

    logPdfDebug("renderPdfPagesAsImages finished", {
      totalRenderedPages: images.length,
    });

    return images;
  } catch (error) {
    logPdfError("renderPdfPagesAsImages failed", error);
    return [];
  }
}

async function extractImagesFromPdf(
  buffer: Buffer
): Promise<ExtractedImageAsset[]> {
  try {
    logPdfDebug("extractImagesFromPdf started", {
      pdfBytes: buffer.length,
    });

    const renderedPages = await renderPdfPagesAsImages(buffer);
    const embeddedImages = await extractEmbeddedImagesFromPdf(buffer);

    const combined = dedupeExtractedImages([
      ...renderedPages,
      ...embeddedImages,
    ]);

    logPdfDebug("extractImagesFromPdf summary", {
      renderedPages: renderedPages.length,
      embeddedImages: embeddedImages.length,
      combinedImages: combined.length,
    });

    return combined;
  } catch (error) {
    logPdfError("extractImagesFromPdf failed", error);
    return [];
  }
}

async function extractTextFromDocx(buffer: Buffer) {
  const htmlResult = await mammoth.convertToHtml({ buffer });
  const html = htmlResult.value || "";

  const blockMatches = Array.from(
    html.matchAll(/<(p|h1|h2|h3|li)[^>]*>([\s\S]*?)<\/(p|h1|h2|h3|li)>/gi)
  );

  const sections: string[] = [];
  const currentSection: string[] = [];

  for (const match of blockMatches) {
    const tag = (match[1] || "").toLowerCase();
    const inner = normalizeInlineText(match[2] || "");

    if (!inner) continue;

    if (isPoolCardStart(inner)) {
      pushCurrentSection(sections, currentSection);
      currentSection.push(inner);
      continue;
    }

    if (isPoolFieldLine(inner)) {
      currentSection.push(inner);
      continue;
    }

    if (tag === "h1" || tag === "h2" || tag === "h3") {
      pushCurrentSection(sections, currentSection);
      currentSection.push(inner);
      continue;
    }

    currentSection.push(inner);
  }

  pushCurrentSection(sections, currentSection);

  const tableRows = Array.from(
    html.matchAll(/<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi)
  ).map((match) => match[1]);

  const normalizedRows: string[] = [];

  for (const rowHtml of tableRows) {
    const cells = Array.from(
      rowHtml.matchAll(/<(td|th)[^>]*>([\s\S]*?)<\/(td|th)>/gi)
    ).map((match) => normalizeInlineText(match[2] || ""));

    const filtered = cells.filter(Boolean);

    if (filtered.length) {
      normalizedRows.push(filtered.join(" | "));
    }
  }

  const raw = await mammoth.extractRawText({ buffer });
  const baseText = normalizeExtractedText(raw.value || "");

  const strongPoolSections = sections.filter((section) => {
    const lower = section.toLowerCase();

    return (
      /^piscina\b/i.test(section) &&
      (lower.includes("tipo:") || lower.includes("tipo|")) &&
      (lower.includes("medidas:") || lower.includes("medidas|")) &&
      (lower.includes("profundidade:") || lower.includes("profundidade|"))
    );
  });

  if (strongPoolSections.length >= 5) {
    return normalizeExtractedText(strongPoolSections.join("\n\n"));
  }

  if (sections.length > 0 && normalizedRows.length === 0) {
    return normalizeExtractedText(sections.join("\n\n"));
  }

  if (normalizedRows.length > 0 && sections.length === 0) {
    return normalizeExtractedText(normalizedRows.join("\n"));
  }

  if (sections.length > 0 && normalizedRows.length > 0) {
    const tableText = normalizeExtractedText(normalizedRows.join("\n"));
    const sectionText = normalizeExtractedText(sections.join("\n\n"));

    if (sectionText.length >= tableText.length) {
      return sectionText;
    }

    return tableText;
  }

  return baseText;
}

async function extractImagesFromDocx(buffer: Buffer) {
  return extractImagesFromZip({
    buffer,
    mediaPrefix: "word/media/",
    source: "docx",
  });
}

async function extractTextFromTxt(buffer: Buffer) {
  return buffer.toString("utf-8").trim();
}

async function extractTextFromXlsx(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as Array<Array<string | number | boolean | null>>;

    parts.push(`PLANILHA: ${sheetName}`);

    for (const row of rows) {
      const line = row
        .map((cell) => String(cell ?? "").trim())
        .filter(Boolean)
        .join(" | ")
        .trim();

      if (line) {
        parts.push(line);
      }
    }

    parts.push("");
  }

  return parts.join("\n").trim();
}

async function extractImagesFromXlsx(buffer: Buffer) {
  return extractImagesFromZip({
    buffer,
    mediaPrefix: "xl/media/",
    source: "xlsx",
  });
}

async function extractTextFromPptx(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const parts: string[] = [];

  for (const slidePath of slideFiles) {
    const slideFile = zip.files[slidePath];
    if (!slideFile || slideFile.dir) continue;

    const xml = await slideFile.async("string");
    const parsed = parser.parse(xml);

    const texts: string[] = [];

    function walk(node: any): void {
      if (!node) return;

      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }

      if (typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          if (key === "a:t" && typeof value === "string") {
            texts.push(value);
          } else {
            walk(value);
          }
        }
      }
    }

    walk(parsed);

    const slideNumberMatch = slidePath.match(/slide(\d+)\.xml$/);
    const slideNumber = slideNumberMatch ? slideNumberMatch[1] : "?";

    parts.push(`SLIDE: ${slideNumber}`);

    const slideText = texts
      .map((item) => item.trim())
      .filter(Boolean)
      .join("\n")
      .trim();

    if (slideText) {
      parts.push(slideText);
    }

    parts.push("");
  }

  return parts.join("\n").trim();
}

async function extractImagesFromPptx(buffer: Buffer) {
  return extractImagesFromZip({
    buffer,
    mediaPrefix: "ppt/media/",
    source: "pptx",
  });
}

async function extractTextFromImage(_buffer: Buffer) {
  return "";
}

async function extractImageFile(buffer: Buffer, fileName: string) {
  const mimeType = getImageMimeTypeFromExtension(fileName);

  return [
    {
      fileName,
      source: "image_file" as const,
      mimeType,
      dataUrl: bufferToDataUrl(buffer, mimeType),
    },
  ];
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

  logPdfDebug("extractTextFromFile started", {
    fileName,
    mimeType,
    extension,
    bufferBytes: buffer.length,
  });

  if (extension === "pdf") {
    text = await extractTextFromPdf(buffer);
    extractedImages = await extractImagesFromPdf(buffer);

    logPdfDebug("extractTextFromFile pdf result", {
      fileName,
      textLength: text.length,
      extractedImages: extractedImages.length,
    });
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

  return {
    fileName,
    mimeType,
    extension,
    text: text.trim(),
    extractedImages,
  };
}
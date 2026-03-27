import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export type ExtractedImageAsset = {
  fileName: string;
  source: "docx" | "xlsx" | "pptx" | "image_file";
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
    const imported: any = await import("pdf-parse");
    const pdfParse =
      typeof imported?.default === "function"
        ? imported.default
        : typeof imported === "function"
        ? imported
        : null;

    if (!pdfParse) {
      return "";
    }

    const result = await pdfParse(buffer);
    return normalizeExtractedText(result?.text || "");
  } catch {
    return "";
  }
}

async function extractTextFromPdfWithPdfJs(buffer: Buffer) {
  try {
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    });

    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();

      const items = (textContent.items || []) as Array<any>;
      const rows = new Map<string, string[]>();

      for (const item of items) {
        const str = String(item?.str || "").trim();
        if (!str) continue;

        const transform = Array.isArray(item?.transform) ? item.transform : [];
        const y = typeof transform[5] === "number" ? transform[5] : 0;
        const key = y.toFixed(1);

        const bucket = rows.get(key) || [];
        bucket.push(str);
        rows.set(key, bucket);
      }

      const ordered = Array.from(rows.entries())
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([, parts]) =>
          parts
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
        )
        .filter(Boolean);

      const pageText = ordered.join("\n").trim();

      if (pageText) {
        pages.push(pageText);
      }
    }

    return normalizeExtractedText(pages.join("\n\n"));
  } catch {
    return "";
  }
}

async function extractTextFromPdf(buffer: Buffer) {
  const firstPass = await extractTextFromPdfWithPdfParse(buffer);

  if (firstPass.length >= 120) {
    return firstPass;
  }

  const secondPass = await extractTextFromPdfWithPdfJs(buffer);

  if (secondPass.length > firstPass.length) {
    return secondPass;
  }

  return firstPass;
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

  if (extension === "pdf") {
    text = await extractTextFromPdf(buffer);
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

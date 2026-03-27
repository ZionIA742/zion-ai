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

async function extractTextFromPdf(buffer: Buffer) {
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
    return (result?.text || "").replace(/\r/g, "").trim();
  } catch {
    return "";
  }
}

async function extractTextFromDocx(buffer: Buffer) {
  const raw = await mammoth.extractRawText({ buffer });
  const baseText = (raw.value || "").replace(/\r/g, "").trim();

  const htmlResult = await mammoth.convertToHtml({ buffer });
  const html = htmlResult.value || "";

  const blockMatches = Array.from(
    html.matchAll(/<(p|h1|h2|h3|li)[^>]*>([\s\S]*?)<\/(p|h1|h2|h3|li)>/gi)
  );

  const blocks: string[] = [];

  for (const match of blockMatches) {
    const tag = (match[1] || "").toLowerCase();

    const inner = (match[2] || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!inner) continue;

    const normalized = inner.replace(/\s+/g, " ").trim();

    if (/^piscina\b/i.test(normalized)) {
      blocks.push(`\n${normalized}\n`);
      continue;
    }

    if (tag === "h1" || tag === "h2" || tag === "h3") {
      blocks.push(`\n${normalized}\n`);
      continue;
    }

    blocks.push(normalized);
  }

  const tableRows = Array.from(
    html.matchAll(/<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi)
  ).map((match) => match[1]);

  const normalizedRows: string[] = [];

  for (const rowHtml of tableRows) {
    const cells = Array.from(
      rowHtml.matchAll(/<(td|th)[^>]*>([\s\S]*?)<\/(td|th)>/gi)
    ).map((match) =>
      match[2]
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
    );

    const filtered = cells.filter(Boolean);

    if (filtered.length) {
      normalizedRows.push(filtered.join(" | "));
    }
  }

  const parts: string[] = [];

  if (blocks.length) {
    parts.push(
      blocks
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    );
  }

  if (normalizedRows.length) {
    parts.push(normalizedRows.join("\n"));
  }

  if (baseText) {
    parts.push(baseText);
  }

  return parts
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export type ExtractedFileContent = {
  fileName: string;
  mimeType: string;
  extension: string;
  text: string;
};

function getExtension(fileName: string) {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

async function extractTextFromPdf(_buffer: Buffer) {
  return "";
}

async function extractTextFromDocx(buffer: Buffer) {
  const raw = await mammoth.extractRawText({ buffer });
  const baseText = (raw.value || "").replace(/\r/g, "").trim();

  const htmlResult = await mammoth.convertToHtml({ buffer });
  const html = htmlResult.value || "";

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

  if (normalizedRows.length) {
    parts.push(normalizedRows.join("\n"));
  }

  if (baseText) {
    parts.push(baseText);
  }

  return parts.join("\n\n").trim();
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
      const line = row.map((cell) => String(cell ?? "").trim()).join(" | ").trim();
      if (line) {
        parts.push(line);
      }
    }

    parts.push("");
  }

  return parts.join("\n").trim();
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
    const parserTarget = zip.files[slidePath];
    if (!parserTarget) continue;

    const xml = await parserTarget.async("string");
    const parsed = parser.parse(xml);

    const texts: string[] = [];

    function walk(node: any) {
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

async function extractTextFromImage(_buffer: Buffer) {
  return "";
}

export async function extractTextFromFile(params: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<ExtractedFileContent> {
  const { fileName, mimeType, buffer } = params;
  const extension = getExtension(fileName);

  let text = "";

  if (extension === "pdf") {
    text = await extractTextFromPdf(buffer);
  } else if (extension === "docx") {
    text = await extractTextFromDocx(buffer);
  } else if (extension === "txt") {
    text = await extractTextFromTxt(buffer);
  } else if (extension === "xlsx" || extension === "xls") {
    text = await extractTextFromXlsx(buffer);
  } else if (extension === "pptx") {
    text = await extractTextFromPptx(buffer);
  } else if (
    ["png", "jpg", "jpeg", "webp"].includes(extension) ||
    mimeType.startsWith("image/")
  ) {
    text = await extractTextFromImage(buffer);
  } else {
    throw new Error(`Tipo de arquivo não suportado: ${fileName}`);
  }

  return {
    fileName,
    mimeType,
    extension,
    text: text.trim(),
  };
}
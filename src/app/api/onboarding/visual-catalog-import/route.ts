import { createRequire } from "node:module";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nodeRequire = createRequire(`${process.cwd()}/package.json`);
const MAX_VISUAL_PAGE_LIMIT = 3;
const PDF_RENDER_SCALE = 0.75;

type VisualCatalogPage = {
  pageNumber: number;
  width: number | null;
  height: number | null;
  imageRef: string;
  hasRenderedImage: boolean;
};

function clampPageStart(value: FormDataEntryValue | null) {
  const parsed = Number(String(value || "1").replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function clampPageLimit(value: FormDataEntryValue | null) {
  const parsed = Number(String(value || String(MAX_VISUAL_PAGE_LIMIT)).replace(/[^\d]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return MAX_VISUAL_PAGE_LIMIT;
  return Math.min(Math.floor(parsed), MAX_VISUAL_PAGE_LIMIT);
}

function readPngDimensionsFromDataUrl(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(",");
  if (separatorIndex < 0) return { width: null, height: null };

  const buffer = Buffer.from(dataUrl.slice(separatorIndex + 1), "base64");
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return { width: null, height: null };
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const uploadedEntry = formData.get("file") || formData.getAll("files")[0];

    if (!(uploadedEntry instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          error: "VISUAL_CATALOG_IMPORT_FILE_REQUIRED",
          message: "Envie um PDF para criar a base visual do catalogo.",
        },
        { status: 400 }
      );
    }

    const extension = uploadedEntry.name.split(".").pop()?.toLowerCase() || "";
    if (extension !== "pdf") {
      return NextResponse.json(
        {
          ok: false,
          error: "VISUAL_CATALOG_IMPORT_PDF_ONLY",
          message: "A base visual inicial aceita apenas PDF.",
        },
        { status: 400 }
      );
    }

    const pageStart = clampPageStart(formData.get("pageStart"));
    const pageLimit = clampPageLimit(formData.get("pageLimit"));
    const requestedPages = Array.from({ length: pageLimit }, (_, index) => pageStart + index);
    const buffer = Buffer.from(await uploadedEntry.arrayBuffer());
    const pdfParseModule = nodeRequire("pdf-parse");
    const PDFParse = (pdfParseModule as any).PDFParse;

    if (typeof PDFParse !== "function") {
      throw new Error("Renderizacao de PDF indisponivel neste ambiente.");
    }

    const parser = new PDFParse({ data: buffer });

    try {
      const screenshot = await parser.getScreenshot({
        partial: requestedPages,
        scale: PDF_RENDER_SCALE,
        imageDataUrl: true,
        imageBuffer: false,
      });

      const pages: VisualCatalogPage[] = (screenshot.pages ?? []).map((page: any) => {
        const pageNumber = Number(page.pageNumber || 0);
        const dimensions =
          typeof page.width === "number" && typeof page.height === "number"
            ? { width: Math.round(page.width), height: Math.round(page.height) }
            : readPngDimensionsFromDataUrl(String(page.dataUrl || ""));
        const imageRef = `pdf::page::${pageNumber}`;

        return {
          pageNumber,
          width: dimensions.width,
          height: dimensions.height,
          imageRef,
          hasRenderedImage: Boolean(page.dataUrl),
        };
      });

      return NextResponse.json({
        ok: true,
        pageStart,
        pageLimit,
        pages,
        drafts: pages.map((page) => ({
          category: null,
          name: null,
          sku: null,
          pageNumber: page.pageNumber,
          imageRef: page.imageRef,
          confidence: 0,
          missingFields: ["vision_not_implemented"],
        })),
        warnings: ["Base visual criada. OCR/vision real ainda nao implementado."],
      });
    } finally {
      await parser.destroy?.();
    }
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "VISUAL_CATALOG_IMPORT_FAILED",
        message: error?.message || "Erro ao criar base visual do catalogo.",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "onboarding/visual-catalog-import",
    method: "POST",
    message: "Rota base para importacao visual de catalogo publicada.",
  });
}

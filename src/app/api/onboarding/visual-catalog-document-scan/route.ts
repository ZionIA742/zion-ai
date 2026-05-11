import { createRequire } from "node:module";
import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nodeRequire = createRequire(`${process.cwd()}/package.json`);
const MAX_DOCUMENT_SCAN_PAGES = 5;
const PDF_RENDER_SCALE = 0.75;
const VISUAL_CATALOG_MODEL = process.env.ZION_VISUAL_CATALOG_MODEL || "gpt-4.1-mini";
const INVALID_JSON_MESSAGE =
  "A analise visual de uma pagina nao retornou evidencias estruturadas validas.";

type PageEvidenceType = "cover" | "model_photos" | "measurement_table" | "description" | "mixed" | "unknown";

type PageEvidenceItem = {
  evidenceId: string;
  modelKey: string | null;
  visibleName: string | null;
  visibleCode: string | null;
  category: "pool" | "chemical" | "accessory" | "other" | null;
  dimensions?: {
    visualText?: string | null;
    width_m?: number | null;
    length_m?: number | null;
    depth_m?: number | null;
    capacity_l?: number | null;
  };
  material?: string | null;
  description?: string | null;
  confidence: number;
  missingFields: string[];
  rawSnippet?: string | null;
};

type PageEvidence = {
  fileKey: string;
  pageNumber: number;
  pageType: PageEvidenceType;
  items: PageEvidenceItem[];
  warnings: string[];
};

class VisualEvidenceInvalidJsonError extends Error {
  constructor(message = INVALID_JSON_MESSAGE) {
    super(message);
    this.name = "VisualEvidenceInvalidJsonError";
  }
}

function parseRequestedPages(formData: FormData) {
  const rawValues = [
    ...formData.getAll("pages"),
    ...formData.getAll("pageNumbers"),
    formData.get("pageStart"),
  ]
    .filter(Boolean)
    .map((value) => String(value || ""));
  const parsed = rawValues
    .flatMap((value) => value.split(/[,\s;]+/g))
    .map((value) => Number(value.replace(/[^\d]/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.floor(value));
  const unique = Array.from(new Set(parsed));
  return unique.length > 0 ? unique.slice(0, MAX_DOCUMENT_SCAN_PAGES) : [1];
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

function coerceNullableString(value: unknown, maxLength = 240) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : null;
}

function coerceNullableNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildModelKey(value: { visibleName: string | null; visibleCode: string | null }) {
  const base = value.visibleCode || value.visibleName;
  if (!base) return null;
  return base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b\d+(?:[,.]\d+)?\s*m?\s*x\s*\d+(?:[,.]\d+)?\s*m?(?:\s*x\s*\d+(?:[,.]\d+)?\s*m?)?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, 80) || null;
}

function parseEvidenceJson(text: string | null | undefined) {
  const rawText = String(text || "").trim();
  if (!rawText) return { pageType: "unknown", items: [], warnings: [INVALID_JSON_MESSAGE] };

  try {
    return JSON.parse(rawText);
  } catch (error) {
    console.error("[ZION][visual-catalog-document-scan] invalid vision JSON", {
      message: error instanceof Error ? error.message : String(error),
      preview: rawText.slice(0, 500),
      length: rawText.length,
    });
    throw new VisualEvidenceInvalidJsonError();
  }
}

function normalizeEvidenceItem(value: any, pageNumber: number, index: number): PageEvidenceItem | null {
  const category = ["pool", "chemical", "accessory", "other"].includes(String(value?.category || ""))
    ? value.category
    : null;
  const visibleName = coerceNullableString(value?.visibleName || value?.visible_name || value?.name);
  const visibleCode = coerceNullableString(value?.visibleCode || value?.visible_code || value?.sku);
  const confidence = Math.max(0, Math.min(1, Number(value?.confidence || 0)));

  if (!visibleName && !visibleCode) return null;
  if (confidence <= 0) return null;

  const dimensions =
    value?.dimensions && typeof value.dimensions === "object"
      ? {
          visualText: coerceNullableString(value.dimensions.visualText || value.dimensions.visual_text),
          width_m: coerceNullableNumber(value.dimensions.width_m),
          length_m: coerceNullableNumber(value.dimensions.length_m),
          depth_m: coerceNullableNumber(value.dimensions.depth_m),
          capacity_l: coerceNullableNumber(value.dimensions.capacity_l),
        }
      : undefined;
  const missingFields = Array.isArray(value?.missingFields)
    ? value.missingFields.map((field: unknown) => String(field || "").trim()).filter(Boolean).slice(0, 12)
    : [];
  const evidence = {
    evidenceId: `page-${pageNumber}-evidence-${index + 1}`,
    modelKey: buildModelKey({ visibleName, visibleCode }),
    visibleName,
    visibleCode,
    category,
    dimensions,
    material: coerceNullableString(value?.material),
    description: coerceNullableString(value?.description, 360),
    confidence,
    missingFields,
    rawSnippet: coerceNullableString(value?.rawSnippet || value?.raw_snippet, 360),
  };
  return evidence;
}

function normalizePageEvidence(value: any, params: { fileKey: string; pageNumber: number }): PageEvidence {
  const pageType = ["cover", "model_photos", "measurement_table", "description", "mixed", "unknown"].includes(
    String(value?.pageType || value?.page_type || "")
  )
    ? (value.pageType || value.page_type)
    : "unknown";
  const rawItems = Array.isArray(value?.items) ? value.items : [];
  const items = rawItems
    .map((item: any, index: number) => normalizeEvidenceItem(item, params.pageNumber, index))
    .filter((item: PageEvidenceItem | null): item is PageEvidenceItem => Boolean(item));
  const warnings = Array.isArray(value?.warnings)
    ? value.warnings.map((warning: unknown) => String(warning || "").trim()).filter(Boolean).slice(0, 8)
    : [];

  return {
    fileKey: params.fileKey,
    pageNumber: params.pageNumber,
    pageType,
    items,
    warnings,
  };
}

async function analyzeEvidencePage(params: {
  dataUrl: string;
  pageNumber: number;
  fileKey: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY nao configurada para analise visual.");
  }

  const openai = new OpenAI({ apiKey });
  const response = await openai.responses.create({
    model: VISUAL_CATALOG_MODEL,
    max_output_tokens: 1400,
    temperature: 0,
    text: {
      format: {
        type: "json_schema",
        name: "visual_catalog_page_evidence",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            pageType: {
              type: "string",
              enum: ["cover", "model_photos", "measurement_table", "description", "mixed", "unknown"],
            },
            items: {
              type: "array",
              maxItems: 12,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  visibleName: { type: ["string", "null"] },
                  visibleCode: { type: ["string", "null"] },
                  category: { type: ["string", "null"], enum: ["pool", "chemical", "accessory", "other", null] },
                  dimensions: {
                    type: ["object", "null"],
                    additionalProperties: false,
                    properties: {
                      visualText: { type: ["string", "null"] },
                      width_m: { type: ["number", "null"] },
                      length_m: { type: ["number", "null"] },
                      depth_m: { type: ["number", "null"] },
                      capacity_l: { type: ["number", "null"] },
                    },
                    required: ["visualText", "width_m", "length_m", "depth_m", "capacity_l"],
                  },
                  material: { type: ["string", "null"] },
                  description: { type: ["string", "null"] },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  missingFields: {
                    type: "array",
                    items: { type: "string" },
                    maxItems: 12,
                  },
                  rawSnippet: { type: ["string", "null"] },
                },
                required: [
                  "visibleName",
                  "visibleCode",
                  "category",
                  "dimensions",
                  "material",
                  "description",
                  "confidence",
                  "missingFields",
                  "rawSnippet",
                ],
              },
            },
            warnings: {
              type: "array",
              items: { type: "string" },
              maxItems: 8,
            },
          },
          required: ["pageType", "items", "warnings"],
        },
      },
    },
    input: [
      {
        role: "system",
        content:
          "Voce gera evidencias visuais de paginas de catalogo. Nao crie produto final e nao consolide modelos. Classifique a pagina e liste apenas evidencias visiveis: nomes, codigos, medidas, materiais e descricoes curtas. Use null quando algo nao estiver legivel. Nunca invente nomes, medidas, precos ou estoque. Se a pagina for densa, retorne menos evidencias corretas em vez de muitas duvidosas. Responda somente JSON valido.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Analise esta pagina como evidencia para uma futura consolidacao de catalogo. Classifique pageType como cover, model_photos, measurement_table, description, mixed ou unknown. Se houver fotos/modelos, capture nomes e codigos visiveis. Se houver tabela de medidas, capture cada modelo/codigo e suas medidas legiveis. Nao gere item final. Nao junte modelos. Para cada evidencia, use visibleName, visibleCode, category, dimensions.visualText exatamente como aparece, numeros JSON com ponto decimal, material, description curta, confidence e missingFields. Se so houver codigo como E01, use visibleCode E01 e visibleName null ou E01 se parecer titulo do item. Use rawSnippet com trecho curto visivel quando ajudar a revisar. Retorne no maximo 12 evidencias seguras.",
          },
          {
            type: "input_image",
            image_url: params.dataUrl,
            detail: "low",
          },
        ],
      },
    ],
  } as any);

  const parsed = parseEvidenceJson(response.output_text);
  return normalizePageEvidence(parsed, {
    fileKey: params.fileKey,
    pageNumber: params.pageNumber,
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const uploadedEntry = formData.get("file") || formData.getAll("files")[0];

    if (!(uploadedEntry instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          error: "VISUAL_DOCUMENT_SCAN_FILE_REQUIRED",
          message: "Envie um PDF visual para gerar evidencias.",
        },
        { status: 400 }
      );
    }

    const extension = uploadedEntry.name.split(".").pop()?.toLowerCase() || "";
    if (extension !== "pdf") {
      return NextResponse.json(
        {
          ok: false,
          error: "VISUAL_DOCUMENT_SCAN_PDF_ONLY",
          message: "A leitura de evidencias visuais aceita apenas PDF nesta etapa.",
        },
        { status: 400 }
      );
    }

    const requestedPages = parseRequestedPages(formData);
    const fileKey = `${uploadedEntry.name}::${uploadedEntry.size}`;
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
      const renderedPages = screenshot.pages ?? [];
      const pageEvidence: PageEvidence[] = [];
      const warnings: string[] = [];

      for (const page of renderedPages) {
        const pageNumber = Number(page.pageNumber || 0);
        const dataUrl = String(page.dataUrl || "");
        if (!pageNumber || !dataUrl) {
          warnings.push("Uma pagina solicitada nao foi renderizada.");
          continue;
        }

        try {
          pageEvidence.push(
            await analyzeEvidencePage({
              dataUrl,
              pageNumber,
              fileKey,
            })
          );
        } catch (error) {
          const message =
            error instanceof VisualEvidenceInvalidJsonError
              ? INVALID_JSON_MESSAGE
              : error instanceof Error
                ? error.message
                : "Falha ao analisar uma pagina.";
          pageEvidence.push({
            fileKey,
            pageNumber,
            pageType: "unknown",
            items: [],
            warnings: [message],
          });
        }
      }

      const renderedPageNumbers = new Set(renderedPages.map((page: any) => Number(page.pageNumber || 0)));
      for (const pageNumber of requestedPages) {
        if (!renderedPageNumbers.has(pageNumber)) {
          warnings.push(`Pagina ${pageNumber} nao foi renderizada.`);
        }
      }

      return NextResponse.json({
        ok: true,
        fileKey,
        requestedPages,
        pageLimit: MAX_DOCUMENT_SCAN_PAGES,
        model: VISUAL_CATALOG_MODEL,
        pageEvidence,
        warnings,
      });
    } finally {
      await parser.destroy?.();
    }
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "VISUAL_DOCUMENT_SCAN_FAILED",
        message: error?.message || "Erro ao gerar evidencias visuais.",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "onboarding/visual-catalog-document-scan",
    method: "POST",
    message: "Rota base para evidencias visuais de catalogo publicada.",
  });
}

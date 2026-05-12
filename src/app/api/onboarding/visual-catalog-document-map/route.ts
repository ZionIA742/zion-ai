import { createRequire } from "node:module";
import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nodeRequire = createRequire(`${process.cwd()}/package.json`);
const MAX_DOCUMENT_MAP_PAGES = 20;
const PDF_RENDER_SCALE = 0.45;
const VISUAL_CATALOG_MODEL = process.env.ZION_VISUAL_CATALOG_MODEL || "gpt-4.1-mini";

type VisualDocumentPageType =
  | "cover"
  | "index"
  | "model_photos"
  | "measurement_table"
  | "spa"
  | "accessories"
  | "institutional"
  | "back_cover"
  | "mixed"
  | "unknown";

type VisualDocumentPageMap = {
  pageNumber: number;
  pageType: VisualDocumentPageType;
  relevanceScore: number;
  detectedLabels: string[];
  possibleModels: string[];
  hasMeasurements: boolean;
  hasManySmallItems: boolean;
  confidence: number;
  recommendedForDetailedScan: boolean;
  reason: string;
};

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
  return Array.from(new Set(parsed)).slice(0, MAX_DOCUMENT_MAP_PAGES);
}

function clampScore(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
}

function coerceStringArray(value: unknown, maxItems: number) {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, maxItems)
    : [];
}

function coercePageType(value: unknown): VisualDocumentPageType {
  const normalized = String(value || "");
  const allowed = [
    "cover",
    "index",
    "model_photos",
    "measurement_table",
    "spa",
    "accessories",
    "institutional",
    "back_cover",
    "mixed",
    "unknown",
  ];
  return allowed.includes(normalized) ? (normalized as VisualDocumentPageType) : "unknown";
}

function normalizePageMap(value: any, pageNumber: number): VisualDocumentPageMap {
  const pageType = coercePageType(value?.pageType || value?.page_type);
  const relevanceScore = clampScore(value?.relevanceScore ?? value?.relevance_score);
  const confidence = clampScore(value?.confidence);
  const hasMeasurements = Boolean(value?.hasMeasurements ?? value?.has_measurements);
  const hasManySmallItems = Boolean(value?.hasManySmallItems ?? value?.has_many_small_items);
  const recommended =
    Boolean(value?.recommendedForDetailedScan ?? value?.recommended_for_detailed_scan) ||
    relevanceScore >= 0.55 ||
    ["model_photos", "measurement_table", "spa", "accessories", "mixed"].includes(pageType);

  return {
    pageNumber,
    pageType,
    relevanceScore,
    detectedLabels: coerceStringArray(value?.detectedLabels || value?.detected_labels, 5),
    possibleModels: coerceStringArray(value?.possibleModels || value?.possible_models, 5),
    hasMeasurements,
    hasManySmallItems,
    confidence,
    recommendedForDetailedScan: recommended,
    reason: String(value?.reason || "").trim().slice(0, 80),
  };
}

function parseMapJson(text: string | null | undefined) {
  const rawText = String(text || "").trim();
  if (!rawText) return { value: null, invalidJson: false };

  try {
    return { value: JSON.parse(rawText), invalidJson: false };
  } catch (error) {
    console.error("[ZION][visual-catalog-document-map] invalid vision JSON", {
      message: error instanceof Error ? error.message : String(error),
      preview: rawText.slice(0, 500),
      length: rawText.length,
    });
    return { value: null, invalidJson: true };
  }
}

async function classifyDocumentPage(params: {
  dataUrl: string;
  pageNumber: number;
}): Promise<VisualDocumentPageMap> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY nao configurada para mapa visual.");
  }

  const openai = new OpenAI({ apiKey });
  const response = await openai.responses.create({
    model: VISUAL_CATALOG_MODEL,
    max_output_tokens: 950,
    temperature: 0,
    text: {
      format: {
        type: "json_schema",
        name: "visual_catalog_document_page_map",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            pageType: {
              type: "string",
              enum: [
                "cover",
                "index",
                "model_photos",
                "measurement_table",
                "spa",
                "accessories",
                "institutional",
                "back_cover",
                "mixed",
                "unknown",
              ],
            },
            relevanceScore: { type: "number", minimum: 0, maximum: 1 },
            detectedLabels: {
              type: "array",
              items: { type: "string", maxLength: 50 },
              maxItems: 5,
            },
            possibleModels: {
              type: "array",
              items: { type: "string", maxLength: 50 },
              maxItems: 5,
            },
            hasMeasurements: { type: "boolean" },
            hasManySmallItems: { type: "boolean" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            recommendedForDetailedScan: { type: "boolean" },
            reason: { type: "string", maxLength: 80 },
          },
          required: [
            "pageType",
            "relevanceScore",
            "detectedLabels",
            "possibleModels",
            "hasMeasurements",
            "hasManySmallItems",
            "confidence",
            "recommendedForDetailedScan",
            "reason",
          ],
        },
      },
    },
    input: [
      {
        role: "system",
        content:
          "Voce faz um mapa barato de paginas de catalogo visual. Nao extraia itens detalhados, medidas completas, tabelas ou listas longas. Classifique a pagina e diga se vale analise detalhada. Use poucos rotulos visiveis e reason com uma frase curta. Responda somente JSON valido.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Classifique esta pagina de catalogo. Tipos validos: cover, index, model_photos, measurement_table, spa, accessories, institutional, back_cover, mixed, unknown. Marque relevanceScore alto para paginas com fotos/modelos, tabelas de medidas, spas, acessorios ou varias linhas de produto. Marque baixo para capa, institucional ou contracapa. Nao transcreva tabelas, nao liste medidas completas e nao liste muitos itens. Em paginas densas, resuma. Liste no maximo 5 rotulos/modelos curtos e visiveis em detectedLabels/possibleModels sem inventar. reason deve ter ate 80 caracteres. recommendedForDetailedScan deve ser true se a pagina pode ajudar a montar itens do catalogo.",
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

  const parsed = parseMapJson(response.output_text);
  const pageMap = normalizePageMap(parsed.value || {}, params.pageNumber);
  if (parsed.invalidJson) {
    pageMap.reason = "Resposta visual parcial no mapa.";
  }
  return pageMap;
}

function selectRecommendedPages(pages: VisualDocumentPageMap[]) {
  const recommended = pages
    .filter((page) => page.recommendedForDetailedScan)
    .sort((a, b) => b.relevanceScore - a.relevanceScore || a.pageNumber - b.pageNumber)
    .map((page) => page.pageNumber);
  const byTypePriority = pages
    .filter((page) =>
      ["model_photos", "measurement_table", "spa", "accessories", "mixed"].includes(page.pageType)
    )
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => page.pageNumber);
  return Array.from(new Set([...recommended, ...byTypePriority])).slice(0, MAX_DOCUMENT_MAP_PAGES);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const uploadedEntry = formData.get("file") || formData.getAll("files")[0];

    if (!(uploadedEntry instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          error: "VISUAL_DOCUMENT_MAP_FILE_REQUIRED",
          message: "Envie um PDF visual para mapear o documento.",
        },
        { status: 400 }
      );
    }

    const extension = uploadedEntry.name.split(".").pop()?.toLowerCase() || "";
    if (extension !== "pdf") {
      return NextResponse.json(
        {
          ok: false,
          error: "VISUAL_DOCUMENT_MAP_PDF_ONLY",
          message: "O mapa visual aceita apenas PDF nesta etapa.",
        },
        { status: 400 }
      );
    }

    const requestedPages = parseRequestedPages(formData);
    const allPages = String(formData.get("allPages") || "").toLowerCase() === "true";
    const fileKey = `${uploadedEntry.name}::${uploadedEntry.size}`;
    const buffer = Buffer.from(await uploadedEntry.arrayBuffer());
    const pdfParseModule = nodeRequire("pdf-parse");
    const PDFParse = (pdfParseModule as any).PDFParse;

    if (typeof PDFParse !== "function") {
      throw new Error("Renderizacao de PDF indisponivel neste ambiente.");
    }

    const parser = new PDFParse({ data: buffer });

    try {
      const screenshotOptions = allPages || requestedPages.length === 0
        ? {
            first: MAX_DOCUMENT_MAP_PAGES,
            scale: PDF_RENDER_SCALE,
            imageDataUrl: true,
            imageBuffer: false,
          }
        : {
            partial: requestedPages,
            scale: PDF_RENDER_SCALE,
            imageDataUrl: true,
            imageBuffer: false,
          };
      const screenshot = await parser.getScreenshot(screenshotOptions);
      const renderedPages = screenshot.pages ?? [];
      const pages: VisualDocumentPageMap[] = [];
      const warnings: string[] = [];

      for (const page of renderedPages.slice(0, MAX_DOCUMENT_MAP_PAGES)) {
        const pageNumber = Number(page.pageNumber || 0);
        const dataUrl = String(page.dataUrl || "");
        if (!pageNumber || !dataUrl) {
          warnings.push("Uma pagina solicitada nao foi renderizada para o mapa.");
          continue;
        }

        try {
          const pageMap = await classifyDocumentPage({ dataUrl, pageNumber });
          if (pageMap.reason === "Resposta visual parcial no mapa.") {
            warnings.push(`Pagina ${pageNumber} teve resposta visual parcial no mapa e foi marcada como unknown.`);
          }
          pages.push(pageMap);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha ao classificar uma pagina.";
          pages.push({
            pageNumber,
            pageType: "unknown",
            relevanceScore: 0,
            detectedLabels: [],
            possibleModels: [],
            hasMeasurements: false,
            hasManySmallItems: false,
            confidence: 0,
            recommendedForDetailedScan: false,
            reason: message,
          });
        }
      }

      return NextResponse.json({
        ok: true,
        fileKey,
        totalPages: Number(screenshot.total || 0) || null,
        pageLimit: MAX_DOCUMENT_MAP_PAGES,
        model: VISUAL_CATALOG_MODEL,
        pages,
        recommendedPages: selectRecommendedPages(pages),
        warnings,
      });
    } finally {
      await parser.destroy?.();
    }
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "VISUAL_DOCUMENT_MAP_FAILED",
        message: error?.message || "Erro ao mapear o catalogo visual.",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "onboarding/visual-catalog-document-map",
    method: "POST",
    message: "Rota base para mapa visual de catalogo publicada.",
  });
}

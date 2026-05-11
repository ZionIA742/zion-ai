import { createRequire } from "node:module";
import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nodeRequire = createRequire(`${process.cwd()}/package.json`);
const MAX_VISUAL_PAGE_LIMIT = 1;
const PDF_RENDER_SCALE = 0.75;
const VISUAL_CATALOG_MODEL = process.env.ZION_VISUAL_CATALOG_MODEL || "gpt-4.1-mini";
const VISUAL_JSON_INVALID_MESSAGE =
  "A analise visual desta pagina nao retornou um resultado estruturado valido. Tente outra pagina ou repita a analise.";

type VisualCatalogPage = {
  pageNumber: number;
  width: number | null;
  height: number | null;
  imageRef: string;
  hasRenderedImage: boolean;
};

type VisualCatalogDraft = {
  category: "pool" | "chemical" | "accessory" | "other" | null;
  name: string | null;
  sku: string | null;
  price_cents: number | null;
  stock_quantity: number | null;
  dimensions: {
    width_m: number | null;
    length_m: number | null;
    depth_m: number | null;
    capacity_l: number | null;
  } | null;
  material: string | null;
  description: string | null;
  pageNumber: number;
  imageRef: string;
  confidence: number;
  missingFields: string[];
};

class VisualCatalogInvalidJsonError extends Error {
  constructor(message = VISUAL_JSON_INVALID_MESSAGE) {
    super(message);
    this.name = "VisualCatalogInvalidJsonError";
  }
}

function clampPageStart(value: FormDataEntryValue | null) {
  const parsed = Number(String(value || "1").replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function clampPageLimit(value: FormDataEntryValue | null) {
  const parsed = Number(String(value || String(MAX_VISUAL_PAGE_LIMIT)).replace(/[^\d]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(Math.floor(parsed), 1);
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

function coerceNullableString(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 240) : null;
}

function coerceNullableNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeVisualDraft(value: any, pageNumber: number, imageRef: string): VisualCatalogDraft | null {
  const category = ["pool", "chemical", "accessory", "other"].includes(String(value?.category || ""))
    ? value.category
    : null;
  const name = coerceNullableString(value?.name);
  const confidence = Math.max(0, Math.min(1, Number(value?.confidence || 0)));

  if (!name || confidence <= 0) return null;

  const dimensions = value?.dimensions && typeof value.dimensions === "object"
    ? {
        width_m: coerceNullableNumber(value.dimensions.width_m),
        length_m: coerceNullableNumber(value.dimensions.length_m),
        depth_m: coerceNullableNumber(value.dimensions.depth_m),
        capacity_l: coerceNullableNumber(value.dimensions.capacity_l),
      }
    : null;
  const missingFields = Array.isArray(value?.missingFields)
    ? value.missingFields.map((field: unknown) => String(field || "").trim()).filter(Boolean).slice(0, 12)
    : [];

  return {
    category,
    name,
    sku: coerceNullableString(value?.sku),
    price_cents: coerceNullableNumber(value?.price_cents),
    stock_quantity: coerceNullableNumber(value?.stock_quantity),
    dimensions,
    material: coerceNullableString(value?.material),
    description: coerceNullableString(value?.description),
    pageNumber,
    imageRef,
    confidence,
    missingFields,
  };
}

function parseVisualCatalogJson(text: string | null | undefined) {
  const rawText = String(text || "").trim();
  if (!rawText) return { drafts: [] };

  try {
    return JSON.parse(rawText);
  } catch (error) {
    console.error("[ZION][visual-catalog-import] invalid vision JSON", {
      message: error instanceof Error ? error.message : String(error),
      preview: rawText.slice(0, 500),
      length: rawText.length,
    });
    throw new VisualCatalogInvalidJsonError();
  }
}

async function analyzeVisualCatalogPage(params: {
  dataUrl: string;
  pageNumber: number;
  imageRef: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY nao configurada para analise visual.");
  }

  const openai = new OpenAI({ apiKey });
  const response = await openai.responses.create({
    model: VISUAL_CATALOG_MODEL,
    max_output_tokens: 1600,
    temperature: 0,
    text: {
      format: {
        type: "json_schema",
        name: "visual_catalog_page",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            drafts: {
              type: "array",
              maxItems: 12,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  category: { type: ["string", "null"], enum: ["pool", "chemical", "accessory", "other", null] },
                  name: { type: ["string", "null"] },
                  sku: { type: ["string", "null"] },
                  price_cents: { type: ["number", "null"] },
                  stock_quantity: { type: ["number", "null"] },
                  dimensions: {
                    type: ["object", "null"],
                    additionalProperties: false,
                    properties: {
                      width_m: { type: ["number", "null"] },
                      length_m: { type: ["number", "null"] },
                      depth_m: { type: ["number", "null"] },
                      capacity_l: { type: ["number", "null"] },
                    },
                    required: ["width_m", "length_m", "depth_m", "capacity_l"],
                  },
                  material: { type: ["string", "null"] },
                  description: { type: ["string", "null"] },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  missingFields: {
                    type: "array",
                    items: { type: "string" },
                    maxItems: 12,
                  },
                },
                required: [
                  "category",
                  "name",
                  "sku",
                  "price_cents",
                  "stock_quantity",
                  "dimensions",
                  "material",
                  "description",
                  "confidence",
                  "missingFields",
                ],
              },
            },
          },
          required: ["drafts"],
        },
      },
    },
    input: [
      {
        role: "system",
        content:
          "Voce extrai rascunhos de catalogos visuais de lojas de piscina. Uma pagina pode conter 0, 1 ou varios produtos. Retorne um draft separado para cada item visivel, ate 12 itens. Nao resuma varios modelos em um so. Nao escolha apenas o item principal se houver outros modelos. Use apenas informacoes visiveis. Nao invente. Responda somente JSON valido, sem markdown, comentarios ou texto fora do JSON. Nao use fracao solta como 1/2; escreva como string no nome/descricao ou use null em campos numericos. Nao use virgula decimal em numeros JSON. Se a pagina estiver muito densa, retorne menos itens com mais seguranca em vez de quebrar o JSON. Se nao houver item claro, retorne drafts vazio.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Analise esta pagina de catalogo. Extraia todos os modelos/produtos visiveis com leitura segura, ate 12 drafts. Cada piscina/produto/codigo deve virar um draft separado. Preserve codigos como E01, E02, E03 no sku quando forem codigos claros; se forem parte do nome, inclua no name. Para piscinas use category pool e tente capturar width_m, length_m, depth_m e capacity_l apenas se estiverem legiveis. Use null quando nao tiver certeza. Campos ausentes devem ser null e listados em missingFields. Use confidence menor quando a leitura estiver incerta. Categorias validas: pool, chemical, accessory, other. Devolva apenas JSON valido.",
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

  const parsed = parseVisualCatalogJson(response.output_text);
  const rawDrafts = Array.isArray(parsed?.drafts) ? parsed.drafts : [];
  return rawDrafts
    .map((draft: any) => normalizeVisualDraft(draft, params.pageNumber, params.imageRef))
    .filter((draft: VisualCatalogDraft | null): draft is VisualCatalogDraft => Boolean(draft));
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
      const firstRenderedPage = (screenshot.pages ?? [])[0];
      const firstPage = pages[0];
      let hadInvalidVisionJson = false;
      const drafts =
        firstRenderedPage?.dataUrl && firstPage
          ? await analyzeVisualCatalogPage({
              dataUrl: String(firstRenderedPage.dataUrl),
              pageNumber: firstPage.pageNumber,
              imageRef: firstPage.imageRef,
            }).catch((error) => {
              if (error instanceof VisualCatalogInvalidJsonError) {
                hadInvalidVisionJson = true;
                return [] as VisualCatalogDraft[];
              }
              throw error;
            })
          : [];

      return NextResponse.json({
        ok: true,
        pageStart,
        pageLimit,
        pages,
        model: VISUAL_CATALOG_MODEL,
        drafts,
        warnings:
          drafts.length > 0
            ? ["Rascunhos gerados por vision. Revise antes de qualquer salvamento."]
            : [
                hadInvalidVisionJson
                  ? VISUAL_JSON_INVALID_MESSAGE
                  : "Ainda nao encontramos itens prontos nesta pagina. Teste outra pagina ou aguarde a etapa completa de vision.",
              ],
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

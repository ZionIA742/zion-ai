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
  visualDimensionsText: string | null;
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

function polishPortugueseCatalogDescription(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return null;

  const replacements: Array<[RegExp, string]> = [
    [/\bagua\b/g, "água"],
    [/\bAgua\b/g, "Água"],
    [/\baplicacao\b/g, "aplicação"],
    [/\bAplicacao\b/g, "Aplicação"],
    [/\bsuspensao\b/g, "suspensão"],
    [/\bSuspensao\b/g, "Suspensão"],
    [/\bparticulas\b/g, "partículas"],
    [/\bParticulas\b/g, "Partículas"],
    [/\birritacao\b/g, "irritação"],
    [/\bIrritacao\b/g, "Irritação"],
    [/\bincrustacoes\b/g, "incrustações"],
    [/\bIncrustacoes\b/g, "Incrustações"],
    [/\bprotecao\b/g, "proteção"],
    [/\bProtecao\b/g, "Proteção"],
    [/\bmanutencao\b/g, "manutenção"],
    [/\bManutencao\b/g, "Manutenção"],
    [/\bcirculacao\b/g, "circulação"],
    [/\bCirculacao\b/g, "Circulação"],
    [/\bquimico\b/g, "químico"],
    [/\bQuimico\b/g, "Químico"],
    [/\bquimica\b/g, "química"],
    [/\bQuimica\b/g, "Química"],
    [/\bacao\b/g, "ação"],
    [/\bAcao\b/g, "Ação"],
    [/\bcorrecao\b/g, "correção"],
    [/\bCorrecao\b/g, "Correção"],
    [/\beliminacao\b/g, "eliminação"],
    [/\bEliminacao\b/g, "Eliminação"],
  ];

  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}

function coerceNullableNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseVisualDecimal(value: string | null | undefined) {
  const normalized = String(value || "").replace(",", ".").replace(/[^\d.]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractDimensionsFromVisualName(name: string | null) {
  if (!name) return null;

  const match = name.match(
    /(.+?)\s+(\d+(?:[,.]\d+)?)\s*m?\s*x\s*(\d+(?:[,.]\d+)?)\s*m?(?:\s*x\s*(\d+(?:[,.]\d+)?)\s*m?)?/i
  );
  if (!match) return null;

  const cleanName = match[1].trim().replace(/[.;,\s]+$/g, "");
  return {
    cleanName: cleanName || name,
    visualDimensionsText: match[0].slice(match[1].length).trim(),
    width_m: parseVisualDecimal(match[2]),
    length_m: parseVisualDecimal(match[3]),
    depth_m: parseVisualDecimal(match[4]),
  };
}

function buildVisualDimensionsTextFromDraft(value: any) {
  const dimensionsFromName = extractDimensionsFromVisualName(coerceNullableString(value?.name));
  if (dimensionsFromName?.visualDimensionsText) return dimensionsFromName.visualDimensionsText;

  return coerceNullableString(value?.visualDimensionsText || value?.visual_dimensions_text);
}

function cleanupVisualMissingFields(params: {
  missingFields: string[];
  name: string | null;
  sku: string | null;
  price_cents: number | null;
  stock_quantity: number | null;
  dimensions: VisualCatalogDraft["dimensions"];
  visualDimensionsText: string | null;
  material: string | null;
  description: string | null;
}) {
  const filled = new Set<string>();
  if (params.name) filled.add("name");
  if (params.sku) filled.add("sku");
  if (params.price_cents != null) filled.add("price_cents");
  if (params.stock_quantity != null) filled.add("stock_quantity");
  if (params.material) filled.add("material");
  if (params.description) filled.add("description");
  if (params.visualDimensionsText) {
    filled.add("dimensions");
    filled.add("width_m");
    filled.add("length_m");
    filled.add("depth_m");
  } else if (
    params.dimensions &&
    (params.dimensions.width_m != null ||
      params.dimensions.length_m != null ||
      params.dimensions.depth_m != null ||
      params.dimensions.capacity_l != null)
  ) {
    filled.add("dimensions");
  }
  if (params.dimensions?.capacity_l != null) filled.add("capacity_l");

  return params.missingFields.filter((field) => !filled.has(field));
}

function normalizeVisualDraft(value: any, pageNumber: number, imageRef: string): VisualCatalogDraft | null {
  const category = ["pool", "chemical", "accessory", "other"].includes(String(value?.category || ""))
    ? value.category
    : null;
  const rawName = coerceNullableString(value?.name);
  const dimensionsFromName = extractDimensionsFromVisualName(rawName);
  const name = dimensionsFromName ? dimensionsFromName.cleanName : rawName;
  const visualDimensionsText = buildVisualDimensionsTextFromDraft(value);
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
  const normalizedDimensions = dimensionsFromName
    ? {
        width_m: dimensions?.width_m ?? dimensionsFromName.width_m,
        length_m: dimensions?.length_m ?? dimensionsFromName.length_m,
        depth_m: dimensions?.depth_m ?? dimensionsFromName.depth_m,
        capacity_l: dimensions?.capacity_l ?? null,
      }
    : dimensions;
  const missingFields = Array.isArray(value?.missingFields)
    ? value.missingFields.map((field: unknown) => String(field || "").trim()).filter(Boolean).slice(0, 12)
    : [];
  const sku = coerceNullableString(value?.sku);
  const priceCents = coerceNullableNumber(value?.price_cents);
  const stockQuantity = coerceNullableNumber(value?.stock_quantity);
  const material = coerceNullableString(value?.material);
  const rawDescription = coerceNullableString(value?.description);
  const description = polishPortugueseCatalogDescription(rawDescription);
  const cleanMissingFields = cleanupVisualMissingFields({
    missingFields,
    name,
    sku,
    price_cents: priceCents,
    stock_quantity: stockQuantity,
    dimensions: normalizedDimensions,
    visualDimensionsText,
    material,
    description,
  });

  return {
    category,
    name,
    sku,
    price_cents: priceCents,
    stock_quantity: stockQuantity,
    dimensions: normalizedDimensions,
    visualDimensionsText,
    material,
    description,
    pageNumber,
    imageRef,
    confidence,
    missingFields: cleanMissingFields,
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
                  visualDimensionsText: { type: ["string", "null"] },
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
                  "visualDimensionsText",
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
          "Você extrai rascunhos de catálogos visuais de lojas de piscina. Responda em português brasileiro natural, com acentos, cedilha e pontuação correta quando escrever nomes descritivos e descrições, por exemplo: água, aplicação, suspensão, manutenção, proteção, circulação e partículas. Preserve exatamente SKUs, códigos, siglas, medidas, marcas e nomes comerciais como aparecem no documento; não invente acentos em códigos, SKUs, marcas ou textos técnicos. Se o texto visível estiver sem acento por ser marca, SKU, rótulo técnico ou texto de embalagem, preserve como está. As descrições devem ficar naturais para catálogo de loja brasileira. Uma página pode conter 0, 1 ou vários produtos. Retorne um draft separado para cada item visível, até 12 itens. Não resuma vários modelos em um só. Não escolha apenas o item principal se houver outros modelos. Use apenas nomes, códigos e medidas literalmente visíveis na imagem. Separe nome/modelo das medidas: se aparecer ITAPEMA 9,10m x 3,60m x 1,40m, use name ITAPEMA, visualDimensionsText exatamente 9,10m x 3,60m x 1,40m e dimensions com números JSON usando ponto decimal. Não reordene as medidas em visualDimensionsText. Não misture medidas no name quando conseguir separar. Nunca invente nomes genéricos como Pool Model 1, Modelo 1, Piscina 1 ou Item 1. Se só houver código legível como E01/E02/E03, use esse código como nome provisório e sku. Se o nome não estiver legível, use name null e inclua name em missingFields. Responda somente JSON válido, sem markdown, comentários ou texto fora do JSON. Não use fração solta como 1/2; escreva como string no nome/descrição ou use null em campos numéricos. Não use vírgula decimal em números JSON. Se a página estiver muito densa, retorne menos itens corretos em vez de muitos itens inventados. Se não houver item claro, retorne drafts vazio.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Analise esta página de catálogo. Extraia todos os modelos/produtos visíveis com leitura segura, até 12 drafts. Cada piscina/produto/código deve virar um draft separado. Preserve códigos como E01, E02, E03 no sku quando forem códigos claros; se forem parte do nome, inclua no name. Nunca crie nomes aproximados ou traduzidos. Não use Pool Model, Modelo, Piscina ou Item com número se isso não estiver escrito na imagem. Se houver apenas código visível, use o código como name provisório. Para piscinas use category pool e tente capturar width_m, length_m, depth_m e capacity_l apenas se estiverem legíveis ao lado do item. Se aparecer modelo junto de medidas, coloque apenas o modelo em name, coloque a medida textual exatamente como aparece em visualDimensionsText, sem reordenar e mantendo vírgula decimal, e coloque números JSON em dimensions com ponto decimal. Quando preencher description, escreva em português brasileiro natural com acentos, cedilha e pontuação correta, sem alterar SKUs, códigos, marcas, medidas ou textos técnicos. Use null quando não tiver certeza. Campos ausentes devem ser null e listados em missingFields. Use confidence menor quando a leitura estiver incerta. Categorias válidas: pool, chemical, accessory, other. Devolva apenas JSON válido.",
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
      const drafts: VisualCatalogDraft[] =
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

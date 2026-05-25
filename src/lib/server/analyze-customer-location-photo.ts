import OpenAI from "openai";

const CUSTOMER_IMAGE_ANALYSIS_MODEL =
  process.env.ZION_CUSTOMER_IMAGE_ANALYSIS_MODEL ||
  process.env.ZION_VISUAL_CATALOG_MODEL ||
  "gpt-4.1-mini";

export type CustomerLocationPhotoAnalysis = {
  summary: string;
  space_size_signal: "small" | "medium" | "large" | "uncertain";
  environment_type: "outdoor" | "indoor" | "mixed" | "uncertain";
  access_constraints: string[];
  ground_context: string[];
  confidence: "low" | "medium" | "high";
  needs_measurements_confirmation: boolean;
  safe_commercial_hints: string[];
};

export type CustomerLocationPhotoAnalysisResult =
  | {
      ok: true;
      analysis: CustomerLocationPhotoAnalysis;
      provider: "openai";
      model: string;
    }
  | {
      ok: false;
      error: string;
      message: string;
      provider: "openai";
      model: string;
    };

function sanitizeStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeEnumValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fallback: T
) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowedValues.includes(normalized as T) ? (normalized as T) : fallback;
}

function parseAnalysisOutput(outputText: string): CustomerLocationPhotoAnalysis | null {
  try {
    const parsed = JSON.parse(outputText || "{}") as Record<string, unknown>;
    const summary = String(parsed.summary || "").trim();

    if (!summary) {
      return null;
    }

    return {
      summary,
      space_size_signal: normalizeEnumValue(
        parsed.space_size_signal,
        ["small", "medium", "large", "uncertain"] as const,
        "uncertain"
      ),
      environment_type: normalizeEnumValue(
        parsed.environment_type,
        ["outdoor", "indoor", "mixed", "uncertain"] as const,
        "uncertain"
      ),
      access_constraints: sanitizeStringArray(parsed.access_constraints, 6),
      ground_context: sanitizeStringArray(parsed.ground_context, 6),
      confidence: normalizeEnumValue(
        parsed.confidence,
        ["low", "medium", "high"] as const,
        "low"
      ),
      needs_measurements_confirmation:
        parsed.needs_measurements_confirmation !== false,
      safe_commercial_hints: sanitizeStringArray(parsed.safe_commercial_hints, 6),
    };
  } catch {
    return null;
  }
}

export async function analyzeCustomerLocationPhotoFromStorage(args: {
  supabase: any;
  bucket: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null | undefined;
}): Promise<CustomerLocationPhotoAnalysisResult> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const model = CUSTOMER_IMAGE_ANALYSIS_MODEL;

  if (!openaiApiKey) {
    return {
      ok: false,
      error: "OPENAI_ENV_MISSING",
      message: "Verifique OPENAI_API_KEY nas variaveis de ambiente.",
      provider: "openai",
      model,
    };
  }

  const { data: imageBlob, error: downloadError } = await args.supabase.storage
    .from(args.bucket)
    .download(args.storagePath);

  if (downloadError || !imageBlob) {
    return {
      ok: false,
      error: "IMAGE_DOWNLOAD_FAILED",
      message: downloadError?.message || "Nao foi possivel baixar a imagem para analise visual.",
      provider: "openai",
      model,
    };
  }

  const arrayBuffer = await imageBlob.arrayBuffer();
  const mimeType = String(args.mimeType || imageBlob.type || "image/jpeg").trim() || "image/jpeg";
  const dataUrl = `data:${mimeType};base64,${Buffer.from(arrayBuffer).toString("base64")}`;
  const openai = new OpenAI({ apiKey: openaiApiKey });

  try {
    const response = await openai.responses.create({
      model,
      max_output_tokens: 1200,
      temperature: 0,
      text: {
        format: {
          type: "json_schema",
          name: "customer_location_photo_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              space_size_signal: {
                type: "string",
                enum: ["small", "medium", "large", "uncertain"],
              },
              environment_type: {
                type: "string",
                enum: ["outdoor", "indoor", "mixed", "uncertain"],
              },
              access_constraints: {
                type: "array",
                items: { type: "string" },
                maxItems: 6,
              },
              ground_context: {
                type: "array",
                items: { type: "string" },
                maxItems: 6,
              },
              confidence: {
                type: "string",
                enum: ["low", "medium", "high"],
              },
              needs_measurements_confirmation: { type: "boolean" },
              safe_commercial_hints: {
                type: "array",
                items: { type: "string" },
                maxItems: 6,
              },
            },
            required: [
              "summary",
              "space_size_signal",
              "environment_type",
              "access_constraints",
              "ground_context",
              "confidence",
              "needs_measurements_confirmation",
              "safe_commercial_hints",
            ],
          },
        },
      },
      input: [
        {
          role: "system",
          content:
            "Voce faz analise visual interna de foto do local para venda consultiva de piscinas. Responda apenas em JSON valido. Seja cauteloso, curto e objetivo em portugues do Brasil. Nunca invente medidas exatas, inclinacao, drenagem, estrutura, instalacao garantida, compatibilidade confirmada, acabamento, deck, paisagismo ou obra. Use linguagem de probabilidade como parece, indica, sugere, aparenta. A summary deve ser util para a IA comercial responder por texto ao cliente com seguranca. needs_measurements_confirmation deve ficar true, exceto se a imagem for totalmente inutilizavel, e mesmo assim nao invente certeza. safe_commercial_hints deve trazer no maximo 6 pistas comerciais seguras, como pedir largura/comprimento, priorizar modelos compactos ou confirmar acesso para entrega.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Analise esta foto do local onde o cliente pensa em colocar uma piscina. Gere uma analise interna segura, sem falar diretamente com o cliente. Preencha summary com 1 ou 2 frases curtas. Use space_size_signal para small, medium, large ou uncertain. Use environment_type para outdoor, indoor, mixed ou uncertain. Liste access_constraints e ground_context apenas quando houver sinal visual razoavel. Marque confidence conforme o nivel de clareza visual. Nunca confirme que cabe com certeza e nunca invente medidas exatas.",
            },
            {
              type: "input_image",
              image_url: dataUrl,
              detail: "low",
            },
          ],
        },
      ],
    } as any);

    const analysis = parseAnalysisOutput(String((response as any)?.output_text || ""));

    if (!analysis) {
      return {
        ok: false,
        error: "INVALID_VISUAL_ANALYSIS_OUTPUT",
        message: "A analise visual retornou um formato invalido.",
        provider: "openai",
        model,
      };
    }

    return {
      ok: true,
      analysis,
      provider: "openai",
      model,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: "OPENAI_VISUAL_ANALYSIS_FAILED",
      message: error?.message || "Falha ao analisar a foto do local do cliente.",
      provider: "openai",
      model,
    };
  }
}

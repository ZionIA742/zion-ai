type CanonicalQualificationFactKey =
  | "need_summary"
  | "interested_product_reference"
  | "space_text"
  | "requested_area_m2"
  | "location_text"
  | "preferred_period_text"
  | "budget_text"
  | "decision_context"
  | "installation_interest"
  | "payment_interest"
  | "technical_visit_interest"
  | "customer_preferences_text"
  | "relevant_objection_text";

type QualificationFactValueKind = "text" | "number" | "boolean";
type QualificationAssertionLevel = "confirmed" | "inferred";
type QualificationSourceType = "incoming_customer_message" | "system_inference";

type OpenAiResponsesClient = {
  responses: {
    create(args: unknown): Promise<unknown>;
  };
};

const FACT_VALUE_KIND_BY_KEY: Record<
  CanonicalQualificationFactKey,
  QualificationFactValueKind
> = {
  need_summary: "text",
  interested_product_reference: "text",
  space_text: "text",
  requested_area_m2: "number",
  location_text: "text",
  preferred_period_text: "text",
  budget_text: "text",
  decision_context: "text",
  installation_interest: "boolean",
  payment_interest: "boolean",
  technical_visit_interest: "boolean",
  customer_preferences_text: "text",
  relevant_objection_text: "text",
};

const ALL_FACT_KEYS = Object.keys(
  FACT_VALUE_KIND_BY_KEY,
) as CanonicalQualificationFactKey[];

type SupportedBooleanFactKey =
  | "installation_interest"
  | "payment_interest"
  | "technical_visit_interest";

type DeterministicBooleanRule = {
  factKey: SupportedBooleanFactKey;
  value: boolean;
  patterns: RegExp[];
};

const DETERMINISTIC_BOOLEAN_RULES: DeterministicBooleanRule[] = [
  {
    factKey: "installation_interest",
    value: false,
    patterns: [
      /\bnao quero instalacao\b/i,
      /\bnao quero com instalacao\b/i,
      /\bquero sem instalacao\b/i,
    ],
  },
  {
    factKey: "installation_interest",
    value: true,
    patterns: [
      /\bquero com instalacao\b/i,
      /\bpreciso de instalacao\b/i,
      /\bquero instalacao\b/i,
      /\bquero incluir instalacao\b/i,
    ],
  },
  {
    factKey: "payment_interest",
    value: true,
    patterns: [
      /\bquero parcelar\b/i,
      /\bpreciso parcelar\b/i,
      /\bquero pagar parcelado\b/i,
      /\bpreciso de parcelamento\b/i,
      /\bquero pagar no pix\b/i,
    ],
  },
  {
    factKey: "technical_visit_interest",
    value: false,
    patterns: [
      /\bnao quero visita tecnica\b/i,
      /\bnao quero uma visita tecnica\b/i,
    ],
  },
  {
    factKey: "technical_visit_interest",
    value: true,
    patterns: [
      /\bquero (uma )?visita tecnica\b/i,
      /\bpodem agendar (uma )?visita tecnica\b/i,
      /\bpreciso de (uma )?visita tecnica\b/i,
    ],
  },
];

export type QualificationFactCandidate = {
  factKey: CanonicalQualificationFactKey;
  valueKind: QualificationFactValueKind;
  valueJson: string | number | boolean;
  assertionLevel: QualificationAssertionLevel;
  sourceType: QualificationSourceType;
  evidenceText: string;
};

type StructuredCandidatePayload = {
  fact_key?: unknown;
  assertion_level?: unknown;
  value_kind?: unknown;
  text_value?: unknown;
  number_value?: unknown;
  boolean_value?: unknown;
  evidence_text?: unknown;
};

export type StructuredQualificationExtractionResult = {
  candidates: QualificationFactCandidate[];
  response: unknown | null;
  failureReason: string | null;
};

export type QualificationFactMergeResult = {
  mergedCandidates: QualificationFactCandidate[];
  discardedFactKeys: CanonicalQualificationFactKey[];
};

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeEvidence(value: string | null | undefined): string {
  return collapseWhitespace(normalizeText(value));
}

function normalizeTextValue(value: string): string {
  return collapseWhitespace(value);
}

function normalizeComparableText(value: string): string {
  return collapseWhitespace(normalizeText(value));
}

function normalizeForPatternChar(char: string): string {
  return char
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00d7/g, "x")
    .toLowerCase();
}

function buildNormalizedTextWithIndexMap(value: string): {
  normalizedText: string;
  indexMap: number[];
} {
  const source = String(value || "");
  let normalizedText = "";
  const indexMap: number[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const normalizedChar = normalizeForPatternChar(source[index] || "");
    for (const outputChar of normalizedChar) {
      normalizedText += outputChar;
      indexMap.push(index);
    }
  }

  return { normalizedText, indexMap };
}

function extractRawMatchSlice(args: {
  sourceText: string;
  indexMap: number[];
  matchIndex: number;
  matchText: string;
}): string {
  const normalizedStart = args.matchIndex;
  const normalizedEnd = normalizedStart + args.matchText.length;
  const rawStart = args.indexMap[normalizedStart] ?? 0;
  const rawEnd =
    normalizedEnd < args.indexMap.length
      ? args.indexMap[normalizedEnd] ?? args.sourceText.length
      : args.sourceText.length;

  return args.sourceText.slice(rawStart, rawEnd);
}

function parseDimensionNumberToken(value: string): number | null {
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function asCanonicalFactKey(value: unknown): CanonicalQualificationFactKey | null {
  return typeof value === "string" && ALL_FACT_KEYS.includes(value as CanonicalQualificationFactKey)
    ? (value as CanonicalQualificationFactKey)
    : null;
}

function asValueKind(value: unknown): QualificationFactValueKind | null {
  return value === "text" || value === "number" || value === "boolean" ? value : null;
}

function asAssertionLevel(value: unknown): QualificationAssertionLevel | null {
  return value === "confirmed" || value === "inferred" ? value : null;
}

function buildCandidate(args: {
  factKey: CanonicalQualificationFactKey;
  valueJson: string | number | boolean;
  assertionLevel: QualificationAssertionLevel;
  sourceType: QualificationSourceType;
  evidenceText: string;
}): QualificationFactCandidate {
  return {
    factKey: args.factKey,
    valueKind: FACT_VALUE_KIND_BY_KEY[args.factKey],
    valueJson: args.valueJson,
    assertionLevel: args.assertionLevel,
    sourceType: args.sourceType,
    evidenceText: args.evidenceText,
  };
}

function pushCandidate(
  out: QualificationFactCandidate[],
  candidate: QualificationFactCandidate | null,
) {
  if (candidate) out.push(candidate);
}

function deriveConfirmedAreaFromText(text: string): number | null {
  const normalizedSource = String(text || "");
  const explicitAreaMatch = normalizedSource.match(
    /\b(\d+(?:[.,]\d+)?)\s*(?:m2|m²|metros?\s+quadrados?)\b/i,
  );
  if (explicitAreaMatch?.[1]) {
    const area = parseDimensionNumberToken(explicitAreaMatch[1]);
    return area != null && area > 0 ? Number(area.toFixed(2)) : null;
  }

  const dimensionMatch = normalizedSource.match(
    /\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:x|×)\s*(\d{1,3}(?:[.,]\d{1,2})?)\b/i,
  );
  if (!dimensionMatch?.[1] || !dimensionMatch?.[2]) return null;

  const width = parseDimensionNumberToken(dimensionMatch[1]);
  const length = parseDimensionNumberToken(dimensionMatch[2]);
  if (width == null || length == null) return null;

  const area = Number((width * length).toFixed(2));
  return Number.isFinite(area) && area > 0 ? area : null;
}

function deriveConfirmedAreaFromMatchableText(text: string): number | null {
  const normalizedSource = normalizeComparableText(text).replace(/\u00b2/g, "2");
  const explicitAreaMatch = normalizedSource.match(
    /\b(\d+(?:[.,]\d+)?)\s*(?:m2|metros?\s+quadrados?)\b/i,
  );
  if (explicitAreaMatch?.[1]) {
    const area = parseDimensionNumberToken(explicitAreaMatch[1]);
    return area != null && area > 0 ? Number(area.toFixed(2)) : null;
  }

  const dimensionMatch = normalizedSource.match(
    /\b(\d{1,3}(?:[.,]\d{1,2})?)\s*x\s*(\d{1,3}(?:[.,]\d{1,2})?)\b/i,
  );
  if (!dimensionMatch?.[1] || !dimensionMatch?.[2]) return null;

  const width = parseDimensionNumberToken(dimensionMatch[1]);
  const length = parseDimensionNumberToken(dimensionMatch[2]);
  if (width == null || length == null) return null;

  const area = Number((width * length).toFixed(2));
  return Number.isFinite(area) && area > 0 ? area : null;
}

function parseDeterministicBooleanCandidateFromNormalizedText(args: {
  factKey: SupportedBooleanFactKey;
  text: string;
}): { value: boolean; evidenceText: string } | null {
  const normalized = buildNormalizedTextWithIndexMap(args.text);

  for (const rule of DETERMINISTIC_BOOLEAN_RULES) {
    if (rule.factKey !== args.factKey) continue;
    for (const pattern of rule.patterns) {
      const match = pattern.exec(normalized.normalizedText);
      if (match?.[0] && match.index != null) {
        return {
          value: rule.value,
          evidenceText: extractRawMatchSlice({
            sourceText: args.text,
            indexMap: normalized.indexMap,
            matchIndex: match.index,
            matchText: match[0],
          }),
        };
      }
    }
  }

  return null;
}

function parseDeterministicBooleanCandidate(args: {
  factKey: SupportedBooleanFactKey;
  text: string;
}): { value: boolean; evidenceText: string } | null {
  return parseDeterministicBooleanCandidateFromNormalizedText(args);
}

function extractDimensionCandidates(anchorMessage: string): QualificationFactCandidate[] {
  const out: QualificationFactCandidate[] = [];
  const matches = Array.from(
    anchorMessage.matchAll(/\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:x|×)\s*(\d{1,3}(?:[.,]\d{1,2})?)\b/gi),
  );
  const first = matches[0];

  if (!first) return out;

  const evidenceText = first[0];
  const areaM2 = deriveConfirmedAreaFromMatchableText(evidenceText);

  pushCandidate(
    out,
    buildCandidate({
      factKey: "space_text",
      valueJson: normalizeTextValue(evidenceText),
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText,
    }),
  );

  if (areaM2 != null) {
    pushCandidate(
      out,
      buildCandidate({
        factKey: "requested_area_m2",
        valueJson: areaM2,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText,
      }),
    );
  }

  return out;
}

function extractExplicitAreaCandidates(anchorMessage: string): QualificationFactCandidate[] {
  const out: QualificationFactCandidate[] = [];
  const normalized = buildNormalizedTextWithIndexMap(anchorMessage);
  const normalizedForArea = normalized.normalizedText.replace(/\u00b2/g, "2");
  const match = /\b(\d+(?:[.,]\d+)?)\s*(?:m2|metros?\s+quadrados?)\b/i.exec(
    normalizedForArea,
  );

  if (!match || match.index == null) return out;

  const evidenceText = extractRawMatchSlice({
    sourceText: anchorMessage,
    indexMap: normalized.indexMap,
    matchIndex: match.index,
    matchText: match[0],
  });
  const areaM2 = deriveConfirmedAreaFromMatchableText(evidenceText);

  if (areaM2 == null) return out;

  out.push(
    buildCandidate({
      factKey: "space_text",
      valueJson: normalizeTextValue(evidenceText),
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText,
    }),
  );
  out.push(
    buildCandidate({
      factKey: "requested_area_m2",
      valueJson: areaM2,
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText,
    }),
  );

  return out;
}

function extractBooleanCandidates(anchorMessage: string): QualificationFactCandidate[] {
  const out: QualificationFactCandidate[] = [];
  const factKeys: SupportedBooleanFactKey[] = [
    "installation_interest",
    "payment_interest",
    "technical_visit_interest",
  ];

  for (const factKey of factKeys) {
    const parsed = parseDeterministicBooleanCandidate({
      factKey,
      text: anchorMessage,
    });
    if (!parsed) continue;

    out.push(
      buildCandidate({
        factKey,
        valueJson: parsed.value,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: parsed.evidenceText,
      }),
    );
  }

  return out;
}

function canonicalizeCandidateValue(candidate: QualificationFactCandidate): string | null {
  if (candidate.valueKind === "text") {
    return typeof candidate.valueJson === "string"
      ? `text:${normalizeComparableText(candidate.valueJson)}`
      : null;
  }

  if (candidate.valueKind === "number") {
    return typeof candidate.valueJson === "number" && Number.isFinite(candidate.valueJson)
      ? `number:${Number(candidate.valueJson)}`
      : null;
  }

  if (candidate.valueKind === "boolean") {
    return typeof candidate.valueJson === "boolean"
      ? `boolean:${candidate.valueJson ? "true" : "false"}`
      : null;
  }

  return null;
}

function candidateStrength(candidate: QualificationFactCandidate): number {
  if (candidate.assertionLevel === "confirmed") return 2;
  return 1;
}

export function isBareQualificationReply(anchorMessage: string): boolean {
  const normalized = normalizeEvidence(anchorMessage);
  return /^(sim|nao|ok|beleza|blz|isso|certo)$/.test(normalized);
}

export function extractDeterministicQualificationCandidates(
  anchorMessage: string,
): QualificationFactCandidate[] {
  if (isBareQualificationReply(anchorMessage)) return [];

  return [
    ...extractDimensionCandidates(anchorMessage),
    ...extractExplicitAreaCandidates(anchorMessage),
    ...extractBooleanCandidates(anchorMessage),
  ];
}

export function validateQualificationFactCandidate(args: {
  candidate: QualificationFactCandidate;
  anchorMessage: string;
}): QualificationFactCandidate | null {
  const expectedValueKind = FACT_VALUE_KIND_BY_KEY[args.candidate.factKey];
  const normalizedAnchor = normalizeEvidence(args.anchorMessage);
  const normalizedEvidence = normalizeEvidence(args.candidate.evidenceText);

  if (!normalizedAnchor || !normalizedEvidence) return null;
  if (!normalizedAnchor.includes(normalizedEvidence)) return null;
  if (isBareQualificationReply(args.anchorMessage)) return null;
  if (args.candidate.valueKind !== expectedValueKind) return null;

  if (
    (args.candidate.assertionLevel === "confirmed" &&
      args.candidate.sourceType !== "incoming_customer_message") ||
    (args.candidate.assertionLevel === "inferred" &&
      args.candidate.sourceType !== "system_inference")
  ) {
    return null;
  }

  if (expectedValueKind === "text") {
    if (typeof args.candidate.valueJson !== "string") return null;
    const normalizedValue = normalizeTextValue(args.candidate.valueJson);
    if (!normalizedValue) return null;

    if (args.candidate.assertionLevel === "confirmed") {
      const comparableValue = normalizeComparableText(normalizedValue);
      if (!comparableValue || !normalizedEvidence.includes(comparableValue)) {
        return null;
      }
    }

    return { ...args.candidate, valueJson: normalizedValue };
  }

  if (expectedValueKind === "number") {
    if (
      typeof args.candidate.valueJson !== "number" ||
      !Number.isFinite(args.candidate.valueJson) ||
      args.candidate.valueJson <= 0
    ) {
      return null;
    }

    if (
      args.candidate.factKey === "requested_area_m2" &&
      args.candidate.assertionLevel === "confirmed"
    ) {
      const derivedArea = deriveConfirmedAreaFromMatchableText(args.candidate.evidenceText);
      if (derivedArea == null || derivedArea !== args.candidate.valueJson) {
        return null;
      }
    }

    return args.candidate;
  }

  if (typeof args.candidate.valueJson !== "boolean") return null;

  if (args.candidate.assertionLevel === "confirmed") {
    const factKey = args.candidate.factKey as SupportedBooleanFactKey;
    const parsed = parseDeterministicBooleanCandidate({
      factKey,
      text: args.candidate.evidenceText,
    });
    if (!parsed || parsed.value !== args.candidate.valueJson) {
      return null;
    }
  }

  return args.candidate;
}

function parseStructuredCandidate(
  rawCandidate: StructuredCandidatePayload,
): QualificationFactCandidate | null {
  const factKey = asCanonicalFactKey(rawCandidate.fact_key);
  const assertionLevel = asAssertionLevel(rawCandidate.assertion_level);
  const valueKind = asValueKind(rawCandidate.value_kind);
  const evidenceText =
    typeof rawCandidate.evidence_text === "string" ? rawCandidate.evidence_text.trim() : "";

  if (!factKey || !assertionLevel || !valueKind || !evidenceText) return null;
  if (FACT_VALUE_KIND_BY_KEY[factKey] !== valueKind) return null;

  const hasTextValue = typeof rawCandidate.text_value === "string";
  const hasNumberValue = typeof rawCandidate.number_value === "number";
  const hasBooleanValue = typeof rawCandidate.boolean_value === "boolean";

  if (valueKind === "text") {
    if (
      !hasTextValue ||
      String(rawCandidate.text_value).trim().length === 0 ||
      rawCandidate.number_value !== null ||
      rawCandidate.boolean_value !== null
    ) {
      return null;
    }

    return buildCandidate({
      factKey,
      valueJson: String(rawCandidate.text_value),
      assertionLevel,
      sourceType: assertionLevel === "confirmed" ? "incoming_customer_message" : "system_inference",
      evidenceText,
    });
  }

  if (valueKind === "number") {
    if (
      !hasNumberValue ||
      !Number.isFinite(rawCandidate.number_value) ||
      rawCandidate.text_value !== null ||
      rawCandidate.boolean_value !== null
    ) {
      return null;
    }

    return buildCandidate({
      factKey,
      valueJson: Number(rawCandidate.number_value),
      assertionLevel,
      sourceType: assertionLevel === "confirmed" ? "incoming_customer_message" : "system_inference",
      evidenceText,
    });
  }

  if (
    !hasBooleanValue ||
    rawCandidate.text_value !== null ||
    rawCandidate.number_value !== null
  ) {
    return null;
  }

  return buildCandidate({
    factKey,
    valueJson: rawCandidate.boolean_value as boolean,
    assertionLevel,
    sourceType: assertionLevel === "confirmed" ? "incoming_customer_message" : "system_inference",
    evidenceText,
  });
}

export async function extractStructuredQualificationCandidates(args: {
  openai: OpenAiResponsesClient;
  model: string;
  anchorMessage: string;
}): Promise<StructuredQualificationExtractionResult> {
  let response: unknown | null = null;

  try {
    response = await args.openai.responses.create({
      model: args.model,
      temperature: 0,
      max_output_tokens: 900,
      text: {
        format: {
          type: "json_schema",
          name: "sales_qualification_fact_candidates",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              candidates: {
                type: "array",
                maxItems: 13,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    fact_key: { type: "string", enum: ALL_FACT_KEYS },
                    assertion_level: { type: "string", enum: ["confirmed", "inferred"] },
                    value_kind: { type: "string", enum: ["text", "number", "boolean"] },
                    text_value: { type: ["string", "null"] },
                    number_value: { type: ["number", "null"] },
                    boolean_value: { type: ["boolean", "null"] },
                    evidence_text: { type: "string" },
                  },
                  required: [
                    "fact_key",
                    "assertion_level",
                    "value_kind",
                    "text_value",
                    "number_value",
                    "boolean_value",
                    "evidence_text",
                  ],
                },
              },
            },
            required: ["candidates"],
          },
        },
      },
      instructions: [
        "Extraia apenas qualification facts canonicos diretamente sustentados pela mensagem do cliente.",
        "Use confirmed somente quando a evidencia literal estiver explicitamente na mensagem.",
        "Use inferred somente para inferencias conservadoras sustentadas por trecho literal, sem inventar contexto.",
        "Nunca extraia fato a partir de respostas vagas como sim, nao, ok, beleza.",
        "evidence_text deve ser um substring literal curto da mensagem do cliente.",
        "Retorne array vazio quando houver duvida, pergunta sem confirmacao, ou evidencia insuficiente.",
      ].join(" "),
      input: [
        {
          role: "user",
          content: `Mensagem do cliente:\n${args.anchorMessage}`,
        },
      ],
    });

    const parsed = JSON.parse(String((response as any)?.output_text || "{}")) as {
      candidates?: StructuredCandidatePayload[];
    };
    const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];

    return {
      candidates: rawCandidates
        .map((candidate) => parseStructuredCandidate(candidate))
        .filter((candidate): candidate is QualificationFactCandidate => !!candidate),
      response,
      failureReason: null,
    };
  } catch (error: any) {
    return {
      candidates: [],
      response,
      failureReason: error?.message || "structured_extraction_failed",
    };
  }
}

export function mergeQualificationFactCandidates(args: {
  deterministicCandidates: QualificationFactCandidate[];
  aiCandidates: QualificationFactCandidate[];
}): QualificationFactMergeResult {
  const byFactKey = new Map<CanonicalQualificationFactKey, QualificationFactCandidate[]>();

  for (const candidate of [...args.deterministicCandidates, ...args.aiCandidates]) {
    const bucket = byFactKey.get(candidate.factKey) || [];
    bucket.push(candidate);
    byFactKey.set(candidate.factKey, bucket);
  }

  const mergedCandidates: QualificationFactCandidate[] = [];
  const discardedFactKeys: CanonicalQualificationFactKey[] = [];

  for (const [factKey, bucket] of byFactKey) {
    const byCanonicalValue = new Map<string, QualificationFactCandidate>();

    for (const candidate of bucket) {
      const canonicalValue = canonicalizeCandidateValue(candidate);
      if (!canonicalValue) continue;

      const existing = byCanonicalValue.get(canonicalValue);
      if (!existing || candidateStrength(candidate) > candidateStrength(existing)) {
        byCanonicalValue.set(canonicalValue, candidate);
      }
    }

    if (byCanonicalValue.size === 1) {
      mergedCandidates.push(
        byCanonicalValue.values().next().value as QualificationFactCandidate,
      );
      continue;
    }

    discardedFactKeys.push(factKey);
  }

  return {
    mergedCandidates,
    discardedFactKeys,
  };
}

export function buildQualificationWriterOperationKey(
  anchorMessageId: string,
  factKey: CanonicalQualificationFactKey,
): string {
  return `p9_qfact_extract_v1:${anchorMessageId}:${factKey}`;
}

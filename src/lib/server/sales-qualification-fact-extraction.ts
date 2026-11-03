type CanonicalQualificationFactKey =
  | "need_summary"
  | "interested_product_reference"
  | "space_text"
  | "requested_area_m2"
  | "location_text"
  | "customer_address_text"
  | "customer_city"
  | "customer_state_code"
  | "preferred_period_text"
  | "budget_text"
  | "decision_context"
  | "installation_interest"
  | "payment_interest"
  | "technical_visit_interest"
  | "measurements_confirmation_required"
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
  customer_address_text: "text",
  customer_city: "text",
  customer_state_code: "text",
  preferred_period_text: "text",
  budget_text: "text",
  decision_context: "text",
  installation_interest: "boolean",
  payment_interest: "boolean",
  technical_visit_interest: "boolean",
  measurements_confirmation_required: "boolean",
  customer_preferences_text: "text",
  relevant_objection_text: "text",
};

const ALL_FACT_KEYS = Object.keys(
  FACT_VALUE_KIND_BY_KEY,
) as CanonicalQualificationFactKey[];

const BRAZILIAN_STATE_CODES = new Set([
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
]);

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
      /\b(?:gostaria|queria) de saber se da para parcelar\b/i,
      /\b(?:gostaria|queria) de saber se tem como parcelar\b/i,
      /\b(?:gostaria|queria) de saber se e possivel parcelar\b/i,
    ],
  },
  {
    factKey: "technical_visit_interest",
    value: false,
    patterns: [
      /\bnao quero visita tecnica\b/i,
      /\bnao quero uma visita tecnica\b/i,
      /\bnao tenho interesse em (?:fazer |agendar )?(?:uma )?visita tecnica\b/i,
    ],
  },
  {
    factKey: "technical_visit_interest",
    value: true,
    patterns: [
      /\bquero (uma )?visita tecnica\b/i,
      /\bpodem agendar (uma )?visita tecnica\b/i,
      /\bpreciso de (uma )?visita tecnica\b/i,
      /\btenho interesse em (?:fazer |agendar )?(?:uma )?visita tecnica\b/i,
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

function containsExplicitStateCodeToken(evidence: string, stateCode: string): boolean {
  const normalizedStateCode = normalizeComparableText(stateCode);
  if (!normalizedStateCode) return false;

  return new RegExp(
    `(^|[^a-z0-9])${normalizedStateCode}($|[^a-z0-9])`,
  ).test(evidence);
}

function isApproximateCustomerCityEvidence(args: {
  evidence: string;
  city: string;
}): boolean {
  const normalizedCity = normalizeComparableText(args.city);
  if (!normalizedCity) return false;

  return [
    "perto de",
    "proximo de",
    "regiao de",
    "zona de",
    "bairro de",
    "bairro",
  ].some((prefix) => args.evidence.includes(`${prefix} ${normalizedCity}`));
}

function canonicalizePreferredPeriodComparableText(value: string): string {
  const normalized = normalizeComparableText(value);

  const currentPeriodMatch =
    /\b(?:de preferencia\s+)?(?:ainda\s+)?(?:este|esse|neste|nesse)\s+(mes|semana)\b/.exec(
      normalized,
    );
  if (currentPeriodMatch?.[1]) {
    return `current:${currentPeriodMatch[1]}`;
  }

  const nextPeriodPrefixMatch =
    /\b(?:no\s+)?proximo\s+(mes|semana)\b/.exec(normalized);
  if (nextPeriodPrefixMatch?.[1]) {
    return `next:${nextPeriodPrefixMatch[1]}`;
  }

  const nextPeriodSuffixMatch =
    /\b(mes|semana)\s+que\s+vem\b/.exec(normalized);
  if (nextPeriodSuffixMatch?.[1]) {
    return `next:${nextPeriodSuffixMatch[1]}`;
  }

  return normalized;
}

function stripPreferredPeriodFromDecisionContext(value: string): string {
  const periodPatterns = [
    /(?:,\s*)?(?:de\s+prefer[eê]ncia\s+)?(?:ainda\s+)?(?:este|esse|neste|nesse)\s+(?:m[eê]s|semana)\b/gi,
    /(?:,\s*)?(?:no\s+)?pr[oó]ximo\s+(?:m[eê]s|semana)\b/gi,
    /(?:,\s*)?(?:m[eê]s|semana)\s+que\s+vem\b/gi,
  ];

  let sanitized = value;
  for (const pattern of periodPatterns) {
    sanitized = sanitized.replace(pattern, "");
  }

  return collapseWhitespace(
    sanitized
      .replace(/^,\s*/, "")
      .replace(/\s+,/g, ",")
      .replace(/,\s*$/g, ""),
  );
}
function normalizeForPatternChar(char: string): string {
  return char
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00d7/g, "x")
    .replace(/\u00b2/g, "2")
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
    /\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:x|×|por(?=\s*\d{1,3}(?:[.,]\d{1,2})?\s*(?:m|metros?)\b))\s*(\d{1,3}(?:[.,]\d{1,2})?)(?:\s*(?:m|metros?))?\b/i,
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
    /\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:x|por(?=\s*\d{1,3}(?:[.,]\d{1,2})?\s*(?:m|metros?)\b))\s*(\d{1,3}(?:[.,]\d{1,2})?)(?:\s*(?:m|metros?))?\b/i,
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
  const normalized = buildNormalizedTextWithIndexMap(anchorMessage);
  const matches = Array.from(
    normalized.normalizedText.matchAll(/\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:x|por(?=\s*\d{1,3}(?:[.,]\d{1,2})?\s*(?:m|metros?)\b))\s*(\d{1,3}(?:[.,]\d{1,2})?)(?:\s*(?:m|metros?))?\b/gi),
  );
  for (const match of matches) {
    if (match.index == null || !isCustomerSpaceEvidence({ normalizedText: normalized.normalizedText, start: match.index, end: match.index + match[0].length, evidenceKind: "dimension" })) continue;
    const evidenceText = extractRawMatchSlice({
      sourceText: anchorMessage,
      indexMap: normalized.indexMap,
      matchIndex: match.index,
      matchText: match[0],
    });
    const areaM2 = deriveConfirmedAreaFromMatchableText(evidenceText);
    pushCandidate(out, buildCandidate({ factKey: "space_text", valueJson: normalizeTextValue(evidenceText), assertionLevel: "confirmed", sourceType: "incoming_customer_message", evidenceText }));
    if (areaM2 != null) pushCandidate(out, buildCandidate({ factKey: "requested_area_m2", valueJson: areaM2, assertionLevel: "confirmed", sourceType: "incoming_customer_message", evidenceText }));
  }

  return out;
}

function extractExplicitAreaCandidates(anchorMessage: string): QualificationFactCandidate[] {
  const out: QualificationFactCandidate[] = [];
  const normalized = buildNormalizedTextWithIndexMap(anchorMessage);
  const normalizedForArea = normalized.normalizedText.replace(/\u00b2/g, "2");
  for (const match of normalizedForArea.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(?:m2|metros?\s+quadrados?)\b/gi)) {
    if (
      match.index == null ||
      !isCustomerSpaceEvidence({
        normalizedText: normalizedForArea,
        start: match.index,
        end: match.index + match[0].length,
        evidenceKind: "area",
      })
    ) {
      continue;
    }

    const evidenceText = extractRawMatchSlice({
      sourceText: anchorMessage,
      indexMap: normalized.indexMap,
      matchIndex: match.index,
      matchText: match[0],
    });
    const areaM2 = deriveConfirmedAreaFromMatchableText(evidenceText);
    if (areaM2 == null) continue;

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
  }

  return out;
}

function isCustomerSpaceEvidence(args: {
  normalizedText: string;
  start: number;
  end: number;
  evidenceKind: "dimension" | "area";
}): boolean {
  const before = args.normalizedText.slice(0, args.start);
  const sentenceStart = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf(","),
    before.lastIndexOf(";"),
    before.lastIndexOf(":"),
  );
  const segment = args.normalizedText.slice(sentenceStart + 1, args.end);
  const connector = Math.max(segment.lastIndexOf(" e "), segment.lastIndexOf(" mas "), segment.lastIndexOf(" porem "));
  const rightSide = connector >= 0 ? segment.slice(connector + 3) : "";
  const startsNewSubject = /\b(?:espacos?|terrenos?|quintais?|lotes?|piscina|modelo|casco|produto)\b/.test(rightSide);
  const local = (connector >= 0 && startsNewSubject ? rightSide : segment).trim();
  const beforeOccurrence = local.slice(0, Math.max(0, local.length - (args.end - args.start)));
  const hasSpace = /\b(?:espacos?|terrenos?|quintais?|lotes?)\b/.test(beforeOccurrence);
  const product = /\b(?:piscina|modelo|casco|produto)\b[\s\S]*(?:\b(?:mede|tem|possui|e|e de|de)\b)/.test(beforeOccurrence);
  const installationSpace = /\b(?:espacos?|terrenos?|quintais?|lotes?)\b[\s\S]*\b(?:para|pra)\s+(?:instalar|colocar)\s+(?:(?:uma?|a)\s+)?piscina\b[\s\S]*(?:\b(?:mede|e de)\b)\s*$/.test(beforeOccurrence);
  const directArea =
    args.evidenceKind === "area" &&
    /\b(?:tenho|possuo|disponho de)\b/.test(beforeOccurrence);
  const explicitAreaSubject =
    args.evidenceKind === "area" &&
    /\barea\b[\s\S]*\b(?:e|de|tem|possui)\s*$/.test(beforeOccurrence);
  return (
    hasSpace ||
    installationSpace ||
    directArea ||
    explicitAreaSubject
  ) && (!product || installationSpace);
}

function countDimensionalOccurrences(value: string): number {
  const normalized = buildNormalizedTextWithIndexMap(value).normalizedText;
  return [
    ...normalized.matchAll(/\b\d{1,3}(?:[.,]\d{1,2})?\s*(?:x|por)\s*\d{1,3}(?:[.,]\d{1,2})?(?:\s*(?:m|metros?))?\b/gi),
    ...normalized.matchAll(/\b\d+(?:[.,]\d+)?\s*(?:m2|metros?\s+quadrados?)\b/gi),
  ].length;
}

function canonicalDimensionOccurrenceKey(value: string): string | null {
  const normalized = buildNormalizedTextWithIndexMap(value).normalizedText;
  const matches = Array.from(normalized.matchAll(/\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:x|por)\s*(\d{1,3}(?:[.,]\d{1,2})?)(?:\s*(?:m|metros?))?\b/gi));
  if (matches.length !== 1) return null;
  const match = matches[0];
  if (!match?.[1] || !match[2]) return null;
  const first = parseDimensionNumberToken(match[1]);
  const second = parseDimensionNumberToken(match[2]);
  if (first == null || second == null) return null;
  return `${first}x${second}`;
}

function hasAuthorizedCustomerSpaceEvidence(
  anchorMessage: string,
  evidenceText: string,
  candidateValue: string | number,
): boolean {
  const normalizedAnchor = buildNormalizedTextWithIndexMap(anchorMessage);
  const normalizedEvidence = buildNormalizedTextWithIndexMap(evidenceText).normalizedText;
  if (!normalizedEvidence) return false;

  const evidenceStart = normalizedAnchor.normalizedText.indexOf(normalizedEvidence);
  if (evidenceStart < 0) return false;
  const evidenceEnd = evidenceStart + normalizedEvidence.length;

  const occurrences = [
    ...Array.from(normalizedAnchor.normalizedText.matchAll(/\b\d{1,3}(?:[.,]\d{1,2})?\s*(?:x|por)\s*\d{1,3}(?:[.,]\d{1,2})?(?:\s*(?:m|metros?))?\b/gi)).map((match) => ({
      match,
      evidenceKind: "dimension" as const,
    })),
    ...Array.from(normalizedAnchor.normalizedText.matchAll(/\b\d+(?:[.,]\d+)?\s*(?:m2|metros?\s+quadrados?)\b/gi)).map((match) => ({
      match,
      evidenceKind: "area" as const,
    })),
  ].filter(({ match }) =>
    match.index != null &&
    match.index >= evidenceStart &&
    match.index + match[0].length <= evidenceEnd,
  );

  if (occurrences.length === 0) return false;

  const candidateHasSingleDimensionalOccurrence =
    typeof candidateValue !== "string" || countDimensionalOccurrences(candidateValue) === 1;
  if (!candidateHasSingleDimensionalOccurrence) return false;

  const candidateDimensionKey =
    typeof candidateValue === "string"
      ? canonicalDimensionOccurrenceKey(candidateValue)
      : null;
  const candidateArea =
    typeof candidateValue === "number"
      ? candidateValue
      : typeof candidateValue === "string"
        ? deriveConfirmedAreaFromMatchableText(candidateValue)
        : null;
  const candidateOccurrences = occurrences.filter(({ match, evidenceKind }) => {
    if (evidenceKind === "dimension" && candidateDimensionKey != null) {
      return canonicalDimensionOccurrenceKey(match[0]) === candidateDimensionKey;
    }
    if (candidateArea != null) {
      return deriveConfirmedAreaFromMatchableText(match[0]) === candidateArea;
    }
    return candidateDimensionKey == null && candidateArea == null;
  });

  if (candidateOccurrences.length === 0) return false;

  const exactOccurrenceEvidence = candidateOccurrences.every(({ match }) => normalizedEvidence === match[0]);
  if (exactOccurrenceEvidence) {
    const exactMatchCount = candidateOccurrences.reduce((count, { evidenceKind }) => {
      const pattern = evidenceKind === "dimension"
        ? /\b\d{1,3}(?:[.,]\d{1,2})?\s*(?:x|por)\s*\d{1,3}(?:[.,]\d{1,2})?(?:\s*(?:m|metros?))?\b/gi
        : /\b\d+(?:[.,]\d+)?\s*(?:m2|metros?\s+quadrados?)\b/gi;
      return count + Array.from(normalizedAnchor.normalizedText.matchAll(pattern)).filter((match) => match[0] === normalizedEvidence).length;
    }, 0);
    if (exactMatchCount !== 1) return false;
  }

  return candidateOccurrences.some(({ match, evidenceKind }) =>
    match.index != null &&
    isCustomerSpaceEvidence({
      normalizedText: normalizedAnchor.normalizedText,
      start: match.index,
      end: match.index + match[0].length,
      evidenceKind,
    }),
  );
}

function extractPreferredPeriodCandidates(anchorMessage: string): QualificationFactCandidate[] {
  const normalized = buildNormalizedTextWithIndexMap(anchorMessage);
  const match =
    /\b(?:de\s+preferencia\s+)?ainda\s+(?:este|esse)\s+(?:mes|semana)\b|\bde\s+preferencia\s+(?:este|esse)\s+(?:mes|semana)\b/i.exec(
      normalized.normalizedText,
    );

  if (!match?.[0] || match.index == null) return [];

  const evidenceText = extractRawMatchSlice({
    sourceText: anchorMessage,
    indexMap: normalized.indexMap,
    matchIndex: match.index,
    matchText: match[0],
  });

  return [
    buildCandidate({
      factKey: "preferred_period_text",
      valueJson: normalizeTextValue(evidenceText),
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText,
    }),
  ];
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

function canonicalizeSpaceDimensionComparableText(value: string): string {
  const normalized = normalizeComparableText(value);

  const matches = Array.from(
    normalized.matchAll(
      /\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:x|\u00d7|por)\s*(\d{1,3}(?:[.,]\d{1,2})?)(?:\s*(?:m|metros?))?\b/g,
    ),
  );

  // Multiplas dimensoes nao podem ser reduzidas a uma unica medida.
  if (matches.length !== 1) return normalized;

  const match = matches[0];
  if (!match?.[1] || !match?.[2]) return normalized;

  const precedingText = normalized.slice(0, match.index ?? 0);
  const isBareDimension = normalized === match[0];

  // Uma descricao contextual so representa o espaco do cliente
  // quando o proprio texto identifica claramente esse espaco.
  const hasCustomerSpaceContext =
    /\b(?:espaco|terreno|quintal|lote)\b/.test(precedingText);

  // Considerar a clausula que descreve a medida, nao qualquer
  // referencia anterior a piscina na mensagem inteira.
  const clauseStart = Math.max(
    precedingText.lastIndexOf(","),
    precedingText.lastIndexOf(";"),
    precedingText.lastIndexOf(":"),
    precedingText.lastIndexOf("."),
  );
  const clauseContext = precedingText.slice(clauseStart + 1).trim();

  const productIsSubject =
    /^(?:(?:e|mas)\s+)?(?:(?:o|a|um|uma|esse|essa|meu|minha)\s+)?(?:piscina|modelo|produto|casco)\b/.test(
      clauseContext,
    );

  const spaceMentions = Array.from(
    precedingText.matchAll(/\b(?:espaco|terreno|quintal|lote)\b/g),
  );
  const lastSpaceMention = spaceMentions[spaceMentions.length - 1];

  const textAfterSpace = lastSpaceMention
    ? precedingText.slice(
        (lastSpaceMention.index ?? 0) + lastSpaceMention[0].length,
      )
    : "";

  const productMentionedAfterSpace =
    /\b(?:piscina|modelo|produto|casco)\b/.test(textAfterSpace);

  // "Meu espaco para instalar uma piscina e de 6 por 3 metros"
  // descreve o espaco; "piscina de 6 por 3 metros" nao.
  const explicitInstallationPurpose =
    /\b(?:espaco|terreno|quintal|lote)\b.*\b(?:para|pra)\s+(?:instalar|colocar)\s+(?:(?:uma?|a)\s+)?piscina\s+(?:e\s+de|mede)\s*$/.test(
      precedingText,
    );

  if (
    !isBareDimension &&
    (
      !hasCustomerSpaceContext ||
      productIsSubject ||
      (productMentionedAfterSpace && !explicitInstallationPurpose)
    )
  ) {
    return normalized;
  }

  const first = parseDimensionNumberToken(match[1]);
  const second = parseDimensionNumberToken(match[2]);

  if (
    first == null ||
    second == null ||
    first <= 0 ||
    second <= 0
  ) {
    return normalized;
  }

  return `space_dimensions:${first}x${second}`;
}

function canonicalizeCandidateValue(candidate: QualificationFactCandidate): string | null {
  if (candidate.valueKind === "text") {
    if (typeof candidate.valueJson !== "string") return null;

    const comparableValue =
      candidate.factKey === "preferred_period_text"
        ? canonicalizePreferredPeriodComparableText(candidate.valueJson)
        : candidate.factKey === "space_text"
          ? canonicalizeSpaceDimensionComparableText(candidate.valueJson)
          : normalizeComparableText(candidate.valueJson);

    return comparableValue ? `text:${comparableValue}` : null;
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
    ...extractPreferredPeriodCandidates(anchorMessage),
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

  if (
    (args.candidate.factKey === "customer_city" ||
      args.candidate.factKey === "customer_state_code") &&
    (args.candidate.assertionLevel !== "confirmed" ||
      args.candidate.sourceType !== "incoming_customer_message")
  ) {
    return null;
  }

  if (expectedValueKind === "text") {
    if (typeof args.candidate.valueJson !== "string") return null;
    const normalizedValue = normalizeTextValue(args.candidate.valueJson);
    if (!normalizedValue) return null;

    if (
      args.candidate.factKey === "space_text" &&
      args.candidate.assertionLevel === "confirmed" &&
      !hasAuthorizedCustomerSpaceEvidence(
        args.anchorMessage,
        args.candidate.evidenceText,
        args.candidate.valueJson,
      )
    ) {
      return null;
    }

    if (
      args.candidate.factKey === "customer_city" &&
      isApproximateCustomerCityEvidence({
        evidence: normalizedEvidence,
        city: normalizedValue,
      })
    ) {
      return null;
    }

    if (args.candidate.factKey === "customer_state_code") {
      const normalizedStateCode = normalizedValue.toUpperCase();
      if (!BRAZILIAN_STATE_CODES.has(normalizedStateCode)) return null;

      if (args.candidate.assertionLevel === "confirmed") {
        if (!containsExplicitStateCodeToken(normalizedEvidence, normalizedStateCode)) {
          return null;
        }
      }

      return { ...args.candidate, valueJson: normalizedStateCode };
    }

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
      if (
        !hasAuthorizedCustomerSpaceEvidence(
          args.anchorMessage,
          args.candidate.evidenceText,
          args.candidate.valueJson,
        )
      ) {
        return null;
      }
    }

    return args.candidate;
  }

  if (typeof args.candidate.valueJson !== "boolean") return null;

  if (args.candidate.assertionLevel === "confirmed") {
    if (args.candidate.factKey === "measurements_confirmation_required") {
      const parsed = parseExplicitMeasurementsConfirmationRequirement(
        args.candidate.evidenceText,
      );

      if (parsed == null || parsed !== args.candidate.valueJson) {
        return null;
      }

      return args.candidate;
    }

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

function parseExplicitMeasurementsConfirmationRequirement(
  text: string,
): boolean | null {
  const normalized = normalizeEvidence(text);

  if (!normalized) return null;

  const mentionsMeasurement =
    /\b(?:medida|medidas|medicao|medicoes)\b/i.test(normalized);

  const mentionsConfirmation =
    /\b(?:confirmar|confirmacao|confirmada|confirmadas|confirmado|confirmados|conferir|conferencia|conferida|conferidas|conferido|conferidos|validar|validacao|validada|validadas|validado|validados)\b/i.test(
      normalized,
    );

  if (!mentionsMeasurement || !mentionsConfirmation) {
    return null;
  }

  const explicitlyStillUnconfirmed =
    /\b(?:ainda\s+)?nao\s+(?:esta|estao|foi|foram)\s+(?:confirmada|confirmadas|confirmado|confirmados|conferida|conferidas|conferido|conferidos|validada|validadas|validado|validados)\b/i.test(
      normalized,
    );

  if (explicitlyStillUnconfirmed) {
    return true;
  }

  const explicitlyAlreadyConfirmed =
    /\b(?:ja\s+)?(?:esta|estao|foi|foram|ficou|ficaram)\s+(?:confirmada|confirmadas|confirmado|confirmados|conferida|conferidas|conferido|conferidos|validada|validadas|validado|validados)\b/i.test(
      normalized,
    );

  if (explicitlyAlreadyConfirmed) {
    return false;
  }

  const explicitlyNoFurtherConfirmation =
    /\bnao\s+(?:precisa|precisam|preciso|precisamos|necessita|necessitam|necessitamos|e\s+necessario)\s+(?:mais\s+)?(?:confirmar|conferir|validar)\b/i.test(
      normalized,
    );

  if (explicitlyNoFurtherConfirmation) {
    return false;
  }

  const explicitlyPending =
    /\b(?:ainda\s+)?(?:precisa|precisam|preciso|precisamos|necessita|necessitam|necessitamos|falta|faltam|tem\s+que|deve|devem)\s+(?:confirmar|conferir|validar|ser\s+(?:confirmada|confirmadas|confirmado|confirmados|conferida|conferidas|conferido|conferidos|validada|validadas|validado|validados))\b/i.test(
      normalized,
    ) ||
    /\b(?:pendente|pendentes)\s+de\s+(?:confirmacao|conferencia|validacao)\b/i.test(
      normalized,
    );

  return explicitlyPending ? true : null;
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

    const rawTextValue = String(rawCandidate.text_value);
    const textValue =
      factKey === "decision_context"
        ? stripPreferredPeriodFromDecisionContext(rawTextValue)
        : rawTextValue;

    if (!textValue.trim()) return null;

    return buildCandidate({
      factKey,
      valueJson: textValue,
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
                maxItems: 17,
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
        "measurements_confirmation_required indica somente se as medidas desta venda ainda precisam de confirmacao; true significa que ainda precisam ser confirmadas e false significa que ja estao explicitamente confirmadas ou que nao precisam mais de confirmacao.",
        "Nunca infira measurements_confirmation_required a partir de dimensoes, requested_area_m2, tamanho do espaco, interesse em visita tecnica, existencia de visita tecnica ou simples necessidade de alguem ir ao local medir.",
        "Se a necessidade de confirmar as medidas nao estiver explicitamente sustentada pela mensagem, nao extraia measurements_confirmation_required.",
        "decision_context descreve somente quem decide, como decide, pessoas envolvidas ou contexto da decisao; nunca inclua prazo ou periodo temporal.",
        "Prazo, janela temporal ou preferencia de quando deve ir exclusivamente em preferred_period_text.",
        "location_text representa somente cidade, bairro, regiao ou localizacao geral do cliente; nao coloque endereco postal completo nesse fato.",
        "customer_address_text representa endereco completo ou especifico informado pelo cliente, como rua ou avenida, numero, complemento, bairro, cidade, estado ou CEP.",
        "customer_city representa somente o municipio ou cidade explicitamente informado como localizacao do cliente; confirme apenas quando a mensagem sustentar literalmente essa cidade.",
        "customer_state_code representa somente a UF brasileira de 2 letras explicitamente informada pelo cliente; nunca infira a UF a partir da cidade.",
        "Nunca trate bairro, regiao, zona ou uma relacao de proximidade como customer_city confirmado, incluindo frases como perto de uma cidade.",
        "Um endereco completo pode produzir customer_address_text e tambem customer_city e customer_state_code quando cidade e UF estiverem explicitamente presentes.",
        "Quando a mesma mensagem trouxer um endereco completo, extraia esse endereco em customer_address_text e nao repita o mesmo endereco em location_text. So extraia location_text separadamente quando houver evidencia literal independente de cidade, bairro, regiao ou localizacao geral.",
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

  const customerAddressCandidate =
    mergedCandidates.find((candidate) => candidate.factKey === "customer_address_text") ?? null;

  const customerAddressCanonicalValue = customerAddressCandidate
    ? canonicalizeCandidateValue(customerAddressCandidate)
    : null;

  const finalMergedCandidates = customerAddressCanonicalValue
    ? mergedCandidates.filter((candidate) => {
        if (candidate.factKey !== "location_text") return true;

        return canonicalizeCandidateValue(candidate) !== customerAddressCanonicalValue;
      })
    : mergedCandidates;

  return {
    mergedCandidates: finalMergedCandidates,
    discardedFactKeys,
  };
}

export function buildQualificationWriterOperationKey(
  anchorMessageId: string,
  factKey: CanonicalQualificationFactKey,
): string {
  return `p9_qfact_extract_v1:${anchorMessageId}:${factKey}`;
}

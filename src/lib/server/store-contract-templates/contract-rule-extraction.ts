type ExtractedContractRuleDraft = {
  ruleGroup: string;
  ruleKey: string;
  label: string;
  valueText: string;
  sourceExcerpt: string;
  confidence: number;
  sortOrder: number;
};

type SectionMarker = {
  key: string;
  phrases: string[];
};

type DenseSearchIndex = {
  denseText: string;
  denseToOriginalIndexes: number[];
};

function cleanInlineText(value: string) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLooseText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function buildDenseSearchIndex(originalText: string): DenseSearchIndex {
  let denseText = "";
  const denseToOriginalIndexes: number[] = [];

  for (let index = 0; index < originalText.length; index += 1) {
    const normalizedChunk = normalizeLooseText(originalText[index]).replace(/[^A-Z0-9]/g, "");
    if (!normalizedChunk) continue;

    for (const char of normalizedChunk) {
      denseText += char;
      denseToOriginalIndexes.push(index);
    }
  }

  return {
    denseText,
    denseToOriginalIndexes,
  };
}

function normalizeDenseToken(value: string) {
  return normalizeLooseText(value).replace(/[^A-Z0-9]/g, "");
}

function limitText(value: string, maxLength: number) {
  const normalized = cleanInlineText(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
}

const SECTION_MARKERS: SectionMarker[] = [
  { key: "dados_partes", phrases: ["DADOS DAS PARTES", "DADOS DAS PARTE"] },
  { key: "contratante", phrases: ["CONTRATANTE"] },
  { key: "contratada", phrases: ["CONTRATADA"] },
  { key: "objeto", phrases: ["DO OBJETO", "OBJETO DO CONTRATO"] },
  { key: "pedido", phrases: ["DO PEDIDO"] },
  {
    key: "instalacao",
    phrases: [
      "DA ENTREGA E INSTALACAO",
      "DA ENTREGA E DA INSTALACAO",
      "DOS SERVICOS CONTRATADOS",
      "DAS NORMAS DE INSTALACAO",
      "ENTREGA E INSTALACAO",
    ],
  },
  {
    key: "pagamento",
    phrases: [
      "DO PAGAMENTO",
      "DO PRECO E FORMA DE PAGAMENTO",
      "PRECO E FORMA DE PAGAMENTO",
      "FORMA DE PAGAMENTO",
    ],
  },
  {
    key: "obrigacoes_cliente",
    phrases: [
      "DAS OBRIGACOES DO A CONTRATANTE",
      "DAS OBRIGACOES DO CONTRATANTE",
      "OBRIGACOES DO CLIENTE",
    ],
  },
  {
    key: "obrigacoes_loja",
    phrases: [
      "DAS OBRIGACOES DA CONTRATADA",
      "OBRIGACOES DA CONTRATADA",
      "OBRIGACOES DA LOJA",
    ],
  },
  {
    key: "garantia",
    phrases: ["DA GARANTIA", "GARANTIA DO PRODUTO", "GARANTIA", "SEGURANCA"],
  },
  {
    key: "rescisao",
    phrases: [
      "DA RESCISAO CONTRATUAL",
      "RESCISAO CONTRATUAL",
      "DA DESISTENCIA",
      "DESISTENCIA",
      "MULTA",
    ],
  },
  { key: "foro", phrases: ["DO FORO COMPETENTE", "DO FORO", "FORO COMPETENTE"] },
  {
    key: "imagem",
    phrases: [
      "TERMO DE USO DE IMAGEM",
      "USO DE IMAGEM",
      "AUTORIZACAO DE USO DE IMAGEM",
    ],
  },
];

function findPhraseInDenseText(index: DenseSearchIndex, phrases: string[]) {
  for (const phrase of phrases) {
    const normalizedPhrase = normalizeDenseToken(phrase);
    if (!normalizedPhrase) continue;

    const denseIndex = index.denseText.indexOf(normalizedPhrase);
    if (denseIndex < 0) continue;

    const startOriginal = index.denseToOriginalIndexes[denseIndex] ?? 0;
    const endDenseIndex = denseIndex + normalizedPhrase.length - 1;
    const endOriginal =
      (index.denseToOriginalIndexes[endDenseIndex] ?? startOriginal) + 1;

    return {
      denseIndex,
      startOriginal,
      endOriginal,
      normalizedPhrase,
    };
  }

  return null;
}

function collectSectionAnchors(originalText: string, searchIndex: DenseSearchIndex) {
  const anchors: Array<{
    key: string;
    startOriginal: number;
    endOriginal: number;
  }> = [];

  for (const marker of SECTION_MARKERS) {
    const found = findPhraseInDenseText(searchIndex, marker.phrases);
    if (!found) continue;

    anchors.push({
      key: marker.key,
      startOriginal: found.startOriginal,
      endOriginal: found.endOriginal,
    });
  }

  anchors.sort((a, b) => a.startOriginal - b.startOriginal);
  return anchors;
}

function getSectionText(
  originalText: string,
  anchors: ReturnType<typeof collectSectionAnchors>,
  sectionKeys: string[]
) {
  const anchor = anchors.find((item) => sectionKeys.includes(item.key));
  if (!anchor) return null;

  const nextAnchor = anchors.find((item) => item.startOriginal > anchor.startOriginal);
  const sectionText = cleanInlineText(
    originalText.slice(
      anchor.startOriginal,
      nextAnchor ? nextAnchor.startOriginal : originalText.length
    )
  );

  if (!sectionText) return null;
  return {
    sectionText,
    matchedByHeading: true,
  };
}

function getKeywordWindow(
  originalText: string,
  searchIndex: DenseSearchIndex,
  keywords: string[]
) {
  const found = findPhraseInDenseText(searchIndex, keywords);
  if (!found) return null;

  const start = Math.max(0, found.startOriginal - 220);
  const end = Math.min(originalText.length, found.endOriginal + 900);
  const excerpt = cleanInlineText(originalText.slice(start, end));
  if (!excerpt) return null;

  return {
    sectionText: excerpt,
    matchedByHeading: false,
  };
}

function buildRuleFromSource(args: {
  source: { sectionText: string; matchedByHeading: boolean } | null;
  ruleGroup: string;
  ruleKey: string;
  label: string;
  sortOrder: number;
  fallbackKeywords?: string[];
  originalText: string;
  searchIndex: DenseSearchIndex;
}) {
  const fallbackSource =
    args.source ||
    (args.fallbackKeywords?.length
      ? getKeywordWindow(args.originalText, args.searchIndex, args.fallbackKeywords)
      : null);

  if (!fallbackSource) return null;

  const valueText = limitText(fallbackSource.sectionText, 1600);
  if (!valueText) return null;

  return {
    ruleGroup: args.ruleGroup,
    ruleKey: args.ruleKey,
    label: args.label,
    valueText,
    sourceExcerpt: limitText(fallbackSource.sectionText, 700),
    confidence: fallbackSource.matchedByHeading ? 0.9 : 0.7,
    sortOrder: args.sortOrder,
  } satisfies ExtractedContractRuleDraft;
}

export function extractSuggestedContractRules(rawText: string) {
  const originalText = cleanInlineText(rawText);
  if (!originalText) return [] as ExtractedContractRuleDraft[];

  const searchIndex = buildDenseSearchIndex(originalText);
  const anchors = collectSectionAnchors(originalText, searchIndex);

  const drafts: Array<ExtractedContractRuleDraft | null> = [
    buildRuleFromSource({
      source:
        getSectionText(originalText, anchors, ["contratada"]) ||
        getSectionText(originalText, anchors, ["dados_partes"]),
      ruleGroup: "partes",
      ruleKey: "contratada",
      label: "Loja/contratada",
      sortOrder: 10,
      fallbackKeywords: ["CONTRATADA", "CNPJ", "ENDERECO"],
      originalText,
      searchIndex,
    }),
    buildRuleFromSource({
      source: getSectionText(originalText, anchors, ["objeto"]),
      ruleGroup: "objeto",
      ruleKey: "objeto_contrato",
      label: "Objeto do contrato",
      sortOrder: 20,
      fallbackKeywords: ["OBJETO", "PRESTACAO DE SERVICO"],
      originalText,
      searchIndex,
    }),
    buildRuleFromSource({
      source: getSectionText(originalText, anchors, ["pagamento"]),
      ruleGroup: "pagamento",
      ruleKey: "pagamento",
      label: "Preco e forma de pagamento",
      sortOrder: 30,
      fallbackKeywords: ["PAGAMENTO", "PARCELA", "VALOR", "PRECO"],
      originalText,
      searchIndex,
    }),
    buildRuleFromSource({
      source: getSectionText(originalText, anchors, ["instalacao"]),
      ruleGroup: "instalacao",
      ruleKey: "entrega_instalacao",
      label: "Entrega e instalacao",
      sortOrder: 40,
      fallbackKeywords: ["INSTALACAO", "ENTREGA", "SERVICOS CONTRATADOS", "NORMAS DE INSTALACAO"],
      originalText,
      searchIndex,
    }),
    buildRuleFromSource({
      source: getSectionText(originalText, anchors, ["obrigacoes_cliente"]),
      ruleGroup: "obrigacoes_cliente",
      ruleKey: "obrigacoes_cliente",
      label: "Obrigacoes do cliente",
      sortOrder: 50,
      fallbackKeywords: ["OBRIGACOES DO CONTRATANTE", "CONTRATANTE"],
      originalText,
      searchIndex,
    }),
    buildRuleFromSource({
      source: getSectionText(originalText, anchors, ["obrigacoes_loja"]),
      ruleGroup: "obrigacoes_loja",
      ruleKey: "obrigacoes_loja",
      label: "Obrigacoes da loja",
      sortOrder: 60,
      fallbackKeywords: ["OBRIGACOES DA CONTRATADA", "CONTRATADA"],
      originalText,
      searchIndex,
    }),
    buildRuleFromSource({
      source: getKeywordWindow(originalText, searchIndex, [
        "ACABAMENTO",
        "DECK",
        "CONTRAPISO",
      ]),
      ruleGroup: "instalacao",
      ruleKey: "acabamento_deck_contrapiso",
      label: "Acabamento, deck e contrapiso",
      sortOrder: 70,
      originalText,
      searchIndex,
    }),
    buildRuleFromSource({
      source: getSectionText(originalText, anchors, ["garantia"]),
      ruleGroup: "garantia",
      ruleKey: "garantia",
      label: "Garantia",
      sortOrder: 80,
      fallbackKeywords: ["GARANTIA", "SEGURANCA"],
      originalText,
      searchIndex,
    }),
    buildRuleFromSource({
      source: getSectionText(originalText, anchors, ["rescisao"]),
      ruleGroup: "rescisao",
      ruleKey: "rescisao_multa",
      label: "Rescisao, desistencia e multa",
      sortOrder: 90,
      fallbackKeywords: ["RESCISAO", "DESISTENCIA", "MULTA"],
      originalText,
      searchIndex,
    }),
    buildRuleFromSource({
      source: getSectionText(originalText, anchors, ["foro"]),
      ruleGroup: "foro",
      ruleKey: "foro",
      label: "Foro",
      sortOrder: 100,
      fallbackKeywords: ["FORO COMPETENTE", "FORO"],
      originalText,
      searchIndex,
    }),
    buildRuleFromSource({
      source: getSectionText(originalText, anchors, ["imagem"]),
      ruleGroup: "imagem",
      ruleKey: "autorizacao_imagem",
      label: "Uso de imagem",
      sortOrder: 110,
      fallbackKeywords: ["USO DE IMAGEM", "AUTORIZACAO DE USO DE IMAGEM"],
      originalText,
      searchIndex,
    }),
  ];

  const deduped = new Map<string, ExtractedContractRuleDraft>();

  for (const draft of drafts) {
    if (!draft) continue;
    if (!cleanInlineText(draft.valueText)) continue;
    if (deduped.has(draft.ruleKey)) continue;
    deduped.set(draft.ruleKey, draft);
  }

  return Array.from(deduped.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}

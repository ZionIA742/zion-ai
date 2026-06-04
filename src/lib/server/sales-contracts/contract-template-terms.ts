type StoreContractTemplateRow = {
  id: string;
  organization_id: string;
  store_id: string;
  status: string | null;
  active_version_id: string | null;
};

type StoreContractTemplateVersionRow = {
  id: string;
  template_id: string;
  organization_id: string;
  store_id: string;
  version_number: number | null;
  status: string | null;
};

type StoreContractTemplateExtractedRuleRow = {
  id: string;
  template_version_id: string;
  organization_id: string;
  store_id: string;
  rule_key: string;
  rule_group: string;
  label: string;
  value_text: string | null;
  review_status: string | null;
  sort_order: number | null;
};

export type ContractTemplateRuleUsed = {
  rule_id: string;
  rule_key: string;
  rule_group: string;
  label: string;
  value_text: string;
  review_status: "approved" | "edited";
  sort_order: number | null;
};

export type ContractTemplateTermsResolution = {
  contractTemplateUsed: boolean;
  templateId: string | null;
  templateVersionId: string | null;
  templateVersionNumber: number | null;
  generatedContractTerms: string | null;
  rulesUsed: ContractTemplateRuleUsed[];
  snapshotGeneratedAt: string;
  warning: string | null;
};

type SanitizeContractRuleTextOptions = {
  ruleGroup?: string | null;
  ruleKey?: string | null;
  label?: string | null;
};

type ContractTermsSectionDefinition = {
  id: string;
  title: string;
  matches: (rule: ContractTemplateRuleUsed) => boolean;
};

const CONTRACT_TERMS_SECTIONS: ContractTermsSectionDefinition[] = [
  {
    id: "partes",
    title: "PARTES",
    matches: (rule) => rule.rule_group === "partes",
  },
  {
    id: "objeto",
    title: "OBJETO DO CONTRATO",
    matches: (rule) => rule.rule_group === "objeto",
  },
  {
    id: "pagamento",
    title: "PRECO E FORMA DE PAGAMENTO",
    matches: (rule) => rule.rule_group === "pagamento",
  },
  {
    id: "instalacao",
    title: "ENTREGA E INSTALACAO",
    matches: (rule) =>
      rule.rule_group === "instalacao" && rule.rule_key !== "acabamento_deck_contrapiso",
  },
  {
    id: "obrigacoes_cliente",
    title: "OBRIGACOES DO CLIENTE",
    matches: (rule) => rule.rule_group === "obrigacoes_cliente",
  },
  {
    id: "obrigacoes_loja",
    title: "OBRIGACOES DA LOJA",
    matches: (rule) => rule.rule_group === "obrigacoes_loja",
  },
  {
    id: "acabamento",
    title: "ACABAMENTO, DECK E CONTRAPISO",
    matches: (rule) => rule.rule_key === "acabamento_deck_contrapiso",
  },
  {
    id: "garantia",
    title: "GARANTIA",
    matches: (rule) => rule.rule_group === "garantia",
  },
  {
    id: "rescisao",
    title: "RESCISAO, DESISTENCIA E MULTA",
    matches: (rule) => rule.rule_group === "rescisao",
  },
  {
    id: "imagem",
    title: "USO DE IMAGEM",
    matches: (rule) => rule.rule_group === "imagem",
  },
];

function cleanText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeReviewStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizeComparableText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyContactNoiseLine(line: string) {
  const normalized = normalizeComparableText(line);
  if (!normalized) return false;

  return (
    normalized.includes("cnpj") ||
    normalized.includes("instagram") ||
    normalized.includes("telefone") ||
    normalized.includes("telefones") ||
    normalized.includes("whatsapp") ||
    normalized.includes("endereco") ||
    normalized.includes("logradouro") ||
    normalized.includes("cep") ||
    /\b(av|avenida|rua|rodovia|estrada|alameda|travessa)\b/.test(normalized) ||
    normalized.includes("www.") ||
    normalized.includes(".com") ||
    normalized.includes("@")
  );
}

function isLikelyRepeatedHeaderFooterLine(line: string) {
  const normalized = normalizeComparableText(line);
  if (!normalized) return false;

  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line.trim())) {
    return true;
  }

  if (isLikelyContactNoiseLine(line)) {
    return true;
  }

  return /^[a-z0-9 .:/-]{6,90}$/i.test(normalized) && !/[.;:!?]$/.test(normalized);
}

function isLegacyContractFieldLine(line: string) {
  const normalized = normalizeComparableText(line);
  if (!normalized) return false;

  const legacyPrefixes = [
    "local da instalacao",
    "data de pedido",
    "data prevista para instalacao",
    "modelo",
    "cor",
    "medida",
    "valor total",
    "entrada a vista",
    "saldo remanescente",
  ];

  return legacyPrefixes.some((prefix) => normalized.startsWith(prefix));
}

function isStandaloneNumberingNoise(line: string) {
  const trimmed = String(line || "").trim();
  return /^(\d+\.?|\(?\d+\))$/.test(trimmed);
}

function isLegacySignatureLine(line: string) {
  const normalized = normalizeComparableText(line).replace(/[:.-]+$/g, "").trim();
  if (!normalized) return false;

  return (
    normalized === "contratado" ||
    normalized === "contratante" ||
    normalized === "cpf" ||
    normalized === "testemunha 1" ||
    normalized === "testemunha 2" ||
    normalized === "testemunha"
  );
}

function isLegacyVariableOptionLine(line: string) {
  const normalized = normalizeComparableText(line);
  if (!normalized) return false;

  if (/^\((x|\s|\d+)\)/i.test(String(line || "").trim())) {
    return true;
  }

  return (
    normalized.startsWith("servicos contratados") ||
    normalized.startsWith("informacoes adicionais") ||
    normalized.startsWith("preco") ||
    normalized.includes("escavacao") ||
    normalized.includes("blindagem") ||
    normalized.includes("mao de obra de instalacao") ||
    normalized.includes("casa de maquinas") ||
    normalized.includes("motor e filtro") ||
    normalized.includes("led azul") ||
    normalized.includes("led rgb") ||
    normalized.includes("hidromassagem") ||
    normalized.includes("cascata")
  );
}

function isLegacyHeaderFooterLine(line: string, context: SanitizeContractRuleTextOptions) {
  const normalized = normalizeComparableText(line);
  if (!normalized) return false;

  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(String(line || "").trim())) {
    return true;
  }

  if (
    /\b[a-z]+\/[a-z]{2},\s*\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4}\b/i.test(
      String(line || "").trim()
    )
  ) {
    return true;
  }

  const isPartesRule =
    context.ruleGroup === "partes" ||
    context.ruleKey === "contratada" ||
    normalizeComparableText(context.label).includes("contratada");

  if (!isPartesRule && isLikelyContactNoiseLine(line)) {
    return true;
  }

  return isLikelyRepeatedHeaderFooterLine(line);
}

function isLegacyVariableLine(line: string, context: SanitizeContractRuleTextOptions) {
  const normalized = normalizeComparableText(line).replace(/[:.-]+$/g, "").trim();
  if (!normalized) return false;

  const ruleGroup = normalizeComparableText(context.ruleGroup);
  const ruleKey = normalizeComparableText(context.ruleKey);
  const isPartesRule = ruleGroup === "partes" || ruleKey === "contratada";
  const isObjetoRule = ruleKey === "objeto_contrato" || ruleGroup === "objeto";
  const isPagamentoRule = ruleKey === "pagamento" || ruleGroup === "pagamento";
  const isImagemRule = ruleGroup === "imagem";
  const isRescisaoRule = ruleGroup === "rescisao";

  if (isPartesRule) {
    return isStandaloneNumberingNoise(line);
  }

  if (isLegacySignatureLine(line)) {
    return true;
  }

  if (isLegacyHeaderFooterLine(line, context)) {
    return true;
  }

  if (isLegacyVariableOptionLine(line)) {
    return true;
  }

  if (normalized === "i pedido" || normalized === "pedido") {
    return true;
  }

  if (isLegacyContractFieldLine(line)) {
    if (isPagamentoRule) {
      return (
        normalized.startsWith("valor total") ||
        normalized.startsWith("entrada a vista") ||
        normalized.startsWith("saldo remanescente") ||
        normalized.startsWith("data de pedido") ||
        normalized.startsWith("data prevista para instalacao")
      );
    }

    if (isObjetoRule) {
      return true;
    }

    return true;
  }

  if (normalized.startsWith("pastilha")) {
    return isObjetoRule;
  }

  if (normalized.startsWith("servicos contratados")) {
    return isObjetoRule;
  }

  if (normalized.startsWith("informacoes adicionais")) {
    return isObjetoRule || isPagamentoRule;
  }

  if (normalized === "preco") {
    return isObjetoRule || isPagamentoRule;
  }

  if (
    /\b[a-z]+\/[a-z]{2},\s*\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4}\b/i.test(
      String(line || "").trim()
    )
  ) {
    return isImagemRule || isRescisaoRule || isObjetoRule;
  }

  return false;
}

function isResidualNoiseLine(line: string, context: SanitizeContractRuleTextOptions) {
  const rawLine = String(line || "").trim();
  const normalized = normalizeComparableText(rawLine).replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  const protectedFragments = [
    "contratante ",
    "contratada ",
    "pagamento",
    "saldo remanescente",
    "multa",
    "garantia",
    "instalacao",
    "obrigacao",
    "paragrafo",
  ];

  if (protectedFragments.some((fragment) => normalized.includes(fragment))) {
    return false;
  }

  const exactResiduals = new Set([
    "contrato.",
    "meses podera ocorrer reajuste.",
    "outro:",
    "testemunha 1: testemunha 2:",
    "cpf: cpf:",
    "cpf:",
    "contratante:",
    "contratado:",
  ]);

  if (exactResiduals.has(normalized)) {
    return true;
  }

  if (/^vi+\.\s*/i.test(rawLine) && normalized.length <= 18) {
    return true;
  }

  if (/\.\.\.$/.test(rawLine) && normalized.length <= 24) {
    return true;
  }

  const isPartesRule =
    context.ruleGroup === "partes" ||
    context.ruleKey === "contratada" ||
    normalizeComparableText(context.label).includes("contratada");

  if (!isPartesRule && isStandaloneNumberingNoise(rawLine)) {
    return true;
  }

  return false;
}

function mergeSafeBrokenWords(text: string) {
  return text
    .replace(/\bpis\s+cina(s?)\b/gi, "piscina$1")
    .replace(/\bcontra\s+piso\b/gi, "contrapiso")
    .replace(/\binsta\s+lacao\b/gi, "instalacao");
}

function removeTrailingResidualFragments(line: string, context: SanitizeContractRuleTextOptions) {
  let nextLine = String(line || "");
  const ruleGroup = normalizeComparableText(context.ruleGroup);
  const ruleKey = normalizeComparableText(context.ruleKey);

  if (ruleGroup === "partes" || ruleKey === "contratada") {
    nextLine = nextLine.replace(/(?:^|\s)1\.\s*$/i, "").trim();
  }

  nextLine = nextLine.replace(/\s*,?\s*que consta abaixo:\s*$/i, "").trim();
  return nextLine;
}

function dedupeNormalizedParagraphs(paragraphs: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const paragraph of paragraphs) {
    const normalized = normalizeComparableText(paragraph);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(paragraph);
  }

  return result;
}

export function sanitizeContractRuleText(
  valueText: string,
  options: SanitizeContractRuleTextOptions = {}
) {
  const preserveContactDetails =
    options.ruleGroup === "partes" ||
    options.ruleKey === "contratada" ||
    normalizeComparableText(options.label).includes("contratada");

  let text = String(valueText || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gim, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ");

  text = mergeSafeBrokenWords(text);

  const sourceLines = text.split("\n");
  const normalizedLineCounts = new Map<string, number>();

  for (const sourceLine of sourceLines) {
    const normalized = normalizeComparableText(sourceLine);
    if (!normalized) continue;
    normalizedLineCounts.set(normalized, (normalizedLineCounts.get(normalized) || 0) + 1);
  }

  const cleanedLines: string[] = [];
  const keptRepeatedLines = new Set<string>();
  let previousNormalizedLine = "";

  for (const sourceLine of sourceLines) {
    const collapsedLine = removeTrailingResidualFragments(
      mergeSafeBrokenWords(
      String(sourceLine || "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]{2,}/g, " ")
        .trim()
      ),
      options
    );
    const normalizedLine = normalizeComparableText(collapsedLine);

    if (!normalizedLine) {
      if (cleanedLines[cleanedLines.length - 1] !== "") {
        cleanedLines.push("");
      }
      previousNormalizedLine = "";
      continue;
    }

    const repeatedCount = normalizedLineCounts.get(normalizedLine) || 0;
    const isRepeatedNoise =
      repeatedCount > 1 && isLikelyRepeatedHeaderFooterLine(collapsedLine);
    const removeAsLegacyNoise =
      !preserveContactDetails &&
      (isLegacyVariableLine(collapsedLine, options) ||
        isResidualNoiseLine(collapsedLine, options) ||
        isStandaloneNumberingNoise(collapsedLine));

    if (isRepeatedNoise) {
      if (preserveContactDetails) {
        if (keptRepeatedLines.has(normalizedLine)) {
          continue;
        }
        keptRepeatedLines.add(normalizedLine);
      } else {
        continue;
      }
    }

    if (removeAsLegacyNoise) {
      continue;
    }

    if (normalizedLine === previousNormalizedLine) {
      continue;
    }

    cleanedLines.push(collapsedLine);
    previousNormalizedLine = normalizedLine;
  }

  const paragraphs = cleanedLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n")
        .trim()
    )
    .filter(Boolean);

  const cleanedParagraphs = dedupeNormalizedParagraphs(paragraphs);
  return cleanText(cleanedParagraphs.join("\n\n")) || "";
}

function formatRuleEntry(rule: ContractTemplateRuleUsed) {
  const label = cleanText(rule.label);
  const valueText = cleanText(rule.value_text);

  if (!valueText) {
    return null;
  }

  if (!label) {
    return valueText;
  }

  const normalizedLabel = normalizeComparableText(label);
  const normalizedValue = normalizeComparableText(valueText);

  if (normalizedValue.startsWith(normalizedLabel)) {
    return valueText;
  }

  return `${label}:\n${valueText}`;
}

export function formatContractRulesIntoSections(rulesUsed: ContractTemplateRuleUsed[]) {
  const sortedRules = [...rulesUsed].sort((a, b) => {
    const aOrder = Number.isFinite(a.sort_order) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isFinite(b.sort_order) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });

  const consumedRuleIds = new Set<string>();
  const sections: string[] = [];
  let sectionNumber = 1;

  for (const section of CONTRACT_TERMS_SECTIONS) {
    const rules = sortedRules.filter((rule) => section.matches(rule));
    if (rules.length === 0) continue;

    rules.forEach((rule) => consumedRuleIds.add(rule.rule_id));
    const entries = rules
      .map((rule) => formatRuleEntry(rule))
      .filter((entry): entry is string => Boolean(entry));

    if (entries.length === 0) continue;
    sections.push(`${sectionNumber}. ${section.title}\n\n${entries.join("\n\n")}`);
    sectionNumber += 1;
  }

  const remainingRules = sortedRules.filter((rule) => !consumedRuleIds.has(rule.rule_id));
  if (remainingRules.length > 0) {
    const entries = remainingRules
      .map((rule) => formatRuleEntry(rule))
      .filter((entry): entry is string => Boolean(entry));

    if (entries.length > 0) {
      sections.push(`${sectionNumber}. OUTRAS CONDICOES\n\n${entries.join("\n\n")}`);
    }
  }

  return cleanText(sections.join("\n\n")) || null;
}

export async function resolveContractTemplateTerms(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
}) {
  const snapshotGeneratedAt = new Date().toISOString();

  try {
    const { data: templateData, error: templateError } = await args.supabase
      .from("store_contract_templates")
      .select("id, organization_id, store_id, status, active_version_id")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .maybeSingle();

    if (templateError) {
      throw new Error(`Falha ao carregar store_contract_templates: ${templateError.message}`);
    }

    const template = (templateData ?? null) as StoreContractTemplateRow | null;
    const activeVersionId = cleanText(template?.active_version_id);

    if (!template?.id || !activeVersionId) {
      return {
        contractTemplateUsed: false,
        templateId: template?.id || null,
        templateVersionId: activeVersionId,
        templateVersionNumber: null,
        generatedContractTerms: null,
        rulesUsed: [],
        snapshotGeneratedAt,
        warning: null,
      } satisfies ContractTemplateTermsResolution;
    }

    const { data: versionData, error: versionError } = await args.supabase
      .from("store_contract_template_versions")
      .select("id, template_id, organization_id, store_id, version_number, status")
      .eq("id", activeVersionId)
      .eq("template_id", template.id)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .maybeSingle();

    if (versionError) {
      throw new Error(
        `Falha ao carregar store_contract_template_versions: ${versionError.message}`
      );
    }

    const version = (versionData ?? null) as StoreContractTemplateVersionRow | null;
    if (!version?.id) {
      return {
        contractTemplateUsed: false,
        templateId: template.id,
        templateVersionId: activeVersionId,
        templateVersionNumber: null,
        generatedContractTerms: null,
        rulesUsed: [],
        snapshotGeneratedAt,
        warning:
          "Template ativo ignorado por inconsistencia entre loja, template e versao ativa.",
      } satisfies ContractTemplateTermsResolution;
    }

    const { data: rulesData, error: rulesError } = await args.supabase
      .from("store_contract_template_extracted_rules")
      .select(
        "id, template_version_id, organization_id, store_id, rule_key, rule_group, label, value_text, review_status, sort_order"
      )
      .eq("template_version_id", version.id)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .in("review_status", ["approved", "edited"])
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (rulesError) {
      throw new Error(
        `Falha ao carregar store_contract_template_extracted_rules: ${rulesError.message}`
      );
    }

    const rulesUsed = ((rulesData ?? []) as StoreContractTemplateExtractedRuleRow[])
      .map((rule) => {
        const valueText = cleanText(rule.value_text);
        const reviewStatus = normalizeReviewStatus(rule.review_status);

        if (!valueText) {
          return null;
        }

        if (reviewStatus !== "approved" && reviewStatus !== "edited") {
          return null;
        }

        const sanitizedValueText = sanitizeContractRuleText(valueText, {
          ruleGroup: rule.rule_group,
          ruleKey: rule.rule_key,
          label: rule.label,
        });

        if (!sanitizedValueText) {
          return null;
        }

        return {
          rule_id: rule.id,
          rule_key: rule.rule_key,
          rule_group: rule.rule_group,
          label: rule.label,
          value_text: sanitizedValueText,
          review_status: reviewStatus,
          sort_order: rule.sort_order,
        } satisfies ContractTemplateRuleUsed;
      })
      .filter((rule): rule is ContractTemplateRuleUsed => Boolean(rule));

    const generatedContractTerms = formatContractRulesIntoSections(rulesUsed);

    if (!generatedContractTerms) {
      return {
        contractTemplateUsed: false,
        templateId: template.id,
        templateVersionId: version.id,
        templateVersionNumber: version.version_number,
        generatedContractTerms: null,
        rulesUsed: [],
        snapshotGeneratedAt,
        warning: null,
      } satisfies ContractTemplateTermsResolution;
    }

    return {
      contractTemplateUsed: true,
      templateId: template.id,
      templateVersionId: version.id,
      templateVersionNumber: version.version_number,
      generatedContractTerms,
      rulesUsed,
      snapshotGeneratedAt,
      warning: null,
    } satisfies ContractTemplateTermsResolution;
  } catch (error) {
    console.warn(
      "[sales-contracts/contract-template-terms] fallback para termos atuais do contrato:",
      error
    );

    return {
      contractTemplateUsed: false,
      templateId: null,
      templateVersionId: null,
      templateVersionNumber: null,
      generatedContractTerms: null,
      rulesUsed: [],
      snapshotGeneratedAt,
      warning: error instanceof Error ? error.message : "Falha ao resolver template ativo.",
    } satisfies ContractTemplateTermsResolution;
  }
}

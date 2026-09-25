import { evaluateContractWorkflowDecision } from "@/lib/server/sales-contracts/contract-workflow-decision";
import { resolveAuthorizedExistingQuote } from "@/lib/server/sales-quotes/quote-auth";

type AssistantRecentMessage = {
  id?: string | null;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
};

type HandleAssistantContractGenerationArgs = {
  request: Request;
  supabase: any;
  organizationId: string;
  storeId: string;
  recentMessages: AssistantRecentMessage[];
  lastHumanMessage: string;
  executeAssistantContractGeneration?: typeof executeAssistantContractGeneration;
};

type HandleAssistantContractGenerationResult =
  | {
      handled: false;
    }
  | {
      handled: true;
      reply: string;
      metadata?: Record<string, unknown>;
    };

export type ExecuteAssistantContractGenerationArgs = {
  request: Request;
  supabase: any;
  organizationId: string;
  storeId: string;
  quoteId: string;
  quoteVersionId?: string | null;
  quoteNumber?: string | null;
  source?: string | null;
  callInternalJson?: typeof callInternalJson;
  evaluateContractWorkflowDecision?: typeof evaluateContractWorkflowDecision;
  resolveAuthorizedExistingQuote?: typeof resolveAuthorizedExistingQuote;
};

export type ExecuteAssistantContractGenerationResult = {
  ok: boolean;
  status: number;
  reply: string;
  metadata: Record<string, unknown>;
  quoteId?: string | null;
  quoteVersionId?: string | null;
  contractId?: string | null;
};

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function looksLikeContractGenerationIntent(messageText: string) {
  const text = normalizeText(messageText);
  if (!text) return false;

  const asksToGenerate = /(gere|gerar|gera|crie|criar|pode gerar)/i.test(text);
  const mentionsContract = /\bcontrato\b/i.test(text);
  const mentionsQuote = /\borcamento\b/i.test(text);

  return asksToGenerate && mentionsContract && mentionsQuote;
}

function extractExplicitQuoteNumber(messageText: string) {
  const directMatch = String(messageText || "").match(/\b([A-Za-z]{2,6})[-\s]?(\d{1,12})\b/);
  if (!directMatch) return null;

  const prefix = String(directMatch[1] || "").trim().toUpperCase();
  const digits = String(directMatch[2] || "").trim();

  if (!prefix || !digits) return null;

  const compact = `${prefix}${digits}`;
  const hyphenated = `${prefix}-${digits}`;

  return {
    raw: String(directMatch[0] || "").trim(),
    compact,
    hyphenated,
    prefix,
    digits,
  };
}

function getQuoteDocumentReviewMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (!isRecord(metadata)) return null;
  if (cleanText(metadata.kind) !== "document_review") return null;
  if (normalizeText(metadata.document_type) !== "quote") return null;
  return metadata;
}

function resolveRecentQuoteContext(messages: AssistantRecentMessage[]) {
  const candidates = messages
    .map((message) => getQuoteDocumentReviewMetadata(message.metadata || null))
    .filter(Boolean)
    .map((metadata) => ({
      quoteId: cleanText(metadata?.document_id),
      quoteNumber: cleanText(metadata?.document_number),
    }))
    .filter((item) => item.quoteId);

  const uniqueById = Array.from(
    new Map(
      candidates.map((item) => [
        item.quoteId as string,
        {
          quoteId: item.quoteId as string,
          quoteNumber: item.quoteNumber || null,
        },
      ])
    ).values()
  );

  if (uniqueById.length !== 1) {
    return {
      kind: "ambiguous" as const,
      candidates: uniqueById,
    };
  }

  return {
    kind: "selected" as const,
    candidate: uniqueById[0],
  };
}

function buildContractGenerationFailClosedResult(args: {
  reasonCode: string;
  reply: string;
  quoteId?: string | null;
  quoteNumber?: string | null;
  commercialOpportunityId?: string | null;
  quoteVersionId?: string | null;
  extraMetadata?: Record<string, unknown>;
}): Extract<HandleAssistantContractGenerationResult, { handled: true }> {
  return {
    handled: true,
    reply: args.reply,
    metadata: {
      source: "assistant_contract_generation_workflow_v1",
      contractGenerationHandled: true,
      reasonCode: args.reasonCode,
      quoteId: cleanText(args.quoteId),
      quoteNumber: cleanText(args.quoteNumber),
      commercialOpportunityId: cleanText(args.commercialOpportunityId),
      quoteVersionId: cleanText(args.quoteVersionId),
      trigger: "human_explicit_request",
      ...(args.extraMetadata || {}),
    },
  };
}

async function loadContractGenerationQuoteReference(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  quoteId: string;
}) {
  const { data, error } = await args.supabase
    .from("sales_quotes")
    .select("id, quote_number, commercial_opportunity_id")
    .eq("id", args.quoteId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar orcamento para contrato: ${error.message}`);
  }

  const quoteId = cleanText(data?.id);
  if (!quoteId) {
    return null;
  }

  return {
    id: quoteId,
    quoteNumber: cleanText(data?.quote_number),
    commercialOpportunityId: cleanText(data?.commercial_opportunity_id),
  };
}

function normalizeCurrentCommercialProposalRows(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (isRecord(value)) {
    return [value];
  }

  return [];
}

async function resolveCurrentProposalQuoteVersionForTextContract(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  quoteId: string;
  quoteNumber?: string | null;
}) {
  const quoteReference = await loadContractGenerationQuoteReference({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    quoteId: args.quoteId,
  });

  if (!quoteReference) {
    return {
      ok: false as const,
      result: buildContractGenerationFailClosedResult({
        reasonCode: "QUOTE_NOT_FOUND",
        reply: "Nao encontrei esse orcamento. Confira o numero e tente novamente.",
        quoteId: args.quoteId,
        quoteNumber: args.quoteNumber,
      }),
    };
  }

  const quoteNumber = quoteReference.quoteNumber || cleanText(args.quoteNumber);
  const commercialOpportunityId = quoteReference.commercialOpportunityId;

  if (!commercialOpportunityId) {
    return {
      ok: false as const,
      result: buildContractGenerationFailClosedResult({
        reasonCode: "QUOTE_COMMERCIAL_OPPORTUNITY_REQUIRED_FOR_CONTRACT",
        reply:
          "Esse orcamento ainda nao tem uma oportunidade comercial vinculada para gerar contrato com seguranca.",
        quoteId: quoteReference.id,
        quoteNumber,
      }),
    };
  }

  const { data, error } = await args.supabase.rpc(
    "read_current_commercial_proposal_by_system",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: commercialOpportunityId,
    }
  );

  if (error) {
    throw new Error(`Falha ao carregar proposta comercial atual: ${error.message}`);
  }

  const proposalRows = normalizeCurrentCommercialProposalRows(data);
  const currentProposal = proposalRows.length === 1 ? proposalRows[0] : null;
  const proposalQuoteVersionId = cleanText(currentProposal?.current_quote_version_id);

  if (
    !currentProposal ||
    cleanText(currentProposal.organization_id) !== args.organizationId ||
    cleanText(currentProposal.store_id) !== args.storeId ||
    cleanText(currentProposal.commercial_opportunity_id) !== commercialOpportunityId ||
    cleanText(currentProposal.proposal_state) !== "available" ||
    !cleanText(currentProposal.current_quote_id) ||
    !proposalQuoteVersionId
  ) {
    return {
      ok: false as const,
      result: buildContractGenerationFailClosedResult({
        reasonCode: !proposalQuoteVersionId
          ? "CURRENT_COMMERCIAL_PROPOSAL_QUOTE_VERSION_REQUIRED"
          : "CURRENT_COMMERCIAL_PROPOSAL_UNAVAILABLE",
        reply:
          "Nao encontrei uma proposta comercial vigente para gerar contrato com seguranca.",
        quoteId: quoteReference.id,
        quoteNumber,
        commercialOpportunityId,
        quoteVersionId: proposalQuoteVersionId,
      }),
    };
  }

  if (cleanText(currentProposal.current_quote_id) !== quoteReference.id) {
    return {
      ok: false as const,
      result: buildContractGenerationFailClosedResult({
        reasonCode: "QUOTE_IS_NOT_CURRENT_COMMERCIAL_PROPOSAL",
        reply:
          "Esse orcamento nao e a proposta comercial vigente. Revise a proposta atual antes de gerar contrato.",
        quoteId: quoteReference.id,
        quoteNumber,
        commercialOpportunityId,
        quoteVersionId: proposalQuoteVersionId,
      }),
    };
  }

  return {
    ok: true as const,
    quoteId: quoteReference.id,
    quoteNumber,
    commercialOpportunityId,
    quoteVersionId: proposalQuoteVersionId,
  };
}

async function callInternalJson(
  request: Request,
  path: string,
  init?: RequestInit
): Promise<{
  ok: boolean;
  status: number;
  body: any;
}> {
  const url = new URL(path, request.url);
  const headers = new Headers(init?.headers || {});
  const cookieHeader = request.headers.get("cookie");

  if (cookieHeader && !headers.has("cookie")) {
    headers.set("cookie", cookieHeader);
  }

  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });

  const body = await response.json().catch(() => null);

  return {
    ok: response.ok && Boolean(body?.ok ?? true),
    status: response.status,
    body,
  };
}

async function resolveQuoteIdFromExplicitNumber(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  quoteNumber: NonNullable<ReturnType<typeof extractExplicitQuoteNumber>>;
}) {
  const normalizedCandidates = Array.from(
    new Set([
      cleanText(args.quoteNumber.raw),
      cleanText(args.quoteNumber.hyphenated),
      cleanText(args.quoteNumber.compact),
    ]).values()
  ).filter(Boolean) as string[];

  for (const candidate of normalizedCandidates) {
    const { data, error } = await args.supabase
      .from("sales_quotes")
      .select("id, quote_number")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("quote_number", candidate)
      .maybeSingle();

    if (error) {
      throw new Error(`Falha ao buscar orcamento por numero: ${error.message}`);
    }

    const quoteId = cleanText(data?.id);
    if (quoteId) {
      return {
        quoteId,
        quoteNumber: cleanText(data?.quote_number) || candidate,
      };
    }
  }

  return null;
}

async function loadExistingContractsForQuote(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  quoteId: string;
}) {
  const { data, error } = await args.supabase
    .from("sales_contracts")
    .select("id, status")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("quote_id", args.quoteId);

  if (error) {
    throw new Error(`Falha ao carregar contratos do orcamento: ${error.message}`);
  }

  return (data || []) as Array<{ id?: string | null; status?: string | null }>;
}

function buildDecisionReply(reasonCode: string) {
  if (reasonCode === "QUOTE_NOT_FOUND") {
    return "Nao encontrei esse orcamento. Confira o numero e tente novamente.";
  }

  if (reasonCode === "QUOTE_HAS_NO_CURRENT_VERSION") {
    return "Esse orcamento ainda nao tem uma versao atual pronta para contrato.";
  }

  if (reasonCode === "QUOTE_NOT_READY_FOR_CONTRACT") {
    return "Esse orcamento ainda precisa estar aprovado ou enviado antes de gerar contrato.";
  }

  if (reasonCode === "CONTRACT_ALREADY_COMPLETED") {
    return "Esse orcamento ja tem um contrato concluido. Se precisar de outro contrato, revise manualmente antes.";
  }

  if (reasonCode === "CONTRACT_ALREADY_PENDING_REVIEW") {
    return "Ja existe um contrato em revisao para esse orcamento. Revise o contrato existente antes de criar outro.";
  }

  if (reasonCode === "CONTRACT_ALREADY_IN_PROGRESS") {
    return "Ja existe um contrato em andamento para esse orcamento.";
  }

  if (reasonCode === "QUOTE_DATA_INCOMPLETE") {
    return "Esse orcamento ainda nao tem todos os dados minimos necessarios para iniciar o contrato com seguranca.";
  }

  if (reasonCode === "TECHNICAL_VISIT_REQUIRED_BEFORE_CONTRACT") {
    return "Essa loja exige visita tecnica concluida antes de iniciar o contrato.";
  }

  return "Nao foi seguro iniciar o contrato agora. Revise o orcamento e tente novamente.";
}

export async function executeAssistantContractGeneration(
  args: ExecuteAssistantContractGenerationArgs
): Promise<ExecuteAssistantContractGenerationResult> {
  const source =
    cleanText(args.source) || "assistant_contract_generation_workflow_v1";
  const quoteVersionId = cleanText(args.quoteVersionId);

  try {
    if (!quoteVersionId) {
      return {
        ok: false,
        status: 409,
        reply: "Nao encontrei a versao exata desse orcamento para gerar contrato com seguranca.",
        metadata: {
          source,
          contractGenerationHandled: true,
          quoteId: cleanText(args.quoteId),
          quoteVersionId: null,
          reasonCode: "QUOTE_VERSION_REFERENCE_REQUIRED",
          trigger: "human_explicit_request",
        },
        quoteId: cleanText(args.quoteId),
      };
    }

    const resolveQuote =
      args.resolveAuthorizedExistingQuote ?? resolveAuthorizedExistingQuote;
    const evaluateDecision =
      args.evaluateContractWorkflowDecision ?? evaluateContractWorkflowDecision;
    const callJson = args.callInternalJson ?? callInternalJson;

    const quoteScope = await resolveQuote(args.quoteId);

    if (
      quoteScope.organizationId !== args.organizationId ||
      quoteScope.store.id !== args.storeId
    ) {
      return {
        ok: false,
        status: 403,
        reply: "Nao encontrei esse orcamento no escopo da loja atual.",
        metadata: {
          source,
          contractGenerationHandled: true,
          reasonCode: "QUOTE_SCOPE_MISMATCH",
          quoteId: args.quoteId,
          quoteVersionId,
          trigger: "human_explicit_request",
        },
        quoteId: args.quoteId,
      };
    }

    const existingContracts = await loadExistingContractsForQuote({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      quoteId: quoteScope.quote.id,
    });

    const decision = evaluateDecision({
      quote: {
        id: quoteScope.quote.id,
        status: quoteScope.quote.status,
        lead_id: quoteScope.quote.lead_id,
        conversation_id: quoteScope.quote.conversation_id,
        store_id: quoteScope.quote.store_id,
        organization_id: quoteScope.quote.organization_id,
        total_cents: quoteScope.quote.total_cents,
        current_version_id: quoteVersionId,
      },
      trigger: "human_explicit_request",
      hasHumanConfirmation: true,
      existingContracts,
    });

    if (!decision.allowed) {
      return {
        ok: false,
        status:
          decision.reasonCode === "QUOTE_NOT_FOUND"
            ? 404
            : decision.reasonCode === "QUOTE_SCOPE_MISMATCH"
              ? 403
              : 409,
        reply: buildDecisionReply(decision.reasonCode),
        metadata: {
          source,
          contractGenerationHandled: true,
          quoteId: quoteScope.quote.id,
          quoteVersionId,
          quoteNumber:
            cleanText(quoteScope.quote.quote_number) || cleanText(args.quoteNumber),
          reasonCode: decision.reasonCode,
          missingRequirements: decision.missingRequirements,
          warnings: decision.warnings,
          recommendedNextAction: decision.recommendedNextAction,
          trigger: "human_explicit_request",
        },
        quoteId: quoteScope.quote.id,
      };
    }

    const createContractResult = await callJson(
      args.request,
      "/api/sales-contracts/create-from-quote",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quoteId: quoteScope.quote.id,
          quoteVersionId,
        }),
      }
    );

    if (!createContractResult.ok || !createContractResult.body?.contract?.id) {
      return {
        ok: false,
        status: createContractResult.status || 500,
        reply:
          createContractResult.body?.message ||
          "Nao consegui gerar o contrato agora. Tente novamente em instantes.",
        metadata: {
          source,
          contractGenerationHandled: true,
          quoteId: quoteScope.quote.id,
          quoteVersionId,
          quoteNumber:
            cleanText(quoteScope.quote.quote_number) || cleanText(args.quoteNumber),
          reasonCode:
            cleanText(createContractResult.body?.error) || "CONTRACT_CREATE_FAILED",
          trigger: "human_explicit_request",
        },
        quoteId: quoteScope.quote.id,
      };
    }

    const contractId = cleanText(createContractResult.body?.contract?.id);
    if (!contractId) {
      return {
        ok: false,
        status: 500,
        reply: "Nao consegui gerar o contrato agora. Tente novamente em instantes.",
        metadata: {
          source,
          contractGenerationHandled: true,
          quoteId: quoteScope.quote.id,
          quoteVersionId,
          quoteNumber:
            cleanText(quoteScope.quote.quote_number) || cleanText(args.quoteNumber),
          reasonCode: "CONTRACT_ID_MISSING_AFTER_CREATE",
          trigger: "human_explicit_request",
        },
        quoteId: quoteScope.quote.id,
        quoteVersionId,
      };
    }

    const generatePdfResult = await callJson(
      args.request,
      `/api/sales-contracts/${encodeURIComponent(contractId)}/generate-pdf`,
      {
        method: "POST",
      }
    );

    if (!generatePdfResult.ok) {
      return {
        ok: false,
        status: generatePdfResult.status || 500,
        reply: "Nao consegui gerar o contrato agora. Tente novamente em instantes.",
        metadata: {
          source,
          contractGenerationHandled: true,
          quoteId: quoteScope.quote.id,
          quoteVersionId,
          contractId,
          quoteNumber:
            cleanText(quoteScope.quote.quote_number) || cleanText(args.quoteNumber),
          reasonCode:
            cleanText(generatePdfResult.body?.error) || "CONTRACT_PDF_GENERATION_FAILED",
          trigger: "human_explicit_request",
        },
        quoteId: quoteScope.quote.id,
        quoteVersionId,
        contractId,
      };
    }

    return {
      ok: true,
      status: 200,
      reply:
        "Contrato gerado para revisao. Confira o documento antes de aprovar ou enviar ao cliente.",
      metadata: {
        source,
        contractGenerationHandled: true,
        quoteId: quoteScope.quote.id,
        quoteVersionId,
        contractId,
        quoteNumber:
          cleanText(quoteScope.quote.quote_number) || cleanText(args.quoteNumber),
        reasonCode: "HUMAN_EXPLICIT_REQUEST_ALLOWED",
        trigger: "human_explicit_request",
        generatedPdf: true,
      },
      quoteId: quoteScope.quote.id,
      quoteVersionId,
      contractId,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nao consegui gerar o contrato agora. Tente novamente em instantes.";

    return {
      ok: false,
      status: 500,
      reply:
        message === "Orcamento nao encontrado."
          ? "Nao encontrei esse orcamento. Confira o numero e tente novamente."
          : message,
      metadata: {
        source,
        contractGenerationHandled: true,
        reasonCode: "ASSISTANT_CONTRACT_GENERATION_FAILED",
        quoteVersionId: quoteVersionId || null,
        trigger: "human_explicit_request",
      },
      quoteId: cleanText(args.quoteId),
      quoteVersionId: quoteVersionId || null,
    };
  }
}

export async function handleAssistantContractGenerationRequest(
  args: HandleAssistantContractGenerationArgs
): Promise<HandleAssistantContractGenerationResult> {
  if (!looksLikeContractGenerationIntent(args.lastHumanMessage)) {
    return { handled: false };
  }

  try {
    const explicitQuoteNumber = extractExplicitQuoteNumber(args.lastHumanMessage);
    let resolvedQuoteId: string | null = null;
    let resolvedQuoteNumber: string | null = null;

    if (explicitQuoteNumber) {
      const explicitResolution = await resolveQuoteIdFromExplicitNumber({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        quoteNumber: explicitQuoteNumber,
      });

      if (!explicitResolution?.quoteId) {
        return {
          handled: true,
          reply: "Nao encontrei esse orcamento. Confira o numero e tente novamente.",
          metadata: {
            source: "assistant_contract_generation_workflow_v1",
            contractGenerationHandled: true,
            reasonCode: "QUOTE_NOT_FOUND",
            explicitQuoteNumber: explicitQuoteNumber.hyphenated,
          },
        };
      }

      resolvedQuoteId = explicitResolution.quoteId;
      resolvedQuoteNumber = explicitResolution.quoteNumber;
    } else {
      const recentContext = resolveRecentQuoteContext(args.recentMessages);

      if (recentContext.kind !== "selected" || !recentContext.candidate.quoteId) {
        return {
          handled: true,
          reply:
            "Me diga o numero do orcamento para eu gerar o contrato com seguranca. Exemplo: ORC-000024.",
          metadata: {
            source: "assistant_contract_generation_workflow_v1",
            contractGenerationHandled: true,
            reasonCode: "QUOTE_REFERENCE_REQUIRED",
            contextCandidateCount:
              recentContext.kind === "ambiguous" ? recentContext.candidates.length : 0,
          },
        };
      }

      resolvedQuoteId = recentContext.candidate.quoteId;
      resolvedQuoteNumber = recentContext.candidate.quoteNumber;
    }

    const currentProposalResolution =
      await resolveCurrentProposalQuoteVersionForTextContract({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        quoteId: resolvedQuoteId,
        quoteNumber: resolvedQuoteNumber,
      });

    if (!currentProposalResolution.ok) {
      return currentProposalResolution.result;
    }

    const executeContractGeneration =
      args.executeAssistantContractGeneration ?? executeAssistantContractGeneration;

    const execution = await executeContractGeneration({
      request: args.request,
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      quoteId: currentProposalResolution.quoteId,
      quoteVersionId: currentProposalResolution.quoteVersionId,
      quoteNumber: currentProposalResolution.quoteNumber,
      source: "assistant_contract_generation_workflow_v1",
    });

    return {
      handled: true,
      reply: execution.reply,
      metadata: execution.metadata,
    };
  } catch (error) {
    return {
      handled: true,
      reply:
        error instanceof Error
          ? error.message
          : "Nao consegui avaliar esse pedido de contrato com seguranca agora.",
      metadata: {
        source: "assistant_contract_generation_workflow_v1",
        contractGenerationHandled: true,
        reasonCode: "ASSISTANT_CONTRACT_GENERATION_FAILED",
        trigger: "human_explicit_request",
      },
    };
  }
}

import { pushAssistantDocumentReviewMessage } from "@/lib/server/assistant/document-review-messages";
import { ContractAccessError } from "@/lib/server/sales-contracts/contract-auth";
import { registerContractBusinessEvent } from "@/lib/server/sales-contracts/contract-events";
import type {
  SalesContract,
  SalesContractSignature,
  SalesContractVersion,
} from "@/lib/server/sales-contracts/types";

const CUSTOMER_SIGN_EVENT_TYPE = "contrato_assinado_cliente";
const DEFAULT_ACCEPTANCE_TEXT = "Li e aceito os termos deste contrato.";
const CUSTOMER_ACCEPTANCE_CONFIRMATION_TEXT =
  "Recebi seu aceite do contrato. Agora falta so a confirmacao final da loja. Assim que estiver tudo certo, te aviso por aqui.";

type AcceptanceLead = {
  id: string;
  name: string | null;
  phone: string | null;
};

type AcceptanceConversation = {
  id: string;
};

export type CustomerContractAcceptanceScope = {
  supabase: any;
  organizationId: string;
  store: {
    id: string;
  };
  contract: SalesContract;
  currentVersion: SalesContractVersion;
  lead: AcceptanceLead | null;
  conversation: AcceptanceConversation | null;
};

type EligibleContractCandidate = {
  id: string;
  contract_number: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  sent_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type EligibleContractResolution =
  | {
      outcome: "none";
      candidateCount: 0;
      matchedBy: "conversation" | "lead" | "none";
    }
  | {
      outcome: "multiple";
      candidateCount: number;
      matchedBy: "conversation" | "lead";
      candidates: Array<{
        contractId: string;
        contractNumber: string | null;
      }>;
    }
  | {
      outcome: "single";
      candidateCount: 1;
      matchedBy: "conversation" | "lead";
      contractId: string;
      contractNumber: string | null;
      scope: CustomerContractAcceptanceScope;
    };

export type SignSalesContractAsCustomerResult = {
  contract: SalesContract;
  currentVersion: SalesContractVersion;
  signature: SalesContractSignature;
  contractId: string;
  contractVersionId: string;
  signatureId: string;
  contractStatus: string | null;
  versionStatus: string | null;
  acceptedAt: string | null;
  signedAt: string | null;
  replayed: boolean;
  reconciled: boolean;
  outcome: "signed" | "already_applied" | "reconciled_partial_state";
  sideEffects?: {
    businessEvent: "completed" | "failed" | "skipped";
    documentReview: "completed" | "failed" | "skipped";
  };
};

type FindEligibleSentContractArgs = {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId?: string | null;
  leadId?: string | null;
  anchorMessageId?: string | null;
  allowLeadFallback?: boolean;
};

type SignSalesContractAsCustomerArgs = {
  scope: CustomerContractAcceptanceScope;
  signerName?: string | null;
  signerPhone?: string | null;
  signerEmail?: string | null;
  acceptanceText?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
  metadataSource?: string | null;
  expectedAnchorMessageId?: string | null;
};

type AtomicCustomerAcceptanceRpcResult = {
  outcome?: unknown;
  replayed?: unknown;
  reconciled?: unknown;
  contract_id?: unknown;
  contract_version_id?: unknown;
  signature_id?: unknown;
  trigger_message_id?: unknown;
  contract_status?: unknown;
  version_status?: unknown;
  signed_at?: unknown;
};

type AnchorSignatureReplayCandidate = {
  id: string;
  contract_id: string | null;
  contract_version_id: string | null;
};

type SignSalesContractAsCustomerDeps = {
  registerBusinessEvent: typeof registerContractBusinessEvent;
  pushDocumentReviewMessage: typeof pushAssistantDocumentReviewMessage;
};

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeBoolean(value: unknown) {
  return value === true;
}

function normalizeCanonicalContractStatus(value: unknown) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  return normalized === "signed_by_customer" ? "customer_signed" : normalized;
}

function buildRpcAcceptanceErrorMessage(code: string, deterministicMessage?: string | null) {
  if (deterministicMessage) {
    return `Nao foi possivel concluir o aceite do cliente (${code}: ${deterministicMessage}).`;
  }

  return `Nao foi possivel concluir o aceite do cliente (${code}).`;
}

function mapRpcAcceptanceErrorStatus(code: string, deterministicMessage?: string | null) {
  const mappedToken = deterministicMessage || code;

  if (mappedToken.endsWith("_NOT_FOUND")) {
    return 404;
  }

  if (mappedToken.endsWith("_REQUIRED")) {
    return 400;
  }

  return 409;
}

function extractRpcAcceptanceError(error: unknown) {
  const candidate =
    error && typeof error === "object"
      ? (error as { message?: unknown; code?: unknown; details?: unknown })
      : null;
  const rawMessage = normalizeOptionalText(candidate?.message);
  const rawCode = normalizeOptionalText(candidate?.code);
  const sqlState = rawCode && /^ZC[A-Z0-9]+$/i.test(rawCode) ? rawCode.toUpperCase() : null;
  const deterministicMessage =
    rawMessage && /^[A-Z0-9_]+$/.test(rawMessage) ? rawMessage : null;
  const errorCode =
    sqlState ||
    deterministicMessage ||
    rawCode ||
    "CUSTOMER_CONTRACT_ACCEPTANCE_RPC_FAILED";
  const normalizedDetails = candidate?.details ?? null;
  const mappedError = new ContractAccessError(
    mapRpcAcceptanceErrorStatus(errorCode, deterministicMessage),
    errorCode,
    buildRpcAcceptanceErrorMessage(errorCode, deterministicMessage),
  ) as ContractAccessError & {
    details?: unknown;
    sqlState?: string | null;
    deterministicMessage?: string | null;
  };

  mappedError.details = normalizedDetails;
  mappedError.sqlState = sqlState;
  mappedError.deterministicMessage = deterministicMessage;

  return mappedError;
}

function buildCanonicalSignatureMetadata(args: {
  metadataSource: string;
  ipAddress: string | null;
  expectedAnchorMessageId: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const rawMetadata =
    args.metadata && typeof args.metadata === "object" ? args.metadata : null;
  const {
    source: _ignoredSource,
    ip_capture_available: _ignoredIpCaptureAvailable,
    accepted_via: _ignoredAcceptedVia,
    trigger_message_id: _ignoredTriggerMessageId,
    ...restMetadata
  } =
    rawMetadata || {};

  return {
    source: args.metadataSource,
    ip_capture_available: Boolean(args.ipAddress),
    ...restMetadata,
    accepted_via: args.expectedAnchorMessageId ? "conversation_text" : "manual_direct",
    ...(args.expectedAnchorMessageId
      ? { trigger_message_id: args.expectedAnchorMessageId }
      : {}),
  };
}

function mapAtomicCustomerAcceptanceRpcResult(
  scope: CustomerContractAcceptanceScope,
  rpcResult: AtomicCustomerAcceptanceRpcResult,
  signerName: string | null,
  signerPhone: string | null,
  signerEmail: string | null,
  acceptanceText: string | null,
  metadata: Record<string, unknown> | null,
  ipAddress: string | null,
  userAgent: string | null,
): SignSalesContractAsCustomerResult {
  const outcome = normalizeOptionalText(rpcResult.outcome);

  if (
    outcome !== "signed" &&
    outcome !== "already_applied" &&
    outcome !== "reconciled_partial_state"
  ) {
    throw new Error("Falha ao interpretar o retorno canonico do aceite atomico do cliente.");
  }

  const contractId =
    normalizeOptionalText(rpcResult.contract_id) || scope.contract.id;
  const contractVersionId =
    normalizeOptionalText(rpcResult.contract_version_id) || scope.currentVersion.id;
  const signatureId = normalizeOptionalText(rpcResult.signature_id);

  if (!contractId || !contractVersionId || !signatureId) {
    throw new Error("A RPC canonica nao retornou os identificadores obrigatorios do aceite do cliente.");
  }

  const contractStatus = normalizeCanonicalContractStatus(rpcResult.contract_status);
  const versionStatus = normalizeCanonicalContractStatus(rpcResult.version_status);
  const signedAt = normalizeOptionalText(rpcResult.signed_at);

  return {
    contract: {
      ...scope.contract,
      id: contractId,
      current_version_id: contractVersionId,
      status: contractStatus,
      customer_signed_at: signedAt,
    },
    currentVersion: {
      ...scope.currentVersion,
      id: contractVersionId,
      contract_id: contractId,
      status: versionStatus,
    },
    signature: {
      id: signatureId,
      contract_id: contractId,
      organization_id: scope.organizationId,
      store_id: scope.store.id,
      contract_version_id: contractVersionId,
      signer_type: "customer",
      status: "signed",
      signer_name: signerName,
      signer_phone: signerPhone,
      signer_email: signerEmail,
      acceptance_text: acceptanceText,
      signed_at: signedAt,
      ip_address: ipAddress,
      user_agent: userAgent,
      metadata,
      created_at: signedAt,
    },
    contractId,
    contractVersionId,
    signatureId,
    contractStatus,
    versionStatus,
    acceptedAt: signedAt,
    signedAt,
    replayed: normalizeBoolean(rpcResult.replayed),
    reconciled: normalizeBoolean(rpcResult.reconciled),
    outcome,
    sideEffects: {
      businessEvent: "skipped",
      documentReview: "skipped",
    },
  };
}

function hasAnyPhrase(text: string, phrases: string[]) {
  return phrases.some((phrase) => text.includes(phrase));
}

function compareDateDesc(a: EligibleContractCandidate, b: EligibleContractCandidate) {
  const aValue = Date.parse(String(a.sent_at || a.updated_at || a.created_at || ""));
  const bValue = Date.parse(String(b.sent_at || b.updated_at || b.created_at || ""));

  const safeA = Number.isFinite(aValue) ? aValue : 0;
  const safeB = Number.isFinite(bValue) ? bValue : 0;

  return safeB - safeA;
}

export function buildCustomerContractAcceptanceConfirmationText() {
  return CUSTOMER_ACCEPTANCE_CONFIRMATION_TEXT;
}

export function detectStrongCustomerContractAcceptance(message: string | null | undefined) {
  const raw = String(message || "").trim();
  const text = normalizeText(raw);

  if (!text || text.length < 3) {
    return false;
  }

  if (
    hasAnyPhrase(text, [
      "nao aceito",
      "não aceito",
      "nao concordo",
      "não concordo",
      "nao pode seguir",
      "não pode seguir",
      "nao confirmo",
      "não confirmo",
      "nao quero contrato",
      "não quero contrato",
      "nao enviar contrato",
      "não enviar contrato",
      "recuso",
      "discordo",
    ])
  ) {
    return false;
  }

  const mentionsContract = hasAnyPhrase(text, ["contrato", "termos"]);
  const mentionsQuoteInstead = hasAnyPhrase(text, [
    "orcamento",
    "orcamento",
    "orçamento",
    "proposta",
    "visita",
  ]);

  if (mentionsQuoteInstead && !mentionsContract) {
    return false;
  }

  if (
    hasAnyPhrase(text, [
      "aceito o contrato",
      "aceito esse contrato",
      "aceito este contrato",
      "li e aceito",
      "li e concordo",
      "estou de acordo",
      "de acordo com o contrato",
      "pode confirmar, eu aceito",
      "pode confirmar eu aceito",
      "confirmo o contrato",
      "confirmo meu aceite",
      "eu aceito",
      "pode finalizar",
    ])
  ) {
    return true;
  }

  if (mentionsContract && hasAnyPhrase(text, ["aceito", "confirmo", "concordo", "pode seguir"])) {
    return true;
  }

  const exactShortAcceptances = new Set([
    "aceito",
    "confirmo",
    "concordo",
    "estou de acordo",
    "pode confirmar",
    "pode seguir",
    "pode finalizar",
    "ok pode seguir",
    "sim aceito",
    "eu aceito",
  ]);

  return exactShortAcceptances.has(text);
}

async function queryEligibleSentContracts(
  args: FindEligibleSentContractArgs & {
    field: "conversation_id" | "lead_id";
    value: string;
  }
) {
  const { data, error } = await args.supabase
    .from("sales_contracts")
    .select("id, contract_number, lead_id, conversation_id, sent_at, updated_at, created_at")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq(args.field, args.value)
    .eq("status", "sent_to_customer")
    .not("current_version_id", "is", null);

  if (error) {
    throw new Error(`Falha ao buscar contratos elegiveis para aceite: ${error.message}`);
  }

  const candidates = Array.isArray(data)
    ? (data as EligibleContractCandidate[]).sort(compareDateDesc)
    : [];

  return candidates;
}

async function loadCustomerContractAcceptanceScope(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  contractId: string;
  contractVersionId?: string | null;
}): Promise<CustomerContractAcceptanceScope> {
  const { data: contract, error: contractError } = await args.supabase
    .from("sales_contracts")
    .select("*")
    .eq("id", args.contractId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (contractError) {
    throw new Error(`Falha ao carregar contrato para aceite do cliente: ${contractError.message}`);
  }

  if (!contract?.id) {
    throw new ContractAccessError(404, "CONTRACT_NOT_FOUND", "Contrato nao encontrado.");
  }

  const currentVersionId = String(args.contractVersionId || contract.current_version_id || "").trim();

  if (!currentVersionId) {
    throw new ContractAccessError(
      400,
      "CONTRACT_VERSION_REQUIRED",
      "Este contrato ainda nao possui current_version_id."
    );
  }

  const { data: currentVersion, error: versionError } = await args.supabase
    .from("sales_contract_versions")
    .select("*")
    .eq("id", currentVersionId)
    .eq("contract_id", contract.id)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (versionError) {
    throw new Error(`Falha ao carregar versao atual do contrato: ${versionError.message}`);
  }

  if (!currentVersion?.id) {
    throw new ContractAccessError(
      404,
      "CONTRACT_VERSION_NOT_FOUND",
      "Versao atual do contrato nao encontrada."
    );
  }

  let lead: AcceptanceLead | null = null;
  const leadId = String(contract.lead_id || "").trim();

  if (leadId) {
    const { data: leadData, error: leadError } = await args.supabase
      .from("leads")
      .select("id, name, phone")
      .eq("id", leadId)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .maybeSingle();

    if (leadError) {
      throw new Error(`Falha ao carregar lead do contrato: ${leadError.message}`);
    }

    if (leadData?.id) {
      lead = leadData as AcceptanceLead;
    }
  }

  let conversation: AcceptanceConversation | null = null;
  const conversationId = String(contract.conversation_id || "").trim();

  if (conversationId) {
    const { data: conversationData, error: conversationError } = await args.supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("organization_id", args.organizationId)
      .maybeSingle();

    if (conversationError) {
      throw new Error(`Falha ao carregar conversa do contrato: ${conversationError.message}`);
    }

    if (conversationData?.id) {
      conversation = conversationData as AcceptanceConversation;
    }
  }

  return {
    supabase: args.supabase,
    organizationId: args.organizationId,
    store: {
      id: args.storeId,
    },
    contract: contract as SalesContract,
    currentVersion: currentVersion as SalesContractVersion,
    lead,
    conversation,
  };
}

async function findEligibleContractByAnchorSignature(
  args: FindEligibleSentContractArgs & {
    conversationId: string;
    anchorMessageId: string;
  }
): Promise<EligibleContractResolution | null> {
  const { data: signature, error } = await args.supabase
    .from("sales_contract_signatures")
    .select("id, contract_id, contract_version_id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("signer_type", "customer")
    .eq("trigger_message_id", args.anchorMessageId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao localizar assinatura do cliente pela mensagem-ancora: ${error.message}`);
  }

  if (!signature) {
    return null;
  }

  const replayCandidate = signature as AnchorSignatureReplayCandidate;
  const contractId = normalizeOptionalText(replayCandidate.contract_id);

  if (!contractId) {
    return null;
  }

  const scope = await loadCustomerContractAcceptanceScope({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    contractId,
    contractVersionId: normalizeOptionalText(replayCandidate.contract_version_id),
  });

  const scopeConversationId = normalizeOptionalText(
    scope.conversation?.id || scope.contract.conversation_id,
  );

  if (scopeConversationId !== args.conversationId) {
    return null;
  }

  return {
    outcome: "single",
    candidateCount: 1,
    matchedBy: "conversation",
    contractId: scope.contract.id,
    contractNumber: scope.contract.contract_number || null,
    scope,
  };
}

export async function findEligibleSentContractForCustomerAcceptance(
  args: FindEligibleSentContractArgs
): Promise<EligibleContractResolution> {
  const conversationId = String(args.conversationId || "").trim();
  const leadId = String(args.leadId || "").trim();
  const anchorMessageId = String(args.anchorMessageId || "").trim();
  const allowLeadFallback = args.allowLeadFallback === true;

  if (conversationId) {
    if (anchorMessageId) {
      const replayResolution = await findEligibleContractByAnchorSignature({
        ...args,
        conversationId,
        anchorMessageId,
      });

      if (replayResolution) {
        return replayResolution;
      }
    }

    const conversationCandidates = await queryEligibleSentContracts({
      ...args,
      field: "conversation_id",
      value: conversationId,
    });

    if (conversationCandidates.length > 1) {
      return {
        outcome: "multiple",
        candidateCount: conversationCandidates.length,
        matchedBy: "conversation",
        candidates: conversationCandidates.map((candidate) => ({
          contractId: candidate.id,
          contractNumber: candidate.contract_number || null,
        })),
      };
    }

    if (conversationCandidates.length === 1) {
      const candidate = conversationCandidates[0];
      const scope = await loadCustomerContractAcceptanceScope({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        contractId: candidate.id,
      });

      return {
        outcome: "single",
        candidateCount: 1,
        matchedBy: "conversation",
        contractId: candidate.id,
        contractNumber: candidate.contract_number || null,
        scope,
      };
    }
  }

  if (!allowLeadFallback || !leadId) {
    return {
      outcome: "none",
      candidateCount: 0,
      matchedBy: conversationId ? "conversation" : "none",
    };
  }

  const leadCandidates = await queryEligibleSentContracts({
    ...args,
    field: "lead_id",
    value: leadId,
  });

  if (leadCandidates.length > 1) {
    return {
      outcome: "multiple",
      candidateCount: leadCandidates.length,
      matchedBy: "lead",
      candidates: leadCandidates.map((candidate) => ({
        contractId: candidate.id,
        contractNumber: candidate.contract_number || null,
      })),
    };
  }

  if (leadCandidates.length !== 1) {
    return {
      outcome: "none",
      candidateCount: 0,
      matchedBy: "lead",
    };
  }

  const candidate = leadCandidates[0];
  const scope = await loadCustomerContractAcceptanceScope({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    contractId: candidate.id,
  });

  return {
    outcome: "single",
    candidateCount: 1,
    matchedBy: "lead",
    contractId: candidate.id,
    contractNumber: candidate.contract_number || null,
    scope,
  };
}

export async function signSalesContractAsCustomer(
  args: SignSalesContractAsCustomerArgs,
  deps?: Partial<SignSalesContractAsCustomerDeps>
): Promise<SignSalesContractAsCustomerResult> {
  const resolvedDeps: SignSalesContractAsCustomerDeps = {
    registerBusinessEvent: registerContractBusinessEvent,
    pushDocumentReviewMessage: pushAssistantDocumentReviewMessage,
    ...deps,
  };
  const scope = args.scope;
  const currentVersionId = String(scope.currentVersion?.id || scope.contract.current_version_id || "").trim();
  if (!currentVersionId) {
    throw new ContractAccessError(
      400,
      "CONTRACT_VERSION_REQUIRED",
      "Este contrato ainda nao possui current_version_id."
    );
  }

  if (!scope.currentVersion?.id) {
    throw new ContractAccessError(
      404,
      "CONTRACT_VERSION_NOT_FOUND",
      "Versao atual do contrato nao encontrada."
    );
  }
  const signerName =
    normalizeOptionalText(args.signerName) ||
    normalizeOptionalText(scope.contract.customer_name) ||
    normalizeOptionalText(scope.lead?.name);
  const signerPhone =
    normalizeOptionalText(args.signerPhone) ||
    normalizeOptionalText(scope.contract.customer_phone) ||
    normalizeOptionalText(scope.lead?.phone);
  const signerEmail = normalizeOptionalText(args.signerEmail);
  const acceptanceText =
    normalizeOptionalText(args.acceptanceText) || DEFAULT_ACCEPTANCE_TEXT;
  const metadataSource =
    normalizeOptionalText(args.metadataSource) || "api_sales_contracts_customer_sign";
  const expectedAnchorMessageId = normalizeOptionalText(args.expectedAnchorMessageId);
  const ipAddress = normalizeOptionalText(args.ipAddress);
  const userAgent = normalizeOptionalText(args.userAgent);
  const signatureMetadata = buildCanonicalSignatureMetadata({
    metadataSource,
    ipAddress,
    expectedAnchorMessageId,
    metadata: args.metadata,
  });

  const { data: rpcResult, error: rpcError } = await scope.supabase.rpc(
    "sign_sales_contract_as_customer_atomic",
    {
      p_organization_id: scope.organizationId,
      p_store_id: scope.store.id,
      p_conversation_id: scope.conversation?.id || scope.contract.conversation_id,
      p_contract_id: scope.contract.id,
      p_expected_contract_version_id: currentVersionId,
      p_expected_anchor_message_id: expectedAnchorMessageId,
      p_signer_name: signerName,
      p_signer_phone: signerPhone,
      p_signer_email: signerEmail,
      p_acceptance_text: acceptanceText,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
      p_metadata: signatureMetadata,
    },
  );

  if (rpcError || !rpcResult) {
    throw extractRpcAcceptanceError(rpcError);
  }

  const mappedResult = mapAtomicCustomerAcceptanceRpcResult(
    scope,
    rpcResult as AtomicCustomerAcceptanceRpcResult,
    signerName,
    signerPhone,
    signerEmail,
    acceptanceText,
    signatureMetadata,
    ipAddress,
    userAgent,
  );

  if (mappedResult.outcome !== "signed") {
    return mappedResult;
  }

  let businessEventStatus: "completed" | "failed" | "skipped" = "skipped";
  let documentReviewStatus: "completed" | "failed" | "skipped" = "skipped";

  try {
    await resolvedDeps.registerBusinessEvent({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      eventKey: CUSTOMER_SIGN_EVENT_TYPE,
      actorType: "customer",
      leadId: scope.lead?.id || scope.contract.lead_id || null,
      conversationId: scope.conversation?.id || scope.contract.conversation_id || null,
      actorUserId: null,
      eventPayload: {
        contract_id: mappedResult.contractId,
        contract_number: mappedResult.contract.contract_number,
        contract_version_id: mappedResult.contractVersionId,
        signature_id: mappedResult.signatureId,
        signer_name: signerName,
        signer_phone: signerPhone,
        signer_email: signerEmail,
        signed_at: mappedResult.signedAt,
        ip_address: ipAddress,
        user_agent: userAgent,
        status: mappedResult.contractStatus,
      },
    });
    businessEventStatus = "completed";
  } catch (businessEventError) {
    businessEventStatus = "failed";
    console.warn("[sales-contracts/customer-sign] falha ao registrar evento de negocio:", {
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      contractId: mappedResult.contractId,
      signatureId: mappedResult.signatureId,
      error: businessEventError,
    });
  }

  try {
    await resolvedDeps.pushDocumentReviewMessage({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      documentType: "contract",
      documentId: mappedResult.contractId,
      documentVersionId: mappedResult.contractVersionId,
      documentNumber:
        String(mappedResult.contract.contract_number || "").trim() || mappedResult.contractId,
      documentStatus: "customer_signed",
      relatedQuoteId: mappedResult.contract.quote_id || null,
      relatedContractId: mappedResult.contractId,
      relatedLeadId: scope.lead?.id || mappedResult.contract.lead_id || null,
      relatedConversationId:
        scope.conversation?.id || mappedResult.contract.conversation_id || null,
      customerName:
        mappedResult.contract.customer_name || scope.lead?.name || signerName || null,
      customerPhone:
        mappedResult.contract.customer_phone || scope.lead?.phone || signerPhone || null,
      originalFileName: scope.currentVersion.original_filename || null,
      fileKind: "sales_contract_pdf",
      mimeType: scope.currentVersion.mime_type || "application/pdf",
      storageBucket: scope.currentVersion.storage_bucket || null,
      storagePath: scope.currentVersion.storage_path || null,
      contentOverride: [
        "Contrato aceito pelo cliente.",
        "",
        `Cliente: ${signerName || mappedResult.contract.customer_name || "Nao informado"}`,
        `Documento: ${String(mappedResult.contract.contract_number || "").trim() || mappedResult.contractId}`,
        "Status atual: Aceito pelo cliente",
        "",
        "O cliente aceitou este contrato. Falta a confirmacao/assinatura da loja para concluir o processo.",
      ].join("\n"),
      assistantPromptOverride:
        "O cliente aceitou este contrato. Revise o documento se necessario e confirme pela loja para concluir o processo.",
      availableActionsOverride: [
        {
          id: "review",
          label: "Revisar",
          kind: "open_document",
        },
        {
          id: "confirm_store_signature",
          label: "Confirmar pela loja",
          kind: "confirm_store_signature",
          requires_confirmation: true,
        },
      ],
      sourceOverride: "assistant_contract_status_workflow_v1",
    });
    documentReviewStatus = "completed";
  } catch (assistantMessageError) {
    documentReviewStatus = "failed";
    console.warn(
      "[sales-contracts/customer-sign] falha ao criar mensagem de status da assistente:",
      {
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        contractId: mappedResult.contractId,
        signatureId: mappedResult.signatureId,
        error: assistantMessageError,
      }
    );
  }

  return {
    ...mappedResult,
    sideEffects: {
      businessEvent: businessEventStatus,
      documentReview: documentReviewStatus,
    },
  };
}

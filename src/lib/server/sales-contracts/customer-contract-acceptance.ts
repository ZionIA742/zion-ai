import { pushAssistantDocumentReviewMessage } from "@/lib/server/assistant/document-review-messages";
import { ContractAccessError } from "@/lib/server/sales-contracts/contract-auth";
import { registerContractBusinessEvent } from "@/lib/server/sales-contracts/contract-events";
import { loadExistingContractSignature } from "@/lib/server/sales-contracts/contract-signatures";
import type {
  SalesContract,
  SalesContractSignature,
  SalesContractVersion,
} from "@/lib/server/sales-contracts/types";

const CUSTOMER_SIGN_EVENT_TYPE = "contrato_assinado_cliente";
const BLOCKED_CONTRACT_STATUSES = new Set(["completed", "cancelled", "expired", "failed"]);
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
};

type FindEligibleSentContractArgs = {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId?: string | null;
  leadId?: string | null;
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

  const currentVersionId = String(contract.current_version_id || "").trim();

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

export async function findEligibleSentContractForCustomerAcceptance(
  args: FindEligibleSentContractArgs
): Promise<EligibleContractResolution> {
  const conversationId = String(args.conversationId || "").trim();
  const leadId = String(args.leadId || "").trim();

  if (conversationId) {
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

  if (!leadId) {
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
  args: SignSalesContractAsCustomerArgs
): Promise<SignSalesContractAsCustomerResult> {
  const scope = args.scope;
  const normalizedContractStatus = String(scope.contract.status || "").trim().toLowerCase();

  if (BLOCKED_CONTRACT_STATUSES.has(normalizedContractStatus)) {
    throw new ContractAccessError(
      409,
      "CONTRACT_STATUS_NOT_SIGNABLE",
      "Este contrato nao pode receber aceite do cliente no status atual."
    );
  }

  if (normalizedContractStatus !== "sent_to_customer") {
    throw new ContractAccessError(
      409,
      "CONTRACT_NOT_SENT_TO_CUSTOMER",
      "O cliente so pode aceitar o contrato depois que ele estiver enviado."
    );
  }

  const currentVersionId = String(scope.contract.current_version_id || "").trim();
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

  const existingSignature = await loadExistingContractSignature({
    supabase: scope.supabase,
    contract: scope.contract,
    versionId: currentVersionId,
    signerType: "customer",
  });

  if (existingSignature?.id) {
    throw new ContractAccessError(
      409,
      "CUSTOMER_SIGNATURE_ALREADY_EXISTS",
      "Ja existe uma assinatura/aceite do cliente para a versao atual deste contrato."
    );
  }

  const signedAt = new Date().toISOString();
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

  const { data: signature, error: signatureError } = await scope.supabase
    .from("sales_contract_signatures")
    .insert({
      contract_id: scope.contract.id,
      contract_version_id: scope.currentVersion.id,
      organization_id: scope.organizationId,
      store_id: scope.store.id,
      signer_type: "customer",
      signer_name: signerName,
      signer_phone: signerPhone,
      signer_email: signerEmail,
      status: "signed",
      signed_at: signedAt,
      ip_address: normalizeOptionalText(args.ipAddress),
      user_agent: normalizeOptionalText(args.userAgent),
      acceptance_text: acceptanceText,
      metadata: {
        source: metadataSource,
        ip_capture_available: Boolean(normalizeOptionalText(args.ipAddress)),
        ...(args.metadata || {}),
      },
    })
    .select("*")
    .maybeSingle();

  if (signatureError || !signature?.id) {
    throw new Error(signatureError?.message || "Falha ao criar sales_contract_signatures.");
  }

  const { data: updatedContract, error: contractUpdateError } = await scope.supabase
    .from("sales_contracts")
    .update({
      status: "customer_signed",
      customer_signed_at: signedAt,
    })
    .eq("id", scope.contract.id)
    .select("*")
    .maybeSingle();

  if (contractUpdateError || !updatedContract?.id) {
    throw new Error(contractUpdateError?.message || "Falha ao atualizar sales_contracts.");
  }

  await registerContractBusinessEvent({
    supabase: scope.supabase,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
    eventKey: CUSTOMER_SIGN_EVENT_TYPE,
    actorType: "customer",
    leadId: scope.lead?.id || scope.contract.lead_id || null,
    conversationId: scope.conversation?.id || scope.contract.conversation_id || null,
    actorUserId: null,
    eventPayload: {
      contract_id: updatedContract.id,
      contract_number: updatedContract.contract_number,
      contract_version_id: scope.currentVersion.id,
      signature_id: signature.id,
      signer_name: signerName,
      signer_phone: signerPhone,
      signer_email: signerEmail,
      signed_at: signedAt,
      ip_address: normalizeOptionalText(args.ipAddress),
      user_agent: normalizeOptionalText(args.userAgent),
      status: updatedContract.status,
    },
  });

  try {
    await pushAssistantDocumentReviewMessage({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      documentType: "contract",
      documentId: updatedContract.id,
      documentVersionId: scope.currentVersion.id,
      documentNumber:
        String(updatedContract.contract_number || "").trim() || updatedContract.id,
      documentStatus: "customer_signed",
      relatedQuoteId: updatedContract.quote_id || null,
      relatedContractId: updatedContract.id,
      relatedLeadId: scope.lead?.id || updatedContract.lead_id || null,
      relatedConversationId:
        scope.conversation?.id || updatedContract.conversation_id || null,
      customerName:
        updatedContract.customer_name || scope.lead?.name || signerName || null,
      customerPhone:
        updatedContract.customer_phone || scope.lead?.phone || signerPhone || null,
      originalFileName: scope.currentVersion.original_filename || null,
      fileKind: "sales_contract_pdf",
      mimeType: scope.currentVersion.mime_type || "application/pdf",
      storageBucket: scope.currentVersion.storage_bucket || null,
      storagePath: scope.currentVersion.storage_path || null,
      contentOverride: [
        "Contrato aceito pelo cliente.",
        "",
        `Cliente: ${signerName || updatedContract.customer_name || "Nao informado"}`,
        `Documento: ${String(updatedContract.contract_number || "").trim() || updatedContract.id}`,
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
  } catch (assistantMessageError) {
    console.warn(
      "[sales-contracts/customer-sign] falha ao criar mensagem de status da assistente:",
      assistantMessageError
    );
  }

  return {
    contract: updatedContract as SalesContract,
    currentVersion: scope.currentVersion,
    signature: signature as SalesContractSignature,
  };
}

import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";
import {
  ContractAccessError,
  resolveAuthorizedExistingContract,
} from "@/lib/server/sales-contracts/contract-auth";

export type AssistantDocumentAction =
  | "review"
  | "approve_and_send"
  | "confirm_store_signature";
export type AssistantDocumentType = "quote" | "contract";

type InternalActionResult = {
  ok: boolean;
  status: number;
  body: any;
};

type ExecuteDocumentActionArgs = {
  request: Request;
  action: AssistantDocumentAction;
  documentType: AssistantDocumentType;
  documentId: string;
};

type ExecuteDocumentActionResult = {
  ok: boolean;
  status: number;
  documentType: AssistantDocumentType;
  documentId: string;
  action: AssistantDocumentAction;
  message: string;
  signedUrl?: string;
  error?: string;
};

type PersistedQuoteApprovalState = {
  status: string | null;
  approved_at: string | null;
  approved_by: string | null;
  sent_at: string | null;
};

const TERMINAL_DOCUMENT_STATUSES = new Set([
  "completed",
  "cancelled",
  "expired",
  "failed",
]);

function isAlreadyHandledError(code: string | null | undefined) {
  return code === "QUOTE_ALREADY_SENT" || code === "CONTRACT_ALREADY_SENT";
}

function isAlreadyApprovedError(code: string | null | undefined) {
  return code === "QUOTE_ALREADY_APPROVED";
}

function isTerminalDocumentStatus(value: string | null | undefined) {
  return TERMINAL_DOCUMENT_STATUSES.has(String(value || "").trim().toLowerCase());
}

async function loadPersistedQuoteApprovalState(scope: Awaited<ReturnType<typeof resolveAuthorizedExistingQuote>>) {
  const { data, error } = await scope.supabase
    .from("sales_quotes")
    .select("status, approved_at, approved_by, sent_at")
    .eq("id", scope.quote.id)
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.store.id)
    .maybeSingle<PersistedQuoteApprovalState>();

  if (error) {
    throw new Error(`Falha ao carregar aprovacao persistida do orcamento: ${error.message}`);
  }

  if (!data) {
    throw new QuoteAccessError(404, "QUOTE_NOT_FOUND", "Orcamento nao encontrado.");
  }

  return data;
}

async function ensurePersistedQuoteApproval(scope: Awaited<ReturnType<typeof resolveAuthorizedExistingQuote>>) {
  const current = await loadPersistedQuoteApprovalState(scope);
  const normalizedStatus = String(current.status || "").trim().toLowerCase();

  if (normalizedStatus === "sent") {
    return {
      ok: true as const,
      alreadySent: true,
      approvalState: current,
    };
  }

  if (normalizedStatus !== "approved") {
    return {
      ok: false as const,
      status: 409,
      error: "QUOTE_APPROVAL_NOT_PERSISTED",
      message: "O orcamento ainda nao ficou aprovado de forma persistida.",
    };
  }

  if (current.approved_at && current.approved_by) {
    return {
      ok: true as const,
      alreadySent: false,
      approvalState: current,
    };
  }

  const approvalTimestamp = current.approved_at || new Date().toISOString();
  const approverUserId = current.approved_by || scope.user.id;

  const { error: patchError } = await scope.supabase
    .from("sales_quotes")
    .update({
      approved_at: approvalTimestamp,
      approved_by: approverUserId,
      updated_at: approvalTimestamp,
    })
    .eq("id", scope.quote.id)
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.store.id);

  if (patchError) {
    return {
      ok: false as const,
      status: 500,
      error: "QUOTE_APPROVAL_PERSISTENCE_FAILED",
      message: `Falha ao persistir approved_at/approved_by do orcamento: ${patchError.message}`,
    };
  }

  const patched = await loadPersistedQuoteApprovalState(scope);
  if (!patched.approved_at || !patched.approved_by) {
    return {
      ok: false as const,
      status: 500,
      error: "QUOTE_APPROVAL_PERSISTENCE_FAILED",
      message: "Nao consegui confirmar approved_at/approved_by no orcamento antes do envio.",
    };
  }

  return {
    ok: true as const,
    alreadySent: false,
    approvalState: patched,
  };
}

async function ensureAuthenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      ok: false as const,
      status: 401,
      error: "UNAUTHORIZED",
      message: error?.message || "Usuario nao autenticado.",
    };
  }

  return {
    ok: true as const,
    userId: user.id,
  };
}

async function callInternalJson(
  request: Request,
  path: string,
  init?: RequestInit
): Promise<InternalActionResult> {
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

async function reviewQuote(request: Request, quoteId: string) {
  const result = await callInternalJson(
    request,
    `/api/sales-quotes/${encodeURIComponent(quoteId)}/signed-pdf-url`,
    { method: "GET" }
  );

  if (!result.ok || !result.body?.signedUrl) {
    return {
      ok: false as const,
      status: result.status,
      error: result.body?.error || "QUOTE_REVIEW_FAILED",
      message: result.body?.message || "Nao foi possivel abrir o orcamento.",
    };
  }

  return {
    ok: true as const,
    status: 200,
    signedUrl: String(result.body.signedUrl),
    message: "Documento pronto para revisao.",
  };
}

async function reviewContract(request: Request, contractId: string) {
  const result = await callInternalJson(
    request,
    `/api/sales-contracts/${encodeURIComponent(contractId)}/signed-pdf-url`,
    { method: "GET" }
  );

  if (!result.ok || !result.body?.signedUrl) {
    return {
      ok: false as const,
      status: result.status,
      error: result.body?.error || "CONTRACT_REVIEW_FAILED",
      message: result.body?.message || "Nao foi possivel abrir o contrato.",
    };
  }

  return {
    ok: true as const,
    status: 200,
    signedUrl: String(result.body.signedUrl),
    message: "Documento pronto para revisao.",
  };
}

async function approveAndSendQuote(request: Request, quoteId: string) {
  try {
    const scope = await resolveAuthorizedExistingQuote(quoteId);
    const currentStatus = String(scope.quote.status || "").trim().toLowerCase();

    if (isTerminalDocumentStatus(currentStatus)) {
      return {
        ok: false as const,
        status: 409,
        error: "QUOTE_STATUS_NOT_SENDABLE",
        message: "Este documento nao pode ser aprovado e enviado no status atual.",
      };
    }

    if (currentStatus === "sent") {
      return {
        ok: true as const,
        status: 200,
        message: "Este orcamento ja foi enviado ao cliente.",
      };
    }

    if (currentStatus !== "approved") {
      const approveResult = await callInternalJson(
        request,
        `/api/sales-quotes/${encodeURIComponent(quoteId)}/approve`,
        { method: "POST" }
      );

      const approveErrorCode = String(approveResult.body?.error || "").trim();
      if (!approveResult.ok && !isAlreadyApprovedError(approveErrorCode)) {
        if (isAlreadyHandledError(approveErrorCode)) {
          return {
            ok: true as const,
            status: 200,
            message: "Este orcamento ja foi enviado ao cliente.",
          };
        }

        return {
          ok: false as const,
          status: approveResult.status,
          error: approveErrorCode || "QUOTE_APPROVE_FAILED",
          message:
            approveResult.body?.message || "Nao foi possivel aprovar o orcamento.",
        };
      }
    }

    const persistedApproval = await ensurePersistedQuoteApproval(scope);
    if (!persistedApproval.ok) {
      return persistedApproval;
    }

    if (persistedApproval.alreadySent) {
      return {
        ok: true as const,
        status: 200,
        message: "Este orcamento ja foi enviado ao cliente.",
      };
    }

    const sendResult = await callInternalJson(
      request,
      `/api/sales-quotes/${encodeURIComponent(quoteId)}/send`,
      { method: "POST" }
    );

    const sendErrorCode = String(sendResult.body?.error || "").trim();
    if (!sendResult.ok && !isAlreadyHandledError(sendErrorCode)) {
      return {
        ok: false as const,
        status: sendResult.status,
        error: sendErrorCode || "QUOTE_SEND_FAILED",
        message: sendResult.body?.message || "Nao foi possivel enviar o orcamento.",
      };
    }

    return {
      ok: true as const,
      status: 200,
      message:
        isAlreadyHandledError(sendErrorCode)
          ? "Este orcamento ja havia sido enviado ao cliente."
          : "Orcamento aprovado e enviado ao cliente com sucesso.",
    };
  } catch (error) {
    if (error instanceof QuoteAccessError) {
      return {
        ok: false as const,
        status: error.status,
        error: error.code,
        message: error.message,
      };
    }

    return {
      ok: false as const,
      status: 500,
      error: "QUOTE_ACTION_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao processar o orcamento.",
    };
  }
}

async function approveAndSendContract(request: Request, contractId: string) {
  try {
    const scope = await resolveAuthorizedExistingContract(contractId);
    const currentStatus = String(scope.contract.status || "").trim().toLowerCase();

    if (isTerminalDocumentStatus(currentStatus)) {
      return {
        ok: false as const,
        status: 409,
        error: "CONTRACT_STATUS_NOT_SENDABLE",
        message: "Este documento nao pode ser aprovado e enviado no status atual.",
      };
    }

    if (currentStatus === "sent_to_customer") {
      return {
        ok: true as const,
        status: 200,
        message: "Este contrato ja foi enviado ao cliente.",
      };
    }

    if (currentStatus !== "approved") {
      const approveResult = await callInternalJson(
        request,
        `/api/sales-contracts/${encodeURIComponent(contractId)}/approve`,
        { method: "POST" }
      );

      const approveErrorCode = String(approveResult.body?.error || "").trim();
      if (!approveResult.ok) {
        if (isAlreadyHandledError(approveErrorCode)) {
          return {
            ok: true as const,
            status: 200,
            message: "Este contrato ja foi enviado ao cliente.",
          };
        }

        return {
          ok: false as const,
          status: approveResult.status,
          error: approveErrorCode || "CONTRACT_APPROVE_FAILED",
          message:
            approveResult.body?.message || "Nao foi possivel aprovar o contrato.",
        };
      }
    }

    const sendResult = await callInternalJson(
      request,
      `/api/sales-contracts/${encodeURIComponent(contractId)}/send`,
      { method: "POST" }
    );

    const sendErrorCode = String(sendResult.body?.error || "").trim();
    if (!sendResult.ok && !isAlreadyHandledError(sendErrorCode)) {
      return {
        ok: false as const,
        status: sendResult.status,
        error: sendErrorCode || "CONTRACT_SEND_FAILED",
        message: sendResult.body?.message || "Nao foi possivel enviar o contrato.",
      };
    }

    return {
      ok: true as const,
      status: 200,
      message:
        isAlreadyHandledError(sendErrorCode)
          ? "Este contrato ja havia sido enviado ao cliente."
          : "Contrato aprovado e enviado ao cliente com sucesso.",
    };
  } catch (error) {
    if (error instanceof ContractAccessError) {
      return {
        ok: false as const,
        status: error.status,
        error: error.code,
        message: error.message,
      };
    }

    return {
      ok: false as const,
      status: 500,
      error: "CONTRACT_ACTION_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao processar o contrato.",
    };
  }
}

async function confirmStoreSignature(request: Request, contractId: string) {
  try {
    const scope = await resolveAuthorizedExistingContract(contractId);
    const currentStatus = String(scope.contract.status || "").trim().toLowerCase();

    if (isTerminalDocumentStatus(currentStatus)) {
      return {
        ok: false as const,
        status: 409,
        error: "CONTRACT_STATUS_NOT_SIGNABLE",
        message: "Este contrato nao pode ser confirmado pela loja no status atual.",
      };
    }

    if (currentStatus === "completed") {
      return {
        ok: true as const,
        status: 200,
        message: "Este contrato ja foi concluido pela loja.",
      };
    }

    if (currentStatus !== "customer_signed") {
      return {
        ok: false as const,
        status: 409,
        error: "CONTRACT_CUSTOMER_SIGNATURE_REQUIRED",
        message: "A loja so pode confirmar o contrato depois que o cliente aceitar.",
      };
    }

    const signResult = await callInternalJson(
      request,
      `/api/sales-contracts/${encodeURIComponent(contractId)}/store-sign`,
      { method: "POST" }
    );

    const signErrorCode = String(signResult.body?.error || "").trim();
    if (
      !signResult.ok &&
      signErrorCode !== "STORE_SIGNATURE_ALREADY_EXISTS"
    ) {
      return {
        ok: false as const,
        status: signResult.status,
        error: signErrorCode || "CONTRACT_STORE_SIGN_FAILED",
        message:
          signResult.body?.message ||
          "Nao foi possivel confirmar este contrato pela loja.",
      };
    }

    return {
      ok: true as const,
      status: 200,
      message: "Contrato confirmado pela loja com sucesso.",
    };
  } catch (error) {
    if (error instanceof ContractAccessError) {
      return {
        ok: false as const,
        status: error.status,
        error: error.code,
        message: error.message,
      };
    }

    return {
      ok: false as const,
      status: 500,
      error: "CONTRACT_STORE_SIGN_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao confirmar o contrato pela loja.",
    };
  }
}

export async function executeAssistantDocumentAction(
  args: ExecuteDocumentActionArgs
): Promise<ExecuteDocumentActionResult> {
  const auth = await ensureAuthenticatedUser();
  if (!auth.ok) {
    return {
      ok: false,
      status: auth.status,
      documentType: args.documentType,
      documentId: args.documentId,
      action: args.action,
      error: auth.error,
      message: auth.message,
    };
  }

  if (args.action === "review") {
    const result =
      args.documentType === "quote"
        ? await reviewQuote(args.request, args.documentId)
        : await reviewContract(args.request, args.documentId);

    return {
      ok: result.ok,
      status: result.status,
      documentType: args.documentType,
      documentId: args.documentId,
      action: args.action,
      message: result.message,
      signedUrl: result.ok ? result.signedUrl : undefined,
      error: result.ok ? undefined : result.error,
    };
  }

  if (args.action === "confirm_store_signature") {
    if (args.documentType !== "contract") {
      return {
        ok: false,
        status: 400,
        documentType: args.documentType,
        documentId: args.documentId,
        action: args.action,
        error: "INVALID_DOCUMENT_TYPE",
        message: "A acao confirm_store_signature so pode ser usada em contratos.",
      };
    }

    const result = await confirmStoreSignature(args.request, args.documentId);

    return {
      ok: result.ok,
      status: result.status,
      documentType: args.documentType,
      documentId: args.documentId,
      action: args.action,
      message: result.message,
      error: result.ok ? undefined : result.error,
    };
  }

  const result =
    args.documentType === "quote"
      ? await approveAndSendQuote(args.request, args.documentId)
      : await approveAndSendContract(args.request, args.documentId);

  return {
    ok: result.ok,
    status: result.status,
    documentType: args.documentType,
    documentId: args.documentId,
    action: args.action,
    message: result.message,
    error: result.ok ? undefined : result.error,
  };
}

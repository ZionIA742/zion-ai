type NumberChangeLinkStartBody = {
  ok?: unknown;
  status?: unknown;
  error?: unknown;
  message?: unknown;
};

export type NumberChangeResumeRequest = {
  id: string;
  organization_id: string;
  store_id: string;
  provider: string;
  status: string;
  candidate_whatsapp_business_account_id: string | null;
  candidate_phone_number_id: string | null;
  candidate_display_phone_number: string | null;
};

export function resolveNumberChangeResumeState(args: {
  linkStatus?: string;
  requestId: string | null;
  changeRequest: NumberChangeResumeRequest | null;
  organizationId?: string;
  storeId?: string;
}): { requestId: string | null; phase: "initial" | "cutover"; blocked: false } | { blocked: true; message: string } {
  if (["completed", "revoked", "expired"].includes(args.linkStatus || "")) {
    return { blocked: true, message: "Este link de troca não pode mais ser retomado." };
  }
  if (!args.requestId) return { requestId: null, phase: "initial", blocked: false };
  if (args.linkStatus && args.linkStatus !== "started") {
    return { blocked: true, message: "O link e o pedido de troca estão em estados incompatíveis." };
  }

  const request = args.changeRequest;
  if (!request || request.id !== args.requestId || request.provider !== "whatsapp" ||
      (args.organizationId !== undefined && request.organization_id !== args.organizationId) ||
      (args.storeId !== undefined && request.store_id !== args.storeId)) {
    return { blocked: true, message: "O estado salvo da troca não pôde ser confirmado com segurança." };
  }
  if (["completed", "failed", "cancelled", "expired"].includes(request.status)) {
    return { blocked: true, message: "Este pedido de troca não pode mais ser retomado." };
  }

  const hasCompleteCandidate = Boolean(
    request.candidate_whatsapp_business_account_id &&
      request.candidate_phone_number_id &&
      request.candidate_display_phone_number,
  );
  if (["candidate_received", "validating", "ready_to_cutover"].includes(request.status) && !hasCompleteCandidate) {
    return { blocked: true, message: "O estado do candidato está inconsistente; a troca foi bloqueada por segurança." };
  }

  return { requestId: request.id, phase: hasCompleteCandidate ? "cutover" : "initial", blocked: false };
}

function cleanStartError(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export function validateNumberChangeLinkStartResponse(args: {
  httpOk: boolean;
  body: unknown;
}): { ok: true } | { ok: false; message: string } {
  const body =
    args.body && typeof args.body === "object"
      ? (args.body as NumberChangeLinkStartBody)
      : null;

  if (args.httpOk && body?.ok === true && body.status === "started") {
    return { ok: true };
  }

  const errorCode = cleanStartError(body?.error);
  const messageByError: Record<string, string> = {
    WHATSAPP_NUMBER_CHANGE_LINK_UNAUTHORIZED:
      "Este link não está autorizado para esta loja ou responsável.",
    WHATSAPP_NUMBER_CHANGE_LINK_TOKEN_REQUIRED:
      "O link de troca de WhatsApp está incompleto.",
    WHATSAPP_NUMBER_CHANGE_LINK_EXPIRED:
      "Este link de troca de WhatsApp expirou. Solicite um novo link.",
    WHATSAPP_NUMBER_CHANGE_LINK_REVOKED:
      "Este link de troca de WhatsApp foi revogado. Solicite um novo link.",
    WHATSAPP_NUMBER_CHANGE_LINK_START_FAILED:
      "Não foi possível autorizar o início da troca de WhatsApp.",
  };

  return {
    ok: false,
    message:
      (errorCode && messageByError[errorCode]) ||
      cleanStartError(body?.message) ||
      "Não foi possível autorizar o início da troca de WhatsApp.",
  };
}

type NumberChangeLinkStartFetcher = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function requestNumberChangeLinkStart(args: {
  token: string;
  fetcher?: NumberChangeLinkStartFetcher;
}) {
  const fetcher = args.fetcher ?? (globalThis.fetch as NumberChangeLinkStartFetcher);
  const response = await fetcher(
    `/api/store/whatsapp/number-change-link?token=${encodeURIComponent(args.token)}`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    },
  );
  const body = await response.json().catch(() => null);
  const result = validateNumberChangeLinkStartResponse({
    httpOk: response.ok,
    body,
  });
  if (!result.ok) throw new Error(result.message);
}

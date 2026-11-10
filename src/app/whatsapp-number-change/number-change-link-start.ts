type NumberChangeLinkStartBody = {
  ok?: unknown;
  status?: unknown;
  error?: unknown;
  message?: unknown;
};

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

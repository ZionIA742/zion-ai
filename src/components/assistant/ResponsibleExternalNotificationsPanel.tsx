"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ResponsibleExternalNotificationItem = {
  id: string;
  status: string | null;
  channel: string | null;
  destinationMasked: string;
  title: string | null;
  rendered_message: string | null;
  related_document_type: string | null;
  related_document_number: string | null;
  related_document_status: string | null;
  external_message_id: string | null;
  sent_at: string | null;
  failed_at: string | null;
  error_text: string | null;
  attempts: number;
  locked_at: string | null;
  processed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ListResponse = {
  ok: boolean;
  items?: ResponsibleExternalNotificationItem[];
  total?: number;
  error?: string;
  message?: string;
};

type ActionResponse = {
  ok: boolean;
  updated?: boolean;
  sent?: boolean;
  notificationId?: string;
  externalMessageId?: string;
  reason?: string;
  message?: string;
};

type Props = {
  organizationId: string | null;
  storeId: string | null;
  enabled?: boolean;
  onTotalChange?: (total: number) => void;
};

const DEFAULT_LIMIT = 10;

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function isOlderThanHours(value: string | null, hours: number) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() > hours * 60 * 60 * 1000;
}

function isOlderThanMinutes(value: string | null, minutes: number) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() > minutes * 60 * 1000;
}

function shortId(value: string | null | undefined) {
  if (!value) return "-";
  return value.length <= 12 ? value : `${value.slice(0, 8)}...`;
}

function normalizeText(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : null;
}

function getStatusLabel(status: string | null | undefined) {
  const normalized = normalizeText(status);
  if (normalized === "materialized") return "Preparado";
  if (normalized === "ready_to_send") return "Pronto para envio manual";
  if (normalized === "processing") return "Processando";
  if (normalized === "sent") return "Enviado";
  if (normalized === "delivered") return "Entregue";
  if (normalized === "read") return "Lido";
  if (normalized === "failed") return "Falhou";
  if (normalized === "cancelled") return "Cancelado";
  return status || "Sem status";
}

function getStatusTone(status: string | null | undefined) {
  const normalized = normalizeText(status);
  if (normalized === "sent" || normalized === "delivered" || normalized === "read") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (normalized === "failed") {
    return "border-red-200 bg-red-50 text-red-800";
  }

  if (normalized === "ready_to_send" || normalized === "processing") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (normalized === "cancelled") {
    return "border-gray-200 bg-gray-100 text-gray-700";
  }

  return "border-gray-200 bg-white text-gray-800";
}

function getDocumentTypeLabel(value: string | null | undefined) {
  return normalizeText(value) === "contract" ? "Contrato" : "Orçamento";
}

function getDocumentStatusLabel(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return "Não informado";
  if (normalized === "pending_review") return "Pendente de revisão";
  if (normalized === "customer_signed") return "Assinado pelo cliente";
  if (normalized === "approved") return "Aprovado";
  if (normalized === "sent") return "Enviado";
  if (normalized === "failed") return "Falhou";
  if (normalized === "cancelled") return "Cancelado";
  return value || "Não informado";
}

function getChannelLabel(value: string | null | undefined) {
  return normalizeText(value) === "whatsapp_responsible"
    ? "WhatsApp do responsável"
    : value || "Não informado";
}

function looksLikeSuspiciousDestination(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text || text === "Não informado" || text === "destino-mascarado") {
    return true;
  }

  return /9999$/.test(text) || /9{3,}/.test(text);
}

function getActionErrorText(result: ActionResponse) {
  if (
    result.reason === "already_sent" ||
    result.reason === "not_ready_to_send" ||
    result.reason === "already_processing_or_not_ready"
  ) {
    return "Este aviso ja foi enviado ou nao esta pronto para envio.";
  }

  if (result.reason === "invalid_status_for_prepare") {
    return "Esse aviso nao pode mais ser preparado no status atual.";
  }

  if (result.reason === "invalid_status_for_cancel") {
    return "Esse aviso nao pode mais ser cancelado no status atual.";
  }

  return result.message || "Nao foi possivel atualizar esse aviso agora.";
}

export default function ResponsibleExternalNotificationsPanel({
  organizationId,
  storeId,
  enabled = true,
  onTotalChange,
}: Props) {
  const [items, setItems] = useState<ResponsibleExternalNotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [actionLoadingKeys, setActionLoadingKeys] = useState<Record<string, boolean>>({});

  const canLoad = enabled && !!organizationId && !!storeId;

  const setActionLoading = useCallback((key: string, loadingState: boolean) => {
    setActionLoadingKeys((current) => {
      if (loadingState) {
        return { ...current, [key]: true };
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const loadItems = useCallback(async () => {
    if (!canLoad || !organizationId || !storeId) return;

    setLoading(true);
    setErrorText(null);

    try {
      const params = new URLSearchParams({
        organizationId,
        storeId,
        limit: String(DEFAULT_LIMIT),
      });

      const response = await fetch(
        `/api/assistant/responsible-external-notifications?${params.toString()}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const result = (await response.json()) as ListResponse;

      if (!response.ok || !result.ok) {
        setErrorText(
          result.message || result.error || "Nao foi possivel carregar a fila externa do responsavel."
        );
        setItems([]);
        onTotalChange?.(0);
        return;
      }

      setItems(Array.isArray(result.items) ? result.items : []);
      const nextTotal = Number(result.total || 0);
      onTotalChange?.(nextTotal);
    } catch (error: unknown) {
      setErrorText(
        getErrorMessage(error) || "Erro inesperado ao carregar a fila externa do responsavel."
      );
      setItems([]);
      onTotalChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [canLoad, onTotalChange, organizationId, storeId]);

  useEffect(() => {
    if (!canLoad) return;
    void loadItems();
  }, [canLoad, loadItems]);

  async function runAction(
    notificationId: string,
    action: "prepare" | "cancel" | "send" | "unlock-processing",
    item?: ResponsibleExternalNotificationItem
  ) {
    if (!canLoad || !organizationId || !storeId) return;

    if (action === "send") {
      const confirmed = window.confirm(
        [
          "Enviar este aviso por WhatsApp para o responsavel?",
          `Documento: ${item?.related_document_number || "Nao informado"}`,
          `Destino: ${item?.destinationMasked || "Nao informado"}`,
          "Esta acao enviara uma mensagem real e nao pode ser desfeita.",
        ].join("\n")
      );

      if (!confirmed) {
        return;
      }
    }

    if (action === "unlock-processing") {
      const confirmed = window.confirm(
        "Este aviso parece preso em processamento. Deseja marcar como falhou para poder revisar e preparar novamente?"
      );

      if (!confirmed) {
        return;
      }
    }

    const actionKey = `${notificationId}:${action}`;
    setActionLoading(actionKey, true);
    setErrorText(null);
    setStatusText(null);

    try {
      const response = await fetch(
        action === "send"
          ? "/api/assistant/responsible-external-notifications/send"
          : action === "unlock-processing"
            ? "/api/assistant/responsible-external-notifications/unlock-processing"
          : `/api/assistant/responsible-external-notifications/${action}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            organizationId,
            storeId,
            notificationId,
          }),
        }
      );

      const result = (await response.json()) as ActionResponse;

      if (!response.ok || !result.ok) {
        setErrorText(getActionErrorText(result));
        return;
      }

      setStatusText(
        action === "prepare"
          ? "Aviso preparado para envio manual."
          : action === "cancel"
            ? "Aviso cancelado com sucesso."
            : action === "unlock-processing"
              ? "Aviso marcado como falhou para nova revisao."
            : "Aviso enviado por WhatsApp ao responsavel."
      );

      await loadItems();
    } catch (error: unknown) {
      setErrorText(getErrorMessage(error) || "Nao foi possivel atualizar esse aviso agora.");
    } finally {
      setActionLoading(actionKey, false);
    }
  }

  const summary = useMemo(() => {
    return items.reduce<Record<string, number>>((acc, item) => {
      const key = normalizeText(item.status) || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [items]);

  return (
    <div className="shrink-0 border-b border-black/10 bg-[#fcfcfc] px-3 py-3">
      <div className="rounded-2xl border border-black/10 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="max-w-3xl text-[12px] leading-5 text-gray-600">
              Prepare, cancele e envie avisos unitários ao responsável. O envio real exige
              confirmação e nunca acontece automaticamente ou em lote.
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadItems()}
            disabled={!canLoad || loading}
            className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Atualizando..." : "Atualizar"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-gray-600">
          {summary.materialized ? (
            <span className="rounded-full bg-gray-50 px-2.5 py-1 ring-1 ring-black/10">
              Preparados: {summary.materialized}
            </span>
          ) : null}
          {summary.ready_to_send ? (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-900 ring-1 ring-amber-200">
              Prontos: {summary.ready_to_send}
            </span>
          ) : null}
          {summary.failed ? (
            <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-800 ring-1 ring-red-200">
              Falharam: {summary.failed}
            </span>
          ) : null}
          {summary.sent ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800 ring-1 ring-emerald-200">
              Enviados: {summary.sent}
            </span>
          ) : null}
        </div>

        {errorText ? (
          <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-800 ring-1 ring-red-200">
            {errorText}
          </div>
        ) : null}

        {statusText ? (
          <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800 ring-1 ring-emerald-200">
            {statusText}
          </div>
        ) : null}

        <div className="mt-3">
            {items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-[#fafafa] px-4 py-4 text-[12px] text-gray-500">
                Nenhum aviso externo encontrado para a loja ativa.
              </div>
            ) : (
              <div className="overflow-x-hidden">
                <div className="space-y-2">
                  {items.map((item) => {
                    const normalizedStatus = normalizeText(item.status);
                    const canPrepare =
                      normalizedStatus === "materialized" || normalizedStatus === "failed";
                    const canSend = normalizedStatus === "ready_to_send";
                    const canShowOldAlert =
                      (normalizedStatus === "materialized" ||
                        normalizedStatus === "ready_to_send" ||
                        normalizedStatus === "failed") &&
                      isOlderThanHours(item.created_at, 24);
                    const showSuspiciousDestinationAlert = looksLikeSuspiciousDestination(
                      item.destinationMasked
                    );
                    const canCancel =
                      normalizedStatus === "materialized" ||
                      normalizedStatus === "ready_to_send" ||
                      normalizedStatus === "failed";
                    const canUnlockProcessing =
                      normalizedStatus === "processing" &&
                      isOlderThanMinutes(item.locked_at, 10);
                    const prepareLoading =
                      actionLoadingKeys[`${item.id}:prepare`] === true;
                    const sendLoading =
                      actionLoadingKeys[`${item.id}:send`] === true;
                    const unlockLoading =
                      actionLoadingKeys[`${item.id}:unlock-processing`] === true;
                    const cancelLoading =
                      actionLoadingKeys[`${item.id}:cancel`] === true;

                    return (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-black/10 bg-[#fafafa] p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${getStatusTone(
                              item.status
                            )}`}
                          >
                            {getStatusLabel(item.status)}
                          </span>
                          <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-gray-700 ring-1 ring-black/10">
                            {item.destinationMasked}
                          </span>
                          <span className="text-[11px] text-gray-500">
                            Tentativas: {item.attempts}
                          </span>
                        </div>

                        <div className="mt-2 text-[13px] font-semibold text-gray-900">
                          {item.title || "Aviso externo da Assistente"}
                        </div>

                        <div className="mt-2 whitespace-pre-wrap rounded-xl bg-white px-3 py-2 text-[12px] leading-5 text-gray-700 ring-1 ring-black/5">
                          {item.rendered_message || "Mensagem não informada."}
                        </div>

                        {canShowOldAlert ? (
                          <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-900 ring-1 ring-amber-200">
                            Este aviso é antigo. Revise antes de enviar.
                          </div>
                        ) : null}

                        {showSuspiciousDestinationAlert ? (
                          <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-900 ring-1 ring-amber-200">
                            Confira o número do responsável antes de enviar este aviso.
                          </div>
                        ) : null}

                        <div className="mt-2 grid gap-2 rounded-xl bg-white px-3 py-3 text-[12px] leading-5 text-gray-700 ring-1 ring-black/5 md:grid-cols-2">
                          <div>
                            <span className="font-semibold text-gray-900">Documento:</span>{" "}
                            {item.related_document_type
                              ? getDocumentTypeLabel(item.related_document_type)
                              : "Não informado"}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-900">Numero:</span>{" "}
                            {item.related_document_number || "Não informado"}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-900">Status do documento:</span>{" "}
                            {getDocumentStatusLabel(item.related_document_status)}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-900">Canal:</span>{" "}
                            {getChannelLabel(item.channel)}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-900">Criado em:</span>{" "}
                            {formatDateTime(item.created_at)}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-900">Atualizado em:</span>{" "}
                            {formatDateTime(item.updated_at)}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-900">Processado em:</span>{" "}
                            {formatDateTime(item.processed_at)}
                          </div>
                        </div>

                        {item.external_message_id || item.sent_at ? (
                          <div className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800 ring-1 ring-emerald-200">
                            Enviado{item.external_message_id ? ` • ${shortId(item.external_message_id)}` : ""}
                            {item.sent_at ? ` • ${formatDateTime(item.sent_at)}` : ""}
                          </div>
                        ) : null}

                        {item.failed_at || item.error_text ? (
                          <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[11px] text-red-800 ring-1 ring-red-200">
                            <div>Falha ao enviar. Você pode revisar o aviso e preparar novamente.</div>
                            {item.failed_at ? (
                              <div className="mt-1">Falhou em {formatDateTime(item.failed_at)}.</div>
                            ) : null}
                            {item.error_text ? (
                              <div className="mt-1 text-[10px] text-red-700">
                                <span className="font-semibold">Detalhe técnico:</span>{" "}
                                {item.error_text}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {canPrepare || canCancel || canSend || canUnlockProcessing ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {canPrepare ? (
                              <button
                                type="button"
                                onClick={() => void runAction(item.id, "prepare")}
                                disabled={
                                  prepareLoading || cancelLoading || sendLoading || unlockLoading
                                }
                                className="rounded-full bg-black px-3 py-1.5 text-[11px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {prepareLoading
                                  ? "Preparando..."
                                  : normalizedStatus === "failed"
                                    ? "Preparar novamente"
                                    : "Preparar para envio manual"}
                              </button>
                            ) : null}

                            {canCancel ? (
                              <button
                                type="button"
                                onClick={() => void runAction(item.id, "cancel")}
                                disabled={
                                  prepareLoading || cancelLoading || sendLoading || unlockLoading
                                }
                                className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {cancelLoading ? "Cancelando..." : "Cancelar aviso"}
                              </button>
                            ) : null}

                            {canSend ? (
                              <button
                                type="button"
                                onClick={() => void runAction(item.id, "send", item)}
                                disabled={
                                  prepareLoading || cancelLoading || sendLoading || unlockLoading
                                }
                                className="rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {sendLoading
                                  ? "Enviando WhatsApp..."
                                  : "Enviar WhatsApp ao responsável"}
                              </button>
                            ) : null}

                            {canUnlockProcessing ? (
                              <button
                                type="button"
                                onClick={() => void runAction(item.id, "unlock-processing", item)}
                                disabled={
                                  prepareLoading || cancelLoading || sendLoading || unlockLoading
                                }
                                className="rounded-full bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {unlockLoading ? "Marcando falha..." : "Marcar como falhou"}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

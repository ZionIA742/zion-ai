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
  reason?: string;
  message?: string;
};

type Props = {
  organizationId: string | null;
  storeId: string | null;
  enabled?: boolean;
};

const DEFAULT_LIMIT = 10;

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function shortId(value: string | null | undefined) {
  if (!value) return "-";
  return value.length <= 12 ? value : `${value.slice(0, 8)}...`;
}

function normalizeText(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function getStatusLabel(status: string | null | undefined) {
  const normalized = normalizeText(status);
  if (normalized === "materialized") return "Materializado";
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
  return normalizeText(value) === "contract" ? "Contrato" : "Orcamento";
}

function getDocumentStatusLabel(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return "Nao informado";
  if (normalized === "pending_review") return "Pendente de revisao";
  if (normalized === "customer_signed") return "Assinado pelo cliente";
  if (normalized === "approved") return "Aprovado";
  if (normalized === "sent") return "Enviado";
  if (normalized === "failed") return "Falhou";
  if (normalized === "cancelled") return "Cancelado";
  return value || "Nao informado";
}

function getActionErrorText(result: ActionResponse) {
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
}: Props) {
  const [items, setItems] = useState<ResponsibleExternalNotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
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
        setTotal(0);
        return;
      }

      setItems(Array.isArray(result.items) ? result.items : []);
      setTotal(Number(result.total || 0));
    } catch (error: any) {
      setErrorText(
        error?.message || "Erro inesperado ao carregar a fila externa do responsavel."
      );
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [canLoad, organizationId, storeId]);

  useEffect(() => {
    if (!canLoad) {
      setItems([]);
      setTotal(0);
      setErrorText(null);
      return;
    }

    void loadItems();
  }, [canLoad, loadItems]);

  async function runAction(
    notificationId: string,
    action: "prepare" | "cancel"
  ) {
    if (!canLoad || !organizationId || !storeId) return;

    const actionKey = `${notificationId}:${action}`;
    setActionLoading(actionKey, true);
    setErrorText(null);
    setStatusText(null);

    try {
      const response = await fetch(
        `/api/assistant/responsible-external-notifications/${action}`,
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
          : "Aviso cancelado com sucesso."
      );

      await loadItems();
    } catch (error: any) {
      setErrorText(error?.message || "Nao foi possivel atualizar esse aviso agora.");
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
            <div className="text-sm font-bold text-gray-900">
              Fila externa do responsavel
            </div>
            <div className="mt-1 max-w-3xl text-[12px] leading-5 text-gray-600">
              Este painel nao envia WhatsApp. Ele apenas prepara ou cancela avisos
              externos da Assistente.
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void loadItems()}
              disabled={!canLoad || loading}
              className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Atualizando..." : "Atualizar"}
            </button>

            <button
              type="button"
              onClick={() => setCollapsed((current) => !current)}
              className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
            >
              {collapsed ? "Mostrar fila" : "Ocultar fila"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-gray-600">
          <span className="rounded-full bg-gray-50 px-2.5 py-1 ring-1 ring-black/10">
            Itens: {total}
          </span>
          {summary.materialized ? (
            <span className="rounded-full bg-gray-50 px-2.5 py-1 ring-1 ring-black/10">
              Materializados: {summary.materialized}
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

        {!collapsed ? (
          <div className="mt-3">
            {items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-[#fafafa] px-4 py-4 text-[12px] text-gray-500">
                Nenhum aviso externo encontrado para a loja ativa.
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto overflow-x-hidden pr-1">
                <div className="space-y-2">
                  {items.map((item) => {
                    const normalizedStatus = normalizeText(item.status);
                    const canPrepare =
                      normalizedStatus === "materialized" || normalizedStatus === "failed";
                    const canCancel =
                      normalizedStatus === "materialized" ||
                      normalizedStatus === "ready_to_send" ||
                      normalizedStatus === "failed";
                    const prepareLoading =
                      actionLoadingKeys[`${item.id}:prepare`] === true;
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
                          {item.rendered_message || "Mensagem nao informada."}
                        </div>

                        <div className="mt-2 grid gap-2 rounded-xl bg-white px-3 py-3 text-[12px] leading-5 text-gray-700 ring-1 ring-black/5 md:grid-cols-2">
                          <div>
                            <span className="font-semibold text-gray-900">Documento:</span>{" "}
                            {item.related_document_type
                              ? getDocumentTypeLabel(item.related_document_type)
                              : "Nao informado"}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-900">Numero:</span>{" "}
                            {item.related_document_number || "Nao informado"}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-900">Status do documento:</span>{" "}
                            {getDocumentStatusLabel(item.related_document_status)}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-900">Canal:</span>{" "}
                            {item.channel || "Nao informado"}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-900">Criado em:</span>{" "}
                            {formatDateTime(item.created_at)}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-900">Atualizado em:</span>{" "}
                            {formatDateTime(item.updated_at)}
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
                            {item.failed_at ? `Falhou em ${formatDateTime(item.failed_at)}.` : "Falhou."}
                            {item.error_text ? ` ${item.error_text}` : ""}
                          </div>
                        ) : null}

                        {canPrepare || canCancel ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {canPrepare ? (
                              <button
                                type="button"
                                onClick={() => void runAction(item.id, "prepare")}
                                disabled={prepareLoading || cancelLoading}
                                className="rounded-full bg-black px-3 py-1.5 text-[11px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {prepareLoading
                                  ? "Preparando..."
                                  : "Preparar para envio manual"}
                              </button>
                            ) : null}

                            {canCancel ? (
                              <button
                                type="button"
                                onClick={() => void runAction(item.id, "cancel")}
                                disabled={prepareLoading || cancelLoading}
                                className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {cancelLoading ? "Cancelando..." : "Cancelar aviso"}
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
        ) : null}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";

type StoreOption = {
  id: string;
  name: string;
  organizationName?: string | null;
};

type Diagnostic = {
  incidentId: string;
  occurrenceId: string | null;
  organizationId: string;
  storeId: string;
  status: string | null;
  severity: string | null;
  causeConfidence: string | null;
  title: string | null;
  explanation: string | null;
  impact: string | null;
  nextAction: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  occurredAt: string | null;
  capturedAt: string | null;
  errorCode: string | null;
  sourceRecordId: string | null;
  occurrenceCount: number | null;
  historical: boolean;
};

type LoadResult = {
  key: string;
  items: Diagnostic[];
  error: boolean;
};

const PAGE_SIZE = 20;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function parseDiagnostic(value: unknown): Diagnostic | null {
  if (!isRecord(value)) return null;

  const incidentId = optionalText(value.incident_id);
  const organizationId = optionalText(value.organization_id);
  const storeId = optionalText(value.store_id);

  if (
    !incidentId ||
    !organizationId ||
    !storeId ||
    !UUID_PATTERN.test(incidentId) ||
    !UUID_PATTERN.test(organizationId) ||
    !UUID_PATTERN.test(storeId) ||
    typeof value.last_failure_older_than_30_days !== "boolean"
  ) {
    return null;
  }

  const count = value.occurrence_count;

  return {
    incidentId,
    occurrenceId: optionalText(value.occurrence_id),
    organizationId,
    storeId,
    status: optionalText(value.incident_status),
    severity: optionalText(value.severity),
    causeConfidence: optionalText(value.cause_confidence),
    title: optionalText(value.title_simple),
    explanation: optionalText(value.explanation_simple),
    impact: optionalText(value.impact_simple),
    nextAction: optionalText(value.next_action_simple),
    firstSeenAt: optionalText(value.first_seen_at),
    lastSeenAt: optionalText(value.last_seen_at),
    occurredAt: optionalText(value.occurred_at),
    capturedAt: optionalText(value.captured_at),
    errorCode: optionalText(value.technical_error_code),
    sourceRecordId: optionalText(value.source_record_id),
    occurrenceCount:
      typeof count === "number" &&
      Number.isSafeInteger(count) &&
      count >= 0
        ? count
        : null,
    historical: value.last_failure_older_than_30_days,
  };
}

function formatDiagnosticDate(value: string | null): string {
  if (!value) return "Não informado";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Não informado";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function buildTechnicalText(
  item: Diagnostic,
  storeName: string,
): string {
  return [
    "ZION Administrador - Diagnóstico de IA",
    `Loja: ${storeName}`,
    `Loja ID: ${item.storeId}`,
    `Organização ID: ${item.organizationId}`,
    `Incidente ID: ${item.incidentId}`,
    `Ocorrência ID: ${item.occurrenceId ?? "Indisponível"}`,
    `Execução de origem: ${item.sourceRecordId ?? "Indisponível"}`,
    "Sistema de origem: ai_runs",
    `Código técnico: ${item.errorCode ?? "Indisponível"}`,
    `Situação administrativa: ${item.status ?? "Indisponível"}`,
    `Gravidade registrada: ${item.severity ?? "Indisponível"}`,
    `Confiança da causa: ${item.causeConfidence ?? "Indisponível"}`,
    `Ocorrências vinculadas: ${item.occurrenceCount ?? "Indisponível"}`,
    `Primeiro registro: ${formatDiagnosticDate(item.firstSeenAt)}`,
    `Última falha registrada: ${formatDiagnosticDate(item.lastSeenAt)}`,
    `Data da ocorrência: ${formatDiagnosticDate(item.occurredAt)}`,
    `Data da captura: ${formatDiagnosticDate(item.capturedAt)}`,
    `Última falha com mais de 30 dias: ${item.historical ? "Sim" : "Não"}`,
    `Resumo: ${item.title ?? "Não informado"}`,
    `Explicação: ${item.explanation ?? "Não informada"}`,
    `Impacto: ${item.impact ?? "Não confirmado"}`,
    `Próxima verificação: ${item.nextAction ?? "Não informada"}`,
    "Mensagem original de erro: não armazenada nesta versão.",
    "Stack trace: não armazenado nesta versão.",
    "O estado aberto não comprova falha ativa.",
  ].join("\n");
}

export default function ZionAdminDiagnosticIncidents({
  stores,
}: {
  stores: readonly StoreOption[];
}) {
  const [storeFilter, setStoreFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [copyStatus, setCopyStatus] = useState<{
    incidentId: string;
    success: boolean;
  } | null>(null);

  const requestKey = `${storeFilter || "all"}:${offset}`;

  const storeNames = useMemo(() => {
    return new Map(
      stores.map((store) => [
        store.id.toLowerCase(),
        store.name,
      ]),
    );
  }, [stores]);

  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });

    if (storeFilter) {
      parameters.set("store_id", storeFilter);
    }

    async function load() {
      try {
        const response = await fetch(
          `/api/zion-admin/diagnostics?${parameters.toString()}`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error("DIAGNOSTICS_REQUEST_UNAVAILABLE");
        }

        const payload: unknown = await response.json();

        if (
          !isRecord(payload) ||
          payload.ok !== true ||
          payload.source !== "ai_runs" ||
          !Array.isArray(payload.items) ||
          payload.items.length > PAGE_SIZE
        ) {
          throw new Error("DIAGNOSTICS_INVALID_RESPONSE");
        }

        const items: Diagnostic[] = [];

        for (const row of payload.items) {
          const parsed = parseDiagnostic(row);

          if (!parsed) {
            throw new Error("DIAGNOSTICS_INVALID_ITEM");
          }

          items.push(parsed);
        }

        if (!controller.signal.aborted) {
          setResult({ key: requestKey, items, error: false });
        }
      } catch {
        if (!controller.signal.aborted) {
          setResult({
            key: requestKey,
            items: [],
            error: true,
          });
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [requestKey, offset, storeFilter]);

  const loading = result?.key !== requestKey;
  const items = loading ? [] : (result?.items ?? []);
  const error = !loading && result?.error === true;

  async function copyTechnicalDetails(item: Diagnostic) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("CLIPBOARD_UNAVAILABLE");
      }

      await navigator.clipboard.writeText(
        buildTechnicalText(
          item,
          storeNames.get(item.storeId.toLowerCase()) ??
            "Loja não identificada",
        ),
      );

      setCopyStatus({
        incidentId: item.incidentId,
        success: true,
      });
    } catch {
      setCopyStatus({
        incidentId: item.incidentId,
        success: false,
      });
    }
  }

  return (
    <section
      aria-label="Diagnósticos persistidos da IA"
      className="space-y-3 rounded-xl border border-[#305362] bg-[#101d27] p-3"
    >
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-[#d6f5fa]">
          Diagnósticos registrados
        </h4>
        <p className="text-xs leading-5 text-[#9ab4c3]">
          Ocorrências guardadas para investigação. Uma falha
          antiga ou um incidente aberto não significa que a
          loja esteja com problema neste momento.
        </p>
      </div>

      <label className="block space-y-1 text-xs text-[#bed4df]">
        <span>Filtrar por loja</span>
        <select
          value={storeFilter}
          onChange={(event) => {
            setStoreFilter(event.target.value);
            setOffset(0);
            setCopyStatus(null);
          }}
          className="w-full rounded-lg border border-[#385563] bg-[#0b1720] px-3 py-2 text-[#e7f2f5]"
        >
          <option value="">Todas as lojas</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </label>

      {loading ? (
        <p role="status" className="text-xs text-[#afc5d0]">
          Consultando diagnósticos...
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-amber-200">
          Não foi possível consultar os diagnósticos. Isso
          não significa que não existam erros registrados.
        </p>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <p className="text-xs text-[#a8beca]">
          Nenhum diagnóstico retornado nesta página.
          Outras fontes de falhas ainda podem existir.
        </p>
      ) : null}

      {!loading && !error ? items.map((item) => {
        const storeName =
          storeNames.get(item.storeId.toLowerCase()) ??
          "Loja não identificada";

        const technical = buildTechnicalText(item, storeName);

        return (
          <details
            key={item.incidentId}
            className="rounded-lg border border-[#344b58] bg-[#0b151d] p-3"
          >
            <summary className="cursor-pointer text-xs text-[#e4f1f5]">
              <span className="font-semibold">
                {item.title ?? "Erro registrado na IA"}
              </span>
              <span className="block mt-1 text-[#9fb8c6]">
                {storeName} ·{" "}
                {formatDiagnosticDate(
                  item.occurredAt ?? item.lastSeenAt,
                )}
              </span>
              <span className="block mt-1 text-[#91cad4]">
                {item.historical
                  ? "Última falha registrada há mais de 30 dias"
                  : "Registro recente — atividade atual não confirmada"}
              </span>
            </summary>

            <div className="mt-3 space-y-3 border-t border-[#304550] pt-3 text-xs leading-5 text-[#b8ccd5]">
              <div className="space-y-1">
                <p className="font-semibold text-white">
                  O que aconteceu
                </p>
                <p>
                  {item.explanation ??
                    "Uma execução da IA apresentou um erro. A causa ainda é desconhecida."}
                </p>
              </div>

              <div className="space-y-1">
                <p className="font-semibold text-white">
                  Impacto
                </p>
                <p>
                  {item.impact ??
                    "Não foi possível confirmar o impacto na loja."}
                </p>
              </div>

              <div className="space-y-1">
                <p className="font-semibold text-white">
                  O que fazer
                </p>
                <p>
                  {item.nextAction ??
                    "Investigar o registro antes de concluir a causa."}
                </p>
              </div>

              <div className="space-y-2 border-t border-[#304550] pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-[#d4f4fa]">
                    Detalhes técnicos
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void copyTechnicalDetails(item);
                    }}
                    className="rounded-lg border border-[#39758a] px-3 py-1.5 font-medium text-[#bcecf4] hover:bg-[#183442]"
                  >
                    Copiar detalhes
                  </button>
                </div>

                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[#07121a] p-3 text-[11px] text-[#b4cbd7]">
                  {technical}
                </pre>

                {copyStatus?.incidentId === item.incidentId ? (
                  <p role="status">
                    {copyStatus.success
                      ? "Detalhes copiados."
                      : "Não foi possível copiar automaticamente. Selecione o texto acima."}
                  </p>
                ) : null}
              </div>
            </div>
          </details>
        );
      }) : null}

      {!loading && !error ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-[#9ab2bf]">
            Página {Math.floor(offset / PAGE_SIZE) + 1}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => {
                setOffset(Math.max(0, offset - PAGE_SIZE));
                setCopyStatus(null);
              }}
              className="rounded-lg border border-[#385563] px-3 py-1.5 text-[#d9e9ee] disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={items.length < PAGE_SIZE}
              onClick={() => {
                setOffset(offset + PAGE_SIZE);
                setCopyStatus(null);
              }}
              className="rounded-lg border border-[#385563] px-3 py-1.5 text-[#d9e9ee] disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

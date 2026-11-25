"use client";

import { useEffect, useMemo, useState } from "react";

type StoreOption = {
  id: string;
  name: string;
  organizationName?: string | null;
};

const DIAGNOSTIC_V2_MODELS = new Set<string>([
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.3",
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6",
  "gpt-6",
]);

type DiagnosticEvidenceV2 = {
  registeredComponent:
    | "sales_ai"
    | "assistant_ai"
    | "ai_origin_unknown"
    | "unknown";
  provenOrigin: "assistant_ai" | "unknown";
  executionType: "assistant_chat" | null;
  provider: "openai" | null;
  model: string | null;
  runStatus: string | null;
  latencyMs: number | null;
};

type Diagnostic = {
  incidentId: string;
  occurrenceId: string | null;
  organizationId: string | null;
  storeId: string | null;
  scope: "system" | "organization" | "store";
  sourceFamily: "ai_runs" | "operational" | "backend_api";
  sourceSystem: string;
  component: string | null;
  category: string | null;
  resolvedAt: string | null;
  technicalLocation: string[];
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
  v2Evidence: DiagnosticEvidenceV2 | null;
};

type LoadResult = {
  key: string;
  source?: "ai_runs" | "unified";
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

function parseEvidenceV2(
  value: Record<string, unknown>,
): DiagnosticEvidenceV2 | null {
  if (
    !Object.prototype.hasOwnProperty.call(
      value,
      "registered_component",
    )
  ) {
    return null;
  }

  const rawComponent = value.registered_component;

  const registeredComponent =
    rawComponent === "sales_ai" ||
    rawComponent === "assistant_ai" ||
    rawComponent === "ai_origin_unknown"
      ? rawComponent
      : "unknown";

  const provenAssistant =
    registeredComponent === "assistant_ai" &&
    value.evidence_origin === "assistant_ai" &&
    value.evidence_execution_type === "assistant_chat";

  const provider =
    value.evidence_provider === "openai" ? "openai" : null;

  const candidateModel = value.evidence_model;

  const model =
    provider === "openai" &&
    typeof candidateModel === "string" &&
    DIAGNOSTIC_V2_MODELS.has(candidateModel)
      ? candidateModel
      : null;

  const rawStatus = value.evidence_run_status;

  const runStatus =
    rawStatus === "queued" ||
    rawStatus === "running" ||
    rawStatus === "completed" ||
    rawStatus === "failed" ||
    rawStatus === "error" ||
    rawStatus === "success" ||
    rawStatus === "cancelled"
      ? rawStatus
      : null;

  const rawLatency = value.evidence_latency_ms;

  const latencyMs =
    typeof rawLatency === "number" &&
    Number.isSafeInteger(rawLatency) &&
    rawLatency >= 0 &&
    rawLatency <= 86400000
      ? rawLatency
      : null;

  return {
    registeredComponent,
    provenOrigin: provenAssistant ? "assistant_ai" : "unknown",
    executionType: provenAssistant ? "assistant_chat" : null,
    provider,
    model,
    runStatus,
    latencyMs,
  };
}

function parseDiagnostic(value: unknown): Diagnostic | null {
  if (!isRecord(value)) return null;

  const incidentId = optionalText(value.incident_id);
  const organizationId = optionalText(value.organization_id);
  const storeId = optionalText(value.store_id);

  const scope = value.scope === undefined ? "store" : value.scope;
  const family = value.source_family === undefined ? "ai_runs" : value.source_family;
  const origin = value.source_system === undefined ? "ai_runs" : value.source_system;
  if (
    !incidentId || !UUID_PATTERN.test(incidentId) ||
    !(scope === "system" && value.organization_id === null && value.store_id === null ||
      scope === "organization" && !!organizationId && UUID_PATTERN.test(organizationId) && value.store_id === null ||
      scope === "store" && !!organizationId && !!storeId && UUID_PATTERN.test(organizationId) && UUID_PATTERN.test(storeId)) ||
    !(family === "ai_runs" && origin === "ai_runs" && scope === "store" ||
      family === "operational" && scope === "store" && (origin === "channel_whatsapp_inbox" || origin === "ai_run_queue" || origin === "ai_sales_action_queue") ||
      family === "backend_api" && origin === "backend_api") ||
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
    scope,
    sourceFamily: family,
    sourceSystem: origin,
    component: optionalText(value.component),
    category: optionalText(value.category),
    resolvedAt: optionalText(value.resolved_at),
    technicalLocation: buildLocationLines(value, family),
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
    v2Evidence: family === "ai_runs" ? parseEvidenceV2(value) : null,
  };
}

function buildLocationLines(value: Record<string, unknown>, family: string): string[] {
  const path = (v: unknown, prefix: string, limit: number) => typeof v === "string" && v.startsWith(prefix) && v.length <= limit && /^[a-zA-Z0-9_./\[\]()-]+$/.test(v) && !v.includes("..") ? v : null;
  const integer = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : null;
  if (family === "operational") return ["Tentativas registradas: " + (integer(value.operational_attempt_count, 0, 2147483647) ?? "Indisponível")];
  if (family !== "backend_api") return [];
  const file = path(value.backend_source_file, "src/", 300);
  return [
    "Rota: " + (path(value.backend_route, "/api/", 200) ?? "Indisponível"),
    "Método HTTP: " + (optionalText(value.backend_method) ?? "Indisponível"),
    "Tipo de falha: " + (optionalText(value.backend_kind) ?? "Indisponível"),
    "Status HTTP: " + (integer(value.backend_http_status, 500, 599) ?? "Indisponível"),
    "Nome técnico: " + (optionalText(value.backend_error_name) ?? "Indisponível"),
    "Código reportado: " + (optionalText(value.backend_reported_error_code) ?? "Indisponível"),
    "Arquivo: " + (file ?? "Indisponível"),
    "Linha: " + (file ? integer(value.backend_source_line, 1, 1000000) ?? "Indisponível" : "Indisponível"),
    "Coluna: " + (file ? integer(value.backend_source_column, 1, 1000000) ?? "Indisponível" : "Indisponível"),
  ];
}
function diagnosticLocation(item: Diagnostic, names: ReadonlyMap<string, string>): string {
  if (item.scope === "system") return "Sistema ZION";
  if (item.scope === "organization") return "Organização " + item.organizationId;
  return names.get(item.storeId?.toLowerCase() ?? "") ?? "Loja não identificada";
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

function buildEvidenceV2Lines(
  evidence: DiagnosticEvidenceV2 | null,
): string[] {
  if (!evidence) {
    return [
      "Evidências estruturadas V2: indisponíveis nesta consulta.",
    ];
  }

  const component =
    evidence.registeredComponent === "sales_ai"
      ? "sales_ai (classificação histórica; não comprova IA Vendedora)"
      : evidence.registeredComponent === "assistant_ai"
        ? "assistant_ai (verificar origem comprovada abaixo)"
        : evidence.registeredComponent === "ai_origin_unknown"
          ? "Origem não identificada"
          : "Classificação indisponível";

  return [
    "Evidências estruturadas V2: disponíveis",
    "Componente registrado: " + component,
    "Origem comprovada: " +
      (evidence.provenOrigin === "assistant_ai"
        ? "IA Assistente"
        : "Não identificada por evidência"),
    "Tipo de execução: " +
      (evidence.executionType ?? "Indisponível"),
    "Provedor registrado: " +
      (evidence.provider ?? "Indisponível"),
    "Modelo registrado: " +
      (evidence.model ?? "Indisponível"),
    "Estado registrado da execução: " +
      (evidence.runStatus ?? "Indisponível"),
    "Latência registrada: " +
      (evidence.latencyMs === null
        ? "Indisponível"
        : String(evidence.latencyMs) + " ms"),
  ];
}

function buildTechnicalText(
  item: Diagnostic,
  storeName: string,
): string {
  return [
    item.sourceFamily === "ai_runs" ? "ZION Administrador - Diagnóstico de IA" : "ZION Administrador - Diagnóstico de incidente",
    `Escopo: ${item.scope}`,
    `Loja: ${storeName}`,
    `Loja ID: ${item.storeId ?? "Não se aplica"}`,
    `Organização ID: ${item.organizationId ?? "Não se aplica"}`,
    `Incidente ID: ${item.incidentId}`,
    `Ocorrência ID: ${item.occurrenceId ?? "Indisponível"}`,
    `Execução de origem: ${item.sourceRecordId ?? "Indisponível"}`,
    `Sistema de origem: ${item.sourceSystem}`,
    `Componente: ${item.component ?? "Indisponível"}`,
    `Categoria: ${item.category ?? "Indisponível"}`,
    ...item.technicalLocation,
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
    ...(item.sourceFamily === "ai_runs" ? [...buildEvidenceV2Lines(item.v2Evidence)] : []),
    `Resolução administrativa registrada: ${formatDiagnosticDate(item.resolvedAt)}`,
    "Recuperação operacional: não comprovada por este registro.",
    "Situação operacional atual: não verificada por este diagnóstico.",
    "O estado aberto não comprova falha ativa.",
  ].join("\n");
}

export default function ZionAdminDiagnosticIncidents({
  stores,
}: {
  stores: readonly StoreOption[];
}) {
  const [storeFilter, setStoreFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [copyStatus, setCopyStatus] = useState<{
    incidentId: string;
    success: boolean;
  } | null>(null);

  const requestKey = `${storeFilter || "all"}:${sourceFilter || "all"}:${offset}`;

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

    if (sourceFilter) parameters.set("source", sourceFilter);

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
          (payload.source !== "ai_runs" && payload.source !== "unified") ||
          !Array.isArray(payload.items) ||
          payload.items.length > PAGE_SIZE
        ) {
          throw new Error("DIAGNOSTICS_INVALID_RESPONSE");
        }

        const items: Diagnostic[] = [];

        for (const row of payload.items) {
          const parsed = parseDiagnostic(row);

          if (!parsed || (payload.source === "unified" && (!isRecord(row) || row.source_family === undefined || row.scope === undefined || row.source_system === undefined)) || (payload.source === "ai_runs" && parsed.sourceFamily !== "ai_runs")) {
            throw new Error("DIAGNOSTICS_INVALID_ITEM");
          }

          items.push(parsed);
        }

        if (!controller.signal.aborted) {
          setResult({ key: requestKey, source: payload.source, items, error: false });
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
  }, [requestKey, offset, storeFilter, sourceFilter]);

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
          diagnosticLocation(item, storeNames),
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
      aria-label="Diagnósticos persistidos"
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

      <label className="block space-y-1 text-xs text-[#bed4df]">
        <span>Filtrar por origem</span>
        <select value={sourceFilter} disabled={result?.source !== "unified" && !sourceFilter}
          onChange={(event) => { setSourceFilter(event.target.value); setOffset(0); setCopyStatus(null); }}
          className="w-full rounded-lg border border-[#385563] bg-[#0b1720] px-3 py-2 text-[#e7f2f5]">
          <option value="">Todas as origens disponíveis</option>
          <option value="ai_runs">Execuções de IA</option>
          <option value="operational">Filas operacionais</option>
          <option value="backend_api">Backend e APIs</option>
        </select>
      </label>
      {result?.source === "ai_runs" && !loading ? <p className="text-xs text-[#9ab4c3]">Leitor anterior ativo: somente incidentes de IA.</p> : null}
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
          diagnosticLocation(item, storeNames);

        const technical = buildTechnicalText(item, storeName);

        return (
          <details
            key={item.incidentId}
            className="rounded-lg border border-[#344b58] bg-[#0b151d] p-3"
          >
            <summary className="cursor-pointer text-xs text-[#e4f1f5]">
              <span className="font-semibold">
                {item.title ?? "Erro registrado"}
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
                    "Uma falha foi registrada. A causa ainda é desconhecida."}
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
              disabled={items.length < PAGE_SIZE || offset >= 5000}
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

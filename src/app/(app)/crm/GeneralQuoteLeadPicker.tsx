"use client";

import { useEffect, useState } from "react";

import {
  loadGeneralQuoteLeadPage,
  type GeneralQuoteLead,
} from "./general-quote-model";

type Props = {
  organizationId: string;
  storeId: string;
  disabled: boolean;
  onSelect: (lead: GeneralQuoteLead) => void;
  onCancel: () => void;
};

type Page = Awaited<ReturnType<typeof loadGeneralQuoteLeadPage>>;

type SearchRequest = {
  search: string;
  offset: number;
};

export default function GeneralQuoteLeadPicker({
  organizationId,
  storeId,
  disabled,
  onSelect,
  onCancel,
}: Props) {
  const [search, setSearch] = useState("");

  const [request, setRequest] =
    useState<SearchRequest>({ search: "", offset: 0 });

  const [result, setResult] = useState<{
    request: SearchRequest;
    page: Page | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void loadGeneralQuoteLeadPage(
      { organizationId, storeId },
      request,
      fetch,
      controller.signal,
    ).then(page => {
      if (!cancelled) {
        setResult({ request, page, error: null });
      }
    }).catch(error => {
      if (!cancelled && !controller.signal.aborted) {
        setResult({
          request,
          page: null,
          error: error instanceof Error
            ? error.message
            : "Nao foi possivel pesquisar.",
        });
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [organizationId, storeId, request]);

  const current =
    result?.request === request &&
    search.trim() === request.search
      ? result
      : null;

  const page = current?.page ?? null;

  function performSearch() {
    if (disabled) return;

    setRequest({
      search: search.trim(),
      offset: 0,
    });
  }

  const buttonClass =
    "rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-700 ring-1 ring-black/10 hover:bg-gray-50 disabled:opacity-50";

  return (
    <div className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          maxLength={80}
          disabled={disabled}
          placeholder="Buscar lead por nome ou telefone"
          aria-label="Buscar lead por nome ou telefone"
          onChange={event => setSearch(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              performSearch();
            }
          }}
          className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900"
        />

        <button
          type="button"
          disabled={disabled}
          onClick={performSearch}
          className={buttonClass}
        >
          Buscar
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={onCancel}
          className={buttonClass}
        >
          Cancelar
        </button>
      </div>

      {search.trim() !== request.search ? (
        <p className="text-xs text-gray-600">
          Clique em Buscar para consultar os leads.
        </p>
      ) : !current ? (
        <p role="status" className="text-sm text-gray-600">
          Carregando leads...
        </p>
      ) : current.error ? (
        <p role="alert" className="text-sm text-red-700">
          {current.error}
        </p>
      ) : page?.leads.length === 0 ? (
        <p className="text-sm text-gray-600">
          Nenhum lead encontrado.
        </p>
      ) : null}

      {page ? (
        <>
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {page.leads.map(lead => (
              <button
                type="button"
                key={lead.id}
                disabled={disabled}
                onClick={() => {
                  if (!disabled && current?.request === request) {
                    onSelect(lead);
                  }
                }}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-left hover:bg-gray-50 disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-gray-900">
                    {lead.name || "Lead sem nome"}
                  </span>
                  <span className="block truncate text-xs text-gray-600">
                    {lead.phone || "Telefone nao informado"}
                  </span>
                </span>
                <span className="text-xs font-semibold text-gray-700">
                  Selecionar
                </span>
              </button>
            ))}
          </div>

          {request.offset > 0 || page.hasMore ? (
            <div className="flex justify-between gap-2">
              <button
                type="button"
                disabled={disabled || request.offset === 0}
                onClick={() => setRequest({
                  ...request,
                  offset: Math.max(0, request.offset - 30),
                })}
                className={buttonClass}
              >
                Anterior
              </button>

              <button
                type="button"
                disabled={disabled || page.nextOffset === null}
                onClick={() => {
                  if (page.nextOffset !== null) {
                    setRequest({
                      ...request,
                      offset: page.nextOffset,
                    });
                  }
                }}
                className={buttonClass}
              >
                {"Pr\u00f3xima"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import QuoteCatalogPrefillPicker from "./lead/[id]/QuoteCatalogPrefillPicker";
import type { HumanQuoteEditItem } from "./lead/[id]/human-quote-edit-request";
import type {
  QuoteCatalogPrefillValues,
  QuoteTechnicalServicesPolicy,
} from "./lead/[id]/quote-catalog-prefill";
import {
  getQuoteItemTypeLabel,
  parseQuoteQuantityValue,
  parseQuoteMoneyValue,
  formatCurrencyBRL,
  type QuoteFormItem,
} from "./quote-editor-model";

export type QuoteEditorModalProps = {
  isEditingQuote: boolean;
  humanQuoteEditView: ReadonlyMap<string, HumanQuoteEditItem["item_type"]> | null;
  editingQuoteNumber: string | null;
  isGeneratingManualQuote: boolean;
  closeQuoteModalAndReset: () => void;
  creationLinkSection: ReactNode;
  quoteTitle: string;
  setQuoteTitle: (value: string) => void;
  quoteWarrantyTerms: string;
  setQuoteWarrantyTerms: (value: string) => void;
  quoteValidityDays: string;
  setQuoteValidityDays: (value: string) => void;
  quoteCustomerNotes: string;
  setQuoteCustomerNotes: (value: string) => void;
  quoteItems: QuoteFormItem[];
  removeQuoteItem: (itemId: string) => void;
  updateQuoteItem: (itemId: string, field: keyof Omit<QuoteFormItem, "id">, value: string) => void;
  addQuoteItem: () => void;
  quoteServiceOptionEnabled: boolean;
  catalogScope: { organizationId: string; storeId: string } | null;
  quoteTechnicalServicesPolicy: QuoteTechnicalServicesPolicy | null;
  applyCatalogPrefillToQuoteItem: (itemId: string, values: QuoteCatalogPrefillValues) => void;
  quoteFormError: string | null;
  quoteFormSuccess: string | null;
  quoteValidationMessage: string | null | undefined;
  quoteSubtotalReais: number;
  quoteDiscountTotalReais: number;
  quoteGlobalDiscountReais: number;
  quoteTotalReais: number;
  canGenerateQuotePdf: boolean;
  onSubmit: () => void | Promise<void>;
};

export default function QuoteEditorModal({
  isEditingQuote,
  humanQuoteEditView,
  editingQuoteNumber,
  isGeneratingManualQuote,
  closeQuoteModalAndReset,
  creationLinkSection,
  quoteTitle,
  setQuoteTitle,
  quoteWarrantyTerms,
  setQuoteWarrantyTerms,
  quoteValidityDays,
  setQuoteValidityDays,
  quoteCustomerNotes,
  setQuoteCustomerNotes,
  quoteItems,
  removeQuoteItem,
  updateQuoteItem,
  addQuoteItem,
  quoteServiceOptionEnabled,
  catalogScope,
  quoteTechnicalServicesPolicy,
  applyCatalogPrefillToQuoteItem,
  quoteFormError,
  quoteFormSuccess,
  quoteValidationMessage,
  quoteSubtotalReais,
  quoteDiscountTotalReais,
  quoteGlobalDiscountReais,
  quoteTotalReais,
  canGenerateQuotePdf,
  onSubmit,
}: QuoteEditorModalProps) {
  return (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-0 sm:px-3 sm:py-3 lg:px-6 lg:py-5">
    <div className="flex h-dvh max-h-dvh w-full min-w-0 max-w-6xl flex-col overflow-hidden rounded-none bg-white shadow-2xl ring-1 ring-black/10 sm:h-auto sm:max-h-[92vh] sm:rounded-3xl">
      <div className="flex min-w-0 items-start justify-between gap-2 border-b border-gray-100 bg-gray-950 px-3 py-3 text-white sm:gap-4 sm:px-5 sm:py-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/50">
            {isEditingQuote ? "Edicao de orcamento" : "Orçamento manual"}
          </div>
          <h2 className="mt-1 text-lg font-bold">
            {isEditingQuote ? "Editar orçamento" : "Novo orçamento"}
          </h2>
        </div>

        <button
          type="button"
          onClick={closeQuoteModalAndReset}
          disabled={isGeneratingManualQuote}
          className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
        >
          Fechar
        </button>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3 sm:max-h-[80vh] sm:p-5 lg:p-7">
        <div className="grid gap-4">
          <div>
            {!isEditingQuote ? creationLinkSection : null}
            <p className="text-sm leading-6 text-gray-700">
              {isEditingQuote
                ? (humanQuoteEditView ? "Revise os dados atuais e salve as alterações." : "Revise os dados atuais do orcamento antes de gerar uma nova versao.")
                : "Crie um orçamento com ou sem vínculo com o cliente."}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {isEditingQuote
                ? editingQuoteNumber
                  ? `Edicao carregada de ${editingQuoteNumber}.`
                  : "Edicao carregada do orcamento atual."
                : "Rascunho salvo temporariamente neste navegador."}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Título do orçamento
              </label>
              <input
                value={quoteTitle}
                onChange={(event) => setQuoteTitle(event.target.value)}
                className="mt-1 w-full min-w-0 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-black sm:text-sm"
                placeholder="Ex.: Orçamento piscina premium"
              />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Garantia
              </label>
              <input
                value={quoteWarrantyTerms}
                onChange={(event) => setQuoteWarrantyTerms(event.target.value)}
                className="mt-1 w-full min-w-0 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-black sm:text-sm"
                placeholder="Ex.: 12 meses"
              />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Validade em dias
              </label>
              <input
                value={quoteValidityDays}
                onChange={(event) => setQuoteValidityDays(event.target.value)}
                className="mt-1 w-full min-w-0 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-black sm:text-sm"
                placeholder="Ex.: 7"
                inputMode="numeric"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Observações para o cliente
              </label>
              <textarea
                value={quoteCustomerNotes}
                onChange={(event) => setQuoteCustomerNotes(event.target.value)}
                className="mt-1 min-h-[96px] w-full min-w-0 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-black sm:text-sm"
                placeholder="Ex.: Condições comerciais, escopo, observações gerais..."
              />
            </div>
          </div>

          <div className="rounded-3xl bg-gray-50 p-4 ring-1 ring-black/5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-gray-900">Itens do orçamento</div>
                <div className="text-xs text-gray-500">
                  Adicione produtos ou serviços manualmente.
                </div>
              </div>

            </div>

            <div className="mt-4 space-y-4">
              {quoteItems.map((item, index) => {
                const quantity = parseQuoteQuantityValue(item.quantity);
                const unitPrice = parseQuoteMoneyValue(item.unitPriceReais);
                const discount = parseQuoteMoneyValue(item.discountReais);
                const itemSubtotal = quantity * unitPrice;
                const itemTotal = Math.max(itemSubtotal - discount, 0);

                return (
                  <div
                    key={item.id}
                    className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/10"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-gray-900">
                        Item {index + 1}
                      </div>

                      <button
                        type="button"
                        onClick={() => removeQuoteItem(item.id)}
                        className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-200"
                      >
                        Remover
                      </button>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Tipo do item
                        </label>
                        <select
                          value={item.itemType}
                          disabled={isEditingQuote && humanQuoteEditView?.has(item.id)}
                          onChange={(event) => {
                            const nextItemType = event.target.value;

                            if (
                              nextItemType === "service" &&
                              !quoteServiceOptionEnabled
                            ) {
                              return;
                            }

                            updateQuoteItem(item.id, "itemType", nextItemType);
                          }}
                          className="mt-1 w-full min-w-0 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-black sm:text-sm"
                        >
                          <option value="pool_installation">
                            {getQuoteItemTypeLabel("pool_installation")}
                          </option>
                          <option value="custom">{isEditingQuote && humanQuoteEditView?.get(item.id) === "pool" ? "Piscina" : isEditingQuote && humanQuoteEditView?.get(item.id) === "catalog_item" ? "Produto do catálogo" : getQuoteItemTypeLabel("custom")}</option>
                          <option
                            value="service"
                            disabled={!quoteServiceOptionEnabled}
                          >
                            {getQuoteItemTypeLabel("service")}
                            {!quoteServiceOptionEnabled ? " (não disponível)" : ""}
                          </option>
                        </select>
                      </div>

                      {!isEditingQuote &&
                      catalogScope ? (
                        <div className="md:col-span-2">
                          <QuoteCatalogPrefillPicker
                            organizationId={catalogScope.organizationId}
                            storeId={catalogScope.storeId}
                            itemType={item.itemType}
                            technicalServicesPolicy={quoteTechnicalServicesPolicy}
                            onSelect={(values) =>
                              applyCatalogPrefillToQuoteItem(item.id, values)
                            }
                          />
                        </div>
                      ) : null}

                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Quantidade
                        </label>
                        <input
                          value={item.quantity}
                          onChange={(event) =>
                            updateQuoteItem(item.id, "quantity", event.target.value)
                          }
                          className="mt-1 w-full min-w-0 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-black sm:text-sm"
                          placeholder="1"
                          inputMode="decimal"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Nome
                        </label>
                        <input
                          value={item.name}
                          onChange={(event) =>
                            updateQuoteItem(item.id, "name", event.target.value)
                          }
                          className="mt-1 w-full min-w-0 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-black sm:text-sm"
                          placeholder="Ex.: Piscina Premium"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Descrição
                        </label>
                        <textarea
                          value={item.description}
                          onChange={(event) =>
                            updateQuoteItem(item.id, "description", event.target.value)
                          }
                          className="mt-1 min-h-[88px] w-full min-w-0 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-black sm:text-sm"
                          placeholder="Detalhes do item ou serviço"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Preço unitário (R$)
                        </label>
                        <input
                          value={item.unitPriceReais}
                          onChange={(event) =>
                            updateQuoteItem(item.id, "unitPriceReais", event.target.value)
                          }
                          className="mt-1 w-full min-w-0 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-black sm:text-sm"
                          placeholder="0,00"
                          inputMode="decimal"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Desconto (R$)
                        </label>
                        <input
                          value={item.discountReais}
                          onChange={(event) =>
                            updateQuoteItem(item.id, "discountReais", event.target.value)
                          }
                          className="mt-1 w-full min-w-0 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-black sm:text-sm"
                          placeholder="0,00"
                          inputMode="decimal"
                        />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl bg-gray-50 px-4 py-3 ring-1 ring-black/5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          Subtotal
                        </div>
                        <div className="mt-1 text-sm font-bold text-gray-900">
                          {formatCurrencyBRL(itemSubtotal)}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-gray-50 px-4 py-3 ring-1 ring-black/5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          Desconto
                        </div>
                        <div className="mt-1 text-sm font-bold text-gray-900">
                          {formatCurrencyBRL(discount)}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-gray-950 px-4 py-3 text-white ring-1 ring-black/5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
                          Total do item
                        </div>
                        <div className="mt-1 text-sm font-bold">
                          {formatCurrencyBRL(itemTotal)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="flex justify-start">
                <button
                  type="button"
                  onClick={addQuoteItem}
                  className="rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
                >
                  Adicionar item
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-gray-950 p-4 text-white ring-1 ring-black/5">
            {quoteFormError ? (
              <div className="mb-4 rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-100 ring-1 ring-red-300/20">
                {quoteFormError}
              </div>
            ) : null}

            {quoteFormSuccess ? (
              <div className="mb-4 rounded-2xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100 ring-1 ring-emerald-300/20">
                {quoteFormSuccess}
              </div>
            ) : null}

            {quoteValidationMessage ? (
              <div className="mb-4 rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/90 ring-1 ring-white/10">
                {quoteValidationMessage}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
                  Subtotal
                </div>
                <div className="mt-1 text-lg font-bold">
                  {formatCurrencyBRL(quoteSubtotalReais)}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
                  Desconto total
                </div>
                <div className="mt-1 text-lg font-bold">
                  {formatCurrencyBRL(quoteDiscountTotalReais + quoteGlobalDiscountReais)}
                  {quoteGlobalDiscountReais > 0 && (
                    <span className="block text-xs font-normal">Inclui desconto global preservado: {formatCurrencyBRL(quoteGlobalDiscountReais)}</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
                  Total
                </div>
                <div className="mt-1 text-lg font-bold">
                  {formatCurrencyBRL(quoteTotalReais)}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closeQuoteModalAndReset}
                disabled={isGeneratingManualQuote}
                className="min-h-11 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
              >
                Fechar
              </button>

              <button
                type="button"
                onClick={() => void onSubmit()}
                disabled={
                  isGeneratingManualQuote ||
                  (isEditingQuote ? !canGenerateQuotePdf : !canGenerateQuotePdf)
                }
                className="min-h-11 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-white/15 disabled:cursor-not-allowed disabled:text-gray-400"
              >
                {isEditingQuote
                  ? isGeneratingManualQuote
                    ? (humanQuoteEditView ? "Salvando..." : "Gerando nova versao...")
                    : (humanQuoteEditView ? "Salvar" : "Gerar nova versao")
                  : isGeneratingManualQuote
                    ? "Gerando..."
                    : "Gerar PDF"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}

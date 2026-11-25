"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { supabase } from "@/lib/supabaseBrowser";
import QuoteEditorModal from "./QuoteEditorModal";
import GeneralQuoteLeadPicker from "./GeneralQuoteLeadPicker";

import {
  createEmptyQuoteFormItem,
  type QuoteFormItem,
} from "./quote-editor-model";

import {
  isQuoteTechnicalServicesPolicyAvailable,
  type QuoteTechnicalServicesPolicy,
  type QuoteCatalogPrefillValues,
} from "./lead/[id]/quote-catalog-prefill";

import { submitManualQuotePdf } from "./manual-quote-pdf";

import {
  buildGeneralQuoteDraftKey,
  buildGeneralQuoteSubmission,
  calculateGeneralQuoteValidation,
  createGeneralQuoteDraft,
  restoreGeneralQuoteDraft,
  assertGeneralQuoteLeadScope,
  setGeneralQuoteLead,
  revalidateGeneralQuoteLead,
  type GeneralQuoteLead,
  type GeneralQuoteDraft,
} from "./general-quote-model";

// Prevent overlapping submissions for the same browser draft.
const activeGeneralQuoteSubmissions = new Set<string>();

type Props = {
  organizationId: string;
  storeId: string;
  onClose: () => void;
};

export default function GeneralQuoteEditor({
  organizationId,
  storeId,
  onClose,
}: Props) {
  const [draft, setDraft] =
    useState<GeneralQuoteDraft>(createGeneralQuoteDraft);

  const [userId, setUserId] =
    useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectingLead, setSelectingLead] = useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [success, setSuccess] =
    useState<string | null>(null);

  const [storageFailed, setStorageFailed] =
    useState(false);

  const [policy, setPolicy] =
    useState<QuoteTechnicalServicesPolicy | null>(null);

  const [configured, setConfigured] =
    useState(false);

  const mounted = useRef(false);
  const inFlight = useRef(false);
  const userRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { data, error: authError } =
          await supabase.auth.getUser();

        if (cancelled) return;

        if (authError || !data.user?.id) {
          throw new Error("Sessao indisponivel. Entre novamente.");
        }

        const scope = {
          organizationId,
          storeId,
          userId: data.user.id,
        };

        const restored = restoreGeneralQuoteDraft(
          window.sessionStorage.getItem(
            buildGeneralQuoteDraftKey(scope)
          )
        );

        if (cancelled) return;

        if (restored.linkedLead) {
          assertGeneralQuoteLeadScope(scope, restored.linkedLead);
        }

        setDraft(restored);
        userRef.current = data.user.id;
        setUserId(data.user.id);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Nao foi possivel abrir o editor."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId, storeId]);

  useEffect(() => {
    const { data: { subscription } } =
      supabase.auth.onAuthStateChange((_event, session) => {
        if (
          userRef.current &&
          session?.user.id !== userRef.current
        ) {
          userRef.current = null;
          onClose();
        }
      });

    return () => subscription.unsubscribe();
  }, [onClose]);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    setConfigured(false);
    setPolicy(null);

    void (async () => {
      try {
        const { data, error: policyError } =
          await supabase.rpc(
            "read_store_operation_execution_policies_scoped",
            {
              p_organization_id: organizationId,
              p_store_id: storeId,
            }
          );

        if (cancelled || policyError) return;

        const rawData = data as unknown;

        const row = (
          Array.isArray(rawData)
            ? rawData[0] ?? null
            : rawData ?? null
        ) as {
          technical_services_policy?: QuoteTechnicalServicesPolicy | null;
          technical_services_configured_at?: string | null;
        } | null;

        const available = Boolean(
          String(row?.technical_services_configured_at || "").trim()
        );

        setConfigured(available);
        setPolicy(
          available && row?.technical_services_policy
            ? row.technical_services_policy
            : null
        );
      } catch {
        if (!cancelled) {
          setConfigured(false);
          setPolicy(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId, storeId, userId]);

  useEffect(() => {
    if (!userId || success) return;

    try {
      window.sessionStorage.setItem(
        buildGeneralQuoteDraftKey({
          organizationId,
          storeId,
          userId,
        }),
        JSON.stringify(draft)
      );

      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [draft, organizationId, storeId, userId, success]);

  const serviceEnabled =
    configured &&
    isQuoteTechnicalServicesPolicyAvailable(policy);

  const validation =
    calculateGeneralQuoteValidation(draft, serviceEnabled);

  function updateDraft(
    update: (current: GeneralQuoteDraft) => GeneralQuoteDraft,
  ) {
    if (inFlight.current || success) return;

    setDraft(update);
    setError(null);
  }

  function setField(
    field: Exclude<keyof GeneralQuoteDraft, "quoteItems" | "linkedLead">,
    value: string,
  ) {
    updateDraft(current => ({
      ...current,
      [field]: value,
    }));
  }

  function changeLinkedLead(lead: GeneralQuoteLead | null) {
    if (
      !userId ||
      userRef.current !== userId ||
      inFlight.current ||
      success
    ) return;

    const scope = { organizationId, storeId, userId };

    try {
      if (lead) {
        assertGeneralQuoteLeadScope(scope, lead);
      }

      updateDraft(current =>
        setGeneralQuoteLead(scope, current, lead)
      );

      setSelectingLead(false);
    } catch {
      setError("Lead fora do escopo da loja.");
    }
  }

  function addItem() {
    updateDraft(current => ({
      ...current,
      quoteItems: [
        ...current.quoteItems,
        createEmptyQuoteFormItem(),
      ],
    }));
  }

  function removeItem(itemId: string) {
    updateDraft(current => ({
      ...current,
      quoteItems: current.quoteItems.length <= 1
        ? [createEmptyQuoteFormItem()]
        : current.quoteItems.filter(item => item.id !== itemId),
    }));
  }

  function updateItem(
    itemId: string,
    field: keyof Omit<QuoteFormItem, "id">,
    value: string,
  ) {
    updateDraft(current => ({
      ...current,
      quoteItems: current.quoteItems.map(item =>
        item.id === itemId
          ? { ...item, [field]: value }
          : item
      ),
    }));
  }

  function applyCatalog(
    itemId: string,
    values: QuoteCatalogPrefillValues,
  ) {
    updateDraft(current => ({
      ...current,
      quoteItems: current.quoteItems.map(item =>
        item.id === itemId
          ? {
              ...item,
              name: values.name,
              description: values.description,
              unitPriceReais: values.unitPriceReais,
            }
          : item
      ),
    }));
  }

  function close() {
    if (inFlight.current) return;

    if (userId) {
      try {
        window.sessionStorage.removeItem(
          buildGeneralQuoteDraftKey({
            organizationId,
            storeId,
            userId,
          })
        );
      } catch {
        // Closing the editor must remain possible.
      }
    }

    onClose();
  }

  async function generate() {
    if (
      inFlight.current ||
      success ||
      !userId ||
      storageFailed ||
      !validation.canGenerateQuotePdf
    ) return;

    const scope = {
      organizationId,
      storeId,
      userId,
    };

    const draftKey = buildGeneralQuoteDraftKey(scope);
    const submittedDraft = JSON.stringify(draft);

    if (activeGeneralQuoteSubmissions.has(draftKey)) {
      setError("Ja existe uma geracao em andamento para este rascunho.");
      return;
    }

    activeGeneralQuoteSubmissions.add(draftKey);

    inFlight.current = true;
    setBusy(true);
    setError(null);

    try {
      if (
        window.sessionStorage.getItem(draftKey) !== submittedDraft
      ) {
        throw new Error(
          "O rascunho mudou ou ja foi concluido. Reabra o editor."
        );
      }
      const { data, error: authError } =
        await supabase.auth.getUser();

      if (!mounted.current) return;

      if (
        authError ||
        data.user?.id !== userId ||
        userRef.current !== userId
      ) {
        throw new Error("O contexto da sessao mudou. Reabra o editor.");
      }

      if (draft.linkedLead) {
        await revalidateGeneralQuoteLead(
          scope,
          draft.linkedLead,
        );
      }

      if (
        !mounted.current ||
        userRef.current !== userId
      ) return;

      const submission =
        buildGeneralQuoteSubmission(scope, draft);

      await submitManualQuotePdf({
        ...submission,
        storage: window.sessionStorage,
        createUuid: () => window.crypto.randomUUID(),
      });

      // Retire the submitted draft even if the editor was unmounted.
      // Never remove a newer draft created for the same scope.
      try {
        if (
          window.sessionStorage.getItem(draftKey) === submittedDraft
        ) {
          window.sessionStorage.removeItem(draftKey);
        }
      } catch {
        // The server already confirmed creation and PDF generation.
      }

      // Do not present a result in a different store or session.
      if (
        !mounted.current ||
        userRef.current !== userId
      ) return;

      setSuccess("Or\u00e7amento gerado com sucesso.");
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Nao foi possivel gerar o orcamento."
        );
      }
    } finally {
      activeGeneralQuoteSubmissions.delete(draftKey);
      inFlight.current = false;

      if (mounted.current) setBusy(false);
    }
  }

  if (loading || !userId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
          <p className="text-sm text-gray-700">
            {loading ? "Carregando editor..." : error || "Sessao indisponivel."}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  const creationLinkSection = (
    <div className="mb-4 grid gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-800">
          {draft.linkedLead
            ? "Lead vinculado"
            : "Or\u00e7amento sem v\u00ednculo"}
        </span>

        <button
          type="button"
          disabled={busy || Boolean(success)}
          onClick={() => {
            if (draft.linkedLead) {
              changeLinkedLead(null);
            } else {
              setSelectingLead(current => !current);
            }
          }}
          className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-800 ring-1 ring-black/10 hover:bg-gray-50 disabled:opacity-50"
        >
          {draft.linkedLead
            ? "Desvincular lead"
            : "Vincular lead ao or\u00e7amento"}
        </button>
      </div>

      {selectingLead && !draft.linkedLead && !success ? (
        <GeneralQuoteLeadPicker
          key={JSON.stringify([organizationId, storeId, userId])}
          organizationId={organizationId}
          storeId={storeId}
          disabled={busy}
          onSelect={changeLinkedLead}
          onCancel={() => setSelectingLead(false)}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-gray-600">
          Nome do cliente (opcional)
          <input
            value={draft.linkedLead
              ? draft.linkedLead.name ?? ""
              : draft.customerName}
            readOnly={Boolean(draft.linkedLead)}
            disabled={busy || Boolean(success)}
            onChange={event => setField("customerName", event.target.value)}
            className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
          />
        </label>

        <label className="grid gap-1 text-xs font-semibold text-gray-600">
          Telefone (opcional)
          <input
            type="tel"
            value={draft.linkedLead
              ? draft.linkedLead.phone ?? ""
              : draft.customerPhone}
            readOnly={Boolean(draft.linkedLead)}
            disabled={busy || Boolean(success)}
            onChange={event => setField("customerPhone", event.target.value)}
            className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
          />
        </label>
      </div>
    </div>
  );

  return (
    <fieldset disabled={busy} className="contents">
      <QuoteEditorModal
        isEditingQuote={false}
        humanQuoteEditView={null}
        editingQuoteNumber={null}
        isGeneratingManualQuote={busy}
        closeQuoteModalAndReset={close}
        creationLinkSection={creationLinkSection}
        quoteTitle={draft.quoteTitle}
        setQuoteTitle={value => setField("quoteTitle", value)}
        quoteWarrantyTerms={draft.quoteWarrantyTerms}
        setQuoteWarrantyTerms={value => setField("quoteWarrantyTerms", value)}
        quoteValidityDays={draft.quoteValidityDays}
        setQuoteValidityDays={value => setField("quoteValidityDays", value)}
        quoteCustomerNotes={draft.quoteCustomerNotes}
        setQuoteCustomerNotes={value => setField("quoteCustomerNotes", value)}
        quoteItems={draft.quoteItems}
        removeQuoteItem={removeItem}
        updateQuoteItem={updateItem}
        addQuoteItem={addItem}
        quoteServiceOptionEnabled={serviceEnabled}
        catalogScope={{ organizationId, storeId }}
        quoteTechnicalServicesPolicy={policy}
        applyCatalogPrefillToQuoteItem={applyCatalog}
        quoteFormError={
          storageFailed
            ? "Nao foi possivel preservar o rascunho neste navegador."
            : error
        }
        quoteFormSuccess={success}
        quoteValidationMessage={success ? null : validation.quoteValidationMessage}
        quoteSubtotalReais={validation.quoteSubtotalReais}
        quoteDiscountTotalReais={validation.quoteDiscountTotalReais}
        quoteGlobalDiscountReais={validation.quoteGlobalDiscountReais}
        quoteTotalReais={validation.quoteTotalReais}
        canGenerateQuotePdf={
          !success &&
          !storageFailed &&
          validation.canGenerateQuotePdf
        }
        onSubmit={generate}
      />
    </fieldset>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { findContractTextMatches } from "./contract-text-search";

type EditSourceResponse = {
  ok: boolean;
  available?: boolean;
  templateVersionId?: string;
  originalFilename?: string | null;
  text?: string;
  recoveredFromFile?: boolean;
  reviewRequired?: boolean;
  message?: string;
};

type ContractDraft = {
  draftId: string;
  draftSha256: string;
  text: string;
  revision: number;
  templateVersionId: string;
  updatedAt?: string;
};

type DraftGetResponse = {
  ok: boolean;
  draftId?: string | null;
  draftSha256?: string | null;
  templateVersionId?: string;
  draft?: ContractDraft | null;
  message?: string;
};

type DraftPutResponse = {
  ok: boolean;
  draftId?: string | null;
  draftSha256?: string | null;
  draft?: ContractDraft;
  error?: string;
  message?: string;
};

type EditorProps = {
  leadId: string | null | undefined;
  commercialOpportunityId: string | null | undefined;
  onDraftStateChange?: (state: ContractDraftState) => void;
};

export type ContractDraftState = {
  ready: boolean;
  draftId: string | null;
  draftSha256: string | null;
  revision: number | null;
  changed: boolean;
  conflict: boolean;
  templateVersionId: string | null;
};

const MAX_DRAFT_LENGTH = 300_000;

export function ContractTemplateTextEditor({
  leadId,
  commercialOpportunityId,
  onDraftStateChange,
}: EditorProps) {
  const [sourceText, setSourceText] = useState("");
  const [draftText, setDraftText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [templateVersionId, setTemplateVersionId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSha256, setDraftSha256] = useState<string | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [originalFilename, setOriginalFilename] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [ready, setReady] = useState(false);
  const [recoveryPreviewOnly, setRecoveryPreviewOnly] = useState(false);
  const [recoveryReviewed, setRecoveryReviewed] = useState(false);
  const scopeEpoch = useRef(0);
  const saveAbort = useRef<AbortController | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const search = useMemo(
    () => findContractTextMatches(draftText, searchQuery, 500),
    [draftText, searchQuery],
  );

  useEffect(() => {
    const controller = new AbortController();
    const epoch = ++scopeEpoch.current;
    saveAbort.current?.abort();
    saveAbort.current = null;

    setSourceText("");
    setDraftText("");
    setSavedText("");
    setTemplateVersionId(null);
    setDraftId(null);
    setDraftSha256(null);
    setRevision(null);
    setOriginalFilename(null);
    setReady(false);
    setRecoveryPreviewOnly(false);
    setRecoveryReviewed(false);
    setLoading(true);
    setSaving(false);
    setError(null);
    setSaveError(null);
    setSaveNotice(null);
    setConflict(false);
    setSearchQuery("");
    setActiveMatchIndex(-1);

    if (!leadId || !commercialOpportunityId) {
      setLoading(false);
      setError("Selecione uma oportunidade comercial para carregar o texto do contrato.");
      return () => {
        controller.abort();
        if (scopeEpoch.current === epoch) scopeEpoch.current++;
      };
    }

    const params = new URLSearchParams({ leadId, commercialOpportunityId });
    const isCurrent = () => !controller.signal.aborted && scopeEpoch.current === epoch;
    void (async () => {
      try {
        const sourceResponse = await fetch(
          `/api/sales-contracts/template-edit-source?${params.toString()}`,
          { method: "GET", cache: "no-store", signal: controller.signal },
        );
        const source = (await sourceResponse.json()) as EditSourceResponse;
        if (!isCurrent()) return;
        if (!sourceResponse.ok || !source.ok || !source.available ||
            !source.templateVersionId || typeof source.text !== "string" || !source.text.trim()) {
          throw new Error(source.message || "O modelo ativo nao possui texto disponivel para edicao.");
        }

        const draftResponse = await fetch(
          `/api/sales-contracts/text-draft?${params.toString()}`,
          { method: "GET", cache: "no-store", signal: controller.signal },
        );
        const draftResult = (await draftResponse.json()) as DraftGetResponse;
        if (!isCurrent()) return;
        if (!draftResponse.ok || !draftResult.ok) {
          throw new Error(draftResult.message || "Nao foi possivel recuperar o rascunho salvo.");
        }
        if (draftResult.templateVersionId !== source.templateVersionId) {
          throw new Error("A versao do modelo mudou durante o carregamento. Reabra o editor.");
        }
        const existing = draftResult.draft;
        if (existing && (
          existing.templateVersionId !== source.templateVersionId ||
          !Number.isSafeInteger(existing.revision) || existing.revision < 1 ||
          typeof existing.text !== "string" || !existing.text.trim() ||
          existing.text.length > MAX_DRAFT_LENGTH
        )) {
          throw new Error("O rascunho salvo nao corresponde ao modelo ativo. Nenhum texto foi sobrescrito.");
        }

        const editable = existing ? existing.text : source.text;
        setSourceText(source.text);
        setDraftText(editable);
        setSavedText(editable);
        setTemplateVersionId(source.templateVersionId);
        setDraftId(existing ? existing.draftId : null);
        setDraftSha256(existing ? existing.draftSha256 : null);
        setRevision(existing ? existing.revision : null);
        setOriginalFilename(source.originalFilename ?? null);
        // A confirmed draft can be edited again without re-confirming the PDF.
        setRecoveryPreviewOnly((source.recoveredFromFile === true || source.reviewRequired === true) && !existing);
        setRecoveryReviewed(false);
        setReady(true);
      } catch (caught) {
        if (isCurrent()) {
          setError(caught instanceof Error ? caught.message : "Falha ao carregar o contrato.");
        }
      } finally {
        if (isCurrent()) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
      saveAbort.current?.abort();
      if (scopeEpoch.current === epoch) scopeEpoch.current++;
    };
  }, [leadId, commercialOpportunityId]);

  const changed = ready && draftText !== savedText;
  const previewPdfAvailable =
    revision !== null && !changed && !saving && !conflict &&
    Boolean(leadId && commercialOpportunityId);

  function previewSavedPdf() {
    if (!previewPdfAvailable || !leadId || !commercialOpportunityId) return;
    const params = new URLSearchParams({ leadId, commercialOpportunityId });
    window.open(
      `/api/sales-contracts/text-draft/pdf-preview?${params.toString()}`,
      "_blank",
      "noopener,noreferrer",
    );
  }


  const invalidText = !draftText.trim() || draftText.length > MAX_DRAFT_LENGTH;
  const canSave = (changed || (recoveryPreviewOnly && recoveryReviewed)) &&
    (!recoveryPreviewOnly || recoveryReviewed) && !invalidText && !saving && !conflict;

  useEffect(() => {
    onDraftStateChange?.({
      ready,
      draftId: changed || conflict ? null : draftId,
      draftSha256: changed || conflict ? null : draftSha256,
      revision,
      changed,
      conflict,
      templateVersionId,
    });
  }, [changed, conflict, draftId, draftSha256, onDraftStateChange, ready, revision, templateVersionId]);

  useEffect(() => {
    if (!changed) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [changed]);

  async function saveDraft() {
    if (!ready || !canSave || !templateVersionId || !leadId || !commercialOpportunityId) return;

    const controller = new AbortController();
    const epoch = scopeEpoch.current;
    const submittedText = draftText;
    const expectedRevision = revision;
    saveAbort.current = controller;
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const response = await fetch("/api/sales-contracts/text-draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          leadId,
          commercialOpportunityId,
          templateVersionId,
          text: submittedText,
          expectedRevision,
          // The server re-extracts the private PDF and compares these exact
          // original bytes before allowing the first confirmed draft.
          ...(recoveryPreviewOnly ? { recoveryReviewed: true, reviewedSourceText: sourceText } : {}),
        }),
      });
      const result = (await response.json()) as DraftPutResponse;
      if (controller.signal.aborted || scopeEpoch.current !== epoch) return;
      if (!response.ok || !result.ok) {
        if (response.status === 409) setConflict(true);
        throw new Error(result.message || "Nao foi possivel salvar o rascunho.");
      }
      const persisted = result.draft;
      if (!persisted || persisted.templateVersionId !== templateVersionId ||
          !persisted.draftId || !persisted.draftSha256 ||
          persisted.text !== submittedText ||
          persisted.revision !== (expectedRevision === null ? 1 : expectedRevision + 1)) {
        setConflict(true);
        throw new Error("O servidor nao confirmou a revisao esperada. Reabra o editor antes de salvar novamente.");
      }
      setSavedText(persisted.text);
      setDraftId(persisted.draftId);
      setDraftSha256(persisted.draftSha256);
      setRevision(persisted.revision);
      setRecoveryPreviewOnly(false);
      setRecoveryReviewed(false);
      setSaveNotice(`Rascunho salvo no ZION (revisao ${persisted.revision}).`);
    } catch (caught) {
      if (!controller.signal.aborted && scopeEpoch.current === epoch) {
        setSaveError(caught instanceof Error ? caught.message : "Falha ao salvar o rascunho.");
      }
    } finally {
      if (saveAbort.current === controller) saveAbort.current = null;
      if (!controller.signal.aborted && scopeEpoch.current === epoch) setSaving(false);
    }
  }

  function jumpToMatch(direction: 1 | -1) {
    if (search.matches.length === 0) return;
    const current = activeMatchIndex >= 0 && activeMatchIndex < search.matches.length
      ? activeMatchIndex
      : direction === 1 ? -1 : 0;
    const next = (current + direction + search.matches.length) % search.matches.length;
    setActiveMatchIndex(next);
    const match = search.matches[next];
    const editor = editorRef.current;
    if (!editor || !match) return;
    editor.focus();
    editor.setSelectionRange(match.start, match.end);
  }

  if (loading) {
    return <div className="p-5 text-sm text-gray-600">Carregando o texto e o rascunho do contrato...</div>;
  }
  if (!ready) {
    return (
      <div role="alert" className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        {error || "Texto do contrato indisponivel. Nenhum conteudo foi preenchido automaticamente."}
      </div>
    );
  }

  return (
    <div className="space-y-2.5 p-2.5 sm:p-3">
      {recoveryPreviewOnly ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <strong>Texto recuperado do PDF.</strong> Confira antes de salvar.
          <label className="mt-2 flex cursor-pointer items-start gap-2 font-medium leading-5">
            <input
              type="checkbox"
              checked={recoveryReviewed}
              onChange={(event) => setRecoveryReviewed(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-sky-700"
            />
            <span>Conferi clausulas, valores e dados no PDF original e autorizo este rascunho.</span>
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">Contrato da oportunidade</p>
          {originalFilename ? (
            <p className="truncate text-xs text-slate-500" title={originalFilename}>
              Modelo da loja: {originalFilename}
            </p>
          ) : null}
          <p className="mt-0.5 text-xs text-slate-600" aria-live="polite">
            {revision === null ? "Sem rascunho salvo" : `Rascunho - revisao ${revision}`}
            {changed ? " · Alteracoes nao salvas" : " · Sem alteracoes pendentes"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saving || draftText === sourceText}
            onClick={() => {
              setDraftText(sourceText);
              setSaveNotice(null);
              setSaveError(null);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Restaurar original
          </button>
          <button
            type="button"
            disabled={!previewPdfAvailable}
            onClick={previewSavedPdf}
            title={
              revision === null
                ? "Salve um rascunho antes de visualizar o PDF."
                : changed
                  ? "Salve as alteracoes pendentes antes de visualizar."
                  : conflict
                    ? "Reabra o editor para resolver o conflito."
                    : "Abrir PDF do rascunho salvo em outra aba."
            }
            className="rounded-lg border border-sky-300 px-3 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Pr&eacute;-visualizar PDF
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => { void saveDraft(); }}
            className="rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar edição"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
        <div className="min-w-[180px] flex-1">
          <label htmlFor="zion-contract-text-search" className="mb-1 block text-xs font-semibold text-slate-700">
            Localizar no contrato
          </label>
          <input
            id="zion-contract-text-search"
            type="search"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setActiveMatchIndex(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                jumpToMatch(event.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Pesquisar nome, palavra, valor ou clausula..."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
          />
        </div>
        <span className="min-w-24 pb-2 text-center text-xs text-slate-600" role="status" aria-live="polite">
          {!searchQuery.trim() ? "Busque no texto" : search.matches.length === 0
            ? "Nao encontrado"
            : `${activeMatchIndex < 0 ? 0 : Math.min(activeMatchIndex + 1, search.matches.length)}/${search.matches.length}${search.truncated ? "+" : ""}`}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={search.matches.length === 0}
            onClick={() => jumpToMatch(-1)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={search.matches.length === 0}
            onClick={() => jumpToMatch(1)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Proximo
          </button>
        </div>
      </div>

      <label htmlFor="zion-contract-template-text-editor" className="sr-only">
        Editar texto completo do modelo de contrato
      </label>
      <textarea
        ref={editorRef}
        id="zion-contract-template-text-editor"
        value={draftText}
        onChange={(event) => {
          setDraftText(event.target.value);
          setSaveError(null);
          setSaveNotice(null);
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
            event.preventDefault();
            document.getElementById("zion-contract-text-search")?.focus();
          }
        }}
        disabled={saving || conflict}
        spellCheck={false}
        className="h-[calc(100dvh-22rem)] min-h-[27rem] w-full resize-y rounded-xl border border-slate-300 bg-white p-4 font-sans text-[15px] leading-8 tracking-[0.005em] text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50"
        aria-label="Texto completo do modelo de contrato, editavel"
      />
      {invalidText ? (
        <p role="alert" className="mt-2 text-xs text-amber-900">
          {draftText.trim() ? "O texto ultrapassa 300.000 caracteres." : "O rascunho nao pode ficar vazio."}
        </p>
      ) : null}
      {saveError ? <p role="alert" className="mt-2 text-sm text-red-700">{saveError}</p> : null}
      {conflict ? (
        <p role="alert" className="mt-2 text-sm text-amber-900">
          Salvamento bloqueado para evitar sobrescrita. Preserve suas alteracoes antes de reabrir o editor.
        </p>
      ) : null}
      {saveNotice ? <p role="status" className="mt-2 text-sm text-green-700">{saveNotice}</p> : null}
      <p className="text-xs text-slate-500">
        O modelo original da loja permanece intacto. Salvar rascunho nao gera nem envia PDF.
      </p>
    </div>
  );
}

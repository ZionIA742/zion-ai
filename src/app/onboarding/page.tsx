"use client";

import { useEffect, useMemo, useState } from "react";
import OrgGuard from "../../components/OrgGuard";
import { StoreProvider, useStoreContext } from "../../components/StoreProvider";
import { supabase } from "@/lib/supabaseBrowser";

type FormData = {
  store_display_name: string;
  store_description: string;
  city: string;
  state: string;
  service_regions: string;
  commercial_whatsapp: string;
};

type AnswersMap = Record<string, any>;

function OnboardingContent() {
  const { loading, error, activeStore, organizationId } = useStoreContext();

  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [draftRecovered, setDraftRecovered] = useState(false);

  const [form, setForm] = useState<FormData>({
    store_display_name: "",
    store_description: "",
    city: "",
    state: "",
    service_regions: "",
    commercial_whatsapp: "",
  });

  const draftStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_step1_draft:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);

  useEffect(() => {
    const loadAnswers = async () => {
      if (!organizationId || !activeStore?.id) {
        setInitialLoading(false);
        return;
      }

      try {
        setInitialLoading(true);
        setLoadError(null);
        setDraftRecovered(false);

        const { data, error } = await supabase.rpc(
          "onboarding_get_answers_scoped",
          {
            p_organization_id: organizationId,
            p_store_id: activeStore.id,
          }
        );

        if (error) {
          console.error("[OnboardingPage] loadAnswers RPC error:", error);
          setLoadError("Falha ao carregar respostas do onboarding.");
          return;
        }

        const answers = (data ?? {}) as AnswersMap;

        const serverForm: FormData = {
          store_display_name: answers.store_display_name ?? activeStore.name ?? "",
          store_description: answers.store_description ?? "",
          city: answers.city ?? "",
          state: answers.state ?? "",
          service_regions: Array.isArray(answers.service_regions)
            ? answers.service_regions.join(", ")
            : answers.service_regions ?? "",
          commercial_whatsapp: answers.commercial_whatsapp ?? "",
        };

        let nextForm = serverForm;

        if (typeof window !== "undefined" && draftStorageKey) {
          const rawDraft = window.localStorage.getItem(draftStorageKey);

          if (rawDraft) {
            try {
              const parsedDraft = JSON.parse(rawDraft) as Partial<FormData>;

              nextForm = {
                store_display_name:
                  parsedDraft.store_display_name ?? serverForm.store_display_name,
                store_description:
                  parsedDraft.store_description ?? serverForm.store_description,
                city: parsedDraft.city ?? serverForm.city,
                state: parsedDraft.state ?? serverForm.state,
                service_regions:
                  parsedDraft.service_regions ?? serverForm.service_regions,
                commercial_whatsapp:
                  parsedDraft.commercial_whatsapp ??
                  serverForm.commercial_whatsapp,
              };

              setDraftRecovered(true);
            } catch (draftErr) {
              console.error(
                "[OnboardingPage] erro ao ler rascunho local:",
                draftErr
              );
            }
          }
        }

        setForm(nextForm);
      } catch (err) {
        console.error("[OnboardingPage] loadAnswers unexpected error:", err);
        setLoadError("Erro inesperado ao carregar onboarding.");
      } finally {
        setInitialLoading(false);
      }
    };

    loadAnswers();
  }, [organizationId, activeStore?.id, activeStore?.name, draftStorageKey]);

  useEffect(() => {
    if (initialLoading) return;
    if (!draftStorageKey) return;
    if (!organizationId || !activeStore?.id) return;

    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify(form));
    } catch (err) {
      console.error("[OnboardingPage] erro ao salvar rascunho local:", err);
    }
  }, [
    form,
    initialLoading,
    draftStorageKey,
    organizationId,
    activeStore?.id,
  ]);

  function updateField<K extends keyof FormData>(field: K, value: FormData[K]) {
    setSuccessMessage(null);
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    if (!organizationId || !activeStore?.id) {
      setLoadError("Loja ativa não encontrada.");
      return;
    }

    setSaving(true);
    setLoadError(null);
    setSuccessMessage(null);

    try {
      const payloads: Array<{ questionKey: string; answer: any }> = [
        {
          questionKey: "store_display_name",
          answer: form.store_display_name.trim(),
        },
        {
          questionKey: "store_description",
          answer: form.store_description.trim(),
        },
        {
          questionKey: "city",
          answer: form.city.trim(),
        },
        {
          questionKey: "state",
          answer: form.state.trim(),
        },
        {
          questionKey: "service_regions",
          answer: form.service_regions
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        },
        {
          questionKey: "commercial_whatsapp",
          answer: form.commercial_whatsapp.trim(),
        },
      ];

      for (const item of payloads) {
        const { error } = await supabase.rpc("onboarding_upsert_answer_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_question_key: item.questionKey,
          p_answer: item.answer,
        });

        if (error) {
          console.error("[OnboardingPage] upsert answer error:", {
            questionKey: item.questionKey,
            error,
          });
          throw new Error(`Falha ao salvar campo: ${item.questionKey}`);
        }
      }

      const { error: statusError } = await supabase.rpc(
        "onboarding_upsert_store_onboarding_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_status: "in_progress",
        }
      );

      if (statusError) {
        console.error("[OnboardingPage] update status error:", statusError);
        throw new Error("Falha ao atualizar status do onboarding.");
      }

      if (draftStorageKey && typeof window !== "undefined") {
        window.localStorage.setItem(draftStorageKey, JSON.stringify(form));
      }

      setSuccessMessage("Etapa 1 salva com sucesso.");
      setDraftRecovered(false);
    } catch (err: any) {
      console.error("[OnboardingPage] handleSave unexpected error:", err);
      setLoadError(err?.message ?? "Erro ao salvar onboarding.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || initialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-600">Carregando onboarding...</p>
      </div>
    );
  }

  if (error || loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 px-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-lg w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Ops…</h1>
          <p className="text-gray-600">{error ?? loadError}</p>
        </div>
      </div>
    );
  }

  if (!activeStore || !organizationId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 px-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-lg w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            Loja não encontrada
          </h1>
          <p className="text-gray-600">
            Não foi possível identificar a loja ativa para iniciar o onboarding.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 px-6 py-10">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="mb-8">
            <p className="text-sm font-medium text-gray-500 mb-2">
              Onboarding inicial
            </p>
            <h1 className="text-3xl font-bold text-gray-900 mb-3">
              Etapa 1 — Identidade da loja
            </h1>
            <p className="text-gray-600 leading-7">
              Vamos configurar os dados principais da loja para a IA entender
              quem você é, onde atende e como deve se apresentar aos clientes.
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 mb-6">
            <p className="text-sm text-gray-500 mb-1">Loja ativa</p>
            <p className="text-lg font-semibold text-gray-900">
              {activeStore.name}
            </p>
          </div>

          {draftRecovered && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-6">
              Recuperamos um rascunho local desta etapa que ainda não tinha sido
              salvo.
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nome comercial da loja
              </label>
              <input
                type="text"
                value={form.store_display_name}
                onChange={(e) =>
                  updateField("store_display_name", e.target.value)
                }
                className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                placeholder="Ex.: Brilho Cristal Piscinas"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Descrição curta da loja
              </label>
              <textarea
                value={form.store_description}
                onChange={(e) =>
                  updateField("store_description", e.target.value)
                }
                className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black min-h-[120px]"
                placeholder="Ex.: Loja especializada em piscinas, acessórios, produtos químicos e instalação."
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Cidade
                </label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => updateField("city", e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                  placeholder="Ex.: Osasco"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Estado
                </label>
                <input
                  type="text"
                  value={form.state}
                  onChange={(e) => updateField("state", e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                  placeholder="Ex.: SP"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Regiões atendidas
              </label>
              <input
                type="text"
                value={form.service_regions}
                onChange={(e) => updateField("service_regions", e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                placeholder="Ex.: Osasco, Barueri, Carapicuíba, São Paulo"
                required
              />
              <p className="text-xs text-gray-500 mt-2">Separe por vírgula.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                WhatsApp comercial
              </label>
              <input
                type="text"
                value={form.commercial_whatsapp}
                onChange={(e) =>
                  updateField("commercial_whatsapp", e.target.value)
                }
                className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                placeholder="Ex.: (11) 99999-9999"
                required
              />
            </div>

            {successMessage && (
              <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                {successMessage}
              </div>
            )}

            <div className="flex items-center justify-between gap-4 flex-wrap pt-4">
              <p className="text-sm text-gray-500">Etapa 1 de 5</p>

              <button
                type="submit"
                disabled={saving}
                className="px-5 py-3 rounded-xl bg-black text-white font-medium disabled:opacity-60"
              >
                {saving ? "Salvando..." : "Salvar etapa 1"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <OrgGuard>
      <StoreProvider>
        <OnboardingContent />
      </StoreProvider>
    </OrgGuard>
  );
}
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import OrgGuard from "../../components/OrgGuard";
import { StoreProvider, useStoreContext } from "../../components/StoreProvider";
import { supabase } from "@/lib/supabaseBrowser";

type Step1FormData = {
  store_display_name: string;
  store_description: string;
  city: string;
  state: string;
  service_regions: string;
  commercial_whatsapp: string;
};

type Step2FormData = {
  pool_types: string;
  sells_chemicals: string;
  sells_accessories: string;
  offers_installation: string;
  offers_technical_visit: string;
  brands_worked: string;
};

type Step3FormData = {
  average_installation_time_days: string;
  installation_available_days: string[];
  installation_days_rule: string;
  technical_visit_available_days: string[];
  technical_visit_days_rule: string;
  average_human_response_time: string;
  installation_process: string;
  technical_visit_rules: string;
  important_limitations: string;
};

type AnswersMap = Record<string, any>;

const WEEK_DAYS = [
  { value: "segunda", label: "Segunda" },
  { value: "terca", label: "Terça" },
  { value: "quarta", label: "Quarta" },
  { value: "quinta", label: "Quinta" },
  { value: "sexta", label: "Sexta" },
  { value: "sabado", label: "Sábado" },
  { value: "domingo", label: "Domingo" },
];

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);

  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function StepBadge({
  step,
  currentStep,
  title,
}: {
  step: number;
  currentStep: number;
  title: string;
}) {
  const active = step === currentStep;

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        active
          ? "border-black bg-black text-white"
          : "border-gray-200 bg-white text-gray-700"
      }`}
    >
      <p className="text-xs opacity-80">Etapa {step}</p>
      <p className="font-medium">{title}</p>
    </div>
  );
}

function WeekdaySelector({
  selectedDays,
  onToggle,
  helperText,
}: {
  selectedDays: string[];
  onToggle: (day: string) => void;
  helperText?: string;
}) {
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {WEEK_DAYS.map((day) => {
          const selected = selectedDays.includes(day.value);

          return (
            <button
              key={day.value}
              type="button"
              onClick={() => onToggle(day.value)}
              className={`rounded-xl border px-4 py-3 text-sm text-left transition ${
                selected
                  ? "border-black bg-black text-white"
                  : "border-gray-300 bg-white text-gray-800"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex h-4 w-4 rounded-full border ${
                    selected ? "border-white bg-white" : "border-gray-400"
                  }`}
                >
                  {selected ? (
                    <span className="m-auto h-2 w-2 rounded-full bg-black" />
                  ) : null}
                </span>
                <span>{day.label}</span>
              </div>
            </button>
          );
        })}
      </div>

      {helperText && (
        <p className="text-xs text-gray-500 mt-2">{helperText}</p>
      )}
    </div>
  );
}

function OnboardingContent() {
  const { loading, error, activeStore, organizationId } = useStoreContext();

  const [currentStep, setCurrentStep] = useState(1);
  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [step1DraftRecovered, setStep1DraftRecovered] = useState(false);
  const [step2DraftRecovered, setStep2DraftRecovered] = useState(false);
  const [step3DraftRecovered, setStep3DraftRecovered] = useState(false);

  const hasHydratedRef = useRef(false);

  const [step1Form, setStep1Form] = useState<Step1FormData>({
    store_display_name: "",
    store_description: "",
    city: "",
    state: "",
    service_regions: "",
    commercial_whatsapp: "",
  });

  const [step2Form, setStep2Form] = useState<Step2FormData>({
    pool_types: "",
    sells_chemicals: "",
    sells_accessories: "",
    offers_installation: "",
    offers_technical_visit: "",
    brands_worked: "",
  });

  const [step3Form, setStep3Form] = useState<Step3FormData>({
    average_installation_time_days: "",
    installation_available_days: [],
    installation_days_rule: "",
    technical_visit_available_days: [],
    technical_visit_days_rule: "",
    average_human_response_time: "",
    installation_process: "",
    technical_visit_rules: "",
    important_limitations: "",
  });

  const step1DraftStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_step1_draft:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);

  const step2DraftStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_step2_draft:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);

  const step3DraftStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_step3_draft:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);

  const currentStepStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_current_step:${organizationId}:${activeStore.id}`;
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
        setSuccessMessage(null);
        setStep1DraftRecovered(false);
        setStep2DraftRecovered(false);
        setStep3DraftRecovered(false);
        hasHydratedRef.current = false;

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

        const serverStep1Form: Step1FormData = {
          store_display_name: answers.store_display_name ?? activeStore.name ?? "",
          store_description: answers.store_description ?? "",
          city: answers.city ?? "",
          state: answers.state ?? "",
          service_regions: Array.isArray(answers.service_regions)
            ? answers.service_regions.join(", ")
            : answers.service_regions ?? "",
          commercial_whatsapp: answers.commercial_whatsapp ?? "",
        };

        const serverStep2Form: Step2FormData = {
          pool_types: Array.isArray(answers.pool_types)
            ? answers.pool_types.join(", ")
            : answers.pool_types ?? "",
          sells_chemicals:
            typeof answers.sells_chemicals === "boolean"
              ? answers.sells_chemicals
                ? "sim"
                : "não"
              : answers.sells_chemicals ?? "",
          sells_accessories:
            typeof answers.sells_accessories === "boolean"
              ? answers.sells_accessories
                ? "sim"
                : "não"
              : answers.sells_accessories ?? "",
          offers_installation:
            typeof answers.offers_installation === "boolean"
              ? answers.offers_installation
                ? "sim"
                : "não"
              : answers.offers_installation ?? "",
          offers_technical_visit:
            typeof answers.offers_technical_visit === "boolean"
              ? answers.offers_technical_visit
                ? "sim"
                : "não"
              : answers.offers_technical_visit ?? "",
          brands_worked: Array.isArray(answers.brands_worked)
            ? answers.brands_worked.join(", ")
            : answers.brands_worked ?? "",
        };

        const serverStep3Form: Step3FormData = {
          average_installation_time_days:
            answers.average_installation_time_days ?? "",
          installation_available_days: Array.isArray(
            answers.installation_available_days
          )
            ? answers.installation_available_days
            : [],
          installation_days_rule: answers.installation_days_rule ?? "",
          technical_visit_available_days: Array.isArray(
            answers.technical_visit_available_days
          )
            ? answers.technical_visit_available_days
            : [],
          technical_visit_days_rule: answers.technical_visit_days_rule ?? "",
          average_human_response_time:
            answers.average_human_response_time ?? "",
          installation_process: answers.installation_process ?? "",
          technical_visit_rules: answers.technical_visit_rules ?? "",
          important_limitations: answers.important_limitations ?? "",
        };

        let nextStep1Form = serverStep1Form;
        let nextStep2Form = serverStep2Form;
        let nextStep3Form = serverStep3Form;
        let nextStep = 1;

        if (typeof window !== "undefined") {
          if (step1DraftStorageKey) {
            const rawDraft1 = window.localStorage.getItem(step1DraftStorageKey);
            if (rawDraft1) {
              try {
                const parsedDraft1 = JSON.parse(rawDraft1) as Partial<Step1FormData>;
                nextStep1Form = {
                  store_display_name:
                    parsedDraft1.store_display_name ?? serverStep1Form.store_display_name,
                  store_description:
                    parsedDraft1.store_description ?? serverStep1Form.store_description,
                  city: parsedDraft1.city ?? serverStep1Form.city,
                  state: parsedDraft1.state ?? serverStep1Form.state,
                  service_regions:
                    parsedDraft1.service_regions ?? serverStep1Form.service_regions,
                  commercial_whatsapp:
                    parsedDraft1.commercial_whatsapp ??
                    serverStep1Form.commercial_whatsapp,
                };
                setStep1DraftRecovered(true);
              } catch (err) {
                console.error("[OnboardingPage] erro ao ler draft step1:", err);
              }
            }
          }

          if (step2DraftStorageKey) {
            const rawDraft2 = window.localStorage.getItem(step2DraftStorageKey);
            if (rawDraft2) {
              try {
                const parsedDraft2 = JSON.parse(rawDraft2) as Partial<Step2FormData>;
                nextStep2Form = {
                  pool_types: parsedDraft2.pool_types ?? serverStep2Form.pool_types,
                  sells_chemicals:
                    parsedDraft2.sells_chemicals ?? serverStep2Form.sells_chemicals,
                  sells_accessories:
                    parsedDraft2.sells_accessories ?? serverStep2Form.sells_accessories,
                  offers_installation:
                    parsedDraft2.offers_installation ??
                    serverStep2Form.offers_installation,
                  offers_technical_visit:
                    parsedDraft2.offers_technical_visit ??
                    serverStep2Form.offers_technical_visit,
                  brands_worked:
                    parsedDraft2.brands_worked ?? serverStep2Form.brands_worked,
                };
                setStep2DraftRecovered(true);
              } catch (err) {
                console.error("[OnboardingPage] erro ao ler draft step2:", err);
              }
            }
          }

          if (step3DraftStorageKey) {
            const rawDraft3 = window.localStorage.getItem(step3DraftStorageKey);
            if (rawDraft3) {
              try {
                const parsedDraft3 = JSON.parse(rawDraft3) as Partial<Step3FormData>;
                nextStep3Form = {
                  average_installation_time_days:
                    parsedDraft3.average_installation_time_days ??
                    serverStep3Form.average_installation_time_days,
                  installation_available_days:
                    parsedDraft3.installation_available_days ??
                    serverStep3Form.installation_available_days,
                  installation_days_rule:
                    parsedDraft3.installation_days_rule ??
                    serverStep3Form.installation_days_rule,
                  technical_visit_available_days:
                    parsedDraft3.technical_visit_available_days ??
                    serverStep3Form.technical_visit_available_days,
                  technical_visit_days_rule:
                    parsedDraft3.technical_visit_days_rule ??
                    serverStep3Form.technical_visit_days_rule,
                  average_human_response_time:
                    parsedDraft3.average_human_response_time ??
                    serverStep3Form.average_human_response_time,
                  installation_process:
                    parsedDraft3.installation_process ??
                    serverStep3Form.installation_process,
                  technical_visit_rules:
                    parsedDraft3.technical_visit_rules ??
                    serverStep3Form.technical_visit_rules,
                  important_limitations:
                    parsedDraft3.important_limitations ??
                    serverStep3Form.important_limitations,
                };
                setStep3DraftRecovered(true);
              } catch (err) {
                console.error("[OnboardingPage] erro ao ler draft step3:", err);
              }
            }
          }

          if (currentStepStorageKey) {
            const rawStep = window.localStorage.getItem(currentStepStorageKey);
            if (rawStep === "2") nextStep = 2;
            if (rawStep === "3") nextStep = 3;
          }
        }

        setStep1Form(nextStep1Form);
        setStep2Form(nextStep2Form);
        setStep3Form(nextStep3Form);
        setCurrentStep(nextStep);
        hasHydratedRef.current = true;
      } catch (err) {
        console.error("[OnboardingPage] loadAnswers unexpected error:", err);
        setLoadError("Erro inesperado ao carregar onboarding.");
      } finally {
        setInitialLoading(false);
      }
    };

    loadAnswers();
  }, [
    organizationId,
    activeStore?.id,
    activeStore?.name,
    step1DraftStorageKey,
    step2DraftStorageKey,
    step3DraftStorageKey,
    currentStepStorageKey,
  ]);

  useEffect(() => {
    if (!hasHydratedRef.current || !step1DraftStorageKey) return;
    window.localStorage.setItem(step1DraftStorageKey, JSON.stringify(step1Form));
  }, [step1Form, step1DraftStorageKey]);

  useEffect(() => {
    if (!hasHydratedRef.current || !step2DraftStorageKey) return;
    window.localStorage.setItem(step2DraftStorageKey, JSON.stringify(step2Form));
  }, [step2Form, step2DraftStorageKey]);

  useEffect(() => {
    if (!hasHydratedRef.current || !step3DraftStorageKey) return;
    window.localStorage.setItem(step3DraftStorageKey, JSON.stringify(step3Form));
  }, [step3Form, step3DraftStorageKey]);

  useEffect(() => {
    if (!hasHydratedRef.current || !currentStepStorageKey) return;
    window.localStorage.setItem(currentStepStorageKey, String(currentStep));
  }, [currentStep, currentStepStorageKey]);

  function updateStep1Field<K extends keyof Step1FormData>(
    field: K,
    value: Step1FormData[K]
  ) {
    setSuccessMessage(null);
    setStep1Form((prev) => ({ ...prev, [field]: value }));
  }

  function updateStep2Field<K extends keyof Step2FormData>(
    field: K,
    value: Step2FormData[K]
  ) {
    setSuccessMessage(null);
    setStep2Form((prev) => ({ ...prev, [field]: value }));
  }

  function updateStep3Field<K extends keyof Step3FormData>(
    field: K,
    value: Step3FormData[K]
  ) {
    setSuccessMessage(null);
    setStep3Form((prev) => ({ ...prev, [field]: value }));
  }

  function toggleStep3Day(
    field: "installation_available_days" | "technical_visit_available_days",
    day: string
  ) {
    setSuccessMessage(null);
    setStep3Form((prev) => {
      const current = prev[field];
      const exists = current.includes(day);

      return {
        ...prev,
        [field]: exists
          ? current.filter((item) => item !== day)
          : [...current, day],
      };
    });
  }

  async function saveStep1(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId || !activeStore?.id) return;

    setSaving(true);
    setLoadError(null);
    setSuccessMessage(null);

    try {
      const payloads = [
        ["store_display_name", step1Form.store_display_name.trim()],
        ["store_description", step1Form.store_description.trim()],
        ["city", step1Form.city.trim()],
        ["state", step1Form.state.trim()],
        [
          "service_regions",
          step1Form.service_regions.split(",").map((i) => i.trim()).filter(Boolean),
        ],
        ["commercial_whatsapp", step1Form.commercial_whatsapp.trim()],
      ];

      for (const [questionKey, answer] of payloads) {
        const { error } = await supabase.rpc("onboarding_upsert_answer_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_question_key: questionKey,
          p_answer: answer,
        });
        if (error) throw new Error(`Falha ao salvar campo: ${questionKey}`);
      }

      const { error: statusError } = await supabase.rpc(
        "onboarding_upsert_store_onboarding_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_status: "in_progress",
        }
      );
      if (statusError) throw new Error("Falha ao atualizar status do onboarding.");

      setStep1DraftRecovered(false);
      setSuccessMessage("Etapa 1 salva com sucesso.");
      setCurrentStep(2);
    } catch (err: any) {
      console.error(err);
      setLoadError(err?.message ?? "Erro ao salvar etapa 1.");
    } finally {
      setSaving(false);
    }
  }

  async function saveStep2(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId || !activeStore?.id) return;

    setSaving(true);
    setLoadError(null);
    setSuccessMessage(null);

    try {
      const normalizeYesNo = (value: string) =>
        value.trim().toLowerCase() === "sim";

      const payloads = [
        [
          "pool_types",
          step2Form.pool_types.split(",").map((i) => i.trim()).filter(Boolean),
        ],
        ["sells_chemicals", normalizeYesNo(step2Form.sells_chemicals)],
        ["sells_accessories", normalizeYesNo(step2Form.sells_accessories)],
        ["offers_installation", normalizeYesNo(step2Form.offers_installation)],
        [
          "offers_technical_visit",
          normalizeYesNo(step2Form.offers_technical_visit),
        ],
        [
          "brands_worked",
          step2Form.brands_worked.split(",").map((i) => i.trim()).filter(Boolean),
        ],
      ];

      for (const [questionKey, answer] of payloads) {
        const { error } = await supabase.rpc("onboarding_upsert_answer_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_question_key: questionKey,
          p_answer: answer,
        });
        if (error) throw new Error(`Falha ao salvar campo: ${questionKey}`);
      }

      const { error: statusError } = await supabase.rpc(
        "onboarding_upsert_store_onboarding_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_status: "in_progress",
        }
      );
      if (statusError) throw new Error("Falha ao atualizar status do onboarding.");

      setStep2DraftRecovered(false);
      setSuccessMessage("Etapa 2 salva com sucesso.");
      setCurrentStep(3);
    } catch (err: any) {
      console.error(err);
      setLoadError(err?.message ?? "Erro ao salvar etapa 2.");
    } finally {
      setSaving(false);
    }
  }

  async function saveStep3(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId || !activeStore?.id) return;

    setSaving(true);
    setLoadError(null);
    setSuccessMessage(null);

    try {
      const payloads = [
        [
          "average_installation_time_days",
          step3Form.average_installation_time_days.trim(),
        ],
        ["installation_available_days", step3Form.installation_available_days],
        ["installation_days_rule", step3Form.installation_days_rule.trim()],
        [
          "technical_visit_available_days",
          step3Form.technical_visit_available_days,
        ],
        ["technical_visit_days_rule", step3Form.technical_visit_days_rule.trim()],
        [
          "average_human_response_time",
          step3Form.average_human_response_time.trim(),
        ],
        ["installation_process", step3Form.installation_process.trim()],
        ["technical_visit_rules", step3Form.technical_visit_rules.trim()],
        ["important_limitations", step3Form.important_limitations.trim()],
      ];

      for (const [questionKey, answer] of payloads) {
        const { error } = await supabase.rpc("onboarding_upsert_answer_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_question_key: questionKey,
          p_answer: answer,
        });
        if (error) throw new Error(`Falha ao salvar campo: ${questionKey}`);
      }

      const { error: statusError } = await supabase.rpc(
        "onboarding_upsert_store_onboarding_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_status: "in_progress",
        }
      );
      if (statusError) throw new Error("Falha ao atualizar status do onboarding.");

      setStep3DraftRecovered(false);
      setSuccessMessage("Etapa 3 salva com sucesso.");
    } catch (err: any) {
      console.error(err);
      setLoadError(err?.message ?? "Erro ao salvar etapa 3.");
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

  if (!activeStore || !organizationId) return null;

  return (
    <div className="min-h-screen bg-gray-100 px-6 py-10">
      <div className="max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-6">
          <StepBadge step={1} currentStep={currentStep} title="Loja" />
          <StepBadge step={2} currentStep={currentStep} title="Catálogo" />
          <StepBadge step={3} currentStep={currentStep} title="Operação" />
          <StepBadge step={4} currentStep={currentStep} title="Comercial" />
          <StepBadge step={5} currentStep={currentStep} title="Ativação" />
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="mb-8">
            <p className="text-sm font-medium text-gray-500 mb-2">
              Onboarding inicial
            </p>
            <h1 className="text-3xl font-bold text-gray-900 mb-3">
              {currentStep === 1 && "Etapa 1 — Identidade da loja"}
              {currentStep === 2 && "Etapa 2 — O que a loja vende"}
              {currentStep === 3 && "Etapa 3 — Operação da loja"}
            </h1>

            <p className="text-gray-600 leading-7">
              {currentStep === 1 &&
                "Vamos configurar os dados principais da loja para a IA entender quem você é, onde atende e como deve se apresentar aos clientes."}
              {currentStep === 2 &&
                "Agora vamos dizer para a IA o que sua loja vende e quais serviços ela realmente oferece."}
              {currentStep === 3 &&
                "Agora vamos configurar como sua loja funciona no dia a dia, para a IA responder do jeito certo."}
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 mb-6">
            <p className="text-sm text-gray-500 mb-1">Loja ativa</p>
            <p className="text-lg font-semibold text-gray-900">
              {activeStore.name}
            </p>
          </div>

          {currentStep === 1 && step1DraftRecovered && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-6">
              Recuperamos um rascunho local da etapa 1 que ainda não tinha sido salvo.
            </div>
          )}

          {currentStep === 2 && step2DraftRecovered && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-6">
              Recuperamos um rascunho local da etapa 2 que ainda não tinha sido salvo.
            </div>
          )}

          {currentStep === 3 && step3DraftRecovered && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-6">
              Recuperamos um rascunho local da etapa 3 que ainda não tinha sido salvo.
            </div>
          )}

          {currentStep === 1 && (
            <form onSubmit={saveStep1} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nome comercial da loja
                </label>
                <input
                  type="text"
                  value={step1Form.store_display_name}
                  onChange={(e) =>
                    updateStep1Field("store_display_name", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                  placeholder="Ex.: Brilho Cristal Piscinas"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  O que sua loja faz?
                </label>
                <textarea
                  value={step1Form.store_description}
                  onChange={(e) =>
                    updateStep1Field("store_description", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black min-h-[120px]"
                  placeholder="Ex.: Vendemos piscinas, produtos e também fazemos instalação."
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
                    value={step1Form.city}
                    onChange={(e) => updateStep1Field("city", e.target.value)}
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
                    value={step1Form.state}
                    onChange={(e) => updateStep1Field("state", e.target.value)}
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
                  value={step1Form.service_regions}
                  onChange={(e) =>
                    updateStep1Field("service_regions", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                  placeholder="Ex.: Osasco, Barueri, Carapicuíba"
                  required
                />
                <p className="text-xs text-gray-500 mt-2">
                  Separe por vírgula.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  WhatsApp comercial
                </label>
                <input
                  type="text"
                  value={step1Form.commercial_whatsapp}
                  onChange={(e) =>
                    updateStep1Field(
                      "commercial_whatsapp",
                      formatPhone(e.target.value)
                    )
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
                  {saving ? "Salvando..." : "Salvar e ir para etapa 2"}
                </button>
              </div>
            </form>
          )}

          {currentStep === 2 && (
            <form onSubmit={saveStep2} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quais tipos de piscina você trabalha?
                </label>
                <input
                  type="text"
                  value={step2Form.pool_types}
                  onChange={(e) =>
                    updateStep2Field("pool_types", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                  placeholder="Ex.: fibra, alvenaria, vinil"
                  required
                />
                <p className="text-xs text-gray-500 mt-2">
                  Separe por vírgula.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Você vende produtos químicos?
                  </label>
                  <select
                    value={step2Form.sells_chemicals}
                    onChange={(e) =>
                      updateStep2Field("sells_chemicals", e.target.value)
                    }
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black bg-white"
                    required
                  >
                    <option value="">Selecione</option>
                    <option value="sim">Sim</option>
                    <option value="não">Não</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Você vende acessórios?
                  </label>
                  <select
                    value={step2Form.sells_accessories}
                    onChange={(e) =>
                      updateStep2Field("sells_accessories", e.target.value)
                    }
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black bg-white"
                    required
                  >
                    <option value="">Selecione</option>
                    <option value="sim">Sim</option>
                    <option value="não">Não</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Você faz instalação?
                  </label>
                  <select
                    value={step2Form.offers_installation}
                    onChange={(e) =>
                      updateStep2Field("offers_installation", e.target.value)
                    }
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black bg-white"
                    required
                  >
                    <option value="">Selecione</option>
                    <option value="sim">Sim</option>
                    <option value="não">Não</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Você faz visita técnica?
                  </label>
                  <select
                    value={step2Form.offers_technical_visit}
                    onChange={(e) =>
                      updateStep2Field("offers_technical_visit", e.target.value)
                    }
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black bg-white"
                    required
                  >
                    <option value="">Selecione</option>
                    <option value="sim">Sim</option>
                    <option value="não">Não</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quais marcas você trabalha?
                </label>
                <input
                  type="text"
                  value={step2Form.brands_worked}
                  onChange={(e) =>
                    updateStep2Field("brands_worked", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                  placeholder="Ex.: iGUi, Sodramar, Brustec"
                  required
                />
                <p className="text-xs text-gray-500 mt-2">
                  Separe por vírgula.
                </p>
              </div>

              {successMessage && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                  {successMessage}
                </div>
              )}

              <div className="flex items-center justify-between gap-4 flex-wrap pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setSuccessMessage(null);
                    setCurrentStep(1);
                  }}
                  className="px-5 py-3 rounded-xl border border-gray-300 bg-white text-gray-800 font-medium"
                >
                  Voltar para etapa 1
                </button>

                <div className="flex items-center gap-4">
                  <p className="text-sm text-gray-500">Etapa 2 de 5</p>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-3 rounded-xl bg-black text-white font-medium disabled:opacity-60"
                  >
                    {saving ? "Salvando..." : "Salvar e ir para etapa 3"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {currentStep === 3 && (
            <form onSubmit={saveStep3} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Em quanto tempo, em média, sua loja termina uma instalação?
                </label>
                <input
                  type="text"
                  value={step3Form.average_installation_time_days}
                  onChange={(e) =>
                    updateStep3Field(
                      "average_installation_time_days",
                      e.target.value
                    )
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                  placeholder="Ex.: 7 dias"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Em quais dias sua loja pode fazer instalação?
                </label>
                <WeekdaySelector
                  selectedDays={step3Form.installation_available_days}
                  onToggle={(day) =>
                    toggleStep3Day("installation_available_days", day)
                  }
                  helperText="Marque os dias. Se preferir, também pode escrever uma regra logo abaixo."
                />

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Regra livre dos dias de instalação
                  </label>
                  <input
                    type="text"
                    value={step3Form.installation_days_rule}
                    onChange={(e) =>
                      updateStep3Field("installation_days_rule", e.target.value)
                    }
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                    placeholder="Ex.: de segunda a sábado"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Em quais dias sua loja pode fazer visita técnica?
                </label>
                <WeekdaySelector
                  selectedDays={step3Form.technical_visit_available_days}
                  onToggle={(day) =>
                    toggleStep3Day("technical_visit_available_days", day)
                  }
                  helperText="Marque os dias. Se preferir, também pode escrever uma regra logo abaixo."
                />

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Regra livre dos dias de visita técnica
                  </label>
                  <input
                    type="text"
                    value={step3Form.technical_visit_days_rule}
                    onChange={(e) =>
                      updateStep3Field(
                        "technical_visit_days_rule",
                        e.target.value
                      )
                    }
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                    placeholder="Ex.: de terça a sexta"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Em quanto tempo, em média, uma pessoa da sua loja responde o cliente?
                </label>
                <input
                  type="text"
                  value={step3Form.average_human_response_time}
                  onChange={(e) =>
                    updateStep3Field(
                      "average_human_response_time",
                      e.target.value
                    )
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                  placeholder="Ex.: 15 minutos"
                  required
                />
                <p className="text-xs text-gray-500 mt-2">
                  Isso ajuda a IA a informar um prazo real quando precisar avisar o cliente que alguém da loja vai responder.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Como funciona o processo de instalação?
                </label>
                <textarea
                  value={step3Form.installation_process}
                  onChange={(e) =>
                    updateStep3Field("installation_process", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black min-h-[120px]"
                  placeholder="Ex.: Primeiro fazemos visita técnica, depois orçamento, aprovação do cliente, preparação do local e instalação."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Existe alguma regra importante para visita técnica?
                </label>
                <textarea
                  value={step3Form.technical_visit_rules}
                  onChange={(e) =>
                    updateStep3Field("technical_visit_rules", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black min-h-[100px]"
                  placeholder="Ex.: A visita técnica precisa ser agendada antes. Em algumas regiões cobramos deslocamento."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Existe alguma limitação importante que a IA precisa saber?
                </label>
                <textarea
                  value={step3Form.important_limitations}
                  onChange={(e) =>
                    updateStep3Field("important_limitations", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black min-h-[100px]"
                  placeholder="Ex.: Não instalamos aos domingos. Não atendemos áreas fora da região definida."
                  required
                />
              </div>

              {successMessage && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                  {successMessage}
                </div>
              )}

              <div className="flex items-center justify-between gap-4 flex-wrap pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setSuccessMessage(null);
                    setCurrentStep(2);
                  }}
                  className="px-5 py-3 rounded-xl border border-gray-300 bg-white text-gray-800 font-medium"
                >
                  Voltar para etapa 2
                </button>

                <div className="flex items-center gap-4">
                  <p className="text-sm text-gray-500">Etapa 3 de 5</p>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-3 rounded-xl bg-black text-white font-medium disabled:opacity-60"
                  >
                    {saving ? "Salvando..." : "Salvar etapa 3"}
                  </button>
                </div>
              </div>
            </form>
          )}
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
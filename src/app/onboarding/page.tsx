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
  installation_days_rule: string;
  installation_available_days: string[];
  technical_visit_days_rule: string;
  technical_visit_available_days: string[];
  average_human_response_time: string;
  installation_process: string;
  technical_visit_rules: string;
  important_limitations: string;
};

type Step4FormData = {
  average_ticket: string;
  can_offer_discount: string;
  max_discount_percent: string;
  accepted_payment_methods: string[];
  ai_can_send_price_directly: string;
  price_direct_rule: string;
  human_help_discount_cases: string;
  human_help_custom_project_cases: string;
  human_help_payment_cases: string;
};

type Step5FormData = {
  responsible_name: string;
  responsible_whatsapp: string;
  ai_should_notify_responsible: string;
  final_activation_notes: string;
  confirm_information_is_correct: boolean;
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

const PAYMENT_METHODS = [
  { value: "pix", label: "Pix" },
  { value: "cartao_credito", label: "Cartão de crédito" },
  { value: "cartao_debito", label: "Cartão de débito" },
  { value: "boleto", label: "Boleto" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "transferencia", label: "Transferência" },
  { value: "parcelado", label: "Parcelado" },
  { value: "financiamento", label: "Financiamento" },
];

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);

  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatBrazilCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";

  const number = Number(digits);
  return number.toLocaleString("pt-BR");
}

function formatPercentInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 3);
  return digits;
}

function StepBadge({
  step,
  currentStep,
  title,
  onClick,
}: {
  step: number;
  currentStep: number;
  title: string;
  onClick: () => void;
}) {
  const active = step === currentStep;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-4 py-3 text-left transition ${
        active
          ? "border-black bg-black text-white"
          : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"
      }`}
    >
      <p className="text-[11px] opacity-80">Etapa {step}</p>
      <p className="font-medium text-sm">{title}</p>
    </button>
  );
}

function WeekdaySelector({
  selectedDays,
  onToggle,
}: {
  selectedDays: string[];
  onToggle: (day: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {WEEK_DAYS.map((day) => {
        const selected = selectedDays.includes(day.value);

        return (
          <button
            key={day.value}
            type="button"
            onClick={() => onToggle(day.value)}
            className={`rounded-lg border px-3 py-2 text-sm text-left transition ${
              selected
                ? "border-black bg-black text-white"
                : "border-gray-300 bg-white text-gray-800"
            }`}
          >
            <div className="flex items-center gap-2">
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
  );
}

function PaymentMethodSelector({
  selectedItems,
  onToggle,
}: {
  selectedItems: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {PAYMENT_METHODS.map((item) => {
        const selected = selectedItems.includes(item.value);

        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onToggle(item.value)}
            className={`rounded-lg border px-3 py-2 text-sm text-left transition ${
              selected
                ? "border-black bg-black text-white"
                : "border-gray-300 bg-white text-gray-800"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex h-4 w-4 rounded-full border ${
                  selected ? "border-white bg-white" : "border-gray-400"
                }`}
              >
                {selected ? (
                  <span className="m-auto h-2 w-2 rounded-full bg-black" />
                ) : null}
              </span>
              <span>{item.label}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function OnboardingContent() {
  const { loading, error, activeStore, organizationId } = useStoreContext();

  const [currentStep, setCurrentStep] = useState(1);
  const [hydratedFromCache, setHydratedFromCache] = useState(false);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [step1DraftRecovered, setStep1DraftRecovered] = useState(false);
  const [step2DraftRecovered, setStep2DraftRecovered] = useState(false);
  const [step3DraftRecovered, setStep3DraftRecovered] = useState(false);
  const [step4DraftRecovered, setStep4DraftRecovered] = useState(false);
  const [step5DraftRecovered, setStep5DraftRecovered] = useState(false);

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
    installation_days_rule: "",
    installation_available_days: [],
    technical_visit_days_rule: "",
    technical_visit_available_days: [],
    average_human_response_time: "",
    installation_process: "",
    technical_visit_rules: "",
    important_limitations: "",
  });

  const [step4Form, setStep4Form] = useState<Step4FormData>({
    average_ticket: "",
    can_offer_discount: "",
    max_discount_percent: "",
    accepted_payment_methods: [],
    ai_can_send_price_directly: "",
    price_direct_rule: "",
    human_help_discount_cases: "",
    human_help_custom_project_cases: "",
    human_help_payment_cases: "",
  });

  const [step5Form, setStep5Form] = useState<Step5FormData>({
    responsible_name: "",
    responsible_whatsapp: "",
    ai_should_notify_responsible: "",
    final_activation_notes: "",
    confirm_information_is_correct: false,
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

  const step4DraftStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_step4_draft:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);

  const step5DraftStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_step5_draft:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);

  const currentStepStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_current_step:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);

  useEffect(() => {
    if (!organizationId || !activeStore?.id) return;

    try {
      setSuccessMessage(null);
      setLoadError(null);
      setStep1DraftRecovered(false);
      setStep2DraftRecovered(false);
      setStep3DraftRecovered(false);
      setStep4DraftRecovered(false);
      setStep5DraftRecovered(false);

      let nextStep = 1;

      if (typeof window !== "undefined") {
        if (step1DraftStorageKey) {
          const raw = window.localStorage.getItem(step1DraftStorageKey);
          if (raw) {
            try {
              setStep1Form((prev) => ({ ...prev, ...JSON.parse(raw) }));
              setStep1DraftRecovered(true);
            } catch {}
          }
        }

        if (step2DraftStorageKey) {
          const raw = window.localStorage.getItem(step2DraftStorageKey);
          if (raw) {
            try {
              setStep2Form((prev) => ({ ...prev, ...JSON.parse(raw) }));
              setStep2DraftRecovered(true);
            } catch {}
          }
        }

        if (step3DraftStorageKey) {
          const raw = window.localStorage.getItem(step3DraftStorageKey);
          if (raw) {
            try {
              setStep3Form((prev) => ({ ...prev, ...JSON.parse(raw) }));
              setStep3DraftRecovered(true);
            } catch {}
          }
        }

        if (step4DraftStorageKey) {
          const raw = window.localStorage.getItem(step4DraftStorageKey);
          if (raw) {
            try {
              setStep4Form((prev) => ({ ...prev, ...JSON.parse(raw) }));
              setStep4DraftRecovered(true);
            } catch {}
          }
        }

        if (step5DraftStorageKey) {
          const raw = window.localStorage.getItem(step5DraftStorageKey);
          if (raw) {
            try {
              setStep5Form((prev) => ({ ...prev, ...JSON.parse(raw) }));
              setStep5DraftRecovered(true);
            } catch {}
          }
        }

        if (currentStepStorageKey) {
          const rawStep = window.localStorage.getItem(currentStepStorageKey);
          if (rawStep === "2") nextStep = 2;
          if (rawStep === "3") nextStep = 3;
          if (rawStep === "4") nextStep = 4;
          if (rawStep === "5") nextStep = 5;
        }
      }

      setCurrentStep(nextStep);
      hasHydratedRef.current = true;
      setHydratedFromCache(true);
    } catch (err) {
      console.error("[OnboardingPage] hydrate local cache error:", err);
    }
  }, [
    organizationId,
    activeStore?.id,
    step1DraftStorageKey,
    step2DraftStorageKey,
    step3DraftStorageKey,
    step4DraftStorageKey,
    step5DraftStorageKey,
    currentStepStorageKey,
  ]);

  useEffect(() => {
    const loadAnswers = async () => {
      if (!organizationId || !activeStore?.id) return;

      try {
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

        setStep1Form((prev) => ({
          store_display_name:
            prev.store_display_name || answers.store_display_name || activeStore.name || "",
          store_description: prev.store_description || answers.store_description || "",
          city: prev.city || answers.city || "",
          state: prev.state || answers.state || "",
          service_regions:
            prev.service_regions ||
            (Array.isArray(answers.service_regions)
              ? answers.service_regions.join(", ")
              : answers.service_regions || ""),
          commercial_whatsapp:
            prev.commercial_whatsapp || answers.commercial_whatsapp || "",
        }));

        setStep2Form((prev) => ({
          pool_types:
            prev.pool_types ||
            (Array.isArray(answers.pool_types)
              ? answers.pool_types.join(", ")
              : answers.pool_types || ""),
          sells_chemicals:
            prev.sells_chemicals ||
            (typeof answers.sells_chemicals === "boolean"
              ? answers.sells_chemicals
                ? "sim"
                : "não"
              : answers.sells_chemicals || ""),
          sells_accessories:
            prev.sells_accessories ||
            (typeof answers.sells_accessories === "boolean"
              ? answers.sells_accessories
                ? "sim"
                : "não"
              : answers.sells_accessories || ""),
          offers_installation:
            prev.offers_installation ||
            (typeof answers.offers_installation === "boolean"
              ? answers.offers_installation
                ? "sim"
                : "não"
              : answers.offers_installation || ""),
          offers_technical_visit:
            prev.offers_technical_visit ||
            (typeof answers.offers_technical_visit === "boolean"
              ? answers.offers_technical_visit
                ? "sim"
                : "não"
              : answers.offers_technical_visit || ""),
          brands_worked:
            prev.brands_worked ||
            (Array.isArray(answers.brands_worked)
              ? answers.brands_worked.join(", ")
              : answers.brands_worked || ""),
        }));

        setStep3Form((prev) => ({
          average_installation_time_days:
            prev.average_installation_time_days ||
            answers.average_installation_time_days ||
            "",
          installation_days_rule:
            prev.installation_days_rule || answers.installation_days_rule || "",
          installation_available_days:
            prev.installation_available_days.length > 0
              ? prev.installation_available_days
              : Array.isArray(answers.installation_available_days)
              ? answers.installation_available_days
              : [],
          technical_visit_days_rule:
            prev.technical_visit_days_rule ||
            answers.technical_visit_days_rule ||
            "",
          technical_visit_available_days:
            prev.technical_visit_available_days.length > 0
              ? prev.technical_visit_available_days
              : Array.isArray(answers.technical_visit_available_days)
              ? answers.technical_visit_available_days
              : [],
          average_human_response_time:
            prev.average_human_response_time ||
            answers.average_human_response_time ||
            "",
          installation_process:
            prev.installation_process || answers.installation_process || "",
          technical_visit_rules:
            prev.technical_visit_rules || answers.technical_visit_rules || "",
          important_limitations:
            prev.important_limitations || answers.important_limitations || "",
        }));

        setStep4Form((prev) => ({
          average_ticket: prev.average_ticket || answers.average_ticket || "",
          can_offer_discount:
            prev.can_offer_discount ||
            (typeof answers.can_offer_discount === "boolean"
              ? answers.can_offer_discount
                ? "sim"
                : "não"
              : answers.can_offer_discount || ""),
          max_discount_percent:
            prev.max_discount_percent || answers.max_discount_percent || "",
          accepted_payment_methods:
            prev.accepted_payment_methods.length > 0
              ? prev.accepted_payment_methods
              : Array.isArray(answers.accepted_payment_methods)
              ? answers.accepted_payment_methods
              : [],
          ai_can_send_price_directly:
            prev.ai_can_send_price_directly ||
            (typeof answers.ai_can_send_price_directly === "boolean"
              ? answers.ai_can_send_price_directly
                ? "sim"
                : "não"
              : answers.ai_can_send_price_directly || ""),
          price_direct_rule:
            prev.price_direct_rule || answers.price_direct_rule || "",
          human_help_discount_cases:
            prev.human_help_discount_cases || answers.human_help_discount_cases || "",
          human_help_custom_project_cases:
            prev.human_help_custom_project_cases || answers.human_help_custom_project_cases || "",
          human_help_payment_cases:
            prev.human_help_payment_cases || answers.human_help_payment_cases || "",
        }));

        setStep5Form((prev) => ({
          responsible_name:
            prev.responsible_name || answers.responsible_name || "",
          responsible_whatsapp:
            prev.responsible_whatsapp || answers.responsible_whatsapp || "",
          ai_should_notify_responsible:
            prev.ai_should_notify_responsible ||
            (typeof answers.ai_should_notify_responsible === "boolean"
              ? answers.ai_should_notify_responsible
                ? "sim"
                : "não"
              : answers.ai_should_notify_responsible || ""),
          final_activation_notes:
            prev.final_activation_notes || answers.final_activation_notes || "",
          confirm_information_is_correct:
            prev.confirm_information_is_correct ||
            Boolean(answers.confirm_information_is_correct),
        }));

        setRemoteLoaded(true);
      } catch (err) {
        console.error("[OnboardingPage] loadAnswers unexpected error:", err);
        setLoadError("Erro inesperado ao carregar onboarding.");
      }
    };

    loadAnswers();
  }, [organizationId, activeStore?.id, activeStore?.name]);

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
    if (!hasHydratedRef.current || !step4DraftStorageKey) return;
    window.localStorage.setItem(step4DraftStorageKey, JSON.stringify(step4Form));
  }, [step4Form, step4DraftStorageKey]);

  useEffect(() => {
    if (!hasHydratedRef.current || !step5DraftStorageKey) return;
    window.localStorage.setItem(step5DraftStorageKey, JSON.stringify(step5Form));
  }, [step5Form, step5DraftStorageKey]);

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

  function updateStep4Field<K extends keyof Step4FormData>(
    field: K,
    value: Step4FormData[K]
  ) {
    setSuccessMessage(null);
    setStep4Form((prev) => ({ ...prev, [field]: value }));
  }

  function updateStep5Field<K extends keyof Step5FormData>(
    field: K,
    value: Step5FormData[K]
  ) {
    setSuccessMessage(null);
    setStep5Form((prev) => ({ ...prev, [field]: value }));
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

  function togglePaymentMethod(value: string) {
    setSuccessMessage(null);
    setStep4Form((prev) => {
      const exists = prev.accepted_payment_methods.includes(value);

      return {
        ...prev,
        accepted_payment_methods: exists
          ? prev.accepted_payment_methods.filter((item) => item !== value)
          : [...prev.accepted_payment_methods, value],
      };
    });
  }

  async function upsertAnswers(
    payloads: Array<[string, any]>,
    nextSuccessMessage: string,
    nextStep?: number,
    finalStatus?: "in_progress" | "completed"
  ) {
    if (!organizationId || !activeStore?.id) return;

    setSaving(true);
    setLoadError(null);
    setSuccessMessage(null);

    try {
      for (const [questionKey, answer] of payloads) {
        const { error } = await supabase.rpc("onboarding_upsert_answer_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_question_key: questionKey,
          p_answer: answer,
        });

        if (error) {
          throw new Error(`Falha ao salvar campo: ${questionKey}`);
        }
      }

      const { error: statusError } = await supabase.rpc(
        "onboarding_upsert_store_onboarding_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_status: finalStatus ?? "in_progress",
        }
      );

      if (statusError) {
        throw new Error("Falha ao atualizar status do onboarding.");
      }

      setSuccessMessage(nextSuccessMessage);

      if (nextStep) {
        setCurrentStep(nextStep);
      }
    } catch (err: any) {
      console.error("[OnboardingPage] save error:", err);
      setLoadError(err?.message ?? "Erro ao salvar etapa.");
    } finally {
      setSaving(false);
    }
  }

  async function saveStep1(e: React.FormEvent) {
    e.preventDefault();

    await upsertAnswers(
      [
        ["store_display_name", step1Form.store_display_name.trim()],
        ["store_description", step1Form.store_description.trim()],
        ["city", step1Form.city.trim()],
        ["state", step1Form.state.trim()],
        [
          "service_regions",
          step1Form.service_regions.split(",").map((i) => i.trim()).filter(Boolean),
        ],
        ["commercial_whatsapp", step1Form.commercial_whatsapp.trim()],
      ],
      "Etapa 1 salva com sucesso.",
      2
    );

    setStep1DraftRecovered(false);
  }

  async function saveStep2(e: React.FormEvent) {
    e.preventDefault();

    const normalizeYesNo = (value: string) =>
      value.trim().toLowerCase() === "sim";

    await upsertAnswers(
      [
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
      ],
      "Etapa 2 salva com sucesso.",
      3
    );

    setStep2DraftRecovered(false);
  }

  async function saveStep3(e: React.FormEvent) {
    e.preventDefault();

    await upsertAnswers(
      [
        [
          "average_installation_time_days",
          step3Form.average_installation_time_days.trim(),
        ],
        ["installation_days_rule", step3Form.installation_days_rule.trim()],
        ["installation_available_days", step3Form.installation_available_days],
        ["technical_visit_days_rule", step3Form.technical_visit_days_rule.trim()],
        [
          "technical_visit_available_days",
          step3Form.technical_visit_available_days,
        ],
        [
          "average_human_response_time",
          step3Form.average_human_response_time.trim(),
        ],
        ["installation_process", step3Form.installation_process.trim()],
        ["technical_visit_rules", step3Form.technical_visit_rules.trim()],
        ["important_limitations", step3Form.important_limitations.trim()],
      ],
      "Etapa 3 salva com sucesso.",
      4
    );

    setStep3DraftRecovered(false);
  }

  async function saveStep4(e: React.FormEvent) {
    e.preventDefault();

    const normalizeYesNo = (value: string) =>
      value.trim().toLowerCase() === "sim";

    await upsertAnswers(
      [
        ["average_ticket", step4Form.average_ticket.trim()],
        ["can_offer_discount", normalizeYesNo(step4Form.can_offer_discount)],
        ["max_discount_percent", step4Form.max_discount_percent.trim()],
        ["accepted_payment_methods", step4Form.accepted_payment_methods],
        [
          "ai_can_send_price_directly",
          normalizeYesNo(step4Form.ai_can_send_price_directly),
        ],
        ["price_direct_rule", step4Form.price_direct_rule.trim()],
        ["human_help_discount_cases", step4Form.human_help_discount_cases.trim()],
        [
          "human_help_custom_project_cases",
          step4Form.human_help_custom_project_cases.trim(),
        ],
        ["human_help_payment_cases", step4Form.human_help_payment_cases.trim()],
      ],
      "Etapa 4 salva com sucesso.",
      5
    );

    setStep4DraftRecovered(false);
  }

  async function saveStep5(e: React.FormEvent) {
    e.preventDefault();

    const normalizeYesNo = (value: string) =>
      value.trim().toLowerCase() === "sim";

    await upsertAnswers(
      [
        ["responsible_name", step5Form.responsible_name.trim()],
        ["responsible_whatsapp", step5Form.responsible_whatsapp.trim()],
        [
          "ai_should_notify_responsible",
          normalizeYesNo(step5Form.ai_should_notify_responsible),
        ],
        ["final_activation_notes", step5Form.final_activation_notes.trim()],
        [
          "confirm_information_is_correct",
          step5Form.confirm_information_is_correct,
        ],
      ],
      "Onboarding concluído com sucesso.",
      undefined,
      "completed"
    );

    setStep5DraftRecovered(false);
  }

  if (loading || (!hydratedFromCache && !remoteLoaded)) {
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
    <div className="min-h-screen bg-gray-100 px-4 py-6">
      <div className="max-w-4xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <StepBadge
            step={1}
            currentStep={currentStep}
            title="Loja"
            onClick={() => {
              setSuccessMessage(null);
              setCurrentStep(1);
            }}
          />
          <StepBadge
            step={2}
            currentStep={currentStep}
            title="Catálogo"
            onClick={() => {
              setSuccessMessage(null);
              setCurrentStep(2);
            }}
          />
          <StepBadge
            step={3}
            currentStep={currentStep}
            title="Operação"
            onClick={() => {
              setSuccessMessage(null);
              setCurrentStep(3);
            }}
          />
          <StepBadge
            step={4}
            currentStep={currentStep}
            title="Comercial"
            onClick={() => {
              setSuccessMessage(null);
              setCurrentStep(4);
            }}
          />
          <StepBadge
            step={5}
            currentStep={currentStep}
            title="Ativação"
            onClick={() => {
              setSuccessMessage(null);
              setCurrentStep(5);
            }}
          />
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <div className="mb-6">
            <p className="text-sm font-medium text-gray-500 mb-1">
              Onboarding inicial
            </p>

            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {currentStep === 1 && "Etapa 1 — Loja"}
              {currentStep === 2 && "Etapa 2 — Catálogo"}
              {currentStep === 3 && "Etapa 3 — Operação da loja"}
              {currentStep === 4 && "Etapa 4 — Comercial"}
              {currentStep === 5 && "Etapa 5 — Ativação"}
            </h1>

            <p className="text-gray-600 leading-6 text-sm">
              {currentStep === 1 &&
                "Vamos preencher os dados principais da loja."}
              {currentStep === 2 &&
                "Agora vamos dizer o que sua loja vende e quais serviços oferece."}
              {currentStep === 3 &&
                "Agora vamos configurar como sua loja funciona no dia a dia."}
              {currentStep === 4 &&
                "Agora vamos configurar as regras comerciais da loja."}
              {currentStep === 5 &&
                "Agora vamos finalizar a ativação da IA para a sua loja."}
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 mb-4">
            <p className="text-xs text-gray-500 mb-1">Loja ativa</p>
            <p className="text-base font-semibold text-gray-900">
              {activeStore.name}
            </p>
          </div>

          {currentStep === 1 && step1DraftRecovered && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4">
              Recuperamos um rascunho local da etapa 1 que ainda não tinha sido salvo.
            </div>
          )}

          {currentStep === 2 && step2DraftRecovered && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4">
              Recuperamos um rascunho local da etapa 2 que ainda não tinha sido salvo.
            </div>
          )}

          {currentStep === 3 && step3DraftRecovered && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4">
              Recuperamos um rascunho local da etapa 3 que ainda não tinha sido salvo.
            </div>
          )}

          {currentStep === 4 && step4DraftRecovered && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4">
              Recuperamos um rascunho local da etapa 4 que ainda não tinha sido salvo.
            </div>
          )}

          {currentStep === 5 && step5DraftRecovered && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4">
              Recuperamos um rascunho local da etapa 5 que ainda não tinha sido salvo.
            </div>
          )}

          {currentStep === 1 && (
            <form onSubmit={saveStep1} className="space-y-4">
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
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
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
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black min-h-[110px]"
                  placeholder="Ex.: Vendemos piscinas, produtos e também fazemos instalação."
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Cidade
                  </label>
                  <input
                    type="text"
                    value={step1Form.city}
                    onChange={(e) => updateStep1Field("city", e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
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
                    className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
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
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: Osasco, Barueri, Carapicuíba"
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
                  value={step1Form.commercial_whatsapp}
                  onChange={(e) =>
                    updateStep1Field(
                      "commercial_whatsapp",
                      formatPhone(e.target.value)
                    )
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: (11) 99999-9999"
                  required
                />
              </div>

              {successMessage && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                  {successMessage}
                </div>
              )}

              <div className="flex items-center justify-between gap-4 flex-wrap pt-2">
                <p className="text-sm text-gray-500">Etapa 1 de 5</p>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-black text-white font-medium disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar e ir para etapa 2"}
                </button>
              </div>
            </form>
          )}

          {currentStep === 2 && (
            <form onSubmit={saveStep2} className="space-y-4">
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
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: fibra, alvenaria, vinil"
                  required
                />
                <p className="text-xs text-gray-500 mt-2">Separe por vírgula.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Você vende produtos químicos?
                  </label>
                  <select
                    value={step2Form.sells_chemicals}
                    onChange={(e) =>
                      updateStep2Field("sells_chemicals", e.target.value)
                    }
                    className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black bg-white"
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
                    className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black bg-white"
                    required
                  >
                    <option value="">Selecione</option>
                    <option value="sim">Sim</option>
                    <option value="não">Não</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Você faz instalação?
                  </label>
                  <select
                    value={step2Form.offers_installation}
                    onChange={(e) =>
                      updateStep2Field("offers_installation", e.target.value)
                    }
                    className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black bg-white"
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
                    className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black bg-white"
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
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: iGUi, Sodramar, Brustec"
                  required
                />
                <p className="text-xs text-gray-500 mt-2">Separe por vírgula.</p>
              </div>

              {successMessage && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                  {successMessage}
                </div>
              )}

              <div className="flex items-center justify-between gap-4 flex-wrap pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSuccessMessage(null);
                    setCurrentStep(1);
                  }}
                  className="px-5 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-800 font-medium"
                >
                  Voltar para etapa 1
                </button>

                <div className="flex items-center gap-4">
                  <p className="text-sm text-gray-500">Etapa 2 de 5</p>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 rounded-xl bg-black text-white font-medium disabled:opacity-60"
                  >
                    {saving ? "Salvando..." : "Salvar e ir para etapa 3"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {currentStep === 3 && (
            <form onSubmit={saveStep3} className="space-y-5">
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
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: 7 dias"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Regra livre dos dias de instalação
                </label>
                <input
                  type="text"
                  value={step3Form.installation_days_rule}
                  onChange={(e) =>
                    updateStep3Field("installation_days_rule", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: de segunda a sábado"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Em quais dias sua loja pode fazer instalação?
                </label>
                <WeekdaySelector
                  selectedDays={step3Form.installation_available_days}
                  onToggle={(day) =>
                    toggleStep3Day("installation_available_days", day)
                  }
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Regra livre dos dias de visita técnica
                </label>
                <input
                  type="text"
                  value={step3Form.technical_visit_days_rule}
                  onChange={(e) =>
                    updateStep3Field("technical_visit_days_rule", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: de terça a sexta"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Em quais dias sua loja pode fazer visita técnica?
                </label>
                <WeekdaySelector
                  selectedDays={step3Form.technical_visit_available_days}
                  onToggle={(day) =>
                    toggleStep3Day("technical_visit_available_days", day)
                  }
                />
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
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
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
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black min-h-[100px]"
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
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black min-h-[90px]"
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
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black min-h-[90px]"
                  placeholder="Ex.: Não instalamos aos domingos. Não atendemos áreas fora da região definida."
                  required
                />
              </div>

              {successMessage && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                  {successMessage}
                </div>
              )}

              <div className="flex items-center justify-between gap-4 flex-wrap pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSuccessMessage(null);
                    setCurrentStep(2);
                  }}
                  className="px-5 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-800 font-medium"
                >
                  Voltar para etapa 2
                </button>

                <div className="flex items-center gap-4">
                  <p className="text-sm text-gray-500">Etapa 3 de 5</p>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 rounded-xl bg-black text-white font-medium disabled:opacity-60"
                  >
                    {saving ? "Salvando..." : "Salvar e ir para etapa 4"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {currentStep === 4 && (
            <form onSubmit={saveStep4} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Qual é o ticket médio da sua loja?
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                    R$
                  </span>
                  <input
                    type="text"
                    value={step4Form.average_ticket}
                    onChange={(e) =>
                      updateStep4Field(
                        "average_ticket",
                        formatBrazilCurrencyInput(e.target.value)
                      )
                    }
                    className="w-full rounded-xl border border-gray-300 pl-12 pr-4 py-2.5 outline-none focus:border-black"
                    placeholder="1.000"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Sua loja pode dar desconto?
                </label>
                <select
                  value={step4Form.can_offer_discount}
                  onChange={(e) =>
                    updateStep4Field("can_offer_discount", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black bg-white"
                  required
                >
                  <option value="">Selecione</option>
                  <option value="sim">Sim</option>
                  <option value="não">Não</option>
                </select>
              </div>

              {step4Form.can_offer_discount === "sim" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Qual é o desconto máximo que pode ser oferecido?
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={step4Form.max_discount_percent}
                      onChange={(e) =>
                        updateStep4Field(
                          "max_discount_percent",
                          formatPercentInput(e.target.value)
                        )
                      }
                      className="w-full rounded-xl border border-gray-300 pl-4 pr-10 py-2.5 outline-none focus:border-black"
                      placeholder="10"
                      required
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                      %
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quais formas de pagamento sua loja aceita?
                </label>
                <PaymentMethodSelector
                  selectedItems={step4Form.accepted_payment_methods}
                  onToggle={togglePaymentMethod}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  A IA pode passar preço direto para o cliente?
                </label>
                <select
                  value={step4Form.ai_can_send_price_directly}
                  onChange={(e) =>
                    updateStep4Field("ai_can_send_price_directly", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black bg-white"
                  required
                >
                  <option value="">Selecione</option>
                  <option value="sim">Sim</option>
                  <option value="não">Não</option>
                </select>
                <p className="text-xs text-gray-500 mt-2">
                  Aqui queremos saber se a IA pode falar valores diretamente ou se antes precisa chamar alguém da loja.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quando a IA pode passar preço?
                </label>
                <textarea
                  value={step4Form.price_direct_rule}
                  onChange={(e) =>
                    updateStep4Field("price_direct_rule", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black min-h-[90px]"
                  placeholder="Ex.: Só depois de entender o tipo de piscina, medidas e se o cliente quer instalação."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Em quais casos a IA deve chamar uma pessoa por causa de desconto?
                </label>
                <textarea
                  value={step4Form.human_help_discount_cases}
                  onChange={(e) =>
                    updateStep4Field("human_help_discount_cases", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black min-h-[80px]"
                  placeholder="Ex.: Quando o cliente pedir desconto maior que o permitido."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Em quais casos a IA deve chamar uma pessoa por causa de projeto especial?
                </label>
                <textarea
                  value={step4Form.human_help_custom_project_cases}
                  onChange={(e) =>
                    updateStep4Field(
                      "human_help_custom_project_cases",
                      e.target.value
                    )
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black min-h-[80px]"
                  placeholder="Ex.: Projeto fora do padrão, instalação diferente, dúvida técnica mais complexa."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Em quais casos a IA deve chamar uma pessoa por causa de pagamento?
                </label>
                <textarea
                  value={step4Form.human_help_payment_cases}
                  onChange={(e) =>
                    updateStep4Field("human_help_payment_cases", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black min-h-[80px]"
                  placeholder="Ex.: Parcelamento diferente, financiamento, condição fora do normal."
                  required
                />
              </div>

              {successMessage && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                  {successMessage}
                </div>
              )}

              <div className="flex items-center justify-between gap-4 flex-wrap pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSuccessMessage(null);
                    setCurrentStep(3);
                  }}
                  className="px-5 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-800 font-medium"
                >
                  Voltar para etapa 3
                </button>

                <div className="flex items-center gap-4">
                  <p className="text-sm text-gray-500">Etapa 4 de 5</p>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 rounded-xl bg-black text-white font-medium disabled:opacity-60"
                  >
                    {saving ? "Salvando..." : "Salvar e ir para etapa 5"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {currentStep === 5 && (
            <form onSubmit={saveStep5} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Qual é o nome da pessoa responsável pela loja?
                </label>
                <input
                  type="text"
                  value={step5Form.responsible_name}
                  onChange={(e) =>
                    updateStep5Field("responsible_name", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: Carlos Silva"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Qual é o WhatsApp dessa pessoa?
                </label>
                <input
                  type="text"
                  value={step5Form.responsible_whatsapp}
                  onChange={(e) =>
                    updateStep5Field(
                      "responsible_whatsapp",
                      formatPhone(e.target.value)
                    )
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: (11) 99999-9999"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  A IA deve avisar essa pessoa quando surgir algo importante?
                </label>
                <select
                  value={step5Form.ai_should_notify_responsible}
                  onChange={(e) =>
                    updateStep5Field(
                      "ai_should_notify_responsible",
                      e.target.value
                    )
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black bg-white"
                  required
                >
                  <option value="">Selecione</option>
                  <option value="sim">Sim</option>
                  <option value="não">Não</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Existe alguma orientação final importante para ativar a IA?
                </label>
                <textarea
                  value={step5Form.final_activation_notes}
                  onChange={(e) =>
                    updateStep5Field("final_activation_notes", e.target.value)
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black min-h-[90px]"
                  placeholder="Ex.: A IA deve ser educada, direta e nunca prometer serviço fora da área atendida."
                  required
                />
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={step5Form.confirm_information_is_correct}
                    onChange={(e) =>
                      updateStep5Field(
                        "confirm_information_is_correct",
                        e.target.checked
                      )
                    }
                    className="mt-1"
                  />
                  <span className="text-sm text-gray-700">
                    Confirmo que as informações preenchidas até aqui estão corretas.
                  </span>
                </label>
              </div>

              {successMessage && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                  {successMessage}
                </div>
              )}

              <div className="flex items-center justify-between gap-4 flex-wrap pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSuccessMessage(null);
                    setCurrentStep(4);
                  }}
                  className="px-5 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-800 font-medium"
                >
                  Voltar para etapa 4
                </button>

                <div className="flex items-center gap-4">
                  <p className="text-sm text-gray-500">Etapa 5 de 5</p>
                  <button
                    type="submit"
                    disabled={saving || !step5Form.confirm_information_is_correct}
                    className="px-5 py-2.5 rounded-xl bg-black text-white font-medium disabled:opacity-60"
                  >
                    {saving ? "Finalizando..." : "Concluir onboarding"}
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
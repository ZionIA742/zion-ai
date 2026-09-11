"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import OrgGuard from "../../components/OrgGuard";
import { StoreProvider, useStoreContext } from "../../components/StoreProvider";
import { supabase } from "@/lib/supabaseBrowser";
import {
  createStoreStrategySettingsInputFromSources,
  normalizeStoreStrategySettingsInput,
  type StoreStrategySettingsInput,
  type StoreStrategySettingsRow,
} from "@/lib/store-strategy-settings";

type AnswersMap = Record<string, unknown>;

type Option = {
  value: string;
  label: string;
  hint?: string;
};

type Step1FormData = {
  store_display_name: string;
  store_description: string;
  city: string;
  state: string;
};

type Step2FormData = {
  store_services: string[];
  store_services_other: string;
  brands_worked: string[];
  brands_worked_other: string;
};

type Step3FormData = {
  responsible_name: string;
  responsible_whatsapp: string;
};

type CanonicalPrimaryResponsible = {
  name?: string | null;
  whatsappNumber?: string | null;
  role?: string | null;
};

type StorePrimaryResponsibleApiResponse = {
  ok: boolean;
  responsible?: CanonicalPrimaryResponsible | null;
  error?: string;
  message?: string;
};

type StoreWhatsappStatusApiResponse = {
  ok: boolean;
  connected?: boolean;
  provider?: string | null;
  status?: string | null;
  isActive?: boolean;
  displayPhoneNumber?: string | null;
  phoneNumberId?: string | null;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  lastSafeError?: string | null;
  error?: string;
  message?: string;
};

function isKnownWhatsappOperationalUnavailability(
  response: Response,
  result: StoreWhatsappStatusApiResponse | null,
): boolean {
  if (response.ok || !result) return false;

  const safeMessage = cleanText(result.message);
  return Boolean(
    result.ok === false &&
      safeMessage &&
      (response.status === 400 || response.status === 401 || response.status === 403),
  );
}

const STORE_SERVICE_OPTIONS: Option[] = [
  { value: "venda_piscinas", label: "Venda de piscinas" },
  { value: "venda_produtos_quimicos", label: "Produtos químicos" },
  { value: "venda_acessorios", label: "Acessórios" },
  { value: "instalacao_piscinas", label: "Instalação de piscinas" },
  { value: "visita_tecnica", label: "Visita técnica" },
  { value: "manutencao", label: "Manutenção / limpeza" },
  { value: "outro", label: "Outro produto ou serviço" },
];

const POOL_MARKET_BRAND_OPTIONS: Option[] = [
  { value: "iGUi", label: "iGUi" },
  { value: "Henrimar", label: "Henrimar" },
  { value: "Fiber", label: "Fiber" },
  { value: "Fibratec", label: "Fibratec" },
  { value: "Sodramar", label: "Sodramar" },
  { value: "Nautilus", label: "Nautilus" },
  { value: "Jacuzzi", label: "Jacuzzi" },
  { value: "Dancor", label: "Dancor" },
  { value: "Syllent", label: "Syllent" },
  { value: "Pooltec", label: "Pooltec" },
  { value: "AstralPool", label: "AstralPool" },
  { value: "Veico", label: "Veico" },
  { value: "Albacete", label: "Albacete" },
  { value: "Panozon", label: "Panozon" },
  { value: "Sibrape / Pentair", label: "Sibrape / Pentair" },
  { value: "HTH", label: "HTH" },
  { value: "Genco", label: "Genco" },
  { value: "Hidroall", label: "Hidroall" },
  { value: "Maresias", label: "Maresias" },
  { value: "CTX Professional", label: "CTX Professional" },
  { value: "outro", label: "Outra marca" },
];

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function extractOnboardingStatus(value: unknown) {
  if (Array.isArray(value)) return extractOnboardingStatus(value[0]);
  if (value && typeof value === "object" && "status" in value) {
    return cleanText((value as { status?: unknown }).status).toLowerCase();
  }
  return cleanText(value).toLowerCase();
}

function mapOnboardingCompletionError(error: unknown) {
  const value = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  } | null;
  const raw = [
    value?.code,
    value?.message,
    value?.details,
    value?.hint,
  ]
    .map(cleanText)
    .join(" ");

  if (raw.includes("P19A_ONBOARDING_NOT_READY:STORE_NAME")) {
    return "Os dados da loja ainda não foram salvos. Revise a Etapa 1 e tente novamente.";
  }
  if (
    raw.includes("P19A_ONBOARDING_NOT_READY:STORE_DESCRIPTION") ||
    raw.includes("P19A_ONBOARDING_NOT_READY:CITY") ||
    raw.includes("P19A_ONBOARDING_NOT_READY:STATE")
  ) {
    return "Revise a Etapa 1 do onboarding e salve os dados essenciais da loja novamente.";
  }
  if (raw.includes("P19A_ONBOARDING_NOT_READY:STORE_SERVICES")) {
    return "Revise a Etapa 2 do onboarding e salve as atividades principais da loja novamente.";
  }
  if (
    raw.includes("P19A_ONBOARDING_NOT_READY:PRIMARY_RESPONSIBLE") ||
    raw.includes("P19A_ONBOARDING_NOT_READY:RESPONSIBLE_NAME") ||
    raw.includes("P19A_ONBOARDING_NOT_READY:RESPONSIBLE_WHATSAPP")
  ) {
    return "Revise a Etapa 3 do onboarding e salve o responsável principal novamente.";
  }
  if (raw.includes("P19A_ONBOARDING_NOT_READY:WHATSAPP_COMMERCIAL")) {
    return "O WhatsApp comercial ainda não está pronto. Confira a conexão oficial e tente novamente.";
  }

  return "Não foi possível confirmar todos os dados essenciais salvos. Revise as etapas do onboarding e tente novamente.";
}

function parseArrayAnswer(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeOptionToken(value: unknown) {
  return cleanText(value).toLocaleLowerCase("pt-BR");
}

function resolveMultiChoiceFromStored(value: unknown, options: Option[]) {
  const storedValues = parseArrayAnswer(value);
  const selected: string[] = [];
  const otherValues: string[] = [];

  for (const item of storedValues) {
    const normalizedItem = normalizeOptionToken(item);
    const matched = options.find(
      (option) =>
        option.value !== "outro" &&
        (normalizeOptionToken(option.value) === normalizedItem ||
          normalizeOptionToken(option.label) === normalizedItem),
    );

    if (matched) {
      if (!selected.includes(matched.value)) selected.push(matched.value);
    } else if (item) {
      otherValues.push(item);
    }
  }

  if (otherValues.length > 0) selected.push("outro");
  return { selected, other: otherValues.join(", ") };
}

function resolveMultiChoiceText(values: string[], other: string, options: Option[]) {
  return [
    ...values
      .filter((value) => value !== "outro")
      .map((value) => options.find((option) => option.value === value)?.label || value),
    values.includes("outro") ? cleanText(other) : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function normalizeWhatsappDigits(value: string) {
  let digits = value.replace(/[^\d]/g, "");
  if (digits.startsWith("55")) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  return digits ? `55${digits}` : "";
}

function formatWhatsappInput(value: string) {
  const canonical = normalizeWhatsappDigits(value);
  if (!canonical) return "";

  const national = canonical.slice(2);
  const ddd = national.slice(0, 2);
  const local = national.slice(2);

  if (!ddd) return "+55";
  if (!local) return `+55 ${ddd}`;

  if (local.length <= 4) return `+55 ${ddd} ${local}`;

  const splitAt = local.length > 8 ? local.length - 4 : 4;
  return `+55 ${ddd} ${local.slice(0, splitAt)}-${local.slice(splitAt)}`;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function persistToLocalStorageSafe(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.error("[OnboardingPage] localStorage setItem error:", error);
  }
}

function removeFromLocalStorageSafe(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.error("[OnboardingPage] localStorage removeItem error:", error);
  }
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
      className={cx(
        "rounded-xl border px-4 py-3 text-left transition",
        active
          ? "border-black bg-black text-white"
          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
      )}
    >
      <p className="text-xs font-medium opacity-80">Etapa {step}</p>
      <p className="mt-1 text-sm font-semibold">{title}</p>
    </button>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-medium text-gray-900">{title}</h2>
      {hint ? <p className="mt-1 text-sm leading-6 text-gray-500">{hint}</p> : null}
    </div>
  );
}

function InfoBlock({
  title,
  description,
  tone = "subtle",
}: {
  title: string;
  description: string;
  tone?: "subtle" | "warning" | "success";
}) {
  return (
    <div
      className={cx(
        "rounded-xl border px-4 py-3",
        tone === "warning" && "border-amber-300 bg-amber-50 text-amber-900",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-900",
        tone === "subtle" && "border-gray-200 bg-gray-50 text-gray-700",
      )}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm leading-6">{description}</p>
    </div>
  );
}

function SelectorGrid({
  options,
  selectedValues,
  onToggle,
  columns = "md:grid-cols-2",
}: {
  options: Option[];
  selectedValues: string[];
  onToggle: (value: string) => void;
  columns?: string;
}) {
  return (
    <div className={cx("grid grid-cols-1 gap-3", columns)}>
      {options.map((option) => {
        const selected = selectedValues.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onToggle(option.value)}
            className={cx(
              "rounded-xl border px-4 py-3 text-left transition",
              selected
                ? "border-black bg-black text-white"
                : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50",
            )}
          >
            <div className="flex items-center gap-3">
              <span
                className={cx(
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs",
                  selected
                    ? "border-white bg-white text-black"
                    : "border-gray-300 bg-white text-transparent",
                )}
              >
                ✓
              </span>
              <div>
                <p className="text-sm font-medium">{option.label}</p>
                {option.hint ? (
                  <p className={cx("mt-1 text-xs", selected ? "text-white/80" : "text-gray-500")}>
                    {option.hint}
                  </p>
                ) : null}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function BrandSelectList({
  values,
  onChange,
  otherValue,
  onOtherChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  otherValue: string;
  onOtherChange: (value: string) => void;
}) {
  const rows = values.length > 0 ? values : [""];

  function updateRow(index: number, value: string) {
    const next = [...rows];
    next[index] = value;
    onChange(next);
  }

  function addRow() {
    onChange([...rows, ""]);
  }

  const hasOther = rows.includes("outro");

  return (
    <div className="space-y-3">
      {rows.map((value, index) => (
        <select
          key={`brand-row-${index}`}
          value={value}
          onChange={(event) => updateRow(index, event.target.value)}
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-black"
        >
          <option value="">Selecione uma marca</option>
          {POOL_MARKET_BRAND_OPTIONS.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={
                option.value !== value &&
                option.value !== "outro" &&
                rows.includes(option.value)
              }
            >
              {option.label}
            </option>
          ))}
        </select>
      ))}

      <button
        type="button"
        onClick={addRow}
        className="rounded-xl border border-dashed border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
      >
        + Adicionar mais uma marca
      </button>

      {hasOther ? (
        <input
          type="text"
          value={otherValue}
          onChange={(event) => onOtherChange(event.target.value)}
          className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
          placeholder="Qual é a outra marca? Se forem várias, separe por vírgula."
        />
      ) : null}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-gray-100 py-3 last:border-b-0 md:grid-cols-[190px_minmax(0,1fr)] md:gap-4">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value || "Não definido"}</span>
    </div>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeStore, organizationId, loading: storeLoading, refreshStores } = useStoreContext();

  const [currentStep, setCurrentStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AnswersMap>({});
  const [onboardingStatus, setOnboardingStatus] = useState("");
  const [strategySettings, setStrategySettings] = useState<StoreStrategySettingsRow | null>(null);
  const [primaryResponsible, setPrimaryResponsible] = useState<CanonicalPrimaryResponsible | null>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<StoreWhatsappStatusApiResponse | null>(null);
  const [whatsappStatusLoading, setWhatsappStatusLoading] = useState(false);
  const [whatsappStatusError, setWhatsappStatusError] = useState<string | null>(null);

  const [step1Form, setStep1Form] = useState<Step1FormData>({
    store_display_name: "",
    store_description: "",
    city: "",
    state: "",
  });

  const [step2Form, setStep2Form] = useState<Step2FormData>({
    store_services: [],
    store_services_other: "",
    brands_worked: [],
    brands_worked_other: "",
  });

  const [step3Form, setStep3Form] = useState<Step3FormData>({
    responsible_name: "",
    responsible_whatsapp: "",
  });

  const storagePrefix = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_v2:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);

  const currentStepStorageKey = storagePrefix ? `${storagePrefix}:current_step` : null;
  const step1DraftStorageKey = storagePrefix ? `${storagePrefix}:step1` : null;
  const step2DraftStorageKey = storagePrefix ? `${storagePrefix}:step2` : null;
  const step3DraftStorageKey = storagePrefix ? `${storagePrefix}:step3` : null;

  const updateStep1Field = <K extends keyof Step1FormData>(field: K, value: Step1FormData[K]) => {
    setStep1Form((current) => ({ ...current, [field]: value }));
  };

  const updateStep2Field = <K extends keyof Step2FormData>(field: K, value: Step2FormData[K]) => {
    setStep2Form((current) => ({ ...current, [field]: value }));
  };

  const updateStep3Field = <K extends keyof Step3FormData>(field: K, value: Step3FormData[K]) => {
    setStep3Form((current) => ({ ...current, [field]: value }));
  };

  function changeStep(step: number) {
    setFormError(null);
    setSuccessMessage(null);
    setCurrentStep(step);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const toggleStoreService = (value: string) => {
    setStep2Form((current) => ({
      ...current,
      store_services: current.store_services.includes(value)
        ? current.store_services.filter((item) => item !== value)
        : [...current.store_services, value],
    }));
  };

  const loadOnboardingStatus = useCallback(async () => {
    if (!organizationId || !activeStore?.id) return "";

    const { data, error } = await supabase.rpc("onboarding_get_store_onboarding_scoped", {
      p_organization_id: organizationId,
      p_store_id: activeStore.id,
    });

    if (error) {
      console.error("[OnboardingPage] loadOnboardingStatus error:", error);
      return "";
    }

    const status = cleanText(Array.isArray(data) ? data[0]?.status : data?.status).toLowerCase();
    setOnboardingStatus(status);
    return status;
  }, [organizationId, activeStore?.id]);

  const fetchWhatsappStatus = useCallback(async () => {
    if (!activeStore?.id) return;

    setWhatsappStatusLoading(true);
    setWhatsappStatusError(null);

    try {
      const response = await fetch(
        `/api/store/whatsapp/status?storeId=${encodeURIComponent(activeStore.id)}`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        },
      );

      const result = (await response.json().catch(() => null)) as StoreWhatsappStatusApiResponse | null;

      if (result && isKnownWhatsappOperationalUnavailability(response, result)) {
        setWhatsappStatus({
          ...result,
          connected: false,
          isActive: false,
          displayPhoneNumber: result.displayPhoneNumber ?? null,
        });
        setWhatsappStatusError(cleanText(result.message));
        return;
      }

      if (!result) {
        throw new Error("Não foi possível carregar o status do WhatsApp da loja.");
      }

      if (!response.ok || !result.ok) {
        throw new Error(result.message || "Não foi possível carregar o status do WhatsApp da loja.");
      }

      setWhatsappStatus(result);
    } catch (error) {
      console.error("[OnboardingPage] fetchWhatsappStatus error:", error);
      setWhatsappStatus(null);
      setWhatsappStatusError(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar o status do WhatsApp da loja.",
      );
    } finally {
      setWhatsappStatusLoading(false);
    }
  }, [activeStore?.id]);

  const loadBaseData = useCallback(async () => {
    if (!organizationId || !activeStore?.id) return;

    try {
      const [answersResult, strategySettingsResult, responsibleResponse] = await Promise.all([
        supabase.rpc("onboarding_get_answers_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
        }),
        supabase
          .from("store_strategy_settings")
          .select(
            "organization_id, store_id, city, state, service_regions, service_region_modes, service_region_primary_mode, service_region_outside_consultation, service_region_notes, store_services, store_services_other, store_description, main_store_brand, brands_worked, strategy_service_exclusions, strategy_primary_focus, strategy_sell_more, strategy_common_customer, strategy_ideal_customer, strategy_ticket_range, strategy_positioning, strategy_priority_brands, strategy_non_worked_brands, strategy_top_lines, strategy_top_products, strategy_differentials, strategy_promise_limits, strategy_ai_presentation, strategy_ai_priorities, strategy_ai_never_forget, created_at, updated_at",
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStore.id)
          .maybeSingle(),
        fetch("/api/store/primary-responsible", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        }),
      ]);

      if (answersResult.error) throw answersResult.error;
      if (strategySettingsResult.error) throw strategySettingsResult.error;

      const responsibleResult = (await responsibleResponse.json().catch(() => null)) as
        | StorePrimaryResponsibleApiResponse
        | null;

      if (!responsibleResponse.ok || !responsibleResult?.ok) {
        throw new Error(
          responsibleResult?.message || "Não foi possível carregar o responsável principal da loja.",
        );
      }

      const nextAnswers = (answersResult.data ?? {}) as AnswersMap;
      const nextStrategySettings = (strategySettingsResult.data ?? null) as StoreStrategySettingsRow | null;
      const strategyInput = createStoreStrategySettingsInputFromSources({
        answers: nextAnswers,
        settings: nextStrategySettings,
      });
      const nextResponsible = responsibleResult.responsible ?? null;

      setAnswers(nextAnswers);
      setStrategySettings(nextStrategySettings);
      setPrimaryResponsible(nextResponsible);

      const storedBrands = resolveMultiChoiceFromStored(
        strategyInput.brandsWorked,
        POOL_MARKET_BRAND_OPTIONS,
      );

      setStep1Form((current) => ({
        store_display_name:
          current.store_display_name || cleanText(nextAnswers.store_display_name) || cleanText(activeStore.name),
        store_description:
          current.store_description || cleanText(strategyInput.storeDescription),
        city: current.city || strategyInput.city,
        state: current.state || strategyInput.state,
      }));

      const baseStoreServices =
        strategyInput.storeServices.length > 0
          ? strategyInput.storeServices
          : parseArrayAnswer(nextAnswers.store_services);
      const storeServicesWithOther =
        strategyInput.storeServicesOther && !baseStoreServices.includes("outro")
          ? [...baseStoreServices, "outro"]
          : baseStoreServices;

      setStep2Form((current) => ({
        store_services:
          current.store_services.length > 0 ? current.store_services : storeServicesWithOther,
        store_services_other: current.store_services_other || strategyInput.storeServicesOther,
        brands_worked:
          current.brands_worked.length > 0 ? current.brands_worked : storedBrands.selected,
        brands_worked_other: current.brands_worked_other || storedBrands.other,
      }));

      setStep3Form((current) => ({
        responsible_name:
          current.responsible_name || cleanText(nextResponsible?.name) || cleanText(nextAnswers.responsible_name),
        responsible_whatsapp:
          current.responsible_whatsapp ||
          formatWhatsappInput(
            cleanText(nextResponsible?.whatsappNumber) || cleanText(nextAnswers.responsible_whatsapp),
          ),
      }));
    } catch (error) {
      console.error("[OnboardingPage] loadBaseData error:", error);
      setFatalError("Falha ao carregar os dados iniciais do onboarding.");
    }
  }, [organizationId, activeStore?.id, activeStore?.name]);

  useEffect(() => {
    loadBaseData();
    loadOnboardingStatus();
    fetchWhatsappStatus();
  }, [loadBaseData, loadOnboardingStatus, fetchWhatsappStatus]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (onboardingStatus === "completed") {
      router.replace("/dashboard");
    }
  }, [onboardingStatus, router]);

  useEffect(() => {
    if (!currentStepStorageKey || typeof window === "undefined") return;

    const paramStep = Number(searchParams.get("step"));
    if (paramStep >= 1 && paramStep <= 4) {
      setCurrentStep(paramStep);
      return;
    }

    const stored = Number(window.localStorage.getItem(currentStepStorageKey));
    if (stored >= 1 && stored <= 4) setCurrentStep(stored);
  }, [currentStepStorageKey, searchParams]);

  useEffect(() => {
    if (!currentStepStorageKey || typeof window === "undefined") return;
    persistToLocalStorageSafe(currentStepStorageKey, String(currentStep));
  }, [currentStep, currentStepStorageKey]);

  useEffect(() => {
    if (!step1DraftStorageKey || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(step1DraftStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<Step1FormData> & {
        store_description_other?: string;
      };
      setStep1Form((current) => ({
        ...current,
        store_display_name: cleanText(parsed.store_display_name) || current.store_display_name,
        store_description:
          cleanText(parsed.store_description) ||
          cleanText(parsed.store_description_other) ||
          current.store_description,
        city: cleanText(parsed.city) || current.city,
        state: cleanText(parsed.state) || current.state,
      }));
    } catch {}
  }, [step1DraftStorageKey]);

  useEffect(() => {
    if (!step2DraftStorageKey || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(step2DraftStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<Step2FormData> & {
        brands_worked?: string[] | string;
      };
      const normalizedBrands = Array.isArray(parsed.brands_worked)
        ? { selected: parsed.brands_worked.map(String).filter(Boolean), other: cleanText(parsed.brands_worked_other) }
        : resolveMultiChoiceFromStored(parsed.brands_worked, POOL_MARKET_BRAND_OPTIONS);

      setStep2Form((current) => ({
        ...current,
        ...parsed,
        store_services: Array.isArray(parsed.store_services)
          ? parsed.store_services.map(String).filter(Boolean)
          : current.store_services,
        brands_worked:
          normalizedBrands.selected.length > 0 ? normalizedBrands.selected : current.brands_worked,
        brands_worked_other:
          cleanText(parsed.brands_worked_other) || normalizedBrands.other || current.brands_worked_other,
      }));
    } catch {}
  }, [step2DraftStorageKey]);

  useEffect(() => {
    if (!step3DraftStorageKey || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(step3DraftStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<Step3FormData>;
      setStep3Form((current) => ({
        ...current,
        ...parsed,
        responsible_whatsapp: formatWhatsappInput(
          cleanText(parsed.responsible_whatsapp) || current.responsible_whatsapp,
        ),
      }));
    } catch {}
  }, [step3DraftStorageKey]);

  useEffect(() => {
    if (step1DraftStorageKey) {
      persistToLocalStorageSafe(step1DraftStorageKey, JSON.stringify(step1Form));
    }
  }, [step1Form, step1DraftStorageKey]);

  useEffect(() => {
    if (step2DraftStorageKey) {
      persistToLocalStorageSafe(step2DraftStorageKey, JSON.stringify(step2Form));
    }
  }, [step2Form, step2DraftStorageKey]);

  useEffect(() => {
    if (step3DraftStorageKey) {
      persistToLocalStorageSafe(step3DraftStorageKey, JSON.stringify(step3Form));
    }
  }, [step3Form, step3DraftStorageKey]);

  async function saveStrategySettingsPartial(patch: Partial<StoreStrategySettingsInput>) {
    if (!organizationId || !activeStore?.id) return null;

    const normalized = normalizeStoreStrategySettingsInput({
      ...createStoreStrategySettingsInputFromSources({
        answers,
        settings: strategySettings,
      }),
      ...patch,
    });

    const { data, error } = await supabase.rpc(
      "upsert_store_strategy_settings_with_legacy_mirror_scoped",
      {
        p_organization_id: organizationId,
        p_store_id: activeStore.id,
        p_city: normalized.value.city,
        p_state: normalized.value.state,
        p_service_regions: normalized.value.serviceRegions,
        p_service_region_modes: normalized.value.serviceRegionModes,
        p_service_region_primary_mode: normalized.value.serviceRegionPrimaryMode,
        p_service_region_outside_consultation:
          normalized.value.serviceRegionOutsideConsultation,
        p_service_region_notes: normalized.value.serviceRegionNotes,
        p_store_services: normalized.value.storeServices,
        p_store_services_other: normalized.value.storeServicesOther,
        p_store_description: normalized.value.storeDescription,
        p_main_store_brand: normalized.value.mainStoreBrand,
        p_brands_worked: normalized.value.brandsWorked,
        p_strategy_service_exclusions: normalized.value.strategyServiceExclusions,
        p_strategy_primary_focus: normalized.value.strategyPrimaryFocus,
        p_strategy_sell_more: normalized.value.strategySellMore,
        p_strategy_common_customer: normalized.value.strategyCommonCustomer,
        p_strategy_ideal_customer: normalized.value.strategyIdealCustomer,
        p_strategy_ticket_range: normalized.value.strategyTicketRange,
        p_strategy_positioning: normalized.value.strategyPositioning,
        p_strategy_priority_brands: normalized.value.strategyPriorityBrands,
        p_strategy_non_worked_brands: normalized.value.strategyNonWorkedBrands,
        p_strategy_top_lines: normalized.value.strategyTopLines,
        p_strategy_top_products: normalized.value.strategyTopProducts,
        p_strategy_differentials: normalized.value.strategyDifferentials,
        p_strategy_promise_limits: normalized.value.strategyPromiseLimits,
        p_strategy_ai_presentation: normalized.value.strategyAiPresentation,
        p_strategy_ai_priorities: normalized.value.strategyAiPriorities,
        p_strategy_ai_never_forget: normalized.value.strategyAiNeverForget,
      },
    );

    if (error) {
      throw new Error("Falha ao sincronizar as informações essenciais da loja.");
    }

    const saved = (data ?? null) as StoreStrategySettingsRow | null;
    setStrategySettings(saved);
    return saved;
  }

  async function persistAnswers(
    payloads: Array<[string, unknown]>,
    nextStatus?: "in_progress",
  ) {
    if (!organizationId || !activeStore?.id) return;

    for (const [questionKey, answer] of payloads) {
      const { error } = await supabase.rpc("onboarding_upsert_answer_scoped", {
        p_organization_id: organizationId,
        p_store_id: activeStore.id,
        p_question_key: questionKey,
        p_answer: answer,
      });

      if (error) throw new Error(`Falha ao salvar campo: ${questionKey}`);
    }

    if (payloads.length > 0) {
      setAnswers((current) => ({
        ...current,
        ...Object.fromEntries(payloads),
      }));
    }

    const resolvedStatus =
      nextStatus || (onboardingStatus === "completed" ? "completed" : "in_progress");

    const { error: statusError } = await supabase.rpc(
      "onboarding_upsert_store_onboarding_scoped",
      {
        p_organization_id: organizationId,
        p_store_id: activeStore.id,
        p_status: resolvedStatus,
      },
    );

    if (statusError) throw new Error("Falha ao atualizar o status do onboarding.");
    setOnboardingStatus(resolvedStatus);
  }

  async function saveStep1(event: FormEvent) {
    event.preventDefault();

    if (!step1Form.store_display_name.trim()) {
      setFormError("Preencha o nome da loja.");
      return;
    }
    if (!step1Form.city.trim()) {
      setFormError("Preencha a cidade onde fica a base principal da loja.");
      return;
    }
    if (!step1Form.state.trim()) {
      setFormError("Preencha o estado da loja.");
      return;
    }
    if (!organizationId || !activeStore?.id) return;

    setSaving(true);
    setFormError(null);
    setSuccessMessage(null);

    try {
      await saveStrategySettingsPartial({
        storeDescription: step1Form.store_description.trim(),
        city: step1Form.city.trim(),
        state: step1Form.state.trim(),
      });

      const response = await fetch("/api/store/update-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStore.id,
          name: step1Form.store_display_name.trim(),
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Falha ao atualizar o nome oficial da loja.");
      }

      await persistAnswers([["store_display_name", step1Form.store_display_name.trim()]]);
      await refreshStores();

      setSuccessMessage("Informações essenciais da loja salvas.");
      changeStep(2);
    } catch (error) {
      console.error("[OnboardingPage] saveStep1 error:", error);
      setFormError(error instanceof Error ? error.message : "Erro ao salvar a etapa.");
    } finally {
      setSaving(false);
    }
  }

  async function saveStep2(event: FormEvent) {
    event.preventDefault();

    if (step2Form.store_services.length === 0) {
      setFormError("Marque pelo menos uma atividade principal da loja.");
      return;
    }
    if (step2Form.store_services.includes("outro") && !step2Form.store_services_other.trim()) {
      setFormError("Informe qual é o outro produto ou serviço da loja.");
      return;
    }
    const selectedBrands = step2Form.brands_worked.filter(Boolean);
    if (selectedBrands.includes("outro") && !step2Form.brands_worked_other.trim()) {
      setFormError("Informe qual é a outra marca trabalhada pela loja.");
      return;
    }

    setSaving(true);
    setFormError(null);
    setSuccessMessage(null);

    try {
      const brandsWorked = resolveMultiChoiceText(
        selectedBrands,
        step2Form.brands_worked_other,
        POOL_MARKET_BRAND_OPTIONS,
      );

      await saveStrategySettingsPartial({
        storeServices: step2Form.store_services.filter((value) => value !== "outro"),
        storeServicesOther: step2Form.store_services.includes("outro")
          ? step2Form.store_services_other.trim()
          : "",
        brandsWorked,
      });
      await persistAnswers([]);

      setSuccessMessage("Essência comercial da loja salva.");
      changeStep(3);
    } catch (error) {
      console.error("[OnboardingPage] saveStep2 error:", error);
      setFormError(error instanceof Error ? error.message : "Erro ao salvar a etapa.");
    } finally {
      setSaving(false);
    }
  }

  async function saveStep3(event: FormEvent) {
    event.preventDefault();

    if (!step3Form.responsible_name.trim()) {
      setFormError("Preencha o nome do responsável principal.");
      return;
    }
    if (!step3Form.responsible_whatsapp.trim()) {
      setFormError("Preencha o WhatsApp autorizado do responsável.");
      return;
    }
    if (!organizationId || !activeStore?.id) return;

    setSaving(true);
    setFormError(null);
    setSuccessMessage(null);

    try {
      const { error: responsibleError } = await supabase.rpc(
        "upsert_store_primary_responsible_with_legacy_mirror_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_name: step3Form.responsible_name.trim(),
          p_whatsapp_number: normalizeWhatsappDigits(step3Form.responsible_whatsapp),
        },
      );

      if (responsibleError) {
        throw new Error("Falha ao sincronizar o responsável principal.");
      }

      await persistAnswers([]);
      setPrimaryResponsible({
        name: step3Form.responsible_name.trim(),
        whatsappNumber: normalizeWhatsappDigits(step3Form.responsible_whatsapp),
        role: cleanText(primaryResponsible?.role) || null,
      });

      setSuccessMessage("Responsável principal salvo.");
      changeStep(4);
    } catch (error) {
      console.error("[OnboardingPage] saveStep3 error:", error);
      setFormError(error instanceof Error ? error.message : "Erro ao salvar a etapa.");
    } finally {
      setSaving(false);
    }
  }

  const whatsappConnected = useMemo(() => {
    const normalizedStatus = cleanText(whatsappStatus?.status).toLowerCase();
    return Boolean(
      whatsappStatus?.connected &&
        whatsappStatus?.isActive &&
        normalizedStatus === "active" &&
        cleanText(whatsappStatus?.displayPhoneNumber),
    );
  }, [whatsappStatus]);

  const essentialsReady = useMemo(() => {
    return Boolean(
      step1Form.store_display_name.trim() &&
        step1Form.city.trim() &&
        step1Form.state.trim() &&
        step2Form.store_services.length > 0 &&
        step3Form.responsible_name.trim() &&
        step3Form.responsible_whatsapp.trim(),
    );
  }, [step1Form, step2Form, step3Form]);

  // UX-only gate; the canonical completion RPC is the final authority.
  const canActivate = essentialsReady && whatsappConnected;

  async function activateZion() {
    if (!organizationId || !activeStore?.id) return;

    if (!essentialsReady) {
      setFormError("Revise as etapas anteriores antes de ativar o ZION.");
      return;
    }

    if (!whatsappConnected) {
      setFormError("O WhatsApp comercial oficial precisa estar conectado antes da ativação.");
      return;
    }

    setSaving(true);
    setFormError(null);
    setSuccessMessage(null);

    try {
      const { data, error } = await supabase.rpc(
        "onboarding_complete_store_onboarding_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
        },
      );

      if (error) throw error;

      const completedStatus = extractOnboardingStatus(data);
      if (completedStatus !== "completed") {
        throw new Error("P19A_ONBOARDING_COMPLETION_STATUS_UNEXPECTED");
      }

      setOnboardingStatus(completedStatus);

      for (const key of [
        currentStepStorageKey,
        step1DraftStorageKey,
        step2DraftStorageKey,
        step3DraftStorageKey,
      ]) {
        if (key) removeFromLocalStorageSafe(key);
      }

      setSuccessMessage("Onboarding concluído. O ZION está pronto para seguir para a configuração detalhada.");

      window.setTimeout(() => {
        router.replace("/dashboard");
      }, 900);
    } catch (error) {
      console.error("[OnboardingPage] activateZion error:", error);
      setFormError(mapOnboardingCompletionError(error));
    } finally {
      setSaving(false);
    }
  }

  if (storeLoading) {
    return (
      <div className="min-h-screen bg-gray-100 px-4 py-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-600">Carregando loja...</p>
          </div>
        </div>
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="min-h-screen bg-gray-100 px-4 py-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
            <p className="text-sm text-red-800">{fatalError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!activeStore || !organizationId) return null;

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StepBadge step={1} currentStep={currentStep} title="Loja" onClick={() => changeStep(1)} />
          <StepBadge
            step={2}
            currentStep={currentStep}
            title="O que a loja faz"
            onClick={() => changeStep(2)}
          />
          <StepBadge
            step={3}
            currentStep={currentStep}
            title="Responsável"
            onClick={() => changeStep(3)}
          />
          <StepBadge
            step={4}
            currentStep={currentStep}
            title="WhatsApp e ativação"
            onClick={() => changeStep(4)}
          />
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">
              {currentStep === 1 && "Etapa 1 — Loja"}
              {currentStep === 2 && "Etapa 2 — O que a loja faz"}
              {currentStep === 3 && "Etapa 3 — Responsável"}
              {currentStep === 4 && "Etapa 4 — WhatsApp e ativação"}
            </h1>
          </div>

          {formError ? (
            <div className="mb-6">
              <InfoBlock title="Ajuste necessário" description={formError} tone="warning" />
            </div>
          ) : null}

          {successMessage ? (
            <div className="mb-6">
              <InfoBlock title="Tudo certo" description={successMessage} tone="success" />
            </div>
          ) : null}

          {currentStep === 1 ? (
            <form onSubmit={saveStep1} className="space-y-6">
              <div>
                <SectionTitle
                  title="Qual é o nome da loja?"
                  hint="Use o nome que deve aparecer no ZION e no atendimento ao cliente."
                />
                <input
                  type="text"
                  value={step1Form.store_display_name}
                  onChange={(event) => updateStep1Field("store_display_name", event.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: Piscinas do Vale"
                  required
                />
              </div>

              <div>
                <SectionTitle
                  title="Como você definiria a loja?"
                  hint="Descreva em poucas palavras o que a empresa é na sua essência."
                />
                <textarea
                  value={step1Form.store_description}
                  onChange={(event) => updateStep1Field("store_description", event.target.value)}
                  className="min-h-24 w-full resize-y rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                  placeholder="Ex.: Loja especializada em piscinas, equipamentos e serviços."
                />
              </div>

              <div>
                <SectionTitle
                  title="Em qual cidade e estado fica a base principal da loja?"
                  hint="Informe a cidade e o estado onde fica a base principal. Endereço completo, cobertura e regras detalhadas ficam em Configurações."
                />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_180px]">
                  <input
                    type="text"
                    value={step1Form.city}
                    onChange={(event) => updateStep1Field("city", event.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                    placeholder="Cidade"
                    required
                  />
                  <input
                    type="text"
                    value={step1Form.state}
                    onChange={(event) => updateStep1Field("state", event.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                    placeholder="Estado (ex.: São Paulo)"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end border-t border-gray-200 pt-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-black px-5 py-2.5 font-medium text-white disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar e continuar"}
                </button>
              </div>
            </form>
          ) : null}

          {currentStep === 2 ? (
            <form onSubmit={saveStep2} className="space-y-6">
              <div>
                <SectionTitle
                  title="O que a loja vende e oferece?"
                  hint="Marque somente o que faz parte da essência atual da empresa. Regras, preços e detalhes operacionais serão configurados depois."
                />
                <SelectorGrid
                  options={STORE_SERVICE_OPTIONS}
                  selectedValues={step2Form.store_services}
                  onToggle={toggleStoreService}
                />
                {step2Form.store_services.includes("outro") ? (
                  <input
                    type="text"
                    value={step2Form.store_services_other}
                    onChange={(event) => updateStep2Field("store_services_other", event.target.value)}
                    className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                    placeholder="Qual é o outro produto ou serviço?"
                  />
                ) : null}
              </div>

              <div>
                <SectionTitle
                  title="Quais marcas a loja trabalha?"
                  hint="Opcional. Selecione as principais marcas. Isso não significa que um produto esteja disponível: catálogo e estoque continuam sendo a autoridade."
                />
                <BrandSelectList
                  values={step2Form.brands_worked}
                  onChange={(values) =>
                    setStep2Form((current) => ({ ...current, brands_worked: values }))
                  }
                  otherValue={step2Form.brands_worked_other}
                  onOtherChange={(value) => updateStep2Field("brands_worked_other", value)}
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-4">
                <button
                  type="button"
                  onClick={() => changeStep(1)}
                  className="rounded-xl border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-black px-5 py-2.5 font-medium text-white disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar e continuar"}
                </button>
              </div>
            </form>
          ) : null}

          {currentStep === 3 ? (
            <form onSubmit={saveStep3} className="space-y-6">
              <div>
                <SectionTitle title="Nome do responsável principal" />
                <input
                  type="text"
                  value={step3Form.responsible_name}
                  onChange={(event) => updateStep3Field("responsible_name", event.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: Junior"
                  required
                />
              </div>


              <div>
                <SectionTitle
                  title="Qual é o WhatsApp autorizado dessa pessoa?"
                  hint="Esse não é o número comercial da loja. Depois da ativação, o ZION usará esse número para reconhecer o responsável quando ele falar com a IA Assistente pelo WhatsApp comercial da loja."
                />
                <input
                  type="text"
                  value={step3Form.responsible_whatsapp}
                  onChange={(event) =>
                    updateStep3Field("responsible_whatsapp", formatWhatsappInput(event.target.value))
                  }
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: +55 11 99999-9999"
                  required
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-4">
                <button
                  type="button"
                  onClick={() => changeStep(2)}
                  className="rounded-xl border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-black px-5 py-2.5 font-medium text-white disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar e continuar"}
                </button>
              </div>
            </form>
          ) : null}

          {currentStep === 4 ? (
            <div className="space-y-6">
              <div
                className={cx(
                  "rounded-2xl border p-5",
                  whatsappConnected
                    ? "border-emerald-200 bg-emerald-50"
                    : whatsappStatusError
                      ? "border-red-200 bg-red-50"
                      : "border-amber-200 bg-amber-50",
                )}
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">WhatsApp comercial da loja</p>
                    <p className="mt-1 text-sm leading-6 text-gray-600">
                      O número comercial deve vir da conexão oficial com a Meta. O onboarding não permite digitar ou trocar esse número manualmente.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={fetchWhatsappStatus}
                    disabled={whatsappStatusLoading}
                    className="shrink-0 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                  >
                    {whatsappStatusLoading ? "Atualizando..." : "Atualizar status"}
                  </button>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-white/80 bg-white/80 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</p>
                    <p className="mt-1 text-base font-semibold text-gray-900">
                      {whatsappConnected
                        ? "Conectado"
                        : whatsappStatusError
                          ? "Status indisponível"
                          : "Ainda não conectado"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/80 bg-white/80 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Número comercial</p>
                    <p className="mt-1 text-base font-semibold text-gray-900">
                      {formatWhatsappInput(cleanText(whatsappStatus?.displayPhoneNumber)) || "Não disponível"}
                    </p>
                  </div>
                </div>

                {whatsappStatusError ? (
                  <p className="mt-4 text-sm text-red-800">{whatsappStatusError}</p>
                ) : null}

                {!whatsappConnected ? (
                  <p className="mt-4 text-sm leading-6 text-amber-900">
                    A conexão oficial por Meta/Embedded Signup ficará nesta etapa. Nesta versão não existe botão fictício de conexão: a ativação só é liberada quando o status vivo confirmar o WhatsApp oficial.
                  </p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-gray-200 p-5">
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-gray-900">Resumo do cadastro inicial</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Apenas os dados essenciais do onboarding. Os detalhes operacionais e comerciais serão configurados depois.
                  </p>
                </div>

                <SummaryRow label="Loja" value={step1Form.store_display_name} />
                <SummaryRow
                  label="Base principal"
                  value={[step1Form.city, step1Form.state].filter(Boolean).join(" / ")}
                />
                <SummaryRow
                  label="Atuação"
                  value={[
                    ...step2Form.store_services
                      .filter((value) => value !== "outro")
                      .map(
                        (value) => STORE_SERVICE_OPTIONS.find((option) => option.value === value)?.label || value,
                      ),
                    step2Form.store_services.includes("outro")
                      ? step2Form.store_services_other
                      : "",
                  ]
                    .filter(Boolean)
                    .join(", ")}
                />
                <SummaryRow
                  label="Marcas trabalhadas"
                  value={resolveMultiChoiceText(
                    step2Form.brands_worked.filter(Boolean),
                    step2Form.brands_worked_other,
                    POOL_MARKET_BRAND_OPTIONS,
                  )}
                />
                <SummaryRow
                  label="Responsável"
                  value={step3Form.responsible_name || cleanText(primaryResponsible?.name)}
                />
                <SummaryRow
                  label="WhatsApp autorizado"
                  value={formatWhatsappInput(
                    step3Form.responsible_whatsapp || cleanText(primaryResponsible?.whatsappNumber),
                  )}
                />
                <SummaryRow
                  label="WhatsApp comercial"
                  value={formatWhatsappInput(cleanText(whatsappStatus?.displayPhoneNumber))}
                />
              </div>

              <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 md:flex-row md:items-center md:justify-between">
                <button
                  type="button"
                  onClick={() => changeStep(3)}
                  className="rounded-xl border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Voltar
                </button>

                <div className="flex flex-col items-stretch gap-2 md:items-end">
                  <button
                    type="button"
                    onClick={activateZion}
                    disabled={saving || !canActivate}
                    className="rounded-xl bg-black px-6 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {saving ? "Ativando..." : "Ativar ZION"}
                  </button>
                  {!canActivate ? (
                    <p className="max-w-md text-xs leading-5 text-gray-500 md:text-right">
                      A ativação será liberada quando os dados essenciais estiverem preenchidos e o WhatsApp comercial oficial estiver conectado.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
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

"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";
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
  store_services: string[];
  store_services_other: string;
  service_region_modes: string[];
  service_region_notes: string;
  service_region_primary_mode: string;
  service_region_outside_consultation: boolean;
};

type Step2FormData = {
  pool_types: string;
  sells_chemicals: string;
  sells_accessories: string;
  offers_installation: string;
  offers_technical_visit: string;
  brands_worked: string;
  pool_types_selected: string[];
  pool_types_other: string;
  main_store_brand: string;
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
  installation_process_steps: string[];
  installation_process_other: string;
  technical_visit_rules_selected: string[];
  technical_visit_rules_other: string;
  important_limitations_selected: string[];
  important_limitations_other: string;
  sales_flow_start_steps: string[];
  sales_flow_middle_steps: string[];
  sales_flow_final_steps: string[];
  sales_flow_notes: string;
  sales_flow_start_confirmed: boolean;
  sales_flow_middle_confirmed: boolean;
  sales_flow_final_confirmed: boolean;
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
  price_direct_conditions: string[];
  price_direct_rule_other: string;
  human_help_discount_cases_selected: string[];
  human_help_discount_cases_other: string;
  human_help_custom_project_cases_selected: string[];
  human_help_custom_project_cases_other: string;
  human_help_payment_cases_selected: string[];
  human_help_payment_cases_other: string;
  price_needs_human_help: string;
  price_talk_mode: string;
  price_must_understand_before: string[];
};

type Step5FormData = {
  responsible_name: string;
  responsible_whatsapp: string;
  ai_should_notify_responsible: string;
  final_activation_notes: string;
  confirm_information_is_correct: boolean;
  responsible_notification_cases: string[];
  responsible_notification_cases_other: string;
  activation_preferences: string[];
  activation_preferences_other: string;
};

type AnswersMap = Record<string, unknown>;

type Option = {
  value: string;
  label: string;
  hint?: string;
};

type TimeUnitOption = {
  value: string;
  label: string;
};

const WEEK_DAYS: Option[] = [
  { value: "segunda", label: "Segunda" },
  { value: "terca", label: "Terça" },
  { value: "quarta", label: "Quarta" },
  { value: "quinta", label: "Quinta" },
  { value: "sexta", label: "Sexta" },
  { value: "sabado", label: "Sábado" },
  { value: "domingo", label: "Domingo" },
];

const PAYMENT_METHOD_MAIN_OPTIONS: Option[] = [
  { value: "pix", label: "Pix" },
  { value: "cartao_credito", label: "Cartão de crédito" },
  { value: "cartao_debito", label: "Cartão de débito" },
  { value: "boleto", label: "Boleto" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "transferencia", label: "Transferência" },
];

const PAYMENT_METHOD_CONDITION_OPTIONS: Option[] = [
  { value: "parcelado", label: "Aceita parcelamento" },
  { value: "financiamento", label: "Trabalha com financiamento" },
];

const STORE_SERVICE_OPTIONS: Option[] = [
  { value: "venda_piscinas", label: "Venda de piscinas" },
  { value: "instalacao_piscinas", label: "Instalação de piscinas" },
  { value: "venda_produtos_quimicos", label: "Venda de produtos químicos" },
  { value: "venda_acessorios", label: "Venda de acessórios para piscina" },
  { value: "visita_tecnica", label: "Visita técnica" },
  { value: "manutencao", label: "Limpeza / manutenção" },
];

const SERVICE_REGION_PRIMARY_OPTIONS: Option[] = [
  { value: "somente_cidade_loja", label: "Somente a cidade da loja" },
  { value: "cidade_e_vizinhas", label: "Cidade da loja + cidades vizinhas" },
  { value: "grande_regiao", label: "Atende várias cidades da região" },
  { value: "todo_estado", label: "Todo o estado" },
];

const POOL_TYPE_OPTIONS: Option[] = [
  { value: "fibra", label: "Fibra" },
  { value: "vinil", label: "Vinil" },
  { value: "alvenaria", label: "Alvenaria" },
  { value: "pastilha", label: "Revestida / pastilha" },
  { value: "spa", label: "SPA / hidromassagem" },
  { value: "prainha", label: "Prainha / complemento" },
];

const YES_NO_OPTIONS: Option[] = [
  { value: "sim", label: "Sim" },
  { value: "não", label: "Não" },
];

const SALES_FLOW_START_OPTIONS: Option[] = [
  { value: "primeiro_atendimento", label: "Primeiro atendimento" },
  { value: "cliente_explica_o_que_quer", label: "Cliente explica o que quer" },
  { value: "cliente_manda_foto_do_local", label: "Cliente manda foto do local" },
  { value: "cliente_pergunta_preco", label: "Cliente pergunta preço" },
  { value: "cliente_pede_visita_tecnica", label: "Cliente pede visita técnica" },
  { value: "cliente_pede_orcamento", label: "Cliente pede orçamento" },
];

const SALES_FLOW_MIDDLE_OPTIONS: Option[] = [
  { value: "entender_melhor_a_necessidade", label: "Entender melhor a necessidade" },
  { value: "mostrar_opcoes_de_piscina", label: "Mostrar opções de piscina" },
  { value: "passar_faixa_de_valor", label: "Passar faixa de valor" },
  { value: "montar_orcamento", label: "Montar orçamento" },
  { value: "tirar_duvidas_tecnicas", label: "Tirar dúvidas técnicas" },
  { value: "negociar_condicao", label: "Negociar condição" },
  { value: "agendar_visita_tecnica", label: "Agendar visita técnica" },
];

const SALES_FLOW_FINAL_OPTIONS: Option[] = [
  { value: "aprovacao_do_orcamento", label: "Aprovação do orçamento" },
  { value: "pagamento_sinal", label: "Pagamento / sinal" },
  { value: "confirmacao_do_pagamento", label: "Confirmação do pagamento" },
  { value: "agendamento_da_instalacao", label: "Agendamento da instalação" },
  { value: "instalacao", label: "Instalação" },
  { value: "entrega_final", label: "Entrega final" },
  { value: "pos_venda", label: "Pós-venda" },
];

const TECHNICAL_VISIT_RULE_OPTIONS: Option[] = [
  { value: "precisa_agendar", label: "Precisa agendar antes" },
  { value: "confirmar_endereco", label: "Precisa confirmar endereço antes" },
  { value: "analise_do_local", label: "Pode depender de avaliação do local" },
  { value: "pode_ter_taxa", label: "Pode ter taxa de deslocamento" },
  { value: "somente_regiao_atendida", label: "Só atende a região cadastrada" },
  { value: "horario_comercial", label: "Somente em horário comercial" },
];

const IMPORTANT_LIMITATION_OPTIONS: Option[] = [
  { value: "nao_atende_domingo", label: "Não atende domingo" },
  { value: "nao_atende_fora_regiao", label: "Não atende fora da região definida" },
  { value: "nao_faz_obra_entorno", label: "Não faz a obra estética completa do entorno" },
  { value: "nao_passa_preco_sem_contexto", label: "Não passa preço sem entender o caso" },
  { value: "depende_avaliacao_tecnica", label: "Alguns casos dependem de avaliação técnica" },
  { value: "prazos_podem_variar", label: "Prazos podem variar conforme o projeto" },
];

const PRICE_DIRECT_BEFORE_OPTIONS: Option[] = [
  { value: "so_apos_entender_objetivo", label: "Só depois de entender o que o cliente quer" },
  { value: "so_apos_identificar_interesse_real", label: "Só depois de perceber interesse real" },
  { value: "so_apos_entender_tipo", label: "Só depois de entender o tipo de piscina ou produto" },
  { value: "so_apos_entender_medidas", label: "Só depois de entender medidas ou porte do projeto" },
  { value: "so_apos_entender_instalacao", label: "Só depois de entender se precisa instalação" },
];

const PRICE_TALK_MODE_OPTIONS: Option[] = [
  { value: "quando_cliente_perguntar", label: "Pode falar preço quando o cliente perguntar" },
  { value: "apenas_faixa_inicial", label: "Pode falar só uma faixa inicial, não valor fechado" },
  { value: "nao_falar_sozinha", label: "Não deve falar preço sozinha" },
];

const HUMAN_HELP_DISCOUNT_OPTIONS: Option[] = [
  { value: "pediu_desconto_maior", label: "Pediu desconto maior que o permitido" },
  { value: "quer_condicao_especial", label: "Quer condição especial" },
  { value: "fechamento_imediato", label: "Cliente quer fechar agora" },
  { value: "cliente_importante", label: "Cliente com alto potencial de fechar" },
];

const HUMAN_HELP_CUSTOM_PROJECT_OPTIONS: Option[] = [
  { value: "projeto_fora_padrao", label: "Projeto fora do padrão" },
  { value: "terreno_dificil", label: "Local ou terreno com dificuldade" },
  { value: "duvida_tecnica_complexa", label: "Dúvida técnica complexa" },
  { value: "pedido_muito_personalizado", label: "Pedido muito personalizado" },
  { value: "obra_complementar", label: "Pedido com obra extra além da piscina" },
];

const HUMAN_HELP_PAYMENT_OPTIONS: Option[] = [
  { value: "parcelamento_diferente", label: "Parcelamento diferente do padrão" },
  { value: "financiamento_especifico", label: "Pedido de financiamento específico" },
  { value: "prazo_especial", label: "Prazo especial de pagamento" },
  { value: "comprovante_pagamento", label: "Validação manual de pagamento" },
];

const RESPONSIBLE_NOTIFICATION_CASE_OPTIONS: Option[] = [
  { value: "pedido_desconto", label: "Pedido de desconto" },
  { value: "cliente_quase_fechando", label: "Cliente com alta chance de fechar" },
  { value: "duvida_tecnica", label: "Dúvida técnica importante" },
  { value: "pedido_visita", label: "Pedido de visita técnica" },
  { value: "pedido_instalacao", label: "Pedido de instalação" },
  { value: "problema_pagamento", label: "Problema de pagamento" },
];

const ACTIVATION_STYLE_OPTIONS: Option[] = [
  { value: "ia_direta", label: "A IA deve ser mais direta" },
  { value: "ia_humanizada", label: "A IA deve soar bem humana" },
  { value: "priorizar_qualificacao", label: "Priorizar qualificação antes de preço" },
  { value: "priorizar_agendamento", label: "Priorizar visita ou agendamento quando fizer sentido" },
];

const ACTIVATION_GUARDRAIL_OPTIONS: Option[] = [
  { value: "nao_prometer_fora_escopo", label: "Nunca prometer algo fora do que a loja realmente faz" },
  { value: "encaminhar_humano_casos_criticos", label: "Chamar uma pessoa da loja em casos críticos" },
];

const INSTALLATION_TIME_UNITS: TimeUnitOption[] = [
  { value: "dias", label: "dias" },
  { value: "semanas", label: "semanas" },
  { value: "meses", label: "meses" },
];

const HUMAN_RESPONSE_TIME_UNITS: TimeUnitOption[] = [
  { value: "minutos", label: "minutos" },
  { value: "horas", label: "horas" },
  { value: "dias úteis", label: "dias úteis" },
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
  return Number(digits).toLocaleString("pt-BR");
}

function formatPercentInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 3);
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

function joinSelectedLabels(selectedValues: string[], options: Option[], otherText?: string) {
  const labels = selectedValues
    .map((value) => options.find((option) => option.value === value)?.label || value)
    .filter(Boolean);

  if (otherText?.trim()) labels.push(otherText.trim());
  return labels.join(", ");
}

function buildArrayFromSelectedLabels(selectedValues: string[], options: Option[], otherText?: string) {
  const labels = selectedValues
    .map((value) => options.find((option) => option.value === value)?.label || value)
    .filter(Boolean);

  if (otherText?.trim()) labels.push(otherText.trim());
  return labels;
}

function toggleArrayValue<T extends string>(current: T[], value: T): T[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function parseDurationValue(value: string, units: TimeUnitOption[]) {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      amount: "",
      unit: units[0]?.value ?? "",
    };
  }

  const match = trimmed.match(/^(\d+)\s*(.*)$/);
  const amount = match?.[1] ?? "";
  const unitPart = match?.[2]?.trim() ?? "";

  const foundUnit =
    units.find((item) => normalizeText(item.value) === normalizeText(unitPart))?.value ??
    units.find((item) => normalizeText(item.label) === normalizeText(unitPart))?.value ??
    units[0]?.value ??
    "";

  return { amount, unit: foundUnit };
}

function SectionTitle({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-2">
      <label className="block text-sm font-medium text-gray-800">{title}</label>
      {hint ? <p className="mt-1 text-xs leading-5 text-gray-500">{hint}</p> : null}
    </div>
  );
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
      <p className="text-sm font-medium">{title}</p>
    </button>
  );
}

function ToggleCard({
  label,
  selected,
  onClick,
  multiple = true,
  hint,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  multiple?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border px-3 py-3 text-left transition ${
        selected
          ? "border-black bg-black text-white shadow-sm"
          : "border-gray-300 bg-white text-gray-800 hover:border-gray-400"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center border text-[11px] font-bold ${
            multiple ? "rounded-md" : "rounded-full"
          } ${
            selected
              ? "border-white bg-white text-black"
              : "border-gray-400 bg-white text-transparent"
          }`}
        >
          ✓
        </span>

        <span className="block">
          <span className="block text-sm font-medium">{label}</span>
          {hint ? (
            <span className={`mt-1 block text-xs ${selected ? "text-gray-200" : "text-gray-500"}`}>
              {hint}
            </span>
          ) : null}
        </span>
      </div>
    </button>
  );
}

function SelectorGrid({
  options,
  selectedValues,
  onToggle,
  columns = "grid-cols-1 md:grid-cols-2",
  helperText = "Você pode marcar mais de uma opção.",
}: {
  options: Option[];
  selectedValues: string[];
  onToggle: (value: string) => void;
  columns?: string;
  helperText?: string;
}) {
  return (
    <div>
      <p className="mb-2 text-xs text-gray-500">{helperText}</p>
      <div className={`grid ${columns} gap-2`}>
        {options.map((item) => (
          <ToggleCard
            key={item.value}
            label={item.label}
            hint={item.hint}
            selected={selectedValues.includes(item.value)}
            onClick={() => onToggle(item.value)}
            multiple
          />
        ))}
      </div>
    </div>
  );
}

function SingleSelectorGrid({
  options,
  value,
  onChange,
  columns = "grid-cols-1 md:grid-cols-2",
}: {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  columns?: string;
}) {
  return (
    <div className={`grid ${columns} gap-2`}>
      {options.map((item) => (
        <ToggleCard
          key={item.value}
          label={item.label}
          hint={item.hint}
          selected={value === item.value}
          onClick={() => onChange(item.value)}
          multiple={false}
        />
      ))}
    </div>
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
    <div>
      <p className="mb-2 text-xs text-gray-500">Marque todos os dias em que isso normalmente pode acontecer.</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {WEEK_DAYS.map((day) => (
          <ToggleCard
            key={day.value}
            label={day.label}
            selected={selectedDays.includes(day.value)}
            onClick={() => onToggle(day.value)}
            multiple
          />
        ))}
      </div>
    </div>
  );
}

function SummaryChip({
  label,
  active,
}: {
  label: string;
  active: boolean;
}) {
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${
        active ? "border-black bg-black text-white" : "border-gray-300 bg-white text-gray-600"
      }`}
    >
      {label}: {active ? "Sim" : "Não"}
    </span>
  );
}

function DraftNotice({ step }: { step: number }) {
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      Rascunho local da etapa {step} recuperado.
    </div>
  );
}

function InfoBlock({
  title,
  description,
  subtle = false,
}: {
  title: string;
  description: string;
  subtle?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        subtle
          ? "border-blue-100 bg-blue-50/60"
          : "border-blue-100 bg-blue-50"
      }`}
    >
      <p className="text-sm font-medium text-blue-900">{title}</p>
      <p className="mt-1 text-xs leading-5 text-blue-800">{description}</p>
    </div>
  );
}

function TimeDurationField({
  label,
  hint,
  value,
  onChange,
  units,
  placeholder = "Ex.: 7",
  required,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  units: TimeUnitOption[];
  placeholder?: string;
  required?: boolean;
}) {
  const parsed = useMemo(() => parseDurationValue(value, units), [value, units]);
  const [amount, setAmount] = useState(parsed.amount);
  const [unit, setUnit] = useState(parsed.unit);

  useEffect(() => {
    setAmount(parsed.amount);
    setUnit(parsed.unit);
  }, [parsed.amount, parsed.unit]);

  function update(nextAmount: string, nextUnit: string) {
    const cleanAmount = nextAmount.replace(/\D/g, "").slice(0, 3);
    setAmount(cleanAmount);
    setUnit(nextUnit);

    if (!cleanAmount) {
      onChange("");
      return;
    }

    onChange(`${cleanAmount} ${nextUnit}`.trim());
  }

  return (
    <div>
      <SectionTitle title={label} hint={hint} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
        <input
          type="text"
          inputMode="numeric"
          value={amount}
          onChange={(e) => update(e.target.value, unit)}
          className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
          placeholder={placeholder}
          required={required}
        />

        <select
          value={unit}
          onChange={(e) => update(amount, e.target.value)}
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 outline-none focus:border-black"
        >
          {units.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ProcessColumn({
  title,
  subtitle,
  options,
  selectedValues,
  onToggle,
  confirmed,
  confirmLabel,
  onConfirmToggle,
}: {
  title: string;
  subtitle: string;
  options: Option[];
  selectedValues: string[];
  onToggle: (value: string) => void;
  confirmed: boolean;
  confirmLabel: string;
  onConfirmToggle: () => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      <p className="mb-3 mt-1 text-xs leading-5 text-gray-500">{subtitle}</p>

      <div className="space-y-2">
        {options.map((item) => (
          <ToggleCard
            key={item.value}
            label={item.label}
            hint={item.hint}
            selected={selectedValues.includes(item.value)}
            onClick={() => onToggle(item.value)}
            multiple
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onConfirmToggle}
        className={`mt-4 w-full rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
          confirmed ? "border-black bg-black text-white" : "border-gray-300 bg-white text-gray-800"
        }`}
      >
        {confirmed ? `${confirmLabel} ✓` : confirmLabel}
      </button>
    </div>
  );
}

function OnboardingContent() {
  const { loading, error, activeStore, organizationId } = useStoreContext();
  const router = useRouter();

  const onboardingCompletedStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_completed:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);

  const [currentStep, setCurrentStep] = useState(1);
  const [hydratedFromCache, setHydratedFromCache] = useState(false);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [hasCompletedOnboardingOnce, setHasCompletedOnboardingOnce] = useState(false);

  const [step1DraftRecovered, setStep1DraftRecovered] = useState(false);
  const [step2DraftRecovered, setStep2DraftRecovered] = useState(false);
  const [step3DraftRecovered, setStep3DraftRecovered] = useState(false);
  const [step4DraftRecovered, setStep4DraftRecovered] = useState(false);
  const [step5DraftRecovered, setStep5DraftRecovered] = useState(false);

  const hasHydratedRef = useRef(false);
  const didRestorePageScrollRef = useRef(false);
  const ignoreNextStepScrollRef = useRef(true);

  const [step1Form, setStep1Form] = useState<Step1FormData>({
    store_display_name: "",
    store_description: "",
    city: "",
    state: "",
    service_regions: "",
    commercial_whatsapp: "",
    store_services: [],
    store_services_other: "",
    service_region_modes: [],
    service_region_notes: "",
    service_region_primary_mode: "",
    service_region_outside_consultation: false,
  });

  const [step2Form, setStep2Form] = useState<Step2FormData>({
    pool_types: "",
    sells_chemicals: "",
    sells_accessories: "",
    offers_installation: "",
    offers_technical_visit: "",
    brands_worked: "",
    pool_types_selected: [],
    pool_types_other: "",
    main_store_brand: "",
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
    installation_process_steps: [],
    installation_process_other: "",
    technical_visit_rules_selected: [],
    technical_visit_rules_other: "",
    important_limitations_selected: [],
    important_limitations_other: "",
    sales_flow_start_steps: [],
    sales_flow_middle_steps: [],
    sales_flow_final_steps: [],
    sales_flow_notes: "",
    sales_flow_start_confirmed: false,
    sales_flow_middle_confirmed: false,
    sales_flow_final_confirmed: false,
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
    price_direct_conditions: [],
    price_direct_rule_other: "",
    human_help_discount_cases_selected: [],
    human_help_discount_cases_other: "",
    human_help_custom_project_cases_selected: [],
    human_help_custom_project_cases_other: "",
    human_help_payment_cases_selected: [],
    human_help_payment_cases_other: "",
    price_needs_human_help: "",
    price_talk_mode: "",
    price_must_understand_before: [],
  });

  const [step5Form, setStep5Form] = useState<Step5FormData>({
    responsible_name: "",
    responsible_whatsapp: "",
    ai_should_notify_responsible: "",
    final_activation_notes: "",
    confirm_information_is_correct: false,
    responsible_notification_cases: [],
    responsible_notification_cases_other: "",
    activation_preferences: [],
    activation_preferences_other: "",
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

  const pageScrollStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_scroll:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);

  const storeHasInstallation = useMemo(
    () => step1Form.store_services.includes("instalacao_piscinas"),
    [step1Form.store_services]
  );

  const storeHasTechnicalVisit = useMemo(
    () => step1Form.store_services.includes("visita_tecnica"),
    [step1Form.store_services]
  );

  const storeSellsChemicals = useMemo(
    () => step1Form.store_services.includes("venda_produtos_quimicos"),
    [step1Form.store_services]
  );

  const storeSellsAccessories = useMemo(
    () => step1Form.store_services.includes("venda_acessorios"),
    [step1Form.store_services]
  );

  function clearMessages() {
    setSuccessMessage(null);
    setFormError(null);
  }

  function changeStep(nextStep: number) {
    clearMessages();
    ignoreNextStepScrollRef.current = false;
    setCurrentStep(nextStep);
  }

  function updateStep1Field<K extends keyof Step1FormData>(field: K, value: Step1FormData[K]) {
    clearMessages();
    setStep1Form((prev) => ({ ...prev, [field]: value }));
  }

  function updateStep2Field<K extends keyof Step2FormData>(field: K, value: Step2FormData[K]) {
    clearMessages();
    setStep2Form((prev) => ({ ...prev, [field]: value }));
  }

  function updateStep3Field<K extends keyof Step3FormData>(field: K, value: Step3FormData[K]) {
    clearMessages();
    setStep3Form((prev) => ({ ...prev, [field]: value }));
  }

  function updateStep4Field<K extends keyof Step4FormData>(field: K, value: Step4FormData[K]) {
    clearMessages();
    setStep4Form((prev) => ({ ...prev, [field]: value }));
  }

  function updateStep5Field<K extends keyof Step5FormData>(field: K, value: Step5FormData[K]) {
    clearMessages();
    setStep5Form((prev) => ({ ...prev, [field]: value }));
  }

  function toggleStep1ArrayField(field: "store_services" | "service_region_modes", value: string) {
    clearMessages();
    setStep1Form((prev) => ({ ...prev, [field]: toggleArrayValue(prev[field], value) }));
  }

  function toggleStep2ArrayField(field: "pool_types_selected", value: string) {
    clearMessages();
    setStep2Form((prev) => ({ ...prev, [field]: toggleArrayValue(prev[field], value) }));
  }

  function toggleStep3ArrayField(
    field:
      | "installation_available_days"
      | "technical_visit_available_days"
      | "technical_visit_rules_selected"
      | "important_limitations_selected"
      | "sales_flow_start_steps"
      | "sales_flow_middle_steps"
      | "sales_flow_final_steps",
    value: string
  ) {
    clearMessages();
    setStep3Form((prev) => ({ ...prev, [field]: toggleArrayValue(prev[field], value) }));
  }

  function toggleStep4ArrayField(
    field:
      | "accepted_payment_methods"
      | "human_help_discount_cases_selected"
      | "human_help_custom_project_cases_selected"
      | "human_help_payment_cases_selected"
      | "price_must_understand_before",
    value: string
  ) {
    clearMessages();
    setStep4Form((prev) => ({ ...prev, [field]: toggleArrayValue(prev[field], value) }));
  }

  function toggleStep5ArrayField(
    field: "responsible_notification_cases" | "activation_preferences",
    value: string
  ) {
    clearMessages();
    setStep5Form((prev) => ({ ...prev, [field]: toggleArrayValue(prev[field], value) }));
  }

  useEffect(() => {
    if (!organizationId || !activeStore?.id) return;

    try {
      setSuccessMessage(null);
      setFormError(null);
      setFatalError(null);
      setRemoteLoaded(false);
      setStep1DraftRecovered(false);
      setStep2DraftRecovered(false);
      setStep3DraftRecovered(false);
      setStep4DraftRecovered(false);
      setStep5DraftRecovered(false);
      didRestorePageScrollRef.current = false;
      ignoreNextStepScrollRef.current = true;

      let nextStep = 1;

      if (typeof window !== "undefined") {
        const loadDraft = <T,>(
          key: string | null,
          setter: Dispatch<SetStateAction<T>>,
          mark: () => void
        ) => {
          if (!key) return;
          const raw = window.localStorage.getItem(key);
          if (!raw) return;
          try {
            setter((prev) => ({ ...(prev as Record<string, unknown>), ...JSON.parse(raw) }) as T);
            mark();
          } catch {}
        };

        loadDraft(step1DraftStorageKey, setStep1Form, () => setStep1DraftRecovered(true));
        loadDraft(step2DraftStorageKey, setStep2Form, () => setStep2DraftRecovered(true));
        loadDraft(step3DraftStorageKey, setStep3Form, () => setStep3DraftRecovered(true));
        loadDraft(step4DraftStorageKey, setStep4Form, () => setStep4DraftRecovered(true));
        loadDraft(step5DraftStorageKey, setStep5Form, () => setStep5DraftRecovered(true));

        if (currentStepStorageKey) {
          const rawStep = window.localStorage.getItem(currentStepStorageKey);
          if (["1", "2", "3", "4", "5"].includes(String(rawStep))) nextStep = Number(rawStep);
        }

        if (onboardingCompletedStorageKey) {
          const rawCompleted = window.localStorage.getItem(onboardingCompletedStorageKey);
          setHasCompletedOnboardingOnce(rawCompleted === "true");
        } else {
          setHasCompletedOnboardingOnce(false);
        }
      }

      setCurrentStep(nextStep);
      hasHydratedRef.current = true;
      setHydratedFromCache(true);
    } catch (err) {
      console.error("[OnboardingPage] hydrate local cache error:", err);
      setHydratedFromCache(true);
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
    onboardingCompletedStorageKey,
  ]);

  useEffect(() => {
    const loadAnswers = async () => {
      if (!organizationId || !activeStore?.id) return;

      try {
        const { data, error: rpcError } = await supabase.rpc("onboarding_get_answers_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
        });

        if (rpcError) {
          console.error("[OnboardingPage] loadAnswers RPC error:", rpcError);
          setFatalError("Falha ao carregar respostas do onboarding.");
          return;
        }

        const answers = (data ?? {}) as AnswersMap;

        const remoteStoreServices = parseArrayAnswer(answers.store_services);
        const remotePoolTypesSelected = parseArrayAnswer(answers.pool_types_selected);
        const remoteTechnicalVisitRulesSelected = parseArrayAnswer(answers.technical_visit_rules_selected);
        const remoteImportantLimitationsSelected = parseArrayAnswer(answers.important_limitations_selected);
        const remoteHumanHelpDiscountSelected = parseArrayAnswer(answers.human_help_discount_cases_selected);
        const remoteHumanHelpCustomProjectSelected = parseArrayAnswer(
          answers.human_help_custom_project_cases_selected
        );
        const remoteHumanHelpPaymentSelected = parseArrayAnswer(answers.human_help_payment_cases_selected);
        const remoteResponsibleNotificationCases = parseArrayAnswer(answers.responsible_notification_cases);
        const remoteActivationPreferences = parseArrayAnswer(answers.activation_preferences);
        const remoteSalesFlowStartSteps = parseArrayAnswer(answers.sales_flow_start_steps);
        const remoteSalesFlowMiddleSteps = parseArrayAnswer(answers.sales_flow_middle_steps);
        const remoteSalesFlowFinalSteps = parseArrayAnswer(answers.sales_flow_final_steps);
        const legacyInstallationSteps = parseArrayAnswer(answers.installation_process_steps);

        const remoteServiceRegionModes = parseArrayAnswer(answers.service_region_modes);
        const fallbackPrimaryRegion =
          String(answers.service_region_primary_mode ?? "") ||
          remoteServiceRegionModes.find((value) => value !== "sob_consulta") ||
          "";

        const fallbackOutsideConsultation =
          typeof answers.service_region_outside_consultation === "boolean"
            ? answers.service_region_outside_consultation
            : remoteServiceRegionModes.includes("sob_consulta");

        setStep1Form((prev) => ({
          store_display_name: prev.store_display_name || String(answers.store_display_name ?? activeStore.name ?? ""),
          store_description: prev.store_description || String(answers.store_description ?? ""),
          city: prev.city || String(answers.city ?? ""),
          state: prev.state || String(answers.state ?? ""),
          service_regions:
            prev.service_regions ||
            (Array.isArray(answers.service_regions)
              ? answers.service_regions.join(", ")
              : String(answers.service_regions ?? "")),
          commercial_whatsapp: prev.commercial_whatsapp || String(answers.commercial_whatsapp ?? ""),
          store_services: prev.store_services.length ? prev.store_services : remoteStoreServices,
          store_services_other: prev.store_services_other || String(answers.store_services_other ?? ""),
          service_region_modes: prev.service_region_modes.length ? prev.service_region_modes : remoteServiceRegionModes,
          service_region_notes: prev.service_region_notes || String(answers.service_region_notes ?? ""),
          service_region_primary_mode: prev.service_region_primary_mode || fallbackPrimaryRegion,
          service_region_outside_consultation:
            prev.service_region_outside_consultation || fallbackOutsideConsultation,
        }));

        setStep2Form((prev) => ({
          pool_types:
            prev.pool_types ||
            (Array.isArray(answers.pool_types) ? answers.pool_types.join(", ") : String(answers.pool_types ?? "")),
          sells_chemicals:
            prev.sells_chemicals ||
            (typeof answers.sells_chemicals === "boolean"
              ? answers.sells_chemicals
                ? "sim"
                : "não"
              : String(answers.sells_chemicals ?? "")),
          sells_accessories:
            prev.sells_accessories ||
            (typeof answers.sells_accessories === "boolean"
              ? answers.sells_accessories
                ? "sim"
                : "não"
              : String(answers.sells_accessories ?? "")),
          offers_installation:
            prev.offers_installation ||
            (typeof answers.offers_installation === "boolean"
              ? answers.offers_installation
                ? "sim"
                : "não"
              : String(answers.offers_installation ?? "")),
          offers_technical_visit:
            prev.offers_technical_visit ||
            (typeof answers.offers_technical_visit === "boolean"
              ? answers.offers_technical_visit
                ? "sim"
                : "não"
              : String(answers.offers_technical_visit ?? "")),
          brands_worked:
            prev.brands_worked ||
            (Array.isArray(answers.brands_worked)
              ? answers.brands_worked.join(", ")
              : String(answers.brands_worked ?? "")),
          pool_types_selected: prev.pool_types_selected.length ? prev.pool_types_selected : remotePoolTypesSelected,
          pool_types_other: prev.pool_types_other || String(answers.pool_types_other ?? ""),
          main_store_brand:
            prev.main_store_brand ||
            String(answers.main_store_brand ?? "") ||
            (Array.isArray(answers.brands_worked)
              ? String(answers.brands_worked[0] ?? "")
              : String(answers.brands_worked ?? "")),
        }));

        setStep3Form((prev) => ({
          average_installation_time_days:
            prev.average_installation_time_days || String(answers.average_installation_time_days ?? ""),
          installation_days_rule: prev.installation_days_rule || String(answers.installation_days_rule ?? ""),
          installation_available_days:
            prev.installation_available_days.length
              ? prev.installation_available_days
              : Array.isArray(answers.installation_available_days)
              ? answers.installation_available_days.map(String)
              : [],
          technical_visit_days_rule:
            prev.technical_visit_days_rule || String(answers.technical_visit_days_rule ?? ""),
          technical_visit_available_days:
            prev.technical_visit_available_days.length
              ? prev.technical_visit_available_days
              : Array.isArray(answers.technical_visit_available_days)
              ? answers.technical_visit_available_days.map(String)
              : [],
          average_human_response_time:
            prev.average_human_response_time || String(answers.average_human_response_time ?? ""),
          installation_process: prev.installation_process || String(answers.installation_process ?? ""),
          technical_visit_rules: prev.technical_visit_rules || String(answers.technical_visit_rules ?? ""),
          important_limitations: prev.important_limitations || String(answers.important_limitations ?? ""),
          installation_process_steps:
            prev.installation_process_steps.length ? prev.installation_process_steps : legacyInstallationSteps,
          installation_process_other: prev.installation_process_other || String(answers.installation_process_other ?? ""),
          technical_visit_rules_selected:
            prev.technical_visit_rules_selected.length
              ? prev.technical_visit_rules_selected
              : remoteTechnicalVisitRulesSelected,
          technical_visit_rules_other:
            prev.technical_visit_rules_other || String(answers.technical_visit_rules_other ?? ""),
          important_limitations_selected:
            prev.important_limitations_selected.length
              ? prev.important_limitations_selected
              : remoteImportantLimitationsSelected,
          important_limitations_other:
            prev.important_limitations_other || String(answers.important_limitations_other ?? ""),
          sales_flow_start_steps:
            prev.sales_flow_start_steps.length ? prev.sales_flow_start_steps : remoteSalesFlowStartSteps,
          sales_flow_middle_steps:
            prev.sales_flow_middle_steps.length ? prev.sales_flow_middle_steps : remoteSalesFlowMiddleSteps,
          sales_flow_final_steps:
            prev.sales_flow_final_steps.length ? prev.sales_flow_final_steps : remoteSalesFlowFinalSteps,
          sales_flow_notes: prev.sales_flow_notes || String(answers.sales_flow_notes ?? ""),
          sales_flow_start_confirmed:
            prev.sales_flow_start_confirmed || Boolean(answers.sales_flow_start_confirmed),
          sales_flow_middle_confirmed:
            prev.sales_flow_middle_confirmed || Boolean(answers.sales_flow_middle_confirmed),
          sales_flow_final_confirmed:
            prev.sales_flow_final_confirmed || Boolean(answers.sales_flow_final_confirmed),
        }));

        const remotePriceMustUnderstandBefore = parseArrayAnswer(
          answers.price_must_understand_before ?? answers.price_direct_conditions
        );

        setStep4Form((prev) => ({
          average_ticket: prev.average_ticket || String(answers.average_ticket ?? ""),
          can_offer_discount:
            prev.can_offer_discount ||
            (typeof answers.can_offer_discount === "boolean"
              ? answers.can_offer_discount
                ? "sim"
                : "não"
              : String(answers.can_offer_discount ?? "")),
          max_discount_percent: prev.max_discount_percent || String(answers.max_discount_percent ?? ""),
          accepted_payment_methods:
            prev.accepted_payment_methods.length
              ? prev.accepted_payment_methods
              : Array.isArray(answers.accepted_payment_methods)
              ? answers.accepted_payment_methods.map(String)
              : [],
          ai_can_send_price_directly:
            prev.ai_can_send_price_directly ||
            (typeof answers.ai_can_send_price_directly === "boolean"
              ? answers.ai_can_send_price_directly
                ? "sim"
                : "não"
              : String(answers.ai_can_send_price_directly ?? "")),
          price_direct_rule: prev.price_direct_rule || String(answers.price_direct_rule ?? ""),
          human_help_discount_cases:
            prev.human_help_discount_cases || String(answers.human_help_discount_cases ?? ""),
          human_help_custom_project_cases:
            prev.human_help_custom_project_cases || String(answers.human_help_custom_project_cases ?? ""),
          human_help_payment_cases:
            prev.human_help_payment_cases || String(answers.human_help_payment_cases ?? ""),
          price_direct_conditions: prev.price_direct_conditions.length ? prev.price_direct_conditions : [],
          price_direct_rule_other: prev.price_direct_rule_other || String(answers.price_direct_rule_other ?? ""),
          human_help_discount_cases_selected:
            prev.human_help_discount_cases_selected.length
              ? prev.human_help_discount_cases_selected
              : remoteHumanHelpDiscountSelected,
          human_help_discount_cases_other:
            prev.human_help_discount_cases_other || String(answers.human_help_discount_cases_other ?? ""),
          human_help_custom_project_cases_selected:
            prev.human_help_custom_project_cases_selected.length
              ? prev.human_help_custom_project_cases_selected
              : remoteHumanHelpCustomProjectSelected,
          human_help_custom_project_cases_other:
            prev.human_help_custom_project_cases_other ||
            String(answers.human_help_custom_project_cases_other ?? ""),
          human_help_payment_cases_selected:
            prev.human_help_payment_cases_selected.length
              ? prev.human_help_payment_cases_selected
              : remoteHumanHelpPaymentSelected,
          human_help_payment_cases_other:
            prev.human_help_payment_cases_other || String(answers.human_help_payment_cases_other ?? ""),
          price_needs_human_help:
            prev.price_needs_human_help ||
            String(answers.price_needs_human_help ?? "") ||
            (parseArrayAnswer(answers.price_direct_conditions).includes("nunca_sem_chamar_humano") ? "sim" : "não"),
          price_talk_mode:
            prev.price_talk_mode ||
            String(answers.price_talk_mode ?? "") ||
            (parseArrayAnswer(answers.price_direct_conditions).includes("apenas_faixa_inicial")
              ? "apenas_faixa_inicial"
              : parseArrayAnswer(answers.price_direct_conditions).includes("quando_cliente_perguntar")
              ? "quando_cliente_perguntar"
              : ""),
          price_must_understand_before:
            prev.price_must_understand_before.length
              ? prev.price_must_understand_before
              : remotePriceMustUnderstandBefore.filter((item) =>
                  PRICE_DIRECT_BEFORE_OPTIONS.some((option) => option.value === item)
                ),
        }));

        setStep5Form((prev) => ({
          responsible_name: prev.responsible_name || String(answers.responsible_name ?? ""),
          responsible_whatsapp: prev.responsible_whatsapp || String(answers.responsible_whatsapp ?? ""),
          ai_should_notify_responsible:
            prev.ai_should_notify_responsible ||
            (typeof answers.ai_should_notify_responsible === "boolean"
              ? answers.ai_should_notify_responsible
                ? "sim"
                : "não"
              : String(answers.ai_should_notify_responsible ?? "")),
          final_activation_notes: prev.final_activation_notes || String(answers.final_activation_notes ?? ""),
          confirm_information_is_correct:
            prev.confirm_information_is_correct || Boolean(answers.confirm_information_is_correct),
          responsible_notification_cases:
            prev.responsible_notification_cases.length
              ? prev.responsible_notification_cases
              : remoteResponsibleNotificationCases,
          responsible_notification_cases_other:
            prev.responsible_notification_cases_other ||
            String(answers.responsible_notification_cases_other ?? ""),
          activation_preferences:
            prev.activation_preferences.length ? prev.activation_preferences : remoteActivationPreferences,
          activation_preferences_other:
            prev.activation_preferences_other || String(answers.activation_preferences_other ?? ""),
        }));

        setRemoteLoaded(true);
      } catch (err) {
        console.error("[OnboardingPage] loadAnswers unexpected error:", err);
        setFatalError("Erro inesperado ao carregar onboarding.");
      }
    };

    loadAnswers();
  }, [organizationId, activeStore?.id, activeStore?.name]);

  useEffect(() => {
    const loadOnboardingStatus = async () => {
      if (!organizationId || !activeStore?.id) return;

      try {
        let cachedCompleted = false;

        if (onboardingCompletedStorageKey && typeof window !== "undefined") {
          cachedCompleted = window.localStorage.getItem(onboardingCompletedStorageKey) === "true";
          if (cachedCompleted) {
            setHasCompletedOnboardingOnce(true);
          }
        }

        const { data, error: statusLoadError } = await supabase
          .from("store_onboarding")
          .select("status")
          .eq("organization_id", organizationId)
          .eq("store_id", activeStore.id)
          .maybeSingle();

        if (statusLoadError) {
          console.error("[OnboardingPage] loadOnboardingStatus error:", statusLoadError);
          return;
        }

        const completed = data?.status === "completed";
        const nextValue = cachedCompleted || completed;

        setHasCompletedOnboardingOnce(nextValue);

        if (nextValue && onboardingCompletedStorageKey && typeof window !== "undefined") {
          window.localStorage.setItem(onboardingCompletedStorageKey, "true");
        }
      } catch (err) {
        console.error("[OnboardingPage] loadOnboardingStatus unexpected error:", err);
      }
    };

    loadOnboardingStatus();
  }, [organizationId, activeStore?.id, onboardingCompletedStorageKey]);

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

  useEffect(() => {
    if (!pageScrollStorageKey || typeof window === "undefined") return;

    const saveScroll = () => {
      window.sessionStorage.setItem(pageScrollStorageKey, String(window.scrollY));
    };

    window.addEventListener("scroll", saveScroll, { passive: true });
    window.addEventListener("pagehide", saveScroll);
    window.addEventListener("beforeunload", saveScroll);

    return () => {
      saveScroll();
      window.removeEventListener("scroll", saveScroll);
      window.removeEventListener("pagehide", saveScroll);
      window.removeEventListener("beforeunload", saveScroll);
    };
  }, [pageScrollStorageKey]);

  useEffect(() => {
    if (!hydratedFromCache || !remoteLoaded || !pageScrollStorageKey) return;
    if (typeof window === "undefined") return;
    if (didRestorePageScrollRef.current) return;

    didRestorePageScrollRef.current = true;
    const raw = window.sessionStorage.getItem(pageScrollStorageKey);
    if (!raw) return;

    const y = Number(raw);
    if (Number.isNaN(y)) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: y, behavior: "auto" });
      });
    });
  }, [hydratedFromCache, remoteLoaded, pageScrollStorageKey]);

  useEffect(() => {
    if (ignoreNextStepScrollRef.current) {
      ignoreNextStepScrollRef.current = false;
      return;
    }

    if (typeof window !== "undefined") {
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
    }
  }, [currentStep]);

  async function upsertAnswers(
    payloads: Array<[string, unknown]>,
    nextSuccessMessage: string,
    nextStep?: number,
    finalStatus?: "in_progress" | "completed"
  ) {
    if (!organizationId || !activeStore?.id) return;

    setSaving(true);
    setFormError(null);
    setSuccessMessage(null);

    try {
      for (const [questionKey, answer] of payloads) {
        const { error: rpcError } = await supabase.rpc("onboarding_upsert_answer_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_question_key: questionKey,
          p_answer: answer,
        });

        if (rpcError) throw new Error(`Falha ao salvar campo: ${questionKey}`);
      }

      const { error: statusError } = await supabase.rpc("onboarding_upsert_store_onboarding_scoped", {
        p_organization_id: organizationId,
        p_store_id: activeStore.id,
        p_status: finalStatus ?? "in_progress",
      });

      if (statusError) throw new Error("Falha ao atualizar status do onboarding.");

      setSuccessMessage(nextSuccessMessage);

      if (typeof nextStep === "number") {
        ignoreNextStepScrollRef.current = false;
        setCurrentStep(nextStep);
      }
    } catch (err) {
      console.error("[OnboardingPage] save error:", err);
      setFormError(err instanceof Error ? err.message : "Erro ao salvar etapa.");
    } finally {
      setSaving(false);
    }
  }

  async function saveStep1(e: FormEvent) {
    e.preventDefault();

    if (step1Form.store_services.length === 0 && !step1Form.store_services_other.trim()) {
      setFormError("Selecione pelo menos uma opção do que sua loja faz.");
      return;
    }

    if (!step1Form.service_region_primary_mode) {
      setFormError("Escolha o alcance principal da região atendida.");
      return;
    }

    const storeDescriptionText = joinSelectedLabels(
      step1Form.store_services,
      STORE_SERVICE_OPTIONS,
      step1Form.store_services_other
    );

    const regionModeValues = [
      step1Form.service_region_primary_mode,
      ...(step1Form.service_region_outside_consultation ? ["sob_consulta"] : []),
    ];

    const regionModeOptionsForText: Option[] = [
      ...SERVICE_REGION_PRIMARY_OPTIONS,
      { value: "sob_consulta", label: "Fora da região, só sob consulta" },
    ];

    const serviceRegionsArray = buildArrayFromSelectedLabels(
      regionModeValues,
      regionModeOptionsForText,
      step1Form.service_region_notes
    );

    await upsertAnswers(
      [
        ["store_display_name", step1Form.store_display_name.trim()],
        ["store_description", storeDescriptionText],
        ["city", step1Form.city.trim()],
        ["state", step1Form.state.trim()],
        ["service_regions", serviceRegionsArray],
        ["commercial_whatsapp", step1Form.commercial_whatsapp.trim()],
        ["store_services", step1Form.store_services],
        ["store_services_other", step1Form.store_services_other.trim()],
        ["service_region_modes", regionModeValues],
        ["service_region_notes", step1Form.service_region_notes.trim()],
        ["service_region_primary_mode", step1Form.service_region_primary_mode],
        ["service_region_outside_consultation", step1Form.service_region_outside_consultation],
      ],
      "Etapa 1 salva com sucesso.",
      2
    );

    setStep1DraftRecovered(false);
  }

  async function saveStep2(e: FormEvent) {
    e.preventDefault();

    if (step2Form.pool_types_selected.length === 0 && !step2Form.pool_types_other.trim()) {
      setFormError("Selecione pelo menos um tipo de piscina ou escreva no campo complementar.");
      return;
    }

    if (!step2Form.main_store_brand.trim()) {
      setFormError("Preencha a marca ou franquia principal da loja.");
      return;
    }

    const poolTypesArray = buildArrayFromSelectedLabels(
      step2Form.pool_types_selected,
      POOL_TYPE_OPTIONS,
      step2Form.pool_types_other
    );

    await upsertAnswers(
      [
        ["pool_types", poolTypesArray],
        ["sells_chemicals", storeSellsChemicals],
        ["sells_accessories", storeSellsAccessories],
        ["offers_installation", storeHasInstallation],
        ["offers_technical_visit", storeHasTechnicalVisit],
        ["brands_worked", [step2Form.main_store_brand.trim()]],
        ["pool_types_selected", step2Form.pool_types_selected],
        ["pool_types_other", step2Form.pool_types_other.trim()],
        ["main_store_brand", step2Form.main_store_brand.trim()],
      ],
      "Etapa 2 salva com sucesso.",
      3
    );

    setStep2DraftRecovered(false);
  }

  async function saveStep3(e: FormEvent) {
    e.preventDefault();

    if (storeHasInstallation && !step3Form.average_installation_time_days.trim()) {
      setFormError("Informe o tempo médio de instalação.");
      return;
    }

    if (
      storeHasInstallation &&
      step3Form.installation_available_days.length === 0 &&
      !step3Form.installation_days_rule.trim()
    ) {
      setFormError("Informe os dias de instalação com os boxes ou escreva uma regra complementar.");
      return;
    }

    if (
      storeHasTechnicalVisit &&
      step3Form.technical_visit_available_days.length === 0 &&
      !step3Form.technical_visit_days_rule.trim()
    ) {
      setFormError("Informe os dias de visita técnica com os boxes ou escreva uma regra complementar.");
      return;
    }

    if (!step3Form.average_human_response_time.trim()) {
      setFormError("Informe o tempo médio de resposta da loja.");
      return;
    }

    const hasSalesFlow =
      step3Form.sales_flow_start_steps.length > 0 ||
      step3Form.sales_flow_middle_steps.length > 0 ||
      step3Form.sales_flow_final_steps.length > 0 ||
      step3Form.sales_flow_notes.trim();

    if (!hasSalesFlow) {
      setFormError("Informe como normalmente funciona o processo da loja.");
      return;
    }

    if (
      storeHasTechnicalVisit &&
      step3Form.technical_visit_rules_selected.length === 0 &&
      !step3Form.technical_visit_rules_other.trim()
    ) {
      setFormError("Informe pelo menos uma regra importante sobre visita técnica.");
      return;
    }

    const technicalVisitRulesText = joinSelectedLabels(
      step3Form.technical_visit_rules_selected,
      TECHNICAL_VISIT_RULE_OPTIONS,
      step3Form.technical_visit_rules_other
    );

    const importantLimitationsText = joinSelectedLabels(
      step3Form.important_limitations_selected,
      IMPORTANT_LIMITATION_OPTIONS,
      step3Form.important_limitations_other
    );

    const salesFlowStartText = joinSelectedLabels(step3Form.sales_flow_start_steps, SALES_FLOW_START_OPTIONS);
    const salesFlowMiddleText = joinSelectedLabels(step3Form.sales_flow_middle_steps, SALES_FLOW_MIDDLE_OPTIONS);
    const salesFlowFinalText = joinSelectedLabels(step3Form.sales_flow_final_steps, SALES_FLOW_FINAL_OPTIONS);

    const installationProcessText = [
      salesFlowStartText ? `Início: ${salesFlowStartText}` : "",
      salesFlowMiddleText ? `Negociação: ${salesFlowMiddleText}` : "",
      salesFlowFinalText ? `Final: ${salesFlowFinalText}` : "",
      step3Form.sales_flow_notes.trim() ? `Complemento: ${step3Form.sales_flow_notes.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    const legacySteps = [
      ...step3Form.sales_flow_start_steps,
      ...step3Form.sales_flow_middle_steps,
      ...step3Form.sales_flow_final_steps,
    ];

    await upsertAnswers(
      [
        ["average_installation_time_days", step3Form.average_installation_time_days.trim()],
        ["installation_days_rule", step3Form.installation_days_rule.trim()],
        ["installation_available_days", step3Form.installation_available_days],
        ["technical_visit_days_rule", step3Form.technical_visit_days_rule.trim()],
        ["technical_visit_available_days", step3Form.technical_visit_available_days],
        ["average_human_response_time", step3Form.average_human_response_time.trim()],
        ["installation_process", installationProcessText],
        ["technical_visit_rules", technicalVisitRulesText],
        ["important_limitations", importantLimitationsText],
        ["installation_process_steps", legacySteps],
        ["installation_process_other", step3Form.sales_flow_notes.trim()],
        ["technical_visit_rules_selected", step3Form.technical_visit_rules_selected],
        ["technical_visit_rules_other", step3Form.technical_visit_rules_other.trim()],
        ["important_limitations_selected", step3Form.important_limitations_selected],
        ["important_limitations_other", step3Form.important_limitations_other.trim()],
        ["sales_flow_start_steps", step3Form.sales_flow_start_steps],
        ["sales_flow_middle_steps", step3Form.sales_flow_middle_steps],
        ["sales_flow_final_steps", step3Form.sales_flow_final_steps],
        ["sales_flow_notes", step3Form.sales_flow_notes.trim()],
        ["sales_flow_start_confirmed", step3Form.sales_flow_start_confirmed],
        ["sales_flow_middle_confirmed", step3Form.sales_flow_middle_confirmed],
        ["sales_flow_final_confirmed", step3Form.sales_flow_final_confirmed],
      ],
      "Etapa 3 salva com sucesso.",
      4
    );

    setStep3DraftRecovered(false);
  }

  async function saveStep4(e: FormEvent) {
    e.preventDefault();

    if (!step4Form.average_ticket.trim()) {
      setFormError("Informe o ticket médio da loja.");
      return;
    }

    if (!step4Form.can_offer_discount) {
      setFormError("Informe se a loja pode ou não dar desconto.");
      return;
    }

    if (step4Form.can_offer_discount === "sim" && !step4Form.max_discount_percent.trim()) {
      setFormError("Informe o desconto máximo permitido.");
      return;
    }

    if (step4Form.accepted_payment_methods.length === 0) {
      setFormError("Selecione pelo menos uma forma de pagamento ou condição comercial.");
      return;
    }

    if (!step4Form.ai_can_send_price_directly) {
      setFormError("Informe se a IA pode ou não falar preço sem chamar alguém da loja.");
      return;
    }

    if (step4Form.ai_can_send_price_directly === "sim") {
      if (step4Form.price_must_understand_before.length === 0 && !step4Form.price_direct_rule_other.trim()) {
        setFormError("Informe o que a IA precisa entender antes de falar preço.");
        return;
      }

      if (!step4Form.price_talk_mode) {
        setFormError("Escolha como a IA pode falar preço.");
        return;
      }

      if (!step4Form.price_needs_human_help) {
        setFormError("Informe se a IA precisa ou não de ajuda humana para falar preço.");
        return;
      }
    }

    if (
      step4Form.human_help_discount_cases_selected.length === 0 &&
      !step4Form.human_help_discount_cases_other.trim()
    ) {
      setFormError("Informe em quais casos a IA deve chamar alguém por causa de desconto.");
      return;
    }

    if (
      step4Form.human_help_custom_project_cases_selected.length === 0 &&
      !step4Form.human_help_custom_project_cases_other.trim()
    ) {
      setFormError("Informe em quais casos a IA deve chamar alguém por causa de projeto especial.");
      return;
    }

    if (
      step4Form.human_help_payment_cases_selected.length === 0 &&
      !step4Form.human_help_payment_cases_other.trim()
    ) {
      setFormError("Informe em quais casos a IA deve chamar alguém por causa de pagamento.");
      return;
    }

    const priceDirectConditionsLegacy = [
      ...step4Form.price_must_understand_before,
      ...(step4Form.price_talk_mode ? [step4Form.price_talk_mode] : []),
      ...(step4Form.price_needs_human_help === "sim" ? ["nunca_sem_chamar_humano"] : []),
    ];

    const priceDirectRuleText =
      step4Form.ai_can_send_price_directly === "não"
        ? "A IA não pode falar preço sem chamar uma pessoa da loja."
        : [
            joinSelectedLabels(step4Form.price_must_understand_before, PRICE_DIRECT_BEFORE_OPTIONS),
            step4Form.price_talk_mode
              ? PRICE_TALK_MODE_OPTIONS.find((option) => option.value === step4Form.price_talk_mode)?.label ?? ""
              : "",
            step4Form.price_needs_human_help === "sim"
              ? "Precisa de ajuda humana para falar preço."
              : "Não precisa de ajuda humana para falar preço na regra normal.",
            step4Form.price_direct_rule_other.trim(),
          ]
            .filter(Boolean)
            .join(" | ");

    const humanHelpDiscountText = joinSelectedLabels(
      step4Form.human_help_discount_cases_selected,
      HUMAN_HELP_DISCOUNT_OPTIONS,
      step4Form.human_help_discount_cases_other
    );

    const humanHelpCustomProjectText = joinSelectedLabels(
      step4Form.human_help_custom_project_cases_selected,
      HUMAN_HELP_CUSTOM_PROJECT_OPTIONS,
      step4Form.human_help_custom_project_cases_other
    );

    const humanHelpPaymentText = joinSelectedLabels(
      step4Form.human_help_payment_cases_selected,
      HUMAN_HELP_PAYMENT_OPTIONS,
      step4Form.human_help_payment_cases_other
    );

    await upsertAnswers(
      [
        ["average_ticket", step4Form.average_ticket.trim()],
        ["can_offer_discount", step4Form.can_offer_discount.trim().toLowerCase() === "sim"],
        ["max_discount_percent", step4Form.max_discount_percent.trim()],
        ["accepted_payment_methods", step4Form.accepted_payment_methods],
        [
          "ai_can_send_price_directly",
          step4Form.ai_can_send_price_directly.trim().toLowerCase() === "sim",
        ],
        ["price_direct_rule", priceDirectRuleText],
        ["human_help_discount_cases", humanHelpDiscountText],
        ["human_help_custom_project_cases", humanHelpCustomProjectText],
        ["human_help_payment_cases", humanHelpPaymentText],
        ["price_direct_conditions", priceDirectConditionsLegacy],
        ["price_direct_rule_other", step4Form.price_direct_rule_other.trim()],
        ["human_help_discount_cases_selected", step4Form.human_help_discount_cases_selected],
        ["human_help_discount_cases_other", step4Form.human_help_discount_cases_other.trim()],
        [
          "human_help_custom_project_cases_selected",
          step4Form.human_help_custom_project_cases_selected,
        ],
        ["human_help_custom_project_cases_other", step4Form.human_help_custom_project_cases_other.trim()],
        ["human_help_payment_cases_selected", step4Form.human_help_payment_cases_selected],
        ["human_help_payment_cases_other", step4Form.human_help_payment_cases_other.trim()],
        ["price_needs_human_help", step4Form.price_needs_human_help],
        ["price_talk_mode", step4Form.price_talk_mode],
        ["price_must_understand_before", step4Form.price_must_understand_before],
      ],
      "Etapa 4 salva com sucesso.",
      5
    );

    setStep4DraftRecovered(false);
  }

  async function saveStep5(e: FormEvent) {
    e.preventDefault();

    if (!step5Form.responsible_name.trim()) {
      setFormError("Preencha o nome da pessoa principal que a IA deve acionar.");
      return;
    }

    if (!step5Form.responsible_whatsapp.trim()) {
      setFormError("Preencha o WhatsApp dessa pessoa.");
      return;
    }

    if (!step5Form.ai_should_notify_responsible) {
      setFormError("Informe se a IA deve ou não avisar essa pessoa quando surgir algo importante.");
      return;
    }

    if (
      step5Form.ai_should_notify_responsible === "sim" &&
      step5Form.responsible_notification_cases.length === 0 &&
      !step5Form.responsible_notification_cases_other.trim()
    ) {
      setFormError("Informe em quais casos essa pessoa deve ser avisada.");
      return;
    }

    if (
      step5Form.activation_preferences.length === 0 &&
      !step5Form.activation_preferences_other.trim()
    ) {
      setFormError("Marque pelo menos uma orientação final para ativar a IA.");
      return;
    }

    if (!step5Form.confirm_information_is_correct) {
      setFormError("Confirme que as informações estão corretas para concluir o onboarding.");
      return;
    }

    const finalActivationNotesText = joinSelectedLabels(
      step5Form.activation_preferences,
      [...ACTIVATION_STYLE_OPTIONS, ...ACTIVATION_GUARDRAIL_OPTIONS],
      step5Form.activation_preferences_other
    );

    if (!organizationId || !activeStore?.id) return;

    setSaving(true);
    setFormError(null);
    setSuccessMessage(null);

    try {
      const payloads: Array<[string, unknown]> = [
        ["responsible_name", step5Form.responsible_name.trim()],
        ["responsible_whatsapp", step5Form.responsible_whatsapp.trim()],
        [
          "ai_should_notify_responsible",
          step5Form.ai_should_notify_responsible.trim().toLowerCase() === "sim",
        ],
        ["final_activation_notes", finalActivationNotesText],
        ["confirm_information_is_correct", step5Form.confirm_information_is_correct],
        ["responsible_notification_cases", step5Form.responsible_notification_cases],
        ["responsible_notification_cases_other", step5Form.responsible_notification_cases_other.trim()],
        ["activation_preferences", step5Form.activation_preferences],
        ["activation_preferences_other", step5Form.activation_preferences_other.trim()],
      ];

      for (const [questionKey, answer] of payloads) {
        const { error: rpcError } = await supabase.rpc("onboarding_upsert_answer_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_question_key: questionKey,
          p_answer: answer,
        });

        if (rpcError) {
          throw new Error(`Falha ao salvar campo: ${questionKey}`);
        }
      }

      const { error: statusError } = await supabase.rpc("onboarding_upsert_store_onboarding_scoped", {
        p_organization_id: organizationId,
        p_store_id: activeStore.id,
        p_status: "completed",
      });

      if (statusError) {
        throw new Error("Falha ao atualizar status do onboarding.");
      }

      setStep5DraftRecovered(false);
      setHasCompletedOnboardingOnce(true);

      if (onboardingCompletedStorageKey && typeof window !== "undefined") {
        window.localStorage.setItem(onboardingCompletedStorageKey, "true");
      }

      router.push("/configuracoes");
    } catch (err) {
      console.error("[OnboardingPage] saveStep5 error:", err);
      setFormError(err instanceof Error ? err.message : "Erro ao concluir onboarding.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !hydratedFromCache || !remoteLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-600">Carregando onboarding...</p>
      </div>
    );
  }

  if (error || fatalError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 px-6">
        <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="mb-3 text-2xl font-bold text-gray-900">Ops…</h1>
          <p className="text-gray-600">{error ?? fatalError}</p>
        </div>
      </div>
    );
  }

  if (!activeStore || !organizationId) return null;

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <StepBadge step={1} currentStep={currentStep} title="Loja" onClick={() => changeStep(1)} />
          <StepBadge step={2} currentStep={currentStep} title="Piscinas" onClick={() => changeStep(2)} />
          <StepBadge step={3} currentStep={currentStep} title="Operação" onClick={() => changeStep(3)} />
          <StepBadge step={4} currentStep={currentStep} title="Comercial" onClick={() => changeStep(4)} />
          <StepBadge step={5} currentStep={currentStep} title="Ativação" onClick={() => changeStep(5)} />
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="mb-1 text-sm font-medium text-gray-500">Onboarding inicial</p>

              <h1 className="mb-2 text-2xl font-bold text-gray-900">
                {currentStep === 1 && "Etapa 1 — Loja"}
                {currentStep === 2 && "Etapa 2 — Piscinas"}
                {currentStep === 3 && "Etapa 3 — Operação da loja"}
                {currentStep === 4 && "Etapa 4 — Comercial"}
                {currentStep === 5 && "Etapa 5 — Ativação"}
              </h1>

              <p className="text-sm leading-6 text-gray-600">
                {currentStep === 1 &&
                  "Vamos preencher os dados principais da loja de um jeito rápido, claro e sem complicação."}
                {currentStep === 2 &&
                  "Agora vamos definir os tipos de piscina e a marca principal da loja, sem repetir o que já foi marcado antes."}
                {currentStep === 3 &&
                  "Agora vamos organizar como a loja funciona no dia a dia para a IA responder do jeito certo."}
                {currentStep === 4 &&
                  "Agora vamos configurar as regras comerciais que a IA deve respeitar sempre."}
                {currentStep === 5 &&
                  "Agora vamos definir quem a IA pode acionar e quais orientações finais ela deve seguir."}
              </p>
            </div>

            <div className="shrink-0">
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                disabled={!hasCompletedOnboardingOnce}
                className={`rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                  hasCompletedOnboardingOnce
                    ? "border border-gray-300 bg-white text-gray-800 hover:border-gray-400"
                    : "cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400"
                }`}
              >
                Salvar onboarding
              </button>

              {!hasCompletedOnboardingOnce && (
                <p className="mt-2 max-w-[220px] text-xs text-gray-500">
                  Essa saída só fica liberada depois que o onboarding for concluído pela primeira vez.
                </p>
              )}
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="mb-1 text-xs text-gray-500">Loja ativa</p>
            <p className="text-base font-semibold text-gray-900">{activeStore.name}</p>
          </div>

          {currentStep === 1 && step1DraftRecovered && <DraftNotice step={1} />}
          {currentStep === 2 && step2DraftRecovered && <DraftNotice step={2} />}
          {currentStep === 3 && step3DraftRecovered && <DraftNotice step={3} />}
          {currentStep === 4 && step4DraftRecovered && <DraftNotice step={4} />}
          {currentStep === 5 && step5DraftRecovered && <DraftNotice step={5} />}

          {formError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {formError}
            </div>
          )}

          {successMessage && (
            <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {successMessage}
            </div>
          )}

          {currentStep === 1 && (
            <form onSubmit={saveStep1} className="space-y-6">
              <div>
                <SectionTitle
                  title="Como seus clientes conhecem sua loja?"
                  hint="Use o nome que normalmente aparece para o cliente."
                />
                <input
                  type="text"
                  value={step1Form.store_display_name}
                  onChange={(e) => updateStep1Field("store_display_name", e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: Brilho Cristal Piscinas"
                  required
                />
              </div>

              <div>
                <SectionTitle
                  title="O que essa loja faz?"
                  hint="Marque tudo o que essa unidade realmente oferece."
                />
                <SelectorGrid
                  options={STORE_SERVICE_OPTIONS}
                  selectedValues={step1Form.store_services}
                  onToggle={(value) => toggleStep1ArrayField("store_services", value)}
                />
                <input
                  type="text"
                  value={step1Form.store_services_other}
                  onChange={(e) => updateStep1Field("store_services_other", e.target.value)}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se tiver algo a mais, escreva aqui (opcional)"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <SectionTitle
                    title="Em que cidade fica esta loja?"
                    hint="Estamos falando da loja que está assinando o sistema."
                  />
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
                  <SectionTitle title="Estado da loja" />
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
                <SectionTitle
                  title="Qual é o alcance principal da região atendida?"
                  hint="Escolha a opção que melhor representa o alcance normal da loja."
                />
                <SingleSelectorGrid
                  options={SERVICE_REGION_PRIMARY_OPTIONS}
                  value={step1Form.service_region_primary_mode}
                  onChange={(value) => updateStep1Field("service_region_primary_mode", value)}
                />

                <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={step1Form.service_region_outside_consultation}
                      onChange={(e) =>
                        updateStep1Field("service_region_outside_consultation", e.target.checked)
                      }
                      className="mt-1 h-4 w-4"
                    />
                    <span className="text-sm text-gray-700">
                      Fora da região principal, essa loja pode atender só sob consulta.
                    </span>
                  </label>
                </div>

                <input
                  type="text"
                  value={step1Form.service_region_notes}
                  onChange={(e) => updateStep1Field("service_region_notes", e.target.value)}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se quiser, escreva bairros, cidades ou alguma regra extra (opcional)"
                />
              </div>

              <div>
                <SectionTitle title="WhatsApp comercial da loja" />
                <input
                  type="text"
                  value={step1Form.commercial_whatsapp}
                  onChange={(e) => updateStep1Field("commercial_whatsapp", formatPhone(e.target.value))}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: (11) 99999-9999"
                  required
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <p className="text-sm text-gray-500">Etapa 1 de 5</p>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-black px-5 py-2.5 font-medium text-white disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar e ir para etapa 2"}
                </button>
              </div>
            </form>
          )}

          {currentStep === 2 && (
            <form onSubmit={saveStep2} className="space-y-6">
              <div>
                <SectionTitle
                  title="Quais tipos de piscina essa loja trabalha?"
                  hint="Marque as principais linhas que essa loja vende."
                />
                <SelectorGrid
                  options={POOL_TYPE_OPTIONS}
                  selectedValues={step2Form.pool_types_selected}
                  onToggle={(value) => toggleStep2ArrayField("pool_types_selected", value)}
                />
                <input
                  type="text"
                  value={step2Form.pool_types_other}
                  onChange={(e) => updateStep2Field("pool_types_other", e.target.value)}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se trabalhar com algo além das opções acima, escreva aqui (opcional)"
                />
              </div>

              <div>
                <SectionTitle
                  title="Marca ou franquia principal da loja"
                  hint="Aqui é a marca principal da loja. Marcas de produtos e acessórios ficam para o catálogo detalhado depois."
                />
                <input
                  type="text"
                  value={step2Form.main_store_brand}
                  onChange={(e) => updateStep2Field("main_store_brand", e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: iGUi"
                  required
                />
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p className="mb-3 text-sm font-semibold text-gray-900">Resumo do que foi marcado na etapa 1</p>
                <div className="flex flex-wrap gap-2">
                  <SummaryChip label="Produtos químicos" active={storeSellsChemicals} />
                  <SummaryChip label="Acessórios" active={storeSellsAccessories} />
                  <SummaryChip label="Instalação" active={storeHasInstallation} />
                  <SummaryChip label="Visita técnica" active={storeHasTechnicalVisit} />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => changeStep(1)}
                  className="rounded-xl border border-gray-300 bg-white px-5 py-2.5 font-medium text-gray-800"
                >
                  Voltar para etapa 1
                </button>

                <div className="flex items-center gap-4">
                  <p className="text-sm text-gray-500">Etapa 2 de 5</p>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-xl bg-black px-5 py-2.5 font-medium text-white disabled:opacity-60"
                  >
                    {saving ? "Salvando..." : "Salvar e ir para etapa 3"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {currentStep === 3 && (
            <form onSubmit={saveStep3} className="space-y-6">
              {storeHasInstallation && (
                <>
                  <TimeDurationField
                    label="Em quanto tempo, em média, a loja termina uma instalação?"
                    hint="Preencha o número e escolha a unidade para não ficar ambíguo."
                    value={step3Form.average_installation_time_days}
                    onChange={(value) => updateStep3Field("average_installation_time_days", value)}
                    units={INSTALLATION_TIME_UNITS}
                    placeholder="Ex.: 7"
                    required={storeHasInstallation}
                  />

                  <div>
                    <SectionTitle
                      title="Em quais dias a loja pode fazer instalação?"
                      hint="Marque os dias normais. Se existir alguma regra especial, escreva no campo abaixo."
                    />
                    <WeekdaySelector
                      selectedDays={step3Form.installation_available_days}
                      onToggle={(day) => toggleStep3ArrayField("installation_available_days", day)}
                    />
                    <input
                      type="text"
                      value={step3Form.installation_days_rule}
                      onChange={(e) => updateStep3Field("installation_days_rule", e.target.value)}
                      className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                      placeholder="Ex.: não instala em feriados / agenda com 2 dias de antecedência (opcional)"
                    />
                  </div>
                </>
              )}

              {storeHasTechnicalVisit && (
                <div>
                  <SectionTitle
                    title="Em quais dias a loja pode fazer visita técnica?"
                    hint="Marque os dias normais. Se existir alguma regra especial, escreva no campo abaixo."
                  />
                  <WeekdaySelector
                    selectedDays={step3Form.technical_visit_available_days}
                    onToggle={(day) => toggleStep3ArrayField("technical_visit_available_days", day)}
                  />
                  <input
                    type="text"
                    value={step3Form.technical_visit_days_rule}
                    onChange={(e) => updateStep3Field("technical_visit_days_rule", e.target.value)}
                    className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                    placeholder="Ex.: visita só com horário marcado / não faz visita aos domingos (opcional)"
                  />
                </div>
              )}

              <TimeDurationField
                label="Em quanto tempo, em média, alguém da loja responde o cliente?"
                hint="Preencha o número e escolha a unidade."
                value={step3Form.average_human_response_time}
                onChange={(value) => updateStep3Field("average_human_response_time", value)}
                units={HUMAN_RESPONSE_TIME_UNITS}
                placeholder="Ex.: 15"
                required
              />

              <div>
                <SectionTitle
                  title="Como normalmente funciona o processo da loja?"
                  hint="Marque o que costuma acontecer em cada parte. Isso ajuda a IA a seguir o fluxo real da loja."
                />

                <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3">
                  <p className="text-xs leading-5 text-blue-900">
                    Marque o que costuma acontecer em cada coluna. Depois clique em “pronto” quando aquele bloco representar bem o processo da loja.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <ProcessColumn
                    title="Início"
                    subtitle="Primeiro contato e começo da conversa."
                    options={SALES_FLOW_START_OPTIONS}
                    selectedValues={step3Form.sales_flow_start_steps}
                    onToggle={(value) => toggleStep3ArrayField("sales_flow_start_steps", value)}
                    confirmed={step3Form.sales_flow_start_confirmed}
                    confirmLabel="Início pronto"
                    onConfirmToggle={() =>
                      updateStep3Field("sales_flow_start_confirmed", !step3Form.sales_flow_start_confirmed)
                    }
                  />

                  <ProcessColumn
                    title="Negociação"
                    subtitle="Parte em que a loja entende, orienta e avança na venda."
                    options={SALES_FLOW_MIDDLE_OPTIONS}
                    selectedValues={step3Form.sales_flow_middle_steps}
                    onToggle={(value) => toggleStep3ArrayField("sales_flow_middle_steps", value)}
                    confirmed={step3Form.sales_flow_middle_confirmed}
                    confirmLabel="Negociação pronta"
                    onConfirmToggle={() =>
                      updateStep3Field(
                        "sales_flow_middle_confirmed",
                        !step3Form.sales_flow_middle_confirmed
                      )
                    }
                  />

                  <ProcessColumn
                    title="Final"
                    subtitle="Parte em que a venda anda para fechamento e entrega."
                    options={SALES_FLOW_FINAL_OPTIONS}
                    selectedValues={step3Form.sales_flow_final_steps}
                    onToggle={(value) => toggleStep3ArrayField("sales_flow_final_steps", value)}
                    confirmed={step3Form.sales_flow_final_confirmed}
                    confirmLabel="Final pronto"
                    onConfirmToggle={() =>
                      updateStep3Field("sales_flow_final_confirmed", !step3Form.sales_flow_final_confirmed)
                    }
                  />
                </div>

                <input
                  type="text"
                  value={step3Form.sales_flow_notes}
                  onChange={(e) => updateStep3Field("sales_flow_notes", e.target.value)}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se quiser complementar algo fora do padrão da loja, escreva aqui (opcional)"
                />
              </div>

              {storeHasTechnicalVisit && (
                <div>
                  <SectionTitle
                    title="Regras importantes da visita técnica"
                    hint="Marque tudo o que a IA precisa respeitar quando falar de visita técnica."
                  />
                  <SelectorGrid
                    options={TECHNICAL_VISIT_RULE_OPTIONS}
                    selectedValues={step3Form.technical_visit_rules_selected}
                    onToggle={(value) => toggleStep3ArrayField("technical_visit_rules_selected", value)}
                  />
                  <input
                    type="text"
                    value={step3Form.technical_visit_rules_other}
                    onChange={(e) => updateStep3Field("technical_visit_rules_other", e.target.value)}
                    className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                    placeholder="Se existir mais alguma regra de visita técnica, escreva aqui (opcional)"
                  />
                </div>
              )}

              <div>
                <SectionTitle
                  title="Regras que a IA deve respeitar sempre"
                  hint="Essas são limitações ou cuidados que a IA nunca deve ignorar."
                />
                <SelectorGrid
                  options={IMPORTANT_LIMITATION_OPTIONS}
                  selectedValues={step3Form.important_limitations_selected}
                  onToggle={(value) => toggleStep3ArrayField("important_limitations_selected", value)}
                />
                <input
                  type="text"
                  value={step3Form.important_limitations_other}
                  onChange={(e) => updateStep3Field("important_limitations_other", e.target.value)}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se existir alguma regra extra importante, escreva aqui (opcional)"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => changeStep(2)}
                  className="rounded-xl border border-gray-300 bg-white px-5 py-2.5 font-medium text-gray-800"
                >
                  Voltar para etapa 2
                </button>

                <div className="flex items-center gap-4">
                  <p className="text-sm text-gray-500">Etapa 3 de 5</p>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-xl bg-black px-5 py-2.5 font-medium text-white disabled:opacity-60"
                  >
                    {saving ? "Salvando..." : "Salvar e ir para etapa 4"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {currentStep === 4 && (
            <form onSubmit={saveStep4} className="space-y-6">
              <div>
                <SectionTitle
                  title="Qual é o ticket médio da loja?"
                  hint="Esse é o valor médio das vendas mais comuns da loja."
                />
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-500">R$</span>
                  <input
                    type="text"
                    value={step4Form.average_ticket}
                    onChange={(e) => updateStep4Field("average_ticket", formatBrazilCurrencyInput(e.target.value))}
                    className="w-full rounded-xl border border-gray-300 py-2.5 pl-12 pr-4 outline-none focus:border-black"
                    placeholder="12.000"
                    required
                  />
                </div>
              </div>

              <div>
                <SectionTitle title="A loja pode dar desconto?" />
                <SingleSelectorGrid
                  options={YES_NO_OPTIONS}
                  value={step4Form.can_offer_discount}
                  onChange={(value) => updateStep4Field("can_offer_discount", value)}
                />
              </div>

              {step4Form.can_offer_discount === "sim" && (
                <div>
                  <SectionTitle
                    title="Qual é o desconto máximo sem precisar chamar alguém da loja?"
                    hint="Preencha apenas o número."
                  />
                  <div className="relative">
                    <input
                      type="text"
                      value={step4Form.max_discount_percent}
                      onChange={(e) => updateStep4Field("max_discount_percent", formatPercentInput(e.target.value))}
                      className="w-full rounded-xl border border-gray-300 py-2.5 pl-4 pr-10 outline-none focus:border-black"
                      placeholder="10"
                      required
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <SectionTitle
                  title="Como o cliente pode pagar?"
                  hint="Marque as formas de pagamento e também as condições comerciais que a loja aceita."
                />

                <div>
                  <p className="mb-2 text-sm font-medium text-gray-700">Formas de pagamento</p>
                  <SelectorGrid
                    options={PAYMENT_METHOD_MAIN_OPTIONS}
                    selectedValues={step4Form.accepted_payment_methods}
                    onToggle={(value) => toggleStep4ArrayField("accepted_payment_methods", value)}
                  />
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-gray-700">Condições comerciais</p>
                  <SelectorGrid
                    options={PAYMENT_METHOD_CONDITION_OPTIONS}
                    selectedValues={step4Form.accepted_payment_methods}
                    onToggle={(value) => toggleStep4ArrayField("accepted_payment_methods", value)}
                  />
                </div>
              </div>

              <div>
                <SectionTitle
                  title="A IA pode falar preço sem chamar alguém da loja?"
                  hint="A ideia aqui não é preço seco. Na maioria dos casos, a IA deve qualificar rápido antes de falar valor."
                />
                <SingleSelectorGrid
                  options={YES_NO_OPTIONS}
                  value={step4Form.ai_can_send_price_directly}
                  onChange={(value) => updateStep4Field("ai_can_send_price_directly", value)}
                />
              </div>

              {step4Form.ai_can_send_price_directly === "sim" && (
                <div className="space-y-6">
                  <div>
                    <SectionTitle
                      title="Antes de falar preço, o que a IA precisa entender?"
                      hint="Marque tudo o que normalmente precisa ser entendido antes."
                    />
                    <SelectorGrid
                      options={PRICE_DIRECT_BEFORE_OPTIONS}
                      selectedValues={step4Form.price_must_understand_before}
                      onToggle={(value) => toggleStep4ArrayField("price_must_understand_before", value)}
                    />
                  </div>

                  <div>
                    <SectionTitle
                      title="Como a IA pode falar preço?"
                      hint="Escolha a forma principal."
                    />
                    <SingleSelectorGrid
                      options={PRICE_TALK_MODE_OPTIONS}
                      value={step4Form.price_talk_mode}
                      onChange={(value) => updateStep4Field("price_talk_mode", value)}
                    />
                  </div>

                  <div>
                    <SectionTitle
                      title="A IA precisa de ajuda humana para isso?"
                      hint="Defina se a loja quer ajuda humana no momento de falar preço."
                    />
                    <SingleSelectorGrid
                      options={YES_NO_OPTIONS}
                      value={step4Form.price_needs_human_help}
                      onChange={(value) => updateStep4Field("price_needs_human_help", value)}
                    />
                  </div>

                  <input
                    type="text"
                    value={step4Form.price_direct_rule_other}
                    onChange={(e) => updateStep4Field("price_direct_rule_other", e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                    placeholder="Se quiser complementar a regra de preço, escreva aqui (opcional)"
                  />
                </div>
              )}

              {step4Form.ai_can_send_price_directly === "não" && (
                <InfoBlock
                  title="Preço com apoio humano"
                  description="Nesse caso, a IA não deve falar preço sozinha. Ela pode qualificar, entender o caso e chamar alguém da loja para seguir."
                  subtle
                />
              )}

              <div>
                <SectionTitle
                  title="Quando a IA deve chamar uma pessoa por causa de desconto?"
                  hint="Marque os casos em que vale sair da IA e envolver alguém da loja."
                />
                <SelectorGrid
                  options={HUMAN_HELP_DISCOUNT_OPTIONS}
                  selectedValues={step4Form.human_help_discount_cases_selected}
                  onToggle={(value) => toggleStep4ArrayField("human_help_discount_cases_selected", value)}
                />
                <input
                  type="text"
                  value={step4Form.human_help_discount_cases_other}
                  onChange={(e) => updateStep4Field("human_help_discount_cases_other", e.target.value)}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se quiser complementar, escreva aqui (opcional)"
                />
              </div>

              <div>
                <SectionTitle
                  title="Quando a IA deve chamar uma pessoa por causa de projeto especial?"
                  hint="Marque os casos fora do padrão ou mais sensíveis."
                />
                <SelectorGrid
                  options={HUMAN_HELP_CUSTOM_PROJECT_OPTIONS}
                  selectedValues={step4Form.human_help_custom_project_cases_selected}
                  onToggle={(value) => toggleStep4ArrayField("human_help_custom_project_cases_selected", value)}
                />
                <input
                  type="text"
                  value={step4Form.human_help_custom_project_cases_other}
                  onChange={(e) => updateStep4Field("human_help_custom_project_cases_other", e.target.value)}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se quiser complementar, escreva aqui (opcional)"
                />
              </div>

              <div>
                <SectionTitle
                  title="Quando a IA deve chamar uma pessoa por causa de pagamento?"
                  hint="Marque os casos em que o padrão normal da loja não é suficiente."
                />
                <SelectorGrid
                  options={HUMAN_HELP_PAYMENT_OPTIONS}
                  selectedValues={step4Form.human_help_payment_cases_selected}
                  onToggle={(value) => toggleStep4ArrayField("human_help_payment_cases_selected", value)}
                />
                <input
                  type="text"
                  value={step4Form.human_help_payment_cases_other}
                  onChange={(e) => updateStep4Field("human_help_payment_cases_other", e.target.value)}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se quiser complementar, escreva aqui (opcional)"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => changeStep(3)}
                  className="rounded-xl border border-gray-300 bg-white px-5 py-2.5 font-medium text-gray-800"
                >
                  Voltar para etapa 3
                </button>

                <div className="flex items-center gap-4">
                  <p className="text-sm text-gray-500">Etapa 4 de 5</p>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-xl bg-black px-5 py-2.5 font-medium text-white disabled:opacity-60"
                  >
                    {saving ? "Salvando..." : "Salvar e ir para etapa 5"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {currentStep === 5 && (
            <form onSubmit={saveStep5} className="space-y-6">
              <div>
                <SectionTitle
                  title="Quem é a principal pessoa da loja que a IA pode acionar?"
                  hint="Pode ser dono, gerente ou alguém responsável por aprovar decisões importantes."
                />
                <input
                  type="text"
                  value={step5Form.responsible_name}
                  onChange={(e) => updateStep5Field("responsible_name", e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: Carlos Silva"
                  required
                />
              </div>

              <div>
                <SectionTitle title="Qual é o WhatsApp dessa pessoa?" />
                <input
                  type="text"
                  value={step5Form.responsible_whatsapp}
                  onChange={(e) => updateStep5Field("responsible_whatsapp", formatPhone(e.target.value))}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: (11) 99999-9999"
                  required
                />
              </div>

              <div>
                <SectionTitle title="A IA deve avisar essa pessoa quando surgir algo importante?" />
                <SingleSelectorGrid
                  options={YES_NO_OPTIONS}
                  value={step5Form.ai_should_notify_responsible}
                  onChange={(value) => updateStep5Field("ai_should_notify_responsible", value)}
                />
              </div>

              {step5Form.ai_should_notify_responsible === "sim" && (
                <div>
                  <SectionTitle
                    title="Em quais casos essa pessoa deve ser avisada?"
                    hint="Marque os casos mais importantes."
                  />
                  <SelectorGrid
                    options={RESPONSIBLE_NOTIFICATION_CASE_OPTIONS}
                    selectedValues={step5Form.responsible_notification_cases}
                    onToggle={(value) => toggleStep5ArrayField("responsible_notification_cases", value)}
                  />
                  <input
                    type="text"
                    value={step5Form.responsible_notification_cases_other}
                    onChange={(e) => updateStep5Field("responsible_notification_cases_other", e.target.value)}
                    className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                    placeholder="Se quiser complementar, escreva aqui (opcional)"
                  />
                </div>
              )}

              <div className="space-y-4">
                <SectionTitle
                  title="Como a IA deve se comportar?"
                  hint="Essas opções ajudam a definir o estilo e as regras principais da IA."
                />

                <div>
                  <p className="mb-2 text-sm font-medium text-gray-700">Estilo da conversa</p>
                  <SelectorGrid
                    options={ACTIVATION_STYLE_OPTIONS}
                    selectedValues={step5Form.activation_preferences}
                    onToggle={(value) => toggleStep5ArrayField("activation_preferences", value)}
                  />
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-gray-700">Regras obrigatórias</p>
                  <SelectorGrid
                    options={ACTIVATION_GUARDRAIL_OPTIONS}
                    selectedValues={step5Form.activation_preferences}
                    onToggle={(value) => toggleStep5ArrayField("activation_preferences", value)}
                  />
                </div>

                <input
                  type="text"
                  value={step5Form.activation_preferences_other}
                  onChange={(e) => updateStep5Field("activation_preferences_other", e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se quiser adicionar uma orientação final, escreva aqui (opcional)"
                />
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={step5Form.confirm_information_is_correct}
                    onChange={(e) => updateStep5Field("confirm_information_is_correct", e.target.checked)}
                    className="mt-1 h-4 w-4"
                  />
                  <span className="text-sm text-gray-700">
                    Revisei e confirmo que as informações preenchidas até aqui estão corretas.
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => changeStep(4)}
                  className="rounded-xl border border-gray-300 bg-white px-5 py-2.5 font-medium text-gray-800"
                >
                  Voltar para etapa 4
                </button>

                <div className="flex items-center gap-4">
                  <p className="text-sm text-gray-500">Etapa 5 de 5</p>
                  <button
                    type="submit"
                    disabled={saving || !step5Form.confirm_information_is_correct}
                    className="rounded-xl bg-black px-5 py-2.5 font-medium text-white disabled:opacity-60"
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
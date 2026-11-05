import { createClient } from "@supabase/supabase-js";
import {
  buildIsoFromDateAndTime,
  getScheduleTimezone,
  safeScheduleTimezone,
} from "@/lib/server/assistant/datetime";
import {
  parseSalesAiScheduleTimeToMinutes,
  type StoreScheduleHolidayBlockForSalesAiWindow,
  type StoreScheduleSettingsForSalesAiWindow,
} from "@/lib/server/sales-ai-operating-window";
import type { StoreScheduleSettingsRow } from "./types";

export type AutomaticReportType = "morning_report" | "evening_report";

// WhatsApp text messages are kept below the provider limit with an explicit margin.
export const AUTOMATIC_REPORT_SAFE_TEXT_LIMIT = 3800;

export type AutomaticReportScheduleSettings = StoreScheduleSettingsForSalesAiWindow & StoreScheduleSettingsRow & {
  organization_id: string;
  store_id: string;
};

type ReportTime = { start?: string | null; end?: string | null };

export type ReportAppointment = {
  id: string;
  title: string | null;
  appointment_type: string | null;
  status: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  address_text: string | null;
  created_at: string | null;
  commercial_opportunity_id?: string | null;
  lead_name?: string | null;
  completion_evidence?: boolean;
};

export type ReportPendingItem = {
  id: string;
  title: string | null;
  body: string | null;
  related_appointment_id: string | null;
  created_at: string | null;
  kind: "notification" | "task";
  priority?: string | null;
  notification_type?: string | null;
  task_type?: string | null;
  commercial_opportunity_id?: string | null;
  related_lead_id?: string | null;
  lead_name?: string | null;
  category?: "visit" | "quote" | "contract" | "other";
  context?: Record<string, unknown> | null;
};

type MorningSnapshotAppointment = {
  id: string;
  scheduled_start: string | null;
  status: string | null;
};

type MorningSnapshot = {
  version: 1;
  local_date: string;
  appointments: MorningSnapshotAppointment[];
  pending_items: Array<{ id: string; related_appointment_id: string | null; kind: "notification" | "task" }>;
};

type PlanningComparison = {
  planned: Array<{ id: string; outcome: string }>;
  newAppointments: string[];
  newPendingItems: string[];
};

export type ReportData = {
  appointmentCount: number;
  openAppointmentCount: number;
  completedAppointmentCount: number;
  cancelledAppointmentCount: number;
  overdueAppointmentCount: number;
  pendingNotificationCount: number;
  pendingTaskCount: number;
  appointments?: ReportAppointment[];
  pendingItems?: ReportPendingItem[];
  planningSnapshotAvailable?: boolean;
  reportLocalDate?: string;
  reportTimezone?: string;
  planningComparison?: PlanningComparison;
};

type ReportSupabase = {
  from(table: string): ReportQuery;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

type ReportQuery = {
  select(columns: string): ReportQuery;
  eq(column: string, value: unknown): ReportQuery;
  gte(column: string, value: unknown): ReportQuery;
  lte(column: string, value: unknown): ReportQuery;
  gt(column: string, value: unknown): ReportQuery;
  lt(column: string, value: unknown): ReportQuery;
  in(column: string, values: unknown[]): ReportQuery;
  then<TResult1 = { data?: unknown; error?: { message?: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data?: unknown; error?: { message?: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
};

type DueReport = {
  type: AutomaticReportType;
  localDate: string;
  targetIso: string;
  reason: "due" | "not_due" | "not_authorized" | "missing_schedule" | "ambiguous_hours";
};

type AutomaticReportClaimResult =
  | { result: "claimed"; claim_id: string; claim_token: string; attempt_count?: number }
  | { result: "already_claimed" | "retry_later"; claim_id: string }
  | { result: "completed"; claim_id: string; message_id?: string | null; notification_id?: string | null };

const AUTOMATIC_REPORT_LEASE_SECONDS = 300;
const AUTOMATIC_REPORTS_ENABLED_ENV = "ASSISTANT_AUTOMATIC_REPORTS_ENABLED";
const AUTOMATIC_REPORTS_ALLOWED_STORE_IDS_ENV = "ASSISTANT_AUTOMATIC_REPORTS_ALLOWED_STORE_IDS";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DAY_KEYS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
export const AUTOMATIC_REPORT_DUE_WINDOW_MS = 15 * 60 * 1000;

export function isAutomaticAssistantReportsEnabled(
  value = process.env[AUTOMATIC_REPORTS_ENABLED_ENV],
) {
  return value === "true";
}

export function getAutomaticAssistantReportsAllowedStoreIds(
  value = process.env[AUTOMATIC_REPORTS_ALLOWED_STORE_IDS_ENV],
) {
  if (!value || !value.trim()) return [];
  const storeIds = value.split(",").map((item) => item.trim());
  if (!storeIds.length || storeIds.some((storeId) => !UUID_PATTERN.test(storeId))) return [];
  return Array.from(new Set(storeIds));
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalize(value: unknown) {
  return cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function getLocalParts(now: Date, timeZone: string) {
  const values: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: safeScheduleTimezone(timeZone),
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour || 0,
    minute: values.minute || 0,
  };
}

function localDateKey(parts: { year: number; month: number; day: number }) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localDayKey(parts: { year: number; month: number; day: number }) {
  return DAY_KEYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()] || "domingo";
}

function validTime(value: unknown) {
  return parseSalesAiScheduleTimeToMinutes(value) !== null ? cleanText(value).slice(0, 5) : null;
}

function readHours(settings: AutomaticReportScheduleSettings, dayKey: string): ReportTime | null {
  const hours = settings.operating_hours;
  if (!hours || typeof hours !== "object" || Array.isArray(hours)) return null;
  const row = (hours as Record<string, ReportTime>)[dayKey];
  if (!row) return null;
  const start = validTime(row.start);
  const end = validTime(row.end);
  return start && end ? { start, end } : null;
}

function resolveHabitualHours(settings: AutomaticReportScheduleSettings, dayKey: string) {
  const current = readHours(settings, dayKey);
  const operatingDays = Array.isArray(settings.operating_days)
    ? settings.operating_days.map(normalize).filter((item) => DAY_KEYS.includes(item))
    : [];
  if (operatingDays.includes(dayKey) && current) return { hours: current, ambiguous: false };

  const distinct = Array.from(new Set(operatingDays.map((day) => {
    const hours = readHours(settings, day);
    return hours ? `${hours.start}-${hours.end}` : null;
  }).filter(Boolean)));

  if (distinct.length !== 1) return { hours: null, ambiguous: true };
  const [start, end] = String(distinct[0]).split("-");
  return { hours: { start, end }, ambiguous: false };
}

function resolveLegacyEveningReportTime(end: string | null) {
  const endMinutes = parseSalesAiScheduleTimeToMinutes(end);
  if (endMinutes === null) return null;
  const reportMinutes = (endMinutes + 1430) % 1440;
  return `${String(Math.floor(reportMinutes / 60)).padStart(2, "0")}:${String(reportMinutes % 60).padStart(2, "0")}`;
}

function resolveReportTime(
  settings: AutomaticReportScheduleSettings,
  type: AutomaticReportType,
  habitualHours: ReportTime,
) {
  const configured = type === "morning_report"
    ? validTime(settings.assistant_morning_report_time)
    : validTime(settings.assistant_evening_report_time);
  if (configured) return configured;
  return type === "morning_report"
    ? habitualHours.start || null
    : resolveLegacyEveningReportTime(habitualHours.end || null);
}

function resolveNonOperatingReportPolicy(settings: AutomaticReportScheduleSettings) {
  const policy = normalize(settings.assistant_non_operating_report_policy);
  return [
    "send_on_non_operating_ai_days",
    "skip_non_operating_days",
    "skip_and_consolidate_non_operating_days",
  ].includes(policy)
    ? policy
    : "send_on_non_operating_ai_days";
}

function insideWindow(minute: number, start: number | null, end: number | null) {
  if (start === null || end === null || start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

function targetOverlapsHoliday(targetIso: string, holidayBlocks: StoreScheduleHolidayBlockForSalesAiWindow[]) {
  const target = Date.parse(targetIso);
  return holidayBlocks.some((block) => {
    const start = Date.parse(String(block.start_at || ""));
    const end = Date.parse(String(block.end_at || ""));
    return Number.isFinite(target) && Number.isFinite(start) && Number.isFinite(end) && target >= start && target < end;
  });
}

export function resolveAutomaticReportDue(args: {
  settings: AutomaticReportScheduleSettings | null;
  now?: Date;
  holidayBlocks?: StoreScheduleHolidayBlockForSalesAiWindow[];
}): DueReport[] {
  if (!args.settings) return [];
  const now = args.now || new Date();
  const timeZone = getScheduleTimezone(args.settings);
  const parts = getLocalParts(now, timeZone);
  const dateKey = localDateKey(parts);
  const dayKey = localDayKey(parts);
  const habitual = resolveHabitualHours(args.settings, dayKey);
  const result: DueReport[] = [];

  for (const type of ["morning_report", "evening_report"] as const) {
    const targetTime = resolveReportTime(args.settings, type, habitual.hours || {});
    if (!targetTime) {
      result.push({ type, localDate: dateKey, targetIso: "", reason: habitual.ambiguous ? "ambiguous_hours" : "missing_schedule" });
      continue;
    }

    const targetIso = buildIsoFromDateAndTime({ year: parts.year, month: parts.month - 1, day: parts.day }, targetTime, args.settings);
    const humanDay = Array.isArray(args.settings.operating_days) && args.settings.operating_days.map(normalize).includes(dayKey);
    const holiday = targetOverlapsHoliday(targetIso, args.holidayBlocks || []);
    const aiConfigured = Boolean(cleanText(args.settings.ai_after_hours_configured_at));
    const aiEnabled = aiConfigured && args.settings.ai_after_hours_enabled === true;
    const mode = normalize(args.settings.ai_after_hours_mode);
    const targetMinute = parseSalesAiScheduleTimeToMinutes(targetTime);
    const aiAllowed = aiEnabled && (!holiday || args.settings.ai_attends_holidays === true) && (
      mode === "all_closed_hours" ||
      (mode === "specific_window" && targetMinute !== null && insideWindow(
        targetMinute,
        parseSalesAiScheduleTimeToMinutes(args.settings.ai_after_hours_start),
        parseSalesAiScheduleTimeToMinutes(args.settings.ai_after_hours_end),
      ))
    );
    const nonOperatingDay = !humanDay || holiday;
    const policy = resolveNonOperatingReportPolicy(args.settings);
    const authorized = !nonOperatingDay
      ? true
      : policy === "send_on_non_operating_ai_days" && aiAllowed;
    result.push({
      type,
      localDate: dateKey,
      targetIso,
      reason: !authorized ? "not_authorized" : Math.abs(now.getTime() - Date.parse(targetIso)) <= AUTOMATIC_REPORT_DUE_WINDOW_MS ? "due" : "not_due",
    });
  }
  return result;
}

function cleanReportValue(value: unknown, fallback = "nao informado") {
  const text = cleanText(value);
  return text || fallback;
}

function formatAppointmentLine(appointment: ReportAppointment, timeZone = "America/Sao_Paulo", pendingItems: ReportPendingItem[] = []) {
  const time = appointment.scheduled_start
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: safeScheduleTimezone(timeZone), hour: "2-digit", minute: "2-digit" }).format(new Date(appointment.scheduled_start))
    : "horario nao informado";
  const parts = [
    time,
    cleanReportValue(appointment.customer_name, "cliente nao identificado"),
    cleanReportValue(appointment.appointment_type, "tipo nao informado"),
    `situacao: ${cleanReportValue(appointment.status)}`,
  ];
  if (appointment.customer_phone) parts.push(`contato: ${appointment.customer_phone}`);
  if (appointment.address_text) parts.push(`local: ${appointment.address_text}`);
  const relatedAction = pendingItems.find((item) => item.related_appointment_id === appointment.id);
  if (relatedAction) parts.push(`acao: ${cleanReportValue(relatedAction.title || relatedAction.body)}`);
  return `- ${parts.join(" | ")}`;
}

function formatPendingItems(items: ReportPendingItem[], reportLocalDate = "") {
  if (!items.length) return ["- nenhuma pendencia interna aberta identificada"];
  const technicalFailures = new Map<string, number>();
  const ordinaryItems: ReportPendingItem[] = [];
  for (const item of items) {
    if (normalize(item.context?.reason) === "sales_ai_failed_final") {
      const key = normalize(item.context?.failure_source) || "atendimento";
      technicalFailures.set(key, (technicalFailures.get(key) || 0) + 1);
    } else {
      ordinaryItems.push(item);
    }
  }
  const lines = ordinaryItems.map((item) => {
    const label = cleanReportValue(item.title || item.body, "pendencia sem descricao");
    const age = item.created_at && item.created_at.slice(0, 10) !== reportLocalDate ? " (pendencia anterior)" : "";
    const priority = ["urgent", "high"].includes(normalize(item.priority)) ? " [prioridade alta]" : "";
    return `- ${label}${priority}${age}`;
  });
  for (const [source, count] of technicalFailures) {
    lines.push(`- atendimento interrompido: ${count === 1 ? "1 falha definitiva" : `${count} falhas definitivas`} da IA Vendedora (${source}); requer verificacao no painel`);
  }
  return lines;
}

function isAutomaticReportQueueItem(item: { notification_type?: unknown; context?: unknown }) {
  const type = normalize(item.notification_type);
  if (type === "morning_report" || type === "evening_report") return true;
  const context = item.context && typeof item.context === "object" && !Array.isArray(item.context)
    ? item.context as Record<string, unknown>
    : null;
  return normalize(context?.report_source) === "assistant_automatic_reports";
}

function isTechnicalIncidentNotification(item: { notification_type?: unknown; context?: unknown }) {
  const context = item.context && typeof item.context === "object" && !Array.isArray(item.context)
    ? item.context as Record<string, unknown>
    : null;
  return normalize(item.notification_type) === "important_alert" &&
    normalize(context?.reason) === "sales_ai_failed_final";
}

function pendingIdentity(item: ReportPendingItem) {
  const context = item.context || {};
  const reason = normalize(context.reason);
  const contractId = cleanText(context.related_contract_id || context.document_id);
  if (contractId && reason) {
    return `contract:${contractId}:reason:${reason}:status:${normalize(context.document_status)}`;
  }
  const taskId = cleanText(context.task_id);
  const appointmentId = cleanText(item.related_appointment_id || context.related_appointment_id);
  if (taskId && reason && appointmentId) {
    return `task:${taskId}:appointment:${appointmentId}:reason:${reason}:classification:${normalize(context.classification)}`;
  }
  const eventKey = cleanText(context.event_key || context.dedupe_key);
  if (eventKey) return `event:${eventKey}`;
  return `${item.kind}:row:${item.id}`;
}

function pendingPriority(item: ReportPendingItem) {
  const priority = normalize(item.priority);
  if (priority === "urgent") return 0;
  if (priority === "high") return 1;
  if (priority === "normal") return 2;
  if (priority === "low") return 3;
  return 4;
}

function deduplicatePendingItems(items: ReportPendingItem[]) {
  const seen = new Set<string>();
  return [...items].sort((left, right) => {
    const priorityDifference = pendingPriority(left) - pendingPriority(right);
    if (priorityDifference !== 0) return priorityDifference;
    const leftCreatedAt = Date.parse(cleanText(left.created_at));
    const rightCreatedAt = Date.parse(cleanText(right.created_at));
    if (Number.isFinite(leftCreatedAt) && Number.isFinite(rightCreatedAt) && leftCreatedAt !== rightCreatedAt) {
      return rightCreatedAt - leftCreatedAt;
    }
    return cleanText(left.id).localeCompare(cleanText(right.id));
  }).filter((item) => {
    const identity = pendingIdentity(item);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function legacyBuildAutomaticMorningReport(data: ReportData) {
  const lines = [
    "PLANEJAMENTO OPERACIONAL DA MANHA",
    `Compromissos de hoje: ${data.appointmentCount}`,
  ];
  const appointments = data.appointments || [];
  const pendingItems = data.pendingItems || [];
  if (appointments.length) {
    lines.push("Agenda:", ...appointments.map((appointment) => formatAppointmentLine(appointment, data.reportTimezone, pendingItems)));
  } else {
    lines.push("- nenhum compromisso agendado para hoje; não há compromissos registrados");
  }
  lines.push(
    `Compromissos em aberto: ${data.openAppointmentCount}`,
    `Compromissos em atraso: ${data.overdueAppointmentCount}`,
    "Pendencias que exigem atencao:",
    ...formatPendingItems(pendingItems, data.reportLocalDate),
  );
  return lines.join("\n");
}

function eveningStatus(status: string | null) {
  const normalized = normalize(status);
  if (["completed", "fully_completed", "done"].includes(normalized)) return "concluido no cadastro; resultado operacional nao inferido";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelado no cadastro";
  if (["rescheduled", "remarcado"].includes(normalized)) return "remarcado no cadastro";
  return `situacao atual: ${cleanReportValue(status)}`;
}

function buildMorningSnapshot(data: ReportData): MorningSnapshot {
  return {
    version: 1,
    local_date: data.reportLocalDate || "",
    appointments: (data.appointments || []).map((appointment) => ({
      id: appointment.id,
      scheduled_start: appointment.scheduled_start,
      status: appointment.status,
    })),
    pending_items: (data.pendingItems || []).map((item) => ({
      id: item.id,
      related_appointment_id: item.related_appointment_id,
      kind: item.kind,
    })),
  };
}

function validMorningSnapshot(value: unknown): value is MorningSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || typeof row.local_date !== "string" || !Array.isArray(row.appointments) || !Array.isArray(row.pending_items)) return false;
  return row.appointments.every((appointment) => Boolean(appointment) && typeof appointment === "object" && typeof (appointment as Record<string, unknown>).id === "string") &&
    row.pending_items.every((item) => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string");
}

export function compareMorningSnapshot(snapshot: {
  version: 1;
  local_date: string;
  appointments: MorningSnapshotAppointment[];
  pending_items: Array<{ id: string; related_appointment_id: string | null; kind: "notification" | "task" }>;
}, current: ReportData): PlanningComparison {
  const currentById = new Map((current.appointments || []).map((appointment) => [appointment.id, appointment]));
  const planned = snapshot.appointments.map((plannedAppointment) => {
    const appointment = currentById.get(plannedAppointment.id);
    if (!appointment) return { id: plannedAppointment.id, outcome: "nao localizado; resultado nao inferido" };
    const currentStart = appointment.scheduled_start;
    if (currentStart && plannedAppointment.scheduled_start && currentStart !== plannedAppointment.scheduled_start) {
      return { id: plannedAppointment.id, outcome: `remarcado; novo horario ${currentStart}` };
    }
    return { id: plannedAppointment.id, outcome: eveningStatus(appointment.status) };
  });
  const plannedIds = new Set(snapshot.appointments.map((appointment) => appointment.id));
  const plannedPendingIds = new Set(snapshot.pending_items.map((item) => item.id));
  return {
    planned,
    newAppointments: (current.appointments || []).filter((appointment) => !plannedIds.has(appointment.id)).map((appointment) => appointment.id),
    newPendingItems: (current.pendingItems || []).filter((item) => !plannedPendingIds.has(item.id)).map((item) => item.id),
  };
}

function legacyBuildAutomaticEveningReport(data: ReportData) {
  const lines = [
    "RETROSPECTIVA OPERACIONAL DO FIM DO DIA",
    `Compromissos encontrados hoje: ${data.appointmentCount}`,
    `concluídos: ${data.completedAppointmentCount} (no cadastro; resultado operacional não inferido)`,
    `Cancelados no cadastro: ${data.cancelledAppointmentCount}`,
    `Ainda em aberto: ${data.openAppointmentCount}`,
  ];
  const appointments = data.appointments || [];
  const pendingItems = data.pendingItems || [];
  if (appointments.length) {
    lines.push("Situacao por compromisso:", ...appointments.map((appointment) => `${formatAppointmentLine(appointment, data.reportTimezone, pendingItems)} | ${eveningStatus(appointment.status)}`));
  } else {
    lines.push("- nenhum compromisso registrado hoje");
  }
  if (!data.planningSnapshotAvailable) {
    lines.push("Planejamento matinal: snapshot historico nao persistido; comparacao historica nao comprovada.");
  } else if (data.planningComparison) {
    lines.push("Comparacao por ID canonico com o planejamento matinal:");
    for (const item of data.planningComparison.planned) lines.push(`- ${item.id}: ${item.outcome}`);
    if (data.planningComparison.newAppointments.length) lines.push(`- novos compromissos apos a manha: ${data.planningComparison.newAppointments.join(", ")}`);
    if (data.planningComparison.newPendingItems.length) lines.push(`- novas pendencias apos a manha: ${data.planningComparison.newPendingItems.join(", ")}`);
  }
  lines.push("Pendencias abertas e proximas acoes:", ...formatPendingItems(pendingItems, data.reportLocalDate));
  return lines.join("\n");
}

void legacyBuildAutomaticMorningReport;
void legacyBuildAutomaticEveningReport;

function reportLeadNameForDisplay(value: unknown) {
  return cleanReportValue(value, "Cliente sem nome cadastrado");
}

function reportAppointmentTypeForDisplay(value: unknown) {
  const valueNormalized = normalize(value);
  if (valueNormalized.includes("technical") || valueNormalized.includes("tecnica")) return "visita tecnica";
  if (valueNormalized.includes("commercial") || valueNormalized.includes("comercial")) return "visita comercial";
  if (valueNormalized.includes("visit")) return "visita";
  if (valueNormalized.includes("installation") || valueNormalized.includes("instalacao")) return "instalacao";
  if (valueNormalized.includes("delivery") || valueNormalized.includes("entrega")) return "entrega";
  return cleanReportValue(value, "compromisso");
}

function reportPendingCategory(item: ReportPendingItem) {
  if (item.category) return item.category;
  const value = normalize([
    item.task_type,
    item.notification_type,
    item.title,
    item.body,
    item.context?.reason,
    item.context?.document_type,
    item.context?.related_contract_id,
    item.context?.related_quote_id,
  ].filter(Boolean).join(" "));
  if (item.related_appointment_id || value.includes("visita") || value.includes("appointment")) return "visit" as const;
  if (value.includes("contrat") || value.includes("document")) return "contract" as const;
  if (value.includes("orcament") || value.includes("quote")) return "quote" as const;
  return "other" as const;
}

function reportPendingSituation(item: ReportPendingItem) {
  const reason = normalize(item.context?.reason);
  if (reason === "sales_ai_failed_final" || reason.includes("failed") || reason.includes("error")) return "atendimento precisa de verificacao";
  if (reportPendingCategory(item) === "visit") return "visita aguardando acompanhamento";
  if (reportPendingCategory(item) === "quote") return "orcamento aguardando acompanhamento";
  if (reportPendingCategory(item) === "contract") return "contrato aguardando conferencia";
  return "atividade precisa de acompanhamento";
}

function reportPendingActivityDetail(item: ReportPendingItem) {
  const context = item.context || {};
  const candidate = [context.activity_label, context.document_number, context.contract_number, context.quote_number]
    .map((value) => cleanText(value))
    .find((value) => value && value.length <= 80);
  if (!candidate || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(candidate) || /(ai_run_queue|inbox|snapshot|uuid|cerebro comercial)/i.test(candidate)) return null;
  return candidate;
}

function reportPendingActivityText(item: ReportPendingItem) {
  const situation = reportPendingSituation(item);
  const detail = reportPendingActivityDetail(item);
  return detail ? `${situation} (${detail})` : situation;
}

function reportPendingLine(item: ReportPendingItem) {
  return `- ${reportLeadNameForDisplay(item.lead_name)}: ${reportPendingActivityText(item)}.`;
}

function reportAttentionItems(items: ReportPendingItem[]) {
  return items.filter((item) => {
    const priority = normalize(item.priority);
    const reason = normalize(item.context?.reason);
    return ["urgent", "high"].includes(priority) || reason === "sales_ai_failed_final" || reason.includes("failed") || reason.includes("error") || reason === "pending_review" || reason === "needs_clarification";
  });
}

function reportPendingGroups(items: ReportPendingItem[]) {
  const groups = new Map<ReturnType<typeof reportPendingCategory>, ReportPendingItem[]>();
  for (const item of items) {
    const category = reportPendingCategory(item);
    const group = groups.get(category) || [];
    group.push(item);
    groups.set(category, group);
  }
  return groups;
}

function reportPendingPresentation(items: ReportPendingItem[]) {
  const all = deduplicatePendingItems(items.filter((item) => !isTechnicalIncidentNotification(item)));
  const attention = reportAttentionItems(all);
  const attentionKeys = new Set(attention.map(pendingIdentity));
  return { all, attention, pending: all.filter((item) => !attentionKeys.has(pendingIdentity(item))) };
}

function reportPendingCategoryCounts(items: ReportPendingItem[]) {
  const groups = reportPendingGroups(items);
  return {
    visit: (groups.get("visit") || []).length,
    quote: (groups.get("quote") || []).length,
    contract: (groups.get("contract") || []).length,
    other: (groups.get("other") || []).length,
  };
}

function reportCountLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function reportSummarySuggestions(data: ReportData) {
  const presentation = reportPendingPresentation(data.pendingItems || []);
  const counts = reportPendingCategoryCounts(presentation.all);
  const suggestions: string[] = [];
  if (presentation.attention.length) {
    suggestions.push(`- Considere priorizar ${reportCountLabel(presentation.attention.length, "atividade", "atividades")} com prioridade alta ou urgente.`);
  }
  if (counts.visit) suggestions.push(`- Pode ser útil revisar ${reportCountLabel(counts.visit, "visita", "visitas")} pendente.`);
  if (counts.quote) suggestions.push(`- Pode ser útil acompanhar ${reportCountLabel(counts.quote, "orçamento", "orçamentos")} pendente.`);
  if (counts.contract) suggestions.push(`- Pode ser útil conferir ${reportCountLabel(counts.contract, "contrato", "contratos")} pendente.`);
  if (counts.other) suggestions.push(`- Pode ser útil acompanhar ${reportCountLabel(counts.other, "outra pendência", "outras pendências")}.`);
  if (!suggestions.length) suggestions.push("- Nenhuma recomendação prioritária foi identificada.");
  return suggestions;
}

function reportCurrentOperationalDataInvitation() {
  return [
    "",
    "\u{1f4ac} Quer saber mais?",
    "- Pergunte sobre os dados operacionais atuais de compromissos, pendências ou outra área específica.",
  ];
}

function buildAdaptiveAutomaticReport(full: string, summary: string) {
  if (full.length <= AUTOMATIC_REPORT_SAFE_TEXT_LIMIT) return full;
  if (summary.length <= AUTOMATIC_REPORT_SAFE_TEXT_LIMIT) return summary;
  throw new Error("AUTOMATIC_REPORT_SUMMARY_EXCEEDS_SAFE_LIMIT");
}

function hasPhysicalSignatureReminder(items: ReportPendingItem[], appointmentId?: string) {
  return items.some((item) =>
    normalize(item.context?.reason) === "physical_contract_signature_pending" &&
    (!appointmentId || item.related_appointment_id === appointmentId),
  );
}

function reportAppointmentLineForDisplay(appointment: ReportAppointment, timeZone = "America/Sao_Paulo", pendingItems: ReportPendingItem[] = []) {
  const time = appointment.scheduled_start
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: safeScheduleTimezone(timeZone), hour: "2-digit", minute: "2-digit" }).format(new Date(appointment.scheduled_start))
    : "horario nao informado";
  const physicalReminder = hasPhysicalSignatureReminder(pendingItems, appointment.id)
    ? " Levar o contrato fisico para assinatura."
    : "";
  return `- ${time} — ${reportLeadNameForDisplay(appointment.lead_name || appointment.customer_name)}: ${reportAppointmentTypeForDisplay(appointment.appointment_type)}.${physicalReminder}`;
}

function reportSuggestions(data: ReportData) {
  const presentation = reportPendingPresentation(data.pendingItems || []);
  const groups = reportPendingGroups(presentation.pending);
  const attention = presentation.attention;
  const suggestions: string[] = [];
  for (const item of attention) {
    suggestions.push(`- Considere revisar ${reportLeadNameForDisplay(item.lead_name)}: ${reportPendingActivityText(item)}.`);
  }
  for (const category of ["visit", "quote", "contract", "other"] as const) {
    const item = (groups.get(category) || [])[0];
    if (item) suggestions.push(`- Pode ser útil acompanhar ${reportLeadNameForDisplay(item.lead_name)}: ${reportPendingActivityText(item)}.`);
  }
  if (!suggestions.length) suggestions.push("- Nenhuma acao prioritaria foi identificada.");
  return suggestions;
}

function reportPlanningChanges(data: ReportData) {
  if (!data.planningSnapshotAvailable || !data.planningComparison) return [] as string[];
  const appointmentsById = new Map((data.appointments || []).map((appointment) => [appointment.id, appointment]));
  const lines = ["Mudanças comparadas com o planejamento da manhã:"];
  for (const item of data.planningComparison.planned) {
    const appointment = appointmentsById.get(item.id);
    const name = reportLeadNameForDisplay(appointment?.lead_name || appointment?.customer_name);
    const outcome = normalize(item.outcome);
    const description = outcome.includes("remarcado") ? "compromisso reagendado" : outcome.includes("cancelado") ? "compromisso cancelado" : outcome.includes("concluido") ? "conclusao registrada" : "situacao nao confirmada";
    lines.push(`- ${name}: ${description}.`);
  }
  for (const id of data.planningComparison.newAppointments) {
    const appointment = appointmentsById.get(id);
    lines.push(`- ${reportLeadNameForDisplay(appointment?.lead_name || appointment?.customer_name)}: novo compromisso registrado.`);
  }
  if (data.planningComparison.newPendingItems.length) {
    const count = data.planningComparison.newPendingItems.length;
    lines.push(`- ${count === 1 ? "1 nova pendencia registrada" : `${count} novas pendencias registradas`}.`);
  }
  return lines;
}

function buildAutomaticMorningReportFull(data: ReportData) {
  const appointments = data.appointments || [];
  const presentation = reportPendingPresentation(data.pendingItems || []);
  const physicalSignaturePending = hasPhysicalSignatureReminder(presentation.all);
  const physicalSignaturePendingWithoutAppointment = presentation.all.some((item) =>
    normalize(item.context?.reason) === "physical_contract_signature_pending" && !item.related_appointment_id,
  );
  const groups = reportPendingGroups(presentation.pending);
  const attention = presentation.attention;
  const lines = [
    "\u{1f305} *Relat\u00f3rio da manh\u00e3*",
    `\u{1f4c5} *Compromissos de hoje — ${appointments.length}*`,
    ...(appointments.length ? appointments.map((appointment) => reportAppointmentLineForDisplay(appointment, data.reportTimezone, presentation.all)) : ["- Nenhum compromisso registrado para hoje."]),
    ...(physicalSignaturePending && physicalSignaturePendingWithoutAppointment ? ["- Levar o contrato fisico para assinatura."] : []),
    "",
    `\u{1f6a8} *Precisa da sua aten\u00e7\u00e3o — ${attention.length}*`,
    ...(attention.length ? attention.map(reportPendingLine) : ["- Nenhuma situacao urgente identificada."]),
    "",
    `\u{1f4cb} *Pend\u00eancias — ${presentation.pending.length}*`,
  ];
  for (const [category, label] of [["visit", "Visitas pendentes"], ["quote", "Orcamentos pendentes"], ["contract", "Contratos pendentes"], ["other", "Outras pendencias"]] as const) {
    const group = groups.get(category) || [];
    if (group.length) lines.push(`*${label} (${group.length})*`, ...group.map(reportPendingLine));
  }
  lines.push("", "\u{1f4a1} *Sugest\u00f5es do que fazer primeiro*", ...reportSuggestions(data));
  return lines.join("\n");
}

function buildAutomaticMorningReportSummary(data: ReportData) {
  const appointments = data.appointments || [];
  const presentation = reportPendingPresentation(data.pendingItems || []);
  const physicalSignaturePending = hasPhysicalSignatureReminder(presentation.all);
  const counts = reportPendingCategoryCounts(presentation.all);
  const totalPending = presentation.all.length;
  return [
    "\u{1f305} *Relat\u00f3rio da manh\u00e3*",
    `\u{1f4c5} *Compromissos de hoje — ${appointments.length}*`,
    `- ${appointments.length === 1 ? "1 compromisso registrado" : `${appointments.length} compromissos registrados`}; detalhes individuais disponíveis sob consulta.`,
    "",
    `\u{1f6a8} *Precisa da sua aten\u00e7\u00e3o — ${presentation.attention.length}*`,
    presentation.attention.length ? `- ${reportCountLabel(presentation.attention.length, "atividade", "atividades")} com prioridade alta ou urgente.` : "- Nenhuma prioridade urgente identificada.",
    "",
    `\u{1f4cb} *Pend\u00eancias — ${totalPending}*`,
    `- Visitas: ${counts.visit} | Orcamentos: ${counts.quote} | Contratos: ${counts.contract} | Outras: ${counts.other}.`,
    ...(physicalSignaturePending ? ["- Há contrato físico pendente: levar o contrato para assinatura."] : []),
    "",
    "\u{1f4a1} *Sugest\u00f5es do que fazer primeiro*",
    ...reportSummarySuggestions(data),
    ...reportCurrentOperationalDataInvitation(),
  ].join("\n");
}

export function buildAutomaticMorningReport(data: ReportData) {
  return buildAdaptiveAutomaticReport(buildAutomaticMorningReportFull(data), buildAutomaticMorningReportSummary(data));
}

function buildAutomaticEveningReportFull(data: ReportData) {
  const appointments = data.appointments || [];
  const presentation = reportPendingPresentation(data.pendingItems || []);
  const pendingItems = presentation.pending;
  const completed = appointments.filter((appointment) => appointment.completion_evidence === true);
  const cancelled = appointments.filter((appointment) => ["cancelled", "canceled"].includes(normalize(appointment.status)));
  const rescheduled = appointments.filter((appointment) => ["rescheduled", "remarcado"].includes(normalize(appointment.status)));
  const open = appointments.filter((appointment) => !completed.includes(appointment) && !cancelled.includes(appointment));
  const attention = presentation.attention;
  const lines = [
    "\u{1f319} *Relat\u00f3rio da noite*",
    "\u{1f4ca} *Como foi o dia*",
    `- Compromissos registrados: ${appointments.length}`,
    `- Compromissos conclu\u00eddos: ${completed.length}`,
    `- Compromissos cancelados: ${cancelled.length}`,
    `- Compromissos reagendados: ${rescheduled.length}`,
    "",
    `\u2705 *O que foi conclu\u00eddo — ${completed.length}*`,
    ...(completed.length ? completed.map((appointment) => `- ${reportLeadNameForDisplay(appointment.lead_name || appointment.customer_name)}: ${reportAppointmentTypeForDisplay(appointment.appointment_type)} conclu\u00edda.`) : ["- Nenhuma conclusao registrada."]),
    "",
    `\u{1f504} *Mudancas e remarcacoes — ${rescheduled.length + cancelled.length}*`,
    ...(rescheduled.length || cancelled.length ? [
      ...rescheduled.map((appointment) => `- ${reportLeadNameForDisplay(appointment.lead_name || appointment.customer_name)}: compromisso reagendado para ${appointment.scheduled_start ? new Intl.DateTimeFormat("pt-BR", { timeZone: safeScheduleTimezone(data.reportTimezone || "America/Sao_Paulo"), dateStyle: "short", timeStyle: "short" }).format(new Date(appointment.scheduled_start)) : "novo horario nao informado"}.`),
      ...cancelled.map((appointment) => `- ${reportLeadNameForDisplay(appointment.lead_name || appointment.customer_name)}: compromisso cancelado.`),
    ] : ["- Nenhuma mudanca registrada."]),
    ...(data.planningSnapshotAvailable ? reportPlanningChanges(data) : []),
    "",
    `\u{1f4cb} *O que ficou pendente — ${open.length + pendingItems.length}*`,
    ...(open.length ? open.map((appointment) => `- ${reportLeadNameForDisplay(appointment.lead_name || appointment.customer_name)}: ${reportAppointmentTypeForDisplay(appointment.appointment_type)} ainda pendente.`) : []),
    ...(pendingItems.length ? pendingItems.map(reportPendingLine) : ["- Nenhuma atividade pendente identificada."]),
    "",
    `\u{1f6a8} *Precisa de atencao — ${attention.length}*`,
    ...(attention.length ? attention.map(reportPendingLine) : ["- Nenhum problema urgente identificado."]),
    "",
    "\u{1f4a1} *Sugest\u00f5es para amanh\u00e3*",
    ...reportSuggestions(data),
  ];
  return lines.join("\n");
}

function buildAutomaticEveningReportSummary(data: ReportData) {
  const appointments = data.appointments || [];
  const presentation = reportPendingPresentation(data.pendingItems || []);
  const completed = appointments.filter((appointment) => appointment.completion_evidence === true);
  const cancelled = appointments.filter((appointment) => ["cancelled", "canceled"].includes(normalize(appointment.status)));
  const rescheduled = appointments.filter((appointment) => ["rescheduled", "remarcado"].includes(normalize(appointment.status)));
  const open = appointments.filter((appointment) => !completed.includes(appointment) && !cancelled.includes(appointment));
  const counts = reportPendingCategoryCounts(presentation.all);
  return [
    "\u{1f319} *Relat\u00f3rio da noite*",
    "\u{1f4ca} *Como foi o dia*",
    `- Compromissos registrados: ${appointments.length}`,
    `- Compromissos conclu\u00eddos: ${completed.length}`,
    `- Compromissos cancelados: ${cancelled.length}`,
    `- Compromissos reagendados: ${rescheduled.length}`,
    "",
    `\u2705 *O que foi conclu\u00eddo — ${completed.length}*`,
    "- Detalhes dos compromissos concluidos disponiveis sob consulta.",
    "",
    `\u{1f504} *Mudancas e remarcacoes — ${rescheduled.length + cancelled.length}*`,
    "- Quantidades preservadas; detalhes individuais disponiveis sob consulta.",
    "",
    `\u{1f4cb} *O que ficou pendente — ${open.length + presentation.all.length}*`,
    `- Compromissos em aberto: ${open.length} | Visitas: ${counts.visit} | Orcamentos: ${counts.quote} | Contratos: ${counts.contract} | Outras: ${counts.other}.`,
    "",
    `\u{1f6a8} *Precisa de atencao — ${presentation.attention.length}*`,
    presentation.attention.length ? `- ${reportCountLabel(presentation.attention.length, "atividade", "atividades")} com prioridade alta ou urgente.` : "- Nenhum problema urgente identificado.",
    "",
    "\u{1f4a1} *Sugest\u00f5es para amanh\u00e3*",
    ...reportSummarySuggestions(data),
    ...reportCurrentOperationalDataInvitation(),
  ].join("\n");
}

export function buildAutomaticEveningReport(data: ReportData) {
  return buildAdaptiveAutomaticReport(buildAutomaticEveningReportFull(data), buildAutomaticEveningReportSummary(data));
}

/* legacy builders retained below for review */
/*
export function buildAutomaticMorningReport(data: ReportData) {
  return [
    "Relatório da manhã:",
    `- compromissos de hoje: ${data.appointmentCount}`,
    `- compromissos em aberto: ${data.openAppointmentCount}`,
    `- compromissos em atraso: ${data.overdueAppointmentCount}`,
    `- pendências internas: ${data.pendingNotificationCount + data.pendingTaskCount}`,
    data.appointmentCount === 0 ? "- movimentação: não há compromissos registrados para hoje" : "- movimentação: há compromissos registrados para hoje",
  ].join("\n");
}

export function buildAutomaticEveningReport(data: ReportData) {
  return [
    "Relatório do fim do dia:",
    `- compromissos previstos: ${data.appointmentCount}`,
    `- concluídos: ${data.completedAppointmentCount}`,
    `- cancelados: ${data.cancelledAppointmentCount}`,
    `- ainda em aberto: ${data.openAppointmentCount}`,
    `- pendências internas: ${data.pendingNotificationCount + data.pendingTaskCount}`,
    data.appointmentCount === 0 ? "- movimentação: não houve compromissos registrados para hoje" : "- movimentação: resumo baseado nos registros disponíveis",
  ].join("\n");
}
*/

function getSupabaseAdmin(): ReportSupabase {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server environment is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as ReportSupabase;
}

async function loadReportData(supabase: ReportSupabase, settings: AutomaticReportScheduleSettings, now: Date): Promise<ReportData> {
  const parts = getLocalParts(now, getScheduleTimezone(settings));
  const reportLocalDate = localDateKey(parts);
  const startIso = buildIsoFromDateAndTime({ year: parts.year, month: parts.month - 1, day: parts.day }, "00:00", settings);
  const endIso = buildIsoFromDateAndTime({ year: parts.year, month: parts.month - 1, day: parts.day }, "23:59", settings);
  const [appointments, notifications, tasks, physicalPreferences] = await Promise.all([
    supabase.from("store_appointments").select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, created_at, commercial_opportunity_id").eq("organization_id", settings.organization_id).eq("store_id", settings.store_id).gte("scheduled_start", startIso).lte("scheduled_start", endIso),
    supabase.from("store_assistant_notification_queue").select("id, title, body, related_appointment_id, related_lead_id, created_at, priority, notification_type, context").eq("organization_id", settings.organization_id).eq("store_id", settings.store_id).eq("status", "pending"),
    supabase.from("store_assistant_operational_tasks").select("id, title, description, related_appointment_id, related_lead_id, created_at, task_type, commercial_opportunity_id").eq("organization_id", settings.organization_id).eq("store_id", settings.store_id).in("status", ["open", "waiting_customer_response", "waiting_user_choice", "ready_to_execute", "in_progress"]),
    supabase.from("p9_physical_contract_signature_preferences").select("id, commercial_opportunity_id, sales_contract_id, sales_contract_version_id, planned_date, planned_time, status").eq("organization_id", settings.organization_id).eq("store_id", settings.store_id).eq("planned_date", reportLocalDate),
  ]);
  if (appointments.error || notifications.error || tasks.error || physicalPreferences.error) throw new Error("AUTOMATIC_REPORT_DATA_LOAD_FAILED");
  const rows = (appointments.data || []) as ReportAppointment[];
  const notificationRows = (notifications.data || []) as Array<{ id?: string; title?: string | null; body?: string | null; related_appointment_id?: string | null; related_lead_id?: string | null; created_at?: string | null; priority?: string | null; notification_type?: string | null; context?: unknown }>;
  const taskRows = (tasks.data || []) as Array<{ id?: string; title?: string | null; description?: string | null; related_appointment_id?: string | null; related_lead_id?: string | null; created_at?: string | null; task_type?: string | null; commercial_opportunity_id?: string | null }>;
  const physicalRows = (physicalPreferences.data || []) as Array<{ id?: string; commercial_opportunity_id?: string | null; sales_contract_id?: string | null; sales_contract_version_id?: string | null; planned_date?: string | null; planned_time?: string | null; status?: string | null }>;
  const pendingPhysicalRows = physicalRows.filter((row) => normalize(row.status) === "pending" && cleanText(row.planned_date) === reportLocalDate);
  const reportableNotificationRows = notificationRows.filter((row) =>
    !isAutomaticReportQueueItem(row) && !isTechnicalIncidentNotification(row) && normalize(
      row.context && typeof row.context === "object" && !Array.isArray(row.context)
        ? (row.context as Record<string, unknown>).reason
        : null,
    ) !== "physical_contract_signature_pending",
  );
  const physicalPendingItems: ReportPendingItem[] = pendingPhysicalRows.map((row) => {
    const opportunityId = cleanText(row.commercial_opportunity_id) || null;
    const appointment = rows.find((candidate) =>
      opportunityId && cleanText(candidate.commercial_opportunity_id) === opportunityId &&
      !["cancelled", "canceled"].includes(normalize(candidate.status)),
    );
    return {
      id: `physical-signature:${cleanText(row.id)}`,
      title: "Assinatura fisica pendente",
      body: "Levar o contrato fisico para assinatura.",
      related_appointment_id: appointment?.id || null,
      related_lead_id: null,
      created_at: null,
      kind: "notification",
      priority: "high",
      notification_type: "physical_contract_signature_pending",
      commercial_opportunity_id: opportunityId,
      context: {
        source: "p9_physical_signature_c6",
        reason: "physical_contract_signature_pending",
        related_contract_id: cleanText(row.sales_contract_id) || null,
        document_version_id: cleanText(row.sales_contract_version_id) || null,
        commercial_opportunity_id: opportunityId,
        planned_date: cleanText(row.planned_date) || null,
        planned_time: cleanText(row.planned_time) || null,
        event_key: `p9-physical-signature:${cleanText(row.id)}:${reportLocalDate}`,
      },
    };
  });
  const rawPendingItems: ReportPendingItem[] = [
    ...reportableNotificationRows
      .map((row) => ({ id: cleanText(row.id), title: row.title || null, body: row.body || null, related_appointment_id: row.related_appointment_id || null, related_lead_id: row.related_lead_id || null, created_at: row.created_at || null, kind: "notification" as const, priority: row.priority || null, notification_type: row.notification_type || null, context: row.context && typeof row.context === "object" && !Array.isArray(row.context) ? row.context as Record<string, unknown> : null })),
    ...physicalPendingItems,
    ...taskRows.map((row) => ({ id: cleanText(row.id), title: row.title || null, body: row.description || null, related_appointment_id: row.related_appointment_id || null, related_lead_id: row.related_lead_id || null, created_at: row.created_at || null, kind: "task" as const, task_type: row.task_type || null, commercial_opportunity_id: row.commercial_opportunity_id || null })),
  ];

  const uuidIds = (values: unknown[]) => Array.from(new Set(values.map(cleanText).filter((value) => UUID_PATTERN.test(value))));
  const directLeadIds = uuidIds([
    ...rawPendingItems.map((item) => item.related_lead_id),
  ]);
  const opportunityIds = uuidIds([
    ...rows.map((row) => row.commercial_opportunity_id),
    ...rawPendingItems.map((item) => item.commercial_opportunity_id || item.context?.commercial_opportunity_id),
    ...pendingPhysicalRows.map((row) => row.commercial_opportunity_id),
  ]);
  const contractIds = uuidIds([
    ...rawPendingItems.map((item) => item.context?.related_contract_id || item.context?.contract_id || item.context?.document_id),
    ...pendingPhysicalRows.map((row) => row.sales_contract_id),
  ]);
  const quoteIds = uuidIds(rawPendingItems.map((item) => item.context?.related_quote_id || item.context?.quote_id || item.context?.sales_quote_id));
  const scopedRows = async (table: string, select: string, ids: string[], label: string) => {
    if (!ids.length) return [] as Array<Record<string, unknown>>;
    const result = await supabase.from(table).select(select).eq("organization_id", settings.organization_id).eq("store_id", settings.store_id).in("id", ids);
    if (result.error) throw new Error(`AUTOMATIC_REPORT_${label}_LOAD_FAILED`);
    return (result.data || []) as Array<Record<string, unknown>>;
  };
  const [leadRows, opportunityRows, contractRows, quoteRows] = await Promise.all([
    scopedRows("leads", "id, name", directLeadIds, "LEAD"),
    scopedRows("commercial_opportunities", "id, origin_lead_id, customer_id", opportunityIds, "OPPORTUNITY"),
    scopedRows("sales_contracts", "id, commercial_opportunity_id", contractIds, "CONTRACT"),
    scopedRows("sales_quotes", "id, lead_id, commercial_opportunity_id", quoteIds, "QUOTE"),
  ]);
  const allLeadIds = uuidIds([
    ...directLeadIds,
    ...opportunityRows.map((row) => row.origin_lead_id),
    ...quoteRows.map((row) => row.lead_id),
  ]);
  const extraLeadRows = allLeadIds.length > directLeadIds.length
    ? await scopedRows("leads", "id, name", allLeadIds, "LEAD")
    : leadRows;
  const customerIds = uuidIds(opportunityRows.map((row) => row.customer_id));
  const customerRows = await scopedRows("customers", "id, display_name", customerIds, "CUSTOMER");
  const leadNames = new Map<string, string>();
  for (const row of extraLeadRows) if (cleanText(row.id) && cleanText(row.name)) leadNames.set(cleanText(row.id), cleanText(row.name));
  const customerNames = new Map<string, string>();
  for (const row of customerRows) if (cleanText(row.id) && cleanText(row.display_name)) customerNames.set(cleanText(row.id), cleanText(row.display_name));
  const opportunityById = new Map(opportunityRows.map((row) => [cleanText(row.id), row]));
  const contractOpportunityById = new Map(contractRows.map((row) => [cleanText(row.id), cleanText(row.commercial_opportunity_id)]));
  const quoteLeadById = new Map(quoteRows.map((row) => [cleanText(row.id), cleanText(row.lead_id)]));
  const resolveLeadName = (leadId: unknown, opportunityId: unknown, entityId?: unknown) => {
    const direct = leadNames.get(cleanText(leadId));
    if (direct) return direct;
    const opportunity = opportunityById.get(cleanText(opportunityId));
    const opportunityLead = leadNames.get(cleanText(opportunity?.origin_lead_id));
    if (opportunityLead) return opportunityLead;
    const customerName = customerNames.get(cleanText(opportunity?.customer_id));
    if (customerName) return customerName;
    const quoteLead = leadNames.get(cleanText(entityId && quoteLeadById.get(cleanText(entityId))));
    return quoteLead || null;
  };
  const pendingItems = deduplicatePendingItems(rawPendingItems.map((item) => {
    const context = item.context || {};
    const contractOpportunityId = contractOpportunityById.get(cleanText(context.related_contract_id || context.contract_id || context.document_id));
    const opportunityId = item.commercial_opportunity_id || context.commercial_opportunity_id || contractOpportunityId || null;
    const quoteId = context.related_quote_id || context.quote_id || context.sales_quote_id;
    return { ...item, lead_name: resolveLeadName(item.related_lead_id, opportunityId, quoteId), commercial_opportunity_id: cleanText(opportunityId) || null };
  }));
  const appointmentOpportunityIds = uuidIds(rows.map((row) => row.commercial_opportunity_id));
  const appointmentLeadRows = appointmentOpportunityIds.length && opportunityRows.length === 0
    ? await scopedRows("commercial_opportunities", "id, origin_lead_id, customer_id", appointmentOpportunityIds, "OPPORTUNITY")
    : opportunityRows;
  for (const row of appointmentLeadRows) opportunityById.set(cleanText(row.id), row);
  const completionEvidence = new Set<string>();
  const appointmentIds = uuidIds(rows.map((row) => row.id));
  if (appointmentIds.length) {
    const current = await scopedRows("store_appointment_completion_current", "appointment_id, current_completion_event_id", appointmentIds, "APPOINTMENT_COMPLETION");
    const eventIds = uuidIds(current.map((row) => row.current_completion_event_id));
    const events = await scopedRows("store_appointment_completion_events", "id, appointment_id, completion_outcome", eventIds, "APPOINTMENT_COMPLETION_EVENT");
    for (const event of events) if (["fully_completed", "needs_followup"].includes(normalize(event.completion_outcome))) completionEvidence.add(cleanText(event.appointment_id));
  }
  const enrichedRows = rows.map((row) => ({
    ...row,
    lead_name: resolveLeadName(null, row.commercial_opportunity_id),
    completion_evidence: completionEvidence.has(row.id),
  }));
  const nowMs = now.getTime();
  const normalized = enrichedRows.map((row) => normalize(row.status));
  return {
    appointmentCount: enrichedRows.length,
    openAppointmentCount: enrichedRows.filter((row) => !row.completion_evidence && !["cancelled", "canceled"].includes(normalize(row.status))).length,
    completedAppointmentCount: enrichedRows.filter((row) => row.completion_evidence === true).length,
    cancelledAppointmentCount: normalized.filter((status) => ["cancelled", "canceled"].includes(status)).length,
    overdueAppointmentCount: enrichedRows.filter((row) => row.scheduled_end && Date.parse(row.scheduled_end) < nowMs && !row.completion_evidence && !["cancelled", "canceled"].includes(normalize(row.status))).length,
    pendingNotificationCount: reportableNotificationRows.length,
    pendingTaskCount: Array.isArray(tasks.data) ? tasks.data.length : 0,
    appointments: enrichedRows,
    pendingItems,
    planningSnapshotAvailable: false,
    reportLocalDate,
    reportTimezone: getScheduleTimezone(settings),
  };
}

async function loadMorningSnapshot(supabase: ReportSupabase, settings: AutomaticReportScheduleSettings, localDate: string) {
  const claims = await supabase
    .from("store_assistant_automatic_report_claims")
    .select("message_id, status")
    .eq("organization_id", settings.organization_id)
    .eq("store_id", settings.store_id)
    .eq("local_date", localDate)
    .eq("report_type", "morning_report");
  if (claims.error) throw new Error(`AUTOMATIC_REPORT_SNAPSHOT_CLAIM_LOAD_FAILED: ${claims.error.message || "unknown"}`);
  const claim = ((claims.data || []) as Array<{ message_id?: string | null; status?: string | null }>).find((row) => row.status === "completed" && cleanText(row.message_id));
  if (!claim?.message_id) return null;

  const messages = await supabase
    .from("store_assistant_messages")
    .select("id, organization_id, store_id, metadata")
    .eq("id", claim.message_id)
    .eq("organization_id", settings.organization_id)
    .eq("store_id", settings.store_id);
  if (messages.error) throw new Error(`AUTOMATIC_REPORT_SNAPSHOT_MESSAGE_LOAD_FAILED: ${messages.error.message || "unknown"}`);
  const message = ((messages.data || []) as Array<{ metadata?: unknown }>)[0];
  const metadata = message?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const snapshot = (metadata as Record<string, unknown>).automatic_report_snapshot;
  return validMorningSnapshot(snapshot) ? snapshot : null;
}

async function loadAppointmentsByIds(supabase: ReportSupabase, settings: AutomaticReportScheduleSettings, ids: string[]) {
  if (!ids.length) return [] as ReportAppointment[];
  const result = await supabase
    .from("store_appointments")
    .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, created_at")
    .eq("organization_id", settings.organization_id)
    .eq("store_id", settings.store_id)
    .in("id", ids);
  if (result.error) throw new Error(`AUTOMATIC_REPORT_SNAPSHOT_APPOINTMENT_LOAD_FAILED: ${result.error.message || "unknown"}`);
  return (result.data || []) as ReportAppointment[];
}

async function loadAutomaticReportHolidayBlocks(
  supabase: ReportSupabase,
  settings: AutomaticReportScheduleSettings,
  now: Date,
) {
  const parts = getLocalParts(now, getScheduleTimezone(settings));
  const startIso = buildIsoFromDateAndTime({ year: parts.year, month: parts.month - 1, day: parts.day }, "00:00", settings);
  const endIso = buildIsoFromDateAndTime({ year: parts.year, month: parts.month - 1, day: parts.day }, "23:59", settings);
  const { data, error } = await supabase
    .from("store_schedule_blocks")
    .select("id, title, block_type, start_at, end_at")
    .eq("organization_id", settings.organization_id)
    .eq("store_id", settings.store_id)
    .eq("block_type", "holiday")
    .lt("start_at", endIso)
    .gt("end_at", startIso);
  if (error) throw new Error(`AUTOMATIC_REPORT_HOLIDAY_LOAD_FAILED: ${error.message || "unknown"}`);
  return Array.isArray(data) ? data as StoreScheduleHolidayBlockForSalesAiWindow[] : [];
}

function reportKey(settings: AutomaticReportScheduleSettings, item: DueReport) {
  return `assistant-automatic-report:${settings.organization_id}:${settings.store_id}:${item.localDate}:${item.type}`;
}

function parseClaimResult(value: unknown): AutomaticReportClaimResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AUTOMATIC_REPORT_CLAIM_RESPONSE_INVALID");
  const row = value as Record<string, unknown>;
  const result = row.result as AutomaticReportClaimResult["result"];
  const claimId = typeof row.claim_id === "string" ? row.claim_id : "";
  if (!claimId || !["claimed", "already_claimed", "retry_later", "completed"].includes(String(result))) {
    throw new Error("AUTOMATIC_REPORT_CLAIM_RESPONSE_INVALID");
  }
  if (result === "claimed") {
    const claimToken = typeof row.claim_token === "string" ? row.claim_token : "";
    if (!claimToken) throw new Error("AUTOMATIC_REPORT_CLAIM_RESPONSE_INVALID");
    return { result, claim_id: claimId, claim_token: claimToken, attempt_count: typeof row.attempt_count === "number" ? row.attempt_count : undefined };
  }
  if (result === "completed") {
    return { result, claim_id: claimId, message_id: typeof row.message_id === "string" ? row.message_id : null, notification_id: typeof row.notification_id === "string" ? row.notification_id : null };
  }
  return { result, claim_id: claimId };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "unknown");
}

async function markAutomaticReportRetryable(args: {
  supabase: ReportSupabase;
  settings: AutomaticReportScheduleSettings;
  item: DueReport;
  claimToken: string;
  errorCode: string;
}) {
  const result = await args.supabase.rpc("assistant_fail_automatic_report", {
    p_organization_id: args.settings.organization_id,
    p_store_id: args.settings.store_id,
    p_local_date: args.item.localDate,
    p_report_type: args.item.type,
    p_claim_token: args.claimToken,
    p_error_code: args.errorCode,
  });
  if (result.error) throw new Error(`AUTOMATIC_REPORT_CLAIM_FAILURE_RECORD_FAILED: ${result.error.message || "unknown"}`);
  if (result.data !== true) throw new Error("AUTOMATIC_REPORT_CLAIM_FAILURE_NOT_RECORDED");
}

export async function processAutomaticAssistantReports(args: { now?: Date; limit?: number; supabase?: ReportSupabase }) {
  if (!isAutomaticAssistantReportsEnabled()) {
    return {
      ok: true as const,
      enabled: false as const,
      processed: 0,
      results: [] as Array<Record<string, unknown>>,
    };
  }

  const allowedStoreIds = getAutomaticAssistantReportsAllowedStoreIds();
  if (allowedStoreIds.length === 0) {
    return {
      ok: true as const,
      enabled: true as const,
      processed: 0,
      results: [] as Array<Record<string, unknown>>,
    };
  }

  const supabase = args.supabase || getSupabaseAdmin();
  const now = args.now || new Date();
  const { data, error } = await supabase.from("store_schedule_settings").select("organization_id, store_id, operating_days, operating_hours, timezone_name, holiday_mode, holiday_open_time, holiday_close_time, attends_holidays, ai_after_hours_enabled, ai_after_hours_mode, ai_after_hours_start, ai_after_hours_end, ai_attends_holidays, ai_after_hours_configured_at, assistant_morning_report_time, assistant_evening_report_time, assistant_non_operating_report_policy").in("store_id", allowedStoreIds);
  if (error) throw new Error(`AUTOMATIC_REPORT_SCHEDULE_LOAD_FAILED: ${error.message || "unknown"}`);
  const results: Array<Record<string, unknown>> = [];
  for (const settings of ((data || []) as AutomaticReportScheduleSettings[]).slice(0, args.limit || 100)) {
    const holidayBlocks = await loadAutomaticReportHolidayBlocks(supabase, settings, now);
    const due = resolveAutomaticReportDue({ settings, now, holidayBlocks });
    for (const item of due.filter((row) => row.reason === "due")) {
      const claim = await supabase.rpc("assistant_claim_automatic_report", {
        p_organization_id: settings.organization_id,
        p_store_id: settings.store_id,
        p_local_date: item.localDate,
        p_report_type: item.type,
        p_lease_seconds: AUTOMATIC_REPORT_LEASE_SECONDS,
      });
      if (claim.error) throw new Error(`AUTOMATIC_REPORT_CLAIM_FAILED: ${claim.error.message || "unknown"}`);
      const claimResult = parseClaimResult(claim.data);
      const currentReportKey = reportKey(settings, item);
      if (claimResult.result !== "claimed") {
        results.push({ organizationId: settings.organization_id, storeId: settings.store_id, type: item.type, status: claimResult.result, reportKey: currentReportKey });
        continue;
      }
      const claimToken = claimResult.claim_token;
      let reportData: ReportData;
      try {
        reportData = await loadReportData(supabase, settings, now);
      } catch (error) {
        await markAutomaticReportRetryable({ supabase, settings, item, claimToken, errorCode: "AUTOMATIC_REPORT_GENERATION_FAILED" });
        throw new Error(`AUTOMATIC_REPORT_GENERATION_FAILED: ${errorMessage(error)}`);
      }
      const body = item.type === "morning_report" ? buildAutomaticMorningReport(reportData) : buildAutomaticEveningReport(reportData);
      const reportMetadata: Record<string, unknown> = {
        source: "assistant_automatic_reports",
        report_key: currentReportKey,
        report_type: item.type,
        local_date: item.localDate,
        target_iso: item.targetIso,
      };
      if (item.type === "morning_report") {
        reportMetadata.automatic_report_snapshot = buildMorningSnapshot(reportData);
      } else {
        const snapshot = await loadMorningSnapshot(supabase, settings, item.localDate);
        if (snapshot) {
          const currentSnapshotAppointments = await loadAppointmentsByIds(
            supabase,
            settings,
            snapshot.appointments.map((appointment) => appointment.id),
          );
          reportData = {
            ...reportData,
            appointments: [...(reportData.appointments || []), ...currentSnapshotAppointments.filter((appointment) => !(reportData.appointments || []).some((current) => current.id === appointment.id))],
            planningSnapshotAvailable: true,
          };
          reportData.planningComparison = compareMorningSnapshot(snapshot, reportData);
        }
      }
      const finalBody = item.type === "morning_report" ? body : buildAutomaticEveningReport(reportData);
      const materialized = await supabase.rpc("assistant_materialize_automatic_report", {
        p_organization_id: settings.organization_id,
        p_store_id: settings.store_id,
        p_local_date: item.localDate,
        p_report_type: item.type,
        p_claim_token: claimToken,
        p_content: finalBody,
        p_metadata: reportMetadata,
      });
      if (materialized.error) {
        await markAutomaticReportRetryable({ supabase, settings, item, claimToken, errorCode: "AUTOMATIC_REPORT_MATERIALIZATION_FAILED" });
        throw new Error(`AUTOMATIC_REPORT_MATERIALIZATION_FAILED: ${materialized.error.message || "unknown"}`);
      }
      const materializedResult = parseClaimResult(materialized.data);
      if (materializedResult.result !== "completed") throw new Error("AUTOMATIC_REPORT_MATERIALIZATION_RESPONSE_INVALID");
      results.push({ organizationId: settings.organization_id, storeId: settings.store_id, type: item.type, status: "generated", reportKey: currentReportKey, messageId: materializedResult.message_id, notificationId: materializedResult.notification_id });
    }
  }
  return { ok: true as const, enabled: true as const, processed: results.length, results };
}

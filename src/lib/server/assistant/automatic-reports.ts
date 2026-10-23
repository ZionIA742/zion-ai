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
};

export type ReportPendingItem = {
  id: string;
  title: string | null;
  body: string | null;
  related_appointment_id: string | null;
  created_at: string | null;
  kind: "notification" | "task";
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
const REPORT_DUE_WINDOW_MS = 2 * 60 * 1000;

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
    if (habitual.ambiguous || !habitual.hours) {
      result.push({ type, localDate: dateKey, targetIso: "", reason: habitual.ambiguous ? "ambiguous_hours" : "missing_schedule" });
      continue;
    }

    const targetTime = type === "morning_report"
      ? habitual.hours.start
      : (() => {
          const endMinutes = parseSalesAiScheduleTimeToMinutes(habitual.hours?.end);
          const reportMinutes = endMinutes === null ? null : (endMinutes + 1430) % 1440;
          return reportMinutes === null ? null : `${String(Math.floor(reportMinutes / 60)).padStart(2, "0")}:${String(reportMinutes % 60).padStart(2, "0")}`;
        })();
    if (!targetTime) {
      result.push({ type, localDate: dateKey, targetIso: "", reason: "missing_schedule" });
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
    const authorized = humanDay || aiAllowed;
    result.push({
      type,
      localDate: dateKey,
      targetIso,
      reason: !authorized ? "not_authorized" : Math.abs(now.getTime() - Date.parse(targetIso)) <= REPORT_DUE_WINDOW_MS ? "due" : "not_due",
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
  return items.map((item) => {
    const label = cleanReportValue(item.title || item.body, "pendencia sem descricao");
    const age = item.created_at && item.created_at.slice(0, 10) !== reportLocalDate ? " (pendencia anterior)" : "";
    return `- ${label}${age}`;
  });
}

export function buildAutomaticMorningReport(data: ReportData) {
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

export function buildAutomaticEveningReport(data: ReportData) {
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
  const startIso = buildIsoFromDateAndTime({ year: parts.year, month: parts.month - 1, day: parts.day }, "00:00", settings);
  const endIso = buildIsoFromDateAndTime({ year: parts.year, month: parts.month - 1, day: parts.day }, "23:59", settings);
  const [appointments, notifications, tasks] = await Promise.all([
    supabase.from("store_appointments").select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, created_at").eq("organization_id", settings.organization_id).eq("store_id", settings.store_id).gte("scheduled_start", startIso).lte("scheduled_start", endIso),
    supabase.from("store_assistant_notification_queue").select("id, title, body, related_appointment_id, created_at").eq("organization_id", settings.organization_id).eq("store_id", settings.store_id).eq("status", "pending"),
    supabase.from("store_assistant_operational_tasks").select("id, title, description, related_appointment_id, created_at").eq("organization_id", settings.organization_id).eq("store_id", settings.store_id).in("status", ["open", "waiting_customer_response", "waiting_user_choice", "ready_to_execute", "in_progress"]),
  ]);
  if (appointments.error || notifications.error || tasks.error) throw new Error("AUTOMATIC_REPORT_DATA_LOAD_FAILED");
  const rows = (appointments.data || []) as ReportAppointment[];
  const notificationRows = (notifications.data || []) as Array<{ id?: string; title?: string | null; body?: string | null; related_appointment_id?: string | null; created_at?: string | null }>;
  const taskRows = (tasks.data || []) as Array<{ id?: string; title?: string | null; description?: string | null; related_appointment_id?: string | null; created_at?: string | null }>;
  const pendingItems: ReportPendingItem[] = [
    ...notificationRows.map((row) => ({ id: cleanText(row.id), title: row.title || null, body: row.body || null, related_appointment_id: row.related_appointment_id || null, created_at: row.created_at || null, kind: "notification" as const })),
    ...taskRows.map((row) => ({ id: cleanText(row.id), title: row.title || null, body: row.description || null, related_appointment_id: row.related_appointment_id || null, created_at: row.created_at || null, kind: "task" as const })),
  ];
  const nowMs = now.getTime();
  const normalized = rows.map((row) => normalize(row.status));
  return {
    appointmentCount: rows.length,
    openAppointmentCount: normalized.filter((status) => !["completed", "fully_completed", "done", "cancelled", "canceled"].includes(status)).length,
    completedAppointmentCount: normalized.filter((status) => ["completed", "fully_completed", "done"].includes(status)).length,
    cancelledAppointmentCount: normalized.filter((status) => ["cancelled", "canceled"].includes(status)).length,
    overdueAppointmentCount: rows.filter((row) => row.scheduled_end && Date.parse(row.scheduled_end) < nowMs && !["completed", "fully_completed", "done", "cancelled", "canceled"].includes(normalize(row.status))).length,
    pendingNotificationCount: Array.isArray(notifications.data) ? notifications.data.length : 0,
    pendingTaskCount: Array.isArray(tasks.data) ? tasks.data.length : 0,
    appointments: rows,
    pendingItems,
    planningSnapshotAvailable: false,
    reportLocalDate: localDateKey(parts),
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
  const { data, error } = await supabase.from("store_schedule_settings").select("organization_id, store_id, operating_days, operating_hours, timezone_name, holiday_mode, holiday_open_time, holiday_close_time, attends_holidays, ai_after_hours_enabled, ai_after_hours_mode, ai_after_hours_start, ai_after_hours_end, ai_attends_holidays, ai_after_hours_configured_at").in("store_id", allowedStoreIds);
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

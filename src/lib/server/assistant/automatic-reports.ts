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

type ReportData = {
  appointmentCount: number;
  openAppointmentCount: number;
  completedAppointmentCount: number;
  cancelledAppointmentCount: number;
  overdueAppointmentCount: number;
  pendingNotificationCount: number;
  pendingTaskCount: number;
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

const DAY_KEYS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const REPORT_DUE_WINDOW_MS = 2 * 60 * 1000;

export function isAutomaticAssistantReportsEnabled(
  value = process.env[AUTOMATIC_REPORTS_ENABLED_ENV],
) {
  return value === "true";
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
          const reportMinutes = endMinutes === null ? null : (endMinutes + 1380) % 1440;
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
    supabase.from("store_appointments").select("status, scheduled_end").eq("organization_id", settings.organization_id).eq("store_id", settings.store_id).gte("scheduled_start", startIso).lte("scheduled_start", endIso),
    supabase.from("store_assistant_notification_queue").select("id").eq("organization_id", settings.organization_id).eq("store_id", settings.store_id).eq("status", "pending"),
    supabase.from("store_assistant_operational_tasks").select("id").eq("organization_id", settings.organization_id).eq("store_id", settings.store_id).in("status", ["open", "waiting_customer_response", "waiting_user_choice", "ready_to_execute", "in_progress"]),
  ]);
  if (appointments.error || notifications.error || tasks.error) throw new Error("AUTOMATIC_REPORT_DATA_LOAD_FAILED");
  const rows = (appointments.data || []) as Array<{ status?: string | null; scheduled_end?: string | null }>;
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
  };
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

  const supabase = args.supabase || getSupabaseAdmin();
  const now = args.now || new Date();
  const { data, error } = await supabase.from("store_schedule_settings").select("organization_id, store_id, operating_days, operating_hours, timezone_name, holiday_mode, holiday_open_time, holiday_close_time, attends_holidays, ai_after_hours_enabled, ai_after_hours_mode, ai_after_hours_start, ai_after_hours_end, ai_attends_holidays, ai_after_hours_configured_at");
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
      const materialized = await supabase.rpc("assistant_materialize_automatic_report", {
        p_organization_id: settings.organization_id,
        p_store_id: settings.store_id,
        p_local_date: item.localDate,
        p_report_type: item.type,
        p_claim_token: claimToken,
        p_content: body,
        p_metadata: { source: "assistant_automatic_reports", report_key: currentReportKey, report_type: item.type, local_date: item.localDate, target_iso: item.targetIso },
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

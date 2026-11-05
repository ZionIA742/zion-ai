import assert from "node:assert/strict";
import { AUTOMATIC_REPORT_SAFE_TEXT_LIMIT, buildAutomaticEveningReport, buildAutomaticMorningReport, compareMorningSnapshot, processAutomaticAssistantReports, resolveAutomaticReportDue } from "./automatic-reports";

const base = {
  organization_id: "org-1", store_id: "11111111-1111-4111-8111-111111111112", timezone_name: "America/Sao_Paulo",
  operating_days: ["segunda", "terca", "quarta", "quinta", "sexta"],
  operating_hours: { segunda: { start: "08:00", end: "18:00" }, terca: { start: "08:00", end: "18:00" }, quarta: { start: "08:00", end: "18:00" }, quinta: { start: "08:00", end: "18:00" }, sexta: { start: "08:00", end: "18:00" } },
  ai_after_hours_enabled: true, ai_after_hours_mode: "all_closed_hours", ai_after_hours_configured_at: "2026-10-01T00:00:00Z", ai_attends_holidays: true, holiday_mode: "closed",
};

const tests = [
  () => { const result = resolveAutomaticReportDue({ settings: base, now: new Date("2026-10-19T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["due", "not_due"]); },
  () => {
    const settings = { ...base, assistant_morning_report_time: "06:30", assistant_evening_report_time: "22:30" };
    const morning = resolveAutomaticReportDue({ settings, now: new Date("2026-10-19T09:30:00Z") });
    const evening = resolveAutomaticReportDue({ settings, now: new Date("2026-10-20T01:30:00Z") });
    assert.equal(morning[0]?.reason, "due");
    assert.equal(evening[1]?.reason, "due");
    assert.equal(morning[0]?.targetIso, "2026-10-19T09:30:00.000Z");
    assert.equal(evening[1]?.targetIso, "2026-10-20T01:30:00.000Z");
  },
  () => {
    const settings = { ...base, operating_hours: null, assistant_morning_report_time: "06:30", assistant_evening_report_time: "22:30" };
    const result = resolveAutomaticReportDue({ settings, now: new Date("2026-10-19T09:30:00Z") });
    assert.equal(result[0]?.reason, "due");
    assert.equal(result[1]?.reason, "not_due");
  },
  () => {
    const settings = { ...base, timezone_name: "America/New_York", assistant_morning_report_time: "05:30", assistant_evening_report_time: "22:15" };
    const result = resolveAutomaticReportDue({ settings, now: new Date("2026-10-19T09:30:00Z") });
    assert.equal(result[0]?.reason, "due");
    assert.equal(result[0]?.targetIso, "2026-10-19T09:30:00.000Z");
  },
  () => {
    const settings = { ...base, assistant_morning_report_time: "06:30" };
    const withinTolerance = resolveAutomaticReportDue({ settings, now: new Date("2026-10-19T09:40:00Z") });
    const outsideTolerance = resolveAutomaticReportDue({ settings, now: new Date("2026-10-19T09:46:00Z") });
    assert.equal(withinTolerance[0]?.reason, "due");
    assert.equal(outsideTolerance[0]?.reason, "not_due");
  },
  () => {
    const send = resolveAutomaticReportDue({ settings: { ...base, assistant_morning_report_time: "06:30", assistant_non_operating_report_policy: "send_on_non_operating_ai_days" }, now: new Date("2026-10-18T09:30:00Z") });
    const skip = resolveAutomaticReportDue({ settings: { ...base, assistant_morning_report_time: "06:30", assistant_non_operating_report_policy: "skip_non_operating_days" }, now: new Date("2026-10-18T09:30:00Z") });
    const consolidate = resolveAutomaticReportDue({ settings: { ...base, assistant_morning_report_time: "06:30", assistant_non_operating_report_policy: "skip_and_consolidate_non_operating_days" }, now: new Date("2026-10-18T09:30:00Z") });
    assert.equal(send[0]?.reason, "due");
    assert.equal(skip[0]?.reason, "not_authorized");
    assert.equal(consolidate[0]?.reason, "not_authorized");
  },
  () => { const result = resolveAutomaticReportDue({ settings: base, now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["due", "not_due"]); },
  () => { const settings = { ...base, ai_after_hours_enabled: false }; const result = resolveAutomaticReportDue({ settings, now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["not_authorized", "not_authorized"]); },
  () => { const result = resolveAutomaticReportDue({ settings: base, now: new Date("2026-10-19T20:50:00Z") }); assert.deepEqual(result.map((item) => item.targetIso), ["2026-10-19T11:00:00.000Z", "2026-10-19T20:50:00.000Z"]); },
  () => { const result = resolveAutomaticReportDue({ settings: base, holidayBlocks: [{ block_type: "holiday", start_at: "2026-10-18T03:00:00Z", end_at: "2026-10-19T03:00:00Z" }], now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["due", "not_due"]); },
  () => { const settings = { ...base, ai_attends_holidays: false }; const result = resolveAutomaticReportDue({ settings, holidayBlocks: [{ block_type: "holiday", start_at: "2026-10-18T03:00:00Z", end_at: "2026-10-19T03:00:00Z" }], now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["not_authorized", "not_authorized"]); },
  () => { const settings = { ...base, ai_after_hours_mode: "specific_window", ai_after_hours_start: "09:00", ai_after_hours_end: "19:00" }; const result = resolveAutomaticReportDue({ settings, now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["not_authorized", "not_due"]); },
  () => { const settings = { ...base, operating_days: ["segunda", "terca"], operating_hours: { segunda: { start: "08:00", end: "18:00" }, terca: { start: "09:00", end: "17:00" } } }; const result = resolveAutomaticReportDue({ settings, now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["ambiguous_hours", "ambiguous_hours"]); },
  () => { const result = buildAutomaticMorningReport({ appointmentCount: 0, openAppointmentCount: 0, completedAppointmentCount: 0, cancelledAppointmentCount: 0, overdueAppointmentCount: 0, pendingNotificationCount: 0, pendingTaskCount: 0 }); assert.match(result, /Nenhum compromisso registrado/); assert.match(result, /Relatório da manhã/); },
  () => { const result = buildAutomaticEveningReport({ appointmentCount: 2, openAppointmentCount: 1, completedAppointmentCount: 1, cancelledAppointmentCount: 0, overdueAppointmentCount: 0, pendingNotificationCount: 1, pendingTaskCount: 2, appointments: [{ id: "done", title: null, appointment_type: "visit", status: "completed", scheduled_start: null, scheduled_end: null, customer_name: "Cliente", customer_phone: null, address_text: null, created_at: null, completion_evidence: true }] }); assert.match(result, /Compromissos concluídos: 1/); },
  () => {
    const appointments = Array.from({ length: 5 }, (_, index) => ({
      id: `appointment-${index}`,
      title: `Visita ${index}`,
      appointment_type: "technical_visit",
      status: index === 0 ? "completed" : "open",
      scheduled_start: `2026-10-19T${String(10 + index).padStart(2, "0")}:00:00Z`,
      scheduled_end: `2026-10-19T${String(10 + index).padStart(2, "0")}:30:00Z`,
      customer_name: `Cliente ${index}`,
      customer_phone: index === 1 ? null : `55119999999${index}`,
      address_text: index === 2 ? null : `Rua ${index}`,
      created_at: "2026-10-18T12:00:00Z",
    }));
    const result = buildAutomaticMorningReport({ appointmentCount: 5, openAppointmentCount: 4, completedAppointmentCount: 1, cancelledAppointmentCount: 0, overdueAppointmentCount: 0, pendingNotificationCount: 1, pendingTaskCount: 1, appointments, pendingItems: [{ id: "old", title: "Retorno pendente", body: null, related_appointment_id: null, created_at: "2026-10-18T12:00:00Z", kind: "task" }], planningSnapshotAvailable: false, reportLocalDate: "2026-10-19" });
    assert.match(result, /Cliente 0/);
    assert.equal((result.match(/Cliente [0-4]/g) || []).length, 5);
    assert.doesNotMatch(result, /appointment-\d/);
    assert.match(result, /Outras pendencias/);
  },
  () => {
    const result = buildAutomaticEveningReport({ appointmentCount: 3, openAppointmentCount: 1, completedAppointmentCount: 1, cancelledAppointmentCount: 1, overdueAppointmentCount: 0, pendingNotificationCount: 0, pendingTaskCount: 1, appointments: [
      { id: "done", title: null, appointment_type: "visit", status: "completed", scheduled_start: "2026-10-19T12:00:00Z", scheduled_end: null, customer_name: "Cliente", customer_phone: null, address_text: null, created_at: null, completion_evidence: true },
      { id: "cancelled", title: null, appointment_type: "visit", status: "cancelled", scheduled_start: "2026-10-19T13:00:00Z", scheduled_end: null, customer_name: null, customer_phone: null, address_text: null, created_at: null },
      { id: "open", title: null, appointment_type: "visit", status: "rescheduled", scheduled_start: "2026-10-19T14:00:00Z", scheduled_end: null, customer_name: null, customer_phone: null, address_text: null, created_at: null },
    ], pendingItems: [], planningSnapshotAvailable: false, reportLocalDate: "2026-10-19" });
    assert.match(result, /Cliente: visita concluída/);
    assert.match(result, /Cliente sem nome cadastrado: compromisso cancelado/);
    assert.match(result, /Cliente sem nome cadastrado: compromisso reagendado/);
    assert.doesNotMatch(result, /snapshot|UUID|resultado operacional/);
  },
  () => {
    const current = Array.from({ length: 6 }, (_, index) => ({
      id: `appointment-${index}`,
      title: null,
      appointment_type: "visit",
      status: index === 0 || index === 1 ? "completed" : index === 2 ? "open" : index === 3 ? "cancelled" : "open",
      scheduled_start: index === 2 ? "2026-10-19T16:00:00Z" : `2026-10-19T${String(10 + index).padStart(2, "0")}:00:00Z`,
      scheduled_end: null,
      customer_name: null,
      customer_phone: null,
      address_text: null,
      created_at: index === 5 ? "2026-10-19T15:00:00Z" : "2026-10-18T12:00:00Z",
    }));
    const comparison = compareMorningSnapshot({
      version: 1,
      local_date: "2026-10-19",
      appointments: current.slice(0, 5).map((appointment, index) => ({ id: appointment.id, scheduled_start: index === 2 ? "2026-10-19T12:00:00Z" : appointment.scheduled_start, status: "open" })),
      pending_items: [],
    }, { appointmentCount: 6, openAppointmentCount: 3, completedAppointmentCount: 2, cancelledAppointmentCount: 1, overdueAppointmentCount: 0, pendingNotificationCount: 0, pendingTaskCount: 0, appointments: current, pendingItems: [], planningSnapshotAvailable: true, reportLocalDate: "2026-10-19" });
    assert.equal(comparison.planned.length, 5);
    assert.match(comparison.planned[0]?.outcome || "", /concluido/);
    assert.match(comparison.planned[2]?.outcome || "", /remarcado/);
    assert.match(comparison.planned[3]?.outcome || "", /cancelado/);
    assert.match(comparison.planned[4]?.outcome || "", /situacao atual/);
    assert.deepEqual(comparison.newAppointments, ["appointment-5"]);
    const missing = compareMorningSnapshot({ version: 1, local_date: "2026-10-19", appointments: [{ id: "missing", scheduled_start: null, status: "open" }], pending_items: [] }, { appointmentCount: 0, openAppointmentCount: 0, completedAppointmentCount: 0, cancelledAppointmentCount: 0, overdueAppointmentCount: 0, pendingNotificationCount: 0, pendingTaskCount: 0, appointments: [], pendingItems: [], planningSnapshotAvailable: true, reportLocalDate: "2026-10-19" });
    assert.match(missing.planned[0]?.outcome || "", /nao localizado/);
  },
];

for (const test of tests) test();

const acceptanceAppointments = Array.from({ length: 10 }, (_, index) => ({
  id: `visit-${index}`,
  title: null,
  appointment_type: "technical_visit",
  status: index === 0 ? "completed" : index === 1 ? "rescheduled" : index === 2 ? "cancelled" : "open",
  scheduled_start: `2026-10-19T${String(8 + index).padStart(2, "0")}:00:00Z`,
  scheduled_end: null,
  customer_name: null,
  customer_phone: null,
  address_text: null,
  created_at: null,
  lead_name: `Lead ${index}`,
  completion_evidence: index === 0,
}));
const acceptancePending = [
  { id: "visit-pending", title: "visita", body: null, related_appointment_id: "visit-3", related_lead_id: null, created_at: null, kind: "task" as const, lead_name: "Lead 3", category: "visit" as const },
  { id: "quote-1", title: "titulo interno de teste", body: null, related_appointment_id: null, related_lead_id: null, created_at: null, kind: "task" as const, lead_name: "Maria", category: "quote" as const },
  { id: "contract-1", title: "Contrato aguardando revisão", body: null, related_appointment_id: null, related_lead_id: null, created_at: null, kind: "notification" as const, lead_name: "João", category: "contract", context: { reason: "pending_review", related_contract_id: "11111111-1111-4111-8111-111111111111" } },
  { id: "contract-duplicate", title: "Outra origem técnica", body: null, related_appointment_id: null, related_lead_id: null, created_at: null, kind: "task" as const, lead_name: "João", category: "contract", context: { reason: "pending_review", related_contract_id: "11111111-1111-4111-8111-111111111111" } },
  { id: "quote-2", title: "outro orçamento", body: null, related_appointment_id: null, related_lead_id: null, created_at: null, kind: "notification" as const, lead_name: "Maria", category: "quote" as const },
  { id: "technical-1", title: "ai_run_queue UUID 22222222-2222-4222-8222-222222222222", body: null, related_appointment_id: null, related_lead_id: null, created_at: null, kind: "notification" as const, notification_type: "important_alert", lead_name: "João", priority: "high", context: { reason: "sales_ai_failed_final", failure_source: "inbox" } },
  { id: "same-name", title: "retorno", body: null, related_appointment_id: null, related_lead_id: null, created_at: null, kind: "task" as const, lead_name: "Maria", category: "other" as const },
];
acceptancePending.push({ id: "contract-distinct", title: "Segundo contrato", body: null, related_appointment_id: null, related_lead_id: null, created_at: null, kind: "task", lead_name: "Joao", category: "contract", context: { reason: "pending_review", related_contract_id: "33333333-3333-4333-8333-333333333333", activity_label: "Contrato de manutencao" } });
const acceptanceMorning = buildAutomaticMorningReport({ appointmentCount: 10, openAppointmentCount: 7, completedAppointmentCount: 1, cancelledAppointmentCount: 1, overdueAppointmentCount: 0, pendingNotificationCount: 0, pendingTaskCount: acceptancePending.length, appointments: acceptanceAppointments, pendingItems: acceptancePending, reportTimezone: "America/Sao_Paulo" });
assert.match(acceptanceMorning, /Compromissos de hoje — 10/);
assert.equal(acceptanceMorning.split("\n").filter((line) => line.includes(": visita tecnica.")).length, 10);
assert.match(acceptanceMorning, /Orcamentos pendentes \(2\)/);
assert.equal(acceptanceMorning.split("\\n").filter((line) => line.includes(": contrato aguardando conferencia.")).length, 1);
assert.match(acceptanceMorning, /Jo.{0,3}o: contrato aguardando conferencia/);
assert.doesNotMatch(acceptanceMorning, /Contratos pendentes/);
assert.doesNotMatch(acceptanceMorning, /atendimento precisa de verificacao|falha definitiva/);
assert.doesNotMatch(acceptanceMorning, /ai_run_queue|22222222-2222/);
assert.match(buildAutomaticMorningReport({ appointmentCount: 0, openAppointmentCount: 0, completedAppointmentCount: 0, cancelledAppointmentCount: 0, overdueAppointmentCount: 0, pendingNotificationCount: 1, pendingTaskCount: 0, pendingItems: [{ id: "unnamed", title: "retorno", body: null, related_appointment_id: null, related_lead_id: null, created_at: null, kind: "notification" }] }), /Cliente sem nome cadastrado/);
const acceptanceNight = buildAutomaticEveningReport({ appointmentCount: 10, openAppointmentCount: 7, completedAppointmentCount: 1, cancelledAppointmentCount: 1, overdueAppointmentCount: 0, pendingNotificationCount: 0, pendingTaskCount: acceptancePending.length, appointments: acceptanceAppointments, pendingItems: acceptancePending, reportTimezone: "America/Sao_Paulo" });
assert.match(acceptanceNight, /Compromissos concluídos: 1/);
assert.match(acceptanceNight, /Lead 0: visita tecnica concluída/);
assert.match(acceptanceNight, /Lead 1: compromisso reagendado/);
assert.match(acceptanceNight, /Lead 2: compromisso cancelado/);
assert.doesNotMatch(acceptanceNight, /atendimento precisa de verificacao|falha definitiva/);
assert.doesNotMatch(acceptanceNight, /Lead 4: visita tecnica concluída/);

const largePending = Array.from({ length: 20 }, (_, index) => ({
  id: `large-pending-${index}`,
  title: "atividade",
  body: null,
  related_appointment_id: null,
  related_lead_id: null,
  created_at: null,
  kind: index % 2 ? "task" as const : "notification" as const,
  lead_name: index % 2 ? "Lead Beta" : "Lead Alfa",
  category: (["visit", "quote", "contract", "other"] as const)[index % 4],
  context: { activity_label: `Atividade ${index + 1}`, ...(index % 4 === 2 ? { related_contract_id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}` } : {}) },
}));
const largeData = { appointmentCount: 0, openAppointmentCount: 0, completedAppointmentCount: 0, cancelledAppointmentCount: 0, overdueAppointmentCount: 0, pendingNotificationCount: 10, pendingTaskCount: 10, pendingItems: largePending };
const largeMorning = buildAutomaticMorningReport(largeData);
const largeNight = buildAutomaticEveningReport(largeData);
for (const index of Array.from({ length: 20 }, (_, value) => value + 1)) {
  assert.match(largeMorning, new RegExp(`Atividade ${index}`));
  assert.match(largeNight, new RegExp(`Atividade ${index}`));
}
assert.match(largeMorning, /Pend[^\n]*20/);
assert.match(largeNight, /O que ficou pendente [^\n]*20/);

let nearLimitPending: Array<(typeof largePending)[number]> = [];
let nearLimitMorning = "";
for (let index = 0; index < 100 && nearLimitMorning.length < AUTOMATIC_REPORT_SAFE_TEXT_LIMIT - 250; index += 1) {
  nearLimitPending = [...nearLimitPending, {
    id: `near-limit-${index}`,
    title: "atividade",
    body: null,
    related_appointment_id: null,
    related_lead_id: null,
    created_at: null,
    kind: "task" as const,
    lead_name: "Near limit lead",
    category: "other" as const,
    context: { activity_label: `Atividade proxima do limite ${index} ${"x".repeat(35)}` },
  }];
  nearLimitMorning = buildAutomaticMorningReport({ ...largeData, pendingItems: nearLimitPending });
  if (!nearLimitMorning.includes("Near limit lead")) break;
}
const nearLimitNight = buildAutomaticEveningReport({ ...largeData, pendingItems: nearLimitPending });
assert.ok(nearLimitMorning.length <= AUTOMATIC_REPORT_SAFE_TEXT_LIMIT);
assert.ok(nearLimitMorning.length >= AUTOMATIC_REPORT_SAFE_TEXT_LIMIT - 700);
assert.match(nearLimitMorning, /Near limit lead/);
assert.ok(nearLimitNight.length <= AUTOMATIC_REPORT_SAFE_TEXT_LIMIT);

const oversizedPending = Array.from({ length: 120 }, (_, index) => ({
  id: `oversized-pending-${index}`,
  title: "atividade",
  body: null,
  related_appointment_id: null,
  related_lead_id: null,
  created_at: null,
  kind: "task" as const,
  lead_name: `Large Lead ${index}`,
  category: (["visit", "quote", "contract", "other"] as const)[index % 4],
  context: { activity_label: `Atividade extensa ${index} ${"x".repeat(60)}` },
}));
const oversizedData = { ...largeData, pendingNotificationCount: 0, pendingTaskCount: oversizedPending.length, pendingItems: oversizedPending };
const oversizedMorning = buildAutomaticMorningReport(oversizedData);
const oversizedNight = buildAutomaticEveningReport(oversizedData);
for (const report of [oversizedMorning, oversizedNight]) {
  assert.ok(report.length <= AUTOMATIC_REPORT_SAFE_TEXT_LIMIT);
  assert.doesNotMatch(report, /Large Lead 119/);
  assert.match(report, /Atividade|Visitas:|Orcamentos:/);
  assert.match(report, /Considere priorizar|Pode ser útil revisar|Pode ser útil acompanhar/);
  assert.match(report, /💬 Quer saber mais\?/);
  assert.match(report, /dados operacionais atuais/);
  assert.doesNotMatch(report, /compromisso\(s\)|atividade\(s\)/);
}

type TestSupabase = NonNullable<Parameters<typeof processAutomaticAssistantReports>[0]["supabase"]>;

const claimId = "11111111-1111-4111-8111-111111111111";
const claimToken = "22222222-2222-4222-8222-222222222222";

function createReportSupabaseMock(options: {
  claims?: unknown[];
  appointmentError?: string;
  materializeError?: string;
  failResult?: boolean;
  holidayBlocks?: unknown[];
  morningSnapshot?: unknown;
  schedule?: Partial<typeof base>;
  schedules?: Array<Partial<typeof base>>;
  notifications?: unknown[];
  tasks?: unknown[];
  appointments?: unknown[];
  physicalPreferences?: unknown[];
  opportunities?: unknown[];
  contracts?: unknown[];
  leads?: unknown[];
  customers?: unknown[];
} = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const inCalls: Array<{ column: string; values: unknown[] }> = [];
  const claims = [...(options.claims || [{ result: "claimed", claim_id: claimId, claim_token: claimToken, attempt_count: 1 }])];
  const schedules = (options.schedules || [{ ...base, ...options.schedule }]).map((schedule) => ({ ...base, ...schedule, ai_after_hours_mode: "all_closed_hours" }));
  const responseFor = (table: string, allowedStoreIds?: unknown[], filters: Array<[string, unknown]> = []) => table === "store_schedule_settings"
    ? { data: allowedStoreIds ? schedules.filter((schedule) => allowedStoreIds.includes(schedule.store_id)) : schedules, error: null }
    : table === "store_schedule_blocks"
      ? { data: options.holidayBlocks || [], error: null }
    : table === "store_assistant_automatic_report_claims"
      ? { data: options.morningSnapshot ? [{ message_id: "morning-message", status: "completed" }] : [], error: null }
      : table === "store_assistant_messages"
        ? { data: options.morningSnapshot ? [{ metadata: { automatic_report_snapshot: options.morningSnapshot } }] : [], error: null }
        : table === "store_appointments"
      ? { data: options.appointmentError ? null : (options.appointments || [{ status: "open", scheduled_end: "2026-10-19T12:00:00Z" }]), error: options.appointmentError ? { message: options.appointmentError } : null }
      : table === "store_assistant_notification_queue"
        ? { data: options.notifications || [], error: null }
        : table === "store_assistant_operational_tasks"
          ? { data: options.tasks || [], error: null }
      : table === "p9_physical_contract_signature_preferences"
        ? { data: (options.physicalPreferences || []).filter((row) => filters.filter(([column]) => column === "planned_date").every(([column, value]) => (row as Record<string, unknown>)[column] === value)), error: null }
      : table === "commercial_opportunities"
        ? { data: options.opportunities || [], error: null }
      : table === "sales_contracts"
        ? { data: options.contracts || [], error: null }
      : table === "leads"
        ? { data: options.leads || [], error: null }
      : table === "customers"
        ? { data: options.customers || [], error: null }
      : { data: [], error: null };
  const supabase = {
    from(table: string) {
      let allowedStoreIds: unknown[] | undefined;
      const filters: Array<[string, unknown]> = [];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          if (table === "p9_physical_contract_signature_preferences") filters.push([column, value]);
          return query;
        },
        gte: () => query,
        lte: () => query,
        gt: () => query,
        lt: () => query,
        in: (column: string, values: unknown[]) => {
          inCalls.push({ column, values });
          if (table === "store_schedule_settings" && column === "store_id") allowedStoreIds = values;
          return query;
        },
        then: (onfulfilled?: (value: ReturnType<typeof responseFor>) => unknown, onrejected?: (reason: unknown) => unknown) => Promise.resolve(responseFor(table, allowedStoreIds, filters)).then(onfulfilled, onrejected),
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "assistant_claim_automatic_report") return { data: claims.shift() || { result: "already_claimed", claim_id: claimId }, error: null };
      if (name === "assistant_materialize_automatic_report") {
        if (options.materializeError) return { data: null, error: { message: options.materializeError } };
        return { data: { result: "completed", claim_id: claimId, message_id: "33333333-3333-4333-8333-333333333333", notification_id: "44444444-4444-4444-8444-444444444444" }, error: null };
      }
      if (name === "assistant_fail_automatic_report") return { data: options.failResult !== false, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
  } as unknown as TestSupabase;
  return { supabase, calls, inCalls };
}

const reportNow = new Date("2026-10-19T11:00:00Z");

async function runIntegrationTests() {
  const generated = createReportSupabaseMock();
  const generatedResult = await processAutomaticAssistantReports({ now: reportNow, supabase: generated.supabase });
  assert.equal(generatedResult.results[0]?.status, "generated");
  assert.deepEqual(generated.calls.map((call) => call.name), ["assistant_claim_automatic_report", "assistant_materialize_automatic_report"]);
  assert.equal(generated.calls[0]?.args.p_report_type, "morning_report");
  assert.equal(generated.calls[1]?.args.p_report_type, "morning_report");
  assert.equal((generated.calls[1]?.args.p_metadata as Record<string, unknown>).report_key, "assistant-automatic-report:org-1:11111111-1111-4111-8111-111111111112:2026-10-19:morning_report");
  const generatedSnapshot = (generated.calls[1]?.args.p_metadata as Record<string, unknown>).automatic_report_snapshot as Record<string, unknown>;
  assert.equal(generatedSnapshot.version, 1);
  assert.equal(generatedSnapshot.local_date, "2026-10-19");
  assert.ok(Array.isArray(generatedSnapshot.appointments));
  assert.ok(Array.isArray(generatedSnapshot.pending_items));

  const physicalContract = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const physicalVersion = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const physicalOpportunity = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const physicalAppointment = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const physical = createReportSupabaseMock({
    appointments: [{ id: physicalAppointment, status: "open", appointment_type: "installation", scheduled_start: "2026-10-19T13:00:00Z", scheduled_end: "2026-10-19T14:00:00Z", customer_name: null, commercial_opportunity_id: physicalOpportunity }],
    physicalPreferences: [{ id: "physical-preference-1", commercial_opportunity_id: physicalOpportunity, sales_contract_id: physicalContract, sales_contract_version_id: physicalVersion, planned_date: "2026-10-19", planned_time: "10:00", status: "pending" }],
    opportunities: [{ id: physicalOpportunity, origin_lead_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", customer_id: null }],
    leads: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: "Regina" }],
    contracts: [{ id: physicalContract, commercial_opportunity_id: physicalOpportunity }],
    notifications: [{ id: "physical-queue-1", title: "Assinatura fisica pendente", context: { reason: "physical_contract_signature_pending", related_contract_id: physicalContract, document_version_id: physicalVersion } }],
  });
  const physicalResult = await processAutomaticAssistantReports({ now: reportNow, supabase: physical.supabase });
  const physicalBody = String(physical.calls.find((call) => call.name === "assistant_materialize_automatic_report")?.args.p_content || "");
  assert.equal(physicalResult.results[0]?.status, "generated");
  assert.match(physicalBody, /Regina/);
  assert.match(physicalBody, /10:00/);
  assert.equal((physicalBody.match(/Levar o contrato/g) || []).length, 1);
  assert.deepEqual(physical.calls.map((call) => call.name), ["assistant_claim_automatic_report", "assistant_materialize_automatic_report"]);

  const physicalNotToday = createReportSupabaseMock({
    physicalPreferences: [{ id: "physical-preference-other-day", sales_contract_id: physicalContract, sales_contract_version_id: physicalVersion, planned_date: "2026-10-20", status: "pending" }],
    notifications: [{ id: "physical-old-date", title: "Assinatura fisica pendente", context: { reason: "physical_contract_signature_pending", related_contract_id: physicalContract, document_version_id: physicalVersion } }],
  });
  const physicalNotTodayResult = await processAutomaticAssistantReports({ now: reportNow, supabase: physicalNotToday.supabase });
  const physicalNotTodayBody = String(physicalNotToday.calls.find((call) => call.name === "assistant_materialize_automatic_report")?.args.p_content || "");
  assert.equal(physicalNotTodayResult.results[0]?.status, "generated");
  assert.doesNotMatch(physicalNotTodayBody, /contrato fisico/);

  const physicalNoTime = createReportSupabaseMock({
    appointments: [{ id: physicalAppointment, status: "open", appointment_type: "installation", scheduled_start: null, scheduled_end: null, customer_name: "Cliente sem horario", commercial_opportunity_id: physicalOpportunity }],
    physicalPreferences: [{ id: "physical-preference-no-time", commercial_opportunity_id: physicalOpportunity, sales_contract_id: physicalContract, sales_contract_version_id: physicalVersion, planned_date: "2026-10-19", planned_time: null, status: "pending" }],
  });
  const physicalNoTimeResult = await processAutomaticAssistantReports({ now: reportNow, supabase: physicalNoTime.supabase });
  const physicalNoTimeBody = String(physicalNoTime.calls.find((call) => call.name === "assistant_materialize_automatic_report")?.args.p_content || "");
  assert.equal(physicalNoTimeResult.results[0]?.status, "generated");
  assert.match(physicalNoTimeBody, /Cliente sem horario/);
  assert.match(physicalNoTimeBody, /horario nao informado/);
  assert.doesNotMatch(physicalNoTimeBody, /10:00/);

  for (const status of ["confirmed", "cancelled"] as const) {
    const closedPhysical = createReportSupabaseMock({
      physicalPreferences: [{ id: `physical-${status}`, sales_contract_id: physicalContract, sales_contract_version_id: physicalVersion, planned_date: "2026-10-19", status }],
      notifications: [{ id: `physical-${status}-queue`, title: "Assinatura fisica pendente", context: { reason: "physical_contract_signature_pending", related_contract_id: physicalContract, document_version_id: physicalVersion } }],
    });
    await processAutomaticAssistantReports({ now: reportNow, supabase: closedPhysical.supabase });
    const closedBody = String(closedPhysical.calls.find((call) => call.name === "assistant_materialize_automatic_report")?.args.p_content || "");
    assert.doesNotMatch(closedBody, /contrato fisico/);
  }

  const rescheduled = createReportSupabaseMock({
    physicalPreferences: [{ id: "physical-rescheduled", sales_contract_id: physicalContract, sales_contract_version_id: physicalVersion, planned_date: "2026-10-21", status: "pending" }],
    notifications: [{ id: "physical-rescheduled-old", title: "Assinatura fisica pendente", context: { reason: "physical_contract_signature_pending", related_contract_id: physicalContract, document_version_id: physicalVersion } }],
  });
  await processAutomaticAssistantReports({ now: reportNow, supabase: rescheduled.supabase });
  const rescheduledBody = String(rescheduled.calls.find((call) => call.name === "assistant_materialize_automatic_report")?.args.p_content || "");
  assert.doesNotMatch(rescheduledBody, /contrato fisico/);

  const twoPhysical = createReportSupabaseMock({
    physicalPreferences: [
      { id: "physical-two-1", sales_contract_id: physicalContract, planned_date: "2026-10-19", status: "pending" },
      { id: "physical-two-2", sales_contract_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", planned_date: "2026-10-19", status: "pending" },
    ],
    opportunities: [{ id: physicalOpportunity, origin_lead_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", customer_id: null }],
    leads: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: "Regina" }],
    contracts: [{ id: physicalContract, commercial_opportunity_id: physicalOpportunity }, { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", commercial_opportunity_id: "99999999-9999-4999-8999-999999999999" }],
  });
  await processAutomaticAssistantReports({ now: reportNow, supabase: twoPhysical.supabase });
  const twoPhysicalBody = String(twoPhysical.calls.find((call) => call.name === "assistant_materialize_automatic_report")?.args.p_content || "");
  assert.equal((twoPhysicalBody.match(/contrato fisico/g) || []).length, 2);

  const compactPhysical = buildAutomaticMorningReport({ appointmentCount: 0, openAppointmentCount: 0, completedAppointmentCount: 0, cancelledAppointmentCount: 0, overdueAppointmentCount: 0, pendingNotificationCount: 101, pendingTaskCount: 0, pendingItems: [
    ...Array.from({ length: 100 }, (_, index) => ({ id: `compact-${index}`, title: "atividade", body: null, related_appointment_id: null, created_at: null, kind: "notification" as const, lead_name: `Cliente ${index}`, category: "other" as const, context: { activity_label: `Atividade compacta ${index} ${"x".repeat(30)}` } })),
    { id: "compact-physical", title: "Assinatura fisica", body: null, related_appointment_id: null, created_at: null, kind: "notification" as const, lead_name: "Regina", category: "contract" as const, context: { reason: "physical_contract_signature_pending", related_contract_id: physicalContract } },
  ] });
  assert.match(compactPhysical, /contrato .* pendente/);

  const pendingNoise = createReportSupabaseMock({
    notifications: [
      { id: "report-queue", notification_type: "morning_report", title: "Relatorio da manha", context: { report_source: "assistant_automatic_reports" } },
      { id: "failure-1", notification_type: "important_alert", title: "Falha definitiva no processamento da IA Vendedora", context: { source: "assistant_enqueue_internal_notification", reason: "sales_ai_failed_final", failure_source: "inbox", needs_human_action: true, event_key: "failure:1" } },
      { id: "failure-1-replay", notification_type: "important_alert", title: "Falha definitiva no processamento da IA Vendedora", context: { source: "assistant_enqueue_internal_notification", reason: "sales_ai_failed_final", failure_source: "inbox", needs_human_action: true, event_key: "failure:1" } },
      { id: "failure-worker-with-identifiers", notification_type: "important_alert", title: "Falha definitiva no processamento da IA Vendedora", related_lead_id: "lead-1", context: { source: "sales_ai_worker", reason: "sales_ai_failed_final", failure_source: "ai_run_queue", failure_record_id: "queue-1", conversation_id: "conversation-1", needs_human_action: true, event_key: "failure:worker-with-identifiers" } },
      { id: "contract-review-old", notification_type: "important_alert", priority: "normal", title: "Contrato CTR-1 aguardando revisao", context: { reason: "pending_review", related_contract_id: "contract-1", document_version_id: "version-1", document_status: "pending_review", event_key: "contract-event-old" }, created_at: "2026-10-19T09:00:00Z" },
      { id: "contract-review-new", notification_type: "important_alert", priority: "high", title: "Contrato CTR-1 exige conferencia", context: { reason: "pending_review", related_contract_id: "contract-1", document_version_id: "version-1", document_status: "pending_review", event_key: "contract-event-new" }, created_at: "2026-10-19T10:00:00Z" },
      { id: "common-action", notification_type: "important_alert", priority: "normal", title: "Tarefa comum", context: { reason: "other_action", event_key: "common-action" }, created_at: "2026-10-19T11:00:00Z" },
    ],
    tasks: [{ id: "task-1", task_type: "contract_review", title: "Contrato aguardando revisao", description: null }],
  });
  const pendingNoiseResult = await processAutomaticAssistantReports({ now: reportNow, supabase: pendingNoise.supabase });
  const pendingNoiseBody = String(pendingNoise.calls.find((call) => call.name === "assistant_materialize_automatic_report")?.args.p_content || "");
  assert.equal(pendingNoiseResult.results[0]?.status, "generated");
  assert.doesNotMatch(pendingNoiseBody, /Relatorio da manha/);
  assert.doesNotMatch(pendingNoiseBody, /atendimento precisa de verificacao|Falha definitiva|ai_run_queue|failure_source/);
  const pendingNoiseSnapshot = pendingNoise.calls.find((call) => call.name === "assistant_materialize_automatic_report")?.args.p_metadata as Record<string, unknown>;
  const pendingNoiseSnapshotItems = ((pendingNoiseSnapshot.automatic_report_snapshot as Record<string, unknown>)?.pending_items || []) as Array<Record<string, unknown>>;
  assert.equal(pendingNoiseSnapshotItems.some((item) => ["failure-1", "failure-1-replay", "failure-worker-with-identifiers"].includes(String(item.id))), false);
  assert.doesNotMatch(pendingNoiseBody, /failure:1|failure:worker-with-identifiers/);
  assert.match(pendingNoiseBody, /Cliente sem nome cadastrado/);

  const eveningSnapshot = {
    version: 1,
    local_date: "2026-10-19",
    appointments: [{ id: "appointment-1", scheduled_start: "2026-10-19T11:00:00Z", status: "open" }],
    pending_items: [],
  };
  const evening = createReportSupabaseMock({ morningSnapshot: eveningSnapshot });
  const eveningResult = await processAutomaticAssistantReports({ now: new Date("2026-10-19T20:50:00Z"), supabase: evening.supabase });
  assert.equal(eveningResult.results[0]?.type, "evening_report");
  const eveningMaterialization = evening.calls.find((call) => call.name === "assistant_materialize_automatic_report");
  assert.match(String(eveningMaterialization?.args.p_content), /Mudanças comparadas com o planejamento da manhã/);

  const sunday = createReportSupabaseMock();
  const sundayResult = await processAutomaticAssistantReports({ now: new Date("2026-10-18T11:00:00Z"), supabase: sunday.supabase });
  assert.equal(sundayResult.results[0]?.status, "generated");

  const sundayDisabled = createReportSupabaseMock({ schedule: { ai_after_hours_enabled: false } });
  const sundayDisabledResult = await processAutomaticAssistantReports({ now: new Date("2026-10-18T11:00:00Z"), supabase: sundayDisabled.supabase });
  assert.equal(sundayDisabledResult.results.length, 0);

  const holiday = createReportSupabaseMock({
    holidayBlocks: [{ block_type: "holiday", start_at: "2026-10-18T03:00:00Z", end_at: "2026-10-19T03:00:00Z" }],
  });
  const holidayResult = await processAutomaticAssistantReports({ now: new Date("2026-10-18T11:00:00Z"), supabase: holiday.supabase });
  assert.equal(holidayResult.results[0]?.status, "generated");

  const holidayDisabled = createReportSupabaseMock({
    schedule: { ai_attends_holidays: false },
    holidayBlocks: [{ block_type: "holiday", start_at: "2026-10-18T03:00:00Z", end_at: "2026-10-19T03:00:00Z" }],
  });
  const holidayDisabledResult = await processAutomaticAssistantReports({ now: new Date("2026-10-18T11:00:00Z"), supabase: holidayDisabled.supabase });
  assert.equal(holidayDisabledResult.results.length, 0);

  for (const result of ["already_claimed", "retry_later", "completed"] as const) {
    const skipped = createReportSupabaseMock({ claims: [{ result, claim_id: claimId }] });
    const skippedResult = await processAutomaticAssistantReports({ now: reportNow, supabase: skipped.supabase });
    assert.equal(skippedResult.results[0]?.status, result);
    assert.deepEqual(skipped.calls.map((call) => call.name), ["assistant_claim_automatic_report"]);
  }

  const recovered = createReportSupabaseMock({ claims: [{ result: "claimed", claim_id: claimId, claim_token: claimToken, attempt_count: 2 }], materializeError: "synthetic materialization failure" });
  await assert.rejects(() => processAutomaticAssistantReports({ now: reportNow, supabase: recovered.supabase }), /AUTOMATIC_REPORT_MATERIALIZATION_FAILED/);
  assert.deepEqual(recovered.calls.map((call) => call.name), ["assistant_claim_automatic_report", "assistant_materialize_automatic_report", "assistant_fail_automatic_report"]);
  assert.equal(recovered.calls[2]?.args.p_claim_token, claimToken);

  const generationFailure = createReportSupabaseMock({ appointmentError: "synthetic load failure" });
  await assert.rejects(() => processAutomaticAssistantReports({ now: reportNow, supabase: generationFailure.supabase }), /AUTOMATIC_REPORT_GENERATION_FAILED/);
  assert.deepEqual(generationFailure.calls.map((call) => call.name), ["assistant_claim_automatic_report", "assistant_fail_automatic_report"]);

  const oldToken = createReportSupabaseMock({ materializeError: "REPORT_CLAIM_INVALID_OR_EXPIRED", failResult: false });
  await assert.rejects(() => processAutomaticAssistantReports({ now: reportNow, supabase: oldToken.supabase }), /AUTOMATIC_REPORT_CLAIM_FAILURE_NOT_RECORDED/);
  assert.equal(oldToken.calls[1]?.args.p_claim_token, claimToken);

  const concurrent = createReportSupabaseMock({ claims: [
    { result: "claimed", claim_id: claimId, claim_token: claimToken, attempt_count: 1 },
    { result: "already_claimed", claim_id: claimId },
  ] });
  await Promise.all([
    processAutomaticAssistantReports({ now: reportNow, supabase: concurrent.supabase }),
    processAutomaticAssistantReports({ now: reportNow, supabase: concurrent.supabase }),
  ]);
  assert.equal(concurrent.calls.filter((call) => call.name === "assistant_materialize_automatic_report").length, 1);
  assert.equal(concurrent.calls.some((call) => call.name === "assistant_push_system_message"), false);
  assert.equal(concurrent.calls.some((call) => call.name === "assistant_enqueue_internal_notification"), false);
}

const previousEnabledFlag = process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED;
const previousAllowedStoreIds = process.env.ASSISTANT_AUTOMATIC_REPORTS_ALLOWED_STORE_IDS;
try {
  for (const value of [undefined, "false", "TRUE", "1"]) {
    if (value === undefined) delete process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED;
    else process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED = value;
    const disabledResult = await processAutomaticAssistantReports({ now: reportNow });
    assert.deepEqual(disabledResult, {
      ok: true,
      enabled: false,
      processed: 0,
      results: [],
    });
  }

  process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED = "true";
  delete process.env.ASSISTANT_AUTOMATIC_REPORTS_ALLOWED_STORE_IDS;
  const missingAllowlist = createReportSupabaseMock();
  assert.deepEqual(await processAutomaticAssistantReports({ now: reportNow, supabase: missingAllowlist.supabase }), {
    ok: true, enabled: true, processed: 0, results: [],
  });
  assert.equal(missingAllowlist.inCalls.length, 0);

  process.env.ASSISTANT_AUTOMATIC_REPORTS_ALLOWED_STORE_IDS = "  ";
  const emptyAllowlist = createReportSupabaseMock();
  assert.deepEqual(await processAutomaticAssistantReports({ now: reportNow, supabase: emptyAllowlist.supabase }), {
    ok: true, enabled: true, processed: 0, results: [],
  });
  assert.equal(emptyAllowlist.inCalls.length, 0);

  process.env.ASSISTANT_AUTOMATIC_REPORTS_ALLOWED_STORE_IDS = `${base.store_id},not-a-uuid`;
  const invalidAllowlist = createReportSupabaseMock();
  assert.deepEqual(await processAutomaticAssistantReports({ now: reportNow, supabase: invalidAllowlist.supabase }), {
    ok: true, enabled: true, processed: 0, results: [],
  });
  assert.equal(invalidAllowlist.inCalls.length, 0);

  process.env.ASSISTANT_AUTOMATIC_REPORTS_ALLOWED_STORE_IDS = base.store_id;
  await runIntegrationTests();

  const nonAllowed = createReportSupabaseMock({ schedule: { store_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } });
  assert.equal((await processAutomaticAssistantReports({ now: reportNow, supabase: nonAllowed.supabase })).processed, 0);
  assert.equal(nonAllowed.calls.length, 0);

  const selectedBeforeLimit = createReportSupabaseMock({ schedules: [
    ...Array.from({ length: 100 }, (_, index) => ({ store_id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}` })),
    { store_id: base.store_id },
  ] });
  const selectedBeforeLimitResult = await processAutomaticAssistantReports({ now: reportNow, supabase: selectedBeforeLimit.supabase });
  assert.equal(selectedBeforeLimitResult.processed, 1);
  assert.deepEqual(selectedBeforeLimit.inCalls[0], { column: "store_id", values: [base.store_id] });
  console.log(`automatic-reports: ${tests.length + 16}/${tests.length + 16} PASS`);
} finally {
  if (previousEnabledFlag === undefined) {
    delete process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED;
  } else {
    process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED = previousEnabledFlag;
  }
  if (previousAllowedStoreIds === undefined) {
    delete process.env.ASSISTANT_AUTOMATIC_REPORTS_ALLOWED_STORE_IDS;
  } else {
    process.env.ASSISTANT_AUTOMATIC_REPORTS_ALLOWED_STORE_IDS = previousAllowedStoreIds;
  }
}

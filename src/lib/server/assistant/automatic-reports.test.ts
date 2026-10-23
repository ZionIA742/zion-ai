import assert from "node:assert/strict";
import { buildAutomaticEveningReport, buildAutomaticMorningReport, compareMorningSnapshot, processAutomaticAssistantReports, resolveAutomaticReportDue } from "./automatic-reports";

const base = {
  organization_id: "org-1", store_id: "11111111-1111-4111-8111-111111111112", timezone_name: "America/Sao_Paulo",
  operating_days: ["segunda", "terca", "quarta", "quinta", "sexta"],
  operating_hours: { segunda: { start: "08:00", end: "18:00" }, terca: { start: "08:00", end: "18:00" }, quarta: { start: "08:00", end: "18:00" }, quinta: { start: "08:00", end: "18:00" }, sexta: { start: "08:00", end: "18:00" } },
  ai_after_hours_enabled: true, ai_after_hours_mode: "all_closed_hours", ai_after_hours_configured_at: "2026-10-01T00:00:00Z", ai_attends_holidays: true, holiday_mode: "closed",
};

const tests = [
  () => { const result = resolveAutomaticReportDue({ settings: base, now: new Date("2026-10-19T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["due", "not_due"]); },
  () => { const result = resolveAutomaticReportDue({ settings: base, now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["due", "not_due"]); },
  () => { const settings = { ...base, ai_after_hours_enabled: false }; const result = resolveAutomaticReportDue({ settings, now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["not_authorized", "not_authorized"]); },
  () => { const result = resolveAutomaticReportDue({ settings: base, now: new Date("2026-10-19T20:50:00Z") }); assert.deepEqual(result.map((item) => item.targetIso), ["2026-10-19T11:00:00.000Z", "2026-10-19T20:50:00.000Z"]); },
  () => { const result = resolveAutomaticReportDue({ settings: base, holidayBlocks: [{ block_type: "holiday", start_at: "2026-10-18T03:00:00Z", end_at: "2026-10-19T03:00:00Z" }], now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["due", "not_due"]); },
  () => { const settings = { ...base, ai_attends_holidays: false }; const result = resolveAutomaticReportDue({ settings, holidayBlocks: [{ block_type: "holiday", start_at: "2026-10-18T03:00:00Z", end_at: "2026-10-19T03:00:00Z" }], now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["not_authorized", "not_authorized"]); },
  () => { const settings = { ...base, ai_after_hours_mode: "specific_window", ai_after_hours_start: "09:00", ai_after_hours_end: "19:00" }; const result = resolveAutomaticReportDue({ settings, now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["not_authorized", "not_due"]); },
  () => { const settings = { ...base, operating_days: ["segunda", "terca"], operating_hours: { segunda: { start: "08:00", end: "18:00" }, terca: { start: "09:00", end: "17:00" } } }; const result = resolveAutomaticReportDue({ settings, now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["ambiguous_hours", "ambiguous_hours"]); },
  () => { const result = buildAutomaticMorningReport({ appointmentCount: 0, openAppointmentCount: 0, completedAppointmentCount: 0, cancelledAppointmentCount: 0, overdueAppointmentCount: 0, pendingNotificationCount: 0, pendingTaskCount: 0 }); assert.match(result, /não há compromissos/); },
  () => { const result = buildAutomaticEveningReport({ appointmentCount: 2, openAppointmentCount: 1, completedAppointmentCount: 1, cancelledAppointmentCount: 0, overdueAppointmentCount: 0, pendingNotificationCount: 1, pendingTaskCount: 2 }); assert.match(result, /concluídos: 1/); },
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
    assert.match(result, /contato:/);
    assert.match(result, /local:/);
    assert.match(result, /pendencia anterior/);
  },
  () => {
    const result = buildAutomaticEveningReport({ appointmentCount: 3, openAppointmentCount: 1, completedAppointmentCount: 1, cancelledAppointmentCount: 1, overdueAppointmentCount: 0, pendingNotificationCount: 0, pendingTaskCount: 1, appointments: [
      { id: "done", title: null, appointment_type: "visit", status: "completed", scheduled_start: "2026-10-19T12:00:00Z", scheduled_end: null, customer_name: "Cliente", customer_phone: null, address_text: null, created_at: null },
      { id: "cancelled", title: null, appointment_type: "visit", status: "cancelled", scheduled_start: "2026-10-19T13:00:00Z", scheduled_end: null, customer_name: null, customer_phone: null, address_text: null, created_at: null },
      { id: "open", title: null, appointment_type: "visit", status: "rescheduled", scheduled_start: "2026-10-19T14:00:00Z", scheduled_end: null, customer_name: null, customer_phone: null, address_text: null, created_at: null },
    ], pendingItems: [], planningSnapshotAvailable: false, reportLocalDate: "2026-10-19" });
    assert.match(result, /resultado operacional não inferido/);
    assert.match(result, /cancelado no cadastro/);
    assert.match(result, /remarcado no cadastro/);
    assert.match(result, /snapshot historico nao persistido/);
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
} = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const inCalls: Array<{ column: string; values: unknown[] }> = [];
  const claims = [...(options.claims || [{ result: "claimed", claim_id: claimId, claim_token: claimToken, attempt_count: 1 }])];
  const schedules = (options.schedules || [{ ...base, ...options.schedule }]).map((schedule) => ({ ...base, ...schedule, ai_after_hours_mode: "all_closed_hours" }));
  const responseFor = (table: string, allowedStoreIds?: unknown[]) => table === "store_schedule_settings"
    ? { data: allowedStoreIds ? schedules.filter((schedule) => allowedStoreIds.includes(schedule.store_id)) : schedules, error: null }
    : table === "store_schedule_blocks"
      ? { data: options.holidayBlocks || [], error: null }
    : table === "store_assistant_automatic_report_claims"
      ? { data: options.morningSnapshot ? [{ message_id: "morning-message", status: "completed" }] : [], error: null }
      : table === "store_assistant_messages"
        ? { data: options.morningSnapshot ? [{ metadata: { automatic_report_snapshot: options.morningSnapshot } }] : [], error: null }
        : table === "store_appointments"
      ? { data: options.appointmentError ? null : [{ status: "open", scheduled_end: "2026-10-19T12:00:00Z" }], error: options.appointmentError ? { message: options.appointmentError } : null }
      : { data: [], error: null };
  const supabase = {
    from(table: string) {
      let allowedStoreIds: unknown[] | undefined;
      const query = {
        select: () => query,
        eq: () => query,
        gte: () => query,
        lte: () => query,
        gt: () => query,
        lt: () => query,
        in: (column: string, values: unknown[]) => {
          inCalls.push({ column, values });
          if (table === "store_schedule_settings" && column === "store_id") allowedStoreIds = values;
          return query;
        },
        then: (onfulfilled?: (value: ReturnType<typeof responseFor>) => unknown, onrejected?: (reason: unknown) => unknown) => Promise.resolve(responseFor(table, allowedStoreIds)).then(onfulfilled, onrejected),
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
  assert.match(String(eveningMaterialization?.args.p_content), /Comparacao por ID canonico/);

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

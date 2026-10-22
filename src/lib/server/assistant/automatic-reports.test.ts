import assert from "node:assert/strict";
import { buildAutomaticEveningReport, buildAutomaticMorningReport, processAutomaticAssistantReports, resolveAutomaticReportDue } from "./automatic-reports";

const base = {
  organization_id: "org-1", store_id: "store-1", timezone_name: "America/Sao_Paulo",
  operating_days: ["segunda", "terca", "quarta", "quinta", "sexta"],
  operating_hours: { segunda: { start: "08:00", end: "18:00" }, terca: { start: "08:00", end: "18:00" }, quarta: { start: "08:00", end: "18:00" }, quinta: { start: "08:00", end: "18:00" }, sexta: { start: "08:00", end: "18:00" } },
  ai_after_hours_enabled: true, ai_after_hours_mode: "all_closed_hours", ai_after_hours_configured_at: "2026-10-01T00:00:00Z", ai_attends_holidays: true, holiday_mode: "closed",
};

const tests = [
  () => { const result = resolveAutomaticReportDue({ settings: base, now: new Date("2026-10-19T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["due", "not_due"]); },
  () => { const result = resolveAutomaticReportDue({ settings: base, now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["due", "not_due"]); },
  () => { const settings = { ...base, ai_after_hours_enabled: false }; const result = resolveAutomaticReportDue({ settings, now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["not_authorized", "not_authorized"]); },
  () => { const result = resolveAutomaticReportDue({ settings: base, now: new Date("2026-10-19T20:00:00Z") }); assert.deepEqual(result.map((item) => item.targetIso), ["2026-10-19T11:00:00.000Z", "2026-10-19T20:00:00.000Z"]); },
  () => { const result = resolveAutomaticReportDue({ settings: base, holidayBlocks: [{ block_type: "holiday", start_at: "2026-10-18T03:00:00Z", end_at: "2026-10-19T03:00:00Z" }], now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["due", "not_due"]); },
  () => { const settings = { ...base, ai_attends_holidays: false }; const result = resolveAutomaticReportDue({ settings, holidayBlocks: [{ block_type: "holiday", start_at: "2026-10-18T03:00:00Z", end_at: "2026-10-19T03:00:00Z" }], now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["not_authorized", "not_authorized"]); },
  () => { const settings = { ...base, ai_after_hours_mode: "specific_window", ai_after_hours_start: "09:00", ai_after_hours_end: "19:00" }; const result = resolveAutomaticReportDue({ settings, now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["not_authorized", "not_due"]); },
  () => { const settings = { ...base, operating_days: ["segunda", "terca"], operating_hours: { segunda: { start: "08:00", end: "18:00" }, terca: { start: "09:00", end: "17:00" } } }; const result = resolveAutomaticReportDue({ settings, now: new Date("2026-10-18T11:00:00Z") }); assert.deepEqual(result.map((item) => item.reason), ["ambiguous_hours", "ambiguous_hours"]); },
  () => { const result = buildAutomaticMorningReport({ appointmentCount: 0, openAppointmentCount: 0, completedAppointmentCount: 0, cancelledAppointmentCount: 0, overdueAppointmentCount: 0, pendingNotificationCount: 0, pendingTaskCount: 0 }); assert.match(result, /não há compromissos/); },
  () => { const result = buildAutomaticEveningReport({ appointmentCount: 2, openAppointmentCount: 1, completedAppointmentCount: 1, cancelledAppointmentCount: 0, overdueAppointmentCount: 0, pendingNotificationCount: 1, pendingTaskCount: 2 }); assert.match(result, /concluídos: 1/); },
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
  schedule?: Partial<typeof base>;
} = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const claims = [...(options.claims || [{ result: "claimed", claim_id: claimId, claim_token: claimToken, attempt_count: 1 }])];
  const schedule = { ...base, ...options.schedule, ai_after_hours_mode: "all_closed_hours" };
  const responseFor = (table: string) => table === "store_schedule_settings"
    ? { data: [schedule], error: null }
    : table === "store_schedule_blocks"
      ? { data: options.holidayBlocks || [], error: null }
    : table === "store_appointments"
      ? { data: options.appointmentError ? null : [{ status: "open", scheduled_end: "2026-10-19T12:00:00Z" }], error: options.appointmentError ? { message: options.appointmentError } : null }
      : { data: [], error: null };
  const supabase = {
    from(table: string) {
      const response = responseFor(table);
      const query = {
        select: () => query,
        eq: () => query,
        gte: () => query,
        lte: () => query,
        gt: () => query,
        lt: () => query,
        in: () => query,
        then: (onfulfilled?: (value: typeof response) => unknown, onrejected?: (reason: unknown) => unknown) => Promise.resolve(response).then(onfulfilled, onrejected),
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
  return { supabase, calls };
}

const reportNow = new Date("2026-10-19T11:00:00Z");

async function runIntegrationTests() {
  const generated = createReportSupabaseMock();
  const generatedResult = await processAutomaticAssistantReports({ now: reportNow, supabase: generated.supabase });
  assert.equal(generatedResult.results[0]?.status, "generated");
  assert.deepEqual(generated.calls.map((call) => call.name), ["assistant_claim_automatic_report", "assistant_materialize_automatic_report"]);
  assert.equal(generated.calls[0]?.args.p_report_type, "morning_report");
  assert.equal(generated.calls[1]?.args.p_report_type, "morning_report");
  assert.equal((generated.calls[1]?.args.p_metadata as Record<string, unknown>).report_key, "assistant-automatic-report:org-1:store-1:2026-10-19:morning_report");

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
  await runIntegrationTests();
  console.log(`automatic-reports: ${tests.length + 10}/${tests.length + 10} PASS`);
} finally {
  if (previousEnabledFlag === undefined) {
    delete process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED;
  } else {
    process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED = previousEnabledFlag;
  }
}

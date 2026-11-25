export const SCHEDULER_COMPONENTS = [
  'sla_alerts','sla_violations','sla_risk','sla_snapshot','whatsapp_inbox',
  'ai_processor','campaign_queue','sales_ai_worker','ai_window_resumes',
  'whatsapp_process_all','assistant_panel_sync','assistant_reports',
  'scheduler_history_retention','cost_daily','monthly_preclosure',
  'cost_retry_morning_1','cost_retry_morning_2','diagnostic_ai_runs','diagnostic_operational',
] as const;
const REASONS = ['unknown','scheduler_reported_cancellation','scheduler_reported_connection_failure','scheduler_reported_restart'] as const;
export type SchedulerFailure = {
  job_id: number; run_id: number; component: typeof SCHEDULER_COMPONENTS[number]; job_active: boolean;
  failed_started_at: string; failed_ended_at: string | null; technical_error_code: 'CRON_EXECUTION_FAILED';
  reported_reason: typeof REASONS[number]; subsequent_success_started_at: string | null; subsequent_success_ended_at: string | null;
};
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function isId(v: unknown): v is number { return typeof v === 'number' && Number.isSafeInteger(v) && v > 0; }
function isDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
}
// Keep only the explicit SQL projection. Dates are normalized, never arbitrary text.
export function projectSchedulerFailures(value: unknown, limit: number): SchedulerFailure[] | null {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Array.isArray(value) || value.length > limit) return null;
  const rows: SchedulerFailure[] = [];
  const seen = new Set<number>();
  for (const v of value) {
    if (!isRecord(v) || !isId(v.job_id) || !isId(v.run_id) || seen.has(v.run_id) || typeof v.job_active !== 'boolean') return null;
    const component = SCHEDULER_COMPONENTS.find(x => x === v.component);
    const reason = REASONS.find(x => x === v.reported_reason);
    const start = v.failed_started_at, end = v.failed_ended_at, resumed = v.subsequent_success_started_at, completed = v.subsequent_success_ended_at;
    if (!component || !reason || v.technical_error_code !== 'CRON_EXECUTION_FAILED' || !isDate(start) || (end !== null && (!isDate(end) || Date.parse(end) < Date.parse(start)))) return null;
    if (resumed === null && completed === null) { /* no evidence */ }
    else if (!isDate(end) || !isDate(resumed) || !isDate(completed) || Date.parse(resumed) < Date.parse(end) || Date.parse(resumed) < Date.parse(start) || Date.parse(completed) < Date.parse(resumed)) return null;
    seen.add(v.run_id);
    rows.push({job_id:v.job_id,run_id:v.run_id,component,job_active:v.job_active,failed_started_at:start,failed_ended_at:end as string|null,technical_error_code:'CRON_EXECUTION_FAILED',reported_reason:reason,subsequent_success_started_at:resumed as string|null,subsequent_success_ended_at:completed as string|null});
  }
  return rows;
}

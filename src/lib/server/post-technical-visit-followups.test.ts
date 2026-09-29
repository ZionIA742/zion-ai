import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  calculatePostTechnicalVisitDue,
  isPostTechnicalVisitEligible,
  recordPostTechnicalVisitResponsibleInbound,
} from "./post-technical-visit-followups";
import { extractIncomingMessage } from "./whatsapp-inbox-processor";

const anchor = "2026-09-28T13:00:00.000Z";
const afterFirstDue = "2026-09-28T13:10:00.000Z";

assert.equal(
  calculatePostTechnicalVisitDue({ scheduledEnd: anchor, promptCount: 0 })?.toISOString(),
  afterFirstDue,
);
assert.equal(
  calculatePostTechnicalVisitDue({ scheduledEnd: anchor, promptCount: 1, lastPromptedAt: afterFirstDue })?.toISOString(),
  "2026-09-28T13:40:00.000Z",
);
assert.equal(calculatePostTechnicalVisitDue({ scheduledEnd: null, promptCount: 0 }), null);

const base = {
  appointmentType: "technical_visit",
  status: "scheduled",
  scheduledEnd: anchor,
  now: afterFirstDue,
  promptCount: 0,
};
assert.equal(isPostTechnicalVisitEligible(base), true);
assert.equal(isPostTechnicalVisitEligible({ ...base, status: "rescheduled" }), true);
assert.equal(isPostTechnicalVisitEligible({ ...base, now: "2026-09-28T13:09:59.999Z" }), false);
assert.equal(isPostTechnicalVisitEligible({ ...base, appointmentType: "installation" }), false);
assert.equal(isPostTechnicalVisitEligible({ ...base, status: "cancelled" }), false);
assert.equal(isPostTechnicalVisitEligible({ ...base, status: "completed" }), false);
assert.equal(isPostTechnicalVisitEligible({ ...base, completionOutcome: "fully_completed" }), false);
assert.equal(isPostTechnicalVisitEligible({ ...base, completionOutcome: "needs_followup" }), true);
assert.equal(isPostTechnicalVisitEligible({ ...base, resolvedAt: afterFirstDue }), false);
assert.equal(isPostTechnicalVisitEligible({ ...base, promptCount: 3 }), false);
assert.equal(isPostTechnicalVisitEligible({ ...base, status: "completed", completionOutcome: "needs_followup" }), true);

const extracted = extractIncomingMessage({
  source: "meta_whatsapp_webhook",
  event_kind: "message",
  phone_number_id: "phone",
  message: { id: "inbound-1", from: "5511999999999", type: "text", text: { body: "ok" }, context: { id: "outbound-1" } },
});
assert.equal(extracted.contextMessageId, "outbound-1");

const inboxSource = fs.readFileSync(path.join(process.cwd(), "src/lib/server/whatsapp-inbox-processor.ts"), "utf8");
assert.ok(inboxSource.indexOf("handleResponsibleInboundBeforeCustomerThread") < inboxSource.indexOf("resolveWhatsappInboundThreadBySystem({"));
assert.ok(!inboxSource.slice(inboxSource.indexOf("if (responsibleInbound.isResponsible)"), inboxSource.indexOf("if (responsibleInbound.isResponsible)") + 700).includes("bootstrapCommercialContextBeforeInsert"));
const cronSource = fs.readFileSync(path.join(process.cwd(), "src/app/api/cron/whatsapp-process-all/route.ts"), "utf8");
assert.ok(cronSource.indexOf("processWhatsappInbox({") < cronSource.indexOf("processPostTechnicalVisitFollowups({"));
assert.ok(cronSource.indexOf("processPostTechnicalVisitFollowups({") < cronSource.indexOf("processWhatsappPendingMessages({"));
const migrationSource = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260928213000_p9_7_4_post_technical_visit_responsible_followups.sql"), "utf8");
assert.ok(migrationSource.includes("status='uncertain'"));
assert.ok(migrationSource.includes("status='superseded'"));
assert.ok(migrationSource.includes("on conflict (appointment_id)"));
assert.ok(migrationSource.includes("prompt_count=0, last_prompted_at=null"));
assert.ok(migrationSource.includes("status='ready_to_send'"));

test("recordPostTechnicalVisitResponsibleInbound preserves inbound and reply context", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  const previousFetch = globalThis.fetch;
  const captured = { requestBody: null as Record<string, unknown> | null };

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (!url.includes("record_post_technical_visit_followup_response")) {
      throw new Error(`unexpected 7.4 inbound fetch: ${url}`);
    }
    captured.requestBody = JSON.parse(String(init?.body || "")) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ handled: true, correlation_status: "matched", response_id: "response-1" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const result = await recordPostTechnicalVisitResponsibleInbound({
      organizationId: "org-1",
      storeId: "store-1",
      responsibleId: "responsible-1",
      inboundExternalMessageId: "inbound-1",
      repliedToExternalMessageId: "outbound-1",
      rawContent: "Visita concluída",
    });

    assert.deepEqual(result, {
      handled: true,
      correlationStatus: "matched",
      responseId: "response-1",
    });
    const requestBody = captured.requestBody;
    assert.ok(requestBody);
    assert.equal(requestBody.p_inbound_external_message_id, "inbound-1");
    assert.equal(requestBody.p_replied_to_external_message_id, "outbound-1");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("cron forwards the 7.4 limit, returns the followup result, and preserves stage order", async () => {
  process.env.CRON_SECRET = "cron-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.WHATSAPP_CRON_POST_APPOINTMENT_FOLLOWUP_LIMIT = "7";

  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/cron/whatsapp-process-all/route.ts"),
    "utf8",
  );
  assert.match(source, /process\.env\.WHATSAPP_CRON_POST_APPOINTMENT_FOLLOWUP_LIMIT/);
  assert.match(source, /limit: postAppointmentFollowupLimit/);
  assert.match(source, /postAppointmentFollowups: postAppointmentFollowupResult/);
  assert.match(source, /postAppointmentFollowupProcessed: results\.reduce/);
  assert.ok(source.indexOf("processWhatsappInbox({") < source.indexOf("processPostTechnicalVisitFollowups({"));
  assert.ok(source.indexOf("processPostTechnicalVisitFollowups({") < source.indexOf("processWhatsappPendingMessages({"));
  assert.ok(source.indexOf("processWhatsappPendingMessages({") < source.indexOf("processDueAiRunQueue({"));

  assert.match(source, /limits:\s*\{[\s\S]*postAppointmentFollowups:\s*postAppointmentFollowupLimit/);
  assert.match(source, /postAppointmentFollowupProcessed:\s*results\.reduce/);
});

console.log("post-technical-visit-followups: focused eligibility tests passed");

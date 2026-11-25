import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const diagnostic = readFileSync(
  join(root, "supabase/diagnostics/20261124150000_p10_7_a1_4_whatsapp_cron_readonly.sql"),
  "utf8",
);
const route = readFileSync(
  join(root, "src/app/api/cron/whatsapp-process-all/route.ts"),
  "utf8",
);
const scanner = readFileSync(
  join(root, "src/lib/server/human-response-alert-scanner.ts"),
  "utf8",
);
const external = readFileSync(
  join(root, "src/lib/server/assistant/responsible-external-notifications.ts"),
  "utf8",
);
const drainer = readFileSync(
  join(root, "src/lib/server/assistant/responsible-external-notifications-drainer.ts"),
  "utf8",
);

test("diagnostic is read-only and does not print cron commands", () => {
  assert.match(diagnostic, /from cron\.job/);
  assert.match(diagnostic, /from cron\.job_run_details/);
  assert.match(diagnostic, /md5\(j\.command\)/);
  assert.doesNotMatch(diagnostic, /v_job\.command[),]/);
  assert.doesNotMatch(diagnostic, /cron\.(schedule|alter_job|unschedule)/i);
});

test("existing executor runs the scanner and delivery stages", () => {
  assert.match(route, /scanHumanResponseAlerts/);
  assert.match(route, /drainResponsibleOperationalApprovalNotifications/);
  assert.match(route, /processWhatsappPendingMessages/);
  assert.match(route, /human_authority_unavailable/);
});

test("scanner and external channel preserve deduplication and registered WhatsApp", () => {
  assert.match(scanner, /human-response:\$\{commitment\.id\}:\$\{thresholdMinutes\}/);
  assert.match(scanner, /assistant_enqueue_internal_notification/);
  assert.match(external, /loadCanonicalActivePrimaryStoreResponsible/);
  assert.match(external, /whatsapp_responsible/);
  assert.match(external, /duplicate_insert_blocked/);
  assert.match(drainer, /isHumanResponseAlertInternalNotification/);
  assert.match(drainer, /uncertainOnTransportFailure: true/);
});

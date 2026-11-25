import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const scanner = readFileSync(join(root, "src/lib/server/human-response-alert-scanner.ts"), "utf8");
const route = readFileSync(join(root, "src/app/api/cron/whatsapp-process-all/route.ts"), "utf8");
const external = readFileSync(join(root, "src/lib/server/assistant/responsible-external-notifications.ts"), "utf8");
const drainer = readFileSync(join(root, "src/lib/server/assistant/responsible-external-notifications-drainer.ts"), "utf8");

test("10.7-A1.3 connects the scanner to the existing local periodic executor", () => {
  assert.match(route, /scanHumanResponseAlerts/);
  assert.match(route, /supabase: timeoutSupabase/);
  assert.match(route, /organizationId: store\.organizationId/);
  assert.match(route, /storeId: store\.storeId/);
  assert.match(route, /human_authority_unavailable/);
});

test("10.7-A1.3 preserves canonical internal queue and registered WhatsApp delivery", () => {
  assert.match(scanner, /assistant_enqueue_internal_notification/);
  assert.match(scanner, /p_event_key: plan\.eventKey/);
  assert.match(scanner, /reason: "human_response_pending"/);
  assert.match(scanner, /HUMAN_RESPONSE_ALERT_THRESHOLDS_MINUTES = \[10, 30\]/);
  assert.match(external, /HUMAN_RESPONSE_ALERT_REASON = "human_response_pending"/);
  assert.match(external, /requiresResponsibleNotification/);
  assert.match(drainer, /HUMAN_RESPONSE_ALERT_REASON = "human_response_pending"/);
  assert.match(drainer, /context->>reason/);
  assert.match(drainer, /whatsapp_responsible/);
});

test("10.7-A1.3 remains fail-closed for authority and future commitments", () => {
  assert.match(scanner, /commitments_unavailable/);
  assert.match(scanner, /human_authority_unavailable/);
  assert.match(scanner, /authority\.released_at !== null/);
  assert.match(scanner, /commitment\.status !== "active"/);
  assert.match(scanner, /due_at/);
  assert.doesNotMatch(scanner, /responsible_user_id/);
});

test("10.7-A1.3 does not add individual-user configuration or modify Pilar 19-A controls", () => {
  assert.doesNotMatch(scanner, /store_responsible_user_links|recipient_responsible_id|memberships/);
  assert.doesNotMatch(route, /store_responsible_user_links|recipient_responsible_id/);
});

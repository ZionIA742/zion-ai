import { strict as assert } from "node:assert";

const { GET } = await import("./route");

const previousCronSecret = process.env.CRON_SECRET;
const previousActivationAt = process.env.ASSISTANT_PANEL_WHATSAPP_SYNC_ACTIVATED_AT;

try {
  process.env.CRON_SECRET = "cron-secret-test";
  process.env.ASSISTANT_PANEL_WHATSAPP_SYNC_ACTIVATED_AT = "2026-10-21T10:00:00.000Z";

  const unauthorized = await GET(new Request("http://localhost/api/cron/assistant-panel-whatsapp-sync"));
  assert.equal(unauthorized.status, 401);

  const wrongSecret = await GET(
    new Request("http://localhost/api/cron/assistant-panel-whatsapp-sync", {
      headers: { authorization: "Bearer wrong-secret" },
    }),
  );
  assert.equal(wrongSecret.status, 401);

  process.env.ASSISTANT_PANEL_WHATSAPP_SYNC_ACTIVATED_AT = "";
  const missingActivation = await GET(
    new Request("http://localhost/api/cron/assistant-panel-whatsapp-sync", {
      headers: { authorization: "Bearer cron-secret-test" },
    }),
  );
  assert.equal(missingActivation.status, 503);
  assert.equal(
    (await missingActivation.json()).error,
    "ASSISTANT_PANEL_SYNC_ACTIVATION_NOT_CONFIGURED",
  );

  process.stdout.write("assistant-panel-whatsapp-sync route: PASS\n");
} finally {
  if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousCronSecret;
  if (previousActivationAt === undefined) delete process.env.ASSISTANT_PANEL_WHATSAPP_SYNC_ACTIVATED_AT;
  else process.env.ASSISTANT_PANEL_WHATSAPP_SYNC_ACTIVATED_AT = previousActivationAt;
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssistantReportsCronGetHandler } from "./route";

test("keeps the reports cron disabled without invoking report processing", async () => {
  const previousSecret = process.env.CRON_SECRET;
  const previousEnabledFlag = process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED;
  let processingCalls = 0;

  try {
    process.env.CRON_SECRET = "test-secret";
    delete process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED;

    const handler = createAssistantReportsCronGetHandler({
      processReports: async () => {
        processingCalls += 1;
        throw new Error("processing must not run while disabled");
      },
    });
    const response = await handler(
      new Request("http://localhost/api/cron/assistant-reports", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      enabled: false,
      processed: 0,
      results: [],
      route: "cron/assistant-reports",
    });
    assert.equal(processingCalls, 0);
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
    if (previousEnabledFlag === undefined) delete process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED;
    else process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED = previousEnabledFlag;
  }
});

test("requires the cron secret before evaluating the reports flag", async () => {
  const previousSecret = process.env.CRON_SECRET;
  const previousEnabledFlag = process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED;
  let processingCalls = 0;

  try {
    process.env.CRON_SECRET = "test-secret";
    process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED = "true";

    const handler = createAssistantReportsCronGetHandler({
      processReports: async () => {
        processingCalls += 1;
        return { ok: true, processed: 0, results: [] };
      },
    });

    const missingSecret = await handler(
      new Request("http://localhost/api/cron/assistant-reports"),
    );
    const wrongSecret = await handler(
      new Request("http://localhost/api/cron/assistant-reports", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );

    assert.equal(missingSecret.status, 401);
    assert.equal(wrongSecret.status, 401);
    assert.equal(processingCalls, 0);
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
    if (previousEnabledFlag === undefined) delete process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED;
    else process.env.ASSISTANT_AUTOMATIC_REPORTS_ENABLED = previousEnabledFlag;
  }
});

console.log("assistant-reports route: 2/2 PASS");

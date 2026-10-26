import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";

type MetaResponse = {
  status: number;
  body?: string;
};

const notification = {
  id: "notification-1",
  organization_id: "org-1",
  store_id: "store-1",
  responsible_id: "responsible-1",
  internal_notification_id: "internal-1",
  channel: "whatsapp_responsible",
  destination: "5511999999999",
  notification_type: "post_technical_visit",
  priority: "high",
  status: "ready_to_send",
  title: "Acompanhamento",
  body: "Como foi a visita?",
  rendered_message: "Como foi a visita?",
  context: {},
  source_event_key: "event-1",
  related_lead_id: null,
  related_conversation_id: null,
  related_appointment_id: "appointment-1",
  related_document_type: null,
  related_document_id: null,
  related_document_number: null,
  related_document_status: null,
  external_message_id: null,
  sent_at: null,
  delivered_at: null,
  read_at: null,
  failed_at: null,
  error_text: null,
  attempts: 0,
  locked_at: null,
  locked_by: null,
  processed_at: null,
  created_at: "2026-09-29T12:00:00.000Z",
  updated_at: "2026-09-29T12:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFetchStub(
  metaResponse: MetaResponse | "reject",
  persistFailure = false,
  notificationOverrides: Partial<typeof notification> = {},
  inboundRows?: unknown[],
) {
  let persistCount = 0;
  const calls: string[] = [];
  const currentNotification = { ...notification, ...notificationOverrides };
  const recentInbound = {
    created_at: new Date().toISOString(),
    metadata: {
      origin: "whatsapp",
      responsible_id: "responsible-1",
      from_phone: "5511999999999",
      external_message_id: "wamid-inbound-1",
    },
  };

  const fetchStub = async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method || "GET"} ${url} ${String(init?.body || "")}`);

    if (url.includes("/rest/v1/store_responsible_external_notifications")) {
      if (init?.method === "PATCH") {
        const patchBody = JSON.parse(String(init.body || "{}")) as Record<string, unknown>;
        if (patchBody.send_status === "sending") {
          return jsonResponse([]);
        }
        persistCount += 1;
        if (persistCount === 1) {
          return jsonResponse({ ...currentNotification, status: "processing", attempts: 1 });
        }
        if (persistFailure && persistCount === 2) {
          return jsonResponse({ error: "database unavailable" }, 500);
        }
        return jsonResponse([]);
      }
      return jsonResponse([currentNotification]);
    }

    if (url.includes("/rest/v1/store_responsibles")) {
      return jsonResponse([{
        id: "responsible-1",
        name: "Responsavel",
        role: "primary",
        whatsapp_number: "5511999999999",
      }]);
    }

    if (url.includes("/rest/v1/store_assistant_messages")) {
      return jsonResponse(inboundRows ?? [recentInbound]);
    }

    if (url.includes("/rest/v1/rpc/get_whatsapp_integration")) {
      return jsonResponse({ access_token: "token-1", phone_number_id: "phone-1" });
    }

    if (url.includes("graph.facebook.com")) {
      if (metaResponse === "reject") {
        throw new Error("network down");
      }
      return new Response(metaResponse.body ?? "", { status: metaResponse.status });
    }

    throw new Error(`unexpected fetch: ${url}`);
  };

  return { fetchStub, calls };
}

async function runCase(
  metaResponse: MetaResponse | "reject",
  options: {
    uncertainOnTransportFailure?: boolean;
    persistFailure?: boolean;
    notificationOverrides?: Partial<typeof notification>;
    inboundRows?: unknown[];
  } = {},
) {
  const previousFetch = globalThis.fetch;
  const stub = createFetchStub(
    metaResponse,
    options.persistFailure,
    options.notificationOverrides,
    options.inboundRows,
  );
  globalThis.fetch = stub.fetchStub as typeof fetch;
  try {
    const { sendResponsibleExternalNotification } = await import(
      "./responsible-external-notifications-sender"
    );
    const result = await sendResponsibleExternalNotification({
      organizationId: "org-1",
      storeId: "store-1",
      notificationId: "notification-1",
      uncertainOnTransportFailure: options.uncertainOnTransportFailure,
    });
    return { result, calls: stub.calls };
  } finally {
    globalThis.fetch = previousFetch;
  }
}

function assertReason(result: Awaited<ReturnType<typeof runCase>>["result"], reason: string) {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, reason);
}

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";

  const networkUncertain = await runCase("reject", { uncertainOnTransportFailure: true });
  assertReason(networkUncertain.result, "send_uncertain");

  const non2xxJson = await runCase({ status: 401, body: JSON.stringify({ error: { message: "unauthorized" } }) }, { uncertainOnTransportFailure: true });
  assertReason(non2xxJson.result, "send_failed");

  const serverFailure = await runCase({ status: 500, body: "not-json" }, { uncertainOnTransportFailure: true });
  assertReason(serverFailure.result, "send_uncertain");

  const successInvalid = await runCase({ status: 200, body: "not-json" }, { uncertainOnTransportFailure: true });
  assertReason(successInvalid.result, "send_uncertain");

  const successWithoutId = await runCase({ status: 200, body: JSON.stringify({ messages: [] }) }, { uncertainOnTransportFailure: true });
  assertReason(successWithoutId.result, "send_uncertain");

  const persistenceUncertain = await runCase(
    { status: 200, body: JSON.stringify({ messages: [{ id: "wamid-1" }] }) },
    { uncertainOnTransportFailure: true, persistFailure: true },
  );
  assertReason(persistenceUncertain.result, "send_uncertain");

  const legacyTransportFailure = await runCase("reject");
  assertReason(legacyTransportFailure.result, "send_failed");

  for (const reportType of ["morning_report", "evening_report"] as const) {
    const report = await runCase(
      { status: 200, body: JSON.stringify({ messages: [{ id: `wamid-${reportType}` }] }) },
      {
        notificationOverrides: {
          notification_type: reportType,
          created_at: new Date().toISOString(),
          context: {
            source: "assistant_automatic_reports",
            report_type: reportType,
            local_date: "2026-10-26",
            target_iso: "2026-10-26T11:00:00.000Z",
            event_key: `assistant-automatic-report:org-1:store-1:2026-10-26:${reportType}`,
          },
        },
      },
    );
    assert.equal(report.result.ok, true);
    assert.ok(report.calls.some((call) => call.includes("graph.facebook.com") && call.includes('"type":"text"')));
  }

  const closedWindowReport = await runCase(
    { status: 200, body: JSON.stringify({ messages: [{ id: "must-not-send" }] }) },
    {
      inboundRows: [],
      notificationOverrides: {
        notification_type: "morning_report",
        created_at: new Date().toISOString(),
        context: {
          source: "assistant_automatic_reports",
          report_type: "morning_report",
          local_date: "2026-10-26",
          target_iso: "2026-10-26T11:00:00.000Z",
          event_key: "assistant-automatic-report:org-1:store-1:2026-10-26:morning_report",
        },
      },
    },
  );
  assertReason(closedWindowReport.result, "send_failed");
  assert.equal(closedWindowReport.calls.some((call) => call.includes("graph.facebook.com")), false);
  assert.ok(closedWindowReport.calls.some((call) => call.includes("RESPONSIBLE_WHATSAPP_TEMPLATE_REQUIRED")));
  assert.equal(closedWindowReport.calls.some((call) => call.includes("RESPONSIBLE_WHATSAPP_TEMPLATE_KIND_REQUIRED")), false);

  const expiredReport = await runCase(
    { status: 200, body: JSON.stringify({ messages: [{ id: "must-not-send" }] }) },
    {
      notificationOverrides: {
        notification_type: "evening_report",
        created_at: "2026-10-20T10:00:00.000Z",
        context: {
          source: "assistant_automatic_reports",
          report_type: "evening_report",
          local_date: "2026-10-20",
          target_iso: "2026-10-20T20:00:00.000Z",
          event_key: "assistant-automatic-report:org-1:store-1:2026-10-20:evening_report",
        },
      },
    },
  );
  assertReason(expiredReport.result, "automatic_report_expired");
  assert.equal(expiredReport.calls.some((call) => call.includes("graph.facebook.com")), false);

  const followupSource = fs.readFileSync(
    path.join(process.cwd(), "src/lib/server/post-technical-visit-followups.ts"),
    "utf8",
  );
  assert.match(followupSource, /uncertainOnTransportFailure:\s*true/);

  const senderSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/lib/server/assistant/responsible-external-notifications-sender.ts",
    ),
    "utf8",
  );
  assert.match(senderSource, /isAutomaticReportNotification\(claimedNotification\)/);
  assert.match(senderSource, /context\.report_source/);
  assert.match(senderSource, /context\.source/);
  assert.match(senderSource, /policy\.mode !== "free_form"/);
  assert.match(senderSource, /templateContext: automaticReport\s*\? undefined/);
  assert.match(senderSource, /AUTOMATIC_REPORT_WHATSAPP_WINDOW_CLOSED/);
  console.log("responsible-external-notifications-sender: focused uncertainty tests passed");
}

void main();

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

function createFetchStub(metaResponse: MetaResponse | "reject", persistFailure = false) {
  let persistCount = 0;
  const calls: string[] = [];
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
    calls.push(`${init?.method || "GET"} ${url}`);

    if (url.includes("/rest/v1/store_responsible_external_notifications")) {
      if (init?.method === "PATCH") {
        persistCount += 1;
        if (persistCount === 1) {
          return jsonResponse({ ...notification, status: "processing", attempts: 1 });
        }
        if (persistFailure && persistCount === 2) {
          return jsonResponse({ error: "database unavailable" }, 500);
        }
        return jsonResponse([]);
      }
      return jsonResponse([notification]);
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
      return jsonResponse([recentInbound]);
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
  options: { uncertainOnTransportFailure?: boolean; persistFailure?: boolean } = {},
) {
  const previousFetch = globalThis.fetch;
  const stub = createFetchStub(metaResponse, options.persistFailure);
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

  const non2xxInvalid = await runCase({ status: 500, body: "not-json" }, { uncertainOnTransportFailure: true });
  assertReason(non2xxInvalid.result, "send_failed");

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

  const followupSource = fs.readFileSync(
    path.join(process.cwd(), "src/lib/server/post-technical-visit-followups.ts"),
    "utf8",
  );
  assert.match(followupSource, /uncertainOnTransportFailure:\s*true/);
  console.log("responsible-external-notifications-sender: focused uncertainty tests passed");
}

void main();

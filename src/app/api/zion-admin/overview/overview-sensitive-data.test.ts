import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeOverviewError, sanitizeTechnicalPreview } from "./overview-sensitive-data";

test("technical preview keeps only bounded numeric operational metadata", () => {
  const preview = sanitizeTechnicalPreview({
    operation: "sales_reply", queue_key: "assistant:reply", http_status: 502,
    retry_count: 2, duration_ms: 1500, attempt: 1,
    nested: { token: "secret-token" }, password: "password-value",
    customer_name: "Maria Silva", access_token: "bearer-secret",
  });
  assert.equal(preview, '{"attempt":1,"duration_ms":1500,"http_status":502,"retry_count":2}');
  assert.equal(preview?.includes("secret-token"), false);
  assert.equal(preview?.includes("Maria Silva"), false);
  assert.equal(preview?.includes("sales_reply"), false);
  assert.equal(preview?.includes("assistant:reply"), false);
});

test("arbitrary strings, personal data, and invalid structures do not become previews", () => {
  assert.equal(sanitizeTechnicalPreview("token=secret password=123"), null);
  assert.equal(sanitizeTechnicalPreview(["customer@example.com"]), null);
  assert.equal(sanitizeTechnicalPreview({ payload: { api_key: "secret" } }), null);
  assert.equal(sanitizeTechnicalPreview({ operation: "contains spaces or secrets" }), null);
  assert.equal(sanitizeTechnicalPreview({ provider: "senha123456", model: "person@example.com" }), null);
  assert.equal(sanitizeTechnicalPreview({ queue_key: "token:segredo123" }), null);
});

test("numeric metadata requires safe integers within operational domains", () => {
  assert.equal(
    sanitizeTechnicalPreview({
      http_status: 200.5,
      retry_count: -1,
      duration_ms: Number.POSITIVE_INFINITY,
      attempt: 101,
    }),
    null,
  );
  assert.equal(sanitizeTechnicalPreview({ http_status: 200, retry_count: 0, duration_ms: 0, attempt: 1 }),
    '{"attempt":1,"duration_ms":0,"http_status":200,"retry_count":0}');
  assert.equal(sanitizeTechnicalPreview({ http_status: 700, duration_ms: 86_400_001 }), null);
});

test("unknown technical errors become generic source-specific descriptions", () => {
  for (const source of ["ai_run_queue", "ai_sales_action_queue", "channel_whatsapp_inbox", "ai_run"] as const) {
    const error = sanitizeOverviewError({ source, rawError: "provider token=secret password=123 customer=Maria" });
    assert.equal(error?.includes("secret"), false);
    assert.equal(error?.includes("Maria"), false);
    assert.match(error || "", /Falha operacional/);
  }
});

test("safe operational context remains available through generic status text", () => {
  assert.equal(sanitizeOverviewError({ source: "ai_run_queue", rawError: null, pending: true }), "Fila de IA aguardando processamento.");
  assert.equal(sanitizeOverviewError({ source: "ai_run", rawError: null }), null);
});

test("serialized administrative output cannot recover sensitive values", () => {
  const output = {
    inputPreview: sanitizeTechnicalPreview({ input: { password: "pw", token: "tok", customer_phone: "+5511999999999" }, operation: "assistant_reply" }),
    error: sanitizeOverviewError({ source: "ai_run", rawError: "api_key=key-secret customer_email=person@example.com" }),
  };
  const serialized = JSON.stringify(output);
  for (const secret of ["pw", "tok", "+5511999999999", "key-secret", "person@example.com"]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(serialized.includes("assistant_reply"), false);
});

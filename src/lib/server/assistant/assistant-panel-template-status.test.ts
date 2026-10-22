import { strict as assert } from "node:assert";
import { readAssistantPanelTemplateStatus } from "./assistant-panel-template-status";

const integration = {
  phone_number_id: "phone-1",
  whatsapp_business_account_id: "waba-1",
  access_token: "token-from-integration",
};

function createSupabase(row: unknown = integration) {
  return {
    from(table: string) {
      assert.equal(table, "external_integrations");
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: row ? [row] : [], error: null }).then(resolve);
        },
      };
      return builder;
    },
  } as never;
}

function fetchFor(args: { status?: string; category?: string; phoneId?: string; fail?: boolean }) {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (args.fail) return new Response("unavailable", { status: 503 });
    if (url.includes("/phone_numbers")) {
      return Response.json({ data: [{ id: args.phoneId || "phone-1" }] });
    }
    return Response.json({
      data: [{
        name: "zion_assistente_pendencia_operacional",
        status: args.status || "APPROVED",
        category: args.category || "UTILITY",
        language: "pt_BR",
        components: [
          {
            type: "BODY",
            text: "Temos trabalho a fazer!\n\nHá uma pendência operacional na sua loja que precisa da sua atenção.\n\nResponda CONTINUAR para receber os detalhes.",
          },
          { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "CONTINUAR" }] },
        ],
      }],
    });
  };
}

async function main() {
  const base = { supabase: createSupabase(), organizationId: "org-1", storeId: "store-1" };
  const approved = await readAssistantPanelTemplateStatus(base, { fetch: fetchFor({}) });
  assert.equal(approved.ok, true);

  for (const status of ["PENDING", "REJECTED", "PAUSED"]) {
    const result = await readAssistantPanelTemplateStatus(base, { fetch: fetchFor({ status }) });
    assert.deepEqual(result, { ok: false, reason: "template_not_approved" });
  }
  const marketing = await readAssistantPanelTemplateStatus(base, { fetch: fetchFor({ category: "MARKETING" }) });
  assert.deepEqual(marketing, { ok: false, reason: "template_category_mismatch" });
  const mismatch = await readAssistantPanelTemplateStatus(base, { fetch: fetchFor({ phoneId: "phone-other" }) });
  assert.deepEqual(mismatch, { ok: false, reason: "phone_number_waba_mismatch" });
  const unavailable = await readAssistantPanelTemplateStatus(base, { fetch: fetchFor({ fail: true }) });
  assert.deepEqual(unavailable, { ok: false, reason: "phone_numbers_unavailable" });
  const noIntegration = await readAssistantPanelTemplateStatus({ ...base, supabase: createSupabase(null) }, { fetch: fetchFor({}) });
  assert.deepEqual(noIntegration, { ok: false, reason: "integration_unavailable" });
  console.log("assistant-panel-template-status: focused tests passed");
}

void main();

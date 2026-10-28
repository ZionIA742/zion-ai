import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { StoreApiAccessDenied } from "@/lib/server/store-api-access";
import { createCreateManualContractPostHandler } from "./route";

const ORG = "11111111-1111-4111-8111-111111111111";
const STORE = "22222222-2222-4222-8222-222222222222";
const OPPORTUNITY = "33333333-3333-4333-8333-333333333333";
const DRAFT = "44444444-4444-4444-8444-444444444444";
const TEMPLATE_VERSION = "55555555-5555-4555-8555-555555555555";
const CONTRACT = "66666666-6666-4666-8666-666666666666";
const TEXT = "Contrato manual conferido pelo responsavel.";
const SHA256 = createHash("sha256").update(TEXT, "utf8").digest("hex");

function granted(supabase: unknown) {
  return { ok: true as const, supabase: supabase as never, sessionUserId: "77777777-7777-4777-8777-777777777777", organizationId: ORG, storeId: STORE, resolution: {} as never };
}
function denied(): StoreApiAccessDenied {
  return { ok: false, httpStatus: 403, payload: { ok: false, error: "STORE_API_FORBIDDEN", message: "Sem permissao.", status: "store_commercial_blocked", reasonCode: "commercial_access_blocked" }, resolution: {} as never };
}
function input(overrides: Record<string, unknown> = {}) {
  return { commercialOpportunityId: OPPORTUNITY, draftId: DRAFT, templateVersionId: TEMPLATE_VERSION, draftRevision: 1, draftSha256: SHA256, ...overrides };
}
function createBuilder(value: unknown, error: { message: string } | null = null) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: value, error }),
  };
  return builder;
}
function harness(options: { rpcData?: unknown; rpcError?: { message: string } | null; opportunity?: unknown; draft?: unknown; template?: unknown; version?: unknown } = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const opportunity = options.opportunity === undefined ? { id: OPPORTUNITY, organization_id: ORG, store_id: STORE } : options.opportunity;
  const draft = options.draft === undefined ? { id: DRAFT, organization_id: ORG, store_id: STORE, commercial_opportunity_id: OPPORTUNITY, template_version_id: TEMPLATE_VERSION, draft_text: TEXT, revision: 1 } : options.draft;
  const template = options.template === undefined ? { id: "88888888-8888-4888-8888-888888888888", organization_id: ORG, store_id: STORE, status: "active", active_version_id: TEMPLATE_VERSION } : options.template;
  const templateId = template && typeof template === "object"
    ? (template as Record<string, unknown>).id
    : undefined;
  const version = options.version === undefined ? { id: TEMPLATE_VERSION, template_id: templateId, organization_id: ORG, store_id: STORE, status: "active" } : options.version;
  const service = {
    from(table: string) {
      if (table === "sales_contract_text_drafts") return createBuilder(draft);
      if (table === "store_contract_templates") return createBuilder(template);
      return createBuilder(version);
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: options.rpcData ?? [{ outcome: "created", contract_id: CONTRACT, organization_id: ORG, store_id: STORE, commercial_opportunity_id: OPPORTUNITY, draft_id: DRAFT, draft_revision: 1, contract_status: "draft" }], error: options.rpcError ?? null };
    },
  };
  const accessSupabase = { from: () => createBuilder(opportunity) };
  return { calls, service, accessSupabase };
}
async function responseOf(handler: ReturnType<typeof createCreateManualContractPostHandler>, body: unknown = input()) {
  const response = await handler(new Request("http://test", { method: "POST", body: JSON.stringify(body) }));
  return { response, body: await response.json() as Record<string, unknown> };
}

async function main() {
  const authorized = async (h: ReturnType<typeof harness>) => granted(h.accessSupabase);

  {
    const h = harness();
    const result = await responseOf(createCreateManualContractPostHandler({ resolveAccess: () => authorized(h), createServiceClient: () => h.service as never }));
    assert.equal(result.response.status, 200); assert.equal((result.body.operation as Record<string, unknown>).outcome, "created"); assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0].args, { p_organization_id: ORG, p_store_id: STORE, p_commercial_opportunity_id: OPPORTUNITY, p_draft_id: DRAFT, p_template_version_id: TEMPLATE_VERSION, p_draft_revision: 1, p_draft_sha256: SHA256, p_actor_user_id: "77777777-7777-4777-8777-777777777777" });
  }
  {
    const h = harness({ rpcData: [{ outcome: "already_exists", contract_id: CONTRACT, organization_id: ORG, store_id: STORE, commercial_opportunity_id: OPPORTUNITY, draft_id: DRAFT, draft_revision: 1, contract_status: "draft" }] });
    const result = await responseOf(createCreateManualContractPostHandler({ resolveAccess: () => authorized(h), createServiceClient: () => h.service as never }));
    assert.equal(result.response.status, 200); assert.equal((result.body.operation as Record<string, unknown>).outcome, "already_exists");
  }
  {
    const h = harness(); const result = await responseOf(createCreateManualContractPostHandler({ resolveAccess: async () => denied(), createServiceClient: () => h.service as never }));
    assert.equal(result.response.status, 403); assert.equal(h.calls.length, 0);
  }
  for (const overrides of [
    { opportunity: { id: OPPORTUNITY, organization_id: "99999999-9999-4999-8999-999999999999", store_id: STORE } },
    { draft: { id: DRAFT, organization_id: ORG, store_id: STORE, commercial_opportunity_id: OPPORTUNITY, template_version_id: TEMPLATE_VERSION, draft_text: TEXT, revision: 2 } },
    { template: { id: "88888888-8888-4888-8888-888888888888", organization_id: ORG, store_id: STORE, status: "active", active_version_id: "99999999-9999-4999-8999-999999999999" } },
  ]) {
    const h = harness(overrides as never);
    const body = overrides.draft && (overrides.draft as Record<string, unknown>).revision === 2 ? input({ draftRevision: 1 }) : input();
    const result = await responseOf(createCreateManualContractPostHandler({ resolveAccess: () => authorized(h), createServiceClient: () => h.service as never }), body);
    assert.ok([403, 409].includes(result.response.status)); assert.equal(h.calls.length, 0);
  }
  {
    const h = harness({ rpcError: { message: "P9_MANUAL_CONTRACT_EXISTING_CONTRACT_DIFFERENT_ORIGIN" } });
    const result = await responseOf(createCreateManualContractPostHandler({ resolveAccess: () => authorized(h), createServiceClient: () => h.service as never }));
    assert.equal(result.response.status, 409); assert.equal(h.calls.length, 1);
  }
  {
    const h = harness({ rpcData: [{ outcome: "unexpected", contract_id: CONTRACT }] });
    const result = await responseOf(createCreateManualContractPostHandler({ resolveAccess: () => authorized(h), createServiceClient: () => h.service as never }));
    assert.equal(result.response.status, 500);
  }
  {
    const h = harness();
    const result = await responseOf(createCreateManualContractPostHandler({ resolveAccess: () => authorized(h), createServiceClient: () => h.service as never }), input({ draftSha256: "a".repeat(64) }));
    assert.equal(result.response.status, 409); assert.equal(h.calls.length, 0);
  }
  const source = readFileSync(join(process.cwd(), "src/app/api/sales-contracts/create-manual/route.ts"), "utf8");
  assert.match(source, /create_sales_contract_manual_by_system/); assert.doesNotMatch(source, /generate-pdf|approve|whatsapp|insert_message/);
  console.log("PASS manual contract creation route tests");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

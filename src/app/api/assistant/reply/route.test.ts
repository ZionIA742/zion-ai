import { strict as assert } from "node:assert";
import { join } from "node:path";
import Module from "node:module";
import { readFileSync } from "node:fs";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const projectSrcPath = join(process.cwd(), "src");
type ResolveFilenameHook = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) => string;
type ModuleWithResolveFilename = typeof Module & {
  _resolveFilename: ResolveFilenameHook;
};
const moduleWithResolveFilename = Module as ModuleWithResolveFilename;
const originalResolveFilename = moduleWithResolveFilename._resolveFilename;

moduleWithResolveFilename._resolveFilename = function resolveFilenamePatched(
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) {
  if (request.startsWith("@/")) {
    const nextRequest = join(projectSrcPath, request.slice(2));
    return originalResolveFilename.call(this, nextRequest, parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const routeModulePromise = import("./route");

async function loadRouteModule() {
  return routeModulePromise;
}

function createDeniedAccess(
  httpStatus: 401 | 403 | 409 | 503,
  status: StoreApiAccessDenied["payload"]["status"],
  reasonCode: StoreApiAccessDenied["payload"]["reasonCode"],
  error = "STORE_API_ACCESS_DENIED",
): StoreApiAccessDenied {
  return {
    ok: false,
    resolution: {
      domain: status === "anonymous" ? "anonymous" : "store_area",
      status,
      sessionUserId: null,
      safeHtmlDestination:
        status === "anonymous" ? "/login" : "/account/access-blocked",
      apiDecision:
        httpStatus === 401
          ? "deny_401"
          : httpStatus === 403
            ? "deny_403"
            : httpStatus === 503
              ? "deny_503"
              : "deny_409",
      organizationResolution: "none",
      storeResolution: "none",
      organizationId: null,
      storeId: null,
      commercialAccess: "unknown",
      reasonCode,
      message: "Mensagem interna.",
    },
    httpStatus,
    payload: {
      ok: false,
      error,
      message: "Mensagem publica.",
      status,
      reasonCode,
    },
  };
}

function createGrantedAccess(
  overrides?: Partial<StoreApiAccessGranted>,
): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as StoreApiAccessGranted["supabase"],
    resolution: {
      domain: "store_area",
      status: "store_ready_active",
      sessionUserId: "session-user-1",
      safeHtmlDestination: "/crm",
      apiDecision: "allow",
      organizationResolution: "single",
      storeResolution: "single",
      organizationId: "canonical-org",
      storeId: "canonical-store",
      commercialAccess: "allowed",
      reasonCode: "ready_active",
      message: "Conta liberada.",
    },
    sessionUserId: "session-user-1",
    organizationId: "canonical-org",
    storeId: "canonical-store",
    ...overrides,
  };
}

function buildRequest(body: Record<string, unknown>) {
  return new Request("https://example.test/api/assistant/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function readRouteSource() {
  return readFileSync("src/app/api/assistant/reply/route.ts", "utf8");
}

function createOpportunityLookupSupabase(rows: Array<Record<string, unknown>>) {
  return {
    calls: [] as Array<{ table: string; filters: Record<string, unknown> }>,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const api = {
        select(_columns: string) {
          return api;
        },
        eq(field: string, value: unknown) {
          filters[field] = value;
          return api;
        },
        async maybeSingle() {
          this;
          const row =
            rows.find((item) => {
              return Object.entries(filters).every(([field, value]) => item[field] === value);
            }) || null;
          return { data: row, error: null };
        },
      };
      this.calls.push({ table, filters });
      return api;
    },
  };
}

function commercialVisitTask(
  commercialOpportunityId: string | null,
  overrides?: Record<string, unknown>,
) {
  return {
    id: `task-${commercialOpportunityId || "none"}`,
    task_type: "commercial_visit_request",
    status: "open",
    related_lead_id: "lead-1",
    related_conversation_id: "conv-1",
    commercial_opportunity_id: commercialOpportunityId,
    ...overrides,
  } as any;
}

function technicalVisitPayload(overrides?: Record<string, unknown>) {
  return {
    title: "Visita tecnica - Joao",
    appointment_type: "technical_visit",
    customer_name: "Joao",
    customer_phone: null,
    address_text: "Rua General Francisco Glicerio, 130, Suzano - SP",
    scheduled_start: "2026-09-18T13:00:00.000Z",
    scheduled_end: "2026-09-18T14:00:00.000Z",
    ...overrides,
  } as any;
}

function identityCandidate(overrides?: Record<string, unknown>) {
  return {
    option_number: 1,
    customer_id: "customer-1",
    lead_id: "lead-1",
    conversation_id: "conv-1",
    commercial_opportunity_id: "opportunity-a",
    customer_name: "Joao",
    customer_phone: "+55 11 99999-0207",
    opportunity_stage: "qualificacao",
    ...overrides,
  } as any;
}

function appointmentCreateOperationKey(args?: {
  threadId?: string;
  appointmentType?: string;
  leadId?: string;
  conversationId?: string;
  opportunityId?: string | null;
  start?: string;
  end?: string;
  message?: string;
}) {
  return [
    "assistant_customer_contact",
    "appointment_create_with_customer",
    args?.threadId || "thread-resumed-create",
    args?.appointmentType || "technical_visit",
    args?.leadId || "lead-1",
    args?.conversationId || "conv-1",
    args?.opportunityId ?? "opportunity-selected",
    args?.start || "2026-09-18T13:00:00.000Z",
    args?.end || "2026-09-18T14:00:00.000Z",
    String(args?.message || "1").toLowerCase().trim(),
  ].join(":");
}

function appointmentCreateTaskRow(overrides?: Record<string, unknown>) {
  return {
    id: "task-existing",
    organization_id: "org-1",
    store_id: "store-1",
    thread_id: "thread-resumed-create",
    task_type: "appointment_create_with_customer",
    status: "waiting_customer_response",
    related_lead_id: "lead-1",
    related_conversation_id: "conv-1",
    related_appointment_id: null,
    commercial_opportunity_id: "opportunity-selected",
    target_start_at: "2026-09-18T13:00:00.000Z",
    target_end_at: "2026-09-18T14:00:00.000Z",
    task_payload: {
      operation_key: appointmentCreateOperationKey(),
      appointment_type: "technical_visit",
      customer_message_sent: true,
      customer_message_id: "message-existing",
      agenda_updated: false,
    },
    ...overrides,
  } as any;
}

function createAssistantRouteSupabaseMock(args?: {
  leads?: Array<Record<string, unknown>>;
  conversations?: Array<Record<string, unknown>>;
  opportunities?: Array<Record<string, unknown>>;
  operationalTasks?: Array<Record<string, unknown>>;
  concurrentOperationalTasks?: Array<Record<string, unknown>>;
  taskInsertError?: { code?: string; message: string } | null;
  writerData?: Record<string, unknown> | null;
  mutationError?: string | null;
  conversationsError?: string | null;
}) {
  const calls = {
    from: [] as string[],
    selects: [] as Array<{ table: string; columns: string }>,
    filters: [] as Array<{ table: string; field: string; op: string }>,
    order: [] as Array<{ table: string; column: string }>,
    rpc: [] as Array<{ name: string; params: Record<string, unknown> }>,
    upserts: [] as Array<Record<string, unknown>>,
  };
  const tableRows: Record<string, Array<Record<string, unknown>>> = {
    leads: args?.leads || [],
    conversations: args?.conversations || [],
    commercial_opportunities: args?.opportunities || [],
    store_assistant_operational_tasks: args?.operationalTasks || [],
    store_operation_settings: [{ organization_id: "org-1", store_id: "store-1", offers_installation: true, offers_technical_visit: true }],
  };

  return {
    calls,
    from(table: string) {
      calls.from.push(table);
      const filters: Array<{ field: string; value: unknown; op: "eq" | "in" | "ilike" }> = [];
      let mutationRow: Record<string, unknown> | null = null;
      const api = {
        select(columns: string) {
          calls.selects.push({ table, columns });
          return api;
        },
        insert(payload: Record<string, unknown>) {
          mutationRow = table === "store_assistant_operational_tasks" ? { ...payload, id: "task-created" } : payload;
          calls.upserts.push(payload);
          if (!(table === "store_assistant_operational_tasks" && args?.taskInsertError) && tableRows[table]) {
            tableRows[table].push(mutationRow);
          }
          if (table === "store_assistant_operational_tasks" && args?.taskInsertError && args.concurrentOperationalTasks) {
            tableRows[table].push(...args.concurrentOperationalTasks);
          }
          return api;
        },
        update(payload: Record<string, unknown>) {
          mutationRow = payload;
          calls.upserts.push(payload);
          return api;
        },
        eq(field: string, value: unknown) {
          filters.push({ field, value, op: "eq" });
          calls.filters.push({ table, field, op: "eq" });
          return api;
        },
        in(field: string, value: unknown) {
          filters.push({ field, value, op: "in" });
          calls.filters.push({ table, field, op: "in" });
          return api;
        },
        ilike(field: string, value: unknown) {
          filters.push({ field, value, op: "ilike" });
          calls.filters.push({ table, field, op: "ilike" });
          return api;
        },
        order(column: string) {
          calls.order.push({ table, column });
          return api;
        },
        limit(_value: number) {
          if (table === "conversations" && args?.conversationsError) {
            return Promise.resolve({
              data: null,
              error: { message: args.conversationsError },
            });
          }
          return Promise.resolve({ data: filterRows(), error: null });
        },
        maybeSingle() {
          if (mutationRow && table === "store_assistant_operational_tasks" && args?.taskInsertError) {
            return Promise.resolve({ data: null, error: args.taskInsertError });
          }
          if (mutationRow && args?.mutationError) {
            return Promise.resolve({ data: null, error: { message: args.mutationError } });
          }
          if (mutationRow) {
            return Promise.resolve({ data: mutationRow, error: null });
          }
          return Promise.resolve({ data: filterRows()[0] || null, error: null });
        },
      };

      function filterRows() {
        return (tableRows[table] || []).filter((row) => {
          return filters.every((filter) => {
            const rowValue = row[filter.field];
            if (filter.op === "eq") return rowValue === filter.value;
            if (filter.op === "in") return Array.isArray(filter.value) && filter.value.includes(rowValue);
            if (filter.op === "ilike") {
              const needle = String(filter.value || "").replace(/%/g, "").toLowerCase();
              return String(rowValue || "").toLowerCase().includes(needle);
            }
            return true;
          });
        });
      }

      return api;
    },
    rpc(name: string, params: Record<string, unknown>) {
      calls.rpc.push({ name, params });
      if (name === "create_store_appointment_with_commercial_context") {
        return Promise.resolve({ data: args?.writerData || {}, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function getBuildStoreBlockSource(source: string) {
  const start = source.indexOf("function buildStoreBlock(");
  assert.equal(start > -1, true, "buildStoreBlock not found");
  const end = source.indexOf("function sortAssistantMessagesChronologically", start);
  assert.equal(end > start, true, "buildStoreBlock end not found");
  return source.slice(start, end);
}

function getGenerateAssistantReplySource(source: string) {
  const start = source.indexOf("async function generateAssistantReply(");
  assert.equal(start > -1, true, "generateAssistantReply not found");
  const end = source.indexOf("export function createAssistantReplyPostHandler", start);
  assert.equal(end > start, true, "generateAssistantReply end not found");
  return source.slice(start, end);
}

function getResolveAppointmentActionReplySource(source: string) {
  const start = source.indexOf("async function resolveAppointmentActionReply(");
  assert.equal(start > -1, true, "resolveAppointmentActionReply not found");
  const end = source.indexOf(
    "function resolveExplicitCommercialOpportunityIdForAssistantTechnicalVisit",
    start,
  );
  assert.equal(end > start, true, "resolveAppointmentActionReply end not found");
  return source.slice(start, end);
}

function getFunctionSource(source: string, signature: string, nextSignature: string) {
  const start = source.indexOf(signature);
  assert.equal(start > -1, true, `${signature} not found`);
  const end = source.indexOf(nextSignature, start);
  assert.equal(end > start, true, `${signature} end not found`);
  return source.slice(start, end);
}

function readProjectFile(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const tests: TestCase[] = [
  {
    name: "assistant runtime store block uses canonical settings context instead of onboarding answers for canonical fields",
    run: () => {
      const source = readRouteSource();
      const block = getBuildStoreBlockSource(source);

      assert.equal(block.includes("storeContext.storeDescription"), true);
      assert.equal(block.includes("storeContext.storeServices"), true);
      assert.equal(block.includes("storeContext.city"), true);
      assert.equal(block.includes("storeContext.state"), true);
      assert.equal(block.includes("storeContext.serviceRegions"), true);
      assert.equal(block.includes("storeContext.offersInstallation"), true);
      assert.equal(block.includes("storeContext.offersTechnicalVisit"), true);
      assert.equal(block.includes("storeContext.acceptedPaymentMethods"), true);
      assert.equal(block.includes("storeContext.responsibleName"), true);
      assert.equal(block.includes("onboardingMap.accepted_payment_methods"), false);
      assert.equal(block.includes("onboardingMap.responsible_name"), false);
      assert.equal(block.includes("onboardingMap.offers_installation"), false);
      assert.equal(block.includes("onboardingMap.service_regions"), false);
    },
  },
  {
    name: "assistant runtime loads canonical store settings before building the model prompt",
    run: () => {
      const source = readRouteSource();
      const block = getGenerateAssistantReplySource(source);

      const strategyIndex = block.indexOf(
        '.rpc("read_store_strategy_settings_by_system"',
      );
      const operationIndex = block.indexOf('.from("store_operation_settings")');
      const paymentIndex = block.indexOf(
        '.rpc("read_store_payment_settings_by_system"',
      );
      const responsibleIndex = block.indexOf("loadCanonicalActivePrimaryStoreResponsible({");
      const contextIndex = block.indexOf("const runtimeStoreContext = buildRuntimeStoreContext({");
      const promptIndex = block.indexOf("const systemPrompt = buildSystemPrompt({");

      assert.equal(strategyIndex > -1, true);
      assert.equal(operationIndex > -1, true);
      assert.equal(paymentIndex > -1, true);
      assert.equal(block.includes('.from("store_strategy_settings")'), false);
      assert.equal(block.includes('.from("store_payment_settings")'), false);
      assert.equal(block.includes("normalizeSystemReaderRow(strategySettingsRows)"), true);
      assert.equal(block.includes("normalizeSystemReaderRow(paymentSettingsRows)"), true);
      assert.equal(responsibleIndex > -1, true);
      assert.equal(contextIndex > strategyIndex, true);
      assert.equal(contextIndex > operationIndex, true);
      assert.equal(contextIndex > paymentIndex, true);
      assert.equal(contextIndex > responsibleIndex, true);
      assert.equal(promptIndex > contextIndex, true);
      assert.equal(block.includes("storeContext: runtimeStoreContext"), true);
    },
  },
  {
    name: "strategy settings system reader migration preserves service-only scoped access",
    run: () => {
      const source = readProjectFile(
        "supabase/migrations/20260916203000_p9_store_strategy_settings_system_reader.sql",
      );

      assert.equal(
        source.includes("create or replace function public.read_store_strategy_settings_by_system"),
        true,
      );
      assert.equal(source.includes("returns table ("), true);
      assert.equal(source.includes("security definer"), true);
      assert.equal(
        source.includes("set search_path = pg_catalog, public, pg_temp"),
        true,
      );
      assert.equal(source.includes("set row_security = off"), true);
      assert.equal(source.includes("where strategy_row.organization_id = p_organization_id"), true);
      assert.equal(source.includes("and strategy_row.store_id = p_store_id"), true);
      assert.equal(
        source.includes("grant execute on function public.read_store_strategy_settings_by_system"),
        true,
      );
      assert.equal(source.includes(") to service_role;"), true);
      assert.equal(source.includes(") from authenticated;"), true);
      assert.equal(source.includes(") from anon;"), true);
      assert.equal(source.includes(") from public;"), true);
      assert.equal(
        source.includes("grant select on table public.store_strategy_settings to service_role"),
        false,
      );
      assert.equal(
        source.includes("grant select on table public.store_payment_settings to service_role"),
        false,
      );
    },
  },
  {
    name: "active account uses canonical tenant and ignores body tenant ids",
    run: async () => {
      const { createAssistantReplyPostHandler } = await loadRouteModule();
      const resolveCalls: Array<Record<string, unknown>> = [];
      const generateCalls: Array<Record<string, unknown>> = [];
      const handler = createAssistantReplyPostHandler({
        resolveAccess: async (params) => {
          resolveCalls.push({ requirement: params.requirement });
          return createGrantedAccess();
        },
        generateReply: async (params) => {
          generateCalls.push({
            organizationId: params.organizationId,
            storeId: params.storeId,
            requestUrl: params.request.url,
          });
          return {
            ok: true,
            reply: "Assistente pronta.",
            source: "test",
          } as any;
        },
      });

      const response = await handler(
        buildRequest({
          organizationId: "forged-org",
          storeId: "forged-store",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.reply, "Assistente pronta.");
      assert.deepEqual(resolveCalls, [{ requirement: "active" }]);
      assert.equal(generateCalls.length, 1);
      assert.deepEqual(generateCalls[0], {
        organizationId: "canonical-org",
        storeId: "canonical-store",
        requestUrl: "https://example.test/api/assistant/reply",
      });
    },
  },
  {
    name: "technical visit opportunity resolution fails closed without explicit opportunity",
    run: async () => {
      const { resolveAuthorizedCommercialOpportunityIdForAssistantTechnicalVisit } =
        await loadRouteModule();
      const supabase = createOpportunityLookupSupabase([]);

      const result = await resolveAuthorizedCommercialOpportunityIdForAssistantTechnicalVisit({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        openOperationalTasks: [],
      });

      assert.equal(result.ok, false);
      assert.equal(result.commercialOpportunityId, null);
      assert.equal(supabase.calls.length, 0);
    },
  },
  {
    name: "technical visit opportunity resolution fails closed for multiple opportunities",
    run: async () => {
      const { resolveAuthorizedCommercialOpportunityIdForAssistantTechnicalVisit } =
        await loadRouteModule();
      const supabase = createOpportunityLookupSupabase([]);

      const result = await resolveAuthorizedCommercialOpportunityIdForAssistantTechnicalVisit({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        openOperationalTasks: [
          commercialVisitTask("opportunity-a"),
          commercialVisitTask("opportunity-b"),
        ],
      });

      assert.equal(result.ok, false);
      assert.equal(result.commercialOpportunityId, null);
      assert.equal(supabase.calls.length, 0);
    },
  },
  {
    name: "technical visit opportunity resolution fails closed on foreign or mismatched opportunity",
    run: async () => {
      const { resolveAuthorizedCommercialOpportunityIdForAssistantTechnicalVisit } =
        await loadRouteModule();
      const foreignStoreSupabase = createOpportunityLookupSupabase([
        {
          id: "opportunity-a",
          organization_id: "org-1",
          store_id: "store-2",
          origin_lead_id: "lead-1",
          primary_conversation_id: "conv-1",
        },
      ]);
      const mismatchedLeadSupabase = createOpportunityLookupSupabase([
        {
          id: "opportunity-a",
          organization_id: "org-1",
          store_id: "store-1",
          origin_lead_id: "lead-2",
          primary_conversation_id: "conv-1",
        },
      ]);

      const foreignStore =
        await resolveAuthorizedCommercialOpportunityIdForAssistantTechnicalVisit({
          supabase: foreignStoreSupabase,
          organizationId: "org-1",
          storeId: "store-1",
          openOperationalTasks: [commercialVisitTask("opportunity-a")],
        });
      const mismatchedLead =
        await resolveAuthorizedCommercialOpportunityIdForAssistantTechnicalVisit({
          supabase: mismatchedLeadSupabase,
          organizationId: "org-1",
          storeId: "store-1",
          openOperationalTasks: [commercialVisitTask("opportunity-a")],
        });

      assert.equal(foreignStore.ok, false);
      assert.equal(foreignStore.commercialOpportunityId, null);
      assert.equal(mismatchedLead.ok, false);
      assert.equal(mismatchedLead.commercialOpportunityId, null);
    },
  },
  {
    name: "technical visit opportunity resolution accepts one authorized coherent opportunity",
    run: async () => {
      const { resolveAuthorizedCommercialOpportunityIdForAssistantTechnicalVisit } =
        await loadRouteModule();
      const supabase = createOpportunityLookupSupabase([
        {
          id: "opportunity-a",
          organization_id: "org-1",
          store_id: "store-1",
          origin_lead_id: "lead-1",
          primary_conversation_id: "conv-1",
        },
      ]);

      const result = await resolveAuthorizedCommercialOpportunityIdForAssistantTechnicalVisit({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        openOperationalTasks: [commercialVisitTask("opportunity-a")],
      });

      assert.equal(result.ok, true);
      assert.equal(result.commercialOpportunityId, "opportunity-a");
      assert.equal(result.leadId, "lead-1");
      assert.equal(result.conversationId, "conv-1");
      assert.equal(supabase.calls[0]?.table, "commercial_opportunities");
    },
  },
  {
    name: "technical visit creation returns before writer when opportunity is not authorized",
    run: () => {
      const source = readRouteSource();
      const block = getFunctionSource(
        source,
        "async function executeCreateAppointmentWithSafeIdentity(",
        "async function resolvePendingCustomerIdentityDisambiguationReply(",
      );
      const resolutionIndex = block.indexOf(
        "await resolveAuthorizedCommercialOpportunityIdForAssistantTechnicalVisit({",
      );
      const safeReturnIndex = block.indexOf(
        "preciso identificar a oportunidade correta antes",
      );
      const writerIndex = block.indexOf(
        '"create_store_appointment_with_commercial_context"',
      );
      const payloadIndex = block.indexOf(
        "p_commercial_opportunity_id: commercialOpportunityId",
      );

      assert.equal(resolutionIndex > -1, true);
      assert.equal(safeReturnIndex > resolutionIndex, true);
      assert.equal(writerIndex > safeReturnIndex, true);
      assert.equal(payloadIndex > writerIndex, true);
      assert.equal(block.includes("p_lead_id: commercialLeadId"), true);
      assert.equal(block.includes("p_conversation_id: commercialConversationId"), true);
      assert.equal(block.includes('p_source: "ai_operator"'), true);
      assert.equal(block.includes('p_source: "assistant_operational"'), false);
      assert.equal(block.includes("p_commercial_opportunity_id: null"), false);
    },
  },
  {
    name: "technical visit fail-closed opportunity resolver cannot be bypassed by candidate opportunity",
    run: async () => {
      const { executeCreateAppointmentWithSafeIdentity } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock();

      const reply = await executeCreateAppointmentWithSafeIdentity({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-technical-create",
        openOperationalTasks: [],
        createPayload: technicalVisitPayload(),
        identityCandidate: identityCandidate({ commercial_opportunity_id: "opportunity-b" }),
        lastHumanMessage: "agende visita tecnica para Joao",
        scheduleSettings: null,
      });

      assert.equal(reply.includes("oportunidade correta"), true);
      assert.equal(
        supabase.calls.rpc.some((call) => call.name === "create_store_appointment_with_commercial_context"),
        false,
      );
    },
  },
  {
    name: "technical visit candidate opportunity mismatch fails closed before writer",
    run: async () => {
      const { executeCreateAppointmentWithSafeIdentity } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        opportunities: [
          {
            id: "opportunity-a",
            organization_id: "org-1",
            store_id: "store-1",
            origin_lead_id: "lead-canon",
            primary_conversation_id: "conv-canon",
          },
        ],
      });

      const reply = await executeCreateAppointmentWithSafeIdentity({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-resumed-create",
        openOperationalTasks: [
          commercialVisitTask("opportunity-a", {
            related_lead_id: "lead-canon",
            related_conversation_id: "conv-canon",
          }),
        ],
        createPayload: technicalVisitPayload(),
        identityCandidate: identityCandidate({
          commercial_opportunity_id: "opportunity-b",
          lead_id: "lead-canon",
          conversation_id: "conv-canon",
        }),
        lastHumanMessage: "agende visita tecnica para Joao",
        scheduleSettings: null,
      });

      assert.equal(reply.includes("oportunidade correta"), true);
      assert.equal(
        supabase.calls.rpc.some((call) => call.name === "create_store_appointment_with_commercial_context"),
        false,
      );
    },
  },
  {
    name: "technical visit creates a durable customer-confirmation task before any writer",
    run: async () => {
      const { executeCreateAppointmentWithSafeIdentity } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        opportunities: [
          {
            id: "opportunity-a",
            organization_id: "org-1",
            store_id: "store-1",
            origin_lead_id: "lead-canon",
            primary_conversation_id: "conv-canon",
          },
        ],
        writerData: { id: null },
      });

      await executeCreateAppointmentWithSafeIdentity({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-technical-create",
        openOperationalTasks: [
          commercialVisitTask("opportunity-a", {
            related_lead_id: "lead-canon",
            related_conversation_id: "conv-canon",
          }),
        ],
        createPayload: technicalVisitPayload(),
        identityCandidate: identityCandidate({
          commercial_opportunity_id: "opportunity-a",
          lead_id: "lead-canon",
          conversation_id: "conv-canon",
        }),
        lastHumanMessage: "agende visita tecnica para Joao",
        scheduleSettings: null,
      });

      assert.equal(supabase.calls.rpc.some((call) => call.name === "create_store_appointment_with_commercial_context"), false);
      const taskInsert = supabase.calls.upserts.find((row) => row.task_type === "appointment_create_with_customer");
      assert.equal(taskInsert?.commercial_opportunity_id, "opportunity-a");
      assert.equal(taskInsert?.related_lead_id, "lead-canon");
      assert.equal(taskInsert?.related_conversation_id, "conv-canon");
    },
  },
  {
    name: "resumed create uses selected candidate opportunity in the durable task",
    run: async () => {
      const { executeCreateAppointmentWithSafeIdentity } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        opportunities: [
          {
            id: "opportunity-selected",
            organization_id: "org-1",
            store_id: "store-1",
            origin_lead_id: "lead-1",
            primary_conversation_id: "conv-1",
          },
        ],
        writerData: { id: "appointment-created" },
      });

      await executeCreateAppointmentWithSafeIdentity({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-resumed-create",
        openOperationalTasks: [],
        createPayload: technicalVisitPayload({
          scheduled_start: "2026-09-18T10:00:00-03:00",
          scheduled_end: "2026-09-18T11:00:00-03:00",
          address_text: "Rua General Francisco GlicÃ©rio, 130, Suzano - SP",
        }),
        identityCandidate: identityCandidate({
          commercial_opportunity_id: "opportunity-selected",
          lead_id: "lead-1",
          conversation_id: "conv-1",
        }),
        lastHumanMessage: "1",
        scheduleSettings: null,
      });

      assert.equal(supabase.calls.rpc.some((call) => call.name === "create_store_appointment_with_commercial_context"), false);
      assert.equal(supabase.calls.upserts.some((row) => row.commercial_opportunity_id === "opportunity-selected"), true);
    },
  },
  {
    name: "appointment create normal replay accepts equivalent instant with different timestamp format",
    run: async () => {
      const { executeCreateAppointmentWithSafeIdentity } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        opportunities: [{
          id: "opportunity-selected",
          organization_id: "org-1",
          store_id: "store-1",
          origin_lead_id: "lead-1",
          primary_conversation_id: "conv-1",
        }],
        operationalTasks: [
          appointmentCreateTaskRow({
            target_start_at: "2026-09-18 13:00:00+00",
            target_end_at: "2026-09-18 14:00:00+00",
          }),
        ],
      });

      const reply = await executeCreateAppointmentWithSafeIdentity({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-resumed-create",
        openOperationalTasks: [],
        createPayload: technicalVisitPayload({
          scheduled_start: "2026-09-18T13:00:00.000Z",
          scheduled_end: "2026-09-18T14:00:00.000Z",
        }),
        identityCandidate: identityCandidate({
          commercial_opportunity_id: "opportunity-selected",
          lead_id: "lead-1",
          conversation_id: "conv-1",
        }),
        lastHumanMessage: "1",
        scheduleSettings: null,
      });

      assert.match(reply, /ja foi enviada|continua aguardando resposta/);
      assert.equal(supabase.calls.upserts.some((row) => row.task_type === "appointment_create_with_customer"), false);
      assert.equal(supabase.calls.rpc.some((call) => call.name === "panel_send_message"), false);
    },
  },
  {
    name: "appointment create concurrent 23505 accepts equivalent instant with different timestamp format",
    run: async () => {
      const { executeCreateAppointmentWithSafeIdentity } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        opportunities: [{
          id: "opportunity-selected",
          organization_id: "org-1",
          store_id: "store-1",
          origin_lead_id: "lead-1",
          primary_conversation_id: "conv-1",
        }],
        taskInsertError: { code: "23505", message: "duplicate key value violates unique constraint" },
        concurrentOperationalTasks: [
          appointmentCreateTaskRow({
            target_start_at: "2026-09-18 13:00:00+00",
            target_end_at: "2026-09-18 14:00:00+00",
          }),
        ],
      });

      const reply = await executeCreateAppointmentWithSafeIdentity({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-resumed-create",
        openOperationalTasks: [],
        createPayload: technicalVisitPayload({
          scheduled_start: "2026-09-18T13:00:00.000Z",
          scheduled_end: "2026-09-18T14:00:00.000Z",
        }),
        identityCandidate: identityCandidate({
          commercial_opportunity_id: "opportunity-selected",
          lead_id: "lead-1",
          conversation_id: "conv-1",
        }),
        lastHumanMessage: "1",
        scheduleSettings: null,
      });

      assert.match(reply, /ja foi enviada|continua aguardando resposta/);
      assert.equal(supabase.calls.upserts.filter((row) => row.task_type === "appointment_create_with_customer").length, 1);
      assert.equal(supabase.calls.rpc.some((call) => call.name === "panel_send_message"), false);
    },
  },
  {
    name: "appointment create concurrent 23505 rejects different instant",
    run: async () => {
      const { executeCreateAppointmentWithSafeIdentity } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        opportunities: [{
          id: "opportunity-selected",
          organization_id: "org-1",
          store_id: "store-1",
          origin_lead_id: "lead-1",
          primary_conversation_id: "conv-1",
        }],
        taskInsertError: { code: "23505", message: "duplicate key value violates unique constraint" },
        concurrentOperationalTasks: [
          appointmentCreateTaskRow({
            target_start_at: "2026-09-18T13:01:00.000Z",
          }),
        ],
      });

      const reply = await executeCreateAppointmentWithSafeIdentity({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-resumed-create",
        openOperationalTasks: [],
        createPayload: technicalVisitPayload({
          scheduled_start: "2026-09-18T13:00:00.000Z",
          scheduled_end: "2026-09-18T14:00:00.000Z",
        }),
        identityCandidate: identityCandidate({
          commercial_opportunity_id: "opportunity-selected",
          lead_id: "lead-1",
          conversation_id: "conv-1",
        }),
        lastHumanMessage: "1",
        scheduleSettings: null,
      });

      assert.match(reply, /nao consegui confirmar a task operacional com seguranca/i);
      assert.equal(supabase.calls.rpc.some((call) => call.name === "panel_send_message"), false);
    },
  },
  {
    name: "appointment create concurrent 23505 rejects invalid timestamp",
    run: async () => {
      const { executeCreateAppointmentWithSafeIdentity } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        opportunities: [{
          id: "opportunity-selected",
          organization_id: "org-1",
          store_id: "store-1",
          origin_lead_id: "lead-1",
          primary_conversation_id: "conv-1",
        }],
        taskInsertError: { code: "23505", message: "duplicate key value violates unique constraint" },
        concurrentOperationalTasks: [
          appointmentCreateTaskRow({
            target_start_at: "not-a-timestamp",
          }),
        ],
      });

      const reply = await executeCreateAppointmentWithSafeIdentity({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-resumed-create",
        openOperationalTasks: [],
        createPayload: technicalVisitPayload({
          scheduled_start: "2026-09-18T13:00:00.000Z",
          scheduled_end: "2026-09-18T14:00:00.000Z",
        }),
        identityCandidate: identityCandidate({
          commercial_opportunity_id: "opportunity-selected",
          lead_id: "lead-1",
          conversation_id: "conv-1",
        }),
        lastHumanMessage: "1",
        scheduleSettings: null,
      });

      assert.match(reply, /nao consegui confirmar a task operacional com seguranca/i);
      assert.equal(supabase.calls.rpc.some((call) => call.name === "panel_send_message"), false);
    },
  },
  {
    name: "appointment create concurrent 23505 fails closed when refetched identity diverges",
    run: async () => {
      const { executeCreateAppointmentWithSafeIdentity } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        opportunities: [{
          id: "opportunity-selected",
          organization_id: "org-1",
          store_id: "store-1",
          origin_lead_id: "lead-1",
          primary_conversation_id: "conv-1",
        }],
        taskInsertError: { code: "23505", message: "duplicate key value violates unique constraint" },
        concurrentOperationalTasks: [
          appointmentCreateTaskRow({
            related_conversation_id: "conv-other",
          }),
        ],
      });

      const reply = await executeCreateAppointmentWithSafeIdentity({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-resumed-create",
        openOperationalTasks: [],
        createPayload: technicalVisitPayload({
          scheduled_start: "2026-09-18T13:00:00.000Z",
          scheduled_end: "2026-09-18T14:00:00.000Z",
        }),
        identityCandidate: identityCandidate({
          commercial_opportunity_id: "opportunity-selected",
          lead_id: "lead-1",
          conversation_id: "conv-1",
        }),
        lastHumanMessage: "1",
        scheduleSettings: null,
      });

      assert.match(reply, /nao consegui confirmar a task operacional com seguranca/i);
      assert.equal(supabase.calls.rpc.some((call) => call.name === "panel_send_message"), false);
    },
  },
  {
    name: "customer identity loader does not silently choose latest opportunity or conversation",
    run: async () => {
      const { loadAssistantCustomerIdentityCandidates } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        leads: [{ id: "lead-1", organization_id: "org-1", store_id: "store-1", name: "Joao", phone: "+55 11 99999-0207" }],
        conversations: [
          { id: "conv-new", organization_id: "org-1", store_id: "store-1", lead_id: "lead-1", created_at: "2026-09-17T10:00:00Z" },
          { id: "conv-old", organization_id: "org-1", store_id: "store-1", lead_id: "lead-1", created_at: "2026-09-16T10:00:00Z" },
        ],
        opportunities: [
          {
            id: "opportunity-new",
            organization_id: "org-1",
            store_id: "store-1",
            customer_id: "customer-1",
            origin_lead_id: "lead-1",
            primary_conversation_id: "conv-new",
            stage: "proposta",
            updated_at: "2026-09-17T10:00:00Z",
          },
          {
            id: "opportunity-old",
            organization_id: "org-1",
            store_id: "store-1",
            customer_id: "customer-1",
            origin_lead_id: "lead-1",
            primary_conversation_id: "conv-old",
            stage: "qualificacao",
            updated_at: "2026-09-16T10:00:00Z",
          },
        ],
      });

      const result = await loadAssistantCustomerIdentityCandidates({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        requestedName: "Joao",
      });

      assert.equal(result.ok, true);
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0].commercial_opportunity_id, null);
      assert.equal(result.candidates[0].conversation_id, null);
      assert.equal(supabase.calls.order.length, 0);
      const conversationSelect = supabase.calls.selects.find(
        (call) => call.table === "conversations",
      );
      assert.equal(conversationSelect?.columns.includes("store_id"), false);
      assert.equal(
        supabase.calls.filters.some(
          (filter) => filter.table === "conversations" && filter.field === "store_id",
        ),
        false,
      );
    },
  },
  {
    name: "customer identity loader keeps only leads authorized by organization and store",
    run: async () => {
      const { loadAssistantCustomerIdentityCandidates } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        leads: [
          { id: "lead-current", organization_id: "org-1", store_id: "store-1", name: "Joao" },
          { id: "lead-other-store", organization_id: "org-1", store_id: "store-2", name: "Joao" },
          { id: "lead-other-org", organization_id: "org-2", store_id: "store-1", name: "Joao" },
        ],
        conversations: [
          { id: "conv-current", organization_id: "org-1", lead_id: "lead-current" },
        ],
      });

      const result = await loadAssistantCustomerIdentityCandidates({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        requestedName: "Joao",
      });

      assert.equal(result.ok, true);
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0]?.lead_id, "lead-current");
      assert.equal(
        supabase.calls.filters.some(
          (filter) => filter.table === "leads" && filter.field === "store_id",
        ),
        true,
      );
      assert.equal(
        supabase.calls.filters.some(
          (filter) => filter.table === "conversations" && filter.field === "store_id",
        ),
        false,
      );
    },
  },
  {
    name: "customer identity conversation lookup failure is sanitized publicly",
    run: async () => {
      const { resolveSafeCustomerIdentityGate } = await loadRouteModule();
      const privateSqlError = "column conversations.store_id does not exist SQL_SENTINEL";
      const supabase = createAssistantRouteSupabaseMock({
        leads: [
          { id: "lead-1", organization_id: "org-1", store_id: "store-1", name: "Joao" },
        ],
        conversationsError: privateSqlError,
      });

      const result = await resolveSafeCustomerIdentityGate({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        assistantContextState: null,
        requestedName: "Joao",
        originalAction: "create",
        originalPayload: technicalVisitPayload(),
        lastHumanMessage: "Agende uma visita tecnica para Joao",
        scheduleTimezone: "America/Sao_Paulo",
      });

      assert.equal(result.type, "blocked");
      assert.equal(String(result.reply).includes(privateSqlError), false);
      assert.equal(String(result.reply).includes("store_id"), false);
      assert.equal(String(result.reply).includes("Tente novamente"), true);
    },
  },
  {
    name: "customer identity disambiguation expiration is fail-closed for missing and invalid expires_at",
    run: async () => {
      const { isAssistantContextExpired } = await loadRouteModule();
      const activeContext = {
        active_topic: "customer_identity_disambiguation",
        active_status: "waiting_user_choice",
      } as any;

      assert.equal(isAssistantContextExpired(activeContext), true);
      assert.equal(isAssistantContextExpired({ ...activeContext, expires_at: "not-a-date" }), true);
      assert.equal(
        isAssistantContextExpired(
          { ...activeContext, expires_at: "2026-09-17T12:20:00.000Z" },
          new Date("2026-09-17T12:00:00.000Z"),
        ),
        false,
      );
    },
  },
  {
    name: "expired customer identity pending context is resolved and cannot trigger side effects",
    run: async () => {
      const { resolvePendingCustomerIdentityDisambiguationReply } = await loadRouteModule();
      const expiredVariants = [
        { label: "past", expires_at: "2026-09-17T11:00:00.000Z" },
        { label: "missing" },
        { label: "invalid", expires_at: "not-a-date" },
      ];

      for (const variant of expiredVariants) {
        const supabase = createAssistantRouteSupabaseMock();
        const reply = await resolvePendingCustomerIdentityDisambiguationReply({
          supabase,
          organizationId: "org-1",
          storeId: "store-1",
          threadId: "thread-1",
          assistantContextState: {
            id: `context-${variant.label}`,
            active_topic: "customer_identity_disambiguation",
            active_status: "waiting_user_choice",
            active_intent: "create",
            active_customer_name: "Joao",
            expires_at: variant.expires_at,
            candidate_options: [identityCandidate()],
            context_payload: {
              original_action: "create",
              original_payload: technicalVisitPayload(),
              original_user_message: "agende visita tecnica para Joao",
            },
          } as any,
          openOperationalTasks: [
            commercialVisitTask("opportunity-a", {
              related_lead_id: "lead-1",
              related_conversation_id: "conv-1",
            }),
          ],
          lastHumanMessage: "1",
          operatorName: "Brian",
          scheduleSettings: null,
        });
        const resolvedPatch = supabase.calls.upserts[0];

        assert.equal(String(reply).includes("contexto pendente de identificacao do cliente expirou"), true);
        assert.equal(resolvedPatch?.active_status, "resolved");
        assert.deepEqual(resolvedPatch?.candidate_options, []);
        assert.deepEqual(resolvedPatch?.context_payload, {
          resolved_reason: "action_completed_or_context_closed",
        });
        assert.equal(
          supabase.calls.rpc.some((call) => call.name === "create_store_appointment_with_commercial_context"),
          false,
        );
        assert.equal(
          supabase.calls.rpc.some((call) => call.name === "panel_send_message"),
          false,
        );
      }
    },
  },
  {
    name: "expired customer identity pending context fails closed when resolution update fails",
    run: async () => {
      const { resolvePendingCustomerIdentityDisambiguationReply } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        mutationError: "context update failed",
      });

      const reply = await resolvePendingCustomerIdentityDisambiguationReply({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-1",
        assistantContextState: {
          id: "context-expired",
          active_topic: "customer_identity_disambiguation",
          active_status: "waiting_user_choice",
          active_intent: "create",
          active_customer_name: "Joao",
          expires_at: "2026-09-17T11:00:00.000Z",
          candidate_options: [identityCandidate()],
          context_payload: {
            original_action: "create",
            original_payload: technicalVisitPayload(),
            original_user_message: "agende visita tecnica para Joao",
          },
        } as any,
        openOperationalTasks: [commercialVisitTask("opportunity-a")],
        lastHumanMessage: "1",
        operatorName: "Brian",
        scheduleSettings: null,
      });

      assert.equal(String(reply).includes("nao consegui encerra-lo com seguranca"), true);
      assert.equal(String(reply).includes("repita a acao"), false);
      assert.equal(
        supabase.calls.rpc.some((call) => call.name === "create_store_appointment_with_commercial_context"),
        false,
      );
      assert.equal(
        supabase.calls.rpc.some((call) => call.name === "panel_send_message"),
        false,
      );
      assert.equal(
        supabase.calls.from.includes("store_assistant_operational_tasks"),
        false,
      );
    },
  },
  {
    name: "expired customer identity gate blocks without lookup when resolution update fails",
    run: async () => {
      const { resolveSafeCustomerIdentityGate } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        mutationError: "context update failed",
        leads: [{ id: "lead-1", organization_id: "org-1", store_id: "store-1", name: "Joao" }],
      });

      const result = await resolveSafeCustomerIdentityGate({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-1",
        assistantContextState: {
          id: "context-expired",
          active_topic: "customer_identity_disambiguation",
          active_status: "waiting_user_choice",
          active_intent: "create",
          active_customer_name: "Joao",
          expires_at: "2026-09-17T11:00:00.000Z",
          candidate_options: [identityCandidate()],
          context_payload: {
            original_action: "create",
            original_payload: technicalVisitPayload(),
          },
        } as any,
        requestedName: "Joao",
        originalAction: "create",
        originalPayload: technicalVisitPayload(),
        lastHumanMessage: "agende visita tecnica para Joao",
        operatorName: "Brian",
        scheduleTimezone: "America/Sao_Paulo",
      });

      assert.equal(result.type, "blocked");
      assert.equal(result.reply.includes("nao consegui encerra-lo com seguranca"), true);
      assert.equal(supabase.calls.from.includes("leads"), false);
      assert.equal(
        supabase.calls.upserts.some((patch) => patch.active_topic === "customer_identity_disambiguation" && patch.active_status === "waiting_user_choice"),
        false,
      );
      assert.equal(supabase.calls.rpc.length, 0);
    },
  },
  {
    name: "expired customer identity context without thread id fails closed",
    run: async () => {
      const { resolvePendingCustomerIdentityDisambiguationReply } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock();

      const reply = await resolvePendingCustomerIdentityDisambiguationReply({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: null,
        assistantContextState: {
          id: "context-expired",
          active_topic: "customer_identity_disambiguation",
          active_status: "waiting_user_choice",
          active_intent: "create",
          active_customer_name: "Joao",
          expires_at: "2026-09-17T11:00:00.000Z",
          candidate_options: [identityCandidate()],
          context_payload: {
            original_action: "create",
            original_payload: technicalVisitPayload(),
          },
        } as any,
        lastHumanMessage: "1",
        scheduleSettings: null,
      });

      assert.equal(String(reply).includes("nao consegui encerra-lo com seguranca"), true);
      assert.equal(String(reply).includes("THREAD_ID_MISSING"), false);
      assert.equal(String(reply).includes("Tente novamente"), true);
      assert.equal(supabase.calls.upserts.length, 0);
      assert.equal(supabase.calls.rpc.length, 0);
    },
  },
  {
    name: "after expired identity context is resolved repeated create starts a new disambiguation",
    run: async () => {
      const {
        resolvePendingCustomerIdentityDisambiguationReply,
        resolveSafeCustomerIdentityGate,
      } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        leads: [
          { id: "lead-1", organization_id: "org-1", store_id: "store-1", name: "Joao", phone: "+55 11 99999-0207" },
          { id: "lead-2", organization_id: "org-1", store_id: "store-1", name: "Joao", phone: "+55 11 98888-4831" },
        ],
        conversations: [
          { id: "conv-1", organization_id: "org-1", store_id: "store-1", lead_id: "lead-1" },
          { id: "conv-2", organization_id: "org-1", store_id: "store-1", lead_id: "lead-2" },
        ],
      });

      const expiredReply = await resolvePendingCustomerIdentityDisambiguationReply({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-1",
        assistantContextState: {
          id: "context-expired",
          active_topic: "customer_identity_disambiguation",
          active_status: "waiting_user_choice",
          active_intent: "create",
          active_customer_name: "Joao",
          expires_at: "2026-09-17T11:00:00.000Z",
          candidate_options: [identityCandidate()],
          context_payload: {
            original_action: "create",
            original_payload: technicalVisitPayload(),
            original_user_message: "agende visita tecnica para Joao",
          },
        } as any,
        lastHumanMessage: "Agende uma visita tecnica para Joao no dia 18/09/2026 as 10:00.",
        scheduleSettings: null,
      });

      const repeatedResult = await resolveSafeCustomerIdentityGate({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-1",
        assistantContextState: null,
        requestedName: "Joao",
        originalAction: "create",
        originalPayload: technicalVisitPayload(),
        lastHumanMessage: "Agende uma visita tecnica para Joao no dia 18/09/2026 as 10:00.",
        operatorName: "Brian",
        scheduleTimezone: "America/Sao_Paulo",
      });
      const resolvedPatch = supabase.calls.upserts[0];
      const newContextPatch = supabase.calls.upserts[1];
      const expiresMs = new Date(String(newContextPatch?.expires_at || "")).getTime();

      assert.equal(String(expiredReply).includes("expirou"), true);
      assert.equal(resolvedPatch?.active_status, "resolved");
      assert.equal(repeatedResult.type, "blocked");
      assert.equal(newContextPatch?.active_topic, "customer_identity_disambiguation");
      assert.equal(newContextPatch?.active_status, "waiting_user_choice");
      assert.equal(Array.isArray(newContextPatch?.candidate_options), true);
      assert.equal((newContextPatch?.candidate_options as unknown[]).length, 2);
      assert.equal(Number.isFinite(expiresMs), true);
      assert.equal(
        supabase.calls.rpc.some((call) => call.name === "create_store_appointment_with_commercial_context"),
        false,
      );
    },
  },
  {
    name: "future customer identity pending context stays active when no candidate is selected",
    run: async () => {
      const { resolvePendingCustomerIdentityDisambiguationReply } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock();

      const reply = await resolvePendingCustomerIdentityDisambiguationReply({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-1",
        assistantContextState: {
          id: "context-valid",
          active_topic: "customer_identity_disambiguation",
          active_status: "waiting_user_choice",
          active_intent: "create",
          active_customer_name: "Joao",
          expires_at: "2099-09-17T12:30:00.000Z",
          candidate_options: [
            identityCandidate({ option_number: 1, lead_id: "lead-1", customer_phone: "+55 11 99999-0207" }),
            identityCandidate({ option_number: 2, lead_id: "lead-2", customer_phone: "+55 11 98888-4831" }),
          ],
          context_payload: {
            original_action: "create",
            original_payload: technicalVisitPayload({ appointment_type: "meeting" }),
            original_user_message: "agende reuniao para Joao",
          },
        } as any,
        lastHumanMessage: "qual deles mesmo?",
        operatorName: "Brian",
        scheduleSettings: null,
      });

      assert.equal(String(reply).includes("Qual deles voce quer?"), true);
      assert.equal(supabase.calls.upserts.length, 0);
      assert.equal(supabase.calls.rpc.length, 0);
    },
  },
  {
    name: "ambiguous customer identity context persists expires_at around thirty minutes",
    run: async () => {
      const { resolveSafeCustomerIdentityGate } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        leads: [
          { id: "lead-1", organization_id: "org-1", store_id: "store-1", name: "Joao", phone: "+55 11 99999-0207" },
          { id: "lead-2", organization_id: "org-1", store_id: "store-1", name: "Joao", phone: "+55 11 98888-4831" },
        ],
        conversations: [
          { id: "conv-1", organization_id: "org-1", store_id: "store-1", lead_id: "lead-1" },
          { id: "conv-2", organization_id: "org-1", store_id: "store-1", lead_id: "lead-2" },
        ],
      });
      const before = Date.now();

      const result = await resolveSafeCustomerIdentityGate({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-1",
        assistantContextState: null,
        requestedName: "Joao",
        originalAction: "create",
        originalPayload: technicalVisitPayload(),
        lastHumanMessage: "agende visita tecnica para Joao",
        operatorName: "Brian",
        scheduleTimezone: "America/Sao_Paulo",
      });
      const after = Date.now();
      const persisted = supabase.calls.upserts[0];
      const expiresMs = new Date(String(persisted?.expires_at || "")).getTime();

      assert.equal(result.type, "blocked");
      assert.equal(persisted?.active_topic, "customer_identity_disambiguation");
      assert.equal(Number.isFinite(expiresMs), true);
      assert.equal(expiresMs >= before + 29 * 60 * 1000, true);
      assert.equal(expiresMs <= after + 31 * 60 * 1000, true);
      assert.equal(
        supabase.calls.rpc.some((call) => call.name === "create_store_appointment_with_commercial_context"),
        false,
      );
    },
  },
  {
    name: "customer identity pending choice resumes original create payload exactly",
    run: async () => {
      const { resolvePendingCustomerIdentityDisambiguationReply } = await loadRouteModule();
      const originalPayload = technicalVisitPayload({
        title: "Visita tecnica original",
        scheduled_start: "2026-09-18T13:00:00.000Z",
        scheduled_end: "2026-09-18T14:00:00.000Z",
      });
      const supabase = createAssistantRouteSupabaseMock({
        opportunities: [
          {
            id: "opportunity-a",
            organization_id: "org-1",
            store_id: "store-1",
            origin_lead_id: "lead-canon",
            primary_conversation_id: "conv-canon",
          },
        ],
        writerData: { id: null },
      });

      await resolvePendingCustomerIdentityDisambiguationReply({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-pending-create",
        assistantContextState: {
          active_topic: "customer_identity_disambiguation",
          active_status: "waiting_user_choice",
          active_intent: "create",
          active_customer_name: "Joao",
          expires_at: "2099-09-17T12:30:00.000Z",
          candidate_options: [
            identityCandidate({
              option_number: 1,
              commercial_opportunity_id: "opportunity-a",
              lead_id: "lead-canon",
              conversation_id: "conv-canon",
            }),
          ],
          context_payload: {
            original_action: "create",
            original_payload: originalPayload,
            original_user_message: "agende visita tecnica para Joao",
          },
        } as any,
        openOperationalTasks: [
          commercialVisitTask("opportunity-a", {
            related_lead_id: "lead-canon",
            related_conversation_id: "conv-canon",
          }),
        ],
        lastHumanMessage: "1",
        operatorName: "Brian",
        scheduleSettings: null,
      });

      assert.equal(supabase.calls.rpc.some((call) => call.name === "create_store_appointment_with_commercial_context"), false);
      const taskInsert = supabase.calls.upserts.find((row) => row.task_type === "appointment_create_with_customer");
      assert.equal((taskInsert?.task_payload as Record<string, unknown>)?.title, originalPayload.title);
      assert.equal(taskInsert?.target_start_at, originalPayload.scheduled_start);
      assert.equal(taskInsert?.target_end_at, originalPayload.scheduled_end);
      assert.equal((taskInsert?.task_payload as Record<string, unknown>)?.address_text, originalPayload.address_text);
    },
  },
  {
    name: "customer identity gate runs before create appointment writer",
    run: () => {
      const source = readRouteSource();
      const block = getResolveAppointmentActionReplySource(source);
      const gateIndex = block.indexOf("await resolveSafeCustomerIdentityGate({");
      const blockedReturnIndex = block.indexOf('if (identityGate.type === "blocked")');
      const executeIndex = block.indexOf("return executeCreateAppointmentWithSafeIdentity({");
      const legacyWriterIndex = block.indexOf('"create_store_appointment_with_commercial_context"');

      assert.equal(gateIndex > -1, true);
      assert.equal(blockedReturnIndex > gateIndex, true);
      assert.equal(executeIndex > blockedReturnIndex, true);
      assert.equal(legacyWriterIndex, -1);
      assert.equal(block.includes("originalAction: \"create\""), true);
      assert.equal(block.includes("originalPayload: createPayload.payload"), true);
    },
  },
  {
    name: "ambiguous customer identity persists original action and candidates before side effects",
    run: () => {
      const source = readRouteSource();
      const gate = getFunctionSource(
        source,
        "async function resolveSafeCustomerIdentityGate(",
        "async function executeCreateAppointmentWithSafeIdentity(",
      );
      const upsertIndex = gate.indexOf("await upsertAssistantContextState({");
      const blockedReplyIndex = gate.indexOf("buildCustomerIdentityDisambiguationReply({");

      assert.equal(gate.includes('active_topic: "customer_identity_disambiguation"'), true);
      assert.equal(gate.includes('active_status: "waiting_user_choice"'), true);
      assert.equal(gate.includes("candidate_options: loaded.candidates"), true);
      assert.equal(gate.includes("original_payload: args.originalPayload"), true);
      assert.equal(gate.includes("original_user_message: args.lastHumanMessage"), true);
      assert.equal(upsertIndex > -1, true);
      assert.equal(blockedReplyIndex > upsertIndex, true);
      assert.equal(gate.includes('"create_store_appointment_with_commercial_context"'), false);
      assert.equal(gate.includes("panel_send_message"), false);
    },
  },
  {
    name: "customer identity candidate UX masks phone and does not render internal ids",
    run: () => {
      const source = readRouteSource();
      const lineBuilder = getFunctionSource(
        source,
        "function buildCustomerIdentityCandidateLine(",
        "function buildCustomerIdentityDisambiguationReply(",
      );
      const replyBuilder = getFunctionSource(
        source,
        "function buildCustomerIdentityDisambiguationReply(",
        "function buildCustomerIdentityNeedsMoreInfoReply(",
      );

      assert.equal(lineBuilder.includes("maskPhoneForAssistantIdentity(candidate.customer_phone)"), true);
      assert.equal(lineBuilder.includes("candidate.customer_id"), false);
      assert.equal(lineBuilder.includes("candidate.lead_id"), false);
      assert.equal(lineBuilder.includes("candidate.conversation_id"), false);
      assert.equal(lineBuilder.includes("candidate.commercial_opportunity_id"), false);
      assert.equal(replyBuilder.includes("Qual deles voce quer?"), true);
    },
  },
  {
    name: "customer identity selection resolves against stored candidates and preserves create intent",
    run: () => {
      const source = readRouteSource();
      const pending = getFunctionSource(
        source,
        "async function resolvePendingCustomerIdentityDisambiguationReply(",
        "function extractReschedulePayload(",
      );

      assert.equal(pending.includes("readAssistantCustomerIdentityCandidates(contextState)"), true);
      assert.equal(pending.includes("resolveCustomerIdentityCandidateFromText({"), true);
      assert.equal(pending.includes('originalAction !== "create"'), true);
      assert.equal(pending.includes("contextPayload.original_payload"), true);
      assert.equal(pending.includes("executeCreateAppointmentWithSafeIdentity({"), true);
      assert.equal(pending.includes("identityCandidate: selectedCandidate"), true);
      assert.equal(pending.includes("appointment_reschedule_with_customer"), false);
    },
  },
  {
    name: "create appointment extracts customer from para Joao request",
    run: async () => {
      const { extractCustomerNameFromText } = await loadRouteModule();

      assert.equal(
        extractCustomerNameFromText("Agende uma visita tecnica para Joao no dia 18/09/2026 as 10:00."),
        "Joao",
      );
    },
  },
  {
    name: "exact imperative technical visit enters identity gate with zero side effects",
    run: async () => {
      const { resolveSafeCustomerIdentityGate } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        leads: [
          { id: "lead-1", organization_id: "org-1", store_id: "store-1", name: "Joao", phone: "+55 11 99999-0207" },
          { id: "lead-2", organization_id: "org-1", store_id: "store-1", name: "Joao", phone: "+55 11 98888-4831" },
        ],
        conversations: [
          { id: "conv-1", organization_id: "org-1", store_id: "store-1", lead_id: "lead-1" },
          { id: "conv-2", organization_id: "org-1", store_id: "store-1", lead_id: "lead-2" },
        ],
      });
      const message = "Agende uma visita técnica para João no dia 19/09/2026 às 10:00, no endereço Rua General Francisco Glicério, 130, Suzano - SP.";
      const result = await resolveSafeCustomerIdentityGate({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-1",
        assistantContextState: null,
        requestedName: "Joao",
        originalAction: "create",
        originalPayload: {
          title: "Visita técnica",
          appointment_type: "technical_visit",
          customer_name: "João",
          scheduled_start: "2026-09-19T10:00:00-03:00",
          scheduled_end: "2026-09-19T11:00:00-03:00",
          address_text: "Rua General Francisco Glicério, 130, Suzano - SP",
        },
        lastHumanMessage: message,
        operatorName: "Brian",
        scheduleTimezone: "America/Sao_Paulo",
      });

      assert.equal(result.type, "blocked");
      assert.equal(String(result.reply).includes("1."), true);
      assert.equal(String(result.reply).includes("2."), true);
      assert.equal(supabase.calls.rpc.some((call) => call.name === "create_store_appointment_with_commercial_context"), false);
      assert.equal(supabase.calls.rpc.some((call) => call.name === "panel_send_message"), false);
      assert.equal(supabase.calls.from.includes("store_assistant_operational_tasks"), false);
      assert.equal(supabase.calls.upserts.some((patch) => patch.active_topic === "customer_identity_disambiguation"), true);
    },
  },
  {
    name: "real two Joao regression stays ambiguous before any appointment or outbound",
    run: async () => {
      const { resolveSafeCustomerIdentityGate } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock({
        leads: [
          {
            id: "44ac7092-3e55-4888-8623-745633ed3321",
            organization_id: "b02252ce-0e73-4371-9e23-f1009e7b1698",
            store_id: "6ac8f4b1-e50f-42c0-9cae-78951d6daf7b",
            name: "Joao",
            phone: "5511999000207",
          },
          {
            id: "0de14327-b226-4bd2-b2e3-0afd459efd00",
            organization_id: "b02252ce-0e73-4371-9e23-f1009e7b1698",
            store_id: "6ac8f4b1-e50f-42c0-9cae-78951d6daf7b",
            name: "Joao",
            phone: "5511999000999",
          },
        ],
        conversations: [
          {
            id: "1b486f6d-a061-4f56-89f5-8e0a3965b03a",
            organization_id: "b02252ce-0e73-4371-9e23-f1009e7b1698",
            lead_id: "44ac7092-3e55-4888-8623-745633ed3321",
          },
          {
            id: "bbb381a7-a711-4f79-8060-15162a2362ee",
            organization_id: "b02252ce-0e73-4371-9e23-f1009e7b1698",
            lead_id: "0de14327-b226-4bd2-b2e3-0afd459efd00",
          },
        ],
        opportunities: [
          {
            id: "0796eb5d-df71-5338-ab70-b15fcb67113a",
            organization_id: "b02252ce-0e73-4371-9e23-f1009e7b1698",
            store_id: "6ac8f4b1-e50f-42c0-9cae-78951d6daf7b",
            customer_id: "customer-1",
            origin_lead_id: "44ac7092-3e55-4888-8623-745633ed3321",
            primary_conversation_id: "1b486f6d-a061-4f56-89f5-8e0a3965b03a",
            stage: "qualificacao",
          },
          {
            id: "opportunity-old-joao",
            organization_id: "b02252ce-0e73-4371-9e23-f1009e7b1698",
            store_id: "6ac8f4b1-e50f-42c0-9cae-78951d6daf7b",
            customer_id: "customer-2",
            origin_lead_id: "0de14327-b226-4bd2-b2e3-0afd459efd00",
            primary_conversation_id: "bbb381a7-a711-4f79-8060-15162a2362ee",
            stage: "qualificacao",
          },
        ],
      });

      const result = await resolveSafeCustomerIdentityGate({
        supabase,
        organizationId: "b02252ce-0e73-4371-9e23-f1009e7b1698",
        storeId: "6ac8f4b1-e50f-42c0-9cae-78951d6daf7b",
        threadId: "thread-real-regression",
        assistantContextState: null,
        requestedName: "Joao",
        originalAction: "create",
        originalPayload: technicalVisitPayload({
          scheduled_start: "2026-09-18T10:00:00-03:00",
          scheduled_end: "2026-09-18T11:00:00-03:00",
          address_text: "Rua General Francisco GlicÃ©rio, 130, Suzano - SP",
        }),
        lastHumanMessage: "Agende uma visita tecnica para Joao",
        scheduleTimezone: "America/Sao_Paulo",
      });

      assert.equal(result.type, "blocked");
      assert.equal(String(result.reply).includes("1."), true);
      assert.equal(String(result.reply).includes("2."), true);
      assert.equal(
        supabase.calls.rpc.some(
          (call) => call.name === "create_store_appointment_with_commercial_context",
        ),
        false,
      );
      assert.equal(supabase.calls.rpc.some((call) => call.name === "panel_send_message"), false);
    },
  },
  {
    name: "customer identity disambiguation reply hides internal ids and masks phone suffixes",
    run: async () => {
      const { buildCustomerIdentityDisambiguationReply } = await loadRouteModule();
      const reply = buildCustomerIdentityDisambiguationReply({
        requestedName: "Joao",
        operatorName: "Brian",
        candidates: [
          {
            option_number: 1,
            customer_id: "751b5eea-6585-522f-ab7b-da2f4a1ad54a",
            lead_id: "44ac7092-3e55-4888-8623-745633ed3321",
            conversation_id: "1b486f6d-a061-4f56-89f5-8e0a3965b03a",
            commercial_opportunity_id: "0796eb5d-df71-5338-ab70-b15fcb67113a",
            customer_name: "Joao",
            customer_phone: "+55 11 99999-0207",
            opportunity_stage: "qualificacao",
          },
          {
            option_number: 2,
            customer_id: "customer-2",
            lead_id: "lead-2",
            conversation_id: "conv-2",
            commercial_opportunity_id: "opp-2",
            customer_name: "Joao",
            customer_phone: "+55 11 98888-4831",
            opportunity_stage: "proposta",
          },
        ],
      });

      assert.equal(reply.includes("Brian"), true);
      assert.equal(reply.includes("1. Joao"), true);
      assert.equal(reply.includes("telefone final 0207"), true);
      assert.equal(reply.includes("telefone final 4831"), true);
      assert.equal(reply.includes("751b5eea"), false);
      assert.equal(reply.includes("44ac7092"), false);
      assert.equal(reply.includes("1b486f6d"), false);
      assert.equal(reply.includes("0796eb5d"), false);
    },
  },
  {
    name: "customer identity selection accepts numeric natural and attribute choices",
    run: async () => {
      const { resolveCustomerIdentityCandidateFromText } = await loadRouteModule();
      const candidates = [
        {
          option_number: 1,
          customer_id: "customer-1",
          lead_id: "lead-1",
          conversation_id: "conv-1",
          commercial_opportunity_id: "opp-1",
          customer_name: "Joao",
          customer_phone: "+55 11 99999-0207",
          opportunity_stage: "qualificacao",
        },
        {
          option_number: 2,
          customer_id: "customer-2",
          lead_id: "lead-2",
          conversation_id: "conv-2",
          commercial_opportunity_id: "opp-2",
          customer_name: "Joao",
          customer_phone: "+55 11 98888-4831",
          opportunity_stage: "proposta",
        },
      ];

      assert.equal(resolveCustomerIdentityCandidateFromText({ text: "1", candidates })?.lead_id, "lead-1");
      assert.equal(resolveCustomerIdentityCandidateFromText({ text: "o segundo", candidates })?.lead_id, "lead-2");
      assert.equal(resolveCustomerIdentityCandidateFromText({ text: "o final 0207", candidates })?.lead_id, "lead-1");
      assert.equal(resolveCustomerIdentityCandidateFromText({ text: "o da proposta", candidates })?.lead_id, "lead-2");
      assert.equal(resolveCustomerIdentityCandidateFromText({ text: "esse joao", candidates }), null);
    },
  },
  {
    name: "create command cannot enter customer reschedule workflow",
    run: () => {
      const source = readRouteSource();
      const generate = getGenerateAssistantReplySource(source);
      const actionIndex = generate.indexOf("const currentScheduleAction = resolveScheduleAction(lastHumanMessage);");
      const workflowIndex = generate.indexOf('const canDispatchCustomerReschedule = currentScheduleAction === "reschedule" || currentScheduleAction === null;');

      assert.equal(actionIndex > -1, true);
      assert.equal(workflowIndex > actionIndex, true);
      assert.equal(generate.includes('currentScheduleAction !== "create"'), false);
    },
  },
  {
    name: "commercial customer messages require canonical target at every call site",
    run: () => {
      const source = readRouteSource();
      const sender = getFunctionSource(
        source,
        "async function sendAiMessageToCustomerConversation(",
        "function formatAppointmentStatus(",
      );
      assert.equal(sender.includes("target: CommercialTargetForSideEffect | null"), true);
      assert.equal(sender.includes("COMMERCIAL_TARGET_NOT_CANONICAL"), true);
      assert.equal(sender.includes("COMMERCIAL_TARGET_CONVERSATION_MISMATCH"), true);
      assert.equal(sender.indexOf("COMMERCIAL_TARGET_NOT_CANONICAL") < sender.indexOf("panel_send_message"), true);

      let searchFrom = source.indexOf("async function sendAiMessageToCustomerConversation(");
      let callCount = 0;
      while (true) {
        const callIndex = source.indexOf("sendAiMessageToCustomerConversation({", searchFrom + 1);
        if (callIndex === -1) break;
        callCount += 1;
        const block = source.slice(callIndex, callIndex + 600);
        assert.equal(block.includes("target:"), true, `missing target near index ${callIndex}`);
        searchFrom = callIndex;
      }
      assert.equal(callCount >= 1, true);
    },
  },
  {
    name: "commercial appointment and task writers assert canonical targets before side effects",
    run: () => {
      const source = readRouteSource();
      const selectedOption = getFunctionSource(
        source,
        "async function executeSelectedAppointmentOptionAction(",
        "function buildCustomerAvailabilityQuestion(",
      );
      const selectedAssertionIndex = selectedOption.indexOf("const selectedTargetAssertion = assertCommercialTargetForSideEffect({");
      const selectedCancelIndex = selectedOption.indexOf('rpc("cancel_store_appointment"');
      const selectedCompleteIndex = selectedOption.indexOf('rpc("complete_store_appointment_with_outcome"');

      assert.equal(selectedAssertionIndex > -1, true);
      assert.equal(selectedCancelIndex > selectedAssertionIndex, true);
      assert.equal(selectedCompleteIndex > selectedAssertionIndex, true);

      const taskWriter = getFunctionSource(
        source,
        "async function createAssistantOperationalTask(",
        "function getOperationalTaskPayload(",
      );
      const taskAssertionIndex = taskWriter.indexOf("assertCommercialTargetForSideEffect({");
      const taskInsertIndex = taskWriter.indexOf('.insert({');
      assert.equal(taskWriter.includes("COMMERCIAL_TARGET_NOT_CANONICAL_FOR_TASK"), true);
      assert.equal(taskAssertionIndex > -1, true);
      assert.equal(taskInsertIndex > taskAssertionIndex, true);

      const appointmentAction = getResolveAppointmentActionReplySource(source);
      const actionAssertionIndex = appointmentAction.indexOf("const selectedAppointmentTargetAssertion = assertCommercialTargetForSideEffect({");
      const rescheduleUpdateIndex = appointmentAction.indexOf('.from("store_appointments")');
      const completeIndex = appointmentAction.indexOf('rpc("complete_store_appointment_with_outcome"');
      const cancelIndex = appointmentAction.indexOf('rpc("cancel_store_appointment"');
      assert.equal(actionAssertionIndex > -1, true);
      assert.equal(rescheduleUpdateIndex > actionAssertionIndex, true);
      assert.equal(completeIndex > actionAssertionIndex, true);
      assert.equal(cancelIndex > actionAssertionIndex, true);
    },
  },
  {
    name: "customer identity disambiguation refuses stale or incompatible active context",
    run: () => {
      const source = readRouteSource();
      const gate = getFunctionSource(
        source,
        "async function resolveSafeCustomerIdentityGate(",
        "async function executeCreateAppointmentWithSafeIdentity(",
      );
      const pending = getFunctionSource(
        source,
        "async function resolvePendingCustomerIdentityDisambiguationReply(",
        "function extractReschedulePayload(",
      );

      assert.equal(source.includes("function isAssistantContextExpired("), true);
      assert.equal(source.includes("function isCompatibleIdentityDisambiguationContext("), true);
      assert.equal(gate.includes("isAssistantContextExpired(args.assistantContextState || null)"), true);
      assert.equal(gate.includes("!isCompatibleIdentityDisambiguationContext(args.assistantContextState || null)"), true);
      assert.equal(pending.includes("isAssistantContextExpired(contextState)"), true);
    },
  },
  {
    name: "onboarding account receives 409 before assistant execution",
    run: async () => {
      const { createAssistantReplyPostHandler } = await loadRouteModule();
      let generateCount = 0;
      const handler = createAssistantReplyPostHandler({
        resolveAccess: async () =>
          createDeniedAccess(
            409,
            "store_ready_onboarding_required",
            "onboarding_required",
            "STORE_API_REQUIREMENT_MISMATCH",
          ),
        generateReply: async () => {
          generateCount += 1;
          throw new Error("generateReply should not run");
        },
      });

      const response = await handler(
        buildRequest({
          organizationId: "body-org",
          storeId: "body-store",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.ok, false);
      assert.equal(body.error, "STORE_API_REQUIREMENT_MISMATCH");
      assert.equal(body.reasonCode, "onboarding_required");
      assert.equal(generateCount, 0);
    },
  },
  {
    name: "anonymous user stays denied before assistant execution",
    run: async () => {
      const { createAssistantReplyPostHandler } = await loadRouteModule();
      let generateCount = 0;
      const handler = createAssistantReplyPostHandler({
        resolveAccess: async () =>
          createDeniedAccess(401, "anonymous", "anonymous"),
        generateReply: async () => {
          generateCount += 1;
          throw new Error("generateReply should not run");
        },
      });

      const response = await handler(buildRequest({}));
      const body = await parseBody(response);

      assert.equal(response.status, 401);
      assert.equal(body.ok, false);
      assert.equal(body.reasonCode, "anonymous");
      assert.equal(generateCount, 0);
    },
  },
  {
    name: "missing membership fails closed before assistant execution",
    run: async () => {
      const { createAssistantReplyPostHandler } = await loadRouteModule();
      let generateCount = 0;
      const handler = createAssistantReplyPostHandler({
        resolveAccess: async () =>
          createDeniedAccess(
            409,
            "store_missing_membership",
            "missing_membership",
          ),
        generateReply: async () => {
          generateCount += 1;
          throw new Error("generateReply should not run");
        },
      });

      const response = await handler(buildRequest({}));
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.ok, false);
      assert.equal(body.reasonCode, "missing_membership");
      assert.equal(generateCount, 0);
    },
  },
  {
    name: "multiple organizations fail closed before assistant execution",
    run: async () => {
      const { createAssistantReplyPostHandler } = await loadRouteModule();
      let generateCount = 0;
      const handler = createAssistantReplyPostHandler({
        resolveAccess: async () =>
          createDeniedAccess(
            409,
            "store_multi_org_unsupported",
            "multi_org_unsupported",
          ),
        generateReply: async () => {
          generateCount += 1;
          throw new Error("generateReply should not run");
        },
      });

      const response = await handler(buildRequest({}));
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.ok, false);
      assert.equal(body.reasonCode, "multi_org_unsupported");
      assert.equal(generateCount, 0);
    },
  },
  {
    name: "multiple stores fail closed before assistant execution",
    run: async () => {
      const { createAssistantReplyPostHandler } = await loadRouteModule();
      let generateCount = 0;
      const handler = createAssistantReplyPostHandler({
        resolveAccess: async () =>
          createDeniedAccess(
            409,
            "store_multi_store_unsupported",
            "multi_store_unsupported",
          ),
        generateReply: async () => {
          generateCount += 1;
          throw new Error("generateReply should not run");
        },
      });

      const response = await handler(buildRequest({}));
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.ok, false);
      assert.equal(body.reasonCode, "multi_store_unsupported");
      assert.equal(generateCount, 0);
    },
  },
  {
    name: "customer availability tratativa requires assistant thread before outbound",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/app/api/assistant/reply/route.ts"),
        "utf8",
      );
      const functionIndex = source.indexOf("async function resolveCustomerAvailabilityRequestFromContext");
      const threadGuardIndex = source.indexOf("if (!args.threadId)", functionIndex);
      const sendIndex = source.indexOf("sendAiMessageToCustomerConversation({", functionIndex);

      assert.equal(functionIndex > -1, true);
      assert.equal(threadGuardIndex > functionIndex, true);
      assert.equal(sendIndex > threadGuardIndex, true);
    },
  },
  {
    name: "reschedule tratativa does not persist waiting context when operational task insert fails",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/app/api/assistant/reply/route.ts"),
        "utf8",
      );
      const taskIndex = source.indexOf('taskType: "appointment_reschedule_with_customer"');
       const failureIndex = source.indexOf("if (!preTaskResult.ok)", taskIndex);
      const contextIndex = source.indexOf("await upsertAssistantContextState({", taskIndex);

      assert.equal(taskIndex > -1, true);
      assert.equal(failureIndex > taskIndex, true);
      assert.equal(contextIndex > failureIndex, true);
    },
  },
  {
    name: "operational treatment abandonment cancels only the task and stale queue work",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/app/api/assistant/reply/route.ts"),
        "utf8",
      );
      const start = source.indexOf("async function resolveOperationalTreatmentAbandonmentReply(");
      const end = source.indexOf("export function resolveExplicitCommercialOpportunityIdForAssistantTechnicalVisit(", start);
      const block = source.slice(start, end);

      assert.equal(start > -1, true);
      assert.equal(end > start, true);
      assert.equal(block.includes('status: "cancelled"'), true);
      assert.equal(block.includes("cancelled_at: nowIso"), true);
      assert.equal(block.includes('from("store_assistant_operational_task_queue")'), true);
      assert.equal(block.includes('status: "cancelled"'), true);
      assert.equal(block.includes("resolveAssistantContextState({"), true);
      assert.equal(block.includes('rpc("cancel_store_appointment"'), false);
    },
  },
  {
    name: "active assistant context loader fails closed on multiple rows without latest authority",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/app/api/assistant/reply/route.ts"),
        "utf8",
      );
      const start = source.indexOf("async function loadAssistantContextState(");
      const end = source.indexOf("async function upsertAssistantContextState(", start);
      const block = source.slice(start, end);

      assert.equal(block.includes(".eq(\"organization_id\", args.organizationId)"), true);
      assert.equal(block.includes(".eq(\"store_id\", args.storeId)"), true);
      assert.equal(block.includes(".eq(\"thread_id\", args.threadId)"), true);
      assert.equal(block.includes("rows.length > 1"), true);
      assert.equal(block.includes("MULTIPLE_ACTIVE_ASSISTANT_CONTEXT_STATES"), true);
      assert.equal(block.includes('.limit(1)'), false);
    },
  },
  {
    name: "customer reschedule task is confirmed before outbound and replay reuses its operation key",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/assistant/customer-reschedule-workflow.ts"),
        "utf8",
      );
      const taskIndex = source.indexOf("const preTaskResult = await deps.createAssistantOperationalTask({");
      const sendIndex = source.indexOf("const sendResult = await deps.sendAiMessageToCustomerConversation({");
      const updateIndex = source.indexOf("const taskUpdateResult = deps.updateAssistantOperationalTaskAfterCustomerContact", sendIndex);

      assert.equal(taskIndex > -1, true);
      assert.equal(sendIndex > taskIndex, true);
      assert.equal(updateIndex > sendIndex, true);
      assert.equal(source.includes("operation_key: operationKey"), true);
      assert.equal(source.includes('status: "waiting_customer_response"'), true);
    },
  },
  {
    name: "imperative create phrases route to CREATE without letting reschedule fragments win",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/app/api/assistant/reply/route.ts"),
        "utf8",
      );
      const start = source.indexOf("function resolveScheduleAction(text: string)");
      const end = source.indexOf("function inferAppointmentTypeFromText", start);
      const block = source.slice(start, end);

      assert.equal(block.includes('"agende"'), true);
      assert.equal(block.includes('"crie um compromisso"'), true);
      assert.equal(block.includes('"marque visita"'), true);
      assert.equal(block.includes('"marque instalação"'), true);
      assert.equal(block.indexOf("return \"reschedule\"") < block.indexOf('"agende"'), true);
    },
  },
  {
    name: "terminal reschedule context cannot reactivate the workflow",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/assistant/customer-reschedule-workflow.ts"),
        "utf8",
      );
      const start = source.indexOf("const contextCanContinueReschedule = [");
      const end = source.indexOf("if (!hasRescheduleSignal)", start);
      const block = source.slice(start, end);

      assert.equal(start > -1, true);
      assert.equal(end > start, true);
      assert.equal(block.includes('"active"'), true);
      assert.equal(block.includes('"waiting_user_choice"'), true);
      assert.equal(block.includes('"waiting_customer_response"'), true);
      assert.equal(block.includes('"cancelled"'), false);
      assert.equal(block.includes('"resolved"'), false);
      assert.equal(block.includes("contextCanContinueReschedule"), true);
    },
  },
  {
    name: "abandonment closes task and queue without appointment or customer side effects",
    run: async () => {
      const { resolveOperationalTreatmentAbandonmentReply } = await loadRouteModule();
      const supabase = createAssistantRouteSupabaseMock();
      const reply = await resolveOperationalTreatmentAbandonmentReply({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-1",
        assistantContextState: null,
        openOperationalTasks: [{
          id: "task-1",
          task_type: "appointment_reschedule_with_customer",
          status: "waiting_customer_response",
          related_appointment_id: "appointment-1",
          task_payload: {},
        } as any],
        lastHumanMessage: "pare a tratativa e nao envie nada ao cliente",
      });

      assert.match(String(reply), /Encerrei/);
      assert.equal(supabase.calls.rpc.some((call) => call.name === "cancel_store_appointment"), false);
      assert.equal(supabase.calls.rpc.some((call) => call.name === "insert_message"), false);
      assert.equal(supabase.calls.from.includes("store_assistant_operational_tasks"), true);
      assert.equal(supabase.calls.from.includes("store_assistant_operational_task_queue"), true);
    },
  },
  {
    name: "suggested-time approval refuses to choose among multiple tasks",
    run: async () => {
      const { resolveSuggestedTimeApprovalReply } = await loadRouteModule();
      const reply = await resolveSuggestedTimeApprovalReply({
        supabase: {},
        organizationId: "org-1",
        storeId: "store-1",
        threadId: "thread-1",
        assistantContextState: null,
        lastHumanMessage: "sim",
        openOperationalTasks: [
          { id: "task-1", task_type: "appointment_reschedule_with_customer", status: "waiting_customer_response", related_appointment_id: "appointment-1", task_payload: { needs_responsible_approval: true, suggested_start_at: "2026-09-20T12:00:00Z", suggested_end_at: "2026-09-20T13:00:00Z" } } as any,
          { id: "task-2", task_type: "appointment_reschedule_with_customer", status: "waiting_customer_response", related_appointment_id: "appointment-2", task_payload: { needs_responsible_approval: true, suggested_start_at: "2026-09-21T12:00:00Z", suggested_end_at: "2026-09-21T13:00:00Z" } } as any,
        ],
      });

      assert.match(String(reply), /mais de uma remarca/);
    },
  },
];

async function main() {
  let passed = 0;

  for (const test of tests) {
    try {
      await test.run();
      passed += 1;
      console.log(`PASS ${test.name}`);
    } catch (error) {
      console.error(`FAIL ${test.name}`);
      throw error;
    }
  }

  console.log(`TOTAL ${passed}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { strict as assert } from "node:assert";
import { join } from "node:path";
import Module from "node:module";
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
    return originalResolveFilename.call(
      this,
      nextRequest,
      parent,
      isMain,
      options,
    );
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const routeModulePromise = import("./route");

async function loadRouteModule() {
  return routeModulePromise;
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
      sessionUserId: "user-1",
      safeHtmlDestination: "/crm",
      apiDecision: "allow",
      organizationResolution: "single",
      storeResolution: "single",
      organizationId: "access-org",
      storeId: "access-store",
      commercialAccess: "allowed",
      reasonCode: "ready_active",
      message: "Conta liberada.",
    },
    sessionUserId: "user-1",
    organizationId: "access-org",
    storeId: "access-store",
    ...overrides,
  };
}

function createDeniedAccess(): StoreApiAccessDenied {
  return {
    ok: false,
    resolution: {
      domain: "anonymous",
      status: "anonymous",
      sessionUserId: null,
      safeHtmlDestination: "/login",
      apiDecision: "deny_401",
      organizationResolution: "none",
      storeResolution: "none",
      organizationId: null,
      storeId: null,
      commercialAccess: "unknown",
      reasonCode: "anonymous",
      message: "Nao autenticado.",
    },
    httpStatus: 401,
    payload: {
      ok: false,
      error: "STORE_API_UNAUTHENTICATED",
      message: "Nao autenticado.",
      status: "anonymous",
      reasonCode: "anonymous",
    },
  };
}

function buildRequest(query: string) {
  return new Request(
    `https://example.test/api/schedule/customer-location?${query}`,
  );
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, any>;
}

function createOpportunity(args?: {
  id?: string;
  leadId?: string;
  stage?: string;
  conversationId?: string | null;
}) {
  return {
    id: args?.id ?? "opp-1",
    organization_id: "access-org",
    store_id: "access-store",
    origin_lead_id: args?.leadId ?? "lead-1",
    primary_conversation_id: args?.conversationId ?? "conv-1",
    stage: args?.stage ?? "qualificacao",
    stage_changed_at: "2026-09-22T12:00:00.000Z",
    created_at: "2026-09-20T12:00:00.000Z",
    updated_at: "2026-09-22T12:00:00.000Z",
  };
}

function createQualificationRow(args?: {
  opportunityId?: string;
  knownFacts?: unknown;
  conflicts?: unknown;
  organizationId?: string;
  storeId?: string;
}) {
  return {
    organization_id: args?.organizationId ?? "access-org",
    store_id: args?.storeId ?? "access-store",
    commercial_opportunity_id: args?.opportunityId ?? "opp-1",
    known_facts: args?.knownFacts ?? [],
    conflicts: args?.conflicts ?? [],
  };
}

function createHandlerHarness(args?: {
  access?: StoreApiAccessGranted | StoreApiAccessDenied;
  leadExists?: boolean;
  opportunities?: ReturnType<typeof createOpportunity>[];
  qualificationRows?: ReturnType<typeof createQualificationRow>[];
}) {
  const calls = {
    clientCreates: 0,
    leadLoads: [] as Array<Record<string, unknown>>,
    opportunityLoads: [] as Array<Record<string, unknown>>,
    qualificationReads: [] as Array<Record<string, unknown>>,
  };

  const access = args?.access ?? createGrantedAccess();
  const leadExists = args?.leadExists ?? true;
  const opportunities = args?.opportunities ?? [createOpportunity()];
  const qualificationRows =
    args?.qualificationRows ??
    [
      createQualificationRow({
        knownFacts: [
          {
            factKey: "location_text",
            state: "confirmed",
            valueKind: "text",
            value: "Rua Canonica, 123",
            normalizedValueText: "Rua Canonica, 123",
          },
        ],
      }),
    ];

  return {
    calls,
    async build() {
      const { createScheduleCustomerLocationGetHandler } =
        await loadRouteModule();

      return createScheduleCustomerLocationGetHandler({
        resolveAccess: async () => access,
        createPrivilegedClient: () => {
          calls.clientCreates += 1;
          return {} as never;
        },
        loadLead: async (input) => {
          calls.leadLoads.push(input as unknown as Record<string, unknown>);

          return leadExists
            ? {
                id: "lead-1",
                organization_id: "access-org",
                store_id: "access-store",
              }
            : null;
        },
        loadOpportunities: async (input) => {
          calls.opportunityLoads.push(
            input as unknown as Record<string, unknown>,
          );
          return opportunities;
        },
        readQualificationFacts: async (input) => {
          calls.qualificationReads.push(
            input as unknown as Record<string, unknown>,
          );
          return qualificationRows;
        },
      });
    },
  };
}

const tests: TestCase[] = [
  {
    name: "missing leadId is rejected before access or privileged client",
    run: async () => {
      const harness = createHandlerHarness();
      const handler = await harness.build();

      const response = await handler(buildRequest(""));
      const body = await parseBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.error, "MISSING_LEAD_ID");
      assert.equal(harness.calls.clientCreates, 0);
      assert.equal(harness.calls.leadLoads.length, 0);
    },
  },
  {
    name: "denied store access stays fail closed",
    run: async () => {
      const harness = createHandlerHarness({
        access: createDeniedAccess(),
      });
      const handler = await harness.build();

      const response = await handler(buildRequest("leadId=lead-1"));
      const body = await parseBody(response);

      assert.equal(response.status, 401);
      assert.equal(body.error, "STORE_API_UNAUTHENTICATED");
      assert.equal(harness.calls.clientCreates, 0);
      assert.equal(harness.calls.qualificationReads.length, 0);
    },
  },
  {
    name: "lead must exist inside canonical active tenant scope",
    run: async () => {
      const harness = createHandlerHarness({
        leadExists: false,
      });
      const handler = await harness.build();

      const response = await handler(
        buildRequest(
          "leadId=lead-1&organizationId=query-org&storeId=query-store",
        ),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 404);
      assert.equal(body.error, "LEAD_NOT_FOUND");

      assert.equal(harness.calls.leadLoads.length, 1);
      assert.equal(
        harness.calls.leadLoads[0]?.organizationId,
        "access-org",
      );
      assert.equal(harness.calls.leadLoads[0]?.storeId, "access-store");
      assert.equal(harness.calls.qualificationReads.length, 0);
    },
  },
  {
    name: "single active opportunity returns confirmed canonical location",
    run: async () => {
      const harness = createHandlerHarness();
      const handler = await harness.build();

      const response = await handler(buildRequest("leadId=lead-1"));
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.resolution, "resolved");
      assert.equal(body.commercialOpportunityId, "opp-1");
      assert.equal(body.location.state, "confirmed");
      assert.equal(body.location.text, "Rua Canonica, 123");

      assert.equal(harness.calls.qualificationReads.length, 1);
      assert.equal(
        harness.calls.qualificationReads[0]?.organizationId,
        "access-org",
      );
      assert.equal(
        harness.calls.qualificationReads[0]?.storeId,
        "access-store",
      );
      assert.equal(
        harness.calls.qualificationReads[0]?.commercialOpportunityId,
        "opp-1",
      );
    },
  },
  {
    name: "inferred canonical location may be suggested",
    run: async () => {
      const harness = createHandlerHarness({
        qualificationRows: [
          createQualificationRow({
            knownFacts: [
              {
                factKey: "location_text",
                state: "inferred",
                valueKind: "text",
                value: "Suzano",
                normalizedValueText: "Suzano",
              },
            ],
          }),
        ],
      });
      const handler = await harness.build();

      const response = await handler(buildRequest("leadId=lead-1"));
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.location.state, "inferred");
      assert.equal(body.location.text, "Suzano");
    },
  },
  {
    name: "location conflict suppresses automatic value even when known fact exists",
    run: async () => {
      const harness = createHandlerHarness({
        qualificationRows: [
          createQualificationRow({
            knownFacts: [
              {
                factKey: "location_text",
                state: "confirmed",
                valueKind: "text",
                value: "Rua A",
                normalizedValueText: "Rua A",
              },
            ],
            conflicts: [
              {
                factKey: "location_text",
                candidates: [
                  { value: "Rua A" },
                  { value: "Rua B" },
                ],
              },
            ],
          }),
        ],
      });
      const handler = await harness.build();

      const response = await handler(buildRequest("leadId=lead-1"));
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.location.state, "conflict");
      assert.equal(body.location.text, null);
    },
  },
  {
    name: "missing location stays absent instead of inventing an address",
    run: async () => {
      const harness = createHandlerHarness({
        qualificationRows: [
          createQualificationRow({
            knownFacts: [
              {
                factKey: "need_summary",
                state: "confirmed",
                valueKind: "text",
                value: "Precisa de cobertura",
                normalizedValueText: "Precisa de cobertura",
              },
            ],
          }),
        ],
      });
      const handler = await harness.build();

      const response = await handler(buildRequest("leadId=lead-1"));
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.location.state, "absent");
      assert.equal(body.location.text, null);
    },
  },
  {
    name: "multiple active opportunities require explicit selection and do not read facts",
    run: async () => {
      const harness = createHandlerHarness({
        opportunities: [
          createOpportunity({ id: "opp-a", stage: "qualificacao" }),
          createOpportunity({ id: "opp-b", stage: "negociacao" }),
        ],
      });
      const handler = await harness.build();

      const response = await handler(buildRequest("leadId=lead-1"));
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(
        body.resolution,
        "requires_opportunity_selection",
      );
      assert.equal(body.commercialOpportunityId, null);
      assert.equal(body.location, null);
      assert.equal(harness.calls.qualificationReads.length, 0);
    },
  },
  {
    name: "pos_venda remains a canonical active pipeline opportunity",
    run: async () => {
      const harness = createHandlerHarness({
        opportunities: [
          createOpportunity({
            id: "opp-post-sale",
            stage: "pos_venda",
          }),
        ],
        qualificationRows: [
          createQualificationRow({
            opportunityId: "opp-post-sale",
            knownFacts: [
              {
                factKey: "location_text",
                state: "confirmed",
                valueKind: "text",
                value: "Rua Pos Venda, 45",
                normalizedValueText: "Rua Pos Venda, 45",
              },
            ],
          }),
        ],
      });
      const handler = await harness.build();

      const response = await handler(buildRequest("leadId=lead-1"));
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.resolution, "resolved");
      assert.equal(body.commercialOpportunityId, "opp-post-sale");
      assert.equal(body.location.state, "confirmed");
      assert.equal(body.location.text, "Rua Pos Venda, 45");
    },
  },
  {
    name: "explicit opportunity selects the requested scoped opportunity",
    run: async () => {
      const harness = createHandlerHarness({
        opportunities: [
          createOpportunity({ id: "opp-a", stage: "qualificacao" }),
          createOpportunity({ id: "opp-b", stage: "negociacao" }),
        ],
        qualificationRows: [
          createQualificationRow({
            opportunityId: "opp-b",
            knownFacts: [
              {
                factKey: "location_text",
                state: "confirmed",
                valueKind: "text",
                value: "Endereco B",
                normalizedValueText: "Endereco B",
              },
            ],
          }),
        ],
      });
      const handler = await harness.build();

      const response = await handler(
        buildRequest(
          "leadId=lead-1&commercialOpportunityId=opp-b",
        ),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.commercialOpportunityId, "opp-b");
      assert.equal(body.location.text, "Endereco B");
      assert.equal(
        harness.calls.qualificationReads[0]?.commercialOpportunityId,
        "opp-b",
      );
    },
  },
  {
    name: "explicit opportunity outside lead context is rejected",
    run: async () => {
      const harness = createHandlerHarness({
        opportunities: [
          createOpportunity({ id: "opp-a" }),
        ],
      });
      const handler = await harness.build();

      const response = await handler(
        buildRequest(
          "leadId=lead-1&commercialOpportunityId=opp-other",
        ),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 404);
      assert.equal(
        body.error,
        "COMMERCIAL_OPPORTUNITY_SCOPE_REJECTED",
      );
      assert.equal(harness.calls.qualificationReads.length, 0);
    },
  },
  {
    name: "no active opportunity does not read qualification facts",
    run: async () => {
      const harness = createHandlerHarness({
        opportunities: [
          createOpportunity({
            id: "opp-lost",
            stage: "perdido",
          }),
        ],
      });
      const handler = await harness.build();

      const response = await handler(buildRequest("leadId=lead-1"));
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.resolution, "no_active_opportunity");
      assert.equal(body.location, null);
      assert.equal(harness.calls.qualificationReads.length, 0);
    },
  },
  {
    name: "qualification reader must return exactly one snapshot",
    run: async () => {
      const harness = createHandlerHarness({
        qualificationRows: [],
      });
      const handler = await harness.build();

      const response = await handler(buildRequest("leadId=lead-1"));
      const body = await parseBody(response);

      assert.equal(response.status, 500);
      assert.equal(body.error, "INVALID_QUALIFICATION_SNAPSHOT");
    },
  },
  {
    name: "malformed qualification snapshot fields fail closed",
    run: async () => {
      for (const qualificationRow of [
        createQualificationRow({
          knownFacts: "invalid-known-facts",
        }),
        createQualificationRow({
          conflicts: "invalid-conflicts",
        }),
      ]) {
        const harness = createHandlerHarness({
          qualificationRows: [qualificationRow],
        });
        const handler = await harness.build();

        const response = await handler(buildRequest("leadId=lead-1"));
        const body = await parseBody(response);

        assert.equal(response.status, 500);
        assert.equal(body.error, "INVALID_QUALIFICATION_SNAPSHOT");
        assert.equal(
          body.detail,
          "MALFORMED_QUALIFICATION_SNAPSHOT_FIELDS",
        );
      }
    },
  },
  {
    name: "qualification snapshot scope must match access scope and opportunity",
    run: async () => {
      const harness = createHandlerHarness({
        qualificationRows: [
          createQualificationRow({
            organizationId: "wrong-org",
          }),
        ],
      });
      const handler = await harness.build();

      const response = await handler(buildRequest("leadId=lead-1"));
      const body = await parseBody(response);

      assert.equal(response.status, 500);
      assert.equal(
        body.error,
        "INVALID_QUALIFICATION_SNAPSHOT_SCOPE",
      );
    },
  },
  {
    name: "location resolver gives conflict precedence",
    run: async () => {
      const { resolveLocationFromQualificationFacts } =
        await loadRouteModule();

      const result = resolveLocationFromQualificationFacts(
        createQualificationRow({
          knownFacts: [
            {
              factKey: "location_text",
              state: "confirmed",
              valueKind: "text",
              value: "Rua A",
              normalizedValueText: "Rua A",
            },
          ],
          conflicts: [{ factKey: "location_text" }],
        }),
      );

      assert.deepEqual(result, {
        state: "conflict",
        text: null,
      });
    },
  },
  {
    name: "module exports a GET handler",
    run: async () => {
      const { GET } = await loadRouteModule();
      assert.equal(typeof GET, "function");
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

  console.log(
    `schedule-customer-location-route: ${passed}/${tests.length} tests passed`,
  );
}

void main();
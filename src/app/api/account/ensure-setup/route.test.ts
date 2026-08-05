import { strict as assert } from "node:assert";
import type { AccessResolution } from "@/lib/account-access-resolution";
import { handleEnsureSetup } from "./route-handler";

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

type ProbeCounts = {
  createSupabaseCalls: number;
  resolveAccessCalls: number;
  directAuthCalls: number;
  directFromCalls: number;
  directRpcCalls: number;
};

function createResolution(
  overrides: Partial<AccessResolution> & Pick<AccessResolution, "status">,
): AccessResolution {
  const { status, ...rest } = overrides;

  return {
    domain: "store_area",
    status,
    sessionUserId: "user-1",
    safeHtmlDestination: "/account/access-blocked",
    apiDecision: "deny_409",
    organizationResolution: "none",
    storeResolution: "none",
    organizationId: null,
    storeId: null,
    commercialAccess: "unknown",
    reasonCode: "missing_membership",
    message: "Conta nao esta pronta para entrar.",
    ...rest,
  };
}

function createRouteDeps(resolution: AccessResolution) {
  const counts: ProbeCounts = {
    createSupabaseCalls: 0,
    resolveAccessCalls: 0,
    directAuthCalls: 0,
    directFromCalls: 0,
    directRpcCalls: 0,
  };

  const supabase = {
    auth: {
      async getUser() {
        counts.directAuthCalls += 1;
        throw new Error("handler must not call auth.getUser directly");
      },
      async getSession() {
        counts.directAuthCalls += 1;
        throw new Error("handler must not call auth.getSession directly");
      },
    },
    from() {
      counts.directFromCalls += 1;
      throw new Error("handler must not query tables directly");
    },
    rpc() {
      counts.directRpcCalls += 1;
      throw new Error("handler must not call RPC directly");
    },
  };

  return {
    counts,
    deps: {
      createSupabase: async () => {
        counts.createSupabaseCalls += 1;
        return supabase as never;
      },
      resolveAccess: async ({
        requestedDomain,
        supabase: requestSupabase,
      }: {
        requestedDomain: string;
        supabase: unknown;
      }) => {
        counts.resolveAccessCalls += 1;
        assert.equal(requestedDomain, "store_area");
        assert.equal(requestSupabase, supabase);
        return resolution;
      },
    },
  };
}

async function getJson(response: Response) {
  return (await response.json()) as {
    ok: boolean;
    status: string;
    message: string;
    destination: string | null;
    error?: string;
    details?: string;
    reasonCode?: string;
    organizationId?: string | null;
    storeId?: string | null;
    apiDecision?: string;
    safeHtmlDestination?: string;
  };
}

async function assertStatusMapping(
  resolution: AccessResolution,
  expectedHttpStatus: number,
  expectedOk: boolean,
  expectedDestination: string | null,
) {
  const { counts, deps } = createRouteDeps(resolution);
  const response = await handleEnsureSetup(deps);
  const payload = await getJson(response);

  assert.equal(response.status, expectedHttpStatus);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(payload.ok, expectedOk);
  assert.equal(payload.status, resolution.status);
  assert.equal(payload.destination, expectedDestination);
  assert.equal(payload.message, resolution.message);
  assert.equal(payload.reasonCode, resolution.reasonCode);
  assert.equal(payload.apiDecision, resolution.apiDecision);
  assert.equal(payload.safeHtmlDestination, resolution.safeHtmlDestination);
  assert.equal(counts.createSupabaseCalls, 1);
  assert.equal(counts.resolveAccessCalls, 1);
  assert.equal(counts.directAuthCalls, 0);
  assert.equal(counts.directFromCalls, 0);
  assert.equal(counts.directRpcCalls, 0);
}

const tests: TestCase[] = [
  {
    name: "anonymous returns 401",
    run: async () => {
      await assertStatusMapping(
        createResolution({
          domain: "anonymous",
          status: "anonymous",
          sessionUserId: null,
          safeHtmlDestination: "/login",
          apiDecision: "deny_401",
          reasonCode: "anonymous",
          message: "A requisicao exige uma sessao autenticada.",
        }),
        401,
        false,
        null,
      );
    },
  },
  {
    name: "first access returns reset-password destination without ids",
    run: async () => {
      const resolution = createResolution({
        status: "store_first_access_required",
        safeHtmlDestination: "/auth/reset-password",
        reasonCode: "first_access_required",
        message: "Primeiro acesso obrigatorio.",
        organizationId: "org-1",
        storeId: "store-1",
      });

      const { deps } = createRouteDeps(resolution);
      const response = await handleEnsureSetup(deps);
      const payload = await getJson(response);

      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.destination, "/auth/reset-password");
      assert.equal(payload.organizationId, null);
      assert.equal(payload.storeId, null);
      assert.equal(payload.error, undefined);
      assert.equal(payload.details, undefined);
    },
  },
  {
    name: "onboarding returns ids preserved",
    run: async () => {
      const resolution = createResolution({
        status: "store_ready_onboarding_required",
        safeHtmlDestination: "/onboarding",
        reasonCode: "onboarding_required",
        message: "Onboarding obrigatorio.",
        organizationResolution: "single",
        storeResolution: "single",
        organizationId: "org-1",
        storeId: "store-1",
        commercialAccess: "allowed",
      });

      const { deps } = createRouteDeps(resolution);
      const response = await handleEnsureSetup(deps);
      const payload = await getJson(response);

      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.destination, "/onboarding");
      assert.equal(payload.organizationId, "org-1");
      assert.equal(payload.storeId, "store-1");
    },
  },
  {
    name: "active account returns crm destination with ids",
    run: async () => {
      const resolution = createResolution({
        status: "store_ready_active",
        safeHtmlDestination: "/crm",
        apiDecision: "allow",
        reasonCode: "ready_active",
        message: "Acesso ao CRM liberado.",
        organizationResolution: "single",
        storeResolution: "single",
        organizationId: "org-1",
        storeId: "store-1",
        commercialAccess: "allowed",
      });

      const { deps } = createRouteDeps(resolution);
      const response = await handleEnsureSetup(deps);
      const payload = await getJson(response);

      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.destination, "/crm");
      assert.equal(payload.organizationId, "org-1");
      assert.equal(payload.storeId, "store-1");
    },
  },
  {
    name: "commercial block returns 403",
    run: async () => {
      await assertStatusMapping(
        createResolution({
          status: "store_commercial_blocked",
          reasonCode: "commercial_access_blocked",
          message: "Conta bloqueada.",
        }),
        403,
        false,
        null,
      );
    },
  },
  {
    name: "resolution unavailable returns 503",
    run: async () => {
      await assertStatusMapping(
        createResolution({
          domain: "unresolved",
          status: "access_resolution_unavailable",
          safeHtmlDestination: "/account/access-unavailable",
          apiDecision: "deny_503",
          reasonCode: "profile_lookup_unavailable",
          message: "Falha tecnica na resolucao.",
        }),
        503,
        false,
        null,
      );
    },
  },
  {
    name: "denied states never expose ids and preserve error fields",
    run: async () => {
      const resolution = createResolution({
        status: "store_missing_store",
        reasonCode: "missing_store",
        message: "Loja ausente.",
        organizationId: "org-secret",
        storeId: "store-secret",
      });

      const { deps } = createRouteDeps(resolution);
      const response = await handleEnsureSetup(deps);
      const payload = await getJson(response);

      assert.equal(response.status, 409);
      assert.equal(payload.ok, false);
      assert.equal(payload.destination, null);
      assert.equal(payload.organizationId, null);
      assert.equal(payload.storeId, null);
      assert.equal(payload.error, "Loja ausente.");
      assert.equal(payload.details, "Loja ausente.");
    },
  },
  {
    name: "unexpected failure returns bootstrap 503 payload",
    run: async () => {
      const response = await handleEnsureSetup({
        createSupabase: async () => {
          throw new Error("boom");
        },
        resolveAccess: async () => {
          throw new Error("resolver should not run");
        },
      });
      const payload = await getJson(response);

      assert.equal(response.status, 503);
      assert.equal(payload.ok, false);
      assert.equal(payload.status, "access_resolution_unavailable");
      assert.equal(payload.reasonCode, "service_client_unavailable");
      assert.equal(payload.apiDecision, "deny_503");
      assert.equal(payload.safeHtmlDestination, "/account/access-unavailable");
    },
  },
];

async function runEnsureSetupRouteTests() {
  for (const testCase of tests) {
    await testCase.run();
  }

  return { count: tests.length };
}

runEnsureSetupRouteTests()
  .then((result) => {
    console.log(`account-ensure-setup route tests: ${result.count} passed`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });

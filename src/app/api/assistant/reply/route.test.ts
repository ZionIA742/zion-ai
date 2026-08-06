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

const tests: TestCase[] = [
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

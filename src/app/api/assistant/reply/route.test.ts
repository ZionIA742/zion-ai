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

      const strategyIndex = block.indexOf('.from("store_strategy_settings")');
      const operationIndex = block.indexOf('.from("store_operation_settings")');
      const paymentIndex = block.indexOf('.from("store_payment_settings")');
      const responsibleIndex = block.indexOf("loadCanonicalActivePrimaryStoreResponsible({");
      const contextIndex = block.indexOf("const runtimeStoreContext = buildRuntimeStoreContext({");
      const promptIndex = block.indexOf("const systemPrompt = buildSystemPrompt({");

      assert.equal(strategyIndex > -1, true);
      assert.equal(operationIndex > -1, true);
      assert.equal(paymentIndex > -1, true);
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

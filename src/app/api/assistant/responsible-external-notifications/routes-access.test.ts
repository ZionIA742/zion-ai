const { strict: assert } = require("node:assert");
const { readFileSync } = require("node:fs");
const fs = require("node:fs");
const { join } = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const projectSrcPath = join(process.cwd(), "src");
const moduleWithResolveFilename = Module;
const originalResolveFilename = moduleWithResolveFilename._resolveFilename;
const originalTsLoader = require.extensions[".ts"];

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

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: filename,
  });

  (module as unknown as { _compile: (code: string, filename: string) => void })._compile(
    transpiled.outputText,
    filename,
  );
};

const {
  createResponsibleExternalNotificationsGetHandler,
} = require("./route.ts");
const {
  createResponsibleExternalNotificationsPreparePostHandler,
} = require("./prepare/route.ts");
const {
  createResponsibleExternalNotificationsSendPostHandler,
} = require("./send/route.ts");
const {
  createResponsibleExternalNotificationsCancelPostHandler,
} = require("./cancel/route.ts");
const {
  createResponsibleExternalNotificationsUnlockPostHandler,
} = require("./unlock-processing/route.ts");

type StoreApiAccessDenied =
  import("@/lib/server/store-api-access").StoreApiAccessDenied;
type StoreApiAccessGranted =
  import("@/lib/server/store-api-access").StoreApiAccessGranted;
type StoreApiStatus = StoreApiAccessDenied["payload"]["status"];
type StoreApiReasonCode = StoreApiAccessDenied["payload"]["reasonCode"];
type StoreApiErrorCode = StoreApiAccessDenied["payload"]["error"];
type RouteBody = Record<string, unknown>;
type RouteResultArgs = {
  organizationId: string;
  storeId: string;
  notificationId?: string;
  status?: string;
  limit?: number;
};

function createDeniedAccess(
  httpStatus: 401 | 403 | 409 | 503,
  status: StoreApiStatus,
  reasonCode: StoreApiReasonCode,
  error?: StoreApiErrorCode,
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
      error:
        error ??
        (httpStatus === 401
          ? "STORE_API_UNAUTHENTICATED"
          : httpStatus === 403
            ? "STORE_API_FORBIDDEN"
            : httpStatus === 503
              ? "STORE_API_ACCESS_UNAVAILABLE"
              : "STORE_API_ACCESS_DENIED"),
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
    ...(overrides || {}),
  };
}

function createJsonRequest(
  bodyFactory: () => RouteBody | Promise<RouteBody>,
  tracker: { reads: number },
): Request {
  return {
    json: async () => {
      tracker.reads += 1;
      return bodyFactory();
    },
  } as Request;
}

function buildGetRequest(query: string): Request {
  return new Request(
    `https://example.test/api/assistant/responsible-external-notifications?${query}`,
  );
}

async function parseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

const ROUTE_SOURCES = [
  "src/app/api/assistant/responsible-external-notifications/route.ts",
  "src/app/api/assistant/responsible-external-notifications/prepare/route.ts",
  "src/app/api/assistant/responsible-external-notifications/send/route.ts",
  "src/app/api/assistant/responsible-external-notifications/cancel/route.ts",
  "src/app/api/assistant/responsible-external-notifications/unlock-processing/route.ts",
];

const tests = [
  {
    name: "list route blocks anonymous access before helper",
    run: async () => {
      let listCalls = 0;

      const response = await createResponsibleExternalNotificationsGetHandler({
        resolveAccess: async () =>
          createDeniedAccess(401, "anonymous", "anonymous"),
        listNotifications: async () => {
          listCalls += 1;
          throw new Error("helper should not run");
        },
      })(buildGetRequest("organizationId=body-org&storeId=body-store"));

      const body = await parseBody(response);
      assert.equal(response.status, 401);
      assert.equal(body.error, "STORE_API_UNAUTHENTICATED");
      assert.equal(listCalls, 0);
    },
  },
  {
    name: "send route blocks inactive membership before body read and helper",
    run: async () => {
      const requestReads = { reads: 0 };
      let sendCalls = 0;

      const response = await createResponsibleExternalNotificationsSendPostHandler(
        {
          resolveAccess: async () =>
            createDeniedAccess(
              403,
              "inactive_membership",
              "inactive_membership",
            ),
          sendNotification: async () => {
            sendCalls += 1;
            throw new Error("send helper should not run");
          },
        },
      )(
        createJsonRequest(
          () => ({
            organizationId: "body-org",
            storeId: "body-store",
            notificationId: "notification-1",
          }),
          requestReads,
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 403);
      assert.equal(body.error, "STORE_API_FORBIDDEN");
      assert.equal(body.status, "inactive_membership");
      assert.equal(requestReads.reads, 0);
      assert.equal(sendCalls, 0);
    },
  },
  {
    name: "list route uses canonical tenant after a successful gate",
    run: async () => {
      const helperCalls: RouteResultArgs[] = [];

      const response = await createResponsibleExternalNotificationsGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        listNotifications: async (args: RouteResultArgs) => {
          helperCalls.push(args);
          return { ok: true, items: [], total: 0 };
        },
      })(
        buildGetRequest(
          "organizationId=access-org&storeId=access-store&status=queued&limit=50",
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.deepEqual(helperCalls[0], {
        organizationId: "access-org",
        storeId: "access-store",
        status: "queued",
        limit: 50,
      });
    },
  },
  {
    name: "prepare route blocks organization mismatch before helper",
    run: async () => {
      let helperCalls = 0;

      const response =
        await createResponsibleExternalNotificationsPreparePostHandler({
          resolveAccess: async () => createGrantedAccess(),
          prepareNotification: async () => {
            helperCalls += 1;
            throw new Error("prepare helper should not run");
          },
        })(
          createJsonRequest(
            () => ({
              organizationId: "foreign-org",
              storeId: "access-store",
              notificationId: "notification-1",
            }),
            { reads: 0 },
          ),
        );

      const body = await parseBody(response);
      assert.equal(response.status, 403);
      assert.equal(body.reason, "forbidden");
      assert.equal(helperCalls, 0);
    },
  },
  {
    name: "cancel route blocks store mismatch before helper",
    run: async () => {
      let helperCalls = 0;

      const response = await createResponsibleExternalNotificationsCancelPostHandler(
        {
          resolveAccess: async () => createGrantedAccess(),
          cancelNotification: async () => {
            helperCalls += 1;
            throw new Error("cancel helper should not run");
          },
        },
      )(
        createJsonRequest(
          () => ({
            organizationId: "access-org",
            storeId: "foreign-store",
            notificationId: "notification-1",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 403);
      assert.equal(body.reason, "forbidden");
      assert.equal(helperCalls, 0);
    },
  },
  {
    name: "prepare cancel and unlock routes reach helpers for active membership",
    run: async () => {
      const prepareCalls: RouteResultArgs[] = [];
      const cancelCalls: RouteResultArgs[] = [];
      const unlockCalls: RouteResultArgs[] = [];

      const prepareResponse =
        await createResponsibleExternalNotificationsPreparePostHandler({
          resolveAccess: async () => createGrantedAccess(),
          prepareNotification: async (args: RouteResultArgs) => {
            prepareCalls.push(args);
            return { ok: true, updated: true, reason: "prepared" };
          },
        })(
          createJsonRequest(
            () => ({
              organizationId: "access-org",
              storeId: "access-store",
              notificationId: "notification-prepare",
            }),
            { reads: 0 },
          ),
        );
      const cancelResponse =
        await createResponsibleExternalNotificationsCancelPostHandler({
          resolveAccess: async () => createGrantedAccess(),
          cancelNotification: async (args: RouteResultArgs) => {
            cancelCalls.push(args);
            return { ok: true, updated: true, reason: "cancelled" };
          },
        })(
          createJsonRequest(
            () => ({
              organizationId: "access-org",
              storeId: "access-store",
              notificationId: "notification-cancel",
            }),
            { reads: 0 },
          ),
        );
      const unlockResponse =
        await createResponsibleExternalNotificationsUnlockPostHandler({
          resolveAccess: async () => createGrantedAccess(),
          unlockNotification: async (args: RouteResultArgs) => {
            unlockCalls.push(args);
            return { ok: true, updated: true, reason: "unlocked" };
          },
        })(
          createJsonRequest(
            () => ({
              organizationId: "access-org",
              storeId: "access-store",
              notificationId: "notification-unlock",
            }),
            { reads: 0 },
          ),
        );

      assert.equal(prepareResponse.status, 200);
      assert.equal(cancelResponse.status, 200);
      assert.equal(unlockResponse.status, 200);
      assert.deepEqual(prepareCalls[0], {
        organizationId: "access-org",
        storeId: "access-store",
        notificationId: "notification-prepare",
      });
      assert.deepEqual(cancelCalls[0], {
        organizationId: "access-org",
        storeId: "access-store",
        notificationId: "notification-cancel",
      });
      assert.deepEqual(unlockCalls[0], {
        organizationId: "access-org",
        storeId: "access-store",
        notificationId: "notification-unlock",
      });
    },
  },
  {
    name: "send route reaches helper only for active canonical request",
    run: async () => {
      const sendCalls: RouteResultArgs[] = [];

      const response = await createResponsibleExternalNotificationsSendPostHandler(
        {
          resolveAccess: async () => createGrantedAccess(),
          sendNotification: async (args: RouteResultArgs) => {
            sendCalls.push(args);
            return { ok: true, sent: true, reason: "sent" };
          },
        },
      )(
        createJsonRequest(
          () => ({
            organizationId: "access-org",
            storeId: "access-store",
            notificationId: "notification-send",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.deepEqual(sendCalls[0], {
        organizationId: "access-org",
        storeId: "access-store",
        notificationId: "notification-send",
      });
    },
  },
  {
    name: "sources use canonical store gate and remove manual membership lookup",
    run: () => {
      for (const relativePath of ROUTE_SOURCES) {
        const source = readFileSync(join(process.cwd(), relativePath), "utf8");

        assert.equal(source.includes("resolveStoreApiAccess"), true);
        assert.equal(source.includes("createStoreApiDeniedResponse"), true);
        assert.equal(source.includes('requirement: "active"'), true);
        assert.equal(source.includes("createSupabaseServerClient"), false);
        assert.equal(source.includes("auth.getUser"), false);
        assert.equal(source.includes('.from("memberships")'), false);
        assert.equal(source.includes('.from("stores")'), false);
        assert.equal(source.includes("createClient"), false);
      }
    },
  },
];

async function main() {
  let passed = 0;

  try {
    for (const test of tests) {
      try {
        await test.run();
        passed += 1;
      } catch (error) {
        console.error(`FAIL ${test.name}`);
        throw error;
      }
    }

    console.log(
      `responsible-external-notifications-routes: ${passed}/${tests.length} tests passed`,
    );
  } finally {
    if (originalTsLoader) {
      require.extensions[".ts"] = originalTsLoader;
    } else {
      delete require.extensions[".ts"];
    }
    moduleWithResolveFilename._resolveFilename = originalResolveFilename;
  }
}

void main();

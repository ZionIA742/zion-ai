import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "./zion-admin-api-response";
import type { ZionAdminApiAccessDenied } from "./zion-admin-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function createDeniedAccess(
  overrides?: Partial<ZionAdminApiAccessDenied>,
): ZionAdminApiAccessDenied {
  return {
    ok: false,
    resolution: {
      domain: "store_area",
      status: "store_missing_membership",
      sessionUserId: null,
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      organizationResolution: "none",
      storeResolution: "none",
      organizationId: null,
      storeId: null,
      commercialAccess: "unknown",
      reasonCode: "missing_membership",
      message: "Conta nao esta pronta para usar a API interna do ZION.",
    },
    httpStatus: 409,
    payload: {
      ok: false,
      error: "ZION_ADMIN_API_ACCESS_DENIED",
      message: "Sua conta nao pode executar esta operacao nesta API interna do ZION.",
      status: "store_missing_membership",
      reasonCode: "missing_membership",
    },
    ...overrides,
  };
}

async function expectStatusPreserved(
  httpStatus: 401 | 403 | 409 | 503,
  payloadStatus: ZionAdminApiAccessDenied["payload"]["status"],
) {
  const access = createDeniedAccess({
    httpStatus,
    payload: {
      ok: false,
      error:
        httpStatus === 401
          ? "ZION_ADMIN_API_UNAUTHENTICATED"
          : httpStatus === 403
            ? "ZION_ADMIN_API_FORBIDDEN"
            : httpStatus === 503
              ? "ZION_ADMIN_API_ACCESS_UNAVAILABLE"
              : "ZION_ADMIN_API_ACCESS_DENIED",
      message: "Mensagem publica.",
      status: payloadStatus,
      reasonCode: "missing_membership",
    },
  });

  const response = createZionAdminApiDeniedResponse(access);
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, httpStatus);
  assert.equal(body.status, payloadStatus);
}

const tests: TestCase[] = [
  {
    name: "401 denied response is preserved",
    run: async () => {
      await expectStatusPreserved(401, "anonymous");
    },
  },
  {
    name: "403 denied response is preserved",
    run: async () => {
      await expectStatusPreserved(403, "cross_domain_forbidden");
    },
  },
  {
    name: "409 denied response is preserved",
    run: async () => {
      await expectStatusPreserved(409, "store_missing_membership");
    },
  },
  {
    name: "503 denied response is preserved",
    run: async () => {
      await expectStatusPreserved(503, "access_resolution_unavailable");
    },
  },
  {
    name: "denied body contains exactly approved public fields",
    run: async () => {
      const response = createZionAdminApiDeniedResponse(createDeniedAccess());
      const body = (await response.json()) as Record<string, unknown>;

      assert.deepEqual(Object.keys(body).sort(), [
        "error",
        "message",
        "ok",
        "reasonCode",
        "status",
      ]);
    },
  },
  {
    name: "runtime extra denied payload fields are stripped",
    run: async () => {
      const access = createDeniedAccess({
        payload: {
          ok: false,
          error: "ZION_ADMIN_API_ACCESS_DENIED",
          message: "Mensagem publica.",
          status: "store_missing_membership",
          reasonCode: "missing_membership",
          resolution: { leaked: true },
          stack: "stack",
          cause: "cause",
          internalId: "internal-id",
          tableName: "zion_internal_admins",
        } as ZionAdminApiAccessDenied["payload"] & Record<string, unknown>,
      });

      const response = createZionAdminApiDeniedResponse(access);
      const body = (await response.json()) as Record<string, unknown>;

      assert.deepEqual(Object.keys(body).sort(), [
        "error",
        "message",
        "ok",
        "reasonCode",
        "status",
      ]);
      assert.equal("resolution" in body, false);
      assert.equal("stack" in body, false);
      assert.equal("cause" in body, false);
      assert.equal("internalId" in body, false);
      assert.equal("tableName" in body, false);
    },
  },
  {
    name: "denied responses are no-store",
    run: () => {
      const response = createZionAdminApiDeniedResponse(createDeniedAccess());

      assert.equal(response.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "json response preserves status",
    run: () => {
      const response = createZionAdminApiJsonResponse({ ok: true }, 207);

      assert.equal(response.status, 207);
    },
  },
  {
    name: "json response preserves payload",
    run: async () => {
      const payload = {
        ok: true,
        nested: {
          value: 1,
        },
        items: ["a", "b"],
      };

      const response = createZionAdminApiJsonResponse(payload, 200);
      const body = await response.json();

      assert.deepEqual(body, payload);
    },
  },
  {
    name: "json responses are no-store for success and local error",
    run: async () => {
      const successResponse = createZionAdminApiJsonResponse({ ok: true }, 200);
      const errorResponse = createZionAdminApiJsonResponse(
        { error: "LOCAL_ERROR" },
        500,
      );

      assert.equal(successResponse.headers.get("Cache-Control"), "no-store");
      assert.equal(errorResponse.headers.get("Cache-Control"), "no-store");
      assert.deepEqual(await successResponse.json(), { ok: true });
      assert.deepEqual(await errorResponse.json(), { error: "LOCAL_ERROR" });
    },
  },
  {
    name: "input objects are not modified",
    run: async () => {
      const deniedAccess = createDeniedAccess();
      const deniedSnapshot = JSON.stringify(deniedAccess);
      const payload = {
        ok: true,
        nested: {
          value: 1,
        },
      };
      const payloadSnapshot = JSON.stringify(payload);

      await createZionAdminApiDeniedResponse(deniedAccess).json();
      await createZionAdminApiJsonResponse(payload, 200).json();

      assert.equal(JSON.stringify(deniedAccess), deniedSnapshot);
      assert.equal(JSON.stringify(payload), payloadSnapshot);
    },
  },
  {
    name: "source has no Supabase, service role, table, RPC, or access resolution code",
    run: () => {
      const filePath = join(__dirname, "zion-admin-api-response.ts");
      const source = readFileSync(filePath, "utf8");

      const forbiddenPatterns = [
        /createSupabaseServerClient/,
        /resolveAccessForRequest/,
        /resolveZionAdminApiAccess/,
        /service_role/i,
        /SUPABASE_SERVICE_ROLE_KEY/,
        /\.from\s*\(/,
        /\.rpc\s*\(/,
        /cookies\s*\(/,
        /getUser\s*\(/,
        /getSession\s*\(/,
        /metadata/i,
        /zion_internal_admins/,
      ];

      for (const pattern of forbiddenPatterns) {
        assert.equal(
          pattern.test(source),
          false,
          `unexpected forbidden pattern in adapter source: ${pattern}`,
        );
      }
    },
  },
];

void ((): void => {
  const deniedOnly = createDeniedAccess();
  createZionAdminApiDeniedResponse(deniedOnly);

  const grantedLike = { ok: true } as const;

  // @ts-expect-error createZionAdminApiDeniedResponse must not accept ok=true
  const deniedInput: Parameters<typeof createZionAdminApiDeniedResponse>[0] =
    grantedLike;

  void deniedInput;
})();

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`zion-admin-api-response: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

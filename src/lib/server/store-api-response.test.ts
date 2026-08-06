import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createStoreApiDeniedResponse } from "./store-api-response";
import type { StoreApiAccessDenied } from "./store-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function createDeniedAccess(
  overrides?: Partial<StoreApiAccessDenied>,
): StoreApiAccessDenied {
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
      message: "Conta nao esta pronta para usar a API da loja.",
    },
    httpStatus: 409,
    payload: {
      ok: false,
      error: "STORE_API_ACCESS_DENIED",
      message: "Sua conta nao pode executar esta operacao nesta API da loja.",
      status: "store_missing_membership",
      reasonCode: "missing_membership",
    },
    ...overrides,
  };
}

async function expectStatusPreserved(
  httpStatus: 401 | 403 | 409 | 503,
  payloadStatus: StoreApiAccessDenied["payload"]["status"],
) {
  const access = createDeniedAccess({
    httpStatus,
    payload: {
      ok: false,
      error:
        httpStatus === 401
          ? "STORE_API_UNAUTHENTICATED"
          : httpStatus === 503
            ? "STORE_API_ACCESS_UNAVAILABLE"
            : "STORE_API_FORBIDDEN",
      message: "Mensagem publica.",
      status: payloadStatus,
      reasonCode: "missing_membership",
    },
  });

  const response = createStoreApiDeniedResponse(access);
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, httpStatus);
  assert.equal(body.status, payloadStatus);
}

const tests: TestCase[] = [
  {
    name: "401 is preserved",
    run: async () => {
      await expectStatusPreserved(401, "anonymous");
    },
  },
  {
    name: "403 is preserved",
    run: async () => {
      await expectStatusPreserved(403, "cross_domain_forbidden");
    },
  },
  {
    name: "409 is preserved",
    run: async () => {
      await expectStatusPreserved(409, "store_missing_membership");
    },
  },
  {
    name: "503 is preserved",
    run: async () => {
      await expectStatusPreserved(503, "access_resolution_unavailable");
    },
  },
  {
    name: "body contains exactly five public fields",
    run: async () => {
      const response = createStoreApiDeniedResponse(createDeniedAccess());
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
    name: "resolution does not appear in body",
    run: async () => {
      const response = createStoreApiDeniedResponse(createDeniedAccess());
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal("resolution" in body, false);
    },
  },
  {
    name: "ids do not appear in body",
    run: async () => {
      const response = createStoreApiDeniedResponse(createDeniedAccess());
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal("sessionUserId" in body, false);
      assert.equal("organizationId" in body, false);
      assert.equal("storeId" in body, false);
    },
  },
  {
    name: "internal details do not appear in body",
    run: async () => {
      const response = createStoreApiDeniedResponse(createDeniedAccess());
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal("domain" in body, false);
      assert.equal("organizationResolution" in body, false);
      assert.equal("storeResolution" in body, false);
      assert.equal("commercialAccess" in body, false);
      assert.equal("safeHtmlDestination" in body, false);
      assert.equal("apiDecision" in body, false);
      assert.equal("stack" in body, false);
      assert.equal("cause" in body, false);
    },
  },
  {
    name: "runtime extra payload fields are stripped from body",
    run: async () => {
      const access = createDeniedAccess({
        payload: {
          ok: false,
          error: "STORE_API_ACCESS_DENIED",
          message: "Mensagem publica.",
          status: "store_missing_membership",
          reasonCode: "missing_membership",
          organizationId: "org-extra",
          storeId: "store-extra",
          resolution: { leaked: true },
          stack: "stack",
          cause: "cause",
          internalDetails: "details",
        } as StoreApiAccessDenied["payload"] & Record<string, unknown>,
      });

      const response = createStoreApiDeniedResponse(access);
      const body = (await response.json()) as Record<string, unknown>;

      assert.deepEqual(Object.keys(body).sort(), [
        "error",
        "message",
        "ok",
        "reasonCode",
        "status",
      ]);
      assert.equal("organizationId" in body, false);
      assert.equal("storeId" in body, false);
      assert.equal("resolution" in body, false);
      assert.equal("stack" in body, false);
      assert.equal("cause" in body, false);
      assert.equal("internalDetails" in body, false);
    },
  },
  {
    name: "Cache-Control is no-store",
    run: () => {
      const response = createStoreApiDeniedResponse(createDeniedAccess());
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "Content-Type is JSON",
    run: () => {
      const response = createStoreApiDeniedResponse(createDeniedAccess());
      assert.equal(
        response.headers.get("Content-Type"),
        "application/json",
      );
    },
  },
  {
    name: "original access object is not modified",
    run: async () => {
      const access = createDeniedAccess();
      const snapshot = JSON.stringify(access);

      await createStoreApiDeniedResponse(access).json();

      assert.equal(JSON.stringify(access), snapshot);
    },
  },
  {
    name: "source does not import Supabase resolver or service role",
    run: () => {
      const filePath = join(__dirname, "store-api-response.ts");
      const source = readFileSync(filePath, "utf8");

      const forbiddenPatterns = [
        /createSupabaseServerClient/,
        /resolveAccessForRequest/,
        /service_role/i,
        /SUPABASE_SERVICE_ROLE_KEY/,
        /\.from\s*\(/,
        /\.rpc\s*\(/,
        /cookies\s*\(/,
        /redirect\s*\(/,
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
  {
    name: "source does not pass access.payload directly to NextResponse.json",
    run: () => {
      const filePath = join(__dirname, "store-api-response.ts");
      const source = readFileSync(filePath, "utf8");

      assert.equal(
        source.includes("NextResponse.json(access.payload"),
        false,
      );
    },
  },
];

void ((): void => {
  const deniedOnly = createDeniedAccess();
  createStoreApiDeniedResponse(deniedOnly);

  const grantedLike = { ok: true } as const;

  // @ts-expect-error createStoreApiDeniedResponse must not accept ok=true
  const deniedInput: Parameters<typeof createStoreApiDeniedResponse>[0] =
    grantedLike;

  void deniedInput;
})();

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`store-api-response: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

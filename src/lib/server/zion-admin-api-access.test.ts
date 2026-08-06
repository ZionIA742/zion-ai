import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccessResolution } from "../account-access-resolution";
import {
  resolveZionAdminApiAccess,
  type ResolveZionAdminApiAccessDeps,
  type ZionAdminApiGrantedResolution,
} from "./zion-admin-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
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
    message: "Conta nao esta pronta para usar a API interna do ZION.",
    ...rest,
  };
}

function createAllowedResolution(): AccessResolution {
  return createResolution({
    domain: "zion_admin",
    status: "zion_admin_allowed",
    sessionUserId: "user-1",
    safeHtmlDestination: "/zion-admin",
    apiDecision: "allow",
    organizationResolution: "none",
    storeResolution: "none",
    organizationId: null,
    storeId: null,
    commercialAccess: "unknown",
    reasonCode: "zion_admin_allowed",
    message: "A sessao interna do ZION esta autorizada.",
  });
}

function createDeps(
  resolution: AccessResolution,
  hooks?: {
    onCreateSupabase?: () => void;
    onResolveAccess?: (args: { requestedDomain: string; supabase: unknown }) => void;
    createSupabaseThrows?: boolean;
    resolveAccessThrows?: boolean;
  },
): ResolveZionAdminApiAccessDeps {
  const supabase = {
    auth: {
      async getUser() {
        return {
          data: { user: { id: "user-1" } },
          error: null,
        };
      },
    },
  };

  return {
    async createSupabase() {
      hooks?.onCreateSupabase?.();

      if (hooks?.createSupabaseThrows) {
        throw new Error("create supabase failed");
      }

      return supabase as never;
    },
    async resolveAccess(args) {
      hooks?.onResolveAccess?.({
        requestedDomain: args.requestedDomain,
        supabase: args.supabase,
      });

      if (hooks?.resolveAccessThrows) {
        throw new Error("resolve access failed");
      }

      return resolution;
    },
  };
}

async function expectDenied(
  resolution: AccessResolution,
  expected: {
    httpStatus: 401 | 403 | 409 | 503;
    error: string;
    status: AccessResolution["status"];
    reasonCode: AccessResolution["reasonCode"];
  },
) {
  const result = await resolveZionAdminApiAccess(createDeps(resolution));

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected denied result");
  }

  assert.equal(result.httpStatus, expected.httpStatus);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, expected.error);
  assert.equal(result.payload.status, expected.status);
  assert.equal(result.payload.reasonCode, expected.reasonCode);
  assert.equal(result.resolution.status, expected.status);
  assert.equal(result.resolution.reasonCode, expected.reasonCode);
  assert.equal(result.resolution.sessionUserId, null);
  assert.equal(result.resolution.organizationId, null);
  assert.equal(result.resolution.storeId, null);
  assert.equal("sessionUserId" in result, false);
  assert.equal("organizationId" in result, false);
  assert.equal("storeId" in result, false);
}

async function expectTechnicalDenied(
  resolution: AccessResolution,
) {
  const result = await resolveZionAdminApiAccess(createDeps(resolution));

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected denied result");
  }

  assert.equal(result.httpStatus, 503);
  assert.equal(result.payload.error, "ZION_ADMIN_API_ACCESS_UNAVAILABLE");
  assert.equal(result.payload.status, "access_resolution_unavailable");
  assert.equal(result.payload.reasonCode, "request_auth_unavailable");
  assert.equal(result.resolution.domain, "unresolved");
  assert.equal(result.resolution.status, "access_resolution_unavailable");
  assert.equal(result.resolution.sessionUserId, null);
  assert.equal(result.resolution.organizationId, null);
  assert.equal(result.resolution.storeId, null);

  return result;
}

const tests: TestCase[] = [
  {
    name: "valid zion_admin_allowed grants access",
    run: async () => {
      let createCount = 0;
      let resolveCount = 0;
      let resolvedDomain = "";
      let resolvedSupabase: unknown = null;

      const result = await resolveZionAdminApiAccess(
        createDeps(createAllowedResolution(), {
          onCreateSupabase: () => {
            createCount += 1;
          },
          onResolveAccess: ({ requestedDomain, supabase }) => {
            resolveCount += 1;
            resolvedDomain = requestedDomain;
            resolvedSupabase = supabase;
          },
        }),
      );

      assert.equal(result.ok, true);
      if (!result.ok) {
        throw new Error("expected granted result");
      }

      assert.equal(result.sessionUserId, "user-1");
      assert.equal(result.resolution.domain, "zion_admin");
      assert.equal(result.resolution.status, "zion_admin_allowed");
      assert.equal(result.resolution.sessionUserId, "user-1");
      assert.equal(result.resolution.organizationResolution, "none");
      assert.equal(result.resolution.storeResolution, "none");
      assert.equal(result.resolution.organizationId, null);
      assert.equal(result.resolution.storeId, null);
      assert.equal(result.resolution.commercialAccess, "unknown");
      assert.equal(result.supabase, resolvedSupabase);
      assert.equal(createCount, 1);
      assert.equal(resolveCount, 1);
      assert.equal(resolvedDomain, "zion_admin");
    },
  },
  {
    name: "same supabase client is returned on success",
    run: async () => {
      let resolvedSupabase: unknown = null;
      const result = await resolveZionAdminApiAccess(
        createDeps(createAllowedResolution(), {
          onResolveAccess: ({ supabase }) => {
            resolvedSupabase = supabase;
          },
        }),
      );

      assert.equal(result.ok, true);
      if (!result.ok) {
        throw new Error("expected granted result");
      }

      assert.equal(result.supabase, resolvedSupabase);
    },
  },
  {
    name: "sessionUserId is normalized",
    run: async () => {
      const result = await resolveZionAdminApiAccess(
        createDeps(
          createAllowedResolution(),
          {},
        ),
      );

      assert.equal(result.ok, true);
      if (!result.ok) {
        throw new Error("expected granted result");
      }

      assert.equal(result.sessionUserId, "user-1");
      assert.equal(result.resolution.sessionUserId, "user-1");
    },
  },
  {
    name: "success normalizes whitespace sessionUserId without mutating original resolution",
    run: async () => {
      const resolution = createAllowedResolution();
      resolution.sessionUserId = " user-9 ";
      const originalSnapshot = resolution.sessionUserId;

      const result = await resolveZionAdminApiAccess(createDeps(resolution));

      assert.equal(result.ok, true);
      if (!result.ok) {
        throw new Error("expected granted result");
      }

      assert.equal(result.sessionUserId, "user-9");
      assert.equal(result.resolution.sessionUserId, "user-9");
      assert.equal(resolution.sessionUserId, originalSnapshot);
    },
  },
  {
    name: "anonymous returns 401",
    run: async () => {
      await expectDenied(
        createResolution({
          domain: "anonymous",
          status: "anonymous",
          sessionUserId: null,
          safeHtmlDestination: "/zion-admin/login",
          apiDecision: "deny_401",
          reasonCode: "anonymous",
          message: "A requisicao exige uma sessao autenticada.",
        }),
        {
          httpStatus: 401,
          error: "ZION_ADMIN_API_UNAUTHENTICATED",
          status: "anonymous",
          reasonCode: "anonymous",
        },
      );
    },
  },
  {
    name: "account_blocked returns 403",
    run: async () => {
      await expectDenied(
        createResolution({
          domain: "zion_admin",
          status: "account_blocked",
          sessionUserId: "user-1",
          apiDecision: "deny_403",
          reasonCode: "account_blocked",
          message: "Profile bloqueado.",
        }),
        {
          httpStatus: 403,
          error: "ZION_ADMIN_API_FORBIDDEN",
          status: "account_blocked",
          reasonCode: "account_blocked",
        },
      );
    },
  },
  {
    name: "cross_domain_forbidden returns 403",
    run: async () => {
      await expectDenied(
        createResolution({
          domain: "store_area",
          status: "cross_domain_forbidden",
          sessionUserId: "user-1",
          apiDecision: "deny_403",
          reasonCode: "store_user_cannot_access_zion_admin",
          message:
            "A sessao autenticada nao possui acesso ao dominio interno do ZION.",
        }),
        {
          httpStatus: 403,
          error: "ZION_ADMIN_API_FORBIDDEN",
          status: "cross_domain_forbidden",
          reasonCode: "store_user_cannot_access_zion_admin",
        },
      );
    },
  },
  {
    name: "access_resolution_unavailable returns 503",
    run: async () => {
      await expectDenied(
        createResolution({
          domain: "unresolved",
          status: "access_resolution_unavailable",
          sessionUserId: null,
          safeHtmlDestination: "/account/access-unavailable",
          apiDecision: "deny_503",
          reasonCode: "request_auth_unavailable",
          message:
            "Nao foi possivel validar o acesso da API interna do ZION no momento.",
        }),
        {
          httpStatus: 503,
          error: "ZION_ADMIN_API_ACCESS_UNAVAILABLE",
          status: "access_resolution_unavailable",
          reasonCode: "request_auth_unavailable",
        },
      );
    },
  },
  {
    name: "store_ready_active returns 409",
    run: async () => {
      await expectDenied(
        createResolution({
          status: "store_ready_active",
          sessionUserId: "user-1",
          organizationResolution: "single",
          storeResolution: "single",
          organizationId: "org-1",
          storeId: "store-1",
          commercialAccess: "allowed",
          reasonCode: "ready_active",
          apiDecision: "allow",
        }),
        {
          httpStatus: 409,
          error: "ZION_ADMIN_API_ACCESS_DENIED",
          status: "store_ready_active",
          reasonCode: "ready_active",
        },
      );
    },
  },
  {
    name: "store_ready_onboarding_required returns 409",
    run: async () => {
      await expectDenied(
        createResolution({
          status: "store_ready_onboarding_required",
          sessionUserId: "user-1",
          organizationResolution: "single",
          storeResolution: "single",
          organizationId: "org-1",
          storeId: "store-1",
          commercialAccess: "allowed",
          reasonCode: "onboarding_required",
          apiDecision: "deny_409",
        }),
        {
          httpStatus: 409,
          error: "ZION_ADMIN_API_ACCESS_DENIED",
          status: "store_ready_onboarding_required",
          reasonCode: "onboarding_required",
        },
      );
    },
  },
  {
    name: "other store states return 409",
    run: async () => {
      const states: AccessResolution[] = [
        createResolution({
          status: "store_missing_profile",
          reasonCode: "missing_profile",
        }),
        createResolution({
          status: "store_missing_membership",
          reasonCode: "missing_membership",
        }),
        createResolution({
          domain: "zion_admin",
          status: "account_blocked",
          apiDecision: "deny_403",
          reasonCode: "account_blocked",
        }),
        createResolution({
          status: "store_commercial_blocked",
          apiDecision: "deny_403",
          reasonCode: "commercial_access_blocked",
        }),
      ];

      for (const resolution of states) {
        await expectDenied(resolution, {
          httpStatus:
            resolution.status === "account_blocked" ? 403 : 409,
          error:
            resolution.status === "account_blocked"
              ? "ZION_ADMIN_API_FORBIDDEN"
              : "ZION_ADMIN_API_ACCESS_DENIED",
          status: resolution.status,
          reasonCode: resolution.reasonCode,
        });
      }
    },
  },
  {
    name: "client creation failure returns 503",
    run: async () => {
      const result = await resolveZionAdminApiAccess(
        createDeps(createAllowedResolution(), {
          createSupabaseThrows: true,
        }),
      );

      assert.equal(result.ok, false);
      if (result.ok) {
        throw new Error("expected denied result");
      }

      assert.equal(result.httpStatus, 503);
      assert.equal(result.payload.status, "access_resolution_unavailable");
      assert.equal(result.payload.reasonCode, "request_auth_unavailable");
      assert.equal(result.payload.message.includes("create supabase failed"), false);
      assert.equal(result.resolution.sessionUserId, null);
      assert.equal(result.resolution.organizationId, null);
      assert.equal(result.resolution.storeId, null);
    },
  },
  {
    name: "resolver failure returns 503",
    run: async () => {
      const result = await resolveZionAdminApiAccess(
        createDeps(createAllowedResolution(), {
          resolveAccessThrows: true,
        }),
      );

      assert.equal(result.ok, false);
      if (result.ok) {
        throw new Error("expected denied result");
      }

      assert.equal(result.httpStatus, 503);
      assert.equal(result.payload.status, "access_resolution_unavailable");
      assert.equal(result.payload.reasonCode, "request_auth_unavailable");
      assert.equal(result.payload.message.includes("resolve access failed"), false);
      assert.equal(result.resolution.sessionUserId, null);
      assert.equal(result.resolution.organizationId, null);
      assert.equal(result.resolution.storeId, null);
    },
  },
  {
    name: "zion_admin_allowed with wrong domain returns 503",
    run: async () => {
      await expectTechnicalDenied(
        createResolution({
          domain: "store_area",
          status: "zion_admin_allowed",
          sessionUserId: "user-1",
          safeHtmlDestination: "/zion-admin",
          apiDecision: "allow",
          reasonCode: "zion_admin_allowed",
          message: "A sessao interna do ZION esta autorizada.",
        }),
      );
    },
  },
  {
    name: "zion_admin_allowed with apiDecision different from allow returns 503",
    run: async () => {
      await expectTechnicalDenied(
        createResolution({
          ...createAllowedResolution(),
          apiDecision: "deny_409",
        }),
      );
    },
  },
  {
    name: "zion_admin_allowed with wrong reasonCode returns 503",
    run: async () => {
      await expectTechnicalDenied(
        createResolution({
          ...createAllowedResolution(),
          reasonCode: "ready_active",
        }),
      );
    },
  },
  {
    name: "sessionUserId missing or empty returns 503",
    run: async () => {
      await expectTechnicalDenied(
        createResolution({
          ...createAllowedResolution(),
          sessionUserId: null,
        }),
      );
      await expectTechnicalDenied(
        createResolution({
          ...createAllowedResolution(),
          sessionUserId: "   ",
        }),
      );
    },
  },
  {
    name: "organizationResolution different from none returns 503",
    run: async () => {
      await expectTechnicalDenied(
        createResolution({
          ...createAllowedResolution(),
          organizationResolution: "single",
        }),
      );
    },
  },
  {
    name: "storeResolution different from none returns 503",
    run: async () => {
      await expectTechnicalDenied(
        createResolution({
          ...createAllowedResolution(),
          storeResolution: "single",
        }),
      );
    },
  },
  {
    name: "organizationId or storeId present returns 503",
    run: async () => {
      await expectTechnicalDenied(
        createResolution({
          ...createAllowedResolution(),
          organizationId: "org-1",
        }),
      );
      await expectTechnicalDenied(
        createResolution({
          ...createAllowedResolution(),
          storeId: "store-1",
        }),
      );
    },
  },
  {
    name: "commercialAccess different from unknown returns 503",
    run: async () => {
      await expectTechnicalDenied(
        createResolution({
          ...createAllowedResolution(),
          commercialAccess: "allowed",
        }),
      );
    },
  },
  {
    name: "contradictory resolution does not appear in denied result",
    run: async () => {
      const contradictoryResolution = createResolution({
        ...createAllowedResolution(),
        domain: "store_area",
        organizationResolution: "single",
        organizationId: "org-1",
      });

      const result = await expectTechnicalDenied(contradictoryResolution);

      assert.equal(result.resolution.domain, "unresolved");
      assert.equal(result.resolution.status, "access_resolution_unavailable");
      assert.equal(result.resolution.reasonCode, "request_auth_unavailable");
      assert.notEqual(result.resolution.domain, contradictoryResolution.domain);
      assert.notEqual(result.resolution.status, contradictoryResolution.status);
    },
  },
  {
    name: "denied results do not expose ids",
    run: async () => {
      const result = await resolveZionAdminApiAccess(
        createDeps(
          createResolution({
            status: "store_missing_membership",
            sessionUserId: "user-secret",
            organizationResolution: "single",
            storeResolution: "single",
            organizationId: "org-secret",
            storeId: "store-secret",
          }),
        ),
      );

      assert.equal(result.ok, false);
      if (result.ok) {
        throw new Error("expected denied result");
      }

      assert.equal("sessionUserId" in result, false);
      assert.equal("organizationId" in result, false);
      assert.equal("storeId" in result, false);
      assert.equal(result.resolution.sessionUserId, null);
      assert.equal(result.resolution.organizationId, null);
      assert.equal(result.resolution.storeId, null);
    },
  },
  {
    name: "exception details are never exposed",
    run: async () => {
      const createFailure = await resolveZionAdminApiAccess(
        createDeps(createAllowedResolution(), {
          createSupabaseThrows: true,
        }),
      );
      const resolveFailure = await resolveZionAdminApiAccess(
        createDeps(createAllowedResolution(), {
          resolveAccessThrows: true,
        }),
      );

      for (const result of [createFailure, resolveFailure]) {
        assert.equal(result.ok, false);
        if (result.ok) {
          throw new Error("expected denied result");
        }

        const serialized = JSON.stringify(result);
        assert.equal(serialized.includes("create supabase failed"), false);
        assert.equal(serialized.includes("resolve access failed"), false);
        assert.equal(serialized.includes("Error"), false);
      }
    },
  },
  {
    name: "granted resolution matches granted type",
    run: async () => {
      const result = await resolveZionAdminApiAccess(
        createDeps(createAllowedResolution()),
      );

      assert.equal(result.ok, true);
      if (!result.ok) {
        throw new Error("expected granted result");
      }

      const grantedResolution: ZionAdminApiGrantedResolution = result.resolution;
      assert.equal(grantedResolution.domain, "zion_admin");
      assert.equal(grantedResolution.commercialAccess, "unknown");
    },
  },
  {
    name: "helper source does not use forbidden authorization shortcuts",
    run: () => {
      const filePath = join(__dirname, "zion-admin-api-access.ts");
      const source = readFileSync(filePath, "utf8");

      const forbiddenPatterns = [
        /getSession\s*\(/,
        /auth\.admin/,
        /user_metadata/,
        /app_metadata/,
        /service_role/i,
        /SUPABASE_SERVICE_ROLE_KEY/,
        /zion_internal_admins/,
        /\.from\s*\(/,
        /\.rpc\s*\(/,
        /profiles/,
        /memberships/,
        /organizations/,
        /stores/,
      ];

      for (const pattern of forbiddenPatterns) {
        assert.equal(
          pattern.test(source),
          false,
          `unexpected forbidden pattern in helper source: ${pattern}`,
        );
      }
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`zion-admin-api-access: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

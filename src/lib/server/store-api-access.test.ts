import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccessResolution } from "../account-access-resolution";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiGrantedResolution,
  type StoreApiAccessRequirement,
} from "./store-api-access";

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
    message: "Conta nao esta pronta para usar a API da loja.",
    ...rest,
  };
}

function createAllowedResolution(
  status: "store_ready_active" | "store_ready_onboarding_required",
): AccessResolution {
  return createResolution({
    status,
    sessionUserId: "user-1",
    safeHtmlDestination:
      status === "store_ready_active" ? "/crm" : "/onboarding",
    apiDecision: status === "store_ready_active" ? "allow" : "deny_409",
    organizationResolution: "single",
    storeResolution: "single",
    organizationId: "org-1",
    storeId: "store-1",
    commercialAccess: "allowed",
    reasonCode:
      status === "store_ready_active" ? "ready_active" : "onboarding_required",
    message:
      status === "store_ready_active"
        ? "Conta pronta para usar a loja."
        : "Conta precisa concluir o onboarding.",
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
): ResolveStoreApiAccessDeps {
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
  requirement: StoreApiAccessRequirement,
  resolution: AccessResolution,
  expected: {
    httpStatus: 401 | 403 | 409 | 503;
    error: string;
  },
) {
  const result = await resolveStoreApiAccess({
    requirement,
    deps: createDeps(resolution),
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected denied result");
  }

  assert.equal(result.httpStatus, expected.httpStatus);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, expected.error);
  assert.equal(result.payload.status, resolution.status);
  assert.equal(result.payload.reasonCode, resolution.reasonCode);
  assert.equal(result.resolution.sessionUserId, null);
  assert.equal(result.resolution.organizationId, null);
  assert.equal(result.resolution.storeId, null);
  assert.equal("organizationId" in result, false);
  assert.equal("storeId" in result, false);
}

async function expectTechnicalDeniedAfterAllowedStatus(
  resolution: AccessResolution,
  requirement: StoreApiAccessRequirement = "active_or_onboarding",
) {
  const result = await resolveStoreApiAccess({
    requirement,
    deps: createDeps(resolution),
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected denied result");
  }

  assert.equal(result.httpStatus, 503);
  assert.equal(result.payload.error, "STORE_API_ACCESS_UNAVAILABLE");
  assert.equal(result.payload.status, "access_resolution_unavailable");
  assert.equal(result.payload.reasonCode, "request_auth_unavailable");
  assert.equal(result.resolution.status, "access_resolution_unavailable");
  assert.equal(result.resolution.domain, "unresolved");
  assert.equal(result.resolution.sessionUserId, null);
  assert.equal(result.resolution.organizationId, null);
  assert.equal(result.resolution.storeId, null);

  return result;
}

const denied409Cases: Array<{
  name: string;
  requirement: StoreApiAccessRequirement;
  resolution: AccessResolution;
}> = [
  {
    name: "active rejects onboarding with 409",
    requirement: "active",
    resolution: createAllowedResolution("store_ready_onboarding_required"),
  },
  {
    name: "onboarding rejects active with 409",
    requirement: "onboarding",
    resolution: createAllowedResolution("store_ready_active"),
  },
  {
    name: "first access required returns 409",
    requirement: "active_or_onboarding",
    resolution: createResolution({
      status: "store_first_access_required",
      reasonCode: "first_access_required",
    }),
  },
  {
    name: "provisioning pending returns 409",
    requirement: "active_or_onboarding",
    resolution: createResolution({
      status: "store_provisioning_pending",
      reasonCode: "provisioning_pending",
    }),
  },
  {
    name: "provisioning failed returns 409",
    requirement: "active_or_onboarding",
    resolution: createResolution({
      status: "store_provisioning_failed",
      reasonCode: "provisioning_failed",
    }),
  },
  {
    name: "invalid account returns 409",
    requirement: "active_or_onboarding",
    resolution: createResolution({
      status: "store_invalid_account",
      reasonCode: "invalid_account_metadata",
    }),
  },
  {
    name: "missing profile returns 409",
    requirement: "active_or_onboarding",
    resolution: createResolution({
      status: "store_missing_profile",
      reasonCode: "missing_profile",
    }),
  },
  {
    name: "missing membership returns 409",
    requirement: "active_or_onboarding",
    resolution: createResolution({
      status: "store_missing_membership",
      reasonCode: "missing_membership",
    }),
  },
  {
    name: "missing store returns 409",
    requirement: "active_or_onboarding",
    resolution: createResolution({
      status: "store_missing_store",
      reasonCode: "missing_store",
    }),
  },
  {
    name: "multi org returns 409",
    requirement: "active_or_onboarding",
    resolution: createResolution({
      status: "store_multi_org_unsupported",
      reasonCode: "multi_org_unsupported",
    }),
  },
  {
    name: "multi store returns 409",
    requirement: "active_or_onboarding",
    resolution: createResolution({
      status: "store_multi_store_unsupported",
      reasonCode: "multi_store_unsupported",
    }),
  },
  {
    name: "zion admin allowed returns 409",
    requirement: "active_or_onboarding",
    resolution: createResolution({
      domain: "zion_admin",
      status: "zion_admin_allowed",
      sessionUserId: "user-1",
      safeHtmlDestination: "/zion-admin",
      apiDecision: "allow",
      reasonCode: "zion_admin_allowed",
      message: "Conta de admin interna.",
    }),
  },
];

const tests: TestCase[] = [
  {
    name: "active allows store_ready_active",
    run: async () => {
      let createCount = 0;
      let resolveCount = 0;
      let resolvedDomain = "";
      let resolvedSupabase: unknown = null;
      const resolution = createAllowedResolution("store_ready_active");

      const result = await resolveStoreApiAccess({
        requirement: "active",
        deps: createDeps(resolution, {
          onCreateSupabase: () => {
            createCount += 1;
          },
          onResolveAccess: ({ requestedDomain, supabase }) => {
            resolveCount += 1;
            resolvedDomain = requestedDomain;
            resolvedSupabase = supabase;
          },
        }),
      });

      assert.equal(result.ok, true);
      if (!result.ok) {
        throw new Error("expected granted result");
      }

      assert.equal(result.sessionUserId, "user-1");
      assert.equal(result.organizationId, "org-1");
      assert.equal(result.storeId, "store-1");
      assert.equal(result.resolution.status, "store_ready_active");
      assert.equal(result.resolution.domain, "store_area");
      assert.equal(result.resolution.sessionUserId, "user-1");
      assert.equal(result.resolution.organizationId, "org-1");
      assert.equal(result.resolution.storeId, "store-1");
      assert.equal(result.resolution.organizationResolution, "single");
      assert.equal(result.resolution.storeResolution, "single");
      assert.equal(result.resolution.commercialAccess, "allowed");
      assert.equal(result.supabase, resolvedSupabase);
      assert.equal(createCount, 1);
      assert.equal(resolveCount, 1);
      assert.equal(resolvedDomain, "store_area");
    },
  },
  {
    name: "onboarding allows store_ready_onboarding_required",
    run: async () => {
      const result = await resolveStoreApiAccess({
        requirement: "onboarding",
        deps: createDeps(
          createAllowedResolution("store_ready_onboarding_required"),
        ),
      });

      assert.equal(result.ok, true);
      if (!result.ok) {
        throw new Error("expected granted result");
      }

      assert.equal(result.organizationId, "org-1");
      assert.equal(result.storeId, "store-1");
      assert.equal(result.resolution.status, "store_ready_onboarding_required");
      assert.equal(result.resolution.domain, "store_area");
      assert.equal(result.resolution.sessionUserId, "user-1");
      assert.equal(result.resolution.organizationId, "org-1");
      assert.equal(result.resolution.storeId, "store-1");
      assert.equal(result.resolution.organizationResolution, "single");
      assert.equal(result.resolution.storeResolution, "single");
      assert.equal(result.resolution.commercialAccess, "allowed");
    },
  },
  {
    name: "active_or_onboarding allows active",
    run: async () => {
      const result = await resolveStoreApiAccess({
        requirement: "active_or_onboarding",
        deps: createDeps(createAllowedResolution("store_ready_active")),
      });

      assert.equal(result.ok, true);
    },
  },
  {
    name: "active_or_onboarding allows onboarding",
    run: async () => {
      const result = await resolveStoreApiAccess({
        requirement: "active_or_onboarding",
        deps: createDeps(
          createAllowedResolution("store_ready_onboarding_required"),
        ),
      });

      assert.equal(result.ok, true);
    },
  },
  {
    name: "anonymous returns 401",
    run: async () => {
      await expectDenied(
        "active_or_onboarding",
        createResolution({
          domain: "anonymous",
          status: "anonymous",
          sessionUserId: null,
          safeHtmlDestination: "/login",
          apiDecision: "deny_401",
          reasonCode: "anonymous",
        }),
        {
          httpStatus: 401,
          error: "STORE_API_UNAUTHENTICATED",
        },
      );
    },
  },
  {
    name: "cross domain forbidden returns 403",
    run: async () => {
      await expectDenied(
        "active_or_onboarding",
        createResolution({
          domain: "zion_admin",
          status: "cross_domain_forbidden",
          sessionUserId: null,
          safeHtmlDestination: "/account/access-blocked",
          apiDecision: "deny_403",
          reasonCode: "zion_admin_cannot_access_store_area",
        }),
        {
          httpStatus: 403,
          error: "STORE_API_FORBIDDEN",
        },
      );
    },
  },
  {
    name: "blocked profile returns 403",
    run: async () => {
      await expectDenied(
        "active_or_onboarding",
        createResolution({
          status: "account_blocked",
          apiDecision: "deny_403",
          reasonCode: "account_blocked",
        }),
        {
          httpStatus: 403,
          error: "STORE_API_FORBIDDEN",
        },
      );
    },
  },
  {
    name: "inactive membership returns 403",
    run: async () => {
      await expectDenied(
        "active_or_onboarding",
        createResolution({
          status: "inactive_membership",
          apiDecision: "deny_403",
          reasonCode: "inactive_membership",
        }),
        {
          httpStatus: 403,
          error: "STORE_API_FORBIDDEN",
        },
      );
    },
  },
  {
    name: "commercial blocked returns 403",
    run: async () => {
      await expectDenied(
        "active_or_onboarding",
        createResolution({
          status: "store_commercial_blocked",
          apiDecision: "deny_403",
          reasonCode: "commercial_access_blocked",
        }),
        {
          httpStatus: 403,
          error: "STORE_API_FORBIDDEN",
        },
      );
    },
  },
  {
    name: "unavailable returns 503",
    run: async () => {
      await expectDenied(
        "active_or_onboarding",
        createResolution({
          domain: "unresolved",
          status: "access_resolution_unavailable",
          sessionUserId: null,
          safeHtmlDestination: "/account/access-unavailable",
          apiDecision: "deny_503",
          reasonCode: "request_auth_unavailable",
        }),
        {
          httpStatus: 503,
          error: "STORE_API_ACCESS_UNAVAILABLE",
        },
      );
    },
  },
  ...denied409Cases.map((testCase) => ({
    name: testCase.name,
    run: async () => {
      await expectDenied(testCase.requirement, testCase.resolution, {
        httpStatus: 409,
        error:
          testCase.resolution.status === "store_ready_active" ||
          testCase.resolution.status === "store_ready_onboarding_required"
            ? "STORE_API_REQUIREMENT_MISMATCH"
            : "STORE_API_ACCESS_DENIED",
      });
    },
  })),
  {
    name: "denied states never expose ids",
    run: async () => {
      const states: AccessResolution[] = [
        createResolution({
          status: "store_missing_profile",
          reasonCode: "missing_profile",
        }),
        createResolution({
          status: "store_provisioning_pending",
          reasonCode: "provisioning_pending",
        }),
        createResolution({
          domain: "unresolved",
          status: "access_resolution_unavailable",
          sessionUserId: null,
          apiDecision: "deny_503",
          safeHtmlDestination: "/account/access-unavailable",
          reasonCode: "request_auth_unavailable",
        }),
      ];

      for (const resolution of states) {
        const result = await resolveStoreApiAccess({
          requirement: "active_or_onboarding",
          deps: createDeps(resolution),
        });

        assert.equal(result.ok, false);
        if (result.ok) {
          throw new Error("expected denied result");
        }

        assert.equal("organizationId" in result, false);
        assert.equal("storeId" in result, false);
        assert.equal("sessionUserId" in result, false);
        assert.equal(result.resolution.sessionUserId, null);
        assert.equal(result.resolution.organizationId, null);
        assert.equal(result.resolution.storeId, null);
      }
    },
  },
  {
    name: "denied result sanitizes ids inside returned resolution",
    run: async () => {
      const resolution = createResolution({
        status: "store_missing_membership",
        sessionUserId: "user-secret",
        organizationId: "org-secret",
        storeId: "store-secret",
        organizationResolution: "single",
        storeResolution: "single",
      });

      const result = await resolveStoreApiAccess({
        requirement: "active_or_onboarding",
        deps: createDeps(resolution),
      });

      assert.equal(result.ok, false);
      if (result.ok) {
        throw new Error("expected denied result");
      }

      assert.equal(result.resolution.sessionUserId, null);
      assert.equal(result.resolution.organizationId, null);
      assert.equal(result.resolution.storeId, null);
      assert.equal(result.resolution.status, "store_missing_membership");
      assert.equal(result.resolution.reasonCode, "missing_membership");
    },
  },
  {
    name: "denied sanitization does not mutate original resolution",
    run: async () => {
      const resolution = createResolution({
        status: "store_missing_store",
        sessionUserId: "original-user",
        organizationId: "original-org",
        storeId: "original-store",
        organizationResolution: "single",
        storeResolution: "single",
      });

      const originalSnapshot = {
        sessionUserId: resolution.sessionUserId,
        organizationId: resolution.organizationId,
        storeId: resolution.storeId,
      };

      const result = await resolveStoreApiAccess({
        requirement: "active_or_onboarding",
        deps: createDeps(resolution),
      });

      assert.equal(result.ok, false);
      if (result.ok) {
        throw new Error("expected denied result");
      }

      assert.deepEqual(
        {
          sessionUserId: resolution.sessionUserId,
          organizationId: resolution.organizationId,
          storeId: resolution.storeId,
        },
        originalSnapshot,
      );
    },
  },
  {
    name: "status active plus domain zion_admin returns technical 503",
    run: async () => {
      await expectTechnicalDeniedAfterAllowedStatus(
        createResolution({
          domain: "zion_admin",
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
        "active",
      );
    },
  },
  {
    name: "status active plus organizationResolution none returns technical 503",
    run: async () => {
      await expectTechnicalDeniedAfterAllowedStatus(
        createResolution({
          status: "store_ready_active",
          sessionUserId: "user-1",
          organizationResolution: "none",
          storeResolution: "single",
          organizationId: "org-1",
          storeId: "store-1",
          commercialAccess: "allowed",
          reasonCode: "ready_active",
          apiDecision: "allow",
        }),
        "active",
      );
    },
  },
  {
    name: "status active plus storeResolution none returns technical 503",
    run: async () => {
      await expectTechnicalDeniedAfterAllowedStatus(
        createResolution({
          status: "store_ready_active",
          sessionUserId: "user-1",
          organizationResolution: "single",
          storeResolution: "none",
          organizationId: "org-1",
          storeId: "store-1",
          commercialAccess: "allowed",
          reasonCode: "ready_active",
          apiDecision: "allow",
        }),
        "active",
      );
    },
  },
  {
    name: "status active plus commercialAccess blocked returns technical 503",
    run: async () => {
      await expectTechnicalDeniedAfterAllowedStatus(
        createResolution({
          status: "store_ready_active",
          sessionUserId: "user-1",
          organizationResolution: "single",
          storeResolution: "single",
          organizationId: "org-1",
          storeId: "store-1",
          commercialAccess: "blocked",
          reasonCode: "ready_active",
          apiDecision: "allow",
        }),
        "active",
      );
    },
  },
  {
    name: "status onboarding plus commercialAccess unknown returns technical 503",
    run: async () => {
      await expectTechnicalDeniedAfterAllowedStatus(
        createResolution({
          status: "store_ready_onboarding_required",
          sessionUserId: "user-1",
          organizationResolution: "single",
          storeResolution: "single",
          organizationId: "org-1",
          storeId: "store-1",
          commercialAccess: "unknown",
          reasonCode: "onboarding_required",
          apiDecision: "deny_409",
        }),
        "onboarding",
      );
    },
  },
  {
    name: "structurally invalid allowed resolution does not appear in denied result",
    run: async () => {
      const contradictoryResolution = createResolution({
        domain: "zion_admin",
        status: "store_ready_active",
        sessionUserId: "user-1",
        organizationResolution: "single",
        storeResolution: "single",
        organizationId: "org-1",
        storeId: "store-1",
        commercialAccess: "allowed",
        reasonCode: "ready_active",
        apiDecision: "allow",
      });

      const result = await expectTechnicalDeniedAfterAllowedStatus(
        contradictoryResolution,
        "active",
      );

      assert.equal(result.resolution.domain, "unresolved");
      assert.equal(result.resolution.status, "access_resolution_unavailable");
      assert.equal(result.resolution.safeHtmlDestination, "/account/access-unavailable");
      assert.equal(result.resolution.reasonCode, "request_auth_unavailable");
      assert.notEqual(result.resolution.domain, contradictoryResolution.domain);
      assert.notEqual(result.resolution.status, contradictoryResolution.status);
    },
  },
  {
    name: "success requires session user id",
    run: async () => {
      await expectTechnicalDeniedAfterAllowedStatus(
        createResolution({
          status: "store_ready_active",
          sessionUserId: null,
          organizationResolution: "single",
          storeResolution: "single",
          organizationId: "org-1",
          storeId: "store-1",
          commercialAccess: "allowed",
          reasonCode: "ready_active",
          apiDecision: "allow",
        }),
        "active",
      );
    },
  },
  {
    name: "success requires organization id",
    run: async () => {
      await expectTechnicalDeniedAfterAllowedStatus(
        createResolution({
          status: "store_ready_active",
          sessionUserId: "user-1",
          organizationResolution: "single",
          storeResolution: "single",
          organizationId: null,
          storeId: "store-1",
          commercialAccess: "allowed",
          reasonCode: "ready_active",
          apiDecision: "allow",
        }),
        "active",
      );
    },
  },
  {
    name: "success requires store id",
    run: async () => {
      await expectTechnicalDeniedAfterAllowedStatus(
        createResolution({
          status: "store_ready_active",
          sessionUserId: "user-1",
          organizationResolution: "single",
          storeResolution: "single",
          organizationId: "org-1",
          storeId: null,
          commercialAccess: "allowed",
          reasonCode: "ready_active",
          apiDecision: "allow",
        }),
        "active",
      );
    },
  },
  {
    name: "whitespace only ids are rejected",
    run: async () => {
      await expectTechnicalDeniedAfterAllowedStatus(
        createResolution({
          status: "store_ready_active",
          sessionUserId: "   ",
          organizationResolution: "single",
          storeResolution: "single",
          organizationId: "  ",
          storeId: "\t",
          commercialAccess: "allowed",
          reasonCode: "ready_active",
          apiDecision: "allow",
        }),
        "active",
      );
    },
  },
  {
    name: "runtime invalid requirement fails closed",
    run: async () => {
      const result = await resolveStoreApiAccess({
        requirement: "unknown_requirement" as StoreApiAccessRequirement,
        deps: createDeps(createAllowedResolution("store_ready_active")),
      });

      assert.equal(result.ok, false);
      if (result.ok) {
        throw new Error("expected denied result");
      }

      assert.equal(result.httpStatus, 409);
      assert.equal(result.payload.error, "STORE_API_ACCESS_DENIED");
      assert.equal(result.resolution.sessionUserId, null);
      assert.equal(result.resolution.organizationId, null);
      assert.equal(result.resolution.storeId, null);
    },
  },
  {
    name: "granted branch trims ids and preserves same supabase client",
    run: async () => {
      let resolvedSupabase: unknown = null;
      const result = await resolveStoreApiAccess({
        requirement: "active",
        deps: createDeps(
          createResolution({
            status: "store_ready_active",
            sessionUserId: " user-1 ",
            organizationResolution: "single",
            storeResolution: "single",
            organizationId: " org-1 ",
            storeId: " store-1 ",
            commercialAccess: "allowed",
            reasonCode: "ready_active",
            apiDecision: "allow",
          }),
          {
            onResolveAccess: ({ supabase }) => {
              resolvedSupabase = supabase;
            },
          },
        ),
      });

      assert.equal(result.ok, true);
      if (!result.ok) {
        throw new Error("expected granted result");
      }

      assert.equal(result.sessionUserId, "user-1");
      assert.equal(result.organizationId, "org-1");
      assert.equal(result.storeId, "store-1");
      assert.equal(result.resolution.sessionUserId, result.sessionUserId);
      assert.equal(result.resolution.organizationId, result.organizationId);
      assert.equal(result.resolution.storeId, result.storeId);
      assert.equal(result.supabase, resolvedSupabase);
    },
  },
  {
    name: "top level ids and resolution ids are equal and normalized",
    run: async () => {
      const result = await resolveStoreApiAccess({
        requirement: "active",
        deps: createDeps(
          createResolution({
            status: "store_ready_active",
            sessionUserId: " user-7 ",
            organizationResolution: "single",
            storeResolution: "single",
            organizationId: " org-7 ",
            storeId: " store-7 ",
            commercialAccess: "allowed",
            reasonCode: "ready_active",
            apiDecision: "allow",
          }),
        ),
      });

      assert.equal(result.ok, true);
      if (!result.ok) {
        throw new Error("expected granted result");
      }

      assert.equal(result.sessionUserId, "user-7");
      assert.equal(result.organizationId, "org-7");
      assert.equal(result.storeId, "store-7");
      assert.equal(result.resolution.sessionUserId, "user-7");
      assert.equal(result.resolution.organizationId, "org-7");
      assert.equal(result.resolution.storeId, "store-7");
    },
  },
  {
    name: "granted resolution original object is not mutated",
    run: async () => {
      const resolution = createResolution({
        status: "store_ready_active",
        sessionUserId: " user-9 ",
        organizationResolution: "single",
        storeResolution: "single",
        organizationId: " org-9 ",
        storeId: " store-9 ",
        commercialAccess: "allowed",
        reasonCode: "ready_active",
        apiDecision: "allow",
      });

      const originalSnapshot = {
        sessionUserId: resolution.sessionUserId,
        organizationId: resolution.organizationId,
        storeId: resolution.storeId,
      };

      const result = await resolveStoreApiAccess({
        requirement: "active",
        deps: createDeps(resolution),
      });

      assert.equal(result.ok, true);
      if (!result.ok) {
        throw new Error("expected granted result");
      }

      assert.deepEqual(
        {
          sessionUserId: resolution.sessionUserId,
          organizationId: resolution.organizationId,
          storeId: resolution.storeId,
        },
        originalSnapshot,
      );
    },
  },
  {
    name: "requirement mismatch remains 409 for active receiving onboarding",
    run: async () => {
      await expectDenied(
        "active",
        createAllowedResolution("store_ready_onboarding_required"),
        {
          httpStatus: 409,
          error: "STORE_API_REQUIREMENT_MISMATCH",
        },
      );
    },
  },
  {
    name: "requirement mismatch remains 409 for onboarding receiving active",
    run: async () => {
      await expectDenied(
        "onboarding",
        createAllowedResolution("store_ready_active"),
        {
          httpStatus: 409,
          error: "STORE_API_REQUIREMENT_MISMATCH",
        },
      );
    },
  },
  {
    name: "active valid resolution still matches granted resolution type",
    run: async () => {
      const result = await resolveStoreApiAccess({
        requirement: "active",
        deps: createDeps(createAllowedResolution("store_ready_active")),
      });

      assert.equal(result.ok, true);
      if (!result.ok) {
        throw new Error("expected granted result");
      }

      const grantedResolution: StoreApiGrantedResolution = result.resolution;
      assert.equal(grantedResolution.domain, "store_area");
      assert.equal(grantedResolution.commercialAccess, "allowed");
    },
  },
  {
    name: "onboarding valid resolution still matches granted resolution type",
    run: async () => {
      const result = await resolveStoreApiAccess({
        requirement: "onboarding",
        deps: createDeps(
          createAllowedResolution("store_ready_onboarding_required"),
        ),
      });

      assert.equal(result.ok, true);
      if (!result.ok) {
        throw new Error("expected granted result");
      }

      const grantedResolution: StoreApiGrantedResolution = result.resolution;
      assert.equal(grantedResolution.domain, "store_area");
      assert.equal(grantedResolution.commercialAccess, "allowed");
    },
  },
  {
    name: "createSupabaseServerClient failure returns 503 without throwing",
    run: async () => {
      const result = await resolveStoreApiAccess({
        requirement: "active",
        deps: createDeps(createAllowedResolution("store_ready_active"), {
          createSupabaseThrows: true,
        }),
      });

      assert.equal(result.ok, false);
      if (result.ok) {
        throw new Error("expected denied result");
      }

      assert.equal(result.httpStatus, 503);
      assert.equal(result.resolution.status, "access_resolution_unavailable");
      assert.equal(result.resolution.sessionUserId, null);
      assert.equal(result.resolution.organizationId, null);
      assert.equal(result.resolution.storeId, null);
      assert.equal(result.payload.reasonCode, "request_auth_unavailable");
      assert.equal(result.payload.message.includes("Error"), false);
    },
  },
  {
    name: "resolveAccessForRequest failure returns 503 without throwing",
    run: async () => {
      const result = await resolveStoreApiAccess({
        requirement: "active",
        deps: createDeps(createAllowedResolution("store_ready_active"), {
          resolveAccessThrows: true,
        }),
      });

      assert.equal(result.ok, false);
      if (result.ok) {
        throw new Error("expected denied result");
      }

      assert.equal(result.httpStatus, 503);
      assert.equal(result.resolution.status, "access_resolution_unavailable");
      assert.equal(result.resolution.sessionUserId, null);
      assert.equal(result.resolution.organizationId, null);
      assert.equal(result.resolution.storeId, null);
      assert.equal(result.payload.reasonCode, "request_auth_unavailable");
      assert.equal(result.payload.message.includes("resolve access failed"), false);
    },
  },
  {
    name: "helper source does not use forbidden authorization shortcuts",
    run: () => {
      const filePath = join(__dirname, "store-api-access.ts");
      const source = readFileSync(filePath, "utf8");

      const forbiddenPatterns = [
        /getSession\s*\(/,
        /service_role/i,
        /SUPABASE_SERVICE_ROLE_KEY/,
        /\.from\s*\(/,
        /\.rpc\s*\(/,
        /memberships/,
        /profiles/,
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

  console.log(`store-api-access: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

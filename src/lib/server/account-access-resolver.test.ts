import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveAccessForRequest,
  type AccountAccessResolverDeps,
} from "./account-access-resolver";

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

type CallLog = {
  getAuthAdminUser: number;
  lookupActiveZionAdmin: number;
  lookupProfileExists: number;
  listMemberships: number;
  lookupOrganizationExists: number;
  listStores: number;
  fetchCommercialAccess: number;
  fetchOnboardingRecord: number;
};

function createRequestSupabase(
  userId: string | null,
  options?: { failAuth?: boolean; authError?: boolean; iat?: number | null; claimsError?: boolean },
) {
  return {
    auth: {
      async getUser() {
        if (options?.failAuth) {
          throw new Error("auth failed");
        }

        return {
          data: {
            user: userId === null ? null : { id: userId },
          },
          error: options?.authError ? new Error("auth error") : null,
        };
      },
      async getSession() {
        throw new Error("getSession must not be used for authorization");
      },
      async getClaims() {
        if (options?.claimsError) {
          return {
            data: { claims: null },
            error: new Error("claims error"),
          };
        }

        return {
          data: {
            claims:
              options?.iat === undefined
                ? null
                : {
                    iat: options.iat,
                  },
          },
          error: null,
        };
      },
    },
  };
}

function createCommercialPayload(overrides: Record<string, unknown> = {}) {
  return {
    subscription_status: "active",
    grace_until: null,
    is_blocked: false,
    reason: null,
    token_limit_mensal: 1000,
    token_consumido_atual: 100,
    token_pct: 10,
    ai_mode: "normal",
    ...overrides,
  };
}

function createDeps(
  overrides: Partial<AccountAccessResolverDeps> = {},
  callLog?: Partial<CallLog>,
): AccountAccessResolverDeps {
  const service = {};

  return {
    createServiceClient: () => service,
    getRequestUser: async (supabase) => {
      const claimsResult =
        typeof supabase.auth.getClaims === "function"
          ? await supabase.auth.getClaims()
          : { data: { claims: null }, error: null };
      if (claimsResult.error) {
        return {
          kind: "unavailable" as const,
          failure: {
            reasonCode: "request_auth_unavailable" as const,
            message: "auth unavailable",
          },
        };
      }
      const result = await supabase.auth.getUser();
      if (result.error) {
        return {
          kind: "unavailable" as const,
          failure: {
            reasonCode: "request_auth_unavailable" as const,
            message: "auth unavailable",
          },
        };
      }

      if (!result.data.user) {
        return { kind: "anonymous" as const };
      }

      return {
        kind: "authenticated" as const,
        user: result.data.user,
        jwtIssuedAtSeconds:
          typeof claimsResult.data?.claims?.iat === "number" &&
          Number.isFinite(claimsResult.data.claims.iat)
            ? claimsResult.data.claims.iat
            : null,
      };
    },
    getAuthAdminUser: async (_service, userId) => {
      if (callLog) {
        callLog.getAuthAdminUser = (callLog.getAuthAdminUser ?? 0) + 1;
      }

      return {
        id: userId,
        app_metadata: {
          provisioned_via: "zion-admin",
          zion_provisioning_status: "provisioned",
          zion_first_access_required: false,
        },
      };
    },
    lookupActiveZionAdmin: async () => {
      if (callLog) {
        callLog.lookupActiveZionAdmin =
          (callLog.lookupActiveZionAdmin ?? 0) + 1;
      }

      return false;
    },
    lookupProfileExists: async () => {
      if (callLog) {
        callLog.lookupProfileExists = (callLog.lookupProfileExists ?? 0) + 1;
      }

      return true;
    },
    listMemberships: async () => {
      if (callLog) {
        callLog.listMemberships = (callLog.listMemberships ?? 0) + 1;
      }

      return [{ organization_id: "org-1", created_at: "2026-07-24T00:00:00Z" }];
    },
    lookupOrganizationExists: async () => {
      if (callLog) {
        callLog.lookupOrganizationExists =
          (callLog.lookupOrganizationExists ?? 0) + 1;
      }

      return true;
    },
    listStores: async () => {
      if (callLog) {
        callLog.listStores = (callLog.listStores ?? 0) + 1;
      }

      return [
        {
          id: "store-1",
          organization_id: "org-1",
          created_at: "2026-07-24T00:00:00Z",
        },
      ];
    },
    fetchCommercialAccess: async () => {
      if (callLog) {
        callLog.fetchCommercialAccess =
          (callLog.fetchCommercialAccess ?? 0) + 1;
      }

      return createCommercialPayload();
    },
    fetchOnboardingRecord: async () => {
      if (callLog) {
        callLog.fetchOnboardingRecord =
          (callLog.fetchOnboardingRecord ?? 0) + 1;
      }

      return { status: "completed" };
    },
    ...overrides,
  };
}

const tests: TestCase[] = [
  {
    name: "returns anonymous without user",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase(null),
        deps: createDeps(),
      });

      assert.equal(result.domain, "anonymous");
      assert.equal(result.status, "anonymous");
      assert.equal(result.apiDecision, "deny_401");
      assert.equal(result.safeHtmlDestination, "/login");
    },
  },
  {
    name: "getSession is never used for authorization",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps(),
      });

      assert.equal(result.status, "store_ready_active");
      assert.equal(result.apiDecision, "allow");
    },
  },
  {
    name: "claims failure returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1", { claimsError: true }),
        deps: createDeps(),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.status, "access_resolution_unavailable");
      assert.equal(result.reasonCode, "request_auth_unavailable");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "auth getUser error returns deny 503 not anonymous",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1", { authError: true }),
        deps: createDeps(),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.status, "access_resolution_unavailable");
      assert.equal(result.reasonCode, "request_auth_unavailable");
      assert.equal(result.apiDecision, "deny_503");
      assert.equal(result.safeHtmlDestination, "/account/access-unavailable");
    },
  },
  {
    name: "auth getUser exception returns deny 503 not anonymous",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1", { failAuth: true }),
        deps: createDeps(),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.status, "access_resolution_unavailable");
      assert.equal(result.reasonCode, "request_auth_unavailable");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "service client creation failure returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          createServiceClient: () => {
            throw new Error("service unavailable");
          },
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "service_client_unavailable");
      assert.equal(result.apiDecision, "deny_503");
      assert.equal(result.safeHtmlDestination, "/account/access-unavailable");
    },
  },
  {
    name: "blocked profile denies zion admin access when profile exists",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "zion_admin",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          lookupActiveZionAdmin: async () => true,
          lookupProfileExists: async () => ({
            hasProfile: true,
            isBlocked: true,
          }),
        }),
      });

      assert.equal(result.domain, "zion_admin");
      assert.equal(result.status, "account_blocked");
      assert.equal(result.reasonCode, "account_blocked");
      assert.equal(result.apiDecision, "deny_403");
    },
  },
  {
    name: "zion admin without profile keeps current legitimate access contract",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "zion_admin",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          lookupActiveZionAdmin: async () => true,
          lookupProfileExists: async () => ({
            hasProfile: false,
            isBlocked: false,
          }),
        }),
      });

      assert.equal(result.domain, "zion_admin");
      assert.equal(result.status, "zion_admin_allowed");
      assert.equal(result.reasonCode, "zion_admin_allowed");
      assert.equal(result.apiDecision, "allow");
    },
  },
  {
    name: "active zion admin in public does not call auth admin or store facts",
    run: async () => {
      const calls: Partial<CallLog> = {};
      const result = await resolveAccessForRequest({
        requestedDomain: "public",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps(
          {
            lookupActiveZionAdmin: async () => {
              calls.lookupActiveZionAdmin =
                (calls.lookupActiveZionAdmin ?? 0) + 1;
              return true;
            },
          },
          calls,
        ),
      });

      assert.equal(result.domain, "zion_admin");
      assert.equal(result.status, "zion_admin_allowed");
      assert.equal(result.apiDecision, "allow");
      assert.equal(calls.getAuthAdminUser ?? 0, 0);
      assert.equal(calls.lookupProfileExists ?? 0, 1);
      assert.equal(calls.listMemberships ?? 0, 0);
      assert.equal(calls.lookupOrganizationExists ?? 0, 0);
      assert.equal(calls.listStores ?? 0, 0);
      assert.equal(calls.fetchCommercialAccess ?? 0, 0);
      assert.equal(calls.fetchOnboardingRecord ?? 0, 0);
    },
  },
  {
    name: "active zion admin with legacy provisioning metadata and valid membership resolves store area normally",
    run: async () => {
      const calls: Partial<CallLog> = {};
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps(
          {
            lookupActiveZionAdmin: async () => {
              calls.lookupActiveZionAdmin =
                (calls.lookupActiveZionAdmin ?? 0) + 1;
              return true;
            },
            getAuthAdminUser: async (_service, userId) => {
              calls.getAuthAdminUser = (calls.getAuthAdminUser ?? 0) + 1;
              return {
                id: userId,
                app_metadata: {
                  provisioned_via: "legacy",
                  zion_provisioning_status: "provisioned",
                  zion_first_access_required: true,
                },
              };
            },
          },
          calls,
        ),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_active");
      assert.equal(result.reasonCode, "ready_active");
      assert.equal(result.apiDecision, "allow");
      assert.equal(calls.getAuthAdminUser ?? 0, 1);
      assert.equal(calls.lookupProfileExists ?? 0, 1);
      assert.equal(calls.listMemberships ?? 0, 1);
      assert.equal(calls.lookupOrganizationExists ?? 0, 1);
      assert.equal(calls.listStores ?? 0, 1);
      assert.equal(calls.fetchCommercialAccess ?? 0, 1);
      assert.equal(calls.fetchOnboardingRecord ?? 0, 1);
    },
  },
  {
    name: "blocked profile denies store area before memberships",
    run: async () => {
      const calls: Partial<CallLog> = {};
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps(
          {
            lookupProfileExists: async () => ({
              hasProfile: true,
              isBlocked: true,
            }),
          },
          calls,
        ),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "account_blocked");
      assert.equal(result.reasonCode, "account_blocked");
      assert.equal(result.apiDecision, "deny_403");
      assert.equal(calls.listMemberships ?? 0, 0);
      assert.equal(calls.lookupOrganizationExists ?? 0, 0);
      assert.equal(calls.listStores ?? 0, 0);
      assert.equal(calls.fetchCommercialAccess ?? 0, 0);
    },
  },
  {
    name: "active zion admin without membership is denied by normal store rule",
    run: async () => {
      const calls: Partial<CallLog> = {};
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps(
          {
            lookupActiveZionAdmin: async () => {
              calls.lookupActiveZionAdmin =
                (calls.lookupActiveZionAdmin ?? 0) + 1;
              return true;
            },
            listMemberships: async () => {
              calls.listMemberships = (calls.listMemberships ?? 0) + 1;
              return [];
            },
          },
          calls,
        ),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_missing_membership");
      assert.equal(result.reasonCode, "missing_membership");
      assert.equal(result.apiDecision, "deny_409");
      assert.equal(calls.getAuthAdminUser ?? 0, 1);
      assert.equal(calls.listMemberships ?? 0, 1);
      assert.equal(calls.lookupOrganizationExists ?? 0, 0);
      assert.equal(calls.listStores ?? 0, 0);
      assert.equal(calls.fetchCommercialAccess ?? 0, 0);
      assert.equal(calls.fetchOnboardingRecord ?? 0, 0);
    },
  },
  {
    name: "client trying zion admin is blocked before auth admin lookup",
    run: async () => {
      const calls: Partial<CallLog> = {};
      const result = await resolveAccessForRequest({
        requestedDomain: "zion_admin",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({}, calls),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "cross_domain_forbidden");
      assert.equal(result.reasonCode, "store_user_cannot_access_zion_admin");
      assert.equal(result.apiDecision, "deny_403");
      assert.equal(calls.getAuthAdminUser ?? 0, 0);
    },
  },
  {
    name: "zion admin lookup failure in public returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "public",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          lookupActiveZionAdmin: async () => {
            throw new Error("lookup failed");
          },
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "zion_admin_lookup_unavailable");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "zion admin lookup failure in store area returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          lookupActiveZionAdmin: async () => {
            throw new Error("lookup failed");
          },
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "zion_admin_lookup_unavailable");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "zion admin lookup failure in zion admin returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "zion_admin",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          lookupActiveZionAdmin: async () => {
            throw new Error("lookup failed");
          },
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "zion_admin_lookup_unavailable");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "auth admin lookup failure returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          getAuthAdminUser: async () => {
            throw new Error("auth admin failed");
          },
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "auth_admin_lookup_unavailable");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "auth admin returning another user id returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          getAuthAdminUser: async () => ({
            id: "other-user",
            app_metadata: {
              provisioned_via: "zion-admin",
              zion_provisioning_status: "provisioned",
              zion_first_access_required: false,
            },
          }),
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "malformed_auth_admin_user");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "legacy provisioning metadata does not block a valid store account by itself",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          getAuthAdminUser: async (_service, userId) => ({
            id: userId,
            app_metadata: {
              provisioned_via: "legacy",
              zion_provisioning_status: "provisioned",
              zion_first_access_required: true,
            },
          }),
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_active");
      assert.equal(result.reasonCode, "ready_active");
      assert.equal(result.apiDecision, "allow");
      assert.equal(result.organizationId, "org-1");
      assert.equal(result.storeId, "store-1");
    },
  },
  {
    name: "session issued before password_login_required_after is denied without ids",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1", { iat: 1_700_000_000 }),
        deps: createDeps({
          getAuthAdminUser: async (_service, userId) => ({
            id: userId,
            app_metadata: {
              provisioned_via: "zion-admin",
              zion_provisioning_status: "provisioned",
              zion_first_access_required: false,
              zion_password_login_required_after: "2026-07-28T12:00:00.000Z",
            },
          }),
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_password_login_required");
      assert.equal(result.reasonCode, "password_login_required");
      assert.equal(result.apiDecision, "deny_409");
      assert.equal(result.organizationId, null);
      assert.equal(result.storeId, null);
    },
  },
  {
    name: "session issued after password_login_required_after is accepted",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1", { iat: 1_785_708_000 }),
        deps: createDeps({
          getAuthAdminUser: async (_service, userId) => ({
            id: userId,
            app_metadata: {
              provisioned_via: "zion-admin",
              zion_provisioning_status: "provisioned",
              zion_first_access_required: false,
              zion_password_login_required_after: "2026-07-28T12:00:00.000Z",
            },
          }),
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_active");
      assert.equal(result.reasonCode, "ready_active");
      assert.equal(result.apiDecision, "allow");
    },
  },
  {
    name: "legacy account without login-required marker is unaffected",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1", { iat: 1_700_000_000 }),
        deps: createDeps({
          getAuthAdminUser: async (_service, userId) => ({
            id: userId,
            app_metadata: {
              provisioned_via: "zion-admin",
              zion_provisioning_status: "provisioned",
              zion_first_access_required: false,
            },
          }),
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_active");
      assert.equal(result.apiDecision, "allow");
    },
  },
  {
    name: "legacy provisioning metadata still denies store area without membership",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          getAuthAdminUser: async (_service, userId) => ({
            id: userId,
            app_metadata: {
              provisioned_via: "legacy",
              zion_provisioning_status: "provisioned",
              zion_first_access_required: true,
            },
          }),
          listMemberships: async () => [],
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_missing_membership");
      assert.equal(result.reasonCode, "missing_membership");
      assert.equal(result.apiDecision, "deny_409");
      assert.equal(result.organizationId, null);
      assert.equal(result.storeId, null);
    },
  },
  {
    name: "single inactive membership returns inactive_membership",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listMemberships: async () => [
            {
              organization_id: "org-1",
              is_active: false,
              created_at: "2026-07-24T00:00:00Z",
            },
          ],
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "inactive_membership");
      assert.equal(result.reasonCode, "inactive_membership");
      assert.equal(result.apiDecision, "deny_403");
    },
  },
  {
    name: "multiple inactive memberships return inactive_membership",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listMemberships: async () => [
            {
              organization_id: "org-1",
              is_active: false,
              created_at: "2026-07-24T00:00:00Z",
            },
            {
              organization_id: "org-2",
              is_active: false,
              created_at: "2026-07-25T00:00:00Z",
            },
          ],
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "inactive_membership");
      assert.equal(result.reasonCode, "inactive_membership");
      assert.equal(result.apiDecision, "deny_403");
    },
  },
  {
    name: "one active membership and one inactive membership uses only the active tenant",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listMemberships: async () => [
            {
              organization_id: "org-inactive",
              is_active: false,
              created_at: "2026-07-24T00:00:00Z",
            },
            {
              organization_id: "org-1",
              is_active: true,
              created_at: "2026-07-25T00:00:00Z",
            },
          ],
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_active");
      assert.equal(result.reasonCode, "ready_active");
      assert.equal(result.organizationId, "org-1");
      assert.equal(result.storeId, "store-1");
    },
  },
  {
    name: "inactive membership does not create false multi organization ambiguity",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listMemberships: async () => [
            {
              organization_id: "org-1",
              is_active: true,
              created_at: "2026-07-24T00:00:00Z",
            },
            {
              organization_id: "org-2",
              is_active: false,
              created_at: "2026-07-25T00:00:00Z",
            },
          ],
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_active");
      assert.equal(result.reasonCode, "ready_active");
    },
  },
  {
    name: "multiple active organizations still return multi_org_unsupported",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listMemberships: async () => [
            {
              organization_id: "org-1",
              is_active: true,
              created_at: "2026-07-24T00:00:00Z",
            },
            {
              organization_id: "org-2",
              is_active: true,
              created_at: "2026-07-25T00:00:00Z",
            },
          ],
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_multi_org_unsupported");
      assert.equal(result.reasonCode, "multi_org_unsupported");
      assert.equal(result.apiDecision, "deny_409");
    },
  },
  {
    name: "profile lookup failure returns deny 503 not missing profile",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          lookupProfileExists: async () => {
            throw new Error("profile failed");
          },
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "profile_lookup_unavailable");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "profile missing remains business denial",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          lookupProfileExists: async () => false,
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_missing_profile");
      assert.equal(result.reasonCode, "missing_profile");
      assert.equal(result.apiDecision, "deny_409");
    },
  },
  {
    name: "membership lookup failure returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listMemberships: async () => {
            throw new Error("membership failed");
          },
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "memberships_lookup_unavailable");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "memberships array malformed returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listMemberships: async () => ({ organization_id: "org-1" }),
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "malformed_memberships_contract");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "membership row malformed returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listMemberships: async () => [
            { organization_id: "org-1" },
            { organization_id: null },
          ],
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "malformed_memberships_contract");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "multiple memberships in one organization remain allowed",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listMemberships: async () => [
            { organization_id: "org-1", created_at: "2026-07-24T00:00:00Z" },
            { organization_id: "org-1", created_at: "2026-07-24T00:00:01Z" },
          ],
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_active");
      assert.equal(result.organizationId, "org-1");
      assert.equal(result.storeId, "store-1");
    },
  },
  {
    name: "organization lookup failure returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          lookupOrganizationExists: async () => {
            throw new Error("organization failed");
          },
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "organization_lookup_unavailable");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "organization missing remains business denial",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          lookupOrganizationExists: async () => false,
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "organization_invalid");
      assert.equal(result.apiDecision, "deny_409");
    },
  },
  {
    name: "stores lookup failure returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listStores: async () => {
            throw new Error("stores failed");
          },
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "stores_lookup_unavailable");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "stores array malformed returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listStores: async () => ({ id: "store-1", organization_id: "org-1" }),
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "malformed_stores_contract");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "valid store plus malformed store row returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listStores: async () => [
            { id: "store-1", organization_id: "org-1" },
            { id: null, organization_id: "org-1" },
          ],
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "malformed_stores_contract");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "store from another organization returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listStores: async () => [{ id: "store-1", organization_id: "org-2" }],
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "malformed_stores_contract");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "duplicate store ids return deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listStores: async () => [
            { id: "store-1", organization_id: "org-1" },
            { id: "store-1", organization_id: "org-1" },
          ],
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "malformed_stores_contract");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "store missing remains business denial",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          listStores: async () => [],
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_missing_store");
      assert.equal(result.reasonCode, "missing_store");
      assert.equal(result.apiDecision, "deny_409");
    },
  },
  {
    name: "commercial payload complete and valid keeps access active",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchCommercialAccess: async () => createCommercialPayload(),
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_active");
      assert.equal(result.apiDecision, "allow");
    },
  },
  {
    name: "commercial payload partial returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchCommercialAccess: async () => ({
            is_blocked: false,
            ai_mode: "normal",
          }),
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "malformed_commercial_access_contract");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "ai mode blocked with is blocked false keeps account accessible",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchCommercialAccess: async () =>
            createCommercialPayload({ ai_mode: "blocked", is_blocked: false }),
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_active");
      assert.equal(result.apiDecision, "allow");
    },
  },
  {
    name: "commercial access blocked by is blocked true",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchCommercialAccess: async () =>
            createCommercialPayload({ is_blocked: true, ai_mode: "normal" }),
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_commercial_blocked");
      assert.equal(result.reasonCode, "commercial_access_blocked");
      assert.equal(result.apiDecision, "deny_403");
    },
  },
  {
    name: "commercial lookup failure returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchCommercialAccess: async () => {
            throw new Error("commercial failed");
          },
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "commercial_access_lookup_unavailable");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "onboarding without row requires onboarding",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchOnboardingRecord: async () => null,
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_onboarding_required");
      assert.equal(result.reasonCode, "onboarding_required");
      assert.equal(result.apiDecision, "deny_409");
      assert.equal(result.safeHtmlDestination, "/onboarding");
    },
  },
  {
    name: "status null object requires onboarding",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchOnboardingRecord: async () => ({ status: null }),
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_onboarding_required");
      assert.equal(result.reasonCode, "onboarding_required");
      assert.equal(result.apiDecision, "deny_409");
      assert.equal(result.safeHtmlDestination, "/onboarding");
    },
  },
  {
    name: "singleton onboarding array with status null requires onboarding",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchOnboardingRecord: async () => [{ status: null }],
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_onboarding_required");
      assert.equal(result.reasonCode, "onboarding_required");
      assert.equal(result.organizationId, "org-1");
      assert.equal(result.storeId, "store-1");
    },
  },
  {
    name: "onboarding not started requires onboarding",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchOnboardingRecord: async () => ({ status: "not_started" }),
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_onboarding_required");
      assert.equal(result.reasonCode, "onboarding_required");
      assert.equal(result.apiDecision, "deny_409");
    },
  },
  {
    name: "singleton onboarding array with in progress status still requires onboarding",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchOnboardingRecord: async () => [{ status: "in_progress" }],
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_onboarding_required");
      assert.equal(result.reasonCode, "onboarding_required");
      assert.equal(result.organizationId, "org-1");
      assert.equal(result.storeId, "store-1");
    },
  },
  {
    name: "onboarding in progress requires onboarding",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchOnboardingRecord: async () => ({ status: "in_progress" }),
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_onboarding_required");
      assert.equal(result.reasonCode, "onboarding_required");
      assert.equal(result.apiDecision, "deny_409");
    },
  },
  {
    name: "onboarding object without status remains fail closed",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchOnboardingRecord: async () => ({ store_id: "store-1" }),
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.status, "access_resolution_unavailable");
      assert.equal(result.reasonCode, "malformed_onboarding_contract");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "singleton onboarding array with completed status keeps account active",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchOnboardingRecord: async () => [
            {
              status: "completed",
              organization_id: "org-1",
              store_id: "store-other",
            },
          ],
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_active");
      assert.equal(result.reasonCode, "ready_active");
      assert.equal(result.organizationId, "org-1");
      assert.equal(result.storeId, "store-1");
    },
  },
  {
    name: "onboarding completed keeps account active",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchOnboardingRecord: async () => ({ status: "completed" }),
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_active");
      assert.equal(result.apiDecision, "allow");
    },
  },
  {
    name: "completed onboarding never overrides canonical store resolution",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchOnboardingRecord: async () => ({
            status: "completed",
            organization_id: "org-other",
            store_id: "store-other",
          }),
        }),
      });

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_active");
      assert.equal(result.reasonCode, "ready_active");
      assert.equal(result.organizationId, "org-1");
      assert.equal(result.storeId, "store-1");
    },
  },
  {
    name: "singleton onboarding array with unknown status still returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchOnboardingRecord: async () => [{ status: "mystery" }],
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.status, "access_resolution_unavailable");
      assert.equal(result.reasonCode, "malformed_onboarding_contract");
      assert.equal(result.organizationId, null);
      assert.equal(result.storeId, null);
    },
  },
  {
    name: "unknown onboarding status returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchOnboardingRecord: async () => ({ status: "mystery" }),
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "malformed_onboarding_contract");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "multiple onboarding rows remain fail closed",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchOnboardingRecord: async () => [
            { status: "completed" },
            { status: "completed" },
          ],
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.status, "access_resolution_unavailable");
      assert.equal(result.reasonCode, "malformed_onboarding_contract");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
  {
    name: "temporary onboarding diagnostic was fully removed",
    run: async () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/account-access-resolver.ts"),
        "utf8",
      );

      assert.equal(source.includes("onboarding_contract_diagnostic"), false);
      assert.equal(source.includes("console.info"), false);
    },
  },
  {
    name: "onboarding lookup failure returns deny 503",
    run: async () => {
      const result = await resolveAccessForRequest({
        requestedDomain: "store_area",
        supabase: createRequestSupabase("user-1"),
        deps: createDeps({
          fetchOnboardingRecord: async () => {
            throw new Error("onboarding failed");
          },
        }),
      });

      assert.equal(result.domain, "unresolved");
      assert.equal(result.reasonCode, "onboarding_lookup_unavailable");
      assert.equal(result.apiDecision, "deny_503");
    },
  },
];

export async function runAccountAccessResolverTests() {
  for (const testCase of tests) {
    await testCase.run();
  }

  return {
    count: tests.length,
  };
}

runAccountAccessResolverTests()
  .then((result) => {
    console.log(`account-access-resolver tests: ${result.count} passed`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });

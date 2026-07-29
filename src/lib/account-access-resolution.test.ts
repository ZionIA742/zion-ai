import { strict as assert } from "node:assert";
import {
  resolveAccessState,
  type ResolveAccessStateInput,
} from "./account-access-resolution";

type TestCase = {
  name: string;
  run: () => void;
};

function createInput(
  overrides: Partial<ResolveAccessStateInput> = {},
): ResolveAccessStateInput {
  return {
    requestedDomain: "store_area",
    hasSession: true,
    isActiveZionAdmin: false,
    provisioningStatus: "provisioned",
    firstAccessRequired: false,
    passwordLoginRequired: false,
    hasProfile: true,
    membershipCount: 1,
    distinctOrganizationCount: 1,
    organizationExists: true,
    storeCount: 1,
    commercialAccess: "allowed",
    onboardingRequired: false,
    sessionUserId: "user-1",
    organizationId: "org-1",
    storeId: "store-1",
    resolutionFailure: null,
    ...overrides,
  };
}

const tests: TestCase[] = [
  {
    name: "returns anonymous without session",
    run: () => {
      const result = resolveAccessState(
        createInput({ hasSession: false, sessionUserId: "ignored" }),
      );

      assert.equal(result.domain, "anonymous");
      assert.equal(result.status, "anonymous");
      assert.equal(result.apiDecision, "deny_401");
      assert.equal(result.safeHtmlDestination, "/login");
      assert.equal(result.organizationId, null);
      assert.equal(result.storeId, null);
    },
  },
  {
    name: "routes anonymous zion admin requests to zion admin login",
    run: () => {
      const result = resolveAccessState(
        createInput({ requestedDomain: "zion_admin", hasSession: false }),
      );

      assert.equal(result.domain, "anonymous");
      assert.equal(result.status, "anonymous");
      assert.equal(result.safeHtmlDestination, "/zion-admin/login");
      assert.equal(result.apiDecision, "deny_401");
    },
  },
  {
    name: "session without session user id is fail closed",
    run: () => {
      const result = resolveAccessState(createInput({ sessionUserId: "   " }));

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "invalid_session_user_id");
      assert.equal(result.apiDecision, "deny_409");
      assert.equal(result.safeHtmlDestination, "/account/access-blocked");
    },
  },
  {
    name: "allows valid zion admin domain access",
    run: () => {
      const result = resolveAccessState(
        createInput({
          requestedDomain: "zion_admin",
          isActiveZionAdmin: true,
          provisioningStatus: null,
          membershipCount: -1,
          storeCount: -1,
        }),
      );

      assert.equal(result.domain, "zion_admin");
      assert.equal(result.status, "zion_admin_allowed");
      assert.equal(result.apiDecision, "allow");
      assert.equal(result.safeHtmlDestination, "/zion-admin");
      assert.equal(result.organizationResolution, "none");
      assert.equal(result.storeResolution, "none");
      assert.equal(result.organizationId, null);
      assert.equal(result.storeId, null);
      assert.equal(result.commercialAccess, "unknown");
    },
  },
  {
    name: "client trying zion admin gets cross domain forbidden even with invalid metadata",
    run: () => {
      const result = resolveAccessState(
        createInput({
          requestedDomain: "zion_admin",
          provisioningStatus: null,
          membershipCount: -1,
        }),
      );

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "cross_domain_forbidden");
      assert.equal(result.reasonCode, "store_user_cannot_access_zion_admin");
      assert.equal(result.apiDecision, "deny_403");
      assert.equal(result.safeHtmlDestination, "/account/access-blocked");
      assert.equal(result.organizationId, null);
      assert.equal(result.storeId, null);
    },
  },
  {
    name: "zion admin with valid membership resolves store area normally",
    run: () => {
      const result = resolveAccessState(
        createInput({
          requestedDomain: "store_area",
          isActiveZionAdmin: true,
        }),
      );

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_active");
      assert.equal(result.reasonCode, "ready_active");
      assert.equal(result.apiDecision, "allow");
      assert.equal(result.organizationResolution, "single");
      assert.equal(result.storeResolution, "single");
      assert.equal(result.organizationId, "org-1");
      assert.equal(result.storeId, "store-1");
      assert.equal(result.commercialAccess, "allowed");
    },
  },
  {
    name: "zion admin without membership is denied by normal store membership rule",
    run: () => {
      const result = resolveAccessState(
        createInput({
          requestedDomain: "store_area",
          isActiveZionAdmin: true,
          membershipCount: 0,
          distinctOrganizationCount: 0,
        }),
      );

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_missing_membership");
      assert.equal(result.reasonCode, "missing_membership");
      assert.equal(result.apiDecision, "deny_409");
      assert.equal(result.organizationId, null);
      assert.equal(result.storeId, null);
    },
  },
  {
    name: "zion admin in public ignores store facts entirely",
    run: () => {
      const result = resolveAccessState(
        createInput({
          requestedDomain: "public",
          isActiveZionAdmin: true,
          hasProfile: false,
          membershipCount: -1,
          distinctOrganizationCount: 99,
          organizationExists: false,
          storeCount: -1,
          commercialAccess: "unknown",
          provisioningStatus: null,
        }),
      );

      assert.equal(result.domain, "zion_admin");
      assert.equal(result.status, "zion_admin_allowed");
      assert.equal(result.organizationId, null);
      assert.equal(result.storeId, null);
      assert.equal(result.organizationResolution, "none");
      assert.equal(result.storeResolution, "none");
      assert.equal(result.commercialAccess, "unknown");
    },
  },
  {
    name: "public domain for regular account resolves store area",
    run: () => {
      const result = resolveAccessState(
        createInput({ requestedDomain: "public" }),
      );

      assert.equal(result.domain, "store_area");
      assert.equal(result.status, "store_ready_active");
      assert.equal(result.apiDecision, "allow");
      assert.equal(result.safeHtmlDestination, "/crm");
    },
  },
  {
    name: "first access wins over provisioning pending",
    run: () => {
      const result = resolveAccessState(
        createInput({
          firstAccessRequired: true,
          provisioningStatus: "pending",
        }),
      );

      assert.equal(result.status, "store_first_access_required");
      assert.equal(result.reasonCode, "first_access_required");
      assert.equal(result.apiDecision, "deny_409");
    },
  },
  {
    name: "first access wins over null metadata",
    run: () => {
      const result = resolveAccessState(
        createInput({
          firstAccessRequired: true,
          provisioningStatus: null,
        }),
      );

      assert.equal(result.status, "store_first_access_required");
      assert.equal(result.reasonCode, "first_access_required");
    },
  },
  {
    name: "first access wins over invalid counters",
    run: () => {
      const result = resolveAccessState(
        createInput({
          firstAccessRequired: true,
          membershipCount: -1,
          distinctOrganizationCount: -1,
          storeCount: -1,
        }),
      );

      assert.equal(result.status, "store_first_access_required");
      assert.equal(result.reasonCode, "first_access_required");
    },
  },
  {
    name: "pending wins over commercial access unknown",
    run: () => {
      const result = resolveAccessState(
        createInput({
          provisioningStatus: "pending",
          commercialAccess: "unknown",
        }),
      );

      assert.equal(result.status, "store_provisioning_pending");
      assert.equal(result.reasonCode, "provisioning_pending");
    },
  },
  {
    name: "pending wins over organization and store invalidity",
    run: () => {
      const result = resolveAccessState(
        createInput({
          provisioningStatus: "pending",
          organizationExists: false,
          storeCount: 0,
        }),
      );

      assert.equal(result.status, "store_provisioning_pending");
      assert.equal(result.reasonCode, "provisioning_pending");
    },
  },
  {
    name: "failed wins over profile organization and store invalidity",
    run: () => {
      const result = resolveAccessState(
        createInput({
          provisioningStatus: "failed",
          hasProfile: false,
          organizationExists: false,
          storeCount: 0,
        }),
      );

      assert.equal(result.status, "store_provisioning_failed");
      assert.equal(result.reasonCode, "provisioning_failed");
    },
  },
  {
    name: "null provisioning status does not block a valid store account by itself",
    run: () => {
      const result = resolveAccessState(
        createInput({ provisioningStatus: null }),
      );

      assert.equal(result.status, "store_ready_active");
      assert.equal(result.reasonCode, "ready_active");
      assert.equal(result.apiDecision, "allow");
    },
  },
  {
    name: "unknown provisioning status still requires membership",
    run: () => {
      const result = resolveAccessState(
        createInput({
          provisioningStatus: "unknown",
          membershipCount: 0,
          distinctOrganizationCount: 0,
          organizationId: null,
          storeCount: 0,
          storeId: null,
        }),
      );

      assert.equal(result.status, "store_missing_membership");
      assert.equal(result.reasonCode, "missing_membership");
    },
  },
  {
    name: "invalid provisioning status still fails closed on multi organization ambiguity",
    run: () => {
      const result = resolveAccessState(
        createInput({
          provisioningStatus: "invalid",
          membershipCount: 2,
          distinctOrganizationCount: 2,
          organizationId: null,
          storeCount: 0,
          storeId: null,
        }),
      );

      assert.equal(result.status, "store_multi_org_unsupported");
      assert.equal(result.reasonCode, "multi_org_unsupported");
    },
  },
  {
    name: "invalid provisioning status still fails closed on multi store ambiguity",
    run: () => {
      const result = resolveAccessState(
        createInput({
          provisioningStatus: "invalid",
          storeCount: 2,
          storeId: null,
        }),
      );

      assert.equal(result.status, "store_multi_store_unsupported");
      assert.equal(result.reasonCode, "multi_store_unsupported");
    },
  },
  {
    name: "missing profile wins over lower structural facts",
    run: () => {
      const result = resolveAccessState(
        createInput({
          hasProfile: false,
          membershipCount: -1,
          distinctOrganizationCount: 99,
          organizationExists: false,
          storeCount: -1,
          commercialAccess: "unknown",
        }),
      );

      assert.equal(result.status, "store_missing_profile");
      assert.equal(result.reasonCode, "missing_profile");
    },
  },
  {
    name: "negative membership count is fail closed",
    run: () => {
      const result = resolveAccessState(createInput({ membershipCount: -1 }));

      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "invalid_membership_count");
    },
  },
  {
    name: "non integer membership count is fail closed",
    run: () => {
      const result = resolveAccessState(createInput({ membershipCount: 1.5 }));

      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "invalid_membership_count");
    },
  },
  {
    name: "non finite membership count is fail closed",
    run: () => {
      const result = resolveAccessState(
        createInput({ membershipCount: Number.POSITIVE_INFINITY }),
      );

      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "invalid_membership_count");
    },
  },
  {
    name: "negative distinct organization count is fail closed",
    run: () => {
      const result = resolveAccessState(
        createInput({ distinctOrganizationCount: -1 }),
      );

      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "invalid_distinct_organization_count");
    },
  },
  {
    name: "non integer distinct organization count is fail closed",
    run: () => {
      const result = resolveAccessState(
        createInput({ distinctOrganizationCount: 1.5 }),
      );

      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "invalid_distinct_organization_count");
    },
  },
  {
    name: "non finite distinct organization count is fail closed",
    run: () => {
      const result = resolveAccessState(
        createInput({ distinctOrganizationCount: Number.NaN }),
      );

      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "invalid_distinct_organization_count");
    },
  },
  {
    name: "missing membership wins over store count and commercial access",
    run: () => {
      const result = resolveAccessState(
        createInput({
          membershipCount: 0,
          distinctOrganizationCount: 0,
          storeCount: 9,
          commercialAccess: "blocked",
        }),
      );

      assert.equal(result.status, "store_missing_membership");
      assert.equal(result.reasonCode, "missing_membership");
    },
  },
  {
    name: "membership count zero with distinct organizations fails closed",
    run: () => {
      const result = resolveAccessState(
        createInput({
          membershipCount: 0,
          distinctOrganizationCount: 1,
        }),
      );

      assert.equal(result.status, "store_invalid_account");
      assert.equal(
        result.reasonCode,
        "invalid_membership_organization_counts",
      );
    },
  },
  {
    name: "distinct organization count greater than membership count fails closed",
    run: () => {
      const result = resolveAccessState(
        createInput({
          membershipCount: 1,
          distinctOrganizationCount: 2,
        }),
      );

      assert.equal(result.status, "store_invalid_account");
      assert.equal(
        result.reasonCode,
        "invalid_membership_organization_counts",
      );
    },
  },
  {
    name: "multiple memberships in one organization remain allowed",
    run: () => {
      const result = resolveAccessState(
        createInput({
          membershipCount: 2,
          distinctOrganizationCount: 1,
        }),
      );

      assert.equal(result.status, "store_ready_active");
      assert.equal(result.organizationId, "org-1");
      assert.equal(result.storeId, "store-1");
    },
  },
  {
    name: "multi org wins over organization store and commercial facts",
    run: () => {
      const result = resolveAccessState(
        createInput({
          membershipCount: 3,
          distinctOrganizationCount: 2,
          organizationExists: false,
          storeCount: 0,
          commercialAccess: "blocked",
        }),
      );

      assert.equal(result.status, "store_multi_org_unsupported");
      assert.equal(result.reasonCode, "multi_org_unsupported");
      assert.equal(result.organizationId, null);
      assert.equal(result.storeId, null);
    },
  },
  {
    name: "single organization without organization id is fail closed",
    run: () => {
      const result = resolveAccessState(createInput({ organizationId: "  " }));

      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "organization_id_required");
    },
  },
  {
    name: "invalid organization returns invalid account",
    run: () => {
      const result = resolveAccessState(
        createInput({ organizationExists: false }),
      );

      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "organization_invalid");
    },
  },
  {
    name: "negative store count is fail closed",
    run: () => {
      const result = resolveAccessState(createInput({ storeCount: -1 }));

      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "invalid_store_count");
    },
  },
  {
    name: "non integer store count is fail closed",
    run: () => {
      const result = resolveAccessState(createInput({ storeCount: 1.5 }));

      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "invalid_store_count");
    },
  },
  {
    name: "non finite store count is fail closed",
    run: () => {
      const result = resolveAccessState(
        createInput({ storeCount: Number.NEGATIVE_INFINITY }),
      );

      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "invalid_store_count");
    },
  },
  {
    name: "missing store wins over commercial access unknown",
    run: () => {
      const result = resolveAccessState(
        createInput({
          storeCount: 0,
          storeId: null,
          commercialAccess: "unknown",
        }),
      );

      assert.equal(result.status, "store_missing_store");
      assert.equal(result.reasonCode, "missing_store");
    },
  },
  {
    name: "multiple stores do not select a single store",
    run: () => {
      const result = resolveAccessState(
        createInput({
          storeCount: 2,
          storeId: "store-should-not-leak",
        }),
      );

      assert.equal(result.status, "store_multi_store_unsupported");
      assert.equal(result.reasonCode, "multi_store_unsupported");
      assert.equal(result.storeId, null);
    },
  },
  {
    name: "single store without store id is fail closed",
    run: () => {
      const result = resolveAccessState(createInput({ storeId: " " }));

      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "store_id_required");
    },
  },
  {
    name: "commercial access unknown is fail closed",
    run: () => {
      const result = resolveAccessState(
        createInput({ commercialAccess: "unknown" }),
      );

      assert.equal(result.status, "store_invalid_account");
      assert.equal(result.reasonCode, "commercial_access_unknown");
    },
  },
  {
    name: "commercial block wins over onboarding",
    run: () => {
      const result = resolveAccessState(
        createInput({
          commercialAccess: "blocked",
          onboardingRequired: true,
        }),
      );

      assert.equal(result.status, "store_commercial_blocked");
      assert.equal(result.reasonCode, "commercial_access_blocked");
      assert.equal(result.apiDecision, "deny_403");
    },
  },
  {
    name: "valid account with onboarding goes to onboarding with deny 409",
    run: () => {
      const result = resolveAccessState(
        createInput({ onboardingRequired: true }),
      );

      assert.equal(result.status, "store_ready_onboarding_required");
      assert.equal(result.apiDecision, "deny_409");
      assert.equal(result.safeHtmlDestination, "/onboarding");
      assert.equal(result.organizationId, "org-1");
      assert.equal(result.storeId, "store-1");
    },
  },
  {
    name: "valid account without onboarding goes to crm",
    run: () => {
      const result = resolveAccessState(createInput());

      assert.equal(result.status, "store_ready_active");
      assert.equal(result.apiDecision, "allow");
      assert.equal(result.safeHtmlDestination, "/crm");
      assert.equal(result.organizationId, "org-1");
      assert.equal(result.storeId, "store-1");
    },
  },
  {
    name: "denied store states do not leak ids",
    run: () => {
      const deniedResults = [
        resolveAccessState(createInput({ firstAccessRequired: true })),
        resolveAccessState(createInput({ provisioningStatus: "pending" })),
        resolveAccessState(createInput({ provisioningStatus: "failed" })),
        resolveAccessState(createInput({ hasProfile: false })),
        resolveAccessState(
          createInput({ membershipCount: 0, distinctOrganizationCount: 0 }),
        ),
        resolveAccessState(
          createInput({ membershipCount: 3, distinctOrganizationCount: 2 }),
        ),
        resolveAccessState(createInput({ organizationExists: false })),
        resolveAccessState(createInput({ storeCount: 0, storeId: null })),
        resolveAccessState(createInput({ storeCount: 2 })),
        resolveAccessState(createInput({ commercialAccess: "blocked" })),
      ];

      for (const result of deniedResults) {
        assert.equal(result.organizationId, null);
        assert.equal(result.storeId, null);
      }
    },
  },
  {
    name: "resolution failure returns deny 503 and unavailable destination",
    run: () => {
      const result = resolveAccessState(
        createInput({
          resolutionFailure: {
            reasonCode: "request_auth_unavailable",
            message: "auth unavailable",
          },
        }),
      );

      assert.equal(result.domain, "unresolved");
      assert.equal(result.status, "access_resolution_unavailable");
      assert.equal(result.apiDecision, "deny_503");
      assert.equal(result.safeHtmlDestination, "/account/access-unavailable");
      assert.equal(result.reasonCode, "request_auth_unavailable");
      assert.equal(result.organizationId, null);
      assert.equal(result.storeId, null);
    },
  },
  {
    name: "resolution failure has precedence over missing session",
    run: () => {
      const result = resolveAccessState(
        createInput({
          hasSession: false,
          resolutionFailure: {
            reasonCode: "request_auth_unavailable",
            message: "auth unavailable",
          },
        }),
      );

      assert.equal(result.domain, "unresolved");
      assert.equal(result.status, "access_resolution_unavailable");
      assert.equal(result.apiDecision, "deny_503");
      assert.equal(result.reasonCode, "request_auth_unavailable");
    },
  },
  {
    name: "resolution failure has precedence over valid zion admin facts",
    run: () => {
      const result = resolveAccessState(
        createInput({
          requestedDomain: "zion_admin",
          isActiveZionAdmin: true,
          resolutionFailure: {
            reasonCode: "zion_admin_lookup_unavailable",
            message: "lookup unavailable",
          },
        }),
      );

      assert.equal(result.domain, "unresolved");
      assert.equal(result.status, "access_resolution_unavailable");
      assert.equal(result.apiDecision, "deny_503");
      assert.equal(result.reasonCode, "zion_admin_lookup_unavailable");
    },
  },
  {
    name: "resolution failure hides store context even with session",
    run: () => {
      const result = resolveAccessState(
        createInput({
          resolutionFailure: {
            reasonCode: "malformed_commercial_access_contract",
            message: "bad payload",
          },
        }),
      );

      assert.equal(result.sessionUserId, "user-1");
      assert.equal(result.organizationResolution, "none");
      assert.equal(result.storeResolution, "none");
      assert.equal(result.commercialAccess, "unknown");
      assert.equal(result.organizationId, null);
      assert.equal(result.storeId, null);
    },
  },
];

export function runAccountAccessResolutionTests() {
  for (const testCase of tests) {
    testCase.run();
  }

  return {
    count: tests.length,
  };
}

const result = runAccountAccessResolutionTests();
console.log(`account-access-resolution tests: ${result.count} passed`);

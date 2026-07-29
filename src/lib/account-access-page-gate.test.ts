import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccessResolution } from "./account-access-resolution";
import {
  resolveAccountAccessPageGate,
  type AccountAccessPageGateDecision,
} from "./account-access-page-gate";

type TestCase = {
  name: string;
  run: () => void;
};

function assertRenderDecision(
  decision: AccountAccessPageGateDecision,
): asserts decision is Extract<AccountAccessPageGateDecision, { action: "render" }> {
  assert.equal(decision.action, "render");
  assert.equal(decision.destination, null);
}

function assertRedirectDecision(
  decision: AccountAccessPageGateDecision,
  destination: string,
): asserts decision is Extract<AccountAccessPageGateDecision, { action: "redirect" }> {
  assert.equal(decision.action, "redirect");
  assert.equal(decision.destination, destination);
  assert.equal(typeof decision.destination, "string");
}

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

const storeBlockedStatuses: AccessResolution["status"][] = [
  "store_commercial_blocked",
  "cross_domain_forbidden",
  "store_provisioning_pending",
  "store_provisioning_failed",
  "store_invalid_account",
  "store_missing_profile",
  "store_missing_membership",
  "store_missing_store",
  "store_multi_org_unsupported",
  "store_multi_store_unsupported",
];

const onboardingBlockedStatuses: AccessResolution["status"][] = [
  "store_commercial_blocked",
  "cross_domain_forbidden",
  "store_provisioning_pending",
  "store_provisioning_failed",
  "store_invalid_account",
  "store_missing_profile",
  "store_missing_membership",
  "store_missing_store",
  "store_multi_org_unsupported",
  "store_multi_store_unsupported",
  "zion_admin_allowed",
];

const tests: TestCase[] = [
  {
    name: "store_app renders active access",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_ready_active",
          safeHtmlDestination: "/crm",
          apiDecision: "allow",
          reasonCode: "ready_active",
          organizationResolution: "single",
          storeResolution: "single",
          organizationId: "org-1",
          storeId: "store-1",
          commercialAccess: "allowed",
        }),
        "store_app",
      );

      assertRenderDecision(result);
    },
  },
  {
    name: "store_app redirects onboarding required access to onboarding",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_ready_onboarding_required",
          safeHtmlDestination: "/onboarding",
          apiDecision: "deny_409",
          reasonCode: "onboarding_required",
          organizationResolution: "single",
          storeResolution: "single",
          organizationId: "org-1",
          storeId: "store-1",
          commercialAccess: "allowed",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/onboarding");
    },
  },
  {
    name: "store_app redirects first access to reset password",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_first_access_required",
          safeHtmlDestination: "/auth/reset-password",
          reasonCode: "first_access_required",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/auth/reset-password");
    },
  },
  {
    name: "store_app redirects password login required to login",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_password_login_required",
          safeHtmlDestination: "/login",
          reasonCode: "password_login_required",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/login");
    },
  },
  {
    name: "store_app redirects anonymous to login",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "anonymous",
          domain: "anonymous",
          sessionUserId: null,
          safeHtmlDestination: "/login",
          apiDecision: "deny_401",
          reasonCode: "anonymous",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/login");
    },
  },
  {
    name: "store_app redirects unavailable resolution to access unavailable",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "access_resolution_unavailable",
          domain: "unresolved",
          sessionUserId: null,
          safeHtmlDestination: "/account/access-unavailable",
          apiDecision: "deny_503",
          reasonCode: "request_auth_unavailable",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/account/access-unavailable");
    },
  },
  {
    name: "store_app sends commercial blocked to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_commercial_blocked",
          safeHtmlDestination: "/account/access-blocked",
          apiDecision: "deny_403",
          reasonCode: "commercial_access_blocked",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "store_app sends cross domain to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "cross_domain_forbidden",
          domain: "zion_admin",
          sessionUserId: null,
          safeHtmlDestination: "/account/access-blocked",
          apiDecision: "deny_403",
          reasonCode: "zion_admin_cannot_access_store_area",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "store_app sends provisioning pending to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_provisioning_pending",
          reasonCode: "provisioning_pending",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "store_app sends provisioning failed to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_provisioning_failed",
          reasonCode: "provisioning_failed",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "store_app sends invalid account to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_invalid_account",
          reasonCode: "invalid_account_metadata",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "store_app sends missing profile to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_missing_profile",
          reasonCode: "missing_profile",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "store_app sends missing membership to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_missing_membership",
          reasonCode: "missing_membership",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "store_app sends missing store to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_missing_store",
          reasonCode: "missing_store",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "store_app sends multi org to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_multi_org_unsupported",
          reasonCode: "multi_org_unsupported",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "store_app sends multi store to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_multi_store_unsupported",
          reasonCode: "multi_store_unsupported",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "onboarding renders onboarding required access",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_ready_onboarding_required",
          safeHtmlDestination: "/onboarding",
          apiDecision: "deny_409",
          reasonCode: "onboarding_required",
          organizationResolution: "single",
          storeResolution: "single",
          organizationId: "org-1",
          storeId: "store-1",
          commercialAccess: "allowed",
        }),
        "onboarding",
      );

      assertRenderDecision(result);
    },
  },
  {
    name: "onboarding redirects active access to crm",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_ready_active",
          safeHtmlDestination: "/crm",
          apiDecision: "allow",
          reasonCode: "ready_active",
          organizationResolution: "single",
          storeResolution: "single",
          organizationId: "org-1",
          storeId: "store-1",
          commercialAccess: "allowed",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/crm");
    },
  },
  {
    name: "onboarding redirects first access to reset password",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_first_access_required",
          safeHtmlDestination: "/auth/reset-password",
          reasonCode: "first_access_required",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/auth/reset-password");
    },
  },
  {
    name: "onboarding redirects password login required to login",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_password_login_required",
          safeHtmlDestination: "/login",
          reasonCode: "password_login_required",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/login");
    },
  },
  {
    name: "onboarding redirects anonymous to login",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "anonymous",
          domain: "anonymous",
          sessionUserId: null,
          safeHtmlDestination: "/login",
          apiDecision: "deny_401",
          reasonCode: "anonymous",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/login");
    },
  },
  {
    name: "onboarding redirects unavailable resolution to access unavailable",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "access_resolution_unavailable",
          domain: "unresolved",
          sessionUserId: null,
          safeHtmlDestination: "/account/access-unavailable",
          apiDecision: "deny_503",
          reasonCode: "request_auth_unavailable",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/account/access-unavailable");
    },
  },
  {
    name: "onboarding sends commercial blocked to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_commercial_blocked",
          apiDecision: "deny_403",
          reasonCode: "commercial_access_blocked",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "onboarding sends cross domain to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "cross_domain_forbidden",
          domain: "zion_admin",
          sessionUserId: null,
          apiDecision: "deny_403",
          reasonCode: "zion_admin_cannot_access_store_area",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "onboarding sends provisioning pending to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_provisioning_pending",
          reasonCode: "provisioning_pending",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "onboarding sends provisioning failed to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_provisioning_failed",
          reasonCode: "provisioning_failed",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "onboarding sends invalid account to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_invalid_account",
          reasonCode: "invalid_account_metadata",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "onboarding sends missing profile to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_missing_profile",
          reasonCode: "missing_profile",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "onboarding sends missing membership to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_missing_membership",
          reasonCode: "missing_membership",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "onboarding sends missing store to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_missing_store",
          reasonCode: "missing_store",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "onboarding sends multi org to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_multi_org_unsupported",
          reasonCode: "multi_org_unsupported",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "onboarding sends multi store to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_multi_store_unsupported",
          reasonCode: "multi_store_unsupported",
        }),
        "onboarding",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "onboarding required on onboarding surface does not loop",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "store_ready_onboarding_required",
          safeHtmlDestination: "/onboarding",
          apiDecision: "deny_409",
          reasonCode: "onboarding_required",
        }),
        "onboarding",
      );

      assertRenderDecision(result);
    },
  },
  {
    name: "blocked and unavailable statuses keep their destination mapping",
    run: () => {
      const blockedResult = resolveAccountAccessPageGate(
        createResolution({
          status: "store_missing_membership",
          safeHtmlDestination: "/account/access-blocked",
        }),
        "store_app",
      );
      const unavailableResult = resolveAccountAccessPageGate(
        createResolution({
          status: "access_resolution_unavailable",
          domain: "unresolved",
          sessionUserId: null,
          safeHtmlDestination: "/account/access-unavailable",
          apiDecision: "deny_503",
          reasonCode: "request_auth_unavailable",
        }),
        "onboarding",
      );

      assertRedirectDecision(blockedResult, "/account/access-blocked");
      assertRedirectDecision(unavailableResult, "/account/access-unavailable");
    },
  },
  {
    name: "zion admin allowed on store_app redirects to access blocked",
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({
          status: "zion_admin_allowed",
          domain: "zion_admin",
          safeHtmlDestination: "/zion-admin",
          apiDecision: "allow",
          reasonCode: "zion_admin_allowed",
        }),
        "store_app",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  },
  {
    name: "render decisions always carry null destination",
    run: () => {
      const activeResult = resolveAccountAccessPageGate(
        createResolution({
          status: "store_ready_active",
          safeHtmlDestination: "/crm",
          apiDecision: "allow",
          reasonCode: "ready_active",
          organizationResolution: "single",
          storeResolution: "single",
          organizationId: "org-1",
          storeId: "store-1",
          commercialAccess: "allowed",
        }),
        "store_app",
      );
      const onboardingResult = resolveAccountAccessPageGate(
        createResolution({
          status: "store_ready_onboarding_required",
          safeHtmlDestination: "/onboarding",
          apiDecision: "deny_409",
          reasonCode: "onboarding_required",
          organizationResolution: "single",
          storeResolution: "single",
          organizationId: "org-1",
          storeId: "store-1",
          commercialAccess: "allowed",
        }),
        "onboarding",
      );

      assertRenderDecision(activeResult);
      assertRenderDecision(onboardingResult);
    },
  },
  {
    name: "redirect decisions always carry string destination",
    run: () => {
      const firstAccessResult = resolveAccountAccessPageGate(
        createResolution({
          status: "store_first_access_required",
          safeHtmlDestination: "/auth/reset-password",
          reasonCode: "first_access_required",
        }),
        "store_app",
      );
      const blockedResult = resolveAccountAccessPageGate(
        createResolution({
          status: "store_missing_membership",
          reasonCode: "missing_membership",
        }),
        "onboarding",
      );

      assertRedirectDecision(firstAccessResult, "/auth/reset-password");
      assertRedirectDecision(blockedResult, "/account/access-blocked");
    },
  },
  {
    name: "layout keeps the gate redirect outside the access resolution try catch",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/app/(app)/layout.tsx"),
        "utf8",
      ).replace(/\r\n/g, "\n");
      const createSupabaseCalls = (
        source.match(/createSupabaseServerClient\(/g) ?? []
      ).length;
      const resolveAccessCalls = (
        source.match(/resolveAccessForRequest\(/g) ?? []
      ).length;

      assert.match(source, /export default async function AppLayout\s*\(/);
      assert.equal(source.includes("renderLayout("), false);
      assert.equal(createSupabaseCalls, 1);
      assert.equal(resolveAccessCalls, 1);
      assert.equal(source.includes("OrgGuard"), false);
      assert.equal(source.includes("OnboardingGuard"), false);
      assert.match(
        source,
        /try\s*\{[\s\S]*createSupabaseServerClient\(\)[\s\S]*resolveAccessForRequest\(\{[\s\S]*requestedDomain:\s*"store_area"[\s\S]*\}\);[\s\S]*\}\s*catch\s*\{[\s\S]*redirect\("\/account\/access-unavailable"\);[\s\S]*\}\s*\n\s*const gate = resolveAccountAccessPageGate\(resolution, "store_app"\);\s*\n\s*if \(gate\.action === "redirect"\) \{\s*\n\s*redirect\(gate\.destination\);/,
      );
      assert.match(
        source,
        /if \(gate\.action === "redirect"\) \{\s*\n\s*redirect\(gate\.destination\);\s*\n\s*\}\s*\n\s*\n\s*return <AppShellClient>\{children\}<\/AppShellClient>;/,
      );
    },
  },
];

for (const status of storeBlockedStatuses) {
  tests.push({
    name: `store_app maps ${status} to access blocked`,
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({ status }),
        "store_app",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  });
}

for (const status of onboardingBlockedStatuses) {
  tests.push({
    name: `onboarding maps ${status} to access blocked`,
    run: () => {
      const result = resolveAccountAccessPageGate(
        createResolution({ status }),
        "onboarding",
      );

      assertRedirectDecision(result, "/account/access-blocked");
    },
  });
}

let passed = 0;

for (const test of tests) {
  try {
    test.run();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${test.name}`);
    throw error;
  }
}

console.log(`account-access-page-gate: ${passed}/${tests.length} tests passed`);

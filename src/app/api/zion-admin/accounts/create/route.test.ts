import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

const routePath = join(fileURLToPath(new URL(".", import.meta.url)), "route.ts");
const consumerPath = join(process.cwd(), "src/app/zion-admin/ZionAdminDashboardClient.tsx");

function readSource(path: string) {
  return readFileSync(path, "utf8");
}

const tests: TestCase[] = [
  {
    name: "route keeps canonical admin adapters and extracted core",
    run: () => {
      const source = readSource(routePath);

      const requiredTokens = [
        "resolveZionAdminApiAccess",
        "createZionAdminApiDeniedResponse",
        "createZionAdminApiJsonResponse",
        "async function createZionAdminAccountCore(",
        "async function cleanupFailedProvisioningAttempt(",
        "const firstAccessAttemptId = createFirstAccessAttemptId();",
        "const inviteRedirectTo = getFirstAccessInviteRedirectTo(firstAccessAttemptId);",
        "redirectTo: inviteRedirectTo,",
        "__zionAdminAccountsCreateRouteTestHooks",
        "failureStatus = hasProvisioningTarget(cleanupTarget) ? 503 : 409;",
      ];

      for (const token of requiredTokens) {
        assert.equal(source.includes(token), true, `missing token: ${token}`);
      }
    },
  },
  {
    name: "compensation deletes tenant resources in reverse order before auth user",
    run: () => {
      const source = readSource(routePath);
      const functionStart = source.indexOf(
        "async function deleteProvisioningTenantResources(",
      );
      const functionEnd = source.indexOf("async function markUserAsFailedSafely(", functionStart);
      const compensationSource = source.slice(functionStart, functionEnd);

      const storeOnboardingIndex = compensationSource.indexOf('.from("store_onboarding")');
      const subscriptionsIndex = compensationSource.indexOf('.from("subscriptions")');
      const storesIndex = compensationSource.indexOf('.from("stores")');
      const membershipsIndex = compensationSource.indexOf('.from("memberships")');
      const profilesIndex = compensationSource.indexOf('.from("profiles")');
      const organizationsIndex = compensationSource.indexOf('.from("organizations")');
      const deleteUserIndex = source.indexOf(".auth.admin.deleteUser(params.userId)");

      assert.notEqual(functionStart, -1);
      assert.notEqual(functionEnd, -1);
      assert.notEqual(storeOnboardingIndex, -1);
      assert.notEqual(subscriptionsIndex, -1);
      assert.notEqual(storesIndex, -1);
      assert.notEqual(membershipsIndex, -1);
      assert.notEqual(profilesIndex, -1);
      assert.notEqual(organizationsIndex, -1);
      assert.notEqual(deleteUserIndex, -1);
      assert.equal(storeOnboardingIndex < subscriptionsIndex, true);
      assert.equal(subscriptionsIndex < storesIndex, true);
      assert.equal(storesIndex < membershipsIndex, true);
      assert.equal(membershipsIndex < profilesIndex, true);
      assert.equal(profilesIndex < organizationsIndex, true);
      assert.equal(organizationsIndex < deleteUserIndex, true);
    },
  },
  {
    name: "POST remains gated and consumer route stays unchanged",
    run: () => {
      const routeSource = readSource(routePath);
      const consumerSource = readSource(consumerPath);

      assert.equal(routeSource.includes("const access = await resolveZionAdminApiAccess()"), true);
      assert.equal(routeSource.includes("return createZionAdminApiDeniedResponse(access)"), true);
      assert.equal(routeSource.includes("const body = await request.json().catch(() => null)"), true);
      assert.equal(routeSource.includes("serviceSupabase: createServiceSupabaseClient(),"), true);
      assert.equal(consumerSource.includes("/api/zion-admin/accounts/create"), true);
    },
  },
];

async function run() {
  for (const test of tests) {
    test.run();
  }

  console.log(`zion-admin-accounts-create-route: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

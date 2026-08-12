import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

const routePath = join(fileURLToPath(new URL(".", import.meta.url)), "route.ts");
const pagePath = join(process.cwd(), "src/app/zion-admin/page.tsx");

function readSource(path: string) {
  return readFileSync(path, "utf8");
}

function getGetFunctionSource(source: string) {
  const marker = "export async function GET()";
  const start = source.indexOf(marker);

  assert.notEqual(start, -1, "GET function must exist");

  return source.slice(start);
}

function countOccurrences(source: string, token: string) {
  return source.split(token).length - 1;
}

const tests: TestCase[] = [
  {
    name: "route uses canonical zion admin access and response helpers",
    run: () => {
      const source = readSource(routePath);

      assert.equal(source.includes("resolveZionAdminApiAccess"), true);
      assert.equal(source.includes("createZionAdminApiDeniedResponse"), true);
      assert.equal(source.includes("createZionAdminApiJsonResponse"), true);
    },
  },
  {
    name: "GET resolves access exactly once before service role and queries",
    run: () => {
      const source = readSource(routePath);
      const getSource = getGetFunctionSource(source);
      const resolveIndex = getSource.indexOf(
        "const access = await resolveZionAdminApiAccess()",
      );
      const deniedIndex = getSource.indexOf(
        "return createZionAdminApiDeniedResponse(access)",
      );
      const serviceRoleIndex = getSource.indexOf(
        "const serviceSupabase = getServiceSupabaseClient()",
      );
      const firstQueryIndex = getSource.indexOf("await Promise.all([");

      assert.notEqual(resolveIndex, -1);
      assert.notEqual(deniedIndex, -1);
      assert.notEqual(serviceRoleIndex, -1);
      assert.notEqual(firstQueryIndex, -1);
      assert.equal(countOccurrences(getSource, "resolveZionAdminApiAccess()"), 1);
      assert.equal(resolveIndex < deniedIndex, true);
      assert.equal(deniedIndex < serviceRoleIndex, true);
      assert.equal(deniedIndex < firstQueryIndex, true);
    },
  },
  {
    name: "manual gate and forbidden auth patterns are absent",
    run: () => {
      const source = readSource(routePath);

      const forbiddenTokens = [
        'from("zion_internal_admins")',
        ".auth.getUser(",
        "getSession(",
        "resolveStoreApiAccess",
        "resolveAccessForRequest",
        "NextResponse.json",
        "details:",
        "error?.message",
        "stack",
        "cause",
        "createServerClient",
        "cookies(",
      ];

      for (const token of forbiddenTokens) {
        assert.equal(
          source.includes(token),
          false,
          `unexpected token in overview route: ${token}`,
        );
      }
    },
  },
  {
    name: "success contract keys remain present",
    run: () => {
      const source = readSource(routePath);

      assert.equal(source.includes("admin: {"), true);
      assert.equal(source.includes("totals: {"), true);
      assert.equal(source.includes("countErrors: {"), true);
      assert.equal(source.includes("stores: storesList"), true);
      assert.equal(source.includes("future: {"), true);
    },
  },
  {
    name: "store payload includes account access snapshot",
    run: () => {
      const source = readSource(routePath);

      const requiredTokens = [
        "loadStoreAccountAccessSnapshots(",
        "accountAccess:",
        "responsibleName:",
        "emailMasked:",
        "cooldownRemainingMs:",
      ];

      for (const token of requiredTokens) {
        assert.equal(source.includes(token), true, `missing token: ${token}`);
      }
    },
  },
  {
    name: "overview uses canonical subscriptions status and does not silently fallback to organization status",
    run: () => {
      const source = readSource(routePath);

      assert.equal(source.includes('.from("subscriptions")'), true);
      assert.equal(source.includes('select("id, organization_id, status, created_at")'), true);
      assert.equal(source.includes("buildCanonicalSubscriptionMap("), true);
      assert.equal(source.includes('subscriptionStatus: organization?.subscription_status'), false);
    },
  },
  {
    name: "consumer route path remains unchanged",
    run: () => {
      const source = readSource(pagePath);

      assert.equal(source.includes("/api/zion-admin/overview"), true);
    },
  },
];

async function run() {
  for (const test of tests) {
    test.run();
  }

  console.log(`zion-admin-overview-route: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

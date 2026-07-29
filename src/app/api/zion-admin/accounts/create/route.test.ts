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

function getPostFunctionSource(source: string) {
  const marker = "export async function POST(request: Request)";
  const start = source.indexOf(marker);

  assert.notEqual(start, -1, "POST function must exist");

  return source.slice(start);
}

function countOccurrences(source: string, token: string) {
  return source.split(token).length - 1;
}

const tests: TestCase[] = [
  {
    name: "route uses canonical zion admin helpers",
    run: () => {
      const source = readSource(routePath);

      assert.equal(source.includes("resolveZionAdminApiAccess"), true);
      assert.equal(source.includes("createZionAdminApiDeniedResponse"), true);
      assert.equal(source.includes("createZionAdminApiJsonResponse"), true);
    },
  },
  {
    name: "POST resolves access exactly once before body and service role",
    run: () => {
      const source = readSource(routePath);
      const postSource = getPostFunctionSource(source);
      const resolveIndex = postSource.indexOf(
        "const access = await resolveZionAdminApiAccess()",
      );
      const deniedIndex = postSource.indexOf(
        "return createZionAdminApiDeniedResponse(access)",
      );
      const jsonIndex = postSource.indexOf("const body = await request.json()");
      const emailValidationIndex = postSource.indexOf('if (!email)');
      const serviceRoleIndex = postSource.indexOf(
        "const serviceSupabase = createServiceSupabaseClient()",
      );
      const authAdminIndex = postSource.indexOf(
        "findAuthUserByEmail(serviceSupabase, email)",
      );
      const rpcIndex = postSource.indexOf("runProvisioningRpc(serviceSupabase, {");

      assert.notEqual(resolveIndex, -1);
      assert.notEqual(deniedIndex, -1);
      assert.notEqual(jsonIndex, -1);
      assert.notEqual(emailValidationIndex, -1);
      assert.notEqual(serviceRoleIndex, -1);
      assert.equal(countOccurrences(postSource, "resolveZionAdminApiAccess()"), 1);
      assert.equal(resolveIndex < deniedIndex, true);
      assert.equal(deniedIndex < jsonIndex, true);
      assert.equal(jsonIndex < emailValidationIndex, true);
      assert.equal(emailValidationIndex < serviceRoleIndex, true);
      assert.equal(serviceRoleIndex < authAdminIndex, true);
      assert.equal(serviceRoleIndex < rpcIndex, true);
    },
  },
  {
    name: "manual gate and forbidden patterns are absent",
    run: () => {
      const source = readSource(routePath);

      const forbiddenTokens = [
        "createSupabaseServerClient",
        ".auth.getUser(",
        "getSession(",
        'from("zion_internal_admins")',
        "resolveStoreApiAccess",
        "resolveAccessForRequest",
        "NextResponse.json",
        "details:",
        "stack",
        "cause",
        "error.message",
      ];

      for (const token of forbiddenTokens) {
        assert.equal(
          source.includes(token),
          false,
          `unexpected token in accounts/create route: ${token}`,
        );
      }
    },
  },
  {
    name: "cleanup failure path is protected and ends through JSON adapter",
    run: () => {
      const source = readSource(routePath);
      const postSource = getPostFunctionSource(source);
      const cleanupBlockIndex = postSource.indexOf("if (invitedUserId) {");
      const cleanupTryIndex = postSource.indexOf("try {", cleanupBlockIndex);
      const cleanupCreateClientIndex = postSource.indexOf(
        "const serviceSupabase = createServiceSupabaseClient()",
        cleanupBlockIndex,
      );
      const cleanupCallIndex = postSource.indexOf(
        "const cleanup = await deleteUserOrMarkFailed(",
        cleanupBlockIndex,
      );
      const cleanupCatchIndex = postSource.indexOf("} catch (cleanupError) {", cleanupBlockIndex);
      const partialReviewCodeIndex = postSource.indexOf(
        "code: PARTIAL_REVIEW_CODE",
        cleanupCatchIndex,
      );
      const partialReviewResponseIndex = postSource.indexOf(
        "return createZionAdminApiJsonResponse(",
        cleanupCatchIndex,
      );

      assert.notEqual(cleanupBlockIndex, -1);
      assert.notEqual(cleanupTryIndex, -1);
      assert.notEqual(cleanupCreateClientIndex, -1);
      assert.notEqual(cleanupCallIndex, -1);
      assert.notEqual(cleanupCatchIndex, -1);
      assert.notEqual(partialReviewCodeIndex, -1);
      assert.notEqual(partialReviewResponseIndex, -1);
      assert.equal(cleanupBlockIndex < cleanupTryIndex, true);
      assert.equal(cleanupTryIndex < cleanupCreateClientIndex, true);
      assert.equal(cleanupCreateClientIndex < cleanupCallIndex, true);
      assert.equal(cleanupCallIndex < cleanupCatchIndex, true);
      assert.equal(cleanupCatchIndex < partialReviewResponseIndex, true);
      assert.equal(partialReviewResponseIndex < partialReviewCodeIndex, true);
      assert.equal(
        postSource.includes("throw cleanupError"),
        false,
        "cleanup errors must not be rethrown from POST",
      );
    },
  },
  {
    name: "public success fields remain present",
    run: () => {
      const source = readSource(routePath);

      const requiredTokens = [
        "ok: true",
        "invited: false",
        "invited: true",
        "recovered: true",
        "userId:",
        "organizationId:",
        "storeId:",
        'membershipRole: "owner"',
        "provisioningStatus:",
        "accessMode:",
        "nextStep:",
        "message:",
        "code:",
      ];

      for (const token of requiredTokens) {
        assert.equal(source.includes(token), true, `missing token: ${token}`);
      }
    },
  },
  {
    name: "initial invite now targets set-initial-password with tracked attempt metadata",
    run: () => {
      const source = readSource(routePath);

      const requiredTokens = [
        "createFirstAccessAttemptId()",
        "getFirstAccessInviteRedirectTo(firstAccessAttemptId)",
        "createFirstAccessInviteMetadataPatch({",
        'redirectTo: inviteRedirectTo',
      ];

      for (const token of requiredTokens) {
        assert.equal(source.includes(token), true, `missing token: ${token}`);
      }
    },
  },
  {
    name: "consumer route path remains unchanged",
    run: () => {
      const source = readSource(consumerPath);

      assert.equal(source.includes("/api/zion-admin/accounts/create"), true);
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

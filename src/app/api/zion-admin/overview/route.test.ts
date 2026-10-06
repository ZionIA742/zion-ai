import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  loadAllOverviewRows,
  loadAllOverviewRowsByChunks,
  OVERVIEW_IN_CHUNK_SIZE,
  OVERVIEW_LOAD_ERROR,
  OVERVIEW_MAX_PAGES,
} from "./overview-pagination";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
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
    name: "store payload includes canonical operational health",
    run: () => {
      const source = readSource(routePath);

      const requiredTokens = [
        "buildStoreOperationalHealthInputs(",
        "resolveStoreOperationalHealth(",
        "operationalHealthInputsByStoreId",
        "operationalHealth,",
        "assistantProcessingStaleMs: 15 * 60 * 1000",
        '.from("store_assistant_operational_task_queue")',
        '.from("store_responsible_external_notifications")',
        '.from("schedule_post_appointment_followups")',
        "outbound_delivery_state",
        "scheduled_end",
        "prompt_count",
        "last_prompted_at",
      ];

      for (const token of requiredTokens) {
        assert.equal(
          source.includes(token),
          true,
          `missing operational health token: ${token}`,
        );
      }

      assert.equal(countOccurrences(source, '.from("ai_runs")'), 1);
      assert.equal(
        countOccurrences(source, '.from("channel_whatsapp_inbox")'),
        1,
      );
    },
  },
  {
    name: "operational health source failures fail closed independently",
    run: () => {
      const source = readSource(routePath);

      const requiredTokens = [
        "whatsappIssueRows.error == null ? whatsappIssueRows.rows : null",
        "whatsappOutboundHealthRows.error == null",
        "aiRunRows.error == null ? aiRunRows.rows : null",
        "aiRunQueueIssueRows.error == null",
        "assistantOperationalHealthRows.error == null",
        "responsibleNotificationHealthRows.error == null",
        "appointmentHealthRows.error == null",
        "postAppointmentFollowupHealthRows.error == null",
      ];

      for (const token of requiredTokens) {
        assert.equal(
          source.includes(token),
          true,
          `missing fail-closed source token: ${token}`,
        );
      }

      assert.equal(source.includes("metrics.configurationIssues +"), true);
      assert.equal(source.includes("metrics.pendingAiRuns +"), true);
      assert.equal(source.includes("metrics.pendingWhatsappEvents +"), true);
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
        "lastInviteHistoryStatus:",
        "firstAccessHistoryStatus:",
      ];

      for (const token of requiredTokens) {
        assert.equal(source.includes(token), true, `missing token: ${token}`);
      }
    },
  },
  {
    name: "store payload includes canonical integrity without removing legacy orphan shape",
    run: () => {
      const source = readSource(routePath);

      for (const token of [
        "resolveStoreIntegrity(",
        "integrityByOrganizationId",
        "integrity:",
        "orphanStoresCount:",
        "orphanStores:",
      ]) {
        assert.equal(source.includes(token), true, `missing integrity contract token: ${token}`);
      }
    },
  },
  {
    name: "integrity is resolved from all stores while account access remains operational-only",
    run: () => {
      const source = readSource(routePath);

      const allStoresLoad = source.indexOf("loadStoreOwnerData(serviceSupabase, stores)");
      const accountAccessLoad = source.indexOf("loadStoreAccountAccessSnapshots(");
      const operationalStoresReference = source.indexOf("operationalStores,");
      const orphanSummaryIntegrity = source.indexOf("const orphanStoreSummaries = orphanStores.map");
      const orphanIntegrityField = source.indexOf("integrityByOrganizationId.get(store.organization_id)");

      assert.notEqual(allStoresLoad, -1);
      assert.notEqual(accountAccessLoad, -1);
      assert.notEqual(operationalStoresReference, -1);
      assert.notEqual(orphanSummaryIntegrity, -1);
      assert.equal(orphanIntegrityField > orphanSummaryIntegrity, true);
      assert.equal(source.includes("stores: storesList"), true);
    },
  },
  {
    name: "single membership load preserves any-membership orphan semantics and owner filtering",
    run: () => {
      const source = readSource(routePath);
      const membershipQueries = source.match(/\.from\("memberships"\)/g) ?? [];
      const ownerDataSource = source.slice(
        source.indexOf("async function loadStoreOwnerData"),
        source.indexOf("async function loadStoreAccountAccessSnapshots"),
      );

      assert.equal(membershipQueries.length, 1);
      assert.equal(ownerDataSource.includes("organizationIdsWithMemberships.add(organizationId)"), true);
      assert.equal(ownerDataSource.includes('normalizeRole(membership.role) !== "owner"'), true);
      assert.equal(source.includes("ownerData.organizationIdsWithMemberships"), true);
    },
  },
  {
    name: "legacy invalid-account snapshots mark first-access history as unavailable",
    run: () => {
      const source = readSource(routePath);

      assert.equal(source.includes('summaryStatus === "invalid_account" && !args.timestamp'), true);
      assert.equal(source.includes("lastInviteHistoryStatus = getAccountAccessHistoryStatus({"), true);
      assert.equal(source.includes("firstAccessHistoryStatus = getAccountAccessHistoryStatus({"), true);
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
  {
    name: "overview pagination aggregates every page and preserves deterministic ranges",
    run: async () => {
      const requestedRanges: Array<[number, number]> = [];
      const allRows = Array.from({ length: 501 }, (_, index) => index);
      const result = await loadAllOverviewRows<number>(async (from, to) => {
        requestedRanges.push([from, to]);
        return { data: allRows.slice(from, to + 1), error: null };
      });

      assert.deepEqual(result.rows, allRows);
      assert.equal(result.error, null);
      assert.deepEqual(requestedRanges, [[0, 499], [500, 999]]);
    },
  },
  {
    name: "overview pagination stops on a partial final page",
    run: async () => {
      let calls = 0;
      const result = await loadAllOverviewRows<number>(async () => {
        calls += 1;
        return { data: [1], error: null };
      }, 2);

      assert.deepEqual(result, { rows: [1], error: null });
      assert.equal(calls, 1);
    },
  },
  {
    name: "intermediate page errors do not become a partial successful list",
    run: async () => {
      const result = await loadAllOverviewRows<number>(async (from) => {
        if (from === 0) {
          return { data: [1, 2], error: null };
        }

        return { data: null, error: new Error("page unavailable") };
      }, 2);

      assert.deepEqual(result.rows, []);
       assert.equal(result.error, OVERVIEW_LOAD_ERROR);
    },
  },
  {
    name: "chunked overview lists deduplicate ids and aggregate pages",
    run: async () => {
      const requestedValues: string[] = [];
      const result = await loadAllOverviewRowsByChunks<number>({
        values: ["a", "b", "a", "c"],
        chunkSize: 2,
        loadPage: async (values, from, to) => {
          requestedValues.push(...values);
          const pageRows = values.map((value) => value.charCodeAt(0)).slice(from, to + 1);
          return { data: pageRows, error: null };
        },
      });

      assert.deepEqual(requestedValues, ["a", "b", "c"]);
      assert.deepEqual(result.rows, [97, 98, 99]);
      assert.equal(result.error, null);
    },
  },
  {
    name: "chunk failure discards rows from earlier chunks",
    run: async () => {
      let calls = 0;
      const result = await loadAllOverviewRowsByChunks<number>({
        values: ["a", "b", "c"],
        chunkSize: 2,
        loadPage: async (values) => {
          calls += 1;
          return values[0] === "c"
            ? { data: null, error: new Error("chunk unavailable") }
            : { data: [1], error: null };
        },
      });

      assert.equal(calls, 2);
      assert.deepEqual(result, { rows: [], error: OVERVIEW_LOAD_ERROR });
    },
  },
  {
    name: "overview pagination fails closed at the operational page guard",
    run: async () => {
      let calls = 0;
      const result = await loadAllOverviewRows<number>(async () => {
        calls += 1;
        return { data: [1], error: null };
      }, 1);

      assert.equal(calls, OVERVIEW_MAX_PAGES);
      assert.deepEqual(result, { rows: [], error: OVERVIEW_LOAD_ERROR });
    },
  },
  {
    name: "empty successful page remains a real zero",
    run: async () => {
      const result = await loadAllOverviewRows<number>(async () => ({
        data: [],
        error: null,
      }));

      assert.deepEqual(result, { rows: [], error: null });
    },
  },
  {
    name: "count-only queries and intentional recent-detail limits remain explicit",
    run: () => {
      const source = readSource(routePath);

      assert.equal(source.includes('select("id", { count: "exact", head: true })'), true);
      assert.equal(source.includes(".slice(0, 50)"), true);
      assert.equal(source.includes(".slice(0, 20)"), true);
      assert.equal(source.includes(".limit(100)"), false);
      assert.equal(source.includes(".limit(200)"), false);
      assert.equal(source.includes(".limit(500)"), false);
    },
  },
  {
    name: "unbounded overview in filters use the chunk helper",
    run: () => {
      const source = readSource(routePath);
      assert.equal(source.includes("loadAllOverviewRowsByChunks<OwnerMembershipRow>"), true);
      assert.equal(source.includes("loadAllOverviewRowsByChunks<ProfileAccessRow>"), true);
      assert.equal(source.includes(".in(\"organization_id\", organizationIds)"), false);
      assert.equal(source.includes(".in(\"user_id\", ownerUserIds)"), false);
      assert.equal(source.includes(".in(\"organization_id\", storeOrganizationIds)"), false);
      assert.equal(OVERVIEW_IN_CHUNK_SIZE, 100);
    },
  },
  {
    name: "organizations stores and subscriptions remain fully paginated",
    run: () => {
      const source = readFileSync(routePath, "utf8");
      const required = [
        'loadAllOverviewRows<OrganizationRow>((from, to)',
        'loadAllOverviewRows<SubscriptionRow>((from, to)',
        'loadAllOverviewRows<StoreRow>((from, to)',
        '.from("organizations")',
        '.from("subscriptions")',
        '.from("stores")',
      ];

      for (const token of required) {
        assert.equal(source.includes(token), true, `missing pagination contract: ${token}`);
      }
    },
  },
  {
    name: "overview paginated ordering has stable tie breakers",
    run: () => {
      const source = readSource(routePath);
      const required = [
        '.from("store_onboarding")',
        '.order("store_id", { ascending: true })',
        'loadStoreBooleanConfigRows(serviceSupabase, "store_responsibles")',
        'loadStoreBooleanConfigRows(serviceSupabase, "store_schedule_settings")',
        'loadStoreBooleanConfigRows(serviceSupabase, "store_discount_settings")',
        'loadStoreAuthConfigRows(serviceSupabase)',
        'if (table === "store_responsibles")',
        '.order("id", { ascending: true })',
        '.from("profiles")',
        '.order("user_id", { ascending: true })',
      ];

      for (const token of required) {
        assert.equal(source.includes(token), true, `missing deterministic ordering evidence: ${token}`);
      }
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`zion-admin-overview-route: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { strict as assert } from "node:assert";
import Module from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type UserRow = {
  id: string;
  email?: string | null;
  invited_at?: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
};

type TableMap = Record<string, Array<Record<string, unknown>>>;

type HarnessState = {
  users: UserRow[];
  tables: TableMap;
  calls: {
    updateUserById: number;
    deleteUser: number;
    inviteUserByEmail: number;
    provisioningRpc: number;
    deleteOrder: string[];
    operationOrder: string[];
  };
  failures: {
    inviteError?: { message: string };
    updateUserByIdAtCalls?: number[];
    updateUserByIdFailureByMetadataStatus?: Array<string | null>;
    deleteUserError?: { message: string } | null;
    deleteErrors?: Partial<Record<string, { message: string }>>;
  };
};

const routeDir = dirname(fileURLToPath(import.meta.url));
const routeUrl = pathToFileURL(join(routeDir, "route.ts")).href;
type ResolveFilenameFn = (
  request: string,
  parent?: unknown,
  isMain?: boolean,
  options?: unknown,
) => string;

const moduleInternal = Module as unknown as {
  _resolveFilename: ResolveFilenameFn;
};
const originalResolveFilename = moduleInternal._resolveFilename;

moduleInternal._resolveFilename =
  function patchedResolveFilename(request, parent, isMain, options) {
    if (request.startsWith("@/")) {
      const localPath = join(process.cwd(), "src", request.slice(2));
      return originalResolveFilename.call(this, localPath, parent, isMain, options);
    }

    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

await import(routeUrl);
const {
  createZionAdminAccountCore,
  cleanupFailedProvisioningAttempt,
} = (globalThis as Record<string, unknown>).__zionAdminAccountsCreateRouteTestHooks as {
  createZionAdminAccountCore: (params: {
    access: { ok: true; sessionUserId: string };
    body: unknown;
    serviceSupabase: ReturnType<typeof createHarnessServiceSupabase>;
  }) => Promise<{ body: Record<string, unknown>; status: number }>;
  cleanupFailedProvisioningAttempt: (
    serviceSupabase: ReturnType<typeof createHarnessServiceSupabase>,
    params: {
      userId: string;
      currentMetadata: Record<string, unknown> | null | undefined;
      removeAuthUser: boolean;
      markUserFailedOnCleanupFailure: boolean;
      restoreMetadata?: Record<string, unknown> | null | undefined;
      tenantTarget?: {
        profileUserId: string | null;
        organizationId: string | null;
        membershipId: string | null;
        storeId: string | null;
      } | null;
    },
  ) => Promise<{
    cleaned: boolean;
    metadataRestored: boolean;
    tenantDeleted: boolean;
    authUserDeleted: boolean;
  }>;
};

function createEmptyState(): HarnessState {
  return {
    users: [],
    tables: {
      profiles: [],
      organizations: [],
      memberships: [],
      stores: [],
      subscriptions: [],
      store_onboarding: [],
    },
    calls: {
      updateUserById: 0,
      deleteUser: 0,
      inviteUserByEmail: 0,
      provisioningRpc: 0,
      deleteOrder: [],
      operationOrder: [],
    },
    failures: {},
  };
}

function insertProvisionedTenant(state: HarnessState, userId: string) {
  state.tables.profiles.push({
    user_id: userId,
    full_name: "Owner",
  });
  state.tables.organizations.push({
    id: "org_existing",
    name: "Existing Org",
  });
  state.tables.memberships.push({
    id: "membership_existing",
    organization_id: "org_existing",
    user_id: userId,
    created_at: "2026-07-30T00:00:00.000Z",
  });
  state.tables.stores.push({
    id: "store_existing",
    organization_id: "org_existing",
    name: "Existing Store",
  });
  state.tables.subscriptions.push({
    id: "subscription_existing",
    organization_id: "org_existing",
  });
}

function applyFilters(rows: Array<Record<string, unknown>>, filters: Array<{
  kind: "eq" | "in";
  column: string;
  value: unknown;
}>) {
  return rows.filter((row) =>
    filters.every((filter) => {
      if (filter.kind === "eq") {
        return row[filter.column] === filter.value;
      }

      return Array.isArray(filter.value) && filter.value.includes(row[filter.column]);
    }),
  );
}

class QueryHarness {
  private filters: Array<{ kind: "eq" | "in"; column: string; value: unknown }> = [];
  private orderColumn: string | null = null;
  private orderAscending = true;
  private mode: "select" | "delete" = "select";

  constructor(
    private readonly state: HarnessState,
    private readonly table: string,
  ) {}

  select() {
    this.mode = "select";
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ kind: "in", column, value });
    return this.executeSelect();
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderColumn = column;
    this.orderAscending = options?.ascending !== false;
    return this.executeSelect();
  }

  maybeSingle<T>() {
    const rows = applyFilters(this.state.tables[this.table] ?? [], this.filters);
    return Promise.resolve({
      data: (rows[0] ?? null) as T | null,
      error: null,
    });
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.executeDelete().then(onfulfilled, onrejected);
  }

  private executeSelect() {
    let rows = [...applyFilters(this.state.tables[this.table] ?? [], this.filters)];

    if (this.orderColumn) {
      rows.sort((left, right) => {
        const leftValue = String(left[this.orderColumn!] ?? "");
        const rightValue = String(right[this.orderColumn!] ?? "");
        return this.orderAscending
          ? leftValue.localeCompare(rightValue)
          : rightValue.localeCompare(leftValue);
      });
    }

    return Promise.resolve({
      data: rows,
      error: null,
    });
  }

  private executeDelete() {
    this.state.calls.deleteOrder.push(this.table);
    this.state.calls.operationOrder.push(`delete:${this.table}`);

    const configuredError = this.state.failures.deleteErrors?.[this.table] ?? null;
    if (configuredError) {
      return Promise.resolve({
        data: null,
        error: configuredError,
      });
    }

    const tableRows = this.state.tables[this.table] ?? [];
    const matched = new Set(applyFilters(tableRows, this.filters));
    this.state.tables[this.table] = tableRows.filter((row) => !matched.has(row));

    return Promise.resolve({
      data: null,
      error: null,
    });
  }
}

function createHarnessServiceSupabase(state: HarnessState) {
  return {
    auth: {
      admin: {
        listUsers: async () => ({
          data: { users: [...state.users] },
          error: null,
        }),
        inviteUserByEmail: async (email: string) => {
          state.calls.inviteUserByEmail += 1;

          if (state.failures.inviteError) {
            return {
              data: { user: null },
              error: state.failures.inviteError,
            };
          }

          const user: UserRow = {
            id: "user_new",
            email,
            invited_at: "2026-07-30T00:00:00.000Z",
            email_confirmed_at: null,
            app_metadata: {},
          };
          state.users.push(user);

          return {
            data: { user },
            error: null,
          };
        },
        updateUserById: async (userId: string, payload: { app_metadata: Record<string, unknown> }) => {
          state.calls.updateUserById += 1;

          const metadataStatus =
            typeof payload.app_metadata?.zion_provisioning_status === "string"
              ? payload.app_metadata.zion_provisioning_status
              : null;
          state.calls.operationOrder.push(`update:${metadataStatus ?? "none"}`);

          if (
            state.failures.updateUserByIdAtCalls?.includes(state.calls.updateUserById) ||
            state.failures.updateUserByIdFailureByMetadataStatus?.includes(metadataStatus)
          ) {
            return {
              data: { user: null },
              error: { message: `update failure ${state.calls.updateUserById}` },
            };
          }

          const user = state.users.find((candidate) => candidate.id === userId) ?? null;
          if (user) {
            user.app_metadata = payload.app_metadata;
          }

          return {
            data: { user },
            error: null,
          };
        },
        deleteUser: async (userId: string) => {
          state.calls.deleteUser += 1;

          if (state.failures.deleteUserError) {
            return { data: null, error: state.failures.deleteUserError };
          }

          state.users = state.users.filter((user) => user.id !== userId);
          return { data: null, error: null };
        },
      },
    },
    from(table: string) {
      return new QueryHarness(state, table);
    },
    rpc(fn: string, args: Record<string, string>) {
      if (fn !== "zion_admin_provision_account") {
        throw new Error(`unexpected rpc ${fn}`);
      }

      return {
        single: async () => {
          state.calls.provisioningRpc += 1;

          const profileUserId = args.p_user_id;
          const organizationId = `org_${state.calls.provisioningRpc}`;
          const membershipId = `membership_${state.calls.provisioningRpc}`;
          const storeId = `store_${state.calls.provisioningRpc}`;

          state.tables.profiles.push({
            user_id: profileUserId,
            full_name: args.p_responsible_name,
          });
          state.tables.organizations.push({
            id: organizationId,
            name: args.p_store_name,
          });
          state.tables.memberships.push({
            id: membershipId,
            organization_id: organizationId,
            user_id: profileUserId,
            created_at: "2026-07-30T00:00:00.000Z",
          });
          state.tables.stores.push({
            id: storeId,
            organization_id: organizationId,
            name: args.p_store_name,
          });
          state.tables.subscriptions.push({
            id: `subscription_${state.calls.provisioningRpc}`,
            organization_id: organizationId,
          });
          state.tables.store_onboarding.push({
            id: `onboarding_${state.calls.provisioningRpc}`,
            organization_id: organizationId,
            store_id: storeId,
            status: null,
          });

          return {
            data: {
              provisioning_status: "provisioned",
              issue_code: null,
              issue_message: null,
              profile_user_id: profileUserId,
              organization_id: organizationId,
              membership_id: membershipId,
              store_id: storeId,
            },
            error: null,
          };
        },
      };
    },
  };
}

async function runCoreWithState(
  state: HarnessState,
  body: { email: string; storeName: string; responsibleName: string },
) {
  return createZionAdminAccountCore({
    access: {
      ok: true,
      sessionUserId: "admin_1",
    },
    body,
    serviceSupabase: createHarnessServiceSupabase(state),
  });
}

const tests: TestCase[] = [
  {
    name: "failure before tenant creation deletes only the invited auth user",
    run: async () => {
      const state = createEmptyState();
      state.failures.updateUserByIdAtCalls = [1];

      const result = await runCoreWithState(state, {
        email: "owner@example.com",
        storeName: "Nova Loja",
        responsibleName: "Owner",
      });

      assert.equal(result.status, 500);
      assert.equal(state.calls.deleteUser, 1);
      assert.deepEqual(state.calls.deleteOrder, []);
      assert.equal(state.users.length, 0);
      assert.equal(state.tables.organizations.length, 0);
      assert.equal(state.tables.stores.length, 0);
    },
  },
  {
    name: "email invite failure stays before tenant provisioning",
    run: async () => {
      const state = createEmptyState();
      state.failures.inviteError = { message: "smtp unavailable" };

      const result = await runCoreWithState(state, {
        email: "owner@example.com",
        storeName: "Nova Loja",
        responsibleName: "Owner",
      });

      assert.equal(result.status, 500);
      assert.equal(state.calls.provisioningRpc, 0);
      assert.equal(state.calls.deleteUser, 0);
      assert.equal(state.tables.organizations.length, 0);
    },
  },
  {
    name: "metadata failure after atomic tenant provisioning compensates full tenant and allows clean retry",
    run: async () => {
      const state = createEmptyState();
      state.failures.updateUserByIdAtCalls = [2];

      const first = await runCoreWithState(state, {
        email: "owner@example.com",
        storeName: "Nova Loja",
        responsibleName: "Owner",
      });

      assert.equal(first.status, 500);
      assert.deepEqual(state.calls.deleteOrder, [
        "store_onboarding",
        "subscriptions",
        "stores",
        "memberships",
        "profiles",
        "organizations",
      ]);
      assert.equal(state.calls.deleteUser, 1);
      assert.equal(state.tables.organizations.length, 0);
      assert.equal(state.tables.stores.length, 0);
      assert.equal(state.tables.subscriptions.length, 0);
      assert.equal(state.tables.store_onboarding.length, 0);
      assert.equal(state.users.length, 0);

      state.failures.updateUserByIdAtCalls = [];
      state.calls.deleteOrder = [];

      const second = await runCoreWithState(state, {
        email: "owner@example.com",
        storeName: "Nova Loja",
        responsibleName: "Owner",
      });

      assert.equal(second.status, 200);
      assert.equal(state.tables.organizations.length, 1);
      assert.equal(state.tables.stores.length, 1);
      assert.equal(state.tables.subscriptions.length, 1);
      assert.equal(state.tables.store_onboarding.length, 1);
    },
  },
  {
    name: "recover_failed restores the exact previous metadata after compensation",
    run: async () => {
      const state = createEmptyState();
      const originalMetadata = {
        provisioned_via: "zion-admin",
        zion_provisioning_status: "failed",
        legacy_marker: "keep_me",
        some_nested: { safe: true },
      };
      state.users.push({
        id: "user_existing",
        email: "owner@example.com",
        email_confirmed_at: null,
        invited_at: null,
        app_metadata: originalMetadata,
      });
      state.failures.updateUserByIdAtCalls = [2];

      const result = await runCoreWithState(state, {
        email: "owner@example.com",
        storeName: "Nova Loja",
        responsibleName: "Owner",
      });

      assert.equal(result.status, 500);
      assert.equal(state.calls.deleteUser, 0);
      assert.equal(state.users.length, 1);
      assert.equal(state.tables.organizations.length, 0);
      assert.equal(state.tables.stores.length, 0);
      assert.equal(state.tables.subscriptions.length, 0);
      assert.deepEqual(state.users[0]?.app_metadata, originalMetadata);
    },
  },
  {
    name: "compensation failure remains fail-closed with safe technical code",
    run: async () => {
      const state = createEmptyState();
      state.failures.updateUserByIdAtCalls = [2];
      state.failures.deleteErrors = {
        stores: { message: "delete store failed" },
      };

      const result = await runCoreWithState(state, {
        email: "owner@example.com",
        storeName: "Nova Loja",
        responsibleName: "Owner",
      });

      assert.equal(result.status, 503);
      assert.equal(result.body.code, "PROVISIONING_COMPENSATION_FAILED");
      assert.equal(state.tables.organizations.length, 1);
      assert.equal(state.users.length, 1);
      assert.equal(
        state.users[0]?.app_metadata?.zion_provisioning_status,
        "failed",
      );
    },
  },
  {
    name: "recover_failed metadata restore failure returns compensation failed and preserves auth user",
    run: async () => {
      const state = createEmptyState();
      state.users.push({
        id: "user_existing",
        email: "owner@example.com",
        email_confirmed_at: null,
        invited_at: null,
        app_metadata: {
          provisioned_via: "zion-admin",
          zion_provisioning_status: "failed",
          legacy_marker: "restore_target",
        },
      });
      state.failures.updateUserByIdAtCalls = [2];
      state.failures.updateUserByIdFailureByMetadataStatus = ["failed"];

      const result = await runCoreWithState(state, {
        email: "owner@example.com",
        storeName: "Nova Loja",
        responsibleName: "Owner",
      });

      assert.equal(result.status, 503);
      assert.equal(result.body.code, "PROVISIONING_COMPENSATION_FAILED");
      assert.equal(state.calls.deleteUser, 0);
      assert.deepEqual(state.calls.deleteOrder, []);
      assert.equal(state.users.length, 1);
      assert.equal(state.tables.organizations.length, 1);
      assert.equal(state.tables.stores.length, 1);
    },
  },
  {
    name: "already provisioned account still returns conflict and never removes preexisting resources",
    run: async () => {
      const state = createEmptyState();
      state.users.push({
        id: "user_existing",
        email: "owner@example.com",
        email_confirmed_at: "2026-07-30T00:00:00.000Z",
        app_metadata: {},
      });
      insertProvisionedTenant(state, "user_existing");

      const result = await runCoreWithState(state, {
        email: "owner@example.com",
        storeName: "Nova Loja",
        responsibleName: "Owner",
      });

      assert.equal(result.status, 409);
      assert.equal(result.body.code, "ACCOUNT_ALREADY_PROVISIONED");
      assert.equal(state.tables.organizations.length, 1);
      assert.equal(state.tables.stores.length, 1);
      assert.equal(state.calls.deleteUser, 0);
    },
  },
  {
    name: "direct cleanup removes store onboarding before store and does not touch unrelated ids",
    run: async () => {
      const state = createEmptyState();
      state.users.push({
        id: "user_new",
        email: "owner@example.com",
        app_metadata: {},
      });
      state.tables.profiles.push({ user_id: "user_new" });
      state.tables.organizations.push({ id: "org_target" }, { id: "org_other" });
      state.tables.memberships.push(
        { id: "membership_target", organization_id: "org_target", user_id: "user_new" },
        { id: "membership_other", organization_id: "org_other", user_id: "user_other" },
      );
      state.tables.stores.push(
        { id: "store_target", organization_id: "org_target" },
        { id: "store_other", organization_id: "org_other" },
      );
      state.tables.subscriptions.push(
        { id: "subscription_target", organization_id: "org_target" },
        { id: "subscription_other", organization_id: "org_other" },
      );
      state.tables.store_onboarding.push(
        { id: "onboarding_target", organization_id: "org_target", store_id: "store_target" },
        { id: "onboarding_other", organization_id: "org_other", store_id: "store_other" },
      );

      const result = await cleanupFailedProvisioningAttempt(
        createHarnessServiceSupabase(state),
        {
          userId: "user_new",
          currentMetadata: {},
          removeAuthUser: true,
          markUserFailedOnCleanupFailure: true,
          tenantTarget: {
            profileUserId: "user_new",
            organizationId: "org_target",
            membershipId: "membership_target",
            storeId: "store_target",
          },
        },
      );

      assert.equal(result.cleaned, true);
      assert.deepEqual(state.calls.deleteOrder, [
        "store_onboarding",
        "subscriptions",
        "stores",
        "memberships",
        "profiles",
        "organizations",
      ]);
      assert.equal(state.tables.organizations.some((row) => row.id === "org_other"), true);
      assert.equal(state.tables.stores.some((row) => row.id === "store_other"), true);
      assert.equal(
        state.tables.store_onboarding.some((row) => row.id === "onboarding_other"),
        true,
      );
    },
  },
  {
    name: "each compensation step failure stays fail-closed and sanitized",
    run: async () => {
      const cleanupTables = [
        "store_onboarding",
        "subscriptions",
        "stores",
        "memberships",
        "profiles",
        "organizations",
      ] as const;

      for (const failingTable of cleanupTables) {
        const state = createEmptyState();
        state.failures.updateUserByIdAtCalls = [2];
        state.failures.deleteErrors = {
          [failingTable]: { message: `${failingTable} delete failed` },
        };

        const result = await runCoreWithState(state, {
          email: "owner@example.com",
          storeName: "Nova Loja",
          responsibleName: "Owner",
        });

        assert.equal(result.status, 503, `expected fail-closed for ${failingTable}`);
        assert.equal(result.body.code, "PROVISIONING_COMPENSATION_FAILED");
        assert.equal(
          String(result.body.error || "").includes("org_"),
          false,
          `public error leaked internal id for ${failingTable}`,
        );
        assert.equal(
          String(result.body.error || "").includes("stack"),
          false,
          `public error leaked stack for ${failingTable}`,
        );
        assert.equal(state.calls.deleteUser, 0, `auth user must remain for ${failingTable}`);
      }
    },
  },
  {
    name: "pending invite remains conflict with sanitized public response",
    run: async () => {
      const state = createEmptyState();
      state.users.push({
        id: "user_pending",
        email: "owner@example.com",
        invited_at: "2026-07-30T00:00:00.000Z",
        email_confirmed_at: null,
        app_metadata: {},
      });

      const result = await runCoreWithState(state, {
        email: "owner@example.com",
        storeName: "Nova Loja",
        responsibleName: "Owner",
      });

      assert.equal(result.status, 409);
      assert.equal(result.body.code, "PENDING_INVITE_ALREADY_EXISTS");
      assert.equal(String(result.body.error || "").includes("user_pending"), false);
      assert.equal(String(result.body.error || "").includes("stack"), false);
    },
  },
  {
    name: "recover_failed restores metadata before first tenant delete",
    run: async () => {
      const state = createEmptyState();
      state.users.push({
        id: "user_existing",
        email: "owner@example.com",
        email_confirmed_at: null,
        invited_at: null,
        app_metadata: {
          provisioned_via: "zion-admin",
          zion_provisioning_status: "failed",
          original_marker: "preserve",
        },
      });
      state.failures.updateUserByIdAtCalls = [2];

      const result = await runCoreWithState(state, {
        email: "owner@example.com",
        storeName: "Nova Loja",
        responsibleName: "Owner",
      });

      assert.equal(result.status, 500);
      const restoreIndex = state.calls.operationOrder.indexOf("update:failed");
      const firstDeleteIndex = state.calls.operationOrder.indexOf("delete:store_onboarding");
      assert.notEqual(restoreIndex, -1);
      assert.notEqual(firstDeleteIndex, -1);
      assert.equal(restoreIndex < firstDeleteIndex, true);
      assert.equal(state.users[0]?.app_metadata?.original_marker, "preserve");
    },
  },
  {
    name: "attempt-created auth user is deleted only after tenant cleanup",
    run: async () => {
      const state = createEmptyState();

      const result = await cleanupFailedProvisioningAttempt(
        createHarnessServiceSupabase(state),
        {
          userId: "user_new",
          currentMetadata: {},
          removeAuthUser: true,
          markUserFailedOnCleanupFailure: true,
          tenantTarget: {
            profileUserId: "user_new",
            organizationId: "org_target",
            membershipId: "membership_target",
            storeId: "store_target",
          },
        },
      );

      assert.equal(result.cleaned, true);
      assert.deepEqual(state.calls.deleteOrder, [
        "store_onboarding",
        "subscriptions",
        "stores",
        "memberships",
        "profiles",
        "organizations",
      ]);
      assert.equal(result.authUserDeleted, true);
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`zion-admin-accounts-create-runtime: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

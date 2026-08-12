import { strict as assert } from "node:assert";

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

const routeHandlerModuleUrl = new URL("./route-handler.ts", import.meta.url);

type RuntimeState = {
  accessResult?:
    | {
        ok: true;
        sessionUserId: string;
      }
    | {
        ok: false;
        httpStatus: number;
        payload: {
          ok: false;
          error: string;
          message: string;
          status: string;
          reasonCode: string;
        };
      };
  membership?: {
    id: string;
    user_id: string;
    organization_id: string;
    role: string | null;
    is_active: boolean | null;
  } | null;
  profile?: {
    user_id: string;
    is_blocked: boolean | null;
  } | null;
  internalAdminUserId?: string | null;
  membershipUpdateError?: unknown;
  profileUpdateError?: unknown;
};

function createBaseState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    accessResult: {
      ok: true,
      sessionUserId: "admin-1",
    },
    membership: {
      id: "membership-1",
      user_id: "user-1",
      organization_id: "org-1",
      role: "owner",
      is_active: true,
    },
    profile: {
      user_id: "user-1",
      is_blocked: false,
    },
    internalAdminUserId: null,
    ...overrides,
  };
}

async function createHarness(state: RuntimeState) {
  const runtimeState = {
    ...state,
    calls: {
      resolveAccess: 0,
      createServiceSupabase: 0,
      updates: [] as string[],
      membershipLookups: [] as string[],
      profileLookups: [] as string[],
      internalAdminLookups: [] as string[],
      authAdminDeleteUser: 0,
      authAdminInviteUserByEmail: 0,
      authAdminUpdateUserById: 0,
      authAdminCreateUser: 0,
    },
  };

  const deps = {
    async resolveAccess() {
      runtimeState.calls.resolveAccess += 1;
      return (runtimeState.accessResult ?? {
        ok: true,
        sessionUserId: "admin-1",
      }) as never;
    },
    createServiceSupabase() {
      runtimeState.calls.createServiceSupabase += 1;
      return {
        from(table: string) {
          return {
            select() {
              return {
                eq(_column: string, value: string) {
                  if (table === "memberships") {
                    runtimeState.calls.membershipLookups.push(value);
                    return {
                      maybeSingle: async () => ({
                        data:
                          runtimeState.membership?.id === value
                            ? runtimeState.membership
                            : null,
                        error: null,
                      }),
                    };
                  }

                  if (table === "profiles") {
                    runtimeState.calls.profileLookups.push(value);
                    return {
                      maybeSingle: async () => ({
                        data:
                          runtimeState.profile?.user_id === value
                            ? runtimeState.profile
                            : null,
                        error: null,
                      }),
                    };
                  }

                  if (table === "zion_internal_admins") {
                    runtimeState.calls.internalAdminLookups.push(value);
                    return {
                      maybeSingle: async () => ({
                        data:
                          runtimeState.internalAdminUserId === value
                            ? { user_id: runtimeState.internalAdminUserId }
                            : null,
                        error: null,
                      }),
                    };
                  }

                  return {
                    maybeSingle: async () => ({
                      data: null,
                      error: null,
                    }),
                  };
                },
              };
            },
            update(payload: Record<string, unknown>) {
              return {
                eq(_column: string, value: string) {
                  return {
                    select() {
                      return {
                        maybeSingle: async () => {
                          if (table === "memberships") {
                            runtimeState.calls.updates.push("memberships");

                            if (runtimeState.membershipUpdateError) {
                              return {
                                data: null,
                                error: runtimeState.membershipUpdateError,
                              };
                            }

                            if (runtimeState.membership?.id !== value) {
                              return {
                                data: null,
                                error: null,
                              };
                            }

                            runtimeState.membership = {
                              ...runtimeState.membership,
                              is_active: payload.is_active as boolean | null,
                            };

                            return {
                              data: {
                                id: runtimeState.membership.id,
                                is_active: runtimeState.membership.is_active,
                              },
                              error: null,
                            };
                          }

                          if (table === "profiles") {
                            runtimeState.calls.updates.push("profiles");

                            if (runtimeState.profileUpdateError) {
                              return {
                                data: null,
                                error: runtimeState.profileUpdateError,
                              };
                            }

                            if (runtimeState.profile?.user_id !== value) {
                              return {
                                data: null,
                                error: null,
                              };
                            }

                            runtimeState.profile = {
                              ...runtimeState.profile,
                              is_blocked: payload.is_blocked as boolean | null,
                            };

                            return {
                              data: {
                                user_id: runtimeState.profile.user_id,
                                is_blocked: runtimeState.profile.is_blocked,
                              },
                              error: null,
                            };
                          }

                          return {
                            data: null,
                            error: null,
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        auth: {
          admin: {
            async deleteUser() {
              runtimeState.calls.authAdminDeleteUser += 1;
              return { data: null, error: null };
            },
            async inviteUserByEmail() {
              runtimeState.calls.authAdminInviteUserByEmail += 1;
              return { data: null, error: null };
            },
            async updateUserById() {
              runtimeState.calls.authAdminUpdateUserById += 1;
              return { data: null, error: null };
            },
            async createUser() {
              runtimeState.calls.authAdminCreateUser += 1;
              return { data: null, error: null };
            },
          },
        },
      };
    },
  };

  return {
    state: runtimeState,
    async run(body: Record<string, unknown>) {
      const { handleAccessStateMutation } = await import(routeHandlerModuleUrl.href);

      return handleAccessStateMutation(
        new Request("https://example.com/api/zion-admin/accounts/access-state", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        deps as never,
      );
    },
  };
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: TestCase[] = [
  {
    name: "denied access returns gate payload before service role",
    async run() {
      const harness = await createHarness(
        createBaseState({
          accessResult: {
            ok: false,
            httpStatus: 403,
            payload: {
              ok: false,
              error: "ZION_ADMIN_API_FORBIDDEN",
              message: "forbidden",
              status: "cross_domain_forbidden",
              reasonCode: "cross_domain_forbidden",
            },
          },
        }),
      );

      const response = await harness.run({
        membershipId: "membership-1",
        action: "block",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 403);
      assert.equal(payload.error, "ZION_ADMIN_API_FORBIDDEN");
      assert.equal(harness.state.calls.resolveAccess, 1);
      assert.equal(harness.state.calls.createServiceSupabase, 0);
    },
  },
  {
    name: "block updates membership first and then profile",
    async run() {
      const harness = await createHarness(createBaseState());

      const response = await harness.run({
        membershipId: "membership-1",
        action: "block",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 200);
      assert.deepEqual(harness.state.calls.updates, ["memberships", "profiles"]);
      assert.equal(payload.accessState, "blocked");
      assert.equal(payload.isMembershipActive, false);
      assert.equal(payload.isProfileBlocked, true);
    },
  },
  {
    name: "reactivate updates profile first and then membership",
    async run() {
      const harness = await createHarness(
        createBaseState({
          membership: {
            id: "membership-1",
            user_id: "user-1",
            organization_id: "org-1",
            role: "owner",
            is_active: false,
          },
          profile: {
            user_id: "user-1",
            is_blocked: true,
          },
        }),
      );

      const response = await harness.run({
        membershipId: "membership-1",
        action: "reactivate",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 200);
      assert.deepEqual(harness.state.calls.updates, ["profiles", "memberships"]);
      assert.equal(payload.accessState, "active");
      assert.equal(payload.isMembershipActive, true);
      assert.equal(payload.isProfileBlocked, false);
    },
  },
  {
    name: "self targeting is rejected",
    async run() {
      const harness = await createHarness(
        createBaseState({
          accessResult: {
            ok: true,
            sessionUserId: "user-1",
          },
        }),
      );

      const response = await harness.run({
        membershipId: "membership-1",
        action: "block",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 409);
      assert.equal(payload.error, "A conta interna do ZION nao pode alterar o proprio acesso.");
      assert.deepEqual(harness.state.calls.updates, []);
    },
  },
  {
    name: "missing membership fails closed without mutations",
    async run() {
      const harness = await createHarness(
        createBaseState({
          membership: null,
        }),
      );

      const response = await harness.run({
        membershipId: "membership-missing",
        action: "block",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 404);
      assert.equal(payload.error, "Membership alvo nao encontrada.");
      assert.deepEqual(harness.state.calls.membershipLookups, ["membership-missing"]);
      assert.deepEqual(harness.state.calls.updates, []);
      assert.equal(harness.state.calls.profileLookups.length, 0);
    },
  },
  {
    name: "missing profile fails closed without mutations",
    async run() {
      const harness = await createHarness(
        createBaseState({
          profile: null,
        }),
      );

      const response = await harness.run({
        membershipId: "membership-1",
        action: "block",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 404);
      assert.equal(payload.error, "Profile alvo nao encontrado.");
      assert.deepEqual(harness.state.calls.membershipLookups, ["membership-1"]);
      assert.deepEqual(harness.state.calls.profileLookups, ["user-1"]);
      assert.deepEqual(harness.state.calls.updates, []);
    },
  },
  {
    name: "internal admin target is rejected",
    async run() {
      const harness = await createHarness(
        createBaseState({
          internalAdminUserId: "user-1",
        }),
      );

      const response = await harness.run({
        membershipId: "membership-1",
        action: "block",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 409);
      assert.equal(
        payload.error,
        "A conta interna do ZION nao pode ser bloqueada ou reativada por esta rota.",
      );
      assert.deepEqual(harness.state.calls.updates, []);
    },
  },
  {
    name: "partial failure stays fail closed without compensation",
    async run() {
      const harness = await createHarness(
        createBaseState({
          profileUpdateError: {
            message: "profile update failed",
          },
        }),
      );

      const response = await harness.run({
        membershipId: "membership-1",
        action: "block",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 500);
      assert.equal(payload.error, "Falha interna ao atualizar o estado de acesso.");
      assert.deepEqual(harness.state.calls.updates, ["memberships", "profiles"]);
      assert.equal(harness.state.membership?.is_active, false);
      assert.equal(harness.state.profile?.is_blocked, false);
    },
  },
  {
    name: "partial failure on reactivate keeps membership inactive",
    async run() {
      const harness = await createHarness(
        createBaseState({
          membership: {
            id: "membership-1",
            user_id: "user-1",
            organization_id: "org-1",
            role: "owner",
            is_active: false,
          },
          profile: {
            user_id: "user-1",
            is_blocked: true,
          },
          membershipUpdateError: {
            message: "membership update failed",
          },
        }),
      );

      const response = await harness.run({
        membershipId: "membership-1",
        action: "reactivate",
        email: "attacker@example.com",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 500);
      assert.equal(payload.error, "Falha interna ao atualizar o estado de acesso.");
      assert.deepEqual(harness.state.calls.updates, ["profiles", "memberships"]);
      assert.equal(harness.state.profile?.is_blocked, false);
      assert.equal(harness.state.membership?.is_active, false);
    },
  },
  {
    name: "email is not authority and lookup stays exclusively on membershipId",
    async run() {
      const harness = await createHarness(
        createBaseState({
          membership: {
            id: "membership-real",
            user_id: "user-1",
            organization_id: "org-1",
            role: "owner",
            is_active: true,
          },
        }),
      );

      const response = await harness.run({
        membershipId: "membership-real",
        action: "block",
        email: "other-target@example.com",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 200);
      assert.equal(payload.membershipId, "membership-real");
      assert.equal(payload.userId, "user-1");
      assert.deepEqual(harness.state.calls.membershipLookups, ["membership-real"]);
      assert.deepEqual(harness.state.calls.profileLookups, ["user-1"]);
      assert.deepEqual(harness.state.calls.internalAdminLookups, ["user-1"]);
    },
  },
  {
    name: "block and reactivate do not use auth admin operations",
    async run() {
      const blockHarness = await createHarness(createBaseState());
      const blockResponse = await blockHarness.run({
        membershipId: "membership-1",
        action: "block",
      });

      assert.equal(blockResponse.status, 200);
      assert.equal(blockHarness.state.calls.authAdminDeleteUser, 0);
      assert.equal(blockHarness.state.calls.authAdminInviteUserByEmail, 0);
      assert.equal(blockHarness.state.calls.authAdminUpdateUserById, 0);
      assert.equal(blockHarness.state.calls.authAdminCreateUser, 0);

      const reactivateHarness = await createHarness(
        createBaseState({
          membership: {
            id: "membership-1",
            user_id: "user-1",
            organization_id: "org-1",
            role: "owner",
            is_active: false,
          },
          profile: {
            user_id: "user-1",
            is_blocked: true,
          },
        }),
      );
      const reactivateResponse = await reactivateHarness.run({
        membershipId: "membership-1",
        action: "reactivate",
      });

      assert.equal(reactivateResponse.status, 200);
      assert.equal(reactivateHarness.state.calls.authAdminDeleteUser, 0);
      assert.equal(reactivateHarness.state.calls.authAdminInviteUserByEmail, 0);
      assert.equal(reactivateHarness.state.calls.authAdminUpdateUserById, 0);
      assert.equal(reactivateHarness.state.calls.authAdminCreateUser, 0);
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`zion-admin-access-state-route: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

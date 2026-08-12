import { strict as assert } from "node:assert";
import { handleResendFirstAccess } from "./route-handler";

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

type AuthUser = {
  id: string;
  email: string;
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
};

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
  store?: { id: string; organization_id: string; name: string | null } | null;
  memberships?: Array<{
    id: string;
    user_id: string;
    organization_id: string;
    role: string | null;
    created_at: string | null;
  }>;
  internalAdminUserId?: string | null;
  authUser: AuthUser;
  accountSummary: { status: string };
  commercialAccess?: { is_blocked: boolean };
  attemptIds?: string[];
  inviteError?: unknown;
  resetError?: unknown;
  replacedByNewerAttempt?: string | null;
  restoreFails?: boolean;
  cooldownActive?: boolean;
  cooldownRemainingMs?: number;
};

function createJsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function createBaseState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    accessResult: {
      ok: true,
      sessionUserId: "admin-1",
    },
    store: {
      id: "store-1",
      organization_id: "org-1",
      name: "Loja Teste",
    },
    memberships: [
      {
        id: "membership-1",
        user_id: "owner-1",
        organization_id: "org-1",
        role: "owner",
        created_at: "2026-07-28T12:00:00.000Z",
      },
    ],
    internalAdminUserId: null,
    authUser: {
      id: "owner-1",
      email: "owner@example.com",
      email_confirmed_at: "2026-07-28T12:00:00.000Z",
      app_metadata: {
        provisioned_via: "zion-admin",
        zion_provisioning_status: "provisioned",
        zion_first_access_required: true,
      },
    },
    accountSummary: {
      status: "first_access_pending",
    },
    commercialAccess: {
      is_blocked: false,
    },
    cooldownActive: false,
    cooldownRemainingMs: 1234,
    ...overrides,
  };
}

async function createHarness(state: RuntimeState) {
  const runtimeState = {
    ...state,
    attemptIds: [...(state.attemptIds ?? ["fia_new"])],
    auditEvents: [] as Array<Record<string, unknown>>,
    calls: {
      resolveAccess: 0,
      createServiceSupabase: 0,
      resetPasswordForEmail: [] as Array<{ email: string; options: { redirectTo?: string } }>,
      inviteUserByEmail: [] as Array<{ email: string; options: { redirectTo?: string } }>,
      updateUserById: [] as Array<Record<string, unknown> | null | undefined>,
      getAuthAdminUserById: [] as string[],
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
                eq(_column: string, _value: string) {
                  if (table === "stores") {
                    return {
                      maybeSingle: async () => ({
                        data: runtimeState.store ?? null,
                        error: null,
                      }),
                    };
                  }

                  if (table === "zion_internal_admins") {
                    return {
                      maybeSingle: async () => ({
                        data: runtimeState.internalAdminUserId
                          ? { user_id: runtimeState.internalAdminUserId }
                          : null,
                        error: null,
                      }),
                    };
                  }

                  return {
                    order: async () => ({
                      data: runtimeState.memberships ?? [],
                      error: null,
                    }),
                    eq() {
                      return {
                        maybeSingle: async () => ({
                          data: null,
                          error: null,
                        }),
                      };
                    },
                  };
                },
              };
            },
          };
        },
        rpc: async () => ({
          data: runtimeState.commercialAccess ?? { is_blocked: false },
          error: null,
        }),
        auth: {
          resetPasswordForEmail: async (email: string, options: { redirectTo?: string }) => {
            runtimeState.calls.resetPasswordForEmail.push({ email, options });
            if (runtimeState.replacedByNewerAttempt) {
              runtimeState.authUser.app_metadata = {
                ...(runtimeState.authUser.app_metadata || {}),
                zion_first_access_invite_id: runtimeState.replacedByNewerAttempt,
              };
            }
            return { data: {}, error: runtimeState.resetError ?? null };
          },
          admin: {
            updateUserById: async (_userId: string, payload: { app_metadata?: Record<string, unknown> }) => {
              runtimeState.calls.updateUserById.push(payload.app_metadata);
              if (
                runtimeState.restoreFails &&
                runtimeState.calls.updateUserById.length > 1
              ) {
                return { data: { user: null }, error: { message: "restore failed" } };
              }
              runtimeState.authUser.app_metadata = payload.app_metadata ?? null;
              return { data: { user: runtimeState.authUser }, error: null };
            },
            inviteUserByEmail: async (email: string, options: { redirectTo?: string }) => {
              runtimeState.calls.inviteUserByEmail.push({ email, options });
              if (runtimeState.replacedByNewerAttempt) {
                runtimeState.authUser.app_metadata = {
                  ...(runtimeState.authUser.app_metadata || {}),
                  zion_first_access_invite_id: runtimeState.replacedByNewerAttempt,
                };
              }
              return { data: { user: runtimeState.authUser }, error: runtimeState.inviteError ?? null };
            },
          },
        },
      };
    },
    createAttemptId() {
      return runtimeState.attemptIds.shift() ?? "fia_fallback";
    },
    createInviteMetadataPatch(params: {
      attemptId: string;
      sentAt: string;
      sentBy: string;
      status: string;
    }) {
      return {
        provisioned_via: "zion-admin",
        zion_provisioning_status: params.status,
        zion_first_access_required: true,
        zion_first_access_invite_id: params.attemptId,
        zion_first_access_invite_sent_at: params.sentAt,
        zion_first_access_invite_sent_by: params.sentBy,
      };
    },
    async getAuthAdminUserById(_service: unknown, userId: string) {
      runtimeState.calls.getAuthAdminUserById.push(userId);
      return runtimeState.authUser;
    },
    async getAuthAdminUserByIdWithRetry() {
      return runtimeState.authUser;
    },
    getCooldownRemainingMs() {
      return runtimeState.cooldownRemainingMs ?? 1234;
    },
    getInviteRedirectTo(attemptId: string) {
      return `https://example.com/auth/callback?next=%2Fauth%2Fset-initial-password&attempt=${attemptId}`;
    },
    getAccountAccessSummary() {
      return runtimeState.accountSummary;
    },
    isInviteCooldownActive() {
      return runtimeState.cooldownActive === true;
    },
    maskEmail(email: string | null | undefined) {
      return String(email || "").replace(/(^.).+(@.*$)/, "$1***$2");
    },
    mergeProvisioningAppMetadata(
      current: Record<string, unknown> | null,
      patch: Record<string, unknown>,
    ) {
      return { ...(current || {}), ...patch };
    },
    readFirstAccessInviteId(metadata: unknown) {
      const value = (metadata as { zion_first_access_invite_id?: unknown } | null)
        ?.zion_first_access_invite_id;
      return typeof value === "string" ? value : null;
    },
    async writeAuditEvent(event: Record<string, unknown>) {
      const operationId =
        typeof event.operationId === "string" && event.operationId.length > 0
          ? event.operationId
          : crypto.randomUUID();
      runtimeState.auditEvents.push({
        ...event,
        operationId,
      });
      return operationId;
    },
  };

  return {
    state: runtimeState,
    run() {
      return handleResendFirstAccess(
        new Request("https://example.com/api/zion-admin/accounts/resend-first-access", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ storeId: "store-1" }),
        }),
        deps as never,
      );
    },
  };
}

async function getJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: TestCase[] = [
  {
    name: "gate runs before service role on denied access",
    run: async () => {
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
      const response = await harness.run();

      assert.equal(response.status, 403);
      assert.equal(harness.state.calls.resolveAccess, 1);
      assert.equal(harness.state.calls.createServiceSupabase, 0);
    },
  },
  {
    name: "confirmed user resends with resetPasswordForEmail and never inviteUserByEmail",
    run: async () => {
      const harness = await createHarness(createBaseState());
      const response = await harness.run();
      const payload = await getJson(response);

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(payload.ok, true);
      assert.equal(harness.state.calls.resetPasswordForEmail.length, 1);
      assert.equal(harness.state.calls.inviteUserByEmail.length, 0);
      assert.equal(harness.state.auditEvents[0]?.outcome, "started");
      assert.equal(harness.state.auditEvents[1]?.outcome, "success");
      assert.equal(harness.state.auditEvents[0]?.operationId, harness.state.auditEvents[1]?.operationId);
    },
  },
  {
    name: "email is resolved on server and sanitized response omits secrets",
    run: async () => {
      const harness = await createHarness(createBaseState());
      const response = await harness.run();
      const payload = await getJson(response);
      const serialized = JSON.stringify(payload);

      assert.equal(harness.state.calls.resetPasswordForEmail[0]?.email, "owner@example.com");
      assert.equal(payload.emailMasked, "o***@example.com");
      assert.equal(serialized.includes("attempt"), false);
      assert.equal(serialized.includes("redirectTo"), false);
      assert.equal(serialized.includes("zion_first_access_invite_id"), false);
    },
  },
  {
    name: "legacy pending account without invite id receives a new attempt",
    run: async () => {
      const harness = await createHarness(
        createBaseState({
          authUser: {
            id: "owner-1",
            email: "owner@example.com",
            email_confirmed_at: "2026-07-28T12:00:00.000Z",
            app_metadata: {
              provisioned_via: "zion-admin",
              zion_provisioning_status: "provisioned",
              zion_first_access_required: true,
            },
          },
          attemptIds: ["fia_legacy_new"],
        }),
      );
      const response = await harness.run();

      assert.equal(response.status, 200);
      assert.equal(
        harness.state.authUser.app_metadata?.zion_first_access_invite_id,
        "fia_legacy_new",
      );
    },
  },
  {
    name: "cooldown blocks resend before delivery",
    run: async () => {
      const harness = await createHarness(
        createBaseState({
          cooldownActive: true,
          cooldownRemainingMs: 4321,
        }),
      );
      const response = await harness.run();
      const payload = await getJson(response);

      assert.equal(response.status, 429);
      assert.equal(payload.cooldownRemainingMs, 4321);
      assert.equal(harness.state.calls.resetPasswordForEmail.length, 0);
      assert.equal(harness.state.calls.inviteUserByEmail.length, 0);
      assert.equal(harness.state.auditEvents[0]?.reasonCode, "first_access_cooldown_active");
    },
  },
  {
    name: "blocked account is rejected",
    run: async () => {
      const harness = await createHarness(
        createBaseState({
          commercialAccess: { is_blocked: true },
        }),
      );
      const response = await harness.run();
      const payload = await getJson(response);

      assert.equal(response.status, 409);
      assert.equal(
        payload.error,
        "A conta da loja esta bloqueada e nao pode receber reenvio comum.",
      );
    },
  },
  {
    name: "configured account is rejected before delivery",
    run: async () => {
      const harness = await createHarness(
        createBaseState({
          accountSummary: {
            status: "first_access_completed",
          },
        }),
      );
      const response = await harness.run();
      const payload = await getJson(response);

      assert.equal(response.status, 409);
      assert.equal(
        payload.error,
        "Esta conta nao esta apta para reenviar o link de primeira senha.",
      );
      assert.equal(harness.state.calls.resetPasswordForEmail.length, 0);
    },
  },
  {
    name: "delivery failure restores previous metadata when still current",
    run: async () => {
      const previousMetadata = {
        provisioned_via: "zion-admin",
        zion_provisioning_status: "provisioned",
        zion_first_access_required: true,
        zion_first_access_invite_id: "fia_old",
      };
      const harness = await createHarness(
        createBaseState({
          authUser: {
            id: "owner-1",
            email: "owner@example.com",
            email_confirmed_at: "2026-07-28T12:00:00.000Z",
            app_metadata: previousMetadata,
          },
          resetError: { message: "smtp failed" },
          attemptIds: ["fia_new"],
        }),
      );
      const response = await harness.run();

      assert.equal(response.status, 500);
      assert.deepEqual(harness.state.authUser.app_metadata, previousMetadata);
      assert.equal(harness.state.calls.updateUserById.length, 2);
      assert.equal(harness.state.auditEvents[0]?.outcome, "started");
      assert.equal(harness.state.auditEvents.at(-1)?.outcome, "failed");
    },
  },
  {
    name: "restore failure returns controlled manual review response",
    run: async () => {
      const harness = await createHarness(
        createBaseState({
          resetError: { message: "smtp failed" },
          restoreFails: true,
        }),
      );
      const response = await harness.run();
      const payload = await getJson(response);

      assert.equal(response.status, 409);
      assert.equal(
        payload.error,
        "A metadata administrativa do primeiro acesso exige revisao manual antes de novo envio.",
      );
      assert.equal(harness.state.auditEvents[0]?.outcome, "started");
      assert.equal(harness.state.auditEvents.at(-1)?.outcome, "failed");
    },
  },
  {
    name: "only latest attempt stays valid after concurrent replacement",
    run: async () => {
      const harness = await createHarness(
        createBaseState({
          replacedByNewerAttempt: "fia_latest",
          attemptIds: ["fia_older"],
        }),
      );
      const response = await harness.run();
      const payload = await getJson(response);

      assert.equal(response.status, 409);
      assert.equal(
        payload.error,
        "Outro reenvio mais recente substituiu esta tentativa. Use apenas o ultimo link enviado.",
      );
      assert.equal(harness.state.auditEvents[0]?.outcome, "started");
      assert.equal(harness.state.auditEvents.at(-1)?.outcome, "failed");
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`zion-admin-accounts-resend-first-access-route: ${tests.length} tests passed`);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

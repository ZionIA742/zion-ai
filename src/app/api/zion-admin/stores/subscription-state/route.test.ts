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
  store?: {
    id: string;
    organization_id: string | null;
    name: string | null;
  } | null;
  subscriptions?: Array<{
    id: string;
    organization_id: string | null;
    status: string | null;
  }>;
  integrationsUpdateError?: unknown;
  subscriptionUpdateError?: unknown;
};

function createBaseState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    accessResult: {
      ok: true,
      sessionUserId: "admin-1",
    },
    store: {
      id: "store-1",
      organization_id: "org-1",
      name: "Loja 1",
    },
    subscriptions: [
      {
        id: "subscription-1",
        organization_id: "org-1",
        status: "active",
      },
    ],
    ...overrides,
  };
}

async function createHarness(state: RuntimeState) {
  const runtimeState = {
    ...state,
    auditEvents: [] as Array<Record<string, unknown>>,
    calls: {
      resolveAccess: 0,
      createServiceSupabase: 0,
      storeLookups: [] as string[],
      subscriptionLookups: [] as string[],
      integrationUpdates: [] as Array<{ organizationId: string; storeId: string }>,
      subscriptionUpdates: [] as Array<{ subscriptionId: string; organizationId: string; status: string }>,
      profileUpdates: 0,
      membershipUpdates: 0,
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
              const filters: Array<{ column: string; value: unknown }> = [];

              const builder = {
                eq(column: string, value: unknown) {
                  filters.push({ column, value });
                  return builder;
                },
                limit(value: number) {
                  void value;

                  if (table === "subscriptions") {
                    const organizationId = String(
                      filters.find((filter) => filter.column === "organization_id")?.value || "",
                    );
                    runtimeState.calls.subscriptionLookups.push(organizationId);
                    return Promise.resolve({
                      data: (runtimeState.subscriptions ?? []).filter(
                        (row) => row.organization_id === organizationId,
                      ),
                      error: null,
                    });
                  }

                  return Promise.resolve({
                    data: [],
                    error: null,
                  });
                },
                maybeSingle() {
                  if (table === "stores") {
                    const storeId = String(
                      filters.find((filter) => filter.column === "id")?.value || "",
                    );
                    runtimeState.calls.storeLookups.push(storeId);
                    return Promise.resolve({
                      data: runtimeState.store?.id === storeId ? runtimeState.store : null,
                      error: null,
                    });
                  }

                  return Promise.resolve({
                    data: null,
                    error: null,
                  });
                },
              };

              return builder;
            },
            update(payload: Record<string, unknown>) {
              const filters: Array<{ column: string; value: unknown }> = [];

              const builder = {
                eq(column: string, value: unknown) {
                  filters.push({ column, value });
                  return builder;
                },
                select() {
                  if (table === "external_integrations") {
                    const organizationId = String(
                      filters.find((filter) => filter.column === "organization_id")?.value || "",
                    );
                    const storeId = String(
                      filters.find((filter) => filter.column === "store_id")?.value || "",
                    );
                    runtimeState.calls.integrationUpdates.push({ organizationId, storeId });

                    if (runtimeState.integrationsUpdateError) {
                      return Promise.resolve({
                        data: null,
                        error: runtimeState.integrationsUpdateError,
                      });
                    }

                    return Promise.resolve({
                      data: [],
                      error: null,
                    });
                  }

                  return {
                    maybeSingle: async () => {
                      if (table === "subscriptions") {
                        const subscriptionId = String(
                          filters.find((filter) => filter.column === "id")?.value || "",
                        );
                        const organizationId = String(
                          filters.find((filter) => filter.column === "organization_id")?.value || "",
                        );
                        runtimeState.calls.subscriptionUpdates.push({
                          subscriptionId,
                          organizationId,
                          status: String(payload.status || ""),
                        });

                        if (runtimeState.subscriptionUpdateError) {
                          return {
                            data: null,
                            error: runtimeState.subscriptionUpdateError,
                          };
                        }

                        const subscription = (runtimeState.subscriptions ?? []).find(
                          (row) =>
                            row.id === subscriptionId &&
                            row.organization_id === organizationId,
                        );

                        if (!subscription) {
                          return {
                            data: null,
                            error: null,
                          };
                        }

                        subscription.status = String(payload.status || null);

                        return {
                          data: subscription,
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

              return builder;
            },
          };
        },
      };
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
    async run(body: Record<string, unknown>) {
      const { handleStoreSubscriptionStateMutation } = await import(
        routeHandlerModuleUrl.href
      );

      return handleStoreSubscriptionStateMutation(
        new Request("https://example.com/api/zion-admin/stores/subscription-state", {
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
        storeId: "store-1",
        action: "suspend",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 403);
      assert.equal(payload.error, "ZION_ADMIN_API_FORBIDDEN");
      assert.equal(harness.state.calls.resolveAccess, 1);
      assert.equal(harness.state.calls.createServiceSupabase, 0);
    },
  },
  {
    name: "store missing fails closed without mutation",
    async run() {
      const harness = await createHarness(
        createBaseState({
          store: null,
        }),
      );

      const response = await harness.run({
        storeId: "missing-store",
        action: "suspend",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 404);
      assert.equal(payload.error, "Loja alvo nao encontrada.");
      assert.deepEqual(harness.state.calls.storeLookups, ["missing-store"]);
      assert.deepEqual(harness.state.calls.integrationUpdates, []);
      assert.deepEqual(harness.state.calls.subscriptionUpdates, []);
    },
  },
  {
    name: "subscription missing or ambiguous fails closed",
    async run() {
      const missingHarness = await createHarness(
        createBaseState({
          subscriptions: [],
        }),
      );

      const missingResponse = await missingHarness.run({
        storeId: "store-1",
        action: "suspend",
      });
      const missingPayload = await readJson(missingResponse);

      assert.equal(missingResponse.status, 409);
      assert.equal(
        missingPayload.error,
        "Subscription canonica inexistente ou ambigua para a loja.",
      );
      assert.deepEqual(missingHarness.state.calls.subscriptionUpdates, []);

      const ambiguousHarness = await createHarness(
        createBaseState({
          subscriptions: [
            {
              id: "subscription-1",
              organization_id: "org-1",
              status: "active",
            },
            {
              id: "subscription-2",
              organization_id: "org-1",
              status: "suspended",
            },
          ],
        }),
      );

      const ambiguousResponse = await ambiguousHarness.run({
        storeId: "store-1",
        action: "suspend",
      });
      const ambiguousPayload = await readJson(ambiguousResponse);

      assert.equal(ambiguousResponse.status, 409);
      assert.equal(
        ambiguousPayload.error,
        "Subscription canonica inexistente ou ambigua para a loja.",
      );
      assert.deepEqual(ambiguousHarness.state.calls.integrationUpdates, []);
      assert.deepEqual(ambiguousHarness.state.calls.subscriptionUpdates, []);
    },
  },
  {
    name: "browser does not choose organization or subscription authority",
    async run() {
      const harness = await createHarness(createBaseState());

      const response = await harness.run({
        storeId: "store-1",
        action: "suspend",
        organizationId: "attacker-org",
        subscriptionId: "attacker-subscription",
        status: "active",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 200);
      assert.equal(payload.organizationId, "org-1");
      assert.equal(payload.subscriptionId, "subscription-1");
      assert.deepEqual(harness.state.calls.storeLookups, ["store-1"]);
      assert.deepEqual(harness.state.calls.subscriptionLookups, ["org-1"]);
    },
  },
  {
    name: "suspend disables integrations before suspending subscription",
    async run() {
      const harness = await createHarness(createBaseState());

      const response = await harness.run({
        storeId: "store-1",
        action: "suspend",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 200);
      assert.equal(payload.subscriptionStatus, "suspended");
      assert.deepEqual(harness.state.calls.integrationUpdates, [
        { organizationId: "org-1", storeId: "store-1" },
      ]);
      assert.deepEqual(harness.state.calls.subscriptionUpdates, [
        {
          subscriptionId: "subscription-1",
          organizationId: "org-1",
          status: "suspended",
        },
      ]);
      assert.equal(harness.state.auditEvents[0]?.outcome, "started");
      assert.equal(harness.state.auditEvents[1]?.outcome, "success");
      assert.equal(harness.state.auditEvents[1]?.previousState, "active");
      assert.equal(harness.state.auditEvents[1]?.nextState, "suspended");
      assert.equal(harness.state.auditEvents[0]?.operationId, harness.state.auditEvents[1]?.operationId);
    },
  },
  {
    name: "integration failure keeps subscription active",
    async run() {
      const harness = await createHarness(
        createBaseState({
          integrationsUpdateError: {
            message: "integration update failed",
          },
        }),
      );

      const response = await harness.run({
        storeId: "store-1",
        action: "suspend",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 500);
      assert.equal(payload.error, "Falha interna ao atualizar o estado da loja.");
      assert.deepEqual(harness.state.calls.subscriptionUpdates, []);
      assert.equal(harness.state.subscriptions?.[0]?.status, "active");
      assert.equal(harness.state.auditEvents[0]?.outcome, "started");
      assert.equal(harness.state.auditEvents.at(-1)?.outcome, "failed");
    },
  },
  {
    name: "subscription failure keeps integrations disabled and response is not success",
    async run() {
      const harness = await createHarness(
        createBaseState({
          subscriptionUpdateError: {
            message: "subscription update failed",
          },
        }),
      );

      const response = await harness.run({
        storeId: "store-1",
        action: "suspend",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 500);
      assert.equal(payload.error, "Falha interna ao atualizar o estado da loja.");
      assert.deepEqual(harness.state.calls.integrationUpdates, [
        { organizationId: "org-1", storeId: "store-1" },
      ]);
      assert.deepEqual(harness.state.calls.subscriptionUpdates, [
        {
          subscriptionId: "subscription-1",
          organizationId: "org-1",
          status: "suspended",
        },
      ]);
      assert.equal(harness.state.subscriptions?.[0]?.status, "active");
      assert.equal(harness.state.auditEvents[0]?.outcome, "started");
      assert.equal(harness.state.auditEvents.at(-1)?.outcome, "failed");
      assert.equal(harness.state.auditEvents[0]?.operationId, harness.state.auditEvents.at(-1)?.operationId);
    },
  },
  {
    name: "success reactivates suspended subscription without re-enabling integrations",
    async run() {
      const harness = await createHarness(
        createBaseState({
          subscriptions: [
            {
              id: "subscription-1",
              organization_id: "org-1",
              status: "suspended",
            },
          ],
        }),
      );

      const response = await harness.run({
        storeId: "store-1",
        action: "reactivate",
      });
      const payload = await readJson(response);

      assert.equal(response.status, 200);
      assert.equal(payload.subscriptionStatus, "active");
      assert.deepEqual(harness.state.calls.integrationUpdates, []);
      assert.deepEqual(harness.state.calls.subscriptionUpdates, [
        {
          subscriptionId: "subscription-1",
          organizationId: "org-1",
          status: "active",
        },
      ]);
      assert.equal(harness.state.auditEvents[0]?.outcome, "started");
      assert.equal(harness.state.auditEvents[1]?.outcome, "success");
      assert.equal(harness.state.calls.profileUpdates, 0);
      assert.equal(harness.state.calls.membershipUpdates, 0);
    },
  },
  {
    name: "invalid target statuses are rejected",
    async run() {
      const suspendHarness = await createHarness(
        createBaseState({
          subscriptions: [
            {
              id: "subscription-1",
              organization_id: "org-1",
              status: "suspended",
            },
          ],
        }),
      );

      const suspendResponse = await suspendHarness.run({
        storeId: "store-1",
        action: "suspend",
      });
      const suspendPayload = await readJson(suspendResponse);

      assert.equal(suspendResponse.status, 409);
      assert.equal(
        suspendPayload.error,
        "Somente lojas com subscription active podem ser desativadas nesta etapa.",
      );

      const reactivateHarness = await createHarness(createBaseState());
      const reactivateResponse = await reactivateHarness.run({
        storeId: "store-1",
        action: "reactivate",
      });
      const reactivatePayload = await readJson(reactivateResponse);

      assert.equal(reactivateResponse.status, 409);
      assert.equal(
        reactivatePayload.error,
        "Somente lojas suspensas podem ser reativadas nesta etapa.",
      );
      assert.equal(
        reactivateHarness.state.auditEvents[0]?.reasonCode,
        "subscription_status_not_suspended",
      );
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`zion-admin-store-subscription-state-route: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

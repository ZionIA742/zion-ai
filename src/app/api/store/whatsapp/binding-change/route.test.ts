import { MetaWhatsappEmbeddedSignupError } from "@/lib/server/meta-whatsapp-embedded-signup";
import { strict as assert } from "node:assert";
import test from "node:test";
import {
  createWhatsappBindingChangeRouteHandler as createRouteHandler,
} from "./route-handler";
import type {
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

const ORG = "org-1";
const STORE = "store-1";
const REQUEST_ID = "request-1";
const ACTIVE_ID = "active-1";

const validateFreshToken = async ({
  whatsappBusinessAccountId,
  phoneNumberId,
}: {
  code: string;
  whatsappBusinessAccountId: string;
  phoneNumberId: string;
}) => ({
  accessToken: "fresh-token-sentinel",
  whatsappBusinessAccountId,
  phoneNumberId,
  displayPhoneNumber: "+55180018",
  graphApiVersion: "v99.0",
  appId: "app-test",
  validatedAt: "2026-10-02T10:00:00.000Z",
  connectionMode: "standard" as const,
});

function createWhatsappBindingChangeRouteHandler(
  args: Parameters<typeof createRouteHandler>[0] = {},
) {
  return createRouteHandler({
    validateFreshToken,
    confirmStandardConnection: async () => {},
    ...args,
  });
}

type FakeState = {
  request: Record<string, unknown>;
  active: Record<string, unknown>;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
};

function createState(overrides: {
  status?: string;
  activeWaba?: string;
  candidateWaba?: string;
  expiresAt?: string;
} = {}): FakeState {
  return {
    request: {
      id: REQUEST_ID,
      organization_id: ORG,
      store_id: STORE,
      provider: "whatsapp",
      status: overrides.status ?? "candidate_received",
      active_integration_id: ACTIVE_ID,
      active_phone_number_id_snapshot: "phone-1471",
      active_whatsapp_business_account_id_snapshot:
        overrides.activeWaba ?? "waba-1",
      active_display_phone_number_snapshot: "+5511471",
      candidate_whatsapp_business_account_id:
        overrides.candidateWaba ?? "waba-1",
      candidate_phone_number_id: "phone-0018",
      candidate_display_phone_number: "+55180018",
      candidate_received_at: "2026-10-02T10:00:00.000Z",
      expires_at: overrides.expiresAt ?? "2099-10-02T10:00:00.000Z",
      completed_at: null,
      terminal_at: null,
    },
    active: {
      id: ACTIVE_ID,
      organization_id: ORG,
      store_id: STORE,
      provider: "whatsapp",
      status: "active",
      is_active: true,
      access_token: "old-token-sentinel",
      phone_number_id: "phone-1471",
      whatsapp_business_account_id: overrides.activeWaba ?? "waba-1",
      display_phone_number: "+5511471",
    },
    calls: [],
  };
}

function createSupabase(state: FakeState) {
  return {
    from(table: string) {
      return {
        select() {
          const filters: Record<string, unknown> = {};
          const query = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return query;
            },
            async maybeSingle() {
              const row = table === "external_integrations" ? state.active : state.request;
              const matches = Object.entries(filters).every(
                ([key, value]) => row[key] === value,
              );
              return { data: matches ? { ...row } : null, error: null };
            },
          };
          return query;
        },
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      state.calls.push({ name, args });
      if (name === "resolve_whatsapp_number_change_link_by_system") {
        return {
          data: [{
            link_id: "link-test-1",
            organization_id: ORG,
            store_id: STORE,
            provider: "whatsapp",
            responsible_user_id: "user-1",
            binding_change_request_id: REQUEST_ID,
          }],
          error: null,
        };
      }
      if (name === "get_pending_external_messages_v2") {
        return { data: [], error: null };
      }
      if (name === "advance_whatsapp_binding_change_request_by_system") {
        state.request.status = args.p_next_status;
      } else if (name === "cancel_whatsapp_binding_change_request_by_system") {
        state.request.status = "cancelled";
      } else if (name === "expire_whatsapp_binding_change_request_by_system") {
        state.request.status = "expired";
      } else if (name === "cutover_whatsapp_binding_change_request_by_system") {
        state.active.access_token = args.p_fresh_access_token;
        state.active.whatsapp_business_account_id =
          state.request.candidate_whatsapp_business_account_id;
        state.active.phone_number_id = state.request.candidate_phone_number_id;
        state.active.display_phone_number = state.request.candidate_display_phone_number;
        state.request.status = "completed";
        state.request.completed_phone_number_id = state.request.candidate_phone_number_id;
        state.request.completed_whatsapp_business_account_id =
          state.request.candidate_whatsapp_business_account_id;
        state.request.completed_display_phone_number =
          state.request.candidate_display_phone_number;
      }
      return { data: [{ request_id: REQUEST_ID, status: state.request.status }], error: null };
    },
  };
}

function grantedAccess(overrides: Partial<StoreApiAccessGranted> = {}): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as StoreApiAccessGranted["supabase"],
    resolution: {
      domain: "store_area",
      status: "store_ready_active",
      sessionUserId: "user-1",
      safeHtmlDestination: "/crm",
      apiDecision: "allow",
      organizationResolution: "single",
      storeResolution: "single",
      organizationId: ORG,
      storeId: STORE,
      commercialAccess: "allowed",
      reasonCode: "ready_active",
      message: "Conta liberada.",
    },
    sessionUserId: "user-1",
    organizationId: ORG,
    storeId: STORE,
    ...overrides,
  };
}

function request(method: "GET" | "POST", body?: unknown) {
  const payload =
    body && typeof body === "object" && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>) }
      : body;
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>).action === "cutover" &&
    !("authorizationCode" in (payload as Record<string, unknown>))
  ) {
    (payload as Record<string, unknown>).authorizationCode = "fresh-code-sentinel";
  }
  return new Request(`https://example.test/api/store/whatsapp/binding-change?request_id=${REQUEST_ID}`, {
    method,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
  });
}

async function readResponse(response: Response) {
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

test("GET returns only scoped non-secret request fields", async () => {
  const state = createState();
  const handler = createWhatsappBindingChangeRouteHandler({
    resolveAccess: async () => grantedAccess(),
    createPrivilegedClient: () => createSupabase(state),
  });
  const result = await readResponse(await handler.GET(request("GET")));
  assert.equal(result.status, 200);
  assert.equal((result.body.request as Record<string, unknown>).id, REQUEST_ID);
  assert.equal(JSON.stringify(result.body).includes("access_token"), false);
  assert.equal(JSON.stringify(result.body).includes("authorization_code"), false);
});

test("cross-organization and cross-store requests fail closed", async () => {
  for (const overrides of [
    { organizationId: "other-org" },
    { storeId: "other-store" },
  ]) {
    const state = createState();
    const handler = createWhatsappBindingChangeRouteHandler({
      resolveAccess: async () => grantedAccess(overrides),
      createPrivilegedClient: () => createSupabase(state),
    });
    const result = await readResponse(await handler.GET(request("GET")));
    assert.equal(result.status, 404);
    assert.equal(result.body.error, "WHATSAPP_BINDING_CHANGE_REQUEST_NOT_FOUND");
  }
});

test("validate and ready use only the canonical consecutive transitions", async () => {
  const state = createState();
  const handler = createWhatsappBindingChangeRouteHandler({
    resolveAccess: async () => grantedAccess(),
    createPrivilegedClient: () => createSupabase(state),
  });

  let result = await readResponse(await handler.POST(request("POST", { action: "validate", requestId: REQUEST_ID })));
  assert.equal(result.status, 200);
  assert.equal(state.request.status, "validating");

  result = await readResponse(await handler.POST(request("POST", { action: "ready", requestId: REQUEST_ID })));
  assert.equal(result.status, 200);
  assert.equal(state.request.status, "ready_to_cutover");
  assert.deepEqual(
    state.calls.map((call) => [call.name, call.args.p_next_status]),
    [
      ["advance_whatsapp_binding_change_request_by_system", "validating"],
      ["advance_whatsapp_binding_change_request_by_system", "ready_to_cutover"],
    ],
  );
});

test("terminal states block every advance and cutover RPC", async () => {
  for (const status of ["completed", "failed", "cancelled", "expired"]) {
    for (const action of ["validate", "ready", "cutover"]) {
      const state = createState({ status });
      const handler = createWhatsappBindingChangeRouteHandler({
        resolveAccess: async () => grantedAccess(),
        createPrivilegedClient: () => createSupabase(state),
      });
      const result = await readResponse(
        await handler.POST(request("POST", { action, requestId: REQUEST_ID })),
      );

      if (status === "completed" && action === "cutover") {
        assert.equal(result.status, 200);
        assert.equal(
          (result.body.request as Record<string, unknown>).status,
          "completed",
        );
      } else {
        assert.equal(result.status, 409);
        assert.equal(state.calls.length, 0);
      }
    }
  }
});

test("expired requests block validate, ready, and cutover", async () => {
  for (const action of ["validate", "ready", "cutover"]) {
    const state = createState({
      status: "candidate_received",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    const handler = createWhatsappBindingChangeRouteHandler({
      resolveAccess: async () => grantedAccess(),
      createPrivilegedClient: () => createSupabase(state),
    });
    const result = await readResponse(
      await handler.POST(request("POST", { action, requestId: REQUEST_ID })),
    );

    assert.equal(result.status, 409);
    assert.equal(state.calls.length, 0);
  }
});

test("client cannot inject active or candidate values", async () => {
  for (const key of [
    "candidate",
    "candidateWaba",
    "candidate_whatsapp_business_account_id",
    "candidatePhoneNumberId",
    "candidate_phone_number_id",
    "candidateDisplayPhoneNumber",
    "candidate_display_phone_number",
    "activeIntegrationId",
  ]) {
    const state = createState({ status: "ready_to_cutover" });
    const handler = createWhatsappBindingChangeRouteHandler({
      resolveAccess: async () => grantedAccess(),
      createPrivilegedClient: () => createSupabase(state),
    });
    const result = await readResponse(
      await handler.POST(request("POST", { action: "cutover", requestId: REQUEST_ID, [key]: "attacker-value" })),
    );
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "WHATSAPP_BINDING_CHANGE_FORBIDDEN_INPUT");
    assert.equal(state.calls.length, 0);
  }
});

test("secret-like client inputs never reach RPC, response, or provenance", async () => {
  const secretKeys = [
    "accessToken",
    "access_token",
    "token",
    "refreshToken",
    "refresh_token",
    "app_secret",
    "client_secret",
    "api_key",
    "bearer",
    "password",
    "secret",
  ];

  for (const key of secretKeys) {
    const marker = `secret-marker-${key}`;
    const state = createState({ status: "ready_to_cutover" });
    const handler = createWhatsappBindingChangeRouteHandler({
      resolveAccess: async () => grantedAccess(),
      createPrivilegedClient: () => createSupabase(state),
    });
    const result = await readResponse(
      await handler.POST(
        request("POST", {
          action: "cutover",
          requestId: REQUEST_ID,
          [key]: marker,
        }),
      ),
    );

    assert.equal(JSON.stringify(result.body).includes(marker), false);
    assert.equal(
      JSON.stringify(state.calls).includes(marker),
      false,
      `${key} reached an RPC argument`,
    );
    assert.equal(JSON.stringify(state.request).includes(marker), false);
  }
});

test("cutover requires a fresh authorization code but never returns it", async () => {
  const state = createState({ status: "ready_to_cutover" });
  const handler = createWhatsappBindingChangeRouteHandler({
    resolveAccess: async () => grantedAccess(),
    createPrivilegedClient: () => createSupabase(state),
  });

  let result = await readResponse(
    await handler.POST(
      request("POST", {
        action: "cutover",
        requestId: REQUEST_ID,
        authorizationCode: null,
      }),
    ),
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "ZION_WHATSAPP_CHANGE_AUTHORIZATION_CODE_REQUIRED");
  assert.equal(state.calls.length, 0);

  result = await readResponse(
    await handler.POST(
      request("POST", {
        action: "cutover",
        requestId: REQUEST_ID,
        authorizationCode: "fresh-code-sentinel",
      }),
    ),
  );
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(result.body).includes("fresh-code-sentinel"), false);
  assert.equal(JSON.stringify(result.body).includes("fresh-token-sentinel"), false);
});

test("cutover derives active and candidate from the scoped database rows", async () => {
  const state = createState({ status: "ready_to_cutover" });
  const handler = createWhatsappBindingChangeRouteHandler({
    resolveAccess: async () => grantedAccess(),
    createPrivilegedClient: () => createSupabase(state),
  });
  const result = await readResponse(await handler.POST(request("POST", { action: "cutover", requestId: REQUEST_ID })));
  assert.equal(result.status, 200);
  const cutover = state.calls.find((call) => call.name.includes("cutover"));
  assert.ok(cutover);
  assert.equal(cutover.args.p_expected_active_integration_id, ACTIVE_ID);
  assert.equal(cutover.args.p_expected_candidate_phone_number_id, "phone-0018");
  assert.equal(cutover.args.p_expected_candidate_whatsapp_business_account_id, "waba-1");
  assert.equal(cutover.args.p_fresh_access_token, "fresh-token-sentinel");
  assert.deepEqual(cutover.args.p_provenance, {
    source: "p19a_whatsapp_binding_change_operation",
    connection_mode: "standard",
  });
});

test("authorized coexistence link forwards connection mode", async () => {
  const state = createState({ status: "ready_to_cutover" });
  const handler = createWhatsappBindingChangeRouteHandler({
    resolveAccess: async () => grantedAccess(),
    createPrivilegedClient: () => createSupabase(state),
  });

  const result = await readResponse(
    await handler.POST(request("POST", {
      action: "cutover",
      requestId: REQUEST_ID,
      numberChangeLinkToken: "synthetic-coexistence-link-token",
    })),
  );

  assert.equal(result.status, 200);
  assert.ok(state.calls.some(
    (call) => call.name === "resolve_whatsapp_number_change_link_by_system",
  ));
  assert.ok(state.calls.some(
    (call) => call.name === "get_pending_external_messages_v2",
  ));

  const cutover = state.calls.find(
    (call) => call.name === "cutover_whatsapp_binding_change_request_by_system",
  );
  assert.ok(cutover);
  assert.deepEqual(cutover.args.p_provenance, {
    source: "p19a_whatsapp_binding_change_operation",
    connection_mode: "business_app_coexistence",
  });
});
test("different WABA succeeds with a freshly validated token", async () => {
  const state = createState({ status: "ready_to_cutover", candidateWaba: "waba-2" });
  const handler = createWhatsappBindingChangeRouteHandler({
    resolveAccess: async () => grantedAccess(),
    createPrivilegedClient: () => createSupabase(state),
  });
  const result = await readResponse(await handler.POST(request("POST", { action: "cutover", requestId: REQUEST_ID })));
  assert.equal(result.status, 200);
  assert.equal(state.request.status, "completed");
  assert.equal(state.active.whatsapp_business_account_id, "waba-2");
  assert.equal(state.active.access_token, "fresh-token-sentinel");
});

test("Meta candidate mismatch blocks the RPC", async () => {
  const state = createState({ status: "ready_to_cutover" });
  const handler = createWhatsappBindingChangeRouteHandler({
    resolveAccess: async () => grantedAccess(),
    createPrivilegedClient: () => createSupabase(state),
    validateFreshToken: async () => ({
      ...await validateFreshToken({
        code: "fresh-code-sentinel",
        whatsappBusinessAccountId: "waba-1",
        phoneNumberId: "phone-0018",
      }),
      whatsappBusinessAccountId: "waba-attacker",
    }),
  });
  const result = await readResponse(
    await handler.POST(request("POST", { action: "cutover", requestId: REQUEST_ID })),
  );
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "ZION_WHATSAPP_CHANGE_META_BINDING_MISMATCH");
  assert.equal(state.calls.some((call) => call.name.includes("cutover")), false);
});

test("same WABA reaches the existing cutover RPC and cancel is replayable", async () => {
  const state = createState({ status: "ready_to_cutover" });
  const handler = createWhatsappBindingChangeRouteHandler({
    resolveAccess: async () => grantedAccess(),
    createPrivilegedClient: () => createSupabase(state),
  });
  let result = await readResponse(await handler.POST(request("POST", { action: "cutover", requestId: REQUEST_ID })));
  assert.equal(result.status, 200);
  assert.equal(state.request.status, "completed");

  result = await readResponse(
    await handler.POST(
      request("POST", {
        action: "cutover",
        requestId: REQUEST_ID,
        authorizationCode: null,
      }),
    ),
  );
  assert.equal(result.status, 200);
  assert.equal(state.calls.filter((call) => call.name.includes("cutover")).length, 1);
  assert.equal(JSON.stringify(result.body).includes("fresh-token-sentinel"), false);

  const cancelState = createState();
  const cancelHandler = createWhatsappBindingChangeRouteHandler({
    resolveAccess: async () => grantedAccess(),
    createPrivilegedClient: () => createSupabase(cancelState),
  });
  result = await readResponse(await cancelHandler.POST(request("POST", { action: "cancel", requestId: REQUEST_ID })));
  assert.equal(result.status, 200);
  result = await readResponse(await cancelHandler.POST(request("POST", { action: "cancel", requestId: REQUEST_ID })));
  assert.equal(result.status, 200);
  assert.equal(cancelState.request.status, "cancelled");
});

test("expiry requires an elapsed request and does not use first-connection writer", async () => {
  const state = createState({ expiresAt: "2020-01-01T00:00:00.000Z" });
  const handler = createWhatsappBindingChangeRouteHandler({
    resolveAccess: async () => grantedAccess(),
    createPrivilegedClient: () => createSupabase(state),
  });
  const result = await readResponse(await handler.POST(request("POST", { action: "expire", requestId: REQUEST_ID })));
  assert.equal(result.status, 200);
  assert.equal(state.request.status, "expired");
  assert.equal(state.calls.some((call) => call.name.includes("materialize")), false);
});

test("standard cutover confirms Meta before the cutover RPC", async () => {
  const state = createState({ status: "ready_to_cutover" });
  let confirmations = 0;

  const handler = createWhatsappBindingChangeRouteHandler({
    resolveAccess: async () => grantedAccess(),
    createPrivilegedClient: () => createSupabase(state),
    confirmStandardConnection: async (validated) => {
      confirmations++;

      assert.equal(validated.phoneNumberId, "phone-0018");
      assert.equal(validated.whatsappBusinessAccountId, "waba-1");
      assert.equal(validated.connectionMode, "standard");

      assert.equal(
        state.calls.some(
          (call) =>
            call.name ===
            "cutover_whatsapp_binding_change_request_by_system",
        ),
        false,
      );
    },
  });

  const result = await readResponse(
    await handler.POST(
      request("POST", {
        action: "cutover",
        requestId: REQUEST_ID,
      }),
    ),
  );

  assert.equal(result.status, 200);
  assert.equal(confirmations, 1);

  const cutovers = state.calls.filter(
    (call) =>
      call.name === "cutover_whatsapp_binding_change_request_by_system",
  );

  assert.equal(cutovers.length, 1);
  assert.deepEqual(cutovers[0].args.p_provenance, {
    source: "p19a_whatsapp_binding_change_operation",
    connection_mode: "standard",
  });

  assert.equal(state.request.status, "completed");
  assert.equal(state.active.phone_number_id, "phone-0018");
});

const standardConfirmationFailures = [
  {
    name: "unconfirmed standard mode blocks cutover and preserves active binding",
    error: new MetaWhatsappEmbeddedSignupError(
      "META_STANDARD_CONNECTION_UNCONFIRMED",
      "synthetic-unconfirmed",
      422,
      { operation: "read_standard_connection_state" },
    ),
    expectedStatus: 409,
    expectedCode: "WHATSAPP_BINDING_CHANGE_STANDARD_MODE_UNCONFIRMED",
  },
  {
    name: "Meta unavailable blocks cutover and preserves active binding",
    error: new MetaWhatsappEmbeddedSignupError(
      "META_UNAVAILABLE",
      "synthetic-unavailable",
      502,
      { operation: "read_standard_connection_state" },
    ),
    expectedStatus: 503,
    expectedCode: "WHATSAPP_BINDING_CHANGE_STANDARD_MODE_CHECK_FAILED",
  },
  {
    name: "unexpected confirmation failure blocks cutover and preserves active binding",
    error: new Error("synthetic-unexpected-error"),
    expectedStatus: 503,
    expectedCode: "WHATSAPP_BINDING_CHANGE_STANDARD_MODE_CHECK_FAILED",
  },
];

for (const scenario of standardConfirmationFailures) {
  test(scenario.name, async () => {
    const state = createState({ status: "ready_to_cutover" });

    const originalActive = structuredClone(state.active);
    const originalRequest = structuredClone(state.request);

    let confirmations = 0;

    const handler = createWhatsappBindingChangeRouteHandler({
      resolveAccess: async () => grantedAccess(),
      createPrivilegedClient: () => createSupabase(state),
      confirmStandardConnection: async () => {
        confirmations++;
        throw scenario.error;
      },
    });

    const result = await readResponse(
      await handler.POST(
        request("POST", {
          action: "cutover",
          requestId: REQUEST_ID,
        }),
      ),
    );

    assert.equal(result.status, scenario.expectedStatus);
    assert.equal(result.body.error, scenario.expectedCode);
    assert.equal(confirmations, 1);

    assert.equal(
      state.calls.some(
        (call) =>
          call.name ===
          "cutover_whatsapp_binding_change_request_by_system",
      ),
      false,
    );

    assert.deepEqual(state.active, originalActive);
    assert.deepEqual(state.request, originalRequest);

    assert.equal(state.active.phone_number_id, "phone-1471");
    assert.equal(state.active.access_token, "old-token-sentinel");
    assert.equal(state.request.status, "ready_to_cutover");

    const responseText = JSON.stringify(result.body);

    assert.equal(
      responseText.includes("synthetic-"),
      false,
    );
    assert.equal(
      responseText.includes("fresh-token-sentinel"),
      false,
    );
  });
}

test("authorized coexistence bypasses standard confirmation", async () => {
  const state = createState({ status: "ready_to_cutover" });
  let standardConfirmations = 0;

  const handler = createWhatsappBindingChangeRouteHandler({
    resolveAccess: async () => grantedAccess(),
    createPrivilegedClient: () => createSupabase(state),
    confirmStandardConnection: async () => {
      standardConfirmations++;
      throw new Error("standard check must not run for coexistence");
    },
  });

  const result = await readResponse(
    await handler.POST(
      request("POST", {
        action: "cutover",
        requestId: REQUEST_ID,
        numberChangeLinkToken: "synthetic-coexistence-link-token",
      }),
    ),
  );

  assert.equal(result.status, 200);
  assert.equal(standardConfirmations, 0);

  assert.ok(
    state.calls.some(
      (call) =>
        call.name ===
        "resolve_whatsapp_number_change_link_by_system",
    ),
  );

  assert.ok(
    state.calls.some(
      (call) => call.name === "get_pending_external_messages_v2",
    ),
  );

  const cutovers = state.calls.filter(
    (call) =>
      call.name === "cutover_whatsapp_binding_change_request_by_system",
  );

  assert.equal(cutovers.length, 1);
  assert.deepEqual(cutovers[0].args.p_provenance, {
    source: "p19a_whatsapp_binding_change_operation",
    connection_mode: "business_app_coexistence",
  });
});

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  POST,
  createStoreWhatsappEmbeddedSignupPostHandler,
} from "./route";
import {
  exchangeAndValidateMetaWhatsappEmbeddedSignup,
  MetaWhatsappEmbeddedSignupError,
  type MetaWhatsappEmbeddedSignupValidationResult,
} from "@/lib/server/meta-whatsapp-embedded-signup";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

process.env.ZION_WHATSAPP_PIN_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 7).toString(
  "base64",
);

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type RpcCall = {
  name: string;
  args: Record<string, unknown>;
};

function createDeniedAccess(
  httpStatus: 401 | 403 | 409 | 503,
  status: StoreApiAccessDenied["payload"]["status"],
  reasonCode: StoreApiAccessDenied["payload"]["reasonCode"],
): StoreApiAccessDenied {
  return {
    ok: false,
    resolution: {
      domain: status === "anonymous" ? "anonymous" : "store_area",
      status,
      sessionUserId: null,
      safeHtmlDestination:
        status === "anonymous" ? "/login" : "/account/access-blocked",
      apiDecision:
        httpStatus === 401
          ? "deny_401"
          : httpStatus === 403
            ? "deny_403"
            : httpStatus === 503
              ? "deny_503"
              : "deny_409",
      organizationResolution: "none",
      storeResolution: "none",
      organizationId: null,
      storeId: null,
      commercialAccess: "unknown",
      reasonCode,
      message: "Mensagem interna.",
    },
    httpStatus,
    payload: {
      ok: false,
      error:
        httpStatus === 401
          ? "STORE_API_UNAUTHENTICATED"
          : httpStatus === 403
            ? "STORE_API_FORBIDDEN"
            : httpStatus === 503
              ? "STORE_API_ACCESS_UNAVAILABLE"
              : "STORE_API_ACCESS_DENIED",
      message: "Mensagem publica.",
      status,
      reasonCode,
    },
  };
}

function createGrantedAccess(
  overrides?: Partial<StoreApiAccessGranted>,
): StoreApiAccessGranted {
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
      organizationId: "access-org",
      storeId: "access-store",
      commercialAccess: "allowed",
      reasonCode: "ready_active",
      message: "Conta liberada.",
    },
    sessionUserId: "user-1",
    organizationId: "access-org",
    storeId: "access-store",
    ...overrides,
  };
}

function createJsonRequest(body: unknown) {
  return new Request("https://example.test/api/store/whatsapp/embedded-signup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function createInvalidJsonRequest() {
  return new Request("https://example.test/api/store/whatsapp/embedded-signup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: "{",
  });
}

function createTrackedRequest(body: unknown, tracker: { reads: number }) {
  return {
    headers: {
      get: () => null,
    },
    json: async () => {
      tracker.reads += 1;
      return body;
    },
  } as unknown as Request;
}

function createPrivilegedClientMock(args?: {
  rpcError?: { message: string };
  rpcData?: unknown;
  pendingRpcError?: { message: string };
  candidateRpcError?: { message: string } | null;
  candidateRpcData?: unknown;
}) {
  const rpcCalls: RpcCall[] = [];
  const candidateRpcCalls: RpcCall[] = [];
  const secretRpcCalls: RpcCall[] = [];

  return {
    rpcCalls,
    candidateRpcCalls,
      secretRpcCalls,
    client: {
      async rpc(name: string, rpcArgs: Record<string, unknown>) {
        if (name === "materialize_whatsapp_binding_candidate_by_system") {
          candidateRpcCalls.push({ name, args: { ...rpcArgs } });
          return {
            data: args?.candidateRpcData ?? null,
            error:
              args?.candidateRpcError === null
                ? null
                : args?.candidateRpcError ?? {
                    message: "ZION_WHATSAPP_CHANGE_REQUIRES_ACTIVE_BINDING",
                  },
          };
        }

        if (name === "create_whatsapp_phone_security_secret_pending_by_system") {
          secretRpcCalls.push({ name, args: { ...rpcArgs } });
          return {
            data: [{ secret_id: "secret-1", status: "pending", outcome: "created" }],
            error: args?.pendingRpcError ?? null,
          };
        }

        if (name === "invalidate_whatsapp_phone_security_secret_by_system") {
          secretRpcCalls.push({ name, args: { ...rpcArgs } });
          return {
            data: [{ secret_id: "secret-1", status: "invalidated", outcome: "invalidated" }],
            error: null,
          };
        }

        if (name === "activate_whatsapp_phone_security_secret_by_system") {
          secretRpcCalls.push({ name, args: { ...rpcArgs } });
          return {
            data: [{ secret_id: "secret-1", status: "active", outcome: "activated" }],
            error: null,
          };
        }

        rpcCalls.push({ name, args: { ...rpcArgs } });

        return {
          data:
            args?.rpcData ?? [
              {
                integration_id: "integration-1",
                outcome: "inserted",
                provider: "whatsapp",
                status: "active",
                is_active: true,
                phone_number_id: String(rpcArgs.p_phone_number_id || ""),
                whatsapp_business_account_id: String(
                  rpcArgs.p_whatsapp_business_account_id || "",
                ),
                display_phone_number: String(rpcArgs.p_display_phone_number || ""),
              },
            ],
          error: args?.rpcError ?? null,
        };
      },
    },
  };
}

function createSuccessfulValidation(
  overrides?: Partial<MetaWhatsappEmbeddedSignupValidationResult>,
): MetaWhatsappEmbeddedSignupValidationResult {
  return {
    accessToken: "fake-business-token",
    whatsappBusinessAccountId: "meta-waba",
    phoneNumberId: "meta-phone",
    displayPhoneNumber: "+55 11 90000-0000",
    graphApiVersion: "v99.0",
    appId: "fake-app-id",
    validatedAt: "2026-09-25T12:00:00.000Z",
    connectionMode: "standard",
    ...overrides,
  };
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function assertNoSecretLeak(body: unknown, secrets: string[]) {
  const serialized = JSON.stringify(body);
  for (const secret of secrets) {
    assert.equal(
      serialized.includes(secret),
      false,
      `response leaked secret marker ${secret}`,
    );
  }
}

function createRouteHandler(args?: {
  access?: StoreApiAccessGranted | StoreApiAccessDenied;
  validate?: () => Promise<ReturnType<typeof createSuccessfulValidation>>;
  rpcError?: { message: string };
  rpcData?: unknown;
  pendingRpcError?: { message: string };
  candidateRpcError?: { message: string } | null;
  candidateRpcData?: unknown;
  events?: string[];
  register?: (validated: ReturnType<typeof createSuccessfulValidation>, pin: string) => Promise<void>;
  readActiveBinding?: () => Promise<{ ok: true; hasActiveBinding: boolean }>;
}) {
  const rpc = createPrivilegedClientMock({
    rpcError: args?.rpcError,
    rpcData: args?.rpcData,
    pendingRpcError: args?.pendingRpcError,
    candidateRpcError: args?.candidateRpcError,
    candidateRpcData: args?.candidateRpcData,
  });

  const handler = createStoreWhatsappEmbeddedSignupPostHandler({
    resolveAccess: async () => args?.access ?? createGrantedAccess(),
    validateEmbeddedSignup: async (input) => {
      args?.events?.push("validate");
      if (args?.validate) {
        return args.validate();
      }

      assert.equal(input.code, "auth-code");
      assert.equal(input.whatsappBusinessAccountId, "claimed-waba");
      assert.equal(input.phoneNumberId, "claimed-phone");
      return createSuccessfulValidation();
    },
    createPrivilegedClient: () => {
      args?.events?.push("rpc-client");
      return rpc.client as never;
    },
    registerEmbeddedSignup: async (validated, pin) => {
      if (args?.register) {
        await args.register(validated, pin);
      }
    },
    readActiveBinding: args?.readActiveBinding,
  });

  return {
    handler,
    rpcCalls: rpc.rpcCalls,
    candidateRpcCalls: rpc.candidateRpcCalls,
    secretRpcCalls: rpc.secretRpcCalls,
  };
}

const tests: TestCase[] = [
  {
    name: "unauthorized store access returns denied response without reading JSON",
    run: async () => {
      const tracker = { reads: 0 };
      const { handler, rpcCalls } = createRouteHandler({
        access: createDeniedAccess(401, "anonymous", "anonymous"),
      });

      const response = await handler(
        createTrackedRequest({ code: "should-not-read" }, tracker),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 401);
      assert.equal(body.error, "STORE_API_UNAUTHENTICATED");
      assert.equal(tracker.reads, 0);
      assert.equal(rpcCalls.length, 0);
    },
  },
  {
    name: "invalid JSON fails closed",
    run: async () => {
      const { handler, rpcCalls } = createRouteHandler();

      const response = await handler(createInvalidJsonRequest());
      const body = await parseBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.error, "INVALID_JSON");
      assert.equal(rpcCalls.length, 0);
    },
  },
  {
    name: "missing code returns 400 without Meta validation",
    run: async () => {
      let validationCalls = 0;
      const { handler, rpcCalls } = createRouteHandler({
        validate: async () => {
          validationCalls += 1;
          return createSuccessfulValidation();
        },
      });

      const response = await handler(
        createJsonRequest({
          whatsappBusinessAccountId: "waba",
          phoneNumberId: "phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.error, "MISSING_CODE");
      assert.equal(validationCalls, 0);
      assert.equal(rpcCalls.length, 0);
    },
  },
  {
    name: "missing WABA returns 400",
    run: async () => {
      const { handler } = createRouteHandler();

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          phoneNumberId: "phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.error, "MISSING_WHATSAPP_BUSINESS_ACCOUNT_ID");
    },
  },
  {
    name: "missing phone returns 400",
    run: async () => {
      const { handler } = createRouteHandler();

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "waba",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.error, "MISSING_PHONE_NUMBER_ID");
    },
  },
  {
    name: "client supplied PIN is rejected before Meta validation",
    run: async () => {
      let validationCalls = 0;
      const { handler, rpcCalls } = createRouteHandler({
        validate: async () => {
          validationCalls += 1;
          return createSuccessfulValidation();
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
          twoStepPin: "123456",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.error, "CLIENT_TWO_STEP_PIN_FORBIDDEN");
      assert.equal(validationCalls, 0);
      assert.equal(rpcCalls.length, 0);
    },
  },
  {
    name: "object values in code WABA or phone return 400",
    run: async () => {
      for (const payload of [
        {
          code: { value: "auth-code" },
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        },
        {
          code: "auth-code",
          whatsappBusinessAccountId: { value: "claimed-waba" },
          phoneNumberId: "claimed-phone",
        },
        {
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: { value: "claimed-phone" },
        },
      ]) {
        const { handler, rpcCalls } = createRouteHandler();

        const response = await handler(createJsonRequest(payload));

        assert.equal(response.status, 400);
        assert.equal(rpcCalls.length, 0);
      }
    },
  },
  {
    name: "oversized payload fails closed before Meta validation",
    run: async () => {
      let validationCalls = 0;
      const { handler, rpcCalls } = createRouteHandler({
        validate: async () => {
          validationCalls += 1;
          return createSuccessfulValidation();
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
          extra: "x".repeat(9 * 1024),
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 413);
      assert.equal(body.error, "PAYLOAD_TOO_LARGE");
      assert.equal(validationCalls, 0);
      assert.equal(rpcCalls.length, 0);
    },
  },
  {
    name: "Meta code exchange failure maps to safe 400 without echoing code",
    run: async () => {
      const secretCode = "secret-auth-code";
      const { handler, rpcCalls } = createRouteHandler({
        validate: async () => {
          throw new MetaWhatsappEmbeddedSignupError(
            "META_CODE_EXCHANGE_FAILED",
            "Nao foi possivel trocar o codigo de autorizacao da Meta.",
            400,
          );
        },
      });

      const response = await handler(
        createJsonRequest({
          code: secretCode,
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.error, "META_CODE_EXCHANGE_FAILED");
      assertNoSecretLeak(body, [secretCode]);
      assert.equal(rpcCalls.length, 0);
    },
  },
  {
    name: "success never returns token, app secret, or authorization code",
    run: async () => {
      const code = "secret-auth-code";
      const token = "secret-business-token";
      const appSecret = "secret-app-secret";
      const { handler } = createRouteHandler({
        validate: async () =>
          createSuccessfulValidation({
            accessToken: token,
            appId: "fake-app-id",
          }),
      });

      const response = await handler(
        createJsonRequest({
          code,
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
          appSecret,
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assertNoSecretLeak(body, [token, appSecret, code]);
    },
  },
  {
    name: "ambiguous Meta evidence remains unknown and never reaches the client",
    run: async () => {
      const { handler } = createRouteHandler({
        validate: async () =>
          new Promise<never>((_, reject) => {
            reject(
              new MetaWhatsappEmbeddedSignupError(
                "META_PHONE_REGISTER_FAILED",
                "already in use by provider cloud api",
                422,
                {
                  httpStatus: 400,
                  metaCode: "190",
                  metaSubcode: "123456",
                  metaType: "OAuthException",
                  operation: "register_phone_number",
                },
              ),
            );
          }),
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(body.connectionScenario, "unknown_meta_state");
      assert.equal(body.message.includes("already in use"), false);
      assert.equal(body.metaCode, undefined);
      assert.equal(body.metaSubcode, undefined);
      assert.equal(body.metaType, undefined);
      assert.equal(body.metaErrorEvidence, undefined);
    },
  },
  {
    name: "phone validation failure does not call writer",
    run: async () => {
      const { handler, rpcCalls } = createRouteHandler({
        validate: async () => {
          throw new MetaWhatsappEmbeddedSignupError(
            "META_PHONE_VALIDATION_FAILED",
            "Nao foi possivel validar o telefone WhatsApp na Meta.",
            422,
          );
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 422);
      assert.equal(body.error, "META_PHONE_VALIDATION_FAILED");
      assert.equal(rpcCalls.length, 0);
    },
  },
  {
    name: "WABA validation failure does not call writer",
    run: async () => {
      const { handler, rpcCalls } = createRouteHandler({
        validate: async () => {
          throw new MetaWhatsappEmbeddedSignupError(
            "META_WABA_VALIDATION_FAILED",
            "Nao foi possivel validar a conta WhatsApp Business na Meta.",
            422,
          );
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 422);
      assert.equal(body.error, "META_WABA_VALIDATION_FAILED");
      assert.equal(rpcCalls.length, 0);
    },
  },
  {
    name: "phone not belonging to WABA fails closed",
    run: async () => {
      const { handler, rpcCalls } = createRouteHandler({
        validate: async () => {
          throw new MetaWhatsappEmbeddedSignupError(
            "META_PHONE_WABA_MISMATCH",
            "O telefone validado nao pertence a conta WhatsApp Business informada.",
            422,
          );
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 422);
      assert.equal(body.error, "META_PHONE_WABA_MISMATCH");
      assert.equal(rpcCalls.length, 0);
    },
  },
  {
    name: "subscribed_apps failure does not call writer",
    run: async () => {
      const { handler, rpcCalls } = createRouteHandler({
        validate: async () => {
          throw new MetaWhatsappEmbeddedSignupError(
            "META_SUBSCRIBED_APPS_FAILED",
            "Nao foi possivel ativar os webhooks da Meta. Reinicie o Embedded Signup.",
            422,
          );
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 422);
      assert.equal(body.error, "META_SUBSCRIBED_APPS_FAILED");
      assertNoSecretLeak(body, ["auth-code", "123456", "fake-business-token"]);
      assert.equal(rpcCalls.length, 0);
    },
  },
  {
    name: "register failure does not call writer",
    run: async () => {
      const { handler, rpcCalls } = createRouteHandler({
        validate: async () => {
          throw new MetaWhatsappEmbeddedSignupError(
            "META_PHONE_REGISTER_FAILED",
            "Nao foi possivel registrar o telefone na Meta. Reinicie o Embedded Signup.",
            422,
          );
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 422);
      assert.equal(body.error, "META_PHONE_REGISTER_FAILED");
      assertNoSecretLeak(body, ["auth-code", "123456", "fake-business-token"]);
      assert.equal(rpcCalls.length, 0);
    },
  },
  {
    name: "client display phone is ignored and Meta display is persisted",
    run: async () => {
      const { handler, rpcCalls } = createRouteHandler({
        validate: async () =>
          createSuccessfulValidation({
            displayPhoneNumber: "+55 11 91111-2222",
          }),
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
          displayPhoneNumber: "+55 11 90000-0000",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(rpcCalls[0]?.args.p_display_phone_number, "+55 11 91111-2222");
      assert.equal(
        (body.integration as Record<string, unknown>).displayPhoneNumber,
        "+55 11 91111-2222",
      );
    },
  },
  {
    name: "writer is called only after complete Meta validation",
    run: async () => {
      const events: string[] = [];
      const { handler } = createRouteHandler({
        events,
        validate: async () => {
          events.push("exchange");
          events.push("waba");
          events.push("phone_numbers");
          events.push("subscribed_apps");
          events.push("register");
          return createSuccessfulValidation();
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );

      assert.equal(response.status, 200);
      assert.deepEqual(events, [
        "rpc-client",
        "validate",
        "exchange",
        "waba",
        "phone_numbers",
        "subscribed_apps",
        "register",
      ]);
    },
  },
  {
    name: "writer receives tenant and store from session, not payload",
    run: async () => {
      const { handler, rpcCalls } = createRouteHandler({
        access: createGrantedAccess({
          organizationId: "session-org",
          storeId: "session-store",
        }),
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
          organizationId: "payload-org",
          storeId: "payload-store",
          accessToken: "payload-token",
          provider: "whatsapp",
          status: "active",
          isActive: true,
        }),
      );

      assert.equal(response.status, 200);
      assert.equal(rpcCalls[0]?.args.p_organization_id, "session-org");
      assert.equal(rpcCalls[0]?.args.p_store_id, "session-store");
      assert.equal(rpcCalls[0]?.args.p_access_token, "fake-business-token");
      const writerArgs = rpcCalls[0]?.args ?? {};
      assert.equal("twoStepPin" in writerArgs, false);
      assert.equal("p_two_step_pin" in writerArgs, false);
    },
  },
  {
    name: "writer conflict returns safe 409",
    run: async () => {
      const { handler } = createRouteHandler({
        rpcError: {
          message: "ZION_WHATSAPP_EMBEDDED_SIGNUP_PHONE_ALREADY_BOUND",
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "WHATSAPP_EMBEDDED_SIGNUP_CONFLICT");
    },
  },
  {
    name: "success returns outcome and integration without secrets",
    run: async () => {
      const { handler } = createRouteHandler();

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );
      const body = await parseBody(response);
      const integration = body.integration as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.outcome, "inserted");
      assert.equal(integration.id, "integration-1");
      assert.equal(integration.provider, "whatsapp");
      assert.equal(integration.status, "active");
      assert.equal(integration.isActive, true);
      assert.equal(integration.phoneNumberId, "meta-phone");
      assert.equal(integration.whatsappBusinessAccountId, "meta-waba");
      assertNoSecretLeak(body, ["fake-business-token", "123456"]);
    },
  },
  {
    name: "first connection generates a server PIN, persists pending before register, then activates after materialization",
    run: async () => {
      let registeredPin = "";
      const { handler, secretRpcCalls } = createRouteHandler({
        register: async (_validated, pin) => {
          registeredPin = pin;
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.match(registeredPin, /^\d{6}$/);
      assert.deepEqual(
        secretRpcCalls.map((call) => call.name),
        [
          "create_whatsapp_phone_security_secret_pending_by_system",
          "activate_whatsapp_phone_security_secret_by_system",
        ],
      );
      assert.equal(secretRpcCalls[0]?.args.p_key_version, 1);
      assert.notEqual(secretRpcCalls[0]?.args.p_ciphertext, registeredPin);
      assertNoSecretLeak(body, [registeredPin]);
    },
  },
  {
    name: "pending persistence failure blocks Meta register",
    run: async () => {
      let registerCalls = 0;
      const { handler, rpcCalls, secretRpcCalls } = createRouteHandler({
        pendingRpcError: { message: "PENDING_WRITE_FAILED" },
        register: async () => {
          registerCalls += 1;
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );

      assert.equal(response.status, 500);
      assert.equal(registerCalls, 0);
      assert.equal(rpcCalls.length, 0);
      assert.equal(secretRpcCalls.length, 1);
    },
  },
  {
    name: "Meta register failure invalidates the pending secret",
    run: async () => {
      const { handler, rpcCalls, secretRpcCalls } = createRouteHandler({
        register: async () => {
          throw new MetaWhatsappEmbeddedSignupError(
            "META_PHONE_REGISTER_FAILED",
            "Nao foi possivel registrar o telefone na Meta.",
            422,
          );
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 422);
      assert.equal(body.error, "META_PHONE_REGISTER_FAILED");
      assert.equal(rpcCalls.length, 0);
      assert.deepEqual(secretRpcCalls.map((call) => call.name), [
        "create_whatsapp_phone_security_secret_pending_by_system",
        "invalidate_whatsapp_phone_security_secret_by_system",
      ]);
    },
  },
  {
    name: "post-register materialization failure does not activate the pending secret",
    run: async () => {
      const { handler, rpcCalls, secretRpcCalls } = createRouteHandler({
        rpcError: { message: "MATERIALIZATION_FAILED" },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );

      assert.equal(response.status, 500);
      assert.equal(rpcCalls.length, 1);
      assert.deepEqual(secretRpcCalls.map((call) => call.name), [
        "create_whatsapp_phone_security_secret_pending_by_system",
      ]);
    },
  },
  {
    name: "existing candidate path does not generate or persist a first-connection PIN",
    run: async () => {
      let registerCalls = 0;
      const { handler, secretRpcCalls } = createRouteHandler({
        candidateRpcError: null,
        candidateRpcData: [
          {
            request_id: "change-request-1",
            outcome: "candidate_materialized",
            status: "candidate_received",
            active_integration_id: "active-1",
            candidate_phone_number_id: "claimed-phone",
            candidate_whatsapp_business_account_id: "claimed-waba",
            candidate_display_phone_number: "+55 11 90000-0000",
          },
        ],
        register: async () => {
          registerCalls += 1;
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );

      assert.equal(response.status, 200);
      assert.equal(registerCalls, 0);
      assert.equal(secretRpcCalls.length, 0);
    },
  },
  {
    name: "helper validates phone through WABA phone_numbers and activates Meta before returning",
    run: async () => {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      const fetchMock: typeof fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });

        if (String(url).includes("/oauth/access_token")) {
          return Response.json({ access_token: "fake-business-token" });
        }

        if (String(url).includes("/meta-waba/phone_numbers")) {
          return Response.json({
            data: [
              {
                id: "meta-phone",
                display_phone_number: "+55 11 92222-3333",
              },
            ],
          });
        }

        if (String(url).includes("/meta-waba/subscribed_apps")) {
          return Response.json({ success: true });
        }

        if (String(url).includes("/meta-phone/register")) {
          return Response.json({ success: true });
        }

        if (String(url).endsWith("/meta-waba?fields=id")) {
          return Response.json({ id: "meta-waba" });
        }

        throw new Error(`unexpected fetch ${String(url)}`);
      };

      const result = await exchangeAndValidateMetaWhatsappEmbeddedSignup(
        {
          code: "secret-auth-code",
          whatsappBusinessAccountId: "meta-waba",
          phoneNumberId: "meta-phone",
          twoStepPin: "123456",
        },
        {
          config: {
            graphApiVersion: "v99.0",
            appId: "fake-app-id",
            appSecret: "secret-app-secret",
          },
          deps: {
            fetch: fetchMock,
            now: () => new Date("2026-09-25T12:00:00.000Z"),
          },
        },
      );

      assert.equal(result.displayPhoneNumber, "+55 11 92222-3333");
      assert.equal(result.phoneNumberId, "meta-phone");
      assert.equal(calls.length, 5);
      assert.equal(calls[0]?.url.includes("secret-auth-code"), false);
      assert.equal(calls[0]?.url.includes("secret-app-secret"), false);
      assert.equal(calls[0]?.url.includes("/oauth/access_token"), true);
      assert.equal(calls[1]?.url.endsWith("/meta-waba?fields=id"), true);
      assert.equal(calls[2]?.url.includes("/meta-waba/phone_numbers"), true);
      assert.equal(calls[2]?.url.includes("fields=id%2Cdisplay_phone_number"), true);
      assert.equal(calls[3]?.url.includes("/meta-waba/subscribed_apps"), true);
      assert.equal(calls[4]?.url.includes("/meta-phone/register"), true);
      assert.equal(
        (calls[1]?.init.headers as Record<string, string>).Authorization,
        "Bearer fake-business-token",
      );
      assert.equal(
        (calls[2]?.init.headers as Record<string, string>).Authorization,
        "Bearer fake-business-token",
      );
      assert.equal(
        (calls[3]?.init.headers as Record<string, string>).Authorization,
        "Bearer fake-business-token",
      );
      assert.equal(
        (calls[4]?.init.headers as Record<string, string>).Authorization,
        "Bearer fake-business-token",
      );
      assert.deepEqual(JSON.parse(String(calls[4]?.init.body)), {
        messaging_product: "whatsapp",
        pin: "123456",
      });
    },
  },
  {
    name: "helper does not retry authorization code exchange",
    run: async () => {
      let fetchCalls = 0;
      const fetchMock: typeof fetch = async () => {
        fetchCalls += 1;
        return Response.json({ error: { message: "invalid code" } }, { status: 400 });
      };

      await assert.rejects(
        () =>
          exchangeAndValidateMetaWhatsappEmbeddedSignup(
            {
              code: "secret-single-use-code",
              whatsappBusinessAccountId: "meta-waba",
              phoneNumberId: "meta-phone",
              twoStepPin: "123456",
            },
            {
              config: {
                graphApiVersion: "v99.0",
                appId: "fake-app-id",
                appSecret: "secret-app-secret",
              },
              deps: {
                fetch: fetchMock,
              },
            },
          ),
        (error: unknown) =>
          error instanceof MetaWhatsappEmbeddedSignupError &&
          error.code === "META_CODE_EXCHANGE_FAILED",
      );

      assert.equal(fetchCalls, 1);
    },
  },
  {
    name: "helper uses display from WABA phone_numbers list",
    run: async () => {
      const calls: string[] = [];
      const fetchMock: typeof fetch = async (url) => {
        calls.push(String(url));

        if (String(url).includes("/oauth/access_token")) {
          return Response.json({ access_token: "fake-business-token" });
        }

        if (String(url).endsWith("/meta-waba?fields=id")) {
          return Response.json({ id: "meta-waba" });
        }

        if (String(url).includes("/meta-waba/phone_numbers")) {
          return Response.json({
            data: [
              {
                id: "meta-phone",
                display_phone_number: "+55 11 94444-5555",
              },
            ],
          });
        }

        if (String(url).includes("/meta-waba/subscribed_apps")) {
          return Response.json({ success: true });
        }

        if (String(url).includes("/meta-phone/register")) {
          return Response.json({ success: true });
        }

        throw new Error(`unexpected fetch ${String(url)}`);
      };

      const result = await exchangeAndValidateMetaWhatsappEmbeddedSignup(
        {
          code: "auth-code",
          whatsappBusinessAccountId: "meta-waba",
          phoneNumberId: "meta-phone",
          twoStepPin: "123456",
        },
        {
          config: {
            graphApiVersion: "v99.0",
            appId: "fake-app-id",
            appSecret: "secret-app-secret",
          },
          deps: {
            fetch: fetchMock,
          },
        },
      );

      assert.equal(result.displayPhoneNumber, "+55 11 94444-5555");
      assert.equal(calls.some((url) => url.includes("/phone_numbers")), true);
      assert.equal(calls.some((url) => url.includes("/meta-phone?")), false);
    },
  },
  {
    name: "helper rejects phone list mismatch",
    run: async () => {
      const fetchMock: typeof fetch = async (url) => {
        if (String(url).includes("/oauth/access_token")) {
          return Response.json({ access_token: "fake-business-token" });
        }

        if (String(url).includes("/meta-waba/phone_numbers")) {
          return Response.json({ data: [{ id: "other-phone" }] });
        }

        if (String(url).includes("/meta-waba")) {
          return Response.json({ id: "meta-waba" });
        }

        return Response.json({ id: "meta-phone" });
      };

      await assert.rejects(
        () =>
          exchangeAndValidateMetaWhatsappEmbeddedSignup(
            {
              code: "auth-code",
              whatsappBusinessAccountId: "meta-waba",
              phoneNumberId: "meta-phone",
              twoStepPin: "123456",
            },
            {
              config: {
                graphApiVersion: "v99.0",
                appId: "fake-app-id",
                appSecret: "secret-app-secret",
              },
              deps: {
                fetch: fetchMock,
              },
            },
          ),
        (error: unknown) =>
          error instanceof MetaWhatsappEmbeddedSignupError &&
          error.code === "META_PHONE_WABA_MISMATCH",
      );
    },
  },
  {
    name: "helper fails closed when WHATSAPP_GRAPH_API_VERSION is absent",
    run: async () => {
      let fetchCalls = 0;
      const fetchMock: typeof fetch = async () => {
        fetchCalls += 1;
        return Response.json({});
      };

      await assert.rejects(
        () =>
          exchangeAndValidateMetaWhatsappEmbeddedSignup(
            {
              code: "auth-code",
              whatsappBusinessAccountId: "meta-waba",
              phoneNumberId: "meta-phone",
              twoStepPin: "123456",
            },
            {
              config: {
                graphApiVersion: "",
                appId: "fake-app-id",
                appSecret: "secret-app-secret",
              },
              deps: {
                fetch: fetchMock,
              },
            },
          ),
        (error: unknown) =>
          error instanceof MetaWhatsappEmbeddedSignupError &&
          error.code === "WHATSAPP_GRAPH_API_VERSION_NOT_CONFIGURED",
      );

      assert.equal(fetchCalls, 0);
    },
  },
  {
    name: "active Zion binding blocks a second onboarding connection before Meta",
    run: async () => {
      let validationCalls = 0;
      const { handler, candidateRpcCalls } = createRouteHandler({
        readActiveBinding: async () => ({ ok: true, hasActiveBinding: true }),
        validate: async () => {
          validationCalls += 1;
          return createSuccessfulValidation();
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.connectionScenario, "existing_zion_binding");
      assert.equal(validationCalls, 0);
      assert.equal(candidateRpcCalls.length, 0);
    },
  },
  {
    name: "existing active binding materializes a non-active candidate without secrets",
    run: async () => {
      const { handler, candidateRpcCalls, rpcCalls } = createRouteHandler({
        candidateRpcError: null,
        candidateRpcData: [
          {
            request_id: "change-request-1",
            outcome: "candidate_materialized",
            status: "candidate_received",
            active_integration_id: "active-1471",
            candidate_phone_number_id: "phone-0018",
            candidate_whatsapp_business_account_id: "waba-0018",
            candidate_display_phone_number: "+55 11 90000-0018",
          },
        ],
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
          changeRequestIdempotencyKey: "change-0018",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(candidateRpcCalls.length, 1);
      assert.equal(rpcCalls.length, 0);
      assert.equal(candidateRpcCalls[0]?.args.p_idempotency_key, "change-0018");
      assert.equal(candidateRpcCalls[0]?.args.p_access_token, undefined);
      assert.deepEqual(body.changeRequest, {
        id: "change-request-1",
        status: "candidate_received",
        activeIntegrationId: "active-1471",
      });
      assert.deepEqual(body.candidate, {
        phoneNumberId: "phone-0018",
        whatsappBusinessAccountId: "waba-0018",
        displayPhoneNumber: "+55 11 90000-0018",
        isActive: false,
      });
      assertNoSecretLeak(body, ["auth-code", "123456", "fake-business-token"]);
    },
  },
  {
    name: "first connection falls back to the existing active writer",
    run: async () => {
      const { handler, candidateRpcCalls, rpcCalls } = createRouteHandler();

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );

      assert.equal(response.status, 200);
      assert.equal(candidateRpcCalls.length, 1);
      assert.equal(rpcCalls.length, 1);
      assert.equal(rpcCalls[0]?.name, "materialize_store_whatsapp_embedded_signup_by_system");
    },
  },
  {
    name: "conflicting candidate is returned as a safe conflict without active writer",
    run: async () => {
      const { handler, candidateRpcCalls, rpcCalls } = createRouteHandler({
        candidateRpcError: {
          message: "ZION_WHATSAPP_CHANGE_CANDIDATE_CONFLICT",
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "WHATSAPP_EMBEDDED_SIGNUP_CONFLICT");
      assert.equal(candidateRpcCalls.length, 1);
      assert.equal(rpcCalls.length, 0);
    },
  },
  {
    name: "coexistence materializes without standard registration or PIN secret",
    run: async () => {
      let registrationBoundaryCalls = 0;
      const { handler, rpcCalls, secretRpcCalls } = createRouteHandler({
        validate: async () =>
          createSuccessfulValidation({
            connectionMode: "business_app_coexistence",
            phoneNumberId: "coexistence-phone",
          }),
        register: async () => {
          registrationBoundaryCalls += 1;
        },
      });

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          connectionMode: "business_app_coexistence",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.connectionMode, "business_app_coexistence");
      assert.equal(body.connectionScenario, "business_app_meta_flow");
      assert.equal(registrationBoundaryCalls, 1);
      assert.equal(secretRpcCalls.length, 0);
      assert.equal(rpcCalls.some((call) => call.name === "materialize_store_whatsapp_embedded_signup_by_system"), true);
    },
  },
  {
    name: "source uses canonical store access, canonical writer RPC, and no real secrets",
    run: () => {
      const routeSource = readFileSync(join(__dirname, "route.ts"), "utf8");
      const helperSource = readFileSync(
        join(process.cwd(), "src/lib/server/meta-whatsapp-embedded-signup.ts"),
        "utf8",
      );

      assert.equal(routeSource.includes("resolveStoreApiAccess"), true);
      assert.equal(routeSource.includes('requirement: "active_or_onboarding"'), true);
      assert.equal(
        routeSource.includes("materialize_store_whatsapp_embedded_signup_by_system"),
        true,
      );
      assert.equal(routeSource.includes("body.storeId"), false);
      assert.equal(routeSource.includes("body.organizationId"), false);
      assert.equal(routeSource.includes("body.displayPhoneNumber"), false);
      assert.equal(helperSource.includes("META_APP_ID"), true);
      assert.equal(helperSource.includes("META_APP_SECRET"), true);
      assert.equal(helperSource.includes("WHATSAPP_GRAPH_API_VERSION"), true);
      assert.equal(helperSource.includes("DEFAULT_GRAPH_API_VERSION"), false);
      assert.equal(helperSource.includes("v23.0"), false);
      assert.equal(helperSource.includes("whatsapp_business_account"), false);
      assert.equal(helperSource.includes("subscribed_apps"), true);
      assert.equal(helperSource.includes("/register"), true);
      assert.equal(routeSource.includes("META_WHATSAPP_ACCESS_TOKEN"), false);
      assert.equal(helperSource.includes("META_WHATSAPP_ACCESS_TOKEN"), false);
      assert.equal(routeSource.includes("1454892709860372"), false);
      assert.equal(helperSource.includes("1454892709860372"), false);
      assert.equal(routeSource.includes("Voce pode continuar usando o mesmo numero"), true);
      assert.equal(routeSource.includes("metaErrorEvidence"), true);
      assert.equal(routeSource.includes("metaSubcode"), true);
      assert.equal(routeSource.includes("metaType"), true);
      assert.equal(routeSource.includes("raw-meta-message"), false);
    },
  },
  {
    name: "module exports the handler factory result",
    run: () => {
      assert.equal(typeof POST, "function");
    },
  },
];

async function run() {
  const failures: string[] = [];

  for (const test of tests) {
    try {
      await test.run();
      process.stdout.write(`ok - ${test.name}\n`);
    } catch (error) {
      failures.push(
        `not ok - ${test.name}\n${
          error instanceof Error ? error.stack || error.message : String(error)
        }`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exit(1);
  }

  process.stdout.write(`1..${tests.length}\n`);
}

void run();

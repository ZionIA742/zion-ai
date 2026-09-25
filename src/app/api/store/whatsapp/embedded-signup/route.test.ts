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
} from "@/lib/server/meta-whatsapp-embedded-signup";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

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
}) {
  const rpcCalls: RpcCall[] = [];

  return {
    rpcCalls,
    client: {
      async rpc(name: string, rpcArgs: Record<string, unknown>) {
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

function createSuccessfulValidation(overrides?: Record<string, unknown>) {
  return {
    accessToken: "fake-business-token",
    whatsappBusinessAccountId: "meta-waba",
    phoneNumberId: "meta-phone",
    displayPhoneNumber: "+55 11 90000-0000",
    graphApiVersion: "v99.0",
    appId: "fake-app-id",
    validatedAt: "2026-09-25T12:00:00.000Z",
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
  events?: string[];
}) {
  const rpc = createPrivilegedClientMock({
    rpcError: args?.rpcError,
    rpcData: args?.rpcData,
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
      assert.equal(input.twoStepPin, "123456");
      return createSuccessfulValidation();
    },
    createPrivilegedClient: () => {
      args?.events?.push("rpc-client");
      return rpc.client as never;
    },
  });

  return { handler, rpcCalls: rpc.rpcCalls };
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
          twoStepPin: "123456",
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
          twoStepPin: "123456",
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
          twoStepPin: "123456",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.error, "MISSING_PHONE_NUMBER_ID");
    },
  },
  {
    name: "missing PIN returns 400",
    run: async () => {
      const { handler, rpcCalls } = createRouteHandler();

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.error, "INVALID_TWO_STEP_PIN");
      assert.equal(rpcCalls.length, 0);
    },
  },
  {
    name: "non-string PIN returns 400",
    run: async () => {
      const { handler, rpcCalls } = createRouteHandler();

      const response = await handler(
        createJsonRequest({
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: "claimed-phone",
          twoStepPin: 123456,
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.error, "INVALID_TWO_STEP_PIN");
      assert.equal(rpcCalls.length, 0);
    },
  },
  {
    name: "PIN must be exactly six numeric characters",
    run: async () => {
      for (const twoStepPin of ["12345", "1234567", "12345a"]) {
        const { handler, rpcCalls } = createRouteHandler();

        const response = await handler(
          createJsonRequest({
            code: "auth-code",
            whatsappBusinessAccountId: "claimed-waba",
            phoneNumberId: "claimed-phone",
            twoStepPin,
          }),
        );
        const body = await parseBody(response);

        assert.equal(response.status, 400);
        assert.equal(body.error, "INVALID_TWO_STEP_PIN");
        assert.equal(rpcCalls.length, 0);
      }
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
          twoStepPin: "123456",
        },
        {
          code: "auth-code",
          whatsappBusinessAccountId: { value: "claimed-waba" },
          phoneNumberId: "claimed-phone",
          twoStepPin: "123456",
        },
        {
          code: "auth-code",
          whatsappBusinessAccountId: "claimed-waba",
          phoneNumberId: { value: "claimed-phone" },
          twoStepPin: "123456",
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
          twoStepPin: "123456",
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
          twoStepPin: "123456",
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
          twoStepPin: "123456",
          appSecret,
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assertNoSecretLeak(body, [token, appSecret, code]);
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
          twoStepPin: "123456",
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
          twoStepPin: "123456",
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
          twoStepPin: "123456",
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
          twoStepPin: "123456",
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
          twoStepPin: "123456",
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
          twoStepPin: "123456",
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
          twoStepPin: "123456",
        }),
      );

      assert.equal(response.status, 200);
      assert.deepEqual(events, [
        "validate",
        "exchange",
        "waba",
        "phone_numbers",
        "subscribed_apps",
        "register",
        "rpc-client",
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
          twoStepPin: "123456",
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
          twoStepPin: "123456",
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
          twoStepPin: "123456",
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

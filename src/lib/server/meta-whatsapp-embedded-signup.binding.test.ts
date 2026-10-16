import { strict as assert } from "node:assert";
import test from "node:test";
import {
  confirmMetaWhatsappPhoneRegistration,
  exchangeAndValidateMetaWhatsappBinding,
  registerMetaWhatsappEmbeddedSignup,
  MetaWhatsappEmbeddedSignupError,
} from "./meta-whatsapp-embedded-signup";

function depsFor(fetch: typeof globalThis.fetch) {
  return {
    fetch,
    createAbortController: () => new AbortController(),
    now: () => new Date("2026-10-02T12:00:00.000Z"),
    timeoutMs: 1000,
  };
}

test("fresh-token helper exchanges and validates without Embedded Signup side effects", async () => {
  const urls: string[] = [];
  const result = await exchangeAndValidateMetaWhatsappBinding(
    {
      code: "fresh-code-sentinel",
      whatsappBusinessAccountId: "waba-candidate",
      phoneNumberId: "phone-candidate",
    },
    {
      config: {
        graphApiVersion: "v99.0",
        appId: "app-test",
        appSecret: "secret-test",
      },
      deps: depsFor(async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/oauth/access_token")) {
          return Response.json({ access_token: "fresh-token-sentinel" });
        }
        if (url.endsWith("/waba-candidate?fields=id")) {
          return Response.json({ id: "waba-candidate" });
        }
        if (url.includes("/waba-candidate/phone_numbers")) {
          return Response.json({
            data: [{ id: "phone-candidate", display_phone_number: "+5511999999999" }],
          });
        }
        return new Response(JSON.stringify({}), { status: 500 });
      }),
    },
  );

  assert.equal(result.accessToken, "fresh-token-sentinel");
  assert.equal(result.whatsappBusinessAccountId, "waba-candidate");
  assert.equal(result.phoneNumberId, "phone-candidate");
  assert.equal(urls.length, 3);
  assert.equal(urls.some((url) => url.includes("/subscribed_apps")), false);
  assert.equal(urls.some((url) => url.includes("/register")), false);
});

test("fresh-token helper rejects a phone outside the candidate WABA", async () => {
  await assert.rejects(
    exchangeAndValidateMetaWhatsappBinding(
      {
        code: "fresh-code-sentinel",
        whatsappBusinessAccountId: "waba-candidate",
        phoneNumberId: "phone-attacker",
      },
      {
        config: {
          graphApiVersion: "v99.0",
          appId: "app-test",
          appSecret: "secret-test",
        },
        deps: depsFor(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("/oauth/access_token")) {
            return Response.json({ access_token: "fresh-token-sentinel" });
          }
          if (url.endsWith("/waba-candidate?fields=id")) {
            return Response.json({ id: "waba-candidate" });
          }
          return Response.json({ data: [{ id: "phone-candidate", display_phone_number: "+5511999999999" }] });
        }),
      },
    ),
    (error: unknown) =>
      error instanceof MetaWhatsappEmbeddedSignupError &&
      error.code === "META_PHONE_WABA_MISMATCH",
  );
});

function recoveryFetchMock(options?: {
  debug?: Record<string, unknown> | null;
  debugStatus?: number;
  phoneId?: string;
}) {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/oauth/access_token")) {
      return Response.json({ access_token: "recovery-token-sentinel" });
    }
    if (url.includes("/debug_token")) {
      if (options?.debugStatus) {
        return Response.json({ error: { code: 190 } }, { status: options.debugStatus });
      }
      return Response.json({ data: options?.debug ?? {} });
    }
    if (url.endsWith("/waba-recovery?fields=id")) {
      return Response.json({ id: "waba-recovery" });
    }
    if (url.includes("/waba-recovery/phone_numbers")) {
      return Response.json({
        data: [
          {
            id: options?.phoneId ?? "phone-recovery",
            display_phone_number: "+5511999999999",
          },
        ],
      });
    }
    return new Response(JSON.stringify({}), { status: 500 });
  };
}

function recoveryDebugData(overrides: Record<string, unknown> = {}) {
  return {
    is_valid: true,
    app_id: "app-recovery",
    type: "USER",
    expires_at: 0,
    scopes: [
      "whatsapp_business_messaging",
      "whatsapp_business_management",
      "business_management",
    ],
    granular_scopes: [
      {
        scope: "whatsapp_business_management",
        target_ids: ["waba-recovery"],
      },
    ],
    ...overrides,
  };
}

async function exchangeRecoveryToken(fetch: typeof globalThis.fetch) {
  return exchangeAndValidateMetaWhatsappBinding(
    {
      code: "recovery-code",
      whatsappBusinessAccountId: "waba-recovery",
      phoneNumberId: "phone-recovery",
      recovery: true,
    },
    {
      config: {
        graphApiVersion: "v99.0",
        appId: "app-recovery",
        appSecret: "secret-recovery",
      },
      deps: depsFor(fetch),
    },
  );
}

test("recovery diagnostics confirm the app, required scopes, WABA and phone", async () => {
  const urls: string[] = [];
  const result = await exchangeRecoveryToken(
    async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return recoveryFetchMock({ debug: recoveryDebugData() })(input);
    },
  );

  assert.deepEqual(result.oauthDiagnostic, {
    tokenValidity: "valid",
    appIdMatch: "yes",
    tokenType: "USER",
    expiresAt: 0,
    permissions: {
      whatsappBusinessMessaging: "present",
      whatsappBusinessManagement: "present",
      businessManagement: "present",
    },
    wabaAccess: "confirmed",
    phoneRecognized: "confirmed",
    conclusion: "ready_for_further_validation",
  });
  assert.equal(urls.some((url) => url.includes("/register")), false);
  assert.equal(urls.some((url) => url.includes("/subscribed_apps")), false);
});

test("recovery diagnostics classify missing WhatsApp permissions", async () => {
  const result = await exchangeRecoveryToken(
    recoveryFetchMock({
      debug: recoveryDebugData({ scopes: ["business_management"], granular_scopes: [] }),
    }),
  );

  assert.equal(result.oauthDiagnostic?.permissions.whatsappBusinessMessaging, "absent");
  assert.equal(result.oauthDiagnostic?.permissions.whatsappBusinessManagement, "absent");
  assert.equal(result.oauthDiagnostic?.conclusion, "missing_permission");
});

test("recovery diagnostics reject a token issued to another app", async () => {
  const result = await exchangeRecoveryToken(
    recoveryFetchMock({ debug: recoveryDebugData({ app_id: "other-app" }) }),
  );

  assert.equal(result.oauthDiagnostic?.appIdMatch, "no");
  assert.equal(result.oauthDiagnostic?.conclusion, "invalid_token");
});

test("recovery diagnostics classify an invalid or expired token", async () => {
  const result = await exchangeRecoveryToken(
    recoveryFetchMock({ debug: recoveryDebugData({ is_valid: false, expires_at: 1 }) }),
  );

  assert.equal(result.oauthDiagnostic?.tokenValidity, "invalid");
  assert.equal(result.oauthDiagnostic?.conclusion, "invalid_token");
});

test("recovery diagnostics detect a WABA-restricted granular scope", async () => {
  const result = await exchangeRecoveryToken(
    recoveryFetchMock({
      debug: recoveryDebugData({
        granular_scopes: [
          { scope: "whatsapp_business_management", target_ids: ["other-waba"] },
        ],
      }),
    }),
  );

  assert.equal(result.oauthDiagnostic?.permissions.whatsappBusinessManagement, "absent");
  assert.equal(result.oauthDiagnostic?.wabaAccess, "denied");
  assert.equal(result.oauthDiagnostic?.conclusion, "missing_permission");
});

test("recovery diagnostics remain indeterminate when debug_token is unavailable", async () => {
  const result = await exchangeRecoveryToken(
    recoveryFetchMock({ debugStatus: 502 }),
  );

  assert.equal(result.oauthDiagnostic?.conclusion, "indeterminate");
  assert.equal(result.oauthDiagnostic?.wabaAccess, "indeterminate");
  assert.equal(JSON.stringify(result.oauthDiagnostic).includes("recovery-token-sentinel"), false);
});

test("recovery diagnostics fail closed on an incomplete debug_token response", async () => {
  const result = await exchangeRecoveryToken(
    recoveryFetchMock({ debug: { is_valid: true, app_id: "app-recovery" } }),
  );

  assert.equal(result.oauthDiagnostic?.conclusion, "indeterminate");
  assert.equal(result.oauthDiagnostic?.permissions.whatsappBusinessMessaging, "indeterminate");
  assert.equal(result.oauthDiagnostic?.permissions.whatsappBusinessManagement, "indeterminate");
});

test("coexistence discovers the sole WABA phone and skips standard registration", async () => {
  const urls: string[] = [];
  const validated = await exchangeAndValidateMetaWhatsappBinding(
    {
      code: "coexistence-code",
      whatsappBusinessAccountId: "waba-coexistence",
      connectionMode: "business_app_coexistence",
    },
    {
      config: {
        graphApiVersion: "v99.0",
        appId: "app-test",
        appSecret: "secret-test",
      },
      deps: depsFor(async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/oauth/access_token")) {
          return Response.json({ access_token: "coexistence-token" });
        }
        if (url.endsWith("/waba-coexistence?fields=id")) {
          return Response.json({ id: "waba-coexistence" });
        }
        if (url.includes("/waba-coexistence/phone_numbers")) {
          return Response.json({
            data: [{ id: "phone-coexistence", display_phone_number: "+5511888888888" }],
          });
        }
        if (url.includes("/subscribed_apps")) return Response.json({ success: true });
        return new Response(JSON.stringify({}), { status: 500 });
      }),
    },
  );

  assert.equal(validated.connectionMode, "business_app_coexistence");
  assert.equal(validated.phoneNumberId, "phone-coexistence");

  await registerMetaWhatsappEmbeddedSignup(validated, "", {
    deps: depsFor(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/subscribed_apps")) return Response.json({ success: true });
      if (url.includes("/register")) return Response.json({ success: true });
      return new Response(JSON.stringify({}), { status: 500 });
    }),
  });

  assert.equal(urls.some((url) => url.includes("/register")), false);
});

test("Meta error evidence is preserved safely without retaining raw payload", async () => {
  await assert.rejects(
    registerMetaWhatsappEmbeddedSignup(
      {
        accessToken: "token-sentinel",
        whatsappBusinessAccountId: "waba-sentinel",
        phoneNumberId: "phone-sentinel",
        connectionMode: "standard",
        displayPhoneNumber: "+5511999999999",
        graphApiVersion: "v99.0",
        appId: "app-sentinel",
        validatedAt: "2026-10-02T12:00:00.000Z",
      },
      "123456",
      {
        deps: depsFor(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("/subscribed_apps")) {
            return Response.json(
              {
                error: {
                  code: 190,
                  error_subcode: 123456,
                  type: "OAuthException",
                  message: "raw-meta-message-sentinel",
                },
              },
              { status: 400 },
            );
          }
          return Response.json({ success: true });
        }),
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof MetaWhatsappEmbeddedSignupError);
      assert.equal(error.code, "META_SUBSCRIBED_APPS_FAILED");
      assert.deepEqual(error.evidence, {
        httpStatus: 400,
        metaCode: "190",
        metaSubcode: "123456",
        metaType: "OAuthException",
        operation: "subscribe_waba_apps",
        normalizedCode: "META_SUBSCRIBED_APPS_FAILED",
      });
      assert.equal(error.message.includes("raw-meta-message-sentinel"), false);
      return true;
    },
  );
});

test("recovery confirmation requires a verified Cloud API phone and performs no mutation", async () => {
  const urls: string[] = [];
  const methods: string[] = [];
  const state = await confirmMetaWhatsappPhoneRegistration(
    {
      accessToken: "fresh-token-sentinel",
      whatsappBusinessAccountId: "waba-candidate",
      phoneNumberId: "phone-candidate",
      connectionMode: "standard",
      displayPhoneNumber: "+5511999999999",
      graphApiVersion: "v99.0",
      appId: "app-test",
      validatedAt: "2026-10-02T12:00:00.000Z",
    },
    {
      deps: depsFor(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        methods.push(init?.method || "GET");
        return Response.json({
          id: "phone-candidate",
          display_phone_number: "+5511999999999",
          code_verification_status: "VERIFIED",
          platform_type: "CLOUD_API",
        });
      }),
    },
  );

  assert.equal(state.codeVerificationStatus, "VERIFIED");
  assert.equal(state.platformType, "CLOUD_API");
  assert.equal(JSON.stringify(state).includes("fresh-token-sentinel"), false);
  assert.equal(urls.length, 1);
  assert.deepEqual(methods, ["GET"]);
  assert.match(urls[0] || "", /fields=id%2Cdisplay_phone_number%2Ccode_verification_status%2Cplatform_type/);
  assert.equal(urls.some((url) => url.includes("/register")), false);
  assert.equal(urls.some((url) => url.includes("/subscribed_apps")), false);
});

test("recovery confirmation blocks an unconfirmed remote phone", async () => {
  await assert.rejects(
    confirmMetaWhatsappPhoneRegistration(
      {
        accessToken: "fresh-token-sentinel",
        whatsappBusinessAccountId: "waba-candidate",
        phoneNumberId: "phone-candidate",
        connectionMode: "standard",
        displayPhoneNumber: "+5511999999999",
        graphApiVersion: "v99.0",
        appId: "app-test",
        validatedAt: "2026-10-02T12:00:00.000Z",
      },
      {
        deps: depsFor(async () =>
          Response.json({
            id: "phone-candidate",
            display_phone_number: "+5511999999999",
            code_verification_status: "NOT_VERIFIED",
            platform_type: "CLOUD_API",
          }),
        ),
      },
    ),
    (error: unknown) =>
      error instanceof MetaWhatsappEmbeddedSignupError &&
      error.code === "META_PHONE_REGISTRATION_UNCONFIRMED",
  );
});

test("recovery confirmation preserves Meta unavailability as a safe error", async () => {
  await assert.rejects(
    confirmMetaWhatsappPhoneRegistration(
      {
        accessToken: "fresh-token-sentinel",
        whatsappBusinessAccountId: "waba-candidate",
        phoneNumberId: "phone-candidate",
        connectionMode: "standard",
        displayPhoneNumber: "+5511999999999",
        graphApiVersion: "v99.0",
        appId: "app-test",
        validatedAt: "2026-10-02T12:00:00.000Z",
      },
      { deps: depsFor(async () => new Response("unavailable", { status: 503 })) },
    ),
    (error: unknown) =>
      error instanceof MetaWhatsappEmbeddedSignupError &&
      error.code === "META_UNAVAILABLE" &&
      error.httpStatus === 502,
  );
});

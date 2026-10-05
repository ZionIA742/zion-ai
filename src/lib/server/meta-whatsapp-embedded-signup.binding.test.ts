import { strict as assert } from "node:assert";
import test from "node:test";
import {
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

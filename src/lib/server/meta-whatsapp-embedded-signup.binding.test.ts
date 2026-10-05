import { strict as assert } from "node:assert";
import test from "node:test";
import {
  exchangeAndValidateMetaWhatsappBinding,
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

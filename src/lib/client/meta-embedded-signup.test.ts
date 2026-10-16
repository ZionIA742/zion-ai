import { strict as assert } from "node:assert";
import {
  extractMetaEmbeddedSignupSession,
  isAllowedMetaEmbeddedSignupOrigin,
  isMetaEmbeddedSignupCancellation,
} from "./meta-embedded-signup";

const trustedOrigin = "https://www.facebook.com";

const tests = [
  {
    name: "accepts only trusted Meta origins",
    run() {
      assert.equal(isAllowedMetaEmbeddedSignupOrigin(trustedOrigin), true);
      assert.equal(isAllowedMetaEmbeddedSignupOrigin("https://evil.example"), false);
      assert.equal(isAllowedMetaEmbeddedSignupOrigin("http://www.facebook.com"), false);
    },
  },
  {
    name: "extracts a validated standard session from object and JSON messages",
    run() {
      const objectSession = extractMetaEmbeddedSignupSession({
        origin: trustedOrigin,
        data: {
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH",
          data: {
            waba_id: "1642288770859048",
            phone_number_id: "1322472314288518",
          },
        },
      });
      const jsonSession = extractMetaEmbeddedSignupSession({
        origin: trustedOrigin,
        data: JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH",
          data: {
            whatsapp_business_account_id: "1642288770859048",
            phoneNumberId: "1322472314288518",
          },
        }),
      });

      assert.deepEqual(objectSession, {
        whatsappBusinessAccountId: "1642288770859048",
        phoneNumberId: "1322472314288518",
        connectionMode: "standard",
      });
      assert.deepEqual(jsonSession, objectSession);
    },
  },
  {
    name: "rejects invalid context and reports cancellation without exposing payload data",
    run() {
      assert.equal(
        extractMetaEmbeddedSignupSession({
          origin: "https://evil.example",
          data: {
            type: "WA_EMBEDDED_SIGNUP",
            event: "FINISH",
            data: { waba_id: "1642288770859048", phone_number_id: "1322472314288518" },
          },
        }),
        null,
      );
      assert.equal(
        extractMetaEmbeddedSignupSession({
          origin: trustedOrigin,
          data: { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "bad" } },
        }),
        null,
      );
      assert.equal(
        isMetaEmbeddedSignupCancellation({
          origin: trustedOrigin,
          data: { type: "WA_EMBEDDED_SIGNUP", event: "CANCELLED", secret: "must-not-be-read" },
        }),
        true,
      );
    },
  },
];

for (const test of tests) test.run();
console.log(`meta-embedded-signup: ${tests.length} tests passed`);

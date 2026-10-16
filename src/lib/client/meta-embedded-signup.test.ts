import { strict as assert } from "node:assert";
import {
  createMetaEmbeddedSignupFlowCoordinator,
  extractMetaEmbeddedSignupSession,
  classifyMetaEmbeddedSignupMessage,
  isAllowedMetaEmbeddedSignupOrigin,
  isMetaEmbeddedSignupCancellation,
  isMetaEmbeddedSignupFlowActive,
} from "./meta-embedded-signup";

const trustedOrigin = "https://www.facebook.com";
const target = { wabaId: "1642288770859048", phoneNumberId: "1322472314288518" };
const finishEvent = {
  origin: trustedOrigin,
  data: {
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH",
    data: { waba_id: target.wabaId, phone_number_id: target.phoneNumberId },
  },
} as const;

const tests = [
  {
    name: "ignores callbacks from a previous flow and closes safely on timeout",
    run() {
      assert.equal(isMetaEmbeddedSignupFlowActive({ expectedFlowId: 2, currentFlowId: 1, status: "authorizing" }), false);
      assert.equal(isMetaEmbeddedSignupFlowActive({ expectedFlowId: 2, currentFlowId: 2, status: "submitting" }), false);
      const flow = createMetaEmbeddedSignupFlowCoordinator(target);
      assert.equal(flow.acceptOAuthCode("oauth-code"), true);
      flow.close();
      assert.equal(flow.canSubmit(), false);
      assert.equal(flow.acceptOAuthCode("late-code"), false);
    },
  },
  {
    name: "coordinates code and FINISH in either order and submits once",
    run() {
      for (const order of ["code-first", "finish-first"] as const) {
        const flow = createMetaEmbeddedSignupFlowCoordinator(target);
        if (order === "code-first") assert.equal(flow.acceptOAuthCode("oauth-code"), true);
        assert.equal(flow.acceptMessage(finishEvent), "finish_valid");
        if (order === "finish-first") assert.equal(flow.acceptOAuthCode("oauth-code"), true);
        assert.equal(flow.canSubmit(), true);
        assert.equal(flow.markSubmitting(), true);
        assert.equal(flow.markSubmitting(), false);
        assert.equal(flow.acceptMessage(finishEvent), "ignored_message");
      }
    },
  },
  {
    name: "rejects cancellation, stale/invalid context and unauthorized origins without readiness",
    run() {
      const flow = createMetaEmbeddedSignupFlowCoordinator(target);
      assert.equal(flow.acceptOAuthCode("oauth-code"), true);
      assert.equal(flow.acceptMessage({ origin: "https://evil.example", data: finishEvent.data }), "origin_rejected");
      assert.equal(
        flow.acceptMessage({
          origin: trustedOrigin,
          data: { ...finishEvent.data, data: { waba_id: "999999999999", phone_number_id: target.phoneNumberId } },
        }),
        "target_rejected",
      );
      assert.equal(flow.canSubmit(), false);
      assert.equal(
        flow.acceptMessage({
          origin: trustedOrigin,
          data: { type: "WA_EMBEDDED_SIGNUP", event: "CANCELLED" },
        }),
        "cancelled",
      );
      assert.equal(flow.acceptOAuthCode("late-code"), false);
      assert.equal(flow.canSubmit(), false);
    },
  },
  {
    name: "classifies only sanitized event diagnostics",
    run() {
      assert.equal(
        classifyMetaEmbeddedSignupMessage({
          origin: trustedOrigin,
          data: { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "1642288770859048" } },
        }),
        "finish_missing_ids",
      );
      assert.equal(
        classifyMetaEmbeddedSignupMessage({
          origin: "https://evil.example",
          data: { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", secret: "must-not-be-returned" },
        }),
        "origin_rejected",
      );
      assert.equal(
        classifyMetaEmbeddedSignupMessage({
          origin: trustedOrigin,
          data: { type: "WA_EMBEDDED_SIGNUP", event: "CANCELLED", token: "must-not-be-returned" },
        }),
        "cancelled",
      );
    },
  },
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

import { strict as assert } from "node:assert";
import {
  enrichEmbeddedSignupSessionWithBackendIdentity,
  isEmbeddedSignupResponseUncertain,
  isEmbeddedSignupStatusForSession,
  recoverEmbeddedSignupStatus,
} from "./embedded-signup-recovery";

const session = { whatsappBusinessAccountId: "waba-1", phoneNumberId: "phone-1" };
const active = {
  ok: true,
  connected: true,
  isActive: true,
  status: "active",
  phoneNumberId: "phone-1",
  whatsappBusinessAccountId: "waba-1",
};

const tests = [
  {
    name: "bounded recovery accepts an active matching integration after a timeout",
    async run() {
      let calls = 0;
      const result = await recoverEmbeddedSignupStatus({
        session,
        fetchStatus: async () => {
          calls += 1;
          return calls === 2 ? active : { ok: true, connected: false, isActive: false, status: null };
        },
        isMounted: () => true,
        wait: async () => undefined,
      });
      assert.equal(result.outcome, "active");
      assert.equal(calls, 2);
    },
  },
  {
    name: "bounded recovery does not poll forever when integration remains absent",
    async run() {
      let calls = 0;
      const result = await recoverEmbeddedSignupStatus({
        session,
        attempts: 3,
        fetchStatus: async () => {
          calls += 1;
          return { ok: true, connected: false, isActive: false, status: null };
        },
        isMounted: () => true,
        wait: async () => undefined,
      });
      assert.equal(result.outcome, "absent");
      assert.equal(calls, 3);
    },
  },
  {
    name: "status transport failures remain inconclusive and do not become false success",
    async run() {
      const result = await recoverEmbeddedSignupStatus({
        session,
        attempts: 2,
        fetchStatus: async () => null,
        isMounted: () => true,
        wait: async () => undefined,
      });
      assert.equal(result.outcome, "inconclusive");
      assert.equal(result.status, null);
    },
  },
  {
    name: "organization or phone mismatch cannot be treated as recovered success",
    run() {
      assert.equal(isEmbeddedSignupStatusForSession(active, session), true);
      assert.equal(
        isEmbeddedSignupStatusForSession(
          { ...active, whatsappBusinessAccountId: "other-waba" },
          session,
        ),
        false,
      );
      assert.equal(isEmbeddedSignupStatusForSession({ ...active, phoneNumberId: "other-phone" }, session), false);
    },
  },
  {
    name: "coexistence without a phone id never accepts an active number by WABA alone",
    async run() {
      const result = await recoverEmbeddedSignupStatus({
        session: { whatsappBusinessAccountId: "waba-1" },
        fetchStatus: async () => ({ ...active, phoneNumberId: "other-phone" }),
        isMounted: () => true,
        attempts: 1,
        wait: async () => undefined,
      });
      assert.equal(result.outcome, "inconclusive");
      assert.equal(
        isEmbeddedSignupStatusForSession(
          { ...active, phoneNumberId: "other-phone" },
          { whatsappBusinessAccountId: "waba-1" },
        ),
        false,
      );
    },
  },
  {
    name: "backend-resolved phone id can safely complete a coexistence session",
    run() {
      const resolved = enrichEmbeddedSignupSessionWithBackendIdentity(
        { whatsappBusinessAccountId: "waba-1" },
        { whatsappBusinessAccountId: "waba-1", phoneNumberId: "phone-1" },
      );
      assert.ok(resolved);
      assert.deepEqual(resolved, {
        whatsappBusinessAccountId: "waba-1",
        phoneNumberId: "phone-1",
      });
      assert.equal(
        isEmbeddedSignupStatusForSession(active, resolved),
        true,
      );
    },
  },
  {
    name: "backend identity from another WABA is rejected",
    run() {
      assert.equal(
        enrichEmbeddedSignupSessionWithBackendIdentity(
          { whatsappBusinessAccountId: "waba-1" },
          { whatsappBusinessAccountId: "other-waba", phoneNumberId: "phone-1" },
        ),
        null,
      );
    },
  },
  {
    name: "truncated successful response is transport-uncertain but definitive 4xx is not",
    run() {
      assert.equal(
        isEmbeddedSignupResponseUncertain({
          responseStatus: 200,
          responseBodyRead: false,
          timedOut: false,
          errorName: "EMBEDDED_SIGNUP_RESPONSE_BODY_UNREADABLE",
        }),
        true,
      );
      assert.equal(
        isEmbeddedSignupResponseUncertain({
          responseStatus: 422,
          responseBodyRead: false,
          timedOut: false,
          errorName: "EMBEDDED_SIGNUP_RESPONSE_BODY_UNREADABLE",
        }),
        false,
      );
    },
  },
  {
    name: "a recovered phone identity cannot be substituted by a different phone",
    run() {
      assert.equal(
        enrichEmbeddedSignupSessionWithBackendIdentity(
          { whatsappBusinessAccountId: "waba-1", phoneNumberId: "phone-1" },
          { whatsappBusinessAccountId: "waba-1", phoneNumberId: "other-phone" },
        ),
        null,
      );
    },
  },
  {
    name: "unmounted recovery stops without another status request",
    async run() {
      let calls = 0;
      const result = await recoverEmbeddedSignupStatus({
        session,
        fetchStatus: async () => {
          calls += 1;
          return null;
        },
        isMounted: () => false,
        wait: async () => undefined,
      });
      assert.equal(result.outcome, "inconclusive");
      assert.equal(calls, 0);
    },
  },
];

for (const test of tests) await test.run();
console.log(`embedded-signup-recovery: ${tests.length} behavioral tests passed`);

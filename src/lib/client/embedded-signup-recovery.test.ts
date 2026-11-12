import { strict as assert } from "node:assert";
import {
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

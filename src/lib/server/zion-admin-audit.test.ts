import { strict as assert } from "node:assert";
import {
  writeZionAdminAuditEvent,
} from "./zion-admin-audit";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const tests: TestCase[] = [
  {
    name: "helper writes explicit metadata only and excludes arbitrary secrets",
    run: async () => {
      const inserts: Array<Record<string, unknown>> = [];

      const operationId = await writeZionAdminAuditEvent({
        actorUserId: "actor-1",
        action: "store.suspend",
        targetType: "store",
        targetId: "store-1",
        organizationId: "org-1",
        storeId: "store-1",
        outcome: "failed",
        operationId: "operation-1",
        reasonCode: "subscription_update_failed",
        subscriptionId: "subscription-1",
        previousState: "active",
        nextState: "unavailable",
        subscriptionStatus: "active",
        externalIntegrationsDisabled: true,
        serviceSupabase: {
          from() {
            return {
              insert(payload: Record<string, unknown>) {
                inserts.push(payload);
                return Promise.resolve({ error: null });
              },
            };
          },
        } as never,
      });

      assert.equal(inserts.length, 1);
      assert.equal(operationId, "operation-1");
      assert.equal(inserts[0]?.operation_id, "operation-1");
      assert.equal(inserts[0]?.actor_user_id, "actor-1");
      assert.equal(inserts[0]?.action, "store.suspend");
      assert.equal(inserts[0]?.target_type, "store");
      assert.equal(inserts[0]?.target_id, "store-1");
      assert.equal(inserts[0]?.organization_id, "org-1");
      assert.equal(inserts[0]?.store_id, "store-1");
      assert.equal(inserts[0]?.outcome, "failed");

      const metadata = inserts[0]?.metadata as Record<string, unknown>;
      assert.deepEqual(metadata, {
        reason_code: "subscription_update_failed",
        subscription_id: "subscription-1",
        previous_state: "active",
        next_state: "unavailable",
        subscription_status: "active",
        external_integrations_disabled: true,
      });
      assert.equal("password" in metadata, false);
      assert.equal("token" in metadata, false);
      assert.equal("redirectTo" in metadata, false);
    },
  },
  {
    name: "helper generates operation id for denied events when one is not provided",
    run: async () => {
      const inserts: Array<Record<string, unknown>> = [];

      const operationId = await writeZionAdminAuditEvent({
        actorUserId: "actor-2",
        action: "account.access_block",
        targetType: "membership",
        targetId: "membership-1",
        outcome: "denied",
        reasonCode: "membership_not_found",
        serviceSupabase: {
          from() {
            return {
              insert(payload: Record<string, unknown>) {
                inserts.push(payload);
                return Promise.resolve({ error: null });
              },
            };
          },
        } as never,
      });

      assert.equal(typeof operationId, "string");
      assert.equal(operationId.length > 0, true);
      assert.equal(inserts.length, 1);
      assert.equal(inserts[0]?.operation_id, operationId);
      assert.equal(inserts[0]?.outcome, "denied");
    },
  },
  {
    name: "helper rejects missing actor",
    run: async () => {
      let error: unknown = null;

      try {
        await writeZionAdminAuditEvent({
          actorUserId: "",
          action: "account.create",
          targetType: "user",
          outcome: "denied",
          serviceSupabase: {
            from() {
              return {
                insert() {
                  return Promise.resolve({ error: null });
                },
              };
            },
          } as never,
        });
      } catch (caught) {
        error = caught;
      }

      assert.equal(error instanceof Error, true);
      assert.equal(
        (error as Error).message,
        "actorUserId is required for zion admin audit.",
      );
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`zion-admin-audit-helper: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

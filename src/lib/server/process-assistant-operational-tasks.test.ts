import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

const sourcePath = join(
  process.cwd(),
  "src/lib/server/process-assistant-operational-tasks.ts",
);

function readSource() {
  return readFileSync(sourcePath, "utf8");
}

const tests: TestCase[] = [
  {
    name: "worker checks canonical subscription before processing queue item",
    run: () => {
      const source = readSource();

      assert.equal(source.includes('from("subscriptions")'), true);
      assert.equal(source.includes("loadCanonicalOrganizationSubscription("), true);
      assert.equal(source.includes('reason: "organization_subscription_suspended"'), true);
      assert.equal(source.includes("const result = await processQueueItem({ supabase, queue: locked, workerId });"), true);
    },
  },
  {
    name: "suspended organizations are failed closed before privileged processing",
    run: () => {
      const source = readSource();

      const suspendedCheck = source.indexOf('if (subscriptionStatus === "suspended")');
      const queueFailureUpdate = source.indexOf('status: "failed"', suspendedCheck);
      const processIndex = source.indexOf(
        "const result = await processQueueItem({ supabase, queue: locked, workerId });",
      );

      assert.notEqual(suspendedCheck, -1);
      assert.notEqual(queueFailureUpdate, -1);
      assert.notEqual(processIndex, -1);
      assert.equal(suspendedCheck < processIndex, true);
    },
  },
];

async function run() {
  for (const test of tests) {
    test.run();
  }

  console.log(`process-assistant-operational-tasks: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

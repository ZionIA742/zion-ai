import { strict as assert } from "node:assert";
import { classifyCustomerReply } from "./process-assistant-operational-tasks";

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [
  {
    name: "customer confirmation without explicit alternative time stays confirmed",
    run: () => {
      const decision = classifyCustomerReply(
        "Claro podemos remarcar para esse dia e esse horario",
      );

      assert.deepEqual(decision, {
        type: "confirmed",
        reason: "customer_confirmed_target_time",
      });
    },
  },
  {
    name: "explicit alternative time still stays as suggested other time",
    run: () => {
      const decision = classifyCustomerReply("Pode ser, mas prefiro as 17:00");

      assert.equal(decision.type, "suggested_other_time");
    },
  },
];

async function run() {
  for (const test of tests) {
    test.run();
  }

  console.log(`process-assistant-operational-tasks-classify: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

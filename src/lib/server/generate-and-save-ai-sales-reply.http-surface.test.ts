import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

const routePath = join(process.cwd(), "src/app/api/internal/ai-sales-reply/route.ts");
const helperPath = join(
  process.cwd(),
  "src/lib/server/generate-and-save-ai-sales-reply.ts",
);
const middlewarePolicyPath = join(
  process.cwd(),
  "src/lib/account-access-middleware-policy.ts",
);

const tests: TestCase[] = [
  {
    name: "orphan ai-sales-reply HTTP route is absent",
    run: () => {
      assert.equal(existsSync(routePath), false);
    },
  },
  {
    name: "legitimate helper remains exported",
    run: () => {
      const source = readFileSync(helperPath, "utf8");

      assert.equal(source.includes("export async function generateAndSaveAiSalesReply"), true);
    },
  },
  {
    name: "middleware no longer lists removed ai-sales-reply HTTP path as public",
    run: () => {
      const source = readFileSync(middlewarePolicyPath, "utf8");

      assert.equal(source.includes("/api/internal/ai-sales-reply"), false);
    },
  },
];

async function run() {
  for (const test of tests) {
    test.run();
  }

  console.log(`generate-and-save-ai-sales-reply-http-surface: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

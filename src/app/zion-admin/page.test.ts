import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

const pagePath = join(process.cwd(), "src/app/zion-admin/page.tsx");

function readPageSource() {
  return readFileSync(pagePath, "utf8");
}

function getBlock(source: string, startPattern: string) {
  const start = source.indexOf(startPattern);
  assert.equal(start > -1, true, `Pattern not found: ${startPattern}`);

  const end = source.indexOf("\n  }\n", start);
  assert.equal(end > start, true, `Block end not found: ${startPattern}`);

  return source.slice(start, end);
}

const tests: TestCase[] = [
  {
    name: "anonymous user in /zion-admin goes to /zion-admin/login",
    run: () => {
      const source = readPageSource();
      const block = getBlock(source, "  if (!user) {");

      assert.equal(block.includes('redirect("/zion-admin/login")'), true);
    },
  },
  {
    name: "store user in /zion-admin goes to /zion-admin/login instead of store area",
    run: () => {
      const source = readPageSource();
      const block = getBlock(source, "  if (adminError || !admin) {");

      assert.equal(block.includes('redirect("/zion-admin/login")'), true);
      assert.equal(block.includes('redirect("/dashboard")'), false);
      assert.equal(source.includes('redirect("/dashboard")'), false);
    },
  },
  {
    name: "zion admin page still checks active internal admin membership before rendering",
    run: () => {
      const source = readPageSource();

      const requiredTokens = [
        '.from("zion_internal_admins")',
        '.eq("user_id", user.id)',
        '.eq("is_active", true)',
        "maybeSingle()",
        "<ZionAdminDashboardClient",
      ];

      for (const token of requiredTokens) {
        assert.equal(source.includes(token), true, `missing token: ${token}`);
      }
    },
  },
];

async function run() {
  for (const test of tests) {
    test.run();
  }

  console.log(`zion-admin-page: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

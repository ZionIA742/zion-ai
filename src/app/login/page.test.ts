import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src/app/login/page.tsx"),
  "utf8",
);

function findBlock(startPattern: string) {
  const start = source.indexOf(startPattern);
  assert.equal(start > -1, true, `Pattern not found: ${startPattern}`);

  const end = source.indexOf("\n  }\n", start);
  assert.equal(end > start, true, `Block end not found: ${startPattern}`);

  return source.slice(start, end);
}

const tests = [
  {
    name: "login page does not call ensure-setup automatically on open",
    run: () => {
      const effectStart = source.indexOf("useEffect(() => {");
      const ensureStart = source.indexOf("ensureAccountSetup(", effectStart);
      const effectEnd = source.indexOf("}, []);", effectStart);

      assert.equal(effectStart > -1, true);
      assert.equal(effectEnd > effectStart, true);
      assert.equal(
        ensureStart > effectStart && ensureStart < effectEnd,
        false,
      );
    },
  },
  {
    name: "password login still calls ensure-setup after successful credentials",
    run: () => {
      const block = findBlock(
        "async function handlePasswordLogin(event: FormEvent<HTMLFormElement>) {",
      );

      assert.equal(block.includes("await supabase.auth.signInWithPassword({"), true);
      assert.equal(block.includes("const access = await ensureAccountSetup();"), true);
      assert.equal(
        block.indexOf("await supabase.auth.signInWithPassword({") <
          block.indexOf("const access = await ensureAccountSetup();"),
        true,
      );
    },
  },
  {
    name: "otp verification still calls ensure-setup after successful verification",
    run: () => {
      const block = findBlock(
        "async function handleVerifyCode(event: FormEvent<HTMLFormElement>) {",
      );

      assert.equal(block.includes("await supabase.auth.verifyOtp({"), true);
      assert.equal(block.includes("const access = await ensureAccountSetup();"), true);
      assert.equal(
        block.indexOf("await supabase.auth.verifyOtp({") <
          block.indexOf("const access = await ensureAccountSetup();"),
        true,
      );
    },
  },
];

let passed = 0;

for (const test of tests) {
  test.run();
  passed += 1;
}

console.log(`login-page: ${passed}/${tests.length} tests passed`);

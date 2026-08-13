import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

const dirPath = fileURLToPath(new URL(".", import.meta.url));
const pagePath = join(dirPath, "page.tsx");

function readPageSource() {
  return readFileSync(pagePath, "utf8");
}

const tests: TestCase[] = [
  {
    name: "reset-password page keeps recovery flow on callback plus trusted session validation",
    run: () => {
      const source = readPageSource();

      const requiredTokens = [
        '"use client";',
        'const callbackUrl = new URL("/auth/callback", window.location.origin);',
        'callbackUrl.searchParams.set("code", code);',
        'callbackUrl.searchParams.set("next", "/auth/reset-password");',
        'const trustedFlow = await fetchPasswordFlow();',
        'if (trustedFlow.flow !== "recovery") {',
        'const { data, error } = await supabase.auth.getSession();',
        "function isRecoverySessionTerminalError(message: string | null | undefined)",
        "await supabase.auth.updateUser({",
        "password: nextPassword,",
        'setStatus("ready");',
        'await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);',
        'setMessage("Senha alterada com sucesso.");',
        'const statusSubtitle = status === "success" ? "Senha redefinida" : "Recuperar senha";',
        'const code = params.get("code");',
        'const recoveryError = params.get("recoveryError");',
      ];

      for (const token of requiredTokens) {
        assert.equal(source.includes(token), true, `missing token: ${token}`);
      }

      assert.equal(source.includes("access_token"), false);
      assert.equal(source.includes("refresh_token"), false);
      assert.equal(source.includes("/api/account/first-access/complete"), false);
      assert.equal(source.includes("createServiceSupabaseClient"), false);
      assert.equal(source.includes("getAuthAdminUserById"), false);
      assert.equal(source.includes("resolveTrustedPasswordFlow"), false);
      assert.equal(source.includes("ZION"), false);
      assert.equal(source.includes("profiles"), false);
      assert.equal(source.includes("memberships"), false);
      assert.equal(source.includes("subscriptions"), false);
      assert.equal(source.includes("external_integrations"), false);
      assert.equal(source.includes("provision"), false);
    },
  },
  {
    name: "recoverable submit errors keep the page reusable without masking terminal token failures",
    run: () => {
      const source = readPageSource();

      const recoverableTokens = [
        'setStatus("ready");\n      setMessage("As senhas nao estao iguais.");',
        'setStatus("ready");\n      setMessage(\n        "A senha precisa ter pelo menos 8 caracteres, uma letra maiuscula, um numero e um caractere especial.",',
        'if (isRecoverySessionTerminalError(rawMessage)) {',
        'setStatus("error");',
        'setStatus("ready");\n        setMessage(friendlyMessage);',
      ];

      for (const token of recoverableTokens) {
        assert.equal(source.includes(token), true, `missing token: ${token}`);
      }
    },
  },
];

async function run() {
  for (const test of tests) {
    test.run();
  }

  console.log(`reset-password-page: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

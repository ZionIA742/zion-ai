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
const clientPath = join(dirPath, "SetInitialPasswordClient.tsx");

function readPageSource() {
  return readFileSync(pagePath, "utf8");
}

function readClientSource() {
  return readFileSync(clientPath, "utf8");
}

const tests: TestCase[] = [
  {
    name: "page is a server wrapper with Suspense around the real client component",
    run: () => {
      const pageSource = readPageSource();

      const requiredTokens = [
        'import { Suspense } from "react";',
        'import SetInitialPasswordClient from "./SetInitialPasswordClient";',
        "<Suspense fallback={<SetInitialPasswordFallback />}>",
        "<SetInitialPasswordClient />",
        "Validando link...",
      ];

      for (const token of requiredTokens) {
        assert.equal(pageSource.includes(token), true, `missing token: ${token}`);
      }

      assert.equal(
        pageSource.includes('"use client"'),
        false,
        "page must remain a server component",
      );
    },
  },
  {
    name: "client component keeps the interactive first-access flow and owns useSearchParams",
    run: () => {
      const pageSource = readPageSource();
      const clientSource = readClientSource();

      const requiredTokens = [
        '"use client";',
        'import { useRouter, useSearchParams } from "next/navigation";',
        'import { validatePasswordPolicy } from "@/lib/password-policy";',
        'import { FIRST_ACCESS_SUCCESS_MESSAGE } from "@/lib/zion-account-provisioning-shared";',
        "/api/account/password-flow?attempt=",
        'flow.flow !== "first_access" || flow.attemptValid !== true',
        "validatePasswordPolicy(password)",
        'body: JSON.stringify({ attempt })',
        'await supabase.auth.signOut({ scope: "global" }).catch(() => undefined)',
        "await clearTemporarySession().catch(() => undefined)",
        'router.replace(`/login?authSuccess=${encodeURIComponent(FIRST_ACCESS_SUCCESS_MESSAGE)}`)',
        'aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}',
        'aria-label={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}',
      ];

      for (const token of requiredTokens) {
        assert.equal(clientSource.includes(token), true, `missing token: ${token}`);
      }

      assert.equal(pageSource.includes("useSearchParams"), false);
      assert.equal(clientSource.includes("useSearchParams"), true);
      assert.equal(
        clientSource.includes('from "@/lib/server/zion-account-provisioning"'),
        false,
        "client component must not import the server provisioning module",
      );
    },
  },
];

async function run() {
  for (const test of tests) {
    test.run();
  }

  console.log(`set-initial-password-page: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { strict as assert } from "node:assert";
import {
  getFirstAccessInviteRedirectTo,
  getRecoveryRedirectTo,
} from "./zion-account-provisioning";

type TestCase = {
  name: string;
  run: () => void;
};

function withEnv(
  nextEnv: Partial<Record<"NEXT_PUBLIC_SITE_URL" | "NEXT_PUBLIC_APP_URL" | "NEXT_PUBLIC_VERCEL_URL" | "NODE_ENV" | "VERCEL_ENV", string | undefined>>,
  run: () => void,
) {
  const previous = {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_VERCEL_URL: process.env.NEXT_PUBLIC_VERCEL_URL,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };

  for (const [key, value] of Object.entries(nextEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const tests: TestCase[] = [
  {
    name: "first-access redirect keeps callback path, encoded next, and attempt",
    run: () => {
      withEnv(
        {
          NEXT_PUBLIC_SITE_URL: "https://zion.example.com/",
          NEXT_PUBLIC_APP_URL: undefined,
          NEXT_PUBLIC_VERCEL_URL: undefined,
          NODE_ENV: "test",
          VERCEL_ENV: undefined,
        },
        () => {
          assert.equal(
            getFirstAccessInviteRedirectTo("fia_123"),
            "https://zion.example.com/auth/callback?next=%2Fauth%2Fset-initial-password&attempt=fia_123",
          );
        },
      );
    },
  },
  {
    name: "recovery redirect keeps callback path and encoded next",
    run: () => {
      withEnv(
        {
          NEXT_PUBLIC_SITE_URL: "https://zion.example.com",
          NEXT_PUBLIC_APP_URL: undefined,
          NEXT_PUBLIC_VERCEL_URL: undefined,
          NODE_ENV: "test",
          VERCEL_ENV: undefined,
        },
        () => {
          assert.equal(
            getRecoveryRedirectTo(),
            "https://zion.example.com/auth/callback?next=%2Fauth%2Freset-password",
          );
        },
      );
    },
  },
  {
    name: "site url has priority over app url and vercel url",
    run: () => {
      withEnv(
        {
          NEXT_PUBLIC_SITE_URL: "https://site.example.com",
          NEXT_PUBLIC_APP_URL: "https://app.example.com",
          NEXT_PUBLIC_VERCEL_URL: "preview.example.vercel.app",
          NODE_ENV: "test",
          VERCEL_ENV: undefined,
        },
        () => {
          assert.equal(
            getFirstAccessInviteRedirectTo("fia_priority"),
            "https://site.example.com/auth/callback?next=%2Fauth%2Fset-initial-password&attempt=fia_priority",
          );
        },
      );
    },
  },
  {
    name: "app url is used when site url is absent",
    run: () => {
      withEnv(
        {
          NEXT_PUBLIC_SITE_URL: undefined,
          NEXT_PUBLIC_APP_URL: "https://app.example.com/base",
          NEXT_PUBLIC_VERCEL_URL: "preview.example.vercel.app",
          NODE_ENV: "test",
          VERCEL_ENV: undefined,
        },
        () => {
          assert.equal(
            getRecoveryRedirectTo(),
            "https://app.example.com/auth/callback?next=%2Fauth%2Freset-password",
          );
        },
      );
    },
  },
  {
    name: "vercel url fallback is normalized to https",
    run: () => {
      withEnv(
        {
          NEXT_PUBLIC_SITE_URL: undefined,
          NEXT_PUBLIC_APP_URL: undefined,
          NEXT_PUBLIC_VERCEL_URL: "zion-ai-ten.vercel.app",
          NODE_ENV: "production",
          VERCEL_ENV: "preview",
        },
        () => {
          assert.equal(
            getFirstAccessInviteRedirectTo("fia_vercel"),
            "https://zion-ai-ten.vercel.app/auth/callback?next=%2Fauth%2Fset-initial-password&attempt=fia_vercel",
          );
        },
      );
    },
  },
  {
    name: "redirects stay undefined when no base url is configured",
    run: () => {
      withEnv(
        {
          NEXT_PUBLIC_SITE_URL: undefined,
          NEXT_PUBLIC_APP_URL: undefined,
          NEXT_PUBLIC_VERCEL_URL: undefined,
          NODE_ENV: "production",
          VERCEL_ENV: "production",
        },
        () => {
          assert.equal(getFirstAccessInviteRedirectTo("fia_missing"), undefined);
          assert.equal(getRecoveryRedirectTo(), undefined);
        },
      );
    },
  },
  {
    name: "production accepts only the official site url",
    run: () => {
      withEnv(
        {
          NEXT_PUBLIC_SITE_URL: "https://zionapi.com.br/",
          NEXT_PUBLIC_APP_URL: "https://wrong.example",
          NEXT_PUBLIC_VERCEL_URL: "preview.example.vercel.app",
          NODE_ENV: "production",
          VERCEL_ENV: "production",
        },
        () => {
          assert.equal(
            getRecoveryRedirectTo(),
            "https://zionapi.com.br/auth/callback?next=%2Fauth%2Freset-password",
          );
        },
      );
    },
  },
  {
    name: "production rejects external, http, vercel, and missing urls",
    run: () => {
      for (const siteUrl of [
        "https://wrong.example",
        "http://zionapi.com.br",
        undefined,
      ]) {
        withEnv(
          {
            NEXT_PUBLIC_SITE_URL: siteUrl,
            NEXT_PUBLIC_APP_URL: "https://app.example.com",
            NEXT_PUBLIC_VERCEL_URL: "preview.example.vercel.app",
            NODE_ENV: "production",
            VERCEL_ENV: "production",
          },
          () => assert.equal(getRecoveryRedirectTo(), undefined),
        );
      }
    },
  },
  {
    name: "preview accepts an explicitly configured vercel url",
    run: () => {
      withEnv(
        {
          NEXT_PUBLIC_SITE_URL: undefined,
          NEXT_PUBLIC_APP_URL: undefined,
          NEXT_PUBLIC_VERCEL_URL: "preview.example.vercel.app",
          NODE_ENV: "production",
          VERCEL_ENV: "preview",
        },
        () => assert.equal(getRecoveryRedirectTo(), "https://preview.example.vercel.app/auth/callback?next=%2Fauth%2Freset-password"),
      );
    },
  },
];

for (const test of tests) {
  test.run();
}

console.log(`zion-account-provisioning-server: ${tests.length} tests passed`);

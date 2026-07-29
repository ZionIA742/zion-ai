import { strict as assert } from "node:assert";
import { handleAuthCallback } from "./callback-handler";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type FakeSupabaseClient = {
  auth: {
    signOut: () => Promise<void>;
    exchangeCodeForSession: (code: string) => Promise<{ error: unknown }>;
    getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
};

type ConsoleCapture = {
  info: string[];
  error: string[];
};

function stringifyConsoleArgs(args: unknown[]) {
  return args
    .map((value) => {
      if (typeof value === "string") {
        return value;
      }

      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(" ");
}

async function withCapturedConsole<T>(
  run: (capture: ConsoleCapture) => Promise<T>,
): Promise<T> {
  const capture: ConsoleCapture = {
    info: [],
    error: [],
  };
  const originalInfo = console.info;
  const originalError = console.error;

  console.info = (...args: unknown[]) => {
    capture.info.push(stringifyConsoleArgs(args));
  };
  console.error = (...args: unknown[]) => {
    capture.error.push(stringifyConsoleArgs(args));
  };

  try {
    return await run(capture);
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
}

async function createCallbackHarness(harnessOptions?: {
  exchangeError?: unknown;
  callbackUser?: { id: string } | null;
  getUserError?: unknown;
  exchangeSupabase?: FakeSupabaseClient;
  authUser?: { app_metadata?: Record<string, unknown> | null };
  resolvedFlow?: { flow: string; message: string; attemptState: string };
}) {
  const calls = {
    signOut: 0,
    exchangeCodes: [] as string[],
    resolveAttempts: [] as Array<string | null | undefined>,
    readInviteMetadataCalls: 0,
  };

  const deps = {
    async createSupabaseClient() {
      return (
        harnessOptions?.exchangeSupabase ?? {
          auth: {
            async signOut() {
              calls.signOut += 1;
            },
            async exchangeCodeForSession(code: string) {
              calls.exchangeCodes.push(code);
              return {
                error: harnessOptions?.exchangeError ?? null,
              };
            },
            async getUser() {
              return {
                data: {
                  user: harnessOptions?.callbackUser ?? { id: "user-1" },
                },
                error: harnessOptions?.getUserError ?? null,
              };
            },
          },
        }
      );
    },
    createServiceClient() {
      return { kind: "service" };
    },
    async getAuthAdminUserByIdWithRetry(
      _service: unknown,
      userId: string,
      options?: { shouldRetry?: (candidate: { app_metadata?: Record<string, unknown> | null }) => boolean },
    ) {
      const authUser = {
        id: userId,
        ...(harnessOptions?.authUser ?? {
          app_metadata: { zion_first_access_invite_id: "fia_current" },
        }),
      };
      options?.shouldRetry?.(authUser);
      return authUser;
    },
    getInvalidFirstAccessAttemptMessage(state: string) {
      return `invalid:${state}`;
    },
    readFirstAccessInviteId(metadata: unknown) {
      calls.readInviteMetadataCalls += 1;
      const value = (metadata as { zion_first_access_invite_id?: unknown } | null)
        ?.zion_first_access_invite_id;
      return typeof value === "string" ? value : null;
    },
    resolveTrustedPasswordFlow(_user: unknown, resolveOptions?: { attemptId?: string | null }) {
      calls.resolveAttempts.push(resolveOptions?.attemptId);
      return (
        harnessOptions?.resolvedFlow ?? {
          flow: "first_access",
          message: "Defina sua primeira senha para concluir o acesso inicial.",
          attemptState: "valid",
        }
      );
    },
  };

  return {
    calls,
    run(url: string) {
      return handleAuthCallback(new Request(url), deps as never);
    },
  };
}

const tests: TestCase[] = [
  {
    name: "absence of code redirects to login with sanitized auth error",
    run: async () => {
      await withCapturedConsole(async (capture) => {
        const harness = await createCallbackHarness();
        const response = await harness.run("https://example.com/auth/callback");

        assert.equal(response.status, 307);
        assert.equal(
          response.headers.get("location"),
          "https://example.com/login?authError=Nao+foi+possivel+validar+o+link+recebido.+Peca+um+novo+e-mail.",
        );
        assert.equal(harness.calls.signOut, 1);
        assert.equal(capture.info.join(" ").includes('"hasCode":false'), true);
      });
    },
  },
  {
    name: "successful non first-access callback preserves allowed next path",
    run: async () => {
      const secretCode = "SECRET-CODE-123";
      const harness = await createCallbackHarness();
      const response = await harness.run(
        `https://example.com/auth/callback?code=${encodeURIComponent(secretCode)}&next=${encodeURIComponent("/crm")}`,
      );

      assert.equal(response.status, 307);
      assert.equal(response.headers.get("location"), "https://example.com/crm");
      assert.deepEqual(harness.calls.exchangeCodes, [secretCode]);
      assert.deepEqual(harness.calls.resolveAttempts, []);
    },
  },
  {
    name: "exchange failure redirects to recovery login path",
    run: async () => {
      await withCapturedConsole(async (capture) => {
        const secretCode = "SECRET-CODE-123";
        const harness = await createCallbackHarness({
          exchangeError: {
            message: "expired code",
            status: 403,
            code: "otp_expired",
          },
        });
        const response = await harness.run(
          `https://example.com/auth/callback?code=${encodeURIComponent(secretCode)}`,
        );

        assert.equal(response.status, 307);
        assert.equal(
          response.headers.get("location"),
          "https://example.com/login?authError=O+link+de+recuperacao+expirou+ou+nao+e+mais+valido.+Peca+um+novo+e-mail.",
        );
        assert.equal(harness.calls.signOut, 1);
        assert.equal(capture.error.join(" ").includes(secretCode), false);
      });
    },
  },
  {
    name: "allowed reset-password next remains preserved",
    run: async () => {
      const harness = await createCallbackHarness();
      const response = await harness.run(
        "https://example.com/auth/callback?code=abc&next=%2Fauth%2Freset-password",
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://example.com/auth/reset-password",
      );
    },
  },
  {
    name: "external next falls back to reset-password",
    run: async () => {
      const harness = await createCallbackHarness();
      const response = await harness.run(
        `https://example.com/auth/callback?code=abc&next=${encodeURIComponent("https://evil.example/phish")}`,
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://example.com/auth/reset-password",
      );
    },
  },
  {
    name: "internal next outside allowlist falls back to reset-password",
    run: async () => {
      const harness = await createCallbackHarness();
      const response = await harness.run(
        `https://example.com/auth/callback?code=abc&next=${encodeURIComponent("/admin")}`,
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://example.com/auth/reset-password",
      );
    },
  },
  {
    name: "valid first-access attempt redirects to set-initial-password and preserves attempt",
    run: async () => {
      await withCapturedConsole(async (capture) => {
        const secretCode = "SECRET-CODE-123";
        const harness = await createCallbackHarness();
        const response = await harness.run(
          `https://example.com/auth/callback?code=${encodeURIComponent(secretCode)}&next=${encodeURIComponent("/auth/set-initial-password")}&attempt=fia_current`,
        );

        assert.equal(response.status, 307);
        assert.equal(
          response.headers.get("location"),
          "https://example.com/auth/set-initial-password?attempt=fia_current",
        );
        assert.deepEqual(harness.calls.exchangeCodes, [secretCode]);
        assert.deepEqual(harness.calls.resolveAttempts, ["fia_current"]);
        assert.equal(harness.calls.readInviteMetadataCalls > 0, true);
        assert.equal(capture.info.join(" ").includes(secretCode), false);
      });
    },
  },
  {
    name: "substituted attempt redirects to login with invalid invite message",
    run: async () => {
      const harness = await createCallbackHarness({
        resolvedFlow: {
          flow: "first_access",
          message: "Defina sua primeira senha para concluir o acesso inicial.",
          attemptState: "mismatch",
        },
      });
      const response = await harness.run(
        "https://example.com/auth/callback?code=abc&next=%2Fauth%2Fset-initial-password&attempt=fia_old",
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://example.com/login?authError=invalid%3Amismatch",
      );
      assert.equal(harness.calls.signOut, 1);
    },
  },
  {
    name: "logs never leak code or attempt values",
    run: async () => {
      await withCapturedConsole(async (capture) => {
        const harness = await createCallbackHarness({
          exchangeError: {
            message: "expired code",
            status: 403,
            code: "otp_expired",
          },
        });
        await harness.run(
          "https://example.com/auth/callback?code=ULTRA-SECRET&next=%2Fauth%2Fset-initial-password&attempt=fia_secret",
        );

        const joined = `${capture.info.join(" ")} ${capture.error.join(" ")}`;
        assert.equal(joined.includes("ULTRA-SECRET"), false);
        assert.equal(joined.includes("fia_secret"), false);
        assert.equal(joined.includes('"hasAttempt":true'), true);
      });
    },
  },
];

async function run() {
  for (const testCase of tests) {
    await testCase.run();
  }

  console.log(`auth-callback-route: ${tests.length} tests passed`);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

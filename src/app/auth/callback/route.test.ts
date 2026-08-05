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
    verifyOtp: (args: {
      token_hash: string;
      type: "recovery" | "invite";
    }) => Promise<{ error: unknown }>;
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
  verifyOtpError?: unknown;
  callbackUser?: { id: string } | null;
  initialSessionUser?: { id: string } | null;
  verifiedRecoveryUser?: { id: string } | null;
  getUserError?: unknown;
  exchangeSupabase?: FakeSupabaseClient;
  authUser?: { app_metadata?: Record<string, unknown> | null };
  resolvedFlow?: { flow: string; message: string; attemptState: string };
}) {
  const calls = {
    signOut: 0,
    exchangeCodes: [] as string[],
    verifyOtpCalls: [] as Array<{ token_hash: string; type: "recovery" | "invite" }>,
    resolveAttempts: [] as Array<string | null | undefined>,
    readInviteMetadataCalls: 0,
  };
  let currentSessionUser: { id: string } | null =
    harnessOptions?.initialSessionUser ?? harnessOptions?.callbackUser ?? { id: "user-1" };

  const deps = {
    async createSupabaseClient() {
      return (
        harnessOptions?.exchangeSupabase ?? {
          auth: {
            async signOut() {
              calls.signOut += 1;
              currentSessionUser = null;
            },
            async exchangeCodeForSession(code: string) {
              calls.exchangeCodes.push(code);
              currentSessionUser = harnessOptions?.callbackUser ?? { id: "user-1" };
              return {
                error: harnessOptions?.exchangeError ?? null,
              };
            },
            async verifyOtp(args: {
              token_hash: string;
              type: "recovery" | "invite";
            }) {
              calls.verifyOtpCalls.push(args);

              if (!harnessOptions?.verifyOtpError) {
                currentSessionUser =
                  harnessOptions?.verifiedRecoveryUser ??
                  harnessOptions?.callbackUser ??
                  { id: "user-1" };
              }

              return {
                error: harnessOptions?.verifyOtpError ?? null,
              };
            },
            async getUser() {
              return {
                data: {
                  user: currentSessionUser,
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
        const response = await harness.run(
          "https://example.com/auth/callback?access_token=leaked-token",
        );

        assert.equal(response.status, 307);
        assert.equal(
          response.headers.get("location"),
          "https://example.com/login?authError=Nao+foi+possivel+validar+o+link+recebido.+Peca+um+novo+e-mail.",
        );
        assert.equal(harness.calls.signOut, 1);
        assert.equal(capture.info.join(" ").includes('"hasCode":false'), true);
        assert.equal(capture.info.join(" ").includes("leaked-token"), false);
      });
    },
  },
  {
    name: "successful recovery PKCE callback preserves reset-password path",
    run: async () => {
      const secretCode = "SECRET-CODE-123";
      const harness = await createCallbackHarness();
      const response = await harness.run(
        `https://example.com/auth/callback?code=${encodeURIComponent(secretCode)}&next=${encodeURIComponent("/auth/reset-password")}`,
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://example.com/auth/reset-password",
      );
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
          `https://example.com/auth/callback?code=${encodeURIComponent(secretCode)}&next=${encodeURIComponent("/auth/reset-password")}`,
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
        "https://example.com/login?authError=Nao+foi+possivel+concluir+a+autenticacao.+Tente+novamente+a+partir+do+login.",
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
        "https://example.com/login?authError=Nao+foi+possivel+concluir+a+autenticacao.+Tente+novamente+a+partir+do+login.",
      );
    },
  },
  {
    name: "first-access recovery link without attempt is rejected",
    run: async () => {
      const harness = await createCallbackHarness({
        verifiedRecoveryUser: { id: "user-b" },
      });
      const response = await harness.run(
        "https://example.com/auth/callback?token_hash=recovery_hash_b&type=recovery&next=%2Fauth%2Fset-initial-password",
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://example.com/login?authError=invalid%3Amissing",
      );
      assert.deepEqual(harness.calls.verifyOtpCalls, [
        { token_hash: "recovery_hash_b", type: "recovery" },
      ]);
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
    name: "existing session A plus valid token_hash for account B switches to first-access of account B",
    run: async () => {
      await withCapturedConsole(async (capture) => {
        const harness = await createCallbackHarness({
          initialSessionUser: { id: "user-a" },
          verifiedRecoveryUser: { id: "user-b" },
          authUser: {
            app_metadata: { zion_first_access_invite_id: "fia_b" },
          },
        });
        const response = await harness.run(
          "https://example.com/auth/callback?token_hash=recovery_hash_b&type=recovery&next=%2Fauth%2Fset-initial-password&attempt=fia_b",
        );

        assert.equal(response.status, 307);
        assert.equal(
          response.headers.get("location"),
          "https://example.com/auth/set-initial-password?attempt=fia_b",
        );
        assert.deepEqual(harness.calls.verifyOtpCalls, [
          { token_hash: "recovery_hash_b", type: "recovery" },
        ]);
        assert.deepEqual(harness.calls.exchangeCodes, []);
        assert.deepEqual(harness.calls.resolveAttempts, ["fia_b"]);
        assert.equal(harness.calls.signOut, 1);
        assert.equal(capture.info.join(" ").includes("recovery_hash_b"), false);
      });
    },
  },
  {
    name: "invalid token_hash redirects to login without leaking recovery token",
    run: async () => {
      await withCapturedConsole(async (capture) => {
        const harness = await createCallbackHarness({
          verifyOtpError: {
            message: "otp expired",
            status: 403,
            code: "otp_expired",
          },
        });
        const response = await harness.run(
          "https://example.com/auth/callback?token_hash=invalid_hash&type=recovery&next=%2Fauth%2Freset-password&attempt=fia_b",
        );

        assert.equal(response.status, 307);
        assert.equal(
          response.headers.get("location"),
          "https://example.com/login?authError=O+link+de+recuperacao+expirou+ou+nao+e+mais+valido.+Peca+um+novo+e-mail.",
        );
        assert.equal(harness.calls.signOut, 2);
        const joined = `${capture.info.join(" ")} ${capture.error.join(" ")}`;
        assert.equal(joined.includes("invalid_hash"), false);
      });
    },
  },
  {
    name: "normal recovery via token_hash opens reset-password and does not require attempt",
    run: async () => {
      const harness = await createCallbackHarness({
        initialSessionUser: { id: "user-a" },
        verifiedRecoveryUser: { id: "user-b" },
      });
      const response = await harness.run(
        "https://example.com/auth/callback?token_hash=recovery_hash_b&type=recovery&next=%2Fauth%2Freset-password",
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://example.com/auth/reset-password",
      );
      assert.deepEqual(harness.calls.verifyOtpCalls, [
        { token_hash: "recovery_hash_b", type: "recovery" },
      ]);
      assert.deepEqual(harness.calls.resolveAttempts, []);
    },
  },
  {
    name: "invite token_hash with valid next and attempt redirects to first-access without leaking token",
    run: async () => {
      await withCapturedConsole(async (capture) => {
        const harness = await createCallbackHarness({
          verifiedRecoveryUser: { id: "user-invite" },
          authUser: {
            app_metadata: { zion_first_access_invite_id: "attempt_invite_1" },
          },
        });
        const response = await harness.run(
          "https://example.com/auth/callback?token_hash=invite_hash_123&type=invite&next=%2Fauth%2Fset-initial-password&attempt=attempt_invite_1",
        );

        assert.equal(response.status, 307);
        assert.equal(
          response.headers.get("location"),
          "https://example.com/auth/set-initial-password?attempt=attempt_invite_1",
        );
        assert.deepEqual(harness.calls.verifyOtpCalls, [
          { token_hash: "invite_hash_123", type: "invite" },
        ]);
        assert.deepEqual(harness.calls.resolveAttempts, ["attempt_invite_1"]);
        assert.equal(
          response.headers.get("location")?.includes("invite_hash_123"),
          false,
        );
        const joined = `${capture.info.join(" ")} ${capture.error.join(" ")}`;
        assert.equal(joined.includes("invite_hash_123"), false);
      });
    },
  },
  {
    name: "invite token_hash without attempt fails closed and clears session",
    run: async () => {
      const harness = await createCallbackHarness();
      const response = await harness.run(
        "https://example.com/auth/callback?token_hash=invite_hash_123&type=invite&next=%2Fauth%2Fset-initial-password",
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://example.com/login?authError=invalid%3Amissing",
      );
      assert.deepEqual(harness.calls.verifyOtpCalls, []);
      assert.equal(harness.calls.signOut, 1);
    },
  },
  {
    name: "invite token_hash with next outside first-access fails closed and clears session",
    run: async () => {
      const harness = await createCallbackHarness();
      const response = await harness.run(
        "https://example.com/auth/callback?token_hash=invite_hash_123&type=invite&next=%2Fauth%2Freset-password&attempt=attempt_invite_1",
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://example.com/login?authError=Nao+foi+possivel+concluir+a+autenticacao.+Tente+novamente+a+partir+do+login.",
      );
      assert.deepEqual(harness.calls.verifyOtpCalls, []);
      assert.equal(harness.calls.signOut, 1);
    },
  },
  {
    name: "invite token_hash verifyOtp failure fails closed and clears session",
    run: async () => {
      await withCapturedConsole(async (capture) => {
        const harness = await createCallbackHarness({
          verifyOtpError: {
            message: "invite expired",
            status: 403,
            code: "otp_expired",
          },
        });
        const response = await harness.run(
          "https://example.com/auth/callback?token_hash=invite_hash_123&type=invite&next=%2Fauth%2Fset-initial-password&attempt=attempt_invite_1",
        );

        assert.equal(response.status, 307);
        assert.equal(
          response.headers.get("location"),
          "https://example.com/login?authError=O+link+de+recuperacao+expirou+ou+nao+e+mais+valido.+Peca+um+novo+e-mail.",
        );
        assert.deepEqual(harness.calls.verifyOtpCalls, [
          { token_hash: "invite_hash_123", type: "invite" },
        ]);
        assert.equal(harness.calls.signOut, 2);
        const joined = `${capture.info.join(" ")} ${capture.error.join(" ")}`;
        assert.equal(joined.includes("invite_hash_123"), false);
      });
    },
  },
  {
    name: "token_hash with unsupported type fails closed and clears session",
    run: async () => {
      const harness = await createCallbackHarness();
      const response = await harness.run(
        "https://example.com/auth/callback?token_hash=unknown_hash_123&type=magic_link&next=%2Fauth%2Freset-password",
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://example.com/login?authError=Nao+foi+possivel+concluir+a+autenticacao.+Tente+novamente+a+partir+do+login.",
      );
      assert.deepEqual(harness.calls.verifyOtpCalls, []);
      assert.equal(harness.calls.signOut, 1);
    },
  },
  {
    name: "attempt from another account is rejected after recovery verification",
    run: async () => {
      const harness = await createCallbackHarness({
        verifiedRecoveryUser: { id: "user-b" },
        authUser: {
          app_metadata: { zion_first_access_invite_id: "fia_b" },
        },
        resolvedFlow: {
          flow: "first_access",
          message: "Defina sua primeira senha para concluir o acesso inicial.",
          attemptState: "mismatch",
        },
      });
      const response = await harness.run(
        "https://example.com/auth/callback?token_hash=recovery_hash_b&type=recovery&next=%2Fauth%2Fset-initial-password&attempt=fia_a",
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://example.com/login?authError=invalid%3Amismatch",
      );
      assert.deepEqual(harness.calls.verifyOtpCalls, [
        { token_hash: "recovery_hash_b", type: "recovery" },
      ]);
    },
  },
  {
    name: "substituted first-access link is rejected after recovery verification",
    run: async () => {
      const harness = await createCallbackHarness({
        verifiedRecoveryUser: { id: "user-b" },
        resolvedFlow: {
          flow: "first_access",
          message: "Defina sua primeira senha para concluir o acesso inicial.",
          attemptState: "mismatch",
        },
      });
      const response = await harness.run(
        "https://example.com/auth/callback?token_hash=recovery_hash_b&type=recovery&next=%2Fauth%2Fset-initial-password&attempt=fia_old",
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://example.com/login?authError=invalid%3Amismatch",
      );
    },
  },
  {
    name: "used first-access link is rejected after recovery verification",
    run: async () => {
      const harness = await createCallbackHarness({
        verifiedRecoveryUser: { id: "user-b" },
        resolvedFlow: {
          flow: "recovery",
          message: "Digite sua nova senha para concluir a recuperacao.",
          attemptState: "not_applicable",
        },
      });
      const response = await harness.run(
        "https://example.com/auth/callback?token_hash=recovery_hash_b&type=recovery&next=%2Fauth%2Fset-initial-password&attempt=fia_old",
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://example.com/login?authError=O+link+de+recuperacao+expirou+ou+nao+e+mais+valido.+Peca+um+novo+e-mail.",
      );
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
  {
    name: "logs never leak token_hash or access_token values",
    run: async () => {
      await withCapturedConsole(async (capture) => {
        const harness = await createCallbackHarness({
          verifyOtpError: {
            message: "otp expired",
            status: 403,
            code: "otp_expired",
          },
        });
        await harness.run(
          "https://example.com/auth/callback?token_hash=HASH-SECRET&access_token=ACCESS-SECRET&type=recovery&attempt=fia_secret",
        );

        const joined = `${capture.info.join(" ")} ${capture.error.join(" ")}`;
        assert.equal(joined.includes("HASH-SECRET"), false);
        assert.equal(joined.includes("ACCESS-SECRET"), false);
        assert.equal(joined.includes('"hasTokenHash":true'), true);
      });
    },
  },
  {
    name: "pkce first-access callback without attempt is rejected",
    run: async () => {
      const harness = await createCallbackHarness();
      const response = await harness.run(
        "https://example.com/auth/callback?code=abc&next=%2Fauth%2Fset-initial-password",
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://example.com/login?authError=invalid%3Amissing",
      );
      assert.deepEqual(harness.calls.exchangeCodes, ["abc"]);
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

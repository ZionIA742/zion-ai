"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";


import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getSafeInternalLoginRedirect } from "@/lib/auth-safe-redirect";
import { resolveAuthPublicBaseUrl } from "@/lib/auth-public-url";

type LoginMode = "password" | "code" | "verifyCode" | "forgot";

const RESET_PASSWORD_PATH = "/auth/reset-password";
const AUTH_CALLBACK_PATH = "/auth/callback";
const ACTIVE_STORE_STORAGE_KEY = "zion_active_store_id";

type EnsureSetupResult = {
  ok: boolean;
  status: string;
  message: string;
  destination: "/crm" | "/onboarding" | "/auth/reset-password" | null;
  error?: string;
  details?: string;
};

type ReadyEnsureSetupResult = EnsureSetupResult & {
  ok: true;
  destination: "/crm" | "/onboarding" | "/auth/reset-password";
};

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

function getPostLoginDestination() {
  if (typeof window === "undefined") return null;
  return getSafeInternalLoginRedirect(
    new URLSearchParams(window.location.search).get("redirectTo"),
  );
}

function clearStoredStoreSelection() {
  if (typeof window === "undefined") {
    return;
  }

  const keysToRemove: string[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);

    if (key && key.startsWith(ACTIVE_STORE_STORAGE_KEY)) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    window.localStorage.removeItem(key);
  }
}

async function clearAuthStateForFreshLogin() {
  clearStoredStoreSelection();

  const { error } = await supabase.auth.signOut({ scope: "local" });

  if (error && !String(error.message || "").toLowerCase().includes("session")) {
    throw error;
  }
}

function friendlyAuthError(message: string) {
  const normalized = String(message || "").toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "E-mail ou senha incorretos.";
  }

  if (normalized.includes("email not confirmed")) {
    return "Confirme seu e-mail antes de entrar.";
  }

  if (normalized.includes("email_not_confirmed")) {
    return "Confirme seu e-mail antes de entrar.";
  }

  if (normalized.includes("signup is disabled")) {
    return "A criação de conta ainda não está liberada para este projeto.";
  }

  if (normalized.includes("user not found") || normalized.includes("not found")) {
    return "Não encontrei uma conta liberada com esse e-mail.";
  }

  if (normalized.includes("token") || normalized.includes("otp")) {
    return "Código inválido ou expirado. Peça um novo código.";
  }

  return message || "Não foi possível concluir essa ação.";
}

function getUnknownErrorMessage(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return fallback;
}

async function ensureAccountSetup() {
  const response = await fetch("/api/account/ensure-setup", {
    method: "POST",
  });

  let payload: EnsureSetupResult | null = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.error ||
        payload?.details ||
        "Não foi possível preparar sua conta para entrar no painel.",
    );
  }

  if (!payload?.ok || !payload.destination) {
    throw new Error(
      payload?.message ||
        "Sua conta ainda não está pronta para acessar o sistema. Fale com o time interno do ZION.",
    );
  }

  return payload as ReadyEnsureSetupResult;
}

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<LoginMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => {
    if (mode === "code") return "Entrar por código";
    if (mode === "verifyCode") return "Digite o código";
    if (mode === "forgot") return "Recuperar senha";
    return "Entrar";
  }, [mode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = String(params.get("authError") || "").trim();
    const authSuccess = String(params.get("authSuccess") || "").trim();

    if (authSuccess) {
      setMessage(authSuccess);
      setError(null);
      setMode("password");
      return;
    }

    if (!authError) {
      return;
    }

    setError(friendlyAuthError(authError));
    setMessage(null);
    setMode("password");
  }, []);

  function clearFeedback() {
    setMessage(null);
    setError(null);
  }

  function changeMode(nextMode: LoginMode) {
    clearFeedback();
    setMode(nextMode);
    setCode("");
  }

  async function handlePasswordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();

    const safeEmail = normalizeEmail(email);

    if (!safeEmail || !password) {
      setError("Preencha e-mail e senha.");
      return;
    }

    setBusy(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: safeEmail,
        password,
      });

      if (signInError) throw signInError;

      clearStoredStoreSelection();
      const access = await ensureAccountSetup();

      router.push(getPostLoginDestination() || access.destination);
      router.refresh();
    } catch (authError: unknown) {
      setError(
        friendlyAuthError(getUnknownErrorMessage(authError, "Falha no login.")),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();

    const safeEmail = normalizeEmail(email);

    if (!safeEmail) {
      setError("Digite seu e-mail para receber o código.");
      return;
    }

    setBusy(true);

    try {
      await clearAuthStateForFreshLogin();

      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: safeEmail,
        options: {
          shouldCreateUser: false,
        },
      });

      if (otpError) throw otpError;

      setMessage("Enviamos um código para seu e-mail. Digite o código abaixo para entrar.");
      setMode("verifyCode");
    } catch (authError: unknown) {
      setError(
        friendlyAuthError(
          getUnknownErrorMessage(authError, "Não foi possível enviar o código."),
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();

    const safeEmail = normalizeEmail(email);
    const safeCode = String(code || "").replace(/\s/g, "").trim();

    if (!safeEmail || !safeCode) {
      setError("Preencha o e-mail e o código recebido.");
      return;
    }

    setBusy(true);

    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: safeEmail,
        token: safeCode,
        type: "email",
      });

      if (verifyError) throw verifyError;

      clearStoredStoreSelection();
      const access = await ensureAccountSetup();

      router.push(getPostLoginDestination() || access.destination);
      router.refresh();
    } catch (authError: unknown) {
      setError(
        friendlyAuthError(
          getUnknownErrorMessage(authError, "Código inválido ou expirado."),
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();

    const safeEmail = normalizeEmail(email);

    if (!safeEmail) {
      setError("Digite seu e-mail para recuperar a senha.");
      return;
    }

    setBusy(true);

    try {
      const configuredBaseUrl = resolveAuthPublicBaseUrl({
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
        appUrl: process.env.NEXT_PUBLIC_APP_URL,
        vercelUrl: process.env.NEXT_PUBLIC_VERCEL_URL,
        nodeEnv: process.env.NODE_ENV,
        vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
      });
      const localDevelopmentOrigin = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(
        window.location.hostname,
      )
        ? window.location.origin
        : null;
      const baseUrl = configuredBaseUrl ||
        (process.env.NODE_ENV !== "production" ? localDevelopmentOrigin : null);

      if (!baseUrl) {
        throw new Error("Domínio oficial de autenticação não configurado.");
      }

      const recoveryRedirectUrl = new URL(AUTH_CALLBACK_PATH, baseUrl);
      recoveryRedirectUrl.searchParams.set("next", RESET_PASSWORD_PATH);

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(safeEmail, {
        redirectTo: recoveryRedirectUrl.toString(),
      });

      if (resetError) throw resetError;

      setMessage("Enviamos o link de recuperação para seu e-mail.");
    } catch (authError: unknown) {
      setError(
        friendlyAuthError(
          getUnknownErrorMessage(
            authError,
            "Não foi possível enviar a recuperação.",
          ),
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh w-full max-w-full flex-col overflow-x-hidden bg-[#020e15] text-slate-50">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat sm:hidden"
        style={{
          backgroundImage: 'url("/branding/zion-login-mountains-mobile.webp")',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden bg-cover bg-center bg-no-repeat sm:block"
        style={{
          backgroundImage: 'url("/branding/zion-login-mountains-desktop.webp")',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(1,10,16,0.07), rgba(1,10,16,0.02) 45%, rgba(1,10,16,0.30))",
        }}
      />
      <div className="relative z-10 flex w-full min-w-0 flex-1 items-center justify-center px-3 py-5 sm:px-4 sm:py-8">
        <section className="w-full min-w-0 max-w-[420px] rounded-[22px] border border-cyan-400/65 bg-[#04131b]/90 p-5 shadow-[0_26px_85px_rgba(0,0,0,0.60)] backdrop-blur-lg sm:p-6">
        <div className="mb-5 flex items-center justify-center">
          <h1
            className="font-serif text-[52px] font-normal leading-none tracking-[-0.045em] text-white drop-shadow-sm sm:text-[56px]"
            aria-label="ZION"
          >
            Zion
          </h1>
        </div>

        <h2 className="mb-5 text-center text-[25px] font-semibold tracking-[-0.02em] text-white">{title}</h2>

        {message ? (
          <div className="mb-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.08] px-4 py-3 text-sm leading-6 text-emerald-100">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-2xl border border-red-400/25 bg-red-500/[0.08] px-4 py-3 text-sm leading-6 text-red-100">
            {error}
          </div>
        ) : null}

        {mode === "password" ? (
          <form onSubmit={handlePasswordLogin} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-200">E-mail</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5 w-full rounded-[14px] border border-slate-300/35 bg-[#0b2530]/85 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-slate-400 focus:border-cyan-300/80 focus:ring-2 focus:ring-cyan-300/15"
                placeholder="seu@email.com"
                type="email"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-200">Senha</label>
              <div className="relative mt-1.5">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-[14px] border border-slate-300/35 bg-[#0b2530]/85 px-4 py-3 pr-12 text-sm text-zinc-100 outline-none transition placeholder:text-slate-400 focus:border-cyan-300/80 focus:ring-2 focus:ring-cyan-300/15"
                  placeholder="••••••••"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute inset-y-0 right-3 flex items-center justify-center rounded-xl px-2 text-zinc-500 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  title={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M17.94 17.94A10.9 10.9 0 0 1 12 20C7 20 2.73 16.89 1 12a12.6 12.6 0 0 1 3.06-4.94" />
                      <path d="M9.9 4.24A10.8 10.8 0 0 1 12 4c5 0 9.27 3.11 11 8a12.6 12.6 0 0 1-1.5 2.63" />
                      <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
                      <path d="M1 1l22 22" />
                    </svg>
                  ) : (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-[14px] bg-cyan-400 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Entrando..." : "Entrar"}
              </button>

              <button
                type="button"
                onClick={() => changeMode("code")}
                disabled={busy}
                className="rounded-[14px] border border-cyan-400/65 bg-[#0b2530]/75 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Código
              </button>
            </div>
          </form>
        ) : null}

        {mode === "code" ? (
          <form onSubmit={handleSendCode} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-200">E-mail</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5 w-full rounded-[14px] border border-slate-300/35 bg-[#0b2530]/85 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-slate-400 focus:border-cyan-300/80 focus:ring-2 focus:ring-cyan-300/15"
                placeholder="seu@email.com"
                type="email"
                autoComplete="email"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-[14px] bg-cyan-400 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Enviando..." : "Enviar código"}
            </button>
          </form>
        ) : null}

        {mode === "verifyCode" ? (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-200">E-mail</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5 w-full rounded-[14px] border border-slate-300/35 bg-[#0b2530]/85 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-slate-400 focus:border-cyan-300/80 focus:ring-2 focus:ring-cyan-300/15"
                placeholder="seu@email.com"
                type="email"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-200">Código</label>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="mt-1.5 w-full rounded-[14px] border border-slate-300/35 bg-[#0b2530]/85 px-4 py-3 text-center text-lg font-bold tracking-[0.35em] text-zinc-100 outline-none transition placeholder:text-slate-400 focus:border-cyan-300/80 focus:ring-2 focus:ring-cyan-300/15"
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-[14px] bg-cyan-400 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Validando..." : "Entrar com código"}
            </button>

            <button
              type="button"
              onClick={() => changeMode("code")}
              disabled={busy}
              className="w-full rounded-[14px] border border-white/10 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Enviar novo código
            </button>
          </form>
        ) : null}

        {mode === "forgot" ? (
          <form onSubmit={handleForgotPassword} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-200">E-mail</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5 w-full rounded-[14px] border border-slate-300/35 bg-[#0b2530]/85 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-slate-400 focus:border-cyan-300/80 focus:ring-2 focus:ring-cyan-300/15"
                placeholder="seu@email.com"
                type="email"
                autoComplete="email"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-[14px] bg-cyan-400 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Enviando..." : "Recuperar senha"}
            </button>
          </form>
        ) : null}

        <div className="mt-4 grid gap-2">
          {mode !== "forgot" ? (
            <button
              type="button"
              onClick={() => changeMode("forgot")}
              className="w-full rounded-[14px] border border-white/10 px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
            >
              Esqueci a senha
            </button>
          ) : null}

          {mode !== "password" ? (
            <button
              type="button"
              onClick={() => changeMode("password")}
              className="w-full rounded-[14px] border border-white/10 px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
            >
              Voltar para login
            </button>
          ) : null}
        </div>
        </section>
      </div>

      <footer className="relative z-10 px-4 pb-5 pt-5">
        <div className="mx-auto flex max-w-md flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-center text-[13px] text-slate-300">
          <Link
            href="/privacy-policy"
            className="transition hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            Política de Privacidade
          </Link>
          <span className="text-zinc-600" aria-hidden="true">
            |
          </span>
          <Link
            href="/terms-of-service"
            className="transition hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            Termos de Serviço
          </Link>
          <span className="text-zinc-600" aria-hidden="true">
            |
          </span>
          <Link
            href="/data-deletion"
            className="transition hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            Exclusão de Dados
          </Link>
        </div>
        <p className="mt-2.5 text-center text-xs text-zinc-500">
          ZION INOVA SIMPLES (I.S.)
        </p>
      </footer>
    </main>
  );
}

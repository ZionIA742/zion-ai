"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type LoginMode = "password" | "code" | "verifyCode" | "forgot" | "signup";

const PANEL_PATH = "/crm";
const RESET_PASSWORD_PATH = "/auth/reset-password";
const AUTH_CALLBACK_PATH = "/auth/callback";
const ACTIVE_STORE_STORAGE_KEY = "zion_active_store_id";

function getBaseUrl() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

function validateStrongPassword(password: string) {
  const value = String(password || "").trim();

  return (
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[@.!?$%#&*-]/.test(value)
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

async function ensureAccountSetup() {
  const response = await fetch("/api/account/ensure-setup", {
    method: "POST",
  });

  let payload: any = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.error ||
        payload?.details ||
        "NÃ£o foi possÃ­vel preparar sua conta para entrar no painel.",
    );
  }

  return payload;
}

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<LoginMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => {
    if (mode === "code") return "Entrar por código";
    if (mode === "verifyCode") return "Digite o código";
    if (mode === "forgot") return "Recuperar senha";
    if (mode === "signup") return "Criar conta";
    return "Entrar";
  }, [mode]);

  useEffect(() => {
    const authError = String(
      new URLSearchParams(window.location.search).get("authError") || ""
    ).trim();

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
    if (nextMode !== "signup") {
      setConfirmPassword("");
    }
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
      await ensureAccountSetup();

      router.push(PANEL_PATH);
      router.refresh();
    } catch (authError: any) {
      setError(friendlyAuthError(authError?.message || "Falha no login."));
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
    } catch (authError: any) {
      setError(friendlyAuthError(authError?.message || "Não foi possível enviar o código."));
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
      await ensureAccountSetup();

      router.push(PANEL_PATH);
      router.refresh();
    } catch (authError: any) {
      setError(friendlyAuthError(authError?.message || "Código inválido ou expirado."));
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
      const recoveryRedirectUrl = `${getBaseUrl()}${AUTH_CALLBACK_PATH}?next=${encodeURIComponent(
        RESET_PASSWORD_PATH,
      )}`;

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(safeEmail, {
        redirectTo: recoveryRedirectUrl,
      });

      if (resetError) throw resetError;

      setMessage("Enviamos o link de recuperação para seu e-mail.");
    } catch (authError: any) {
      setError(friendlyAuthError(authError?.message || "Não foi possível enviar a recuperação."));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();

    const safeEmail = normalizeEmail(email);

    if (!safeEmail || !password || !confirmPassword) {
      setError("Preencha e-mail, senha e confirmação da senha.");
      return;
    }

    if (!validateStrongPassword(password)) {
      setError(
        "A senha precisa ter pelo menos 8 caracteres, uma letra maiúscula, um número e um caractere especial."
      );
      return;
    }

    if (password !== confirmPassword) {
      setError("As senhas não conferem.");
      return;
    }

    setBusy(true);

    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: safeEmail,
        password,
        options: {
          emailRedirectTo: `${getBaseUrl()}${AUTH_CALLBACK_PATH}?next=${encodeURIComponent(
            PANEL_PATH,
          )}`,
        },
      });

      if (signUpError) throw signUpError;

      if (signUpData.session) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) throw signOutError;
      }

      setMessage("Conta criada. Confirme seu e-mail antes de entrar.");
      setMode("password");
      setPassword("");
      setConfirmPassword("");
    } catch (authError: any) {
      setError(friendlyAuthError(authError?.message || "Não foi possível criar a conta."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-10 text-zinc-50">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-900/70 p-6 shadow-2xl shadow-black/30">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-sm font-black tracking-tight text-black">
            Z
          </div>
          <h1 className="text-2xl font-bold tracking-tight">ZION</h1>
        </div>



        <h2 className="mb-4 text-lg font-bold">{title}</h2>

        {message ? (
          <div className="mb-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {mode === "password" ? (
          <form onSubmit={handlePasswordLogin} className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-zinc-300">E-mail</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm outline-none transition focus:border-white/30"
                placeholder="seu@email.com"
                type="email"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-300">Senha</label>
              <div className="relative mt-1">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 pr-12 text-sm outline-none transition focus:border-white/30"
                  placeholder="••••••••"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute inset-y-0 right-3 flex items-center justify-center rounded-xl px-2 text-zinc-400 transition hover:text-white"
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
                className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Entrando..." : "Entrar"}
              </button>

              <button
                type="button"
                onClick={() => changeMode("code")}
                disabled={busy}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Código
              </button>
            </div>
          </form>
        ) : null}

        {mode === "code" ? (
          <form onSubmit={handleSendCode} className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-zinc-300">E-mail</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm outline-none transition focus:border-white/30"
                placeholder="seu@email.com"
                type="email"
                autoComplete="email"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Enviando..." : "Enviar código"}
            </button>
          </form>
        ) : null}

        {mode === "verifyCode" ? (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-zinc-300">E-mail</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm outline-none transition focus:border-white/30"
                placeholder="seu@email.com"
                type="email"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-300">Código</label>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-center text-lg font-bold tracking-[0.35em] outline-none transition focus:border-white/30"
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Validando..." : "Entrar com código"}
            </button>

            <button
              type="button"
              onClick={() => changeMode("code")}
              disabled={busy}
              className="w-full rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Enviar novo código
            </button>
          </form>
        ) : null}

        {mode === "forgot" ? (
          <form onSubmit={handleForgotPassword} className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-zinc-300">E-mail</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm outline-none transition focus:border-white/30"
                placeholder="seu@email.com"
                type="email"
                autoComplete="email"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Enviando..." : "Recuperar senha"}
            </button>
          </form>
        ) : null}

        {mode === "signup" ? (
          <form onSubmit={handleCreateAccount} className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-zinc-300">E-mail</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm outline-none transition focus:border-white/30"
                placeholder="seu@email.com"
                type="email"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-300">Senha</label>
              <div className="relative mt-1">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 pr-12 text-sm outline-none transition focus:border-white/30"
                  placeholder="••••••••"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute inset-y-0 right-3 flex items-center justify-center rounded-xl px-2 text-zinc-400 transition hover:text-white"
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

            <div>
              <label className="text-xs font-semibold text-zinc-300">Confirmar senha</label>
              <div className="relative mt-1">
                <input
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 pr-12 text-sm outline-none transition focus:border-white/30"
                  placeholder="••••••••"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  className="absolute inset-y-0 right-3 flex items-center justify-center rounded-xl px-2 text-zinc-400 transition hover:text-white"
                  aria-label={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}
                  title={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showConfirmPassword ? (
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

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Criando..." : "Criar conta"}
            </button>
          </form>
        ) : null}

        <div className="mt-5 grid gap-2">
          {mode !== "forgot" ? (
            <button
              type="button"
              onClick={() => changeMode("forgot")}
              className="w-full rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
            >
              Esqueci a senha
            </button>
          ) : null}

          {mode !== "signup" ? (
            <button
              type="button"
              onClick={() => changeMode("signup")}
              className="w-full rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
            >
              Criar conta
            </button>
          ) : null}

          {mode !== "password" ? (
            <button
              type="button"
              onClick={() => changeMode("password")}
              className="w-full rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
            >
              Voltar para login
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}

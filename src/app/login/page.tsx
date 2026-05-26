"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type LoginMode = "password" | "code" | "verifyCode" | "forgot" | "signup";

const PANEL_PATH = "/crm";
const RESET_PASSWORD_PATH = "/auth/reset-password";

function getBaseUrl() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

function friendlyAuthError(message: string) {
  const normalized = String(message || "").toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "E-mail ou senha incorretos.";
  }

  if (normalized.includes("email not confirmed")) {
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

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<LoginMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: safeEmail,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${getBaseUrl()}${PANEL_PATH}`,
        },
      });

      if (otpError) throw otpError;

      setMessage("Código enviado para seu e-mail. Ele expira em 10 minutos.");
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
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(safeEmail, {
        redirectTo: `${getBaseUrl()}${RESET_PASSWORD_PATH}`,
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

    if (password.length < 6) {
      setError("Use uma senha com pelo menos 6 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("As senhas não conferem.");
      return;
    }

    setBusy(true);

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: safeEmail,
        password,
        options: {
          emailRedirectTo: `${getBaseUrl()}${PANEL_PATH}`,
        },
      });

      if (signUpError) throw signUpError;

      setMessage("Conta criada. Confira seu e-mail para confirmar o acesso.");
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
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-sm font-black tracking-tight text-black">
            Z
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">ZION</h1>
          <p className="mt-1 text-sm text-zinc-400">Acesse sua loja</p>
        </div>

        <div className="mb-5 rounded-2xl border border-white/10 bg-black/20 p-1">
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => changeMode("password")}
              className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                mode === "password" ? "bg-white text-black" : "text-zinc-300 hover:bg-white/10"
              }`}
            >
              Senha
            </button>
            <button
              type="button"
              onClick={() => changeMode("code")}
              className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                mode === "code" || mode === "verifyCode"
                  ? "bg-white text-black"
                  : "text-zinc-300 hover:bg-white/10"
              }`}
            >
              Código
            </button>
          </div>
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
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm outline-none transition focus:border-white/30"
                placeholder="••••••••"
                type="password"
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Entrando..." : "Entrar"}
            </button>
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
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm outline-none transition focus:border-white/30"
                placeholder="••••••••"
                type="password"
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-300">Confirmar senha</label>
              <input
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm outline-none transition focus:border-white/30"
                placeholder="••••••••"
                type="password"
                autoComplete="new-password"
              />
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

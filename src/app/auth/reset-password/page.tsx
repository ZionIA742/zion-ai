"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RecoveryStatus = "checking" | "ready" | "saving" | "success" | "error";

function getFriendlyErrorMessage(message: string | null | undefined) {
  const normalized = String(message || "").toLowerCase();

  if (!normalized) {
    return "Nao foi possivel continuar. Tente abrir o link novamente.";
  }

  if (normalized.includes("expired") || normalized.includes("invalid")) {
    return "Esse link expirou ou nao e mais valido. Volte para o login e peca um novo link.";
  }

  if (normalized.includes("same password")) {
    return "A nova senha precisa ser diferente da senha atual.";
  }

  if (normalized.includes("weak") || normalized.includes("password")) {
    return "Use uma senha mais forte, com pelo menos 8 caracteres, uma letra maiuscula, um numero e um caractere especial.";
  }

  return message || "Nao foi possivel continuar. Tente novamente.";
}

function getRecoveryLinkErrorMessage(params: URLSearchParams) {
  const error = params.get("error");
  const errorCode = params.get("error_code");
  const errorDescription = params.get("error_description");
  const recoveryError = params.get("recoveryError");

  if (!error && !errorCode && !errorDescription && !recoveryError) {
    return null;
  }

  return "Este link expirou ou e invalido. Solicite uma nova recuperacao de senha.";
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

async function fetchPasswordFlow() {
  const response = await fetch("/api/account/password-flow", {
    method: "GET",
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.flow) {
    throw new Error(
      payload?.message || "Nao foi possivel validar o fluxo seguro desta conta.",
    );
  }

  return payload as { flow: string; message: string };
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<RecoveryStatus>("checking");
  const [message, setMessage] = useState("Validando link...");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function prepareRecoverySession() {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const recoveryLinkError = getRecoveryLinkErrorMessage(params);

        if (code) {
          const callbackUrl = new URL("/auth/callback", window.location.origin);
          callbackUrl.searchParams.set("code", code);
          callbackUrl.searchParams.set("next", "/auth/reset-password");
          window.location.replace(callbackUrl.toString());
          return;
        }

        if (recoveryLinkError) {
          if (cancelled) return;
          setStatus("error");
          setMessage(recoveryLinkError);
          return;
        }

        const { data, error } = await supabase.auth.getSession();

        if (cancelled) return;

        if (error || !data.session) {
          setStatus("error");
          setMessage("Link nao encontrado. Volte para o login e peca um novo link.");
          return;
        }

        const trustedFlow = await fetchPasswordFlow();

        if (cancelled) return;

        if (trustedFlow.flow !== "recovery") {
          setStatus("error");
          setMessage(
            trustedFlow.flow === "first_access"
              ? "Este link nao pertence a recuperacao comum. Use o convite mais recente para criar a primeira senha."
              : trustedFlow.message,
          );
          return;
        }

        setStatus("ready");
        setMessage(trustedFlow.message);
      } catch (error: unknown) {
        if (cancelled) return;
        setStatus("error");
        setMessage(
          getFriendlyErrorMessage(
            getUnknownErrorMessage(error, "Nao foi possivel validar o link."),
          ),
        );
      }
    }

    void prepareRecoverySession();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (status !== "ready") {
      return;
    }

    const nextPassword = password.trim();
    const nextConfirmPassword = confirmPassword.trim();

    if (
      nextPassword.length < 8 ||
      !/[A-Z]/.test(nextPassword) ||
      !/\d/.test(nextPassword) ||
      !/[@.!?$%#&*-]/.test(nextPassword)
    ) {
      setStatus("error");
      setMessage(
        "A senha precisa ter pelo menos 8 caracteres, uma letra maiuscula, um numero e um caractere especial.",
      );
      return;
    }

    if (nextPassword !== nextConfirmPassword) {
      setStatus("error");
      setMessage("As senhas nao estao iguais.");
      return;
    }

    setStatus("saving");
    setMessage("Salvando nova senha...");

    try {
      const { error } = await supabase.auth.updateUser({
        password: nextPassword,
      });

      if (error) {
        setStatus("error");
        setMessage(getFriendlyErrorMessage(error.message ?? ""));
        return;
      }

      setPassword("");
      setConfirmPassword("");
      setStatus("success");
      setMessage("Senha alterada com sucesso.");

      window.setTimeout(() => {
        router.replace("/login");
      }, 700);
    } catch (error: unknown) {
      setStatus("error");
      setMessage(
        getFriendlyErrorMessage(
          getUnknownErrorMessage(error, "Nao foi possivel salvar a nova senha."),
        ),
      );
    }
  }

  const isSaving = status === "saving";
  const canSubmit =
    status === "ready" && password.trim().length > 0 && confirmPassword.trim().length > 0;
  const shouldShowForm = status === "ready" || status === "saving";

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-6 shadow-sm">
        <div className="text-center">
          <div className="text-2xl font-black tracking-tight">ZION</div>
          <div className="mt-1 text-sm text-zinc-400">Recuperar senha</div>
        </div>

        <div
          className={[
            "mt-5 rounded-2xl border px-4 py-3 text-sm",
            status === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
              : status === "error"
                ? "border-red-500/30 bg-red-500/10 text-red-100"
                : "border-white/10 bg-white/[0.04] text-zinc-200",
          ].join(" ")}
        >
          {message}
        </div>

        {shouldShowForm ? (
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <div>
              <label className="text-xs text-zinc-400">Nova senha</label>
              <div className="relative mt-1">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  disabled={status !== "ready"}
                  className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 pr-11 text-sm text-white outline-none focus:border-white/30 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="Digite a nova senha"
                  autoComplete="new-password"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  disabled={status !== "ready"}
                  className="absolute inset-y-0 right-2 flex items-center justify-center rounded-xl px-2 text-zinc-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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
              <label className="text-xs text-zinc-400">Confirmar senha</label>
              <div className="relative mt-1">
                <input
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type={showConfirmPassword ? "text" : "password"}
                  disabled={status !== "ready"}
                  className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 pr-11 text-sm text-white outline-none focus:border-white/30 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="Repita a nova senha"
                  autoComplete="new-password"
                />

                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  disabled={status !== "ready"}
                  className="absolute inset-y-0 right-2 flex items-center justify-center rounded-xl px-2 text-zinc-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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
              disabled={isSaving || !canSubmit}
              className="w-full rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Salvando..." : "Salvar nova senha"}
            </button>
          </form>
        ) : null}

        <button
          type="button"
          onClick={() => router.replace("/login")}
          className="mt-3 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white hover:bg-white/[0.08]"
        >
          Voltar para o login
        </button>
      </div>
    </div>
  );
}

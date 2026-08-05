"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { validatePasswordPolicy } from "@/lib/password-policy";
import { FIRST_ACCESS_SUCCESS_MESSAGE } from "@/lib/zion-account-provisioning-shared";

type FirstAccessStatus = "checking" | "ready" | "saving" | "error";

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

function getFriendlyFirstAccessError(message: string | null | undefined) {
  const normalized = String(message || "").toLowerCase();

  if (!normalized) {
    return "Nao foi possivel validar este convite. Peca um novo link.";
  }

  if (
    normalized.includes("expired") ||
    normalized.includes("invalid") ||
    normalized.includes("substituido")
  ) {
    return "Este link expirou, foi substituido ou nao e mais valido. Peca um novo convite.";
  }

  if (normalized.includes("session")) {
    return "Nao foi possivel abrir a sessao temporaria do convite. Peca um novo link.";
  }

  return message || "Nao foi possivel concluir o primeiro acesso.";
}

async function fetchPasswordFlow(attempt: string) {
  const response = await fetch(
    `/api/account/password-flow?attempt=${encodeURIComponent(attempt)}`,
    {
      method: "GET",
    },
  );

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.flow) {
    throw new Error(
      payload?.message || "Nao foi possivel validar o fluxo seguro desta conta.",
    );
  }

  return payload as {
    flow: string;
    message: string;
    attemptValid: boolean | null;
    requiresNewLogin?: boolean;
  };
}

async function clearTemporarySession() {
  await supabase.auth.signOut({ scope: "local" });
}

async function completeFirstAccess(attempt: string) {
  const response = await fetch("/api/account/first-access/complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ attempt }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.ok) {
    throw new Error(
      payload?.error ||
        "A senha foi criada, mas ainda falta concluir a liberacao segura do primeiro acesso.",
    );
  }
}

export default function SetInitialPasswordClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<FirstAccessStatus>("checking");
  const [message, setMessage] = useState("Validando convite...");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const attempt = useMemo(
    () => String(searchParams.get("attempt") || "").trim(),
    [searchParams],
  );
  const policy = useMemo(() => validatePasswordPolicy(password), [password]);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  useEffect(() => {
    let cancelled = false;

    async function prepareFirstAccess() {
      try {
        if (!attempt) {
          throw new Error("missing invite attempt");
        }

        const { data, error } = await supabase.auth.getSession();

        if (cancelled) return;

        if (error || !data.session) {
          throw new Error("missing temporary session");
        }

        const flow = await fetchPasswordFlow(attempt);

        if (cancelled) return;

        if (flow.flow !== "first_access" || flow.attemptValid !== true) {
          await clearTemporarySession().catch(() => undefined);
          throw new Error(flow.message);
        }

        setStatus("ready");
        setMessage(flow.message);
      } catch (error: unknown) {
        if (cancelled) return;
        await clearTemporarySession().catch(() => undefined);
        setStatus("error");
        setMessage(
          getFriendlyFirstAccessError(
            getUnknownErrorMessage(error, "Nao foi possivel validar o convite."),
          ),
        );
      }
    }

    void prepareFirstAccess();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (status !== "ready") {
      return;
    }

    if (!policy.isValid) {
      setStatus("error");
      setMessage(
        "A senha precisa ter pelo menos 8 caracteres, uma letra maiuscula, uma minuscula, um numero, um caractere especial e nao pode conter apenas espacos.",
      );
      return;
    }

    if (!passwordsMatch) {
      setStatus("error");
      setMessage("As duas senhas precisam ser iguais.");
      return;
    }

    setStatus("saving");
    setMessage("Salvando primeira senha...");

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        throw error;
      }

      await completeFirstAccess(attempt);
      await supabase.auth.signOut({ scope: "global" }).catch(() => undefined);
      await clearTemporarySession().catch(() => undefined);
      router.replace(`/login?authSuccess=${encodeURIComponent(FIRST_ACCESS_SUCCESS_MESSAGE)}`);
    } catch (error: unknown) {
      setStatus("error");
      setMessage(
        getFriendlyFirstAccessError(
          getUnknownErrorMessage(error, "Nao foi possivel concluir o primeiro acesso."),
        ),
      );
    }
  }

  const canSubmit =
    status === "ready" &&
    policy.isValid &&
    passwordsMatch &&
    password.length > 0 &&
    confirmPassword.length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-6 shadow-sm">
        <div className="text-center">
          <div className="text-2xl font-black tracking-tight">ZION</div>
          <div className="mt-1 text-sm text-zinc-400">Criar primeira senha</div>
        </div>

        <div
          className={[
            "mt-5 rounded-2xl border px-4 py-3 text-sm",
            status === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-100"
              : "border-white/10 bg-white/[0.04] text-zinc-200",
          ].join(" ")}
        >
          {message}
        </div>

        {status === "ready" || status === "saving" ? (
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <div>
              <label className="text-xs text-zinc-400">Nova senha</label>
              <div className="relative mt-1">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  disabled={status !== "ready"}
                  className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 pr-20 text-sm text-white outline-none focus:border-white/30 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="Digite a nova senha"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  disabled={status !== "ready"}
                  className="absolute inset-y-0 right-2 flex items-center justify-center rounded-xl px-2 text-zinc-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-400">Confirmar nova senha</label>
              <div className="relative mt-1">
                <input
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type={showConfirmPassword ? "text" : "password"}
                  disabled={status !== "ready"}
                  className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 pr-20 text-sm text-white outline-none focus:border-white/30 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="Repita a nova senha"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  disabled={status !== "ready"}
                  className="absolute inset-y-0 right-2 flex items-center justify-center rounded-xl px-2 text-zinc-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showConfirmPassword ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-zinc-900/40 px-4 py-3 text-xs leading-5 text-zinc-300">
              <div>Pelo menos 8 caracteres</div>
              <div>Ao menos uma letra maiuscula</div>
              <div>Ao menos uma letra minuscula</div>
              <div>Ao menos um numero</div>
              <div>Ao menos um caractere especial</div>
            </div>

            <button
              type="submit"
              disabled={status === "saving" || !canSubmit}
              className="w-full rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "saving" ? "Salvando..." : "Criar senha"}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

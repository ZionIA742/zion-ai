"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ZionAdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw new Error("Email ou senha inválidos.");
      }

      const authenticatedUser = data.user;

      if (!authenticatedUser?.id) {
        await supabase.auth.signOut();
        throw new Error("NÃ£o foi possÃ­vel validar o usuÃ¡rio autenticado.");
      }

      const { data: admin, error: adminError } = await supabase
        .from("zion_internal_admins")
        .select("id, role, is_active")
        .eq("user_id", authenticatedUser.id)
        .eq("is_active", true)
        .maybeSingle();

      if (adminError || !admin) {
        await supabase.auth.signOut();
        throw new Error("Este usuário não tem acesso ao painel interno do ZION.");
      }

      router.push("/zion-admin");
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao entrar no painel interno.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="relative isolate flex min-h-dvh w-full flex-col overflow-x-hidden bg-[#020e15] text-slate-50"
      style={{ colorScheme: "dark" }}
    >
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
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(1,10,16,0.08),rgba(1,10,16,0.03)_45%,rgba(1,10,16,0.28))]"
      />
      <div className="relative z-10 flex min-h-dvh w-full min-w-0 items-center justify-center px-4 py-8 sm:py-10">
        <section className="w-full min-w-0 max-w-[500px] rounded-[24px] border border-cyan-400/70 bg-[#04131b]/90 p-6 shadow-[0_28px_85px_rgba(0,0,0,0.62)] backdrop-blur-lg sm:p-8">
          <div className="mb-6 text-center font-serif text-[40px] leading-none tracking-[-0.04em] sm:text-[46px]">
            <span className="text-white">ZION</span>{" "}
            <span className="text-cyan-400">ADM</span>
          </div>





        {err && (
          <div className="mt-4 rounded-2xl border border-red-600/40 bg-red-600/10 px-4 py-3 text-sm text-red-100">
            {err}
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-200">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full min-w-0 rounded-[14px] border border-slate-300/35 bg-[#0b2530]/90 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20"
              placeholder="admin@zion.com"
              autoComplete="email"
              type="email"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-200">Senha</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="mt-1.5 w-full min-w-0 rounded-[14px] border border-slate-300/35 bg-[#0b2530]/90 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button
            disabled={busy}
            className="w-full rounded-[14px] bg-cyan-400 px-4 py-3 text-sm font-semibold text-[#00151e] transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Entrando..." : "Entrar no painel interno"}
          </button>
        </form>
        </section>
      </div>
    </main>
  );
}

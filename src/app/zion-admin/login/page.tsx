"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ArrowIcon, LockIcon, MailIcon, SacredCircuitFrame, ShieldLockIcon } from "@/components/auth/SacredCircuitFrame";

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
          backgroundImage: 'url("/branding/zion-sacred-circuit-mobile.webp")',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden bg-cover bg-center bg-no-repeat sm:block"
        style={{
          backgroundImage: 'url("/branding/zion-sacred-circuit-desktop.webp")',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(1,10,16,0.08),rgba(1,10,16,0.03)_45%,rgba(1,10,16,0.28))]"
      />
      <div className="relative z-10 flex min-h-dvh w-full min-w-0 items-center justify-center px-4 py-8 sm:py-10">
        <SacredCircuitFrame variant="admin">
          <div className="mb-5 text-center text-cyan-300">
            <ShieldLockIcon />
          </div>
          <div className="mb-3 text-center font-serif text-[40px] leading-none tracking-[-0.04em] sm:text-[46px]">
            <span className="text-white">ZION</span>{" "}
            <span className="text-cyan-400">ADM</span>
          </div>
          <p className="text-center text-[10px] font-medium uppercase tracking-[0.38em] text-slate-300">Painel administrativo</p>
          <p className="mt-3 text-center text-[9px] uppercase tracking-[0.28em] text-slate-400">Controle · Configuração · Segurança</p>
          <h1 className="mt-5 text-center text-xl font-semibold text-white">Entrar no painel interno</h1>


        {err && (
          <div className="mt-4 rounded-2xl border border-red-600/40 bg-red-600/10 px-4 py-3 text-sm text-red-100">
            {err}
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-200">Email</label>
            <div className="relative mt-1.5"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-200"><MailIcon /></span><input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full min-w-0 border border-slate-300/40 bg-[#0b2530]/90 px-10 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20"
              placeholder="admin@zion.com"
              autoComplete="email"
              type="email"
            /></div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-200">Senha</label>
            <div className="relative mt-1.5"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-200"><LockIcon /></span><input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="w-full min-w-0 border border-slate-300/40 bg-[#0b2530]/90 px-10 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20"
              placeholder="••••••••"
              autoComplete="current-password"
            /></div>
          </div>

          <button
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-[#00151e] transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            style={{ clipPath: "polygon(0 10px, 10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px))" }}
          >
            {busy ? "Entrando..." : <> <ShieldLockIcon className="h-4 w-4" /> Entrar no painel interno <ArrowIcon /></>}
          </button>
        </form>
        </SacredCircuitFrame>
      </div>
    </main>
  );
}

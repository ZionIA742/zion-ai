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
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw new Error("Email ou senha inválidos.");
      }

      const { data: admin, error: adminError } = await supabase
        .from("zion_internal_admins")
        .select("id, role, is_active")
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
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-sm">
        <div className="text-sm font-medium uppercase tracking-[0.22em] text-zinc-500">
          ZION Interno
        </div>

        <div className="mt-3 text-2xl font-semibold">
          Entrar no painel interno
        </div>

        <div className="mt-2 text-sm leading-6 text-zinc-400">
          Área exclusiva para o dono e sócios do ZION. Assinantes das lojas não
          têm acesso a esta área.
        </div>

        {err && (
          <div className="mt-4 rounded-2xl border border-red-600/40 bg-red-600/10 px-4 py-3 text-sm text-red-100">
            {err}
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <div>
            <label className="text-xs text-zinc-400">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-white/10 bg-zinc-950/40 px-3 py-2 text-sm outline-none focus:border-white/20"
              placeholder="admin@zion.com"
              autoComplete="email"
              type="email"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400">Senha</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="mt-1 w-full rounded-2xl border border-white/10 bg-zinc-950/40 px-3 py-2 text-sm outline-none focus:border-white/20"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button
            disabled={busy}
            className="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15 disabled:opacity-60"
          >
            {busy ? "Entrando..." : "Entrar no painel interno"}
          </button>
        </form>
      </div>
    </div>
  );
}
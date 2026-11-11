"use client";

import { useState } from "react";

export default function ZionAdminWhatsappNumberChange({
  organizationId,
  storeId,
  storeName,
  emailMasked,
  canAccess,
}: {
  organizationId: string;
  storeId: string;
  storeName: string;
  emailMasked: string;
  canAccess: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendLink() {
    if (busy || !canAccess) return;
    if (!window.confirm(`Enviar o link de troca de WhatsApp de ${storeName} para ${emailMasked}?`)) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/zion-admin/whatsapp-number-change", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, storeId, action: "create" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error || "Não foi possível preparar o link.");
      setMessage(`Link enviado para ${body.emailMasked}. Validade até ${new Date(body.expiresAt).toLocaleString("pt-BR")}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível preparar o link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#29313b] bg-[#10141b] p-3 text-sm text-zinc-300">
      <div className="flex items-start gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#18313c] text-[#7bd9e2]">↔</span>
        <div>
          <h4 className="text-[12px] font-semibold text-zinc-100">Trocar número comercial</h4>
          <p className="mt-0.5 text-[10px] leading-4 text-[#8e98aa]">Envie um link seguro para o responsável conectar um novo número de WhatsApp.</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <div><div className="text-[10px] text-zinc-500">Destino</div><div className="text-xs text-zinc-200">{emailMasked || "indisponível"}</div></div>
        <div><div className="text-[10px] text-zinc-500">Escopo</div><div className="text-xs text-zinc-200">{storeName}</div></div>
      </div>
      <button type="button" onClick={() => void sendLink()} disabled={!canAccess || busy || !emailMasked} className="mt-3 w-full rounded-lg border border-cyan-400/30 bg-cyan-500/15 px-3 py-2 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? "Preparando..." : "Trocar WhatsApp"}
      </button>
      {message ? <p className="mt-2 text-[10px] leading-4 text-emerald-200">{message}</p> : null}
      {error ? <p className="mt-2 text-[10px] leading-4 text-red-200">{error}</p> : null}
    </div>
  );
}

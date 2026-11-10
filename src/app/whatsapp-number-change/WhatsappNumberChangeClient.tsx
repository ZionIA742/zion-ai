"use client";

import { useEffect, useRef, useState } from "react";
import {
  ensureFacebookSdkLoaded,
  extractMetaEmbeddedSignupSession,
  getMetaEmbeddedSignupConfig,
  classifyMetaEmbeddedSignupMessage,
  type MetaEmbeddedSignupSession,
} from "@/lib/client/meta-embedded-signup";
import { requestNumberChangeLinkStart } from "./number-change-link-start";

export default function WhatsappNumberChangeClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("Sua loja");
  const [currentPhone, setCurrentPhone] = useState("Não informado");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"initial" | "cutover">("initial");
  const codeRef = useRef("");
  const sessionRef = useRef<MetaEmbeddedSignupSession | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/store/whatsapp/number-change-link?token=${encodeURIComponent(token)}`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.ok) throw new Error(body?.error || "Link inválido ou não autorizado.");
        setStoreName(body.store?.name || "Sua loja");
        setCurrentPhone(body.integration?.display_phone_number || "Não informado");
        setStatus(body.link?.status === "started" ? "Troca iniciada" : "Autorização disponível");
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível validar o link."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token]);

  async function submitInitial() {
    const code = codeRef.current;
    const session = sessionRef.current;
    if (!code || !session || session.connectionMode !== "business_app_coexistence") throw new Error("A Meta não confirmou o modo oficial de coexistência.");
    const response = await fetch("/api/store/whatsapp/embedded-signup", {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, whatsappBusinessAccountId: session.whatsappBusinessAccountId, ...(session.phoneNumberId ? { phoneNumberId: session.phoneNumberId } : {}), connectionMode: "business_app_coexistence", numberChangeLinkToken: token }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) throw new Error(body?.error || "A validação Meta falhou.");
    const id = body.changeRequest?.id;
    if (!id) throw new Error("A Meta foi validada, mas o pedido de troca não foi materializado.");
    setRequestId(id);
    setPhase("cutover");
    setStatus("Novo número validado. É necessária uma nova autorização Meta para concluir.");
  }

  async function submitCutover() {
    if (!requestId || !codeRef.current) throw new Error("Autorização Meta incompleta.");
    const validate = await fetch(`/api/store/whatsapp/binding-change?request_id=${encodeURIComponent(requestId)}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "validate", requestId }) });
    if (!validate.ok) throw new Error("Não foi possível validar o pedido de troca.");
    const ready = await fetch(`/api/store/whatsapp/binding-change?request_id=${encodeURIComponent(requestId)}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ready", requestId }) });
    if (!ready.ok) throw new Error("O pedido ainda não está pronto para conclusão.");
    const cutover = await fetch(`/api/store/whatsapp/binding-change?request_id=${encodeURIComponent(requestId)}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cutover", requestId, authorizationCode: codeRef.current, numberChangeLinkToken: token }) });
    const body = await cutover.json().catch(() => null);
    if (!cutover.ok || !body?.ok) throw new Error(body?.error || "O cutover não foi concluído.");
    setStatus("Troca concluída com sucesso.");
    setPhase("initial");
  }

  async function startMeta() {
    if (busy) return;
    setBusy(true); setError(null); codeRef.current = ""; sessionRef.current = null;
    const config = getMetaEmbeddedSignupConfig();
    try {
      await requestNumberChangeLinkStart({ token });

      await ensureFacebookSdkLoaded(config.appId);
      if (!window.FB?.login) throw new Error("FACEBOOK_SDK_LOGIN_UNAVAILABLE");
      const result = await new Promise<{ code: string; session: MetaEmbeddedSignupSession }>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("A autorização Meta expirou.")), 180_000);
        const onMessage = (event: MessageEvent) => {
          if (classifyMetaEmbeddedSignupMessage(event) !== "finish_valid") return;
          const session = extractMetaEmbeddedSignupSession(event);
          if (!session || session.connectionMode !== "business_app_coexistence") { window.clearTimeout(timeout); window.removeEventListener("message", onMessage); reject(new Error("A Meta retornou um modo diferente de coexistência.")); return; }
          sessionRef.current = session;
          if (codeRef.current) { window.clearTimeout(timeout); window.removeEventListener("message", onMessage); resolve({ code: codeRef.current, session }); }
        };
        window.addEventListener("message", onMessage);
        window.FB?.login((response) => {
          const code = typeof response.authResponse?.code === "string" ? response.authResponse.code.trim() : "";
          if (!code) { window.clearTimeout(timeout); window.removeEventListener("message", onMessage); reject(new Error("A Meta não retornou um código de autorização.")); return; }
          codeRef.current = code;
          if (sessionRef.current) { window.clearTimeout(timeout); window.removeEventListener("message", onMessage); resolve({ code, session: sessionRef.current }); }
        }, { config_id: config.configId, response_type: "code", override_default_response_type: true, extras: { version: "v4", featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" } });
      });
      codeRef.current = result.code; sessionRef.current = result.session;
      if (phase === "initial") await submitInitial(); else await submitCutover();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir a autorização Meta.");
    } finally { setBusy(false); }
  }

  if (loading) return <main className="min-h-screen bg-zinc-950 p-8 text-zinc-100">Validando autorização...</main>;
  if (error && !storeName) return <main className="min-h-screen bg-zinc-950 p-8 text-red-200">{error}</main>;
  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-10 text-zinc-100">
      <div className="mx-auto max-w-2xl rounded-3xl border border-white/10 bg-zinc-900 p-6 shadow-2xl">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">ZION</div>
        <h1 className="mt-3 text-2xl font-semibold">Central de Conexão</h1>
        <p className="mt-2 text-sm text-zinc-400">Loja: <span className="text-zinc-200">{storeName}</span></p>
        <p className="mt-1 text-sm text-zinc-400">WhatsApp comercial atual: <span className="text-zinc-200">{currentPhone}</span></p>
        <div className="mt-6 space-y-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm text-zinc-300">
          <p>O número atual permanece associado até a confirmação final do cutover.</p>
          <p>Use exclusivamente o Embedded Signup oficial da Meta e escolha a coexistência com o WhatsApp Business App.</p>
          <p>Não informe PIN, senha ou token ao ZION.</p>
        </div>
        <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm text-zinc-400"><li>Abra a autorização oficial da Meta.</li><li>Confirme o WABA e o novo telefone.</li><li>Aguarde a validação server-side e a conclusão do cutover.</li></ol>
        {status ? <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200">{status}</p> : null}
        {error ? <p className="mt-5 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-200">{error}</p> : null}
        <button type="button" onClick={() => void startMeta()} disabled={busy} className="mt-6 w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-50">{busy ? "Aguardando Meta..." : phase === "initial" ? "Iniciar troca de WhatsApp" : "Autorizar conclusão na Meta"}</button>
        <p className="mt-5 text-xs leading-5 text-zinc-500">Em caso de dúvida, interrompa e procure o suporte humano. Este link é temporário e vinculado ao responsável autenticado.</p>
      </div>
    </main>
  );
}

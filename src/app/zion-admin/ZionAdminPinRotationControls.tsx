"use client";

import { useEffect, useRef, useState } from "react";
import {
  isListedSecretId, matchesAuthorizedRotation, parsePreparedRotation,
  isConfirmedPinRotation,
} from "./pin-rotation-ui-protocol";

type AuthorizedOperation = {
  rotationId: string;
  operationId: string;
  expiresAt: number;
  secretId: string;
};
type Phase = "idle" | "prepared" | "authorized" | "completed" | "reconciliation";
type Action = "prepare" | "authorize" | "execute";

export type PinRotationControlsProps = {
  canAccess: boolean;
  rotationEnabled: boolean;
  executionEnabled: boolean;
  organizationId: string;
  storeId: string;
  activeSecretId: string | null;
  onCompleted: () => void;
};

/** No sensitive PIN, raw phone ID, or Meta credential enters this component. */
export default function ZionAdminPinRotationControls({
  canAccess, rotationEnabled, executionEnabled, organizationId, storeId,
  activeSecretId, onCompleted,
}: PinRotationControlsProps) {
  const [operation, setOperation] = useState<AuthorizedOperation | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState<Action | null>(null);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  const permitted = canAccess && rotationEnabled && executionEnabled &&
    isListedSecretId(activeSecretId);

  // A prepared authorization is ephemeral: not stored in localStorage or URL.
  useEffect(() => {
    if (!operation || phase === "completed" || phase === "reconciliation") return;
    const delay = Math.max(0, operation.expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      if (busy) return;
      setOperation(null);
      setPhase("idle");
      setMessage("A autorização expirou. Inicie uma nova preparação.");
    }, delay);
    return () => window.clearTimeout(timer);
  }, [operation, phase, busy]);

  async function submit(action: Action) {
    if (!permitted || !isListedSecretId(activeSecretId) || busyRef.current || busy || phase === "completed" || phase === "reconciliation") return;
    if (action === "prepare" && phase !== "idle") return;
    if (action === "authorize" && phase !== "prepared") return;
    if (action === "execute" && phase !== "authorized") return;
    if (action !== "prepare" && (!operation || operation.secretId !== activeSecretId || Date.now() >= operation.expiresAt)) {
      setOperation(null);
      setPhase("idle");
      setMessage("A operação expirou ou o PIN mudou. Prepare uma nova troca.");
      return;
    }

    const confirmation = action === "prepare"
      ? "Preparar uma nova troca de PIN para esta loja? Nenhuma alteração será enviada à Meta agora."
      : action === "authorize"
        ? "Autorizar esta troca de PIN? A autorização ainda NÃO altera o PIN na Meta."
        : "CONFIRMAR EXECUÇÃO REAL: deseja enviar a troca do PIN à Meta agora? O resultado pode exigir conferência manual.";
    if (!window.confirm(confirmation)) return;

    busyRef.current = true;
    setBusy(action);
    setMessage(null);
    try {
      const url = action === "execute"
        ? "/api/zion-admin/whatsapp-pins/rotation/execute"
        : "/api/zion-admin/whatsapp-pins/rotation";
      const response = await fetch(url, {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action, consent: true, organizationId, storeId, secretId: activeSecretId,
          ...(action === "prepare" ? {} : {
            rotationId: operation?.rotationId, operationId: operation?.operationId,
          }),
        }),
      });
      // Read only the allowlisted control fields. Never display server internals.
      const data: unknown = await response.json().catch(() => null);
      if (action === "prepare") {
        const prepared = parsePreparedRotation(response.ok, data);
        if (!prepared) throw new Error("prepare-denied");
        setOperation({
          rotationId: prepared.rotationId, operationId: prepared.operationId,
          secretId: activeSecretId, expiresAt: Date.now() + prepared.expiresInSeconds * 1000,
        });
        setPhase("prepared");
        setMessage("Troca preparada. Autorize para continuar; o PIN atual não foi alterado.");
      } else if (action === "authorize") {
        if (!operation || !matchesAuthorizedRotation(response.ok, data, operation)) {
          throw new Error("authorize-denied");
        }
        setPhase("authorized");
        setMessage("Troca autorizada. A execução na Meta exige uma confirmação separada.");
      } else {
        if (isConfirmedPinRotation(response.ok, data)) {
          setPhase("completed");
          setOperation(null);
          setMessage("Meta confirmou a troca. A lista de PINs será atualizada.");
          onCompleted();
        } else {
          // After an attempted external call, NEVER permit an automatic or UI retry.
          setPhase("reconciliation");
          setOperation(null);
          setMessage("Execução não confirmada. Pare aqui e confira o registro administrativo antes de tentar novamente.");
        }
      }
    } catch {
      if (action === "execute") {
        // Connection failure could follow a successful remote request.
        setPhase("reconciliation");
        setOperation(null);
        setMessage("Resultado remoto incerto. Não repita a operação; confira a situação na Meta e o registro administrativo.");
      } else {
        setOperation(null);
        setPhase("idle");
        setMessage("Não foi possível preparar ou autorizar a troca. Nenhuma execução foi iniciada por esta interface.");
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 border-t border-[#26343d] pt-2">
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" disabled={!permitted || busy !== null || phase !== "idle"}
          onClick={() => void submit("prepare")}
          className="min-w-0 rounded-lg border border-[#397788] bg-[#132d37] px-2 py-2 text-[10px] font-semibold text-[#a6eef3] hover:bg-[#1c4350] disabled:cursor-not-allowed disabled:opacity-50">
          {busy === "prepare" ? "Preparando..." : "Trocar PIN"}
        </button>
        <button type="button" disabled={!permitted || busy !== null || phase !== "prepared"}
          onClick={() => void submit("authorize")}
          className="min-w-0 rounded-lg border border-[#397788] bg-[#132d37] px-2 py-2 text-[10px] font-semibold text-[#a6eef3] hover:bg-[#1c4350] disabled:cursor-not-allowed disabled:opacity-50">
          {busy === "authorize" ? "Autorizando..." : "Autorizar troca"}
        </button>
      </div>
      {phase === "authorized" ? (
        <button type="button" disabled={!permitted || busy !== null}
          onClick={() => void submit("execute")}
          className="mt-1.5 w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50">
          {busy === "execute" ? "Aguardando Meta..." : "Executar troca na Meta"}
        </button>
      ) : null}
      {!rotationEnabled || !executionEnabled ? (
        <p className="mt-1.5 text-[10px] leading-4 text-[#8e98aa]">Troca desabilitada até autorização da operação real.</p>
      ) : !activeSecretId ? (
        <p className="mt-1.5 text-[10px] leading-4 text-[#8e98aa]">Não há PIN ativo disponível para troca.</p>
      ) : null}
      {message ? <p role="status" className="mt-1.5 text-[10px] leading-4 text-[#c7d6dd]">{message}</p> : null}
    </div>
  );
}

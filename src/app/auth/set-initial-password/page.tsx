import { Suspense } from "react";
import SetInitialPasswordClient from "./SetInitialPasswordClient";

function SetInitialPasswordFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-6 shadow-sm">
        <div className="text-center">
          <div className="text-2xl font-black tracking-tight">ZION</div>
          <div className="mt-1 text-sm text-zinc-400">Criar primeira senha</div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-200">
          Validando link...
        </div>
      </div>
    </div>
  );
}

export default function SetInitialPasswordPage() {
  return (
    <Suspense fallback={<SetInitialPasswordFallback />}>
      <SetInitialPasswordClient />
    </Suspense>
  );
}

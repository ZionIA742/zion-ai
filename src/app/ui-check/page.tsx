// src/app/ui-check/page.tsx
export default function UICheckPage() {
  return (
    <div className="min-h-screen bg-gray-100 p-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">UI Check</h1>
            <p className="text-sm text-gray-600">
              Se isso aqui estiver quadrado/sem sombra, é interferência global.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90">
              Botão Preto
            </button>
            <button className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50">
              Botão Branco
            </button>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <div className="text-sm font-semibold">Card A</div>
            <div className="mt-2 text-sm text-gray-600">
              Deve ter <b>borda suave</b>, <b>cantos arredondados</b> e <b>sombra leve</b>.
            </div>
            <div className="mt-4 inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/20">
              OK (verde)
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <div className="text-sm font-semibold">Card B</div>
            <div className="mt-2 text-sm text-gray-600">
              Mesmo layout, com chip amarelo.
            </div>
            <div className="mt-4 inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-600/20">
              PENDENTE (amarelo)
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <div className="text-sm font-semibold">Card C</div>
            <div className="mt-2 text-sm text-gray-600">
              Mesmo layout, com chip vermelho.
            </div>
            <div className="mt-4 inline-flex items-center rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 ring-1 ring-red-600/20">
              CRÍTICO (vermelho)
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Teste de colunas</div>
              <div className="text-sm text-gray-600">
                Aqui a borda deve ser “soft”, não preta/forte.
              </div>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
              Neutro
            </span>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
              <div className="text-xs font-semibold text-gray-700">Coluna</div>
              <div className="mt-3 space-y-3">
                <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                  <div className="text-sm font-medium">Card 1</div>
                  <div className="mt-2 h-1.5 w-16 rounded-full bg-emerald-500/80" />
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                  <div className="text-sm font-medium">Card 2</div>
                  <div className="mt-2 h-1.5 w-16 rounded-full bg-amber-500/80" />
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5" />
            <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5" />
          </div>
        </div>
      </div>
    </div>
  );
}
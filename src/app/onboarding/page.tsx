"use client";

import OrgGuard from "../../components/OrgGuard";
import { StoreProvider, useStoreContext } from "../../components/StoreProvider";

function OnboardingContent() {
  const { loading, error, activeStore } = useStoreContext();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-600">Carregando onboarding...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 px-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-lg w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Ops…</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!activeStore) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 px-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-lg w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            Loja não encontrada
          </h1>
          <p className="text-gray-600">
            Não foi possível identificar a loja ativa para iniciar o onboarding.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 px-6 py-10">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="mb-8">
            <p className="text-sm font-medium text-gray-500 mb-2">
              Onboarding inicial
            </p>
            <h1 className="text-3xl font-bold text-gray-900 mb-3">
              Vamos configurar sua loja no ZION
            </h1>
            <p className="text-gray-600 leading-7">
              Antes de liberar o sistema, precisamos coletar algumas informações
              essenciais para personalizar a IA comercial e o funcionamento da
              loja.
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 mb-8">
            <p className="text-sm text-gray-500 mb-1">Loja ativa</p>
            <p className="text-lg font-semibold text-gray-900">
              {activeStore.name}
            </p>
          </div>

          <div className="space-y-4 mb-8">
            <div className="rounded-xl border border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900 mb-1">
                Você vai preencher
              </h2>
              <p className="text-sm text-gray-600">
                Dados da loja, catálogo, marcas trabalhadas, política comercial,
                regiões atendidas, instalação e regras iniciais de operação.
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900 mb-1">
                Por que isso é importante
              </h2>
              <p className="text-sm text-gray-600">
                Essas informações serão a base da IA vendedora e da IA
                operacional, evitando respostas erradas, promessas indevidas e
                inconsistências comerciais.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-gray-500">
              Etapa 1 de 1 nesta versão inicial
            </p>

            <button
              type="button"
              className="px-5 py-3 rounded-xl bg-black text-white font-medium cursor-not-allowed opacity-60"
              disabled
            >
              Continuar em breve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <OrgGuard>
      <StoreProvider>
        <OnboardingContent />
      </StoreProvider>
    </OrgGuard>
  );
}
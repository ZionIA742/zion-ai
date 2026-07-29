export default function AccessBlockedPage() {
  return (
    <div className="flex min-h-screen bg-gray-100 px-6 py-12">
      <div className="m-auto w-full max-w-xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
        <h1 className="text-2xl font-bold text-gray-900">Acesso bloqueado</h1>
        <p className="mt-4 text-sm leading-6 text-gray-600">
          Sua conta não está liberada para acessar esta área no momento.
        </p>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          Entre em contato com o suporte ZION ou com o administrador
          responsável pela sua conta para revisar o acesso.
        </p>
      </div>
    </div>
  );
}

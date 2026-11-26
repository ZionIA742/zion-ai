export default function DocumentsPage() {
  return (
    <div className="min-w-0 space-y-5">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold text-gray-950">
          Central de Documentos
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Or?amentos e contratos gerados pelo ZION.
        </p>
      </section>

      <section
        className="rounded-2xl border border-gray-200 bg-white p-8"
        aria-label="Documentos"
      >
        <p className="text-sm text-gray-500">
          A listagem de documentos ser? disponibilizada nesta se??o.
        </p>
      </section>
    </div>
  );
}

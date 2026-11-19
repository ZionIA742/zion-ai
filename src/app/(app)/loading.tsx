export default function AppAreaLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="w-full min-h-[45vh] p-4 md:p-6"
    >
      <span className="sr-only">Carregando área...</span>

      <div className="mx-auto w-full max-w-6xl animate-pulse space-y-5">
        <div className="h-8 w-48 rounded-lg bg-zinc-200" />

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="h-28 rounded-2xl bg-zinc-100" />
          <div className="h-28 rounded-2xl bg-zinc-100" />
          <div className="h-28 rounded-2xl bg-zinc-100" />
        </div>

        <div className="h-64 rounded-2xl bg-zinc-100" />
      </div>
    </div>
  );
}
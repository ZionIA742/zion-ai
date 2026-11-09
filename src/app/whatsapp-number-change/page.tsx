import WhatsappNumberChangeClient from "./WhatsappNumberChangeClient";

export default async function WhatsappNumberChangePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token.trim() : "";
  if (!token) return <main className="min-h-screen bg-zinc-950 p-8 text-red-200">Link de troca ausente.</main>;
  return <WhatsappNumberChangeClient token={token} />;
}

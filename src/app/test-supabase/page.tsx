import { supabase } from "@/lib/supabaseClient";

export default async function TestSupabasePage() {
  const { data, error } = await supabase
    .from("ping")
    .select("id, message, created_at")
    .order("id", { ascending: false })
    .limit(1);

  return (
    <div style={{ padding: 20 }}>
      <h1>Teste Supabase</h1>
      <pre>{JSON.stringify({ data, error }, null, 2)}</pre>
    </div>
  );
}
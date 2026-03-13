import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!url || !anon) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ENV_MISSING: Verifique NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no .env.local",
        urlPresent: !!url,
        anonPresent: !!anon,
      },
      { status: 500 }
    );
  }

  const pingUrl = `${url}/rest/v1/`;

  try {
    const res = await fetch(pingUrl, {
      method: "GET",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      },
      cache: "no-store",
    });

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      supabaseRest: pingUrl,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "FETCH_FAILED", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
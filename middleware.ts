import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  const isPublic =
    path === "/login" ||
    path.startsWith("/_next") ||
    path.startsWith("/favicon") ||

    // Rotas internas protegidas por segredo próprio.
    // Elas não podem depender de sessão/login, porque são chamadas por worker, cron ou integrações.
    path === "/api/internal/ai-sales-reply" ||
    path === "/api/internal/whatsapp/process-pending" ||
    path === "/api/internal/assistant-operational-tasks/process" ||

    // Rotas de cron da Vercel.
    // A autenticação delas é feita dentro da própria rota via CRON_SECRET.
    path === "/api/cron/assistant-operational-tasks";

  if (isPublic) {
    return NextResponse.next();
  }

  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          res.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", path);
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const normalizedPath = path.replace(/\/$/, "") || "/";
  const publicPaths = new Set([
    "/login",
    "/auth/callback",
    "/auth/reset-password",
    "/zion-admin/login",
    "/privacy-policy",
    "/terms-of-service",
    "/data-deletion",
    "/api/webhooks/whatsapp",
    "/api/internal/ai-sales-reply",
    "/api/internal/assistant/responsible-external-notifications/materialize",
    "/api/internal/assistant/responsible-external-notifications/send",
    "/api/internal/assistant/responsible-external-notifications/list",
    "/api/internal/assistant/responsible-external-notifications/prepare",
    "/api/internal/assistant/responsible-external-notifications/cancel",
    "/api/internal/whatsapp/process-inbox",
    "/api/internal/whatsapp/process-pending",
    "/api/internal/assistant-operational-tasks/process",
    "/api/cron/assistant-operational-tasks",
    "/api/cron/whatsapp-process-all",
  ]);

  const isPublic =
    publicPaths.has(normalizedPath) ||
    path.startsWith("/_next") ||
    path.startsWith("/favicon");

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

    if (path.startsWith("/zion-admin")) {
      url.pathname = "/zion-admin/login";
      url.searchParams.set("redirectTo", path);
      return NextResponse.redirect(url);
    }

    url.pathname = "/login";
    url.searchParams.set("redirectTo", path);
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

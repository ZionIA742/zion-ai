import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  resolveAccountAccessMiddlewarePolicy,
  type MiddlewareAuthState,
  type MiddlewarePolicyDecision,
} from "./src/lib/account-access-middleware-policy";

type MiddlewareUserResponse = {
  data: {
    user: unknown | null;
  };
  error: unknown;
};

type MiddlewareAuthClient = {
  getUser: () => Promise<MiddlewareUserResponse>;
};

type MiddlewareEvalDeps = {
  createClient: () => MiddlewareAuthClient | Promise<MiddlewareAuthClient>;
  hasSessionCookie?: boolean;
};

type MiddlewareEvalResult = {
  authState: MiddlewareAuthState;
  decision: MiddlewarePolicyDecision;
};

export async function evaluateMiddlewarePathname(
  pathname: string,
  deps: MiddlewareEvalDeps,
): Promise<MiddlewareEvalResult> {
  const publicDecision = resolveAccountAccessMiddlewarePolicy(
    pathname,
    "anonymous",
  );

  if (publicDecision.action === "next") {
    return {
      authState: "anonymous",
      decision: publicDecision,
    };
  }

  try {
    const client = await deps.createClient();
    const { data, error } = await client.getUser();
    const authState: MiddlewareAuthState = error
      ? deps.hasSessionCookie
        ? "unavailable"
        : "anonymous"
      : data.user
        ? "authenticated"
        : "anonymous";

    return {
      authState,
      decision: resolveAccountAccessMiddlewarePolicy(pathname, authState),
    };
  } catch {
    const authState: MiddlewareAuthState = deps.hasSessionCookie
      ? "unavailable"
      : "anonymous";

    return {
      authState,
      decision: resolveAccountAccessMiddlewarePolicy(pathname, authState),
    };
  }
}

function hasSupabaseSessionCookie(req: NextRequest): boolean {
  return req.cookies
    .getAll()
    .some(({ name }) => name.includes("sb-") && name.includes("auth-token"));
}

function applySessionCookies(
  source: NextResponse,
  target: NextResponse,
) {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
}

export function buildRedirectUrl(
  requestUrl: string,
  requestPathname: string,
  decision: Extract<MiddlewarePolicyDecision, { action: "redirect" }>,
) {
  const url = new URL(decision.destination, requestUrl);
  url.search = "";

  if (decision.preserveRedirectTo) {
    url.searchParams.set("redirectTo", requestPathname);
  }

  return url.toString();
}

function buildRedirectResponse(
  requestUrl: string,
  requestPathname: string,
  baseResponse: NextResponse,
  decision: Extract<MiddlewarePolicyDecision, { action: "redirect" }>,
): NextResponse {
  const redirectResponse = NextResponse.redirect(
    buildRedirectUrl(requestUrl, requestPathname, decision),
  );
  applySessionCookies(baseResponse, redirectResponse);
  return redirectResponse;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const initialDecision = resolveAccountAccessMiddlewarePolicy(
    path,
    "anonymous",
  );

  if (initialDecision.action === "next") {
    return NextResponse.next();
  }

  const res = NextResponse.next();

  const result = await evaluateMiddlewarePathname(path, {
    hasSessionCookie: hasSupabaseSessionCookie(req),
    createClient: () => {
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

      return {
        getUser: () => supabase.auth.getUser(),
      };
    },
  });

  if (result.decision.action === "redirect") {
    return buildRedirectResponse(req.url, req.nextUrl.pathname, res, result.decision);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

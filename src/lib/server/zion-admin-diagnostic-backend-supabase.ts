import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  BACKEND_DIAGNOSTIC_WRITER,
  type BackendDiagnosticRpc,
} from "./zion-admin-diagnostic-backend-transport";

type BackendDiagnosticEnvironment = Readonly<{
  NEXT_PUBLIC_SUPABASE_URL?: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
}>;

// Read only the required configuration, when invoked.
// Never reuse a customer-authenticated client.

export function createBackendDiagnosticRpc(
  environment: BackendDiagnosticEnvironment = {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY:
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  fetchOverride?: typeof fetch,
): BackendDiagnosticRpc {
  const rawUrl =
    environment.NEXT_PUBLIC_SUPABASE_URL;

  const rawKey =
    environment.SUPABASE_SERVICE_ROLE_KEY;

  if (
    typeof rawUrl !== "string" ||
    !rawUrl.trim() ||
    typeof rawKey !== "string" ||
    !rawKey.trim() ||
    /[\r\n]/.test(rawKey)
  ) {
    throw new Error(
      "BACKEND_DIAGNOSTIC_CONFIGURATION_UNAVAILABLE",
    );
  }

  let url: URL;

  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error(
      "BACKEND_DIAGNOSTIC_CONFIGURATION_INVALID",
    );
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "BACKEND_DIAGNOSTIC_CONFIGURATION_INVALID",
    );
  }

  try {
    const client = createClient(
      url.origin,
      rawKey.trim(),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        ...(fetchOverride
          ? {
              global: {
                fetch: fetchOverride,
              },
            }
          : {}),
      },
    );

    return (args, signal) =>
      client
        .rpc(
          BACKEND_DIAGNOSTIC_WRITER,
          args,
        )
        .abortSignal(signal);
  } catch {
    throw new Error(
      "BACKEND_DIAGNOSTIC_CLIENT_UNAVAILABLE",
    );
  }
}
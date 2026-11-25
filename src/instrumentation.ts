import type { Instrumentation } from "next";

// Node-only dependencies must remain outside the Edge entry.
// Capture is disabled unless explicitly enabled.

export const onRequestError: Instrumentation.onRequestError =
  async (error, request, context) => {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      if (
        process.env.ZION_ADMIN_DIAGNOSTIC_BACKEND_ENABLED
          !== "true"
      ) {
        return;
      }

      try {
        const adapter = await import(
          "./lib/server/zion-admin-diagnostic-backend-next"
        );

        await adapter.handleBackendRequestError(
          error,
          request,
          context,
        );
      } catch {
        try {
          console.warn(
            "ZION_BACKEND_DIAGNOSTIC_HOOK_FAILURE",
          );
        } catch {
          // Preserve the original application failure.
        }
      }
    }
  };

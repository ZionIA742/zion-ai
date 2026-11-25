import { installClientBrowserDiagnostics } from "./lib/client/client-browser-diagnostics";

// Next.js client entry, before hydration. Both client and server gates default off.
if (typeof window !== "undefined") {
  installClientBrowserDiagnostics(window, process.env.NEXT_PUBLIC_ZION_ADMIN_DIAGNOSTIC_CLIENT_ENABLED === "true");
}

import { canonicalBrowserPage, CLIENT_BROWSER_ENDPOINT, parseBrowserReport, safeBrowserAsset, safeBrowserPosition, type BrowserReport } from "../diagnostics/client-browser-contract";

// Never serialize the error itself, messages, stack, URLs, cookies or session IDs.
function knownName(value: unknown): string | null {
  try {
    if (value instanceof TypeError) return "TypeError";
    if (value instanceof ReferenceError) return "ReferenceError";
    if (value instanceof RangeError) return "RangeError";
    if (value instanceof SyntaxError) return "SyntaxError";
    if (value instanceof URIError) return "URIError";
    if (value instanceof EvalError) return "EvalError";
    if (value instanceof AggregateError) return "AggregateError";
    return value instanceof Error ? "Error" : null;
  } catch { return null; }
}
const installed = Symbol.for("zion.client-browser-diagnostics.v1");
export function installClientBrowserDiagnostics(target: Window, enabled: boolean): void {
  if (!enabled) return;
  try {
    const state = target as Window & { [installed]?: boolean };
    if (state[installed]) return;
    const recent = new Map<string, number>();
    let sent: number[] = [];
    function submit(kind: BrowserReport["kind"], reason: unknown, filename?: string, lineno?: number, colno?: number) {
      try {
        const page = canonicalBrowserPage(target.location.pathname);
        if (!page) return;
        if (typeof DOMException !== "undefined" && reason instanceof DOMException && reason.name === "AbortError") return;
        let asset: string | null = null;
        if (filename && filename.length <= 1024) {
          const url = new URL(filename, target.location.origin);
          if (url.origin === target.location.origin && !url.search && !url.hash && !url.username && !url.password) asset = safeBrowserAsset(url.pathname);
        }
        const report = parseBrowserReport({kind,page,errorName:knownName(reason),asset,line:asset ? safeBrowserPosition(lineno) : null,column:asset ? safeBrowserPosition(colno) : null});
        if (!report) return;
        const now = Date.now();
        sent = sent.filter(t => now - t < 60000);
        for (const [key, time] of recent) if (now - time >= 60000) recent.delete(key);
        const key = JSON.stringify(report);
        if (sent.length >= 5 || recent.has(key)) return;
        recent.set(key, now); sent.push(now);
        // No retry, no local persistence, no read of the response body.
        void target.fetch(CLIENT_BROWSER_ENDPOINT, {method:"POST",credentials:"same-origin",redirect:"error",cache:"no-store",keepalive:true,headers:{"Content-Type":"application/json"},body:key}).catch(() => {});
      } catch { /* Fail open. Never report a collector error recursively. */ }
    }
    const onError = (event: ErrorEvent) => {
      if (event instanceof ErrorEvent) submit("uncaught_error",event.error,event.filename,event.lineno,event.colno);
    };
    const onRejection = (event: PromiseRejectionEvent) => submit("unhandled_rejection",event.reason);
    target.addEventListener("error",onError);
    try { target.addEventListener("unhandledrejection",onRejection); state[installed] = true; }
    catch { target.removeEventListener("error",onError); }
  } catch { /* Diagnostics must not interrupt initialization. */ }
}

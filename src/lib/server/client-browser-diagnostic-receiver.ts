import { isBrowserUuid, pageDomain, parseBrowserReport, type BrowserReport, type ClientBrowserDomain } from "../diagnostics/client-browser-contract";

export type BrowserScope = { userId: string; scope: "system" | "store"; organizationId: string | null; storeId: string | null };
export type BrowserWriterArgs = { p_user_id:string; p_scope:"system"|"store"; p_organization_id:string|null; p_store_id:string|null; p_report:BrowserReport };
type Dependencies = {
  enabled: boolean;
  authorize(domain: ClientBrowserDomain): Promise<BrowserScope | null>;
  persist(args: BrowserWriterArgs): Promise<boolean>;
};
const MAX_BYTES = 1024;
function reply(status: number) { return new Response(null,{status,headers:{"Cache-Control":"no-store"}}); }
async function readBounded(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("BODY_REQUIRED");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bytes: Uint8Array[] = [];
  let size = 0;
  try {
    const deadline = new Promise<never>((_, reject) => {timer=setTimeout(()=>reject(new Error("BODY_TIMEOUT")),2000);});
    while (true) {
      const part = await Promise.race([reader.read(),deadline]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) throw new Error("BODY_LIMIT");
      bytes.push(part.value);
    }
    const all = new Uint8Array(size); let pos=0;
    for (const part of bytes) {all.set(part,pos);pos+=part.byteLength;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(all));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader.cancel().catch(()=>{});
  }
}
export function createBrowserDiagnosticReceiver(deps: Dependencies) {
  return async function receive(request: Request): Promise<Response> {
    if (!deps.enabled) return reply(204);
    try {
      const origin = request.headers.get("origin");
      const site = request.headers.get("sec-fetch-site");
      if (!origin || origin !== new URL(request.url).origin || site !== null && site !== "same-origin") return reply(403);
      if (request.method !== "POST" || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || request.headers.has("content-encoding")) return reply(415);
      const length = request.headers.get("content-length");
      if (length !== null && (!/^\d{1,5}$/.test(length) || Number(length) > MAX_BYTES)) return reply(413);
      let report: BrowserReport | null;
      try { report = parseBrowserReport(await readBounded(request)); } catch { return reply(400); }
      if (!report) return reply(400);
      const domain = pageDomain(report.page);
      if (!domain) return reply(400);
      const scope = await deps.authorize(domain);
      if (!scope || !isBrowserUuid(scope.userId) || !(domain === "zion_admin" && scope.scope === "system" && scope.organizationId === null && scope.storeId === null || domain === "store_area" && scope.scope === "store" && isBrowserUuid(scope.organizationId) && isBrowserUuid(scope.storeId))) return reply(403);
      const ok = await deps.persist({p_user_id:scope.userId,p_scope:scope.scope,p_organization_id:scope.organizationId,p_store_id:scope.storeId,p_report:report});
      return reply(ok ? 204 : 503);
    } catch { return reply(503); }
  };
}

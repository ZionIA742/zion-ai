import { CLIENT_BROWSER_PAGES } from "./client-browser-pages";

export const CLIENT_BROWSER_ENDPOINT = "/api/diagnostics/client-browser";
export type ClientBrowserDomain = "store_area" | "zion_admin";
export type BrowserReport = {
  kind: "uncaught_error" | "unhandled_rejection";
  page: string;
  errorName: string | null;
  asset: string | null;
  line: number | null;
  column: number | null;
};
const names = new Set(["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "URIError", "EvalError", "AggregateError"]);
const assets = /^\/_next\/static\/chunks\/(?:[0-9]{1,8}-)?[a-f0-9]{8,64}\.js$/;
const keys = ["kind", "page", "errorName", "asset", "line", "column"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isBrowserUuid(value: unknown): value is string { return typeof value === "string" && uuid.test(value); }
export function pageDomain(page: string): ClientBrowserDomain | null {
  return CLIENT_BROWSER_PAGES.find(item => item.page === page)?.domain ?? null;
}
export function canonicalBrowserPage(pathname: string): string | null {
  if (pathname.length > 2048 || !pathname.startsWith("/") || /[?#\\]/.test(pathname)) return null;
  const normalized = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
  const segments = normalized.split("/");
  const matches = CLIENT_BROWSER_PAGES.filter(({page}) => {
    const parts = page.split("/");
    return parts.length === segments.length && parts.every((part, i) => /^\[[A-Za-z0-9_]+\]$/.test(part) ? !!segments[i] && !/[\[\]]/.test(segments[i]) : part === segments[i]);
  });
  // Prefer a literal page over a parameterized page. Never guess ties.
  const exact = matches.find(item => item.page === normalized);
  return exact?.page ?? (matches.length === 1 ? matches[0].page : null);
}
export function safeBrowserAsset(value: unknown): string | null {
  return typeof value === "string" && assets.test(value) ? value : null;
}
export function safeBrowserPosition(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1000000 ? value : null;
}
export function parseBrowserReport(value: unknown): BrowserReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== keys.length || !keys.every(k => Object.prototype.hasOwnProperty.call(r,k))) return null;
  if (r.kind !== "uncaught_error" && r.kind !== "unhandled_rejection") return null;
  if (typeof r.page !== "string" || !pageDomain(r.page)) return null;
  if (r.errorName !== null && (typeof r.errorName !== "string" || !names.has(r.errorName))) return null;
  const asset = safeBrowserAsset(r.asset);
  const line = safeBrowserPosition(r.line), column = safeBrowserPosition(r.column);
  if (r.asset !== null && !asset || r.line !== null && line === null || r.column !== null && column === null || !asset && (line !== null || column !== null)) return null;
  return {kind:r.kind,page:r.page,errorName:r.errorName as string|null,asset,line,column};
}

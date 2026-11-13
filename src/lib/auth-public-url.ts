export const OFFICIAL_ZION_SITE_URL = "https://zionapi.com.br";

type AuthPublicUrlConfig = {
  siteUrl?: string | null;
  appUrl?: string | null;
  vercelUrl?: string | null;
  nodeEnv?: string | null;
  vercelEnv?: string | null;
};

function isProductionDeployment(config: AuthPublicUrlConfig) {
  const vercelEnv = String(config.vercelEnv || "").trim().toLowerCase();

  return vercelEnv === "production" ||
    (String(config.nodeEnv || "").trim().toLowerCase() === "production" && !vercelEnv);
}

function isLocalHost(url: URL) {
  return url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
}

function parseCandidate(value: string | null | undefined) {
  const raw = String(value || "").trim();

  if (!raw) return null;

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);

    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function normalizeOrigin(url: URL) {
  return url.origin;
}

export function resolveAuthPublicBaseUrl(config: AuthPublicUrlConfig = {}) {
  const production = isProductionDeployment(config);
  const siteUrl = parseCandidate(config.siteUrl);

  if (production) {
    return siteUrl?.origin === OFFICIAL_ZION_SITE_URL ? OFFICIAL_ZION_SITE_URL : null;
  }

  for (const candidate of [config.siteUrl, config.appUrl, config.vercelUrl]) {
    const url = parseCandidate(candidate);

    if (!url) continue;

    if (url.origin === OFFICIAL_ZION_SITE_URL) {
      return OFFICIAL_ZION_SITE_URL;
    }

    if (isLocalHost(url)) {
      return normalizeOrigin(url);
    }

    if (String(config.vercelEnv || "").trim().toLowerCase() === "preview" &&
        url.protocol === "https:" &&
        url.hostname.endsWith(".vercel.app")) {
      return normalizeOrigin(url);
    }

    if (String(config.nodeEnv || "").trim().toLowerCase() === "test") {
      return normalizeOrigin(url);
    }
  }

  return null;
}

export function getServerAuthPublicBaseUrl() {
  return resolveAuthPublicBaseUrl({
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    vercelUrl: process.env.VERCEL_URL || process.env.NEXT_PUBLIC_VERCEL_URL,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  });
}

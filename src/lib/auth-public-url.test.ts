import { strict as assert } from "node:assert";
import { resolveAuthPublicBaseUrl, OFFICIAL_ZION_SITE_URL } from "./auth-public-url";

assert.equal(
  resolveAuthPublicBaseUrl({
    siteUrl: OFFICIAL_ZION_SITE_URL,
    appUrl: "https://wrong.example",
    nodeEnv: "production",
    vercelEnv: "production",
  }),
  OFFICIAL_ZION_SITE_URL,
);

for (const siteUrl of ["https://wrong.example", "http://zionapi.com.br", "", null]) {
  assert.equal(
    resolveAuthPublicBaseUrl({
      siteUrl,
      appUrl: "https://app.example.com",
      vercelUrl: "preview.example.vercel.app",
      nodeEnv: "production",
      vercelEnv: "production",
    }),
    null,
  );
}

assert.equal(
  resolveAuthPublicBaseUrl({
    vercelUrl: "preview.example.vercel.app",
    nodeEnv: "production",
    vercelEnv: "preview",
  }),
  "https://preview.example.vercel.app",
);

assert.equal(
  resolveAuthPublicBaseUrl({
    siteUrl: "https://preview.example.vercel.app",
    nodeEnv: "production",
    vercelEnv: "preview",
  }),
  "https://preview.example.vercel.app",
);

assert.equal(
  resolveAuthPublicBaseUrl({
    siteUrl: "https://preview.example.vercel.app",
    nodeEnv: "production",
    vercelEnv: "production",
  }),
  null,
);

assert.equal(
  resolveAuthPublicBaseUrl({
    siteUrl: "http://localhost:3000",
    nodeEnv: "development",
  }),
  "http://localhost:3000",
);

console.log("auth-public-url: 9 tests passed");

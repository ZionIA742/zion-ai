import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pagePath = join(process.cwd(), "src/app/(app)/crm/lead/[id]/page.tsx");
const source = readFileSync(pagePath, "utf8");

assert.equal(
  source.includes("buildStoreAddressText(storeGeneralAddress)"),
  true,
  "lead detail must derive route origin from canonical store general address"
);
assert.equal(
  source.includes("destination: selectedRouteDestinationAddress"),
  true,
  "lead detail route button must use selected context destination"
);
assert.equal(
  source.includes("selectedRouteDisabledReason"),
  true,
  "lead detail route button must explain missing origin or destination"
);
assert.equal(
  source.includes("setStoreGeneralAddress(result.storeGeneralAddress ?? null)"),
  true,
  "lead detail must hydrate canonical store address from API response"
);
assert.equal(
  /openGoogleMapsRoute\s*\(\s*storeRouteOriginAddress\s*,\s*selectedRouteDestinationAddress\s*\)/.test(
    source
  ),
  true,
  "lead detail route button must open complete origin/destination directions"
);
assert.equal(
  source.includes("openGoogleMapsRoute(appointment.address_text)"),
  false,
  "appointment route buttons must not open destination-only directions"
);
assert.equal(
  source.includes("Foto/Vídeo"),
  true,
  "manual composer must expose the photo/video option"
);
assert.equal(
  source.includes("Documento"),
  true,
  "manual composer must expose the document option"
);
assert.equal(
  />\s*Áudio\s*<\/button>/.test(source),
  true,
  "manual composer must expose the audio option"
);
assert.equal(
  source.includes("Produto do catálogo"),
  true,
  "manual composer must expose the catalog placeholder"
);
assert.equal(
  source.includes("const MANUAL_DOCUMENT_ACCEPT") &&
    source.includes("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
  true,
  "manual document input must use the backend-supported MIME allowlist"
);
assert.equal(
  source.includes("accept={MANUAL_MEDIA_ACCEPT}") &&
    source.includes("accept={MANUAL_AUDIO_ACCEPT}"),
  true,
  "manual media and audio inputs must use dedicated accept values"
);
assert.equal(
  source.includes("Nenhum produto foi selecionado ou enviado."),
  true,
  "catalog placeholder must not silently send or invent a product"
);
assert.equal(
  source.includes("kind === \"media\" && (mimeType.startsWith(\"image/\") || mimeType.startsWith(\"video/\"))"),
  true,
  "manual media preview must create a local preview for image and video"
);

console.log("ok - lead detail route UI contract");

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
  source.includes("result?.customerMessageSaved === true") &&
    source.includes("result.aiErrorCode") &&
    source.includes("nao reenvie automaticamente"),
  true,
  "partial simulation failure must preserve the saved-message diagnostic without retrying",
);
assert.equal(
  /customerMessageSaved === true[\s\S]*?fetchLeadConversationAndMessages\(\{ silent: true \}\)/.test(
    source,
  ),
  true,
  "partial simulation failure must refresh the conversation history",
);
assert.equal(
  source.includes("async function fetchAcceptedQuoteSummary()") &&
    source.includes("void fetchAcceptedQuoteSummary();") &&
    /void fetchAcceptedQuoteSummary\(\);[\s\S]*?\}, \[documentScopeKey\]\);/.test(source),
  true,
  "accepted quote verification must be started when the document scope is ready",
);
assert.equal(
  source.includes('status: "none"') &&
    source.includes("Nenhum orçamento aceito registrado para este lead.") &&
    source.includes('status: "error"') &&
    source.includes('acceptance?.acceptance_state !== "accepted"'),
  true,
  "accepted quote summary must distinguish no canonical acceptance from verification errors",
);
assert.equal(
  source.includes("current_quote_version_id") &&
    source.includes("current_version_id !== acceptedQuoteVersionId") &&
    source.includes("detailResult.current_version?.id !== acceptedQuoteVersionId"),
  true,
  "accepted quote summary must use the exact canonical accepted quote version",
);
assert.equal(
  source.includes("kind === \"media\" && (mimeType.startsWith(\"image/\") || mimeType.startsWith(\"video/\"))"),
  true,
  "manual media preview must create a local preview for image and video"
);

console.log("ok - lead detail route UI contract");

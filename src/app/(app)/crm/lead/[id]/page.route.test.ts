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

console.log("ok - lead detail route UI contract");

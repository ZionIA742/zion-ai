import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const picker = readFileSync(join(process.cwd(), "src/app/(app)/crm/lead/[id]/CatalogProductComposerPicker.tsx"), "utf8");
const page = readFileSync(join(process.cwd(), "src/app/(app)/crm/lead/[id]/page.tsx"), "utf8");

assert.match(picker, /setLoading\(true\)/);
assert.match(picker, /setError\(null\)/);
assert.match(picker, /setProducts\(\[\]\)/);
assert.match(picker, /\.finally\(\(\) =>/);
assert.match(picker, /setLoading\(false\)/);
assert.match(picker, /!loading && !error/);
assert.match(picker, /cancelled/);
assert.doesNotMatch(picker, /Escolha um produto/);

assert.match(picker, /\/api\/crm\/catalog-products/);
assert.match(page, /\/api\/crm\/messages\/send-manual-catalog-product/);
assert.match(page, /newMessage\.trim\(\)\.length > 0 \|\| manualPendingAttachment !== null/);
assert.doesNotMatch(page, /newMessage\.trim\(\)\.length > 0 \|\| manualPendingAttachment !== null \|\| selectedCatalogProduct !== null/);
assert.match(page, /try \{\s*sent = await sendCatalogProduct\(selectedCatalogProduct, text\);[\s\S]*?finally \{[\s\S]*?manualSendInFlightRef\.current = false;[\s\S]*?setWorking\(false\);/);
assert.match(page, /async function sendCatalogProduct[\s\S]*?try \{[\s\S]*?catch \{/);
assert.match(page, /operationId: globalThis\.crypto\.randomUUID\(\)/);
assert.match(page, /function prepareManualAttachment[\s\S]*?if \(selectedCatalogProduct\)[\s\S]*?clearSelectedCatalogProduct\(\)/);
assert.match(page, /recorder\.onstop[\s\S]*?prepareManualAttachment\(audioFile, "audio"\)/);
assert.match(page, /isCatalogProductPhotoMessage\(message\) &&[\s\S]*?isPrivateCatalogPhoto/);
assert.match(page, /function isCatalogProductPhotoMessage[\s\S]*?mediaPurpose === "catalog_product_photo"/);
assert.ok(page.includes("!/^https?:\\/\\//i.test(String(message.media_url"));
assert.match(page, /setSelectedCatalogProduct\(null\)/);
assert.match(page, /send-manual-catalog-product/);
console.log("catalog-product-picker: PASS");

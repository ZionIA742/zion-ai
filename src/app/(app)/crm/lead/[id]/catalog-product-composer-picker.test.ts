import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const picker = readFileSync(join(process.cwd(), "src/app/(app)/crm/lead/[id]/CatalogProductComposerPicker.tsx"), "utf8");
const page = readFileSync(join(process.cwd(), "src/app/(app)/crm/lead/[id]/page.tsx"), "utf8");

assert.match(picker, /createPortal\(/);
assert.match(picker, /dialog\.showModal\(\)/);
assert.match(picker, /grid-cols-4/);
assert.match(picker, /view: "search"/);
assert.match(picker, /view: "detail"/);
assert.match(picker, /function openProduct/);
assert.match(picker, /detail\.photos\.map/);
assert.match(picker, /AbortController/);
assert.match(picker, /controller\.abort\(\)/);
assert.match(picker, /if \(product\.photos\.length > 0 && !previewUrl\) return;/);
assert.match(picker, /const previewUrl = product\.photos\[0\]\?\.previewUrl \?\? "";/);
assert.doesNotMatch(picker, /disabled=\{detail\.photos\.length === 0\}/);
assert.match(picker, /props\.onSelect\(/);
assert.match(picker, /if \(!props\.open\) return null;/);
assert.doesNotMatch(picker, /src=\{product\.previewUrl\}/);

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
assert.doesNotMatch(page, /catalogPlaceholderOpen|setCatalogPlaceholderOpen|openCatalogPlaceholder/);
assert.doesNotMatch(page, /Nenhum produto foi selecionado ou enviado\./);
assert.equal((page.match(/<CatalogProductComposerPicker\b/g) || []).length, 1);
assert.match(page, /function openCatalogPicker\(\)\s*\{\s*setAttachmentMenuOpen\(false\);[\s\S]*?catalogPickerScopeRef\.current = catalogScopeKey;\s*setCatalogPickerOpen\(true\);/);
assert.match(page, /onClick=\{openCatalogPicker\}/);
assert.match(page, /onClose=\{\(\) => \{\s*catalogPickerScopeRef\.current = null;\s*setCatalogPickerOpen\(false\);\s*\}\}/);
assert.match(picker, /useStoreContext\(\)/);
assert.match(picker, /activeStore\.name\.trim\(\)/);
assert.match(picker, /activeStore\.id === activeStoreId/);
assert.match(picker, /activeStore\.organization_id === organizationId/);
assert.match(picker, /\/api\/store-branding\/logo/);
assert.match(picker, /result\.branding\?\.organization_id !== organizationId/);
assert.match(picker, /result\.branding\?\.store_id !== storeId/);
assert.match(picker, /src=\{logoUrl\}/);
assert.match(picker, /onError=\{\(\) => setLogoUrl\(null\)\}/);
assert.match(picker, /currentKey !== initialKey/);
assert.match(picker, /expectedOrganizationId/);
assert.match(picker, /expectedStoreId/);
assert.doesNotMatch(picker, /\/branding\/zion-/);
assert.match(picker, /type="search"/);
assert.match(picker, /value=\{searchText\}/);
assert.match(picker, /maxLength=\{120\}/);
assert.match(picker, /params\.set\("q", query\)/);
assert.match(picker, /params\.set\("category", category\)/);
assert.match(picker, /query && page === 0 \? 400 : 0/);
assert.match(picker, /window\.clearTimeout\(timer\)/);
assert.match(picker, /revision === listRevision\.current/);
assert.match(picker, /listRevision\.current \+= 1/);
assert.match(picker, /resetCatalogList\(null, event\.target\.value\)/);
assert.match(picker, /resetCatalogList\(entry\.id, ""\)/);
assert.match(picker, /setPage\(0\)/);
assert.match(picker, /setHasMore\(result\.hasMore\)/);
assert.match(picker, /Resultados da pesquisa/);
assert.match(picker, /const visibleProducts = products;/);
assert.doesNotMatch(picker, /view=list&page=/);
assert.match(picker, /view: "categories"/);
assert.match(picker, /CATEGORY_BATCH_TTL_MS = 30_000/);

assert.match(
  picker,
  /const pages = await batch\.promise;\s*if \(!isCurrent\(\)\) return;\s*if \(\s*pages &&\s*categoryBatchRef\.current === batch &&\s*Date\.now\(\) - batch\.startedAt < CATEGORY_BATCH_TTL_MS/,
);

assert.match(
  picker,
  /result = pages\[category\];\s*\}\s*\}\s*if \(!result\) \{\s*const response = await fetch/,
);

assert.doesNotMatch(
  picker,
  /throw new Error\("catalog_category_batch_failed"\)/,
);

assert.match(
  picker,
  /if \(categoryBatchRef\.current === batch\) \{\s*categoryBatchRef\.current = null;/,
);

console.log("catalog-category-prefetch-contract: PASS");
assert.match(
  picker,
  /DETAIL_CACHE_TTL_MS = 30_000/,
);

assert.match(
  picker,
  /DETAIL_CACHE_MAX_ENTRIES = 20/,
);

assert.match(
  picker,
  /DETAIL_URL_SAFETY_MARGIN_MS = 5_000/,
);

assert.match(
  picker,
  /function detailCacheKey[\s\S]*?organizationId,\s*storeId,\s*product\.sourceKind,\s*product\.sourceId/,
);

assert.match(
  picker,
  /if \(cached && cached\.expiresAt > now\)[\s\S]*?setDetail\(cached\.product\)/,
);

assert.match(
  picker,
  /requestStartedAt \+ Math\.min\([\s\S]*?DETAIL_CACHE_TTL_MS,[\s\S]*?DETAIL_URL_SAFETY_MARGIN_MS/,
);

assert.match(
  picker,
  /while \(cache\.size >= DETAIL_CACHE_MAX_ENTRIES\)/,
);

assert.match(
  picker,
  /revision === detailRevision\.current/,
);

assert.match(
  picker,
  /function reloadDetail\(\)[\s\S]*?detailCacheRef\.current\.delete/,
);

assert.match(
  picker,
  /const cache = detailCacheRef\.current;\s*return \(\) => \{\s*cache\.clear\(\);/,
);

assert.match(
  picker,
  /if \(!response\.ok\) \{\s*cache\.clear\(\);/,
);

console.log("catalog-detail-cache-contract: PASS");
assert.match(
  picker,
  /function isCatalogAuthorityDenied[\s\S]*?\[401, 403, 409, 503\]\.includes\(status\)/,
);

assert.match(
  picker,
  /function blockCatalogAccess\(\)[\s\S]*?authorityBlockedRef\.current = true;/,
);

assert.match(
  picker,
  /function blockCatalogAccess\(\)[\s\S]*?listRevision\.current \+= 1;[\s\S]*?detailRevision\.current \+= 1;/,
);

assert.match(
  picker,
  /function blockCatalogAccess\(\)[\s\S]*?categoryBatchRef\.current = null;[\s\S]*?detailCacheRef\.current\.clear\(\);/,
);

assert.match(
  picker,
  /function blockCatalogAccess\(\)[\s\S]*?setProducts\(\[\]\);[\s\S]*?setSelection\(null\);[\s\S]*?setDetail\(null\);/,
);

assert.equal(
  (picker.match(/isCatalogAuthorityDenied\(response\.status\)/g) || []).length,
  3,
);

assert.match(
  picker,
  /revision === listRevision\.current && !authorityBlockedRef\.current/,
);

assert.match(
  picker,
  /revision === detailRevision\.current && !authorityBlockedRef\.current/,
);

assert.match(
  picker,
  /\{authorityBlocked \? \(/,
);

assert.match(
  picker,
  /function confirmProduct\(product: ProductDetail\) \{\s*if \(authorityBlockedRef\.current\) return;/,
);

console.log("catalog-authority-invalidation-contract: PASS");
assert.match(
  picker,
  /SEARCH_CACHE_TTL_MS = 30_000/,
);

assert.match(
  picker,
  /SEARCH_CACHE_MAX_ENTRIES = 20/,
);

assert.match(
  picker,
  /const cacheKey = params\.toString\(\);/,
);

assert.match(
  picker,
  /cachedPage\.expiresAt > performance\.now\(\)/,
);

assert.match(
  picker,
  /listCache\.get\(cacheKey\) === cachedPage/,
);

assert.match(
  picker,
  /result = cachedPage\.result;/,
);

assert.match(
  picker,
  /cachedPageUsable \? 0 : query && page === 0 \? 400 : 0/,
);

assert.match(
  picker,
  /fetchedDirectly &&\s*isCurrent\(\) &&\s*expiresAt > performance\.now\(\)/,
);

assert.match(
  picker,
  /requestStartedAt \+ SEARCH_CACHE_TTL_MS/,
);

assert.match(
  picker,
  /while \(listCache\.size >= SEARCH_CACHE_MAX_ENTRIES\)/,
);

assert.match(
  picker,
  /categoryBatchRef\.current = null;\s*detailCacheRef\.current\.clear\(\);\s*searchPageCacheRef\.current\.clear\(\);/,
);

assert.match(
  picker,
  /cache\.clear\(\);\s*searchCache\.clear\(\);/,
);

assert.match(
  picker,
  /result\.pageSize !== 100/,
);

assert.match(
  picker,
  /seen\.has\(identity\)/,
);

assert.match(
  picker,
  /listRevision\.current \+= 1;\s*searchPageCacheRef\.current\.clear\(\);\s*categoryBatchRef\.current = null;/,
);

console.log("catalog-search-cache-contract: PASS");
assert.match(
  picker,
  /import type \{ CatalogCommercialProduct \} from "\.\/catalog-commercial-message"/,
);

assert.match(
  picker,
  /commercialDetails: CatalogCommercialProduct;/,
);

const commercialSelection = picker.match(
  /commercialDetails: \{\s*sourceKind: product\.sourceKind,\s*category: normalizeCategory\(product\),\s*name: product\.name,\s*description: product\.description,\s*price: product\.price,\s*priceStatus: product\.priceStatus,\s*characteristics: product\.characteristics,\s*\}/,
);

assert.ok(
  commercialSelection,
  "Expected only the approved commercial detail fields",
);

assert.doesNotMatch(
  commercialSelection[0],
  /stockQuantity|stockStatus|organizationId|storeId|storage_path|metadata|photos|previewUrl/,
);

assert.match(
  picker,
  /function confirmProduct\(product: ProductDetail\) \{\s*if \(authorityBlockedRef\.current\) return;/,
);

assert.doesNotMatch(
  picker,
  /buildCatalogCommercialMessage\(/,
);

console.log("catalog-commercial-selection-contract: PASS");
assert.match(page, /buildCatalogCommercialMessage\(\s*product\.commercialDetails,\s*CATALOG_COMMERCIAL_CAPTION_LIMIT - prefix\.length,/);

assert.doesNotMatch(page, /setNewMessage\(product\.name\.trim\(\)\)/);

assert.match(page, /const originalDraft = newMessage;/);

assert.match(page, /caption: prefix \+ commercialMessage,/);

assert.match(page, /function clearSelectedCatalogProduct\(\) \{\s*setSelectedCatalogProduct\(null\);\s*\}/);

assert.match(page, /openingScope !== catalogScopeKey/);

assert.match(page, /selectedCatalogProduct\.scopeKey !== catalogScopeKey/);

assert.match(page, /lead\.organization_id === catalogOrganizationId/);

assert.match(page, /lead\.store_id === catalogStoreId/);

assert.match(page, /async function sendMessage\(catalogConfirmed = false\)/);

assert.match(page, /catalogConfirmed !== true \|\|\s*!catalogSelectionCurrent/);

assert.match(page, /onClick=\{\(\) => void sendMessage\(true\)\}/);

assert.equal(
  (page.match(/sendMessage\(true\)/g) || []).length,
  1,
);

assert.match(page, /if \(!sent\) return;/);

assert.match(page, /current === selectedCatalogProduct\.originalDraft/);

assert.match(page, /function handleCatalogCaptionChange[\s\S]*?caption: value,\s*operationId: globalThis\.crypto\.randomUUID\(\)/);

assert.match(page, /aria-label="Mensagem comercial do produto"/);

assert.match(page, /value=\{selectedCatalogProduct\.caption\}/);

assert.match(page, /maxLength=\{CATALOG_COMMERCIAL_CAPTION_LIMIT\}/);

assert.match(page, /Enviar mensagem e foto/);

assert.match(page, /Remover produto/);

assert.match(page, /function handleInputKeyDown[\s\S]*?if \(selectedCatalogProduct \|\| event\.nativeEvent\.isComposing\)/);

assert.match(page, /onSelect=\{editingFactKey === "interested_product_reference" \? \(product\) => \{\s*setEditingFactValue\(product\.name\);\s*setCatalogPickerOpen\(false\);\s*\} : selectCatalogProduct\}/);

console.log("catalog-commercial-composer-contract: PASS");
console.log("catalog-product-picker: PASS");

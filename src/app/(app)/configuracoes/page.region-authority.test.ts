import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PAGE_PATH = path.join(
  process.cwd(),
  "src/app/(app)/configuracoes/page.tsx",
);

const STRATEGY_LIB_PATH = path.join(
  process.cwd(),
  "src/lib/store-strategy-settings.ts",
);

function readPageSource() {
  return fs.readFileSync(PAGE_PATH, "utf8");
}

function readStrategyLibSource() {
  return fs.readFileSync(STRATEGY_LIB_PATH, "utf8");
}

function getRegionSaveBlock(source: string) {
  const start = source.indexOf(
    "  const handleRegionEditSave = useCallback(async () => {",
  );

  assert.ok(start >= 0, "handleRegionEditSave not found");

  const end = source.indexOf(
    "  const handleGeneralInformationSave = useCallback(async () => {",
    start,
  );

  assert.ok(end > start, "handleRegionEditSave end not found");

  return source.slice(start, end);
}

function getRegionCardBlock(source: string) {
  const titleIndex = source.indexOf('title="Região de atendimento"');

  assert.ok(titleIndex >= 0, "Region card title not found");

  const start = source.lastIndexOf("<SectionBlock", titleIndex);

  assert.ok(start >= 0, "Region card start not found");

  const visitTitleIndex = source.indexOf(
    'title="Visita técnica"',
    titleIndex,
  );

  assert.ok(
    visitTitleIndex > titleIndex,
    "Technical visit card after Region not found",
  );

  const end = source.lastIndexOf("<SectionBlock", visitTitleIndex);

  assert.ok(end > start, "Region card end not found");

  return source.slice(start, end);
}

test("strategy settings row exposes the explicit region configuration marker", () => {
  const source = readStrategyLibSource();

  assert.equal(
    source.includes("service_region_configured_at?: string | null;"),
    true,
  );
});

test("settings page reads the canonical region configuration marker", () => {
  const source = readPageSource();

  assert.equal(
    source.includes(
      "service_region_outside_consultation, service_region_configured_at, service_region_notes",
    ),
    true,
  );

  assert.equal(
    source.includes(
      "strategySettings?.service_region_configured_at",
    ),
    true,
  );
});

test("region completeness is derived from explicit configuration marker", () => {
  const source = readPageSource();
  const block = getRegionCardBlock(source);

  assert.equal(
    block.includes('tone={isRegionConfigured ? "blue" : "yellow"}'),
    true,
  );

  assert.equal(
    block.includes(
      'status={isRegionConfigured ? "Completo" : "Precisa de atenção"}',
    ),
    true,
  );

  assert.equal(
    block.includes(
      "strategySettingsInput.serviceRegionModes.length || strategySettingsInput.serviceRegions",
    ),
    false,
  );
});

test("region card uses only canonical primary coverage modes", () => {
  const source = readPageSource();
  const block = getRegionCardBlock(source);

  assert.equal(
    block.includes(
      "value={strategyDraft.serviceRegionPrimaryMode}",
    ),
    true,
  );

  assert.equal(
    block.includes("SERVICE_REGION_MODE_OPTIONS.filter("),
    true,
  );

  assert.equal(
    block.includes('option.value !== "sob_consulta"'),
    true,
  );

  assert.equal(block.includes('value:"cidade_loja"'), false);
  assert.equal(block.includes('value:"cidade_vizinhas"'), false);
  assert.equal(block.includes('value:"varias_cidades"'), false);
  assert.equal(block.includes('value:"outra"'), false);
});

test("outside coverage exposes only consultation or no", () => {
  const source = readPageSource();
  const block = getRegionCardBlock(source);

  assert.equal(
    block.includes('label: "Sim, mas somente sob consulta"'),
    true,
  );

  assert.equal(
    block.includes('value: "consulta"'),
    true,
  );

  assert.equal(
    block.includes('value: "nao"'),
    true,
  );

  assert.equal(
    block.includes("Sim, normalmente"),
    false,
  );
});

test("region save uses only the dedicated scoped writer", () => {
  const source = readPageSource();
  const block = getRegionSaveBlock(source);

  assert.equal(
    block.includes(
      '"upsert_store_strategy_region_configuration_scoped"',
    ),
    true,
  );

  assert.equal(
    block.includes(
      '"upsert_store_strategy_settings_with_legacy_mirror_scoped"',
    ),
    false,
  );

  assert.equal(
    block.includes(
      '"upsert_store_strategy_settings_scoped"',
    ),
    false,
  );
});

test("region save requires an explicit outside-coverage human choice", () => {
  const source = readPageSource();
  const block = getRegionSaveBlock(source);

  assert.equal(
    block.includes(
      'if (!["consulta", "nao"].includes(outsidePolicy))',
    ),
    true,
  );

  assert.equal(
    block.includes(
      'p_service_region_outside_consultation:',
    ),
    true,
  );

  assert.equal(
    block.includes('outsidePolicy === "consulta"'),
    true,
  );
});

test("region save sends only the regional canonical payload", () => {
  const source = readPageSource();
  const block = getRegionSaveBlock(source);

  for (const expected of [
    "p_organization_id:",
    "p_store_id:",
    "p_service_regions:",
    "p_service_region_modes:",
    "p_service_region_primary_mode:",
    "p_service_region_outside_consultation:",
    "p_service_region_notes:",
  ]) {
    assert.equal(
      block.includes(expected),
      true,
      `missing canonical region argument ${expected}`,
    );
  }

  for (const forbidden of [
    "p_store_services:",
    "p_store_description:",
    "p_main_store_brand:",
    "p_strategy_primary_focus:",
    "p_strategy_ai_never_forget:",
  ]) {
    assert.equal(
      block.includes(forbidden),
      false,
      `region writer must not carry unrelated Strategy argument ${forbidden}`,
    );
  }
});

test("region summary no longer reads the local operation-experience authority", () => {
  const source = readPageSource();
  const block = getRegionCardBlock(source);

  assert.equal(
    block.includes(
      "savedOperationExperience.region_outside_policy",
    ),
    false,
  );

  assert.equal(
    block.includes(
      "strategySettingsInput.serviceRegionOutsideConsultation",
    ),
    true,
  );

  assert.equal(
    block.includes("canonicalRegionOutsidePolicy"),
    true,
  );
});

test("unconfigured false is not rendered as an explicit human No", () => {
  const source = readPageSource();

  assert.equal(
    source.includes(
      'const canonicalRegionOutsidePolicy = isRegionConfigured',
    ),
    true,
  );

  assert.equal(
    source.includes(
      'strategySettings?.service_region_outside_consultation === true',
    ),
    true,
  );
});
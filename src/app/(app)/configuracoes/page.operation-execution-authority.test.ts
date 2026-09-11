import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pagePath = "src/app/(app)/configuracoes/page.tsx";
const source = fs.readFileSync(pagePath, "utf8");

function blockBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `start not found: ${start}`);
  assert.notEqual(endIndex, -1, `end not found: ${end}`);
  assert.equal(endIndex > startIndex, true);

  return source.slice(startIndex, endIndex);
}

test("page reads canonical execution authority", () => {
  assert.equal(
    source.includes(
      '"read_store_operation_execution_policies_scoped"',
    ),
    true,
  );

  assert.equal(
    source.includes(
      "operationExecutionPolicies?.technical_visit_configured_at",
    ),
    true,
  );

  assert.equal(
    source.includes(
      "operationExecutionPolicies?.installation_configured_at",
    ),
    true,
  );
});

test("technical visit uses dedicated atomic writer", () => {
  assert.equal(
    source.includes(
      '"upsert_store_operation_technical_visit_configuration_scoped"',
    ),
    true,
  );

  assert.equal(
    source.includes(
      'onClick={()=>void saveTechnicalVisitConfigurationCard()}',
    ),
    true,
  );
});

test("installation uses dedicated atomic writer", () => {
  assert.equal(
    source.includes(
      '"upsert_store_operation_installation_configuration_scoped"',
    ),
    true,
  );

  assert.equal(
    source.includes(
      'onClick={()=>void saveInstallationConfigurationCard()}',
    ),
    true,
  );
});

test("old local save bridge is gone from Cards 5 through 10", () => {
  for (const oldCall of [
    'saveOperationExperienceCard("technical_visit", false)',
    'saveOperationExperienceCard("installation", false)',
    'saveOperationExperienceCard("pool_replacement")',
    'saveOperationExperienceCard("delivery")',
    'saveOperationExperienceCard("pickup")',
    'saveOperationExperienceCard("technical_services")',
  ]) {
    assert.equal(
      source.includes(oldCall),
      false,
      `old local save bridge still present: ${oldCall}`,
    );
  }
});

test("technical visit status depends on canonical completeness", () => {
  assert.equal(
    source.includes(
      'tone={technicalVisitCardIsComplete ? "blue" : "yellow"}',
    ),
    true,
  );

  assert.equal(
    source.includes(
      "operationSettingsInput.offersTechnicalVisit && !savedOperationExperience.visit_duration_mode",
    ),
    false,
  );
});

test("installation status depends on canonical completeness", () => {
  assert.equal(
    source.includes(
      'tone={installationCardIsComplete ? "blue" : "yellow"}',
    ),
    true,
  );

  assert.equal(
    source.includes(
      'Number(savedOperationExperience.installation_concurrent_capacity || "1") <= 0',
    ),
    false,
  );
});

test("technical visit writer carries rich policy and pricing only", () => {
  const visitBlock = blockBetween(
    "const saveTechnicalVisitConfigurationCard = useCallback",
    "const saveInstallationConfigurationCard = useCallback",
  );

  assert.equal(
    visitBlock.includes("buildTechnicalVisitExecutionPolicy("),
    true,
  );
  assert.equal(
    visitBlock.includes("parseVisitFixedFeeToCents("),
    true,
  );
  assert.equal(
    visitBlock.includes("p_offers_technical_visit"),
    true,
  );
  assert.equal(
    visitBlock.includes("p_technical_visit_policy"),
    true,
  );
  assert.equal(
    visitBlock.includes("p_offers_installation"),
    false,
  );
});

test("installation writer carries installation policy only", () => {
  const installBlock = blockBetween(
    "const saveInstallationConfigurationCard = useCallback",
    "const handleOperationEditSave = useCallback",
  );

  assert.equal(
    installBlock.includes("buildInstallationExecutionPolicy("),
    true,
  );
  assert.equal(
    installBlock.includes("p_offers_installation"),
    true,
  );
  assert.equal(
    installBlock.includes("p_installation_policy"),
    true,
  );
  assert.equal(
    installBlock.includes("p_offers_technical_visit"),
    false,
  );
});

test("canonical DB policies hydrate both UI drafts", () => {
  assert.equal(
    source.includes("technicalVisitPolicyToDraftPatch("),
    true,
  );
  assert.equal(
    source.includes("installationPolicyToDraftPatch("),
    true,
  );
});

test("cards close only after successful dedicated RPC", () => {
  const visitBlock = blockBetween(
    "const saveTechnicalVisitConfigurationCard = useCallback",
    "const saveInstallationConfigurationCard = useCallback",
  );

  const installBlock = blockBetween(
    "const saveInstallationConfigurationCard = useCallback",
    "const handleOperationEditSave = useCallback",
  );

  assert.equal(
    visitBlock.indexOf("if (error) throw error") <
      visitBlock.indexOf("setOperationEditTarget(null)"),
    true,
  );

  assert.equal(
    installBlock.indexOf("if (error) throw error") <
      installBlock.indexOf("setOperationEditTarget(null)"),
    true,
  );
});
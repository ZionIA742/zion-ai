import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

assert.equal(
  source.includes(
    '"panel_list_commercial_opportunity_priority_scoped"',
  ),
  true,
  "CRM lead page must use the canonical P9 commercial priority reader",
);

assert.equal(
  source.includes("p_as_of: null"),
  true,
  "CRM priority must be evaluated using the canonical reader current-time behavior",
);

assert.equal(
  source.includes(
    'String(row.commercial_opportunity_id || "").trim() === opportunityId',
  ),
  true,
  "CRM must bind priority to the exact selected commercial opportunity",
);

for (const band of ["urgent", "high", "normal", "low"]) {
  assert.equal(
    source.includes(`${band}: {`),
    true,
    `missing visual mapping for canonical priority band ${band}`,
  );
}

assert.equal(source.includes('label: "Muito alta"'), true);
assert.equal(source.includes('label: "Alta"'), true);
assert.equal(source.includes('label: "Média"'), true);
assert.equal(source.includes('label: "Baixa"'), true);

assert.equal(source.includes("text-red-600"), true);
assert.equal(source.includes("text-orange-500"), true);
assert.equal(source.includes("text-amber-400"), true);
assert.equal(source.includes("text-sky-400"), true);

assert.equal(
  source.includes('data-priority-flame-icon="second-row-second"'),
  true,
  "CRM must use the approved flame silhouette",
);

assert.equal(
  source.includes(
    "Este lead precisa de atenção imediata. Há sinais fortes de prioridade na negociação.",
  ),
  true,
);

assert.equal(
  source.includes(
    "Este lead merece atenção agora. Há sinais importantes para continuar a negociação.",
  ),
  true,
);

assert.equal(
  source.includes(
    "Este lead está em acompanhamento. A negociação continua ativa, mas sem grande urgência.",
  ),
  true,
);

assert.equal(
  source.includes("Este lead está com baixa prioridade no momento. Não há sinais importantes que exijam atenção agora."),
  true,
);

const stageIndex = source.indexOf("{selectedOpportunityStageLabel}");
const flameIndex = source.indexOf(
  '<PriorityFlameIcon className="h-[19px] w-[19px]" />',
  stageIndex,
);

assert.equal(stageIndex >= 0, true, "selected stage chip not found");
assert.equal(
  flameIndex > stageIndex,
  true,
  "priority flame must render beside the selected opportunity stage",
);

assert.equal(
  source.includes('aria-label="Prioridade comercial do lead"'),
  true,
  "priority flame must expose an explanatory popover",
);

assert.equal(
  source.includes("lead_temperature"),
  false,
  "CRM must not create a parallel lead temperature field",
);

console.log("ok - crm lead canonical priority flame contract");
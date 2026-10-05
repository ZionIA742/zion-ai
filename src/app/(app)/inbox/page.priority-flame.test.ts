import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

assert.equal(
  source.includes('data-priority-flame-icon="second-row-second"'),
  true,
  "Inbox must use the approved flame silhouette",
);

for (const expected of [
  'label: "Muito alta"',
  'label: "Alta"',
  'label: "Média"',
  'label: "Baixa"',
  "text-red-600",
  "text-orange-500",
  "text-amber-400",
  "text-sky-400",
]) {
  assert.equal(
    source.includes(expected),
    true,
    `missing canonical priority visual: ${expected}`,
  );
}

for (const expected of [
  "Este lead precisa de atenção imediata. Há sinais fortes de prioridade na negociação.",
  "Este lead merece atenção agora. Há sinais importantes para continuar a negociação.",
  "Este lead está em acompanhamento. A negociação continua ativa, mas sem grande urgência.",
  "Este lead está com baixa prioridade no momento. Não há sinais importantes que exijam atenção agora.",
]) {
  assert.equal(
    source.includes(expected),
    true,
    `missing simple priority explanation: ${expected}`,
  );
}

assert.equal(
  source.includes(
    '"panel_list_crm_opportunity_cards_scoped"',
  ),
  true,
  "Inbox must use the canonical CRM opportunity reader to bind conversation to opportunity",
);

assert.equal(
  source.includes(
    "if (opportunityContextScopeKeyRef.current === scopeKey)",
  ),
  true,
  "conversation/opportunity context must be cached instead of queried on every 10-second refresh",
);

assert.equal(
  source.includes("if (opportunityIds?.size === 1)"),
  true,
  "ambiguous conversation/opportunity mappings must fail closed",
);

assert.equal(
  source.includes(
    "opportunityIdByConversation[row.conversation_id] || null",
  ),
  true,
  "recent Inbox cards must resolve their exact opportunity before showing priority",
);

const flameUses =
  source.match(
    /<PriorityFlame\s+priorityBand=\{[^}]+priority_band\}/g,
  ) || [];

assert.equal(
  flameUses.length >= 2,
  true,
  "priority flame must render in recent-message and follow-up cards",
);

assert.equal(
  source.includes("Cliente aguardando</span>"),
  true,
);

assert.equal(
  source.includes("Respondido</span>"),
  true,
);

assert.equal(
  source.includes("Prioridade {priority.priority_band}"),
  true,
);

console.log(
  "ok - inbox and follow-up canonical priority flame contract",
);
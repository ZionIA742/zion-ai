import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type CommercialTask = {
  id: string;
  commercial_opportunity_id: string | null;
  task_payload: {
    next_step?: string | null;
    conversation_summary?: string | null;
    location_text?: string | null;
    customer_preferences?: string | null;
    relevant_objection?: string | null;
  } | null;
};

type QualificationKnownFact = {
  factKey?: string | null;
  state?: string | null;
  value?: unknown;
  normalizedValueText?: string | null;
};

type QualificationConflictFact = {
  factKey?: string | null;
};

type QualificationFactsSnapshot = {
  commercial_opportunity_id?: string | null;
  known_facts?: QualificationKnownFact[] | null;
  conflicts?: QualificationConflictFact[] | null;
};

type LeadDetailsResponse = {
  ok: true;
  selectedOpportunityId: string | null;
  commercialTasks: CommercialTask[];
  qualificationFacts: QualificationFactsSnapshot | null;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function qualificationFactValue(
  snapshot: QualificationFactsSnapshot | null,
  factKey: string,
) {
  const conflict = (snapshot?.conflicts || []).find((fact) => fact.factKey === factKey);
  if (conflict) return "Precisa de confirmação";

  const knownFact = (snapshot?.known_facts || []).find(
    (fact) =>
      fact.factKey === factKey &&
      (fact.state === "confirmed" || fact.state === "inferred"),
  );
  if (!knownFact) return "Não informado";

  const normalizedValueText = String(knownFact.normalizedValueText || "").trim();
  if (normalizedValueText) return normalizedValueText;

  if (typeof knownFact.value === "string") return knownFact.value.trim() || "Não informado";
  return "Não informado";
}

function renderGlobalSummaryAndContext(snapshot: QualificationFactsSnapshot | null) {
  return {
    need: qualificationFactValue(snapshot, "need_summary"),
    product: qualificationFactValue(snapshot, "interested_product_reference"),
    location: qualificationFactValue(snapshot, "location_text"),
    preferences: qualificationFactValue(snapshot, "customer_preferences_text"),
    objection: qualificationFactValue(snapshot, "relevant_objection_text"),
  };
}

class LeadDetailsHarness {
  readonly leadId = "lead-a";
  readonly pending = new Map<string, Deferred<LeadDetailsResponse>>();
  readonly calls: string[] = [];

  requestedOpportunityId: string | null = "opp-a";
  commercialTasks: CommercialTask[] = [];
  qualificationFacts: QualificationFactsSnapshot | null = null;
  leadDetailsScopeRef: string | null = null;

  get leadDetailsScopeKey() {
    return `${this.leadId}::${this.requestedOpportunityId || ""}`;
  }

  applySelectedOpportunity(opportunityId: string) {
    this.commercialTasks = [];
    this.qualificationFacts = null;
    this.requestedOpportunityId = opportunityId;
  }

  async fetchLeadDetails() {
    const scopedLeadDetailsKey = this.leadDetailsScopeKey;
    this.leadDetailsScopeRef = scopedLeadDetailsKey;
    const opportunityId = this.requestedOpportunityId || "";
    const deferred = createDeferred<LeadDetailsResponse>();

    this.calls.push(opportunityId || "no-opportunity");
    this.pending.set(opportunityId || "no-opportunity", deferred);

    const result = await deferred.promise;

    if (this.leadDetailsScopeRef !== scopedLeadDetailsKey) {
      return;
    }

    this.commercialTasks = Array.isArray(result.commercialTasks)
      ? result.commercialTasks
      : [];
    this.qualificationFacts = result.qualificationFacts ?? null;
  }
}

const oldTask: CommercialTask = {
  id: "task-old",
  commercial_opportunity_id: "opp-a",
  task_payload: {
    next_step: "Enviar proposta antiga",
    conversation_summary: "Cliente queria modelo antigo",
    location_text: "Local antigo",
    customer_preferences: "Preferência antiga",
    relevant_objection: "Objeção antiga",
  },
};

const factsA: QualificationFactsSnapshot = {
  commercial_opportunity_id: "opp-a",
  known_facts: [
    { factKey: "need_summary", state: "confirmed", normalizedValueText: "necessidade atual" },
    {
      factKey: "interested_product_reference",
      state: "confirmed",
      normalizedValueText: "produto atual",
    },
    { factKey: "location_text", state: "confirmed", normalizedValueText: "localização atual" },
    {
      factKey: "customer_preferences_text",
      state: "confirmed",
      normalizedValueText: "preferência atual",
    },
    {
      factKey: "relevant_objection_text",
      state: "confirmed",
      normalizedValueText: "objeção atual",
    },
  ],
  conflicts: [],
};

const factsB: QualificationFactsSnapshot = {
  commercial_opportunity_id: "opp-b",
  known_facts: [
    { factKey: "need_summary", state: "confirmed", normalizedValueText: "necessidade B" },
    {
      factKey: "interested_product_reference",
      state: "confirmed",
      normalizedValueText: "produto B",
    },
    { factKey: "location_text", state: "confirmed", normalizedValueText: "localização B" },
  ],
  conflicts: [],
};

const pagePath = join(process.cwd(), "src/app/(app)/crm/lead/[id]/page.tsx");
const source = readFileSync(pagePath, "utf8");

for (const forbidden of [
  "latestCommercialTask?.task_payload?.next_step ||",
  "latestCommercialTask?.task_payload?.conversation_summary ||",
  "latestCommercialTask?.task_payload?.ad_model_or_requested_model ||",
  "latestCommercialTask?.task_payload?.recommended_model ||",
  "latestCommercialTask?.task_payload?.space_text ||",
  "latestCommercialTask?.task_payload?.location_text ||",
  "latestCommercialTask?.task_payload?.customer_preferences ||",
  "latestCommercialTask?.task_payload?.relevant_objection ||",
]) {
  assert.equal(
    source.includes(forbidden),
    false,
    `global summary/context must not use task payload: ${forbidden}`,
  );
}

assert.equal(
  source.includes("setQualificationFacts(null);"),
  true,
  "opportunity changes must clear previous qualification facts snapshot",
);

assert.deepEqual(renderGlobalSummaryAndContext(factsA), {
  need: "necessidade atual",
  product: "produto atual",
  location: "localização atual",
  preferences: "preferência atual",
  objection: "objeção atual",
});
assert.equal(
  renderGlobalSummaryAndContext(factsA).location,
  "localização atual",
  "global context must prefer current Qualification Facts over stale task payload",
);
assert.equal(
  oldTask.task_payload?.next_step,
  "Enviar proposta antiga",
  "stale task next_step remains associated only with the operational task",
);
assert.equal(
  Object.values(renderGlobalSummaryAndContext(factsA)).includes("Local antigo"),
  false,
  "stale task location must not contaminate global context",
);
assert.equal(
  Object.values(renderGlobalSummaryAndContext(factsA)).includes("Preferência antiga"),
  false,
  "stale task preferences must not contaminate global context",
);
assert.equal(
  Object.values(renderGlobalSummaryAndContext(factsA)).includes("Objeção antiga"),
  false,
  "stale task objection must not contaminate global context",
);
assert.equal(
  qualificationFactValue(
    { known_facts: [], conflicts: [{ factKey: "location_text" }] },
    "location_text",
  ),
  "Precisa de confirmação",
  "conflicts must not silently choose a value",
);
assert.equal(
  qualificationFactValue(null, "location_text"),
  "Não informado",
  "absence must remain empty/safe",
);

const harness = new LeadDetailsHarness();
const pendingA = harness.fetchLeadDetails();

harness.applySelectedOpportunity("opp-b");
assert.equal(harness.qualificationFacts, null);
assert.deepEqual(harness.commercialTasks, []);

const pendingB = harness.fetchLeadDetails();
assert.deepEqual(harness.calls, ["opp-a", "opp-b"]);

harness.pending.get("opp-b")?.resolve({
  ok: true,
  selectedOpportunityId: "opp-b",
  commercialTasks: [],
  qualificationFacts: factsB,
});
await pendingB;

const currentFactsAfterB = harness.qualificationFacts as QualificationFactsSnapshot | null;
assert.equal(currentFactsAfterB?.commercial_opportunity_id, "opp-b");
assert.deepEqual(renderGlobalSummaryAndContext(currentFactsAfterB), {
  need: "necessidade B",
  product: "produto B",
  location: "localização B",
  preferences: "Não informado",
  objection: "Não informado",
});

harness.pending.get("opp-a")?.resolve({
  ok: true,
  selectedOpportunityId: "opp-a",
  commercialTasks: [oldTask],
  qualificationFacts: factsA,
});
await pendingA;

const currentFactsAfterStaleA = harness.qualificationFacts as QualificationFactsSnapshot | null;
assert.equal(
  currentFactsAfterStaleA?.commercial_opportunity_id,
  "opp-b",
  "stale facts from opportunity A must not replace opportunity B",
);
assert.deepEqual(
  harness.commercialTasks,
  [],
  "stale task from opportunity A must not replace opportunity B",
);

const noOpportunityHarness = new LeadDetailsHarness();
noOpportunityHarness.requestedOpportunityId = null;
const noOpportunityRequest = noOpportunityHarness.fetchLeadDetails();
noOpportunityHarness.pending.get("no-opportunity")?.resolve({
  ok: true,
  selectedOpportunityId: null,
  commercialTasks: [],
  qualificationFacts: null,
});
await noOpportunityRequest;

assert.equal(noOpportunityHarness.qualificationFacts, null);
assert.deepEqual(renderGlobalSummaryAndContext(noOpportunityHarness.qualificationFacts), {
  need: "Não informado",
  product: "Não informado",
  location: "Não informado",
  preferences: "Não informado",
  objection: "Não informado",
});

console.log("ok - lead detail qualification facts semantic authority contract");

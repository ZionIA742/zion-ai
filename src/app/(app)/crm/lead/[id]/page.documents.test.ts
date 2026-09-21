import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Opportunity = {
  id: string;
};

type Quote = {
  id: string;
  quote_number: string;
};

type Contract = {
  id: string;
  contract_number: string;
  quote_id: string;
};

type FetchCall = {
  url: string;
  leadId: string | null;
  commercialOpportunityId: string | null;
  kind: "quotes" | "contracts";
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

function createJsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  };
}

function quoteNumbers(quotes: Quote[]) {
  return quotes.map((quote) => quote.quote_number);
}

function contractNumbers(contracts: Contract[]) {
  return contracts.map((contract) => contract.contract_number);
}

class DocumentsHarness {
  readonly leadId = "lead-a";
  readonly opportunities: Opportunity[] = [{ id: "opp-a" }, { id: "opp-b" }];
  readonly calls: FetchCall[] = [];
  readonly pending = {
    quotes: new Map<string, Deferred<unknown>>(),
    contracts: new Map<string, Deferred<unknown>>(),
  };

  selectedOpportunityId: string | null = "opp-a";
  activeDetailsTab: "overview" | "pdfs" = "overview";
  generatedQuotes: Quote[] = [{ id: "quote-1", quote_number: "Q1" }];
  generatedContracts: Contract[] = [
    { id: "contract-1", contract_number: "C1", quote_id: "quote-1" },
  ];
  documentScopeRef: string | null = null;

  get selectedOpportunity() {
    return (
      this.opportunities.find(
        (opportunity) => opportunity.id === this.selectedOpportunityId,
      ) || null
    );
  }

  get selectedDocumentOpportunityId() {
    return this.selectedOpportunity?.id || null;
  }

  get documentScopeKey() {
    return this.leadId && this.selectedDocumentOpportunityId
      ? `${this.leadId}:${this.selectedDocumentOpportunityId}`
      : null;
  }

  setSelectedOpportunityId(opportunityId: string | null) {
    this.selectedOpportunityId = opportunityId;
    this.onDocumentScopeChanged();
  }

  applySelectedOpportunity(opportunityId: string) {
    this.documentScopeRef = null;
    this.generatedQuotes = [];
    this.generatedContracts = [];
    this.setSelectedOpportunityId(opportunityId);
  }

  onDocumentScopeChanged() {
    this.documentScopeRef = this.documentScopeKey;
    this.generatedQuotes = [];
    this.generatedContracts = [];
  }

  openDocumentsTab() {
    this.activeDetailsTab = "pdfs";

    if (!this.documentScopeKey) {
      return [];
    }

    return [this.fetchGeneratedQuotes(), this.fetchGeneratedContracts()];
  }

  async fetch(url: string) {
    const parsed = new URL(url, "https://example.test");
    const leadId = parsed.searchParams.get("leadId");
    const commercialOpportunityId = parsed.searchParams.get("commercialOpportunityId");
    const kind = parsed.pathname.includes("sales-quotes") ? "quotes" : "contracts";
    const deferred = createDeferred<unknown>();

    this.calls.push({
      url,
      leadId,
      commercialOpportunityId,
      kind,
    });

    this.pending[kind].set(String(commercialOpportunityId), deferred);
    return deferred.promise;
  }

  async fetchGeneratedQuotes() {
    const scopedLeadId = this.leadId;
    const scopedOpportunityId = this.selectedDocumentOpportunityId;
    const scopedDocumentKey = this.documentScopeKey;

    if (!scopedLeadId || !scopedOpportunityId || !scopedDocumentKey) {
      this.generatedQuotes = [];
      return;
    }

    this.documentScopeRef = scopedDocumentKey;

    const params = new URLSearchParams({
      leadId: scopedLeadId,
      commercialOpportunityId: scopedOpportunityId,
    });
    const response = (await this.fetch(`/api/sales-quotes?${params.toString()}`)) as {
      ok: boolean;
      json: () => Promise<{ ok?: boolean; quotes?: Quote[]; message?: string }>;
    };
    const result = await response.json();

    if (this.documentScopeRef !== scopedDocumentKey) {
      return;
    }

    if (!response.ok || !result?.ok) {
      throw new Error(result?.message || "Nao foi possivel carregar os PDFs gerados.");
    }

    this.generatedQuotes = Array.isArray(result.quotes) ? result.quotes : [];
  }

  async fetchGeneratedContracts() {
    const scopedLeadId = this.leadId;
    const scopedOpportunityId = this.selectedDocumentOpportunityId;
    const scopedDocumentKey = this.documentScopeKey;

    if (!scopedLeadId || !scopedOpportunityId || !scopedDocumentKey) {
      this.generatedContracts = [];
      return;
    }

    this.documentScopeRef = scopedDocumentKey;

    const params = new URLSearchParams({
      leadId: scopedLeadId,
      commercialOpportunityId: scopedOpportunityId,
    });
    const response = (await this.fetch(`/api/sales-contracts?${params.toString()}`)) as {
      ok: boolean;
      json: () => Promise<{ ok?: boolean; contracts?: Contract[]; message?: string }>;
    };
    const result = await response.json();

    if (this.documentScopeRef !== scopedDocumentKey) {
      return;
    }

    if (!response.ok || !result?.ok) {
      throw new Error(result?.message || "Nao foi possivel carregar os contratos.");
    }

    this.generatedContracts = Array.isArray(result.contracts) ? result.contracts : [];
  }
}

const pagePath = join(process.cwd(), "src/app/(app)/crm/lead/[id]/page.tsx");
const source = readFileSync(pagePath, "utf8");

assert.equal(
  source.includes("commercialOpportunityId: scopedOpportunityId"),
  true,
  "generated document fetches must include the selected commercial opportunity id",
);
assert.equal(
  source.includes("/api/sales-quotes?leadId=${encodeURIComponent(leadId)}"),
  false,
  "quote documents must not be listed by leadId alone",
);
assert.equal(
  source.includes("/api/sales-contracts?leadId=${encodeURIComponent(leadId)}"),
  false,
  "contract documents must not be listed by leadId alone",
);

const harness = new DocumentsHarness();
const pendingA = harness.openDocumentsTab();

assert.equal(pendingA.length, 2);
assert.deepEqual(
  harness.calls.map((call) => `${call.kind}:${call.commercialOpportunityId}`),
  ["quotes:opp-a", "contracts:opp-a"],
);

harness.applySelectedOpportunity("opp-b");
assert.deepEqual(harness.generatedQuotes, []);
assert.deepEqual(harness.generatedContracts, []);

const pendingB = harness.openDocumentsTab();
assert.equal(pendingB.length, 2);
assert.deepEqual(
  harness.calls.map((call) => `${call.kind}:${call.commercialOpportunityId}`),
  ["quotes:opp-a", "contracts:opp-a", "quotes:opp-b", "contracts:opp-b"],
);

harness.pending.quotes.get("opp-b")?.resolve(
  createJsonResponse({ ok: true, quotes: [{ id: "quote-2", quote_number: "Q2" }] }),
);
harness.pending.contracts.get("opp-b")?.resolve(
  createJsonResponse({
    ok: true,
    contracts: [{ id: "contract-2", contract_number: "C2", quote_id: "quote-2" }],
  }),
);
await Promise.all(pendingB);

assert.deepEqual(
  quoteNumbers(harness.generatedQuotes),
  ["Q2"],
);
assert.deepEqual(
  contractNumbers(harness.generatedContracts),
  ["C2"],
);

harness.pending.quotes.get("opp-a")?.resolve(
  createJsonResponse({ ok: true, quotes: [{ id: "quote-1", quote_number: "Q1" }] }),
);
harness.pending.contracts.get("opp-a")?.resolve(
  createJsonResponse({
    ok: true,
    contracts: [{ id: "contract-1", contract_number: "C1", quote_id: "quote-1" }],
  }),
);
await Promise.all(pendingA);

assert.deepEqual(
  quoteNumbers(harness.generatedQuotes),
  ["Q2"],
  "stale quote response from opportunity A must not replace opportunity B",
);
assert.deepEqual(
  contractNumbers(harness.generatedContracts),
  ["C2"],
  "stale contract response from opportunity A must not replace opportunity B",
);

const noSelectionHarness = new DocumentsHarness();
noSelectionHarness.setSelectedOpportunityId(null);
const noSelectionFetches = noSelectionHarness.openDocumentsTab();
assert.equal(noSelectionFetches.length, 0);
assert.deepEqual(noSelectionHarness.calls, []);
assert.deepEqual(noSelectionHarness.generatedQuotes, []);
assert.deepEqual(noSelectionHarness.generatedContracts, []);

console.log("ok - lead detail documents runtime opportunity isolation contract");
console.log(
  `observed calls: ${harness.calls
    .map((call) => `${call.kind}:${call.leadId}:${call.commercialOpportunityId}`)
    .join(", ")}`,
);

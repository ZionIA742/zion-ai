import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

type Opportunity = {
  id: string;
};

type Quote = {
  id: string;
  quote_number: string;
  is_unlinked?: boolean;
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
  quoteListScopeRef = { current: null as string | null };
  quoteListSequenceRef = { current: 0 };
  quoteError: string | null = null;
  quoteProposal: unknown = null;
  quoteLoading = false;
  quoteLoaded = false;

  get quoteDocumentScopeKey() {
    return `${this.leadId}:${this.selectedDocumentOpportunityId || "unlinked"}`;
  }

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
    this.quoteListScopeRef.current = this.quoteDocumentScopeKey;
    this.quoteListSequenceRef.current += 1;
    this.generatedQuotes = [];
    this.generatedContracts = [];
  }

  openDocumentsTab() {
    this.activeDetailsTab = "pdfs";

    this.quoteListScopeRef.current = this.quoteDocumentScopeKey;
    const quotes = this.fetchGeneratedQuotes();
    return this.documentScopeKey ? [quotes, this.fetchGeneratedContracts()] : [quotes];
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

    const pendingKey = kind === "quotes"
      ? `${this.quoteDocumentScopeKey}:${String(commercialOpportunityId)}`
      : String(commercialOpportunityId);
    this.pending[kind].set(pendingKey, deferred);
    return deferred.promise;
  }

  async fetchGeneratedQuotes() {
    // Execute the production function, not a copied implementation.
    const run = new Function(
      "leadId", "selectedDocumentOpportunityId", "quoteDocumentScopeKey",
      "quoteListScopeRef", "quoteListSequenceRef", "fetch",
      "setGeneratedQuotes", "setCurrentCommercialProposal", "setGeneratedQuotesLoading",
      "setGeneratedQuotesError", "setHasLoadedGeneratedQuotes",
      quoteListProgram + "\nreturn fetchGeneratedQuotes;",
    )(
      this.leadId, this.selectedDocumentOpportunityId, this.quoteDocumentScopeKey,
      this.quoteListScopeRef, this.quoteListSequenceRef,
      (url: string) => this.fetch(url),
      (value: Quote[]) => { this.generatedQuotes = value; },
      (value: unknown) => { this.quoteProposal = value; },
      (value: boolean) => { this.quoteLoading = value; },
      (value: string | null) => { this.quoteError = value; },
      (value: boolean) => { this.quoteLoaded = value; },
    ) as () => Promise<void>;
    await run();
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
const ast = ts.createSourceFile(pagePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const financialTextOffset = source.indexOf("Financeiro da oportunidade");
assert.ok(financialTextOffset >= 0, "production financial panel must exist");
const financialGuardExpressions: string[] = [];
function collectFinancialGuards(node: ts.Node) {
  if (
    ts.isConditionalExpression(node) &&
    node.getStart(ast) <= financialTextOffset &&
    node.getEnd() > financialTextOffset
  ) {
    financialGuardExpressions.push(node.condition.getText(ast));
  }
  ts.forEachChild(node, collectFinancialGuards);
}
collectFinancialGuards(ast);
assert.ok(
  financialGuardExpressions.some(
    (expression) => expression === 'activeDetailsTab === "summary" && activeInformationSection === "financial"',
  ),
  "financial panel must have an exclusive Information > Financeiro render guard",
);

function financialPanelIsRendered(
  activeDetailsTab: "summary" | "appointments" | "pdfs",
  activeInformationSection: "summary" | "opportunity" | "context" | "tasks" | "financial",
) {
  return financialGuardExpressions.every((expression) =>
    Function("activeDetailsTab", "activeInformationSection", `return Boolean(${expression});`)(
      activeDetailsTab,
      activeInformationSection,
    ),
  );
}

assert.equal(financialPanelIsRendered("summary", "financial"), true);
assert.equal(financialPanelIsRendered("summary", "summary"), false);
assert.equal(financialPanelIsRendered("summary", "opportunity"), false);
assert.equal(financialPanelIsRendered("summary", "context"), false);
assert.equal(financialPanelIsRendered("summary", "tasks"), false);
assert.equal(financialPanelIsRendered("pdfs", "financial"), false);
assert.equal(financialPanelIsRendered("pdfs", "summary"), false);
assert.equal(financialPanelIsRendered("appointments", "summary"), false);
const declarations = new Map<string, ts.FunctionDeclaration>();
let quoteList: ts.FunctionDeclaration | undefined;
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "fetchGeneratedQuotes") quoteList = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(quoteList, "production quote list function is required");
for (const node of ast.statements) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node);
}
const dependencies = new Map<string, ts.FunctionDeclaration>();
function collect(node: ts.Node) {
  if (ts.isIdentifier(node)) {
    const dep = declarations.get(node.text);
    if (dep && !dependencies.has(node.text)) {
      dependencies.set(node.text, dep);
      ts.forEachChild(dep, collect);
    }
  }
  ts.forEachChild(node, collect);
}
const normalizer = declarations.get("normalizeCurrentCommercialProposalSummary");
assert.ok(normalizer);
dependencies.set("normalizeCurrentCommercialProposalSummary", normalizer);
ts.forEachChild(normalizer, collect);
const quoteListProgram = ts.transpileModule(
  [...dependencies.values()].map((node) => node.getText(ast)).join("\n") + "\n" + quoteList.getText(ast),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

assert.equal(
  source.includes("commercialOpportunityId: scopedOpportunityId"),
  true,
  "contract fetches must include the selected commercial opportunity id",
);
assert.equal(
  source.includes("/api/sales-quotes?leadId=${encodeURIComponent(leadId)}"),
  false,
  "quote documents must use the scoped list path, not the obsolete direct URL",
);
assert.equal(
  source.includes("/api/sales-contracts?leadId=${encodeURIComponent(leadId)}"),
  false,
  "contract documents must not be listed by leadId alone",
);
assert.equal(
  source.includes('type InformationSection = "summary" | "opportunity" | "context" | "tasks" | "financial";'),
  true,
  "financial must be an information section",
);
assert.equal(
  source.includes('onClick={() => setActiveInformationSection("financial")}'),
  true,
  "information modal must expose the financial tab",
);
assert.equal(
  source.includes('activeDetailsTab === "summary" && activeInformationSection === "financial"'),
  true,
  "financial panel must render from Information > Financeiro",
);
assert.equal(
  /\{activeDetailsTab === "pdfs" \? \(\s*<>/.test(source),
  true,
  "documents-only content must remain separately gated",
);
assert.equal(
  source.includes('if (activeDetailsTab === "summary" && activeInformationSection === "financial")'),
  true,
  "financial loading must not depend on opening Documents",
);

const harness = new DocumentsHarness();
const pendingA = harness.openDocumentsTab();

assert.equal(pendingA.length, 2);
assert.deepEqual(
  harness.calls.map((call) => `${call.kind}:${call.commercialOpportunityId}`),
  ["quotes:opp-a", "quotes:null", "contracts:opp-a"],
);

harness.applySelectedOpportunity("opp-b");
assert.deepEqual(harness.generatedQuotes, []);
assert.deepEqual(harness.generatedContracts, []);

const pendingB = harness.openDocumentsTab();
assert.equal(pendingB.length, 2);
assert.deepEqual(
  harness.calls.map((call) => `${call.kind}:${call.commercialOpportunityId}`),
  ["quotes:opp-a", "quotes:null", "contracts:opp-a", "quotes:opp-b", "quotes:null", "contracts:opp-b"],
);

harness.pending.quotes.get("lead-a:opp-b:opp-b")!.resolve(
  createJsonResponse({ ok: true, quotes: [{ id: "quote-2", quote_number: "Q2" }] }),
);
harness.pending.quotes.get("lead-a:opp-b:null")!.resolve(
  createJsonResponse({ ok: true, quotes: [{ id: "free-1", quote_number: "FREE" }] }),
);
harness.pending.contracts.get("opp-b")!.resolve(
  createJsonResponse({
    ok: true,
    contracts: [{ id: "contract-2", contract_number: "C2", quote_id: "quote-2" }],
  }),
);
await Promise.all(pendingB);

assert.deepEqual(
  quoteNumbers(harness.generatedQuotes),
  ["Q2", "FREE"],
);
assert.deepEqual(
  contractNumbers(harness.generatedContracts),
  ["C2"],
);

harness.pending.quotes.get("lead-a:opp-a:opp-a")!.resolve(
  createJsonResponse({ ok: true, quotes: [{ id: "quote-1", quote_number: "Q1" }] }),
);
harness.pending.quotes.get("lead-a:opp-a:null")!.resolve(
  createJsonResponse({ ok: true, quotes: [{ id: "old-free", quote_number: "OLD" }] }),
);
harness.pending.contracts.get("opp-a")!.resolve(
  createJsonResponse({
    ok: true,
    contracts: [{ id: "contract-1", contract_number: "C1", quote_id: "quote-1" }],
  }),
);
await Promise.all(pendingA);

assert.deepEqual(
  quoteNumbers(harness.generatedQuotes),
  ["Q2", "FREE"],
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
assert.equal(noSelectionFetches.length, 1);
assert.deepEqual(noSelectionHarness.calls.map((call) => [call.kind, call.commercialOpportunityId]), [["quotes", null]]);
noSelectionHarness.pending.quotes.get("lead-a:unlinked:null")!.resolve(
  createJsonResponse({ ok: true, quotes: [{ id: "free-1", quote_number: "FREE" }] }),
);
await Promise.all(noSelectionFetches);
assert.deepEqual(quoteNumbers(noSelectionHarness.generatedQuotes), ["FREE"]);
assert.equal(noSelectionHarness.generatedQuotes[0].is_unlinked, true);
assert.equal(noSelectionHarness.quoteProposal, null);
assert.deepEqual(noSelectionHarness.generatedContracts, []);
assert.equal((harness.generatedQuotes as Quote[])[0].is_unlinked, false);
assert.equal((harness.generatedQuotes as Quote[])[1].is_unlinked, true);

const latest = new DocumentsHarness();
latest.setSelectedOpportunityId(null);
const first = latest.fetchGeneratedQuotes();
const oldResponse = latest.pending.quotes.get("lead-a:unlinked:null");
const second = latest.fetchGeneratedQuotes();
latest.pending.quotes.get("lead-a:unlinked:null")!.resolve(
  createJsonResponse({ ok: true, quotes: [{ id: "new", quote_number: "NEW" }] }),
);
await second;
assert.ok(oldResponse);
oldResponse.resolve(createJsonResponse({ ok: true, quotes: [{ id: "old", quote_number: "OLD" }] }));
await first;
assert.deepEqual(quoteNumbers(latest.generatedQuotes), ["NEW"]);
assert.equal(latest.quoteLoading, false);
assert.equal(latest.quoteLoaded, true);

const partial = new DocumentsHarness();
partial.setSelectedOpportunityId("opp-a");
const partialFetch = partial.fetchGeneratedQuotes();
partial.pending.quotes.get("lead-a:opp-a:opp-a")!.resolve(createJsonResponse({ ok: false }));
partial.pending.quotes.get("lead-a:opp-a:null")!.resolve(
  createJsonResponse({ ok: true, quotes: [{ id: "free-1", quote_number: "FREE" }] }),
);
await partialFetch;
assert.deepEqual(quoteNumbers(partial.generatedQuotes), ["FREE"]);
assert.ok(partial.quoteError);

console.log("ok - lead detail documents runtime free quote and opportunity isolation contract");
console.log(
  `observed calls: ${harness.calls
    .map((call) => `${call.kind}:${call.leadId}:${call.commercialOpportunityId}`)
    .join(", ")}`,
);

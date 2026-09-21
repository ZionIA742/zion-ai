import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

type PaymentState = {
  label: string;
};

class PaymentHarness {
  selectedOpportunityId: string | null = "opp-a";
  paymentState: PaymentState | null = { label: "old-a" };
  paymentScopeRef: string | null = null;
  paymentLoading = false;
  readonly pending = new Map<string, Deferred<unknown>>();

  applySelectedOpportunity(opportunityId: string) {
    this.paymentScopeRef = opportunityId;
    this.paymentState = null;
    this.paymentLoading = false;
    this.selectedOpportunityId = opportunityId;
  }

  async fetch(url: string) {
    const parsed = new URL(url, "https://example.test");
    const opportunityId = parsed.searchParams.get("commercialOpportunityId") || "";
    const deferred = createDeferred<unknown>();
    this.pending.set(opportunityId, deferred);
    return deferred.promise;
  }

  async loadSelectedOpportunityPayment() {
    const selectedOpportunityId = this.selectedOpportunityId;

    if (!selectedOpportunityId) {
      return;
    }

    const scopedPaymentKey = selectedOpportunityId;
    this.paymentScopeRef = scopedPaymentKey;
    this.paymentLoading = true;

    try {
      const response = (await this.fetch(
        `/api/crm/opportunities/payment?commercialOpportunityId=${encodeURIComponent(
          scopedPaymentKey,
        )}`,
      )) as {
        ok: boolean;
        json: () => Promise<{
          ok?: boolean;
          commercialOpportunityId?: string;
          payment?: PaymentState;
        }>;
      };
      const result = await response.json();

      if (this.paymentScopeRef !== scopedPaymentKey) {
        return;
      }

      if (
        !response.ok ||
        !result?.ok ||
        !result.payment ||
        String(result.commercialOpportunityId || "").trim() !== scopedPaymentKey
      ) {
        return;
      }

      this.paymentState = result.payment;
    } finally {
      if (this.paymentScopeRef === scopedPaymentKey) {
        this.paymentLoading = false;
      }
    }
  }
}

type Quote = {
  id: string;
  quote_number: string;
};

type Contract = {
  id: string;
  contract_number: string;
  quote_id: string;
};

class QuoteEditHarness {
  selectedOpportunityId: string | null = "opp-a";
  documentScopeRef: string | null = "lead-a:opp-a";
  quoteEditScopeRef: string | null = null;
  generatedQuotes: Quote[] = [{ id: "quote-a", quote_number: "Q1" }];
  isQuoteModalOpen = false;
  editingQuoteId: string | null = null;
  quoteTitle = "";
  readonly pending = new Map<string, Deferred<unknown>>();

  get selectedDocumentOpportunityId() {
    return this.selectedOpportunityId;
  }

  get documentScopeKey() {
    return this.selectedDocumentOpportunityId
      ? `lead-a:${this.selectedDocumentOpportunityId}`
      : null;
  }

  applySelectedOpportunity(opportunityId: string) {
    this.selectedOpportunityId = opportunityId;
    this.documentScopeRef = this.documentScopeKey;
    this.quoteEditScopeRef = null;
    this.generatedQuotes = opportunityId === "opp-a"
      ? [{ id: "quote-a", quote_number: "Q1" }]
      : [{ id: "quote-b", quote_number: "Q2" }];
  }

  async fetch(url: string) {
    const quoteId = url.split("/").pop() || "";
    const deferred = createDeferred<unknown>();
    this.pending.set(quoteId, deferred);
    return deferred.promise;
  }

  async loadQuoteForEdit(quoteId: string) {
    const safeQuoteId = String(quoteId || "").trim();
    const scopedOpportunityId = this.selectedDocumentOpportunityId;
    const scopedDocumentKey = this.documentScopeKey;
    const scopedQuoteEditKey =
      scopedOpportunityId && scopedDocumentKey
        ? `${scopedDocumentKey}:${safeQuoteId}`
        : null;

    if (!safeQuoteId || !scopedOpportunityId || !scopedQuoteEditKey) {
      return;
    }

    if (!this.generatedQuotes.some((quote) => quote.id === safeQuoteId)) {
      return;
    }

    this.quoteEditScopeRef = scopedQuoteEditKey;

    const response = (await this.fetch(`/api/sales-quotes/${safeQuoteId}`)) as {
      ok: boolean;
      json: () => Promise<{ ok?: boolean; quote?: { id: string; title: string } }>;
    };
    const result = await response.json();

    if (
      this.quoteEditScopeRef !== scopedQuoteEditKey ||
      !response.ok ||
      !result?.ok ||
      !result.quote ||
      result.quote.id !== safeQuoteId
    ) {
      return;
    }

    this.editingQuoteId = result.quote.id;
    this.quoteTitle = result.quote.title;
    this.isQuoteModalOpen = true;
  }
}

class RefreshHarness {
  activeDetailsTab: "summary" | "pdfs" = "pdfs";
  documentScopeKey: string | null = "lead-a:opp-a";
  mainRefreshes = 0;
  documentFetches: string[] = [];
  generatedQuotes: Quote[] = [{ id: "quote-1", quote_number: "Q1" }];
  generatedContracts: Contract[] = [
    { id: "contract-1", contract_number: "C1", quote_id: "quote-1" },
  ];

  async fetchLeadConversationAndMessages() {
    this.mainRefreshes += 1;
  }

  async fetchGeneratedQuotes() {
    this.documentFetches.push("quotes");
    this.generatedQuotes = [{ id: "quote-2", quote_number: "Q2" }];
  }

  async fetchGeneratedContracts() {
    this.documentFetches.push("contracts");
    this.generatedContracts = [
      { id: "contract-2", contract_number: "C2", quote_id: "quote-2" },
    ];
  }

  async refreshCurrentScreenSnapshot() {
    await this.fetchLeadConversationAndMessages();

    if (this.activeDetailsTab === "pdfs" && this.documentScopeKey) {
      await Promise.all([
        this.fetchGeneratedQuotes(),
        this.fetchGeneratedContracts(),
      ]);
    }
  }
}

class SingleFlightHarness {
  readonly calls: string[] = [];
  readonly pending = createDeferred<void>();
  inFlight = false;
  stateBusy = false;

  async run(name: string) {
    if (this.inFlight || this.stateBusy) {
      return false;
    }

    this.inFlight = true;
    this.stateBusy = true;
    this.calls.push(name);
    await this.pending.promise;
    this.inFlight = false;
    this.stateBusy = false;
    return true;
  }
}

async function testStalePayment() {
  const harness = new PaymentHarness();
  const pendingA = harness.loadSelectedOpportunityPayment();

  harness.applySelectedOpportunity("opp-b");
  assert.equal(harness.paymentState, null, "opportunity change must clear payment snapshot");

  const pendingB = harness.loadSelectedOpportunityPayment();
  harness.pending.get("opp-b")?.resolve(
    createJsonResponse({
      ok: true,
      commercialOpportunityId: "opp-b",
      payment: { label: "payment-b" },
    }),
  );
  await pendingB;
  assert.deepEqual(harness.paymentState, { label: "payment-b" });

  harness.pending.get("opp-a")?.resolve(
    createJsonResponse({
      ok: true,
      commercialOpportunityId: "opp-a",
      payment: { label: "payment-a" },
    }),
  );
  await pendingA;
  assert.deepEqual(
    harness.paymentState,
    { label: "payment-b" },
    "stale payment A must not replace selected payment B",
  );
}

async function testStaleQuoteEdit() {
  const staleHarness = new QuoteEditHarness();
  const pendingA = staleHarness.loadQuoteForEdit("quote-a");
  staleHarness.applySelectedOpportunity("opp-b");

  staleHarness.pending.get("quote-a")?.resolve(
    createJsonResponse({
      ok: true,
      quote: { id: "quote-a", title: "Quote A" },
    }),
  );
  await pendingA;
  assert.equal(staleHarness.isQuoteModalOpen, false);
  assert.equal(staleHarness.editingQuoteId, null);

  const normalHarness = new QuoteEditHarness();
  const pendingNormal = normalHarness.loadQuoteForEdit("quote-a");
  normalHarness.pending.get("quote-a")?.resolve(
    createJsonResponse({
      ok: true,
      quote: { id: "quote-a", title: "Quote A" },
    }),
  );
  await pendingNormal;
  assert.equal(normalHarness.isQuoteModalOpen, true);
  assert.equal(normalHarness.editingQuoteId, "quote-a");
  assert.equal(normalHarness.quoteTitle, "Quote A");
}

async function testRefreshDocuments() {
  const openHarness = new RefreshHarness();
  await openHarness.refreshCurrentScreenSnapshot();

  assert.equal(openHarness.mainRefreshes, 1);
  assert.deepEqual(openHarness.documentFetches, ["quotes", "contracts"]);
  assert.deepEqual(openHarness.generatedQuotes.map((quote) => quote.quote_number), ["Q2"]);
  assert.deepEqual(
    openHarness.generatedContracts.map((contract) => contract.contract_number),
    ["C2"],
  );

  const closedHarness = new RefreshHarness();
  closedHarness.activeDetailsTab = "summary";
  await closedHarness.refreshCurrentScreenSnapshot();

  assert.equal(closedHarness.mainRefreshes, 1);
  assert.deepEqual(closedHarness.documentFetches, []);
}

async function testSingleFlight(name: string) {
  const harness = new SingleFlightHarness();
  const first = harness.run(name);
  const second = harness.run(name);

  assert.deepEqual(harness.calls, [name]);
  assert.equal(await second, false);

  harness.pending.resolve();
  assert.equal(await first, true);

  const next = new SingleFlightHarness();
  const legitimate = next.run(name);
  next.pending.resolve();
  assert.equal(await legitimate, true);
  assert.deepEqual(next.calls, [name]);
}

const pagePath = join(process.cwd(), "src/app/(app)/crm/lead/[id]/page.tsx");
const source = readFileSync(pagePath, "utf8");

assert.equal(source.includes("const paymentScopeRef = useRef<string | null>(null);"), true);
assert.equal(source.includes("const quoteEditScopeRef = useRef<string | null>(null);"), true);
assert.equal(source.includes("async function refreshCurrentScreenSnapshot()"), true);
assert.equal(source.includes("void refreshCurrentScreenSnapshot();"), true);
assert.equal(source.includes("manualSendInFlightRef.current || working"), true);
assert.equal(source.includes("simulatedCustomerMutationInFlightRef.current || simulatingCustomer"), true);
assert.equal(source.includes("takeoverMutationInFlightRef.current || working"), true);
assert.equal(source.includes("paymentSubmitInFlightRef.current || paymentSubmitting"), true);

await testStalePayment();
await testStaleQuoteEdit();
await testRefreshDocuments();
await testSingleFlight("send-message");
await testSingleFlight("simulate-customer");
await testSingleFlight("takeover");
await testSingleFlight("release");
await testSingleFlight("payment-submit");

console.log("ok - crm lead page staleness refresh and concurrency contract");

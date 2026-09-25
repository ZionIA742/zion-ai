import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Quote = {
  id: string;
  status: string;
  current_version_id?: string | null;
};

type Contract = {
  quote_id: string | null;
  quote_version_id: string | null;
};

type CurrentCommercialProposal = {
  proposal_state: string | null;
  current_quote_id: string | null;
  current_quote_version_id: string | null;
};

function buildContractQuoteVersionKey(
  quoteId: string | null | undefined,
  quoteVersionId: string | null | undefined,
) {
  const safeQuoteId = String(quoteId || "").trim();
  const safeQuoteVersionId = String(quoteVersionId || "").trim();

  if (!safeQuoteId || !safeQuoteVersionId) return null;

  return `${safeQuoteId}:${safeQuoteVersionId}`;
}

function canCreateContractForQuote(args: {
  quote: Quote;
  contracts: Contract[];
  currentCommercialProposal: CurrentCommercialProposal | null;
  hasLoadedGeneratedContracts?: boolean;
}) {
  const normalizedStatus = String(args.quote.status || "").trim().toLowerCase();
  const currentProposalQuoteId = String(
    args.currentCommercialProposal?.current_quote_id || "",
  ).trim();
  const currentProposalQuoteVersionId = String(
    args.currentCommercialProposal?.current_quote_version_id || "",
  ).trim();
  const isCurrentCommercialProposal =
    args.currentCommercialProposal?.proposal_state === "available" &&
    currentProposalQuoteId === args.quote.id &&
    Boolean(currentProposalQuoteVersionId);
  const exactContractKey = isCurrentCommercialProposal
    ? buildContractQuoteVersionKey(args.quote.id, currentProposalQuoteVersionId)
    : null;
  const exactLinkedContract = exactContractKey
    ? args.contracts.find(
        (contract) =>
          buildContractQuoteVersionKey(contract.quote_id, contract.quote_version_id) ===
          exactContractKey,
      )
    : null;

  return (
    args.hasLoadedGeneratedContracts !== false &&
    (normalizedStatus === "approved" || normalizedStatus === "sent") &&
    isCurrentCommercialProposal &&
    !exactLinkedContract
  );
}

async function createContractFromQuoteHarness(args: {
  quoteId: string;
  quoteVersionId: string | null;
  contracts: Contract[];
  postBodies: Array<Record<string, unknown>>;
}) {
  const safeQuoteId = String(args.quoteId || "").trim();
  const safeQuoteVersionId = String(args.quoteVersionId || "").trim();
  const contractKey = buildContractQuoteVersionKey(safeQuoteId, safeQuoteVersionId);

  if (!safeQuoteId || !safeQuoteVersionId || !contractKey) {
    return false;
  }

  if (
    args.contracts.some(
      (contract) =>
        buildContractQuoteVersionKey(contract.quote_id, contract.quote_version_id) ===
        contractKey,
    )
  ) {
    return false;
  }

  args.postBodies.push({
    quoteId: safeQuoteId,
    quoteVersionId: safeQuoteVersionId,
  });
  return true;
}

async function attemptCreate(args: {
  quote: Quote;
  contracts?: Contract[];
  currentCommercialProposal: CurrentCommercialProposal | null;
}) {
  const postBodies: Array<Record<string, unknown>> = [];
  const contracts = args.contracts || [];

  if (
    canCreateContractForQuote({
      quote: args.quote,
      contracts,
      currentCommercialProposal: args.currentCommercialProposal,
    })
  ) {
    await createContractFromQuoteHarness({
      quoteId: args.quote.id,
      quoteVersionId: args.currentCommercialProposal?.current_quote_version_id || null,
      contracts,
      postBodies,
    });
  }

  return postBodies;
}

async function runBehaviorTests() {
  const currentProposal = {
    proposal_state: "available",
    current_quote_id: "quote-1",
    current_quote_version_id: "version-presented-v1",
  };

  assert.deepEqual(
    await attemptCreate({
      quote: {
        id: "quote-1",
        status: "sent",
        current_version_id: "version-internal-v2",
      },
      currentCommercialProposal: currentProposal,
    }),
    [
      {
        quoteId: "quote-1",
        quoteVersionId: "version-presented-v1",
      },
    ],
  );

  assert.deepEqual(
    await attemptCreate({
      quote: { id: "quote-old", status: "sent" },
      currentCommercialProposal: currentProposal,
    }),
    [],
  );

  assert.deepEqual(
    await attemptCreate({
      quote: { id: "quote-1", status: "sent" },
      currentCommercialProposal: {
        ...currentProposal,
        proposal_state: "needs_resolution",
      },
    }),
    [],
  );

  assert.deepEqual(
    await attemptCreate({
      quote: { id: "quote-1", status: "sent" },
      currentCommercialProposal: {
        ...currentProposal,
        current_quote_version_id: null,
      },
    }),
    [],
  );

  assert.deepEqual(
    await attemptCreate({
      quote: { id: "quote-1", status: "sent" },
      contracts: [{ quote_id: "quote-1", quote_version_id: "version-v1" }],
      currentCommercialProposal: {
        ...currentProposal,
        current_quote_version_id: "version-v2",
      },
    }),
    [
      {
        quoteId: "quote-1",
        quoteVersionId: "version-v2",
      },
    ],
  );

  assert.deepEqual(
    await attemptCreate({
      quote: { id: "quote-1", status: "sent" },
      contracts: [{ quote_id: "quote-1", quote_version_id: "version-v2" }],
      currentCommercialProposal: {
        ...currentProposal,
        current_quote_version_id: "version-v2",
      },
    }),
    [],
  );
}

function runSourceAssertions() {
  const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");
  const createStart = pageSource.indexOf("async function createContractFromQuote(");
  const createEnd = pageSource.indexOf("async function generateContractPdf", createStart);
  assert.notEqual(createStart, -1);
  assert.notEqual(createEnd, -1);
  const createSource = pageSource.slice(createStart, createEnd);

  assert.match(
    createSource,
    /JSON\.stringify\(\{\s*quoteId:\s*safeQuoteId,\s*quoteVersionId:\s*safeQuoteVersionId,\s*\}\)/,
  );
  assert.equal(createSource.includes("quote.current_version_id"), false);
  assert.equal(createSource.includes("quote.current_version?.id"), false);

  const gateStart = pageSource.indexOf("const currentProposalQuoteId = String(");
  const gateEnd = pageSource.indexOf("const canEditQuote", gateStart);
  assert.notEqual(gateStart, -1);
  assert.notEqual(gateEnd, -1);
  const gateSource = pageSource.slice(gateStart, gateEnd);

  assert.equal(
    gateSource.includes("currentCommercialProposal?.current_quote_version_id"),
    true,
  );
  assert.equal(gateSource.includes("quote.current_version_id"), false);
  assert.equal(gateSource.includes("quote.current_version?.id"), false);
  assert.equal(gateSource.includes("version_number"), false);
  assert.equal(gateSource.includes("created_at"), false);

  const fetchStart = pageSource.indexOf("async function fetchGeneratedQuotes(");
  const fetchEnd = pageSource.indexOf("async function fetchGeneratedContracts", fetchStart);
  assert.notEqual(fetchStart, -1);
  assert.notEqual(fetchEnd, -1);
  const fetchSource = pageSource.slice(fetchStart, fetchEnd);

  const scopeIndex = fetchSource.indexOf("documentScopeRef.current = scopedDocumentKey;");
  const clearBeforeReadIndex = fetchSource.indexOf(
    "setCurrentCommercialProposal(null);",
    scopeIndex,
  );
  const remoteReadIndex = fetchSource.indexOf("const response = await fetch(", scopeIndex);

  assert.notEqual(scopeIndex, -1);
  assert.notEqual(clearBeforeReadIndex, -1);
  assert.notEqual(remoteReadIndex, -1);
  assert.ok(clearBeforeReadIndex > scopeIndex);
  assert.ok(clearBeforeReadIndex < remoteReadIndex);

  const catchStart = fetchSource.indexOf("} catch (error: any) {");
  const catchEnd = fetchSource.indexOf("} finally {", catchStart);
  assert.notEqual(catchStart, -1);
  assert.notEqual(catchEnd, -1);
  const catchSource = fetchSource.slice(catchStart, catchEnd);
  const sameScopeGuardIndex = catchSource.indexOf(
    "if (documentScopeRef.current !== scopedDocumentKey) {",
  );
  const clearOnErrorIndex = catchSource.indexOf("setCurrentCommercialProposal(null);");

  assert.notEqual(sameScopeGuardIndex, -1);
  assert.notEqual(clearOnErrorIndex, -1);
  assert.ok(clearOnErrorIndex > sameScopeGuardIndex);
}

await runBehaviorTests();
runSourceAssertions();

console.log("ok - crm contract caller uses current commercial proposal quote version");

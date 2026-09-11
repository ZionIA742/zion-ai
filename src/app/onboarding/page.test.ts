import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

const pagePath = join(process.cwd(), "src/app/onboarding/page.tsx");

function readPageSource() {
  return readFileSync(pagePath, "utf8");
}

function getFunctionBlock(source: string, signature: string, nextSignature: string) {
  const start = source.indexOf(signature);
  assert.equal(start > -1, true, `${signature} not found`);
  const end = source.indexOf(nextSignature, start);
  assert.equal(end > start, true, `${signature} end not found`);
  return source.slice(start, end);
}

function getPersistAnswersBlock(source: string) {
  return getFunctionBlock(
    source,
    "  async function persistAnswers(",
    "  async function saveStep1(",
  );
}

function getActivateZionBlock(source: string) {
  return getFunctionBlock(
    source,
    "  async function activateZion() {",
    "  if (storeLoading) {",
  );
}

function getFetchWhatsappStatusBlock(source: string) {
  return getFunctionBlock(
    source,
    "  const fetchWhatsappStatus = useCallback(async () => {",
    "  const loadBaseData = useCallback(async () => {",
  );
}

function getCatchBlock(block: string) {
  const start = block.indexOf("    } catch (error) {");
  assert.equal(start > -1, true, "catch block not found");
  const end = block.indexOf("    } finally {", start);
  assert.equal(end > start, true, "catch block end not found");
  return block.slice(start, end);
}

const tests: TestCase[] = [
  {
    name: "expected WhatsApp operational unavailability is preserved as UI state without fatal throw",
    run: () => {
      const source = readPageSource();
      const block = getFetchWhatsappStatusBlock(source);

      const knownIndex = block.indexOf(
        "if (result && isKnownWhatsappOperationalUnavailability(response, result))",
      );
      const setStatusIndex = block.indexOf("setWhatsappStatus({", knownIndex);
      const connectedFalseIndex = block.indexOf("connected: false", setStatusIndex);
      const isActiveFalseIndex = block.indexOf("isActive: false", setStatusIndex);
      const setErrorIndex = block.indexOf("setWhatsappStatusError(cleanText(result.message));", setStatusIndex);
      const returnIndex = block.indexOf("return;", setErrorIndex);
      const throwIndex = block.indexOf("throw new Error", returnIndex);

      assert.equal(source.includes("function isKnownWhatsappOperationalUnavailability("), true);
      assert.equal(source.includes("response.status === 400"), true);
      assert.equal(source.includes("response.status === 401"), true);
      assert.equal(source.includes("response.status === 403"), true);
      assert.equal(knownIndex > -1, true);
      assert.equal(setStatusIndex > knownIndex, true);
      assert.equal(connectedFalseIndex > setStatusIndex, true);
      assert.equal(isActiveFalseIndex > setStatusIndex, true);
      assert.equal(setErrorIndex > setStatusIndex, true);
      assert.equal(returnIndex > setErrorIndex, true);
      assert.equal(throwIndex > returnIndex, true);
      assert.equal(block.includes("console.error"), true);
      assert.equal(block.indexOf("console.error") > returnIndex, true);
    },
  },
  {
    name: "real WhatsApp status transport or unusable response errors remain fail closed",
    run: () => {
      const source = readPageSource();
      const block = getFetchWhatsappStatusBlock(source);
      const catchBlock = getCatchBlock(block);

      assert.equal(block.includes("await response.json().catch(() => null)"), true);
      assert.equal(
        block.includes('throw new Error("Não foi possível carregar o status do WhatsApp da loja.");') ||
          block.includes('throw new Error("NÃ£o foi possÃ­vel carregar o status do WhatsApp da loja.");'),
        true,
      );
      assert.equal(
        block.includes('throw new Error(result.message || "Não foi possível carregar o status do WhatsApp da loja.");') ||
          block.includes('throw new Error(result.message || "NÃ£o foi possÃ­vel carregar o status do WhatsApp da loja.");'),
        true,
      );
      assert.equal(catchBlock.includes("console.error"), true);
      assert.equal(catchBlock.includes("setWhatsappStatus(null);"), true);
      assert.equal(catchBlock.includes("setWhatsappStatusError("), true);
    },
  },
  {
    name: "activateZion calls the canonical onboarding completion RPC",
    run: () => {
      const source = readPageSource();
      const block = getActivateZionBlock(source);

      assert.equal(
        block.includes('"onboarding_complete_store_onboarding_scoped"'),
        true,
      );
      assert.equal(block.includes("p_organization_id: organizationId"), true);
      assert.equal(block.includes("p_store_id: activeStore.id"), true);
    },
  },
  {
    name: "activateZion no longer completes through the generic onboarding status RPC",
    run: () => {
      const source = readPageSource();
      const block = getActivateZionBlock(source);
      const persistBlock = getPersistAnswersBlock(source);

      assert.equal(block.includes('persistAnswers([], "completed")'), false);
      assert.equal(
        block.includes('"onboarding_upsert_store_onboarding_scoped"'),
        false,
      );
      assert.equal(persistBlock.includes('nextStatus?: "in_progress"'), true);
      assert.equal(persistBlock.includes('nextStatus?: "in_progress" | "completed"'), false);
    },
  },
  {
    name: "canonical RPC failure stays on onboarding and shows a mapped human error",
    run: () => {
      const source = readPageSource();
      const block = getActivateZionBlock(source);
      const catchBlock = getCatchBlock(block);

      assert.equal(block.includes("if (error) throw error;"), true);
      assert.equal(catchBlock.includes("setFormError(mapOnboardingCompletionError(error));"), true);
      assert.equal(catchBlock.includes("setOnboardingStatus"), false);
      assert.equal(catchBlock.includes('router.replace("/dashboard")'), false);
      assert.equal(source.includes("P19A_ONBOARDING_NOT_READY:STORE_NAME"), true);
      assert.equal(source.includes("P19A_ONBOARDING_NOT_READY:STORE_SERVICES"), true);
      assert.equal(source.includes("P19A_ONBOARDING_NOT_READY:WHATSAPP_COMMERCIAL"), true);
      assert.equal(
        source.includes("Não foi possível confirmar todos os dados essenciais salvos."),
        true,
      );
    },
  },
  {
    name: "canonical completed response updates local state before the existing success flow",
    run: () => {
      const source = readPageSource();
      const block = getActivateZionBlock(source);

      const rpcIndex = block.indexOf('"onboarding_complete_store_onboarding_scoped"');
      const extractIndex = block.indexOf("const completedStatus = extractOnboardingStatus(data);");
      const statusCheckIndex = block.indexOf('if (completedStatus !== "completed")');
      const setCompletedIndex = block.indexOf("setOnboardingStatus(completedStatus);");
      const successIndex = block.indexOf("setSuccessMessage(", setCompletedIndex);
      const redirectIndex = block.indexOf('router.replace("/dashboard")');

      assert.equal(rpcIndex > -1, true);
      assert.equal(extractIndex > rpcIndex, true);
      assert.equal(statusCheckIndex > extractIndex, true);
      assert.equal(setCompletedIndex > statusCheckIndex, true);
      assert.equal(successIndex > setCompletedIndex, true);
      assert.equal(redirectIndex > successIndex, true);
    },
  },
  {
    name: "frontend readiness remains an explicit UX-only gate",
    run: () => {
      const source = readPageSource();

      assert.equal(
        source.includes("// UX-only gate; the canonical completion RPC is the final authority."),
        true,
      );
      assert.equal(source.includes("const canActivate = essentialsReady && whatsappConnected;"), true);
    },
  },
];

async function run() {
  for (const test of tests) {
    test.run();
  }

  console.log(`onboarding-page: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

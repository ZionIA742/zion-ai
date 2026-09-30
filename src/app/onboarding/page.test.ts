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
    "  const fetchWhatsappStatus = useCallback(async (): Promise<StoreWhatsappStatusApiResponse | null> => {",
    "  const loadBaseData = useCallback(async () => {",
  );
}

function getSaveStep2Block(source: string) {
  return getFunctionBlock(
    source,
    "  async function saveStep2(",
    "  async function saveStep3(",
  );
}

function getMetaSignupSessionParserBlock(source: string) {
  return getFunctionBlock(
    source,
    "function extractMetaEmbeddedSignupSession(",
    "function isMetaEmbeddedSignupCancellation(",
  );
}

function getStartMetaSignupBlock(source: string) {
  return getFunctionBlock(
    source,
    "  async function startMetaEmbeddedSignup() {",
    "  useEffect(() => {\n    if (!embeddedSignupCode) return;",
  );
}

function getEmbeddedSignupSubmitBlock(source: string) {
  return getFunctionBlock(
    source,
    "  useEffect(() => {\n    if (!embeddedSignupCode || !embeddedSignupSession) return;",
    "  async function activateZion() {",
  );
}

function getFacebookSdkLoaderBlock(source: string) {
  return getFunctionBlock(
    source,
    "function ensureFacebookSdkLoaded(appId: string) {",
    "function isKnownWhatsappOperationalUnavailability(",
  );
}

function getCatchBlock(block: string) {
  const start = block.indexOf("    } catch (error) {");
  assert.equal(start > -1, true, "catch block not found");
  const finallyEnd = block.indexOf("    } finally {", start);
  const asyncEnd = block.indexOf("    })();", start);
  const end = finallyEnd > -1 ? finallyEnd : asyncEnd;
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
      const setErrorIndex = block.indexOf("setWhatsappStatusError(WHATSAPP_STATUS_UNAVAILABLE_MESSAGE);", setStatusIndex);
      const returnIndex = block.indexOf("return result;", setErrorIndex);
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

      const unusableResponseGuard = block.indexOf("if (!result) {");
      const unusableResponseThrow = block.indexOf("throw new Error(", unusableResponseGuard);
      assert.equal(unusableResponseGuard > -1, true);
      assert.equal(unusableResponseThrow > unusableResponseGuard, true);

      const failedResponseGuard = block.indexOf("if (!response.ok || !result.ok) {");
      const failedResponseThrow = block.indexOf(
        'throw new Error("WHATSAPP_STATUS_REQUEST_FAILED")',
        failedResponseGuard,
      );
      assert.equal(failedResponseGuard > -1, true);
      assert.equal(failedResponseThrow > failedResponseGuard, true);
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
        source.includes("confirmar todos os dados essenciais salvos"),
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
    name: "frontend activation gate depends on canonical onboarding activation readiness",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes("const canActivate ="), true);
      assert.equal(
        source.includes(
          '!onboardingActivationLoading && onboardingActivationState === "ready";',
        ),
        true,
      );
      assert.equal(
        source.includes("const canActivate = essentialsReady && whatsappConnected;"),
        false,
      );
    },
  },
  {
    name: "Meta Embedded Signup ignores invalid window message origins",
    run: () => {
      const source = readPageSource();
      const parserBlock = getMetaSignupSessionParserBlock(source);

      assert.equal(source.includes("window.addEventListener(\"message\", handleEmbeddedSignupMessage)"), true);
      assert.equal(source.includes("window.removeEventListener(\"message\", handleEmbeddedSignupMessage)"), true);
      assert.equal(source.includes("META_EMBEDDED_SIGNUP_ALLOWED_ORIGINS"), true);
      assert.equal(
        parserBlock.includes("if (!isAllowedMetaEmbeddedSignupOrigin(event.origin)) return null;"),
        true,
      );
    },
  },
  {
    name: "Meta Embedded Signup ignores irrelevant message events",
    run: () => {
      const source = readPageSource();
      const parserBlock = getMetaSignupSessionParserBlock(source);

      assert.equal(
        parserBlock.includes("payload.type !== META_EMBEDDED_SIGNUP_MESSAGE_TYPE"),
        true,
      );
      assert.equal(parserBlock.includes('eventName !== "FINISH"'), true);
      assert.equal(source.includes('"WA_EMBEDDED_SIGNUP"'), true);
    },
  },
  {
    name: "valid Meta Embedded Signup session captures WABA and phone ids",
    run: () => {
      const source = readPageSource();
      const parserBlock = getMetaSignupSessionParserBlock(source);

      assert.equal(parserBlock.includes("normalizeMetaIdentifier(payloadData.whatsapp_business_account_id)"), true);
      assert.equal(parserBlock.includes("normalizeMetaIdentifier(payloadData.waba_id)"), true);
      assert.equal(parserBlock.includes("normalizeMetaIdentifier(payloadData.phone_number_id)"), true);
      assert.equal(parserBlock.includes("whatsappBusinessAccountId,"), true);
      assert.equal(parserBlock.includes("phoneNumberId,"), true);
      assert.equal(parserBlock.includes("display_phone_number"), false);
    },
  },
  {
    name: "FB.login callback captures only the authorization code",
    run: () => {
      const source = readPageSource();
      const block = getStartMetaSignupBlock(source);

      assert.equal(block.includes("window.FB.login("), true);
      assert.equal(block.includes("config_id: metaEmbeddedSignupConfig.configId"), true);
      assert.equal(block.includes('response_type: "code"'), true);
      assert.equal(block.includes("override_default_response_type: true"), true);
      assert.equal(block.includes('version: "v4"'), true);
      assert.equal(block.includes("typeof response.authResponse?.code === \"string\""), true);
      assert.equal(block.includes("setEmbeddedSignupCode(code);"), true);
      assert.equal(block.includes("accessToken"), false);
    },
  },
  {
    name: "Meta Embedded Signup PIN must be exactly six digits",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes("function isValidTwoStepPin(value: string)"), true);
      assert.equal(source.includes("/^[0-9]{6}$/.test(value)"), true);
      assert.equal(source.includes("event.target.value.replace(/[^\\d]/g, \"\").slice(0, 6)"), true);
      assert.equal(source.includes("!isValidTwoStepPin(embeddedSignupPin)"), true);
    },
  },
  {
    name: "Meta Embedded Signup POST sends only code WABA phone and PIN",
    run: () => {
      const source = readPageSource();
      const block = getEmbeddedSignupSubmitBlock(source);
      const payloadStart = block.indexOf("body: JSON.stringify({");
      const payloadEnd = block.indexOf("}),", payloadStart);
      const payloadBlock = block.slice(payloadStart, payloadEnd);

      assert.equal(block.includes('fetch("/api/store/whatsapp/embedded-signup"'), true);
      assert.equal(payloadBlock.includes("code: embeddedSignupCode"), true);
      assert.equal(payloadBlock.includes("whatsappBusinessAccountId:"), true);
      assert.equal(payloadBlock.includes("phoneNumberId:"), true);
      assert.equal(payloadBlock.includes("twoStepPin: embeddedSignupPin"), true);
      assert.equal(payloadBlock.includes("displayPhoneNumber"), false);
      assert.equal(payloadBlock.includes("token"), false);
    },
  },
  {
    name: "Facebook SDK loader observes an existing script and can retry after timeout or failure",
    run: () => {
      const source = readPageSource();
      const block = getFacebookSdkLoaderBlock(source);

      assert.equal(block.includes("document.getElementById(FACEBOOK_SDK_SCRIPT_ID)"), true);
      assert.equal(block.includes("script.addEventListener(\"load\", handleScriptLoad"), true);
      assert.equal(block.includes("script.addEventListener(\"error\", handleScriptError"), true);
      assert.equal(block.includes("window.setTimeout(() => fail(\"FACEBOOK_SDK_UNAVAILABLE\"), 10000)"), true);
      assert.equal(block.includes("facebookSdkLoadPromise = null;"), true);
      assert.equal(block.includes("script.parentNode.removeChild(script)"), true);
      assert.equal(block.includes("setTimeout(() => {"), false);
      assert.equal(block.includes("}, 0)"), false);
      assert.equal(
        block.includes('["complete", "loaded"].includes('),
        true,
      );
      assert.equal(
        block.includes(
          "} else {\n      handleFacebookSdkReady();\n    }",
        ),
        false,
      );
    },
  },
  {
    name: "Embedded Signup submission uses a ref guard without depending on its own submitting state",
    run: () => {
      const source = readPageSource();
      const block = getEmbeddedSignupSubmitBlock(source);
      const dependenciesStart = block.lastIndexOf("  }, [");
      const dependencies = block.slice(dependenciesStart);

      assert.equal(block.includes("embeddedSignupSubmittingRef.current"), true);
      assert.equal(block.includes("embeddedSignupSubmittingRef.current = true;"), true);
      assert.equal(block.includes("embeddedSignupSubmittingRef.current = false;"), true);
      assert.equal(dependencies.includes("embeddedSignupSubmitting,"), false);
      assert.equal(block.includes("cancelled"), false);
      assert.equal(block.includes("return () =>"), false);
      assert.equal(block.includes("embeddedSignupAttemptRef.current = attempt;"), true);
      assert.equal(
        block.indexOf("embeddedSignupAttemptRef.current = null;") >
          block.indexOf("await refreshActivationReadinessAfterEmbeddedSignup();"),
        true,
      );
    },
  },
  {
    name: "Embedded Signup PIN is immutable while the attempt is in progress",
    run: () => {
      const source = readPageSource();
      const inputStart = source.indexOf("value={embeddedSignupPin}");
      const inputEnd = source.indexOf("aria-label=\"PIN de verificacao", inputStart);
      const inputBlock = source.slice(inputStart, inputEnd);

      assert.equal(inputStart > -1, true);
      assert.equal(inputBlock.includes("disabled={embeddedSignupLoading || embeddedSignupSubmitting}"), true);
      assert.equal(inputBlock.includes("embeddedSignupAttemptRef.current || embeddedSignupSubmittingRef.current"), true);
    },
  },
  {
    name: "onboarding frontend never handles Meta tokens or persists code and PIN",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes("accessToken"), false);
      assert.equal(source.includes("access_token"), false);
      assert.equal(source.includes("META_WHATSAPP_ACCESS_TOKEN"), false);
      assert.equal(source.includes("sessionStorage"), false);
      assert.equal(source.includes("embeddedSignupPin") && source.includes("localStorage.setItem"), true);
      assert.equal(/localStorage\.setItem\([^)]*embeddedSignup(Pin|Code)/.test(source), false);
      assert.equal(/window\.location[^;]*(embeddedSignupPin|embeddedSignupCode|twoStepPin|code)/.test(source), false);
    },
  },
  {
    name: "successful Meta Embedded Signup refreshes WhatsApp status and onboarding readiness",
    run: () => {
      const source = readPageSource();
      const block = getEmbeddedSignupSubmitBlock(source);

      const clearIndex = block.indexOf("clearEmbeddedSignupSensitiveState();");
      const statusIndex = block.indexOf("await fetchWhatsappStatus();", clearIndex);
      const readinessIndex = block.indexOf(
        "await refreshActivationReadinessAfterEmbeddedSignup();",
        statusIndex,
      );

      assert.equal(clearIndex > -1, true);
      assert.equal(statusIndex > clearIndex, true);
      assert.equal(readinessIndex > statusIndex, true);
    },
  },
  {
    name: "Embedded Signup only confirms connection after canonical status and readiness",
    run: () => {
      const source = readPageSource();
      const block = getEmbeddedSignupSubmitBlock(source);
      const postSuccessIndex = block.indexOf("if (!response.ok || result?.ok !== true)");
      const neutralMessageIndex = block.indexOf(
        'setEmbeddedSignupMessage("Validando conexao oficial...");',
        postSuccessIndex,
      );
      const statusIndex = block.indexOf("const confirmedWhatsappStatus = await fetchWhatsappStatus();", neutralMessageIndex);
      const statusGuardIndex = block.indexOf(
        "if (!isWhatsappStatusConnected(confirmedWhatsappStatus))",
        statusIndex,
      );
      const readinessIndex = block.indexOf(
        "const readinessConfirmed = await refreshActivationReadinessAfterEmbeddedSignup();",
        statusGuardIndex,
      );
      const readinessGuardIndex = block.indexOf(
        "if (!readinessConfirmed)",
        readinessIndex,
      );
      const finalMessageIndex = block.indexOf(
        'setEmbeddedSignupMessage("WhatsApp conectado pela Meta.");',
        readinessGuardIndex,
      );

      assert.equal(neutralMessageIndex > postSuccessIndex, true);
      assert.equal(statusIndex > neutralMessageIndex, true);
      assert.equal(statusGuardIndex > statusIndex, true);
      assert.equal(readinessIndex > statusGuardIndex, true);
      assert.equal(readinessGuardIndex > readinessIndex, true);
      assert.equal(finalMessageIndex > readinessGuardIndex, true);
      assert.equal(
        block.indexOf('setEmbeddedSignupMessage("WhatsApp conectado pela Meta.");', postSuccessIndex) >
          readinessGuardIndex,
        true,
      );
      assert.equal(source.includes("function isWhatsappStatusConnected("), true);
      assert.equal(source.includes("function mapEmbeddedSignupError("), true);
    },
  },
  {
    name: "Embedded Signup status and readiness failures remain neutral or mapped",
    run: () => {
      const source = readPageSource();
      const block = getEmbeddedSignupSubmitBlock(source);
      const statusGuardIndex = block.indexOf(
        "if (!isWhatsappStatusConnected(confirmedWhatsappStatus))",
      );
      const statusThrowIndex = block.indexOf(
        'throw new Error("WHATSAPP_STATUS_NOT_CONFIRMED")',
        statusGuardIndex,
      );
      const readinessGuardIndex = block.indexOf("if (!readinessConfirmed)", statusThrowIndex);
      const readinessThrowIndex = block.indexOf(
        'throw new Error("ONBOARDING_READINESS_NOT_CONFIRMED")',
        readinessGuardIndex,
      );
      const finalMessageIndex = block.indexOf(
        'setEmbeddedSignupMessage("WhatsApp conectado pela Meta.");',
      );

      assert.equal(statusThrowIndex > statusGuardIndex, true);
      assert.equal(readinessThrowIndex > readinessGuardIndex, true);
      assert.equal(finalMessageIndex > readinessThrowIndex, true);
      assert.equal(source.includes("WHATSAPP_STATUS_UNAVAILABLE_MESSAGE"), true);
      assert.equal(source.includes("EMBEDDED_SIGNUP_STATUS_NOT_CONFIRMED_MESSAGE"), true);
      assert.equal(source.includes("EMBEDDED_SIGNUP_READINESS_NOT_CONFIRMED_MESSAGE"), true);
    },
  },
  {
    name: "arbitrary backend messages never reach Embedded Signup UI",
    run: () => {
      const source = readPageSource();
      const block = getEmbeddedSignupSubmitBlock(source);
      const catchBlock = getCatchBlock(block);

      assert.equal(block.includes("cleanText(result?.message)"), false);
      assert.equal(catchBlock.includes("error.message"), false);
      assert.equal(catchBlock.includes("mapEmbeddedSignupError(error)"), true);
      assert.equal(source.includes("function mapEmbeddedSignupError(error: unknown)"), true);
      assert.equal(source.includes("result.message ||"), false);
    },
  },
  {
    name: "success, error and cancellation clear Embedded Signup code and PIN",
    run: () => {
      const source = readPageSource();
      const submitBlock = getEmbeddedSignupSubmitBlock(source);
      const sessionListenerBlock = getFunctionBlock(
        source,
        "    const handleEmbeddedSignupMessage = (event: MessageEvent) => {",
        "    window.addEventListener(\"message\", handleEmbeddedSignupMessage);",
      );
      const startBlock = getStartMetaSignupBlock(source);

      assert.equal(submitBlock.includes("clearEmbeddedSignupSensitiveState();"), true);
      assert.equal(getCatchBlock(submitBlock).includes("clearEmbeddedSignupSensitiveState();"), true);
      assert.equal(sessionListenerBlock.includes("clearEmbeddedSignupSensitiveState();"), true);
      assert.equal(startBlock.includes("clearEmbeddedSignupSensitiveState();"), true);
    },
  },
  {
    name: "Meta Embedded Signup errors do not mark WhatsApp connected",
    run: () => {
      const source = readPageSource();
      const block = getEmbeddedSignupSubmitBlock(source);
      const catchBlock = getCatchBlock(block);

      assert.equal(catchBlock.includes("clearEmbeddedSignupSensitiveState();"), true);
      assert.equal(catchBlock.includes("await fetchWhatsappStatus();"), true);
      assert.equal(catchBlock.includes("connected: false"), false);
      assert.equal(catchBlock.includes("isActive: false"), false);
      assert.equal(catchBlock.includes("setEmbeddedSignupError("), true);
      assert.equal(catchBlock.includes("setWhatsappStatusConnected"), false);
      assert.equal(catchBlock.includes("setWhatsappStatus((current)"), false);
    },
  },
  {
    name: "other onboarding steps keep the existing Step 2 draft and persistence flow",
    run: () => {
      const source = readPageSource();
      const block = getSaveStep2Block(source);

      assert.equal(source.includes("const step2DraftStorageKey = storagePrefix ? `${storagePrefix}:step2` : null;"), true);
      assert.equal(source.includes("persistToLocalStorageSafe(step2DraftStorageKey, JSON.stringify(step2Form));"), true);
      assert.equal(block.includes("await saveStrategySettingsPartial({"), true);
      assert.equal(block.includes("storeServices:"), true);
      assert.equal(block.includes("changeStep(3);"), true);
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

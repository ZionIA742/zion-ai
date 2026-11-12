import { strict as assert } from "node:assert";
import { createElement, useEffect } from "react";
import { act, create } from "react-test-renderer";
import {
  useMetaEmbeddedSignupAttempt,
} from "./use-meta-embedded-signup-attempt";

if (!("window" in globalThis)) {
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true });

const trustedOrigin = "https://www.facebook.com";
const target = { wabaId: "1642288770859048", phoneNumberId: "1322472314288518" };
const finishEvent = {
  origin: trustedOrigin,
  data: {
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH",
    data: { waba_id: target.wabaId, phone_number_id: target.phoneNumberId },
  },
};

let latest = null;

function Harness({ timeoutMs = 25 }) {
  const api = useMetaEmbeddedSignupAttempt({ timeoutMs });
  useEffect(() => {
    latest = api;
  }, [api]);
  return null;
}

function renderHarness(timeoutMs) {
  let renderer;
  act(() => {
    renderer = create(createElement(Harness, { timeoutMs }));
  });
  return renderer;
}

function begin(mode = "standard") {
  assert.ok(latest);
  const attemptId = latest.beginAttempt(mode);
  assert.ok(latest.flowRef.current);
  return { attemptId, flow: latest.flowRef.current };
}

const tests = [
  {
    name: "mounts the real hook and expires without opening a later attempt",
    async run() {
      latest = null;
      const renderer = renderHarness(10);
      const { attemptId } = begin();
      let timedOut = false;
      latest.startTimeout(attemptId, () => {
        timedOut = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(timedOut, true);
      assert.equal(latest.isAttemptActive(attemptId), false);
      assert.equal(latest.flowRef.current, null);
      act(() => renderer.unmount());
    },
  },
  {
    name: "late SDK completion cannot reactivate an expired attempt",
    async run() {
      latest = null;
      const renderer = renderHarness(10);
      const { attemptId } = begin();
      latest.startTimeout(attemptId, () => undefined);
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(latest.isAttemptActive(attemptId), false);
      act(() => renderer.unmount());
    },
  },
  {
    name: "cancellation during submitting remains ignored by the mounted flow",
    run() {
      latest = null;
      const renderer = renderHarness();
      const { flow } = begin();
      assert.equal(flow.acceptOAuthCode("oauth-code"), true);
      assert.equal(flow.acceptMessage(finishEvent), "finish_valid");
      assert.equal(flow.markSubmitting(), true);
      assert.equal(
        flow.acceptMessage({
          origin: trustedOrigin,
          data: { type: "WA_EMBEDDED_SIGNUP", event: "CANCELLED" },
        }),
        "ignored_message",
      );
      assert.equal(flow.getSnapshot().status, "submitting");
      act(() => renderer.unmount());
    },
  },
  {
    name: "unmount closes the real hook and rejects late callbacks",
    run() {
      latest = null;
      const renderer = renderHarness();
      const { attemptId } = begin();
      act(() => renderer.unmount());
      assert.equal(latest.isAttemptActive(attemptId), false);
      assert.equal(latest.flowRef.current, null);
    },
  },
  {
    name: "a new attempt is isolated from the closed attempt while protocol correlation remains limited",
    run() {
      latest = null;
      const renderer = renderHarness();
      const first = begin();
      const oldFlow = first.flow;
      assert.equal(latest.closeAttempt(first.attemptId), true);
      const second = begin();
      assert.notEqual(second.attemptId, first.attemptId);
      assert.equal(oldFlow.acceptOAuthCode("old-code"), false);
      assert.equal(latest.isAttemptActive(second.attemptId), true);
      assert.equal(
        second.flow.acceptMessage({
          origin: trustedOrigin,
          data: { ...finishEvent.data, data: { waba_id: target.wabaId, phone_number_id: target.phoneNumberId } },
        }),
        "finish_valid",
      );
      act(() => renderer.unmount());
    },
  },
];

for (const test of tests) await test.run();
console.log(`use-meta-embedded-signup-attempt: ${tests.length} mounted-hook tests passed`);

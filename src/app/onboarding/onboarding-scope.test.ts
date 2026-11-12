import { strict as assert } from "node:assert";
import {
  createElement,
  createRef,
  forwardRef,
  useImperativeHandle,
  useState,
} from "react";
import { act, create } from "react-test-renderer";
import { useOnboardingScope } from "./onboarding-scope";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

function renderProbe(initialOrganizationId: string | null, initialStoreId: string | null) {
  type ProbeHandle = {
    scope: ReturnType<typeof useOnboardingScope>;
    setContext: (value: [string | null, string | null]) => void;
    applyDeferredValue: (token: ReturnType<ReturnType<typeof useOnboardingScope>["capture"]>, value: string) => void;
    visibleValue: () => string | null;
  };

  const control = createRef<ProbeHandle>();
  const Probe = forwardRef<ProbeHandle>(function Probe(_props, ref) {
    const [context, setContextState] = useState<[string | null, string | null]>([
      initialOrganizationId,
      initialStoreId,
    ]);
    const [visibleValue, setVisibleValue] = useState<string | null>(null);
    const scope = useOnboardingScope(context[0], context[1]);
    useImperativeHandle(ref, () => ({
      scope,
      setContext: setContextState,
      applyDeferredValue: (token, value) => {
        if (scope.isCurrent(token)) setVisibleValue(value);
      },
      visibleValue: () => visibleValue,
    }), [scope, visibleValue]);
    return null;
  });

  let renderer;
  act(() => {
    renderer = create(createElement(Probe, { ref: control }));
  });

  return {
    renderer,
    get snapshot() {
      return control.current?.scope ?? null;
    },
    applyDeferredValue(token: ReturnType<ReturnType<typeof useOnboardingScope>["capture"]>, value: string) {
      act(() => control.current?.applyDeferredValue(token, value));
    },
    get visibleValue() {
      return control.current?.visibleValue() ?? null;
    },
    setContext(value: [string | null, string | null]) {
      act(() => control.current?.setContext(value));
    },
  };
}

const probe = renderProbe("org-a", "store-a");
const tokenA = probe.snapshot?.capture();
assert.ok(tokenA);
assert.equal(probe.snapshot?.isCurrent(tokenA), true);

probe.setContext(["org-b", "store-b"]);
assert.equal(probe.snapshot?.isCurrent(tokenA), false);
probe.applyDeferredValue(tokenA, "dados-da-loja-a");
assert.equal(probe.visibleValue, null);
const tokenB = probe.snapshot?.capture();
assert.ok(tokenB);
assert.equal(probe.snapshot?.isCurrent(tokenB), true);
probe.applyDeferredValue(tokenB, "dados-da-loja-b");
assert.equal(probe.visibleValue, "dados-da-loja-b");

probe.setContext(["org-a", "store-a"]);
assert.equal(probe.snapshot?.isCurrent(tokenA), false);
const tokenAAgain = probe.snapshot?.capture();
assert.ok(tokenAAgain);
assert.equal(probe.snapshot?.isCurrent(tokenAAgain), true);

probe.setContext([null, null]);
assert.equal(probe.snapshot?.isCurrent(tokenAAgain), false);
assert.equal(probe.snapshot?.capture(), null);

act(() => probe.renderer.unmount());
assert.equal(probe.snapshot, null);

console.log("Onboarding scope: 1 mounted behavioral test passed");

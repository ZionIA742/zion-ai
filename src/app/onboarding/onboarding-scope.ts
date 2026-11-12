import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export type OnboardingScopeToken = {
  organizationId: string;
  storeId: string;
  key: string;
  generation: number;
};

export function useOnboardingScope(
  organizationId: string | null,
  storeId: string | null,
) {
  const mountedRef = useRef(true);
  const scopeRef = useRef<{
    key: string | null;
    organizationId: string | null;
    storeId: string | null;
    generation: number;
  }>({
    key: organizationId && storeId ? `${organizationId}:${storeId}` : null,
    organizationId,
    storeId,
    generation: organizationId && storeId ? 1 : 0,
  });

  const key = organizationId && storeId ? `${organizationId}:${storeId}` : null;

  useLayoutEffect(() => {
    if (scopeRef.current.key === key) return;
    scopeRef.current = {
      key,
      organizationId,
      storeId,
      generation: scopeRef.current.generation + 1,
    };
  }, [key, organizationId, storeId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scopeRef.current = {
        ...scopeRef.current,
        key: null,
        organizationId: null,
        storeId: null,
        generation: scopeRef.current.generation + 1,
      };
    };
  }, []);

  const capture = useCallback((): OnboardingScopeToken | null => {
    const current = scopeRef.current;
    if (
      !mountedRef.current ||
      !current.key ||
      !current.organizationId ||
      !current.storeId
    ) {
      return null;
    }

    return {
      organizationId: current.organizationId,
      storeId: current.storeId,
      key: current.key,
      generation: current.generation,
    };
  }, []);

  const isCurrent = useCallback((token: OnboardingScopeToken | null) => {
    const current = scopeRef.current;
    return Boolean(
      mountedRef.current &&
        token &&
        current.key === token.key &&
        current.organizationId === token.organizationId &&
        current.storeId === token.storeId &&
        current.generation === token.generation,
    );
  }, []);

  return {
    key,
    capture,
    isCurrent,
  };
}

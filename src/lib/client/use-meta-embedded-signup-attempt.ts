import { useCallback, useEffect, useRef } from "react";
import {
  createMetaEmbeddedSignupFlowCoordinator,
  type MetaEmbeddedSignupFlowCoordinator,
  type MetaEmbeddedSignupSession,
} from "./meta-embedded-signup";

export type MetaEmbeddedSignupAttemptMode = MetaEmbeddedSignupSession["connectionMode"];

export function useMetaEmbeddedSignupAttempt(options?: { timeoutMs?: number }) {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const mountedRef = useRef(true);
  const attemptIdRef = useRef(0);
  const flowRef = useRef<MetaEmbeddedSignupFlowCoordinator | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const clearTimeoutRef = useCallback(() => {
    if (timeoutRef.current === null) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const closeAttempt = useCallback((attemptId: number) => {
    if (attemptIdRef.current !== attemptId) return false;
    flowRef.current?.close();
    flowRef.current = null;
    clearTimeoutRef();
    return true;
  }, [clearTimeoutRef]);

  const beginAttempt = useCallback((mode: MetaEmbeddedSignupAttemptMode) => {
    const attemptId = attemptIdRef.current + 1;
    attemptIdRef.current = attemptId;
    flowRef.current = createMetaEmbeddedSignupFlowCoordinator({ connectionMode: mode });
    clearTimeoutRef();
    return attemptId;
  }, [clearTimeoutRef]);

  const startTimeout = useCallback((attemptId: number, onTimeout: () => void) => {
    clearTimeoutRef();
    timeoutRef.current = window.setTimeout(() => {
      if (!mountedRef.current || attemptIdRef.current !== attemptId) return;
      closeAttempt(attemptId);
      onTimeout();
    }, timeoutMs);
  }, [clearTimeoutRef, closeAttempt, timeoutMs]);

  const isAttemptActive = useCallback((attemptId: number) => {
    return Boolean(
      mountedRef.current &&
        attemptIdRef.current === attemptId &&
        flowRef.current &&
        flowRef.current.getSnapshot().status === "authorizing",
    );
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      flowRef.current?.close();
      flowRef.current = null;
      clearTimeoutRef();
    };
  }, [clearTimeoutRef]);

  return {
    mountedRef,
    attemptIdRef,
    flowRef,
    beginAttempt,
    closeAttempt,
    clearTimeout: clearTimeoutRef,
    startTimeout,
    isAttemptActive,
  };
}

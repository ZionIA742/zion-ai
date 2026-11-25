import "server-only";

import type {
  createBackendDiagnosticCollector,
} from "./zion-admin-diagnostic-backend-collector";

type Collector = ReturnType<
  typeof createBackendDiagnosticCollector
>;

type RouteObserverOptions = Readonly<{
  enabled?: boolean;
  collector: Collector;
  schedule: (
    task: () => Promise<void>,
  ) => void;
}>;

function warnObserverFailure(): void {
  try {
    console.warn(
      "ZION_BACKEND_DIAGNOSTIC_ROUTE_FAILURE",
    );
  } catch {
    // Diagnostic failures must not replace a response.
  }
}

// Only observe the final Response.
// Never read, clone or modify its body or headers.
//
// Exceptions from the original handler remain owned
// by the global Next.js onRequestError hook.
//
// This observer uses system scope until a trusted
// tenant attribution mechanism is explicitly provided.

export function createBackendRouteObserver(
  options: RouteObserverOptions,
) {
  const enabled = options.enabled === true;

  async function observeResponse(
    route: string,
    method: string,
    response: Response,
  ): Promise<void> {
    if (!enabled) {
      return;
    }

    try {
      if (!(response instanceof Response)) {
        return;
      }

      const status = response.status;

      if (
        !Number.isInteger(status) ||
        status < 500 ||
        status > 599
      ) {
        return;
      }

      const prepared = options.collector.prepare(
        {
          route,
          method,
          kind: "http_response",
          status,
        },
        undefined,
      );

      if (prepared.status !== "ready") {
        return;
      }

      let pending: Promise<void> | undefined;

      const persistOnce = (): Promise<void> => {
        pending ??= Promise.resolve()
          .then(async () => {
            await options.collector.persist(
              prepared,
            );
          })
          .catch(() => {
            warnObserverFailure();
          });

        return pending;
      };

      try {
        options.schedule(persistOnce);
      } catch {
        // Bounded fallback for an already failing
        // response if the scheduler is unavailable.
        await persistOnce();
      }
    } catch {
      warnObserverFailure();
    }
  }

  function wrap<
    Args extends unknown[],
    Result extends Response,
  >(
    route: string,
    method: string,
    handler: (...args: Args) =>
      Result | Promise<Result>,
  ): (...args: Args) => Promise<Result> {
    return async (...args: Args) => {
      // Do not catch application exceptions here.
      // Preserve the original error and let Next.js
      // deliver it to the global instrumentation.
      const response = await handler(...args);

      if (enabled) {
        await observeResponse(
          route,
          method,
          response,
        );
      }

      return response;
    };
  }

  return Object.freeze({
    wrap,
    observeResponse,
  });
}
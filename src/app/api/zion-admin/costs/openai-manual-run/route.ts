import { withBackendDiagnosticRoute } from "../../../../../lib/server/zion-admin-diagnostic-backend-next";
import {
  createOpenAiCostManualTargetedHandler,
} from "@/lib/server/zion-admin-openai-cost-manual-targeted-handler";

import {
  createProtectedOpenAiCostTargetedRunner,
} from "@/lib/server/zion-admin-openai-cost-protected-targeted-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manually executes one already-prepared financial operation.
 * Disabled by default through a separate manual flag.
 * No cron or automatic retry is registered.
 */
const zionBackendOriginalPOST = createOpenAiCostManualTargetedHandler({
  run: createProtectedOpenAiCostTargetedRunner(),
});

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/zion-admin/costs/openai-manual-run",
  "POST",
  zionBackendOriginalPOST,
);

export const POST: typeof zionBackendOriginalPOST = async function POST(request: Parameters<typeof zionBackendOriginalPOST>[0]) {
  return zionBackendObservedPOST(request);
};
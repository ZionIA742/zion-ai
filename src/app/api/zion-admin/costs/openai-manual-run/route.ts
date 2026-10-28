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
export const POST = createOpenAiCostManualTargetedHandler({
  run: createProtectedOpenAiCostTargetedRunner(),
});
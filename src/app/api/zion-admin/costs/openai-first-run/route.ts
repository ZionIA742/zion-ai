import {
  createFirstOpenAiCostCollectionHandler,
} from "@/lib/server/zion-admin-openai-cost-first-collection-handler";

import {
  createProtectedOpenAiCostTargetedRunner,
} from "@/lib/server/zion-admin-openai-cost-protected-targeted-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manual first collection only.
 *
 * The handler restricts the HTTP request to the one
 * explicitly authorized operation and requires the
 * independent one-shot flag.
 *
 * The protected targeted runner independently checks
 * financial flags, administrator access, manage_accounts
 * and the server-side execution allowlist.
 *
 * No cron, automatic retry or batch endpoint.
 * Construction performs no financial I/O.
 */
export const POST = createFirstOpenAiCostCollectionHandler({
  run: createProtectedOpenAiCostTargetedRunner(),
});

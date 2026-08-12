import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import {
  createFirstAccessAttemptId,
  createFirstAccessInviteMetadataPatch,
  createServiceSupabaseClient,
  getAuthAdminUserByIdWithRetry,
  getAuthAdminUserById,
  getFirstAccessInviteCooldownRemainingMs,
  getFirstAccessInviteRedirectTo,
  getProvisioningAccountAccessSummary,
  isFirstAccessInviteCooldownActive,
  maskEmail,
  mergeProvisioningAppMetadata,
  readFirstAccessInviteId,
} from "@/lib/server/zion-account-provisioning";
import { writeZionAdminAuditEvent } from "@/lib/server/zion-admin-audit";
import { handleResendFirstAccess } from "./route-handler";

export async function POST(request: Request) {
  return handleResendFirstAccess(request, {
    resolveAccess: resolveZionAdminApiAccess,
    createServiceSupabase: createServiceSupabaseClient,
    createAttemptId: createFirstAccessAttemptId,
    createInviteMetadataPatch: createFirstAccessInviteMetadataPatch,
    getAuthAdminUserById,
    getAuthAdminUserByIdWithRetry,
    getCooldownRemainingMs: getFirstAccessInviteCooldownRemainingMs,
    getInviteRedirectTo: getFirstAccessInviteRedirectTo,
    getAccountAccessSummary: getProvisioningAccountAccessSummary,
    isInviteCooldownActive: isFirstAccessInviteCooldownActive,
    maskEmail,
    mergeProvisioningAppMetadata,
    readFirstAccessInviteId,
    writeAuditEvent: writeZionAdminAuditEvent,
  });
}

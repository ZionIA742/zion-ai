import { createClient } from "@supabase/supabase-js";
import { resolveStoreApiAccess } from "@/lib/server/store-api-access";
import {
  createProductionDataAccess,
  resolveAuthorizedOpportunityDetailWithDeps,
  type AuthorizedOpportunityDetailData,
  type AuthorizedOpportunityStage,
  type OpportunityDetailErrorCode,
  type OpportunityDetailProblemCode,
  type OpportunityDetailWarningCode,
  type ResolveAuthorizedOpportunityDetailFailure,
  type ResolveAuthorizedOpportunityDetailResult,
  type ResolveAuthorizedOpportunityDetailSuccess,
  type ServiceSupabaseLike,
} from "./resolve-authorized-opportunity-detail.internal";

export type {
  AuthorizedOpportunityDetailData,
  AuthorizedOpportunityStage,
  OpportunityDetailErrorCode,
  OpportunityDetailProblemCode,
  OpportunityDetailWarningCode,
  ResolveAuthorizedOpportunityDetailFailure,
  ResolveAuthorizedOpportunityDetailResult,
  ResolveAuthorizedOpportunityDetailSuccess,
} from "./resolve-authorized-opportunity-detail.internal";

function createServiceSupabaseClient(): ServiceSupabaseLike {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Supabase environment is not configured.");
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }) as unknown as ServiceSupabaseLike;
}

export async function resolveAuthorizedOpportunityDetail(
  commercialOpportunityId: string,
): Promise<ResolveAuthorizedOpportunityDetailResult> {
  return resolveAuthorizedOpportunityDetailWithDeps(commercialOpportunityId, {
    async resolveStoreAccess() {
      const access = await resolveStoreApiAccess({
        requirement: "active",
      });

      if (!access.ok) {
        return {
          ok: false,
          reason: access.httpStatus === 401 ? "unauthenticated" : "unavailable",
        };
      }

      return {
        ok: true,
        context: {
          sessionUserId: access.sessionUserId,
          organizationId: access.organizationId,
          storeId: access.storeId,
        },
      };
    },
    createDataAccess() {
      const serviceSupabase = createServiceSupabaseClient();
      return createProductionDataAccess(serviceSupabase);
    },
  });
}

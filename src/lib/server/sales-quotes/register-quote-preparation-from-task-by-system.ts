import { createHash } from "node:crypto";

import {
  resolveQuotePreparationIdentityBySystem,
  type QuotePreparationIdentity,
  type QuotePreparationIdentityResolution,
  type QuotePreparationIdentitySupabase,
} from "./resolve-quote-preparation-identity-by-system";
import {
  registerQuotePreparationOperationBySystem,
  type QuotePreparationRegistrationResult,
  type QuotePreparationRegistrationSupabase,
} from "./register-quote-preparation-operation-by-system";

type RegistrationSupabase =
  & QuotePreparationIdentitySupabase
  & QuotePreparationRegistrationSupabase;

export type QuotePreparationTaskRegistrationResult =
  | {
      outcome: "ineligible";
      resolution: Exclude<QuotePreparationIdentityResolution, { eligible: true }>;
    }
  | {
      outcome: QuotePreparationRegistrationResult["outcome"];
      identity: QuotePreparationIdentity;
      operationKey: string;
      requestFingerprint: string;
      registration: QuotePreparationRegistrationResult;
    };

function canonicalIdentityJson(identity: QuotePreparationIdentity): string {
  return JSON.stringify({
    organization_id: identity.organizationId,
    store_id: identity.storeId,
    lead_id: identity.leadId,
    conversation_id: identity.conversationId,
    commercial_opportunity_id: identity.commercialOpportunityId,
    request_message_id: identity.requestMessageId,
    profile_version_id: identity.profileVersionId,
    profile_version_number: identity.profileVersionNumber,
  });
}

function canonicalOperationScopeJson(identity: QuotePreparationIdentity): string {
  return JSON.stringify({
    organization_id: identity.organizationId,
    store_id: identity.storeId,
    lead_id: identity.leadId,
    conversation_id: identity.conversationId,
    commercial_opportunity_id: identity.commercialOpportunityId,
    request_message_id: identity.requestMessageId,
  });
}

export function buildQuotePreparationOperationKey(
  identity: QuotePreparationIdentity,
): string {
  const scopeDigest = createHash("sha256")
    .update(canonicalOperationScopeJson(identity), "utf8")
    .digest("hex");
  return `p19a:quote-preparation:v1:${scopeDigest}`;
}

export function buildQuotePreparationRequestFingerprint(
  identity: QuotePreparationIdentity,
): string {
  return createHash("sha256")
    .update(canonicalIdentityJson(identity), "utf8")
    .digest("hex");
}

export async function registerQuotePreparationFromTaskBySystem(args: {
  taskId: string;
  organizationId: string;
  storeId: string;
  supabase?: RegistrationSupabase;
}): Promise<QuotePreparationTaskRegistrationResult> {
  const resolution = await resolveQuotePreparationIdentityBySystem({
    taskId: args?.taskId,
    organizationId: args?.organizationId,
    storeId: args?.storeId,
    supabase: args?.supabase,
  });

  if (!resolution.eligible) {
    return { outcome: "ineligible", resolution };
  }

  const identity = resolution.identity;
  const operationKey = buildQuotePreparationOperationKey(identity);
  const requestFingerprint = buildQuotePreparationRequestFingerprint(identity);
  const registration = await registerQuotePreparationOperationBySystem({
    registration: {
      organizationId: identity.organizationId,
      storeId: identity.storeId,
      leadId: identity.leadId,
      conversationId: identity.conversationId,
      commercialOpportunityId: identity.commercialOpportunityId,
      requestMessageId: identity.requestMessageId,
      profileVersionId: identity.profileVersionId,
      profileVersionNumber: identity.profileVersionNumber,
      operationKey,
      requestFingerprint,
    },
    supabase: args?.supabase,
  });

  return {
    outcome: registration.outcome,
    identity,
    operationKey,
    requestFingerprint,
    registration,
  };
}

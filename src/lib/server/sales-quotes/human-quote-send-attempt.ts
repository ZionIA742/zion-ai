import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  buildHumanQuoteSendIdentity,
  parseHumanQuoteSendRequest,
  normalizeHumanQuoteSendPhone,
} from "./human-quote-send-contract";

import type {
  executeHumanQuoteTransport,
} from "./human-quote-send-transport";

type Scope =
  Parameters<typeof buildHumanQuoteSendIdentity>[0];

type TransportDependencies =
  Parameters<typeof executeHumanQuoteTransport>[0];

type AttemptCallbacks =
  Pick<TransportDependencies,"begin"|"finish">;

type AuthorizationDecision =
  | { allowed:true }
  | { allowed:false; reason:string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function validUuid(value:unknown): value is string {
  return typeof value==="string"
    && UUID_PATTERN.test(value)
    && value!=="00000000-0000-0000-0000-000000000000";
}

function validReason(value:unknown): value is string {
  return typeof value==="string"
    && /^[A-Za-z0-9_:-]{1,160}$/.test(value);
}

function validExternalId(value:unknown): value is string {
  return typeof value==="string"
    && value.length>=1
    && value.length<=512
    && !/[\s\x00-\x1f\x7f]/.test(value);
}

/**
 * Internal bridge for a registered and authenticated send.
 *
 * The caller supplies server-resolved scope and document identity.
 * The authorization callback must enforce the destination policy
 * before any attempt can start.
 *
 * No public route, provider call or direct ledger access.
 */
export function createHumanQuoteSendAttemptCallbacks(args:{
  supabase:SupabaseClient;
  scope:Scope;
  request:unknown;
  storeFileId:string;
  destinationPhone:string;
  authorizeStart:()=>Promise<AuthorizationDecision>;
}):AttemptCallbacks {

  const request=parseHumanQuoteSendRequest(args.request);

  const scope={...args.scope};

  for(const value of [
    scope.organizationId,
    scope.storeId,
    scope.actorUserId,
    scope.quoteId,
    args.storeFileId,
  ]) {
    if(!validUuid(value)) {
      throw new Error("HUMAN_QUOTE_ATTEMPT_SCOPE_INVALID");
    }
  }

  const destinationPhone=normalizeHumanQuoteSendPhone(
    args.destinationPhone
  );

  if(destinationPhone!==args.destinationPhone) {
    throw new Error("HUMAN_QUOTE_ATTEMPT_PHONE_INVALID");
  }

  if(
    request.recipient.kind==="phone" &&
    request.recipient.phone!==destinationPhone
  ) {
    throw new Error("HUMAN_QUOTE_ATTEMPT_DESTINATION_MISMATCH");
  }

  const identity=buildHumanQuoteSendIdentity(
    scope,request
  );

  const baseParams={
    p_organization_id:scope.organizationId,
    p_store_id:scope.storeId,
    p_actor_user_id:scope.actorUserId,
    p_operation_id:request.operationId,
    p_operation_key:identity.operationKey,
    p_request_fingerprint:identity.requestFingerprint,
    p_quote_id:scope.quoteId,
    p_quote_version_id:request.quoteVersionId,
    p_store_file_id:args.storeFileId,
    p_destination_phone:destinationPhone,
  };

  async function transition(
    action:"start"|"block"|"accept"|"fail"|"uncertain",
    token:string|null,
    reason:string|null,
    externalId:string|null,
  ):Promise<Record<string,unknown>> {

    const result=await args.supabase.rpc(
      "transition_human_quote_send_by_system",
      {
        ...baseParams,
        p_action:action,
        p_attempt_token:token,
        p_reason:reason,
        p_external_message_id:externalId,
      }
    );

    if(result.error) {
      throw new Error("HUMAN_QUOTE_ATTEMPT_RPC_FAILED");
    }

    if(
      !result.data ||
      typeof result.data!=="object" ||
      Array.isArray(result.data)
    ) {
      throw new Error("HUMAN_QUOTE_ATTEMPT_RESPONSE_INVALID");
    }

    const data=result.data as Record<string,unknown>;

    if(data.operation_id!==request.operationId) {
      throw new Error("HUMAN_QUOTE_ATTEMPT_RESPONSE_SCOPE_INVALID");
    }

    return data;
  }

  return {

    async begin() {

      const decision=await args.authorizeStart();

      if(decision?.allowed===false) {

        if(!validReason(decision.reason)) {
          throw new Error("HUMAN_QUOTE_ATTEMPT_POLICY_INVALID");
        }

        const result=await transition(
          "block",null,decision.reason,null
        );

        if(
          result.status!=="blocked" ||
          !["transitioned","existing_state"].includes(
            String(result.outcome)
          ) ||
          result.attempt_token!==null ||
          result.new_attempt!==false
        ) {
          throw new Error("HUMAN_QUOTE_ATTEMPT_BLOCK_INVALID");
        }

        return {
          outcome:"existing_state",
          status:"blocked",
        };
      }

      if(decision?.allowed!==true) {
        throw new Error("HUMAN_QUOTE_ATTEMPT_POLICY_INVALID");
      }

      const result=await transition(
        "start",null,null,null
      );

      if(result.outcome==="attempt_created") {

        if(
          result.status!=="attempt_started" ||
          result.new_attempt!==true ||
          !validUuid(result.attempt_token)
        ) {
          throw new Error("HUMAN_QUOTE_ATTEMPT_CLAIM_INVALID");
        }

        return {
          outcome:"attempt_created",
          attemptToken:result.attempt_token,
        };
      }

      const status=result.status;

      if(
        result.outcome==="existing_state" &&
        result.new_attempt===false &&
        result.attempt_token===null &&
        (
          status==="blocked" ||
          status==="attempt_started" ||
          status==="accepted" ||
          status==="failed" ||
          status==="uncertain"
        )
      ) {
        return {
          outcome:"existing_state",
          status,
        };
      }

      throw new Error("HUMAN_QUOTE_ATTEMPT_START_INVALID");
    },

    async finish(input) {

      if(!validUuid(input.attemptToken)) {
        throw new Error("HUMAN_QUOTE_ATTEMPT_TOKEN_INVALID");
      }

      let reason:string|null=null;
      let externalId:string|null=null;

      if(input.action==="accept") {

        if(!validExternalId(input.externalMessageId)) {
          throw new Error("HUMAN_QUOTE_ATTEMPT_EXTERNAL_ID_INVALID");
        }

        externalId=input.externalMessageId;

      } else {

        if(!validReason(input.reason)) {
          throw new Error("HUMAN_QUOTE_ATTEMPT_REASON_INVALID");
        }

        reason=input.reason;
      }

      const result=await transition(
        input.action,
        input.attemptToken,
        reason,
        externalId
      );

      const expected =
        input.action==="accept"
          ? "accepted"
          : input.action==="fail"
            ? "failed"
            : "uncertain";

      if(
        result.status!==expected ||
        !["transitioned","existing_state"].includes(
          String(result.outcome)
        ) ||
        result.new_attempt!==false ||
        result.attempt_token!==null
      ) {
        throw new Error("HUMAN_QUOTE_ATTEMPT_FINISH_INVALID");
      }

      return {status:expected};
    },
  };
}

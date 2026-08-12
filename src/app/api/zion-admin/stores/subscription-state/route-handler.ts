import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";
import type { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { type writeZionAdminAuditEvent } from "@/lib/server/zion-admin-audit";
import type { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";

type ZionAdminAccessResult = Awaited<ReturnType<typeof resolveZionAdminApiAccess>>;

type StoreRow = {
  id: string;
  organization_id: string | null;
  name: string | null;
};

type SubscriptionRow = {
  id: string;
  organization_id: string | null;
  status: string | null;
};

type SubscriptionMutationAction = "suspend" | "reactivate";

export type StoreSubscriptionStateHandlerDeps = {
  resolveAccess: typeof resolveZionAdminApiAccess;
  createServiceSupabase: typeof createServiceSupabaseClient;
  writeAuditEvent: typeof writeZionAdminAuditEvent;
};

function normalizeAction(value: unknown): SubscriptionMutationAction | null {
  return value === "suspend" || value === "reactivate" ? value : null;
}

function normalizeStatus(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeAuditState(
  value: string | null | undefined,
): "active" | "suspended" | "unavailable" {
  const normalized = normalizeStatus(value);

  if (normalized === "active" || normalized === "suspended") {
    return normalized;
  }

  return "unavailable";
}

async function loadCanonicalSubscription(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  organizationId: string,
) {
  const { data, error } = await serviceSupabase
    .from("subscriptions")
    .select("id, organization_id, status")
    .eq("organization_id", organizationId)
    .limit(2);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as SubscriptionRow[];

  if (rows.length !== 1 || !rows[0]?.id || !rows[0]?.organization_id) {
    return null;
  }

  return rows[0];
}

async function disableStoreExternalIntegrations(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  organizationId: string,
  storeId: string,
) {
  const { error } = await serviceSupabase
    .from("external_integrations")
    .update({
      is_active: false,
    })
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .select("id");

  if (error) {
    throw error;
  }
}

async function updateSubscriptionStatus(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  subscriptionId: string,
  organizationId: string,
  nextStatus: "active" | "suspended",
) {
  const { data, error } = await serviceSupabase
    .from("subscriptions")
    .update({
      status: nextStatus,
    })
    .eq("id", subscriptionId)
    .eq("organization_id", organizationId)
    .select("id, organization_id, status")
    .maybeSingle<SubscriptionRow>();

  if (error) {
    throw error;
  }

  if (!data?.id || !data.organization_id) {
    throw new Error("Subscription target not found during update.");
  }

  return data;
}

export async function handleStoreSubscriptionStateMutation(
  request: Request,
  deps: StoreSubscriptionStateHandlerDeps,
): Promise<Response> {
  let actorUserId: string | null = null;
  let serviceSupabase: ReturnType<typeof createServiceSupabaseClient> | null = null;
  let resolvedStore: StoreRow | null = null;
  let resolvedSubscription: SubscriptionRow | null = null;
  let action: SubscriptionMutationAction | null = null;
  let operationId: string | null = null;
  let currentSubscriptionStatus: string | null = null;
  let externalIntegrationsDisabled = false;

  try {
    const access = (await deps.resolveAccess()) as ZionAdminAccessResult;

    if (!access.ok) {
      return createZionAdminApiDeniedResponse(access);
    }

    actorUserId = access.sessionUserId;

    const body = await request.json().catch(() => null);
    const storeId = String(body?.storeId || "").trim();
    action = normalizeAction(body?.action);

    if (!storeId) {
      return createZionAdminApiJsonResponse(
        {
          error: "Store ID obrigatorio.",
        },
        400,
      );
    }

    if (!action) {
      return createZionAdminApiJsonResponse(
        {
          error: "Acao invalida.",
        },
        400,
      );
    }

    serviceSupabase = deps.createServiceSupabase();
    const { data: store, error: storeError } = await serviceSupabase
      .from("stores")
      .select("id, organization_id, name")
      .eq("id", storeId)
      .maybeSingle<StoreRow>();

    if (storeError) {
      throw storeError;
    }

    resolvedStore = store ?? null;

    if (!store?.id || !store.organization_id) {
      await deps.writeAuditEvent({
        actorUserId: access.sessionUserId,
        action: action === "reactivate" ? "store.reactivate" : "store.suspend",
        targetType: "store",
        targetId: storeId,
        outcome: "denied",
        reasonCode: "store_not_found",
        serviceSupabase,
      });
      return createZionAdminApiJsonResponse(
        {
          error: "Loja alvo nao encontrada.",
        },
        404,
      );
    }

    const subscription = await loadCanonicalSubscription(
      serviceSupabase,
      store.organization_id,
    );

    resolvedSubscription = subscription;

    if (!subscription?.id) {
      await deps.writeAuditEvent({
        actorUserId: access.sessionUserId,
        action: action === "reactivate" ? "store.reactivate" : "store.suspend",
        targetType: "store",
        targetId: store.id,
        organizationId: store.organization_id,
        storeId: store.id,
        outcome: "denied",
        reasonCode: "subscription_missing_or_ambiguous",
        serviceSupabase,
      });
      return createZionAdminApiJsonResponse(
        {
          error: "Subscription canonica inexistente ou ambigua para a loja.",
        },
        409,
      );
    }

    const currentStatus = normalizeStatus(subscription.status);
    const currentAuditState = normalizeAuditState(subscription.status);
    currentSubscriptionStatus = subscription.status;

    if (action === "suspend") {
      if (currentStatus !== "active") {
        await deps.writeAuditEvent({
          actorUserId: access.sessionUserId,
          action: "store.suspend",
          targetType: "store",
          targetId: store.id,
          organizationId: store.organization_id,
          storeId: store.id,
          outcome: "denied",
          reasonCode: "subscription_status_not_active",
          subscriptionId: subscription.id,
          previousState: currentAuditState,
          serviceSupabase,
        });
        return createZionAdminApiJsonResponse(
          {
            error: "Somente lojas com subscription active podem ser desativadas nesta etapa.",
          },
          409,
        );
      }

      operationId =
        (await deps.writeAuditEvent({
        actorUserId: access.sessionUserId,
        action: "store.suspend",
        targetType: "store",
        targetId: store.id,
        organizationId: store.organization_id,
        storeId: store.id,
        outcome: "started",
        subscriptionId: subscription.id,
        previousState: currentAuditState,
        serviceSupabase,
      })) ?? crypto.randomUUID();

      await disableStoreExternalIntegrations(
        serviceSupabase,
        store.organization_id,
        store.id,
      );
      externalIntegrationsDisabled = true;

      const updatedSubscription = await updateSubscriptionStatus(
        serviceSupabase,
        subscription.id,
        store.organization_id,
        "suspended",
      );
      currentSubscriptionStatus = updatedSubscription.status;

      try {
        await deps.writeAuditEvent({
          actorUserId: access.sessionUserId,
          action: "store.suspend",
          targetType: "store",
          targetId: store.id,
          organizationId: store.organization_id,
          storeId: store.id,
          outcome: "success",
          operationId,
          subscriptionId: updatedSubscription.id,
          previousState: currentAuditState,
          nextState: normalizeAuditState(updatedSubscription.status),
          subscriptionStatus: normalizeAuditState(updatedSubscription.status),
          externalIntegrationsDisabled,
          serviceSupabase,
        });
      } catch (auditError) {
        console.error("[zion-admin][stores][subscription-state][audit-terminal-failed]", {
          operation_id: operationId,
          action,
          phase: "success",
          error: auditError instanceof Error ? auditError.message : String(auditError),
        });
      }

      return createZionAdminApiJsonResponse(
        {
          ok: true,
          storeId: store.id,
          organizationId: store.organization_id,
          subscriptionId: updatedSubscription.id,
          action,
          previousStatus: subscription.status,
          subscriptionStatus: updatedSubscription.status,
        },
        200,
      );
    }

    if (currentStatus !== "suspended") {
      await deps.writeAuditEvent({
        actorUserId: access.sessionUserId,
        action: "store.reactivate",
        targetType: "store",
        targetId: store.id,
        organizationId: store.organization_id,
        storeId: store.id,
        outcome: "denied",
        reasonCode: "subscription_status_not_suspended",
        subscriptionId: subscription.id,
        previousState: currentAuditState,
        serviceSupabase,
      });
      return createZionAdminApiJsonResponse(
        {
          error: "Somente lojas suspensas podem ser reativadas nesta etapa.",
        },
        409,
      );
    }

    operationId =
      (await deps.writeAuditEvent({
      actorUserId: access.sessionUserId,
      action: "store.reactivate",
      targetType: "store",
      targetId: store.id,
      organizationId: store.organization_id,
      storeId: store.id,
      outcome: "started",
      subscriptionId: subscription.id,
      previousState: currentAuditState,
      serviceSupabase,
    })) ?? crypto.randomUUID();

    const updatedSubscription = await updateSubscriptionStatus(
      serviceSupabase,
      subscription.id,
      store.organization_id,
      "active",
    );
    currentSubscriptionStatus = updatedSubscription.status;

    try {
      await deps.writeAuditEvent({
        actorUserId: access.sessionUserId,
        action: "store.reactivate",
        targetType: "store",
        targetId: store.id,
        organizationId: store.organization_id,
        storeId: store.id,
        outcome: "success",
        operationId,
        subscriptionId: updatedSubscription.id,
        previousState: currentAuditState,
        nextState: normalizeAuditState(updatedSubscription.status),
        subscriptionStatus: normalizeAuditState(updatedSubscription.status),
        serviceSupabase,
      });
    } catch (auditError) {
      console.error("[zion-admin][stores][subscription-state][audit-terminal-failed]", {
        operation_id: operationId,
        action,
        phase: "success",
        error: auditError instanceof Error ? auditError.message : String(auditError),
      });
    }

    return createZionAdminApiJsonResponse(
      {
        ok: true,
        storeId: store.id,
        organizationId: store.organization_id,
        subscriptionId: updatedSubscription.id,
        action,
        previousStatus: subscription.status,
        subscriptionStatus: updatedSubscription.status,
      },
      200,
    );
  } catch (error) {
    if (actorUserId && action && serviceSupabase && resolvedStore?.id && operationId) {
      try {
        await deps.writeAuditEvent({
          actorUserId,
          action: action === "reactivate" ? "store.reactivate" : "store.suspend",
          targetType: "store",
          targetId: resolvedStore.id,
          organizationId: resolvedStore.organization_id,
          storeId: resolvedStore.id,
          outcome: "failed",
          operationId,
          reasonCode: "subscription_state_update_failed",
          subscriptionId: resolvedSubscription?.id,
          previousState: normalizeAuditState(resolvedSubscription?.status),
          nextState: normalizeAuditState(currentSubscriptionStatus),
          subscriptionStatus: normalizeAuditState(currentSubscriptionStatus),
          externalIntegrationsDisabled,
          serviceSupabase,
        });
      } catch (auditError) {
        console.error("[zion-admin][stores][subscription-state][audit-terminal-failed]", {
          operation_id: operationId,
          action,
          phase: "failed",
          error: auditError instanceof Error ? auditError.message : String(auditError),
        });
      }
    }

    console.error("[zion-admin][stores][subscription-state] unexpected error", error);
    return createZionAdminApiJsonResponse(
      {
        error: "Falha interna ao atualizar o estado da loja.",
      },
      500,
    );
  }
}

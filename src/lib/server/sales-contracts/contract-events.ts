export async function registerContractBusinessEvent(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  eventKey: string;
  actorType: string;
  leadId?: string | null;
  conversationId?: string | null;
  actorUserId?: string | null;
  eventPayload?: Record<string, unknown> | null;
}) {
  const { data, error } = await args.supabase.rpc("store_business_event_register", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_event_key: args.eventKey,
    p_actor_type: args.actorType,
    p_lead_id: args.leadId || null,
    p_conversation_id: args.conversationId || null,
    p_actor_user_id: args.actorUserId || null,
    p_event_payload: args.eventPayload || {},
  });

  if (error) {
    throw new Error(`Falha ao registrar evento de negocio do contrato: ${error.message}`);
  }

  return data;
}

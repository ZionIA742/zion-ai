import { strict as assert } from "node:assert";
import {
  resolveResponsibleWhatsappOutboundPolicy,
  type ResponsibleWhatsappTemplateContext,
} from "./responsible-whatsapp-outbound-policy";

const responsible = {
  id: "responsible-1",
  name: "Ana Responsável",
  role: "primary",
  whatsappNumber: "5511999999999",
};

function createSupabase(rows: unknown[]) {
  return {
    from(table: string) {
      assert.equal(table, "store_assistant_messages");
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        contains() { return builder; },
        order() { return builder; },
        limit: async () => ({ data: rows, error: null }),
      };
      return builder;
    },
  } as never;
}

function inbound(createdAt: string, fromPhone = "5511999999999") {
  return {
    created_at: createdAt,
    metadata: {
      origin: "whatsapp",
      responsible_id: responsible.id,
      from_phone: fromPhone,
      external_message_id: "wamid-inbound-1",
    },
  };
}

const dependencies = {
  loadResponsible: async () => ({ ok: true as const, responsible }),
  loadCustomerName: async () => "Cliente Exemplo",
  now: () => new Date("2026-10-01T12:00:00.000Z"),
};

async function resolve(context?: ResponsibleWhatsappTemplateContext, rows: unknown[] = []) {
  return resolveResponsibleWhatsappOutboundPolicy({
    supabase: createSupabase(rows),
    organizationId: "org-1",
    storeId: "store-1",
    responsibleId: responsible.id,
    destination: responsible.whatsappNumber,
    templateContext: context,
  }, dependencies);
}

async function main() {
  const recent = await resolve(undefined, [inbound("2026-10-01T11:00:00.000Z")]);
  assert.equal(recent.ok, true);
  if (recent.ok) assert.equal(recent.mode, "free_form");

  const stale = await resolve(undefined, [inbound("2026-09-30T11:59:59.000Z")]);
  assert.deepEqual(stale, { ok: false, reason: "RESPONSIBLE_WHATSAPP_TEMPLATE_REQUIRED" });

  const noInbound = await resolve(undefined);
  assert.deepEqual(noInbound, { ok: false, reason: "RESPONSIBLE_WHATSAPP_TEMPLATE_REQUIRED" });

  const common = {
    body: "Cliente solicitou uma decisão sobre o atendimento.",
    relatedLeadId: "lead-1",
    context: {
      situation: "Cliente solicitou uma decisão sobre o atendimento.",
    },
  } satisfies ResponsibleWhatsappTemplateContext;
  const cases: Array<[string, ResponsibleWhatsappTemplateContext, string, number]> = [
    ["approval", { ...common, templateKind: "operational_approval", context: { ...common.context, decision: "aprovar o horário sugerido" } }, "zion_aprovacao_operacional", 4],
    ["help", { ...common, templateKind: "human_help", context: { ...common.context, action: "avaliar a solicitação do cliente" } }, "zion_ajuda_humana", 4],
    ["action", { ...common, templateKind: "responsible_action", context: { ...common.context, action: "confirmar o próximo passo com o cliente" } }, "zion_acao_do_responsavel", 4],
    ["commitment", { ...common, templateKind: "commitment_decision", context: { ...common.context, date_time: "10/10/2026 14:00", decision: "confirmar o compromisso" } }, "zion_decisao_sobre_compromisso", 5],
  ];
  for (const [, context, templateName, parameterCount] of cases) {
    const result = await resolve(context);
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.mode, "template_required");
    assert.equal(result.template.name, templateName);
    assert.equal(result.template.language.code, "pt_BR");
    assert.equal(result.template.components[0]?.parameters.length, parameterCount);
  }

  const generic = await resolve({
    ...common,
    templateKind: "responsible_action",
    context: { situation: "há uma pendência" },
  });
  assert.deepEqual(generic, { ok: false, reason: "RESPONSIBLE_WHATSAPP_TEMPLATE_CONTEXT_INVALID" });

  const missingAction = await resolve({
    ...common,
    templateKind: "responsible_action",
  });
  assert.deepEqual(missingAction, { ok: false, reason: "RESPONSIBLE_WHATSAPP_TEMPLATE_CONTEXT_INVALID" });

  const missingCustomer = await resolveResponsibleWhatsappOutboundPolicy({
    supabase: createSupabase([]),
    organizationId: "org-1",
    storeId: "store-1",
    responsibleId: responsible.id,
    destination: responsible.whatsappNumber,
    templateContext: {
      ...common,
      templateKind: "responsible_action",
      context: { ...common.context, action: "confirmar o próximo passo" },
    },
  }, { ...dependencies, loadCustomerName: async () => null });
  assert.deepEqual(missingCustomer, { ok: false, reason: "RESPONSIBLE_WHATSAPP_TEMPLATE_CONTEXT_INVALID" });

  const oldDestination = await resolve(undefined, [inbound("2026-10-01T11:00:00.000Z", "5511888888888")]);
  assert.deepEqual(oldDestination, { ok: false, reason: "RESPONSIBLE_WHATSAPP_TEMPLATE_REQUIRED" });

  const invalidAuthority = await resolveResponsibleWhatsappOutboundPolicy({
    supabase: createSupabase([]),
    organizationId: "org-other",
    storeId: "store-other",
    responsibleId: "responsible-old",
    destination: responsible.whatsappNumber,
  }, {
    ...dependencies,
    loadResponsible: async () => ({ ok: false as const, reason: "responsible_primary_not_configured" as const }),
  });
  assert.deepEqual(invalidAuthority, { ok: false, reason: "RESPONSIBLE_WHATSAPP_AUTHORITY_INVALID" });

  console.log("responsible-whatsapp-outbound-policy: focused window/template tests passed");
}

void main();

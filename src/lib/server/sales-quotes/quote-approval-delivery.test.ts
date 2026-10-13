import assert from "node:assert/strict";
import { test } from "node:test";
import { deliverQuoteApprovalRequest, type QuoteApprovalDeliveryTransport } from "./quote-approval-delivery";
import type { ResponsibleWhatsappOutboundPolicy } from "../assistant/responsible-whatsapp-outbound-policy";

type DeliveryInput = Parameters<typeof deliverQuoteApprovalRequest>[0];
type PolicyResolver = NonNullable<DeliveryInput["resolvePolicy"]>;

const IDS = {
  request: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  store: "33333333-3333-4333-8333-333333333333",
  responsible: "44444444-4444-4444-8444-444444444444",
  quote: "55555555-5555-4555-8555-555555555555",
  version: "66666666-6666-4666-8666-666666666666",
  file: "77777777-7777-4777-8777-777777777777",
  inbound: "88888888-8888-4888-8888-888888888888",
};

function scope() {
  return {
    request_id: IDS.request,
    organization_id: IDS.organization,
    store_id: IDS.store,
    responsible_id: IDS.responsible,
    destination: "5511999999999",
    quote_id: IDS.quote,
    quote_version_id: IDS.version,
    report_snapshot: {
      quote_id: IDS.quote,
      quote_version_id: IDS.version,
      quote_number: "ORC-2026-001",
      quote_version_number: "1",
      currency: "BRL",
      total_cents: 123456,
      commercial_opportunity_id: "opportunity-internal",
      storage_path: "private/internal/path.pdf",
      quote_pdf_store_file_id: IDS.file,
    },
    pdf_store_file_id: IDS.file,
    pdf_storage_bucket: "zion-store-files",
    pdf_storage_path: "org/store/sales-quotes/quote-v1.pdf",
    prepared: true,
  };
}

function fakeSupabase() {
  const calls: Array<{ kind: string; name?: string; args?: Record<string, unknown> }> = [];
  type FakeRpcResponse = { data: unknown; error: { message: string } | null };
  const rpc = async (name: string, args: Record<string, unknown>): Promise<FakeRpcResponse> => {
    calls.push({ kind: "rpc", name, args });
    if (name.includes("prepare")) return { data: scope(), error: null };
    if (name.includes("claim")) {
      const component = String(args.p_component);
      return {
        data: { ...scope(), component, claim_token: `${component}-token`, state: "claimed" },
        error: null,
      };
    }
    return {
      data: {
        request_id: IDS.request,
        component: args.p_component,
        state: args.p_result,
        idempotent: false,
        request_status: "awaiting_responsible",
      },
      error: null,
    };
  };
  const ledger = ["opening_template", "report", "pdf"].map((component) => ({
    request_id: IDS.request,
    organization_id: IDS.organization,
    store_id: IDS.store,
    component,
    status: "pending",
    external_message_id: null,
    inbound_window_message_id: null,
    pdf_store_file_id: component === "pdf" ? IDS.file : null,
    pdf_storage_bucket: component === "pdf" ? "zion-store-files" : null,
    pdf_storage_path: component === "pdf" ? "org/store/sales-quotes/quote-v1.pdf" : null,
  }));
  const client = {
    calls,
    ledger,
    ledgerError: null as { message: string } | null,
    rpc,
    from(table: string) {
      if (table === "p9_quote_approval_delivery_parts") {
        const query = {
          eq() {
            return query;
          },
          then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
            return Promise.resolve({ data: ledger, error: client.ledgerError }).then(resolve, reject);
          },
        };
        return { select: () => query };
      }
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: {
                    id: IDS.file,
                    organization_id: IDS.organization,
                    store_id: IDS.store,
                    storage_bucket: "zion-store-files",
                    storage_path: "org/store/sales-quotes/quote-v1.pdf",
                    original_filename: "orcamento-v1.pdf",
                    mime_type: "application/pdf",
                  },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          createSignedUrl: async (path: string, expiresIn: number) => ({
            data: { signedUrl: `https://signed.test/${bucket}/${path}?ttl=${expiresIn}` },
            error: null,
          }),
        };
      },
    },
  };
  return client;
}

function freePolicy(inboundMessageId = IDS.inbound): ResponsibleWhatsappOutboundPolicy {
  return {
    ok: true as const,
    mode: "free_form" as const,
    responsible: { id: IDS.responsible, whatsappNumber: "5511999999999", name: "Responsavel", role: null },
    template: null,
    lastInboundMessageId: inboundMessageId,
  };
}

function templatePolicy(): ResponsibleWhatsappOutboundPolicy {
  return {
    ok: true as const,
    mode: "template_required" as const,
    responsible: { id: IDS.responsible, whatsappNumber: "5511999999999", name: "Responsavel", role: null },
    template: {
      name: "zion_acao_do_responsavel",
      language: { code: "pt_BR" },
      components: [{ type: "body" as const, parameters: [{ type: "text" as const, text: "Responsavel" }] }],
    },
    lastInboundMessageId: null,
  };
}

function input(client: ReturnType<typeof fakeSupabase>, transport: QuoteApprovalDeliveryTransport, resolvePolicy: PolicyResolver) {
  return {
    requestId: IDS.request,
    supabase: client as unknown as NonNullable<DeliveryInput["supabase"]>,
    transport,
    resolvePolicy,
    openingTemplateContext: { templateKind: "responsible_action", body: "Aprovar o orcamento", context: { situation: "Orcamento pendente", action: "Responder" } },
  };
}

test("entrega report e PDF exatos no mesmo WhatsApp, com claim antes do transporte", async () => {
  const client = fakeSupabase();
  const sent: Array<{ payload: { type: string; [key: string]: unknown } }> = [];
  const transport: QuoteApprovalDeliveryTransport = async (args) => {
    sent.push(args);
    return { ok: true, externalMessageId: `wamid-${sent.length}` };
  };
  const result = await deliverQuoteApprovalRequest(input(client, transport, async () => freePolicy()));
  assert.equal(result.ok, true);
  assert.deepEqual(sent.map((item) => item.payload.type), ["text", "document"]);
  assert.equal(sent[1].payload.link, "https://signed.test/zion-store-files/org/store/sales-quotes/quote-v1.pdf?ttl=300");
  assert.match(String(sent[0].payload.body), /R\$\s*1\.234,56/);
  assert.doesNotMatch(String(sent[0].payload.body), /commercial|storage|quote_pdf_store_file_id|opportunity-internal/i);
  assert.equal(client.calls.filter((call) => call.kind === "rpc").some((call) => String(call.name).includes("materialize")), false);
  const firstSendIndex = client.calls.findIndex((call) => call.kind === "rpc" && String(call.name).includes("claim"));
  assert.equal(firstSendIndex >= 0, true);
});

test("fora da janela envia apenas o template e aguarda inbound real", async () => {
  const client = fakeSupabase();
  const sent: Array<{ payload: { type: string; [key: string]: unknown } }> = [];
  const result = await deliverQuoteApprovalRequest(input(client, async (args) => {
    sent.push(args);
    return { ok: true, externalMessageId: "wamid-opening" };
  }, async () => templatePolicy()));
  assert.deepEqual(result, { ok: false, requestId: IDS.request, state: "awaiting_inbound", reason: "P9_DELIVERY_AWAITING_RESPONSIBLE_INBOUND" });
  assert.deepEqual(sent.map((item) => item.payload.type), ["template"]);
  assert.equal(client.calls.filter((call) => call.kind === "rpc" && String(call.name).includes("claim")).length, 1);
});

test("transporte incerto finaliza uncertain e não envia o PDF", async () => {
  const client = fakeSupabase();
  const sent: Array<{ payload: { type: string; [key: string]: unknown } }> = [];
  const result = await deliverQuoteApprovalRequest(input(client, async (args) => {
    sent.push(args);
    return { ok: false, reason: "send_uncertain" };
  }, async () => freePolicy()));
  assert.deepEqual(result, { ok: false, requestId: IDS.request, state: "uncertain", reason: "send_uncertain" });
  assert.deepEqual(sent.map((item) => item.payload.type), ["text"]);
  const finish = client.calls.find((call) => call.kind === "rpc" && String(call.name).includes("finish"));
  assert.equal(finish?.args?.p_result, "uncertain");
});

test("claim já reservado bloqueia reprocessamento sem novo envio", async () => {
  const client = fakeSupabase();
  const originalRpc = client.rpc;
  client.rpc = async (name: string, args: Record<string, unknown>) => {
    if (name.includes("claim")) return { data: null, error: { message: "P9_DELIVERY_COMPONENT_ALREADY_CLAIMED" } };
    return originalRpc(name, args);
  };
  let sends = 0;
  const result = await deliverQuoteApprovalRequest(input(client, async () => {
    sends += 1;
    return { ok: true, externalMessageId: "wamid-never" };
  }, async () => freePolicy()));
  assert.equal(result.ok, false);
  assert.equal(sends, 0);
  assert.equal(result.state, "report_not_retryable");
});

test("exceção de transporte depois do claim finaliza uncertain sem retry", async () => {
  const client = fakeSupabase();
  const result = await deliverQuoteApprovalRequest(input(client, async () => {
    throw new Error("network socket closed");
  }, async () => freePolicy()));
  assert.deepEqual(result, {
    ok: false,
    requestId: IDS.request,
    state: "uncertain",
    reason: "P9_DELIVERY_TRANSPORT_EXCEPTION_UNKNOWN_OUTCOME",
  });
  const finish = client.calls.find((call) => call.kind === "rpc" && String(call.name).includes("finish"));
  assert.equal(finish?.args?.p_result, "uncertain");
});

test("falha da finalização após aceite externo preserva o bloqueio para reconciliação", async () => {
  const client = fakeSupabase();
  const originalRpc = client.rpc;
  client.rpc = async (name: string, args: Record<string, unknown>) => {
    if (name.includes("finish")) {
      client.calls.push({ kind: "rpc", name, args });
      return { data: null, error: { message: "RPC unavailable" } };
    }
    return originalRpc(name, args);
  };
  const result = await deliverQuoteApprovalRequest(input(client, async () => ({
    ok: true,
    externalMessageId: "wamid-accepted-before-finalization",
  }), async () => freePolicy()));
  assert.equal(result.ok, false);
  assert.equal(result.state, "finalization_uncertain");
  assert.equal(result.reason, "P9_DELIVERY_FINALIZATION_FAILED_AFTER_EXTERNAL_ATTEMPT");
});

test("falha do Storage antes do claim do PDF não repete o relatório aceito", async () => {
  const client = fakeSupabase();
  client.storage.from = (() => ({
    createSignedUrl: async () => ({ data: null, error: { message: "storage unavailable" } }),
  })) as unknown as typeof client.storage.from;
  const sent: string[] = [];
  const result = await deliverQuoteApprovalRequest(input(client, async (args) => {
    sent.push(args.payload.type);
    return { ok: true, externalMessageId: `wamid-${sent.length}` };
  }, async () => freePolicy()));
  assert.equal(result.ok, false);
  assert.equal(result.state, "pdf_prepare_failed");
  assert.deepEqual(sent, ["text"]);
  assert.equal(client.calls.filter((call) => call.kind === "rpc" && String(call.name).includes("claim")).length, 1);
});

test("inbound novo e legítimo entre relatório e PDF é aceito e o claim usa cada UUID", async () => {
  const client = fakeSupabase();
  const inboundA = IDS.inbound;
  const inboundB = "99999999-9999-4999-8999-999999999999";
  const inboundC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const policies = [freePolicy(inboundA), freePolicy(inboundB), freePolicy(inboundC), freePolicy(inboundC)];
  let policyIndex = 0;
  const result = await deliverQuoteApprovalRequest(input(client, async () => ({
    ok: true,
    externalMessageId: "wamid-ok",
  }), async () => policies[Math.min(policyIndex++, policies.length - 1)]));
  assert.equal(result.ok, true);
  const claims = client.calls.filter((call) => call.kind === "rpc" && String(call.name).includes("claim"));
  assert.equal(claims[0]?.args?.p_inbound_window_message_id, inboundA);
  assert.equal(claims[1]?.args?.p_inbound_window_message_id, inboundC);
});

test("status dispatch_uncertain não é reportado como entrega completa e preserva IDs", async () => {
  const client = fakeSupabase();
  const originalRpc = client.rpc;
  client.rpc = async (name: string, args: Record<string, unknown>) => {
    const response = await originalRpc(name, args);
    if (name.includes("finish") && args.p_component === "pdf") {
      return {
        ...response,
        data: { ...(response.data as Record<string, unknown>), request_status: "dispatch_uncertain" },
      };
    }
    return response;
  };
  const result = await deliverQuoteApprovalRequest(input(client, async (args) => ({
    ok: true,
    externalMessageId: args.payload.type === "text" ? "wamid-report" : "wamid-pdf",
  }), async () => freePolicy()));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected incomplete delivery");
  assert.equal(result.state, "unexpected_request_status");
  assert.equal(result.requestStatus, "dispatch_uncertain");
  assert.equal(result.reportMessageId, "wamid-report");
  assert.equal(result.pdfMessageId, "wamid-pdf");
});

test("inbound inválido é rejeitado antes do claim", async () => {
  const client = fakeSupabase();
  const result = await deliverQuoteApprovalRequest(input(client, async () => ({
    ok: true,
    externalMessageId: "wamid-never",
  }), async () => freePolicy("not-a-uuid")));
  assert.deepEqual(result, {
    ok: false,
    requestId: IDS.request,
    state: "window_invalid",
    reason: "P9_DELIVERY_INBOUND_ID_INVALID",
  });
  assert.equal(client.calls.some((call) => call.kind === "rpc" && String(call.name).includes("claim")), false);
});

test("request obsoleto falha no prepare sem transporte", async () => {
  const client = fakeSupabase();
  const originalRpc = client.rpc;
  client.rpc = async (name: string, args: Record<string, unknown>) => {
    if (name.includes("prepare")) {
      client.calls.push({ kind: "rpc", name, args });
      return { data: null, error: { message: "P9_DELIVERY_VERSION_STALE" } };
    }
    return originalRpc(name, args);
  };
  let sends = 0;
  const result = await deliverQuoteApprovalRequest(input(client, async () => {
    sends += 1;
    return { ok: true, externalMessageId: "wamid-never" };
  }, async () => freePolicy()));
  if (result.ok) throw new Error("expected prepare failure");
  assert.equal(result.state, "prepare_failed");
  assert.equal(sends, 0);
});

test("retomada usa relatório aceito e envia somente o PDF pendente", async () => {
  const client = fakeSupabase();
  client.ledger.find((part) => part.component === "report")!.status = "accepted";
  client.ledger.find((part) => part.component === "report")!.external_message_id = "wamid-report-persistido";
  const sent: string[] = [];
  const result = await deliverQuoteApprovalRequest(input(client, async (args) => {
    sent.push(args.payload.type);
    return { ok: true, externalMessageId: "wamid-pdf-retomado" };
  }, async () => freePolicy()));
  assert.equal(result.ok, true);
  assert.deepEqual(sent, ["document"]);
  assert.equal(result.reportMessageId, "wamid-report-persistido");
  assert.equal(client.calls.filter((call) => call.kind === "rpc" && String(call.name).includes("claim") && call.args?.p_component === "report").length, 0);
});

test("componente report claimed ou uncertain não é reenviado", async () => {
  for (const status of ["claimed", "uncertain"] as const) {
    const client = fakeSupabase();
    const reportPart = client.ledger.find((part) => part.component === "report")!;
    reportPart.status = status;
    let sends = 0;
    const result = await deliverQuoteApprovalRequest(input(client, async () => {
      sends += 1;
      return { ok: true, externalMessageId: "wamid-never" };
    }, async () => freePolicy()));
    assert.equal(result.ok, false);
    assert.equal(sends, 0);
    assert.equal(result.state, "report_not_retryable");
  }
});

test("falha de leitura do ledger bloqueia a entrega sem transporte", async () => {
  const client = fakeSupabase();
  client.ledgerError = { message: "permission denied" };
  let sends = 0;
  const result = await deliverQuoteApprovalRequest(input(client, async () => {
    sends += 1;
    return { ok: true, externalMessageId: "wamid-never" };
  }, async () => freePolicy()));
  assert.deepEqual(result, {
    ok: false,
    requestId: IDS.request,
    state: "ledger_unavailable",
    reason: "P9_DELIVERY_LEDGER_READ_FAILED",
  });
  assert.equal(sends, 0);
});

test("rejeição definitiva da Meta finaliza failed e não envia o PDF", async () => {
  const client = fakeSupabase();
  const sent: string[] = [];
  const result = await deliverQuoteApprovalRequest(input(client, async (args) => {
    sent.push(args.payload.type);
    return { ok: false, reason: "META_MESSAGE_REJECTED" };
  }, async () => freePolicy()));
  assert.deepEqual(result, { ok: false, requestId: IDS.request, state: "failed", reason: "META_MESSAGE_REJECTED" });
  assert.deepEqual(sent, ["text"]);
  assert.equal(client.calls.find((call) => call.kind === "rpc" && call.args?.p_component === "report" && String(call.name).includes("finish"))?.args?.p_result, "failed");
});

test("snapshot sem dados comerciais essenciais bloqueia o relatório", async () => {
  const client = fakeSupabase();
  const originalRpc = client.rpc;
  client.rpc = async (name: string, args: Record<string, unknown>) => {
    const response = await originalRpc(name, args);
    if (name.includes("prepare")) {
      const prepared = response.data as Record<string, unknown>;
      const snapshot = { ...(prepared.report_snapshot as Record<string, unknown>) };
      delete snapshot.quote_number;
      return { ...response, data: { ...prepared, report_snapshot: snapshot } };
    }
    return response;
  };
  const result = await deliverQuoteApprovalRequest(input(client, async () => ({ ok: true, externalMessageId: "wamid-never" }), async () => freePolicy()));
  assert.deepEqual(result, { ok: false, requestId: IDS.request, state: "report_blocked", reason: "P9_DELIVERY_REPORT_DATA_INSUFFICIENT" });
  assert.equal(client.calls.some((call) => call.kind === "rpc" && String(call.name).includes("claim")), false);
});

test("finalização com componente ou estado inesperado não confirma entrega", async () => {
  const client = fakeSupabase();
  const originalRpc = client.rpc;
  client.rpc = async (name: string, args: Record<string, unknown>) => {
    const response = await originalRpc(name, args);
    if (name.includes("finish") && args.p_component === "pdf") {
      return { ...response, data: { ...(response.data as Record<string, unknown>), component: "report" } };
    }
    return response;
  };
  const result = await deliverQuoteApprovalRequest(input(client, async (args) => ({
    ok: true,
    externalMessageId: args.payload.type === "text" ? "wamid-report" : "wamid-pdf",
  }), async () => freePolicy()));
  assert.equal(result.ok, false);
  assert.equal(result.state, "finalization_uncertain");
  assert.equal(result.reportMessageId, "wamid-report");
});

test("solicitação fica bloqueada se ficar obsoleta durante a retomada", async () => {
  const client = fakeSupabase();
  const reportPart = client.ledger.find((part) => part.component === "report")!;
  reportPart.status = "accepted";
  reportPart.external_message_id = "wamid-report-persistido";
  const originalRpc = client.rpc;
  client.rpc = async (name: string, args: Record<string, unknown>) => {
    if (name.includes("claim") && args.p_component === "pdf") {
      return { data: null, error: { message: "P9_DELIVERY_VERSION_STALE" } };
    }
    return originalRpc(name, args);
  };
  const result = await deliverQuoteApprovalRequest(input(client, async () => ({ ok: true, externalMessageId: "wamid-never" }), async () => freePolicy()));
  assert.deepEqual(result, {
    ok: false,
    requestId: IDS.request,
    state: "pdf_not_retryable",
    reason: "P9_DELIVERY_VERSION_STALE",
    reportMessageId: "wamid-report-persistido",
  });
});

test("retomada não libera PDF claimed ou uncertain e preserva reportMessageId", async () => {
  for (const status of ["claimed", "uncertain"] as const) {
    const client = fakeSupabase();
    const reportPart = client.ledger.find((part) => part.component === "report")!;
    reportPart.status = "accepted";
    reportPart.external_message_id = "wamid-report-persistido";
    const pdfPart = client.ledger.find((part) => part.component === "pdf")!;
    pdfPart.status = status;
    let sends = 0;
    const result = await deliverQuoteApprovalRequest(input(client, async () => {
      sends += 1;
      return { ok: true, externalMessageId: "wamid-never" };
    }, async () => freePolicy()));
    assert.equal(result.ok, false);
    assert.equal(result.state, "pdf_not_retryable");
    assert.equal(result.reportMessageId, "wamid-report-persistido");
    assert.equal(sends, 0);
  }
});

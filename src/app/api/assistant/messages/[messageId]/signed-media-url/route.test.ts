import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantSignedMediaUrlGetHandler } from "./route";

function client(messagePath: string, eventPath = messagePath) {
  const supabase = {
    from(table: string) {
      const query: any = {
        select() { return query; },
        eq() { return query; },
        contains() { return query; },
        maybeSingle: async () => {
          if (table === "store_assistant_messages") {
            return {
              data: {
                id: "assistant-message-1",
                organization_id: "org-1",
                store_id: "store-1",
                thread_id: "thread-1",
                sender_role: "system",
                metadata: {
                  kind: "document_review",
                  attachment_kind: "file",
                  origin: "received_contract_document_evidence",
                  channel: "whatsapp",
                  received_evidence_source_message_id: "incoming-1",
                  storage_bucket: "zion-store-files",
                  storage_path: messagePath,
                  mime_type: "application/pdf",
                  original_file_name: "devolvido.pdf",
                },
              },
              error: null,
            };
          }
          if (table === "store_assistant_threads") {
            return { data: { id: "thread-1", organization_id: "org-1", store_id: "store-1", thread_type: "primary" }, error: null };
          }
          return {
            data: {
              event_key: "contract_uploaded",
              event_payload: {
                schema: "received_contract_document_evidence",
                source_message_id: "incoming-1",
                received_document: {
                  storageBucket: "zion-store-files",
                  storagePath: eventPath,
                },
              },
            },
            error: null,
          };
        },
      };
      return query;
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed.test/${path}` }, error: null }),
      }),
    },
  };
  return supabase;
}

test("disponibiliza o arquivo recebido somente após validar a evidencia no tenant", async () => {
  const handler = createAssistantSignedMediaUrlGetHandler({
    resolveAccess: async () => ({ ok: true, organizationId: "org-1", storeId: "store-1" } as any),
    createPrivilegedClient: () => client("inbound/devolvido-v2.pdf") as any,
  });
  const response = await handler(new Request("https://example.test"), {
    params: Promise.resolve({ messageId: "assistant-message-1" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.signedUrl, "https://signed.test/inbound/devolvido-v2.pdf");
});

test("nao autoriza a mensagem quando o caminho nao corresponde ao evento recebido", async () => {
  const response = await createAssistantSignedMediaUrlGetHandler({
    resolveAccess: async () => ({ ok: true, organizationId: "org-1", storeId: "store-1" } as any),
    createPrivilegedClient: () => client("inbound/devolvido-v2.pdf", "inbound/outro-arquivo.pdf") as any,
  })(new Request("https://example.test"), {
    params: Promise.resolve({ messageId: "assistant-message-1" }),
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error, "INVALID_RECEIVED_DOCUMENT_EVIDENCE");
});

test("nega acesso fora do escopo da loja antes de consultar a evidencia", async () => {
  const response = await createAssistantSignedMediaUrlGetHandler({
    resolveAccess: async () => ({
      ok: false,
      httpStatus: 403,
      payload: { ok: false, error: "STORE_ACCESS_DENIED" },
    } as any),
    createPrivilegedClient: () => {
      throw new Error("cliente nao deveria ser criado");
    },
  })(new Request("https://example.test"), {
    params: Promise.resolve({ messageId: "assistant-message-1" }),
  });
  assert.equal(response.status, 403);
});

console.log("assistant-received-document-signed-url: PASS");

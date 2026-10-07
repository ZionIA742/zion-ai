import { strict as assert } from "node:assert";
import { readManualAttachmentAuthorization } from "@/lib/server/manual-attachment-contract";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { handleManualAttachmentAuthorizePost } from "./route";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const scope = {
  organizationId: "org-authorized",
  storeId: "store-authorized",
  conversationId: "conversation-authorized",
  leadId: "lead-authorized",
};

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function createGrantedAccess(
  overrides: Partial<StoreApiAccessGranted> = {},
): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as StoreApiAccessGranted["supabase"],
    resolution: {} as StoreApiAccessGranted["resolution"],
    sessionUserId: "user-authorized",
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    ...overrides,
  };
}

function createDeniedAccess(): StoreApiAccessDenied {
  return {
    ok: false,
    resolution: {} as StoreApiAccessDenied["resolution"],
    httpStatus: 403,
    payload: {
      ok: false,
      error: "STORE_API_ACCESS_DENIED",
      message: "Mensagem publica.",
      status: "blocked",
      reasonCode: "missing_membership",
    },
  };
}

function createRequest(body: unknown, options: { invalidJson?: boolean } = {}) {
  return new Request("http://localhost/api/crm/messages/send-manual-attachment/authorize", {
    method: "POST",
    body: options.invalidJson ? "{" : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function createSupabase(args: {
  conversation?: { id: string; organization_id: string; lead_id: string | null } | null;
  lead?: { id: string; organization_id: string; store_id: string | null } | null;
  signedToken?: string | null;
  calls: { signedUpload: Array<{ bucket: string; path: string; options: unknown }> };
}) {
  const query = (table: string) => {
    const filters: Record<string, unknown> = {};
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      maybeSingle: async () => {
        if (table === "conversations") {
          const row = args.conversation;
          const matches = row && Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value);
          return { data: matches ? row : null, error: null };
        }
        const row = args.lead;
        const matches = row && Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value);
        return { data: matches ? row : null, error: null };
      },
    };
    return builder;
  };

  return {
    from: (table: string) => query(table),
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string, options: unknown) => {
          args.calls.signedUpload.push({ bucket, path, options });
          return {
            data: args.signedToken === null ? null : { token: args.signedToken || "signed-upload-token" },
            error: args.signedToken === null ? { message: "signed upload unavailable" } : null,
          };
        },
      }),
    },
  };
}

async function run(
  body: unknown,
  args: {
    access?: StoreApiAccessGranted | StoreApiAccessDenied;
    supabase?: ReturnType<typeof createSupabase>;
    invalidJson?: boolean;
  } = {},
) {
  const supabase = args.supabase || createSupabase({
    conversation: {
      id: scope.conversationId,
      organization_id: scope.organizationId,
      lead_id: scope.leadId,
    },
    lead: {
      id: scope.leadId,
      organization_id: scope.organizationId,
      store_id: scope.storeId,
    },
    calls: { signedUpload: [] },
  });

  return handleManualAttachmentAuthorizePost(
    createRequest(body, { invalidJson: args.invalidJson }),
    {
      resolveAccess: async () => args.access || createGrantedAccess(),
      createServiceClient: () => supabase as never,
    },
  );
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const validBody = {
  conversationId: scope.conversationId,
  fileName: "Contrato final.pdf",
  mimeType: "application/pdf; charset=binary",
  sizeBytes: 1234,
  content: "Documento enviado pela loja.",
};

const cases: TestCase[] = [
  {
    name: "rejeita acesso sem loja ativa",
    async run() {
      const response = await run(validBody, { access: createDeniedAccess() });
      assert.equal(response.status, 403);
      assert.equal((await readJson(response)).ok, false);
    },
  },
  {
    name: "rejeita JSON inválido",
    async run() {
      const response = await run(validBody, { invalidJson: true });
      assert.equal(response.status, 400);
      assert.equal((await readJson(response)).error, "invalid_json");
    },
  },
  {
    name: "rejeita body inválido",
    async run() {
      const response = await run({ conversationId: scope.conversationId });
      assert.equal(response.status, 400);
      assert.equal((await readJson(response)).error, "invalid_attachment_request");
    },
  },
  {
    name: "rejeita tamanho zero e negativo",
    async run() {
      for (const sizeBytes of [0, -1]) {
        const response = await run({ ...validBody, sizeBytes });
        assert.equal(response.status, 400);
        assert.equal((await readJson(response)).error, "attachment_empty");
      }
    },
  },
  {
    name: "rejeita arquivo acima de 10 MB",
    async run() {
      const response = await run({ ...validBody, sizeBytes: MAX_FILE_SIZE_BYTES + 1 });
      assert.equal(response.status, 413);
      assert.equal((await readJson(response)).error, "attachment_too_large");
    },
  },
  {
    name: "rejeita MIME não permitido",
    async run() {
      const response = await run({ ...validBody, mimeType: "application/x-secret-format" });
      assert.equal(response.status, 415);
      assert.equal((await readJson(response)).error, "unsupported_attachment_type");
    },
  },
  {
    name: "rejeita conversa fora do organization/store/lead autorizado",
    async run() {
      const calls = { signedUpload: [] as Array<{ bucket: string; path: string; options: unknown }> };
      const supabase = createSupabase({
        conversation: {
          id: scope.conversationId,
          organization_id: "org-other",
          lead_id: "lead-other",
        },
        lead: null,
        calls,
      });
      const response = await run(validBody, { supabase });
      assert.equal(response.status, 403);
      assert.equal((await readJson(response)).error, "conversation_not_found_or_forbidden");
      assert.deepEqual(calls.signedUpload, []);
    },
  },
  {
    name: "gera path server-side no escopo canônico e usa bucket privado",
    async run() {
      const calls = { signedUpload: [] as Array<{ bucket: string; path: string; options: unknown }> };
      const supabase = createSupabase({
        conversation: { id: scope.conversationId, organization_id: scope.organizationId, lead_id: scope.leadId },
        lead: { id: scope.leadId, organization_id: scope.organizationId, store_id: scope.storeId },
        calls,
      });
      const response = await run({ ...validBody, organizationId: "browser-org", storeId: "browser-store", path: "browser/path" }, { supabase });
      const payload = await readJson(response);
      assert.equal(response.status, 200);
      assert.match(String(payload.path), new RegExp(`^${scope.organizationId}/${scope.storeId}/manual-attachments/${scope.conversationId}/`));
      assert.equal(calls.signedUpload.length, 1);
      assert.equal(calls.signedUpload[0].bucket, "zion-store-files");
      assert.equal(calls.signedUpload[0].path, payload.path);
      assert.notEqual(String(payload.path), "browser/path");
    },
  },
  {
    name: "usa createSignedUploadUrl com upsert=false",
    async run() {
      const calls = { signedUpload: [] as Array<{ bucket: string; path: string; options: unknown }> };
      const response = await run(validBody, {
        supabase: createSupabase({
          conversation: { id: scope.conversationId, organization_id: scope.organizationId, lead_id: scope.leadId },
          lead: { id: scope.leadId, organization_id: scope.organizationId, store_id: scope.storeId },
          calls,
        }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(calls.signedUpload[0].options, { upsert: false });
    },
  },
  {
    name: "retorna token de signed upload e authorizationToken assinado",
    async run() {
      const response = await run(validBody);
      const payload = await readJson(response);
      assert.equal(response.status, 200);
      assert.equal(payload.token, "signed-upload-token");
      assert.match(String(payload.authorizationToken), /^[^.]+\.[^.]+$/);
    },
  },
  {
    name: "authorizationToken preserva o contrato canônico",
    async run() {
      const response = await run(validBody);
      const payload = await readJson(response);
      const authorization = readManualAttachmentAuthorization(String(payload.authorizationToken));
      assert.equal(authorization.organizationId, scope.organizationId);
      assert.equal(authorization.storeId, scope.storeId);
      assert.equal(authorization.conversationId, scope.conversationId);
      assert.equal(authorization.leadId, scope.leadId);
      assert.equal(authorization.path, payload.path);
      assert.equal(authorization.mimeType, "application/pdf");
      assert.equal(authorization.sizeBytes, validBody.sizeBytes);
      assert.equal(authorization.messageType, "document");
      assert.equal(authorization.content, validBody.content);
      assert.match(authorization.idempotencyKey, /^crm_manual_attachment:/);
      assert.match(authorization.payloadFingerprint, /^[a-f0-9]{64}$/);
    },
  },
  {
    name: "aceita imagem, documento, áudio e vídeo do allowlist",
    async run() {
      const allowed = [
        ["image/png", "image", "foto.png"],
        ["application/pdf", "document", "arquivo.pdf"],
        ["audio/webm", "audio", "voz.webm"],
        ["video/mp4", "video", "video.mp4"],
      ] as const;
      for (const [mimeType, messageType, fileName] of allowed) {
        const response = await run({ ...validBody, mimeType, fileName });
        const payload = await readJson(response);
        assert.equal(response.status, 200);
        assert.equal(payload.messageType, messageType);
      }
    },
  },
  {
    name: "não expõe service role nem depende de organization/store/path do browser",
    async run() {
      const response = await run({
        ...validBody,
        organization_id: "browser-org",
        store_id: "browser-store",
        storagePath: "../../outside",
        authorizationToken: process.env.SUPABASE_SERVICE_ROLE_KEY,
      });
      const serialized = JSON.stringify(await readJson(response));
      assert.equal(response.status, 200);
      assert.equal(serialized.includes(process.env.SUPABASE_SERVICE_ROLE_KEY || ""), false);
      assert.equal(serialized.includes("browser-org"), false);
      assert.equal(serialized.includes("browser-store"), false);
      assert.equal(serialized.includes("../../outside"), false);
    },
  },
];

for (const testCase of cases) {
  await testCase.run();
}

console.log(`manual-attachment-authorize: ${cases.length} tests passed`);

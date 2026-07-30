import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleSendManualAttachmentPost } from "./route";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type QueryRecord = {
  table: string;
  columns: string;
  filters: Record<string, unknown>;
};

type ConversationFixture = {
  id: string;
  organization_id: string;
  store_id: string | null;
  lead_id: string | null;
};

type LeadFixture = {
  id: string;
  organization_id: string;
  store_id: string | null;
};

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function createDeniedAccess(
  httpStatus: 401 | 403 | 409 | 503,
  status: StoreApiAccessDenied["payload"]["status"],
): StoreApiAccessDenied {
  return {
    ok: false,
    resolution: {
      domain: "store_area",
      status,
      sessionUserId: null,
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      organizationResolution: "none",
      storeResolution: "none",
      organizationId: null,
      storeId: null,
      commercialAccess: "unknown",
      reasonCode: "missing_membership",
      message: "Conta nao esta pronta para usar a API da loja.",
    },
    httpStatus,
    payload: {
      ok: false,
      error:
        httpStatus === 401
          ? "STORE_API_UNAUTHENTICATED"
          : httpStatus === 503
            ? "STORE_API_ACCESS_UNAVAILABLE"
            : httpStatus === 403
              ? "STORE_API_FORBIDDEN"
              : "STORE_API_ACCESS_DENIED",
      message: "Mensagem publica.",
      status,
      reasonCode: "missing_membership",
    },
  };
}

function createGrantedAccess(
  overrides?: Partial<StoreApiAccessGranted>,
): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as unknown as StoreApiAccessGranted["supabase"],
    resolution: {
      domain: "store_area",
      status: "store_ready_active",
      sessionUserId: "user-1",
      safeHtmlDestination: "/crm",
      apiDecision: "allow",
      organizationResolution: "single",
      storeResolution: "single",
      organizationId: "access-org",
      storeId: "access-store",
      commercialAccess: "allowed",
      reasonCode: "missing_membership",
      message: "Conta liberada.",
    },
    sessionUserId: "user-1",
    organizationId: "access-org",
    storeId: "access-store",
    ...overrides,
  };
}

function createFile(
  name: string,
  type: string,
  content: string,
): File {
  return new File([content], name, { type });
}

function createRequest(args: {
  formDataFactory: () => FormData | Promise<FormData>;
  tracker: { reads: number };
}) {
  return {
    formData: async () => {
      args.tracker.reads += 1;
      return args.formDataFactory();
    },
  } as unknown as Request;
}

function createFormData(fields: {
  organizationId?: string;
  storeId?: string;
  conversationId?: string;
  content?: string;
  file?: File | string | null;
}) {
  const formData = new FormData();

  if (fields.organizationId !== undefined) {
    formData.set("organizationId", fields.organizationId);
  }

  if (fields.storeId !== undefined) {
    formData.set("storeId", fields.storeId);
  }

  if (fields.conversationId !== undefined) {
    formData.set("conversationId", fields.conversationId);
  }

  if (fields.content !== undefined) {
    formData.set("content", fields.content);
  }

  if (fields.file instanceof File) {
    formData.set("file", fields.file);
  } else if (typeof fields.file === "string") {
    formData.set("file", fields.file);
  }

  return formData;
}

function createServiceSupabaseMock(args?: {
  conversation?: ConversationFixture | null;
  conversationError?: unknown;
  lead?: LeadFixture | null;
  leadError?: unknown;
  uploadError?: unknown;
  removeError?: unknown;
  removeThrows?: boolean;
  insertResult?: { data: unknown; error: unknown };
  insertThrows?: boolean;
  events?: string[];
}) {
  const queries: QueryRecord[] = [];
  const uploads: Array<{ bucket: string; path: string; body: Buffer; options: Record<string, unknown> }> = [];
  const removals: Array<{ bucket: string; paths: string[] }> = [];
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];

  const supabase = {
    queries,
    uploads,
    removals,
    rpcCalls,
    from(table: string) {
      const state: QueryRecord = {
        table,
        columns: "",
        filters: {},
      };

      return {
        select(columns: string) {
          state.columns = columns;
          return this;
        },
        eq(column: string, value: unknown) {
          state.filters[column] = value;
          return this;
        },
        async maybeSingle() {
          queries.push({
            table: state.table,
            columns: state.columns,
            filters: { ...state.filters },
          });

          if (table === "conversations") {
            args?.events?.push("conversation_query");
            if (args?.conversationError) {
              return { data: null, error: args.conversationError };
            }
            return { data: args?.conversation ?? null, error: null };
          }

          if (table === "leads") {
            args?.events?.push("lead_query");
            if (args?.leadError) {
              return { data: null, error: args.leadError };
            }
            return { data: args?.lead ?? null, error: null };
          }

          return { data: null, error: null };
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          async upload(
            path: string,
            body: Buffer,
            options: Record<string, unknown>,
          ) {
            uploads.push({ bucket, path, body, options });
            args?.events?.push("upload");
            return { error: args?.uploadError ?? null };
          },
          async remove(paths: string[]) {
            removals.push({ bucket, paths });
            args?.events?.push("cleanup");
            if (args?.removeThrows) {
              throw new Error("cleanup exploded");
            }
            return { error: args?.removeError ?? null };
          },
        };
      },
    },
    async rpc(name: string, params: Record<string, unknown>) {
      rpcCalls.push({ name, params });
      args?.events?.push("insert_message");
      if (args?.insertThrows) {
        throw new Error("insert exploded");
      }
      return args?.insertResult ?? { data: { id: "message-1" }, error: null };
    },
  };

  return supabase;
}

const tests: TestCase[] = [
  {
    name: "401 403 409 and 503 denied statuses are preserved",
    run: async () => {
      for (const [httpStatus, status] of [
        [401, "anonymous"],
        [403, "cross_domain_forbidden"],
        [409, "store_missing_membership"],
        [503, "access_resolution_unavailable"],
      ] as const) {
        const tracker = { reads: 0 };
        let resolveCalls = 0;
        let createServiceCalls = 0;
        let readFileCalls = 0;

        const response = await handleSendManualAttachmentPost(
          createRequest({
            tracker,
            formDataFactory: () => {
              throw new Error("formData must not be read");
            },
          }),
          {
            resolveStoreAccess: async () => {
              resolveCalls += 1;
              return createDeniedAccess(httpStatus, status);
            },
            createServiceSupabaseClient: () => {
              createServiceCalls += 1;
              throw new Error("service role must not be created");
            },
            isRealWhatsappConversation: async () => false,
            readFileBytes: async () => {
              readFileCalls += 1;
              return Buffer.from("");
            },
          },
        );

        const body = (await response.json()) as Record<string, unknown>;
        assert.equal(response.status, httpStatus);
        assert.equal(body.status, status);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert.equal(tracker.reads, 0);
        assert.equal(resolveCalls, 1);
        assert.equal(createServiceCalls, 0);
        assert.equal(readFileCalls, 0);
      }
    },
  },
  {
    name: "invalid form data returns 400",
    run: async () => {
      const response = await handleSendManualAttachmentPost(
        {
          formData: async () => {
            throw new Error("bad multipart");
          },
        } as unknown as Request,
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => {
            throw new Error("must not create service role");
          },
          isRealWhatsappConversation: async () => false,
          readFileBytes: async () => Buffer.from(""),
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 400);
      assert.equal(body.error, "INVALID_FORM_DATA");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "missing file, invalid mime and excessive size are rejected",
    run: async () => {
      const cases = [
        {
          formData: createFormData({
            conversationId: "conversation-1",
          }),
          expectedStatus: 400,
          expectedError: "FILE_REQUIRED",
        },
        {
          formData: createFormData({
            conversationId: "conversation-1",
            file: createFile("bad.exe", "application/x-msdownload", "bad"),
          }),
          expectedStatus: 415,
          expectedError: "UNSUPPORTED_FILE_TYPE",
        },
        {
          formData: createFormData({
            conversationId: "conversation-1",
            file: new File([new Uint8Array(MAX_FILE_SIZE_BYTES + 1)], "large.pdf", {
              type: "application/pdf",
            }),
          }),
          expectedStatus: 400,
          expectedError: "FILE_TOO_LARGE",
        },
      ];

      for (const testCase of cases) {
        let createServiceCalls = 0;

        const response = await handleSendManualAttachmentPost(
          createRequest({
            tracker: { reads: 0 },
            formDataFactory: () => testCase.formData,
          }),
          {
            resolveStoreAccess: async () => createGrantedAccess(),
            createServiceSupabaseClient: () => {
              createServiceCalls += 1;
              throw new Error("must not create service role");
            },
            isRealWhatsappConversation: async () => false,
            readFileBytes: async () => Buffer.from(""),
          },
        );

        const body = (await response.json()) as Record<string, unknown>;
        assert.equal(response.status, testCase.expectedStatus);
        assert.equal(body.error, testCase.expectedError);
        assert.equal(createServiceCalls, 0);
      }
    },
  },
  {
    name: "organizationId and storeId from form data are ignored",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversation: {
          id: "conversation-1",
          organization_id: "access-org",
          store_id: "access-store",
          lead_id: "lead-1",
        },
        lead: {
          id: "lead-1",
          organization_id: "access-org",
          store_id: "access-store",
        },
      });
      const readEvents: string[] = [];

      const response = await handleSendManualAttachmentPost(
        createRequest({
          tracker: { reads: 0 },
          formDataFactory: () =>
            createFormData({
              organizationId: "browser-org",
              storeId: "browser-store",
              conversationId: "conversation-1",
              content: "hello",
              file: createFile("photo.jpg", "image/jpeg", "img"),
            }),
        }),
        {
          resolveStoreAccess: async () =>
            createGrantedAccess({
              organizationId: "access-org",
              storeId: "access-store",
              sessionUserId: "user-1",
            }),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => false,
          readFileBytes: async () => {
            readEvents.push("read_file");
            return Buffer.from("img");
          },
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.deepEqual(serviceSupabase.queries[0]?.filters, {
        id: "conversation-1",
        organization_id: "access-org",
        store_id: "access-store",
      });
      assert.deepEqual(serviceSupabase.queries[1]?.filters, {
        id: "lead-1",
        organization_id: "access-org",
        store_id: "access-store",
      });
      assert.equal(serviceSupabase.uploads[0]?.path.startsWith("access-org/access-store/manual-attachments/conversation-1/"), true);
      assert.equal(serviceSupabase.uploads[0]?.path.includes("browser-org"), false);
      assert.equal(serviceSupabase.uploads[0]?.path.includes("browser-store"), false);
      assert.deepEqual(readEvents, ["read_file"]);
    },
  },
  {
    name: "conversation from another organization or store is rejected by canonical scope query",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversation: null,
      });

      const response = await handleSendManualAttachmentPost(
        createRequest({
          tracker: { reads: 0 },
          formDataFactory: () =>
            createFormData({
              conversationId: "conversation-1",
              file: createFile("photo.jpg", "image/jpeg", "img"),
            }),
        }),
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => false,
          readFileBytes: async () => Buffer.from("img"),
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 404);
      assert.equal(body.error, "CONVERSATION_NOT_FOUND_OR_FORBIDDEN");
      assert.deepEqual(serviceSupabase.queries[0]?.filters, {
        id: "conversation-1",
        organization_id: "access-org",
        store_id: "access-store",
      });
      assert.equal(serviceSupabase.uploads.length, 0);
      assert.equal(serviceSupabase.rpcCalls.length, 0);
    },
  },
  {
    name: "lead is derived from validated conversation and out-of-scope lead is rejected",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversation: {
          id: "conversation-1",
          organization_id: "access-org",
          store_id: "access-store",
          lead_id: "lead-1",
        },
        lead: null,
      });
      let readFileCalls = 0;

      const response = await handleSendManualAttachmentPost(
        createRequest({
          tracker: { reads: 0 },
          formDataFactory: () =>
            createFormData({
              conversationId: "conversation-1",
              file: createFile("photo.jpg", "image/jpeg", "img"),
            }),
        }),
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => false,
          readFileBytes: async () => {
            readFileCalls += 1;
            return Buffer.from("img");
          },
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 404);
      assert.equal(body.error, "LEAD_NOT_FOUND_OR_FORBIDDEN");
      assert.deepEqual(serviceSupabase.queries[1]?.filters, {
        id: "lead-1",
        organization_id: "access-org",
        store_id: "access-store",
      });
      assert.equal(readFileCalls, 0);
    },
  },
  {
    name: "file is read only after conversation and lead validation",
    run: async () => {
      const events: string[] = [];
      const serviceSupabase = createServiceSupabaseMock({
        conversation: {
          id: "conversation-1",
          organization_id: "access-org",
          store_id: "access-store",
          lead_id: "lead-1",
        },
        lead: {
          id: "lead-1",
          organization_id: "access-org",
          store_id: "access-store",
        },
        events,
      });

      const response = await handleSendManualAttachmentPost(
        createRequest({
          tracker: { reads: 0 },
          formDataFactory: () =>
            createFormData({
              conversationId: "conversation-1",
              file: createFile("photo.jpg", "image/jpeg", "img"),
            }),
        }),
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => false,
          readFileBytes: async () => {
            events.push("read_file");
            return Buffer.from("img");
          },
        },
      );

      assert.equal(response.status, 200);
      assert.deepEqual(events.slice(0, 3), [
        "conversation_query",
        "lead_query",
        "read_file",
      ]);
    },
  },
  {
    name: "image whatsapp preserves send_external true",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversation: {
          id: "conversation-1",
          organization_id: "access-org",
          store_id: "access-store",
          lead_id: "lead-1",
        },
        lead: {
          id: "lead-1",
          organization_id: "access-org",
          store_id: "access-store",
        },
      });

      const response = await handleSendManualAttachmentPost(
        createRequest({
          tracker: { reads: 0 },
          formDataFactory: () =>
            createFormData({
              conversationId: "conversation-1",
              file: createFile("photo.jpg", "image/jpeg", "img"),
            }),
        }),
        {
          resolveStoreAccess: async () =>
            createGrantedAccess({ sessionUserId: "user-1" }),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => true,
          readFileBytes: async () => Buffer.from("img"),
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 200);
      assert.equal(body.messageType, "image");
      assert.equal(body.attachmentKind, "image");
      assert.equal(serviceSupabase.rpcCalls[0]?.params.p_media_url, serviceSupabase.uploads[0]?.path);
      assert.equal(
        (serviceSupabase.rpcCalls[0]?.params.p_metadata as Record<string, unknown>).send_external,
        true,
      );
    },
  },
  {
    name: "audio video and document remain internal",
    run: async () => {
      const cases = [
        ["clip.mp3", "audio/mpeg", "audio", "audio"],
        ["clip.mp4", "video/mp4", "video", "video"],
        ["doc.pdf", "application/pdf", "text", "file"],
      ] as const;

      for (const [name, type, expectedMessageType, expectedAttachmentKind] of cases) {
        const serviceSupabase = createServiceSupabaseMock({
          conversation: {
            id: "conversation-1",
            organization_id: "access-org",
            store_id: "access-store",
            lead_id: "lead-1",
          },
          lead: {
            id: "lead-1",
            organization_id: "access-org",
            store_id: "access-store",
          },
        });

        const response = await handleSendManualAttachmentPost(
          createRequest({
            tracker: { reads: 0 },
            formDataFactory: () =>
              createFormData({
                conversationId: "conversation-1",
                file: createFile(name, type, "blob"),
              }),
          }),
          {
            resolveStoreAccess: async () =>
              createGrantedAccess({ sessionUserId: "user-1" }),
            createServiceSupabaseClient: () => serviceSupabase as never,
            isRealWhatsappConversation: async () => true,
            readFileBytes: async () => Buffer.from("blob"),
          },
        );

        const body = (await response.json()) as Record<string, unknown>;
        const metadata = serviceSupabase.rpcCalls[0]?.params.p_metadata as Record<string, unknown>;
        assert.equal(response.status, 200);
        assert.equal(body.messageType, expectedMessageType);
        assert.equal(body.attachmentKind, expectedAttachmentKind);
        assert.equal(metadata.send_external, false);
      }
    },
  },
  {
    name: "upload error does not call insert_message",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversation: {
          id: "conversation-1",
          organization_id: "access-org",
          store_id: "access-store",
          lead_id: "lead-1",
        },
        lead: {
          id: "lead-1",
          organization_id: "access-org",
          store_id: "access-store",
        },
        uploadError: { message: "upload failed" },
      });

      const response = await handleSendManualAttachmentPost(
        createRequest({
          tracker: { reads: 0 },
          formDataFactory: () =>
            createFormData({
              conversationId: "conversation-1",
              file: createFile("photo.jpg", "image/jpeg", "img"),
            }),
        }),
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => false,
          readFileBytes: async () => Buffer.from("img"),
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 500);
      assert.equal(body.error, "MEDIA_UPLOAD_FAILED");
      assert.equal(serviceSupabase.rpcCalls.length, 0);
      assert.equal(serviceSupabase.removals.length, 0);
    },
  },
  {
    name: "insert_message error executes exact cleanup",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversation: {
          id: "conversation-1",
          organization_id: "access-org",
          store_id: "access-store",
          lead_id: "lead-1",
        },
        lead: {
          id: "lead-1",
          organization_id: "access-org",
          store_id: "access-store",
        },
        insertResult: {
          data: null,
          error: { message: "insert failed" },
        },
      });

      const response = await handleSendManualAttachmentPost(
        createRequest({
          tracker: { reads: 0 },
          formDataFactory: () =>
            createFormData({
              conversationId: "conversation-1",
              file: createFile("photo.jpg", "image/jpeg", "img"),
            }),
        }),
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => false,
          readFileBytes: async () => Buffer.from("img"),
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 500);
      assert.equal(body.error, "INSERT_MANUAL_ATTACHMENT_FAILED");
      assert.deepEqual(serviceSupabase.removals[0], {
        bucket: "zion-store-files",
        paths: [serviceSupabase.uploads[0]?.path],
      });
    },
  },
  {
    name: "throw during insert_message also executes cleanup",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversation: {
          id: "conversation-1",
          organization_id: "access-org",
          store_id: "access-store",
          lead_id: "lead-1",
        },
        lead: {
          id: "lead-1",
          organization_id: "access-org",
          store_id: "access-store",
        },
        insertThrows: true,
      });

      const response = await handleSendManualAttachmentPost(
        createRequest({
          tracker: { reads: 0 },
          formDataFactory: () =>
            createFormData({
              conversationId: "conversation-1",
              file: createFile("photo.jpg", "image/jpeg", "img"),
            }),
        }),
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => false,
          readFileBytes: async () => Buffer.from("img"),
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 500);
      assert.equal(body.error, "INSERT_MANUAL_ATTACHMENT_FAILED");
      assert.equal(serviceSupabase.removals.length, 1);
    },
  },
  {
    name: "cleanup failure does not leak or replace the primary error",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversation: {
          id: "conversation-1",
          organization_id: "access-org",
          store_id: "access-store",
          lead_id: "lead-1",
        },
        lead: {
          id: "lead-1",
          organization_id: "access-org",
          store_id: "access-store",
        },
        insertResult: {
          data: null,
          error: { message: "insert failed" },
        },
        removeThrows: true,
      });
      const originalConsoleError = console.error;
      const consoleCalls: unknown[] = [];
      console.error = (...args: unknown[]) => {
        consoleCalls.push(args);
      };

      try {
        const response = await handleSendManualAttachmentPost(
          createRequest({
            tracker: { reads: 0 },
            formDataFactory: () =>
              createFormData({
                conversationId: "conversation-1",
                file: createFile("photo.jpg", "image/jpeg", "img"),
              }),
          }),
          {
            resolveStoreAccess: async () => createGrantedAccess(),
            createServiceSupabaseClient: () => serviceSupabase as never,
            isRealWhatsappConversation: async () => false,
            readFileBytes: async () => Buffer.from("img"),
          },
        );

        const body = (await response.json()) as Record<string, unknown>;
        assert.equal(response.status, 500);
        assert.equal(body.error, "INSERT_MANUAL_ATTACHMENT_FAILED");
        assert.equal(String(body.message).includes("cleanup"), false);
        assert.equal(consoleCalls.length > 0, true);
      } finally {
        console.error = originalConsoleError;
      }
    },
  },
  {
    name: "confirmed persistence never removes the uploaded file even without messageId",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversation: {
          id: "conversation-1",
          organization_id: "access-org",
          store_id: "access-store",
          lead_id: "lead-1",
        },
        lead: {
          id: "lead-1",
          organization_id: "access-org",
          store_id: "access-store",
        },
        insertResult: {
          data: {},
          error: null,
        },
      });

      const response = await handleSendManualAttachmentPost(
        createRequest({
          tracker: { reads: 0 },
          formDataFactory: () =>
            createFormData({
              conversationId: "conversation-1",
              file: createFile("photo.jpg", "image/jpeg", "img"),
            }),
        }),
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => false,
          readFileBytes: async () => Buffer.from("img"),
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.messageId, null);
      assert.equal(serviceSupabase.removals.length, 0);
    },
  },
  {
    name: "success preserves ok messageId messageType and attachmentKind",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversation: {
          id: "conversation-1",
          organization_id: "access-org",
          store_id: "access-store",
          lead_id: "lead-1",
        },
        lead: {
          id: "lead-1",
          organization_id: "access-org",
          store_id: "access-store",
        },
        insertResult: {
          data: { id: "message-1" },
          error: null,
        },
      });

      const response = await handleSendManualAttachmentPost(
        createRequest({
          tracker: { reads: 0 },
          formDataFactory: () =>
            createFormData({
              conversationId: "conversation-1",
              file: createFile("photo.jpg", "image/jpeg", "img"),
            }),
        }),
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => false,
          readFileBytes: async () => Buffer.from("img"),
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.deepEqual(body, {
        ok: true,
        messageId: "message-1",
        messageType: "image",
        attachmentKind: "image",
      });
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "technical failures are sanitized",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversationError: { message: "select * from conversations" },
      });

      const response = await handleSendManualAttachmentPost(
        createRequest({
          tracker: { reads: 0 },
          formDataFactory: () =>
            createFormData({
              conversationId: "conversation-1",
              file: createFile("photo.jpg", "image/jpeg", "img"),
            }),
        }),
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => false,
          readFileBytes: async () => Buffer.from("img"),
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 500);
      assert.equal(body.error, "CONVERSATION_LOOKUP_FAILED");
      assert.equal(body.message, "Nao foi possivel validar a conversa informada.");
      assert.equal(String(body.message).includes("select *"), false);
    },
  },
  {
    name: "route source uses canonical store gate and removes legacy auth",
    run: () => {
      const source = readFileSync(join(__dirname, "route.ts"), "utf8");

      assert.equal(source.includes("resolveStoreApiAccess"), true);
      assert.equal(source.includes("createStoreApiDeniedResponse"), true);
      assert.equal(source.includes('requirement: "active"'), true);
      assert.equal(source.includes("createSupabaseServerClient"), false);
      assert.equal(source.includes("auth.getUser"), false);
      assert.equal(source.includes("getSession"), false);
      assert.equal(source.includes('formData.get("organizationId")'), false);
      assert.equal(source.includes('formData.get("storeId")'), false);
      assert.equal(source.includes("requestedStoreId"), false);
      assert.equal(source.includes("error.message"), false);
      assert.equal(source.includes("details"), false);
      assert.equal(source.includes("stack"), false);
      assert.equal(source.includes("cause"), false);
      assert.match(
        source,
        /serviceSupabase\.storage[\s\S]*?\.from\(STORAGE_BUCKET\)[\s\S]*?\.upload\(/,
      );

      const gateIndex = source.indexOf("const access = await deps.resolveStoreAccess");
      const deniedIndex = source.indexOf("return createStoreApiDeniedResponse(access)");
      const formDataIndex = source.indexOf("formData = await request.formData()");
      const serviceRoleIndex = source.indexOf("serviceSupabase = deps.createServiceSupabaseClient()");
      const conversationQueryIndex = source.indexOf("const conversationResult = await loadScopedConversation");
      const fileReadIndex = source.indexOf("const fileBytes = await deps.readFileBytes");
      const uploadIndex = source.indexOf("const uploadResult = await serviceSupabase.storage");

      assert.notEqual(gateIndex, -1);
      assert.notEqual(deniedIndex, -1);
      assert.notEqual(formDataIndex, -1);
      assert.notEqual(serviceRoleIndex, -1);
      assert.notEqual(conversationQueryIndex, -1);
      assert.notEqual(fileReadIndex, -1);
      assert.notEqual(uploadIndex, -1);
      assert.equal(gateIndex < deniedIndex, true);
      assert.equal(deniedIndex < formDataIndex, true);
      assert.equal(formDataIndex < serviceRoleIndex, true);
      assert.equal(serviceRoleIndex < conversationQueryIndex, true);
      assert.equal(conversationQueryIndex < fileReadIndex, true);
      assert.equal(fileReadIndex < uploadIndex, true);
    },
  },
];

async function run() {
  const failures: string[] = [];

  for (const test of tests) {
    try {
      await test.run();
    } catch (error) {
      failures.push(
        `${test.name}: ${error instanceof Error ? error.stack || error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n\n"));
  }
}

void run();

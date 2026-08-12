import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSimulateCustomerMediaPostHandler } from "./handler";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
  StoreApiAccessResult,
} from "../../../lib/server/store-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type QueryCall = {
  table: string;
  mode: "select" | "update";
  columns: string | null;
  eqs: Array<{ field: string; value: unknown }>;
  updateValues?: Record<string, unknown>;
};

type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

type UploadCall = {
  bucket: string;
  path: string;
  buffer: Buffer;
  options: Record<string, unknown>;
};

type RemoveCall = {
  bucket: string;
  paths: string[];
};

type MediaClassificationResult = {
  mediaPurpose:
    | "customer_location_photo"
    | "customer_product_or_pool_photo"
    | "payment_proof"
    | "conversation_or_document_screenshot"
    | "catalog_file"
    | "unknown_image"
    | "customer_audio"
    | "customer_video";
  confidence: "high" | "medium" | "low";
  reason: string;
  requiresAiAnalysis: boolean;
  requiresHumanReview: boolean;
};

type CustomerLocationPhotoAnalysisResult =
  | {
      ok: true;
      analysis: {
        summary: string;
        space_size_signal: "small" | "medium" | "large" | "uncertain";
        environment_type: "outdoor" | "indoor" | "mixed" | "uncertain";
        access_constraints: string[];
        ground_context: string[];
        confidence: "low" | "medium" | "high";
        needs_measurements_confirmation: boolean;
        safe_commercial_hints: string[];
      };
      provider: "openai";
      model: string;
    }
  | {
      ok: false;
      error: string;
      message: string;
      provider: "openai";
      model: string;
    };

type AudioTranscriptionResult =
  | {
      ok: true;
      transcript: string;
      provider: "openai";
      model: string;
    }
  | {
      ok: false;
      error: string;
      message: string;
      provider: "openai";
      model: string;
    };

type AiFlowResult =
  | {
      ok: true;
      aiText: string;
      persisted: true;
      messageId: string | null;
    }
  | {
      ok: false;
      error: string;
      message: string;
    };

type FakeSupabaseOptions = {
  conversationResult?: { data: unknown; error: { message: string } | null };
  leadResult?: { data: unknown; error: { message: string } | null };
  persistedMessageResult?: { data: unknown; error: { message: string } | null };
  uploadError?: { message: string } | null;
  insertData?: unknown;
  insertError?: { message: string } | null;
  updateError?: { message: string } | null;
  throwOnFromTable?: string | null;
  throwOnUpload?: boolean;
  throwOnRemove?: boolean;
  throwOnRpc?: boolean;
  throwOnPersistedMessageLookup?: boolean;
  throwOnUpdate?: boolean;
};

type FakeRequestOptions = {
  onFormData?: () => void;
  formDataThrows?: boolean;
};

type MediaFileFixture = {
  name: string;
  size: number;
  type: string;
  payload: Buffer;
  reads: number;
  throwOnRead?: boolean;
};

type CreateHarnessOptions = {
  accessResult?: StoreApiAccessResult;
  fakeSupabaseOptions?: FakeSupabaseOptions;
  fileOverrides?: Partial<MediaFileFixture>;
  classifyResult?: MediaClassificationResult;
  classifyThrows?: boolean;
  analyzeResult?: CustomerLocationPhotoAnalysisResult;
  analyzeThrows?: boolean;
  transcriptionResult?: AudioTranscriptionResult;
  transcriptionThrows?: boolean;
  aiResult?: AiFlowResult;
  aiThrows?: boolean;
};

type PurposeMimeCase = {
  label: string;
  purpose?: string;
  fileName: string;
  mimeType: string;
  expectedMessageType: "image" | "audio" | "video" | "file";
  expectedExplicitPurpose: string;
  classifyResult: MediaClassificationResult;
  expectedRequestedPurpose: string;
  expectAnalyze: boolean;
  expectTranscribe: boolean;
  expectAi: boolean;
};

function createGrantedAccess(): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as never,
    resolution: {
      domain: "store_area",
      status: "store_ready_active",
      sessionUserId: "user-1",
      safeHtmlDestination: "/crm",
      apiDecision: "allow",
      organizationResolution: "single",
      storeResolution: "single",
      organizationId: "server-org",
      storeId: "server-store",
      commercialAccess: "allowed",
      reasonCode: "ready_active",
      message: "Conta pronta.",
    },
    sessionUserId: "user-1",
    organizationId: "server-org",
    storeId: "server-store",
  };
}

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
      safeHtmlDestination:
        httpStatus === 503 ? "/account/access-unavailable" : "/account/access-blocked",
      apiDecision:
        httpStatus === 401
          ? "deny_401"
          : httpStatus === 403
            ? "deny_403"
            : httpStatus === 503
              ? "deny_503"
              : "deny_409",
      organizationResolution: "none",
      storeResolution: "none",
      organizationId: null,
      storeId: null,
      commercialAccess: "unknown",
      reasonCode: "missing_membership",
      message: "Acesso negado.",
    },
    httpStatus,
    payload: {
      ok: false,
      error:
        httpStatus === 401
          ? "STORE_API_UNAUTHENTICATED"
          : httpStatus === 403
            ? "STORE_API_FORBIDDEN"
            : httpStatus === 503
              ? "STORE_API_ACCESS_UNAVAILABLE"
              : "STORE_API_ACCESS_DENIED",
      message: `public-${httpStatus}`,
      status,
      reasonCode: "missing_membership",
    },
  };
}

function createFakeFile(overrides?: Partial<MediaFileFixture>) {
  const fixture: MediaFileFixture = {
    name: "cliente-foto.png",
    size: 1024,
    type: "image/png",
    payload: Buffer.from("image-buffer"),
    reads: 0,
    ...overrides,
  };

  return {
    file: {
      name: fixture.name,
      size: fixture.size,
      type: fixture.type,
      async arrayBuffer() {
        fixture.reads += 1;
        if (fixture.throwOnRead) {
          throw new Error("FILE_ARRAY_BUFFER_SENTINEL");
        }
        return fixture.payload.buffer.slice(
          fixture.payload.byteOffset,
          fixture.payload.byteOffset + fixture.payload.byteLength,
        );
      },
    },
    fixture,
  };
}

function createFakeRequest(
  values: Record<string, unknown>,
  options?: FakeRequestOptions,
): Request {
  return {
    async formData() {
      options?.onFormData?.();
      if (options?.formDataThrows) {
        throw new Error("FORMDATA_THROW_SENTINEL");
      }

      return {
        get(name: string) {
          return (values[name] as FormDataEntryValue | null | undefined) ?? null;
        },
      } as FormData;
    },
  } as Request;
}

function createFakeSupabase(options: FakeSupabaseOptions | undefined, events: string[]) {
  const queryCalls: QueryCall[] = [];
  const rpcCalls: RpcCall[] = [];
  const uploadCalls: UploadCall[] = [];
  const removeCalls: RemoveCall[] = [];

  const client = {
    storage: {
      from(bucket: string) {
        return {
          async upload(
            path: string,
            buffer: Buffer,
            uploadOptions: Record<string, unknown>,
          ) {
            events.push("upload");
            uploadCalls.push({
              bucket,
              path,
              buffer,
              options: uploadOptions,
            });

            if (options?.throwOnUpload) {
              throw new Error("UPLOAD_THROW_SENTINEL");
            }

            return {
              error: options?.uploadError ?? null,
            };
          },
          async remove(paths: string[]) {
            events.push("cleanup:remove");
            removeCalls.push({
              bucket,
              paths,
            });

            if (options?.throwOnRemove) {
              throw new Error("REMOVE_THROW_SENTINEL");
            }

            return {
              error: null,
            };
          },
        };
      },
    },
    from(table: string) {
      if (options?.throwOnFromTable === table) {
        throw new Error(`${table.toUpperCase()}_THROW_SENTINEL`);
      }

      const selectCall: QueryCall = {
        table,
        mode: "select",
        columns: null,
        eqs: [],
      };

      const updateCall: QueryCall = {
        table,
        mode: "update",
        columns: null,
        eqs: [],
      };

      const selectBuilder = {
        select(columns: string) {
          selectCall.columns = columns;
          return selectBuilder;
        },
        eq(field: string, value: unknown) {
          selectCall.eqs.push({ field, value });
          return selectBuilder;
        },
        async maybeSingle<T>() {
          queryCalls.push({ ...selectCall, eqs: [...selectCall.eqs] });

          if (table === "conversations") {
            events.push("conversation:query");
          } else if (table === "leads") {
            events.push("lead:query");
          } else if (table === "messages") {
            events.push("metadata:load");
          }

          if (options?.throwOnPersistedMessageLookup && table === "messages") {
            throw new Error("PERSISTED_MESSAGE_LOOKUP_SENTINEL");
          }

          if (table === "conversations") {
            return (options?.conversationResult ?? {
              data: {
                id: "conv-1",
                organization_id: "server-org",
                store_id: "server-store",
                lead_id: "lead-1",
              },
              error: null,
            }) as { data: T | null; error: { message: string } | null };
          }

          if (table === "leads") {
            return (options?.leadResult ?? {
              data: {
                id: "lead-1",
                organization_id: "server-org",
                store_id: "server-store",
              },
              error: null,
            }) as { data: T | null; error: { message: string } | null };
          }

          return (options?.persistedMessageResult ?? {
            data: {
              id: "message-1",
              metadata: {
                previous: true,
              },
            },
            error: null,
          }) as { data: T | null; error: { message: string } | null };
        },
      };

      const updateBuilder = {
        update(values: Record<string, unknown>) {
          updateCall.updateValues = values;
          return updateBuilder;
        },
        eq(field: string, value: unknown) {
          updateCall.eqs.push({ field, value });
          return updateBuilder;
        },
      };

      return {
        select: selectBuilder.select,
        update(values: Record<string, unknown>) {
          updateCall.updateValues = values;
          return {
            eq(field: string, value: unknown) {
              updateCall.eqs.push({ field, value });
              return {
                async eq(innerField: string, innerValue: unknown) {
                  updateCall.eqs.push({ field: innerField, value: innerValue });
                  events.push("metadata:update");
                  queryCalls.push({
                    ...updateCall,
                    eqs: [...updateCall.eqs],
                    updateValues: updateCall.updateValues
                      ? { ...updateCall.updateValues }
                      : undefined,
                  });

                  if (options?.throwOnUpdate) {
                    throw new Error("MESSAGE_UPDATE_SENTINEL");
                  }

                  return {
                    error: options?.updateError ?? null,
                  };
                },
              };
            },
          };
        },
      };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      events.push("insert_message");
      rpcCalls.push({ fn, args });

      if (options?.throwOnRpc) {
        throw new Error("RPC_THROW_SENTINEL");
      }

      return {
        data: options?.insertData ?? [{ id: "message-1" }],
        error: options?.insertError ?? null,
      };
    },
  };

  return {
    client,
    queryCalls,
    rpcCalls,
    uploadCalls,
    removeCalls,
  };
}

function createHandlerHarness(options?: CreateHarnessOptions) {
  const events: string[] = [];
  const fakeSupabase = createFakeSupabase(options?.fakeSupabaseOptions, events);
  const { file, fixture } = createFakeFile(options?.fileOverrides);
  let resolveCalls = 0;
  let createClientCalls = 0;
  let deniedCalls = 0;
  let classifyCalls = 0;
  let analyzeCalls = 0;
  let transcriptionCalls = 0;
  let aiCalls = 0;
  let readFileCalls = 0;
  const classificationInputs: Array<Record<string, unknown>> = [];

  const handler = createSimulateCustomerMediaPostHandler({
    async resolveAccess() {
      events.push("resolve:start");
      resolveCalls += 1;
      const result = options?.accessResult ?? createGrantedAccess();
      events.push(result.ok ? "resolve:granted" : `resolve:denied:${result.httpStatus}`);
      return result;
    },
    createDeniedResponse(access) {
      deniedCalls += 1;
      return Response.json(access.payload, {
        status: access.httpStatus,
        headers: {
          "Cache-Control": "no-store",
        },
      }) as never;
    },
    createPrivilegedClient() {
      events.push("client:create");
      createClientCalls += 1;
      return fakeSupabase.client as never;
    },
    async readFileBuffer(inputFile) {
      events.push("file:read");
      readFileCalls += 1;
      const arrayBuffer = await inputFile.arrayBuffer();
      return Buffer.from(arrayBuffer);
    },
    async uploadMedia(args) {
      return fakeSupabase.client.storage.from(args.bucket).upload(
        args.storagePath,
        args.fileBuffer,
        {
          upsert: false,
          contentType: args.mimeType,
        },
      );
    },
    classifyCustomerMedia(input) {
      events.push("classify");
      classifyCalls += 1;
      classificationInputs.push({ ...input });
      if (options?.classifyThrows) {
        throw new Error("CLASSIFY_THROW_SENTINEL");
      }
      return (
        options?.classifyResult ?? {
          mediaPurpose: "customer_location_photo",
          confidence: "high",
          reason: "explicit",
          requiresAiAnalysis: false,
          requiresHumanReview: false,
        }
      );
    },
    async analyzeCustomerLocationPhoto() {
      events.push("analyze");
      analyzeCalls += 1;
      if (options?.analyzeThrows) {
        throw new Error("ANALYZE_THROW_SENTINEL");
      }
      return (
        options?.analyzeResult ?? {
          ok: true,
          analysis: {
            summary: "Resumo seguro",
            space_size_signal: "medium",
            environment_type: "outdoor",
            access_constraints: [],
            ground_context: [],
            confidence: "medium",
            needs_measurements_confirmation: true,
            safe_commercial_hints: [],
          },
          provider: "openai",
          model: "gpt-4.1-mini",
        }
      );
    },
    async transcribeCustomerAudio() {
      events.push("transcribe");
      transcriptionCalls += 1;
      if (options?.transcriptionThrows) {
        throw new Error("TRANSCRIBE_THROW_SENTINEL");
      }
      return (
        options?.transcriptionResult ?? {
          ok: true,
          transcript: "transcricao segura",
          provider: "openai",
          model: "whisper-1",
        }
      );
    },
    async runAiFlow() {
      events.push("ai:start");
      aiCalls += 1;
      if (options?.aiThrows) {
        throw new Error("AI_THROW_SENTINEL");
      }
      return (
        options?.aiResult ?? {
          ok: true,
          aiText: "Resposta da IA",
          persisted: true,
          messageId: "ai-message-1",
        }
      );
    },
    now: () => new Date("2026-07-27T12:00:00.000Z"),
    createRandomSuffix: () => "random1",
  });

  function makeRequest(
    overrides?: Partial<{
      conversationId: string;
      purpose: string;
      file: unknown;
      organizationId: string;
      storeId: string;
      leadId: string;
    }>,
    requestOptions?: Omit<FakeRequestOptions, "onFormData">,
  ) {
    return createFakeRequest(
      {
        organizationId: "body-org",
        storeId: "body-store",
        leadId: "body-lead",
        conversationId: "conv-1",
        purpose: "customer_location_photo",
        file,
        ...(overrides ?? {}),
      },
      {
        ...requestOptions,
        onFormData: () => {
          events.push("formData");
        },
      },
    );
  }

  return {
    handler,
    file,
    fixture,
    events,
    fakeSupabase,
    classificationInputs,
    makeRequest,
    getResolveCalls: () => resolveCalls,
    getCreateClientCalls: () => createClientCalls,
    getDeniedCalls: () => deniedCalls,
    getClassifyCalls: () => classifyCalls,
    getAnalyzeCalls: () => analyzeCalls,
    getTranscriptionCalls: () => transcriptionCalls,
    getAiCalls: () => aiCalls,
    getReadFileCalls: () => readFileCalls,
  };
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function assertNoSentinel(body: Record<string, unknown>, label: string) {
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes("SENTINEL"), false, label);
  assert.equal(serialized.includes("SUPABASE_ENV_MISSING"), false, label);
}

function expectEventSequence(events: string[], expected: string[]) {
  let lastIndex = -1;

  for (const event of expected) {
    const nextIndex = events.indexOf(event, lastIndex + 1);
    assert.notEqual(nextIndex, -1, `missing event ${event}: ${events.join(" -> ")}`);
    assert.ok(nextIndex > lastIndex, `out of order event ${event}: ${events.join(" -> ")}`);
    lastIndex = nextIndex;
  }
}

const purposeMimeCases: PurposeMimeCase[] = [
  {
    label: "customer_location_photo + image",
    purpose: "customer_location_photo",
    fileName: "local.png",
    mimeType: "image/png",
    expectedMessageType: "image",
    expectedExplicitPurpose: "customer_location_photo",
    classifyResult: {
      mediaPurpose: "customer_location_photo",
      confidence: "high",
      reason: "location-image",
      requiresAiAnalysis: false,
      requiresHumanReview: false,
    },
    expectedRequestedPurpose: "customer_location_photo",
    expectAnalyze: true,
    expectTranscribe: false,
    expectAi: true,
  },
  {
    label: "customer_location_photo + audio",
    purpose: "customer_location_photo",
    fileName: "cliente.webm",
    mimeType: "audio/webm",
    expectedMessageType: "audio",
    expectedExplicitPurpose: "customer_location_photo",
    classifyResult: {
      mediaPurpose: "customer_audio",
      confidence: "high",
      reason: "audio-wins",
      requiresAiAnalysis: true,
      requiresHumanReview: false,
    },
    expectedRequestedPurpose: "customer_location_photo",
    expectAnalyze: false,
    expectTranscribe: true,
    expectAi: true,
  },
  {
    label: "customer_location_photo + video",
    purpose: "customer_location_photo",
    fileName: "cliente.mp4",
    mimeType: "video/mp4",
    expectedMessageType: "video",
    expectedExplicitPurpose: "customer_location_photo",
    classifyResult: {
      mediaPurpose: "customer_video",
      confidence: "high",
      reason: "video-wins",
      requiresAiAnalysis: true,
      requiresHumanReview: false,
    },
    expectedRequestedPurpose: "customer_location_photo",
    expectAnalyze: false,
    expectTranscribe: false,
    expectAi: false,
  },
  {
    label: "customer_location_photo + document",
    purpose: "customer_location_photo",
    fileName: "cliente.pdf",
    mimeType: "application/pdf",
    expectedMessageType: "file",
    expectedExplicitPurpose: "customer_location_photo",
    classifyResult: {
      mediaPurpose: "conversation_or_document_screenshot",
      confidence: "medium",
      reason: "document-wins",
      requiresAiAnalysis: false,
      requiresHumanReview: true,
    },
    expectedRequestedPurpose: "customer_location_photo",
    expectAnalyze: false,
    expectTranscribe: false,
    expectAi: false,
  },
  {
    label: "unknown + image",
    purpose: "unknown",
    fileName: "cliente.png",
    mimeType: "image/png",
    expectedMessageType: "image",
    expectedExplicitPurpose: "unknown",
    classifyResult: {
      mediaPurpose: "unknown_image",
      confidence: "low",
      reason: "unknown-image",
      requiresAiAnalysis: false,
      requiresHumanReview: false,
    },
    expectedRequestedPurpose: "unknown",
    expectAnalyze: false,
    expectTranscribe: false,
    expectAi: false,
  },
  {
    label: "unknown + audio",
    purpose: "unknown",
    fileName: "cliente.webm",
    mimeType: "audio/webm",
    expectedMessageType: "audio",
    expectedExplicitPurpose: "unknown",
    classifyResult: {
      mediaPurpose: "customer_audio",
      confidence: "high",
      reason: "unknown-audio",
      requiresAiAnalysis: true,
      requiresHumanReview: false,
    },
    expectedRequestedPurpose: "unknown",
    expectAnalyze: false,
    expectTranscribe: true,
    expectAi: true,
  },
  {
    label: "unknown + video",
    purpose: "unknown",
    fileName: "cliente.mp4",
    mimeType: "video/mp4",
    expectedMessageType: "video",
    expectedExplicitPurpose: "unknown",
    classifyResult: {
      mediaPurpose: "customer_video",
      confidence: "high",
      reason: "unknown-video",
      requiresAiAnalysis: true,
      requiresHumanReview: false,
    },
    expectedRequestedPurpose: "unknown",
    expectAnalyze: false,
    expectTranscribe: false,
    expectAi: false,
  },
  {
    label: "unknown + document",
    purpose: "unknown",
    fileName: "cliente.pdf",
    mimeType: "application/pdf",
    expectedMessageType: "file",
    expectedExplicitPurpose: "unknown",
    classifyResult: {
      mediaPurpose: "conversation_or_document_screenshot",
      confidence: "medium",
      reason: "unknown-document",
      requiresAiAnalysis: false,
      requiresHumanReview: true,
    },
    expectedRequestedPurpose: "unknown",
    expectAnalyze: false,
    expectTranscribe: false,
    expectAi: false,
  },
  {
    label: "customer_product_or_pool_photo + image",
    purpose: "customer_product_or_pool_photo",
    fileName: "produto.jpg",
    mimeType: "image/jpeg",
    expectedMessageType: "image",
    expectedExplicitPurpose: "customer_product_photo",
    classifyResult: {
      mediaPurpose: "customer_product_or_pool_photo",
      confidence: "high",
      reason: "product-photo",
      requiresAiAnalysis: false,
      requiresHumanReview: false,
    },
    expectedRequestedPurpose: "customer_product_or_pool_photo",
    expectAnalyze: false,
    expectTranscribe: false,
    expectAi: false,
  },
  {
    label: "payment_proof + document",
    purpose: "payment_proof",
    fileName: "comprovante.pdf",
    mimeType: "application/pdf",
    expectedMessageType: "file",
    expectedExplicitPurpose: "payment_receipt",
    classifyResult: {
      mediaPurpose: "payment_proof",
      confidence: "high",
      reason: "payment-document",
      requiresAiAnalysis: false,
      requiresHumanReview: true,
    },
    expectedRequestedPurpose: "payment_proof",
    expectAnalyze: false,
    expectTranscribe: false,
    expectAi: false,
  },
  {
    label: "conversation_or_document_screenshot + document",
    purpose: "conversation_or_document_screenshot",
    fileName: "print.pdf",
    mimeType: "application/pdf",
    expectedMessageType: "file",
    expectedExplicitPurpose: "screenshot",
    classifyResult: {
      mediaPurpose: "conversation_or_document_screenshot",
      confidence: "high",
      reason: "screenshot-document",
      requiresAiAnalysis: false,
      requiresHumanReview: true,
    },
    expectedRequestedPurpose: "conversation_or_document_screenshot",
    expectAnalyze: false,
    expectTranscribe: false,
    expectAi: false,
  },
  {
    label: "purpose absent defaults to customer_location_photo",
    purpose: undefined,
    fileName: "default.png",
    mimeType: "image/png",
    expectedMessageType: "image",
    expectedExplicitPurpose: "customer_location_photo",
    classifyResult: {
      mediaPurpose: "customer_location_photo",
      confidence: "high",
      reason: "default-purpose",
      requiresAiAnalysis: false,
      requiresHumanReview: false,
    },
    expectedRequestedPurpose: "customer_location_photo",
    expectAnalyze: true,
    expectTranscribe: false,
    expectAi: true,
  },
];

async function expectDeniedStatus(
  denied: StoreApiAccessDenied,
  expectedStatus: 401 | 403 | 409 | 503,
) {
  const harness = createHandlerHarness({
    accessResult: denied,
  });
  const response = await harness.handler(harness.makeRequest());
  const body = await parseBody(response);

  assert.equal(response.status, expectedStatus);
  assert.equal(body.ok, false);
  assert.equal(harness.events.includes("formData"), false);
  assert.equal(harness.getCreateClientCalls(), 0);
  assert.equal(harness.fixture.reads, 0);
  assert.equal(harness.fakeSupabase.uploadCalls.length, 0);
  assert.equal(harness.fakeSupabase.rpcCalls.length, 0);
}

const tests: TestCase[] = [
  {
    name: "401 is preserved",
    run: async () => {
      await expectDeniedStatus(createDeniedAccess(401, "anonymous"), 401);
    },
  },
  {
    name: "403 is preserved",
    run: async () => {
      await expectDeniedStatus(
        createDeniedAccess(403, "cross_domain_forbidden"),
        403,
      );
    },
  },
  {
    name: "409 is preserved",
    run: async () => {
      await expectDeniedStatus(
        createDeniedAccess(409, "store_missing_membership"),
        409,
      );
    },
  },
  {
    name: "503 is preserved",
    run: async () => {
      await expectDeniedStatus(
        createDeniedAccess(503, "access_resolution_unavailable"),
        503,
      );
    },
  },
  {
    name: "access denied does not read formdata file upload or persist anything",
    run: async () => {
      const harness = createHandlerHarness({
        accessResult: createDeniedAccess(403, "store_commercial_blocked"),
      });

      const response = await harness.handler(harness.makeRequest());

      assert.equal(response.status, 403);
      assert.equal(harness.getDeniedCalls(), 1);
      assert.equal(harness.getClassifyCalls(), 0);
      assert.equal(harness.getReadFileCalls(), 0);
      assert.equal(harness.getAnalyzeCalls(), 0);
      assert.equal(harness.getTranscriptionCalls(), 0);
      assert.equal(harness.getAiCalls(), 0);
      assert.equal(harness.fakeSupabase.queryCalls.length, 0);
      assert.equal(harness.fakeSupabase.uploadCalls.length, 0);
      assert.equal(harness.fakeSupabase.rpcCalls.length, 0);
    },
  },
  {
    name: "purpose x mime matrix preserves canonical purpose and classification behavior",
    run: async () => {
      for (const testCase of purposeMimeCases) {
        const harness = createHandlerHarness({
          fileOverrides: {
            name: testCase.fileName,
            type: testCase.mimeType,
          },
          classifyResult: testCase.classifyResult,
        });

        const response = await harness.handler(
          harness.makeRequest({
            purpose: testCase.purpose,
          }),
        );
        const body = await parseBody(response);
        const classificationInput = harness.classificationInputs[0] || {};
        const metadata = harness.fakeSupabase.rpcCalls[0]?.args
          .p_metadata as Record<string, unknown>;

        assert.equal(response.status, 200, testCase.label);
        assert.equal(body.ok, true, testCase.label);
        assert.equal(classificationInput.messageType, testCase.expectedMessageType, testCase.label);
        assert.equal(
          classificationInput.explicitPurpose,
          testCase.expectedExplicitPurpose,
          testCase.label,
        );
        assert.equal(metadata.media_purpose, testCase.expectedRequestedPurpose, testCase.label);
        assert.equal(
          metadata.media_purpose_normalized,
          testCase.classifyResult.mediaPurpose,
          testCase.label,
        );
        assert.equal(harness.getAnalyzeCalls() > 0, testCase.expectAnalyze, testCase.label);
        assert.equal(
          harness.getTranscriptionCalls() > 0,
          testCase.expectTranscribe,
          testCase.label,
        );
        assert.equal(harness.getAiCalls() > 0, testCase.expectAi, testCase.label);

        if (testCase.expectedMessageType === "audio") {
          assert.notEqual(metadata.media_purpose_normalized, "customer_location_photo", testCase.label);
        }

        if (testCase.expectedMessageType === "video") {
          assert.notEqual(metadata.media_purpose_normalized, "customer_location_photo", testCase.label);
        }
      }
    },
  },
  {
    name: "aliases from the CRM are accepted",
    run: async () => {
      const aliasCases = [
        {
          purpose: "customer_product_or_pool_photo",
          expectedExplicitPurpose: "customer_product_photo",
        },
        {
          purpose: "payment_proof",
          expectedExplicitPurpose: "payment_receipt",
        },
        {
          purpose: "conversation_or_document_screenshot",
          expectedExplicitPurpose: "screenshot",
        },
      ];

      for (const aliasCase of aliasCases) {
        const harness = createHandlerHarness({
          classifyResult: {
            mediaPurpose: "unknown_image",
            confidence: "low",
            reason: "alias",
            requiresAiAnalysis: false,
            requiresHumanReview: false,
          },
        });

        const response = await harness.handler(
          harness.makeRequest({
            purpose: aliasCase.purpose,
          }),
        );

        assert.equal(response.status, 200);
        assert.equal(
          harness.classificationInputs[0]?.explicitPurpose,
          aliasCase.expectedExplicitPurpose,
        );
      }
    },
  },
  {
    name: "access resolution occurs exactly once and browser flow works without internal secret",
    run: async () => {
      const harness = createHandlerHarness({
        classifyResult: {
          mediaPurpose: "unknown_image",
          confidence: "low",
          reason: "unknown",
          requiresAiAnalysis: false,
          requiresHumanReview: false,
        },
      });

      const response = await harness.handler(harness.makeRequest({ purpose: "unknown" }));
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(harness.getResolveCalls(), 1);
    },
  },
  {
    name: "there is no NODE_ENV bypass or internal secret left in implementation",
    run: () => {
      const source = readFileSync(join(__dirname, "handler.ts"), "utf8");

      assert.equal(source.includes("AI_INTERNAL_ROUTE_SECRET"), false);
      assert.equal(source.includes("x-zion-internal-secret"), false);
      assert.equal(source.includes("x-internal-secret"), false);
      assert.equal(source.includes("NODE_ENV"), false);
    },
  },
  {
    name: "organizationId storeId and leadId from formdata are ignored in canonical scope",
    run: async () => {
      const harness = createHandlerHarness({
        classifyResult: {
          mediaPurpose: "unknown_image",
          confidence: "low",
          reason: "unknown",
          requiresAiAnalysis: false,
          requiresHumanReview: false,
        },
      });

      await harness.handler(
        harness.makeRequest({
          organizationId: "body-org",
          storeId: "body-store",
          leadId: "body-lead",
          conversationId: "body-conversation",
          purpose: "customer_product_or_pool_photo",
        }),
      );

      assert.deepEqual(harness.fakeSupabase.queryCalls[0], {
        table: "conversations",
        mode: "select",
        columns: "id, organization_id, store_id, lead_id",
        eqs: [
          { field: "id", value: "body-conversation" },
          { field: "organization_id", value: "server-org" },
          { field: "store_id", value: "server-store" },
        ],
      });
      assert.deepEqual(harness.fakeSupabase.queryCalls[1], {
        table: "leads",
        mode: "select",
        columns: "id, organization_id, store_id",
        eqs: [
          { field: "id", value: "lead-1" },
          { field: "organization_id", value: "server-org" },
          { field: "store_id", value: "server-store" },
        ],
      });
    },
  },
  {
    name: "upload uses validated scope and validated ids in the storage path",
    run: async () => {
      const harness = createHandlerHarness({
        classifyResult: {
          mediaPurpose: "unknown_image",
          confidence: "low",
          reason: "unknown",
          requiresAiAnalysis: false,
          requiresHumanReview: false,
        },
      });

      await harness.handler(
        harness.makeRequest({
          purpose: "customer_product_or_pool_photo",
        }),
      );

      const uploadCall = harness.fakeSupabase.uploadCalls[0];
      assert.equal(uploadCall.bucket, "zion-store-files");
      assert.equal(
        uploadCall.path,
        "server-org/server-store/customer-media/lead-1/conv-1/20260727-random1-cliente-foto.png",
      );
      assert.equal(uploadCall.options.contentType, "image/png");
    },
  },
  {
    name: "metadata uses only validated ids and canonical purpose mapping",
    run: async () => {
      const harness = createHandlerHarness({
        classifyResult: {
          mediaPurpose: "customer_product_or_pool_photo",
          confidence: "high",
          reason: "product",
          requiresAiAnalysis: false,
          requiresHumanReview: false,
        },
      });

      await harness.handler(
        harness.makeRequest({
          organizationId: "body-org",
          storeId: "body-store",
          leadId: "body-lead",
          purpose: "customer_product_or_pool_photo",
        }),
      );

      const metadata = harness.fakeSupabase.rpcCalls[0]?.args
        .p_metadata as Record<string, unknown>;
      assert.equal(metadata.organization_id, "server-org");
      assert.equal(metadata.store_id, "server-store");
      assert.equal(metadata.lead_id, "lead-1");
      assert.equal(metadata.conversation_id, "conv-1");
      assert.equal(metadata.media_purpose, "customer_product_or_pool_photo");
      assert.equal(metadata.media_purpose_normalized, "customer_product_or_pool_photo");
    },
  },
  {
    name: "conversation outside scope is rejected before file read upload and persistence",
    run: async () => {
      const harness = createHandlerHarness({
        fakeSupabaseOptions: {
          conversationResult: {
            data: null,
            error: null,
          },
        },
      });

      const response = await harness.handler(harness.makeRequest());
      const body = await parseBody(response);

      assert.equal(response.status, 404);
      assert.equal(body.error, "SIMULATE_CUSTOMER_MEDIA_CONVERSATION_NOT_AVAILABLE");
      assert.equal(harness.fixture.reads, 0);
      assert.equal(harness.fakeSupabase.uploadCalls.length, 0);
      assert.equal(harness.fakeSupabase.rpcCalls.length, 0);
      assert.equal(harness.getAnalyzeCalls(), 0);
      assert.equal(harness.getTranscriptionCalls(), 0);
    },
  },
  {
    name: "lead outside scope is rejected before file read upload and persistence",
    run: async () => {
      const harness = createHandlerHarness({
        fakeSupabaseOptions: {
          leadResult: {
            data: null,
            error: null,
          },
        },
      });

      const response = await harness.handler(harness.makeRequest());
      const body = await parseBody(response);

      assert.equal(response.status, 404);
      assert.equal(body.error, "SIMULATE_CUSTOMER_MEDIA_LEAD_NOT_AVAILABLE");
      assert.equal(harness.fixture.reads, 0);
      assert.equal(harness.fakeSupabase.uploadCalls.length, 0);
      assert.equal(harness.fakeSupabase.rpcCalls.length, 0);
    },
  },
  {
    name: "order is resolve granted formdata client conversation lead file classify upload insert metadata analyze metadata update ai",
    run: async () => {
      const harness = createHandlerHarness();
      const response = await harness.handler(
        harness.makeRequest({
          purpose: "customer_location_photo",
        }),
      );

      assert.equal(response.status, 200);
      expectEventSequence(harness.events, [
        "resolve:start",
        "resolve:granted",
        "formData",
        "client:create",
        "conversation:query",
        "lead:query",
        "file:read",
        "classify",
        "upload",
        "insert_message",
        "metadata:load",
        "analyze",
        "metadata:update",
        "ai:start",
      ]);
    },
  },
  {
    name: "audio order is resolve granted formdata client conversation lead file classify upload insert metadata transcribe metadata update ai",
    run: async () => {
      const harness = createHandlerHarness({
        fileOverrides: {
          name: "cliente-audio.webm",
          type: "audio/webm",
        },
        classifyResult: {
          mediaPurpose: "customer_audio",
          confidence: "high",
          reason: "audio",
          requiresAiAnalysis: true,
          requiresHumanReview: false,
        },
      });

      const response = await harness.handler(
        harness.makeRequest({
          purpose: "unknown",
        }),
      );

      assert.equal(response.status, 200);
      expectEventSequence(harness.events, [
        "resolve:start",
        "resolve:granted",
        "formData",
        "client:create",
        "conversation:query",
        "lead:query",
        "file:read",
        "classify",
        "upload",
        "insert_message",
        "metadata:load",
        "transcribe",
        "metadata:update",
        "ai:start",
      ]);
    },
  },
  {
    name: "generic attachments return success without calling runAiFlow",
    run: async () => {
      const harness = createHandlerHarness({
        classifyResult: {
          mediaPurpose: "unknown_image",
          confidence: "low",
          reason: "generic",
          requiresAiAnalysis: false,
          requiresHumanReview: false,
        },
      });

      const response = await harness.handler(
        harness.makeRequest({
          purpose: "unknown",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(harness.getAiCalls(), 0);
      assert.equal(harness.events.includes("metadata:load"), false);
    },
  },
  {
    name: "formdata exception is sanitized and stops before client creation",
    run: async () => {
      const harness = createHandlerHarness();
      const response = await harness.handler(harness.makeRequest({}, { formDataThrows: true }));
      const body = await parseBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.error, "SIMULATE_CUSTOMER_MEDIA_INVALID_REQUEST");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(harness.getCreateClientCalls(), 0);
      assertNoSentinel(body, "formdata exception");
    },
  },
  {
    name: "uploadMedia returning error keeps sanitized 500 response",
    run: async () => {
      const harness = createHandlerHarness({
        classifyResult: {
          mediaPurpose: "unknown_image",
          confidence: "low",
          reason: "generic",
          requiresAiAnalysis: false,
          requiresHumanReview: false,
        },
        fakeSupabaseOptions: {
          uploadError: { message: "UPLOAD_RETURN_SENTINEL" },
        },
      });

      const response = await harness.handler(harness.makeRequest({ purpose: "unknown" }));
      const body = await parseBody(response);

      assert.equal(response.status, 500);
      assert.equal(body.error, "SIMULATE_CUSTOMER_MEDIA_UPLOAD_FAILED");
      assert.equal(harness.fakeSupabase.rpcCalls.length, 0);
      assertNoSentinel(body, "upload returned error");
    },
  },
  {
    name: "insert_message returning error triggers cleanup and keeps sanitized 500 response",
    run: async () => {
      const harness = createHandlerHarness({
        classifyResult: {
          mediaPurpose: "unknown_image",
          confidence: "low",
          reason: "generic",
          requiresAiAnalysis: false,
          requiresHumanReview: false,
        },
        fakeSupabaseOptions: {
          insertError: { message: "INSERT_RETURN_SENTINEL" },
        },
      });

      const response = await harness.handler(harness.makeRequest({ purpose: "unknown" }));
      const body = await parseBody(response);

      assert.equal(response.status, 500);
      assert.equal(body.error, "SIMULATE_CUSTOMER_MEDIA_MESSAGE_SAVE_FAILED");
      assert.deepEqual(harness.fakeSupabase.removeCalls[0], {
        bucket: "zion-store-files",
        paths: [
          "server-org/server-store/customer-media/lead-1/conv-1/20260727-random1-cliente-foto.png",
        ],
      });
      assertNoSentinel(body, "insert returned error");
    },
  },
  {
    name: "insert_message throw triggers cleanup and keeps sanitized 500 response",
    run: async () => {
      const harness = createHandlerHarness({
        fakeSupabaseOptions: {
          throwOnRpc: true,
        },
      });

      const response = await harness.handler(harness.makeRequest());
      const body = await parseBody(response);

      assert.equal(response.status, 500);
      assert.equal(body.error, "SIMULATE_CUSTOMER_MEDIA_ROUTE_FAILED");
      assert.deepEqual(harness.fakeSupabase.removeCalls[0], {
        bucket: "zion-store-files",
        paths: [
          "server-org/server-store/customer-media/lead-1/conv-1/20260727-random1-cliente-foto.png",
        ],
      });
      assertNoSentinel(body, "insert throw");
    },
  },
  {
    name: "cleanup failure does not leak or replace the primary response",
    run: async () => {
      const harness = createHandlerHarness({
        classifyResult: {
          mediaPurpose: "unknown_image",
          confidence: "low",
          reason: "generic",
          requiresAiAnalysis: false,
          requiresHumanReview: false,
        },
        fakeSupabaseOptions: {
          insertError: { message: "INSERT_RETURN_SENTINEL" },
          throwOnRemove: true,
        },
      });

      const response = await harness.handler(harness.makeRequest({ purpose: "unknown" }));
      const body = await parseBody(response);

      assert.equal(response.status, 500);
      assert.equal(body.error, "SIMULATE_CUSTOMER_MEDIA_MESSAGE_SAVE_FAILED");
      assertNoSentinel(body, "cleanup throw");
    },
  },
  {
    name: "missing messageId in processing flow returns sanitized 409 and does not remove persisted media",
    run: async () => {
      const harness = createHandlerHarness({
        fakeSupabaseOptions: {
          insertData: [],
        },
      });

      const response = await harness.handler(harness.makeRequest());
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE");
      assert.equal(harness.getAiCalls(), 0);
      assert.equal(harness.fakeSupabase.removeCalls.length, 0);
      assertNoSentinel(body, "missing messageId processing flow");
    },
  },
  {
    name: "missing messageId in generic attachment still returns success without ai",
    run: async () => {
      const harness = createHandlerHarness({
        classifyResult: {
          mediaPurpose: "unknown_image",
          confidence: "low",
          reason: "generic",
          requiresAiAnalysis: false,
          requiresHumanReview: false,
        },
        fakeSupabaseOptions: {
          insertData: [],
        },
      });

      const response = await harness.handler(harness.makeRequest({ purpose: "unknown" }));
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(harness.getAiCalls(), 0);
    },
  },
  {
    name: "analysis false returns sanitized 409 without removing persisted media",
    run: async () => {
      const harness = createHandlerHarness({
        analyzeResult: {
          ok: false,
          error: "ANALYSIS_RETURN_SENTINEL",
          message: "analysis failed",
          provider: "openai",
          model: "gpt-4.1-mini",
        },
      });

      const response = await harness.handler(harness.makeRequest());
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE");
      assert.equal(harness.fakeSupabase.removeCalls.length, 0);
      assertNoSentinel(body, "analysis false");
    },
  },
  {
    name: "transcription false returns sanitized 409 without removing persisted media",
    run: async () => {
      const harness = createHandlerHarness({
        fileOverrides: {
          name: "cliente-audio.webm",
          type: "audio/webm",
        },
        classifyResult: {
          mediaPurpose: "customer_audio",
          confidence: "high",
          reason: "audio",
          requiresAiAnalysis: true,
          requiresHumanReview: false,
        },
        transcriptionResult: {
          ok: false,
          error: "TRANSCRIPTION_RETURN_SENTINEL",
          message: "transcription failed",
          provider: "openai",
          model: "whisper-1",
        },
      });

      const response = await harness.handler(
        harness.makeRequest({
          purpose: "unknown",
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE");
      assert.equal(harness.fakeSupabase.removeCalls.length, 0);
      assertNoSentinel(body, "transcription false");
    },
  },
  {
    name: "metadata update returning error keeps sanitized 409 response",
    run: async () => {
      const harness = createHandlerHarness({
        fakeSupabaseOptions: {
          updateError: { message: "UPDATE_RETURN_SENTINEL" },
        },
      });

      const response = await harness.handler(harness.makeRequest());
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE");
      assert.equal(harness.fakeSupabase.removeCalls.length, 0);
      assertNoSentinel(body, "metadata update error");
    },
  },
  {
    name: "runAiFlow false returns sanitized 409",
    run: async () => {
      const harness = createHandlerHarness({
        aiResult: {
          ok: false,
          error: "AI_RETURN_SENTINEL",
          message: "ai failed",
        },
      });

      const response = await harness.handler(harness.makeRequest());
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE");
      assertNoSentinel(body, "runAiFlow false");
    },
  },
  {
    name: "exception scenarios use the same harness file and keep responses sanitized",
    run: async () => {
      const scenarios: Array<{
        name: string;
        expectedStatus: number;
        createHarness: () => ReturnType<typeof createHandlerHarness>;
        requestOverrides?: Parameters<ReturnType<typeof createHandlerHarness>["makeRequest"]>[0];
      }> = [
        {
          name: "conversation query throw",
          expectedStatus: 500,
          createHarness: () =>
            createHandlerHarness({
              fakeSupabaseOptions: {
                throwOnFromTable: "conversations",
              },
            }),
        },
        {
          name: "file read throw",
          expectedStatus: 500,
          createHarness: () =>
            createHandlerHarness({
              fileOverrides: {
                throwOnRead: true,
              },
            }),
        },
        {
          name: "upload throw",
          expectedStatus: 500,
          createHarness: () =>
            createHandlerHarness({
              fakeSupabaseOptions: {
                throwOnUpload: true,
              },
            }),
        },
        {
          name: "persisted message lookup throw",
          expectedStatus: 409,
          createHarness: () =>
            createHandlerHarness({
              fakeSupabaseOptions: {
                throwOnPersistedMessageLookup: true,
              },
            }),
        },
        {
          name: "analysis throw",
          expectedStatus: 409,
          createHarness: () =>
            createHandlerHarness({
              analyzeThrows: true,
            }),
        },
        {
          name: "metadata update throw",
          expectedStatus: 409,
          createHarness: () =>
            createHandlerHarness({
              fakeSupabaseOptions: {
                throwOnUpdate: true,
              },
            }),
        },
        {
          name: "ai throw",
          expectedStatus: 409,
          createHarness: () =>
            createHandlerHarness({
              aiThrows: true,
            }),
        },
      ];

      for (const scenario of scenarios) {
        const harness = scenario.createHarness();
        const response = await harness.handler(harness.makeRequest(scenario.requestOverrides));
        const body = await parseBody(response);

        assert.equal(response.status, scenario.expectedStatus, scenario.name);
        assert.equal(response.headers.get("Cache-Control"), "no-store", scenario.name);
        assertNoSentinel(body, scenario.name);
      }
    },
  },
  {
    name: "success payload contains only ok and message and local errors contain only ok error and message",
    run: async () => {
      const successHarness = createHandlerHarness({
        classifyResult: {
          mediaPurpose: "unknown_image",
          confidence: "low",
          reason: "unknown",
          requiresAiAnalysis: false,
          requiresHumanReview: false,
        },
      });
      const successResponse = await successHarness.handler(
        successHarness.makeRequest({
          purpose: "unknown",
        }),
      );
      const successBody = await parseBody(successResponse);

      assert.deepEqual(Object.keys(successBody).sort(), ["message", "ok"]);

      const errorHarness = createHandlerHarness({
        fakeSupabaseOptions: {
          conversationResult: {
            data: null,
            error: null,
          },
        },
      });
      const errorResponse = await errorHarness.handler(errorHarness.makeRequest());
      const errorBody = await parseBody(errorResponse);

      assert.deepEqual(Object.keys(errorBody).sort(), ["error", "message", "ok"]);
    },
  },
  {
    name: "route.ts is minimal and uses the secure handler",
    run: () => {
      const routeSource = readFileSync(join(__dirname, "route.ts"), "utf8");

      assert.equal(routeSource.includes("createSimulateCustomerMediaPostHandler"), false);
      assert.equal(routeSource.includes("NextResponse"), false);
      assert.equal(routeSource.includes("createClient"), false);
      assert.equal(routeSource.includes("export const dynamic"), false);
      assert.equal(
        routeSource.includes(
          'import { POST as simulateCustomerMediaPost } from "./handler";',
        ),
        true,
      );
      assert.equal(routeSource.includes('export const runtime = "nodejs";'), true);
      assert.equal(
        routeSource.includes("export const POST = simulateCustomerMediaPost;"),
        true,
      );
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`simulate-customer-media-handler: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

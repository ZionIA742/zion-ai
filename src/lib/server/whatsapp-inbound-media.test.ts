import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  downloadAndStoreWhatsappInboundMedia,
  WhatsappInboundMediaError,
} from "./whatsapp-inbound-media.js";

const originalFetch = globalThis.fetch;
const originalToken = process.env.META_WHATSAPP_ACCESS_TOKEN;
const originalMaxBytes = process.env.WHATSAPP_INBOUND_MEDIA_MAX_BYTES;

function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function oggBytes(size = 8) {
  const bytes = new Uint8Array(size);
  bytes.set([0x4f, 0x67, 0x67, 0x53]);
  return bytes;
}

function response(bytes: Uint8Array, contentType = "audio/ogg") {
  return new Response(Buffer.from(bytes), { status: 200, headers: { "content-type": contentType } });
}

function makeSupabase(uploadError?: { message: string }, existingBytes?: Uint8Array) {
  const uploads: Array<{ path: string; bytes: Uint8Array; options: Record<string, unknown> }> = [];
  return {
    uploads,
    supabase: {
      storage: {
        from: () => ({
          upload: async (path: string, bytes: Uint8Array, options: Record<string, unknown>) => {
            uploads.push({ path, bytes, options });
            return { data: uploadError ? null : { path }, error: uploadError || null };
          },
          download: async () => ({
            data: existingBytes ? new Blob([Buffer.from(existingBytes)]) : null,
            error: existingBytes ? null : { message: "not found" },
          }),
          remove: async () => ({ data: [], error: null }),
        }),
      },
    } as never,
  };
}

function installFetch(args: {
  bytes?: Uint8Array;
  metadata?: Record<string, unknown>;
  mediaResponse?: Response | Promise<Response>;
}) {
  const bytes = args.bytes || oggBytes();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("graph.facebook.com")) {
      return new Response(JSON.stringify({
        url: "https://media.test/audio",
        mime_type: "audio/ogg",
        file_size: bytes.byteLength,
        sha256: hash(bytes),
        ...args.metadata,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return args.mediaResponse || response(bytes);
  }) as typeof fetch;
}

async function run(args: Parameters<typeof installFetch>[0] & {
  mediaKind?: "audio" | "image";
  uploadError?: { message: string };
  downloadTimeoutMs?: number;
}) {
  installFetch(args);
  const storage = makeSupabase(args.uploadError);
  const result = await downloadAndStoreWhatsappInboundMedia({
    supabase: storage.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conversation-1",
    mediaId: "meta-media-1",
    mediaKind: args.mediaKind || "audio",
    fetchImpl: globalThis.fetch,
    downloadTimeoutMs: args.downloadTimeoutMs,
  });
  return { result, uploads: storage.uploads };
}

test.beforeEach(() => {
  process.env.META_WHATSAPP_ACCESS_TOKEN = "test-token";
  process.env.WHATSAPP_INBOUND_MEDIA_MAX_BYTES = "1048576";
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.META_WHATSAPP_ACCESS_TOKEN;
  else process.env.META_WHATSAPP_ACCESS_TOKEN = originalToken;
  if (originalMaxBytes === undefined) delete process.env.WHATSAPP_INBOUND_MEDIA_MAX_BYTES;
  else process.env.WHATSAPP_INBOUND_MEDIA_MAX_BYTES = originalMaxBytes;
});

test("stores valid audio with the actual hash and tenant/store path", async () => {
  const bytes = oggBytes();
  const { result, uploads } = await run({ bytes });
  assert.equal(result.mimeType, "audio/ogg");
  assert.equal(result.sha256, hash(bytes));
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].options.upsert, false);
  assert.match(uploads[0].path, /^org-1\/store-1\/whatsapp-inbound\//);
});

test("rejects metadata declaring a file above the configured limit before download", async () => {
  let mediaRequested = false;
  installFetch({ metadata: { file_size: 1_048_577 } });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "https://media.test/audio") mediaRequested = true;
    return globalThis.fetch(input, init);
  }) as typeof fetch;
  await assert.rejects(
    () => downloadAndStoreWhatsappInboundMedia({
      supabase: makeSupabase().supabase,
      organizationId: "org-1", storeId: "store-1", conversationId: "c-1", mediaId: "m-1",
      mediaKind: "audio", fetchImpl,
    }),
    (error: unknown) => error instanceof WhatsappInboundMediaError && error.code === "WHATSAPP_MEDIA_TOO_LARGE",
  );
  assert.equal(mediaRequested, false);
});

test("stops a streamed body when it exceeds the limit", async () => {
  const chunks = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(oggBytes(700_000));
      controller.enqueue(new Uint8Array(400_000));
    },
  });
  await assert.rejects(
    () => run({ mediaResponse: new Response(chunks, { status: 200, headers: { "content-type": "audio/ogg" } }) }),
    (error: unknown) => error instanceof WhatsappInboundMediaError && error.code === "WHATSAPP_MEDIA_TOO_LARGE",
  );
});

test("classifies an interrupted download and a timeout", async () => {
  const interrupted = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(oggBytes());
      controller.error(new Error("connection reset"));
    },
  });
  await assert.rejects(
    () => run({ mediaResponse: new Response(interrupted, { status: 200 }) }),
    (error: unknown) => error instanceof WhatsappInboundMediaError && error.code === "WHATSAPP_MEDIA_DOWNLOAD_INTERRUPTED",
  );

  installFetch({});
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("graph.facebook.com")) return globalThis.fetch(input, init);
    return await new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as typeof fetch;
  await assert.rejects(
    () => downloadAndStoreWhatsappInboundMedia({
      supabase: makeSupabase().supabase,
      organizationId: "org-1", storeId: "store-1", conversationId: "c-1", mediaId: "m-1",
      mediaKind: "audio", fetchImpl, downloadTimeoutMs: 5,
    }),
    (error: unknown) => error instanceof WhatsappInboundMediaError && error.code === "WHATSAPP_MEDIA_DOWNLOAD_TIMEOUT",
  );
});

test("accepts the correct digest and rejects incorrect or malformed digests", async () => {
  const bytes = oggBytes();
  await run({ bytes, metadata: { sha256: hash(bytes) } });
  await assert.rejects(
    () => run({ bytes, metadata: { sha256: "0".repeat(64) } }),
    (error: unknown) => error instanceof WhatsappInboundMediaError && error.code === "WHATSAPP_MEDIA_HASH_MISMATCH",
  );
  await assert.rejects(
    () => run({ bytes, metadata: { sha256: "not-a-sha256" } }),
    (error: unknown) => error instanceof WhatsappInboundMediaError && error.code === "WHATSAPP_MEDIA_HASH_INVALID",
  );
});

test("accepts generic MIME only when the bytes are real audio and rejects incompatible MIME", async () => {
  const bytes = oggBytes();
  const generic = await run({ bytes, metadata: { mime_type: "application/octet-stream" } });
  assert.equal(generic.result.mimeType, "audio/ogg");
  await assert.rejects(
    () => run({ bytes, metadata: { mime_type: "image/png" } }),
    (error: unknown) => error instanceof WhatsappInboundMediaError && error.code === "WHATSAPP_AUDIO_MIME_INVALID",
  );
  await assert.rejects(
    () => run({ bytes: new Uint8Array([1, 2, 3]), metadata: { sha256: hash(new Uint8Array([1, 2, 3])) } }),
    (error: unknown) => error instanceof WhatsappInboundMediaError && error.code === "WHATSAPP_AUDIO_FORMAT_INVALID",
  );
});

test("does not overwrite an existing object on replay", async () => {
  const bytes = oggBytes();
  const storage = makeSupabase({ message: "already exists" }, bytes);
  installFetch({});
  const metadataAndMediaFetch = globalThis.fetch;
  let mediaDownloads = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "https://media.test/audio") mediaDownloads += 1;
    return metadataAndMediaFetch(input, init);
  }) as typeof fetch;
  const result = await downloadAndStoreWhatsappInboundMedia({
      supabase: storage.supabase,
      organizationId: "org-1", storeId: "store-1", conversationId: "c-1", mediaId: "m-1", mediaKind: "audio",
      fetchImpl,
    });
  assert.equal(result.reusedExisting, true);
  assert.equal(result.sha256, hash(bytes));
  assert.equal(mediaDownloads, 0);
  assert.equal(storage.uploads.length, 0);
});

test("does not reuse an existing object from another content identity", async () => {
  const storage = makeSupabase({ message: "already exists" }, new Uint8Array([1, 2, 3]));
  installFetch({});
  await assert.rejects(
    () => downloadAndStoreWhatsappInboundMedia({
      supabase: storage.supabase,
      organizationId: "org-1", storeId: "store-1", conversationId: "c-1", mediaId: "m-1", mediaKind: "audio",
      fetchImpl: globalThis.fetch,
    }),
    (error: unknown) => error instanceof WhatsappInboundMediaError && error.code === "WHATSAPP_MEDIA_HASH_MISMATCH",
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { File } from "node:buffer";
import { createHash } from "node:crypto";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);

function loadTs(path, resolveModule) {
  const source = readFileSync(path, "utf8");

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const context = {
    exports: {},
    require: resolveModule,
    Buffer,
    Error,
    File,
    Request,
    Response,
    URL,
  };

  runInNewContext(compiled.outputText, context);
  return context.exports;
}

const TEST_ADMIN_ID =
  "11111111-2222-4333-8444-555555555555";

class TestRegistrationError extends Error {
  constructor(outcome, reasonCode) {
    super(reasonCode);
    this.outcome = outcome;
    this.reasonCode = reasonCode;
  }
}
const validator = loadTs(
  "src/lib/server/zion-admin-financial-evidence-upload-validation.ts",
  nativeRequire,
);

const route = loadTs(
  "src/app/api/zion-admin/financial-evidence/upload/route.ts",
  (name) => {
    if (name === "node:crypto") return nativeRequire(name);

    if (name === "@supabase/supabase-js") {
      return {
        createClient() {
          throw new Error("REAL_SUPABASE_ACCESS_FORBIDDEN");
        },
      };
    }

    if (name.endsWith("/zion-admin-api-access")) {
      return {
        resolveZionAdminApiAccess() {
          throw new Error("REAL_AUTH_ACCESS_FORBIDDEN");
        },
      };
    }

    if (name.endsWith("/zion-admin-api-response")) {
      return {
        createZionAdminApiDeniedResponse() {
          return Response.json(
            { ok: false, error: "ACCESS_DENIED" },
            { status: 401 },
          );
        },
        createZionAdminApiJsonResponse(body, status) {
          return Response.json(body, { status });
        },
      };
    }

    if (
      name.endsWith(
        "/zion-admin-financial-evidence-upload-validation",
      )
    ) {
      return validator;
    }

    if (
      name.endsWith(
        "/zion-admin-financial-evidence-upload-registration",
      )
    ) {
      return {
        FinancialEvidenceRegistrationError: TestRegistrationError,
        registerFinancialEvidenceUpload() {
          throw new Error("REAL_REGISTRATION_FORBIDDEN");
        },
      };
    }
    throw new Error(`UNEXPECTED_IMPORT: ${name}`);
  },
);

const createHandler = route.createFinancialEvidenceUploadHandler;

const ENDPOINT =
  "https://zionapi.com.br/api/zion-admin/financial-evidence/upload";

function pdf() {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF",
    "ascii",
  );
}

function request(options = {}) {
  const form = new FormData();

  form.set("month", options.month ?? "2026-10-01");
  form.set(
    "preclosureRevision",
    options.revision ?? "1",
  );
  form.set("source", options.source ?? "meta_invoice");

  if (options.includeFile !== false) {
    form.set(
      "file",
      new File(
        [options.bytes ?? pdf()],
        options.filename ?? "fatura.pdf",
        {
          type: options.mime ?? "application/pdf",
        },
      ),
    );
  }

  const headers = {};

  if (options.origin !== null) {
    headers.origin = options.origin ?? "https://zionapi.com.br";
  }

  if (options.contentLength !== undefined) {
    headers["content-length"] = String(options.contentLength);
  }

  return new Request(ENDPOINT, {
    method: "POST",
    headers,
    body: form,
  });
}

function fakeAccess(capabilities = ["manage_accounts"]) {
  return {
    ok: true,
    resolution: { capabilities },
    sessionUserId: TEST_ADMIN_ID,
  };
}

function setup(options = {}) {
  const calls = {
    authorization: 0,
    periods: [],
    uploads: [],
    registrations: [],
    cleanups: [],
  };

  const handler = createHandler({
    authorize: async () => {
      calls.authorization++;
      return options.access ?? fakeAccess();
    },
    getPeriodState: async (month, revision) => {
      calls.periods.push([month, revision]);

      if (options.periodError) {
        throw new Error("SIMULATED_PERIOD_FAILURE");
      }

      return options.period ?? "ready";
    },
    upload: async (path, bytes, mime) => {
      calls.uploads.push({
        path,
        bytes,
        mime,
      });

      if (options.uploadError) {
        throw new Error("SIMULATED_STORAGE_FAILURE");
      }
    },
    register: async (payload) => {
      calls.registrations.push(payload);

      if (options.registrationError) {
        throw options.registrationError;
      }

      return {
        uploadId: options.uploadId ?? 7,
        status: "uploaded_unverified",
        verified: false,
      };
    },
    cleanup: async (path) => {
      calls.cleanups.push(path);

      if (options.cleanupError) {
        throw new Error("SIMULATED_CLEANUP_FAILURE");
      }
    },    generateId: () =>
      "11111111-2222-4333-8444-555555555555",
  });

  return { handler, calls };
}

async function execute(handler, req = request()) {
  const response = await handler(req);

  return {
    status: response.status,
    body: await response.json(),
  };
}

test("01 - sem autenticacao, acesso negado", async () => {
  const ctx = setup({ access: { ok: false } });
  const result = await execute(ctx.handler);

  assert.equal(result.status, 401);
  assert.equal(ctx.calls.periods.length, 0);
  assert.equal(ctx.calls.uploads.length, 0);
});

test("02 - sem capacidade administrativa, 403", async () => {
  const ctx = setup({ access: fakeAccess([]) });
  const result = await execute(ctx.handler);

  assert.equal(result.status, 403);
  assert.equal(ctx.calls.uploads.length, 0);
});

test("03 - origem externa rejeitada", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    request({ origin: "https://outro-site.example" }),
  );

  assert.equal(result.status, 403);
  assert.equal(ctx.calls.uploads.length, 0);
});

test("04 - origem malformada rejeitada", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    request({ origin: "origem-invalida" }),
  );

  assert.equal(result.status, 403);
});

test("05 - requisicao nao multipart rejeitada", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    new Request(ENDPOINT, {
      method: "POST",
      headers: {
        origin: "https://zionapi.com.br",
        "content-type": "application/json",
      },
      body: "{}",
    }),
  );

  assert.equal(result.status, 415);
});

test("06 - tamanho declarado excessivo rejeitado", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    request({ contentLength: 4_400_001 }),
  );

  assert.equal(result.status, 413);
});

test("07 - Content-Length invalido rejeitado", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    request({ contentLength: "invalido" }),
  );

  assert.equal(result.status, 400);
});

test("08 - formulario multipart invalido rejeitado", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    new Request(ENDPOINT, {
      method: "POST",
      headers: {
        origin: "https://zionapi.com.br",
        "content-type":
          "multipart/form-data; boundary=inexistente",
      },
      body: "conteudo-invalido",
    }),
  );

  assert.equal(result.status, 400);
});

test("09 - arquivo ausente rejeitado", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    request({ includeFile: false }),
  );

  assert.equal(result.status, 400);
});

test("10 - arquivo vazio rejeitado", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    request({ bytes: Buffer.alloc(0) }),
  );

  assert.equal(result.status, 413);
});

test("11 - arquivo maior que 4 MiB rejeitado", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    request({
      bytes: Buffer.alloc(4 * 1024 * 1024 + 1),
    }),
  );

  assert.equal(result.status, 413);
  assert.equal(ctx.calls.uploads.length, 0);
});

test("12 - revisao zero rejeitada", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    request({ revision: "0" }),
  );

  assert.equal(result.status, 400);
  assert.equal(
    result.body.error,
    "FINANCIAL_EVIDENCE_INVALID_REVISION",
  );
});

test("13 - arquivo sem assinatura valida rejeitado", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    request({
      bytes: Buffer.from("arquivo-falso"),
    }),
  );

  assert.equal(result.status, 400);
  assert.equal(ctx.calls.uploads.length, 0);
});

test("14 - MIME divergente rejeitado", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    request({ mime: "image/png" }),
  );

  assert.equal(result.status, 400);
});

test("15 - competencia invalida rejeitada", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    request({ month: "2026-13-01" }),
  );

  assert.equal(result.status, 400);
});

test("16 - fonte desconhecida rejeitada", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    request({ source: "fornecedor_desconhecido" }),
  );

  assert.equal(result.status, 400);
});

test("17 - upload aprovado fica NAO VERIFICADO", async () => {
  const ctx = setup();
  const result = await execute(ctx.handler);

  assert.equal(result.status, 201);
  assert.equal(result.body.status, "uploaded_unverified");
  assert.equal(result.body.verified, false);

  assert.equal(
    result.body.bucket,
    "zion-admin-financial-evidence",
  );

  assert.equal(ctx.calls.periods.length, 1);
  assert.equal(ctx.calls.uploads.length, 1);

  const uploaded = ctx.calls.uploads[0];

  assert.equal(
    uploaded.path.startsWith(
      "unverified/2026-10-01/1/meta_invoice/",
    ),
    true,
  );

  assert.equal(
    result.body.sha256,
    createHash("sha256").update(pdf()).digest("hex"),
  );

  assert.equal(uploaded.mime, "application/pdf");
  assert.equal(uploaded.bytes.equals(pdf()), true);
});

test("18 - revisao desatualizada bloqueia upload", async () => {
  const ctx = setup({ period: "stale" });
  const result = await execute(ctx.handler);

  assert.equal(result.status, 409);
  assert.equal(
    result.body.error,
    "FINANCIAL_EVIDENCE_STALE_PRECLOSURE",
  );
  assert.equal(ctx.calls.uploads.length, 0);
});

test("19 - mes fechado bloqueia upload", async () => {
  const ctx = setup({ period: "closed" });
  const result = await execute(ctx.handler);

  assert.equal(result.status, 409);
  assert.equal(
    result.body.error,
    "FINANCIAL_EVIDENCE_MONTH_CLOSED",
  );
  assert.equal(ctx.calls.uploads.length, 0);
});

test("20 - pre-fechamento inexistente bloqueia", async () => {
  const ctx = setup({ period: "missing" });
  const result = await execute(ctx.handler);

  assert.equal(result.status, 404);
  assert.equal(
    result.body.error,
    "FINANCIAL_EVIDENCE_PRECLOSURE_NOT_FOUND",
  );
  assert.equal(ctx.calls.uploads.length, 0);
});

test("21 - falha de consulta bloqueia upload", async () => {
  const ctx = setup({ periodError: true });
  const result = await execute(ctx.handler);

  assert.equal(result.status, 503);
  assert.equal(ctx.calls.uploads.length, 0);
});

test("22 - falha de Storage nao aprova arquivo", async () => {
  const ctx = setup({ uploadError: true });
  const result = await execute(ctx.handler);

  assert.equal(result.status, 503);
  assert.equal(
    result.body.error,
    "FINANCIAL_EVIDENCE_UPLOAD_UNAVAILABLE",
  );
  assert.equal(result.body.verified, undefined);
});

test("23 - nome original nao define caminho", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    request({ filename: "nome-escolhido-pelo-usuario.pdf" }),
  );

  assert.equal(result.status, 201);

  assert.equal(
    result.body.path.includes(
      "nome-escolhido-pelo-usuario",
    ),
    false,
  );

  assert.equal(
    result.body.path.includes(
      "11111111-2222-4333-8444-555555555555",
    ),
    true,
  );
});

test("24 - registro confirmado inclui ID e ator da sessao", async () => {
  const ctx = setup();
  const result = await execute(ctx.handler);

  assert.equal(result.status, 201);
  assert.equal(result.body.uploadId, 7);
  assert.equal(result.body.verified, false);
  assert.equal(ctx.calls.registrations.length, 1);
  assert.equal(ctx.calls.cleanups.length, 0);

  const registration = ctx.calls.registrations[0];

  assert.equal(registration.sessionUserId, TEST_ADMIN_ID);
  assert.equal(registration.storagePath, result.body.path);
  assert.equal(registration.validated.sha256, result.body.sha256);
});

test("25 - rejeicao confirmada preserva arquivo", async () => {
  const ctx = setup({
    registrationError: new TestRegistrationError(
      "rejected",
      "ZION_ADMIN_UPLOAD_STALE_REVISION",
    ),
  });

  const result = await execute(ctx.handler);

  assert.equal(result.status, 503);
  assert.equal(
    result.body.error,
    "FINANCIAL_EVIDENCE_REGISTRATION_REJECTED",
  );
  assert.equal(result.body.verified, false);
  assert.equal(result.body.cleanupStatus, "not_attempted");
  assert.equal(ctx.calls.uploads.length, 1);
  assert.equal(ctx.calls.registrations.length, 1);
  assert.equal(ctx.calls.cleanups.length, 0);
});

test("26 - resultado incerto preserva arquivo", async () => {
  const ctx = setup({
    registrationError: new TestRegistrationError(
      "uncertain",
      "FINANCIAL_REGISTRATION_OUTCOME_UNKNOWN",
    ),
  });

  const result = await execute(ctx.handler);

  assert.equal(result.status, 503);
  assert.equal(
    result.body.error,
    "FINANCIAL_EVIDENCE_REGISTRATION_UNCERTAIN",
  );
  assert.equal(result.body.cleanupStatus, "not_attempted");
  assert.equal(result.body.verified, false);
  assert.equal(ctx.calls.uploads.length, 1);
  assert.equal(ctx.calls.cleanups.length, 0);
});

test("27 - conflito de caminho nao exclui arquivo", async () => {
  const ctx = setup({
    registrationError: new TestRegistrationError(
      "rejected",
      "ZION_ADMIN_UPLOAD_PATH_CONFLICT",
    ),
  });

  const result = await execute(ctx.handler);

  assert.equal(result.status, 503);
  assert.equal(result.body.cleanupStatus, "not_attempted");
  assert.equal(ctx.calls.cleanups.length, 0);
});

test("28 - rejeicao nao tenta limpeza indisponivel", async () => {
  const ctx = setup({
    registrationError: new TestRegistrationError(
      "rejected",
      "ZION_ADMIN_UPLOAD_STALE_REVISION",
    ),
    cleanupError: true,
  });

  const result = await execute(ctx.handler);

  assert.equal(result.status, 503);
  assert.equal(result.body.cleanupStatus, "not_attempted");
  assert.equal(result.body.verified, false);
  assert.equal(ctx.calls.cleanups.length, 0);
});

test("29 - erro inesperado preserva arquivo", async () => {
  const ctx = setup({
    registrationError: new Error("UNEXPECTED_FAILURE"),
  });

  const result = await execute(ctx.handler);

  assert.equal(result.status, 503);
  assert.equal(
    result.body.error,
    "FINANCIAL_EVIDENCE_REGISTRATION_UNCERTAIN",
  );
  assert.equal(ctx.calls.cleanups.length, 0);
});

test("30 - falha no upload nao tenta registrar nem limpar", async () => {
  const ctx = setup({ uploadError: true });
  const result = await execute(ctx.handler);

  assert.equal(result.status, 503);
  assert.equal(ctx.calls.uploads.length, 1);
  assert.equal(ctx.calls.registrations.length, 0);
  assert.equal(ctx.calls.cleanups.length, 0);
});

test("31 - arquivo invalido nao inicia registro", async () => {
  const ctx = setup();

  const result = await execute(
    ctx.handler,
    request({ bytes: Buffer.from("INVALIDO") }),
  );

  assert.equal(result.status, 400);
  assert.equal(ctx.calls.uploads.length, 0);
  assert.equal(ctx.calls.registrations.length, 0);
  assert.equal(ctx.calls.cleanups.length, 0);
});

test("32 - revisao desatualizada impede todas as escritas", async () => {
  const ctx = setup({ period: "stale" });
  const result = await execute(ctx.handler);

  assert.equal(result.status, 409);
  assert.equal(ctx.calls.uploads.length, 0);
  assert.equal(ctx.calls.registrations.length, 0);
  assert.equal(ctx.calls.cleanups.length, 0);
});
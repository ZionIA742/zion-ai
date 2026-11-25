const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadContract(source) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
    reportDiagnostics: true,
  });

  const errors = (compiled.diagnostics || [])
    .filter(d => d.category === ts.DiagnosticCategory.Error);

  assert.equal(errors.length, 0);

  const m = { exports: {} };

  new Function(
    "require", "module", "exports",
    compiled.outputText
  )(require, m, m.exports);

  return m.exports;
}

function run(source) {
  const {
    parseHumanQuoteSendRequest: parse,
    normalizeHumanQuoteSendPhone: phone,
    buildHumanQuoteSendIdentity: identity,
    HumanQuoteSendContractError,
  } = loadContract(source);

  const id = n =>
    "10000000-0000-4000-8000-" +
    String(n).padStart(12, "0");

  const scope = {
    organizationId: id(1),
    storeId: id(2),
    actorUserId: id(3),
    quoteId: id(4),
  };

  const base = {
    operationId: id(5),
    quoteVersionId: id(6),
  };

  const lead = {
    ...base,
    recipient: { kind: "lead", leadId: id(7) },
  };

  const direct = {
    ...base,
    recipient: { kind: "phone", phone: "(11) 99999-1234" },
  };

  const responsible = {
    ...base,
    recipient: { kind: "responsible" },
  };

  let count = 0;

  function check(name, fn) {
    fn();
    count++;
    console.log("ok - " + name);
  }

  function rejects(fn, code) {
    assert.throws(fn, error =>
      error instanceof HumanQuoteSendContractError &&
      (!code || error.code === code)
    );
  }

  check("explicit lead recipient", () => {
    assert.deepEqual(parse(lead), lead);
  });

  check("free phone recipient normalization", () => {
    assert.deepEqual(parse(direct).recipient, {
      kind: "phone",
      phone: "+5511999991234",
    });
  });

  check("responsible uses server-resolved destination", () => {
    assert.deepEqual(parse(responsible), responsible);
  });

  check("Brazilian and international phone formats", () => {
    assert.equal(phone("+55 (11) 99999-1234"), "+5511999991234");
    assert.equal(phone("5511999991234"), "+5511999991234");
    assert.equal(phone("(11) 3333-1234"), "+551133331234");
    assert.equal(phone("+1 415 555 0123"), "+14155550123");
  });

  check("invalid phone formats fail closed", () => {
    for (const value of [
      null, 11999991234, "", "123", "abc123456789",
      "11 99999-1234 ext 1", "+55123", "00000000000",
      "+1234567890123456", "++5511999991234",
    ]) {
      rejects(() => phone(value));
    }
  });

  check("missing version and operation IDs are rejected", () => {
    rejects(() => parse({ ...lead, quoteVersionId: "" }));
    rejects(() => parse({ ...lead, operationId: "invalid" }));
  });

  check("recipient kind and lead identity are required", () => {
    rejects(() => parse({
      ...base, recipient: { kind: "other" },
    }));
    rejects(() => parse({
      ...base, recipient: { kind: "lead", leadId: "invalid" },
    }));
  });

  check("caller cannot override responsible identity or phone", () => {
    rejects(() => parse({
      ...base,
      recipient: {
        kind: "responsible",
        responsibleId: id(7),
      },
    }));

    rejects(() => parse({
      ...base,
      recipient: {
        kind: "responsible",
        phone: "5511999991234",
      },
    }));
  });

  check("caller cannot override authoritative scope", () => {
    for (const key of [
      "organizationId", "storeId",
      "actorUserId", "conversationId",
      "commercialOpportunityId", "approved",
      "storagePath", "signedUrl",
    ]) {
      rejects(() => parse({
        ...lead, [key]: id(9),
      }));
    }
  });

  check("mixed recipient modes are rejected", () => {
    rejects(() => parse({
      ...base,
      recipient: {
        kind: "lead",
        leadId: id(7),
        phone: "5511999991234",
      },
    }));

    rejects(() => parse({
      ...base,
      recipient: {
        kind: "phone",
        phone: "5511999991234",
        leadId: id(7),
      },
    }));
  });

  check("malformed objects fail closed", () => {
    for (const value of [null, [], "", 123, {}]) {
      rejects(() => parse(value));
    }
  });

  check("same operation and normalized recipient are stable", () => {
    const a = identity(scope, direct);

    const b = identity(scope, {
      ...direct,
      recipient: {
        kind: "phone",
        phone: "+55 11 99999-1234",
      },
    });

    assert.deepEqual(a, b);
  });

  check("changed version or recipient conflicts with same operation", () => {
    const a = identity(scope, lead);

    for (const changed of [
      { ...lead, quoteVersionId: id(8) },
      { ...lead, recipient: { kind: "lead", leadId: id(8) } },
      direct,
      responsible,
    ]) {
      const b = identity(scope, changed);
      assert.equal(a.operationKey, b.operationKey);
      assert.notEqual(a.requestFingerprint, b.requestFingerprint);
    }
  });

  check("new explicit operation permits subsequent delivery", () => {
    const a = identity(scope, responsible);
    const b = identity(scope, {
      ...responsible,
      operationId: id(10),
    });

    assert.notEqual(a.operationKey, b.operationKey);
    assert.equal(a.requestFingerprint, b.requestFingerprint);
  });

  check("organization store and actor isolate operation identity", () => {
    const a = identity(scope, lead);

    for (const key of [
      "organizationId", "storeId", "actorUserId",
    ]) {
      const b = identity({ ...scope, [key]: id(10) }, lead);

      assert.notEqual(a.operationKey, b.operationKey);
      assert.notEqual(a.requestFingerprint, b.requestFingerprint);
    }
  });

  check("quote changes conflict instead of reusing an operation", () => {
    const a = identity(scope, lead);
    const b = identity({ ...scope, quoteId: id(10) }, lead);

    assert.equal(a.operationKey, b.operationKey);
    assert.notEqual(a.requestFingerprint, b.requestFingerprint);
  });

  check("invalid authority scope is rejected", () => {
    for (const key of Object.keys(scope)) {
      rejects(() => identity({ ...scope, [key]: "" }, lead));
    }
  });


  check("phone normalization is idempotent", () => {
    for (const value of [
      "(11) 99999-1234",
      "5511999991234",
      "+55 11 99999-1234",
      "+1 415 555 0123",
      "+44 20 7946 0958",
      "+351 912 345 678",
    ]) {
      const normalized = phone(value);
      assert.ok(normalized.startsWith("+"));
      assert.equal(phone(normalized), normalized);
    }
  });

  check("international request survives parsing twice", () => {
    const request = {
      ...base,
      recipient: {
        kind: "phone",
        phone: "+1 415 555 0123",
      },
    };

    const parsed = parse(request);

    assert.equal(
      parsed.recipient.phone,
      "+14155550123"
    );

    assert.deepEqual(parse(parsed), parsed);
  });

  check("international identity is stable without country corruption", () => {
    for (const value of [
      "+1 415 555 0123",
      "+44 20 7946 0958",
      "+351 912 345 678",
    ]) {
      const request = {
        ...base,
        recipient: { kind: "phone", phone: value },
      };

      const parsed = parse(request);

      assert.deepEqual(
        identity(scope, request),
        identity(scope, parsed)
      );
    }

    const international = {
      ...base,
      recipient: {
        kind: "phone",
        phone: "+1 415 555 0123",
      },
    };

    const brazilian = {
      ...base,
      recipient: {
        kind: "phone",
        phone: "+55 14 15555-0123",
      },
    };

    const a = identity(scope, international);
    const b = identity(scope, brazilian);

    assert.equal(a.operationKey, b.operationKey);

    assert.notEqual(
      a.requestFingerprint,
      b.requestFingerprint
    );
  });

  assert.equal(count, 20);


  console.log("HUMAN_QUOTE_SEND_CONTRACT: 20/20 PASS");
}

module.exports = run;

if (require.main === module) {
  run(fs.readFileSync(
    path.join(__dirname, "human-quote-send-contract.ts"),
    "utf8"
  ));
}

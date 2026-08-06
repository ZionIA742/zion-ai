import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

type RouteAudit = {
  name: string;
  relativePath: string;
  globalErrorCode: string;
  preservedSuccessFields: string[];
};

const ROUTES: RouteAudit[] = [
  {
    name: "visual-catalog-import",
    relativePath: "src/app/api/onboarding/visual-catalog-import/route.ts",
    globalErrorCode: "VISUAL_CATALOG_IMPORT_FAILED",
    preservedSuccessFields: ["drafts", "warnings"],
  },
  {
    name: "visual-catalog-document-scan",
    relativePath: "src/app/api/onboarding/visual-catalog-document-scan/route.ts",
    globalErrorCode: "VISUAL_DOCUMENT_SCAN_FAILED",
    preservedSuccessFields: ["pagePreviews", "rawSnippet"],
  },
  {
    name: "visual-catalog-document-map",
    relativePath: "src/app/api/onboarding/visual-catalog-document-map/route.ts",
    globalErrorCode: "VISUAL_DOCUMENT_MAP_FAILED",
    preservedSuccessFields: ["detectedLabels", "possibleModels", "recommendedPages"],
  },
];

function loadSource(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function extractFunctionBody(source: string, signature: string) {
  const signatureIndex = source.indexOf(signature);
  assert.notEqual(signatureIndex, -1, `missing signature: ${signature}`);

  const openBraceIndex = source.indexOf("{", signatureIndex);
  assert.notEqual(openBraceIndex, -1, `missing opening brace for: ${signature}`);

  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBraceIndex + 1, index);
      }
    }
  }

  throw new Error(`missing closing brace for: ${signature}`);
}

function extractJsonNoStoreBody(source: string) {
  return extractFunctionBody(source, "function jsonNoStore(");
}

function extractConsoleErrorCall(source: string, routeName: string) {
  const marker = `console.error("[ZION][${routeName}]"`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing invalid JSON log for ${routeName}`);

  const end = source.indexOf(");", start);
  assert.notEqual(end, -1, `missing end of invalid JSON log for ${routeName}`);

  return source.slice(start, end + 2);
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function assertGate(body: string, routeName: string) {
  assert.match(
    body,
    /const access = await resolveStoreApiAccess\(\s*\{\s*requirement:\s*"active_or_onboarding",\s*\}\s*\);/,
    `${routeName} should resolve access with active_or_onboarding`,
  );
  assert.match(
    body,
    /if \(!access\.ok\)\s*\{\s*return createStoreApiDeniedResponse\(access\);\s*\}/,
    `${routeName} should return denied response helper`,
  );
}

function assertNoForbiddenAccessSource(source: string, routeName: string) {
  const forbiddenPatterns = [
    /resolveAccessForRequest/,
    /getSession\(/,
    /service[_ -]?role/i,
    /\borganizationId\b/,
    /\bstoreId\b/,
    /\berror(?:\?\.|\.)message\b/,
    /\bstack\b/,
    /\bcause\b/,
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(
      pattern.test(source),
      false,
      `${routeName} should not contain forbidden pattern ${pattern}`,
    );
  }
}

function assertPostOrdering(postBody: string, routeName: string) {
  const gateIndex = postBody.indexOf("const access = await resolveStoreApiAccess(");
  const deniedIndex = postBody.indexOf("return createStoreApiDeniedResponse(access);");
  const formDataIndex = postBody.indexOf("const formData = await request.formData();");

  assert.ok(gateIndex >= 0, `${routeName} POST should contain access gate`);
  assert.ok(deniedIndex >= 0, `${routeName} POST should contain denied return`);
  assert.ok(formDataIndex >= 0, `${routeName} POST should read formData`);
  assert.ok(gateIndex < formDataIndex, `${routeName} POST gate should precede formData`);
  assert.ok(deniedIndex < formDataIndex, `${routeName} POST denied return should precede formData`);

  for (const token of [
    "Buffer.from(",
    "PDFParse",
    "getScreenshot(",
    "new OpenAI(",
    "openai.responses.create(",
  ]) {
    const tokenIndex = postBody.indexOf(token);
    if (tokenIndex >= 0) {
      assert.ok(
        formDataIndex < tokenIndex,
        `${routeName} POST should read formData before ${token}`,
      );
    }
  }
}

function assertLocalJsonGoesThroughJsonNoStore(source: string, routeName: string) {
  const matches = source.match(/NextResponse\.json\(/g) || [];
  assert.equal(
    matches.length,
    1,
    `${routeName} should only call NextResponse.json locally inside jsonNoStore`,
  );

  const jsonNoStoreBody = extractJsonNoStoreBody(source);
  assert.match(
    jsonNoStoreBody,
    /return NextResponse\.json\(body,\s*\{/,
    `${routeName} jsonNoStore should wrap NextResponse.json`,
  );
  assert.match(
    jsonNoStoreBody,
    /headers\.set\("Cache-Control", "no-store"\);/,
    `${routeName} jsonNoStore should set no-store`,
  );
}

function assertInvalidJsonLogIsSafe(source: string, routeName: string) {
  const logCall = extractConsoleErrorCall(source, routeName);
  const forbiddenLogTerms = [
    "rawText",
    "output_text",
    "dataUrl",
    "rawSnippet",
    "fileName",
    "uploadedEntry",
    "preview",
    "length",
    "message:",
    "instanceof Error",
    "String(error)",
  ];

  for (const term of forbiddenLogTerms) {
    assert.equal(
      logCall.includes(term),
      false,
      `${routeName} invalid JSON log should not include ${term}`,
    );
  }

  assert.match(logCall, /event:\s*"invalid_vision_json"/, `${routeName} should log a fixed event`);
  assert.match(logCall, /stage:\s*"parse_response"/, `${routeName} should log a safe stage`);
}

const tests: TestCase[] = ROUTES.flatMap((route) => [
  {
    name: `${route.name}: GET and POST exist`,
    run: () => {
      const source = loadSource(route.relativePath);
      assert.notEqual(source.indexOf("export async function GET("), -1);
      assert.notEqual(source.indexOf("export async function POST("), -1);
    },
  },
  {
    name: `${route.name}: GET and POST use the shared active_or_onboarding gate`,
    run: () => {
      const source = loadSource(route.relativePath);
      const getBody = extractFunctionBody(source, "export async function GET(");
      const postBody = extractFunctionBody(source, "export async function POST(");

      assertGate(getBody, `${route.name} GET`);
      assertGate(postBody, `${route.name} POST`);
    },
  },
  {
    name: `${route.name}: POST gate runs before formData and visual processing`,
    run: () => {
      const source = loadSource(route.relativePath);
      const postBody = extractFunctionBody(source, "export async function POST(");

      assertPostOrdering(postBody, route.name);
    },
  },
  {
    name: `${route.name}: source avoids forbidden auth and leak patterns`,
    run: () => {
      const source = loadSource(route.relativePath);
      assertNoForbiddenAccessSource(source, route.name);
    },
  },
  {
    name: `${route.name}: local JSON responses go through jsonNoStore with no-store`,
    run: () => {
      const source = loadSource(route.relativePath);
      assertLocalJsonGoesThroughJsonNoStore(source, route.name);
    },
  },
  {
    name: `${route.name}: invalid JSON logs stay sanitized`,
    run: () => {
      const source = loadSource(route.relativePath);
      assertInvalidJsonLogIsSafe(source, route.name);
    },
  },
  {
    name: `${route.name}: preserves expected success fields and global error code`,
    run: () => {
      const source = loadSource(route.relativePath);

      for (const field of route.preservedSuccessFields) {
        assert.ok(source.includes(field), `${route.name} should preserve ${field}`);
      }

      assert.ok(
        source.includes(route.globalErrorCode),
        `${route.name} should preserve ${route.globalErrorCode}`,
      );
    },
  },
]);

tests.push(
  {
    name: "shared access gate signature appears twice per route",
    run: () => {
      for (const route of ROUTES) {
        const normalizedSource = normalizeWhitespace(loadSource(route.relativePath));
        const gateMatches =
          normalizedSource.match(
            /resolveStoreApiAccess\(\s*\{\s*requirement:\s*"active_or_onboarding",\s*\}\s*\)/g,
          ) || [];

        assert.equal(gateMatches.length, 2, `${route.name} should gate GET and POST`);
      }
    },
  },
  {
    name: "global error codes remain stable across the three routes",
    run: () => {
      const allSource = ROUTES.map((route) => loadSource(route.relativePath)).join("\n");

      for (const errorCode of [
        "VISUAL_CATALOG_IMPORT_FAILED",
        "VISUAL_DOCUMENT_SCAN_FAILED",
        "VISUAL_DOCUMENT_MAP_FAILED",
      ]) {
        assert.ok(allSource.includes(errorCode), `missing ${errorCode}`);
      }
    },
  },
);

async function main() {
  let passed = 0;

  for (const test of tests) {
    await test.run();
    passed += 1;
  }

  console.log(`visual-catalog-routes-access: ${passed}/${tests.length} tests passed`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pageSource = readFileSync(
  join(process.cwd(), "src/app/(app)/crm/lead/[id]/page.tsx"),
  "utf8",
);

const sendFunctionStart = pageSource.indexOf("async function sendManualAttachment(file: File)");
const sendFunctionEnd = pageSource.indexOf("async function sendTextMessage", sendFunctionStart);
assert.ok(sendFunctionStart >= 0, "sendManualAttachment deve existir");
assert.ok(sendFunctionEnd > sendFunctionStart, "limite da função de attachment deve existir");

const sendFunction = pageSource.slice(sendFunctionStart, sendFunctionEnd);
const authorizeIndex = sendFunction.indexOf(
  'fetch("/api/crm/messages/send-manual-attachment/authorize"',
);
const uploadIndex = sendFunction.indexOf(".uploadToSignedUrl(");
const finalizeIndex = sendFunction.indexOf(
  'fetch("/api/crm/messages/send-manual-attachment/finalize"',
);
const uploadSegment = sendFunction.slice(uploadIndex, finalizeIndex);
const authorizeSegment = sendFunction.slice(authorizeIndex, uploadIndex);
const finalizeSegment = sendFunction.slice(finalizeIndex);

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

check(authorizeIndex >= 0, "o browser deve chamar o endpoint authorize");
check(uploadIndex >= 0, "o browser deve usar uploadToSignedUrl");
check(finalizeIndex >= 0, "o browser deve chamar o endpoint finalize");
check(authorizeIndex < uploadIndex, "authorize deve ocorrer antes do upload");
check(uploadIndex < finalizeIndex, "uploadToSignedUrl deve ocorrer antes do finalize");

check(
  sendFunction.includes("supabase.storage") &&
    sendFunction.includes(".from(result.bucket)") &&
    sendFunction.includes(".uploadToSignedUrl(result.path, result.token, file, { contentType: file.type })"),
  "upload deve usar bucket, path, token e file retornados pelo servidor",
);
check(
  sendFunction.includes(
    "body: JSON.stringify({ authorizationToken: result.authorizationToken, path: result.path })",
  ),
  "finalize deve receber exatamente authorizationToken e path do servidor",
);

check(
  authorizeSegment.includes("conversationId: conversation.id") &&
    authorizeSegment.includes("fileName: file.name") &&
    authorizeSegment.includes("mimeType: file.type") &&
    authorizeSegment.includes("sizeBytes: file.size"),
  "authorize deve depender somente da conversa e dos dados necessários do arquivo",
);
check(
  !authorizeSegment.includes("organizationId") &&
    !authorizeSegment.includes("storeId") &&
    !authorizeSegment.includes("storagePath") &&
    !authorizeSegment.includes("path:"),
  "o browser não deve fabricar organizationId, storeId ou path no authorize",
);

check(
  !pageSource.includes("SUPABASE_SERVICE_ROLE_KEY") &&
    !pageSource.includes("service_role"),
  "o código browser não deve conter nem usar service role",
);
check(
  !sendFunction.includes("/api/crm/messages/send-manual-attachment\""),
  "o envio direto não deve usar o endpoint multipart legado",
);

check(
  authorizeSegment.includes("if (!response.ok || !result?.ok)") &&
    authorizeSegment.includes("throw new Error"),
  "erro do authorize deve interromper antes do upload",
);
check(
  uploadSegment.includes("if (upload.error) throw new Error"),
  "erro do upload deve interromper antes do finalize",
);
check(
  finalizeSegment.includes("if (!finalize.ok || !finalized?.ok)") &&
    finalizeSegment.includes("throw new Error"),
  "erro do finalize deve ser tratado como falha",
);

console.log(`crm-manual-attachment-direct-upload: ${assertions} assertions passed`);

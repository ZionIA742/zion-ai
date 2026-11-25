import { types as backendNodeTypes } from "node:util";
export type BackendDiagnosticFrame = Readonly<{
  sourceFile: string;
  line: number;
  column: number;
}>;

export type BackendTechnicalEvidence = Readonly<{
  schemaVersion: 1;
  errorName: string | null;
  reportedErrorCode: string | null;
  sanitizedMessage: string | null;
  frames: readonly BackendDiagnosticFrame[];
  rawMessageStored: false;
  rawStackStored: false;
}>;

const SAFE_NAMES = new Set([
  "Error",
  "TypeError",
  "ReferenceError",
  "RangeError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "AbortError",
  "TimeoutError",
]);

// Exact recognized technical codes.
// A reported code does not establish the root cause.

const SAFE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ERR_NETWORK",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
  "08006",
  "22023",
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "40P01",
  "42501",
  "42703",
  "42883",
  "42P01",
  "55P03",
  "57014",
  "PGRST202",
  "PGRST204",
  "PGRST301",
]);

// Preserve only exact, known-safe messages.
// Never persist arbitrary exception text.

const SAFE_MESSAGES = new Set([
  "fetch failed",
  "Failed to fetch",
  "Network request failed",
  "Request timeout",
  "The operation was aborted.",
]);

const MAX_STACK_LENGTH = 16000;
const MAX_STACK_LINES = 64;
const MAX_FRAMES = 8;
const MAX_POSITION = 1000000;

const SOURCE_PATH_PATTERN =
  /^src\/[A-Za-z0-9_./()[\]-]+\.(?:ts|tsx|js|mjs|cjs)$/;

const STACK_FRAME_PATTERN =
  /(?:^|[/(\s])(src\/[A-Za-z0-9_./()[\]-]+\.(?:ts|tsx|js|mjs|cjs)):(\d{1,7}):(\d{1,7})\)?$/;

function ownData(
  input: unknown,
  key: string,
): unknown {
  try {
    if (
      input === null ||
      typeof input !== "object"
    ) {
      return undefined;
    }

    const descriptor =
      Object.getOwnPropertyDescriptor(input, key);

    if (
      !descriptor ||
      !Object.prototype.hasOwnProperty.call(
        descriptor,
        "value",
      )
    ) {
      return undefined;
    }

    return descriptor.value;
  } catch {
    return undefined;
  }
}

function knownErrorName(
  error: unknown,
): string | null {
  const reported = ownData(error, "name");

  if (
    typeof reported === "string" &&
    SAFE_NAMES.has(reported)
  ) {
    return reported;
  }

  try {
    if (error instanceof TypeError) return "TypeError";
    if (error instanceof ReferenceError) return "ReferenceError";
    if (error instanceof RangeError) return "RangeError";
    if (error instanceof SyntaxError) return "SyntaxError";
    if (error instanceof URIError) return "URIError";
    if (error instanceof EvalError) return "EvalError";
    if (error instanceof AggregateError) return "AggregateError";
    if (error instanceof Error) return "Error";
  } catch {
    return null;
  }

  return null;
}

function extractFrames(
  stack: unknown,
  knownSourceFiles: ReadonlySet<string>,
): BackendDiagnosticFrame[] {
  if (typeof stack !== "string") {
    return [];
  }

  const lines = stack
    .slice(0, MAX_STACK_LENGTH)
    .split(/\r?\n/)
    .slice(0, MAX_STACK_LINES);

  const frames: BackendDiagnosticFrame[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!/^\s*at\s+/.test(line)) {
      continue;
    }

    const normalized = line
      .trim()
      .replace(/\\/g, "/");

    const match =
      STACK_FRAME_PATTERN.exec(normalized);

    if (!match) continue;

    const sourceFile = match[1];

    if (
      sourceFile.length > 240 ||
      !SOURCE_PATH_PATTERN.test(sourceFile) ||
      sourceFile.split("/").some(
        segment =>
          segment === "." ||
          segment === ".." ||
          segment === "",
      ) ||
      !knownSourceFiles.has(sourceFile)
    ) {
      continue;
    }

    const lineNumber = Number(match[2]);
    const columnNumber = Number(match[3]);

    if (
      !Number.isInteger(lineNumber) ||
      !Number.isInteger(columnNumber) ||
      lineNumber < 1 ||
      columnNumber < 1 ||
      lineNumber > MAX_POSITION ||
      columnNumber > MAX_POSITION
    ) {
      continue;
    }

    const key =
      sourceFile + ":" +
      lineNumber + ":" +
      columnNumber;

    if (seen.has(key)) continue;

    seen.add(key);

    frames.push({
      sourceFile,
      line: lineNumber,
      column: columnNumber,
    });

    if (frames.length >= MAX_FRAMES) {
      break;
    }
  }

  return frames;
}

export function extractBackendTechnicalEvidence(
  error: unknown,
  knownSourceFiles: ReadonlySet<string>,
): BackendTechnicalEvidence {
  const code = ownData(error, "code");
  const message = ownData(error, "message");
  const stack = readBackendDiagnosticStack(error);

  return {
    schemaVersion: 1,
    errorName: knownErrorName(error),

    reportedErrorCode:
      typeof code === "string" &&
      SAFE_CODES.has(code)
        ? code
        : null,

    sanitizedMessage:
      typeof message === "string" &&
      SAFE_MESSAGES.has(message)
        ? message
        : null,

    frames: extractFrames(
      stack,
      knownSourceFiles,
    ),

    rawMessageStored: false,
    rawStackStored: false,
  };
}

// Node.js 24 exposes native Error.stack as an accessor.
// Accept only the getter captured from a genuine Error.
// Never invoke arbitrary stack getters.

const nativeBackendStackGetter =
  Object.getOwnPropertyDescriptor(
    new Error(),
    "stack",
  )?.get;

// Native lazy stack formatting may inspect name/message.
// Avoid accessor-backed or object-valued fields.

function hasSafeStackFormattingFields(
  value: object,
): boolean {
  for (const key of ["name", "message"]) {
    let current: object | null = value;
    let depth = 0;

    while (current !== null) {
      if (
        depth++ >= 16 ||
        backendNodeTypes.isProxy(current)
      ) {
        return false;
      }

      const descriptor =
        Object.getOwnPropertyDescriptor(
          current,
          key,
        );

      if (descriptor) {
        if (
          !Object.prototype.hasOwnProperty.call(
            descriptor,
            "value",
          )
        ) {
          return false;
        }

        if (
          descriptor.value !== undefined &&
          typeof descriptor.value !== "string"
        ) {
          return false;
        }

        break;
      }

      current = Object.getPrototypeOf(current);
    }
  }

  return true;
}

function readBackendDiagnosticStack(
  value: Parameters<typeof ownData>[0],
): unknown {
  try {
    if (
      value === null ||
      (
        typeof value !== "object" &&
        typeof value !== "function"
      ) ||
      backendNodeTypes.isProxy(value)
    ) {
      return undefined;
    }

    // Preserve the existing data-descriptor path.
    const ordinary = ownData(value, "stack");

    if (typeof ordinary === "string") {
      return ordinary;
    }

    if (
      typeof nativeBackendStackGetter !== "function" ||
      !backendNodeTypes.isNativeError(value)
    ) {
      return ordinary;
    }

    const descriptor =
      Object.getOwnPropertyDescriptor(
        value,
        "stack",
      );

    if (
      !descriptor ||
      descriptor.get !== nativeBackendStackGetter ||
      !hasSafeStackFormattingFields(value)
    ) {
      return ordinary;
    }

    const stack = Reflect.apply(
      nativeBackendStackGetter,
      value,
      [],
    );

    return typeof stack === "string"
      ? stack
      : undefined;
  } catch {
    // Stack extraction is best effort.
    // Never replace the original application failure.
    return undefined;
  }
}

import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "crypto";

export const ZION_ADMIN_LOGIN_CHALLENGE_PURPOSE = "admin_login_stepup";
export const ZION_ADMIN_2FA_CODE_LENGTH = 6;
export const ZION_ADMIN_2FA_CODE_TTL_MINUTES = 10;
export const ZION_ADMIN_2FA_COOKIE_NAME = "zion_admin_2fa";
export const ZION_ADMIN_2FA_COOKIE_TTL_HOURS = 8;

type ZionAdminSecondFactorCookiePayload = {
  userId: string;
  verifiedAt: string;
  expiresAt: string;
};

type ZionAdminSecondFactorCookieValue = {
  payload: ZionAdminSecondFactorCookiePayload;
  value: string;
};

type ZionAdminSecondFactorCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
};

function getZionAdminCookieSecret() {
  const secret = process.env.ZION_ADMIN_2FA_COOKIE_SECRET?.trim() || "";

  if (!secret) {
    throw new Error("ZION_ADMIN_2FA_COOKIE_SECRET não está definido no servidor.");
  }

  return secret;
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signZionAdminValue(value: string) {
  return createHmac("sha256", getZionAdminCookieSecret())
    .update(value)
    .digest("base64url");
}

function getCodeHashKeyMaterial(salt: string) {
  return `${getZionAdminCookieSecret()}:${salt}:zion-admin-code`;
}

export function generateZionAdminVerificationCode() {
  const maxValue = 10 ** ZION_ADMIN_2FA_CODE_LENGTH;
  return String(randomInt(0, maxValue)).padStart(ZION_ADMIN_2FA_CODE_LENGTH, "0");
}

export function getZionAdminChallengeExpiresAt(now = new Date()) {
  return new Date(now.getTime() + ZION_ADMIN_2FA_CODE_TTL_MINUTES * 60 * 1000);
}

export function hashZionAdminVerificationCode(code: string) {
  const normalizedCode = String(code || "").replace(/\D/g, "");

  if (normalizedCode.length !== ZION_ADMIN_2FA_CODE_LENGTH) {
    throw new Error("Código admin inválido para hash.");
  }

  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(
    normalizedCode,
    getCodeHashKeyMaterial(salt),
    64
  ).toString("hex");

  return `v1:${salt}:${derived}`;
}

export function verifyZionAdminVerificationCode(code: string, storedHash: string) {
  const normalizedCode = String(code || "").replace(/\D/g, "");
  const normalizedStoredHash = String(storedHash || "").trim();

  if (normalizedCode.length !== ZION_ADMIN_2FA_CODE_LENGTH || !normalizedStoredHash) {
    return false;
  }

  const [version, salt, expectedHex] = normalizedStoredHash.split(":");

  if (version !== "v1" || !salt || !expectedHex) {
    return false;
  }

  const derivedHex = scryptSync(
    normalizedCode,
    getCodeHashKeyMaterial(salt),
    64
  ).toString("hex");

  const expectedBuffer = Buffer.from(expectedHex, "hex");
  const derivedBuffer = Buffer.from(derivedHex, "hex");

  if (expectedBuffer.length === 0 || expectedBuffer.length !== derivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, derivedBuffer);
}

export function getZionAdminSecondFactorCookieOptions(): ZionAdminSecondFactorCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/zion-admin",
    maxAge: ZION_ADMIN_2FA_COOKIE_TTL_HOURS * 60 * 60,
  };
}

export function buildZionAdminSecondFactorCookie(
  userId: string,
  now = new Date()
): ZionAdminSecondFactorCookieValue {
  const normalizedUserId = String(userId || "").trim();

  if (!normalizedUserId) {
    throw new Error("userId é obrigatório para gerar cookie admin.");
  }

  const payload: ZionAdminSecondFactorCookiePayload = {
    userId: normalizedUserId,
    verifiedAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + ZION_ADMIN_2FA_COOKIE_TTL_HOURS * 60 * 60 * 1000
    ).toISOString(),
  };

  const serializedPayload = JSON.stringify(payload);
  const encodedPayload = toBase64Url(serializedPayload);
  const signature = signZionAdminValue(encodedPayload);

  return {
    payload,
    value: `${encodedPayload}.${signature}`,
  };
}

export function verifyZionAdminSecondFactorCookie(
  rawCookieValue: string | null | undefined,
  expectedUserId?: string | null
) {
  const value = String(rawCookieValue || "").trim();

  if (!value) {
    return null;
  }

  const separatorIndex = value.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return null;
  }

  const encodedPayload = value.slice(0, separatorIndex);
  const providedSignature = value.slice(separatorIndex + 1);
  const expectedSignature = signZionAdminValue(encodedPayload);

  const providedBuffer = Buffer.from(providedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    providedBuffer.length === 0 ||
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      fromBase64Url(encodedPayload)
    ) as ZionAdminSecondFactorCookiePayload;

    if (!payload?.userId || !payload?.verifiedAt || !payload?.expiresAt) {
      return null;
    }

    if (expectedUserId && payload.userId !== String(expectedUserId).trim()) {
      return null;
    }

    const expiresAt = Date.parse(payload.expiresAt);

    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function buildClearZionAdminSecondFactorCookie() {
  return {
    name: ZION_ADMIN_2FA_COOKIE_NAME,
    value: "",
    options: {
      ...getZionAdminSecondFactorCookieOptions(),
      maxAge: 0,
    },
  };
}

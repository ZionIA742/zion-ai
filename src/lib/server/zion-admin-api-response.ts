import { NextResponse } from "next/server";
import type { ZionAdminApiAccessDenied } from "./zion-admin-api-access";

export function createZionAdminApiDeniedResponse(
  access: ZionAdminApiAccessDenied,
) {
  const publicPayload = {
    ok: access.payload.ok,
    error: access.payload.error,
    message: access.payload.message,
    status: access.payload.status,
    reasonCode: access.payload.reasonCode,
  };

  return NextResponse.json(publicPayload, {
    status: access.httpStatus,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function createZionAdminApiJsonResponse(
  payload: Readonly<unknown>,
  status: number,
) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

import { NextResponse } from "next/server";
import type { StoreApiAccessDenied } from "./store-api-access";

export function createStoreApiDeniedResponse(access: StoreApiAccessDenied) {
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

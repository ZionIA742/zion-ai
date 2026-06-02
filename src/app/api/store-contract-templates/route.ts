import { NextResponse } from "next/server";
import {
  buildStoreContractTemplateErrorResponse,
  listStoreContractTemplate,
} from "@/lib/server/store-contract-templates/template-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const storeId = String(url.searchParams.get("storeId") || "").trim();
    const organizationId = String(url.searchParams.get("organizationId") || "").trim();

    const result = await listStoreContractTemplate({
      storeId,
      organizationId: organizationId || null,
    });

    return NextResponse.json(
      {
        ok: true,
        store: result.store,
        template: result.template,
        activeVersion: result.activeVersion,
        versions: result.versions,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return buildStoreContractTemplateErrorResponse(error);
  }
}

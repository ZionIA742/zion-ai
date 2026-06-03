import { NextResponse } from "next/server";
import {
  analyzeStoreContractTemplateVersion,
  buildStoreContractTemplateErrorResponse,
} from "@/lib/server/store-contract-templates/template-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ versionId: string }> }
) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          storeId?: string | null;
          organizationId?: string | null;
        }
      | null;
    const { versionId: rawVersionId } = await context.params;

    const result = await analyzeStoreContractTemplateVersion({
      versionId: String(rawVersionId || "").trim(),
      storeId: String(body?.storeId || "").trim(),
      organizationId: String(body?.organizationId || "").trim() || null,
    });

    return NextResponse.json(
      {
        ok: true,
        store: result.store,
        template: result.template,
        activeVersion: result.activeVersion,
        versions: result.versions,
        analyzedVersion: result.analyzedVersion,
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

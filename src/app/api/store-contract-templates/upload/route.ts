import { NextResponse } from "next/server";
import {
  buildStoreContractTemplateErrorResponse,
  uploadStoreContractTemplateVersion,
} from "@/lib/server/store-contract-templates/template-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const storeId = String(formData.get("storeId") || "").trim();
    const organizationId = String(formData.get("organizationId") || "").trim();
    const fileEntry = formData.get("file");

    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          error: "FILE_REQUIRED",
          message: "Selecione um arquivo valido do contrato base.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const result = await uploadStoreContractTemplateVersion({
      storeId,
      organizationId: organizationId || null,
      file: fileEntry,
    });

    return NextResponse.json(
      {
        ok: true,
        store: result.store,
        template: result.template,
        activeVersion: result.activeVersion,
        versions: result.versions,
        extractedRules: result.extractedRules,
        uploadedVersion: result.uploadedVersion,
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

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORAGE_BUCKET = "zion-store-files";
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const SIGNED_URL_EXPIRATION_SECONDS = 60 * 30;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type MembershipRow = {
  organization_id: string;
};

type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
};

type StoreBrandingSettingsRow = {
  id: string;
  organization_id: string;
  store_id: string;
  logo_storage_bucket: string | null;
  logo_storage_path: string | null;
  logo_original_filename: string | null;
  logo_mime_type: string | null;
  logo_size_bytes: number | null;
  logo_uploaded_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function getServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service role nao configurada.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function normalizeMimeType(value: string | null | undefined) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function sanitizeFileName(fileName: string) {
  const normalized = String(fileName || "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "");
  const parts = normalized.split(".");
  const extension = parts.length > 1 ? parts.pop() || "" : "";
  const baseName = parts.join(".") || normalized;
  const safeBaseName = baseName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const safeExtension = extension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 10);

  if (safeBaseName && safeExtension) return `${safeBaseName}.${safeExtension}`;
  if (safeBaseName) return safeBaseName;
  if (safeExtension) return `logo.${safeExtension}`;
  return "logo";
}

function replaceFileExtension(fileName: string, extension: string) {
  const normalizedExtension = String(extension || "")
    .trim()
    .replace(/^\.+/, "")
    .toLowerCase();
  const sanitizedFileName = sanitizeFileName(fileName);
  const lastDotIndex = sanitizedFileName.lastIndexOf(".");
  const baseName = lastDotIndex > 0 ? sanitizedFileName.slice(0, lastDotIndex) : sanitizedFileName;

  if (!normalizedExtension) {
    return baseName || "logo";
  }

  return `${baseName || "logo"}.${normalizedExtension}`;
}

function buildStoragePath(args: { organizationId: string; storeId: string; fileName: string }) {
  const safeFileName = sanitizeFileName(args.fileName);
  return [
    args.organizationId,
    args.storeId,
    "branding",
    "logo",
    `${Date.now()}-${safeFileName}`,
  ].join("/");
}

async function resolveAuthorizedStoreContext(storeId: string) {
  const sessionSupabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await sessionSupabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "UNAUTHENTICATED",
          message: "Usuario nao autenticado.",
        },
        401
      ),
    };
  }

  const safeStoreId = String(storeId || "").trim();
  if (!safeStoreId) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "INVALID_STORE_ID",
          message: "Store ID nao informado.",
        },
        400
      ),
    };
  }

  const serviceSupabase = getServiceSupabaseClient();
  const { data: memberships, error: membershipError } = await serviceSupabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id);

  if (membershipError) {
    throw membershipError;
  }

  const organizationIds = Array.from(
    new Set(
      ((memberships ?? []) as MembershipRow[])
        .map((membership) => String(membership.organization_id || "").trim())
        .filter(Boolean)
    )
  );

  if (organizationIds.length === 0) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "FORBIDDEN",
          message: "Usuario sem acesso a lojas.",
        },
        403
      ),
    };
  }

  const { data: store, error: storeError } = await serviceSupabase
    .from("stores")
    .select("id, organization_id, name")
    .eq("id", safeStoreId)
    .maybeSingle<StoreRow>();

  if (storeError) {
    throw storeError;
  }

  if (!store) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "STORE_NOT_FOUND",
          message: "Loja nao encontrada.",
        },
        404
      ),
    };
  }

  if (!organizationIds.includes(store.organization_id)) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "FORBIDDEN",
          message: "Voce nao pode acessar esta loja.",
        },
        403
      ),
    };
  }

  return {
    ok: true as const,
    user,
    supabase: serviceSupabase,
    store,
  };
}

async function loadBranding(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
  organizationId: string,
  storeId: string
) {
  const { data, error } = await supabase
    .from("store_branding_settings")
    .select(
      "id, organization_id, store_id, logo_storage_bucket, logo_storage_path, logo_original_filename, logo_mime_type, logo_size_bytes, logo_uploaded_at, created_at, updated_at"
    )
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .maybeSingle<StoreBrandingSettingsRow>();

  if (error) {
    throw error;
  }

  return (data ?? null) as StoreBrandingSettingsRow | null;
}

async function createBrandingSignedUrl(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
  branding: StoreBrandingSettingsRow | null
) {
  const bucket = String(branding?.logo_storage_bucket || "").trim();
  const path = String(branding?.logo_storage_path || "").trim();

  if (!bucket || !path) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_EXPIRATION_SECONDS);

  if (error) {
    throw error;
  }

  return data?.signedUrl || null;
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const storeId = String(searchParams.get("storeId") || "").trim();
    const auth = await resolveAuthorizedStoreContext(storeId);

    if (!auth.ok) {
      return auth.response;
    }

    const branding = await loadBranding(auth.supabase, auth.store.organization_id, auth.store.id);
    const signedUrl = await createBrandingSignedUrl(auth.supabase, branding);

    return buildJsonResponse({
      ok: true,
      branding,
      signedUrl,
    });
  } catch (error: any) {
    console.error("[api/store-branding/logo][GET] error:", error);
    return buildJsonResponse(
      {
        ok: false,
        error: "LOAD_STORE_BRANDING_FAILED",
        message: "Nao foi possivel carregar a logo da loja.",
      },
      500
    );
  }
}

export async function POST(request: Request) {
  let uploadedStoragePath: string | null = null;
  let serviceSupabaseForCleanup: ReturnType<typeof getServiceSupabaseClient> | null = null;

  try {
    const formData = await request.formData();
    const storeId = String(formData.get("storeId") || "").trim();
    const fileEntry = formData.get("file");
    const auth = await resolveAuthorizedStoreContext(storeId);

    if (!auth.ok) {
      return auth.response;
    }

    serviceSupabaseForCleanup = auth.supabase;

    if (!(fileEntry instanceof File)) {
      return buildJsonResponse(
        {
          ok: false,
          error: "FILE_REQUIRED",
          message: "Selecione uma imagem valida para a logo.",
        },
        400
      );
    }

    if (fileEntry.size <= 0) {
      return buildJsonResponse(
        {
          ok: false,
          error: "EMPTY_FILE",
          message: "A imagem enviada esta vazia.",
        },
        400
      );
    }

    if (fileEntry.size > MAX_FILE_SIZE_BYTES) {
      return buildJsonResponse(
        {
          ok: false,
          error: "FILE_TOO_LARGE",
          message: "A logo deve ter no maximo 2 MB.",
        },
        400
      );
    }

    const mimeType = normalizeMimeType(fileEntry.type);
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
      return buildJsonResponse(
        {
          ok: false,
          error: "INVALID_FILE_TYPE",
          message: "Envie uma imagem PNG, JPEG ou WebP.",
        },
        400
      );
    }

    const existingBranding = await loadBranding(
      auth.supabase,
      auth.store.organization_id,
      auth.store.id
    );
    const oldBucket = String(existingBranding?.logo_storage_bucket || "").trim();
    const oldPath = String(existingBranding?.logo_storage_path || "").trim();
    let uploadBody: File | Buffer = fileEntry;
    let finalFileName = fileEntry.name;
    let finalMimeType = mimeType;
    let finalSizeBytes = fileEntry.size;

    if (mimeType === "image/webp") {
      try {
        const inputBuffer = Buffer.from(await fileEntry.arrayBuffer());
        const convertedBuffer = await sharp(inputBuffer).png().toBuffer();
        uploadBody = convertedBuffer;
        finalFileName = replaceFileExtension(fileEntry.name, "png");
        finalMimeType = "image/png";
        finalSizeBytes = convertedBuffer.byteLength;
      } catch (conversionError) {
        console.error("[api/store-branding/logo][POST] webp conversion error:", conversionError);
        return buildJsonResponse(
          {
            ok: false,
            error: "STORE_BRANDING_WEBP_CONVERSION_FAILED",
            message: "Nao foi possivel converter essa logo. Tente enviar PNG ou JPEG.",
          },
          400
        );
      }
    }

    const storagePath = buildStoragePath({
      organizationId: auth.store.organization_id,
      storeId: auth.store.id,
      fileName: finalFileName,
    });

    const { error: uploadError } = await auth.supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, uploadBody, {
        cacheControl: "3600",
        upsert: false,
        contentType: finalMimeType,
      });

    if (uploadError) {
      throw uploadError;
    }

    uploadedStoragePath = storagePath;
    const timestamp = new Date().toISOString();
    const payload = {
      logo_storage_bucket: STORAGE_BUCKET,
      logo_storage_path: storagePath,
      logo_original_filename: finalFileName,
      logo_mime_type: finalMimeType,
      logo_size_bytes: finalSizeBytes,
      logo_uploaded_at: timestamp,
      updated_at: timestamp,
    };

    if (existingBranding?.id) {
      const { error: updateError } = await auth.supabase
        .from("store_branding_settings")
        .update(payload)
        .eq("id", existingBranding.id)
        .eq("organization_id", auth.store.organization_id)
        .eq("store_id", auth.store.id);

      if (updateError) {
        throw updateError;
      }
    } else {
      const { error: insertError } = await auth.supabase.from("store_branding_settings").insert({
        organization_id: auth.store.organization_id,
        store_id: auth.store.id,
        ...payload,
      });

      if (insertError) {
        throw insertError;
      }
    }

    let warning: string | null = null;
    if (oldBucket && oldPath && (oldBucket !== STORAGE_BUCKET || oldPath !== storagePath)) {
      const { error: removeOldError } = await auth.supabase.storage.from(oldBucket).remove([oldPath]);
      if (removeOldError) {
        warning = "Logo salva, mas nao foi possivel remover o arquivo anterior.";
      }
    }

    const branding = await loadBranding(auth.supabase, auth.store.organization_id, auth.store.id);
    const signedUrl = await createBrandingSignedUrl(auth.supabase, branding);

    return buildJsonResponse({
      ok: true,
      branding,
      signedUrl,
      warning,
    });
  } catch (error: any) {
    console.error("[api/store-branding/logo][POST] error:", error);

    if (uploadedStoragePath && serviceSupabaseForCleanup) {
      await serviceSupabaseForCleanup.storage.from(STORAGE_BUCKET).remove([uploadedStoragePath]);
    }

    return buildJsonResponse(
      {
        ok: false,
        error: "SAVE_STORE_BRANDING_FAILED",
        message: "Nao foi possivel salvar a logo.",
      },
      500
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const storeId = String(body?.storeId || "").trim();
    const auth = await resolveAuthorizedStoreContext(storeId);

    if (!auth.ok) {
      return auth.response;
    }

    const branding = await loadBranding(auth.supabase, auth.store.organization_id, auth.store.id);
    const oldBucket = String(branding?.logo_storage_bucket || "").trim();
    const oldPath = String(branding?.logo_storage_path || "").trim();

    const { error: updateError } = await auth.supabase
      .from("store_branding_settings")
      .update({
        logo_storage_bucket: null,
        logo_storage_path: null,
        logo_original_filename: null,
        logo_mime_type: null,
        logo_size_bytes: null,
        logo_uploaded_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", auth.store.organization_id)
      .eq("store_id", auth.store.id);

    if (updateError) {
      throw updateError;
    }

    let warning: string | null = null;
    if (oldBucket && oldPath) {
      const { error: removeStorageError } = await auth.supabase.storage.from(oldBucket).remove([oldPath]);
      if (removeStorageError) {
        warning =
          "Logo removida da configuracao, mas nao foi possivel apagar o arquivo anterior.";
      }
    }

    const nextBranding = await loadBranding(auth.supabase, auth.store.organization_id, auth.store.id);

    return buildJsonResponse({
      ok: true,
      branding: nextBranding,
      signedUrl: null,
      warning,
    });
  } catch (error: any) {
    console.error("[api/store-branding/logo][DELETE] error:", error);
    return buildJsonResponse(
      {
        ok: false,
        error: "DELETE_STORE_BRANDING_FAILED",
        message: "Nao foi possivel remover a logo.",
      },
      500
    );
  }
}

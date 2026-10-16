import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import ZionAdminDashboardClient, {
  type ZionAdminOverview,
} from "./ZionAdminDashboardClient";
import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";

async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {
          // Server Component: não altera cookies aqui.
        },
        remove() {
          // Server Component: não altera cookies aqui.
        },
      },
    }
  );
}

async function getZionAdminOverview(): Promise<{
  data: ZionAdminOverview | null;
  error: string | null;
}> {
  try {
    const headerStore = await headers();
    const cookieStore = await cookies();

    const host = headerStore.get("host");
    const protocol = headerStore.get("x-forwarded-proto") ?? "http";

    if (!host) {
      return {
        data: null,
        error: "Não foi possível identificar o endereço interno da aplicação.",
      };
    }

    const cookieHeader = cookieStore
      .getAll()
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    const response = await fetch(`${protocol}://${host}/api/zion-admin/overview`, {
      cache: "no-store",
      headers: {
        cookie: cookieHeader,
      },
    });

    const contentType = response.headers.get("content-type") || "";
    const rawBody = await response.text();

    if (!contentType.includes("application/json")) {
      return {
        data: null,
        error:
          response.status === 401 || response.status === 403
            ? "Sessão interna não autorizada. Entre novamente no painel interno."
            : "A API interna não retornou JSON. Verifique se a rota /api/zion-admin/overview está compilando e se a sessão de admin continua válida.",
      };
    }

    const json = JSON.parse(rawBody);

    if (!response.ok) {
      return {
        data: null,
        error: json?.error ?? "Falha ao carregar dados internos do ZION.",
      };
    }

    return {
      data: json as ZionAdminOverview,
      error: null,
    };
  } catch (error: unknown) {
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao buscar dados internos.",
    };
  }
}

export default async function ZionAdminDashboardPage() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/zion-admin/login");
  }

  const { data: admin, error: adminError } = await supabase
    .from("zion_internal_admins")
    .select("id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (adminError || !admin) {
    redirect("/zion-admin/login");
  }

  const overview = await getZionAdminOverview();
  const pinAccess = await resolveZionAdminApiAccess({
    requiredCapability: "manage_whatsapp_pins",
  });

  return (
    <ZionAdminDashboardClient
      adminRole={String(admin.role || "admin")}
      canManageWhatsappPins={pinAccess.ok}
      whatsappPinRecoveryMetaEnabled={process.env.ZION_WHATSAPP_PIN_RECOVERY_META_ENABLED === "true"}
      initialData={overview.data}
      initialError={overview.error}
    />
  );
}

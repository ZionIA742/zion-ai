import { NextResponse } from "next/server";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
  type StoreApiAccessRequirement,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ViaCepPayload = {
  erro?: boolean;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

type StoreCepRouteDeps = {
  resolveAccess: (params: {
    requirement: StoreApiAccessRequirement;
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  fetchCep: typeof fetch;
};

function onlyCepDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 8);
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function createStoreCepGetHandler(deps: Partial<StoreCepRouteDeps> = {}) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const fetchCep = deps.fetchCep ?? fetch;

  return async function GET(request: Request) {
    const access = await resolveAccess({
      requirement: "active_or_onboarding",
    });

    if (!access.ok) {
      return createStoreApiDeniedResponse(access);
    }

    const url = new URL(request.url);
    const cep = onlyCepDigits(url.searchParams.get("cep"));

    if (cep.length !== 8) {
      return buildJsonResponse(
        {
          ok: false,
          error: "STORE_CEP_INVALID",
          message: "Informe um CEP brasileiro com 8 digitos.",
        },
        400,
      );
    }

    try {
      const response = await fetchCep(`https://viacep.com.br/ws/${cep}/json/`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("STORE_CEP_PROVIDER_UNAVAILABLE");
      }

      const payload = (await response.json().catch(() => null)) as ViaCepPayload | null;

      if (!payload || payload.erro === true) {
        return buildJsonResponse({
          ok: true,
          found: false,
          message: "CEP nao encontrado. Voce pode preencher o endereco manualmente.",
        });
      }

      return buildJsonResponse({
        ok: true,
        found: true,
        address: {
          street: cleanText(payload.logradouro),
          district: cleanText(payload.bairro),
          city: cleanText(payload.localidade),
          state: cleanText(payload.uf).toUpperCase(),
        },
      });
    } catch {
      return buildJsonResponse(
        {
          ok: false,
          error: "STORE_CEP_LOOKUP_FAILED",
          message: "Nao foi possivel consultar o CEP agora. Voce pode preencher o endereco manualmente.",
        },
        503,
      );
    }
  };
}

export const GET = createStoreCepGetHandler();

export type CustomerGeographyLookupStatus =
  | "unique"
  | "ambiguous"
  | "not_found"
  | "lookup_failed";

export type CustomerGeographyMunicipality = {
  ibgeCode: number;
  name: string;
  normalizedName: string;
  stateCode: string;
};

export type CustomerGeographyResolution = {
  status: CustomerGeographyLookupStatus;
  normalizedCity: string;
  stateCode: string | null;
  municipality: CustomerGeographyMunicipality | null;
};

type MunicipalityQueryClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        limit(value: number): Promise<{
          data: unknown;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

export function normalizeMunicipalityLookupName(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildCustomerStateFromCityOperationKey(
  cityLastEventId: string | null | undefined,
): string | null {
  const eventId = String(cityLastEventId || "").trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      eventId,
    )
  ) {
    return null;
  }

  const operationKey =
    `p9_qfact_customer_state_from_city_v1:${eventId}:customer_state_code`;
  return operationKey.length <= 200 ? operationKey : null;
}

function parseMunicipality(row: unknown): CustomerGeographyMunicipality | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  const ibgeCode = value.ibge_code;
  const name = value.name;
  const normalizedName = value.normalized_name;
  const stateCode = value.state_code;

  if (
    typeof ibgeCode !== "number" ||
    !Number.isInteger(ibgeCode) ||
    ibgeCode < 1000000 ||
    ibgeCode > 9999999 ||
    typeof name !== "string" ||
    name.trim() === "" ||
    typeof normalizedName !== "string" ||
    typeof stateCode !== "string" ||
    !/^[A-Z]{2}$/.test(stateCode) ||
    normalizedName !== normalizeMunicipalityLookupName(name)
  ) {
    return null;
  }

  return { ibgeCode, name, normalizedName, stateCode };
}

export async function resolveCustomerStateCodeFromCity(args: {
  supabase: MunicipalityQueryClient;
  cityValue: string;
}): Promise<CustomerGeographyResolution> {
  const normalizedCity = normalizeMunicipalityLookupName(args.cityValue);
  if (!normalizedCity) {
    return {
      status: "not_found",
      normalizedCity,
      stateCode: null,
      municipality: null,
    };
  }

  const { data, error } = await args.supabase
    .from("brazilian_municipalities")
    .select("ibge_code,name,normalized_name,state_code")
    .eq("normalized_name", normalizedCity)
    .limit(2);

  if (error || !Array.isArray(data)) {
    return {
      status: "lookup_failed",
      normalizedCity,
      stateCode: null,
      municipality: null,
    };
  }

  if (data.length === 0) {
    return {
      status: "not_found",
      normalizedCity,
      stateCode: null,
      municipality: null,
    };
  }

  if (data.length > 1) {
    return {
      status: "ambiguous",
      normalizedCity,
      stateCode: null,
      municipality: null,
    };
  }

  const municipality = parseMunicipality(data[0]);
  if (!municipality || municipality.normalizedName !== normalizedCity) {
    return {
      status: "lookup_failed",
      normalizedCity,
      stateCode: null,
      municipality: null,
    };
  }

  return {
    status: "unique",
    normalizedCity,
    stateCode: municipality.stateCode,
    municipality,
  };
}

export type StoreGeneralAddressLike = {
  has_public_address?: boolean | null;
  cep?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
};

const ROUTE_DESTINATION_KEYS = [
  "address_text",
  "addressText",
  "address",
  "location_text",
  "locationText",
  "customer_address",
  "customerAddress",
];

export function cleanRouteAddressPart(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function getTextFromRoutePayload(
  payload: Record<string, unknown> | null | undefined,
  keys = ROUTE_DESTINATION_KEYS
) {
  if (!payload) return null;

  for (const key of keys) {
    const safeValue = cleanRouteAddressPart(payload[key]);
    if (safeValue) return safeValue;
  }

  return null;
}

export function buildStoreAddressText(row: StoreGeneralAddressLike | null | undefined) {
  if (!row?.has_public_address) return null;

  const street = cleanRouteAddressPart(row.street);
  const number = cleanRouteAddressPart(row.number);
  const district = cleanRouteAddressPart(row.district);
  const city = cleanRouteAddressPart(row.city);
  const state = cleanRouteAddressPart(row.state);

  if (!street || !number || !district || !city || !state) {
    return null;
  }

  const complement = cleanRouteAddressPart(row.complement);
  const cep = cleanRouteAddressPart(row.cep);

  return [
    `${street}, ${number}`,
    complement,
    district,
    `${city} - ${state}`,
    cep ? `CEP ${cep}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function buildGoogleMapsDirectionsUrl(args: {
  origin?: string | null;
  destination?: string | null;
}) {
  const origin = cleanRouteAddressPart(args.origin);
  const destination = cleanRouteAddressPart(args.destination);

  if (!origin || !destination) {
    return null;
  }

  const searchParams = new URLSearchParams({
    api: "1",
    origin,
    destination,
  });

  return `https://www.google.com/maps/dir/?${searchParams.toString()}`;
}


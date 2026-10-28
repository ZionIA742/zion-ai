export type DailyPtaxRate = {
  date: string;
  quotationDate: string | null;
  rate: string | null;
  status: "same_day" | "previous_available" | "unavailable";
};

export type DailyPtaxReport = {
  source: "bcb_ptax_venda";
  daily: DailyPtaxRate[];
};

type PtaxResponse = {
  ok: boolean;
  json(): Promise<unknown>;
};

export type PtaxFetcher = (
  url: string,
  options: RequestInit
) => Promise<PtaxResponse>;

export class DailyPtaxError extends Error {
  constructor() {
    super("PTAX_UNAVAILABLE");
  }
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function shiftDay(value: string, offset: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function bcbDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${month}-${day}-${year}`;
}

function decimalParts(value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error("INVALID_DECIMAL");
  }
  const [whole, fraction = ""] = value.split(".");
  return {
    integer: BigInt(whole + fraction),
    scale: fraction.length,
  };
}

/**
 * USD official amount * PTAX BRL/USD -> estimated BRL.
 * Rounds only the final BRL amount to cents, half-up.
 * Never uses JavaScript floating-point multiplication.
 */
export function convertOfficialUsdToBrl(
  amountUsd: string,
  rateBrlPerUsd: string
): string {
  const amount = decimalParts(amountUsd);
  const rate = decimalParts(rateBrlPerUsd);

  if (rate.integer <= BigInt(0)) {
    throw new Error("INVALID_RATE");
  }

  const numerator = amount.integer * rate.integer * BigInt(100);
  const divisor = BigInt(10) ** BigInt(amount.scale + rate.scale);
  const cents = (numerator * BigInt(2) + divisor) / (divisor * BigInt(2));

  const whole = cents / BigInt(100);
  const fraction = (cents % BigInt(100)).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

/**
 * PTAX de venda BCB. A data do gasto usa a cotacao
 * do proprio dia ou a ultima anterior disponivel
 * dentro de uma janela de dez dias corridos.
 */
export async function loadDailyPtaxRates(
  from: string,
  to: string,
  fetcher: PtaxFetcher = (url, options) => fetch(url, options)
): Promise<DailyPtaxReport> {
  if (!validDate(from) || !validDate(to)) {
    throw new DailyPtaxError();
  }

  const count =
    (Date.parse(`${to}T00:00:00Z`) -
      Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;

  if (count < 1 || count > 366) {
    throw new DailyPtaxError();
  }

  const beginning = shiftDay(from, -10);

  const params = new URLSearchParams({
    "@dataInicial": `'${bcbDate(beginning)}'`,
    "@dataFinalCotacao": `'${bcbDate(to)}'`,
    "$top": "1500",
    "$select": "cotacaoVenda,dataHoraCotacao",
    "$orderby": "dataHoraCotacao asc",
    "$format": "json",
  });

  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/" +
    "versao/v1/odata/CotacaoDolarPeriodo" +
    "(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?" +
    params.toString();

  let body: unknown;

  try {
    const response = await fetcher(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) throw new DailyPtaxError();
    body = await response.json();
  } catch {
    throw new DailyPtaxError();
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("value" in body) ||
    !Array.isArray(body.value) ||
    body.value.length >= 1500
  ) {
    throw new DailyPtaxError();
  }

  const quotations = new Map<
    string,
    { timestamp: string; rate: string }
  >();

  for (const entry of body.value) {
    if (!entry || typeof entry !== "object") {
      throw new DailyPtaxError();
    }

    const row = entry as Record<string, unknown>;
    const timestamp = String(row.dataHoraCotacao ?? "");
    const date = timestamp.slice(0, 10);
    const rate = String(row.cotacaoVenda ?? "");

    if (
      !validDate(date) ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rate) ||
      Number(rate) <= 0 ||
      Number(rate) >= 1000
    ) {
      throw new DailyPtaxError();
    }

    const existing = quotations.get(date);

    if (!existing || timestamp > existing.timestamp) {
      quotations.set(date, { timestamp, rate });
    }
  }

  const daily: DailyPtaxRate[] = [];

  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    let quotationDate: string | null = null;
    let rate: string | null = null;

    for (let offset = 0; offset <= 10; offset++) {
      const candidate = shiftDay(day, -offset);
      const quotation = quotations.get(candidate);

      if (quotation) {
        quotationDate = candidate;
        rate = quotation.rate;
        break;
      }
    }

    daily.push({
      date: day,
      quotationDate,
      rate,
      status: rate === null
        ? "unavailable"
        : quotationDate === day
          ? "same_day"
          : "previous_available",
    });
  }

  return { source: "bcb_ptax_venda", daily };
}

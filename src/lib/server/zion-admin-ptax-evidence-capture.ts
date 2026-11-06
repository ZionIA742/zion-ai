/**
 * ZION-ADM | 2.3-C.1-B.8-D.5
 *
 * Captura a resposta JSON obtida na mesma consulta PTAX
 * validada pelo leitor financeiro existente.
 *
 * Nao grava no banco, nao cria cron e nao habilita
 * autoridade financeira para o fechamento.
 */

import {
  DailyPtaxError,
  loadDailyPtaxRates,
  type DailyPtaxReport,
  type PtaxFetcher,
} from "./zion-admin-ptax-daily";

export type ValidatedPtaxEvidence = {
  source: "bcb_ptax_venda";
  requestedFrom: string;
  requestedTo: string;
  requestStartedAt: string;
  requestFinishedAt: string;
  endpointUrl: string;
  responsePayload: Record<string, unknown>;
  resultCount: number;
};

export type ValidatedPtaxCapture = {
  report: DailyPtaxReport;
  evidence: ValidatedPtaxEvidence;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

/**
 * Uma unica chamada a fonte.
 *
 * A evidencia somente e entregue quando
 * loadDailyPtaxRates valida integralmente a resposta.
 *
 * O fetcher e o relogio injetaveis apenas para
 * testes e integracao controlada.
 */
export async function captureValidatedPtaxCollection(
  from: string,
  to: string,
  fetcher: PtaxFetcher = (url, options) => fetch(url, options),
  clock: () => Date = () => new Date(),
): Promise<ValidatedPtaxCapture> {
  let captured: ValidatedPtaxEvidence | null = null;

  const intercept: PtaxFetcher = async (url, options) => {
    const startedAt = clock();

    const response = await fetcher(url, options);

    return {
      ok: response.ok,

      async json(): Promise<unknown> {
        const body = await response.json();
        const finishedAt = clock();

        if (isRecord(body) && Array.isArray(body.value)) {
          captured = {
            source: "bcb_ptax_venda",
            requestedFrom: from,
            requestedTo: to,
            requestStartedAt: startedAt.toISOString(),
            requestFinishedAt: finishedAt.toISOString(),
            endpointUrl: url,
            responsePayload: body,
            resultCount: body.value.length,
          };
        }

        return body;
      },
    };
  };

  // A validacao canonica deve passar antes de devolver a evidencia.
  const report = await loadDailyPtaxRates(from, to, intercept);

  if (captured === null) {
    throw new DailyPtaxError();
  }

  const evidence: ValidatedPtaxEvidence = captured;

  const started = Date.parse(evidence.requestStartedAt);
  const finished = Date.parse(evidence.requestFinishedAt);

  if (
    !Number.isFinite(started) ||
    !Number.isFinite(finished) ||
    finished < started ||
    evidence.source !== report.source
  ) {
    throw new DailyPtaxError();
  }

  return { report, evidence };
}
export type ColunaId =
  | "novo_lead"
  | "qualificacao"
  | "orcamento"
  | "negociacao"
  | "fechamento_pagamento"
  | "pagamento_pendente_confirmacao"
  | "agendar_visita"
  | "agendar_instalacao"
  | "pos_venda_nps"
  | "perdido"
  | "humano_assumiu";

export type Nivel = "ok" | "pendente" | "critico";

export const COLUNAS: { id: ColunaId; titulo: string }[] = [
  { id: "novo_lead", titulo: "Novo Lead" },
  { id: "qualificacao", titulo: "Qualificacao" },
  { id: "orcamento", titulo: "Orcamento" },
  { id: "negociacao", titulo: "Negociacao" },
  { id: "fechamento_pagamento", titulo: "Fechamento / Pagamento" },
  { id: "agendar_instalacao", titulo: "Instalacao / Entrega" },
  { id: "pos_venda_nps", titulo: "Pos-venda / Follow-up" },
  { id: "perdido", titulo: "Perdido" },
];

export function nivelBaseDaColuna(id: ColunaId): Nivel {
  if (id === "perdido" || id === "humano_assumiu") return "critico";
  if (id === "fechamento_pagamento" || id === "pagamento_pendente_confirmacao")
    return "pendente";
  return "ok";
}

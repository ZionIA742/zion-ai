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
  | "humano_assumiu"

export type Nivel = "ok" | "pendente" | "critico"

export const COLUNAS: { id: ColunaId; titulo: string }[] = [
  { id: "novo_lead", titulo: "Novo Lead" },
  { id: "qualificacao", titulo: "Qualificação" },
  { id: "orcamento", titulo: "Orçamento" },
  { id: "negociacao", titulo: "Negociação" },
  { id: "fechamento_pagamento", titulo: "Fechamento / Pagamento" },
  { id: "pagamento_pendente_confirmacao", titulo: "Pagamento Pendente" },
  { id: "agendar_visita", titulo: "Agendar Visita" },
  { id: "agendar_instalacao", titulo: "Agendar Instalação" },
  { id: "pos_venda_nps", titulo: "Pós-venda (NPS)" },
  { id: "perdido", titulo: "Perdido" },
  { id: "humano_assumiu", titulo: "Humano Assumiu" },
]

export function nivelBaseDaColuna(id: ColunaId): Nivel {
  if (id === "perdido" || id === "humano_assumiu") return "critico"
  if (id === "fechamento_pagamento" || id === "pagamento_pendente_confirmacao")
    return "pendente"
  return "ok"
}
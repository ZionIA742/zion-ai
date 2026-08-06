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

export type CanonicalCrmStageId =
  | "novo_lead"
  | "qualificacao"
  | "orcamento"
  | "visita_tecnica"
  | "negociacao"
  | "fechamento_pagamento"
  | "instalacao_entrega"
  | "pos_venda"
  | "perdido"
  | "concluido_sem_mais_acoes";

export type CanonicalCrmStageArea = "pipeline" | "lost" | "completed";

export type CanonicalCrmStageDefinition = {
  id: CanonicalCrmStageId;
  title: string;
  order: number;
  area: CanonicalCrmStageArea;
  nivel: Nivel;
};

export const CANONICAL_CRM_STAGES: CanonicalCrmStageDefinition[] = [
  { id: "novo_lead", title: "Novo Lead", order: 1, area: "pipeline", nivel: "ok" },
  { id: "qualificacao", title: "Qualificacao", order: 2, area: "pipeline", nivel: "ok" },
  { id: "orcamento", title: "Orcamento", order: 3, area: "pipeline", nivel: "ok" },
  { id: "visita_tecnica", title: "Visita Tecnica", order: 4, area: "pipeline", nivel: "pendente" },
  { id: "negociacao", title: "Negociacao", order: 5, area: "pipeline", nivel: "ok" },
  {
    id: "fechamento_pagamento",
    title: "Fechamento / Pagamento",
    order: 6,
    area: "pipeline",
    nivel: "pendente",
  },
  {
    id: "instalacao_entrega",
    title: "Instalacao / Entrega",
    order: 7,
    area: "pipeline",
    nivel: "pendente",
  },
  { id: "pos_venda", title: "Pos-venda", order: 8, area: "pipeline", nivel: "ok" },
  { id: "perdido", title: "Perdido", order: 9, area: "lost", nivel: "critico" },
  {
    id: "concluido_sem_mais_acoes",
    title: "Concluido sem mais acoes",
    order: 10,
    area: "completed",
    nivel: "ok",
  },
];

export function getCanonicalCrmStage(
  value: string | null | undefined
): CanonicalCrmStageDefinition | null {
  const normalized = String(value || "").trim().toLowerCase();
  return CANONICAL_CRM_STAGES.find((stage) => stage.id === normalized) || null;
}

export const COLUNAS: { id: ColunaId; titulo: string }[] = [
  { id: "novo_lead", titulo: "Novo Lead" },
  { id: "qualificacao", titulo: "Qualificação" },
  { id: "orcamento", titulo: "Orçamento" },
  { id: "negociacao", titulo: "Negociação" },
  { id: "fechamento_pagamento", titulo: "Fechamento / Pagamento" },
  { id: "agendar_instalacao", titulo: "Instalação / Entrega" },
  { id: "pos_venda_nps", titulo: "Pós-venda / Follow-up" },
  { id: "perdido", titulo: "Perdido" },
];

export function nivelBaseDaColuna(id: ColunaId): Nivel {
  if (id === "perdido" || id === "humano_assumiu") return "critico";
  if (id === "fechamento_pagamento" || id === "pagamento_pendente_confirmacao")
    return "pendente";
  return "ok";
}

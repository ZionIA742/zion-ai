"use client";

import { useMemo, useState } from "react";

type HelpTopic = {
  id: string;
  title: string;
  description: string;
  bullets: string[];
};

type FaqItem = {
  question: string;
  answer: string;
};

const helpTopics: HelpTopic[] = [
  {
    id: "comecando",
    title: "Começando no ZION",
    description:
      "O primeiro passo é preencher o onboarding da loja. Ele alimenta as informações básicas que o sistema e as IAs usam para trabalhar com segurança.",
    bullets: [
      "Preencha os dados da loja, horários, região atendida e regras principais.",
      "Confira as Configurações depois do onboarding para ajustar informações importantes.",
      "Cadastre piscinas, produtos, acessórios, químicos e outros itens no Catálogo.",
      "Use Inbox e CRM para acompanhar clientes, conversas e oportunidades.",
      "Use a Agenda para controlar visitas, instalações, manutenções, medições e bloqueios.",
      "Acompanhe o Dashboard para ver resultados, pendências, leads e compromissos.",
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    description:
      "O Dashboard mostra uma visão rápida do desempenho e da operação da loja.",
    bullets: [
      "Faturamento do mês mostra os valores registrados no sistema.",
      "Vendas hoje, vendas da semana e leads do mês ajudam a acompanhar o movimento comercial.",
      "Pendências mostram pontos que precisam de atenção da loja.",
      "Meta mensal aparece quando a loja configura uma meta nas Configurações ou no Onboarding.",
      "Próximos compromissos ajudam a enxergar visitas, instalações e tarefas próximas.",
      "Os números devem ser usados como apoio operacional, sempre com base nos dados cadastrados no sistema.",
    ],
  },
  {
    id: "crm",
    title: "CRM",
    description:
      "O CRM organiza os clientes por etapa comercial para a loja entender quem está começando, quem está negociando e quem precisa de atenção.",
    bullets: [
      "Novo lead: cliente novo ou oportunidade recém-chegada.",
      "Qualificação: etapa para entender interesse, região, espaço, modelo desejado e urgência.",
      "Orçamento: cliente já tem informações suficientes para avançar para valores ou proposta.",
      "Negociação: cliente está comparando, tirando dúvidas, pedindo condição ou avaliando fechar.",
      "Fechamento / Pagamento: etapa para tratar confirmação de compra, pagamento, comprovante ou próximo passo final.",
      "Instalação / Entrega: acompanhamento após a venda, quando existe entrega, instalação, visita técnica ou execução.",
      "Pós-venda / Follow-up: acompanhamento depois da compra, recompra, indicação, manutenção ou relacionamento.",
      "Perdido: cliente desistiu, não respondeu, saiu da região atendida ou não avançou.",
      "Badges como Humano assumiu, Pedido de visita, Pagamento pendente e Ação humana necessária são avisos operacionais, não etapas principais do funil.",
    ],
  },
  {
    id: "inbox",
    title: "Inbox",
    description:
      "A Inbox concentra as conversas com clientes e permite acompanhar o histórico do atendimento.",
    bullets: [
      "Use a Inbox para ler mensagens, responder manualmente e acompanhar o contexto da conversa.",
      "Quando o humano assume uma conversa, a IA vendedora não deve responder por cima.",
      "A conversa pode ter avisos de pendência, pedido de visita, orçamento ou necessidade de ação humana.",
      "Arquivos, imagens e documentos enviados pelo cliente devem ser analisados com cuidado quando estiverem disponíveis.",
      "Antes de tomar decisões sensíveis, confira o histórico da conversa e os dados do cliente.",
    ],
  },
  {
    id: "agenda",
    title: "Agenda",
    description:
      "A Agenda organiza compromissos da loja, como visitas, instalações, manutenções, medições e bloqueios.",
    bullets: [
      "Use a Agenda para visualizar compromissos por dia e acompanhar o que precisa ser feito.",
      "Compromissos podem ser criados, remarcados, cancelados ou concluídos conforme as regras do sistema.",
      "Bloqueios servem para impedir agendamentos em horários ou dias indisponíveis.",
      "Quando um compromisso envolve cliente, alterações importantes devem ser comunicadas ao cliente.",
      "A IA assistente pode ajudar a consultar a agenda e preparar ações, mas não deve afirmar que alterou algo se a alteração não aconteceu no banco.",
    ],
  },
  {
    id: "ia-vendedora",
    title: "IA Vendedora",
    description:
      "A IA Vendedora ajuda no atendimento comercial dos clientes, usando as configurações da loja, o catálogo e o histórico da conversa.",
    bullets: [
      "Ela conversa com clientes, tira dúvidas e ajuda a conduzir a venda.",
      "Ela pode qualificar o lead perguntando sobre modelo desejado, espaço, região, urgência e forma de pagamento.",
      "Ela deve recomendar apenas itens ativos, vendáveis e compatíveis com o que a loja cadastrou.",
      "Ela pode ajudar o cliente a avançar para orçamento, visita, negociação ou próximo passo comercial.",
      "Ela não deve prometer prazo, desconto, garantia, instalação ou condição que não esteja configurada.",
      "Ela não confirma pagamento sozinha; comprovantes precisam de validação da loja.",
      "Quando houver situação sensível, exceção ou falta de configuração, ela deve acionar o responsável.",
    ],
  },
  {
    id: "ia-assistente",
    title: "IA Assistente",
    description:
      "A IA Assistente é a central operacional interna da loja. Ela ajuda o responsável a entender o que está acontecendo no sistema.",
    bullets: [
      "Ela pode consultar agenda, clientes, pendências, conversas, tarefas e informações importantes.",
      "Ela ajuda o responsável com resumos, alertas e próximos passos.",
      "Ela pode apoiar ações como remarcar, cancelar, criar bloqueios ou consultar compromissos, respeitando regras de segurança.",
      "Ela deve explicar o contexto de cada pendência para o humano não ficar perdido.",
      "Quando uma ação sensível exigir confirmação, ela deve pedir aprovação clara antes de executar.",
      "Futuramente, ela também pode funcionar por WhatsApp do responsável, canal separado da IA vendedora.",
    ],
  },
  {
    id: "catalogo",
    title: "Catálogo",
    description:
      "O Catálogo é a base de produtos que a IA e a loja usam para vender com mais precisão.",
    bullets: [
      "Cadastre piscinas, produtos, acessórios, químicos e outros itens vendidos pela loja.",
      "Mantenha nomes, preços, fotos, descrições e estoque atualizados.",
      "Marque como ativo apenas o que pode ser vendido ou recomendado ao cliente.",
      "Quanto melhor o catálogo, melhor a IA consegue responder e sugerir opções corretas.",
      "A importação inteligente ajuda a acelerar o cadastro, mas itens importados devem ser revisados antes de uso comercial.",
      "Fotos e descrições devem representar produtos reais para evitar promessa errada ao cliente.",
    ],
  },
  {
    id: "configuracoes",
    title: "Configurações",
    description:
      "As Configurações definem como a loja funciona e quais regras o sistema deve seguir.",
    bullets: [
      "Revise dados da loja, horários, região atendida e regras comerciais.",
      "Configure formas de pagamento aceitas e regras de Pix, quando disponíveis.",
      "Defina regras de desconto, visita técnica, follow-up e acionamento humano.",
      "Mantenha as informações atualizadas para a IA não operar com dados antigos ou incompletos.",
      "Quando uma regra não estiver configurada, a IA deve evitar prometer e pode pedir confirmação ao responsável.",
    ],
  },
];

const faqItems: FaqItem[] = [
  {
    question: "Como começo a usar o ZION?",
    answer:
      "Comece preenchendo o onboarding. Depois confira as Configurações, cadastre o catálogo, verifique a agenda e acompanhe Inbox, CRM e Dashboard no dia a dia.",
  },
  {
    question: "Como cadastrar piscinas e produtos?",
    answer:
      "Use a área de Catálogo para cadastrar piscinas, produtos, acessórios, químicos e outros itens. Inclua nome, preço, descrição, fotos, estoque e status ativo/inativo sempre que possível.",
  },
  {
    question: "Como funciona a IA Vendedora?",
    answer:
      "Ela atende clientes, tira dúvidas, qualifica leads e conduz a conversa para orçamento, visita, negociação ou próximo passo comercial. Ela usa o catálogo, as configurações e o histórico da conversa.",
  },
  {
    question: "A IA pode responder sozinha?",
    answer:
      "Sim, quando a loja tem dados suficientes configurados e a situação é segura. Em casos sensíveis, como pagamento, desconto especial, contrato, prazo, garantia ou exceção, a IA deve acionar o responsável.",
  },
  {
    question: "Como assumo uma conversa?",
    answer:
      "Pela Inbox, o responsável pode responder manualmente e assumir o atendimento. Quando o humano está no controle, a IA não deve responder por cima.",
  },
  {
    question: "A IA pode confirmar pagamento?",
    answer:
      "Não. A IA pode receber comprovante e avisar o responsável, mas a validação final de Pix, transferência, cartão, dinheiro ou qualquer pagamento é responsabilidade da loja.",
  },
  {
    question: "A IA pode mandar chave Pix?",
    answer:
      "Somente se a loja tiver cadastrado a chave Pix oficial e permitido que a IA envie essa informação. Se não estiver configurado, a IA deve pedir confirmação ao responsável.",
  },
  {
    question: "A IA pode dar desconto?",
    answer:
      "Ela pode seguir regras configuradas pela loja. Se o desconto pedido estiver fora da regra ou envolver exceção, a IA deve consultar o responsável antes de prometer qualquer condição.",
  },
  {
    question: "Como funciona o CRM?",
    answer:
      "O CRM organiza clientes por etapa comercial: Novo lead, Qualificação, Orçamento, Negociação, Fechamento / Pagamento, Instalação / Entrega, Pós-venda / Follow-up e Perdido.",
  },
  {
    question: "Como funciona a Agenda?",
    answer:
      "A Agenda mostra compromissos, visitas, instalações, manutenções, medições e bloqueios. Ela ajuda a loja a organizar horários e acompanhar tarefas relacionadas a clientes.",
  },
  {
    question: "Como funciona a IA Assistente?",
    answer:
      "Ela é uma assistente interna da loja. Ajuda o responsável a consultar informações, entender pendências, organizar agenda, acompanhar clientes e receber alertas importantes.",
  },
  {
    question: "Como pausar a IA?",
    answer:
      "A IA deve pausar quando o humano assume a conversa ou quando existe uma trava operacional. A liberação deve acontecer conforme as regras do sistema e da loja.",
  },
  {
    question: "O que acontece se o cliente estiver fora da região atendida?",
    answer:
      "A IA deve seguir a região configurada. Em casos ambíguos ou com potencial, ela pode acionar o responsável antes de recusar ou continuar o atendimento.",
  },
];

const notIncludedItems = [
  "O ZION não substitui a responsabilidade da loja nas decisões comerciais, operacionais ou financeiras.",
  "O ZION não confirma pagamentos sozinho. A validação de comprovantes, Pix, transferências, cartão ou dinheiro é responsabilidade da loja.",
  "O ZION não promete prazos, garantias, descontos, condições comerciais ou serviços que a loja não configurou ou não consegue cumprir.",
  "O ZION não assina contratos pela loja e não substitui a validação jurídica, comercial ou operacional da empresa.",
  "O ZION não garante fechamento de venda. Ele ajuda no atendimento e na condução, mas a decisão final é do cliente.",
  "O ZION não executa instalação, entrega, manutenção, medição ou visita técnica. Essas ações são responsabilidade da loja, equipe técnica ou parceiros.",
  "O ZION não deve ser usado para passar informações falsas, enganosas ou diferentes do que a loja realmente oferece.",
];

const responsibilityItems = [
  "Manter dados da loja, horários e região atendida atualizados.",
  "Manter catálogo, preços, fotos, descrições, estoque e disponibilidade corretos.",
  "Configurar corretamente formas de pagamento, Pix, regras de desconto, visita técnica e follow-up.",
  "Validar pagamentos e comprovantes antes de confirmar qualquer compra.",
  "Cumprir prazos, garantias, visitas, instalações, entregas e manutenções prometidas ao cliente.",
  "Revisar situações sensíveis quando a IA pedir ajuda ou quando houver dúvida.",
  "Garantir que as informações cadastradas no sistema sejam verdadeiras e estejam atualizadas.",
];

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matchesSearch(value: string, search: string) {
  const normalizedSearch = normalizeText(search.trim());
  if (!normalizedSearch) return true;
  return normalizeText(value).includes(normalizedSearch);
}

export default function HelpPage() {
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const filteredTopics = useMemo(() => {
    return helpTopics.filter((topic) =>
      matchesSearch(`${topic.title} ${topic.description} ${topic.bullets.join(" ")}`, search)
    );
  }, [search]);

  const filteredFaqItems = useMemo(() => {
    return faqItems.filter((item) =>
      matchesSearch(`${item.question} ${item.answer}`, search)
    );
  }, [search]);

  const shouldShowLimits = useMemo(() => {
    return matchesSearch(
      `O que o ZION não faz limites responsabilidade ${notIncludedItems.join(" ")}`,
      search
    );
  }, [search]);

  const shouldShowResponsibilities = useMemo(() => {
    return matchesSearch(
      `Responsabilidades da loja cuidados obrigação ${responsibilityItems.join(" ")}`,
      search
    );
  }, [search]);

  const hasResults =
    filteredTopics.length > 0 ||
    filteredFaqItems.length > 0 ||
    shouldShowLimits ||
    shouldShowResponsibilities;

  function toggleOpen(id: string) {
    setOpenId((current) => (current === id ? null : id));
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 text-gray-950">
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-500">
              Central de Ajuda
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-gray-950">
              Como usar o ZION
            </h1>
          </div>

          <label className="relative block w-full lg:max-w-md">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
              🔎
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Procure uma dúvida ou digite uma pergunta..."
              className="h-10 w-full rounded-xl border border-gray-300 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-gray-900"
            />
          </label>
        </div>
      </section>

      {!hasResults ? (
        <section className="rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-sm text-gray-600 shadow-sm">
          Nenhum resultado encontrado. Tente procurar por palavras como CRM, agenda,
          pagamento, IA, catálogo, desconto ou Pix.
        </section>
      ) : null}

      {filteredTopics.length > 0 ? (
        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filteredTopics.map((topic) => {
            const isOpen = openId === topic.id;

            return (
              <article
                key={topic.id}
                className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => toggleOpen(topic.id)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-gray-50"
                >
                  <span className="text-sm font-semibold text-gray-950">
                    {topic.title}
                  </span>
                  <span className="text-lg leading-none text-gray-500">
                    {isOpen ? "−" : "+"}
                  </span>
                </button>

                {isOpen ? (
                  <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="text-xs leading-5 text-gray-700">
                      {topic.description}
                    </p>
                    <ul className="mt-2 space-y-1.5 text-xs leading-5 text-gray-700">
                      {topic.bullets.map((bullet) => (
                        <li key={bullet} className="flex gap-2">
                          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-gray-900" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}

      {filteredFaqItems.length > 0 ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-gray-950">Perguntas frequentes</h2>
            <span className="text-xs text-gray-500">
              {filteredFaqItems.length} resultado(s)
            </span>
          </div>

          <div className="grid gap-2 lg:grid-cols-2">
            {filteredFaqItems.map((item) => {
              const id = `faq-${item.question}`;
              const isOpen = openId === id;

              return (
                <article
                  key={item.question}
                  className="overflow-hidden rounded-xl border border-gray-200 bg-white"
                >
                  <button
                    type="button"
                    onClick={() => toggleOpen(id)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-gray-50"
                  >
                    <span className="text-xs font-semibold leading-5 text-gray-950">
                      {item.question}
                    </span>
                    <span className="text-base leading-none text-gray-500">
                      {isOpen ? "−" : "+"}
                    </span>
                  </button>

                  {isOpen ? (
                    <p className="border-t border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-700">
                      {item.answer}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="grid gap-2 lg:grid-cols-2">
        {shouldShowLimits ? (
          <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => toggleOpen("limits")}
              className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-gray-50"
            >
              <span className="text-sm font-semibold text-gray-950">
                O que o ZION não faz
              </span>
              <span className="text-lg leading-none text-gray-500">
                {openId === "limits" ? "−" : "+"}
              </span>
            </button>

            {openId === "limits" ? (
              <ul className="border-t border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-700">
                {notIncludedItems.map((item) => (
                  <li key={item} className="mb-1.5 flex gap-2 last:mb-0">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-900" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ) : null}

        {shouldShowResponsibilities ? (
          <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => toggleOpen("responsibilities")}
              className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-gray-50"
            >
              <span className="text-sm font-semibold text-gray-950">
                Responsabilidades da loja
              </span>
              <span className="text-lg leading-none text-gray-500">
                {openId === "responsibilities" ? "−" : "+"}
              </span>
            </button>

            {openId === "responsibilities" ? (
              <ul className="border-t border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-700">
                {responsibilityItems.map((item) => (
                  <li key={item} className="mb-1.5 flex gap-2 last:mb-0">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-900" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ) : null}
      </section>
    </div>
  );
}

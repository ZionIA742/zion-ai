import type { Metadata } from "next";
import Link from "next/link";
import {
  CONTACT_EMAIL,
  LegalList,
  LegalPageLayout,
  LegalSection,
} from "../LegalPageLayout";

export const metadata: Metadata = {
  title: "Política de Privacidade do ZION",
  description:
    "Documento público com informações gerais sobre tratamento de dados, segurança, uso de inteligência artificial e contato do ZION.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout
      title="Política de Privacidade do ZION"
      description="Esta política apresenta, de forma pública e objetiva, como informações podem ser tratadas durante o uso do ZION por empresas que utilizam a plataforma em suas rotinas comerciais, operacionais e de atendimento."
    >
      <LegalSection title="1. Apresentação">
        <p>
          O ZION é uma plataforma de apoio ao atendimento, gestão comercial,
          CRM, automações e comunicação por WhatsApp para empresas.
        </p>
        <p>
          Esta política descreve como informações podem ser tratadas durante o
          uso da plataforma.
        </p>
      </LegalSection>

      <LegalSection title="2. Dados que podem ser tratados">
        <LegalList
          items={[
            "Dados de cadastro e identificação.",
            "Nome, e-mail e telefone.",
            "Dados da loja e de seus usuários.",
            "Informações de leads e clientes inseridas pela loja.",
            "Mensagens e histórico de atendimento.",
            "Imagens, áudios, vídeos e documentos enviados voluntariamente.",
            "Dados de catálogo, orçamentos, contratos, tarefas e compromissos.",
            "Dados técnicos essenciais, como registros de acesso, erros, horários e identificadores de integração.",
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Como os dados são obtidos">
        <LegalList
          items={[
            "Diretamente dos usuários.",
            "Pelas lojas que utilizam o ZION.",
            "Por mensagens enviadas pelo WhatsApp.",
            "Por integrações configuradas pela própria loja.",
            "Durante o funcionamento técnico e de segurança da plataforma.",
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Finalidades">
        <LegalList
          items={[
            "Fornecer atendimento e funcionalidades contratadas.",
            "Organizar leads e conversas.",
            "Gerar respostas, resumos e sugestões.",
            "Permitir comunicação pelo WhatsApp.",
            "Elaborar documentos comerciais.",
            "Executar tarefas, compromissos e automações.",
            "Prevenir fraude, abuso e falhas.",
            "Prestar suporte.",
            "Cumprir obrigações legais.",
          ]}
        />
      </LegalSection>

      <LegalSection title="5. Inteligência artificial e automações">
        <LegalList
          items={[
            "Alguns recursos do ZION utilizam modelos de inteligência artificial.",
            "Conteúdos podem ser processados para gerar respostas, classificações, resumos e apoio operacional.",
            "Decisões relevantes devem ser revisadas pelos responsáveis da empresa usuária.",
            "Os recursos do ZION não devem ser tratados como substituição de análise humana, jurídica, financeira ou profissional.",
          ]}
        />
      </LegalSection>

      <LegalSection title="6. Compartilhamento e fornecedores">
        <p>
          Dados podem ser processados por fornecedores técnicos somente conforme
          necessário para viabilizar funcionalidades, infraestrutura,
          comunicação e suporte operacional.
        </p>
        <LegalList
          items={[
            "Meta e WhatsApp Cloud API.",
            "OpenAI.",
            "Supabase.",
            "Vercel.",
            "Outros fornecedores de infraestrutura ou comunicação configurados futuramente.",
          ]}
        />
        <p>
          Isso não significa que todos os fornecedores recebam todos os dados.
          Cada fornecedor possui suas próprias práticas e obrigações.
        </p>
      </LegalSection>

      <LegalSection title="7. Papel das lojas usuárias">
        <LegalList
          items={[
            "A loja é responsável pelos dados de seus clientes e leads que insere ou recebe no ZION.",
            "A loja deve possuir fundamento adequado para tratar esses dados.",
            "A loja deve informar seus próprios clientes quando necessário.",
            "A loja deve restringir acessos aos seus usuários autorizados.",
          ]}
        />
      </LegalSection>

      <LegalSection title="8. Papel das partes no tratamento de dados">
        <LegalList
          items={[
            "Dependendo da atividade e do contexto, a empresa ou loja usuária poderá tomar as principais decisões sobre o tratamento dos dados de seus clientes e leads.",
            "Quando o ZION tratar esses dados para prestar as funcionalidades configuradas pela loja, poderá atuar seguindo instruções e finalidades definidas pela empresa usuária.",
            "Em atividades relacionadas à própria administração da plataforma, segurança, prevenção de abuso, suporte, gestão de contas e cumprimento de obrigações próprias, os papéis e responsabilidades poderão variar conforme o caso.",
            "A definição jurídica aplicável deve considerar a operação concreta e a legislação vigente.",
          ]}
        />
      </LegalSection>

      <LegalSection title="9. Bases legais para o tratamento">
        <p>
          As bases legais aplicáveis poderão variar conforme a finalidade, a
          relação entre as partes, o tipo de dado e o contexto concreto de cada
          operação.
        </p>
        <LegalList
          items={[
            "Execução de contrato ou procedimentos relacionados à contratação.",
            "Cumprimento de obrigação legal ou regulatória.",
            "Exercício regular de direitos.",
            "Legítimo interesse, quando cabível e após avaliação adequada.",
            "Consentimento, quando ele for necessário.",
            "Outras hipóteses legalmente previstas e compatíveis com a atividade.",
          ]}
        />
      </LegalSection>

      <LegalSection title="10. Transferência internacional de dados">
        <LegalList
          items={[
            "Alguns fornecedores de tecnologia e infraestrutura utilizados pelo ZION poderão processar dados em outros países, conforme o serviço utilizado e sua configuração.",
            "Isso poderá envolver operações internacionais de armazenamento, suporte, processamento ou infraestrutura.",
            "Quando houver transferência internacional de dados pessoais, deverão ser observados os requisitos e mecanismos previstos na legislação aplicável.",
            "O ZION buscará utilizar fornecedores e configurações compatíveis com as necessidades de segurança e proteção de dados.",
          ]}
        />
      </LegalSection>

      <LegalSection title="11. Segurança">
        <LegalList
          items={[
            "O ZION adota medidas técnicas e administrativas razoáveis.",
            "Há controles de acesso, isolamento por organização ou loja, proteção de credenciais e registros operacionais.",
            "Nenhuma plataforma pode garantir segurança absoluta.",
          ]}
        />
      </LegalSection>

      <LegalSection title="12. Retenção e exclusão">
        <LegalList
          items={[
            "Os dados podem ser mantidos pelo período necessário às finalidades da plataforma, à relação contratual, à segurança e ao cumprimento de obrigações legais.",
            "Quando aplicável, informações poderão ser eliminadas ou anonimizadas.",
            `Pedidos relacionados a exclusão podem ser enviados para ${CONTACT_EMAIL}.`,
            "Algumas informações podem ser preservadas quando houver obrigação legal, prevenção de fraude, exercício regular de direitos ou outra justificativa legítima.",
          ]}
        />
      </LegalSection>

      <LegalSection title="13. Direitos do titular">
        <LegalList
          items={[
            "Confirmação e acesso.",
            "Correção.",
            "Informação sobre tratamento.",
            "Portabilidade, quando aplicável.",
            "Anonimização, bloqueio ou exclusão, quando cabível.",
            "Revogação do consentimento, quando essa for a base utilizada.",
            "Oposição nos casos previstos.",
            "Revisão de decisões automatizadas, quando aplicável.",
          ]}
        />
      </LegalSection>

      <LegalSection title="14. Crianças e adolescentes">
        <LegalList
          items={[
            "O ZION não é destinado diretamente a crianças.",
            "Empresas usuárias não devem inserir dados de crianças ou adolescentes sem fundamento e cuidados adequados.",
          ]}
        />
      </LegalSection>

      <LegalSection title="15. Alterações nesta política">
        <p>
          Este documento pode ser atualizado ao longo da operação do produto.
          A data da versão vigente permanecerá exibida nesta página.
        </p>
      </LegalSection>

      <LegalSection title="16. Contato">
        <p>
          Para dúvidas, solicitações relacionadas a dados ou comunicação sobre
          esta política, utilize o e-mail oficial:
        </p>
        <p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-zinc-100 underline decoration-zinc-500 underline-offset-4 transition hover:decoration-zinc-200"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
        <p>
          Para instruções públicas de solicitação de exclusão, acesse{" "}
          <Link
            href="/data-deletion"
            className="font-medium text-zinc-100 underline decoration-zinc-500 underline-offset-4 transition hover:decoration-zinc-200"
          >
            /data-deletion
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import {
  CONTACT_EMAIL,
  LegalList,
  LegalPageLayout,
  LegalSection,
} from "../LegalPageLayout";

export const metadata: Metadata = {
  title: "Termos de Serviço do ZION",
  description:
    "Documento público com regras gerais de uso do ZION, responsabilidades das lojas usuárias, uso de inteligência artificial e dependência de serviços de terceiros.",
};

export default function TermsOfServicePage() {
  return (
    <LegalPageLayout
      title="Termos de Serviço do ZION"
      description="Estes termos apresentam as regras gerais de uso do ZION e de suas funcionalidades, integrações e serviços."
    >
      <LegalSection title="1. Aceitação dos termos">
        <p>
          Ao acessar ou utilizar o ZION, a empresa usuária e seus usuários
          autorizados concordam com estes termos na medida aplicável ao uso da
          plataforma.
        </p>
      </LegalSection>

      <LegalSection title="2. Descrição geral do ZION">
        <p>
          O ZION é uma plataforma de apoio ao atendimento, gestão comercial,
          CRM, automações, organização operacional e comunicação por WhatsApp
          para empresas.
        </p>
      </LegalSection>

      <LegalSection title="3. Elegibilidade e responsabilidade pela conta">
        <LegalList
          items={[
            "O acesso deve ser utilizado apenas por pessoas autorizadas pela empresa usuária.",
            "A empresa é responsável pelo controle de acesso, uso adequado da conta e proteção de credenciais.",
            "Informações de login e acessos internos não devem ser compartilhados de forma indevida.",
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Uso permitido">
        <p>
          O ZION deve ser utilizado para finalidades empresariais legítimas,
          dentro dos limites técnicos do produto e das regras aplicáveis aos
          canais e integrações utilizados.
        </p>
      </LegalSection>

      <LegalSection title="5. Proibições de uso">
        <LegalList
          items={[
            "Fraude, spam ou campanhas não autorizadas.",
            "Violação de direitos de terceiros.",
            "Uso ilegal ou contrário às regras aplicáveis.",
            "Tentativa de acessar dados de outras lojas ou organizações.",
            "Envio de conteúdo malicioso, código nocivo ou tentativa de comprometer a plataforma.",
            "Uso contrário às regras da Meta e do WhatsApp.",
          ]}
        />
      </LegalSection>

      <LegalSection title="6. Responsabilidade da loja usuária">
        <p>
          A loja usuária é responsável pelos dados, catálogos, mensagens,
          documentos, preços e demais informações que inserir, sincronizar,
          aprovar, revisar ou utilizar no ZION.
        </p>
      </LegalSection>

      <LegalSection title="7. Inteligência artificial">
        <LegalList
          items={[
            "Respostas, classificações e sugestões automatizadas podem conter imprecisões.",
            "O usuário responsável deve revisar informações importantes antes de decisões comerciais, operacionais ou contratuais.",
            "O ZION não deve ser usado como substituição de aconselhamento jurídico, contábil, médico ou financeiro.",
          ]}
        />
      </LegalSection>

      <LegalSection title="8. WhatsApp e serviços de terceiros">
        <p>
          Parte do funcionamento do ZION depende de fornecedores externos,
          integrações, infraestrutura e canais de comunicação.
        </p>
        <p>
          Indisponibilidades, limites, alterações técnicas ou mudanças de regra
          desses serviços podem afetar parcial ou totalmente algumas
          funcionalidades da plataforma.
        </p>
      </LegalSection>

      <LegalSection title="9. Propriedade intelectual">
        <p>
          A estrutura, identidade do produto, software, documentação e demais
          elementos do ZION permanecem protegidos pelas regras aplicáveis de
          propriedade intelectual, sem prejuízo dos direitos obrigatórios de
          terceiros sobre conteúdos próprios.
        </p>
      </LegalSection>

      <LegalSection title="10. Privacidade">
        <p>
          Informações gerais sobre tratamento de dados podem ser consultadas na{" "}
          <Link
            href="/privacy-policy"
            className="font-medium text-zinc-100 underline decoration-zinc-500 underline-offset-4 transition hover:decoration-zinc-200"
          >
            Política de Privacidade
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="11. Suspensão ou encerramento">
        <p>
          O acesso poderá ser restringido, suspenso ou encerrado em caso de
          abuso, risco relevante, uso indevido, violação destes termos ou
          necessidade de proteção da plataforma e de terceiros.
        </p>
      </LegalSection>

      <LegalSection title="12. Limitação responsável de garantias">
        <p>
          O ZION é disponibilizado com esforço técnico compatível com sua
          operação, mas não há promessa de funcionamento ininterrupto, ausência
          absoluta de erros ou adequação universal a qualquer finalidade
          específica. Nada aqui busca afastar direitos obrigatórios previstos na
          legislação aplicável.
        </p>
      </LegalSection>

      <LegalSection title="13. Alterações dos termos">
        <p>
          Estes termos podem ser atualizados conforme a evolução do produto, de
          integrações e de requisitos operacionais. A versão vigente permanecerá
          publicada nesta página.
        </p>
      </LegalSection>

      <LegalSection title="14. Legislação aplicável">
        <p>
          Estes termos devem ser interpretados de acordo com a legislação
          brasileira, sem definição de foro específico.
        </p>
      </LegalSection>

      <LegalSection title="15. Contato">
        <p>
          Para comunicações relacionadas a estes termos, utilize o e-mail
          oficial:
        </p>
        <p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-zinc-100 underline decoration-zinc-500 underline-offset-4 transition hover:decoration-zinc-200"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}

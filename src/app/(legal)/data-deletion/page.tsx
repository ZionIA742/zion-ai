import type { Metadata } from "next";
import Link from "next/link";
import {
  CONTACT_EMAIL,
  LegalList,
  LegalPageLayout,
  LegalSection,
} from "../LegalPageLayout";

export const metadata: Metadata = {
  title: "Solicitação de Exclusão de Dados",
  description:
    "Página pública com instruções para solicitar exclusão de dados relacionados ao uso do ZION.",
};

export default function DataDeletionPage() {
  return (
    <LegalPageLayout
      title="Solicitação de Exclusão de Dados"
      description="Esta página apresenta um procedimento público, simples e sem formulário para pedidos de exclusão relacionados ao uso do ZION."
    >
      <LegalSection title="1. Quem pode solicitar">
        <LegalList
          items={[
            "Titular dos dados.",
            "Usuário de uma loja.",
            "Representante autorizado.",
            "Responsável pela loja contratante.",
          ]}
        />
      </LegalSection>

      <LegalSection title="2. Como solicitar">
        <p>
          A solicitação deve ser enviada por e-mail para{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-zinc-100 underline decoration-zinc-500 underline-offset-4 transition hover:decoration-zinc-200"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <LegalList
          items={[
            "Assunto sugerido: Solicitação de exclusão de dados - ZION.",
            "Informar nome.",
            "Informar telefone ou e-mail usado no atendimento ou na conta.",
            "Informar o nome da loja relacionada, quando aplicável.",
            "Descrever o pedido de forma objetiva.",
            "Não enviar senha, token, código de autenticação ou documento sensível sem solicitação expressa.",
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Validação">
        <p>
          O ZION poderá solicitar informações adicionais apenas para confirmar a
          identidade do solicitante e evitar exclusão indevida.
        </p>
      </LegalSection>

      <LegalSection title="4. O que poderá ser excluído">
        <LegalList
          items={[
            "Cadastro.",
            "Dados de contato.",
            "Conversas e mídias.",
            "Registros comerciais vinculados.",
            "Outros dados pessoais aplicáveis.",
          ]}
        />
      </LegalSection>

      <LegalSection title="5. Limitações">
        <LegalList
          items={[
            "Dados podem ser preservados quando necessários para obrigação legal, segurança, prevenção de fraude, defesa de direitos ou outra justificativa legítima.",
            "Em alguns casos, a loja cliente pode possuir responsabilidade própria sobre o tratamento.",
            "Quando aplicável, o pedido poderá precisar ser encaminhado ou coordenado com a loja responsável.",
          ]}
        />
      </LegalSection>

      <LegalSection title="6. Processo">
        <LegalList
          items={[
            "Confirmar recebimento do pedido.",
            "Validar identidade e escopo da solicitação.",
            "Informar o tratamento aplicável ao caso.",
            "Comunicar a conclusão do pedido ou eventual justificativa de retenção.",
          ]}
        />
        <p>
          Este documento não fixa prazo legal exato e não substitui avaliação
          do caso concreto.
        </p>
      </LegalSection>

      <LegalSection title="7. Links úteis">
        <p>
          Consulte também a{" "}
          <Link
            href="/privacy-policy"
            className="font-medium text-zinc-100 underline decoration-zinc-500 underline-offset-4 transition hover:decoration-zinc-200"
          >
            Política de Privacidade
          </Link>{" "}
          e os{" "}
          <Link
            href="/terms-of-service"
            className="font-medium text-zinc-100 underline decoration-zinc-500 underline-offset-4 transition hover:decoration-zinc-200"
          >
            Termos de Serviço
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}

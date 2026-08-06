import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCanonicalCrmStage } from "@/config/crm";
import { buildCrmLeadConversationHref } from "@/lib/server/crm/lead-conversation-opportunity-context";
import {
  resolveAuthorizedOpportunityDetail,
  type AuthorizedOpportunityDetailData,
  type OpportunityDetailProblemCode,
  type OpportunityDetailWarningCode,
} from "@/lib/server/crm/resolve-authorized-opportunity-detail";

type OpportunityDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

function mapWarningMessage(code: OpportunityDetailWarningCode) {
  switch (code) {
    case "missing_origin_lead":
      return "Esta oportunidade não possui um lead de origem registrado.";
    case "missing_primary_conversation":
      return "Nenhuma conversa principal está vinculada.";
    case "missing_display_name":
      return "O nome do cliente ainda não foi informado.";
    case "missing_phone":
      return "O telefone do cliente ainda não foi informado.";
    default:
      return null;
  }
}

function mapProblemMessage(code: OpportunityDetailProblemCode) {
  switch (code) {
    case "invalid_stage":
      return "A etapa comercial desta oportunidade precisa ser revisada.";
    case "customer_scope_inconsistency":
      return "Os dados do cliente não puderam ser confirmados com segurança.";
    case "origin_lead_scope_inconsistency":
      return "O vínculo com a origem da oportunidade precisa ser revisado.";
    case "primary_conversation_scope_inconsistency":
      return "O vínculo da conversa principal precisa ser revisado.";
    default:
      return "Existe uma pendência que precisa ser revisada.";
  }
}

function renderValue(label: string, value: string) {
  return (
    <div className="rounded-xl bg-gray-50 px-4 py-3 ring-1 ring-black/5">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-gray-900">{value}</dd>
    </div>
  );
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function getStageLabel(data: AuthorizedOpportunityDetailData) {
  if (data.opportunity.stageStatus === "valid" && data.opportunity.stage) {
    return (
      getCanonicalCrmStage(data.opportunity.stage)?.title ??
      "Etapa comercial pendente de revisão"
    );
  }

  return "Etapa comercial pendente de revisão";
}

function hasCustomerInconsistency(data: AuthorizedOpportunityDetailData) {
  return data.problems.includes("customer_scope_inconsistency");
}

function getCustomerSummary(data: AuthorizedOpportunityDetailData) {
  const displayName = normalizeOptionalText(data.displayName);
  const phone = normalizeOptionalText(data.phone);

  return {
    name: displayName ?? "Nome ainda não informado",
    phone: phone ?? "Telefone ainda não informado",
  };
}

function getOriginSummary(data: AuthorizedOpportunityDetailData) {
  if (data.problems.includes("origin_lead_scope_inconsistency")) {
    return "O vínculo com a origem desta oportunidade precisa ser verificado.";
  }

  if (!data.hasOriginLead) {
    return "Esta oportunidade não possui um lead de origem registrado.";
  }

  if (!data.originLead) {
    return "O vínculo com a origem desta oportunidade precisa ser verificado.";
  }

  const parts = [data.originLead.name?.trim() || "Lead de origem confirmado"];

  if (data.originLead.phone?.trim()) {
    parts.push(data.originLead.phone.trim());
  }

  return parts.join(" • ");
}

function getConversationSummary(data: AuthorizedOpportunityDetailData) {
  if (!data.hasPrimaryConversation) {
    return "Nenhuma conversa principal vinculada.";
  }

  if (!data.primaryConversation) {
    return "O vínculo da conversa principal precisa ser verificado.";
  }

  return "Conversa principal confirmada";
}

function getOriginLeadStatus(data: AuthorizedOpportunityDetailData) {
  if (data.problems.includes("origin_lead_scope_inconsistency")) {
    return "Lead de origem precisa de revisão";
  }

  if (!data.hasOriginLead) {
    return "Lead de origem ausente";
  }

  if (data.originLead) {
    return "Lead de origem confirmado";
  }

  return "Lead de origem precisa de revisão";
}

function getAttendanceSummary(data: AuthorizedOpportunityDetailData) {
  if (!data.primaryConversation || data.isHumanActive === null) {
    return "Situação do atendimento não confirmada";
  }

  return data.isHumanActive ? "Humano assumiu" : "Humano não assumiu";
}

function renderFailureState(
  title: string,
  description: string,
  extra?: string,
) {
  return (
    <div className="min-h-[calc(100vh-151px)] bg-gray-100 px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
            Detalhe da oportunidade
          </div>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">{description}</p>
          {extra ? <p className="mt-2 text-sm text-gray-600">{extra}</p> : null}
          <div className="mt-6">
            <Link
              href="/crm"
              className="inline-flex rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
            >
              Voltar para o CRM
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function OpportunityDetailPage({
  params,
}: OpportunityDetailPageProps) {
  const { id } = await params;
  const result = await resolveAuthorizedOpportunityDetail(id);

  if (!result.ok) {
    if (result.error === "not_found") {
      notFound();
    }

    if (result.error === "unauthenticated") {
      return renderFailureState(
        "Sessão não confirmada",
        "Não foi possível confirmar sua sessão para abrir esta oportunidade.",
      );
    }

    return renderFailureState(
      "Não foi possível carregar esta oportunidade.",
      "Tente novamente mais tarde.",
    );
  }

  const data = result.data;
  const redirectHref = buildCrmLeadConversationHref({
    leadId: data.originLead?.id || null,
    conversationId: data.primaryConversation?.id || null,
    opportunityId: data.opportunity.id,
  });

  if (redirectHref) {
    redirect(redirectHref);
  }

  const stageLabel = getStageLabel(data);
  const customer = getCustomerSummary(data);
  const customerInconsistency = hasCustomerInconsistency(data);
  const safeDisplayName = normalizeOptionalText(data.displayName);
  const pageTitle =
    customerInconsistency || !safeDisplayName
      ? "Detalhe da oportunidade"
      : safeDisplayName;
  const warningMessages = data.warnings
    .map(mapWarningMessage)
    .filter((value) => value !== null);
  const problemMessages = data.problems
    .map(mapProblemMessage)
    .filter((value) => value !== null);

  return (
    <div className="min-h-[calc(100vh-151px)] bg-gray-100 px-4 py-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                Detalhe da oportunidade
              </div>
              <h1 className="mt-2 text-2xl font-bold text-gray-900">{pageTitle}</h1>
              <p className="mt-2 text-sm text-gray-600">{stageLabel}</p>
            </div>

            <Link
              href="/crm"
              className="inline-flex rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
            >
              Voltar para o CRM
            </Link>
          </div>
        </div>

        {data.requiresAttention ? (
          <section className="rounded-2xl bg-red-50 p-5 shadow-sm ring-1 ring-red-200">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-red-700">
              Ação necessária
            </h2>
            <div className="mt-3 space-y-2">
              {problemMessages.map((message) => (
                <p key={message} className="text-sm text-red-900">
                  {message}
                </p>
              ))}
            </div>
          </section>
        ) : null}

        {warningMessages.length > 0 ? (
          <section className="rounded-2xl bg-gray-50 p-5 shadow-sm ring-1 ring-gray-200">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-gray-700">
              Informações pendentes
            </h2>
            <div className="mt-3 space-y-2">
              {warningMessages.map((message) => (
                <p key={message} className="text-sm text-gray-700">
                  {message}
                </p>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <div className="mb-4">
            <h2 className="text-base font-bold text-gray-900">Resumo comercial</h2>
            <p className="mt-1 text-sm text-gray-500">
              Visão segura e somente de leitura da oportunidade atual.
            </p>
          </div>

          <dl className="grid gap-3 md:grid-cols-2">
            {renderValue(
              "Cliente",
              customerInconsistency
                ? "Os dados do cliente precisam ser verificados."
                : customer.name,
            )}
            {!customerInconsistency ? renderValue("Telefone", customer.phone) : null}
            {renderValue("Etapa atual", stageLabel)}
            {renderValue("Conversa principal", getConversationSummary(data))}
            {renderValue("Atendimento", getAttendanceSummary(data))}
            {renderValue("Lead de origem", getOriginLeadStatus(data))}
          </dl>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            <h2 className="text-base font-bold text-gray-900">Cliente</h2>
            {customerInconsistency ? (
              <p className="mt-4 text-sm text-gray-700">
                Os dados do cliente precisam ser verificados.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Nome
                  </div>
                  <div className="mt-1 text-sm text-gray-900">{customer.name}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Telefone
                  </div>
                  <div className="mt-1 text-sm text-gray-900">{customer.phone}</div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            <h2 className="text-base font-bold text-gray-900">Origem da oportunidade</h2>
            <p className="mt-4 text-sm text-gray-700">{getOriginSummary(data)}</p>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <h2 className="text-base font-bold text-gray-900">Conversa principal</h2>
          <p className="mt-4 text-sm text-gray-700">{getConversationSummary(data)}</p>
          <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 ring-1 ring-black/5">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
              Situação do atendimento
            </div>
            <div className="mt-1 text-sm text-gray-900">{getAttendanceSummary(data)}</div>
          </div>
        </section>
      </div>
    </div>
  );
}

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

const clientPath = join(process.cwd(), "src/app/zion-admin/ZionAdminDashboardClient.tsx");

function readSource() {
  return readFileSync(clientPath, "utf8");
}

const tests: TestCase[] = [
  {
    name: "store subscription action uses dedicated Zion Admin endpoint",
    run: () => {
      const source = readSource();

      assert.equal(source.includes('/api/zion-admin/stores/subscription-state'), true);
      assert.equal(source.includes("Gestão da loja"), true);
      assert.equal(source.includes("Operação da loja"), true);
      assert.equal(source.includes("Gerencie o funcionamento desta loja no ZION."), true);
      assert.equal(source.includes("Conta responsável"), true);
      assert.equal(source.includes("Gerencie o acesso do responsável à loja."), true);
      assert.equal(source.includes("Desativar loja"), true);
      assert.equal(source.includes("Reativar loja"), true);
      assert.equal(source.includes("Bloquear acesso"), true);
      assert.equal(source.includes("Reativar acesso"), true);
      assert.equal(source.includes("Assinatura canônica"), false);
      assert.equal(source.includes("Autoridade da etapa 5.2: subscriptions.status"), false);
      assert.equal(source.includes("Semântica"), false);
      assert.equal(
        source.includes("Acesso bloqueado = pessoa/conta. Inativa/Suspensa = loja."),
        false,
      );
      assert.equal(
        source.includes("Motivo detalhado ainda não registrado em base confiável."),
        false,
      );
    },
  },
  {
    name: "store action requires explicit confirmation and browser sends only storeId plus action",
    run: () => {
      const source = readSource();

      assert.equal(source.includes("window.confirm("), true);
      assert.equal(source.includes("storeId: store.id"), true);
      assert.equal(source.includes("organizationId: store.organizationId"), false);
      assert.equal(source.includes("subscriptionId:"), false);
    },
  },
  {
    name: "first access control stays visible in drawer header and reuses resend handler",
    run: () => {
      const source = readSource();

      assert.equal(source.includes("headerActions={"), true);
      assert.equal(source.includes("flex flex-wrap items-start justify-end gap-2"), true);
      assert.equal(source.includes("getFirstAccessControlState({"), true);
      assert.equal(source.includes("title={firstAccessControl.reason || undefined}"), true);
      assert.equal(source.includes("void onResendFirstAccess(store)"), true);
      assert.equal(source.includes('/api/zion-admin/accounts/resend-first-access'), true);
    },
  },
  {
    name: "historical account overview distinguishes unavailable history from no activity",
    run: () => {
      const source = readSource();

      assert.equal(source.includes('return "Histórico não disponível";'), true);
      assert.equal(source.includes('return "Sem atividade";'), true);
      assert.equal(source.includes("accountAccess?.lastInviteHistoryStatus"), true);
      assert.equal(source.includes("accountAccess?.firstAccessHistoryStatus"), true);
    },
  },
  {
    name: "suspended status is represented in the client",
    run: () => {
      const source = readSource();

      assert.equal(source.includes('if (normalized === "suspended") return "Desativada";'), true);
      assert.equal(source.includes('if (normalized === "active") return "suspend" as const;'), true);
      assert.equal(source.includes('if (normalized === "suspended") return "reactivate" as const;'), true);
      assert.equal(source.includes("Lojas canceladas ou inativas"), true);
      assert.equal(source.includes("Acesso bloqueado"), true);
      assert.equal(source.includes("Acesso ativo"), true);
    },
  },
  {
    name: "canonical integrity labels and fail-closed fallback are exposed",
    run: () => {
      const source = readSource();

      for (const label of [
        "Saudável",
        "Atenção",
        "Problema",
        "Não verificada",
        "Loja sem proprietário",
        "Mais de um proprietário encontrado",
        "Proprietário inativo",
        "Perfil do proprietário ausente",
        "Assinatura não encontrada",
        "Mais de uma assinatura encontrada",
        "Organização não encontrada",
      ]) {
        assert.equal(source.includes(label), true, `missing integrity label: ${label}`);
      }

      assert.equal(source.includes('integrity?.state ?? "unknown"'), true);
      assert.equal(source.includes("Integridade estrutural"), true);
      assert.equal(source.includes("Sem pendências operacionais críticas"), true);
      assert.equal(source.includes("getStoreIntegritySummary(stores, integrityOrphanStores)"), true);
      assert.equal(source.includes("integrityOrphanStores.slice(0, 3)"), true);
      assert.equal(source.includes("sem usuario vinculado"), false);
      assert.equal(source.includes("não entram nas listas nem nos contadores normais"), false);
      assert.equal(
        source.includes("fora da lista operacional e dos indicadores operacionais") &&
          source.includes("consideradas no resumo de integridade"),
        true,
      );
      assert.equal(source.includes("Revisar:"), false);
      assert.equal(source.includes("e mais ${integrityOrphanStores.length - 3} estrutura(s)."), true);
      assert.equal(source.includes("subscriptionStatus"), true);
      assert.equal(source.includes("accountAccess"), true);
    },
  },
  {
    name: "canonical operational health is surfaced without replacing legacy pending UI",
    run: () => {
      const source = readSource();

      for (const token of [
        "operationalHealth?: StoreOperationalHealth | null",
        "Saúde operacional",
        "Saúde:",
        "WhatsApp",
        "Assistente",
        "Operação",
        "Sem atividade de IA",
        "Não foi possível verificar",
        "Conectividade ao vivo do WhatsApp",
        "Heartbeat dos workers",
        "não afirma que",
        "whatsapp_outbound_stale",
        "assistant_task_stale_pending",
        "responsible_notification_stale_processing",
        "post_appointment_followup_overdue",
      ]) {
        assert.equal(
          source.includes(token),
          true,
          `missing operational health UI token: ${token}`,
        );
      }

      assert.equal(
        source.includes(
          'const operationalHealthState = store.operationalHealth?.state ?? "unknown";',
        ),
        true,
      );

      assert.equal(
        source.includes(
          'operationalHealth?.whatsapp?.liveConnectivity === "unverified"',
        ),
        true,
      );

      assert.equal(
        source.includes(
          "operationalHealth?.observability?.workerHeartbeatAvailable === false",
        ),
        true,
      );

      assert.equal(
        source.includes("getOperationalSummary(store)"),
        true,
        "legacy pending UI must remain available during 4.3-A",
      );

      assert.equal(
        source.includes("Sem pendências operacionais críticas"),
        true,
        "legacy pending copy must not be removed in 4.3-A",
      );
    },
  },];

async function run() {
  for (const test of tests) {
    test.run();
  }

  console.log(`zion-admin-dashboard-client: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

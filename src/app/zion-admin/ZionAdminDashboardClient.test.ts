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
      assert.equal(source.includes("Acesso bloqueado = pessoa/conta. Inativa/Suspensa = loja."), false);
      assert.equal(source.includes("Motivo detalhado ainda não registrado em base confiável."), false);
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
];

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

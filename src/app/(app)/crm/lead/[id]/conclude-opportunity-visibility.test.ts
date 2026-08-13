import { strict as assert } from "node:assert";
import {
  canEnableConcludeOpportunityAction,
  canEnableReopenForPostSaleAction,
  canRenderConcludeOpportunityAction,
  canRenderReopenForPostSaleAction,
} from "./conclude-opportunity-visibility";

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [
  {
    name: "without selected opportunity the button still renders but stays disabled",
    run: () => {
      assert.equal(canRenderConcludeOpportunityAction(null, false), true);
      assert.equal(canEnableConcludeOpportunityAction(null), false);
    },
  },
  {
    name: "orcamento keeps the action disabled",
    run: () => {
      assert.equal(canRenderConcludeOpportunityAction("orcamento", true), true);
      assert.equal(canEnableConcludeOpportunityAction("orcamento"), false);
    },
  },
  {
    name: "instalacao_entrega keeps the action disabled",
    run: () => {
      assert.equal(canRenderConcludeOpportunityAction("instalacao_entrega", true), true);
      assert.equal(canEnableConcludeOpportunityAction("instalacao_entrega"), false);
    },
  },
  {
    name: "pos_venda enables the action",
    run: () => {
      assert.equal(canRenderConcludeOpportunityAction("pos_venda", true), true);
      assert.equal(canEnableConcludeOpportunityAction("pos_venda"), true);
    },
  },
  {
    name: "concluido_sem_mais_acoes enables post-sale reopen action",
    run: () => {
      assert.equal(
        canRenderReopenForPostSaleAction("concluido_sem_mais_acoes", true),
        true,
      );
      assert.equal(
        canEnableReopenForPostSaleAction("concluido_sem_mais_acoes"),
        true,
      );
    },
  },
  {
    name: "orcamento keeps post-sale reopen action unavailable",
    run: () => {
      assert.equal(canRenderReopenForPostSaleAction("orcamento", true), false);
      assert.equal(canEnableReopenForPostSaleAction("orcamento"), false);
    },
  },
  {
    name: "missing selected opportunity keeps post-sale reopen action unavailable",
    run: () => {
      assert.equal(canRenderReopenForPostSaleAction(null, false), false);
      assert.equal(canEnableReopenForPostSaleAction(null), false);
    },
  },
];

function main() {
  let passed = 0;

  for (const test of tests) {
    try {
      test.run();
      passed += 1;
      console.log(`PASS ${test.name}`);
    } catch (error) {
      console.error(`FAIL ${test.name}`);
      throw error;
    }
  }

  console.log(`TOTAL ${passed}`);
}

main();

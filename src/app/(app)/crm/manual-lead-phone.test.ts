import { strict as assert } from "node:assert";
import {
  extractManualLeadPhoneDigits,
  formatManualLeadPhone,
} from "./manual-lead-phone";

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [
  {
    name: "11978071471 vira celular brasileiro canonico",
    run: () => {
      assert.equal(formatManualLeadPhone("11978071471"), "(11) 97807-1471");
    },
  },
  {
    name: "1134567890 vira telefone fixo canonico",
    run: () => {
      assert.equal(formatManualLeadPhone("1134567890"), "(11) 3456-7890");
    },
  },
  {
    name: "telefone ja mascarado permanece canonico",
    run: () => {
      assert.equal(
        formatManualLeadPhone("(11) 97807-1471"),
        "(11) 97807-1471",
      );
    },
  },
  {
    name: "colagem com +55 vira telefone brasileiro local",
    run: () => {
      assert.equal(
        formatManualLeadPhone("+55 11 97807-1471"),
        "(11) 97807-1471",
      );
    },
  },
  {
    name: "ddd 55 local com 11 digitos permanece local",
    run: () => {
      assert.equal(formatManualLeadPhone("55999999999"), "(55) 99999-9999");
      assert.equal(
        formatManualLeadPhone("(55) 99999-9999"),
        "(55) 99999-9999",
      );
    },
  },
  {
    name: "ddd 55 local com 10 digitos permanece local",
    run: () => {
      assert.equal(formatManualLeadPhone("5534567890"), "(55) 3456-7890");
    },
  },
  {
    name: "55 e removido como ddi apenas com evidencia internacional suficiente",
    run: () => {
      assert.equal(formatManualLeadPhone("5511978071471"), "(11) 97807-1471");
      assert.equal(
        extractManualLeadPhoneDigits("5511978071471"),
        "11978071471",
      );
      assert.equal(
        extractManualLeadPhoneDigits("+55 11 97807-1471"),
        "11978071471",
      );
    },
  },
  {
    name: "letras misturadas nao permanecem no valor",
    run: () => {
      assert.equal(
        formatManualLeadPhone("ab11c97d807e1471f"),
        "(11) 97807-1471",
      );
    },
  },
  {
    name: "mais de 11 digitos nao ultrapassam o limite",
    run: () => {
      assert.equal(
        extractManualLeadPhoneDigits("11978071471123456789"),
        "11978071471",
      );
      assert.equal(
        formatManualLeadPhone("11978071471123456789"),
        "(11) 97807-1471",
      );
    },
  },
  {
    name: "digitacao parcial nao quebra a UI",
    run: () => {
      assert.deepEqual(
        [
          formatManualLeadPhone("1"),
          formatManualLeadPhone("11"),
          formatManualLeadPhone("119"),
          formatManualLeadPhone("1197"),
          formatManualLeadPhone("11978"),
          formatManualLeadPhone("119780"),
          formatManualLeadPhone("1197807"),
          formatManualLeadPhone("11978071"),
          formatManualLeadPhone("119780714"),
          formatManualLeadPhone("1197807147"),
        ],
        [
          "(1",
          "(11",
          "(11) 9",
          "(11) 97",
          "(11) 978",
          "(11) 9780",
          "(11) 97807",
          "(11) 97807-1",
          "(11) 97807-14",
          "(11) 97807-147",
        ],
      );
    },
  },
  {
    name: "campo vazio continua vazio",
    run: () => {
      assert.equal(formatManualLeadPhone(""), "");
      assert.equal(formatManualLeadPhone(null), "");
    },
  },
];

for (const test of tests) {
  test.run();
  process.stdout.write(`ok - ${test.name}\n`);
}

console.log(`manual-lead-phone: ${tests.length} tests passed`);

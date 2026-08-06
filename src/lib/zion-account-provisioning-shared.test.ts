import { strict as assert } from "node:assert";
import {
  FIRST_ACCESS_SUCCESS_MESSAGE,
  getInvalidFirstAccessAttemptMessage,
  maskEmail,
  PROVISIONING_SOURCE,
} from "./zion-account-provisioning-shared";

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [
  {
    name: "shared module keeps browser-safe provisioning constants",
    run: () => {
      assert.equal(PROVISIONING_SOURCE, "zion-admin");
      assert.equal(
        FIRST_ACCESS_SUCCESS_MESSAGE,
        "Senha criada com sucesso. Entre com seu e-mail e sua nova senha.",
      );
    },
  },
  {
    name: "shared module keeps pure invite validation messages",
    run: () => {
      assert.equal(
        getInvalidFirstAccessAttemptMessage("missing"),
        "O link recebido esta incompleto ou nao e mais valido. Peca um novo convite.",
      );
      assert.equal(
        getInvalidFirstAccessAttemptMessage("mismatch"),
        "Este link foi substituido, expirou ou ja nao e mais valido. Peca um novo convite.",
      );
    },
  },
  {
    name: "shared module masks email without server dependencies",
    run: () => {
      assert.equal(maskEmail("owner@example.com"), "o***r@example.com");
      assert.equal(maskEmail("a@site.test"), "a***@site.test");
    },
  },
];

for (const test of tests) {
  test.run();
}

console.log(`zion-account-provisioning-shared: ${tests.length} tests passed`);

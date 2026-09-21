import { strict as assert } from "node:assert";
import test from "node:test";
import {
  buildCustomerIdentityNameOperationKey,
  extractCustomerSelfDeclaredName,
} from "./customer-identity-name-extraction.js";

function nameOf(message: string) {
  const result = extractCustomerSelfDeclaredName(message);
  return result.ok ? result.displayName : null;
}

test("extracts explicit customer self-declared names", () => {
  assert.equal(nameOf("Meu nome é João"), "João");
  assert.equal(nameOf("Meu nome é João Silva"), "João Silva");
  assert.equal(nameOf("Me chamo João"), "João");
  assert.equal(nameOf("Sou o João"), "João");
  assert.equal(nameOf("Sou a Maria"), "Maria");
  assert.equal(nameOf("Aqui é o João"), "João");
  assert.equal(nameOf("Aqui é a Maria"), "Maria");
});

test("preserves Brazilian name characters and stops at punctuation", () => {
  assert.equal(nameOf("Meu nome é José D'Ávila-Santos, quero uma piscina"), "José D'Ávila-Santos");
  assert.equal(nameOf("Sou a Ana Júlia. Quero orçamento"), "Ana Júlia");
});

test("normalizes decomposed unicode names to NFC", () => {
  assert.equal(nameOf("Meu nome é Joa\u0303o"), "João");
  assert.equal(nameOf("Meu nome é Jose\u0301 D'A\u0301vila-Santos"), "José D'Ávila-Santos");
});

test("rejects third-person or billing-contact mentions", () => {
  for (const message of [
    "meu marido é João",
    "minha esposa é Maria",
    "fale com o João",
    "o orçamento é para Maria",
    "coloca no nome do Carlos",
    "o responsável é João",
  ]) {
    assert.equal(nameOf(message), null, message);
  }
});

test("rejects role descriptions after sou/aqui declarations", () => {
  for (const message of [
    "Sou o dono da casa",
    "Sou a dona da casa",
    "Sou o proprietário do imóvel",
    "Sou a proprietária do imóvel",
    "Sou o técnico",
    "Sou a técnica",
    "Aqui é o vendedor",
    "Aqui é a atendente",
    "Sou o responsável pela obra",
  ]) {
    assert.equal(nameOf(message), null, message);
  }
});

test("rejects obviously invalid names", () => {
  assert.equal(nameOf("Meu nome é piscina"), null);
  assert.equal(nameOf("Meu nome é A"), null);
  assert.equal(nameOf("Meu nome é João 123"), null);
});

test("operation key is deterministic for replay", () => {
  assert.equal(
    buildCustomerIdentityNameOperationKey("msg-1"),
    buildCustomerIdentityNameOperationKey("msg-1"),
  );
  assert.notEqual(
    buildCustomerIdentityNameOperationKey("msg-1"),
    buildCustomerIdentityNameOperationKey("msg-2"),
  );
});

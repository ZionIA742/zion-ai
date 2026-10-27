import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildInformalPortugueseContextInstruction } from "./informal-portuguese-context";

const salesSource = readFileSync("src/lib/server/generate-ai-sales-reply.ts", "utf8");
const assistantSource = readFileSync("src/app/api/assistant/reply/route.ts", "utf8");

test("a politica cobre linguagem informal sem transformar contexto em autorizacao", () => {
  const policy = buildInformalPortugueseContextInstruction();
  for (const example of ["vc/vcs", "qto/quanto", "mto/muito", "kkk", "rsrs", "sqn", "n tankei", "tá salgado", "faz um precinho", "uai", "oxente", "esse msm", "manda aq", "pode ser"]) {
    assert.ok(policy.includes(example), `exemplo ausente: ${example}`);
  }
  assert.match(policy, /histórico recente/);
  assert.match(policy, /não é autorização/);
  assert.match(policy, /infira preço/);
  assert.match(policy, /preserve a mensagem original/);
});

test("a colecao cobre mensagens fragmentadas e leituras dependentes de contexto", () => {
  const policy = buildInformalPortugueseContextInstruction();
  for (const example of [
    "vc tem piscina menor?",
    "qto fica no pix?",
    "mto caro kkkkk",
    "blz fechou",
    "fds vcs atendem?",
    "ah fds deixa pra lá",
    "kkkkkk",
    "rsrsrsrs",
    "hahahahaha",
    "uai, cê num tem outro?",
    "oxente, mas já?",
  ]) {
    assert.ok(policy.includes(example), `caso representativo ausente: ${example}`);
  }
});

test("a Vendedora e a Assistente integram o mesmo bloco nos caminhos efetivos", () => {
  assert.match(salesSource, /informal-portuguese-context/);
  assert.match(salesSource, /buildInformalPortugueseContextInstruction\(\{/);
  assert.match(assistantSource, /informal-portuguese-context/);
  assert.match(assistantSource, /buildInformalPortugueseContextInstruction\(\{/);
});

test("a politica trata nome cadastrado como candidato e preserva a identidade autenticada da Assistente", () => {
  const salesPolicy = buildInformalPortugueseContextInstruction({
    persona: "sales",
    customerNameCandidate: "Nome de cadastro",
  });
  const assistantPolicy = buildInformalPortugueseContextInstruction({ persona: "assistant" });

  assert.match(salesPolicy, /candidato de cadastro/);
  assert.match(salesPolicy, /Qual que é o seu nome\?/);
  assert.match(salesPolicy, /nao sobrescreva cadastro/);
  assert.match(assistantPolicy, /responsavel autenticado/);
  assert.doesNotMatch(assistantPolicy, /Qual que é o seu nome\?/);
});

test("a politica orienta naturalidade sem templates nem perda de gates", () => {
  const policy = buildInformalPortugueseContextInstruction({ persona: "sales" });

  for (const phrase of ["Oi!", "Perfeito!", "Compreendo perfeitamente sua solicitação", "Para prosseguirmos com seu atendimento"]) {
    assert.match(policy, new RegExp(phrase.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")));
  }
  assert.match(policy, /termine obrigatoriamente toda resposta com pergunta/);
  assert.match(policy, /cria autoridade/);
});

test("a politica nao cria chamada adicional ao provedor", () => {
  assert.doesNotMatch(buildInformalPortugueseContextInstruction(), /openai|responses\.create|fetch\(/i);
});

import assert from "node:assert/strict";
import { getFirstAccessControlState } from "./first-access-control.ts";

function createAccess(overrides = {}) {
  return {
    membershipId: "membership-1",
    responsibleName: "Owner",
    emailMasked: "o***r@example.com",
    userId: "user-1",
    isMembershipActive: true,
    isProfileBlocked: false,
    accessState: "active",
    accessStateLabel: "Acesso ativo",
    status: "first_access_pending",
    statusLabel: "Aguardando definicao da primeira senha",
    canResend: true,
    lastInviteSentAt: null,
    firstAccessCompletedAt: null,
    cooldownRemainingMs: 0,
    ...overrides,
  };
}

const tests = [
  {
    name: "pendente sem envio previo mantem botao habilitado",
    run() {
      const state = getFirstAccessControlState({
        accountAccess: createAccess(),
        canManageAccounts: true,
        isBusy: false,
      });

      assert.equal(state.label, "Enviar primeiro acesso");
      assert.equal(state.disabled, false);
      assert.equal(state.confirmMessage !== null, true);
    },
  },
  {
    name: "pendente com envio previo usa rotulo de reenvio habilitado",
    run() {
      const state = getFirstAccessControlState({
        accountAccess: createAccess({
          lastInviteSentAt: "2026-08-13T10:00:00.000Z",
        }),
        canManageAccounts: true,
        isBusy: false,
      });

      assert.equal(state.label, "Reenviar primeiro acesso");
      assert.equal(state.disabled, false);
    },
  },
  {
    name: "concluido mantem botao visivel desabilitado",
    run() {
      const state = getFirstAccessControlState({
        accountAccess: createAccess({
          status: "first_access_completed",
          statusLabel: "Acesso configurado",
          canResend: false,
          firstAccessCompletedAt: "2026-08-13T11:00:00.000Z",
        }),
        canManageAccounts: true,
        isBusy: false,
      });

      assert.equal(state.label, "Primeiro acesso concluido");
      assert.equal(state.disabled, true);
      assert.equal(state.reason, "A conta responsavel ja criou a primeira senha.");
    },
  },
  {
    name: "ambiguo mantem botao visivel desabilitado sem escolher owner",
    run() {
      const state = getFirstAccessControlState({
        accountAccess: createAccess({
          membershipId: null,
          userId: null,
          accessState: "unavailable",
          accessStateLabel: "Acesso indisponivel",
          status: "ambiguous",
          statusLabel: "Conta de loja ambigua",
          canResend: false,
        }),
        canManageAccounts: true,
        isBusy: false,
      });

      assert.equal(state.label, "Primeiro acesso indisponivel");
      assert.equal(state.disabled, true);
      assert.equal(state.reason, "Existe mais de uma conta owner candidata para esta loja.");
    },
  },
  {
    name: "conta bloqueada nao permite envio indevido",
    run() {
      const state = getFirstAccessControlState({
        accountAccess: createAccess({
          accessState: "blocked",
          accessStateLabel: "Acesso bloqueado",
          isMembershipActive: false,
          isProfileBlocked: true,
          lastInviteSentAt: "2026-08-13T10:00:00.000Z",
        }),
        canManageAccounts: true,
        isBusy: false,
      });

      assert.equal(state.label, "Reenviar primeiro acesso");
      assert.equal(state.disabled, true);
      assert.equal(
        state.reason,
        "A conta da loja esta bloqueada e nao pode receber novo primeiro acesso.",
      );
      assert.equal(state.confirmMessage, null);
    },
  },
];

for (const test of tests) {
  test.run();
}

console.log(`zion-admin-first-access-control: ${tests.length} tests passed`);

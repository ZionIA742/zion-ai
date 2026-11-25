import "server-only";
import { createBackendRouteObserver } from "./zion-admin-diagnostic-backend-route";


import type { Instrumentation } from "next";
import { after } from "next/server";
import { unstable_rethrow } from "next/navigation";

import {
  createBackendDiagnosticCollector,
} from "./zion-admin-diagnostic-backend-collector";

const KNOWN_ROUTES: ReadonlySet<string> = new Set(
[
  "/api/account/ensure-setup",
  "/api/account/first-access/complete",
  "/api/account/password-flow",
  "/api/ai/reply",
  "/api/assistant/actions/contract-workflow",
  "/api/assistant/actions/document",
  "/api/assistant/messages/[messageId]/signed-media-url",
  "/api/assistant/reply",
  "/api/assistant/responsible-external-notifications",
  "/api/assistant/responsible-external-notifications/cancel",
  "/api/assistant/responsible-external-notifications/prepare",
  "/api/assistant/responsible-external-notifications/send",
  "/api/assistant/responsible-external-notifications/unlock-processing",
  "/api/crm/catalog-products",
  "/api/crm/human-response-commitments",
  "/api/crm/lead-details/[id]",
  "/api/crm/leads/manual",
  "/api/crm/messages/[messageId]/outbound-review",
  "/api/crm/messages/[messageId]/signed-media-url",
  "/api/crm/messages/send-manual-attachment",
  "/api/crm/messages/send-manual-attachment/authorize",
  "/api/crm/messages/send-manual-attachment/finalize",
  "/api/crm/messages/send-manual-catalog-product",
  "/api/crm/messages/send-manual-text",
  "/api/crm/opportunities/action-readiness",
  "/api/crm/opportunities/conclude",
  "/api/crm/opportunities/new-cycle",
  "/api/crm/opportunities/payment",
  "/api/crm/opportunities/reopen-for-post-sale",
  "/api/cron/assistant-operational-tasks",
  "/api/cron/assistant-panel-whatsapp-sync",
  "/api/cron/assistant-reports",
  "/api/cron/whatsapp-process-all",
  "/api/cron/zion-admin-diagnostic-ai-runs",
  "/api/cron/zion-admin-diagnostic-operational",
  "/api/cron/zion-admin-monthly-preclosure",
  "/api/cron/zion-admin-openai-cost-cutover",
  "/api/cron/zion-admin-openai-cost-retries",
  "/api/cron/zion-admin-openai-costs",
  "/api/dashboard/metrics",
  "/api/onboarding/intelligent-import",
  "/api/onboarding/intelligent-import/save-approved",
  "/api/onboarding/intelligent-import/staged-media-preview",
  "/api/onboarding/visual-catalog-document-map",
  "/api/onboarding/visual-catalog-document-scan",
  "/api/onboarding/visual-catalog-import",
  "/api/sales-contracts",
  "/api/sales-contracts/[contractId]",
  "/api/sales-contracts/[contractId]/approve",
  "/api/sales-contracts/[contractId]/correct-buyer",
  "/api/sales-contracts/[contractId]/correct-text",
  "/api/sales-contracts/[contractId]/customer-sign",
  "/api/sales-contracts/[contractId]/generate-pdf",
  "/api/sales-contracts/[contractId]/send",
  "/api/sales-contracts/[contractId]/signed-pdf-url",
  "/api/sales-contracts/[contractId]/store-sign",
  "/api/sales-contracts/create-from-quote",
  "/api/sales-contracts/create-manual",
  "/api/sales-contracts/template-edit-source",
  "/api/sales-contracts/template-source",
  "/api/sales-contracts/text-draft",
  "/api/sales-contracts/text-draft/pdf-preview",
  "/api/sales-quotes",
  "/api/sales-quotes/[quoteId]",
  "/api/sales-quotes/[quoteId]/apply-change",
  "/api/sales-quotes/[quoteId]/approve",
  "/api/sales-quotes/[quoteId]/edit-human",
  "/api/sales-quotes/[quoteId]/generate-pdf",
  "/api/sales-quotes/[quoteId]/request-change",
  "/api/sales-quotes/[quoteId]/send",
  "/api/sales-quotes/[quoteId]/signed-pdf-url",
  "/api/sales-quotes/create",
  "/api/schedule",
  "/api/schedule/customer-location",
  "/api/schedule/technical-visit",
  "/api/simulate-customer",
  "/api/simulate-customer-media",
  "/api/store/cep",
  "/api/store/monthly-sales-goal",
  "/api/store/primary-responsible",
  "/api/store/readiness",
  "/api/store/update-name",
  "/api/store/whatsapp/binding-change",
  "/api/store/whatsapp/embedded-signup",
  "/api/store/whatsapp/number-change-link",
  "/api/store/whatsapp/status",
  "/api/store-branding/logo",
  "/api/store-contract-templates",
  "/api/store-contract-templates/[versionId]/analyze",
  "/api/store-contract-templates/[versionId]/approve",
  "/api/store-contract-templates/[versionId]/download",
  "/api/store-contract-templates/[versionId]/extract-rules",
  "/api/store-contract-templates/[versionId]/reject",
  "/api/store-contract-templates/rules/[ruleId]/review",
  "/api/store-contract-templates/upload",
  "/api/webhooks/whatsapp",
  "/api/zion-admin/accounts/access-state",
  "/api/zion-admin/accounts/create",
  "/api/zion-admin/accounts/resend-first-access",
  "/api/zion-admin/costs",
  "/api/zion-admin/costs/catalog",
  "/api/zion-admin/costs/openai-first-run",
  "/api/zion-admin/costs/openai-manual-run",
  "/api/zion-admin/costs/openai-official",
  "/api/zion-admin/diagnostics",
  "/api/zion-admin/financial-evidence/review/confirm",
  "/api/zion-admin/financial-evidence/review/document",
  "/api/zion-admin/financial-evidence/review/meta-batch",
  "/api/zion-admin/financial-evidence/review/prepare",
  "/api/zion-admin/financial-evidence/upload",
  "/api/zion-admin/financial-history",
  "/api/zion-admin/manual-revenue",
  "/api/zion-admin/meta-cost-evidence",
  "/api/zion-admin/meta-integrations",
  "/api/zion-admin/meta-pricing",
  "/api/zion-admin/overview",
  "/api/zion-admin/stores/subscription-state",
  "/api/zion-admin/whatsapp-number-change",
  "/api/zion-admin/whatsapp-pins",
  "/api/zion-admin/whatsapp-pins/recovery",
  "/api/zion-admin/whatsapp-pins/reveal",
  "/api/zion-admin/whatsapp-pins/rotation",
  "/api/zion-admin/whatsapp-pins/rotation/execute"
]
);

const KNOWN_SOURCE_FILES: ReadonlySet<string> = new Set(
[
  "src/app/(app)/AppShellClient.tsx",
  "src/app/(app)/assistant/opportunity-priority.ts",
  "src/app/(app)/assistant/page.tsx",
  "src/app/(app)/assistant/staleness-scope.ts",
  "src/app/(app)/configuracoes/catalogo/[categoria]/page.tsx",
  "src/app/(app)/configuracoes/contract-rule-review-ui.ts",
  "src/app/(app)/configuracoes/page.tsx",
  "src/app/(app)/configuracoes/piscinas/page.tsx",
  "src/app/(app)/crm/lead/[id]/CatalogProductComposerPicker.tsx",
  "src/app/(app)/crm/lead/[id]/conclude-opportunity-visibility.ts",
  "src/app/(app)/crm/lead/[id]/contract-panel-preview.ts",
  "src/app/(app)/crm/lead/[id]/contract-send-orchestration.ts",
  "src/app/(app)/crm/lead/[id]/contract-template-text-editor.tsx",
  "src/app/(app)/crm/lead/[id]/contract-text-search.ts",
  "src/app/(app)/crm/lead/[id]/page.tsx",
  "src/app/(app)/crm/lead/[id]/quote-catalog-prefill.ts",
  "src/app/(app)/crm/lead/[id]/QuoteCatalogPrefillPicker.tsx",
  "src/app/(app)/crm/lead/[id]/quote-create-operation.ts",
  "src/app/(app)/crm/manual-lead-create-operation.ts",
  "src/app/(app)/crm/manual-lead-phone.ts",
  "src/app/(app)/crm/opportunity/[id]/page.tsx",
  "src/app/(app)/crm/page.tsx",
  "src/app/(app)/dashboard/page.tsx",
  "src/app/(app)/help/page.tsx",
  "src/app/(app)/inbox/followup-priority-order.ts",
  "src/app/(app)/inbox/page.tsx",
  "src/app/(app)/layout.tsx",
  "src/app/(app)/loading.tsx",
  "src/app/(app)/schedule/appointment-create-contract.ts",
  "src/app/(app)/schedule/appointment-create-operation.ts",
  "src/app/(app)/schedule/page.tsx",
  "src/app/(app)/schedule/schedule-timezone.ts",
  "src/app/(legal)/data-deletion/page.tsx",
  "src/app/(legal)/LegalPageLayout.tsx",
  "src/app/(legal)/privacy-policy/page.tsx",
  "src/app/(legal)/terms-of-service/page.tsx",
  "src/app/account/access-blocked/page.tsx",
  "src/app/account/access-unavailable/page.tsx",
  "src/app/api/account/ensure-setup/route.ts",
  "src/app/api/account/ensure-setup/route-handler.ts",
  "src/app/api/account/first-access/complete/route.ts",
  "src/app/api/account/password-flow/route.ts",
  "src/app/api/ai/reply/route.ts",
  "src/app/api/assistant/actions/contract-workflow/route.ts",
  "src/app/api/assistant/actions/document/route.ts",
  "src/app/api/assistant/messages/[messageId]/signed-media-url/route.ts",
  "src/app/api/assistant/reply/route.ts",
  "src/app/api/assistant/responsible-external-notifications/cancel/route.ts",
  "src/app/api/assistant/responsible-external-notifications/prepare/route.ts",
  "src/app/api/assistant/responsible-external-notifications/route.ts",
  "src/app/api/assistant/responsible-external-notifications/send/route.ts",
  "src/app/api/assistant/responsible-external-notifications/unlock-processing/route.ts",
  "src/app/api/crm/catalog-products/route.ts",
  "src/app/api/crm/human-response-commitments/route.ts",
  "src/app/api/crm/human-response-commitments/route-handler.ts",
  "src/app/api/crm/lead-details/[id]/route.ts",
  "src/app/api/crm/leads/manual/route.ts",
  "src/app/api/crm/messages/[messageId]/outbound-review/route.ts",
  "src/app/api/crm/messages/[messageId]/signed-media-url/route.ts",
  "src/app/api/crm/messages/send-manual-attachment/authorize/route.ts",
  "src/app/api/crm/messages/send-manual-attachment/finalize/route.ts",
  "src/app/api/crm/messages/send-manual-attachment/route.ts",
  "src/app/api/crm/messages/send-manual-catalog-product/route.ts",
  "src/app/api/crm/messages/send-manual-text/route.ts",
  "src/app/api/crm/opportunities/action-readiness/route.ts",
  "src/app/api/crm/opportunities/conclude/route.ts",
  "src/app/api/crm/opportunities/new-cycle/route.ts",
  "src/app/api/crm/opportunities/payment/route.ts",
  "src/app/api/crm/opportunities/reopen-for-post-sale/route.ts",
  "src/app/api/cron/assistant-operational-tasks/route.ts",
  "src/app/api/cron/assistant-panel-whatsapp-sync/route.ts",
  "src/app/api/cron/assistant-reports/route.ts",
  "src/app/api/cron/whatsapp-process-all/route.ts",
  "src/app/api/cron/zion-admin-diagnostic-ai-runs/route.ts",
  "src/app/api/cron/zion-admin-diagnostic-operational/route.ts",
  "src/app/api/cron/zion-admin-monthly-preclosure/route.ts",
  "src/app/api/cron/zion-admin-openai-cost-cutover/route.ts",
  "src/app/api/cron/zion-admin-openai-cost-retries/route.ts",
  "src/app/api/cron/zion-admin-openai-costs/route.ts",
  "src/app/api/dashboard/metrics/route.ts",
  "src/app/api/onboarding/intelligent-import/route.ts",
  "src/app/api/onboarding/intelligent-import/save-approved/route.ts",
  "src/app/api/onboarding/intelligent-import/staged-media-preview/route.ts",
  "src/app/api/onboarding/visual-catalog-document-map/route.ts",
  "src/app/api/onboarding/visual-catalog-document-scan/route.ts",
  "src/app/api/onboarding/visual-catalog-import/route.ts",
  "src/app/api/sales-contracts/[contractId]/approve/route.ts",
  "src/app/api/sales-contracts/[contractId]/correct-buyer/route.ts",
  "src/app/api/sales-contracts/[contractId]/correct-text/route.ts",
  "src/app/api/sales-contracts/[contractId]/customer-sign/route.ts",
  "src/app/api/sales-contracts/[contractId]/generate-pdf/route.ts",
  "src/app/api/sales-contracts/[contractId]/route.ts",
  "src/app/api/sales-contracts/[contractId]/send/route.ts",
  "src/app/api/sales-contracts/[contractId]/signed-pdf-url/route.ts",
  "src/app/api/sales-contracts/[contractId]/store-sign/route.ts",
  "src/app/api/sales-contracts/create-from-quote/route.ts",
  "src/app/api/sales-contracts/create-manual/route.ts",
  "src/app/api/sales-contracts/route.ts",
  "src/app/api/sales-contracts/template-edit-source/route.ts",
  "src/app/api/sales-contracts/template-source/route.ts",
  "src/app/api/sales-contracts/text-draft/pdf-preview/route.ts",
  "src/app/api/sales-contracts/text-draft/route.ts",
  "src/app/api/sales-quotes/[quoteId]/apply-change/route.ts",
  "src/app/api/sales-quotes/[quoteId]/approve/route.ts",
  "src/app/api/sales-quotes/[quoteId]/edit-human/route.ts",
  "src/app/api/sales-quotes/[quoteId]/generate-pdf/route.ts",
  "src/app/api/sales-quotes/[quoteId]/request-change/route.ts",
  "src/app/api/sales-quotes/[quoteId]/route.ts",
  "src/app/api/sales-quotes/[quoteId]/send/route.ts",
  "src/app/api/sales-quotes/[quoteId]/signed-pdf-url/route.ts",
  "src/app/api/sales-quotes/create/route.ts",
  "src/app/api/sales-quotes/route.ts",
  "src/app/api/schedule/customer-location/route.ts",
  "src/app/api/schedule/route.ts",
  "src/app/api/schedule/technical-visit/route.ts",
  "src/app/api/simulate-customer/handler.ts",
  "src/app/api/simulate-customer/route.ts",
  "src/app/api/simulate-customer-media/handler.ts",
  "src/app/api/simulate-customer-media/route.ts",
  "src/app/api/store/cep/route.ts",
  "src/app/api/store/monthly-sales-goal/route.ts",
  "src/app/api/store/primary-responsible/route.ts",
  "src/app/api/store/readiness/route.ts",
  "src/app/api/store/update-name/route.ts",
  "src/app/api/store/whatsapp/binding-change/route.ts",
  "src/app/api/store/whatsapp/embedded-signup/route.ts",
  "src/app/api/store/whatsapp/number-change-link/route.ts",
  "src/app/api/store/whatsapp/number-change-link/route-handler.ts",
  "src/app/api/store/whatsapp/status/route.ts",
  "src/app/api/store-branding/logo/route.ts",
  "src/app/api/store-contract-templates/[versionId]/analyze/route.ts",
  "src/app/api/store-contract-templates/[versionId]/approve/route.ts",
  "src/app/api/store-contract-templates/[versionId]/download/route.ts",
  "src/app/api/store-contract-templates/[versionId]/extract-rules/route.ts",
  "src/app/api/store-contract-templates/[versionId]/reject/route.ts",
  "src/app/api/store-contract-templates/route.ts",
  "src/app/api/store-contract-templates/rules/[ruleId]/review/route.ts",
  "src/app/api/store-contract-templates/upload/route.ts",
  "src/app/api/webhooks/whatsapp/route.ts",
  "src/app/api/zion-admin/accounts/access-state/route.ts",
  "src/app/api/zion-admin/accounts/access-state/route-handler.ts",
  "src/app/api/zion-admin/accounts/create/route.ts",
  "src/app/api/zion-admin/accounts/resend-first-access/route.ts",
  "src/app/api/zion-admin/accounts/resend-first-access/route-handler.ts",
  "src/app/api/zion-admin/costs/catalog/route.ts",
  "src/app/api/zion-admin/costs/openai-first-run/route.ts",
  "src/app/api/zion-admin/costs/openai-manual-run/route.ts",
  "src/app/api/zion-admin/costs/openai-official/route.ts",
  "src/app/api/zion-admin/costs/route.ts",
  "src/app/api/zion-admin/diagnostics/route.ts",
  "src/app/api/zion-admin/financial-evidence/review/confirm/route.ts",
  "src/app/api/zion-admin/financial-evidence/review/document/route.ts",
  "src/app/api/zion-admin/financial-evidence/review/meta-batch/route.ts",
  "src/app/api/zion-admin/financial-evidence/review/prepare/route.ts",
  "src/app/api/zion-admin/financial-evidence/upload/route.ts",
  "src/app/api/zion-admin/financial-history/route.ts",
  "src/app/api/zion-admin/manual-revenue/route.ts",
  "src/app/api/zion-admin/meta-cost-evidence/route.ts",
  "src/app/api/zion-admin/meta-integrations/route.ts",
  "src/app/api/zion-admin/meta-pricing/route.ts",
  "src/app/api/zion-admin/overview/commercial-action-classification.ts",
  "src/app/api/zion-admin/overview/commercial-action-evidence.ts",
  "src/app/api/zion-admin/overview/operational-health-resolution.ts",
  "src/app/api/zion-admin/overview/operational-health-source-adapter.ts",
  "src/app/api/zion-admin/overview/overview-diagnostic-association.ts",
  "src/app/api/zion-admin/overview/overview-pagination.ts",
  "src/app/api/zion-admin/overview/overview-sensitive-data.ts",
  "src/app/api/zion-admin/overview/route.ts",
  "src/app/api/zion-admin/overview/settings-readiness-overview.ts",
  "src/app/api/zion-admin/overview/settings-readiness-resolution.ts",
  "src/app/api/zion-admin/overview/settings-readiness-source-adapter.ts",
  "src/app/api/zion-admin/overview/store-account-access-resolution.ts",
  "src/app/api/zion-admin/overview/store-account-identity-resolution.ts",
  "src/app/api/zion-admin/overview/store-integrity-resolution.ts",
  "src/app/api/zion-admin/stores/subscription-state/route.ts",
  "src/app/api/zion-admin/stores/subscription-state/route-handler.ts",
  "src/app/api/zion-admin/whatsapp-number-change/route.ts",
  "src/app/api/zion-admin/whatsapp-number-change/route-handler.ts",
  "src/app/api/zion-admin/whatsapp-pins/recovery/route.ts",
  "src/app/api/zion-admin/whatsapp-pins/reveal/route.ts",
  "src/app/api/zion-admin/whatsapp-pins/rotation/execute/route.ts",
  "src/app/api/zion-admin/whatsapp-pins/rotation/route.ts",
  "src/app/api/zion-admin/whatsapp-pins/route.ts",
  "src/app/auth/callback/callback-handler.ts",
  "src/app/auth/callback/route.ts",
  "src/app/auth/reset-password/page.tsx",
  "src/app/auth/set-initial-password/page.tsx",
  "src/app/auth/set-initial-password/SetInitialPasswordClient.tsx",
  "src/app/layout.tsx",
  "src/app/login/page.tsx",
  "src/app/onboarding/layout.tsx",
  "src/app/onboarding/onboarding-scope.ts",
  "src/app/onboarding/page.tsx",
  "src/app/onboarding/whatsapp-display.ts",
  "src/app/page.tsx",
  "src/app/test-supabase/page.tsx",
  "src/app/ui-check/page.tsx",
  "src/app/whatsapp-number-change/number-change-link-start.ts",
  "src/app/whatsapp-number-change/page.tsx",
  "src/app/whatsapp-number-change/WhatsappNumberChangeClient.tsx",
  "src/app/zion-admin/ai-run-classification.ts",
  "src/app/zion-admin/first-access-control.ts",
  "src/app/zion-admin/login/page.tsx",
  "src/app/zion-admin/operational-health-guidance.ts",
  "src/app/zion-admin/operational-summary.ts",
  "src/app/zion-admin/overview-availability.ts",
  "src/app/zion-admin/page.tsx",
  "src/app/zion-admin/pin-rotation-ui-protocol.ts",
  "src/app/zion-admin/recent-ai-errors.ts",
  "src/app/zion-admin/ZionAdminCostsRecalculate.tsx",
  "src/app/zion-admin/ZionAdminCostsSection.tsx",
  "src/app/zion-admin/ZionAdminDashboardClient.tsx",
  "src/app/zion-admin/ZionAdminDiagnosticIncidents.tsx",
  "src/app/zion-admin/ZionAdminFinancialHistory.tsx",
  "src/app/zion-admin/ZionAdminManualRevenue.tsx",
  "src/app/zion-admin/ZionAdminMetaCosts.tsx",
  "src/app/zion-admin/ZionAdminOpenAiOfficialCosts.tsx",
  "src/app/zion-admin/ZionAdminPinRotationControls.tsx",
  "src/app/zion-admin/ZionAdminVariableExpenseCatalog.tsx",
  "src/app/zion-admin/ZionAdminWhatsappNumberChange.tsx",
  "src/components/assistant/ResponsibleExternalNotificationsPanel.tsx",
  "src/components/catalog/IntelligentCatalogImportPanel.tsx",
  "src/components/layout/AppHeader.tsx",
  "src/components/layout/Sidebar.tsx",
  "src/components/nav/SidebarLink.tsx",
  "src/components/OnboardingGuard.tsx",
  "src/components/OrgGuard.tsx",
  "src/components/StoreProvider.tsx",
  "src/config/crm.ts",
  "src/hooks/useOrgAccess.ts",
  "src/lib/account-access.ts",
  "src/lib/account-access-middleware-policy.ts",
  "src/lib/account-access-page-gate.ts",
  "src/lib/account-access-resolution.ts",
  "src/lib/assistant/active-pending-actions.ts",
  "src/lib/auth-public-url.ts",
  "src/lib/auth-safe-redirect.ts",
  "src/lib/catalog/availability.ts",
  "src/lib/catalog/presentation.ts",
  "src/lib/client/embedded-signup-recovery.ts",
  "src/lib/client/meta-embedded-signup.ts",
  "src/lib/client/use-meta-embedded-signup-attempt.ts",
  "src/lib/commercial-opportunity-current-proposal-projection.ts",
  "src/lib/commercial-opportunity-visit-stage-projection.ts",
  "src/lib/google-maps-route.ts",
  "src/lib/leads.ts",
  "src/lib/onboarding-import-dedup-identity.ts",
  "src/lib/onboarding-import-structured-parser.ts",
  "src/lib/onboarding-intelligent-import-save-contract.ts",
  "src/lib/password-policy.ts",
  "src/lib/sales-quotes/validity.ts",
  "src/lib/server/account-access-resolver.ts",
  "src/lib/server/ai-sales-behavior.ts",
  "src/lib/server/ai-sales-methodology.ts",
  "src/lib/server/ai-sales-response-brain.ts",
  "src/lib/server/analyze-customer-location-photo.ts",
  "src/lib/server/assistant/appointment-selection.ts",
  "src/lib/server/assistant/assistant-panel-template-status.ts",
  "src/lib/server/assistant/assistant-panel-whatsapp-sync.ts",
  "src/lib/server/assistant/automatic-reports.ts",
  "src/lib/server/assistant/contract-generation-intent.ts",
  "src/lib/server/assistant/contract-workflow-actions.ts",
  "src/lib/server/assistant/contract-workflow-messages.ts",
  "src/lib/server/assistant/customer-commercial-intents.ts",
  "src/lib/server/assistant/customer-commercial-notifications.ts",
  "src/lib/server/assistant/customer-context-report.ts",
  "src/lib/server/assistant/customer-context-summary.ts",
  "src/lib/server/assistant/customer-reschedule-workflow.ts",
  "src/lib/server/assistant/datetime.ts",
  "src/lib/server/assistant/document-actions.ts",
  "src/lib/server/assistant/document-edit-intent.ts",
  "src/lib/server/assistant/document-review-messages.ts",
  "src/lib/server/assistant/human-command-resolver.ts",
  "src/lib/server/assistant/payment-proof-decision.ts",
  "src/lib/server/assistant/received-contract-document-acknowledgement.ts",
  "src/lib/server/assistant/received-contract-document-confirmation.ts",
  "src/lib/server/assistant/received-contract-document-decision.ts",
  "src/lib/server/assistant/reschedule-target.ts",
  "src/lib/server/assistant/responsible-external-notifications.ts",
  "src/lib/server/assistant/responsible-external-notifications-drainer.ts",
  "src/lib/server/assistant/responsible-external-notifications-sender.ts",
  "src/lib/server/assistant/responsible-whatsapp-conversation.ts",
  "src/lib/server/assistant/responsible-whatsapp-outbound-policy.ts",
  "src/lib/server/assistant/types.ts",
  "src/lib/server/commercial-action-readiness.ts",
  "src/lib/server/commercial-conversation-fact-events.ts",
  "src/lib/server/contextual-reconstruction-aggregator.ts",
  "src/lib/server/contextual-reconstruction-conflict-resolver.ts",
  "src/lib/server/contextual-reconstruction-snapshot.ts",
  "src/lib/server/conversation-ai-sales-eligibility.ts",
  "src/lib/server/crm/lead-conversation-opportunity-context.ts",
  "src/lib/server/crm/resolve-authorized-opportunity-detail.internal.ts",
  "src/lib/server/crm/resolve-authorized-opportunity-detail.ts",
  "src/lib/server/customer-geography-resolution.ts",
  "src/lib/server/customer-identity-name-extraction.ts",
  "src/lib/server/dashboard-time.ts",
  "src/lib/server/generate-ai-reply.ts",
  "src/lib/server/generate-ai-sales-reply.ts",
  "src/lib/server/generate-and-save-ai-sales-reply.ts",
  "src/lib/server/human-response-alert-scanner.ts",
  "src/lib/server/human-response-commitments.ts",
  "src/lib/server/informal-portuguese-context.ts",
  "src/lib/server/ingest-commercial-conversation-facts.ts",
  "src/lib/server/manual-attachment-contract.ts",
  "src/lib/server/manual-catalog-product-contract.ts",
  "src/lib/server/media-classification.ts",
  "src/lib/server/meta-whatsapp-embedded-signup.ts",
  "src/lib/server/meta-whatsapp-pin-rotation.ts",
  "src/lib/server/onboarding-file-extractors.ts",
  "src/lib/server/onboarding-import-dedup.ts",
  "src/lib/server/onboarding-import-normalizers.ts",
  "src/lib/server/onboarding-intelligent-import.ts",
  "src/lib/server/onboarding-intelligent-import-save.ts",
  "src/lib/server/openai-organization-costs-collector.ts",
  "src/lib/server/p19a-quote-preparation-concurrency-runner.mjs",
  "src/lib/server/p9-contract-buyer-data-crypto.ts",
  "src/lib/server/payment-proof-confirmation.ts",
  "src/lib/server/physical-contract-signature.ts",
  "src/lib/server/post-technical-visit-decision.ts",
  "src/lib/server/post-technical-visit-followups.ts",
  "src/lib/server/post-technical-visit-result-extraction.ts",
  "src/lib/server/post-technical-visit-runtime.ts",
  "src/lib/server/process-ai-run-queue.ts",
  "src/lib/server/process-assistant-operational-tasks.ts",
  "src/lib/server/promote-commercial-memory-to-opportunity.ts",
  "src/lib/server/sales-ai-appointment-context.ts",
  "src/lib/server/sales-ai-behavior-contract.ts",
  "src/lib/server/sales-ai-error-diagnostics.ts",
  "src/lib/server/sales-ai-failure-operational-alert.ts",
  "src/lib/server/sales-ai-operating-window.ts",
  "src/lib/server/sales-ai-price-negotiation-strategy.ts",
  "src/lib/server/sales-contracts/build-contract-pdf.ts",
  "src/lib/server/sales-contracts/build-contract-text-draft-pdf.ts",
  "src/lib/server/sales-contracts/buyer-correction-version.ts",
  "src/lib/server/sales-contracts/canonical-contract-renderer.ts",
  "src/lib/server/sales-contracts/contract-auth.ts",
  "src/lib/server/sales-contracts/contract-events.ts",
  "src/lib/server/sales-contracts/contract-messaging.ts",
  "src/lib/server/sales-contracts/contract-send.ts",
  "src/lib/server/sales-contracts/contract-signatures.ts",
  "src/lib/server/sales-contracts/contract-storage.ts",
  "src/lib/server/sales-contracts/contract-template-terms.ts",
  "src/lib/server/sales-contracts/contract-text-correction-version.ts",
  "src/lib/server/sales-contracts/contract-text-draft-canonical-snapshot.ts",
  "src/lib/server/sales-contracts/contract-text-draft-pdf-preview.ts",
  "src/lib/server/sales-contracts/contract-text-draft-source.ts",
  "src/lib/server/sales-contracts/contract-text-draft-version-provenance.ts",
  "src/lib/server/sales-contracts/contract-versioning.ts",
  "src/lib/server/sales-contracts/contract-workflow-decision.ts",
  "src/lib/server/sales-contracts/correct-and-render-contract-text.ts",
  "src/lib/server/sales-contracts/customer-contract-acceptance.ts",
  "src/lib/server/sales-contracts/received-contract-document-evidence.ts",
  "src/lib/server/sales-contracts/received-contract-document-identity.ts",
  "src/lib/server/sales-contracts/render-contract-text-draft-version.ts",
  "src/lib/server/sales-contracts/types.ts",
  "src/lib/server/sales-qualification-fact-extraction.ts",
  "src/lib/server/sales-quotes/accepted-sales-quote-revision.ts",
  "src/lib/server/sales-quotes/build-quote-pdf.ts",
  "src/lib/server/sales-quotes/canonical-payload-v1.ts",
  "src/lib/server/sales-quotes/create-authorized-sales-quote-draft-by-system.ts",
  "src/lib/server/sales-quotes/create-sales-quote-draft-by-system.ts",
  "src/lib/server/sales-quotes/enqueue-quote-preparation-task-by-system.ts",
  "src/lib/server/sales-quotes/human-quote-draft-edit-input.ts",
  "src/lib/server/sales-quotes/human-quote-edit-boundary.ts",
  "src/lib/server/sales-quotes/human-quote-edit-provenance.ts",
  "src/lib/server/sales-quotes/issue-quote-preparation-task-authorization-by-system.ts",
  "src/lib/server/sales-quotes/money.ts",
  "src/lib/server/sales-quotes/negotiation-concession-materialization.ts",
  "src/lib/server/sales-quotes/quote-approval-decision.ts",
  "src/lib/server/sales-quotes/quote-approval-delivery.ts",
  "src/lib/server/sales-quotes/quote-approval-request.ts",
  "src/lib/server/sales-quotes/quote-auth.ts",
  "src/lib/server/sales-quotes/quote-change-requests.ts",
  "src/lib/server/sales-quotes/quote-conversation-readiness.ts",
  "src/lib/server/sales-quotes/quote-creation-boundary.ts",
  "src/lib/server/sales-quotes/quote-events.ts",
  "src/lib/server/sales-quotes/quote-expiration.ts",
  "src/lib/server/sales-quotes/quote-kind.ts",
  "src/lib/server/sales-quotes/quote-send.ts",
  "src/lib/server/sales-quotes/quote-settings.ts",
  "src/lib/server/sales-quotes/quote-storage.ts",
  "src/lib/server/sales-quotes/quote-versioning.ts",
  "src/lib/server/sales-quotes/register-quote-preparation-from-task-by-system.ts",
  "src/lib/server/sales-quotes/register-quote-preparation-operation-by-system.ts",
  "src/lib/server/sales-quotes/resolve-quote-preparation-identity-by-system.ts",
  "src/lib/server/sales-quotes/types.ts",
  "src/lib/server/sales-quotes/unlinked-quote-list.ts",
  "src/lib/server/sales-quotes/validate-quote-preparation-task-authorization-by-system.ts",
  "src/lib/server/store-api-access.ts",
  "src/lib/server/store-api-response.ts",
  "src/lib/server/store-brand-pdf-theme.ts",
  "src/lib/server/store-brand-visual-policy.ts",
  "src/lib/server/store-contract-templates/contract-rule-extraction.ts",
  "src/lib/server/store-contract-templates/contract-text-analysis.ts",
  "src/lib/server/store-contract-templates/template-management.ts",
  "src/lib/server/store-contract-usage-policy.ts",
  "src/lib/server/store-discount-counterpart-policy-reader.ts",
  "src/lib/server/store-discount-settings-reader.ts",
  "src/lib/server/store-readiness.ts",
  "src/lib/server/store-responsibles.ts",
  "src/lib/server/transactional-commercial-authority.ts",
  "src/lib/server/transcribe-customer-audio.ts",
  "src/lib/server/whatsapp-binding-change-operation.ts",
  "src/lib/server/whatsapp-connection-scenario-router.ts",
  "src/lib/server/whatsapp-external-sender.ts",
  "src/lib/server/whatsapp-inbound-media.ts",
  "src/lib/server/whatsapp-inbox-processor.ts",
  "src/lib/server/whatsapp-number-change-link.ts",
  "src/lib/server/whatsapp-pin-recovery.ts",
  "src/lib/server/whatsapp-process-all-status.ts",
  "src/lib/server/whatsapp-two-step-pin-crypto.ts",
  "src/lib/server/whatsapp-two-step-pin-secrets.ts",
  "src/lib/server/whatsapp-worker-claims.ts",
  "src/lib/server/zion-account-provisioning.ts",
  "src/lib/server/zion-admin-ai-run-evidence.ts",
  "src/lib/server/zion-admin-api-access.ts",
  "src/lib/server/zion-admin-api-response.ts",
  "src/lib/server/zion-admin-audit.ts",
  "src/lib/server/zion-admin-auth.ts",
  "src/lib/server/zion-admin-costs.ts",
  "src/lib/server/zion-admin-diagnostic-ai-run-cron-runner.ts",
  "src/lib/server/zion-admin-diagnostic-backend-classifier.ts",
  "src/lib/server/zion-admin-diagnostic-backend-evidence.ts",
  "src/lib/server/zion-admin-diagnostic-backend-identity.ts",
  "src/lib/server/zion-admin-diagnostic-operational-cron-runner.ts",
  "src/lib/server/zion-admin-diagnostic-reader-v2-projection.ts",
  "src/lib/server/zion-admin-financial-evidence-binding.ts",
  "src/lib/server/zion-admin-financial-evidence-binding-reader.ts",
  "src/lib/server/zion-admin-financial-evidence-integrity-reader.ts",
  "src/lib/server/zion-admin-financial-evidence-private-bytes.ts",
  "src/lib/server/zion-admin-financial-evidence-private-view-handler.ts",
  "src/lib/server/zion-admin-financial-evidence-review-access.ts",
  "src/lib/server/zion-admin-financial-evidence-review-confirmation.ts",
  "src/lib/server/zion-admin-financial-evidence-review-confirm-handler.ts",
  "src/lib/server/zion-admin-financial-evidence-review-preparation.ts",
  "src/lib/server/zion-admin-financial-evidence-review-prepare-handler.ts",
  "src/lib/server/zion-admin-financial-evidence-storage-integrity.ts",
  "src/lib/server/zion-admin-financial-evidence-upload-registration.ts",
  "src/lib/server/zion-admin-financial-evidence-upload-validation.ts",
  "src/lib/server/zion-admin-financial-evidence-verification-draft.ts",
  "src/lib/server/zion-admin-financial-history.ts",
  "src/lib/server/zion-admin-meta-candidate-account-reader.ts",
  "src/lib/server/zion-admin-meta-candidate-monthly-coverage-adapter.ts",
  "src/lib/server/zion-admin-meta-cost-evidence.ts",
  "src/lib/server/zion-admin-meta-document-batch-review-handler.ts",
  "src/lib/server/zion-admin-meta-financial-proof-contract.ts",
  "src/lib/server/zion-admin-meta-monthly-binding.ts",
  "src/lib/server/zion-admin-meta-monthly-coverage.ts",
  "src/lib/server/zion-admin-meta-pricing.ts",
  "src/lib/server/zion-admin-monthly-final-close-eligibility.ts",
  "src/lib/server/zion-admin-monthly-final-close-totals.ts",
  "src/lib/server/zion-admin-monthly-final-closure-evidence.ts",
  "src/lib/server/zion-admin-monthly-openai-ptax.ts",
  "src/lib/server/zion-admin-monthly-preclosure-execution.ts",
  "src/lib/server/zion-admin-monthly-preclosure-preparation.ts",
  "src/lib/server/zion-admin-monthly-preclosure-source-reader.ts",
  "src/lib/server/zion-admin-openai-cost-batch-adapters.ts",
  "src/lib/server/zion-admin-openai-cost-batch-coordinator.ts",
  "src/lib/server/zion-admin-openai-cost-claimed-operations.ts",
  "src/lib/server/zion-admin-openai-cost-cron-auth.ts",
  "src/lib/server/zion-admin-openai-cost-cutover-planner.ts",
  "src/lib/server/zion-admin-openai-cost-cutover-runner.ts",
  "src/lib/server/zion-admin-openai-cost-daily-claim-adapter.ts",
  "src/lib/server/zion-admin-openai-cost-daily-claim-validator.ts",
  "src/lib/server/zion-admin-openai-cost-daily-execution-auth.ts",
  "src/lib/server/zion-admin-openai-cost-daily-execution-runner.ts",
  "src/lib/server/zion-admin-openai-cost-daily-inventory-coordinator.ts",
  "src/lib/server/zion-admin-openai-cost-daily-planner.ts",
  "src/lib/server/zion-admin-openai-cost-daily-preparation-service.ts",
  "src/lib/server/zion-admin-openai-cost-daily-retry-eligibility.ts",
  "src/lib/server/zion-admin-openai-cost-daily-retry-reader.ts",
  "src/lib/server/zion-admin-openai-cost-daily-retry-runner.ts",
  "src/lib/server/zion-admin-openai-cost-execution-gate.ts",
  "src/lib/server/zion-admin-openai-cost-expired-quarantine.ts",
  "src/lib/server/zion-admin-openai-cost-first-collection-handler.ts",
  "src/lib/server/zion-admin-openai-cost-inventory-reader.ts",
  "src/lib/server/zion-admin-openai-cost-inventory-rpc.ts",
  "src/lib/server/zion-admin-openai-cost-manual-targeted-handler.ts",
  "src/lib/server/zion-admin-openai-cost-operation-failure.ts",
  "src/lib/server/zion-admin-openai-cost-operation-finalizer.ts",
  "src/lib/server/zion-admin-openai-cost-operation-preparer.ts",
  "src/lib/server/zion-admin-openai-cost-protected-preparer.ts",
  "src/lib/server/zion-admin-openai-cost-protected-runner.ts",
  "src/lib/server/zion-admin-openai-cost-protected-targeted-runner.ts",
  "src/lib/server/zion-admin-openai-cost-query-contract.ts",
  "src/lib/server/zion-admin-openai-cost-targeted-claim.ts",
  "src/lib/server/zion-admin-openai-cost-uncertain-inspector.ts",
  "src/lib/server/zion-admin-openai-cost-uncertain-review.ts",
  "src/lib/server/zion-admin-openai-official-cost-report.ts",
  "src/lib/server/zion-admin-openai-provider-cost-orchestrator.ts",
  "src/lib/server/zion-admin-openai-provider-cost-writer.ts",
  "src/lib/server/zion-admin-ptax-daily.ts",
  "src/lib/server/zion-admin-ptax-evidence-capture.ts",
  "src/lib/server/zion-admin-ptax-evidence-persist.ts",
  "src/lib/server/zion-admin-ptax-evidence-reconcile.ts",
  "src/lib/server/zion-admin-whatsapp-pin-rotation-binding.ts",
  "src/lib/server/zion-admin-whatsapp-pin-rotation-execute-handler.ts",
  "src/lib/server/zion-admin-whatsapp-pin-rotation-execution.ts",
  "src/lib/server/zion-admin-whatsapp-pin-rotation-preparation.ts",
  "src/lib/server/zion-admin-whatsapp-pin-rotation-target.ts",
  "src/lib/server/zion-admin-whatsapp-pin-rotation-wiring.ts",
  "src/lib/store-channel-settings.ts",
  "src/lib/store-commercial-ai-settings.ts",
  "src/lib/store-discount-counterpart-policy.ts",
  "src/lib/store-discount-settings.ts",
  "src/lib/store-monthly-sales-goal.ts",
  "src/lib/store-operation-execution-policies.ts",
  "src/lib/store-operation-settings.ts",
  "src/lib/store-payment-settings.ts",
  "src/lib/store-strategy-settings.ts",
  "src/lib/supabaseBrowser.ts",
  "src/lib/supabaseClient.ts",
  "src/lib/supabaseServer.ts",
  "src/lib/visual-catalog-document-analysis.ts",
  "src/lib/zion-account-provisioning-shared.ts",
  "src/lib/zion-admin-meta-cost-presentation.ts"
]
);

type Collector = ReturnType<
  typeof createBackendDiagnosticCollector
>;

type Schedule = (
  task: () => Promise<void>,
) => void;

type HookOptions = Readonly<{
  collector: Collector;
  schedule: Schedule;
  rethrowFrameworkControl: (
    error: unknown,
  ) => void;
}>;

function warnHookFailure(): void {
  try {
    console.warn(
      "ZION_BACKEND_DIAGNOSTIC_HOOK_FAILURE",
    );
  } catch {
    // Never replace the application error.
  }
}

function canonicalRoute(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  if (KNOWN_ROUTES.has(value)) {
    return value;
  }

  if (value.endsWith("/route")) {
    const candidate = value.slice(0,-6);

    if (KNOWN_ROUTES.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function createBackendRequestErrorHook(
  options: HookOptions,
): Instrumentation.onRequestError {
  return async (error, request, context) => {
    try {
      if (
        context.routerKind !== "App Router" ||
        context.routeType !== "route"
      ) {
        return;
      }

      const route = canonicalRoute(
        context.routePath,
      );

      if (!route) {
        return;
      }

      try {
        options.rethrowFrameworkControl(error);
      } catch {
        // Framework control-flow is not an incident.
        return;
      }

      const prepared = options.collector.prepare(
        {
          route,
          method: request.method,
          kind: "unhandled_exception",
        },
        error,
      );

      if (prepared.status !== "ready") {
        return;
      }

      let pending: Promise<void> | undefined;

      const persistOnce = (): Promise<void> => {
        pending ??= Promise.resolve()
          .then(async () => {
            await options.collector.persist(
              prepared,
            );
          })
          .catch(() => {
            warnHookFailure();
          });

        return pending;
      };

      try {
        options.schedule(persistOnce);
      } catch {
        // Outside request scope, use bounded persistence.
        // Never launch an untracked background promise.
        await persistOnce();
      }
    } catch {
      warnHookFailure();
    }
  };
}

let cachedHook:
  | Instrumentation.onRequestError
  | undefined;

export const handleBackendRequestError:
  Instrumentation.onRequestError =
  async (error, request, context) => {
    if (
      process.env.NEXT_RUNTIME !== "nodejs" ||
      process.env.ZION_ADMIN_DIAGNOSTIC_BACKEND_ENABLED
        !== "true"
    ) {
      return;
    }

    cachedHook ??= createBackendRequestErrorHook({
      collector: createBackendDiagnosticCollector({
        enabled: true,
        knownRoutes: KNOWN_ROUTES,
        knownSourceFiles: KNOWN_SOURCE_FILES,
        timeoutMs: 2000,
      }),
      schedule: task => after(task),
      rethrowFrameworkControl: unstable_rethrow,
    });

    await cachedHook(error,request,context);
  };


let cachedRouteObserver:
  | ReturnType<typeof createBackendRouteObserver>
  | undefined;

// Keep the existing handler authoritative.
// Observe only its final response. Thrown exceptions
// remain owned by the global onRequestError hook.

export function withBackendDiagnosticRoute<
  Args extends unknown[],
  Result extends Response | undefined,
>(
  route: string,
  declaredMethod: string,
  handler: (...args: Args) =>
    Result | Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args: Args) => {
    const response = await handler(...args);

    if (
      process.env.NEXT_RUNTIME !== "nodejs" ||
      process.env.ZION_ADMIN_DIAGNOSTIC_BACKEND_ENABLED
        !== "true"
    ) {
      return response;
    }

    try {
      if (
        !(response instanceof Response) ||
        response.status < 500 ||
        response.status > 599
      ) {
        return response;
      }

      // Next.js may implement HEAD through GET.
      // Use the actual method in that specific case.
      // Never inspect headers, URL or body.

      const request: unknown = args[0];

      const method =
        declaredMethod === "GET" &&
        request instanceof Request &&
        request.method === "HEAD"
          ? "HEAD"
          : declaredMethod;

      cachedRouteObserver ??=
        createBackendRouteObserver({
          enabled: true,
          collector:
            createBackendDiagnosticCollector({
              enabled: true,
              knownRoutes: KNOWN_ROUTES,
              knownSourceFiles:
                KNOWN_SOURCE_FILES,
              timeoutMs: 2000,
            }),
          schedule: task => after(task),
        });

      await cachedRouteObserver.observeResponse(
        route,
        method,
        response,
      );
    } catch {
      warnHookFailure();
    }

    return response;
  };
}

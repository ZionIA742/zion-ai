BEGIN;

DO $guard$
DECLARE v_oid oid := pg_catalog.to_regprocedure('public.register_zion_admin_backend_failure_by_system(uuid,text,text,uuid,uuid,text,text,text,integer,timestamptz,jsonb)');
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_oid AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND upper(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex'))='DD7FBAF412E71738F4F7577F2F52B06902E0A3E266F84BE734433379AAA137D6')
 OR NOT pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE')
 OR pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
 OR pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
 THEN RAISE EXCEPTION 'BACKEND_WRITER_INTEGRITY_OR_ACL'; END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.register_zion_admin_backend_failure_by_system(
    p_event_id uuid,
    p_incident_key text,
    p_scope text,
    p_organization_id uuid,
    p_store_id uuid,
    p_route text,
    p_method text,
    p_kind text,
    p_http_status integer,
    p_occurred_at timestamptz,
    p_evidence jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_routes CONSTANT text[] := ARRAY[
        '/api/account/ensure-setup',
        '/api/account/first-access/complete',
        '/api/account/password-flow',
        '/api/ai/reply',
        '/api/assistant/actions/contract-workflow',
        '/api/assistant/actions/document',
        '/api/assistant/messages/[messageId]/signed-media-url',
        '/api/assistant/reply',
        '/api/assistant/responsible-external-notifications',
        '/api/assistant/responsible-external-notifications/cancel',
        '/api/assistant/responsible-external-notifications/prepare',
        '/api/assistant/responsible-external-notifications/send',
        '/api/assistant/responsible-external-notifications/unlock-processing',
        '/api/crm/catalog-products',
        '/api/crm/human-response-commitments',
        '/api/crm/lead-details/[id]',
        '/api/crm/leads/manual',
        '/api/crm/messages/[messageId]/outbound-review',
        '/api/crm/messages/[messageId]/signed-media-url',
        '/api/crm/messages/send-manual-attachment',
        '/api/crm/messages/send-manual-attachment/authorize',
        '/api/crm/messages/send-manual-attachment/finalize',
        '/api/crm/messages/send-manual-catalog-product',
        '/api/crm/messages/send-manual-text',
        '/api/crm/opportunities/action-readiness',
        '/api/crm/opportunities/conclude',
        '/api/crm/opportunities/new-cycle',
        '/api/crm/opportunities/payment',
        '/api/crm/opportunities/reopen-for-post-sale',
        '/api/cron/assistant-operational-tasks',
        '/api/cron/assistant-panel-whatsapp-sync',
        '/api/cron/assistant-reports',
        '/api/cron/whatsapp-process-all',
        '/api/cron/zion-admin-diagnostic-ai-runs',
        '/api/cron/zion-admin-diagnostic-operational',
        '/api/cron/zion-admin-monthly-preclosure',
        '/api/cron/zion-admin-openai-cost-cutover',
        '/api/cron/zion-admin-openai-cost-retries',
        '/api/cron/zion-admin-openai-costs',
        '/api/dashboard/metrics',
        '/api/onboarding/intelligent-import',
        '/api/onboarding/intelligent-import/save-approved',
        '/api/onboarding/intelligent-import/staged-media-preview',
        '/api/onboarding/visual-catalog-document-map',
        '/api/onboarding/visual-catalog-document-scan',
        '/api/onboarding/visual-catalog-import',
        '/api/sales-contracts',
        '/api/sales-contracts/[contractId]',
        '/api/sales-contracts/[contractId]/approve',
        '/api/sales-contracts/[contractId]/correct-buyer',
        '/api/sales-contracts/[contractId]/correct-text',
        '/api/sales-contracts/[contractId]/customer-sign',
        '/api/sales-contracts/[contractId]/generate-pdf',
        '/api/sales-contracts/[contractId]/send',
        '/api/sales-contracts/[contractId]/signed-pdf-url',
        '/api/sales-contracts/[contractId]/store-sign',
        '/api/sales-contracts/create-from-quote',
        '/api/sales-contracts/create-manual',
        '/api/sales-contracts/template-edit-source',
        '/api/sales-contracts/template-source',
        '/api/sales-contracts/text-draft',
        '/api/sales-contracts/text-draft/pdf-preview',
        '/api/sales-quotes',
        '/api/sales-quotes/[quoteId]',
        '/api/sales-quotes/[quoteId]/apply-change',
        '/api/sales-quotes/[quoteId]/approve',
        '/api/sales-quotes/[quoteId]/edit-human',
        '/api/sales-quotes/[quoteId]/generate-pdf',
        '/api/sales-quotes/[quoteId]/request-change',
        '/api/sales-quotes/[quoteId]/send',
        '/api/sales-quotes/[quoteId]/signed-pdf-url',
        '/api/sales-quotes/create',
        '/api/schedule',
        '/api/schedule/customer-location',
        '/api/schedule/technical-visit',
        '/api/simulate-customer',
        '/api/simulate-customer-media',
        '/api/store/cep',
        '/api/store/monthly-sales-goal',
        '/api/store/primary-responsible',
        '/api/store/readiness',
        '/api/store/update-name',
        '/api/store/whatsapp/binding-change',
        '/api/store/whatsapp/embedded-signup',
        '/api/store/whatsapp/number-change-link',
        '/api/store/whatsapp/status',
        '/api/store-branding/logo',
        '/api/store-contract-templates',
        '/api/store-contract-templates/[versionId]/analyze',
        '/api/store-contract-templates/[versionId]/approve',
        '/api/store-contract-templates/[versionId]/download',
        '/api/store-contract-templates/[versionId]/extract-rules',
        '/api/store-contract-templates/[versionId]/reject',
        '/api/store-contract-templates/rules/[ruleId]/review',
        '/api/store-contract-templates/upload',
        '/api/webhooks/whatsapp',
        '/api/zion-admin/accounts/access-state',
        '/api/zion-admin/accounts/create',
        '/api/zion-admin/accounts/resend-first-access',
        '/api/zion-admin/costs',
        '/api/zion-admin/costs/catalog',
        '/api/zion-admin/costs/openai-first-run',
        '/api/zion-admin/costs/openai-manual-run',
        '/api/zion-admin/costs/openai-official',
        '/api/zion-admin/diagnostics',
        '/api/zion-admin/financial-evidence/review/confirm',
        '/api/zion-admin/financial-evidence/review/document',
        '/api/zion-admin/financial-evidence/review/meta-batch',
        '/api/zion-admin/financial-evidence/review/prepare',
        '/api/zion-admin/financial-evidence/upload',
        '/api/zion-admin/financial-history',
        '/api/zion-admin/manual-revenue',
        '/api/zion-admin/meta-cost-evidence',
        '/api/zion-admin/meta-integrations',
        '/api/zion-admin/meta-pricing',
        '/api/zion-admin/overview',
        '/api/zion-admin/stores/subscription-state',
        '/api/zion-admin/whatsapp-number-change',
        '/api/zion-admin/whatsapp-pins',
        '/api/zion-admin/whatsapp-pins/recovery',
        '/api/zion-admin/whatsapp-pins/reveal',
        '/api/zion-admin/whatsapp-pins/rotation',
        '/api/zion-admin/whatsapp-pins/rotation/execute',
        '/api/sales-quotes/lead-picker',
        '/api/diagnostics/client-browser',
        '/api/zion-admin/diagnostics/scheduler'
    ]::text[];

    v_sources CONSTANT text[] := ARRAY[
        'src/app/(app)/AppShellClient.tsx',
        'src/app/(app)/assistant/opportunity-priority.ts',
        'src/app/(app)/assistant/page.tsx',
        'src/app/(app)/assistant/staleness-scope.ts',
        'src/app/(app)/configuracoes/catalogo/[categoria]/page.tsx',
        'src/app/(app)/configuracoes/contract-rule-review-ui.ts',
        'src/app/(app)/configuracoes/page.tsx',
        'src/app/(app)/configuracoes/piscinas/page.tsx',
        'src/app/(app)/crm/lead/[id]/CatalogProductComposerPicker.tsx',
        'src/app/(app)/crm/lead/[id]/conclude-opportunity-visibility.ts',
        'src/app/(app)/crm/lead/[id]/contract-panel-preview.ts',
        'src/app/(app)/crm/lead/[id]/contract-send-orchestration.ts',
        'src/app/(app)/crm/lead/[id]/contract-template-text-editor.tsx',
        'src/app/(app)/crm/lead/[id]/contract-text-search.ts',
        'src/app/(app)/crm/lead/[id]/page.tsx',
        'src/app/(app)/crm/lead/[id]/quote-catalog-prefill.ts',
        'src/app/(app)/crm/lead/[id]/QuoteCatalogPrefillPicker.tsx',
        'src/app/(app)/crm/lead/[id]/quote-create-operation.ts',
        'src/app/(app)/crm/manual-lead-create-operation.ts',
        'src/app/(app)/crm/manual-lead-phone.ts',
        'src/app/(app)/crm/opportunity/[id]/page.tsx',
        'src/app/(app)/crm/page.tsx',
        'src/app/(app)/dashboard/page.tsx',
        'src/app/(app)/help/page.tsx',
        'src/app/(app)/inbox/followup-priority-order.ts',
        'src/app/(app)/inbox/page.tsx',
        'src/app/(app)/layout.tsx',
        'src/app/(app)/loading.tsx',
        'src/app/(app)/schedule/appointment-create-contract.ts',
        'src/app/(app)/schedule/appointment-create-operation.ts',
        'src/app/(app)/schedule/page.tsx',
        'src/app/(app)/schedule/schedule-timezone.ts',
        'src/app/(legal)/data-deletion/page.tsx',
        'src/app/(legal)/LegalPageLayout.tsx',
        'src/app/(legal)/privacy-policy/page.tsx',
        'src/app/(legal)/terms-of-service/page.tsx',
        'src/app/account/access-blocked/page.tsx',
        'src/app/account/access-unavailable/page.tsx',
        'src/app/api/account/ensure-setup/route.ts',
        'src/app/api/account/ensure-setup/route-handler.ts',
        'src/app/api/account/first-access/complete/route.ts',
        'src/app/api/account/password-flow/route.ts',
        'src/app/api/ai/reply/route.ts',
        'src/app/api/assistant/actions/contract-workflow/route.ts',
        'src/app/api/assistant/actions/document/route.ts',
        'src/app/api/assistant/messages/[messageId]/signed-media-url/route.ts',
        'src/app/api/assistant/reply/route.ts',
        'src/app/api/assistant/responsible-external-notifications/cancel/route.ts',
        'src/app/api/assistant/responsible-external-notifications/prepare/route.ts',
        'src/app/api/assistant/responsible-external-notifications/route.ts',
        'src/app/api/assistant/responsible-external-notifications/send/route.ts',
        'src/app/api/assistant/responsible-external-notifications/unlock-processing/route.ts',
        'src/app/api/crm/catalog-products/route.ts',
        'src/app/api/crm/human-response-commitments/route.ts',
        'src/app/api/crm/human-response-commitments/route-handler.ts',
        'src/app/api/crm/lead-details/[id]/route.ts',
        'src/app/api/crm/leads/manual/route.ts',
        'src/app/api/crm/messages/[messageId]/outbound-review/route.ts',
        'src/app/api/crm/messages/[messageId]/signed-media-url/route.ts',
        'src/app/api/crm/messages/send-manual-attachment/authorize/route.ts',
        'src/app/api/crm/messages/send-manual-attachment/finalize/route.ts',
        'src/app/api/crm/messages/send-manual-attachment/route.ts',
        'src/app/api/crm/messages/send-manual-catalog-product/route.ts',
        'src/app/api/crm/messages/send-manual-text/route.ts',
        'src/app/api/crm/opportunities/action-readiness/route.ts',
        'src/app/api/crm/opportunities/conclude/route.ts',
        'src/app/api/crm/opportunities/new-cycle/route.ts',
        'src/app/api/crm/opportunities/payment/route.ts',
        'src/app/api/crm/opportunities/reopen-for-post-sale/route.ts',
        'src/app/api/cron/assistant-operational-tasks/route.ts',
        'src/app/api/cron/assistant-panel-whatsapp-sync/route.ts',
        'src/app/api/cron/assistant-reports/route.ts',
        'src/app/api/cron/whatsapp-process-all/route.ts',
        'src/app/api/cron/zion-admin-diagnostic-ai-runs/route.ts',
        'src/app/api/cron/zion-admin-diagnostic-operational/route.ts',
        'src/app/api/cron/zion-admin-monthly-preclosure/route.ts',
        'src/app/api/cron/zion-admin-openai-cost-cutover/route.ts',
        'src/app/api/cron/zion-admin-openai-cost-retries/route.ts',
        'src/app/api/cron/zion-admin-openai-costs/route.ts',
        'src/app/api/dashboard/metrics/route.ts',
        'src/app/api/onboarding/intelligent-import/route.ts',
        'src/app/api/onboarding/intelligent-import/save-approved/route.ts',
        'src/app/api/onboarding/intelligent-import/staged-media-preview/route.ts',
        'src/app/api/onboarding/visual-catalog-document-map/route.ts',
        'src/app/api/onboarding/visual-catalog-document-scan/route.ts',
        'src/app/api/onboarding/visual-catalog-import/route.ts',
        'src/app/api/sales-contracts/[contractId]/approve/route.ts',
        'src/app/api/sales-contracts/[contractId]/correct-buyer/route.ts',
        'src/app/api/sales-contracts/[contractId]/correct-text/route.ts',
        'src/app/api/sales-contracts/[contractId]/customer-sign/route.ts',
        'src/app/api/sales-contracts/[contractId]/generate-pdf/route.ts',
        'src/app/api/sales-contracts/[contractId]/route.ts',
        'src/app/api/sales-contracts/[contractId]/send/route.ts',
        'src/app/api/sales-contracts/[contractId]/signed-pdf-url/route.ts',
        'src/app/api/sales-contracts/[contractId]/store-sign/route.ts',
        'src/app/api/sales-contracts/create-from-quote/route.ts',
        'src/app/api/sales-contracts/create-manual/route.ts',
        'src/app/api/sales-contracts/route.ts',
        'src/app/api/sales-contracts/template-edit-source/route.ts',
        'src/app/api/sales-contracts/template-source/route.ts',
        'src/app/api/sales-contracts/text-draft/pdf-preview/route.ts',
        'src/app/api/sales-contracts/text-draft/route.ts',
        'src/app/api/sales-quotes/[quoteId]/apply-change/route.ts',
        'src/app/api/sales-quotes/[quoteId]/approve/route.ts',
        'src/app/api/sales-quotes/[quoteId]/edit-human/route.ts',
        'src/app/api/sales-quotes/[quoteId]/generate-pdf/route.ts',
        'src/app/api/sales-quotes/[quoteId]/request-change/route.ts',
        'src/app/api/sales-quotes/[quoteId]/route.ts',
        'src/app/api/sales-quotes/[quoteId]/send/route.ts',
        'src/app/api/sales-quotes/[quoteId]/signed-pdf-url/route.ts',
        'src/app/api/sales-quotes/create/route.ts',
        'src/app/api/sales-quotes/route.ts',
        'src/app/api/schedule/customer-location/route.ts',
        'src/app/api/schedule/route.ts',
        'src/app/api/schedule/technical-visit/route.ts',
        'src/app/api/simulate-customer/handler.ts',
        'src/app/api/simulate-customer/route.ts',
        'src/app/api/simulate-customer-media/handler.ts',
        'src/app/api/simulate-customer-media/route.ts',
        'src/app/api/store/cep/route.ts',
        'src/app/api/store/monthly-sales-goal/route.ts',
        'src/app/api/store/primary-responsible/route.ts',
        'src/app/api/store/readiness/route.ts',
        'src/app/api/store/update-name/route.ts',
        'src/app/api/store/whatsapp/binding-change/route.ts',
        'src/app/api/store/whatsapp/embedded-signup/route.ts',
        'src/app/api/store/whatsapp/number-change-link/route.ts',
        'src/app/api/store/whatsapp/number-change-link/route-handler.ts',
        'src/app/api/store/whatsapp/status/route.ts',
        'src/app/api/store-branding/logo/route.ts',
        'src/app/api/store-contract-templates/[versionId]/analyze/route.ts',
        'src/app/api/store-contract-templates/[versionId]/approve/route.ts',
        'src/app/api/store-contract-templates/[versionId]/download/route.ts',
        'src/app/api/store-contract-templates/[versionId]/extract-rules/route.ts',
        'src/app/api/store-contract-templates/[versionId]/reject/route.ts',
        'src/app/api/store-contract-templates/route.ts',
        'src/app/api/store-contract-templates/rules/[ruleId]/review/route.ts',
        'src/app/api/store-contract-templates/upload/route.ts',
        'src/app/api/webhooks/whatsapp/route.ts',
        'src/app/api/zion-admin/accounts/access-state/route.ts',
        'src/app/api/zion-admin/accounts/access-state/route-handler.ts',
        'src/app/api/zion-admin/accounts/create/route.ts',
        'src/app/api/zion-admin/accounts/resend-first-access/route.ts',
        'src/app/api/zion-admin/accounts/resend-first-access/route-handler.ts',
        'src/app/api/zion-admin/costs/catalog/route.ts',
        'src/app/api/zion-admin/costs/openai-first-run/route.ts',
        'src/app/api/zion-admin/costs/openai-manual-run/route.ts',
        'src/app/api/zion-admin/costs/openai-official/route.ts',
        'src/app/api/zion-admin/costs/route.ts',
        'src/app/api/zion-admin/diagnostics/route.ts',
        'src/app/api/zion-admin/financial-evidence/review/confirm/route.ts',
        'src/app/api/zion-admin/financial-evidence/review/document/route.ts',
        'src/app/api/zion-admin/financial-evidence/review/meta-batch/route.ts',
        'src/app/api/zion-admin/financial-evidence/review/prepare/route.ts',
        'src/app/api/zion-admin/financial-evidence/upload/route.ts',
        'src/app/api/zion-admin/financial-history/route.ts',
        'src/app/api/zion-admin/manual-revenue/route.ts',
        'src/app/api/zion-admin/meta-cost-evidence/route.ts',
        'src/app/api/zion-admin/meta-integrations/route.ts',
        'src/app/api/zion-admin/meta-pricing/route.ts',
        'src/app/api/zion-admin/overview/commercial-action-classification.ts',
        'src/app/api/zion-admin/overview/commercial-action-evidence.ts',
        'src/app/api/zion-admin/overview/operational-health-resolution.ts',
        'src/app/api/zion-admin/overview/operational-health-source-adapter.ts',
        'src/app/api/zion-admin/overview/overview-diagnostic-association.ts',
        'src/app/api/zion-admin/overview/overview-pagination.ts',
        'src/app/api/zion-admin/overview/overview-sensitive-data.ts',
        'src/app/api/zion-admin/overview/route.ts',
        'src/app/api/zion-admin/overview/settings-readiness-overview.ts',
        'src/app/api/zion-admin/overview/settings-readiness-resolution.ts',
        'src/app/api/zion-admin/overview/settings-readiness-source-adapter.ts',
        'src/app/api/zion-admin/overview/store-account-access-resolution.ts',
        'src/app/api/zion-admin/overview/store-account-identity-resolution.ts',
        'src/app/api/zion-admin/overview/store-integrity-resolution.ts',
        'src/app/api/zion-admin/stores/subscription-state/route.ts',
        'src/app/api/zion-admin/stores/subscription-state/route-handler.ts',
        'src/app/api/zion-admin/whatsapp-number-change/route.ts',
        'src/app/api/zion-admin/whatsapp-number-change/route-handler.ts',
        'src/app/api/zion-admin/whatsapp-pins/recovery/route.ts',
        'src/app/api/zion-admin/whatsapp-pins/reveal/route.ts',
        'src/app/api/zion-admin/whatsapp-pins/rotation/execute/route.ts',
        'src/app/api/zion-admin/whatsapp-pins/rotation/route.ts',
        'src/app/api/zion-admin/whatsapp-pins/route.ts',
        'src/app/auth/callback/callback-handler.ts',
        'src/app/auth/callback/route.ts',
        'src/app/auth/reset-password/page.tsx',
        'src/app/auth/set-initial-password/page.tsx',
        'src/app/auth/set-initial-password/SetInitialPasswordClient.tsx',
        'src/app/layout.tsx',
        'src/app/login/page.tsx',
        'src/app/onboarding/layout.tsx',
        'src/app/onboarding/onboarding-scope.ts',
        'src/app/onboarding/page.tsx',
        'src/app/onboarding/whatsapp-display.ts',
        'src/app/page.tsx',
        'src/app/test-supabase/page.tsx',
        'src/app/ui-check/page.tsx',
        'src/app/whatsapp-number-change/number-change-link-start.ts',
        'src/app/whatsapp-number-change/page.tsx',
        'src/app/whatsapp-number-change/WhatsappNumberChangeClient.tsx',
        'src/app/zion-admin/ai-run-classification.ts',
        'src/app/zion-admin/first-access-control.ts',
        'src/app/zion-admin/login/page.tsx',
        'src/app/zion-admin/operational-health-guidance.ts',
        'src/app/zion-admin/operational-summary.ts',
        'src/app/zion-admin/overview-availability.ts',
        'src/app/zion-admin/page.tsx',
        'src/app/zion-admin/pin-rotation-ui-protocol.ts',
        'src/app/zion-admin/recent-ai-errors.ts',
        'src/app/zion-admin/ZionAdminCostsRecalculate.tsx',
        'src/app/zion-admin/ZionAdminCostsSection.tsx',
        'src/app/zion-admin/ZionAdminDashboardClient.tsx',
        'src/app/zion-admin/ZionAdminDiagnosticIncidents.tsx',
        'src/app/zion-admin/ZionAdminFinancialHistory.tsx',
        'src/app/zion-admin/ZionAdminManualRevenue.tsx',
        'src/app/zion-admin/ZionAdminMetaCosts.tsx',
        'src/app/zion-admin/ZionAdminOpenAiOfficialCosts.tsx',
        'src/app/zion-admin/ZionAdminPinRotationControls.tsx',
        'src/app/zion-admin/ZionAdminVariableExpenseCatalog.tsx',
        'src/app/zion-admin/ZionAdminWhatsappNumberChange.tsx',
        'src/components/assistant/ResponsibleExternalNotificationsPanel.tsx',
        'src/components/catalog/IntelligentCatalogImportPanel.tsx',
        'src/components/layout/AppHeader.tsx',
        'src/components/layout/Sidebar.tsx',
        'src/components/nav/SidebarLink.tsx',
        'src/components/OnboardingGuard.tsx',
        'src/components/OrgGuard.tsx',
        'src/components/StoreProvider.tsx',
        'src/config/crm.ts',
        'src/hooks/useOrgAccess.ts',
        'src/lib/account-access.ts',
        'src/lib/account-access-middleware-policy.ts',
        'src/lib/account-access-page-gate.ts',
        'src/lib/account-access-resolution.ts',
        'src/lib/assistant/active-pending-actions.ts',
        'src/lib/auth-public-url.ts',
        'src/lib/auth-safe-redirect.ts',
        'src/lib/catalog/availability.ts',
        'src/lib/catalog/presentation.ts',
        'src/lib/client/embedded-signup-recovery.ts',
        'src/lib/client/meta-embedded-signup.ts',
        'src/lib/client/use-meta-embedded-signup-attempt.ts',
        'src/lib/commercial-opportunity-current-proposal-projection.ts',
        'src/lib/commercial-opportunity-visit-stage-projection.ts',
        'src/lib/google-maps-route.ts',
        'src/lib/leads.ts',
        'src/lib/onboarding-import-dedup-identity.ts',
        'src/lib/onboarding-import-structured-parser.ts',
        'src/lib/onboarding-intelligent-import-save-contract.ts',
        'src/lib/password-policy.ts',
        'src/lib/sales-quotes/validity.ts',
        'src/lib/server/account-access-resolver.ts',
        'src/lib/server/ai-sales-behavior.ts',
        'src/lib/server/ai-sales-methodology.ts',
        'src/lib/server/ai-sales-response-brain.ts',
        'src/lib/server/analyze-customer-location-photo.ts',
        'src/lib/server/assistant/appointment-selection.ts',
        'src/lib/server/assistant/assistant-panel-template-status.ts',
        'src/lib/server/assistant/assistant-panel-whatsapp-sync.ts',
        'src/lib/server/assistant/automatic-reports.ts',
        'src/lib/server/assistant/contract-generation-intent.ts',
        'src/lib/server/assistant/contract-workflow-actions.ts',
        'src/lib/server/assistant/contract-workflow-messages.ts',
        'src/lib/server/assistant/customer-commercial-intents.ts',
        'src/lib/server/assistant/customer-commercial-notifications.ts',
        'src/lib/server/assistant/customer-context-report.ts',
        'src/lib/server/assistant/customer-context-summary.ts',
        'src/lib/server/assistant/customer-reschedule-workflow.ts',
        'src/lib/server/assistant/datetime.ts',
        'src/lib/server/assistant/document-actions.ts',
        'src/lib/server/assistant/document-edit-intent.ts',
        'src/lib/server/assistant/document-review-messages.ts',
        'src/lib/server/assistant/human-command-resolver.ts',
        'src/lib/server/assistant/payment-proof-decision.ts',
        'src/lib/server/assistant/received-contract-document-acknowledgement.ts',
        'src/lib/server/assistant/received-contract-document-confirmation.ts',
        'src/lib/server/assistant/received-contract-document-decision.ts',
        'src/lib/server/assistant/reschedule-target.ts',
        'src/lib/server/assistant/responsible-external-notifications.ts',
        'src/lib/server/assistant/responsible-external-notifications-drainer.ts',
        'src/lib/server/assistant/responsible-external-notifications-sender.ts',
        'src/lib/server/assistant/responsible-whatsapp-conversation.ts',
        'src/lib/server/assistant/responsible-whatsapp-outbound-policy.ts',
        'src/lib/server/assistant/types.ts',
        'src/lib/server/commercial-action-readiness.ts',
        'src/lib/server/commercial-conversation-fact-events.ts',
        'src/lib/server/contextual-reconstruction-aggregator.ts',
        'src/lib/server/contextual-reconstruction-conflict-resolver.ts',
        'src/lib/server/contextual-reconstruction-snapshot.ts',
        'src/lib/server/conversation-ai-sales-eligibility.ts',
        'src/lib/server/crm/lead-conversation-opportunity-context.ts',
        'src/lib/server/crm/resolve-authorized-opportunity-detail.internal.ts',
        'src/lib/server/crm/resolve-authorized-opportunity-detail.ts',
        'src/lib/server/customer-geography-resolution.ts',
        'src/lib/server/customer-identity-name-extraction.ts',
        'src/lib/server/dashboard-time.ts',
        'src/lib/server/generate-ai-reply.ts',
        'src/lib/server/generate-ai-sales-reply.ts',
        'src/lib/server/generate-and-save-ai-sales-reply.ts',
        'src/lib/server/human-response-alert-scanner.ts',
        'src/lib/server/human-response-commitments.ts',
        'src/lib/server/informal-portuguese-context.ts',
        'src/lib/server/ingest-commercial-conversation-facts.ts',
        'src/lib/server/manual-attachment-contract.ts',
        'src/lib/server/manual-catalog-product-contract.ts',
        'src/lib/server/media-classification.ts',
        'src/lib/server/meta-whatsapp-embedded-signup.ts',
        'src/lib/server/meta-whatsapp-pin-rotation.ts',
        'src/lib/server/onboarding-file-extractors.ts',
        'src/lib/server/onboarding-import-dedup.ts',
        'src/lib/server/onboarding-import-normalizers.ts',
        'src/lib/server/onboarding-intelligent-import.ts',
        'src/lib/server/onboarding-intelligent-import-save.ts',
        'src/lib/server/openai-organization-costs-collector.ts',
        'src/lib/server/p19a-quote-preparation-concurrency-runner.mjs',
        'src/lib/server/p9-contract-buyer-data-crypto.ts',
        'src/lib/server/payment-proof-confirmation.ts',
        'src/lib/server/physical-contract-signature.ts',
        'src/lib/server/post-technical-visit-decision.ts',
        'src/lib/server/post-technical-visit-followups.ts',
        'src/lib/server/post-technical-visit-result-extraction.ts',
        'src/lib/server/post-technical-visit-runtime.ts',
        'src/lib/server/process-ai-run-queue.ts',
        'src/lib/server/process-assistant-operational-tasks.ts',
        'src/lib/server/promote-commercial-memory-to-opportunity.ts',
        'src/lib/server/sales-ai-appointment-context.ts',
        'src/lib/server/sales-ai-behavior-contract.ts',
        'src/lib/server/sales-ai-error-diagnostics.ts',
        'src/lib/server/sales-ai-failure-operational-alert.ts',
        'src/lib/server/sales-ai-operating-window.ts',
        'src/lib/server/sales-ai-price-negotiation-strategy.ts',
        'src/lib/server/sales-contracts/build-contract-pdf.ts',
        'src/lib/server/sales-contracts/build-contract-text-draft-pdf.ts',
        'src/lib/server/sales-contracts/buyer-correction-version.ts',
        'src/lib/server/sales-contracts/canonical-contract-renderer.ts',
        'src/lib/server/sales-contracts/contract-auth.ts',
        'src/lib/server/sales-contracts/contract-events.ts',
        'src/lib/server/sales-contracts/contract-messaging.ts',
        'src/lib/server/sales-contracts/contract-send.ts',
        'src/lib/server/sales-contracts/contract-signatures.ts',
        'src/lib/server/sales-contracts/contract-storage.ts',
        'src/lib/server/sales-contracts/contract-template-terms.ts',
        'src/lib/server/sales-contracts/contract-text-correction-version.ts',
        'src/lib/server/sales-contracts/contract-text-draft-canonical-snapshot.ts',
        'src/lib/server/sales-contracts/contract-text-draft-pdf-preview.ts',
        'src/lib/server/sales-contracts/contract-text-draft-source.ts',
        'src/lib/server/sales-contracts/contract-text-draft-version-provenance.ts',
        'src/lib/server/sales-contracts/contract-versioning.ts',
        'src/lib/server/sales-contracts/contract-workflow-decision.ts',
        'src/lib/server/sales-contracts/correct-and-render-contract-text.ts',
        'src/lib/server/sales-contracts/customer-contract-acceptance.ts',
        'src/lib/server/sales-contracts/received-contract-document-evidence.ts',
        'src/lib/server/sales-contracts/received-contract-document-identity.ts',
        'src/lib/server/sales-contracts/render-contract-text-draft-version.ts',
        'src/lib/server/sales-contracts/types.ts',
        'src/lib/server/sales-qualification-fact-extraction.ts',
        'src/lib/server/sales-quotes/accepted-sales-quote-revision.ts',
        'src/lib/server/sales-quotes/build-quote-pdf.ts',
        'src/lib/server/sales-quotes/canonical-payload-v1.ts',
        'src/lib/server/sales-quotes/create-authorized-sales-quote-draft-by-system.ts',
        'src/lib/server/sales-quotes/create-sales-quote-draft-by-system.ts',
        'src/lib/server/sales-quotes/enqueue-quote-preparation-task-by-system.ts',
        'src/lib/server/sales-quotes/human-quote-draft-edit-input.ts',
        'src/lib/server/sales-quotes/human-quote-edit-boundary.ts',
        'src/lib/server/sales-quotes/human-quote-edit-provenance.ts',
        'src/lib/server/sales-quotes/issue-quote-preparation-task-authorization-by-system.ts',
        'src/lib/server/sales-quotes/money.ts',
        'src/lib/server/sales-quotes/negotiation-concession-materialization.ts',
        'src/lib/server/sales-quotes/quote-approval-decision.ts',
        'src/lib/server/sales-quotes/quote-approval-delivery.ts',
        'src/lib/server/sales-quotes/quote-approval-request.ts',
        'src/lib/server/sales-quotes/quote-auth.ts',
        'src/lib/server/sales-quotes/quote-change-requests.ts',
        'src/lib/server/sales-quotes/quote-conversation-readiness.ts',
        'src/lib/server/sales-quotes/quote-creation-boundary.ts',
        'src/lib/server/sales-quotes/quote-events.ts',
        'src/lib/server/sales-quotes/quote-expiration.ts',
        'src/lib/server/sales-quotes/quote-kind.ts',
        'src/lib/server/sales-quotes/quote-send.ts',
        'src/lib/server/sales-quotes/quote-settings.ts',
        'src/lib/server/sales-quotes/quote-storage.ts',
        'src/lib/server/sales-quotes/quote-versioning.ts',
        'src/lib/server/sales-quotes/register-quote-preparation-from-task-by-system.ts',
        'src/lib/server/sales-quotes/register-quote-preparation-operation-by-system.ts',
        'src/lib/server/sales-quotes/resolve-quote-preparation-identity-by-system.ts',
        'src/lib/server/sales-quotes/types.ts',
        'src/lib/server/sales-quotes/unlinked-quote-list.ts',
        'src/lib/server/sales-quotes/validate-quote-preparation-task-authorization-by-system.ts',
        'src/lib/server/store-api-access.ts',
        'src/lib/server/store-api-response.ts',
        'src/lib/server/store-brand-pdf-theme.ts',
        'src/lib/server/store-brand-visual-policy.ts',
        'src/lib/server/store-contract-templates/contract-rule-extraction.ts',
        'src/lib/server/store-contract-templates/contract-text-analysis.ts',
        'src/lib/server/store-contract-templates/template-management.ts',
        'src/lib/server/store-contract-usage-policy.ts',
        'src/lib/server/store-discount-counterpart-policy-reader.ts',
        'src/lib/server/store-discount-settings-reader.ts',
        'src/lib/server/store-readiness.ts',
        'src/lib/server/store-responsibles.ts',
        'src/lib/server/transactional-commercial-authority.ts',
        'src/lib/server/transcribe-customer-audio.ts',
        'src/lib/server/whatsapp-binding-change-operation.ts',
        'src/lib/server/whatsapp-connection-scenario-router.ts',
        'src/lib/server/whatsapp-external-sender.ts',
        'src/lib/server/whatsapp-inbound-media.ts',
        'src/lib/server/whatsapp-inbox-processor.ts',
        'src/lib/server/whatsapp-number-change-link.ts',
        'src/lib/server/whatsapp-pin-recovery.ts',
        'src/lib/server/whatsapp-process-all-status.ts',
        'src/lib/server/whatsapp-two-step-pin-crypto.ts',
        'src/lib/server/whatsapp-two-step-pin-secrets.ts',
        'src/lib/server/whatsapp-worker-claims.ts',
        'src/lib/server/zion-account-provisioning.ts',
        'src/lib/server/zion-admin-ai-run-evidence.ts',
        'src/lib/server/zion-admin-api-access.ts',
        'src/lib/server/zion-admin-api-response.ts',
        'src/lib/server/zion-admin-audit.ts',
        'src/lib/server/zion-admin-auth.ts',
        'src/lib/server/zion-admin-costs.ts',
        'src/lib/server/zion-admin-diagnostic-ai-run-cron-runner.ts',
        'src/lib/server/zion-admin-diagnostic-backend-classifier.ts',
        'src/lib/server/zion-admin-diagnostic-backend-evidence.ts',
        'src/lib/server/zion-admin-diagnostic-backend-identity.ts',
        'src/lib/server/zion-admin-diagnostic-operational-cron-runner.ts',
        'src/lib/server/zion-admin-diagnostic-reader-v2-projection.ts',
        'src/lib/server/zion-admin-financial-evidence-binding.ts',
        'src/lib/server/zion-admin-financial-evidence-binding-reader.ts',
        'src/lib/server/zion-admin-financial-evidence-integrity-reader.ts',
        'src/lib/server/zion-admin-financial-evidence-private-bytes.ts',
        'src/lib/server/zion-admin-financial-evidence-private-view-handler.ts',
        'src/lib/server/zion-admin-financial-evidence-review-access.ts',
        'src/lib/server/zion-admin-financial-evidence-review-confirmation.ts',
        'src/lib/server/zion-admin-financial-evidence-review-confirm-handler.ts',
        'src/lib/server/zion-admin-financial-evidence-review-preparation.ts',
        'src/lib/server/zion-admin-financial-evidence-review-prepare-handler.ts',
        'src/lib/server/zion-admin-financial-evidence-storage-integrity.ts',
        'src/lib/server/zion-admin-financial-evidence-upload-registration.ts',
        'src/lib/server/zion-admin-financial-evidence-upload-validation.ts',
        'src/lib/server/zion-admin-financial-evidence-verification-draft.ts',
        'src/lib/server/zion-admin-financial-history.ts',
        'src/lib/server/zion-admin-meta-candidate-account-reader.ts',
        'src/lib/server/zion-admin-meta-candidate-monthly-coverage-adapter.ts',
        'src/lib/server/zion-admin-meta-cost-evidence.ts',
        'src/lib/server/zion-admin-meta-document-batch-review-handler.ts',
        'src/lib/server/zion-admin-meta-financial-proof-contract.ts',
        'src/lib/server/zion-admin-meta-monthly-binding.ts',
        'src/lib/server/zion-admin-meta-monthly-coverage.ts',
        'src/lib/server/zion-admin-meta-pricing.ts',
        'src/lib/server/zion-admin-monthly-final-close-eligibility.ts',
        'src/lib/server/zion-admin-monthly-final-close-totals.ts',
        'src/lib/server/zion-admin-monthly-final-closure-evidence.ts',
        'src/lib/server/zion-admin-monthly-openai-ptax.ts',
        'src/lib/server/zion-admin-monthly-preclosure-execution.ts',
        'src/lib/server/zion-admin-monthly-preclosure-preparation.ts',
        'src/lib/server/zion-admin-monthly-preclosure-source-reader.ts',
        'src/lib/server/zion-admin-openai-cost-batch-adapters.ts',
        'src/lib/server/zion-admin-openai-cost-batch-coordinator.ts',
        'src/lib/server/zion-admin-openai-cost-claimed-operations.ts',
        'src/lib/server/zion-admin-openai-cost-cron-auth.ts',
        'src/lib/server/zion-admin-openai-cost-cutover-planner.ts',
        'src/lib/server/zion-admin-openai-cost-cutover-runner.ts',
        'src/lib/server/zion-admin-openai-cost-daily-claim-adapter.ts',
        'src/lib/server/zion-admin-openai-cost-daily-claim-validator.ts',
        'src/lib/server/zion-admin-openai-cost-daily-execution-auth.ts',
        'src/lib/server/zion-admin-openai-cost-daily-execution-runner.ts',
        'src/lib/server/zion-admin-openai-cost-daily-inventory-coordinator.ts',
        'src/lib/server/zion-admin-openai-cost-daily-planner.ts',
        'src/lib/server/zion-admin-openai-cost-daily-preparation-service.ts',
        'src/lib/server/zion-admin-openai-cost-daily-retry-eligibility.ts',
        'src/lib/server/zion-admin-openai-cost-daily-retry-reader.ts',
        'src/lib/server/zion-admin-openai-cost-daily-retry-runner.ts',
        'src/lib/server/zion-admin-openai-cost-execution-gate.ts',
        'src/lib/server/zion-admin-openai-cost-expired-quarantine.ts',
        'src/lib/server/zion-admin-openai-cost-first-collection-handler.ts',
        'src/lib/server/zion-admin-openai-cost-inventory-reader.ts',
        'src/lib/server/zion-admin-openai-cost-inventory-rpc.ts',
        'src/lib/server/zion-admin-openai-cost-manual-targeted-handler.ts',
        'src/lib/server/zion-admin-openai-cost-operation-failure.ts',
        'src/lib/server/zion-admin-openai-cost-operation-finalizer.ts',
        'src/lib/server/zion-admin-openai-cost-operation-preparer.ts',
        'src/lib/server/zion-admin-openai-cost-protected-preparer.ts',
        'src/lib/server/zion-admin-openai-cost-protected-runner.ts',
        'src/lib/server/zion-admin-openai-cost-protected-targeted-runner.ts',
        'src/lib/server/zion-admin-openai-cost-query-contract.ts',
        'src/lib/server/zion-admin-openai-cost-targeted-claim.ts',
        'src/lib/server/zion-admin-openai-cost-uncertain-inspector.ts',
        'src/lib/server/zion-admin-openai-cost-uncertain-review.ts',
        'src/lib/server/zion-admin-openai-official-cost-report.ts',
        'src/lib/server/zion-admin-openai-provider-cost-orchestrator.ts',
        'src/lib/server/zion-admin-openai-provider-cost-writer.ts',
        'src/lib/server/zion-admin-ptax-daily.ts',
        'src/lib/server/zion-admin-ptax-evidence-capture.ts',
        'src/lib/server/zion-admin-ptax-evidence-persist.ts',
        'src/lib/server/zion-admin-ptax-evidence-reconcile.ts',
        'src/lib/server/zion-admin-whatsapp-pin-rotation-binding.ts',
        'src/lib/server/zion-admin-whatsapp-pin-rotation-execute-handler.ts',
        'src/lib/server/zion-admin-whatsapp-pin-rotation-execution.ts',
        'src/lib/server/zion-admin-whatsapp-pin-rotation-preparation.ts',
        'src/lib/server/zion-admin-whatsapp-pin-rotation-target.ts',
        'src/lib/server/zion-admin-whatsapp-pin-rotation-wiring.ts',
        'src/lib/store-channel-settings.ts',
        'src/lib/store-commercial-ai-settings.ts',
        'src/lib/store-discount-counterpart-policy.ts',
        'src/lib/store-discount-settings.ts',
        'src/lib/store-monthly-sales-goal.ts',
        'src/lib/store-operation-execution-policies.ts',
        'src/lib/store-operation-settings.ts',
        'src/lib/store-payment-settings.ts',
        'src/lib/store-strategy-settings.ts',
        'src/lib/supabaseBrowser.ts',
        'src/lib/supabaseClient.ts',
        'src/lib/supabaseServer.ts',
        'src/lib/visual-catalog-document-analysis.ts',
        'src/lib/zion-account-provisioning-shared.ts',
        'src/lib/zion-admin-meta-cost-presentation.ts',
        'src/app/api/assistant/messages/[messageId]/signed-media-url/route-handler.ts',
        'src/app/api/assistant/reply/route-handler.ts',
        'src/app/api/assistant/responsible-external-notifications/cancel/route-handler.ts',
        'src/app/api/assistant/responsible-external-notifications/prepare/route-handler.ts',
        'src/app/api/assistant/responsible-external-notifications/route-handler.ts',
        'src/app/api/assistant/responsible-external-notifications/send/route-handler.ts',
        'src/app/api/assistant/responsible-external-notifications/unlock-processing/route-handler.ts',
        'src/app/api/crm/catalog-products/route-handler.ts',
        'src/app/api/crm/leads/manual/route-handler.ts',
        'src/app/api/crm/messages/[messageId]/outbound-review/route-handler.ts',
        'src/app/api/crm/messages/[messageId]/signed-media-url/route-handler.ts',
        'src/app/api/crm/messages/send-manual-attachment/authorize/route-handler.ts',
        'src/app/api/crm/messages/send-manual-attachment/finalize/route-handler.ts',
        'src/app/api/crm/messages/send-manual-attachment/route-handler.ts',
        'src/app/api/crm/messages/send-manual-catalog-product/route-handler.ts',
        'src/app/api/crm/messages/send-manual-text/route-handler.ts',
        'src/app/api/crm/opportunities/action-readiness/route-handler.ts',
        'src/app/api/crm/opportunities/conclude/route-handler.ts',
        'src/app/api/crm/opportunities/new-cycle/route-handler.ts',
        'src/app/api/crm/opportunities/payment/route-handler.ts',
        'src/app/api/crm/opportunities/reopen-for-post-sale/route-handler.ts',
        'src/app/api/cron/assistant-reports/route-handler.ts',
        'src/app/api/cron/zion-admin-monthly-preclosure/route-handler.ts',
        'src/app/api/cron/zion-admin-openai-cost-cutover/route-handler.ts',
        'src/app/api/cron/zion-admin-openai-cost-retries/route-handler.ts',
        'src/app/api/cron/zion-admin-openai-costs/route-handler.ts',
        'src/app/api/dashboard/metrics/route-handler.ts',
        'src/app/api/onboarding/intelligent-import/route-handler.ts',
        'src/app/api/onboarding/intelligent-import/save-approved/route-handler.ts',
        'src/app/api/onboarding/intelligent-import/staged-media-preview/route-handler.ts',
        'src/app/api/sales-contracts/[contractId]/approve/route-handler.ts',
        'src/app/api/sales-contracts/[contractId]/correct-buyer/route-handler.ts',
        'src/app/api/sales-contracts/[contractId]/customer-sign/route-handler.ts',
        'src/app/api/sales-contracts/[contractId]/generate-pdf/route-handler.ts',
        'src/app/api/sales-contracts/[contractId]/route-handler.ts',
        'src/app/api/sales-contracts/[contractId]/send/route-handler.ts',
        'src/app/api/sales-contracts/[contractId]/signed-pdf-url/route-handler.ts',
        'src/app/api/sales-contracts/[contractId]/store-sign/route-handler.ts',
        'src/app/api/sales-contracts/create-from-quote/route-handler.ts',
        'src/app/api/sales-contracts/create-manual/route-handler.ts',
        'src/app/api/sales-contracts/route-handler.ts',
        'src/app/api/sales-contracts/template-edit-source/route-handler.ts',
        'src/app/api/sales-contracts/template-source/route-handler.ts',
        'src/app/api/sales-contracts/text-draft/route-handler.ts',
        'src/app/api/sales-quotes/[quoteId]/apply-change/route-handler.ts',
        'src/app/api/sales-quotes/[quoteId]/approve/route-handler.ts',
        'src/app/api/sales-quotes/[quoteId]/request-change/route-handler.ts',
        'src/app/api/sales-quotes/[quoteId]/send/route-handler.ts',
        'src/app/api/sales-quotes/create/route-handler.ts',
        'src/app/api/sales-quotes/lead-picker/route-handler.ts',
        'src/app/api/sales-quotes/lead-picker/route.ts',
        'src/app/api/sales-quotes/route-handler.ts',
        'src/app/api/schedule/customer-location/route-handler.ts',
        'src/app/api/schedule/route-handler.ts',
        'src/app/api/schedule/technical-visit/route-handler.ts',
        'src/app/api/store-branding/logo/route-handler.ts',
        'src/app/api/store-contract-templates/[versionId]/analyze/route-handler.ts',
        'src/app/api/store-contract-templates/[versionId]/approve/route-handler.ts',
        'src/app/api/store-contract-templates/[versionId]/download/route-handler.ts',
        'src/app/api/store-contract-templates/[versionId]/extract-rules/route-handler.ts',
        'src/app/api/store-contract-templates/[versionId]/reject/route-handler.ts',
        'src/app/api/store-contract-templates/route-handler.ts',
        'src/app/api/store-contract-templates/rules/[ruleId]/review/route-handler.ts',
        'src/app/api/store-contract-templates/upload/route-handler.ts',
        'src/app/api/store/cep/route-handler.ts',
        'src/app/api/store/monthly-sales-goal/route-handler.ts',
        'src/app/api/store/primary-responsible/route-handler.ts',
        'src/app/api/store/readiness/route-handler.ts',
        'src/app/api/store/update-name/route-handler.ts',
        'src/app/api/store/whatsapp/binding-change/route-handler.ts',
        'src/app/api/store/whatsapp/embedded-signup/route-handler.ts',
        'src/app/api/store/whatsapp/status/route-handler.ts',
        'src/app/api/webhooks/whatsapp/route-handler.ts',
        'src/app/api/zion-admin/costs/openai-official/route-handler.ts',
        'src/app/api/zion-admin/costs/route-handler.ts',
        'src/app/api/zion-admin/financial-evidence/upload/route-handler.ts',
        'src/app/api/zion-admin/overview/route-handler.ts'
    ]::text[];

    v_incident_id uuid;
    v_occurrence_id uuid;
    v_new_incident boolean := false;
    v_new_occurrence boolean := false;

    v_error_code text;
    v_occurrence_key text;
    v_expected_key text;
    v_fingerprint_json text;

    v_frame jsonb;
    v_first_frame jsonb;
    v_field text;
    v_value text;

    v_error_name text;
    v_reported_code text;
    v_message text;

    v_safe_evidence jsonb;
    v_existing_incident record;
    v_existing_occurrence record;

    v_title text;
    v_impact text;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_event_id IS NULL
       OR p_occurred_at IS NULL
       OR NOT pg_catalog.isfinite(p_occurred_at)
    THEN
        RAISE EXCEPTION
            'ZION_BACKEND_EVENT_INVALID'
            USING ERRCODE = '22023';
    END IF;

    -- Validar o escopo real.
    -- Atribuicao desconhecida nao significa impacto global.

    IF p_scope = 'system'
       AND p_organization_id IS NULL
       AND p_store_id IS NULL
    THEN
        NULL;

    ELSIF p_scope = 'organization'
       AND p_organization_id IS NOT NULL
       AND p_store_id IS NULL
    THEN
        PERFORM 1
        FROM public.organizations o
        WHERE o.id = p_organization_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'ZION_BACKEND_SCOPE_INVALID'
                USING ERRCODE = '22023';
        END IF;

    ELSIF p_scope = 'store'
       AND p_organization_id IS NOT NULL
       AND p_store_id IS NOT NULL
    THEN
        PERFORM 1
        FROM public.stores s
        WHERE s.id = p_store_id
          AND s.organization_id = p_organization_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'ZION_BACKEND_SCOPE_INVALID'
                USING ERRCODE = '22023';
        END IF;

    ELSE
        RAISE EXCEPTION
            'ZION_BACKEND_SCOPE_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF (p_route = ANY(v_routes)) IS NOT TRUE
       OR (
           p_method IN (
               'GET','POST','PUT','PATCH',
               'DELETE','HEAD','OPTIONS'
           )
       ) IS NOT TRUE
    THEN
        RAISE EXCEPTION
            'ZION_BACKEND_CONTEXT_INVALID'
            USING ERRCODE = '22023';
    END IF;

    -- Impedir recursao do proprio subsistema.
    -- A saude diagnostica tera tratamento separado.

    IF p_route IN (
        '/api/zion-admin/diagnostics',
        '/api/cron/zion-admin-diagnostic-ai-runs',
        '/api/cron/zion-admin-diagnostic-operational',
        '/api/diagnostics/client-browser',
        '/api/zion-admin/diagnostics/scheduler'
    ) THEN
        RAISE EXCEPTION
            'ZION_BACKEND_DIAGNOSTIC_RECURSION'
            USING ERRCODE = '22023';
    END IF;

    IF p_kind = 'unhandled_exception'
       AND p_http_status IS NULL
    THEN
        v_error_code := 'BACKEND_UNHANDLED_EXCEPTION';

    ELSIF p_kind = 'http_response'
       AND p_http_status BETWEEN 500 AND 599
    THEN
        v_error_code := 'BACKEND_HTTP_5XX';

    ELSE
        RAISE EXCEPTION
            'ZION_BACKEND_CLASSIFICATION_INVALID'
            USING ERRCODE = '22023';
    END IF;

    -- Aceitar exclusivamente o contrato de evidencias 3.5-B.

    IF pg_catalog.jsonb_typeof(p_evidence)
        IS DISTINCT FROM 'object'
    THEN
        RAISE EXCEPTION
            'ZION_BACKEND_EVIDENCE_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF NOT (
        p_evidence ?& ARRAY[
            'schemaVersion',
            'errorName',
            'reportedErrorCode',
            'sanitizedMessage',
            'frames',
            'rawMessageStored',
            'rawStackStored'
        ]
    )
    OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_object_keys(
            p_evidence
        ) AS k(key)
        WHERE k.key NOT IN (
            'schemaVersion',
            'errorName',
            'reportedErrorCode',
            'sanitizedMessage',
            'frames',
            'rawMessageStored',
            'rawStackStored'
        )
    )
    THEN
        RAISE EXCEPTION
            'ZION_BACKEND_EVIDENCE_FIELDS_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF p_evidence -> 'schemaVersion'
        IS DISTINCT FROM '1'::jsonb
       OR p_evidence -> 'rawMessageStored'
        IS DISTINCT FROM 'false'::jsonb
       OR p_evidence -> 'rawStackStored'
        IS DISTINCT FROM 'false'::jsonb
    THEN
        RAISE EXCEPTION
            'ZION_BACKEND_EVIDENCE_VERSION_INVALID'
            USING ERRCODE = '22023';
    END IF;

    FOREACH v_field IN ARRAY ARRAY[
        'errorName',
        'reportedErrorCode',
        'sanitizedMessage'
    ]
    LOOP
        IF pg_catalog.jsonb_typeof(
            p_evidence -> v_field
        ) NOT IN ('string','null')
        THEN
            RAISE EXCEPTION
                'ZION_BACKEND_EVIDENCE_TYPE_INVALID'
                USING ERRCODE = '22023';
        END IF;
    END LOOP;

    v_error_name := p_evidence ->> 'errorName';
    v_reported_code := p_evidence ->> 'reportedErrorCode';
    v_message := p_evidence ->> 'sanitizedMessage';

    IF v_error_name IS NOT NULL
       AND v_error_name NOT IN (
           'Error',
           'TypeError',
           'ReferenceError',
           'RangeError',
           'SyntaxError',
           'URIError',
           'EvalError',
           'AggregateError',
           'AbortError',
           'TimeoutError'
       )
    THEN
        RAISE EXCEPTION
            'ZION_BACKEND_ERROR_NAME_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF v_reported_code IS NOT NULL
       AND v_reported_code NOT IN (
           'ECONNRESET',
           'ECONNREFUSED',
           'ETIMEDOUT',
           'ENOTFOUND',
           'EAI_AGAIN',
           'EPIPE',
           'ERR_NETWORK',
           'UND_ERR_CONNECT_TIMEOUT',
           'UND_ERR_HEADERS_TIMEOUT',
           'UND_ERR_SOCKET',
           '08006',
           '22023',
           '23502',
           '23503',
           '23505',
           '23514',
           '40001',
           '40P01',
           '42501',
           '42703',
           '42883',
           '42P01',
           '55P03',
           '57014',
           'PGRST202',
           'PGRST204',
           'PGRST301'
       )
    THEN
        RAISE EXCEPTION
            'ZION_BACKEND_ERROR_CODE_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF v_message IS NOT NULL
       AND v_message NOT IN (
           'fetch failed',
           'Failed to fetch',
           'Network request failed',
           'Request timeout',
           'The operation was aborted.'
       )
    THEN
        RAISE EXCEPTION
            'ZION_BACKEND_MESSAGE_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.jsonb_typeof(
        p_evidence -> 'frames'
    ) IS DISTINCT FROM 'array'
    THEN
        RAISE EXCEPTION
            'ZION_BACKEND_FRAMES_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.jsonb_array_length(
        p_evidence -> 'frames'
    ) > 8
    THEN
        RAISE EXCEPTION
            'ZION_BACKEND_FRAME_LIMIT'
            USING ERRCODE = '22023';
    END IF;

    FOR v_frame IN
        SELECT f.value
        FROM pg_catalog.jsonb_array_elements(
            p_evidence -> 'frames'
        ) AS f(value)
    LOOP
        IF pg_catalog.jsonb_typeof(v_frame)
            IS DISTINCT FROM 'object'
        THEN
            RAISE EXCEPTION
                'ZION_BACKEND_FRAME_INVALID'
                USING ERRCODE = '22023';
        END IF;

        IF NOT (
            v_frame ?& ARRAY[
                'sourceFile','line','column'
            ]
        )
        OR EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_object_keys(
                v_frame
            ) AS k(key)
            WHERE k.key NOT IN (
                'sourceFile','line','column'
            )
        )
        THEN
            RAISE EXCEPTION
                'ZION_BACKEND_FRAME_FIELDS_INVALID'
                USING ERRCODE = '22023';
        END IF;

        IF pg_catalog.jsonb_typeof(
            v_frame -> 'sourceFile'
        ) IS DISTINCT FROM 'string'
        OR (
            (v_frame ->> 'sourceFile') = ANY(v_sources)
        ) IS NOT TRUE
        THEN
            RAISE EXCEPTION
                'ZION_BACKEND_SOURCE_FILE_INVALID'
                USING ERRCODE = '22023';
        END IF;

        FOREACH v_field IN ARRAY ARRAY['line','column']
        LOOP
            v_value := v_frame ->> v_field;

            IF pg_catalog.jsonb_typeof(
                v_frame -> v_field
            ) IS DISTINCT FROM 'number'
            OR (
                v_value ~ '^[1-9][0-9]{0,6}$'
            ) IS NOT TRUE
            THEN
                RAISE EXCEPTION
                    'ZION_BACKEND_POSITION_INVALID'
                    USING ERRCODE = '22023';
            END IF;

            IF v_value::integer > 1000000 THEN
                RAISE EXCEPTION
                    'ZION_BACKEND_POSITION_INVALID'
                    USING ERRCODE = '22023';
            END IF;
        END LOOP;
    END LOOP;

    -- Reproduzir o JSON compacto usado pelo SHA256
    -- da microetapa 3.5-C.
    -- O writer nao confia na chave recebida sem verifica-la.

    v_first_frame :=
        p_evidence -> 'frames' -> 0;

    v_fingerprint_json :=
        '[' ||
        pg_catalog.array_to_string(
            ARRAY[
                pg_catalog.to_json(
                    'zion-backend-fingerprint-v1'::text
                )::text,
                pg_catalog.to_json(p_scope)::text,
                pg_catalog.to_json(
                    p_organization_id::text
                )::text,
                pg_catalog.to_json(
                    p_store_id::text
                )::text,
                pg_catalog.to_json(
                    'backend_api'::text
                )::text,
                pg_catalog.to_json(p_route)::text,
                pg_catalog.to_json(p_method)::text,
                pg_catalog.to_json(p_kind)::text,
                pg_catalog.to_json(p_http_status)::text,
                pg_catalog.to_json(v_error_code)::text,
                pg_catalog.to_json(v_error_name)::text,
                pg_catalog.to_json(v_reported_code)::text,
                pg_catalog.to_json(
                    v_first_frame ->> 'sourceFile'
                )::text,
                pg_catalog.to_json(
                    (v_first_frame ->> 'line')::integer
                )::text
            ]::text[],
            ',',
            'null'
        ) ||
        ']';

    v_expected_key :=
        'zion-b2:backend:v1:' ||
        pg_catalog.encode(
            pg_catalog.sha256(
                pg_catalog.convert_to(
                    v_fingerprint_json,
                    'UTF8'
                )
            ),
            'hex'
        );

    IF p_incident_key
        IS DISTINCT FROM v_expected_key
    THEN
        RAISE EXCEPTION
            'ZION_BACKEND_FINGERPRINT_INVALID'
            USING ERRCODE = '22023';
    END IF;

    v_occurrence_key :=
        'zion-b2:backend-event:' ||
        p_event_id::text;

    v_safe_evidence :=
        pg_catalog.jsonb_build_object(
            'schema_version', 1,
            'origin', 'backend_api',
            'route', p_route,
            'method', p_method,
            'kind', p_kind,
            'http_status', p_http_status,
            'error_name', v_error_name,
            'reported_error_code', v_reported_code,
            'frames', p_evidence -> 'frames',
            'raw_message_stored', false,
            'raw_stack_stored', false,
            'attribution',
                CASE
                    WHEN p_scope = 'system'
                    THEN 'unverified'
                    ELSE 'server_supplied'
                END
        );

    v_title :=
        'Falha tecnica no backend: ' ||
        p_method || ' ' || p_route;

    v_impact :=
        'A operacao pode ter sido afetada. ' ||
        'A extensao do impacto ainda nao foi confirmada.';

    INSERT INTO public.zion_admin_diagnostic_incidents (
        incident_key,
        scope,
        organization_id,
        store_id,
        component,
        category,
        severity,
        status,
        cause_confidence,
        title_simple,
        explanation_simple,
        impact_simple,
        next_action_simple,
        first_seen_at,
        last_seen_at
    )
    VALUES (
        v_expected_key,
        p_scope,
        p_organization_id,
        p_store_id,
        'backend',
        'backend_api_failure',
        'error',
        'open',
        'unknown',
        v_title,
        CASE
            WHEN p_kind = 'unhandled_exception'
            THEN 'O backend registrou uma excecao inesperada.'
            ELSE 'A API retornou uma resposta de erro do servidor.'
        END,
        v_impact,
        'Consultar as evidencias tecnicas e verificar a causa antes de intervir.',
        p_occurred_at,
        p_occurred_at
    )
    ON CONFLICT (incident_key) DO NOTHING
    RETURNING id INTO v_incident_id;

    v_new_incident := FOUND;

    IF NOT v_new_incident THEN
        SELECT i.*
        INTO v_existing_incident
        FROM public.zion_admin_diagnostic_incidents i
        WHERE i.incident_key = v_expected_key
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'ZION_BACKEND_INCIDENT_LOOKUP_FAILED';
        END IF;

        IF v_existing_incident.scope
                IS DISTINCT FROM p_scope
           OR v_existing_incident.organization_id
                IS DISTINCT FROM p_organization_id
           OR v_existing_incident.store_id
                IS DISTINCT FROM p_store_id
           OR v_existing_incident.component
                IS DISTINCT FROM 'backend'
           OR v_existing_incident.category
                IS DISTINCT FROM 'backend_api_failure'
        THEN
            RAISE EXCEPTION
                'ZION_BACKEND_INCIDENT_CONFLICT';
        END IF;

        v_incident_id := v_existing_incident.id;
    END IF;

    INSERT INTO public.zion_admin_diagnostic_occurrences (
        incident_id,
        occurrence_key,
        source_system,
        source_record_id,
        error_code,
        sanitized_error_message,
        sanitized_evidence,
        occurred_at
    )
    VALUES (
        v_incident_id,
        v_occurrence_key,
        'backend_api',
        p_event_id::text,
        v_error_code,
        v_message,
        v_safe_evidence,
        p_occurred_at
    )
    ON CONFLICT (occurrence_key) DO NOTHING
    RETURNING id INTO v_occurrence_id;

    v_new_occurrence := FOUND;

    IF NOT v_new_occurrence THEN
        SELECT o.*
        INTO v_existing_occurrence
        FROM public.zion_admin_diagnostic_occurrences o
        WHERE o.occurrence_key = v_occurrence_key;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'ZION_BACKEND_OCCURRENCE_LOOKUP_FAILED';
        END IF;

        -- Replay identico: reutilizar a ocorrencia.
        -- Replay divergente: impedir associacao incorreta.

        IF v_existing_occurrence.incident_id
                IS DISTINCT FROM v_incident_id
           OR v_existing_occurrence.source_system
                IS DISTINCT FROM 'backend_api'
           OR v_existing_occurrence.source_record_id
                IS DISTINCT FROM p_event_id::text
           OR v_existing_occurrence.error_code
                IS DISTINCT FROM v_error_code
           OR v_existing_occurrence.occurred_at
                IS DISTINCT FROM p_occurred_at
           OR v_existing_occurrence.sanitized_error_message
                IS DISTINCT FROM v_message
           OR v_existing_occurrence.sanitized_evidence
                IS DISTINCT FROM v_safe_evidence
        THEN
            RAISE EXCEPTION
                'ZION_BACKEND_OCCURRENCE_CONFLICT';
        END IF;

        v_occurrence_id := v_existing_occurrence.id;

    ELSE
        UPDATE public.zion_admin_diagnostic_incidents
        SET
            first_seen_at = LEAST(
                first_seen_at,
                p_occurred_at
            ),
            last_seen_at = GREATEST(
                last_seen_at,
                p_occurred_at
            ),
            updated_at = pg_catalog.now()
        WHERE id = v_incident_id;
    END IF;

    -- Preservar estado administrativo existente.
    -- Nao reabrir automaticamente incidente resolvido.

    IF v_new_incident THEN
        INSERT INTO public.zion_admin_diagnostic_history (
            incident_id,
            event_kind,
            actor_kind,
            previous_status,
            new_status,
            description_simple
        )
        VALUES (
            v_incident_id,
            'created',
            'system',
            NULL,
            'open',
            'Incidente criado a partir de falha tecnica do backend.'
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'incident_id', v_incident_id,
        'occurrence_id', v_occurrence_id,
        'new_incident', v_new_incident,
        'new_occurrence', v_new_occurrence,
        'source_system', 'backend_api',
        'event_id', p_event_id
    );
END;
$function$;

DO $guard$
DECLARE v_oid oid := pg_catalog.to_regprocedure('public.register_zion_admin_backend_failure_by_system(uuid,text,text,uuid,uuid,text,text,text,integer,timestamptz,jsonb)');
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_oid AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND upper(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex'))='28A27F92B0A9EDAE539799C9B138F798801E1278DB86C8C1A58DF71FC8EACCAB')
 OR NOT pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE')
 OR pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
 OR pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
 THEN RAISE EXCEPTION 'BACKEND_WRITER_INTEGRITY_OR_ACL'; END IF;
END;
$guard$;

COMMIT;

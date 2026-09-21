import assert from "node:assert/strict";
import {
  loadStoreBrandVisualPolicy,
  normalizeStoreBrandVisualPolicy,
} from "./store-brand-visual-policy";

async function main() {
  const empty = normalizeStoreBrandVisualPolicy({});

  assert.deepEqual(empty, {
    configured: false,
    useLogoOnQuotes: null,
    useLogoOnContracts: null,
    primaryColor: null,
    secondaryColor: null,
    documentFooter: null,
  });

  const configured = normalizeStoreBrandVisualPolicy({
    use_logo_on_quotes: "Sim",
    use_logo_on_contracts: "Não",
    primary_color: "#112233",
    secondary_color: "#aabbcc",
    document_footer: "  Rodapé da loja  ",
  });

  assert.deepEqual(configured, {
    configured: true,
    useLogoOnQuotes: true,
    useLogoOnContracts: false,
    primaryColor: "#112233",
    secondaryColor: "#AABBCC",
    documentFooter: "Rodapé da loja",
  });

  assert.throws(
    () =>
      normalizeStoreBrandVisualPolicy({
        use_logo_on_quotes: "Talvez",
        use_logo_on_contracts: "Sim",
        primary_color: "#112233",
        secondary_color: "",
        document_footer: "",
      }),
    /brand_visual_policy canonica invalida/
  );

  const rpcCalls: Array<{
    name: string;
    args: Record<string, unknown>;
  }> = [];

  const policy = await loadStoreBrandVisualPolicy({
    organizationId: "org-1",
    storeId: "store-1",
    supabase: {
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });

        return {
          data: [
            {
              brand_visual_policy: {
                use_logo_on_quotes: "Não",
                use_logo_on_contracts: "Sim",
                primary_color: "#445566",
                secondary_color: "",
                document_footer: "",
              },
            },
          ],
          error: null,
        };
      },
    },
  });

  assert.deepEqual(rpcCalls, [
    {
      name: "read_store_settings_experience_policies_scoped",
      args: {
        p_organization_id: "org-1",
        p_store_id: "store-1",
      },
    },
  ]);

  assert.deepEqual(policy, {
    configured: true,
    useLogoOnQuotes: false,
    useLogoOnContracts: true,
    primaryColor: "#445566",
    secondaryColor: null,
    documentFooter: null,
  });

  await assert.rejects(
    () =>
      loadStoreBrandVisualPolicy({
        organizationId: "org-1",
        storeId: "store-1",
        supabase: {
          async rpc() {
            return {
              data: [{ brand_visual_policy: {} }, { brand_visual_policy: {} }],
              error: null,
            };
          },
        },
      }),
    /mais de uma brand_visual_policy/
  );

  console.log("PASS store brand visual canonical policy");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
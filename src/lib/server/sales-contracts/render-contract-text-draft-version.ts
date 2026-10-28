import type { ContractTextDraftSource } from "./contract-text-draft-source";
import { buildContractTextDraftPdf } from "./build-contract-text-draft-pdf";
import {
  prepareContractTextDraftVersionProvenance,
  type ContractTextDraftVersionProvenance,
} from "./contract-text-draft-version-provenance";

export type RenderContractTextDraftVersionResult = {
  pdfBytes: Uint8Array;
  provenance: ContractTextDraftVersionProvenance;
  textSha256: string;
  pdfSha256: string;
};

/**
 * Renders one server-authorized draft source and derives provenance from the
 * same in-memory source and the same PDF bytes.
 *
 * The source must already have been authorized and resolved by the server.
 * This helper does not replace access authorization or future atomic database
 * revalidation, and it performs no persistence, storage, messaging, or SQL.
 */
export async function renderContractTextDraftVersion(
  source: ContractTextDraftSource,
): Promise<RenderContractTextDraftVersionResult> {
  // Capture primitive fields before the first await. The renderer and
  // provenance helper must observe exactly the same validated source.
  const draftCopy: ContractTextDraftSource = {
    draftId: source.draftId,
    organizationId: source.organizationId,
    storeId: source.storeId,
    commercialOpportunityId: source.commercialOpportunityId,
    templateVersionId: source.templateVersionId,
    revision: source.revision,
    text: source.text,
    sha256: source.sha256,
  };

  const pdfBytes = await buildContractTextDraftPdf({ text: draftCopy.text });
  const provenanceResult = prepareContractTextDraftVersionProvenance({
    draft: draftCopy,
    pdfBytes,
  });

  return {
    pdfBytes,
    provenance: provenanceResult.provenance,
    textSha256: provenanceResult.text_sha256,
    pdfSha256: provenanceResult.pdf_sha256,
  };
}

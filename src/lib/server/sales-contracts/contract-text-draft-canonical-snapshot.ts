import { createHash } from "node:crypto";
import {
  computeContractContentFingerprint,
  type CanonicalContractRendererInput,
  type buildContractSnapshotV2,
} from "./canonical-contract-renderer";
import type { ContractTextDraftVersionProvenance } from "./contract-text-draft-version-provenance";

export type CanonicalContractSnapshotV2 = ReturnType<
  typeof buildContractSnapshotV2
>;

export type ContractTextDraftCanonicalSnapshot = CanonicalContractSnapshotV2 & {
  text_provenance: ContractTextDraftVersionProvenance;
};

export type ContractTextDraftCanonicalSnapshotResult = {
  snapshot: ContractTextDraftCanonicalSnapshot;
  contentFingerprint: string;
  baseContentFingerprint: string;
};

export type ContractTextDraftCanonicalSnapshotErrorCode =
  | "INVALID_CANONICAL_SNAPSHOT"
  | "INVALID_TEXT_PROVENANCE"
  | "TEXT_PROVENANCE_SCOPE_MISMATCH";

export class ContractTextDraftCanonicalSnapshotError extends Error {
  constructor(
    public readonly code: ContractTextDraftCanonicalSnapshotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContractTextDraftCanonicalSnapshotError";
  }
}

function fail(
  code: ContractTextDraftCanonicalSnapshotErrorCode,
  message: string,
): never {
  throw new ContractTextDraftCanonicalSnapshotError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateCanonicalSnapshot(
  snapshot: CanonicalContractSnapshotV2,
): void {
  if (!isRecord(snapshot)) {
    fail("INVALID_CANONICAL_SNAPSHOT", "O snapshot canonico nao e um objeto.");
  }

  const identity = snapshot.identity;
  const lineage = snapshot.lineage;
  const templateAuthority = snapshot.template_authority;
  const rendererInput = snapshot.renderer_input;

  if (
    snapshot.schema !== "zion.sales_contract_snapshot.v2" ||
    !isRecord(identity) ||
    !isNonEmptyString(identity.contract_id) ||
    !isNonEmptyString(identity.organization_id) ||
    !isNonEmptyString(identity.store_id) ||
    !isRecord(lineage) ||
    !hasOwn(lineage, "commercial_opportunity_id") ||
    !isRecord(templateAuthority) ||
    !isNonEmptyString(templateAuthority.template_version_id) ||
    !isRecord(rendererInput) ||
    !isNonEmptyString(snapshot.materialized_at) ||
    !isSha256(snapshot.content_fingerprint)
  ) {
    fail(
      "INVALID_CANONICAL_SNAPSHOT",
      "O snapshot canonico V2 nao possui todos os campos obrigatorios.",
    );
  }

  let recomputedFingerprint: string;
  try {
    recomputedFingerprint = computeContractContentFingerprint(
      rendererInput as unknown as CanonicalContractRendererInput,
    );
  } catch {
    fail(
      "INVALID_CANONICAL_SNAPSHOT",
      "O renderer_input do snapshot canonico nao pode ser fingerprintado.",
    );
  }

  if (recomputedFingerprint !== snapshot.content_fingerprint) {
    fail(
      "INVALID_CANONICAL_SNAPSHOT",
      "O fingerprint do snapshot canonico nao corresponde ao renderer_input.",
    );
  }

  if (hasOwn(snapshot, "origin")) {
    const origin = snapshot.origin;
    const rendererIdentity = isRecord(rendererInput.identity)
      ? rendererInput.identity
      : null;
    const rendererLineage = isRecord(rendererInput.lineage)
      ? rendererInput.lineage
      : null;
    const rendererValues = isRecord(rendererInput.values)
      ? rendererInput.values
      : null;

    if (
      !isRecord(origin) ||
      origin.source !== "responsible_text_draft" ||
      origin.commercial_amounts_authoritative !== false ||
      lineage.quote_id !== null ||
      lineage.quote_version_id !== null ||
      lineage.proposal_acceptance_event_id !== null ||
      rendererIdentity?.quoteId !== null ||
      rendererIdentity?.quoteVersionId !== null ||
      rendererLineage?.proposalAcceptanceEventId !== null ||
      !rendererValues ||
      rendererValues.subtotalCents !== 0 ||
      rendererValues.discountCents !== 0 ||
      rendererValues.totalCents !== 0 ||
      !Array.isArray(rendererInput.items) ||
      rendererInput.items.length !== 0
    ) {
      fail(
        "INVALID_CANONICAL_SNAPSHOT",
        "O snapshot manual possui linhagem ou valores comerciais indevidos.",
      );
    }
  }
}

function validateProvenance(
  provenance: ContractTextDraftVersionProvenance,
): void {
  if (
    !isRecord(provenance) ||
    provenance.mode !== "saved_text_draft" ||
    !isNonEmptyString(provenance.draft_id) ||
    !isNonEmptyString(provenance.organization_id) ||
    !isNonEmptyString(provenance.store_id) ||
    !isNonEmptyString(provenance.commercial_opportunity_id) ||
    !isNonEmptyString(provenance.template_version_id) ||
    !Number.isSafeInteger(provenance.revision) ||
    provenance.revision < 1 ||
    !isSha256(provenance.text_sha256) ||
    !isSha256(provenance.pdf_sha256) ||
    provenance.text_representation !== "persisted_text_utf8_exact" ||
    provenance.rendered_text_representation !== "line_endings_normalized_to_lf"
  ) {
    fail(
      "INVALID_TEXT_PROVENANCE",
      "A proveniencia textual nao possui um formato valido.",
    );
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function computeTextDraftContentFingerprint(args: {
  baseContentFingerprint: string;
  rendererInput: unknown;
  provenance: ContractTextDraftVersionProvenance;
}): string {
  return createHash("sha256")
    .update(
      stableSerialize({
        base_content_fingerprint: args.baseContentFingerprint,
        renderer_input: args.rendererInput,
        text_provenance: args.provenance,
      }),
      "utf8",
    )
    .digest("hex");
}

/**
 * Adds saved-text provenance to an already valid V2 snapshot.
 *
 * This is a pure preparation step. It does not authorize the draft, render a
 * PDF, call SQL, persist a version, approve a contract, or send anything.
 * The derived fingerprint is required because a textual revision or its
 * effective PDF bytes are material content identity, not merely annotations.
 */
export function buildContractTextDraftCanonicalSnapshot(args: {
  snapshot: CanonicalContractSnapshotV2;
  provenance: ContractTextDraftVersionProvenance;
}): ContractTextDraftCanonicalSnapshotResult {
  validateCanonicalSnapshot(args?.snapshot);
  validateProvenance(args?.provenance);

  const snapshotIdentity = args.snapshot.identity;
  const snapshotLineage = args.snapshot.lineage;
  const snapshotTemplateAuthority = args.snapshot.template_authority;

  if (
    args.provenance.organization_id !== snapshotIdentity.organization_id ||
    args.provenance.store_id !== snapshotIdentity.store_id ||
    args.provenance.commercial_opportunity_id !==
      snapshotLineage.commercial_opportunity_id ||
    args.provenance.template_version_id !==
      snapshotTemplateAuthority.template_version_id
  ) {
    fail(
      "TEXT_PROVENANCE_SCOPE_MISMATCH",
      "A proveniencia textual nao corresponde ao escopo do snapshot canonico.",
    );
  }

  const baseContentFingerprint = args.snapshot.content_fingerprint;
  const snapshotCopy = structuredClone(args.snapshot);
  const provenanceCopy = structuredClone(args.provenance);
  const contentFingerprint = computeTextDraftContentFingerprint({
    baseContentFingerprint,
    rendererInput: snapshotCopy.renderer_input,
    provenance: provenanceCopy,
  });

  const snapshot: ContractTextDraftCanonicalSnapshot = {
    ...snapshotCopy,
    content_fingerprint: contentFingerprint,
    text_provenance: provenanceCopy,
  };

  return {
    snapshot,
    contentFingerprint,
    baseContentFingerprint,
  };
}

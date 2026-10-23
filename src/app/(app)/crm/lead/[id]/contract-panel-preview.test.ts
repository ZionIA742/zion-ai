import { strict as assert } from "node:assert";
import { chooseContractPreviewTarget } from "./contract-panel-preview";

assert.deepEqual(
  chooseContractPreviewTarget(
    [{ id: "contract-1", current_version_id: "version-1" }],
    { available: true, signedUrl: "https://example.test/template.pdf", mimeType: "application/pdf" },
  ),
  { kind: "contract", id: "contract-1" },
  "a saved buyer contract must take priority over the store template",
);

assert.deepEqual(
  chooseContractPreviewTarget([], {
    available: true,
    signedUrl: "https://example.test/template.pdf",
    mimeType: "application/pdf",
  }),
  { kind: "template", signedUrl: "https://example.test/template.pdf" },
  "an active PDF template must load automatically when no buyer contract exists",
);

assert.equal(
  chooseContractPreviewTarget([], {
    available: true,
    signedUrl: "https://example.test/template.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }),
  null,
  "DOCX must not be presented as an inline faithful PDF preview",
);

assert.equal(chooseContractPreviewTarget([], { available: false }), null);
console.log("contract-panel-preview: behavioral tests passed");

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { formatOfficialWhatsappDisplay } from "./whatsapp-display";

test("preserves the official international phone presentation", () => {
  assert.equal(formatOfficialWhatsappDisplay(" +1 555-347-9126 "), "+1 555-347-9126");
  assert.equal(formatOfficialWhatsappDisplay("+55 15 55347-9126"), "+55 15 55347-9126");
  assert.equal(formatOfficialWhatsappDisplay("+1 (555) 347-9126"), "+1 (555) 347-9126");
});

test("returns an empty value for an absent official phone", () => {
  assert.equal(formatOfficialWhatsappDisplay(null), "");
  assert.equal(formatOfficialWhatsappDisplay(undefined), "");
  assert.equal(formatOfficialWhatsappDisplay("   "), "");
});

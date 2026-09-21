import assert from "node:assert/strict";
import { resolveStoreBrandPdfTheme } from "./store-brand-pdf-theme";

function approximatelyEqual(
  actual: number,
  expected: number,
  epsilon = 0.0001
) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be approximately ${expected}`
  );
}

const darkTheme = resolveStoreBrandPdfTheme({
  primaryColor: "#112233",
  secondaryColor: "#AABBCC",
  documentFooter: "  Obrigado pela preferência.  ",
});

assert.ok(darkTheme.accentColor);
assert.ok(darkTheme.accentTextColor);
assert.ok(darkTheme.secondaryPanelColor);
assert.ok(darkTheme.totalBackgroundColor);
assert.ok(darkTheme.totalTextColor);

approximatelyEqual(darkTheme.accentColor.red, 0x11 / 255);
approximatelyEqual(darkTheme.accentColor.green, 0x22 / 255);
approximatelyEqual(darkTheme.accentColor.blue, 0x33 / 255);

approximatelyEqual(
  darkTheme.secondaryPanelColor.red,
  0.88 + (0xaa / 255) * 0.12
);
approximatelyEqual(
  darkTheme.secondaryPanelColor.green,
  0.88 + (0xbb / 255) * 0.12
);
approximatelyEqual(
  darkTheme.secondaryPanelColor.blue,
  0.88 + (0xcc / 255) * 0.12
);

assert.equal(darkTheme.totalTextColor.red, 1);
assert.equal(darkTheme.totalTextColor.green, 1);
assert.equal(darkTheme.totalTextColor.blue, 1);
assert.equal(
  darkTheme.documentFooter,
  "Obrigado pela preferência."
);

const lightTheme = resolveStoreBrandPdfTheme({
  primaryColor: "#FFFFFF",
  secondaryColor: "",
  documentFooter: "   ",
});

assert.ok(lightTheme.accentTextColor);
assert.ok(lightTheme.totalTextColor);
assert.equal(lightTheme.secondaryPanelColor, null);
assert.equal(lightTheme.documentFooter, null);

assert.ok(
  lightTheme.accentTextColor.red < 0.6 &&
    lightTheme.accentTextColor.green < 0.6 &&
    lightTheme.accentTextColor.blue < 0.6,
  "light primary color must be darkened for readable accent text"
);

assert.equal(lightTheme.totalTextColor.red, 0);
assert.equal(lightTheme.totalTextColor.green, 0);
assert.equal(lightTheme.totalTextColor.blue, 0);

const emptyTheme = resolveStoreBrandPdfTheme({
  primaryColor: null,
  secondaryColor: null,
  documentFooter: null,
});

assert.equal(emptyTheme.accentColor, null);
assert.equal(emptyTheme.accentTextColor, null);
assert.equal(emptyTheme.secondaryPanelColor, null);
assert.equal(emptyTheme.totalBackgroundColor, null);
assert.equal(emptyTheme.totalTextColor, null);
assert.equal(emptyTheme.documentFooter, null);

assert.throws(
  () =>
    resolveStoreBrandPdfTheme({
      primaryColor: "vermelho",
    }),
  /cor de marca invalida para PDF/
);

console.log("PASS store brand PDF theme");
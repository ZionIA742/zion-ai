import { strict as assert } from "node:assert";
import {
  assertSalesQuoteVersionNotExpired,
  isSalesQuoteVersionExpired,
  resolveSalesQuoteVersionValidUntil,
} from "./quote-expiration";

const tests = [
  {
    name: "snapshot validUntil wins over sales_quotes valid_until",
    run: () => {
      const validUntil = resolveSalesQuoteVersionValidUntil({
        version: {
          quote_snapshot: { quote: { validUntil: "2026-09-21" } },
        },
        quote: { valid_until: "2026-09-30" },
      });

      assert.equal(validUntil, "2026-09-21");
    },
  },
  {
    name: "snapshot validUntil null does not fall back to quote valid_until",
    run: () => {
      const validUntil = resolveSalesQuoteVersionValidUntil({
        version: {
          quote_snapshot: { quote: { validUntil: null } },
        },
        quote: { valid_until: "2026-09-21" },
      });

      assert.equal(validUntil, null);
    },
  },
  {
    name: "legacy snapshot without validUntil falls back to quote valid_until",
    run: () => {
      const validUntil = resolveSalesQuoteVersionValidUntil({
        version: {
          quote_snapshot: { quote: { quoteNumber: "ORC-1" } },
        },
        quote: { valid_until: "2026-09-30" },
      });

      assert.equal(validUntil, "2026-09-30");
    },
  },
  {
    name: "expiration date-only matrix",
    run: () => {
      assert.equal(isSalesQuoteVersionExpired({ validUntil: "2026-09-21", today: "2026-09-22" }), true);
      assert.equal(isSalesQuoteVersionExpired({ validUntil: "2026-09-22", today: "2026-09-22" }), false);
      assert.equal(isSalesQuoteVersionExpired({ validUntil: "2026-09-23", today: "2026-09-22" }), false);
      assert.equal(isSalesQuoteVersionExpired({ validUntil: null, today: "2026-09-22" }), false);
    },
  },
  {
    name: "expired version throws stable QuoteAccessError before caller mutates",
    run: () => {
      assert.throws(
        () =>
          assertSalesQuoteVersionNotExpired({
            version: {
              quote_snapshot: { quote: { validUntil: "2026-09-21" } },
            },
            quote: { valid_until: null },
            today: "2026-09-22",
          }),
        (error: unknown) =>
          Boolean(
            error &&
              typeof error === "object" &&
              (error as { code?: string }).code === "QUOTE_VERSION_EXPIRED",
          ),
      );
    },
  },
];

async function main() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`quote-expiration: ${tests.length} tests passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
